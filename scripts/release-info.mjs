import assert from "node:assert/strict";
import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function releaseInfo(version, appVersion, ref = "") {
  assert.equal(typeof version, "string", "Package version is required");
  assert.equal(version.trim(), version, "Package version must not contain surrounding whitespace");
  assert.match(version, /^\d+\.\d+\.\d+-\d{4,}$/, "Invalid DSM package version");
  assert.equal(version.split("-")[0], appVersion, "Application and DSM package versions must agree");
  const tag = `v${version}`;
  if (ref.startsWith("refs/tags/")) assert.equal(ref, `refs/tags/${tag}`, "Tag must match packages/dsm/version.json");
  return { version, tag, file: `DSM-Terminal-${version}-apollolake.spk` };
}

export async function readReleaseInfo(ref = process.env.GITHUB_REF ?? "") {
  const [{ version }, app] = await Promise.all([
    readFile(new URL("../packages/dsm/version.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse)
  ]);
  return releaseInfo(version, app.version, ref);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const info = await readReleaseInfo();
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, Object.entries(info).map(([key, value]) => `${key}=${value}\n`).join(""));
  }
  console.log(JSON.stringify(info));
}
