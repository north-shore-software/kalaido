import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

function requireCloudEnv(): void {
  const missing = ["VITE_BETTER_AUTH_URL", "VITE_CLOUD_PB_URL"].filter(
    (key) => !process.env[key],
  );
  if (missing.length > 0) {
    throw new Error(
      `${missing.join(" and ")} not set — run this through ./kalaido.sh (e.g. ./kalaido.sh dev:web), which supplies them.`,
    );
  }
}

requireCloudEnv();

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    chunkSizeWarningLimit: 2500,
    outDir: "dist",
  },
  server: {
    port: 1424,
    strictPort: true,
  },
});
