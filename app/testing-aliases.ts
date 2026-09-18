import path from "node:path";

/**
 * Module aliases for code that runs outside the Tauri webview — route
 * validation under vite-node and the vitest suite. Every `@tauri-apps/*`
 * entry point the app imports resolves to a stub in `src/testing/tauri-stubs`,
 * and image imports to a placeholder, so importing a module that *touches*
 * Tauri never drags the real plugin into a Node process.
 */
export const testingAliases = [
  {
    find: /^.*\.(png|jpg|jpeg|svg|gif|webp)$/,
    replacement: path.resolve(__dirname, "src/testing/tauri-stubs/png-mock.ts"),
  },
  {
    find: "@tauri-apps/api/core",
    replacement: path.resolve(__dirname, "src/testing/tauri-stubs/api-core.ts"),
  },
  {
    find: "@tauri-apps/api/event",
    replacement: path.resolve(
      __dirname,
      "src/testing/tauri-stubs/api-event.ts",
    ),
  },
  {
    find: "@tauri-apps/plugin-store",
    replacement: path.resolve(
      __dirname,
      "src/testing/tauri-stubs/plugin-store.ts",
    ),
  },
  {
    find: "@tauri-apps/plugin-dialog",
    replacement: path.resolve(
      __dirname,
      "src/testing/tauri-stubs/plugin-dialog.ts",
    ),
  },
  {
    find: "@tauri-apps/plugin-opener",
    replacement: path.resolve(
      __dirname,
      "src/testing/tauri-stubs/plugin-opener.ts",
    ),
  },
  { find: "@", replacement: path.resolve(__dirname, "./src") },
];
