import "@fontsource-variable/source-serif-4";
import "@fontsource-variable/inter";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/components.css";
import "./styles/editor.css";
import "./styles/documents.css";
import "./styles/learning.css";
import "./styles/glossar.css";
import "katex/dist/katex.min.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";

// Browser-/iPad-Version: App-Dateien offline vorhalten (keine Nutzerdaten im Cache).
// Neue Version: Der Service Worker übernimmt sofort; die Seite speichert offene
// Änderungen und lädt einmal neu. Beim Zurückkehren zur App wird nach Updates gesucht.
if (__WEB_BUILD__ && "serviceWorker" in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloading) return;
    reloading = true;
    void import("./features/editor/saveQueue")
      .then((m) => m.flushAll())
      .catch(() => {})
      .finally(() => location.reload());
  });
  navigator.serviceWorker
    .register("./sw.js")
    .then((reg) => {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") void reg.update().catch(() => {});
      });
    })
    .catch(() => {});
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
