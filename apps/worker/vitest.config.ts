import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Vitest doesn't follow package.json subpath exports for symlinked workspace packages.
      // Point directly at the source entrypoint so tests can import @orun/db/runtime.
      "@orun/db/runtime": path.resolve(__dirname, "../../packages/db/src/runtime.ts"),
    },
  },
  test: {
    globals: true,
    passWithNoTests: true,
  },
});
