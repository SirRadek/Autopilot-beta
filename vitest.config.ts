import { defineConfig } from "vitest/config";

// Scope the suite to the real beta tests only. Without this, vitest scans the
// whole working tree and picks up scratch test files (e.g. radeq_tmp/, output/),
// which pollutes `npm run verify`. Keep the suite deterministic and beta-only.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "radeq_tmp/**", "output/**"]
  }
});
