import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { testingAliases } from "./apps/desktop/testing-aliases";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: testingAliases,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./vitest.setup.ts",
    include: ["packages/**/*.test.{ts,tsx}", "apps/**/*.test.{ts,tsx}"],
  },
});
