import { ApiError, call, explain, plugin } from "./api";
import { parseFolders } from "./folders";
import { icon, type IconName } from "./icons";
import { t } from "./i18n";
import { renderFilterEditor } from "./sieve/form";
import { parseFilterScript } from "./sieve/script";
import { readAppearance, type Appearance } from "./theme";

export { writeProp } from "./jcard";

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
  unread: number | null;
}

export interface TwoFactorInfo {
  enabled: boolean;
  ready: boolean;
  secret: string;
  codes: string;
  qr: string;
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
  scripts: ScriptRow[] | null;
  sieveCapa: string[];
  folderNames: string[];
  keys: KeyRow[];
  certs: CertRow[];
  notes: { accounts: string; contacts: string; filters: string; keys: string; certs: string };
  app: Record<string, unknown>;
  twoFactor: TwoFactorInfo | null;
  passwordPlugin: boolean;
  assist: Record<string, unknown> | null;
  assistTones: string[];
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

export async function loadDesk(caps: Caps, currentEmail: string, mainEmail: string, app: Record<string, unknown> = {}): Promise<SettingsSnapshot> {
  const main = mainEmail || currentEmail;
  const plugins = (app.Plugins || {}) as Record<string, unknown>;
  const snap: SettingsSnapshot = {
    caps,
    mainEmail: main,
    currentEmail,
    accounts: [{ email: main, name: "", current: currentEmail === main, main: true, unread: null }],
    identities: [],
    scripts: caps.sieve ? [] : null,
    sieveCapa: [],
    folderNames: [],
    keys: [],
    certs: [],
    notes: { accounts: "", contacts: "", filters: "", keys: "", certs: "" },
    app,
    twoFactor: null,
    passwordPlugin: Boolean(plugins["change-password"]),
    assist: null,
    assistTones: []
  };

  const desk = await tryCall<{ Accounts?: { email?: string; name?: string }[]; Identities?: Record<string, unknown>[] }>("AccountsAndIdentities");
  if (desk.error) snap.notes.accounts = desk.error;
  else if (desk.value) {
    const extra = values(desk.value.Accounts).map((item) => {
      const row = item as { email?: string; name?: string };
      const email = text(row.email);
      return { email, name: text(row.name), current: email === currentEmail, main: false, unread: null as number | null };
    }).filter((row) => row.email && row.email !== main);
    snap.accounts = snap.accounts.concat(extra);
    snap.identities = values(desk.value.Identities).map((item) => identityOf(item as Record<string, unknown>));
    const named = snap.identities.find((item) => item.email === main && item.name);
    if (named) snap.accounts[0].name = named.name;
  }

  if (caps.sieve) {
    const filters = await tryCall<{ Scripts?: unknown }>("Filters");
    if (filters.error) snap.notes.filters = filters.error;
    else if (filters.value) {
      const bag = filters.value as { Scripts?: unknown; Capa?: unknown };
      snap.sieveCapa = values(bag.Capa).map((item) => text(item)).filter(Boolean);
      snap.scripts = values(bag.Scripts).map((item) => {
        const row = item as { name?: string; active?: boolean; body?: string };
        return { name: text(row.name), active: Boolean(row.active), body: text(row.body) };
      }).filter((row) => row.name);
      const tree = await tryCall<Record<string, unknown>>("Folders");
      if (!tree.error && tree.value) {
        snap.folderNames = parseFolders(tree.value).folders.filter((item) => item.selectable).map((item) => item.fullName);
      }
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

  await Promise.all(snap.accounts.filter((item) => !item.current && !item.main).map(async (item) => {
    const info = await tryCall<{ unreadEmails?: number }>("AccountUnread", { email: item.email });
    if (!info.error && info.value) item.unread = Number(info.value.unreadEmails || 0);
  }));

  if (plugins["two-factor-auth"]) {
    const info = await tryCall<Record<string, unknown>>("GetTwoFactorInfo");
    const value = info.value;
    if (value && typeof value === "object") {
      snap.twoFactor = {
        enabled: Boolean(value.Enable),
        ready: Boolean(value.IsSet),
        secret: text(value.Secret),
        codes: text(value.BackupCodes),
        qr: text(value.QRCode)
      };
    }
  }

  if (plugins["ai-copilot"]) {
    const via = await pluginSafe();
    snap.assist = via.settings;
    snap.assistTones = via.tones;
  }

  return snap;
}

async function pluginSafe(): Promise<{ settings: Record<string, unknown> | null; tones: string[] }> {
  try {
    const result = await plugin<{ settings?: Record<string, unknown>; tones?: string[] }>("AiGetSettings");
    return { settings: result.settings || {}, tones: result.tones || [] };
  } catch {
    return { settings: null, tones: [] };
  }
}

export async function applyDesk(name: string, data: Record<string, string>, snap: SettingsSnapshot): Promise<"reload" | "session" | "keep"> {
  if (name === "save-account") {
    if (!data.email?.trim() || !data.password) throw new ApiError(0, "Adresse und Passwort eintragen.");
    await call("AccountSetup", { email: data.email.trim(), password: data.password, name: data.name || "", new: 1 });
    return "reload";
  }
  if (name === "edit-account") {
    if (!data.email?.trim()) throw new ApiError(0, "Adresse eintragen.");
    await call("AccountSetup", { email: data.email.trim(), password: data.password || "", name: data.name || "", new: 0 });
    return "reload";
  }
  if (name === "sort-accounts") {
    const emails = data.order.split(",").map((item) => item.trim()).filter(Boolean);
    await call("AccountsAndIdentitiesSortOrder", { Accounts: emails });
    return "reload";
  }
  if (name === "sort-identities") {
    const ids = data.order.split(",").map((item) => item.trim()).filter(Boolean);
    await call("AccountsAndIdentitiesSortOrder", { Identities: ids });
    return "reload";
  }
  if (name === "import-account") {
    await call("AccountImport", { email: data.email, rootfolder: data.email });
    return "reload";
  }
  if (name === "change-password") {
    if (!data.PrevPassword || !data.NewPassword) throw new ApiError(0, "Beide Passwörter eintragen.");
    if (data.NewPassword !== data.Repeat) throw new ApiError(0, "Die Wiederholung stimmt nicht.");
    await call("ChangePassword", { PrevPassword: data.PrevPassword, NewPassword: data.NewPassword });
    return "reload";
  }
  if (name === "two-factor-create") {
    await call("CreateTwoFactorSecret", { Code: data.Code || "" });
    return "reload";
  }
  if (name === "two-factor-enable") {
    await call("EnableTwoFactor", { Enable: data.Enable ? "1" : "0", Code: data.Code || "" });
    return "reload";
  }
  if (name === "two-factor-clear") {
    await call("ClearTwoFactorInfo", { Code: data.Code || "" });
    return "reload";
  }
  if (name === "assist-save") {
    const features: Record<string, boolean> = {};
    Object.keys(data).forEach((key) => {
      if (key.startsWith("feature:")) features[key.slice(8)] = data[key] === "1";
    });
    await plugin("AiSaveSettings", {
      settings: {
        enabled: data.enabled === "1",
        features,
        tone: data.tone || "professional",
        language: data.language || "auto",
        name: data.name || "",
        style: data.style || "",
        addresses: data.addresses || "",
        notice_ack: data.notice_ack === "1"
      }
    });
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
  if (name === "save-sync") {
    await call("SaveContactsSyncData", {
      Mode: Number(data.Mode || 0),
      Url: data.Url || "",
      User: data.User || "",
      Password: data.Password || ""
    });
    const previous = snap.app.ContactsSync;
    const sync = previous && typeof previous === "object" ? { ...(previous as Record<string, unknown>) } : {};
    sync.Mode = Number(data.Mode || 0);
    sync.Url = data.Url || "";
    sync.User = data.User || "";
    sync.Password = data.Password ? "********" : "";
    snap.app.ContactsSync = sync;
    return "keep";
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

function flag(app: Record<string, unknown>, key: string, fallback = false): boolean {
  const value = app[key];
  if (value == null || value === "") return fallback;
  return value === true || value === 1 || value === "1";
}

function num(app: Record<string, unknown>, key: string, fallback: number): number {
  const value = Number(app[key]);
  return Number.isFinite(value) ? value : fallback;
}

function choice(name: string, value: string, label: string, current: string): string {
  return `<label class="check"><input type="radio" name="${name}" data-pref="${name}" value="${esc(value)}"${current === value ? " checked" : ""}> ${esc(label)}</label>`;
}

function prefCheck(name: string, label: string, on: boolean): string {
  return `<label class="check"><input type="checkbox" data-pref="${name}"${on ? " checked" : ""}> ${esc(label)}</label>`;
}

function prefSelect(name: string, label: string, current: string, options: [string, string][]): string {
  const items = options.map(([value, textValue]) => `<option value="${esc(value)}"${value === current ? " selected" : ""}>${esc(textValue)}</option>`).join("");
  return `<label class="field"><span>${esc(label)}</span><select data-pref="${name}">${items}</select></label>`;
}

function group(title: string, body: string): string {
  return `<p class="mono">${esc(title)}</p><div class="fields">${body}</div>`;
}

export function renderGeneral(app: Record<string, unknown>): string {
  const languages = ((app.System as { languages?: Record<string, string> } | undefined)?.languages) || {};
  const langOptions = Object.entries(languages).map(([code, label]) => [code, label] as [string, string]);
  const language = String(app.language || "");
  const hour = String(app.hourCycle || "");
  const layout = String(num(app, "Layout", 1));
  const perPage = String(num(app, "MessagesPerPage", 25));
  const interval = String(num(app, "CheckMailInterval", 15));
  const minInterval = String(Math.max(1, num(app, "minRefreshInterval", 5)));
  const sort = String(app.defaultSort || "");
  const thread = String(app.threadAlgorithm || "");
  const images = String(app.ViewImages || "ask");
  const editor = String(app.EditorDefaultType || "Plain") === "Html" ? "Html" : "Plain";
  const sounds = Array.isArray(app.newMailSounds) ? app.newMailSounds.map((item) => String(item)) : ["new-mail"];
  const sound = String(app.NotificationSound || "new-mail");
  const permission = typeof Notification === "undefined" ? "" : Notification.permission;
  const denied = permission === "denied" ? `<p class="quiet">${esc(t("SETTINGS_GENERAL.CHROME_NOTIFICATION_DESC_DENIED", "Der Browser hat Hinweise abgelehnt. Die Freigabe liegt in den Browser-Einstellungen."))}</p>` : "";
  const lang = flag(app, "allowLanguagesOnSettings", true) && langOptions.length
    ? prefSelect("language", t("GLOBAL.LANGUAGE", "Sprache"), language, langOptions)
    : "";
  return `
    ${group(t("SETTINGS_GENERAL.LEGEND_TIME", "Sprache und Zeit"), `
      ${lang}
      ${prefSelect("hourCycle", t("SETTINGS_GENERAL.HOUR_CYCLE", "Uhrzeit"), hour, [["", t("SETTINGS_GENERAL.HOUR_AUTO", "Wie im System")], ["h23", t("SETTINGS_GENERAL.HOUR_24", "24 Stunden")], ["h12", t("SETTINGS_GENERAL.HOUR_12", "12 Stunden")]])}
    `)}
    ${group(t("SETTINGS_LABELS.FOLDERS", "Postfach"), `
      <fieldset class="choices">
        <legend class="quiet">${esc(t("SETTINGS_GENERAL.LAYOUT", "Layout"))}</legend>
        ${choice("Layout", "0", t("SETTINGS_GENERAL.LAYOUT_NO_SPLIT", "Ohne Teilung"), layout)}
        ${choice("Layout", "1", t("SETTINGS_GENERAL.LAYOUT_COLUMNS", "Spalten"), layout)}
        ${choice("Layout", "2", t("SETTINGS_GENERAL.LAYOUT_BOTTOM", "Brief unten"), layout)}
      </fieldset>
      ${prefSelect("MessagesPerPage", t("SETTINGS_GENERAL.MESSAGES_PER_PAGE", "Mails pro Seite"), perPage, ["10", "20", "25", "50", "100"].map((value) => [value, value]))}
      ${prefSelect("CheckMailInterval", t("SETTINGS_GENERAL.CHECK_INTERVAL", "Abrufintervall"), interval, ["5", "10", "15", "30", "60"].filter((value) => Number(value) >= Number(minInterval)).map((value) => [value, `${value} min`]))}
      ${prefSelect("defaultSort", t("MESSAGE_LIST.SORT", "Sortierung"), sort, [["", t("MESSAGE_LIST.SORT_DATE", "Datum")], ["DATE", t("MESSAGE_LIST.SORT_DATE", "Datum")], ["FROM", t("MESSAGE_LIST.SORT_FROM", "Absender")], ["SUBJECT", t("MESSAGE_LIST.SORT_SUBJECT", "Betreff")], ["SIZE", t("MESSAGE_LIST.SORT_SIZE", "Größe")]])}
      ${prefCheck("UseThreads", t("SETTINGS_GENERAL.THREADS", "Unterhaltungen"), flag(app, "useThreads") || flag(app, "UseThreads"))}
      ${prefSelect("threadAlgorithm", t("SETTINGS_GENERAL.THREAD_ALGORITHM", "Thread-Verfahren"), thread, [["", t("SETTINGS_GENERAL.THREAD_SERVER", "Wie der Server")], ["REFERENCES", "References"], ["ORDEREDSUBJECT", "Subject"]])}
      ${prefCheck("UseCheckboxesInList", t("SETTINGS_GENERAL.CHECKBOXES", "Kontrollkästchen in der Liste"), flag(app, "UseCheckboxesInList", true))}
      ${prefCheck("listGrouped", t("SETTINGS_GENERAL.GROUPED", "Nach Datum gruppieren"), flag(app, "listGrouped"))}
      ${prefCheck("HideDeleted", t("SETTINGS_GENERAL.HIDE_DELETED", "Gelöschte ausblenden"), flag(app, "HideDeleted", true))}
      ${prefCheck("HideUnsubscribed", t("SETTINGS_GENERAL.HIDE_UNSUB", "Nicht abonnierte ausblenden"), flag(app, "HideUnsubscribed"))}
      ${prefCheck("ShowUnreadCount", t("SETTINGS_GENERAL.UNREAD_TITLE", "Ungelesen im Fenstertitel"), flag(app, "ShowUnreadCount"))}
    `)}
    ${group(t("SETTINGS_GENERAL.LEGEND_READ", "Lesen"), `
      ${prefCheck("messageReadAuto", t("SETTINGS_GENERAL.READ_AUTO", "Beim Lesen als gelesen markieren"), flag(app, "messageReadAuto", true))}
      ${prefSelect("MessageReadDelay", t("SETTINGS_GENERAL.READ_DELAY", "Gelesen nach"), String(num(app, "MessageReadDelay", 5)), [["0", t("SETTINGS_GENERAL.READ_NOW", "Sofort")], ["2", "2 s"], ["5", "5 s"], ["10", "10 s"]])}
      ${prefCheck("showNextMessage", t("SETTINGS_GENERAL.SHOW_NEXT", "Nach dem Löschen die nächste Mail öffnen"), flag(app, "showNextMessage"))}
      ${prefCheck("messageNewWindow", t("SETTINGS_GENERAL.NEW_WINDOW", "Brief in einem neuen Fenster"), flag(app, "messageNewWindow"))}
      ${prefSelect("MsgDefaultAction", t("SETTINGS_GENERAL.DEFAULT_REPLY", "Standard-Antwort"), String(num(app, "MsgDefaultAction", 1)), [["1", t("MESSAGE.BUTTON_REPLY", "Antworten")], ["2", t("MESSAGE.BUTTON_REPLY_ALL", "Allen antworten")]])}
      ${prefCheck("ViewHTML", t("SETTINGS_GENERAL.VIEW_HTML", "HTML bevorzugen"), flag(app, "ViewHTML", true))}
      ${prefSelect("ViewImages", t("SETTINGS_GENERAL.VIEW_IMAGES", "Externe Bilder"), images, [["ask", t("SETTINGS_GENERAL.IMAGES_ASK", "Fragen")], ["always", t("SETTINGS_GENERAL.IMAGES_ALWAYS", "Immer laden")], ["match", t("SETTINGS_GENERAL.IMAGES_LIST", "Nur die Liste")], ["never", t("SETTINGS_GENERAL.IMAGES_NEVER", "Nie")]])}
      <label class="field"><span>${esc(t("SETTINGS_GENERAL.IMAGE_LIST", "Liste für externe Bilder"))}</span><textarea data-pref="ViewImagesWhitelist">${esc(String(app.ViewImagesWhitelist || ""))}</textarea></label>
      ${prefCheck("RemoveColors", t("SETTINGS_GENERAL.REMOVE_COLORS", "Farben entfernen"), flag(app, "RemoveColors"))}
      ${prefCheck("AllowStyles", t("SETTINGS_GENERAL.ALLOW_STYLES", "Stile erlauben"), flag(app, "AllowStyles"))}
      ${prefSelect("minFontSize", t("SETTINGS_GENERAL.MIN_FONT", "Mindestschrift"), String(num(app, "minFontSize", 5)), ["5", "8", "10", "12", "14"].map((value) => [value, `${value} px`]))}
      ${prefCheck("CollapseBlockquotes", t("SETTINGS_GENERAL.COLLAPSE_QUOTES", "Zitate einklappen"), flag(app, "CollapseBlockquotes", true))}
      ${prefSelect("MaxBlockquotesLevel", t("SETTINGS_GENERAL.QUOTE_LEVEL", "Zitate ab Ebene"), String(num(app, "MaxBlockquotesLevel", 0)), [["0", t("SETTINGS_GENERAL.QUOTE_ALL", "Alle")], ["1", "1"], ["2", "2"], ["3", "3"]])}
      ${prefCheck("ListInlineAttachments", t("SETTINGS_GENERAL.INLINE", "Eingebettete Anhänge listen"), flag(app, "ListInlineAttachments"))}
      ${prefCheck("simpleAttachmentsList", t("SETTINGS_GENERAL.SIMPLE_FILES", "Einfache Anhangsliste"), flag(app, "simpleAttachmentsList"))}
    `)}
    ${group(t("SETTINGS_GENERAL.LEGEND_WRITE", "Schreiben"), `
      ${prefSelect("EditorDefaultType", t("SETTINGS_GENERAL.EDITOR", "Editor"), editor, [["Plain", t("COMPOSE.TOGGLE_TO_PLAIN", "Text")], ["Html", "HTML"]])}
      ${prefCheck("markdown", "Markdown", flag(app, "markdown"))}
      ${prefCheck("allowSpellcheck", t("SETTINGS_GENERAL.SPELLCHECK", "Rechtschreibung"), flag(app, "allowSpellcheck"))}
      ${prefCheck("AllowDraftAutosave", t("SETTINGS_GENERAL.AUTOSAVE", "Entwürfe automatisch speichern"), flag(app, "AllowDraftAutosave", true))}
      ${prefCheck("ReplySameFolder", t("SETTINGS_GENERAL.REPLY_SAME", "In denselben Ordner antworten"), flag(app, "ReplySameFolder"))}
      ${prefCheck("ContactsAutosave", t("SETTINGS_GENERAL.CONTACTS_SAVE", "Empfänger als Kontakte merken"), flag(app, "ContactsAutosave", true))}
      ${prefCheck("requestReadReceipt", t("SETTINGS_GENERAL.RECEIPT", "Lesebestätigung anfragen"), flag(app, "requestReadReceipt"))}
      ${prefCheck("requestDsn", t("SETTINGS_GENERAL.DSN", "Zustellbestätigung anfragen"), flag(app, "requestDsn"))}
      ${prefCheck("requireTLS", "TLS", flag(app, "requireTLS"))}
      ${prefCheck("pgpSign", t("CRYPTO.SIGN", "Unterschreiben"), flag(app, "pgpSign"))}
      ${prefCheck("pgpEncrypt", t("CRYPTO.ENCRYPT", "Verschlüsseln"), flag(app, "pgpEncrypt"))}
      <p class="quiet">${esc(t("SETTINGS_GENERAL.MAILTO_DESC", "mailto:-Links können direkt hier eine neue Nachricht öffnen."))}</p>
      <button type="button" class="text-btn" data-action="mailto-register">${icon("external")}<span>${esc(t("SETTINGS_GENERAL.MAILTO", "Als Programm für mailto:-Links registrieren"))}</span></button>
    `)}
    ${group(t("SETTINGS_GENERAL.LEGEND_NOTIFY", "Benachrichtigungen"), `
      ${prefCheck("DesktopNotifications", t("SETTINGS_GENERAL.DESKTOP", "Hinweis auf dem Desktop"), flag(app, "DesktopNotifications", true))}
      <p class="quiet">${esc(permission === "granted" ? t("SETTINGS_GENERAL.NOTIFY_OK", "Der Browser erlaubt Hinweise.") : permission === "denied" ? "" : t("SETTINGS_GENERAL.NOTIFY_ASK", "Der Browser fragt beim Einschalten."))}</p>
      ${denied}
      ${prefCheck("SoundNotification", t("SETTINGS_GENERAL.SOUND", "Ton"), flag(app, "SoundNotification", true))}
      ${prefSelect("NotificationSound", t("SETTINGS_GENERAL.SOUND_NAME", "Klang"), sound, sounds.map((name) => [name, name]))}
      <button type="button" class="text-btn" data-action="preview-sound">${icon("external")}<span>${esc(t("SETTINGS_GENERAL.SOUND_PREVIEW", "Probehören"))}</span></button>
    `)}`;
}

export function renderSecurity(snap: SettingsSnapshot): string {
  const app = snap.app;
  const logout = String(num(app, "AutoLogout", 30));
  const forget = String(num(app, "keyPassForget", 15));
  const password = snap.passwordPlugin ? form("change-password", `
    ${field(t("GLOBAL.PASSWORD", "Passwort"), "PrevPassword", "", "password", "autocomplete=\"current-password\" required")}
    ${field(t("SETTINGS_SECURITY.NEW_PASSWORD", "Neues Passwort"), "NewPassword", "", "password", "autocomplete=\"new-password\" required")}
    ${field(t("SETTINGS_SECURITY.REPEAT", "Wiederholen"), "Repeat", "", "password", "autocomplete=\"new-password\" required")}
  `, t("SETTINGS_SECURITY.CHANGE", "Passwort ändern"), false) : "";
  const factor = snap.twoFactor ? `
    <p class="mono">${esc(t("SETTINGS_SECURITY.TWO_FACTOR", "Zwei-Faktor"))}</p>
    <p class="quiet">${esc(snap.twoFactor.enabled ? t("SETTINGS_SECURITY.TWO_ON", "Eingeschaltet.") : t("SETTINGS_SECURITY.TWO_OFF", "Ausgeschaltet."))}</p>
    ${snap.twoFactor.secret ? `<p class="quiet">${esc(snap.twoFactor.secret)}</p>` : ""}
    ${snap.twoFactor.codes ? `<p class="quiet">${esc(t("SETTINGS_SECURITY.BACKUP", "Ersatzcodes"))}: ${esc(snap.twoFactor.codes)}</p>` : ""}
    ${form("two-factor-create", field(t("SETTINGS_SECURITY.CURRENT_CODE", "Aktueller Code"), "Code", ""), t("SETTINGS_SECURITY.NEW_SECRET", "Neues Geheimnis"), false)}
    ${form("two-factor-enable", `
      ${check("Enable", t("SETTINGS_SECURITY.TWO_ENABLE", "Zwei-Faktor einschalten"), snap.twoFactor.enabled)}
      ${field(t("SETTINGS_SECURITY.CURRENT_CODE", "Aktueller Code"), "Code", "")}
    `, t("GLOBAL.SAVE", "Speichern"), false)}
    ${form("two-factor-clear", field(t("SETTINGS_SECURITY.CURRENT_CODE", "Aktueller Code"), "Code", ""), t("SETTINGS_SECURITY.CLEAR", "Zwei-Faktor löschen"), false)}
  ` : "";
  return `
    ${group(t("SETTINGS_SECURITY.LEGEND", "Sitzung"), `
      ${prefSelect("AutoLogout", t("SETTINGS_SECURITY.AUTO_LOGOUT", "Automatisch abmelden nach"), logout, [["0", t("SETTINGS_SECURITY.NEVER", "Nie")], ["5", "5 min"], ["15", "15 min"], ["30", "30 min"], ["60", "1 h"], ["120", "2 h"]])}
      ${prefSelect("keyPassForget", t("SETTINGS_SECURITY.KEY_FORGET", "Schlüssel-Passwort vergessen nach"), forget, [["0", t("SETTINGS_SECURITY.NEVER", "Nie")], ["5", "5 min"], ["15", "15 min"], ["30", "30 min"], ["60", "1 h"]])}
    `)}
    ${password}
    ${factor}`;
}

const ASSIST_FEATURES: [string, string][] = [
  ["summarize", "Zusammenfassen"],
  ["draft", "Entwurf"],
  ["quick_replies", "Kurze Antworten"],
  ["search", "Suche"],
  ["triage", "Einordnen"],
  ["triage_llm", "Einordnen mit Modell"],
  ["chat", "Fragen"],
  ["alerts", "Hinweise"]
];

export function renderAssistant(snap: SettingsSnapshot): string {
  const settings = snap.assist;
  if (!settings) return note(t("SETTINGS_DESK.UNAVAILABLE", "Nicht verfügbar."));
  const features = (settings.features || {}) as Record<string, boolean>;
  const admin = (((snap.app.Plugins as Record<string, { features?: Record<string, boolean> }> | undefined)?.["ai-copilot"])?.features) || {};
  const providers = ((snap.app.Plugins as Record<string, { providers?: Record<string, { name?: string; model?: string }> }> | undefined)?.["ai-copilot"])?.providers || {};
  const provider = providers.default;
  const tones = (snap.assistTones.length ? snap.assistTones : ["professional"]).map((tone) => [tone, tone] as [string, string]);
  const boxes = ASSIST_FEATURES.filter(([name]) => admin[name] !== false).map(([name, label]) =>
    prefCheck(`feature:${name}`, label, features[name] !== false)
  ).join("");
  return `
    <p class="mono">${esc(t("AI_COPILOT.TITLE", "Assistent"))}</p>
    <form class="fields" data-action="settings-form" data-kind="assist-save">
      ${check("enabled", t("AI_COPILOT.ENABLED", "Assistent für dieses Konto"), settings.enabled !== false)}
      ${boxes.replace(/data-pref=/g, "name=").replace(/type="checkbox"/g, "type=\"checkbox\"")}
      <label class="field"><span>${esc(t("AI_COPILOT.TONE", "Standardton"))}</span><select name="tone">${tones.map(([value]) => `<option value="${esc(value)}"${value === String(settings.tone || "professional") ? " selected" : ""}>${esc(value)}</option>`).join("")}</select></label>
      ${prefSelect("language", t("GLOBAL.LANGUAGE", "Sprache"), String(settings.language || "auto"), [["auto", "Automatisch"], ["de", "Deutsch"], ["en", "Englisch"]]).replace("data-pref=\"language\"", "name=\"language\"")}
      ${field(t("AI_COPILOT.NAME", "Eigener Name"), "name", String(settings.name || ""))}
      ${field(t("AI_COPILOT.STYLE", "Schreibstil"), "style", String(settings.style || ""), "area")}
      ${field(t("AI_COPILOT.ADDRESSES", "Eigene Adressen"), "addresses", String(settings.addresses || ""), "area")}
      <p class="quiet">${esc(provider ? `${provider.name || ""} ${provider.model || ""}`.trim() : "")}</p>
      <p class="quiet">${esc(t("AI_COPILOT.PRIVACY", "Der Assistent sendet Brieftext erst nach einer Einwilligung an den Anbieter."))}</p>
      ${check("notice_ack", t("AI_COPILOT.NOTICE", "Einwilligung bleibt gespeichert"), Boolean(settings.notice_ack))}
      <button type="button" class="text-btn" data-action="assist-revoke">${esc(t("AI_COPILOT.REVOKE", "Einwilligung zurücknehmen"))}</button>
      <div class="dialog-actions"><button type="submit" class="ink-btn">${icon("save")}<span class="btn-label">${esc(t("GLOBAL.SAVE", "Speichern"))}</span></div>
    </form>`;
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
  if (section === "general") return error + renderGeneral(snap?.app || {});
  if (section === "security") return error + (snap ? renderSecurity(snap) : loading());
  if (section === "assistant") return error + (snap ? renderAssistant(snap) : loading());
  if (!snap) return error + loading();

  if (section === "accounts") {
    const extras = snap.accounts.filter((item) => !item.main).map((item) => item.email);
    const rows = snap.accounts.map((item) => {
      const unread = item.unread == null ? "" : `${item.unread} ${t("MAILBOX.UNREAD", "ungelesen")}`;
      const meta = [item.main ? t("SETTINGS_DESK.MAIN", "Hauptkonto") : item.name, item.current ? t("SETTINGS_DESK.ACTIVE", "Aktiv") : "", unread].filter(Boolean).join(" · ");
      const index = extras.indexOf(item.email);
      const actions = [
        item.main ? "" : button("settings-move", t("SETTINGS_DESK.UP", "Nach oben"), { list: "accounts", dir: "up", email: item.email }),
        item.main ? "" : button("settings-move", t("SETTINGS_DESK.DOWN", "Nach unten"), { list: "accounts", dir: "down", email: item.email }),
        item.current ? "" : button("settings-switch", t("SETTINGS_DESK.SWITCH", "Wechseln"), { email: item.email }),
        item.main ? "" : button("settings-edit", t("SETTINGS_DESK.EDIT", "Bearbeiten"), { kind: "account", id: item.email }),
        item.main || !snap.caps.accounts ? "" : button("settings-import", t("SETTINGS_DESK.IMPORT", "Importieren"), { email: item.email }),
        item.main ? "" : button("settings-delete", t("GLOBAL.DELETE", "Löschen"), { kind: "account", email: item.email }, true)
      ].join("");
      const drag = item.main ? "" : ` draggable="true" data-sort="account" data-email="${esc(item.email)}" data-index="${index}"`;
      return `<li class="set-row"${drag}><span class="grow"><strong title="${esc(item.email)}">${esc(item.email)}</strong>${meta ? `<span class="quiet">${esc(meta)}</span>` : ""}</span>${actions}</li>`;
    }).join("");
    const editing = edit?.kind === "account" ? snap.accounts.find((item) => item.email === edit.id) : null;
    const editor = editing ? form("edit-account", `
      ${field(t("GLOBAL.EMAIL", "E-Mail"), "email", editing.email, "email", "readonly")}
      ${field(t("GLOBAL.NAME", "Name"), "name", editing.name)}
      ${field(t("GLOBAL.PASSWORD", "Passwort"), "password", "", "password", "autocomplete=\"new-password\"")}
      <p class="quiet">${esc(t("SETTINGS_DESK.PASSWORD_KEEP", "Leer lassen, um das Passwort zu behalten."))}</p>
    `, t("GLOBAL.SAVE", "Speichern"), true) : "";
    const add = snap.caps.accounts
      ? form("save-account", `
          ${field(t("GLOBAL.EMAIL", "E-Mail"), "email", "", "email", "autocomplete=\"email\" required")}
          ${field(t("GLOBAL.PASSWORD", "Passwort"), "password", "", "password", "autocomplete=\"current-password\" required")}
          ${field(t("GLOBAL.NAME", "Name"), "name", "")}
        `, t("POPUPS_ADD_ACCOUNT.BUTTON_ADD_ACCOUNT", "Hinzufügen"), false)
      : "";
    return `${error}<p class="mono">${esc(t("SETTINGS_ACCOUNTS.LEGEND_ACCOUNTS", "Konten"))}</p>${note(snap.notes.accounts, true)}<ul class="set-list">${rows}</ul>${add}${editor}`;
  }

  if (section === "identities") {
    const rows = snap.identities.map((item) => row(
      item.name || item.email || item.label,
      [item.email, item.label].filter(Boolean).join(" · "),
      [
        button("settings-move", t("SETTINGS_DESK.UP", "Nach oben"), { list: "identities", dir: "up", id: item.id }),
        button("settings-move", t("SETTINGS_DESK.DOWN", "Nach unten"), { list: "identities", dir: "down", id: item.id }),
        button("settings-edit", t("SETTINGS_DESK.EDIT", "Bearbeiten"), { kind: "identity", id: item.id }),
        item.id && snap.caps.identities ? button("settings-delete", t("GLOBAL.DELETE", "Löschen"), { kind: "identity", id: item.id }, true) : ""
      ].join("")
    ).replace("<li class=\"set-row\">", `<li class="set-row" draggable="true" data-sort="identity" data-id="${esc(item.id)}">`)).join("");
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
    const sync = snap.app.ContactsSync;
    if (!sync || typeof sync !== "object") return error + note(t("SETTINGS_DESK.UNAVAILABLE", "Nicht verfügbar."));
    const row = sync as { Mode?: unknown; Url?: unknown; User?: unknown; Password?: unknown };
    const mode = String(row.Mode ?? 0);
    const options = [
      ["0", t("GLOBAL.NO", "Nein")],
      ["1", t("GLOBAL.YES", "Ja")],
      ["2", t("SETTINGS_CONTACTS.SYNC_READ", "Nur lesend")]
    ].map(([id, label]) => `<option value="${id}"${id === mode ? " selected" : ""}>${esc(label)}</option>`).join("");
    const password = String(row.Password || "");
    return `${error}<p class="mono">${esc(t("SETTINGS_CONTACTS.LEGEND_CONTACTS_SYNC", "Remote-Synchronisierung (CardDAV)"))}</p>${note(snap.notes.contacts, true)}
      <form class="fields" data-action="settings-form" data-kind="save-sync">
        <label class="field"><span>${esc(t("SETTINGS_CONTACTS.LABEL_CONTACTS_SYNC_ENABLE", "Remote-Synchronisierung aktivieren"))}</span><select name="Mode">${options}</select></label>
        ${field(t("SETTINGS_CONTACTS.LABEL_CONTACTS_SYNC_AB_URL", "Adressbuch-URL"), "Url", String(row.Url || ""), "url", "autocomplete=\"off\" inputmode=\"url\"")}
        ${field(t("SETTINGS_CONTACTS.LABEL_CONTACTS_SYNC_USER", "Benutzer"), "User", String(row.User || ""), "text", "autocomplete=\"username\"")}
        ${field(t("GLOBAL.PASSWORD", "Passwort"), "Password", password, "password", "autocomplete=\"new-password\"")}
        ${password === "********" ? `<p class="quiet">${esc(t("SETTINGS_CONTACTS.PASSWORD_KEEP", "Acht Sterne stehen für das gespeicherte Passwort."))}</p>` : ""}
      </form>
      <div class="dialog-actions">
        <button type="button" class="text-btn" data-action="test-sync">${icon("check")}<span class="btn-label">${esc(t("GLOBAL.TEST", "Testen"))}</span></button>
        <button type="button" class="text-btn" data-action="sync-now"${mode === "0" ? " hidden" : ""}>${icon("refresh")}<span class="btn-label">${esc(t("CONTACTS.SYNC_NOW", "Jetzt synchronisieren"))}</span></button>
      </div>
      <p class="quiet">${esc(t("SETTINGS_CONTACTS.SYNC_HINT", "Änderungen werden beim Verlassen des Feldes gespeichert. Das Adressbuch selbst liegt in der Seitenleiste."))}</p>`;
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
    const source = current?.body || "";
    const parsed = parseFilterScript(source);
    const editor = adding ? form("save-script", `
      ${field(t("GLOBAL.NAME", "Name"), "name", current?.name || "", "text", current ? "readonly" : "required")}
      ${renderFilterEditor(current?.name || "", source, parsed.ok ? parsed.script : null, parsed.ok ? "" : parsed.reason, snap.folderNames, snap.sieveCapa.includes("vacation"), snap.sieveCapa)}
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
