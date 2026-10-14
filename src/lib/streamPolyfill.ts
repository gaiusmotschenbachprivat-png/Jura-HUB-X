/**
 * Safari kennt (Stand Safari 26) kein schrittweises Durchlaufen von
 * `ReadableStream` mit `for await`. pdf.js nutzt das beim Auslesen von Text und
 * beim Entpacken. Diese kleine Ergänzung bildet das Verhalten nach dem
 * Web-Standard nach (nur, wenn der Browser es nicht selbst kann).
 */
type Iter<T> = AsyncIterableIterator<T> & { return(v?: unknown): Promise<IteratorResult<T>> };

const proto = (globalThis as { ReadableStream?: { prototype: ReadableStream } }).ReadableStream?.prototype as
  | (ReadableStream & { values?: unknown; [Symbol.asyncIterator]?: unknown })
  | undefined;

if (proto && typeof proto[Symbol.asyncIterator] !== "function") {
  const values = function <T>(this: ReadableStream<T>, opts?: { preventCancel?: boolean }): Iter<T> {
    const reader = this.getReader();
    const it: Iter<T> = {
      next: () => reader.read() as Promise<IteratorResult<T>>,
      async return(value?: unknown) {
        if (!opts?.preventCancel) await reader.cancel(value).catch(() => {});
        reader.releaseLock();
        return { done: true, value: value as T };
      },
      [Symbol.asyncIterator]() {
        return it;
      },
    };
    return it;
  };
  Object.defineProperty(proto, "values", { value: values, configurable: true, writable: true });
  Object.defineProperty(proto, Symbol.asyncIterator, { value: values, configurable: true, writable: true });
}

export {};
