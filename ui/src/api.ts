import { t } from "./i18n";
import { ConcurrencyLimiter, EventStreamParser } from "./runtime";

export interface ApiFailure {
  code: number;
  message: string;
  detail: string;
}

export class ApiError extends Error {
  code: number;
  detail: string;
  /** Machine-readable cause from the AI plugin, e.g. consent_required. */
  reason: string;

  constructor(code: number, message: string, detail = "", reason = "") {
    super(message);
    this.code = code;
    this.detail = detail;
    this.reason = reason;
  }
}

interface Envelope {
  Result?: unknown;
  code?: number;
  message?: string;
  messageAdditional?: string;
  System?: { token?: string };
}

let token = "";
let rustStreamRoute = "";
let onExpired: (() => void) | null = null;

/** Sitzung abgelaufen (Fehler 101): einmal melden, der Aufrufer zeigt den Anmelde-Dialog. */
export function watchSession(handler: () => void): void {
  onExpired = handler;
}

export async function loadLanguage(code: string): Promise<void> {
  const response = await fetch(`${root()}?/Lang/App/${encodeURIComponent(code)}/`, { credentials: "same-origin" });
  if (!response.ok) throw new ApiError(1, t("LOGIN.ERROR_LANG_LOAD", "Die Sprache konnte nicht geladen werden."));
  const script = await response.text();
  new Function(script)();
}

function root(): string {
  return location.pathname.replace(/\/+$/, "") + "/";
}

export function explain(error: unknown): string {
  if (!(error instanceof ApiError)) return t("NOTIFICATIONS.UnknownError", "Die Anfrage ist fehlgeschlagen.");
  const known: Record<number, [string, string]> = {
    101: ["NOTIFICATIONS.InvalidToken", "Die Sitzung ist abgelaufen. Seite neu laden."],
    102: ["NOTIFICATIONS.AuthError", "Anmeldung fehlgeschlagen. Adresse oder Passwort prüfen."],
    104: ["NOTIFICATIONS.ConnectionError", "Der Mailserver ist nicht erreichbar."],
    109: ["NOTIFICATIONS.DomainNotAllowed", "Diese Domain ist nicht erlaubt."],
    110: ["NOTIFICATIONS.AccountNotAllowed", "Dieses Konto ist nicht erlaubt."],
    140: ["NOTIFICATIONS.ContactsSyncError", "Die Kontakte konnten nicht synchronisiert werden."],
    201: ["NOTIFICATIONS.CantGetMessageList", "Die Liste konnte nicht geladen werden."],
    202: ["NOTIFICATIONS.CantGetMessage", "Der Brief konnte nicht geladen werden."],
    203: ["NOTIFICATIONS.CantDeleteMessage", "Löschen ist fehlgeschlagen."],
    204: ["NOTIFICATIONS.CantMoveMessage", "Verschieben ist fehlgeschlagen."],
    302: ["NOTIFICATIONS.CantSendMessage", "Senden ist fehlgeschlagen."],
    303: ["NOTIFICATIONS.InvalidRecipients", "Empfänger prüfen."],
    901: ["NOTIFICATIONS.MailServerError", "Der Mailserver hat die Anfrage abgelehnt."]
  };
  const item = known[error.code];
  const text = item ? t(item[0], item[1]) : (error.message || t("NOTIFICATIONS.UnknownError", "Die Anfrage ist fehlgeschlagen."));
  return error.detail ? `${text} ${error.detail}` : text;
}

async function readApp(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) throw new ApiError(1, t("LOGIN.ERROR_APP_LOAD", "Die Anwendung konnte nicht geladen werden."));
  const data = await response.json() as Record<string, unknown>;
  const system = data.System as { token?: string } | undefined;
  if (system?.token) token = system.token;
  const plugins = data.Plugins as Record<string, unknown> | undefined;
  const copilot = plugins?.["ai-copilot"] as Record<string, unknown> | undefined;
  const rust = copilot?.rustStream as Record<string, unknown> | undefined;
  const route = typeof rust?.route === "string" ? rust.route : "";
  // Authenticated AppData is the deployment gate. Only a safe relative path
  // is accepted; absence or withdrawal restores the legacy PHP endpoint.
  rustStreamRoute = /^[a-z0-9][a-z0-9/_-]*$/i.test(route) && !route.includes("..") ? route : "";
  return data;
}

export function loadApp(): Promise<Record<string, unknown>> {
  return readApp(`${root()}?/AppData/0/${Math.random().toString().slice(2)}/`);
}

export function loadAdminApp(): Promise<Record<string, unknown>> {
  return readApp(`${root()}?/AdminAppData/0/${Math.random().toString().slice(2)}/`);
}

async function postJson<T>(url: string, action: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-SM-Token": token
    },
    body: JSON.stringify({ Action: action, ...params }),
    signal
  });
  if (!response.ok) throw new ApiError(1, "Die Anfrage ist fehlgeschlagen.");
  const data = await response.json() as Envelope;
  if (data.System?.token) token = data.System.token;
  const result = data.Result as { System?: { token?: string } } | null;
  if (result && typeof result === "object" && result.System?.token) token = result.System.token;
  if (data.Result === false || data.Result == null) {
    const code = data.code || 999;
    if (code === 101) onExpired?.();
    throw new ApiError(code, data.message || "", data.messageAdditional || "");
  }
  return data.Result as T;
}

export function call<T>(action: string, params: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
  return postJson<T>(`${root()}?/Json/&q[]=/0/`, action, params, signal);
}

export function adminCall<T>(adminKey: string, action: string, params: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
  const key = /^[a-z0-9._-]+$/i.test(adminKey) && !adminKey.includes("..") ? adminKey : "admin";
  return postJson<T>(`${root()}?/${key}/Json/&q[]=/0/`, action, params, signal);
}

export interface UploadedFile {
  name: string;
  size: number;
  tempName: string;
  mimeType: string;
}

export interface UploadTask {
  promise: Promise<UploadedFile>;
  abort(): void;
}

/** Einziger Upload-Weg: ServiceUpload mit Fortschritt und Abbruch. */
export function upload(file: File, onProgress: (percent: number) => void): UploadTask {
  const request = new XMLHttpRequest();
  const promise = new Promise<UploadedFile>((resolve, reject) => {
    request.open("POST", `${root()}?/Upload/&q[]=/0/`);
    request.setRequestHeader("Accept", "application/json");
    request.setRequestHeader("X-SM-Token", token);
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(Math.min(100, Math.round(event.loaded / event.total * 100)));
    });
    request.addEventListener("error", () => reject(new ApiError(1, "Der Upload ist fehlgeschlagen.")));
    request.addEventListener("abort", () => reject(new ApiError(0, "Der Upload wurde abgebrochen.")));
    request.addEventListener("load", () => {
      try {
        const data = JSON.parse(request.responseText) as Envelope & { Result?: { Attachment?: UploadedFile; code?: number; message?: string } };
        const attachment = data.Result?.Attachment;
        if (request.status < 200 || request.status >= 300 || !attachment?.tempName) {
          reject(new ApiError(Number(data.Result?.code || data.code || 999), String(data.Result?.message || data.message || "Der Upload ist fehlgeschlagen.")));
          return;
        }
        resolve(attachment);
      } catch {
        reject(new ApiError(1, "Der Server hat den Upload nicht bestätigt."));
      }
    });
    const body = new FormData();
    body.append("uploader", file, file.name);
    request.send(body);
  });
  return { promise, abort: () => request.abort() };
}

function readEnvelope(text: string): Envelope {
  const lines = text.split(/\n/).map((line) => line.trim()).filter(Boolean);
  const last = lines[lines.length - 1] || "";
  try {
    return JSON.parse(last) as Envelope;
  } catch {
    throw new ApiError(1, t("NOTIFICATIONS.RequestError", "Der Server hat keine lesbare Antwort geschickt."));
  }
}

function takeToken(data: Envelope): void {
  if (data.System?.token) token = data.System.token;
  const result = data.Result as { System?: { token?: string } } | null;
  if (result && typeof result === "object" && result.System?.token) token = result.System.token;
}

/** Import von vCard oder CSV über ServiceUploadContacts. Liefert die Zahl neuer Kontakte. */
export async function uploadContacts(file: File): Promise<number> {
  const body = new FormData();
  body.append("uploader", file, file.name);
  const response = await fetch(`${root()}?/UploadContacts/&q[]=/0/`, {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json", "X-SM-Token": token },
    body
  });
  const data = readEnvelope(await response.text());
  takeToken(data);
  if (!response.ok || data.Result === false || data.Result == null) {
    throw new ApiError(data.code || 999, data.message || "Der Import ist fehlgeschlagen.", data.messageAdditional || "");
  }
  return Number(data.Result) || 0;
}

/** CardDAV-Abgleich. Der Server schreibt zuerst eine Zeile, dann die JSON-Antwort. */
export async function syncContacts(): Promise<void> {
  const response = await fetch(`${root()}?/Json/&q[]=/0/`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-SM-Token": token
    },
    body: JSON.stringify({ Action: "ContactsSync" })
  });
  const data = readEnvelope(await response.text());
  takeToken(data);
  if (!response.ok || data.Result === false || data.Result == null) {
    throw new ApiError(data.code || 140, data.message || "", data.messageAdditional || "");
  }
}

/** Raw-Pfad ohne Schlüssel, zum Beispiel ContactsVcf und ContactsCsv. */
export function rawPath(action: string): string {
  return `${root()}?/Raw/&q[]=/0/${encodeURIComponent(action)}/`;
}

export async function plugin<T>(action: string, params: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
  const result = await call<T & { error?: string; status?: number; code?: string }>("Plugin" + action, params, signal);
  if (result && typeof result === "object" && "error" in result && result.error) {
    throw new ApiError(Number(result.status) || 999, String(result.error), "", String(result.code || ""));
  }
  return result;
}

export async function streamEvents(
  path: string,
  params: Record<string, unknown>,
  onEvent: (event: string, data: Record<string, unknown>) => void,
  signal?: AbortSignal
): Promise<void> {
  const url = path === "AiStream" && rustStreamRoute
    ? `${root()}${rustStreamRoute}`
    : `${root()}?/${path}/`;
  // Never replay a failed Rust request through PHP: dispatch may already have
  // reached the provider, so an automatic fallback could duplicate generation.
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "text/event-stream",
      "Content-Type": "application/json",
      "X-SM-Token": token
    },
    body: JSON.stringify(params),
    signal
  });
  if (!response.ok || !response.body) throw new ApiError(1, "Verbindung unterbrochen.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = new EventStreamParser();
  let finished = false;
  const emit = (events: { event: string; data: string }[]): void => {
    events.forEach(({ event, data }) => {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(data) as Record<string, unknown>;
      } catch {
        throw new ApiError(1, t("NOTIFICATIONS.RequestError", "Der Server hat keine lesbare Antwort geschickt."));
      }
      if (event === "done") finished = true;
      onEvent(event, payload);
    });
  };
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      emit(parser.feed(decoder.decode(chunk.value, { stream: true })));
    }
    // Flush a split UTF-8 sequence and accept one final, unterminated SSE block.
    emit(parser.feed(decoder.decode()));
    emit(parser.finish());
    if (!finished) throw new ApiError(1, "Verbindung unterbrochen.");
  } finally {
    try { await reader.cancel(); } catch { /* Stream kann bereits geschlossen oder fehlerhaft sein. */ }
    reader.releaseLock();
  }
}

/** Base64url eines JSON-Objekts, wie SnappyMail es für Raw-Schlüssel erwartet. */
export function b64Json(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type RawType = "Download" | "View" | "ViewAsPlain" | "ViewThumbnail";

export function rawUrl(type: RawType, hash: string): string {
  return `${root()}?/Raw/&q[]=/0/${type}/&q[]=/${hash}`;
}

export interface FileKey {
  folder: string;
  uid: number;
  mimeIndex: string;
  mimeType: string;
  fileName: string;
  accountHash: string;
}

export function fileHash(file: FileKey): string {
  return b64Json(file);
}

export function downloadUrl(file: FileKey): string {
  return rawUrl("Download", fileHash(file));
}

/** Schlüssel der ganzen Mail (für Quelltext, .eml, Weiterleiten als Anhang). */
export function messageHash(folder: string, uid: number, subject: string, hash: string, accountHash: string): string {
  return b64Json({
    folder,
    uid,
    mimeType: "message/rfc822",
    fileName: `${(subject || "message").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80)}-${hash}.eml`,
    accountHash
  });
}

/** Externe Adresse über den Bild-Proxy des Servers. */
export function proxyUrl(url: string): string {
  const encoded = btoa(url.replace(/ /g, "%20")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${root()}?/ProxyExternal/${encoded}`;
}

async function boundedBlob(response: Response, limit: number): Promise<Blob> {
  const max = Math.max(0, limit);
  const declared = Number(response.headers.get("Content-Length") || 0);
  if (declared > max) {
    try { await response.body?.cancel(); } catch { /* Der Stream kann bereits fehlerhaft sein. */ }
    throw new ApiError(1, "Datei zu groß.");
  }
  if (!response.body) {
    const blob = await response.blob();
    if (blob.size > max) throw new ApiError(1, "Datei zu groß.");
    return blob;
  }
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  let ended = false;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        ended = true;
        break;
      }
      size += chunk.value.byteLength;
      if (size > max) throw new ApiError(1, "Datei zu groß.");
      parts.push(chunk.value);
    }
    return new Blob(parts.map((part) => part as Uint8Array<ArrayBuffer>), { type: response.headers.get("Content-Type") || "" });
  } finally {
    if (!ended) {
      try { await reader.cancel(); } catch { /* Der Stream kann bereits fehlerhaft sein. */ }
    }
    reader.releaseLock();
  }
}

const imageSlots = new ConcurrencyLimiter(4);

/** Lädt eine Adresse dieser Seite und gibt sie als data:-URL zurück (für den sandboxed Brief). */
export function fetchDataUrl(url: string, limit = 8 * 1024 * 1024, signal?: AbortSignal): Promise<string> {
  return imageSlots.run(async () => {
    const response = await fetch(url, { credentials: "same-origin", signal });
    if (!response.ok) throw new ApiError(1, "Datei nicht erreichbar.");
    const blob = await boundedBlob(response, limit);
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      const cleanup = () => signal?.removeEventListener("abort", abort);
      const abort = () => reader.abort();
      reader.onload = () => { cleanup(); resolve(String(reader.result || "")); };
      reader.onerror = () => { cleanup(); reject(new ApiError(1, "Datei nicht lesbar.")); };
      reader.onabort = () => { cleanup(); reject(signal?.reason || new ApiError(0, "Der Vorgang wurde abgebrochen.")); };
      if (signal?.aborted) {
        reject(signal.reason || new ApiError(0, "Der Vorgang wurde abgebrochen."));
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });
      try { reader.readAsDataURL(blob); } catch (error) { cleanup(); reject(error); }
    });
  }, signal);
}

export async function fetchText(url: string, limit = 2 * 1024 * 1024, signal?: AbortSignal): Promise<string> {
  const response = await fetch(url, { credentials: "same-origin", signal });
  if (!response.ok) throw new ApiError(1, "Datei nicht erreichbar.");
  return (await boundedBlob(response, limit)).text();
}

export function appRoot(): string {
  return root();
}
