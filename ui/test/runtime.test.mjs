import test from "node:test";
import assert from "node:assert/strict";
import { BoundedCache, ConcurrencyLimiter, EventStreamParser, pollBackoff } from "../src/runtime.ts";

const turn = () => new Promise((resolve) => setImmediate(resolve));

test("SSE accepts every CRLF split and an unterminated final done block", () => {
  const input = "event: delta\r\ndata: {\"text\":\"Grüße\"}\r\n\r\nevent: done\r\ndata: {\"body\":\"fertig\"}";
  for (let split = 0; split <= input.length; split += 1) {
    const parser = new EventStreamParser();
    const events = [...parser.feed(input.slice(0, split)), ...parser.feed(input.slice(split)), ...parser.finish()];
    assert.deepEqual(events, [
      { event: "delta", data: "{\"text\":\"Grüße\"}" },
      { event: "done", data: "{\"body\":\"fertig\"}" }
    ], `split ${split}`);
  }
});

test("SSE handles LF, comments, multiline data, and one optional data space", () => {
  const parser = new EventStreamParser();
  const events = [
    ...parser.feed(": keepalive\n\nevent: delta\ndata:  first\ndata:second\n\n"),
    ...parser.feed("data: {\"ok\":true}\n"),
    ...parser.finish()
  ];
  assert.deepEqual(events, [
    { event: "delta", data: " first\nsecond" },
    { event: "message", data: "{\"ok\":true}" }
  ]);
});

test("bounded cache evicts oldest entries by count and bytes", () => {
  const counted = new BoundedCache(2, 100, (value) => value.length);
  counted.set("a", "1").set("b", "22").set("c", "333");
  assert.equal(counted.size, 2);
  assert.equal(counted.has("a"), false);
  assert.equal(counted.byteSize, 5);
  counted.set("b", "4");
  assert.equal(counted.byteSize, 4);
  counted.delete("b");
  assert.equal(counted.byteSize, 3);
  counted.clear();
  assert.equal(counted.size, 0);
  assert.equal(counted.byteSize, 0);

  const sized = new BoundedCache(10, 10, (value) => value.length);
  sized.set("a", "123456").set("b", "12345");
  assert.equal(sized.has("a"), false);
  assert.equal(sized.get("b"), "12345");
  sized.set("too-large", "12345678901");
  assert.equal(sized.has("too-large"), false);
  assert.equal(sized.get("b"), "12345");
});

test("shared limiter never exceeds four active tasks", async () => {
  const limiter = new ConcurrencyLimiter(4);
  let active = 0;
  let maximum = 0;
  const gates = Array.from({ length: 10 }, () => {
    let release;
    const promise = new Promise((resolve) => { release = resolve; });
    return { promise, release };
  });
  const tasks = gates.map((gate) => limiter.run(async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await gate.promise;
    active -= 1;
  }));
  await turn();
  assert.equal(limiter.active, 4);
  assert.equal(limiter.pending, 6);
  gates.slice(0, 4).forEach((gate) => gate.release());
  await turn();
  await turn();
  gates.slice(4).forEach((gate) => gate.release());
  await Promise.all(tasks);
  assert.equal(maximum, 4);
  assert.equal(limiter.active, 0);
  assert.equal(limiter.pending, 0);
});

test("queued work can be aborted without starting it", async () => {
  const limiter = new ConcurrencyLimiter(1);
  let release;
  const blocker = limiter.run(() => new Promise((resolve) => { release = resolve; }));
  const controller = new AbortController();
  let started = false;
  const queued = limiter.run(async () => { started = true; }, controller.signal);
  controller.abort();
  await assert.rejects(queued, (error) => error?.name === "AbortError");
  release();
  await blocker;
  await turn();
  assert.equal(started, false);
  assert.equal(limiter.active, 0);
});

test("poll backoff is jittered, exponential, and capped", () => {
  assert.equal(pollBackoff(1, 0.5), 15_000);
  assert.equal(pollBackoff(2, 0.5), 30_000);
  assert.equal(pollBackoff(1, 0), 12_000);
  assert.equal(pollBackoff(1, 1), 18_000);
  for (let failures = 1; failures < 100; failures += 1) {
    assert.ok(pollBackoff(failures, Math.random()) <= 300_000);
  }
});
