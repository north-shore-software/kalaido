import { defineConfig } from "vite";
import { testingAliases } from "./testing-aliases";

// The route registry imports every page, and two of them pull in the cloud
// clients, which refuse to load without these. Route validation never talks
// to the cloud, so a standalone `pnpm check:routes` gets placeholders;
// kalaido.sh exports the real values first and wins.
process.env.VITE_BETTER_AUTH_URL ??= "http://cloud.invalid";
process.env.VITE_CLOUD_PB_URL ??= "http://cloud.invalid";

export default defineConfig({
  resolve: {
    alias: testingAliases,
  },
});
