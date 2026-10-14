/// <reference lib="webworker" />
/** Eigener Einstieg für den pdf.js-Worker: zuerst die Safari-Ergänzung laden. */
import "./streamPolyfill";
import "pdfjs-dist/legacy/build/pdf.worker.mjs";
