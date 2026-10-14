import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";

const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
const staged = process.argv.includes("--staged");
const history = process.argv.includes("--history");
const refIndex = process.argv.indexOf("--ref");
const historyRef = refIndex < 0 ? undefined : process.argv[refIndex + 1];
if (refIndex >= 0) assert.ok(historyRef && !historyRef.startsWith("-"), "An explicit history ref is required");
const explicitPrivacyRules = process.env.DSM_TERMINAL_PRIVACY_RULES;
const privatePatterns = await readFile(explicitPrivacyRules ?? ".local/privacy.json", "utf8").then(JSON.parse).then(value => value.forbidden).catch(error => {
  if (error.code === "ENOENT" && !explicitPrivacyRules) return [];
  throw error;
});
assert.ok(Array.isArray(privatePatterns) && privatePatterns.every(value => typeof value === "string" && value.length), "Invalid local privacy rules");
const failures = [];
const secret = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\r?\n(?:[A-Za-z0-9+/=]{40,}\r?\n){2}|\b(?:gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16})\b/;
const privatePath = /(^|\/)(?:\.local|\.codegraph|node_modules|data)(\/|$)|(^|\/)(?:credentials\.key|profiles\.json|\.env(?:\..*)?)$|\.(?:spk|log|pem|key|tmp)$/i;
function check(label, bytes) {
  const value = bytes.toString("utf8");
  if (privatePatterns.some(pattern => value.toLowerCase().includes(pattern.toLowerCase()))) failures.push(`${label}: local privacy rule matched`);
  if (secret.test(value)) failures.push(`${label}: possible credential material`);
}
const files = [...new Set(git("ls-files", ...(staged ? ["--cached"] : ["--cached", "--others", "--exclude-standard"]), "-z").split("\0").filter(Boolean))];
for (const path of files) {
  check(`${path}:name`, path);
  if (privatePath.test(path)) failures.push(`${path}: private artifact must not be tracked`);
  if (staged) check(`index:${path}`, git("show", `:${path}`));
  else if (await stat(path).then(value => value.isFile()).catch(() => false)) check(path, await readFile(path));
}
if (history) {
  const revisions = git("rev-list", ...(historyRef ? ["--end-of-options", historyRef] : ["--branches", "--tags", "--remotes"])).trim().split("\n").filter(Boolean);
  const blobs = new Set();
  for (const revision of revisions) {
    check(`commit:${revision.slice(0, 8)}`, git("show", "-s", "--format=%an <%ae>%n%cn <%ce>%n%B", revision));
    for (const entry of git("ls-tree", "-rz", revision).split("\0").filter(Boolean)) {
      const [header, path] = entry.split("\t");
      const [mode, type, oid] = header.split(" ");
      check(`${revision.slice(0, 8)}:path`, path);
      if (type !== "blob" || blobs.has(oid)) continue;
      blobs.add(oid);
      if (privatePath.test(path)) failures.push(`${revision.slice(0, 8)}:${path}: private historical artifact`);
      check(`${revision.slice(0, 8)}:${path}`, git("cat-file", "blob", oid));
    }
  }
}
if (failures.length) { console.error(failures.join("\n")); process.exitCode = 1; }
else console.log(`Publication check passed: ${files.length} files${history ? (historyRef ? ", selected-ref reachable history" : ", branch/tag/remote reachable history") : ""}; generic secret patterns and available local privacy rules`);
