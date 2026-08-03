import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(__dirname, "../src");

const BANNED_IMPORTS = [
  "useNavigate",
  "Link",
  "NavLink",
  "Navigate",
  "useHref",
];

// Recursively walks the directory and returns all .ts/.tsx files
function getFiles(dir) {
  const files = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      // Exclude only the top-level src/routes and src/testing (a nested
      // features/*/routes dir must still be checked), plus node_modules.
      if (
        filePath === path.join(SRC_DIR, "routes") ||
        filePath === path.join(SRC_DIR, "testing") ||
        file === "node_modules" ||
        filePath.includes(".stories.")
      ) {
        continue;
      }
      files.push(...getFiles(filePath));
    } else {
      if (
        (file.endsWith(".ts") || file.endsWith(".tsx")) &&
        !file.endsWith(".stories.tsx") &&
        !file.endsWith(".stories.ts")
      ) {
        files.push(filePath);
      }
    }
  }
  return files;
}

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");

  // Regex to find imports from 'react-router-dom'
  // Handles multi-line imports
  const importRegex =
    /import\s+(?:type\s+)?\{([^}]*)}\s+from\s+["']react-router-dom["']/g;

  const violations = [];
  let match = importRegex.exec(content);

  while (match !== null) {
    const importedText = match[1];
    // Split on commas to get individual imports
    const imports = importedText.split(",").map((i) => i.trim());

    for (const rawImport of imports) {
      if (!rawImport) continue;

      // Clean up import name: strip 'type ' prefix, then split on ' as '
      let name = rawImport;
      if (name.startsWith("type ")) {
        name = name.slice(5).trim();
      }
      if (name.includes(" as ")) {
        name = name.split(/\s+as\s+/)[0].trim();
      } else {
        name = name.trim();
      }

      if (BANNED_IMPORTS.includes(name)) {
        // Find line number
        const offset = match.index;
        const lineNum = content.slice(0, offset).split("\n").length;
        violations.push({ lineNum, name });
      }
    }

    match = importRegex.exec(content);
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
          `  - ${relPath}:${v.lineNum}: Imported banned symbol "${v.name}" from "react-router-dom"`,
        );
      }
      failed = true;
    }
  }

  if (failed) {
    console.error(
      "\ncheck-navigation-discipline FAILED. Banned react-router-dom APIs found outside src/routes/.",
    );
    process.exit(1);
  } else {
    console.log(
      "check-navigation-discipline OK — No raw navigation imports found outside of src/routes.",
    );
    process.exit(0);
  }
}

main();
