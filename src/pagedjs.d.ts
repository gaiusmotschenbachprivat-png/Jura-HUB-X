declare module "pagedjs" {
  export class Previewer {
    constructor(options?: Record<string, unknown>);
    preview(content: string | Node, stylesheets: (string | Record<string, string>)[], renderTo: HTMLElement): Promise<{ total?: number; pages?: unknown[] }>;
    polisher?: { destroy?: () => void };
  }
}
