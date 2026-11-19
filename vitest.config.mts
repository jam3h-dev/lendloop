import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Same V8-isolate style runtime as Convex: catches accidental Node-only APIs.
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    include: ["tests/**/*.test.ts"],
  },
});
