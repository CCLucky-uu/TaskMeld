import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const pkgPath = join(__dirname, "..", "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
const version = pkg.version ?? "0.0.0";

const versionFilePath = join(__dirname, "..", "src", "version.ts");
const content = [
  "// 由 scripts/gen-version.ts 自动生成，请勿手动编辑",
  `export const APP_VERSION = "${version}";`,
  "",
].join("\n");

writeFileSync(versionFilePath, content, "utf-8");
console.log(`[gen-version] APP_VERSION = ${version}`);
