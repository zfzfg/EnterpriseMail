export interface ApiFailure {
  code: number;
  message: string;
  detail: string;
}

export class ApiError extends Error {
  code: number;
  detail: string;

  constructor(code: number, message: string, detail = "") {
    super(message);
    this.code = code;
    this.detail = detail;
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

function root(): string {
  return location.pathname.replace(/\/+$/, "") + "/";
}

export function explain(error: unknown): string {
  if (!(error instanceof ApiError)) return "Die Anfrage ist fehlgeschlagen.";
  const known: Record<number, string> = {
    101: "Die Sitzung ist abgelaufen. Seite neu laden.",
    102: "Anmeldung fehlgeschlagen. Adresse oder Passwort prüfen.",
    104: "Der Mailserver ist nicht erreichbar.",
    109: "Diese Domain ist nicht erlaubt.",
    110: "Dieses Konto ist nicht erlaubt.",
    201: "Die Liste konnte nicht geladen werden.",
    202: "Der Brief konnte nicht geladen werden.",
    203: "Löschen ist fehlgeschlagen.",
    204: "Verschieben ist fehlgeschlagen.",
    302: "Senden ist fehlgeschlagen.",
    303: "Empfänger prüfen.",
    901: "Der Mailserver hat die Anfrage abgelehnt."
  };
  const text = known[error.code] || error.message || "Die Anfrage ist fehlgeschlagen.";
  return error.detail ? `${text} ${error.detail}` : text;
}

async function readApp(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) throw new ApiError(1, "Die Anwendung konnte nicht geladen werden.");
  const data = await response.json() as Record<string, unknown>;
  const system = data.System as { token?: string } | undefined;
  if (system?.token) token = system.token;
  return data;
}

export function loadApp(): Promise<Record<string, unknown>> {
  return readApp(`${root()}?/AppData/0/${Math.random().toString().slice(2)}/`);
}

export function loadAdminApp(): Promise<Record<string, unknown>> {
  return readApp(`${root()}?/AdminAppData/0/${Math.random().toString().slice(2)}/`);
}

async function postJson<T>(url: string, action: string, params: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-SM-Token": token
    },
    body: JSON.stringify({ Action: action, ...params })
  });
  if (!response.ok) throw new ApiError(1, "Die Anfrage ist fehlgeschlagen.");
  const data = await response.json() as Envelope;
  if (data.System?.token) token = data.System.token;
  const result = data.Result as { System?: { token?: string } } | null;
  if (result && typeof result === "object" && result.System?.token) token = result.System.token;
  if (data.Result === false || data.Result == null) {
    throw new ApiError(data.code || 999, data.message || "", data.messageAdditional || "");
  }
  return data.Result as T;
}

export function call<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  return postJson<T>(`${root()}?/Json/&q[]=/0/`, action, params);
}

export function adminCall<T>(adminKey: string, action: string, params: Record<string, unknown> = {}): Promise<T> {
  const key = /^[a-z0-9._-]+$/i.test(adminKey) && !adminKey.includes("..") ? adminKey : "admin";
  return postJson<T>(`${root()}?/${key}/Json/&q[]=/0/`, action, params);
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

export async function plugin<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  const result = await call<T & { error?: string; status?: number }>("Plugin" + action, params);
  if (result && typeof result === "object" && "error" in result && result.error) {
    throw new ApiError(Number(result.status) || 999, String(result.error));
  }
  return result;
}

export async function streamEvents(
  path: string,
  params: Record<string, unknown>,
  onEvent: (event: string, data: Record<string, unknown>) => void,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetch(`${root()}?/${path}/`, {
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
  let buffer = "";
  for (;;) {
    const chunk = await reader.read();
    buffer += chunk.value ? decoder.decode(chunk.value, { stream: !chunk.done }) : "";
    const blocks = buffer.split(/\n\n/);
    buffer = blocks.pop() || "";
    for (const block of blocks) {
      let event = "message";
      const data: string[] = [];
      block.split(/\n/).forEach((line) => {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trim());
      });
      if (data.length) onEvent(event, JSON.parse(data.join("\n")) as Record<string, unknown>);
    }
    if (chunk.done) break;
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

/** Lädt eine Adresse dieser Seite und gibt sie als data:-URL zurück (für den sandboxed Brief). */
export async function fetchDataUrl(url: string, limit = 8 * 1024 * 1024): Promise<string> {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) throw new ApiError(1, "Datei nicht erreichbar.");
  const blob = await response.blob();
  if (blob.size > limit) throw new ApiError(1, "Datei zu groß.");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new ApiError(1, "Datei nicht lesbar."));
    reader.readAsDataURL(blob);
  });
}

export async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) throw new ApiError(1, "Datei nicht erreichbar.");
  return response.text();
}

export function appRoot(): string {
  return root();
}
