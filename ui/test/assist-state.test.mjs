import test from "node:test";
import assert from "node:assert/strict";
import { actionFacts, assistKey, AssistScopes, chatActionAt, draftModeFor, joinPlainDraft, ownNodeRange, splitPlainDraft } from "../src/assist-state.ts";

const action = (label) => ({ label, state: "", payload: { type: label } });

test("chat actions resolve inside the turn that rendered them", () => {
  const turns = [{ actions: [action("archive")] }, { actions: [] }, { actions: [action("delete")] }];
  assert.equal(chatActionAt(turns, 0, 0)?.label, "archive");
  assert.equal(chatActionAt(turns, 2, 0)?.label, "delete");
  assert.equal(chatActionAt(turns, 1, 0), null);
  assert.equal(chatActionAt(turns, Number(undefined), 0), null);
});

test("assist scopes go stale when the message changes", () => {
  const scopes = new AssistScopes();
  let key = "INBOX|1";
  const first = scopes.begin(() => key);
  const parallel = scopes.begin(() => key);
  assert.equal(first.signal, parallel.signal, "parallel requests share one controller");
  assert.equal(first.live(), true);
  key = "INBOX|2";
  assert.equal(first.live(), false, "a late result must not paint on another message");
  key = "INBOX|1";
  scopes.reset();
  assert.equal(first.signal.aborted, true);
  assert.equal(first.live(), false, "an aborted request stays stale");
  assert.equal(scopes.begin(() => key).signal.aborted, false);
});

test("action facts ignore the model's label", () => {
  assert.deepEqual(actionFacts({ type: "delete", uids: [1, 2, 3], folder: "INBOX", label: "Nur archivieren" }), { type: "delete", count: 3, folder: "INBOX", to: "", search: "" });
  assert.deepEqual(actionFacts({ type: "move", uids: [1], folder: "INBOX", to: "Archiv" }), { type: "move", count: 1, folder: "INBOX", to: "Archiv", search: "" });
  assert.equal(actionFacts({ type: "open", uid: 4, folder: "INBOX" }).count, 1);
  assert.equal(actionFacts({ type: "compose", to: "a@example.com" }).count, 0);
});

test("assist cache keys ignore selection order and separate folders", () => {
  assert.equal(assistKey("INBOX", [3, 1, 2]), assistKey("INBOX", [1, 2, 3]));
  assert.notEqual(assistKey("INBOX", [1]), assistKey("Archiv", [1]));
});

test("an empty key is never live", () => {
  assert.equal(new AssistScopes().begin(() => "").live(), false);
});

test("reply quote is kept and not sent as own text", () => {
  const body = "\n\nAm 09.11.2026, 10:00 schrieb Max:\n> Hallo\n> Welt";
  const parts = splitPlainDraft(body);
  assert.equal(parts.own, "");
  assert.equal(joinPlainDraft(parts, "Danke!"), "Danke!\n\nAm 09.11.2026, 10:00 schrieb Max:\n> Hallo\n> Welt");
});

test("trailing signature and own text are separated", () => {
  const parts = splitPlainDraft("Mein Text\nZeile 2\n\n-- \nMax Muster");
  assert.equal(parts.own, "Mein Text\nZeile 2");
  assert.equal(parts.tail, "-- \nMax Muster");
  assert.equal(joinPlainDraft(parts, "Neu"), "Neu\n\n-- \nMax Muster");
});

test("signature placed before the quote and a leading signature stay intact", () => {
  const trailing = splitPlainDraft("\n\nOn Mon, Max wrote:\n> Hi\n\n-- \nSig");
  assert.equal(trailing.own, "");
  assert.match(trailing.tail, /wrote:\n> Hi\n\n-- \nSig$/);
  const leading = splitPlainDraft("\n\n-- \nSig\n\nEigener Text\n\nAm 1.1.2026 schrieb A:\n> B");
  assert.equal(leading.own, "Eigener Text");
  assert.match(leading.head, /Sig$/);
  assert.match(leading.tail, /^Am 1\.1\.2026/);
});

test("forward header is preserved", () => {
  const parts = splitPlainDraft("Siehe unten\n\n-------- Weitergeleitete Nachricht --------\nVon: A");
  assert.equal(parts.own, "Siehe unten");
  assert.match(parts.tail, /^-{8} Weitergeleitete/);
});

test("text without quote is entirely own text", () => {
  assert.deepEqual(splitPlainDraft("Nur Text"), { head: "", own: "Nur Text", tail: "" });
  assert.equal(joinPlainDraft(splitPlainDraft(""), "Neu"), "Neu");
});

test("editor node range stops at quote and signature", () => {
  const node = (text, tag = "#text", signature = false) => ({ tag, signature, text });
  assert.deepEqual(ownNodeRange([node("Hallo"), node("", "BR"), node("Am 1.1.2026 schrieb A:"), node("", "BR"), node("B", "BLOCKQUOTE")]), { start: 0, end: 2 });
  assert.deepEqual(ownNodeRange([node("Hallo"), node("Sig", "DIV", true)]), { start: 0, end: 1 });
  assert.deepEqual(ownNodeRange([node("Sig", "DIV", true), node("Hallo"), node("Q", "BLOCKQUOTE")]), { start: 1, end: 2 });
  assert.deepEqual(ownNodeRange([node("", "BR"), node("Q", "BLOCKQUOTE")]), { start: 0, end: 1 });
});

test("assistant mode follows the composer that was opened", () => {
  assert.equal(draftModeFor({ mode: "reply" }), "reply");
  assert.equal(draftModeFor({ mode: "new" }), "new");
  assert.equal(draftModeFor({ mode: "forward" }), "new");
  assert.equal(draftModeFor({ mode: "draft", draftInfo: ["reply-all", 1, "INBOX"] }), "reply");
  assert.equal(draftModeFor({ mode: "draft", draftInfo: ["forward", 1, "INBOX"] }), "new");
  assert.equal(draftModeFor({}), "new");
});
