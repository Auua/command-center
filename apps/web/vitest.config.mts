import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    // Required for Testing Library's automatic DOM cleanup between tests
    // (it registers itself on the global afterEach).
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", ".next/**", "e2e/**"],
  },
  resolve: {
    // Mirrors the "@/*" path mapping in tsconfig.json.
    alias: { "@": path.resolve(import.meta.dirname) },
  },
});
