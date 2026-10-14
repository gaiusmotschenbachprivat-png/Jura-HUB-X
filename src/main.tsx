import "@fontsource-variable/source-serif-4";
import "@fontsource-variable/inter";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/components.css";
import "./styles/editor.css";
import "./styles/documents.css";
import "./styles/learning.css";
import "katex/dist/katex.min.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";

// Browser-/iPad-Version: App-Dateien offline vorhalten (keine Nutzerdaten im Cache).
if (__WEB_BUILD__ && "serviceWorker" in navigator) {
  void navigator.serviceWorker.register("./sw.js").catch(() => {});
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
