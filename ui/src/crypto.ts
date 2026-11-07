// GnuPG und S/MIME über die vorhandenen JSON-Aktionen. Kein OpenPGP.js, kein Mailvelope.
import { call } from "./api";
import { t } from "./i18n";

export interface CryptoPart {
  partId: string;
  sigPartId: string;
  detached: boolean;
  keyIds: string[];
}

export interface CryptoParts {
  pgpEncrypted: CryptoPart | null;
  pgpSigned: CryptoPart | null;
  smimeEncrypted: CryptoPart | null;
  smimeSigned: CryptoPart | null;
}

export interface GnuKey {
  id: string;
  email: string;
  name: string;
  secret: boolean;
  canEncrypt: boolean;
  canSign: boolean;
}

const sessionPass = new Map<string, string>();

export function rememberedPass(id: string): string {
  return sessionPass.get(id) || "";
}

export function rememberPass(id: string, value: string, keep: boolean): void {
  if (keep && value) sessionPass.set(id, value);
}

export function emptyParts(): CryptoParts {
  return { pgpEncrypted: null, pgpSigned: null, smimeEncrypted: null, smimeSigned: null };
}

function part(value: unknown): CryptoPart | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const partId = String(row.partId || "");
  if (!partId) return null;
  const keyIds = Array.isArray(row.keyIds) ? row.keyIds.map((item) => String(item)).filter(Boolean) : [];
  return { partId, sigPartId: String(row.sigPartId || ""), detached: Boolean(row.detached), keyIds };
}

export function readParts(item: Record<string, unknown>): CryptoParts {
  return {
    pgpEncrypted: part(item.pgpEncrypted),
    pgpSigned: part(item.pgpSigned),
    smimeEncrypted: part(item.smimeEncrypted),
    smimeSigned: part(item.smimeSigned)
  };
}

export function autocryptHeader(headers: Record<string, string>): string {
  return headers.autocrypt || "";
}

/** Autocrypt: `addr=…; keydata=…` (Base64 des Schlüssels). */
export function autocryptKey(header: string): { email: string; key: string } | null {
  const email = /addr=([^;]+)/i.exec(header)?.[1]?.trim() || "";
  const data = /keydata=([A-Za-z0-9+/=\s]+)/i.exec(header)?.[1]?.replace(/\s+/g, "") || "";
  if (!data) return null;
  let key = "";
  try { key = atob(data); } catch { return null; }
  if (!key.includes("BEGIN PGP")) key = `-----BEGIN PGP PUBLIC KEY BLOCK-----\n\n${key}\n-----END PGP PUBLIC KEY BLOCK-----`;
  return { email, key };
}

export function bodyFromDecrypt(raw: string): { html: string; plain: string } {
  const text = raw.replace(/\r\n/g, "\n");
  const html = text.match(/<html[\s\S]*<\/html>/i)?.[0]
    || (/<(p|div|br|table)\b/i.test(text) ? text : "");
  if (html) return { html, plain: "" };
  const chunks = text.split(/\n\n/);
  const looksLikeHeader = chunks.length > 1 && /^[\w-]+:\s/m.test(chunks[0] || "");
  return { html: "", plain: looksLikeHeader ? chunks.slice(1).join("\n\n") : text };
}

function rows(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((item) => item && typeof item === "object") as Record<string, unknown>[];
  if (value && typeof value === "object") return Object.values(value as object).filter((item) => item && typeof item === "object") as Record<string, unknown>[];
  return [];
}

function keyOf(row: Record<string, unknown>, secret: boolean): GnuKey | null {
  const subs = rows(row.subkeys);
  const id = String(subs[0]?.fingerprint || subs[0]?.keyid || row.fingerprint || "");
  if (!id) return null;
  const uids = rows(row.uids);
  const email = String(uids[0]?.email || "");
  const name = String(uids[0]?.name || uids[0]?.uid || email || id.slice(-16));
  return {
    id,
    email,
    name,
    secret,
    canEncrypt: Boolean(row.can_encrypt ?? row.can_decrypt ?? true),
    canSign: Boolean(row.can_sign ?? row.can_verify ?? secret)
  };
}

export async function loadGnuKeys(): Promise<GnuKey[]> {
  const bag = await call<{ public?: unknown; private?: unknown }>("GnupgGetKeys");
  const pub = rows(bag?.public).map((row) => keyOf(row, false)).filter((row): row is GnuKey => Boolean(row));
  const sec = rows(bag?.private).map((row) => keyOf(row, true)).filter((row): row is GnuKey => Boolean(row));
  return [...sec, ...pub];
}

export function emailOf(value: string): string {
  const hit = /<([^>]+)>/.exec(value);
  return (hit?.[1] || value).trim().toLowerCase();
}

export async function keysFor(address: string, known: GnuKey[]): Promise<GnuKey[]> {
  const email = emailOf(address);
  const local = known.filter((key) => key.email.toLowerCase() === email && !key.secret && key.canEncrypt);
  if (local.length || !email) return local;
  const found = await call<string | false>("PgpSearchKey", { query: email });
  if (typeof found === "string" && found.includes("BEGIN PGP")) {
    await call("PgpImportKey", { key: found, keyId: "", email, backup: 0, gnuPG: 1 });
    const again = await loadGnuKeys();
    known.splice(0, known.length, ...again);
    return again.filter((key) => key.email.toLowerCase() === email && !key.secret && key.canEncrypt);
  }
  return [];
}

export async function gnupgDecrypt(folder: string, uid: number, partId: string, keyId: string, passphrase: string): Promise<string> {
  const result = await call<{ data?: string } | string>("GnupgDecrypt", { folder, uid, partId, keyId, passphrase, data: "" });
  if (typeof result === "string") return result;
  return String(result?.data || "");
}

export async function smimeDecrypt(folder: string, uid: number, partId: string, certificate: string, privateKey: string, passphrase: string): Promise<string> {
  const result = await call<{ data?: string }>("SMimeDecryptMessage", { folder, uid, partId, certificate, privateKey, passphrase });
  return String(result?.data || "");
}

export interface VerifyResult {
  ok: boolean;
  text: string;
}

export async function pgpVerify(folder: string, uid: number, part: CryptoPart): Promise<VerifyResult> {
  const result = await call<Record<string, unknown> | false>("PgpVerifyMessage", {
    folder, uid, partId: part.partId, sigPartId: part.sigPartId, tryGnuPG: 1
  });
  if (!result || typeof result !== "object") {
    return { ok: false, text: t("CRYPTO.VERIFY_FAIL", "Die Signatur ließ sich nicht prüfen.") };
  }
  const status = Number(result.status ?? 0);
  const fingerprint = String(result.fingerprint || "");
  const message = String(result.message || "");
  const ok = status === 0;
  const who = fingerprint ? fingerprint.slice(-16) : "";
  const line = ok
    ? t("CRYPTO.VERIFY_OK", "Signatur gültig.") + (who ? ` ${who}` : "")
    : message || t("CRYPTO.VERIFY_BAD", "Die Signatur ist ungültig.");
  return { ok, text: line };
}

export async function smimeVerify(folder: string, uid: number, part: CryptoPart): Promise<VerifyResult> {
  const result = await call<{ success?: boolean } | false>("SMimeVerifyMessage", {
    folder, uid, partId: part.partId, sigPartId: part.sigPartId, detached: part.detached ? 1 : 0
  });
  const ok = Boolean(result && typeof result === "object" && result.success);
  return {
    ok,
    text: ok
      ? t("CRYPTO.SMIME_OK", "S/MIME-Signatur gültig.")
      : t("CRYPTO.SMIME_BAD", "Die S/MIME-Signatur ist ungültig oder der Aussteller fehlt.")
  };
}

export function downloadText(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
