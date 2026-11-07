/** jCard (RFC 7095) lesen und schreiben. Eine Zeile ist [Name, Parameter, Typ, Wert]. */

export type JParams = Record<string, unknown>;
export type JRow = [string, JParams, string, unknown];
export type JCard = ["vcard", JRow[], unknown[]?];

export type CryptoPref = "Ask" | "Never" | "Always" | "IfPossible";

export interface JAddress {
  pobox: string;
  ext: string;
  street: string;
  locality: string;
  region: string;
  code: string;
  country: string;
}

export interface ContactCard {
  id: string;
  readOnly: boolean;
  prefix: string;
  given: string;
  middle: string;
  surname: string;
  suffix: string;
  nickname: string | null;
  note: string | null;
  birthday: string | null;
  org: string;
  department: string;
  title: string;
  emails: string[];
  phones: string[] | null;
  urls: string[] | null;
  addresses: JAddress[] | null;
  tags: string | null;
  sign: CryptoPref;
  encrypt: CryptoPref;
  /** Nur in der Oberfläche: an alle Adressen dieses Kontakts schreiben. */
  sendAll: boolean;
  source: JCard;
}

const PREFS = new Set<CryptoPref>(["Ask", "Never", "Always", "IfPossible"]);
const MANAGED = new Set(["n", "fn", "nickname", "note", "bday", "title", "org", "email", "tel", "url", "adr", "categories", "x-crypto"]);

function propName(row: unknown[]): string {
  const raw = String(row[0] || "").toLowerCase();
  const dot = raw.lastIndexOf(".");
  return dot >= 0 ? raw.slice(dot + 1) : raw;
}

function paramsOf(row: unknown[] | undefined): JParams {
  const value = row?.[1];
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as JParams) } : {};
}

function flat(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map((part) => (typeof part === "string" ? part : "")).filter(Boolean).join(" ");
  return "";
}

function parts(value: unknown, count: number): string[] {
  const list = Array.isArray(value) ? value : [];
  return Array.from({ length: count }, (_, index) => (typeof list[index] === "string" ? list[index] : ""));
}

function pref(value: unknown): CryptoPref {
  const text = String(value || "");
  return PREFS.has(text as CryptoPref) ? text as CryptoPref : "Ask";
}

export function asCard(card: unknown): JCard {
  if (Array.isArray(card) && String(card[0]).toLowerCase() === "vcard" && Array.isArray(card[1])) {
    const rows = (card[1] as unknown[]).filter(Array.isArray).map((row) => {
      const item = row as unknown[];
      return [String(item[0] || ""), paramsOf(item), String(item[2] || "text"), item[3]] as JRow;
    });
    const groups = Array.isArray(card[2]) ? [card[2] as unknown[]] : [];
    return groups.length ? ["vcard", rows, ...groups] as JCard : ["vcard", rows];
  }
  return ["vcard", [["version", {}, "text", "4.0"]]];
}

/** Ersetzt die erste Texteigenschaft oder hängt sie an. Reicht für „Zu Kontakten“. */
export function writeProp(card: unknown, name: string, value: string): JCard {
  const next = asCard(card);
  const rows = next[1];
  const index = rows.findIndex((row) => propName(row) === name.toLowerCase());
  const line: JRow = [name, {}, "text", value];
  if (index >= 0) rows[index] = line;
  else rows.push(line);
  return next;
}

function rowsNamed(card: JCard, name: string): JRow[] {
  return card[1].filter((row) => propName(row) === name);
}

function dateValue(value: unknown): string {
  const text = flat(value).trim();
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  return text;
}

export function blankCard(): ContactCard {
  return {
    id: "",
    readOnly: false,
    prefix: "", given: "", middle: "", surname: "", suffix: "",
    nickname: null, note: null, birthday: null,
    org: "", department: "", title: "",
    emails: [""], phones: null, urls: null, addresses: null, tags: null,
    sign: "Ask", encrypt: "Ask", sendAll: true,
    source: ["vcard", [["version", {}, "text", "4.0"]]]
  };
}

export function parseCard(raw: { id?: unknown; readOnly?: boolean; jCard?: unknown }): ContactCard {
  const source = asCard(raw.jCard);
  const name = parts(rowsNamed(source, "n")[0]?.[3], 5);
  const org = parts(rowsNamed(source, "org")[0]?.[3], 2);
  const crypto = paramsOf(rowsNamed(source, "x-crypto")[0]);
  const emails = rowsNamed(source, "email").map((row) => flat(row[3])).filter(Boolean);
  const phones = rowsNamed(source, "tel").map((row) => flat(row[3]));
  const urls = rowsNamed(source, "url").map((row) => flat(row[3]));
  const addresses = rowsNamed(source, "adr").map((row) => {
    const value = parts(row[3], 7);
    return { pobox: value[0], ext: value[1], street: value[2], locality: value[3], region: value[4], code: value[5], country: value[6] };
  });
  const tags = rowsNamed(source, "categories")[0];
  const tagText = Array.isArray(tags?.[3]) ? (tags[3] as unknown[]).map((part) => flat(part)).filter(Boolean).join(", ") : flat(tags?.[3]);
  const one = (field: string): string | null => {
    const row = rowsNamed(source, field)[0];
    return row ? flat(row[3]) : null;
  };
  return {
    id: raw.id == null ? "" : String(raw.id),
    readOnly: Boolean(raw.readOnly),
    surname: name[0], given: name[1], middle: name[2], prefix: name[3], suffix: name[4],
    nickname: one("nickname"),
    note: one("note"),
    birthday: rowsNamed(source, "bday")[0] ? dateValue(rowsNamed(source, "bday")[0][3]) : null,
    org: org[0],
    department: org[1],
    title: one("title") || "",
    emails: emails.length ? emails : [""],
    phones: phones.length ? phones : null,
    urls: urls.length ? urls : null,
    addresses: addresses.length ? addresses : null,
    tags: tags ? tagText : null,
    sign: pref(crypto.signpref),
    encrypt: pref(crypto.encryptpref),
    sendAll: true,
    source
  };
}

export function displayName(card: ContactCard): string {
  const name = [card.prefix, card.given, card.middle, card.surname, card.suffix].map((part) => part.trim()).filter(Boolean).join(" ");
  return name || card.emails.find((item) => item.trim()) || card.nickname || "";
}

function reuseText(existing: JRow[], name: string, values: string[], type = "text"): JRow[] {
  const pool = existing.filter((row) => propName(row) === name);
  const used = new Set<number>();
  return values.map((value) => value.trim()).filter(Boolean).map((value) => {
    const match = pool.findIndex((row, index) => !used.has(index) && flat(row[3]) === value);
    if (match >= 0) {
      used.add(match);
      return [name, paramsOf(pool[match]), String(pool[match][2] || type), value] as JRow;
    }
    return [name, {}, type, value] as JRow;
  });
}

function single(existing: JRow[], name: string, value: string, type = "text"): JRow | null {
  const text = value.trim();
  if (!text) return null;
  const prev = existing.find((row) => propName(row) === name);
  return [name, paramsOf(prev), String(prev?.[2] || type), text];
}

export function toJCard(card: ContactCard): JCard {
  const kept = card.source[1].filter((row) => !MANAGED.has(propName(row))).map((row) => [row[0], paramsOf(row), row[2], row[3]] as JRow);
  if (!kept.some((row) => propName(row) === "version")) kept.unshift(["version", {}, "text", "4.0"]);
  const name = [card.surname, card.given, card.middle, card.prefix, card.suffix];
  kept.push(["n", {}, "text", name]);
  const fn = displayName(card);
  if (fn) kept.push(["fn", {}, "text", fn]);
  const nickname = card.nickname == null ? null : single(card.source[1], "nickname", card.nickname);
  const note = card.note == null ? null : single(card.source[1], "note", card.note);
  const title = single(card.source[1], "title", card.title);
  const birthday = card.birthday == null ? null : single(card.source[1], "bday", card.birthday, "date");
  [nickname, note, title, birthday].forEach((row) => { if (row) kept.push(row); });
  if (card.org.trim() || card.department.trim()) {
    const prev = card.source[1].find((row) => propName(row) === "org");
    const value = card.department.trim() ? [card.org.trim(), card.department.trim()] : [card.org.trim()];
    kept.push(["org", paramsOf(prev), "text", value]);
  }
  reuseText(card.source[1], "email", card.emails).forEach((row) => kept.push(row));
  if (card.phones) reuseText(card.source[1], "tel", card.phones).forEach((row) => kept.push(row));
  if (card.urls) reuseText(card.source[1], "url", card.urls, "uri").forEach((row) => kept.push(row));
  (card.addresses || []).forEach((item, index) => {
    const filled = [item.pobox, item.ext, item.street, item.locality, item.region, item.code, item.country].some((part) => part.trim());
    if (!filled) return;
    const prev = rowsNamed(card.source, "adr")[index];
    kept.push(["adr", paramsOf(prev), String(prev?.[2] || "text"), [item.pobox, item.ext, item.street, item.locality, item.region, item.code, item.country]]);
  });
  if (card.tags != null && card.tags.trim()) {
    const prev = card.source[1].find((row) => propName(row) === "categories");
    kept.push(["categories", paramsOf(prev), "text", card.tags.trim()]);
  }
  const prevCrypto = card.source[1].find((row) => propName(row) === "x-crypto");
  const crypto = paramsOf(prevCrypto);
  crypto.allowed = crypto.allowed || "PGP/INLINE,PGP/MIME,S/MIME,S/MIMEOpaque";
  crypto.signpref = card.sign;
  crypto.encryptpref = card.encrypt;
  kept.push(["x-crypto", crypto, "x-crypto", ""]);
  return card.source[2] ? ["vcard", kept, card.source[2]] : ["vcard", kept];
}

export function formatAddress(name: string, email: string): string {
  const clean = name.replace(/"/g, "").trim();
  if (!clean || clean.toLowerCase() === email.toLowerCase()) return email;
  return /[",<>]/.test(clean) ? `"${clean}" <${email}>` : `${clean} <${email}>`;
}
