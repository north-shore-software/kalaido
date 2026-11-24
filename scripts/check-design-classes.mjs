import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const SCAN_ROOTS = [
  path.join(ROOT_DIR, "packages"),
  path.join(ROOT_DIR, "apps"),
];
const IGNORED_DIRS = new Set([
  path.join(ROOT_DIR, "packages", "react", "primitives", "src", "shadcn"),
]);
const SKIP_DIR_NAMES = new Set(["node_modules", "dist", "src-tauri", "target"]);

const BANNED_CLASS =
  /\brounded-(?:(?:t|b|l|r|s|e|tl|tr|bl|br|ss|se|es|ee)-)?(?:xs|sm|md|lg|xl|2xl|3xl|4xl)\b/g;

function getFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name) || IGNORED_DIRS.has(filePath)) {
        continue;
      }
      files.push(...getFiles(filePath));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(filePath);
    }
  }
  return files;
}

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const violations = [];
  let match = BANNED_CLASS.exec(content);
  while (match !== null) {
    const lineNum = content.slice(0, match.index).split("\n").length;
    violations.push({ lineNum, name: match[0] });
    match = BANNED_CLASS.exec(content);
  }
  return violations;
}

function main() {
  const files = SCAN_ROOTS.flatMap(getFiles);
  let failed = false;

  for (const file of files) {
    const violations = checkFile(file);
    if (violations.length > 0) {
      const relPath = path.relative(ROOT_DIR, file);
      for (const v of violations) {
        console.error(
          `  - ${relPath}:${v.lineNum}: Radius class "${v.name}" (DESIGN.md §5: zero radius; use rounded-none)`,
        );
      }
      failed = true;
    }
  }

  if (failed) {
    console.error(
      "\ncheck-design-classes FAILED. Radius classes found outside packages/react/primitives/src/shadcn/.",
    );
    process.exit(1);
  } else {
    console.log(
      "check-design-classes OK — No radius classes found outside packages/react/primitives/src/shadcn/.",
    );
    process.exit(0);
  }
}

main();
