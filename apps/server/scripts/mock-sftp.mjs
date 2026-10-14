import fs from "node:fs";
import path from "node:path";
import ssh2 from "ssh2";

const { STATUS_CODE, flagsToString } = ssh2.utils.sftp;

export function attachMockSftp(client, root, configureSession = () => undefined) {
  client.on("session", (accept) => {
    const session = accept();
    configureSession(session);
    session.on("sftp", (acceptSftp) => {
      const sftp = acceptSftp();
      let nextHandle = 1;
      const handles = new Map();
      const resolvePath = (remote) => {
        const local = path.resolve(root, "." + path.posix.resolve("/", remote));
        if (local !== root && !local.startsWith(root + path.sep)) throw new Error("Invalid path");
        return local;
      };
      const attrs = (stat) => ({ mode: stat.mode, uid: stat.uid, gid: stat.gid, size: stat.size, atime: Math.floor(stat.atimeMs / 1000), mtime: Math.floor(stat.mtimeMs / 1000) });
      const fail = (id, error) => sftp.status(id, error.code === "ENOENT" ? STATUS_CODE.NO_SUCH_FILE : error.code === "EACCES" ? STATUS_CODE.PERMISSION_DENIED : STATUS_CODE.FAILURE, error.message);
      const handle = (value) => {
        const key = Buffer.alloc(4); key.writeUInt32BE(nextHandle++);
        handles.set(key.toString("hex"), value); return key;
      };
      sftp.on("REALPATH", (id, remote) => {
        const normalized = remote === "." ? "/home/demo" : path.posix.resolve("/", remote);
        fs.realpath(resolvePath(normalized), (error) => error ? fail(id, error) : sftp.name(id, [{ filename: normalized, longname: normalized, attrs: {} }]));
      });
      sftp.on("STAT", (id, remote) => fs.stat(resolvePath(remote), (error, stat) => error ? fail(id, error) : sftp.attrs(id, attrs(stat))));
      sftp.on("LSTAT", (id, remote) => fs.lstat(resolvePath(remote), (error, stat) => error ? fail(id, error) : sftp.attrs(id, attrs(stat))));
      sftp.on("OPENDIR", (id, remote) => {
        fs.readdir(resolvePath(remote), (error, names) => {
          if (error) return fail(id, error);
          const entries = names.map((name) => ({ filename: name, longname: name, attrs: attrs(fs.lstatSync(path.join(resolvePath(remote), name))) }));
          sftp.handle(id, handle({ entries, sent: false }));
        });
      });
      sftp.on("READDIR", (id, key) => {
        const directory = handles.get(key.toString("hex"));
        if (!directory || directory.sent || !directory.entries.length) return sftp.status(id, STATUS_CODE.EOF);
        directory.sent = true; sftp.name(id, directory.entries);
      });
      sftp.on("OPEN", (id, remote, flags, attributes) => {
        fs.open(resolvePath(remote), flagsToString(flags), attributes.mode ?? 0o644, (error, fd) => error ? fail(id, error) : sftp.handle(id, handle({ fd })));
      });
      sftp.on("READ", (id, key, offset, length) => {
        const file = handles.get(key.toString("hex"));
        if (!file || file.fd === undefined) return sftp.status(id, STATUS_CODE.FAILURE);
        const data = Buffer.alloc(length);
        fs.read(file.fd, data, 0, length, offset, (error, bytesRead) => error ? fail(id, error) : bytesRead ? sftp.data(id, data.subarray(0, bytesRead)) : sftp.status(id, STATUS_CODE.EOF));
      });
      sftp.on("WRITE", (id, key, offset, data) => {
        const file = handles.get(key.toString("hex"));
        if (!file || file.fd === undefined) return sftp.status(id, STATUS_CODE.FAILURE);
        fs.write(file.fd, data, 0, data.length, offset, (error) => error ? fail(id, error) : sftp.status(id, STATUS_CODE.OK));
      });
      sftp.on("FSTAT", (id, key) => {
        const file = handles.get(key.toString("hex"));
        if (!file || file.fd === undefined) return sftp.status(id, STATUS_CODE.FAILURE);
        fs.fstat(file.fd, (error, stat) => error ? fail(id, error) : sftp.attrs(id, attrs(stat)));
      });
      sftp.on("CLOSE", (id, key) => {
        const file = handles.get(key.toString("hex")); handles.delete(key.toString("hex"));
        if (file?.fd !== undefined) fs.close(file.fd, (error) => error ? fail(id, error) : sftp.status(id, STATUS_CODE.OK));
        else sftp.status(id, STATUS_CODE.OK);
      });
      sftp.on("MKDIR", (id, remote, attributes) => fs.mkdir(resolvePath(remote), { mode: attributes.mode ?? 0o755 }, (error) => error ? fail(id, error) : sftp.status(id, STATUS_CODE.OK)));
      sftp.on("RMDIR", (id, remote) => fs.rmdir(resolvePath(remote), (error) => error ? fail(id, error) : sftp.status(id, STATUS_CODE.OK)));
      sftp.on("REMOVE", (id, remote) => fs.unlink(resolvePath(remote), (error) => error ? fail(id, error) : sftp.status(id, STATUS_CODE.OK)));
      sftp.on("RENAME", (id, from, to) => fs.rename(resolvePath(from), resolvePath(to), (error) => error ? fail(id, error) : sftp.status(id, STATUS_CODE.OK)));
      sftp.on("EXTENDED", (id, name, from, to) => {
        if (name !== "posix-rename@openssh.com") return sftp.status(id, STATUS_CODE.OP_UNSUPPORTED);
        fs.rename(resolvePath(from), resolvePath(to), (error) => error ? fail(id, error) : sftp.status(id, STATUS_CODE.OK));
      });
      sftp.on("SETSTAT", (id, remote, attributes) => {
        if (attributes.mode === undefined) return sftp.status(id, STATUS_CODE.OP_UNSUPPORTED);
        fs.chmod(resolvePath(remote), attributes.mode, (error) => error ? fail(id, error) : sftp.status(id, STATUS_CODE.OK));
      });
      sftp.on("close", () => {
        for (const value of handles.values()) if (value.fd !== undefined) fs.close(value.fd, () => undefined);
        handles.clear();
      });
    });
  });
}
