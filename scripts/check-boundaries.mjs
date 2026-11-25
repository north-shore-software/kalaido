import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const ALLOWED_INTERNAL_DEPS = {
  brand: [],
  "packages/lib/platform": [],
  "packages/lib/client": ["@kalaido/platform"],
  "packages/react/primitives": ["@kalaido/brand"],
  "packages/react/state": [],
  "packages/react/hooks": [
    "@kalaido/platform",
    "@kalaido/client",
    "@kalaido/state",
  ],
  "packages/react/components": [
    "@kalaido/brand",
    "@kalaido/platform",
    "@kalaido/client",
    "@kalaido/primitives",
    "@kalaido/state",
    "@kalaido/hooks",
  ],
  "packages/react/features": [
    "@kalaido/platform",
    "@kalaido/client",
    "@kalaido/primitives",
    "@kalaido/state",
    "@kalaido/hooks",
    "@kalaido/components",
  ],
  "apps/desktop": [
    "@kalaido/platform",
    "@kalaido/client",
    "@kalaido/primitives",
    "@kalaido/state",
    "@kalaido/hooks",
    "@kalaido/components",
    "@kalaido/features",
  ],
  "apps/mobile": [
    "@kalaido/platform",
    "@kalaido/client",
    "@kalaido/primitives",
    "@kalaido/state",
    "@kalaido/hooks",
    "@kalaido/components",
    "@kalaido/features",
  ],
  "apps/web": [
    "@kalaido/platform",
    "@kalaido/client",
    "@kalaido/primitives",
    "@kalaido/state",
    "@kalaido/hooks",
    "@kalaido/components",
    "@kalaido/features",
  ],
};

const BANNED_DEPS_BY_PKG = {
  "packages/lib/platform": [
    "react",
    "react-dom",
    "react-router-dom",
    "@tauri-apps/plugin-dialog",
    "@tauri-apps/plugin-shell",
    "@tauri-apps/plugin-updater",
  ],
  "packages/lib/client": [
    "react",
    "react-dom",
    "react-router-dom",
    "@tauri-apps/*",
  ],
  "packages/react/primitives": [
    "pocketbase",
    "better-auth",
    "@ai-sdk/react",
    "ai",
    "swr",
    "valtio",
    "react-router-dom",
    "@tauri-apps/*",
  ],
  "packages/react/state": [
    "better-auth",
    "@ai-sdk/react",
    "ai",
    "react-router-dom",
    "@tauri-apps/*",
  ],
  "packages/react/hooks": [
    "react-router-dom",
    "@tauri-apps/*",
    "swr",
    "valtio",
    "better-auth",
  ],
  "packages/react/components": [
    "react-router-dom",
    "@tauri-apps/*",
    "swr",
    "valtio",
    "better-auth",
  ],
  "packages/react/features": [
    "react-router-dom",
    "@tauri-apps/*",
    "swr",
    "valtio",
    "better-auth",
  ],
  "apps/desktop": ["swr", "valtio", "better-auth"],
  "apps/mobile": [
    "@tauri-apps/plugin-dialog",
    "@tauri-apps/plugin-shell",
    "@tauri-apps/plugin-updater",
    "swr",
    "valtio",
    "better-auth",
  ],
  "apps/web": ["@tauri-apps/*", "swr", "valtio", "better-auth"],
};

const ALLOWED_LOCALSTORAGE_FILES = new Set([
  "packages/lib/platform/src/web.ts",
  "apps/desktop/src/features/onboarding/restore.ts",
]);

const REQUIRED_TAILWIND_SOURCES = [
  "packages/react/primitives/src/index.css",
  "packages/react/components/src/styles.css",
  "packages/react/features/src/styles.css",
];

function stripJsComments(source) {
  let out = "";
  let i = 0;
  const len = source.length;
  const templateBraceDepths = [];

  const scanTemplateChunk = () => {
    while (i < len) {
      const c = source[i];
      if (c === "\\" && i + 1 < len) {
        out += c + source[i + 1];
        i += 2;
        continue;
      }
      if (c === "`") {
        out += c;
        i++;
        return;
      }
      if (c === "$" && source[i + 1] === "{") {
        out += "${";
        i += 2;
        templateBraceDepths.push(0);
        return;
      }
      out += c;
      i++;
    }
  };

  while (i < len) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === "/" && next === "/") {
      i += 2;
      while (i < len && source[i] !== "\n") i++;
      continue;
    }

    if (ch === "/" && next === "*") {
      i += 2;
      while (i < len && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i += 2;
      out += " ";
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      out += ch;
      i++;
      while (i < len) {
        const c = source[i];
        out += c;
        i++;
        if (c === "\\" && i < len) {
          out += source[i];
          i++;
          continue;
        }
        if (c === quote) break;
      }
      continue;
    }

    if (ch === "`") {
      out += ch;
      i++;
      scanTemplateChunk();
      continue;
    }

    if (templateBraceDepths.length > 0) {
      if (ch === "{") {
        templateBraceDepths[templateBraceDepths.length - 1]++;
      } else if (ch === "}") {
        if (templateBraceDepths[templateBraceDepths.length - 1] === 0) {
          templateBraceDepths.pop();
          out += ch;
          i++;
          scanTemplateChunk();
          continue;
        }
        templateBraceDepths[templateBraceDepths.length - 1]--;
      }
    }

    out += ch;
    i++;
  }

  return out;
}

function matchesPattern(dep, pattern) {
  if (pattern.endsWith("/*")) {
    return dep.startsWith(pattern.slice(0, -1));
  }
  return dep === pattern;
}

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relPath), "utf-8"));
}

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name === "node_modules" ||
      entry.name === "dist" ||
      entry.name === "src-tauri" ||
      entry.name === "target"
    ) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

function main() {
  const errors = [];

  for (const [pkgDir, allowed] of Object.entries(ALLOWED_INTERNAL_DEPS)) {
    const pkgJsonPath = `${pkgDir}/package.json`;
    const pkg = readJson(pkgJsonPath);
    const allDeps = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
    ];

    const allowedSet = new Set(allowed);
    for (const dep of allDeps) {
      if (dep.startsWith("@kalaido/") && !allowedSet.has(dep)) {
        errors.push(
          `${pkgJsonPath}: forbidden internal dependency "${dep}" (allowed: ${allowed.join(", ") || "none"})`,
        );
      }
    }

    const banned = BANNED_DEPS_BY_PKG[pkgDir] ?? [];
    for (const dep of allDeps) {
      for (const pattern of banned) {
        if (matchesPattern(dep, pattern)) {
          errors.push(
            `${pkgJsonPath}: forbidden dependency "${dep}" (matches "${pattern}")`,
          );
        }
      }
    }

    const srcDir = path.join(ROOT, pkgDir, "src");
    for (const file of walkFiles(srcDir)) {
      if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue;
      if (pkgDir.startsWith("packages/lib/") && file.endsWith(".tsx")) {
        errors.push(
          `${path.relative(ROOT, file)}: .tsx files are not allowed in packages/lib/*`,
        );
      }
      const text = fs.readFileSync(file, "utf-8");
      const relFile = path.relative(ROOT, file).replace(/\\/g, "/");
      if (
        !ALLOWED_LOCALSTORAGE_FILES.has(relFile) &&
        /\blocalStorage\b/.test(stripJsComments(text))
      ) {
        errors.push(
          `${relFile}: direct localStorage access is forbidden outside packages/lib/platform/src/web.ts`,
        );
      }
      const relImportRegex = /from\s+["'](\.[^"']+)["']/g;
      let match = relImportRegex.exec(text);
      while (match !== null) {
        const resolved = path.resolve(path.dirname(file), match[1]);
        const relToRoot = path.relative(ROOT, resolved);
        if (
          !resolved.startsWith(srcDir + path.sep) &&
          resolved !== srcDir &&
          !relToRoot.startsWith("kalaidoscope/")
        ) {
          errors.push(
            `${path.relative(ROOT, file)}: relative import "${match[1]}" escapes ${pkgDir}/src`,
          );
        }
        match = relImportRegex.exec(text);
      }
    }
  }

  for (const libPkg of ["packages/lib/platform", "packages/lib/client"]) {
    const tsconfig = readJson(`${libPkg}/tsconfig.json`);
    const types = tsconfig.compilerOptions?.types ?? [];
    if (types.includes("vite/client")) {
      errors.push(
        `${libPkg}/tsconfig.json: "vite/client" is not allowed in packages/lib/*`,
      );
    }
  }

  for (const cssPath of REQUIRED_TAILWIND_SOURCES) {
    const content = fs.readFileSync(path.join(ROOT, cssPath), "utf-8");
    if (!content.includes('@source "./";')) {
      errors.push(`${cssPath}: missing required '@source "./";' directive`);
    }
  }

  if (errors.length > 0) {
    console.error(
      `check-boundaries FAILED:\n${errors.map((e) => `  - ${e}`).join("\n")}`,
    );
    process.exit(1);
  }

  console.log(
    `check-boundaries OK — ${Object.keys(ALLOWED_INTERNAL_DEPS).length} workspace packages checked.`,
  );
}

main();
