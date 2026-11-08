export interface StreamEvent {
  event: string;
  data: string;
}

/** Incremental SSE block parser. A final block does not need a trailing blank line. */
export class EventStreamParser {
  private buffer = "";
  private event = "message";
  private data: string[] = [];

  feed(text: string): StreamEvent[] {
    this.buffer += text;
    return this.take(false);
  }

  finish(): StreamEvent[] {
    const events = this.take(true);
    if (this.buffer) {
      const line = this.buffer;
      this.buffer = "";
      this.line(line, events);
    }
    const final = this.dispatch();
    if (final) events.push(final);
    return events;
  }

  private take(final: boolean): StreamEvent[] {
    const events: StreamEvent[] = [];
    let offset = 0;
    for (let index = 0; index < this.buffer.length; index += 1) {
      const character = this.buffer[index];
      if (character !== "\n" && character !== "\r") continue;
      // A CR at a chunk edge may become CRLF when the next chunk arrives.
      if (character === "\r" && index + 1 === this.buffer.length && !final) break;
      this.line(this.buffer.slice(offset, index), events);
      if (character === "\r" && this.buffer[index + 1] === "\n") index += 1;
      offset = index + 1;
    }
    this.buffer = this.buffer.slice(offset);
    return events;
  }

  private line(line: string, events: StreamEvent[]): void {
    if (!line) {
      const event = this.dispatch();
      if (event) events.push(event);
      return;
    }
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") this.event = value || "message";
    else if (field === "data") this.data.push(value);
  }

  private dispatch(): StreamEvent | null {
    if (!this.data.length) {
      this.event = "message";
      return null;
    }
    const event = { event: this.event || "message", data: this.data.join("\n") };
    this.event = "message";
    this.data = [];
    return event;
  }
}

/** Map with deterministic oldest-first eviction and explicit memory accounting. */
export class BoundedCache<K, V> extends Map<K, V> {
  private weights = new Map<K, number>();
  private bytes = 0;

  private maxEntries: number;
  private maxBytes: number;
  private measure: (value: V, key: K) => number;

  constructor(maxEntries: number, maxBytes: number, measure: (value: V, key: K) => number) {
    super();
    this.maxEntries = Math.max(0, Math.floor(maxEntries));
    this.maxBytes = Math.max(0, maxBytes);
    this.measure = measure;
  }

  get byteSize(): number {
    return this.bytes;
  }

  set(key: K, value: V): this {
    this.delete(key);
    const weight = Math.max(0, this.measure(value, key));
    if (weight > this.maxBytes) return this;
    super.set(key, value);
    this.weights.set(key, weight);
    this.bytes += weight;
    while (this.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldest = this.keys().next();
      if (oldest.done) break;
      this.delete(oldest.value);
    }
    return this;
  }

  delete(key: K): boolean {
    if (!this.has(key)) return false;
    this.bytes -= this.weights.get(key) || 0;
    this.weights.delete(key);
    return super.delete(key);
  }

  clear(): void {
    super.clear();
    this.weights.clear();
    this.bytes = 0;
  }
}

interface QueuedWork {
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  signal?: AbortSignal;
  onAbort: () => void;
}

export function abortReason(signal: AbortSignal): unknown {
  return signal.reason || new DOMException("Die Anfrage wurde abgebrochen.", "AbortError");
}

/** Small shared FIFO limiter; queued work can be aborted before it starts. */
export class ConcurrencyLimiter {
  private queue: QueuedWork[] = [];
  private running = 0;
  private limit: number;

  constructor(limit: number) {
    this.limit = Math.max(1, Math.floor(limit));
  }

  get active(): number {
    return this.running;
  }

  get pending(): number {
    return this.queue.length;
  }

  run<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortReason(signal));
        return;
      }
      const work: QueuedWork = {
        run: run as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
        signal,
        onAbort: () => undefined
      };
      work.onAbort = () => {
        const index = this.queue.indexOf(work);
        if (index < 0) return;
        this.queue.splice(index, 1);
        reject(abortReason(signal as AbortSignal));
      };
      this.queue.push(work);
      signal?.addEventListener("abort", work.onAbort, { once: true });
      this.pump();
    });
  }

  private pump(): void {
    while (this.running < this.limit && this.queue.length) {
      const work = this.queue.shift() as QueuedWork;
      work.signal?.removeEventListener("abort", work.onAbort);
      if (work.signal?.aborted) {
        work.reject(abortReason(work.signal));
        continue;
      }
      this.running += 1;
      Promise.resolve().then(work.run).then(work.resolve, work.reject).finally(() => {
        this.running -= 1;
        this.pump();
      });
    }
  }
}

/** Exponential poll backoff (15 seconds to 5 minutes) with ±20% jitter. */
export function pollBackoff(failures: number, random = Math.random()): number {
  const count = Math.max(1, Math.floor(failures));
  const stable = Math.min(300_000, 15_000 * 2 ** Math.min(6, count - 1));
  const sample = Number.isFinite(random) ? Math.max(0, Math.min(1, random)) : 0.5;
  return Math.min(300_000, Math.round(stable * (0.8 + sample * 0.4)));
}
