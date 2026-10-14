import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
let bash = "bash";

if (process.platform === "win32") {
  const candidates = [
    process.env.ProgramFiles && join(process.env.ProgramFiles, "Git/bin/bash.exe"),
    process.env["ProgramFiles(x86)"] && join(process.env["ProgramFiles(x86)"], "Git/bin/bash.exe")
  ].filter(Boolean);
  bash = candidates.find((candidate) => existsSync(candidate)) ?? "";
  if (!bash) {
    console.error("Git for Windows Bash was not found. Install Git for Windows before packaging the SPK.");
    process.exit(1);
  }
}

const result = spawnSync(bash, ["packages/dsm/build-spk.sh"], {
  cwd: projectRoot,
  stdio: "inherit"
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
