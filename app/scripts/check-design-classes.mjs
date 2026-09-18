import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(__dirname, "../src");

// DESIGN.md §5: "Radius. Zero. Everywhere." Every radius token in the Tailwind
// theme is already 0, so a `rounded-lg` renders square — but it reads as if
// the author asked for a radius, and it would silently come alive if a token
// ever changed. Only `rounded-none`, `rounded-full` (status dots, radio
// circles), `rounded-*-none` and arbitrary `rounded-[…]` (the colour swatch)
// are allowed.
const BANNED_CLASS =
  /\brounded-(?:(?:t|b|l|r|s|e|tl|tr|bl|br|ss|se|es|ee)-)?(?:xs|sm|md|lg|xl|2xl|3xl|4xl)\b/g;

// Recursively walks the directory and returns all .ts/.tsx files, stories
// included — stories are the largest source of stray radius classes.
function getFiles(dir) {
  const files = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      // src/components/ui is generated shadcn code (biome excludes it too);
      // its radius classes are neutralised by the zero tokens.
      if (
        filePath === path.join(SRC_DIR, "components", "ui") ||
        file === "node_modules"
      ) {
        continue;
      }
      files.push(...getFiles(filePath));
    } else if (file.endsWith(".ts") || file.endsWith(".tsx")) {
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
  const files = getFiles(SRC_DIR);
  let failed = false;

  for (const file of files) {
    const violations = checkFile(file);
    if (violations.length > 0) {
      const relPath = path.relative(path.resolve(SRC_DIR, ".."), file);
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
      "\ncheck-design-classes FAILED. Radius classes found outside src/components/ui/.",
    );
    process.exit(1);
  } else {
    console.log(
      "check-design-classes OK — No radius classes found outside src/components/ui/.",
    );
    process.exit(0);
  }
}

main();
