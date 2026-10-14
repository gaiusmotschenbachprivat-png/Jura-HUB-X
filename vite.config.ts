import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

import { webApp } from "./build/webApp";

// Desktop (Tauri): fester Port, keine Bildschirmlöschung.
// Browser-/iPad-Version: `vite build --mode web` (relative Pfade, Offline-Betrieb).
export default defineConfig(({ mode }) => {
  const web = mode === "web";
  return {
    plugins: [react(), ...(web ? [webApp()] : [])],
    base: web ? "./" : "/",
    publicDir: web ? "public" : false,
    clearScreen: false,
    server: { port: 1420, strictPort: true, host: "127.0.0.1" },
    envPrefix: ["VITE_", "TAURI_ENV_"],
    define: { __WEB_BUILD__: JSON.stringify(web) },
    optimizeDeps: { exclude: ["@sqlite.org/sqlite-wasm"] },
    worker: { format: "es" },
    build: {
      target: "es2022",
      sourcemap: false,
      chunkSizeWarningLimit: 3000,
      outDir: web ? "dist-web" : "dist",
    },
    test: {
      environment: "jsdom",
      include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    },
  };
});
