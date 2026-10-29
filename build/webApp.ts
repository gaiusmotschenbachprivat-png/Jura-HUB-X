/**
 * Vite-Plugin für die Browser-/iPad-Version (`vite build --mode web`):
 * - Web-App-Manifest und Angaben für „Zum Home-Bildschirm“
 * - strenge Content-Security-Policy als <meta> (wie in der Desktop-App)
 * - Service Worker, der alle Dateien der App für den Offline-Betrieb vorhält.
 *   Er speichert ausschließlich die App selbst, nie Nutzerdaten.
 */
import { createHash } from "node:crypto";
import type { Plugin } from "vite";

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // Vorlesungsaufnahmen abspielen (aus dem lokalen Speicher)
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  // Claude API nur für den KI-Assistenten (ausdrücklich eingeschaltet, Schlüssel nur im Speicher)
  "connect-src 'self' https://api.anthropic.com",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const MANIFEST = {
  name: "Studium OS",
  short_name: "Studium OS",
  description: "Lokales Arbeitsinstrument für das Studium – alle Daten bleiben auf dem Gerät.",
  lang: "de",
  start_url: "./",
  scope: "./",
  display: "standalone",
  orientation: "any",
  background_color: "#f7f7f5",
  theme_color: "#f7f7f5",
  icons: [
    { src: "web/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "web/icon-512.png", sizes: "512x512", type: "image/png" },
  ],
};

export function webApp(): Plugin {
  return {
    name: "studium-web-app",
    apply: "build",
    transformIndexHtml() {
      return [
        { tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: CSP }, injectTo: "head-prepend" },
        { tag: "meta", attrs: { name: "referrer", content: "no-referrer" }, injectTo: "head" },
        { tag: "link", attrs: { rel: "manifest", href: "manifest.webmanifest" }, injectTo: "head" },
        { tag: "link", attrs: { rel: "apple-touch-icon", href: "web/apple-touch-icon.png" }, injectTo: "head" },
        { tag: "meta", attrs: { name: "apple-mobile-web-app-capable", content: "yes" }, injectTo: "head" },
        { tag: "meta", attrs: { name: "mobile-web-app-capable", content: "yes" }, injectTo: "head" },
        { tag: "meta", attrs: { name: "apple-mobile-web-app-title", content: "Studium OS" }, injectTo: "head" },
        { tag: "meta", attrs: { name: "apple-mobile-web-app-status-bar-style", content: "default" }, injectTo: "head" },
        // Statusleiste deckend in der Farbe der App (ohne viewport-fit=cover liegt nichts darunter, also kein Weichzeichner)
        { tag: "meta", attrs: { name: "theme-color", content: "#ffffff", media: "(prefers-color-scheme: light)" }, injectTo: "head" },
        { tag: "meta", attrs: { name: "theme-color", content: "#17191e", media: "(prefers-color-scheme: dark)" }, injectTo: "head" },
      ];
    },
    generateBundle(_opts, bundle) {
      this.emitFile({ type: "asset", fileName: "manifest.webmanifest", source: JSON.stringify(MANIFEST, null, 2) });
      const files = Object.keys(bundle)
        .filter((f) => !f.endsWith(".map"))
        .concat(["manifest.webmanifest", "web/apple-touch-icon.png", "web/icon-192.png", "web/icon-512.png"]);
      const version = createHash("sha256").update(files.sort().join("\n")).digest("hex").slice(0, 16);
      this.emitFile({ type: "asset", fileName: "sw.js", source: serviceWorker(version, ["./", ...files]) });
    },
  };
}

function serviceWorker(version: string, files: string[]): string {
  return `// Studium OS – Service Worker (automatisch erzeugt). Hält nur die App-Dateien vor.
const CACHE = "studium-os-${version}";
const FILES = ${JSON.stringify(files)};
self.addEventListener("install", (e) => {
  // Neue Version sofort aktivieren (iPad-Apps auf dem Home-Bildschirm werden sonst nie neu geladen)
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("studium-os-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("message", (e) => {
  if (e.data === "skipWaiting") self.skipWaiting();
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      if (e.request.mode === "navigate") return caches.match("./");
      return fetch(e.request);
    }),
  );
});
`;
}
