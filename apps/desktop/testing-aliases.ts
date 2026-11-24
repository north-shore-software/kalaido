import path from "node:path";

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
    find: "@tauri-apps/plugin-clipboard-manager",
    replacement: path.resolve(
      __dirname,
      "src/testing/tauri-stubs/plugin-clipboard-manager.ts",
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
