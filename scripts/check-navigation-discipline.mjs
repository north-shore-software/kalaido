import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const SCAN_ROOTS = [
  path.join(ROOT_DIR, "packages"),
  path.join(ROOT_DIR, "apps", "desktop", "src"),
];
const IGNORED_DIRS = new Set([
  path.join(ROOT_DIR, "apps", "desktop", "src", "routes"),
  path.join(ROOT_DIR, "apps", "desktop", "src", "testing"),
]);
const SKIP_DIR_NAMES = new Set(["node_modules", "dist", "src-tauri", "target"]);

const BANNED_IMPORTS = [
  "useParams",
  "useLocation",
  "useSearchParams",
  "useNavigate",
  "Link",
  "NavLink",
  "Navigate",
  "useHref",
];

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
  const importRegex =
    /import\s+(?:type\s+)?\{([^}]*)}\s+from\s+["']react-router-dom["']/g;

  const violations = [];
  let match = importRegex.exec(content);

  while (match !== null) {
    const importedText = match[1];
    const imports = importedText.split(",").map((i) => i.trim());

    for (const rawImport of imports) {
      if (!rawImport) continue;

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
  const files = SCAN_ROOTS.flatMap(getFiles);
  let failed = false;

  for (const file of files) {
    const violations = checkFile(file);
    if (violations.length > 0) {
      const relPath = path.relative(ROOT_DIR, file);
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
      "\ncheck-navigation-discipline FAILED. Banned react-router-dom APIs found outside apps/desktop/src/routes/.",
    );
    process.exit(1);
  } else {
    console.log(
      "check-navigation-discipline OK — No raw navigation imports found in packages/ or outside apps/desktop/src/routes/.",
    );
    process.exit(0);
  }
}

main();
