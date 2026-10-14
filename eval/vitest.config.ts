import { defineConfig } from "vitest/config";

// Eigene Konfiguration für die Evaluation (läuft unter Node, ruft die echte Claude API auf).
export default defineConfig({
  test: {
    environment: "node",
    include: ["eval/**/*.eval.ts"],
    testTimeout: 4 * 60 * 60 * 1000,
  },
});
