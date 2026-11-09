/** DOM-free rules for the AI assistant, kept separate so they can be unit tested. */

export interface ChatAction {
  label: string;
  state: string;
  payload: Record<string, unknown>;
}

export interface ChatActionTurn {
  actions: ChatAction[];
}

/** Resolves an action inside the turn that rendered its button, never the newest turn. */
export function chatActionAt<T extends ChatActionTurn>(turns: T[], turn: number, index: number): ChatAction | null {
  if (!Number.isInteger(turn) || !Number.isInteger(index)) return null;
  return turns[turn]?.actions[index] ?? null;
}

export interface ActionFacts {
  type: string;
  count: number;
  folder: string;
  to: string;
  search: string;
}

/** What an action will really do, taken from validated fields instead of the model's own label. */
export function actionFacts(payload: Record<string, unknown>): ActionFacts {
  return {
    type: String(payload.type || ""),
    count: Array.isArray(payload.uids) ? payload.uids.length : payload.uid ? 1 : 0,
    folder: String(payload.folder || ""),
    to: String(payload.to || ""),
    search: String(payload.search || "")
  };
}

/** Session cache key for an assistant result about these mails. */
export function assistKey(folder: string, uids: number[]): string {
  return `${folder}\n${[...uids].sort((a, b) => a - b).join(",")}`;
}

export interface AssistScope {
  signal: AbortSignal;
  live(): boolean;
}

/**
 * Ties provider requests to the message they were started for. Parallel requests
 * for one message share a controller; reset() cancels them when the message changes.
 */
export class AssistScopes {
  private controller: AbortController | null = null;

  begin(currentKey: () => string): AssistScope {
    const controller = this.controller || new AbortController();
    this.controller = controller;
    const key = currentKey();
    return {
      signal: controller.signal,
      live: () => !controller.signal.aborted && key !== "" && currentKey() === key
    };
  }

  reset(): void {
    this.controller?.abort();
    this.controller = null;
  }
}

export interface DraftParts {
  head: string;
  own: string;
  tail: string;
}

const QUOTE_INTRO = /^(Am|On)\s.{4,160}(schrieb|wrote)\s*.{0,100}:\s*$/iu;
const SEPARATOR_LINE = /^-{4,}\s*\S.*-{4,}\s*$/u;

function startsPreserved(line: string): boolean {
  const trimmed = line.trim();
  return line === "-- " || line === "--" || trimmed.startsWith(">") || QUOTE_INTRO.test(trimmed) || SEPARATOR_LINE.test(trimmed);
}

/** Splits composer text into a leading signature, the user's own text, and the kept quote/signature. */
export function splitPlainDraft(text: string): DraftParts {
  const lines = text.replace(/\r/g, "").split("\n");
  let start = 0;
  const first = lines.findIndex((line) => line.trim() !== "");
  if (first >= 0 && (lines[first] === "-- " || lines[first] === "--")) {
    const blank = lines.findIndex((line, index) => index > first && line.trim() === "");
    start = blank < 0 ? lines.length : blank;
  }
  let end = lines.findIndex((line, index) => index >= start && startsPreserved(line));
  if (end < 0) end = lines.length;
  return {
    head: lines.slice(0, start).join("\n"),
    own: lines.slice(start, end).join("\n").trim(),
    tail: lines.slice(end).join("\n")
  };
}

export function joinPlainDraft(parts: DraftParts, own: string): string {
  return [parts.head, own, parts.tail].filter((part) => part !== "").join("\n\n");
}

export interface DraftNode {
  tag: string;
  signature: boolean;
  text: string;
}

/** The same split for top-level editor nodes; returns the half-open range of own content. */
export function ownNodeRange(nodes: DraftNode[]): { start: number; end: number } {
  const first = nodes.findIndex((node) => node.tag === "BLOCKQUOTE" || node.signature || node.text.trim() !== "");
  const start = first >= 0 && nodes[first].signature ? first + 1 : 0;
  let end = nodes.findIndex((node, index) => {
    if (index < start) return false;
    return node.tag === "BLOCKQUOTE" || node.signature || startsPreserved(node.text.split("\n")[0] ?? "");
  });
  if (end < 0) end = nodes.length;
  return { start, end };
}

/** Which assistant mode fits a composer that was just opened. */
export function draftModeFor(seed: { mode?: string; draftInfo?: [string, number, string] }): "new" | "reply" {
  if (seed.mode === "reply") return "reply";
  return seed.mode === "draft" && /^reply/i.test(seed.draftInfo?.[0] || "") ? "reply" : "new";
}
