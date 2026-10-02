import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

// Set by the Tauri CLI for its before-commands (desktop or mobile) or overridden
// by APP_TARGET for the web target. Mobile and web builds bundle their own
// entry point instead of the desktop one (index.html).
const target =
  process.env.APP_TARGET ??
  (["android", "ios"].includes(process.env.TAURI_ENV_PLATFORM ?? "")
    ? "mobile"
    : "desktop");

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
    // doesn't apply. The web target now exists, so code-splitting is owed
    // before this limit is lowered.
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      input: path.resolve(
        __dirname,
        target === "mobile"
          ? "mobile.html"
          : target === "web"
            ? "web.html"
            : "index.html",
      ),
    },
    outDir: target === "web" ? "dist-web" : "dist",
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
