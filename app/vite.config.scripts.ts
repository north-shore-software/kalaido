import { defineConfig } from "vite";
import { testingAliases } from "./testing-aliases";

export default defineConfig({
  resolve: {
    alias: testingAliases,
  },
});
