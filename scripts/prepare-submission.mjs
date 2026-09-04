// Export current source, including uncommitted task work, without Git history.
// Does not overwrite an existing export or change the original repository.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destination = path.join(root, ".github-upload");
if (existsSync(destination)) throw new Error(".github-upload already exists. Preserve it or choose a new export destination before rerunning.");
const candidates = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
const forbidden = /(^|\/)(\.git|\.github-upload|submission-artifacts|node_modules|\.dbdata[^/]*|\.qa|\.p18|dist|build|coverage)(\/|$)|(^|\/)\.env(?!\.example$)(\.|$)|\.(pem|key|p12|pfx|log)$/i;
const patterns = [
  /rzp_live_[A-Za-z0-9]{8,}/,
  /sk-ant-api\d+-[A-Za-z0-9_-]{20,}/,
  /gh[pousr]_[A-Za-z0-9]{30,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];
// Compare candidate files with configured local secret values without logging
// those values. This supplements patterns; it is not a full secret audit.
const configuredSecrets = existsSync(path.join(root, ".env"))
  ? readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*([A-Z_]*(?:SECRET|API_KEY|PASSWORD|KEY_ID))\s*=\s*(.*?)\s*$/);
    if (!match) return [];
    const value = match[2].replace(/^['"]|['"]$/g, "");
    return value.length >= 12 && !/^(replace-|development-only-)/.test(value) ? [value] : [];
  }) : [];
const files = [...new Set(candidates)].filter((file) => !forbidden.test(file) && existsSync(path.join(root, file)));
for (const file of files) {
  const absolute = path.resolve(root, file);
  if (!absolute.startsWith(root + path.sep)) throw new Error(`Invalid source path: ${file}`);
  const info = lstatSync(absolute);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Not a regular source file: ${file}`);
  if (info.size > 50 * 1024 * 1024) throw new Error(`Unexpected large file: ${file}`);
  const data = readFileSync(absolute);
  if (data.includes(0)) continue;
  const text = data.toString("utf8");
  if (patterns.some((pattern) => pattern.test(text)) || configuredSecrets.some((secret) => text.includes(secret))) {
    throw new Error(`Possible secret in ${file}; export stopped. Values are intentionally not printed.`);
  }
}
mkdirSync(destination);
for (const file of files) {
  const target = path.join(destination, file);
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(path.join(root, file), target);
}
console.log(`Exported ${files.length} source files to .github-upload without Git history, local databases, or environment files (except .env.example).`);
