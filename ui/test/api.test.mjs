import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

Object.defineProperty(globalThis, "location", { value: { pathname: "/mail/" }, configurable: true });
Object.defineProperty(globalThis, "window", { value: {}, configurable: true });

const output = await build({
  entryPoints: [fileURLToPath(new URL("../src/api.ts", import.meta.url))],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  target: "es2022"
});
const api = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].contents).toString("base64")}`);
const originalFetch = globalThis.fetch;

async function setStreamCapability(route) {
  globalThis.fetch = async () => new Response(JSON.stringify({
    System: { token: "test-token" },
    Plugins: route === undefined ? {} : { "ai-copilot": { rustStream: { route } } }
  }), { headers: { "Content-Type": "application/json" } });
  await api.loadApp();
}

function streamed(chunks, headers = {}) {
  let index = 0;
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(chunks[index++]);
      else controller.close();
    },
    cancel() { cancelled = true; }
  });
  return {
    response: new Response(body, { status: 200, headers }),
    cancelled: () => cancelled
  };
}

test("plugin errors keep their machine-readable cause", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    Result: { error: "Bitte bestätigen", status: 403, code: "consent_required" }
  }), { headers: { "Content-Type": "application/json" } });
  try {
    await assert.rejects(api.plugin("AiChat"), (error) => {
      assert.equal(error.reason, "consent_required");
      assert.equal(error.code, 403);
      assert.equal(error.message, "Bitte bestätigen");
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("streamEvents accepts arbitrary bytes and a final unterminated done block", async () => {
  const bytes = new TextEncoder().encode("event: delta\r\ndata: {\"text\":\"Grüße\"}\r\n\r\nevent: done\r\ndata: {\"body\":\"fertig\"}");
  const source = streamed(Array.from(bytes, (byte) => new Uint8Array([byte])));
  globalThis.fetch = async () => source.response;
  const events = [];
  try {
    await api.streamEvents("AiStream", {}, (event, data) => events.push({ event, data }));
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(events, [
    { event: "delta", data: { text: "Grüße" } },
    { event: "done", data: { body: "fertig" } }
  ]);
  assert.equal(source.response.body.locked, false);
});

test("streamEvents rejects EOF without terminal done", async () => {
  globalThis.fetch = async () => new Response("event: delta\n\ndata: {\"text\":\"partial\"}\n\n");
  try {
    await assert.rejects(api.streamEvents("AiStream", {}, () => undefined), /Verbindung unterbrochen/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("streamEvents cancels and releases the reader when a callback throws", async () => {
  const encoder = new TextEncoder();
  const source = streamed([
    encoder.encode("event: done\n\ndata: {\"body\":\"one\"}\n\n"),
    encoder.encode("event: delta\n\ndata: {\"text\":\"two\"}\n\n")
  ]);
  globalThis.fetch = async () => source.response;
  const failure = new Error("callback failed");
  try {
    await assert.rejects(api.streamEvents("AiStream", {}, () => { throw failure; }), (error) => error === failure);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(source.cancelled(), true);
  assert.equal(source.response.body.locked, false);
});

test("streamEvents rejects malformed event JSON and releases the reader", async () => {
  const source = streamed([
    new TextEncoder().encode("event: delta\n\ndata: {broken}\n\n"),
    new TextEncoder().encode("event: delta\n\ndata: {\"text\":\"unread\"}\n\n")
  ]);
  globalThis.fetch = async () => source.response;
  try {
    await assert.rejects(api.streamEvents("AiStream", {}, () => undefined), /keine lesbare Antwort/);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(source.cancelled(), true);
  assert.equal(source.response.body.locked, false);
});

test("fetchText enforces its limit while reading and cancels the stream", async () => {
  const source = streamed([new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6]), new Uint8Array([7])]);
  globalThis.fetch = async () => source.response;
  try {
    await assert.rejects(api.fetchText("/large", 5), /Datei zu groß/);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(source.cancelled(), true);
  assert.equal(source.response.body.locked, false);
});

test("call passes an optional AbortSignal to fetch", async () => {
  const controller = new AbortController();
  let received;
  globalThis.fetch = async (_url, options) => {
    received = options.signal;
    return new Response(JSON.stringify({ Result: { ok: true } }), { headers: { "Content-Type": "application/json" } });
  };
  try {
    assert.deepEqual(await api.call("Ping", {}, controller.signal), { ok: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(received, controller.signal);
});

test("authenticated AppData selects the Rust stream route below the application prefix", async () => {
  const requests = [];
  try {
    await setStreamCapability("api/ai/stream");
    globalThis.fetch = async (url, options) => {
      requests.push({ url, options });
      return new Response("event: done\ndata: {\"body\":\"fertig\"}\n\n");
    };
    await api.streamEvents("AiStream", { mode: "new" }, () => undefined);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "/mail/api/ai/stream");
    assert.equal(requests[0].options.credentials, "same-origin");
    assert.equal(requests[0].options.headers["X-SM-Token"], "test-token");
  } finally {
    await setStreamCapability(undefined);
    globalThis.fetch = originalFetch;
  }
});

test("withdrawing or invalidating the capability selects the PHP route", async () => {
  const requests = [];
  try {
    for (const route of ["https://example.invalid/stream", "../api/ai/stream", undefined]) {
      await setStreamCapability(route);
      globalThis.fetch = async (url) => {
        requests.push(url);
        return new Response("event: done\ndata: {\"body\":\"fertig\"}\n\n");
      };
      await api.streamEvents("AiStream", {}, () => undefined);
    }
    assert.deepEqual(requests, Array(3).fill("/mail/?/AiStream/"));
  } finally {
    await setStreamCapability(undefined);
    globalThis.fetch = originalFetch;
  }
});

test("a Rust failure is not replayed through the PHP endpoint", async () => {
  const requests = [];
  try {
    await setStreamCapability("api/ai/stream");
    globalThis.fetch = async (url) => {
      requests.push(url);
      return new Response("unavailable", { status: 503 });
    };
    await assert.rejects(api.streamEvents("AiStream", {}, () => undefined), /Verbindung unterbrochen/);
    assert.deepEqual(requests, ["/mail/api/ai/stream"]);
  } finally {
    await setStreamCapability(undefined);
    globalThis.fetch = originalFetch;
  }
});
