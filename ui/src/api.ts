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

export async function loadApp(): Promise<Record<string, unknown>> {
  const response = await fetch(`${root()}?/AppData/0/${Math.random().toString().slice(2)}/`, {
    credentials: "same-origin",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) throw new ApiError(1, "Die Anwendung konnte nicht geladen werden.");
  const data = await response.json() as Record<string, unknown>;
  const system = data.System as { token?: string } | undefined;
  if (system?.token) token = system.token;
  return data;
}

export async function call<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(`${root()}?/Json/&q[]=/0/`, {
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

export function downloadUrl(file: {
  folder: string;
  uid: number;
  mimeIndex: string;
  mimeType: string;
  fileName: string;
  accountHash: string;
}): string {
  const json = JSON.stringify(file);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  const hash = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${root()}?/Raw/&q[]=/0/Download/&q[]=/${hash}`;
}
