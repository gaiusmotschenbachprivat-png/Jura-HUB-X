// Minimale Typangabe für jsdom (nur DOMParser wird in der Evaluation genutzt).
declare module "jsdom" {
  export class JSDOM {
    constructor(html?: string);
    window: { DOMParser: typeof DOMParser };
  }
}
