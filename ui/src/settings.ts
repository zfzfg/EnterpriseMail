import { ApiError, call, explain } from "./api";
import { icon, type IconName } from "./icons";
import { t } from "./i18n";
import { readAppearance, type Appearance } from "./theme";

export interface Caps {
  accounts: boolean;
  identities: boolean;
  contacts: boolean;
  sieve: boolean;
  openpgp: boolean;
  gnupg: boolean;
}

export interface AccountRow {
  email: string;
  name: string;
  current: boolean;
  main: boolean;
}

export interface IdentityRow {
  id: string;
  label: string;
  email: string;
  name: string;
  replyTo: string;
  bcc: string;
  signature: string;
  signatureInsertBefore: boolean;
  sentFolder: string;
  pgpEncrypt: boolean;
  pgpSign: boolean;
  smimeKey: string;
  smimeCertificate: string;
  smimeCertificateChain: string;
}

export interface ContactRow {
  id: string;
  name: string;
  email: string;
  readOnly: boolean;
  jCard: unknown;
}

export interface ScriptRow {
  name: string;
  active: boolean;
  body: string;
}

export interface KeyRow {
  kind: string;
  preview: string;
}

export interface CertRow {
  id: string;
  name: string;
  email: string;
  until: string;
}

export interface SettingsSnapshot {
  caps: Caps;
  mainEmail: string;
  currentEmail: string;
  accounts: AccountRow[];
  identities: IdentityRow[];
  contacts: ContactRow[] | null;
  contactCount: number;
  contactSearch: string;
  scripts: ScriptRow[] | null;
  keys: KeyRow[];
  certs: CertRow[];
  notes: { accounts: string; contacts: string; filters: string; keys: string; certs: string };
}

export interface DeskEdit {
  kind: string;
  id: string;
  fresh: boolean;
}

export function readCaps(data: Record<string, unknown>): Caps {
  const capa = data.Capa && typeof data.Capa === "object" ? data.Capa as Record<string, unknown> : {};
  return {
    accounts: Boolean(capa.AdditionalAccounts),
    identities: Boolean(capa.Identities),
    contacts: Boolean(capa.Contacts),
    sieve: Boolean(capa.Sieve),
    openpgp: Boolean(capa.OpenPGP),
    gnupg: Boolean(capa.GnuPG)
  };
}

function values(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value as object);
  return [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function propText(card: unknown, names: string[]): string {
  if (!Array.isArray(card) || !Array.isArray(card[1])) return "";
  const wanted = new Set(names);
  for (const row of card[1] as unknown[]) {
    if (!Array.isArray(row) || !wanted.has(String(row[0]).toLowerCase())) continue;
    const value = row[3];
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
      return value.map((part) => (typeof part === "string" ? part : "")).filter(Boolean).join(" ");
    }
  }
  return "";
}

export function writeProp(card: unknown, name: string, value: string): unknown[] {
  const rows = Array.isArray(card) && card[0] === "vcard" && Array.isArray(card[1])
    ? (card[1] as unknown[][]).map((row) => (Array.isArray(row) ? row.slice() : row))
    : [["version", {}, "text", "4.0"]];
  const index = rows.findIndex((row) => Array.isArray(row) && String(row[0]).toLowerCase() === name);
  const next = [name, {}, "text", value];
  if (index >= 0) rows[index] = next;
  else rows.push(next);
  const extra = Array.isArray(card) && Array.isArray(card[2]) ? [card[2]] : [];
  return ["vcard", rows, ...extra];
}

function identityOf(item: Record<string, unknown>): IdentityRow {
  return {
    id: text(item.id),
    label: text(item.label),
    email: text(item.email),
    name: text(item.name),
    replyTo: text(item.replyTo),
    bcc: text(item.bcc),
    signature: text(item.signature),
    signatureInsertBefore: Boolean(item.signatureInsertBefore),
    sentFolder: text(item.sentFolder),
    pgpEncrypt: Boolean(item.pgpEncrypt),
    pgpSign: Boolean(item.pgpSign),
    smimeKey: text(item.smimeKey),
    smimeCertificate: text(item.smimeCertificate),
    smimeCertificateChain: text(item.smimeCertificateChain)
  };
}

function keyRow(armored: string): KeyRow {
  const head = armored.split("\n")[0] || "";
  const kind = /PRIVATE/i.test(head)
    ? t("SETTINGS_OPENPGP.TITLE_PRIVATE", "Privat")
    : /PUBLIC/i.test(head)
      ? t("SETTINGS_OPENPGP.TITLE_PUBLIC", "Öffentlich")
      : t("SETTINGS_DESK.KEYS", "Schlüssel");
  const body = armored.replace(/-----.*?-----/g, "").replace(/\s+/g, "");
  return { kind, preview: body.slice(0, 32) };
}

async function tryCall<T>(action: string, params: Record<string, unknown> = {}): Promise<{ value: T | null; error: string }> {
  try {
    return { value: await call<T>(action, params), error: "" };
  } catch (error) {
    return { value: null, error: explain(error) };
  }
}

export async function loadDesk(caps: Caps, currentEmail: string, mainEmail: string, contactSearch = ""): Promise<SettingsSnapshot> {
  const main = mainEmail || currentEmail;
  const snap: SettingsSnapshot = {
    caps,
    mainEmail: main,
    currentEmail,
    accounts: [{ email: main, name: "", current: currentEmail === main, main: true }],
    identities: [],
    contacts: caps.contacts ? [] : null,
    contactCount: 0,
    contactSearch,
    scripts: caps.sieve ? [] : null,
    keys: [],
    certs: [],
    notes: { accounts: "", contacts: "", filters: "", keys: "", certs: "" }
  };

  const desk = await tryCall<{ Accounts?: { email?: string; name?: string }[]; Identities?: Record<string, unknown>[] }>("AccountsAndIdentities");
  if (desk.error) snap.notes.accounts = desk.error;
  else if (desk.value) {
    const extra = values(desk.value.Accounts).map((item) => {
      const row = item as { email?: string; name?: string };
      const email = text(row.email);
      return { email, name: text(row.name), current: email === currentEmail, main: false };
    }).filter((row) => row.email && row.email !== main);
    snap.accounts = snap.accounts.concat(extra);
    snap.identities = values(desk.value.Identities).map((item) => identityOf(item as Record<string, unknown>));
    const named = snap.identities.find((item) => item.email === main && item.name);
    if (named) snap.accounts[0].name = named.name;
  }

  if (caps.contacts) {
    const book = await tryCall<{ Count?: number; List?: unknown[] }>("Contacts", { Search: contactSearch, Offset: 0, Limit: 50 });
    if (book.error) snap.notes.contacts = book.error;
    else if (book.value) {
      snap.contactCount = Number(book.value.Count || 0);
      snap.contacts = values(book.value.List).map((item) => {
        const row = item as { id?: unknown; readOnly?: boolean; jCard?: unknown };
        return {
          id: text(row.id),
          name: propText(row.jCard, ["fn", "n"]),
          email: propText(row.jCard, ["email"]),
          readOnly: Boolean(row.readOnly),
          jCard: row.jCard
        };
      });
    }
  }

  if (caps.sieve) {
    const filters = await tryCall<{ Scripts?: unknown }>("Filters");
    if (filters.error) snap.notes.filters = filters.error;
    else if (filters.value) {
      snap.scripts = values(filters.value.Scripts).map((item) => {
        const row = item as { name?: string; active?: boolean; body?: string };
        return { name: text(row.name), active: Boolean(row.active), body: text(row.body) };
      }).filter((row) => row.name);
    }
  }

  const keys = await tryCall<unknown>("GetPGPKeys");
  if (keys.error) snap.notes.keys = keys.error;
  else snap.keys = values(keys.value).map((item) => text(item)).filter(Boolean).map((item) => keyRow(item));

  const certs = await tryCall<unknown>("SMimeGetCertificates");
  if (certs.error) snap.notes.certs = certs.error;
  else {
    snap.certs = values(certs.value).map((item) => {
      const row = item as { id?: string; CN?: string; emailAddress?: string; validTo_time_t?: number };
      const until = Number(row.validTo_time_t || 0);
      return {
        id: text(row.id),
        name: text(row.CN),
        email: text(row.emailAddress),
        until: until ? new Date(until * 1000).toLocaleDateString() : ""
      };
    });
  }

  return snap;
}

export async function applyDesk(name: string, data: Record<string, string>, snap: SettingsSnapshot): Promise<"reload" | "session"> {
  if (name === "save-account") {
    if (!data.email?.trim() || !data.password) throw new ApiError(0, "Adresse und Passwort eintragen.");
    await call("AccountSetup", { email: data.email.trim(), password: data.password, name: data.name || "", new: 1 });
    return "reload";
  }
  if (name === "delete-account") {
    await call("AccountDelete", { emailToDelete: data.email });
    return data.email === snap.currentEmail ? "session" : "reload";
  }
  if (name === "switch-account") {
    await call("AccountSwitch", { Email: data.email });
    return "session";
  }
  if (name === "save-identity") {
    if (!data.email?.trim()) throw new ApiError(0, "E-Mail eintragen.");
    await call("IdentityUpdate", {
      Id: data.id || "",
      Label: data.label || "",
      Email: data.email.trim(),
      Name: data.name || "",
      ReplyTo: data.replyTo || "",
      Bcc: data.bcc || "",
      Signature: data.signature || "",
      SignatureInsertBefore: data.signatureInsertBefore ? 1 : 0,
      sentFolder: data.sentFolder || "",
      pgpEncrypt: data.pgpEncrypt ? 1 : 0,
      pgpSign: data.pgpSign ? 1 : 0,
      smimeKey: data.smimeKey || "",
      smimeCertificate: data.smimeCertificate || "",
      smimeCertificateChain: data.smimeCertificateChain || ""
    });
    return "reload";
  }
  if (name === "delete-identity") {
    await call("IdentityDelete", { idToDelete: data.id });
    return "reload";
  }
  if (name === "save-contact") {
    const nameText = (data.name || "").trim();
    const email = (data.email || "").trim();
    if (!nameText && !email) throw new ApiError(0, "Name oder E-Mail eintragen.");
    const existing = snap.contacts?.find((item) => item.id === data.id);
    let card = writeProp(existing?.jCard, "fn", nameText || email);
    card = writeProp(card, "email", email);
    await call("ContactSave", { uid: data.id || "", jCard: card });
    return "reload";
  }
  if (name === "delete-contact") {
    await call("ContactsDelete", { uids: data.id });
    return "reload";
  }
  if (name === "save-script") {
    if (!data.name?.trim()) throw new ApiError(0, "Name eintragen.");
    await call("FiltersScriptSave", { name: data.name.trim(), body: data.body || "" });
    return "reload";
  }
  if (name === "activate-script") {
    await call("FiltersScriptActivate", { name: data.name });
    return "reload";
  }
  if (name === "delete-script") {
    await call("FiltersScriptDelete", { name: data.name });
    return "reload";
  }
  if (name === "import-key") {
    if (!data.key?.trim()) throw new ApiError(0, "Schlüssel einfügen.");
    if (!data.backup && !data.gnupg) throw new ApiError(0, "Speicherort wählen.");
    await call("PgpImportKey", {
      key: data.key,
      keyId: "",
      email: data.email || "",
      backup: data.backup ? 1 : 0,
      gnuPG: data.gnupg ? 1 : 0
    });
    return "reload";
  }
  if (name === "import-cert") {
    if (!data.pem?.trim()) throw new ApiError(0, "Zertifikat einfügen.");
    await call("SMimeImportCertificate", { pem: data.pem });
    return "reload";
  }
  return "reload";
}

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  }[char] ?? char));
}

function field(label: string, name: string, value: string, type = "text", extra = ""): string {
  const control = type === "area"
    ? `<textarea name="${name}" class="${extra}">${esc(value)}</textarea>`
    : `<input name="${name}" type="${type}" value="${esc(value)}" ${extra}>`;
  return `<label class="field"><span>${esc(label)}</span>${control}</label>`;
}

function check(name: string, label: string, on: boolean): string {
  return `<label class="check"><input type="checkbox" name="${name}"${on ? " checked" : ""}> ${esc(label)}</label>`;
}

const BUTTON_ICON: Record<string, IconName> = {
  "settings-edit": "compose",
  "settings-delete": "delete",
  "settings-switch": "user",
  "settings-activate": "check"
};

function button(action: string, label: string, attrs: Record<string, string>, danger = false): string {
  const extra = Object.entries(attrs).map(([key, value]) => ` data-${key}="${esc(value)}"`).join("");
  const name: IconName = attrs.fresh ? "plus" : BUTTON_ICON[action] || "chevron-right";
  return `<button type="button" class="${danger ? "danger" : "text-btn"}" data-action="${action}"${extra}>${icon(name)}<span class="btn-label">${esc(label)}</span></button>`;
}

function row(title: string, meta: string, actions: string): string {
  return `<li class="set-row"><span class="grow"><strong title="${esc(title)}">${esc(title)}</strong>${meta ? `<span class="quiet">${esc(meta)}</span>` : ""}</span>${actions}</li>`;
}

function form(kind: string, inner: string, submit: string, cancel: boolean): string {
  const back = cancel ? `<button type="button" class="text-btn" data-action="settings-cancel">${esc(t("GLOBAL.CANCEL", "Abbrechen"))}</button>` : "";
  return `<form class="fields" data-action="settings-form" data-kind="${kind}">${inner}<div class="dialog-actions">${back}<button type="submit" class="ink-btn">${icon(kind === "search-contacts" ? "search" : kind.startsWith("import") ? "upload" : kind === "save-account" ? "account-add" : "save")}<span class="btn-label">${esc(submit)}</span></button></div></form>`;
}

function note(textValue: string, error = false): string {
  if (!textValue) return "";
  return `<p class="${error ? "error" : "quiet"}">${esc(textValue)}</p>`;
}

function loading(): string {
  return `<p class="quiet">${esc(t("GLOBAL.LOADING", "Wird geladen"))} …</p>`;
}

const blankIdentity = (): IdentityRow => ({
  id: "", label: "", email: "", name: "", replyTo: "", bcc: "", signature: "",
  signatureInsertBefore: false, sentFolder: "", pgpEncrypt: false, pgpSign: false,
  smimeKey: "", smimeCertificate: "", smimeCertificateChain: ""
});

function identityForm(item: IdentityRow, caps: Caps): string {
  const crypto = caps.openpgp || caps.gnupg
    ? `${check("pgpSign", t("CRYPTO.SIGN", "Unterschreiben"), item.pgpSign)}${check("pgpEncrypt", t("CRYPTO.ENCRYPT", "Verschlüsseln"), item.pgpEncrypt)}`
    : "";
  const smimeOpen = item.smimeCertificate || item.smimeKey || item.smimeCertificateChain ? " open" : "";
  return form("save-identity", `
    <input type="hidden" name="id" value="${esc(item.id)}">
    ${field(t("POPUPS_IDENTITY.LABEL", "Label"), "label", item.label)}
    ${field(t("GLOBAL.NAME", "Name"), "name", item.name)}
    ${field(t("GLOBAL.EMAIL", "E-Mail"), "email", item.email, "email", "autocomplete=\"email\" required")}
    ${field(t("GLOBAL.REPLY_TO", "Antwort an"), "replyTo", item.replyTo, "email", "autocomplete=\"email\"")}
    ${field(t("GLOBAL.BCC", "BCC"), "bcc", item.bcc)}
    ${field(t("SETTINGS_DESK.SENT_FOLDER", "Ordner für Gesendet"), "sentFolder", item.sentFolder)}
    ${field(t("POPUPS_IDENTITY.SIGNATURE", "Signatur"), "signature", item.signature, "area", "short")}
    ${check("signatureInsertBefore", t("POPUPS_IDENTITY.LABEL_SIGNATURE_INSERT_BEFORE", "Diese Signatur in Antworten vor dem zitierten Text einfügen"), item.signatureInsertBefore)}
    ${crypto}
    <details${smimeOpen}>
      <summary>${esc(t("SMIME.CERTIFICATES", "S/MIME-Zertifikate"))}</summary>
      ${field(t("SMIME.CERTIFICATE", "Zertifikat"), "smimeCertificate", item.smimeCertificate, "area", "code")}
      ${field(t("CRYPTO.PRIVATE_KEY", "Privater Schlüssel"), "smimeKey", item.smimeKey, "area", "code")}
      ${field(t("SMIME.CERTIFICATECHAIN", "Zwischenzertifikat(e)"), "smimeCertificateChain", item.smimeCertificateChain, "area", "code")}
    </details>
  `, t("GLOBAL.SAVE", "Speichern"), true);
}

function lookSection(): string {
  const current = readAppearance();
  const choice = (value: Appearance, label: string) =>
    `<label class="check"><input type="radio" name="appearance" value="${value}"${current === value ? " checked" : ""}> ${label}</label>`;
  return `
    <p class="mono">${esc(t("SETTINGS_DESK.APPEARANCE", "Erscheinungsbild"))}</p>
    <fieldset class="choices">
      ${choice("system", t("SETTINGS_DESK.SYSTEM", "System"))}
      ${choice("light", t("SETTINGS_DESK.LIGHT", "Hell"))}
      ${choice("dark", t("SETTINGS_DESK.DARK", "Dunkel"))}
    </fieldset>
    <p class="mono">${esc(t("SETTINGS_GENERAL.MAILTO_LINKS", "E-Mail-Adressen"))}</p>
    <p class="quiet">${esc(t("SETTINGS_GENERAL.MAILTO_DESC", "mailto:-Links können direkt hier eine neue Nachricht öffnen."))}</p>
    <button type="button" class="text-btn" data-action="mailto-register">${icon("external")}<span>${esc(t("SETTINGS_GENERAL.MAILTO", "Als Programm für mailto:-Links registrieren"))}</span></button>`;
}

export function renderDesk(section: string, snap: SettingsSnapshot | null, edit: DeskEdit | null): string {
  const error = `<p class="error" id="settings-error" hidden></p>`;
  if (section === "look") return error + lookSection();
  if (!snap) return error + loading();

  if (section === "accounts") {
    const rows = snap.accounts.map((item) => {
      const meta = [item.main ? t("SETTINGS_DESK.MAIN", "Hauptkonto") : item.name, item.current ? t("SETTINGS_DESK.ACTIVE", "Aktiv") : ""].filter(Boolean).join(" · ");
      const actions = [
        item.current ? "" : button("settings-switch", t("SETTINGS_DESK.SWITCH", "Wechseln"), { email: item.email }),
        item.main ? "" : button("settings-delete", t("GLOBAL.DELETE", "Löschen"), { kind: "account", email: item.email }, true)
      ].join("");
      return row(item.email, meta, actions);
    }).join("");
    const add = snap.caps.accounts
      ? form("save-account", `
          ${field(t("GLOBAL.EMAIL", "E-Mail"), "email", "", "email", "autocomplete=\"email\" required")}
          ${field(t("GLOBAL.PASSWORD", "Passwort"), "password", "", "password", "autocomplete=\"current-password\" required")}
          ${field(t("GLOBAL.NAME", "Name"), "name", "")}
        `, t("POPUPS_ADD_ACCOUNT.BUTTON_ADD_ACCOUNT", "Hinzufügen"), false)
      : "";
    return `${error}<p class="mono">${esc(t("SETTINGS_ACCOUNTS.LEGEND_ACCOUNTS", "Konten"))}</p>${note(snap.notes.accounts, true)}<ul class="set-list">${rows}</ul>${add}`;
  }

  if (section === "identities") {
    const rows = snap.identities.map((item) => row(
      item.name || item.email || item.label,
      [item.email, item.label].filter(Boolean).join(" · "),
      [
        button("settings-edit", t("SETTINGS_DESK.EDIT", "Bearbeiten"), { kind: "identity", id: item.id }),
        item.id && snap.caps.identities ? button("settings-delete", t("GLOBAL.DELETE", "Löschen"), { kind: "identity", id: item.id }, true) : ""
      ].join("")
    )).join("");
    const adding = edit?.kind === "identity";
    const current = edit?.kind === "identity"
      ? (edit.fresh ? blankIdentity() : snap.identities.find((item) => item.id === edit.id) || blankIdentity())
      : null;
    const editor = current ? identityForm(current, snap.caps) : "";
    const add = snap.caps.identities && !adding
      ? button("settings-edit", t("SETTINGS_ACCOUNTS.BUTTON_ADD_IDENTITY", "Identität hinzufügen"), { kind: "identity", fresh: "1" })
      : "";
    return `${error}<p class="mono">${esc(t("SETTINGS_ACCOUNTS.LEGEND_IDENTITIES", "Identitäten"))}</p>${note(snap.notes.accounts, true)}<ul class="set-list">${rows || ""}</ul>${rows ? "" : note(t("SETTINGS_DESK.EMPTY", "Nichts vorhanden."))}${add}${editor}`;
  }

  if (section === "contacts") {
    if (!snap.contacts) return error + note(t("SETTINGS_DESK.UNAVAILABLE", "Nicht verfügbar."));
    const rows = snap.contacts.map((item) => row(
      item.name || item.email || item.id,
      item.name ? item.email : "",
      item.readOnly ? "" : [
        button("settings-edit", t("SETTINGS_DESK.EDIT", "Bearbeiten"), { kind: "contact", id: item.id }),
        button("settings-delete", t("GLOBAL.DELETE", "Löschen"), { kind: "contact", id: item.id }, true)
      ].join("")
    )).join("");
    const search = form("search-contacts", field(t("GLOBAL.SEARCH", "Suchen"), "search", snap.contactSearch, "search"), t("GLOBAL.SEARCH", "Suchen"), false);
    const adding = edit?.kind === "contact";
    const current = edit?.kind === "contact" && !edit.fresh
      ? snap.contacts.find((item) => item.id === edit.id)
      : null;
    const editor = adding ? form("save-contact", `
      <input type="hidden" name="id" value="${esc(current?.id || "")}">
      ${field(t("CONTACTS.DISPLAY_NAME", "Anzeigename"), "name", current?.name || "")}
      ${field(t("GLOBAL.EMAIL", "E-Mail"), "email", current?.email || "", "email", "autocomplete=\"email\"")}
    `, t("GLOBAL.SAVE", "Speichern"), true) : "";
    const more = snap.contactCount > snap.contacts.length
      ? note(`${snap.contacts.length} / ${snap.contactCount}`)
      : "";
    const add = adding ? "" : button("settings-edit", t("CONTACTS.BUTTON_ADD_CONTACT", "Kontakt hinzufügen"), { kind: "contact", fresh: "1" });
    return `${error}<p class="mono">${esc(t("SETTINGS_LABELS.CONTACTS", "Kontakte"))}</p>${note(snap.notes.contacts, true)}${search}<ul class="set-list">${rows}</ul>${rows ? "" : note(snap.contactSearch ? t("CONTACTS.EMPTY_SEARCH", "Keine Kontakte gefunden") : t("CONTACTS.EMPTY_LIST", "Keine Kontakte"))}${more}${add}${editor}`;
  }

  if (section === "filters") {
    if (!snap.scripts) return error + note(t("SETTINGS_DESK.UNAVAILABLE", "Nicht verfügbar."));
    const rows = snap.scripts.map((item) => row(
      item.name,
      item.active ? t("SETTINGS_DESK.ACTIVE", "Aktiv") : "",
      [
        item.active ? "" : button("settings-activate", t("SETTINGS_DESK.ACTIVATE", "Aktivieren"), { name: item.name }),
        button("settings-edit", t("SETTINGS_DESK.EDIT", "Bearbeiten"), { kind: "script", id: item.name }),
        button("settings-delete", t("GLOBAL.DELETE", "Löschen"), { kind: "script", name: item.name }, true)
      ].join("")
    )).join("");
    const adding = edit?.kind === "script";
    const current = edit?.kind === "script" && !edit.fresh
      ? snap.scripts.find((item) => item.name === edit.id)
      : null;
    const editor = adding ? form("save-script", `
      ${field(t("GLOBAL.NAME", "Name"), "name", current?.name || "", "text", current ? "readonly" : "required")}
      ${field(t("SETTINGS_DESK.SCRIPT", "Skript"), "body", current?.body || "", "area", "code")}
    `, t("GLOBAL.SAVE", "Speichern"), true) : "";
    const add = adding ? "" : button("settings-edit", t("SETTINGS_FILTERS.BUTTON_ADD_SCRIPT", "Skript hinzufügen"), { kind: "script", fresh: "1" });
    return `${error}<p class="mono">${esc(t("SETTINGS_LABELS.FILTERS", "Filter"))}</p>${note(snap.notes.filters, true)}<ul class="set-list">${rows}</ul>${rows ? "" : note(t("SETTINGS_DESK.EMPTY", "Nichts vorhanden."))}${add}${editor}`;
  }

  const keyRows = snap.keys.map((item) => row(item.kind, item.preview, "")).join("");
  const certRows = snap.certs.map((item) => row(
    item.name || item.email || item.id,
    [item.email, item.until ? `${t("CRYPTO.VALID_UNTIL", "Gültig bis")} ${item.until}` : ""].filter(Boolean).join(" · "),
    ""
  )).join("");
  const keyImport = form("import-key", `
    ${field(t("SETTINGS_OPENPGP.BUTTON_IMPORT_KEY", "Schlüssel importieren"), "key", "", "area", "code")}
    ${field(t("GLOBAL.EMAIL", "E-Mail"), "email", "", "email", "autocomplete=\"email\"")}
    ${check("backup", t("OPENPGP.BACKUP_ON_SERVER", "Auf dem Server verschlüsselt speichern"), true)}
    ${snap.caps.gnupg ? check("gnupg", t("OPENPGP.STORE_IN_GNUPG", "Auf dem Server in GnuPG speichern"), false) : ""}
  `, t("OPENPGP.POPUP_IMPORT_BUTTON", "Importieren"), false);
  const certImport = form("import-cert", `
    ${field(t("SMIME.CERTIFICATE", "Zertifikat"), "pem", "", "area", "code")}
  `, t("OPENPGP.POPUP_IMPORT_BUTTON", "Importieren"), false);
  return `${error}
    <p class="mono">${esc(t("SETTINGS_DESK.KEYS", "Schlüssel"))}</p>
    <p class="quiet">${esc(t("SETTINGS_DESK.KEY_HINT", "Signieren und Verschlüsseln stehen an der Identität."))}</p>
    ${note(snap.notes.keys, true)}
    <ul class="set-list">${keyRows}</ul>
    ${keyRows ? "" : note(t("SETTINGS_DESK.EMPTY", "Nichts vorhanden."))}
    <details><summary>${esc(t("SETTINGS_OPENPGP.BUTTON_IMPORT_KEY", "Schlüssel importieren"))}</summary>${keyImport}</details>
    <p class="mono">${esc(t("SMIME.CERTIFICATES", "S/MIME-Zertifikate"))}</p>
    ${note(snap.notes.certs, true)}
    <ul class="set-list">${certRows}</ul>
    ${certRows ? "" : note(t("SETTINGS_DESK.EMPTY", "Nichts vorhanden."))}
    <details><summary>${esc(t("SMIME.POPUP_IMPORT_TITLE", "S/MIME-Zertifikat importieren"))}</summary>${certImport}</details>`;
}
