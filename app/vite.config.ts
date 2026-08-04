import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

// The cloud endpoints are written down in exactly one place, kalaido.sh, and
// reach the bundle through the environment. Failing here rather than defaulting
// keeps a build that bypassed the script from silently baking in the wrong
// domains — the app has no fallback to fall back to.
function requireCloudEnv(): void {
  const missing = ["VITE_BETTER_AUTH_URL", "VITE_CLOUD_PB_URL"].filter(
    (key) => !process.env[key],
  );
  if (missing.length > 0) {
    throw new Error(
      `${missing.join(" and ")} not set — run this through ./kalaido.sh (e.g. ./kalaido.sh dev), which supplies them.`,
    );
  }
}

requireCloudEnv();

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  build: {
    // The bundle is loaded from local disk by the Tauri webview, not over a
    // network, so Vite's default 500 kB warning (which is about download time)
    // doesn't apply. Revisit if this frontend is ever served as a web app —
    // at that point transfer size becomes real and code-splitting is worth it.
    chunkSizeWarningLimit: 2000,
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
