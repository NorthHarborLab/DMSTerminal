import { generateKeyPairSync } from "node:crypto";
import ssh2 from "ssh2";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attachMockSftp } from "./mock-sftp.mjs";

const { Server } = ssh2;

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const hostKey = privateKey.export({ type: "pkcs1", format: "pem" });
const fileRoot = mkdtempSync(join(tmpdir(), "dsm-mock-sftp-"));
mkdirSync(join(fileRoot, "home/demo/documents"), { recursive: true });
writeFileSync(join(fileRoot, "home/demo/readme.txt"), "DSM Terminal SFTP 测试\n上传、下载和文件管理使用此隔离临时目录\n");
writeFileSync(join(fileRoot, "home/demo/.hidden"), "hidden file\n");

const server = new Server({ hostKeys: [hostKey] }, (client) => {
  client
    .on("error", () => {
      // Unknown-host rejection is expected during the first verification pass.
    })
    .on("authentication", (context) => {
      if (
        context.method === "password" &&
        context.username === "demo" &&
        context.password === "dsm-terminal-demo"
      ) {
        context.accept();
      } else {
        context.reject();
      }
    })
    .on("ready", () => {
      attachMockSftp(client, fileRoot, (session) => {
        session.on("pty", (acceptPty) => acceptPty?.());
        session.on("window-change", (acceptWindowChange) => acceptWindowChange?.());
        session.on("shell", (acceptShell) => {
          const stream = acceptShell();
          stream.write("\x1b[2J\x1b[H\x1b[38;2;112;247;176mDSM Terminal integration test\x1b[0m\r\n");
          stream.write("\x1b[38;5;244mTrueColor + PTY + UTF-8: 中文正常\x1b[0m\r\n");
          stream.write("demo@mock:~$ ");
          stream.on("data", (data) => {
            const input = data.toString();
            stream.write(input.replace(/\r/g, "\r\n"));
            if (input.includes("exit")) stream.exit(0).close();
            else if (input.includes("\r")) stream.write("demo@mock:~$ ");
          });
        });
      });
    });
});

server.listen(22222, "127.0.0.1", () => {
  console.log("Mock SSH server listening on 127.0.0.1:22222");
  console.log("Credentials: demo / dsm-terminal-demo");
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
