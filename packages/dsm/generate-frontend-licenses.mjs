import { createRequire } from "node:module";
import { dirname, resolve, join } from "node:path";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const webRequire = createRequire(join(root, "apps/web/package.json"));
const reactDomRequire = createRequire(webRequire.resolve("react-dom"));
const packages = ["react", "react-dom", "scheduler", "@xterm/xterm", "@xterm/addon-fit"];
const sections = [];
for (const name of packages) {
  let directory = dirname((name === "scheduler" ? reactDomRequire : webRequire).resolve(name));
  let metadata;
  while (true) {
    try {
      const candidate = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
      if (candidate.name === name) { metadata = candidate; break; }
    } catch { /* Continue to this dependency's package root */ }
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`Package metadata missing: ${name}`);
    directory = parent;
  }
  const licenses = (await readdir(directory)).filter(file => /^licen[sc]e(?:\..*)?$/i.test(file)).sort();
  if (!licenses.length) throw new Error(`License missing: ${name}`);
  sections.push(`${name}@${metadata.version}\nLicense: ${metadata.license}\n` +
    (await Promise.all(licenses.map(file => readFile(join(directory, file), "utf8")))).join("\n"));
}
await writeFile(resolve(process.argv[2]), sections.join("\n\n====================\n\n") + "\n");
