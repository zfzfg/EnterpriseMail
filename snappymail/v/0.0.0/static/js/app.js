// src/assistant.ts
function on(admin, user, providers, name, route = "default") {
  if (!admin[name]) return false;
  if (user.features && user.features[name] === false) return false;
  const provider = providers[route] || providers.default;
  if (provider && provider.ready === false && name !== "triage" && name !== "alerts") return false;
  return true;
}
async function readAssist(app, load) {
  const plugins = app.Plugins;
  const section = plugins?.["ai-copilot"];
  if (!section) return null;
  const admin = section.features || {};
  const providers = section.providers || {};
  let settings = { enabled: true, notice_ack: false };
  try {
    settings = await load();
  } catch {
    return null;
  }
  if (settings.enabled === false) return null;
  const flags = {
    summarize: on(admin, settings, providers, "summarize"),
    draft: on(admin, settings, providers, "draft"),
    replies: on(admin, settings, providers, "quick_replies"),
    search: on(admin, settings, providers, "search", "search"),
    triage: on(admin, settings, providers, "triage"),
    triageLlm: Boolean(admin.triage) && settings.features?.triage !== false && on(admin, settings, providers, "triage_llm", "triage"),
    chat: on(admin, settings, providers, "chat", "chat"),
    alerts: on(admin, settings, providers, "alerts"),
    provider: "",
    providerName: String(providers.default?.name || ""),
    noticeAck: Boolean(settings.notice_ack)
  };
  const label2 = providers.default;
  flags.provider = label2 ? `${label2.local ? "LOKAL" : String(label2.name || "").toUpperCase()}${label2.model ? " \xB7 " + label2.model : ""}` : "";
  const active = flags.summarize || flags.draft || flags.replies || flags.search || flags.triage || flags.triageLlm || flags.chat || flags.alerts;
  if (!active) return null;
  return flags;
}

// src/api.ts
var ApiError = class extends Error {
  code;
  detail;
  constructor(code, message, detail = "") {
    super(message);
    this.code = code;
    this.detail = detail;
  }
};
var token = "";
function root() {
  return location.pathname.replace(/\/+$/, "") + "/";
}
function explain(error) {
  if (!(error instanceof ApiError)) return "Die Anfrage ist fehlgeschlagen.";
  const known = {
    101: "Die Sitzung ist abgelaufen. Seite neu laden.",
    102: "Anmeldung fehlgeschlagen. Adresse oder Passwort pr\xFCfen.",
    104: "Der Mailserver ist nicht erreichbar.",
    109: "Diese Domain ist nicht erlaubt.",
    110: "Dieses Konto ist nicht erlaubt.",
    201: "Die Liste konnte nicht geladen werden.",
    202: "Der Brief konnte nicht geladen werden.",
    203: "L\xF6schen ist fehlgeschlagen.",
    204: "Verschieben ist fehlgeschlagen.",
    302: "Senden ist fehlgeschlagen.",
    303: "Empf\xE4nger pr\xFCfen.",
    901: "Der Mailserver hat die Anfrage abgelehnt."
  };
  const text2 = known[error.code] || error.message || "Die Anfrage ist fehlgeschlagen.";
  return error.detail ? `${text2} ${error.detail}` : text2;
}
async function readApp(url) {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) throw new ApiError(1, "Die Anwendung konnte nicht geladen werden.");
  const data = await response.json();
  const system = data.System;
  if (system?.token) token = system.token;
  return data;
}
function loadApp() {
  return readApp(`${root()}?/AppData/0/${Math.random().toString().slice(2)}/`);
}
async function postJson(url, action, params) {
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
  const data = await response.json();
  if (data.System?.token) token = data.System.token;
  const result = data.Result;
  if (result && typeof result === "object" && result.System?.token) token = result.System.token;
  if (data.Result === false || data.Result == null) {
    throw new ApiError(data.code || 999, data.message || "", data.messageAdditional || "");
  }
  return data.Result;
}
function call(action, params = {}) {
  return postJson(`${root()}?/Json/&q[]=/0/`, action, params);
}
async function plugin(action, params = {}) {
  const result = await call("Plugin" + action, params);
  if (result && typeof result === "object" && "error" in result && result.error) {
    throw new ApiError(Number(result.status) || 999, String(result.error));
  }
  return result;
}
async function streamEvents(path, params, onEvent, signal) {
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
  for (; ; ) {
    const chunk = await reader.read();
    buffer += chunk.value ? decoder.decode(chunk.value, { stream: !chunk.done }) : "";
    const blocks = buffer.split(/\n\n/);
    buffer = blocks.pop() || "";
    for (const block of blocks) {
      let event = "message";
      const data = [];
      block.split(/\n/).forEach((line) => {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trim());
      });
      if (data.length) onEvent(event, JSON.parse(data.join("\n")));
    }
    if (chunk.done) break;
  }
}
function downloadUrl(file) {
  const json = JSON.stringify(file);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  const hash = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${root()}?/Raw/&q[]=/0/Download/&q[]=/${hash}`;
}

// src/i18n.ts
function dig(bag, path) {
  let cur = bag;
  for (const part of path.split(".")) {
    if (!cur || typeof cur !== "object" || !(part in cur)) return void 0;
    cur = cur[part];
  }
  return typeof cur === "string" ? cur : void 0;
}
function t(path, fallback) {
  const bag = window.rl?.I18N;
  return dig(bag, path) ?? fallback;
}

// src/theme.ts
var KEY = "sm-appearance";
function readAppearance() {
  try {
    const value = localStorage.getItem(KEY);
    if (value === "light" || value === "dark" || value === "system") return value;
  } catch {
  }
  return "system";
}
function applyAppearance(mode) {
  const dark = mode === "dark" || mode !== "light" && matchMedia("(prefers-color-scheme: dark)").matches;
  const root3 = document.documentElement;
  root3.dataset.appearance = mode;
  root3.classList.toggle("dark", dark);
  root3.style.colorScheme = dark ? "dark" : "light";
  try {
    localStorage.setItem(KEY, mode);
  } catch {
  }
}
function watchSystemTheme(onChange) {
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", onChange);
}

// src/settings.ts
function readCaps(data) {
  const capa = data.Capa && typeof data.Capa === "object" ? data.Capa : {};
  return {
    accounts: Boolean(capa.AdditionalAccounts),
    identities: Boolean(capa.Identities),
    contacts: Boolean(capa.Contacts),
    sieve: Boolean(capa.Sieve),
    openpgp: Boolean(capa.OpenPGP),
    gnupg: Boolean(capa.GnuPG)
  };
}
function values(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}
function text(value) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}
function propText(card, names) {
  if (!Array.isArray(card) || !Array.isArray(card[1])) return "";
  const wanted = new Set(names);
  for (const row2 of card[1]) {
    if (!Array.isArray(row2) || !wanted.has(String(row2[0]).toLowerCase())) continue;
    const value = row2[3];
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
      return value.map((part) => typeof part === "string" ? part : "").filter(Boolean).join(" ");
    }
  }
  return "";
}
function writeProp(card, name, value) {
  const rows = Array.isArray(card) && card[0] === "vcard" && Array.isArray(card[1]) ? card[1].map((row2) => Array.isArray(row2) ? row2.slice() : row2) : [["version", {}, "text", "4.0"]];
  const index = rows.findIndex((row2) => Array.isArray(row2) && String(row2[0]).toLowerCase() === name);
  const next = [name, {}, "text", value];
  if (index >= 0) rows[index] = next;
  else rows.push(next);
  const extra = Array.isArray(card) && Array.isArray(card[2]) ? [card[2]] : [];
  return ["vcard", rows, ...extra];
}
function identityOf(item) {
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
function keyRow(armored) {
  const head = armored.split("\n")[0] || "";
  const kind = /PRIVATE/i.test(head) ? t("SETTINGS_OPENPGP.TITLE_PRIVATE", "Privat") : /PUBLIC/i.test(head) ? t("SETTINGS_OPENPGP.TITLE_PUBLIC", "\xD6ffentlich") : t("SETTINGS_DESK.KEYS", "Schl\xFCssel");
  const body = armored.replace(/-----.*?-----/g, "").replace(/\s+/g, "");
  return { kind, preview: body.slice(0, 32) };
}
async function tryCall(action, params = {}) {
  try {
    return { value: await call(action, params), error: "" };
  } catch (error) {
    return { value: null, error: explain(error) };
  }
}
async function loadDesk(caps, currentEmail, mainEmail, contactSearch = "") {
  const main = mainEmail || currentEmail;
  const snap = {
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
  const desk = await tryCall("AccountsAndIdentities");
  if (desk.error) snap.notes.accounts = desk.error;
  else if (desk.value) {
    const extra = values(desk.value.Accounts).map((item) => {
      const row2 = item;
      const email = text(row2.email);
      return { email, name: text(row2.name), current: email === currentEmail, main: false };
    }).filter((row2) => row2.email && row2.email !== main);
    snap.accounts = snap.accounts.concat(extra);
    snap.identities = values(desk.value.Identities).map((item) => identityOf(item));
    const named = snap.identities.find((item) => item.email === main && item.name);
    if (named) snap.accounts[0].name = named.name;
  }
  if (caps.contacts) {
    const book = await tryCall("Contacts", { Search: contactSearch, Offset: 0, Limit: 50 });
    if (book.error) snap.notes.contacts = book.error;
    else if (book.value) {
      snap.contactCount = Number(book.value.Count || 0);
      snap.contacts = values(book.value.List).map((item) => {
        const row2 = item;
        return {
          id: text(row2.id),
          name: propText(row2.jCard, ["fn", "n"]),
          email: propText(row2.jCard, ["email"]),
          readOnly: Boolean(row2.readOnly),
          jCard: row2.jCard
        };
      });
    }
  }
  if (caps.sieve) {
    const filters = await tryCall("Filters");
    if (filters.error) snap.notes.filters = filters.error;
    else if (filters.value) {
      snap.scripts = values(filters.value.Scripts).map((item) => {
        const row2 = item;
        return { name: text(row2.name), active: Boolean(row2.active), body: text(row2.body) };
      }).filter((row2) => row2.name);
    }
  }
  const keys = await tryCall("GetPGPKeys");
  if (keys.error) snap.notes.keys = keys.error;
  else snap.keys = values(keys.value).map((item) => text(item)).filter(Boolean).map((item) => keyRow(item));
  const certs = await tryCall("SMimeGetCertificates");
  if (certs.error) snap.notes.certs = certs.error;
  else {
    snap.certs = values(certs.value).map((item) => {
      const row2 = item;
      const until = Number(row2.validTo_time_t || 0);
      return {
        id: text(row2.id),
        name: text(row2.CN),
        email: text(row2.emailAddress),
        until: until ? new Date(until * 1e3).toLocaleDateString() : ""
      };
    });
  }
  return snap;
}
async function applyDesk(name, data, snap) {
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
    if (!data.key?.trim()) throw new ApiError(0, "Schl\xFCssel einf\xFCgen.");
    if (!data.backup && !data.gnupg) throw new ApiError(0, "Speicherort w\xE4hlen.");
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
    if (!data.pem?.trim()) throw new ApiError(0, "Zertifikat einf\xFCgen.");
    await call("SMimeImportCertificate", { pem: data.pem });
    return "reload";
  }
  return "reload";
}
function esc(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char] ?? char);
}
function field(label2, name, value, type = "text", extra = "") {
  const control = type === "area" ? `<textarea name="${name}" class="${extra}">${esc(value)}</textarea>` : `<input name="${name}" type="${type}" value="${esc(value)}" ${extra}>`;
  return `<label class="field"><span>${esc(label2)}</span>${control}</label>`;
}
function check(name, label2, on2) {
  return `<label class="check"><input type="checkbox" name="${name}"${on2 ? " checked" : ""}> ${esc(label2)}</label>`;
}
function button(action, label2, attrs, danger = false) {
  const extra = Object.entries(attrs).map(([key, value]) => ` data-${key}="${esc(value)}"`).join("");
  return `<button type="button" class="${danger ? "danger" : "text-btn"}" data-action="${action}"${extra}>${esc(label2)}</button>`;
}
function row(title, meta, actions) {
  return `<li class="set-row"><span class="grow"><strong title="${esc(title)}">${esc(title)}</strong>${meta ? `<span class="quiet">${esc(meta)}</span>` : ""}</span>${actions}</li>`;
}
function form(kind, inner, submit, cancel) {
  const back = cancel ? `<button type="button" class="text-btn" data-action="settings-cancel">${esc(t("GLOBAL.CANCEL", "Abbrechen"))}</button>` : "";
  return `<form class="fields" data-action="settings-form" data-kind="${kind}">${inner}<div class="dialog-actions">${back}<button type="submit" class="ink-btn">${esc(submit)}</button></div></form>`;
}
function note(textValue, error = false) {
  if (!textValue) return "";
  return `<p class="${error ? "error" : "quiet"}">${esc(textValue)}</p>`;
}
function loading() {
  return `<p class="quiet">${esc(t("GLOBAL.LOADING", "Wird geladen"))} \u2026</p>`;
}
var blankIdentity = () => ({
  id: "",
  label: "",
  email: "",
  name: "",
  replyTo: "",
  bcc: "",
  signature: "",
  signatureInsertBefore: false,
  sentFolder: "",
  pgpEncrypt: false,
  pgpSign: false,
  smimeKey: "",
  smimeCertificate: "",
  smimeCertificateChain: ""
});
function identityForm(item, caps) {
  const crypto = caps.openpgp || caps.gnupg ? `${check("pgpSign", t("CRYPTO.SIGN", "Unterschreiben"), item.pgpSign)}${check("pgpEncrypt", t("CRYPTO.ENCRYPT", "Verschl\xFCsseln"), item.pgpEncrypt)}` : "";
  const smimeOpen = item.smimeCertificate || item.smimeKey || item.smimeCertificateChain ? " open" : "";
  return form("save-identity", `
    <input type="hidden" name="id" value="${esc(item.id)}">
    ${field(t("POPUPS_IDENTITY.LABEL", "Label"), "label", item.label)}
    ${field(t("GLOBAL.NAME", "Name"), "name", item.name)}
    ${field(t("GLOBAL.EMAIL", "E-Mail"), "email", item.email, "email", 'autocomplete="email" required')}
    ${field(t("GLOBAL.REPLY_TO", "Antwort an"), "replyTo", item.replyTo, "email", 'autocomplete="email"')}
    ${field(t("GLOBAL.BCC", "BCC"), "bcc", item.bcc)}
    ${field(t("SETTINGS_DESK.SENT_FOLDER", "Ordner f\xFCr Gesendet"), "sentFolder", item.sentFolder)}
    ${field(t("POPUPS_IDENTITY.SIGNATURE", "Signatur"), "signature", item.signature, "area", "short")}
    ${check("signatureInsertBefore", t("POPUPS_IDENTITY.LABEL_SIGNATURE_INSERT_BEFORE", "Diese Signatur in Antworten vor dem zitierten Text einf\xFCgen"), item.signatureInsertBefore)}
    ${crypto}
    <details${smimeOpen}>
      <summary>${esc(t("SMIME.CERTIFICATES", "S/MIME-Zertifikate"))}</summary>
      ${field(t("SMIME.CERTIFICATE", "Zertifikat"), "smimeCertificate", item.smimeCertificate, "area", "code")}
      ${field(t("CRYPTO.PRIVATE_KEY", "Privater Schl\xFCssel"), "smimeKey", item.smimeKey, "area", "code")}
      ${field(t("SMIME.CERTIFICATECHAIN", "Zwischenzertifikat(e)"), "smimeCertificateChain", item.smimeCertificateChain, "area", "code")}
    </details>
  `, t("GLOBAL.SAVE", "Speichern"), true);
}
function lookSection() {
  const current = readAppearance();
  const choice = (value, label2) => `<label class="check"><input type="radio" name="appearance" value="${value}"${current === value ? " checked" : ""}> ${label2}</label>`;
  return `
    <p class="mono">${esc(t("SETTINGS_DESK.APPEARANCE", "Erscheinungsbild"))}</p>
    <fieldset class="choices">
      ${choice("system", t("SETTINGS_DESK.SYSTEM", "System"))}
      ${choice("light", t("SETTINGS_DESK.LIGHT", "Hell"))}
      ${choice("dark", t("SETTINGS_DESK.DARK", "Dunkel"))}
    </fieldset>`;
}
function renderDesk(section, snap, edit) {
  const error = `<p class="error" id="settings-error" hidden></p>`;
  if (section === "look") return error + lookSection();
  if (!snap) return error + loading();
  if (section === "accounts") {
    const rows = snap.accounts.map((item) => {
      const meta = [item.main ? t("SETTINGS_DESK.MAIN", "Hauptkonto") : item.name, item.current ? t("SETTINGS_DESK.ACTIVE", "Aktiv") : ""].filter(Boolean).join(" \xB7 ");
      const actions = [
        item.current ? "" : button("settings-switch", t("SETTINGS_DESK.SWITCH", "Wechseln"), { email: item.email }),
        item.main ? "" : button("settings-delete", t("GLOBAL.DELETE", "L\xF6schen"), { kind: "account", email: item.email }, true)
      ].join("");
      return row(item.email, meta, actions);
    }).join("");
    const add = snap.caps.accounts ? form("save-account", `
          ${field(t("GLOBAL.EMAIL", "E-Mail"), "email", "", "email", 'autocomplete="email" required')}
          ${field(t("GLOBAL.PASSWORD", "Passwort"), "password", "", "password", 'autocomplete="current-password" required')}
          ${field(t("GLOBAL.NAME", "Name"), "name", "")}
        `, t("POPUPS_ADD_ACCOUNT.BUTTON_ADD_ACCOUNT", "Hinzuf\xFCgen"), false) : "";
    return `${error}<p class="mono">${esc(t("SETTINGS_ACCOUNTS.LEGEND_ACCOUNTS", "Konten"))}</p>${note(snap.notes.accounts, true)}<ul class="set-list">${rows}</ul>${add}`;
  }
  if (section === "identities") {
    const rows = snap.identities.map((item) => row(
      item.name || item.email || item.label,
      [item.email, item.label].filter(Boolean).join(" \xB7 "),
      [
        button("settings-edit", t("SETTINGS_DESK.EDIT", "Bearbeiten"), { kind: "identity", id: item.id }),
        item.id && snap.caps.identities ? button("settings-delete", t("GLOBAL.DELETE", "L\xF6schen"), { kind: "identity", id: item.id }, true) : ""
      ].join("")
    )).join("");
    const adding = edit?.kind === "identity";
    const current = edit?.kind === "identity" ? edit.fresh ? blankIdentity() : snap.identities.find((item) => item.id === edit.id) || blankIdentity() : null;
    const editor = current ? identityForm(current, snap.caps) : "";
    const add = snap.caps.identities && !adding ? button("settings-edit", t("SETTINGS_ACCOUNTS.BUTTON_ADD_IDENTITY", "Identit\xE4t hinzuf\xFCgen"), { kind: "identity", fresh: "1" }) : "";
    return `${error}<p class="mono">${esc(t("SETTINGS_ACCOUNTS.LEGEND_IDENTITIES", "Identit\xE4ten"))}</p>${note(snap.notes.accounts, true)}<ul class="set-list">${rows || ""}</ul>${rows ? "" : note(t("SETTINGS_DESK.EMPTY", "Nichts vorhanden."))}${add}${editor}`;
  }
  if (section === "contacts") {
    if (!snap.contacts) return error + note(t("SETTINGS_DESK.UNAVAILABLE", "Nicht verf\xFCgbar."));
    const rows = snap.contacts.map((item) => row(
      item.name || item.email || item.id,
      item.name ? item.email : "",
      item.readOnly ? "" : [
        button("settings-edit", t("SETTINGS_DESK.EDIT", "Bearbeiten"), { kind: "contact", id: item.id }),
        button("settings-delete", t("GLOBAL.DELETE", "L\xF6schen"), { kind: "contact", id: item.id }, true)
      ].join("")
    )).join("");
    const search = form("search-contacts", field(t("GLOBAL.SEARCH", "Suchen"), "search", snap.contactSearch, "search"), t("GLOBAL.SEARCH", "Suchen"), false);
    const adding = edit?.kind === "contact";
    const current = edit?.kind === "contact" && !edit.fresh ? snap.contacts.find((item) => item.id === edit.id) : null;
    const editor = adding ? form("save-contact", `
      <input type="hidden" name="id" value="${esc(current?.id || "")}">
      ${field(t("CONTACTS.DISPLAY_NAME", "Anzeigename"), "name", current?.name || "")}
      ${field(t("GLOBAL.EMAIL", "E-Mail"), "email", current?.email || "", "email", 'autocomplete="email"')}
    `, t("GLOBAL.SAVE", "Speichern"), true) : "";
    const more = snap.contactCount > snap.contacts.length ? note(`${snap.contacts.length} / ${snap.contactCount}`) : "";
    const add = adding ? "" : button("settings-edit", t("CONTACTS.BUTTON_ADD_CONTACT", "Kontakt hinzuf\xFCgen"), { kind: "contact", fresh: "1" });
    return `${error}<p class="mono">${esc(t("SETTINGS_LABELS.CONTACTS", "Kontakte"))}</p>${note(snap.notes.contacts, true)}${search}<ul class="set-list">${rows}</ul>${rows ? "" : note(snap.contactSearch ? t("CONTACTS.EMPTY_SEARCH", "Keine Kontakte gefunden") : t("CONTACTS.EMPTY_LIST", "Keine Kontakte"))}${more}${add}${editor}`;
  }
  if (section === "filters") {
    if (!snap.scripts) return error + note(t("SETTINGS_DESK.UNAVAILABLE", "Nicht verf\xFCgbar."));
    const rows = snap.scripts.map((item) => row(
      item.name,
      item.active ? t("SETTINGS_DESK.ACTIVE", "Aktiv") : "",
      [
        item.active ? "" : button("settings-activate", t("SETTINGS_DESK.ACTIVATE", "Aktivieren"), { name: item.name }),
        button("settings-edit", t("SETTINGS_DESK.EDIT", "Bearbeiten"), { kind: "script", id: item.name }),
        button("settings-delete", t("GLOBAL.DELETE", "L\xF6schen"), { kind: "script", name: item.name }, true)
      ].join("")
    )).join("");
    const adding = edit?.kind === "script";
    const current = edit?.kind === "script" && !edit.fresh ? snap.scripts.find((item) => item.name === edit.id) : null;
    const editor = adding ? form("save-script", `
      ${field(t("GLOBAL.NAME", "Name"), "name", current?.name || "", "text", current ? "readonly" : "required")}
      ${field(t("SETTINGS_DESK.SCRIPT", "Skript"), "body", current?.body || "", "area", "code")}
    `, t("GLOBAL.SAVE", "Speichern"), true) : "";
    const add = adding ? "" : button("settings-edit", t("SETTINGS_FILTERS.BUTTON_ADD_SCRIPT", "Skript hinzuf\xFCgen"), { kind: "script", fresh: "1" });
    return `${error}<p class="mono">${esc(t("SETTINGS_LABELS.FILTERS", "Filter"))}</p>${note(snap.notes.filters, true)}<ul class="set-list">${rows}</ul>${rows ? "" : note(t("SETTINGS_DESK.EMPTY", "Nichts vorhanden."))}${add}${editor}`;
  }
  const keyRows = snap.keys.map((item) => row(item.kind, item.preview, "")).join("");
  const certRows = snap.certs.map((item) => row(
    item.name || item.email || item.id,
    [item.email, item.until ? `${t("CRYPTO.VALID_UNTIL", "G\xFCltig bis")} ${item.until}` : ""].filter(Boolean).join(" \xB7 "),
    ""
  )).join("");
  const keyImport = form("import-key", `
    ${field(t("SETTINGS_OPENPGP.BUTTON_IMPORT_KEY", "Schl\xFCssel importieren"), "key", "", "area", "code")}
    ${field(t("GLOBAL.EMAIL", "E-Mail"), "email", "", "email", 'autocomplete="email"')}
    ${check("backup", t("OPENPGP.BACKUP_ON_SERVER", "Auf dem Server verschl\xFCsselt speichern"), true)}
    ${snap.caps.gnupg ? check("gnupg", t("OPENPGP.STORE_IN_GNUPG", "Auf dem Server in GnuPG speichern"), false) : ""}
  `, t("OPENPGP.POPUP_IMPORT_BUTTON", "Importieren"), false);
  const certImport = form("import-cert", `
    ${field(t("SMIME.CERTIFICATE", "Zertifikat"), "pem", "", "area", "code")}
  `, t("OPENPGP.POPUP_IMPORT_BUTTON", "Importieren"), false);
  return `${error}
    <p class="mono">${esc(t("SETTINGS_DESK.KEYS", "Schl\xFCssel"))}</p>
    <p class="quiet">${esc(t("SETTINGS_DESK.KEY_HINT", "Signieren und Verschl\xFCsseln stehen an der Identit\xE4t."))}</p>
    ${note(snap.notes.keys, true)}
    <ul class="set-list">${keyRows}</ul>
    ${keyRows ? "" : note(t("SETTINGS_DESK.EMPTY", "Nichts vorhanden."))}
    <details><summary>${esc(t("SETTINGS_OPENPGP.BUTTON_IMPORT_KEY", "Schl\xFCssel importieren"))}</summary>${keyImport}</details>
    <p class="mono">${esc(t("SMIME.CERTIFICATES", "S/MIME-Zertifikate"))}</p>
    ${note(snap.notes.certs, true)}
    <ul class="set-list">${certRows}</ul>
    ${certRows ? "" : note(t("SETTINGS_DESK.EMPTY", "Nichts vorhanden."))}
    <details><summary>${esc(t("SMIME.POPUP_IMPORT_TITLE", "S/MIME-Zertifikat importieren"))}</summary>${certImport}</details>`;
}

// src/icons.ts
var svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true">${body}</svg>`;
var iconMenu = svg(
  `<rect x="5" y="5" width="4" height="4"/><rect x="13" y="5" width="4" height="4"/><rect x="21" y="5" width="4" height="4"/><rect x="5" y="13" width="4" height="4"/><rect x="13" y="13" width="4" height="4"/><rect x="21" y="13" width="4" height="4"/><rect x="5" y="21" width="4" height="4"/><rect x="13" y="21" width="4" height="4"/><rect x="21" y="21" width="4" height="4"/>`
);
var iconClose = svg(
  `<rect x="5" y="5" width="4" height="4"/><rect x="21" y="5" width="4" height="4"/><rect x="9" y="9" width="4" height="4"/><rect x="17" y="9" width="4" height="4"/><rect x="13" y="13" width="4" height="4"/><rect x="9" y="17" width="4" height="4"/><rect x="17" y="17" width="4" height="4"/><rect x="5" y="21" width="4" height="4"/><rect x="21" y="21" width="4" height="4"/>`
);

// src/view.ts
var CATEGORY = {
  needs_reply: "Antwort n\xF6tig",
  personal: "F\xFCr mich",
  newsletter: "Newsletter",
  notification: "Benachrichtigungen",
  invoice: "Rechnungen"
};
function categoryMark(category) {
  if (!category || !CATEGORY[category]) return "";
  const mark = category === "needs_reply" ? `<i class="wait" aria-hidden="true"></i>` : "";
  return `<span class="cat">${mark}${esc2(t("AI_COPILOT.CAT_" + category.toUpperCase(), CATEGORY[category]))}</span>`;
}
function esc2(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char] ?? char);
}
function createView(root3, actions) {
  let shell = null;
  let opener = null;
  let section = "look";
  let edit = null;
  let snap = null;
  const wide = () => matchMedia("(min-width: 800px)").matches;
  const docked = () => matchMedia("(min-width: 1280px)").matches;
  const showLogin = (title) => {
    document.title = title;
    root3.innerHTML = `
      <main class="login">
        <form class="login-card" novalidate>
          <h1 class="title">${esc2(title)}</h1>
          <label class="field"><span>${esc2(t("GLOBAL.EMAIL", "E-Mail"))}</span>
            <input name="email" type="email" autocomplete="email" inputmode="email" required>
          </label>
          <p class="error" data-for="email" hidden></p>
          <label class="field"><span>${esc2(t("GLOBAL.PASSWORD", "Passwort"))}</span>
            <input name="password" type="password" autocomplete="current-password" required>
          </label>
          <p class="error" data-for="password" hidden></p>
          <label class="stay"><input name="stay" type="checkbox"> ${esc2(t("LOGIN.LABEL_SIGN_ME", "Anmeldung merken"))}</label>
          <p class="error" data-for="form" hidden></p>
          <button type="submit" class="ink-btn">${esc2(t("LOGIN.BUTTON_SIGN_IN", "Anmelden"))}</button>
        </form>
      </main>`;
    const form2 = root3.querySelector("form");
    form2.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form2);
      actions.login(String(data.get("email") || ""), String(data.get("password") || ""), data.get("stay") === "on");
    });
  };
  const setLoginBusy = (busy) => {
    const button2 = root3.querySelector(".login-card button");
    if (button2) button2.disabled = busy;
  };
  const setLoginError = (text2) => {
    const slot = root3.querySelector("[data-for='form']");
    if (!slot) return;
    slot.hidden = !text2;
    slot.textContent = text2;
  };
  const showMail = (email, folderName, assist) => {
    root3.innerHTML = `
      <div class="shell" data-pane="list" data-sidebar="${docked() ? "open" : "closed"}">
        <button type="button" class="scrim" data-action="close-sidebar" aria-label="Ordner schlie\xDFen"></button>
        <aside class="sidebar" aria-label="Ordner">
          <div class="account">
            <button type="button" class="account-btn" data-action="account" aria-expanded="false" aria-controls="account-menu" aria-haspopup="menu"></button>
            <div class="menu" id="account-menu" role="menu" hidden>
              <button type="button" class="menu-item" role="menuitem" data-action="settings">${esc2(t("GLOBAL.SETTINGS", "Einstellungen"))}</button>
              <button type="button" class="menu-item" role="menuitem" data-action="logout">${esc2(t("GLOBAL.LOGOUT", "Abmelden"))}</button>
            </div>
          </div>
          <p class="group-label mono">${esc2(t("FOLDER_LIST.INBOX_NAME", "Posteingang"))}</p>
          <div id="folder-inbox"></div>
          <p class="group-label mono">Ordner</p>
          <div id="folder-rest"></div>
        </aside>
        <section class="list-pane" aria-label="Mails">
          <div class="pane-head">
            <button type="button" class="icon-btn" data-action="toggle-sidebar" aria-label="Ordner ein- oder ausblenden">${iconMenu}</button>
            <h1 class="title title-md" id="folder-title"></h1>
          </div>
          <form class="search-wrap" data-action="search">
            <label class="sr" for="search">Suche</label>
            <input class="search" id="search" type="search" placeholder="" autocomplete="off">
          </form>
          <div class="pane-body" id="list-body">
            <div id="rows"></div>
            <p class="empty" id="list-empty" hidden></p>
            <button type="button" class="text-btn" data-action="clear-search" hidden>Suche aufheben</button>
            <button type="button" class="text-btn" data-action="more" hidden>Weitere</button>
            <p class="error" id="list-error" hidden></p>
          </div>
        </section>
        <div class="splitter" role="separator" aria-orientation="vertical" aria-label="Breite der Liste" tabindex="0" aria-valuemin="288" aria-valuemax="640" aria-valuenow="384"></div>
        <section class="reader" aria-label="Brief">
          <div class="reader-bar">
            <button type="button" class="text-btn" data-action="back" hidden>${esc2(t("GLOBAL.BACK", "Zur\xFCck"))}</button>
            <span class="quiet" id="reader-place"></span>
            <span class="spacer"></span>
            <button type="button" class="text-btn" data-action="reply" hidden>${esc2(t("MESSAGE.BUTTON_REPLY", "Antworten"))}</button>
            <button type="button" class="text-btn" data-action="reply-all" hidden>${esc2(t("MESSAGE.BUTTON_REPLY_ALL", "Allen antworten"))}</button>
            <button type="button" class="text-btn" data-action="forward" hidden>${esc2(t("MESSAGE.BUTTON_FORWARD", "Weiterleiten"))}</button>
            <button type="button" class="text-btn" data-action="archive" hidden>${esc2(t("GLOBAL.TO_ARCHIVE", "Archivieren"))}</button>
            <button type="button" class="text-btn" data-action="unread" hidden>Ungelesen</button>
            <button type="button" class="text-btn" data-action="delete" hidden>${esc2(t("GLOBAL.DELETE", "L\xF6schen"))}</button>
          </div>
          <p class="quiet live" id="notice"></p>
          <div class="pane-body" id="reader-body">
            <p class="empty" id="reader-empty">W\xE4hlen Sie eine Mail.</p>
          </div>
        </section>
        <section class="composer" hidden aria-label="Neue Mail">
          <form class="composer-form">
            <div class="composer-bar">
              <button type="button" class="icon-btn" data-action="close-compose" aria-label="${esc2(t("GLOBAL.CLOSE", "Schlie\xDFen"))}">${iconClose}</button>
              <span class="title title-md" id="compose-title">Neue Mail</span>
              <span class="spacer"></span>
              <button type="submit" class="ink-btn">${esc2(t("COMPOSE.BUTTON_SEND", "Senden"))}</button>
            </div>
            <div class="fields">
              <p class="quiet" id="compose-from"></p>
              <label class="field"><span>${esc2(t("GLOBAL.TO", "An"))}</span><input name="to" type="text" autocomplete="email"></label>
              <label class="field"><span>${esc2(t("GLOBAL.CC", "Cc"))}</span><input name="cc" type="text" autocomplete="email"></label>
              <label class="field"><span>${esc2(t("GLOBAL.SUBJECT", "Betreff"))}</span><input name="subject" type="text"></label>
              <label class="field"><span>Text</span><textarea name="body"></textarea></label>
              <p class="error" id="send-error" hidden></p>
            </div>
          </form>
        </section>
        <nav class="tabbar" aria-label="Navigation">
          <button type="button" class="text-btn" data-action="pane-folders">Ordner</button>
          <button type="button" class="text-btn" data-action="pane-search">Suche</button>
          <button type="button" class="ink-btn" data-action="compose">${esc2(t("FOLDER_LIST.BUTTON_NEW_MESSAGE", "Neue Nachricht"))}</button>
        </nav>
        <dialog id="settings" class="dialog-wide" aria-labelledby="settings-title">
          <div class="dialog-body">
            <div class="settings-sticky">
              <div class="sheet-head" style="padding:0;border:0;min-height:0">
                <h2 id="settings-title" class="title title-md">${esc2(t("GLOBAL.SETTINGS", "Einstellungen"))}</h2>
                <span class="spacer"></span>
                <button type="button" class="icon-btn" data-action="close-dialog" aria-label="${esc2(t("GLOBAL.CLOSE", "Schlie\xDFen"))}">${iconClose}</button>
              </div>
              <nav class="settings-nav" aria-label="${esc2(t("GLOBAL.SETTINGS", "Einstellungen"))}">
                <button type="button" class="text-btn" data-action="settings-section" data-section="look" aria-pressed="true">${esc2(t("SETTINGS_DESK.APPEARANCE", "Erscheinungsbild"))}</button>
                <button type="button" class="text-btn" data-action="settings-section" data-section="accounts">${esc2(t("SETTINGS_LABELS.ACCOUNTS", "Konten"))}</button>
                <button type="button" class="text-btn" data-action="settings-section" data-section="identities">${esc2(t("SETTINGS_ACCOUNTS.LEGEND_IDENTITIES", "Identit\xE4ten"))}</button>
                <button type="button" class="text-btn" data-action="settings-section" data-section="contacts" hidden>${esc2(t("SETTINGS_LABELS.CONTACTS", "Kontakte"))}</button>
                <button type="button" class="text-btn" data-action="settings-section" data-section="filters" hidden>${esc2(t("SETTINGS_LABELS.FILTERS", "Filter"))}</button>
                <button type="button" class="text-btn" data-action="settings-section" data-section="keys">${esc2(t("SETTINGS_DESK.KEYS", "Schl\xFCssel"))}</button>
              </nav>
            </div>
            <div id="settings-panel"></div>
          </div>
        </dialog>
        <dialog id="keys" aria-labelledby="keys-title">
          <div class="dialog-body">
            <div class="sheet-head" style="padding:0;border:0;min-height:0">
              <h2 id="keys-title" class="title title-md">Tasten</h2>
              <span class="spacer"></span>
              <button type="button" class="icon-btn" data-action="close-dialog" aria-label="${esc2(t("GLOBAL.CLOSE", "Schlie\xDFen"))}">${iconClose}</button>
            </div>
            <ul class="keys">
              <li><span>N\xE4chste, vorige Mail</span><kbd>J</kbd> <kbd>K</kbd></li>
              <li><span>\xD6ffnen</span><kbd>Enter</kbd></li>
              <li><span>Schreiben</span><kbd>C</kbd></li>
              <li><span>Antworten</span><kbd>R</kbd></li>
              <li><span>Archivieren</span><kbd>E</kbd></li>
              <li><span>L\xF6schen</span><kbd>#</kbd></li>
              <li><span>Seitenleiste</span><kbd>\\</kbd></li>
              <li><span>Schlie\xDFen</span><kbd>Esc</kbd></li>
              <li><span>Diese Liste</span><kbd>?</kbd></li>
            </ul>
          </div>
        </dialog>
        <dialog id="confirm" aria-labelledby="confirm-title">
          <div class="dialog-body">
            <h2 id="confirm-title" class="title title-md">Wirklich l\xF6schen?</h2>
            <div class="dialog-actions">
              <button type="button" class="text-btn" value="cancel">${esc2(t("GLOBAL.CANCEL", "Abbrechen"))}</button>
              <button type="button" class="danger" value="ok">${esc2(t("GLOBAL.DELETE", "L\xF6schen"))}</button>
            </div>
          </div>
        </dialog>
      </div>`;
    const next = root3.querySelector(".shell");
    if (!next) return;
    shell = next;
    const account = next.querySelector(".account-btn");
    account.textContent = email;
    next.querySelector("#compose-from").textContent = `${t("GLOBAL.FROM", "Von")} ${email}`;
    next.querySelector("#folder-title").textContent = folderName;
    next.querySelector("#reader-place").textContent = folderName;
    const search = next.querySelector("#search");
    search.placeholder = `In ${folderName} suchen`;
    wireShell();
    if (assist) installAssist(assist);
  };
  function pane(name) {
    if (!shell) return;
    shell.dataset.pane = name;
    const back = shell.querySelector("[data-action='back']");
    back.hidden = wide() || name !== "reader";
  }
  function setSidebar(open) {
    if (shell) shell.dataset.sidebar = open ? "open" : "closed";
  }
  function closeMenu() {
    const menu = shell?.querySelector("#account-menu");
    const button2 = shell?.querySelector("[data-action='account']");
    if (!menu || !button2) return;
    menu.hidden = true;
    button2.setAttribute("aria-expanded", "false");
  }
  function openLayer(layer, from) {
    opener = from;
    layer.hidden = false;
    layer.dataset.open = "false";
    requestAnimationFrame(() => {
      layer.dataset.open = "true";
    });
  }
  function closeLayer(layer) {
    layer.dataset.open = "false";
    const finish = () => {
      layer.hidden = true;
    };
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) finish();
    else layer.addEventListener("transitionend", finish, { once: true });
    opener?.focus();
    opener = null;
  }
  function wireShell() {
    if (!shell) return;
    const menu = shell.querySelector("#account-menu");
    const accountBtn = shell.querySelector("[data-action='account']");
    const list = shell.querySelector(".list-pane");
    const separator = shell.querySelector(".splitter");
    const composer = shell.querySelector(".composer");
    const setListWidth = (px) => {
      const next = Math.min(640, Math.max(288, Math.round(px)));
      shell?.style.setProperty("--list-w", `${next}px`);
      separator.setAttribute("aria-valuenow", String(next));
    };
    shell.addEventListener("click", (event) => {
      const target = event.target.closest("[data-action], [data-folder], [data-uid]");
      if (!menu.hidden && !target?.closest(".account")) closeMenu();
      if (!target) return;
      const action = target.dataset.action;
      if (target.dataset.folder) {
        actions.selectFolder(target.dataset.folder);
        if (!wide()) pane("list");
        if (!docked()) setSidebar(false);
      } else if (target.dataset.uid) {
        actions.selectMessage(Number(target.dataset.uid));
        if (!wide()) pane("reader");
      } else if (action === "toggle-sidebar") {
        if (!wide()) pane("folders");
        else setSidebar(shell?.dataset.sidebar !== "open");
      } else if (action === "close-sidebar") setSidebar(false);
      else if (action === "account") {
        const open = menu.hidden;
        menu.hidden = !open;
        accountBtn.setAttribute("aria-expanded", open ? "true" : "false");
      } else if (action === "settings") {
        closeMenu();
        section = "look";
        edit = null;
        snap = null;
        paintSettings();
        (shell?.querySelector("#settings")).showModal();
        void actions.settings?.("open", {});
      } else if (action === "settings-section") {
        section = target.dataset.section || "look";
        edit = null;
        paintSettings();
      } else if (action === "settings-edit") {
        edit = { kind: target.dataset.kind || "", id: target.dataset.id || "", fresh: target.dataset.fresh === "1" };
        paintSettings();
      } else if (action === "settings-cancel") {
        edit = null;
        paintSettings();
      } else if (action === "settings-delete" || action === "settings-switch" || action === "settings-activate") {
        const name = action === "settings-delete" ? `delete-${target.dataset.kind || ""}` : action === "settings-switch" ? "switch-account" : "activate-script";
        const payload = {
          id: target.dataset.id || "",
          email: target.dataset.email || "",
          name: target.dataset.name || ""
        };
        void (async () => {
          if (action === "settings-delete") {
            const dialog = shell?.querySelector("#confirm");
            if (!dialog) return;
            dialog.showModal();
            const ok = await new Promise((resolve) => {
              dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok"), { once: true });
            });
            if (!ok) return;
          }
          await actions.settings?.(name, payload);
        })();
      } else if (action === "logout") actions.logout();
      else if (action === "close-dialog") target.closest("dialog")?.close();
      else if (action === "search") {
      } else if (action === "clear-search") actions.clearSearch();
      else if (action === "more") actions.more();
      else if (action === "back") pane("list");
      else if (action === "pane-folders") pane("folders");
      else if (action === "pane-search") {
        pane("list");
        (shell?.querySelector("#search")).focus();
      } else if (action === "compose") actions.compose();
      else if (action === "reply") actions.reply(false);
      else if (action === "reply-all") actions.reply(true);
      else if (action === "forward") actions.forward();
      else if (action === "archive") actions.archive();
      else if (action === "unread") actions.unread();
      else if (action === "delete") actions.askDelete();
      else if (action === "close-compose") {
        closeLayer(composer);
        if (!wide()) pane("list");
        actions.closeCompose();
      } else if (action === "close-sheet") {
        const sheet = shell?.querySelector(".sheet");
        if (sheet) closeLayer(sheet);
      } else if (action === "open-sheet") {
        if (!wide()) pane("reader");
        const sheet = shell?.querySelector(".sheet");
        if (sheet) openLayer(sheet, target);
      } else if (action === "cat") {
        shell?.querySelectorAll(".filter").forEach((button2) => {
          button2.setAttribute("aria-pressed", button2.dataset.cat === target.dataset.cat ? "true" : "false");
        });
        actions.assist?.("cat", target.dataset);
      } else if (action === "mode" || action === "tone") {
        target.parentElement?.querySelectorAll("button").forEach((button2) => {
          button2.setAttribute("aria-pressed", button2 === target ? "true" : "false");
        });
      } else if (action === "prompt") {
        const area = shell?.querySelector("#ask");
        if (area) area.value = target.textContent || "";
        actions.assist?.("ask", { text: target.textContent || "" });
      } else if (action) actions.assist?.(action, target.dataset);
    });
    shell.addEventListener("submit", (event) => {
      const form2 = event.target;
      if (form2.classList.contains("composer-form")) {
        event.preventDefault();
        const data = new FormData(form2);
        actions.send({
          title: "",
          to: String(data.get("to") || ""),
          cc: String(data.get("cc") || ""),
          subject: String(data.get("subject") || ""),
          body: String(data.get("body") || "")
        });
      } else if (form2.dataset.action === "search") {
        event.preventDefault();
        actions.search(form2.querySelector("#search").value.trim());
      } else if (form2.dataset.action === "ask") {
        event.preventDefault();
        const area = form2.querySelector("textarea");
        actions.assist?.("ask", { text: area.value });
        area.value = "";
      } else if (form2.dataset.action === "settings-form") {
        event.preventDefault();
        const data = {};
        new FormData(form2).forEach((value, key) => {
          data[key] = String(value);
        });
        form2.querySelectorAll("input[type='checkbox']").forEach((box) => {
          data[box.name] = box.checked ? "1" : "";
        });
        void actions.settings?.(form2.dataset.kind || "", data);
      }
    });
    shell.addEventListener("change", (event) => {
      const input = event.target;
      if (input.name === "appearance") applyAppearance(input.value);
    });
    shell.addEventListener("keydown", (event) => {
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLElement && event.target.isContentEditable;
      if (event.key === "Escape") {
        if (shell?.querySelector("dialog[open]")) return;
        if (!menu.hidden) {
          closeMenu();
          return;
        }
        if (!composer.hidden) {
          closeLayer(composer);
          if (!wide()) pane("list");
          actions.closeCompose();
          return;
        }
        if (!docked() && shell?.dataset.sidebar === "open") setSidebar(false);
        return;
      }
      if (typing) return;
      const focusedControl = event.target instanceof HTMLButtonElement && !event.target.dataset.uid && !event.target.dataset.folder;
      if (focusedControl && (event.key === "Enter" || event.key === " ")) return;
      const key = event.key.toLowerCase();
      if (event.key === "\\") {
        event.preventDefault();
        if (!wide()) pane(shell?.dataset.pane === "folders" ? "list" : "folders");
        else setSidebar(shell?.dataset.sidebar !== "open");
      } else if (event.key === "?") {
        event.preventDefault();
        (shell?.querySelector("#keys")).showModal();
      } else if (event.key === "." && (event.ctrlKey || event.metaKey) && shell?.querySelector(".sheet")) {
        event.preventDefault();
        if (!wide()) pane("reader");
        openLayer(shell.querySelector(".sheet"), null);
      } else if (key === "c") actions.compose();
      else if (key === "r") actions.reply(false);
      else if (key === "e") actions.archive();
      else if (event.key === "#") actions.askDelete();
      else if (key === "j" || key === "k" || event.key === "Enter") {
        event.preventDefault();
        moveSelection(key === "k" ? -1 : key === "j" ? 1 : 0);
      }
    });
    separator.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      separator.setPointerCapture(event.pointerId);
      const startX = event.clientX;
      const startW = list.getBoundingClientRect().width;
      const move = (ev) => setListWidth(startW + ev.clientX - startX);
      const up = () => {
        separator.removeEventListener("pointermove", move);
        separator.removeEventListener("pointerup", up);
      };
      separator.addEventListener("pointermove", move);
      separator.addEventListener("pointerup", up);
    });
    separator.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const delta = event.key === "ArrowRight" ? 16 : -16;
      setListWidth(list.getBoundingClientRect().width + delta);
    });
    const confirm = shell.querySelector("#confirm");
    confirm.addEventListener("click", (event) => {
      const button2 = event.target.closest("button");
      if (button2) confirm.close(button2.value);
    });
  }
  function moveSelection(delta) {
    const rows = [...shell?.querySelectorAll("[data-uid]") ?? []];
    if (!rows.length) return;
    const index = rows.findIndex((row3) => row3.getAttribute("aria-current") === "true");
    const next = delta === 0 ? Math.max(index, 0) : Math.min(rows.length - 1, Math.max(0, index + delta));
    const row2 = rows[next];
    if (!row2) return;
    actions.selectMessage(Number(row2.dataset.uid));
    row2.scrollIntoView({ block: "nearest" });
    if (!wide()) pane("reader");
  }
  function installAssist(flags) {
    if (!shell) return;
    if (flags.alerts) {
      const block = document.createElement("div");
      block.innerHTML = `
        <p class="group-label mono">Heute</p>
        <button type="button" class="count-row" data-action="alert" data-kind="reply"><span>Offene Antworten</span><span class="count" data-count="reply">0</span></button>
        <button type="button" class="count-row" data-action="alert" data-kind="follow"><span>Ohne Antwort</span><span class="count" data-count="follow">0</span></button>
        <button type="button" class="count-row" data-action="alert" data-kind="invoice"><span>Rechnungen</span><span class="count" data-count="invoice">0</span></button>
        <p class="quiet" id="dues"></p>
        <button type="button" class="text-btn" data-action="deadlines">Fristen lesen</button>`;
      shell.querySelector(".account")?.after(block);
    }
    const searchForm = shell.querySelector(".search-wrap");
    if (flags.triage && searchForm) {
      const filters = document.createElement("div");
      filters.className = "filters";
      filters.setAttribute("role", "toolbar");
      filters.setAttribute("aria-label", "Filter");
      const cats = [["all", "Alle"], ...Object.entries(CATEGORY)];
      filters.innerHTML = cats.map(
        ([id, label2], index) => `<button type="button" class="filter" data-action="cat" data-cat="${id}" aria-pressed="${index === 0 ? "true" : "false"}">${esc2(id === "all" ? t("AI_COPILOT.TAB_ALL", label2) : t("AI_COPILOT.CAT_" + id.toUpperCase(), label2))}</button>`
      ).join("") + (flags.triageLlm ? `<button type="button" class="text-btn" data-action="triage">${esc2(t("AI_COPILOT.TRIAGE_LLM", "Mit KI einordnen"))}</button>` : "");
      searchForm.after(filters);
    }
    if (flags.search && searchForm) {
      const button2 = document.createElement("button");
      button2.type = "button";
      button2.className = "text-btn";
      button2.dataset.action = "lang-search";
      button2.hidden = true;
      button2.textContent = "Als Sprache verstehen";
      searchForm.append(button2);
      const hint = document.createElement("div");
      hint.id = "translated";
      hint.hidden = true;
      hint.className = "translate";
      hint.innerHTML = `<p class="quiet" id="translate-why"></p><input class="search" id="translate-q" aria-label="\xDCbersetzte Suche"><button type="button" class="text-btn" data-action="run-search">Suchen</button>`;
      searchForm.after(hint);
      const input = shell.querySelector("#search");
      input.addEventListener("input", () => {
        button2.hidden = !input.value.trim();
      });
    }
    if (flags.summarize || flags.replies) {
      const strip = document.createElement("div");
      strip.id = "strip";
      shell.querySelector("#reader-body")?.before(strip);
    }
    if (flags.chat) {
      const ask = document.createElement("button");
      ask.type = "button";
      ask.className = "text-btn";
      ask.dataset.action = "open-sheet";
      ask.textContent = t("AI_COPILOT.ASK_COPILOT", "Copilot fragen");
      shell.querySelector(".reader-bar")?.append(ask);
      const sheet = document.createElement("aside");
      sheet.className = "sheet";
      sheet.hidden = true;
      sheet.innerHTML = `
        <div class="sheet-head">
          <span class="title title-md">${esc2(t("AI_COPILOT.ASK_COPILOT", "Copilot fragen"))}</span>
          <span class="mono quiet">${esc2(flags.provider)}</span>
          <span class="spacer"></span>
          <button type="button" class="icon-btn" data-action="close-sheet" aria-label="${esc2(t("GLOBAL.CLOSE", "Schlie\xDFen"))}">${iconClose}</button>
        </div>
        <div class="sheet-log" id="chat-log">
          <p class="quiet">${esc2(t("AI_COPILOT.CHAT_EMPTY", "Fragen Sie zum Beispiel, welche Mails auf eine Antwort warten."))}</p>
          <div class="prompts">
            <button type="button" class="prompt" data-action="prompt">Welche Mails warten auf meine Antwort?</button>
            <button type="button" class="prompt" data-action="prompt">Zeig mir Rechnungen vom letzten Monat</button>
            <button type="button" class="prompt" data-action="prompt">Fasse die ge\xF6ffnete Mail zusammen</button>
          </div>
        </div>
        <button type="button" class="text-btn" data-action="drop-context" id="context-chip" hidden></button>
        <form class="sheet-form" data-action="ask">
          <textarea id="ask" rows="2" placeholder="${esc2(t("AI_COPILOT.CHAT_PLACEHOLDER", "Nachricht an Copilot \u2026"))}"></textarea>
          <button type="submit" class="ink-btn">${esc2(t("AI_COPILOT.SEND", "Senden"))}</button>
        </form>
        <p class="error" id="chat-error" hidden></p>`;
      shell.querySelector(".reader")?.append(sheet);
    }
    if (flags.draft) {
      const tools = document.createElement("div");
      tools.className = "draft-tools";
      const tones = [["professional", "Professionell"], ["friendly", "Freundlich"], ["casual", "Locker"], ["concise", "Knapp"], ["formal", "F\xF6rmlich"]];
      tools.innerHTML = `
        <div class="modes" role="toolbar" aria-label="Art">
          <button type="button" class="seg" data-action="mode" data-mode="new" aria-pressed="true">Neue Mail</button>
          <button type="button" class="seg" data-action="mode" data-mode="reply" aria-pressed="false">Antwort</button>
          <button type="button" class="seg" data-action="mode" data-mode="rewrite" aria-pressed="false">Umschreiben</button>
          <button type="button" class="seg" data-action="mode" data-mode="proofread" aria-pressed="false">Korrektur</button>
        </div>
        <label class="field"><span>Anweisung</span><input id="instruction" type="text" placeholder="${esc2(t("AI_COPILOT.INSTRUCTION_PLACEHOLDER", "Was soll die Mail sagen?"))}"></label>
        <div class="tones" role="toolbar" aria-label="Ton">
          ${tones.map(([id, label2], index) => `<button type="button" class="seg" data-action="tone" data-tone="${id}" aria-pressed="${index === 0 ? "true" : "false"}">${esc2(t("AI_COPILOT.TONE_" + id.toUpperCase(), label2))}</button>`).join("")}
        </div>
        <div class="draft-actions">
          <button type="button" class="text-btn" data-action="generate">${esc2(t("AI_COPILOT.GENERATE", "Erzeugen"))}</button>
          <button type="button" class="text-btn" data-action="stop-generate" hidden>${esc2(t("AI_COPILOT.STOP", "Stopp"))}</button>
          <button type="button" class="text-btn" data-action="revert-draft" hidden>Zur\xFCck</button>
        </div>
        <p class="subject-hint" id="subject-hint" hidden><span></span><button type="button" class="text-btn" data-action="apply-subject">${esc2(t("AI_COPILOT.APPLY_SUBJECT", "\xDCbernehmen"))}</button></p>
        <p class="quiet" id="draft-status"></p>`;
      shell.querySelector(".fields")?.prepend(tools);
    }
    const consent = document.createElement("dialog");
    consent.id = "consent";
    consent.innerHTML = `
      <div class="dialog-body">
        <h2 class="title title-md">Assistent</h2>
        <p id="consent-text"></p>
        <div class="dialog-actions">
          <button type="button" class="text-btn" value="cancel">${esc2(t("GLOBAL.CANCEL", "Abbrechen"))}</button>
          <button type="button" class="ink-btn" value="ok">Fortfahren</button>
        </div>
      </div>`;
    consent.addEventListener("click", (event) => {
      const button2 = event.target.closest("button");
      if (button2) consent.close(button2.value);
    });
    shell.append(consent);
  }
  function paintSettings() {
    const panel = shell?.querySelector("#settings-panel");
    if (!panel) return;
    shell?.querySelectorAll("[data-section]").forEach((button2) => {
      const id = button2.dataset.section || "";
      button2.setAttribute("aria-pressed", id === section ? "true" : "false");
      if (id === "contacts") button2.hidden = !snap?.caps.contacts;
      if (id === "filters") button2.hidden = !snap?.caps.sieve;
    });
    panel.innerHTML = renderDesk(section, snap, edit);
    if (edit) {
      const field2 = panel.querySelector("input:not([type='hidden']), textarea");
      field2?.focus({ preventScroll: true });
    }
  }
  function folderButton(row2) {
    const count = row2.unread > 0 ? `<span class="count">${row2.unread}</span>` : "";
    return `<button type="button" class="folder" data-folder="${esc2(row2.fullName)}" aria-current="${row2.current ? "page" : "false"}" style="padding-left:${8 + row2.depth * 12}px"><span>${esc2(row2.name)}</span>${count}</button>`;
  }
  return {
    showLogin,
    setLoginBusy,
    setLoginError,
    showMail,
    setFolders(rows) {
      const inbox = rows.filter((row2) => row2.inbox);
      const rest = rows.filter((row2) => !inbox.includes(row2));
      const inboxEl = shell?.querySelector("#folder-inbox");
      const restEl = shell?.querySelector("#folder-rest");
      if (inboxEl) inboxEl.innerHTML = inbox.map(folderButton).join("") || `<button type="button" class="folder" data-folder="INBOX">Posteingang</button>`;
      if (restEl) restEl.innerHTML = rest.map(folderButton).join("");
      const current = rows.find((row2) => row2.current);
      if (current && shell) {
        shell.querySelector("#folder-title").textContent = current.name;
        shell.querySelector("#reader-place").textContent = current.name;
        const search = shell.querySelector("#search");
        if (document.activeElement !== search) search.placeholder = `In ${current.name} suchen`;
      }
    },
    setList(rows, empty, error, more, searching) {
      const box = shell?.querySelector("#rows");
      const emptyEl = shell?.querySelector("#list-empty");
      const errorEl = shell?.querySelector("#list-error");
      const moreBtn = shell?.querySelector("[data-action='more']");
      const clearBtn = shell?.querySelector("[data-action='clear-search']");
      if (box) {
        box.innerHTML = rows.map((row2) => `
          <button type="button" class="msg${row2.unseen ? " unseen" : ""}" data-uid="${row2.uid}" aria-current="${row2.current ? "true" : "false"}">
            <span class="who">${esc2(row2.who)}</span>
            <span class="when">${esc2(row2.when)}</span>
            <span class="subj">${esc2(row2.subject || "(ohne Betreff)")}${categoryMark(row2.category)}</span>
            <span class="peek">${esc2(row2.preview)}</span>
          </button>`).join("");
      }
      if (emptyEl) {
        emptyEl.hidden = !empty;
        emptyEl.textContent = empty;
      }
      if (errorEl) {
        errorEl.hidden = !error;
        errorEl.textContent = error;
      }
      if (moreBtn) moreBtn.hidden = !more;
      if (clearBtn) clearBtn.hidden = !searching;
    },
    setReader(data, loading2, error) {
      const body = shell?.querySelector("#reader-body");
      const buttons = ["reply", "reply-all", "forward", "archive", "unread", "delete"];
      buttons.forEach((name) => {
        const button2 = shell?.querySelector(`[data-action='${name}']`);
        if (button2) button2.hidden = !data;
      });
      if (!body) return;
      body.replaceChildren();
      if (loading2) {
        const p = document.createElement("p");
        p.className = "quiet";
        p.textContent = loading2;
        body.append(p);
        return;
      }
      if (error) {
        const p = document.createElement("p");
        p.className = "error";
        p.textContent = error;
        body.append(p);
        return;
      }
      if (!data) {
        const p = document.createElement("p");
        p.className = "empty";
        p.textContent = "W\xE4hlen Sie eine Mail.";
        body.append(p);
        return;
      }
      const head = document.createElement("header");
      head.className = "letter-head";
      const title = document.createElement("h2");
      title.className = "title title-md";
      title.textContent = data.subject || "(ohne Betreff)";
      const meta = document.createElement("p");
      meta.className = "quiet";
      meta.textContent = `${data.from} \xB7 ${data.when}`;
      const to = document.createElement("p");
      to.className = "quiet";
      to.textContent = data.to ? `An ${data.to}` : "";
      head.append(title, meta, to);
      body.append(head);
      if (data.attachments.length) {
        const list = document.createElement("ul");
        list.className = "files";
        data.attachments.forEach((file) => {
          const item = document.createElement("li");
          const link = document.createElement("a");
          link.href = file.href;
          link.textContent = file.size ? `${file.name} (${file.size})` : file.name;
          item.append(link);
          list.append(item);
        });
        body.append(list);
      }
      const frame = document.createElement("iframe");
      frame.className = "letter";
      frame.setAttribute("sandbox", "allow-popups allow-popups-to-escape-sandbox");
      frame.referrerPolicy = "no-referrer";
      frame.title = "Brief";
      const scheme = document.documentElement.classList.contains("dark") ? "dark" : "light";
      frame.srcdoc = data.html ? /<html[\s>]/i.test(data.html) ? data.html : `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"></head><body>${data.html}</body></html>` : `<!doctype html><meta charset="utf-8"><meta name="color-scheme" content="${scheme}"><style>body{margin:0;background:Canvas;color:CanvasText;white-space:pre-wrap;overflow-wrap:anywhere;font:16px/1.5 sans-serif}</style>${esc2(data.plain || "")}`;
      body.append(frame);
    },
    openCompose(seed) {
      if (!shell) return;
      const composer = shell.querySelector(".composer");
      shell.querySelector("#compose-title").textContent = seed.title;
      const form2 = shell.querySelector(".composer-form");
      form2.elements.namedItem("to").value = seed.to;
      form2.elements.namedItem("cc").value = seed.cc;
      form2.elements.namedItem("subject").value = seed.subject;
      form2.elements.namedItem("body").value = seed.body;
      shell.querySelectorAll("[data-mode]").forEach((button2) => {
        button2.setAttribute("aria-pressed", button2.dataset.mode === (seed.mode || "new") ? "true" : "false");
      });
      this.setSendState(false, "");
      if (!wide()) pane("compose");
      openLayer(composer, document.activeElement instanceof HTMLElement ? document.activeElement : null);
      form2.elements.namedItem("to").focus({ preventScroll: true });
    },
    closeCompose() {
      const composer = shell?.querySelector(".composer");
      if (composer && !composer.hidden) closeLayer(composer);
    },
    setSendState(busy, error) {
      const button2 = shell?.querySelector(".composer-form button[type='submit']");
      const slot = shell?.querySelector("#send-error");
      if (button2) {
        button2.disabled = busy;
        button2.textContent = busy ? "Wird gesendet \u2026" : t("COMPOSE.BUTTON_SEND", "Senden");
      }
      if (slot) {
        slot.hidden = !error;
        slot.textContent = error;
      }
    },
    notice(text2) {
      const slot = shell?.querySelector("#notice");
      if (slot) slot.textContent = text2;
    },
    confirmDelete() {
      const dialog = shell?.querySelector("#confirm");
      if (!dialog) return Promise.resolve(false);
      dialog.showModal();
      return new Promise((resolve) => {
        dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok"), { once: true });
      });
    },
    confirmConsent(text2) {
      const dialog = shell?.querySelector("#consent");
      const slot = shell?.querySelector("#consent-text");
      if (!dialog || !slot) return Promise.resolve(true);
      slot.textContent = text2;
      dialog.showModal();
      return new Promise((resolve) => {
        dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok"), { once: true });
      });
    },
    pressCategory(id) {
      shell?.querySelectorAll(".filter").forEach((button2) => {
        button2.setAttribute("aria-pressed", button2.dataset.cat === id ? "true" : "false");
      });
    },
    setAlerts(reply, follow, invoice, dues) {
      const write = (name, value) => {
        const slot = shell?.querySelector(`[data-count='${name}']`);
        if (slot) slot.textContent = String(value);
      };
      write("reply", reply);
      write("follow", follow);
      write("invoice", invoice);
      const line = shell?.querySelector("#dues");
      if (line) line.textContent = dues;
    },
    setStrip(state) {
      const strip = shell?.querySelector("#strip");
      if (!strip) return;
      strip.replaceChildren();
      if (!state) return;
      if (state.loading) {
        const p = document.createElement("p");
        p.className = "quiet";
        p.textContent = state.loading;
        strip.append(p);
        return;
      }
      if (state.error) {
        const p = document.createElement("p");
        p.className = "error";
        p.textContent = state.error;
        strip.append(p);
      }
      const row2 = document.createElement("div");
      row2.className = "strip-row";
      if (!state.tldr && state.showSummarize) {
        const button2 = document.createElement("button");
        button2.type = "button";
        button2.className = "text-btn";
        button2.dataset.action = "summarize";
        button2.textContent = t("AI_COPILOT.SUMMARIZE", "Zusammenfassen");
        row2.append(button2);
      } else if (state.tldr) {
        const label2 = document.createElement("span");
        label2.className = "mono";
        label2.textContent = "Zusammenfassung";
        const text2 = document.createElement("p");
        text2.textContent = state.tldr;
        const again = document.createElement("button");
        again.type = "button";
        again.className = "text-btn";
        again.dataset.action = "summarize";
        again.dataset.force = "1";
        again.textContent = t("AI_COPILOT.REGENERATE", "Neu erzeugen");
        row2.append(label2, text2, again);
        if (state.cached) {
          const note2 = document.createElement("p");
          note2.className = "quiet";
          note2.textContent = "aus dem Zwischenspeicher";
          row2.append(note2);
        }
        const caveat = document.createElement("p");
        caveat.className = "quiet";
        caveat.textContent = "Kann Angaben enthalten, die so nicht in der Mail stehen. Der Brief darunter ist die Quelle.";
        row2.append(caveat);
      }
      if (state.showReplies && !state.replies.length) {
        const replies = document.createElement("button");
        replies.type = "button";
        replies.className = "text-btn";
        replies.dataset.action = "replies";
        replies.textContent = t("AI_COPILOT.QUICK_REPLIES", "Antwortvorschl\xE4ge");
        row2.append(replies);
      }
      state.replies.forEach((reply, index) => {
        const button2 = document.createElement("button");
        button2.type = "button";
        button2.className = "prompt";
        button2.dataset.action = "use-reply";
        button2.dataset.index = String(index);
        button2.textContent = reply.label;
        row2.append(button2);
      });
      if (state.model) {
        const model = document.createElement("p");
        model.className = "mono quiet";
        model.textContent = state.model;
        row2.append(model);
      }
      strip.append(row2);
    },
    setChat(turns, thinking, context = "") {
      const log = shell?.querySelector("#chat-log");
      const chip = shell?.querySelector("#context-chip");
      const error = shell?.querySelector("#chat-error");
      if (chip) {
        chip.hidden = !context;
        chip.textContent = context ? `${context} \xB7 ohne Bezug` : "";
      }
      if (error) {
        error.hidden = !thinking.startsWith("!");
        error.textContent = thinking.startsWith("!") ? thinking.slice(1) : "";
      }
      if (!log) return;
      log.replaceChildren();
      if (!turns.length && !thinking) {
        const p = document.createElement("p");
        p.className = "quiet";
        p.textContent = t("AI_COPILOT.CHAT_EMPTY", "Fragen Sie zum Beispiel, welche Mails auf eine Antwort warten.");
        const prompts = document.createElement("div");
        prompts.className = "prompts";
        ["Welche Mails warten auf meine Antwort?", "Zeig mir Rechnungen vom letzten Monat", "Fasse die ge\xF6ffnete Mail zusammen"].forEach((text2) => {
          const button2 = document.createElement("button");
          button2.type = "button";
          button2.className = "prompt";
          button2.dataset.action = "prompt";
          button2.textContent = text2;
          prompts.append(button2);
        });
        log.append(p, prompts);
      }
      turns.forEach((turn) => {
        const item = document.createElement("article");
        item.className = turn.role === "user" ? "bubble" : "assistant";
        if (turn.trace.length) {
          const trace = document.createElement("p");
          trace.className = "mono quiet";
          trace.textContent = turn.trace.join(" \xB7 ");
          item.append(trace);
        }
        const text2 = document.createElement("p");
        text2.textContent = turn.text;
        item.append(text2);
        turn.actions.forEach((action, index) => {
          const card = document.createElement("div");
          card.className = "action";
          const label2 = document.createElement("p");
          label2.textContent = action.label;
          card.append(label2);
          if (!action.state) {
            const run = document.createElement("button");
            run.type = "button";
            run.className = "text-btn";
            run.dataset.action = "run-action";
            run.dataset.index = String(index);
            run.textContent = t("AI_COPILOT.RUN", "Ausf\xFChren");
            const dismiss = document.createElement("button");
            dismiss.type = "button";
            dismiss.className = "text-btn";
            dismiss.dataset.action = "dismiss-action";
            dismiss.dataset.index = String(index);
            dismiss.textContent = t("AI_COPILOT.DISMISS", "Verwerfen");
            card.append(run, dismiss);
          } else {
            const state = document.createElement("p");
            state.className = "quiet";
            state.textContent = action.state;
            card.append(state);
          }
          item.append(card);
        });
        log.append(item);
      });
      if (thinking && !thinking.startsWith("!")) {
        const p = document.createElement("p");
        p.className = "quiet";
        p.textContent = thinking;
        log.append(p);
      }
      log.scrollTop = log.scrollHeight;
    },
    openSheet() {
      const sheet = shell?.querySelector(".sheet");
      if (!sheet) return;
      if (!wide()) pane("reader");
      openLayer(sheet, document.activeElement instanceof HTMLElement ? document.activeElement : null);
      shell?.querySelector("#ask")?.focus({ preventScroll: true });
    },
    closeSheet() {
      const sheet = shell?.querySelector(".sheet");
      if (sheet && !sheet.hidden) closeLayer(sheet);
    },
    draftOptions() {
      const pressed = (selector) => shell?.querySelector(`${selector}[aria-pressed="true"]`)?.dataset;
      return {
        mode: pressed("[data-mode]")?.mode || "new",
        tone: pressed("[data-tone]")?.tone || "professional",
        instruction: shell?.querySelector("#instruction")?.value || "",
        body: shell?.querySelector("textarea[name='body']")?.value || "",
        subject: shell?.querySelector("input[name='subject']")?.value || ""
      };
    },
    setDraftBody(text2) {
      const area = shell?.querySelector("textarea[name='body']");
      if (area) area.value = text2;
    },
    setDraftBusy(busy, status) {
      const generate = shell?.querySelector("[data-action='generate']");
      const stop = shell?.querySelector("[data-action='stop-generate']");
      const revert = shell?.querySelector("[data-action='revert-draft']");
      const slot = shell?.querySelector("#draft-status");
      if (generate) generate.hidden = busy;
      if (stop) stop.hidden = !busy;
      if (revert) revert.hidden = busy;
      if (slot) slot.textContent = status;
    },
    setSubjectHint(subject) {
      const hint = shell?.querySelector("#subject-hint");
      if (!hint) return;
      hint.hidden = !subject;
      const span = hint.querySelector("span");
      if (span) span.textContent = subject ? `Betreff: ${subject}` : "";
      hint.dataset.subject = subject;
    },
    showSettings(next) {
      snap = next;
      edit = null;
      paintSettings();
    },
    settingsNotice(text2) {
      const slot = shell?.querySelector("#settings-error");
      if (!slot) return;
      slot.hidden = !text2;
      slot.textContent = text2;
    },
    showTranslation(search, explanation) {
      const box = shell?.querySelector("#translated");
      if (!box) return;
      box.hidden = false;
      box.querySelector("#translate-q").value = search;
      const why = box.querySelector("#translate-why");
      if (why) why.textContent = explanation;
    }
  };
}

// src/mail.ts
var PAGE_FALLBACK = 20;
function people(value) {
  const list = value && typeof value === "object" ? value["@Collection"] : null;
  if (!Array.isArray(list)) return [];
  return list.map((item) => ({
    name: String(item.name || ""),
    email: String(item.email || "")
  })).filter((item) => item.email || item.name);
}
function label(person) {
  return person.name || person.email;
}
function address(person) {
  if (!person.email) return person.name;
  return person.name ? `${person.name} <${person.email}>` : person.email;
}
function when(stamp) {
  if (!stamp) return "";
  const date = new Date(stamp * 1e3);
  const now = /* @__PURE__ */ new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { day: "numeric", month: "short" });
}
function seen(flags) {
  return flags.some((flag) => flag.toLowerCase() === "\\seen");
}
function plainFromHtml(html) {
  return new DOMParser().parseFromString(html, "text/html").body.textContent || "";
}
function quote(body) {
  return body.replace(/\r\n/g, "\n").split("\n").map((line) => `> ${line}`).join("\n");
}
function sizeLabel(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
async function boot(root3) {
  const session = new Session(root3);
  try {
    await session.start(await loadApp());
  } catch (error) {
    root3.replaceChildren(Object.assign(document.createElement("p"), {
      className: "error",
      textContent: explain(error)
    }));
  }
}
var Session = class {
  view;
  email = "";
  accountHash = "";
  sentFolder = "";
  archiveFolder = "";
  pageSize = PAGE_FALLBACK;
  folders = [];
  folder = "INBOX";
  messages = [];
  total = 0;
  offset = 0;
  search = "";
  selected = 0;
  hasMore = false;
  current = null;
  replyKind = "";
  assistFlags = null;
  noticeAck = false;
  useContext = true;
  chat = [];
  turns = [];
  chatActions = [];
  replies = [];
  draftBackup = "";
  draftAbort = null;
  tagged = /* @__PURE__ */ new Set();
  alertItems = [];
  category = "all";
  mainEmail = "";
  caps = { accounts: false, identities: false, contacts: false, sieve: false, openpgp: false, gnupg: false };
  desk = null;
  contactSearch = "";
  constructor(root3) {
    this.view = createView(root3, {
      login: (email, password, stay) => void this.login(email, password, stay),
      logout: () => void this.logout(),
      selectFolder: (fullName) => void this.selectFolder(fullName),
      selectMessage: (uid) => void this.selectMessage(uid),
      search: (query) => void this.setSearch(query),
      clearSearch: () => void this.setSearch(""),
      more: () => void this.loadList(true),
      compose: () => this.openNew(),
      reply: (all) => this.openReply(all),
      forward: () => this.openForward(),
      archive: () => void this.archive(),
      unread: () => void this.markUnread(),
      askDelete: () => void this.remove(),
      send: (values2) => void this.send(values2),
      closeCompose: () => {
        this.replyKind = "";
      },
      back: () => void 0,
      assist: (name, data) => void this.assist(name, data),
      settings: (name, data) => this.settings(name, data)
    });
  }
  async start(data) {
    const title = String(data.title || "SnappyMail");
    if (data.Auth) await this.enter(data);
    else this.view.showLogin(title);
  }
  async login(email, password, stay) {
    if (!email.trim() || !password) {
      this.view.setLoginError("Adresse und Passwort eintragen.");
      return;
    }
    this.view.setLoginBusy(true);
    this.view.setLoginError("");
    try {
      const result = await call("Login", {
        Email: email.trim(),
        Password: password,
        language: document.documentElement.lang || "",
        signMe: stay ? 1 : 0
      });
      await this.enter(result);
    } catch (error) {
      this.view.setLoginError(explain(error));
    } finally {
      this.view.setLoginBusy(false);
    }
  }
  async logout() {
    try {
      await call("Logout");
    } catch {
    }
    this.view.showLogin(document.title || "SnappyMail");
  }
  async enter(data) {
    this.email = String(data.Email || "");
    this.mainEmail = String(data.mainEmail || data.Email || "");
    this.caps = readCaps(data);
    this.accountHash = String(data.accountHash || "");
    this.sentFolder = String(data.SentFolder || "");
    this.archiveFolder = String(data.ArchiveFolder || "");
    const page = Number(data.MessagesPerPage || PAGE_FALLBACK);
    this.pageSize = Math.min(50, Math.max(10, page || PAGE_FALLBACK));
    document.title = this.email || String(data.title || "Postfach");
    this.assistFlags = await readAssist(data, async () => {
      const result = await plugin("AiGetSettings");
      return result.settings;
    });
    this.noticeAck = Boolean(this.assistFlags?.noticeAck);
    this.view.showMail(this.email, "Posteingang", this.assistFlags);
    if (this.assistFlags?.alerts) void this.loadAlerts();
    await this.loadFolders();
  }
  async settings(name, data) {
    try {
      if (name === "open") this.contactSearch = "";
      if (name === "search-contacts") this.contactSearch = data.search || "";
      if (name === "open" || name === "search-contacts") {
        this.desk = await loadDesk(this.caps, this.email, this.mainEmail, this.contactSearch);
        this.view.showSettings(this.desk);
        return;
      }
      if (!this.desk) return;
      const next = await applyDesk(name, data, this.desk);
      if (next === "session") {
        await this.enter(await loadApp());
        return;
      }
      this.desk = await loadDesk(this.caps, this.email, this.mainEmail, this.contactSearch);
      this.view.showSettings(this.desk);
    } catch (error) {
      this.view.settingsNotice(explain(error));
    }
  }
  async loadFolders() {
    try {
      const result = await call("Folders");
      this.folders = (result["@Collection"] || []).map((item) => ({
        fullName: String(item.fullName || ""),
        name: String(item.name || item.fullName || ""),
        delimiter: String(item.delimiter || "/"),
        role: String(item.role || ""),
        unread: Number(item.unreadEmails || 0),
        total: Number(item.totalEmails || 0),
        uidNext: Number(item.uidNext || 0)
      })).filter((folder) => folder.fullName);
      const inbox = this.folders.find((folder) => folder.role === "inbox" || folder.fullName.toUpperCase() === "INBOX");
      await this.selectFolder(inbox?.fullName || this.folders[0]?.fullName || "INBOX");
    } catch (error) {
      this.view.setList([], "", explain(error), false, false);
    }
  }
  async selectFolder(fullName) {
    this.folder = fullName;
    this.offset = 0;
    this.search = "";
    this.selected = 0;
    this.current = null;
    this.view.setReader(null, "", "");
    this.paintFolders();
    await this.loadList(false);
  }
  paintFolders() {
    const rows = this.folders.slice().sort((a, b) => Number(b.role === "inbox") - Number(a.role === "inbox") || a.fullName.localeCompare(b.fullName)).map((folder) => {
      const parts = folder.delimiter ? folder.fullName.split(folder.delimiter).filter(Boolean) : [folder.fullName];
      return {
        fullName: folder.fullName,
        name: folder.name,
        depth: Math.min(2, Math.max(0, parts.length - 1)),
        unread: folder.unread,
        current: folder.fullName === this.folder,
        inbox: folder.role === "inbox" || folder.fullName.toUpperCase() === "INBOX"
      };
    });
    this.view.setFolders(rows);
  }
  async loadList(append) {
    const start = append ? this.offset : 0;
    if (!append) this.view.setList([], "Mails werden geladen \u2026", "", false, Boolean(this.search));
    try {
      const result = await call("MessageList", {
        folder: this.folder,
        offset: start,
        limit: this.pageSize,
        search: this.category === "needs_reply" ? "keyword:$ai_needs_reply is:unanswered" : this.category === "personal" ? "keyword:$ai_personal" : this.category === "newsletter" ? "keyword:$ai_newsletter" : this.category === "notification" ? "keyword:$ai_notification" : this.category === "invoice" ? "keyword:$ai_invoice" : this.search,
        sort: "",
        uidNext: this.folders.find((folder) => folder.fullName === this.folder)?.uidNext || 0
      });
      const batch = (result["@Collection"] || []).map((item) => this.parseMessage(item));
      this.messages = append ? this.messages.concat(batch) : batch;
      this.offset = start + batch.length;
      this.total = Number(result.folder?.totalEmails ?? result.totalEmails ?? this.messages.length);
      const known = this.folders.find((folder) => folder.fullName === this.folder);
      if (known && result.folder) {
        if (result.folder.unreadEmails != null) known.unread = Number(result.folder.unreadEmails);
        if (result.folder.uidNext) known.uidNext = Number(result.folder.uidNext);
        this.paintFolders();
      }
      this.hasMore = this.search ? batch.length >= this.pageSize : this.offset < this.total;
      this.paintList();
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      this.hasMore = false;
      this.view.setList(this.rows(), "", explain(error), false, Boolean(this.search));
    }
  }
  parseMessage(item, full = false) {
    const flags = Array.isArray(item.flags) ? item.flags.map(String) : [];
    const attachments = full && item.attachments && typeof item.attachments === "object" ? (item.attachments["@Collection"] || []).filter((file) => !file.isInline).map((file) => ({
      name: String(file.fileName || "Anhang"),
      size: Number(file.estimatedSize || 0),
      href: downloadUrl({
        folder: String(item.folder || this.folder),
        uid: Number(item.uid || 0),
        mimeIndex: String(file.mimeIndex || ""),
        mimeType: String(file.mimeType || "application/octet-stream"),
        fileName: String(file.fileName || "anhang"),
        accountHash: this.accountHash
      })
    })) : [];
    const references = Array.isArray(item.references) ? item.references.map(String).join(" ") : String(item.references || "");
    return {
      uid: Number(item.uid || 0),
      subject: String(item.subject || ""),
      preview: String(item.preview || ""),
      from: people(item.from),
      to: people(item.to),
      cc: people(item.cc),
      replyTo: people(item.replyTo),
      date: Number(item.dateTimestamp || 0),
      flags,
      messageId: String(item.messageId || ""),
      references,
      html: String(item.html || ""),
      plain: String(item.plain || ""),
      attachments,
      category: String(item.aiCategory || "")
    };
  }
  rows() {
    return this.messages.map((message) => ({
      uid: message.uid,
      who: label(message.from[0] || { name: "", email: "" }) || "(unbekannt)",
      subject: message.subject,
      preview: message.preview,
      when: when(message.date),
      unseen: !seen(message.flags),
      current: message.uid === this.selected,
      category: message.category
    }));
  }
  paintList() {
    const empty = this.messages.length ? "" : this.category !== "all" ? "Keine Mails f\xFCr diesen Filter." : this.search ? "Keine Mails f\xFCr diese Suche." : "Dieser Ordner ist leer.";
    this.view.setList(this.rows(), empty, "", this.hasMore, Boolean(this.search) || this.category !== "all");
  }
  async setSearch(query) {
    this.search = query;
    this.category = "all";
    this.view.pressCategory("all");
    this.offset = 0;
    this.selected = 0;
    this.current = null;
    this.view.setReader(null, "", "");
    await this.loadList(false);
  }
  async selectMessage(uid) {
    this.selected = uid;
    this.paintList();
    this.view.setReader(null, "Brief wird geladen \u2026", "");
    try {
      const result = await call("Message", { folder: this.folder, uid });
      const message = this.parseMessage(result, true);
      this.current = message;
      const row2 = this.messages.find((item) => item.uid === uid);
      if (row2 && !seen(row2.flags)) {
        row2.flags.push("\\seen");
        const folder = this.folders.find((item) => item.fullName === this.folder);
        if (folder && folder.unread > 0) folder.unread -= 1;
        this.paintFolders();
        this.paintList();
        void call("MessageSetSeen", { folder: this.folder, uids: String(uid), setAction: 1 }).catch(() => void 0);
      }
      this.view.setReader(this.readerData(message), "", "");
      this.paintStrip();
      void this.loadCachedSummary();
    } catch (error) {
      this.view.setReader(null, "", explain(error));
    }
  }
  readerData(message) {
    return {
      subject: message.subject,
      from: message.from.map(label).join(", "),
      to: message.to.map(label).join(", "),
      when: when(message.date),
      html: message.html || null,
      plain: message.plain || null,
      attachments: message.attachments.map((file) => ({
        name: file.name,
        size: sizeLabel(file.size),
        href: file.href
      }))
    };
  }
  openNew() {
    this.replyKind = "";
    this.view.openCompose({ title: "Neue Nachricht", to: "", cc: "", subject: "", body: "", mode: "new" });
  }
  openReply(all) {
    const message = this.current;
    if (!message) return;
    this.replyKind = all ? "reply-all" : "reply";
    const author = message.replyTo[0] || message.from[0];
    const others = [...message.to, ...message.cc].filter((person) => person.email.toLowerCase() !== this.email.toLowerCase());
    const body = message.plain || plainFromHtml(message.html);
    const subject = /^re:/i.test(message.subject) ? message.subject : `Re: ${message.subject}`;
    this.view.openCompose({
      title: all ? "Allen antworten" : "Antworten",
      mode: "reply",
      to: author ? address(author) : "",
      cc: all ? others.map(address).join(", ") : "",
      subject,
      body: `

Am ${when(message.date)} schrieb ${author ? label(author) : ""}:
${quote(body)}`
    });
  }
  openForward() {
    const message = this.current;
    if (!message) return;
    this.replyKind = "forward";
    const body = message.plain || plainFromHtml(message.html);
    const subject = /^fw:/i.test(message.subject) ? message.subject : `Fw: ${message.subject}`;
    this.view.openCompose({
      title: "Weiterleiten",
      to: "",
      cc: "",
      subject,
      body: `

-------- Weitergeleitete Nachricht --------
Von: ${message.from.map(label).join(", ")}
Betreff: ${message.subject}

${body}`
    });
  }
  async send(values2) {
    if (!values2.to.trim()) {
      this.view.setSendState(false, "Geben Sie bitte mindestens einen Empf\xE4nger an.");
      return;
    }
    this.view.setSendState(true, "");
    const message = this.current;
    const params = {
      from: this.email,
      to: values2.to,
      cc: values2.cc,
      bcc: "",
      subject: values2.subject,
      plain: values2.body,
      html: "",
      saveFolder: this.sentFolder
    };
    if (message && this.replyKind) {
      params.inReplyTo = message.messageId;
      params.references = [message.references, message.messageId].filter(Boolean).join(" ");
      params.draftInfo = [this.replyKind === "forward" ? "forward" : "reply", message.uid, this.folder];
    }
    try {
      await call("SendMessage", params);
      this.view.closeCompose();
      this.view.setSendState(false, "");
      this.view.notice("Gesendet.");
      this.replyKind = "";
      this.offset = 0;
      await this.loadList(false);
    } catch (error) {
      this.view.setSendState(false, explain(error));
    }
  }
  async archive() {
    if (!this.selected) return;
    if (!this.archiveFolder) {
      this.view.notice("Kein Archiv-Ordner eingerichtet.");
      return;
    }
    try {
      await call("MessageMove", { fromFolder: this.folder, toFolder: this.archiveFolder, uids: String(this.selected) });
      this.view.notice("Archiviert.");
      await this.afterRemoval();
    } catch (error) {
      this.view.notice(explain(error));
    }
  }
  async remove() {
    if (!this.selected) return;
    if (!await this.view.confirmDelete()) return;
    try {
      await call("MessageDelete", { folder: this.folder, uids: String(this.selected) });
      this.view.notice("Gel\xF6scht.");
      await this.afterRemoval();
    } catch (error) {
      this.view.notice(explain(error));
    }
  }
  async afterRemoval() {
    this.messages = this.messages.filter((message) => message.uid !== this.selected);
    this.selected = 0;
    this.current = null;
    this.view.setReader(null, "", "");
    this.offset = Math.max(0, this.offset - 1);
    await this.loadList(false);
  }
  strip() {
    return {
      loading: "",
      error: "",
      tldr: this.tldr,
      cached: this.summaryCached,
      decisions: [],
      actions: [],
      next: "",
      replies: this.replies,
      model: this.summaryModel,
      showSummarize: Boolean(this.assistFlags?.summarize),
      showReplies: Boolean(this.assistFlags?.replies)
    };
  }
  tldr = "";
  summaryCached = false;
  summaryModel = "";
  paintStrip() {
    if (!this.assistFlags?.summarize && !this.assistFlags?.replies) return;
    this.view.setStrip(this.current ? this.strip() : null);
  }
  async loadCachedSummary() {
    if (!this.assistFlags?.summarize || !this.current) return;
    try {
      const result = await plugin("AiSummarize", {
        folder: this.folder,
        uids: [this.current.uid],
        cacheOnly: true,
        sent: this.sentFolder
      });
      this.tldr = result.summary?.tldr || "";
      this.summaryCached = Boolean(result.cached);
      this.summaryModel = result.summary?.model || "";
      this.paintStrip();
    } catch {
      this.paintStrip();
    }
  }
  async consent(kind = "mail") {
    if (this.noticeAck) return true;
    const name = this.assistFlags?.providerName || "den Anbieter";
    const text2 = kind === "query" ? `Nur die Suchanfrage geht an ${name}. Die Mails selbst bleiben auf dem Server. Fortfahren?` : `Diese KI-Funktion sendet den Inhalt der betroffenen Mails an ${name}. Es wird nur gesendet, wenn Sie eine KI-Aktion anklicken. Fortfahren?`;
    const ok = await this.view.confirmConsent(text2);
    if (!ok) return false;
    try {
      await plugin("AiSaveSettings", { settings: { notice_ack: true } });
    } catch {
    }
    this.noticeAck = true;
    return true;
  }
  async loadAlerts() {
    const inbox = this.folders.find((folder) => folder.role === "inbox")?.fullName || "INBOX";
    try {
      const result = await plugin("AiAlerts", {
        inbox,
        sent: this.sentFolder
      });
      this.alertItems = result.alerts || [];
      const count = (type) => this.alertItems.filter((item) => item.type === type).length;
      this.view.setAlerts(count("reply"), count("followup"), count("invoice"), "");
    } catch {
    }
  }
  async assist(name, data) {
    if (name === "cat") {
      this.category = data.cat || "all";
      if (this.category !== "all" && this.assistFlags?.triage && !this.tagged.has(this.folder)) {
        try {
          await plugin("AiTriageTag", { folder: this.folder, sent: this.sentFolder });
          this.tagged.add(this.folder);
        } catch (error) {
          this.view.notice(explain(error));
          return;
        }
      }
      this.offset = 0;
      await this.loadList(false);
      return;
    }
    if (name === "alert") {
      if (data.kind === "follow") {
        const sent = this.folders.find((folder) => folder.role === "sent")?.fullName || this.sentFolder;
        if (sent) await this.selectFolder(sent);
        return;
      }
      await this.assist("cat", { cat: data.kind === "invoice" ? "invoice" : "needs_reply" });
      this.view.pressCategory(data.kind === "invoice" ? "invoice" : "needs_reply");
      return;
    }
    if (name === "summarize" || name === "replies" || name === "generate" || name === "triage" || name === "deadlines" || name === "ask") {
      if (!await this.consent()) return;
    }
    if (name === "lang-search") {
      if (!await this.consent("query")) return;
      const query = data.text || "";
      const input = document.querySelector("#search");
      const text2 = query || input?.value.trim() || "";
      if (!text2) return;
      try {
        const result = await plugin("AiSearch", {
          query: text2,
          folders: this.folders.map((folder) => folder.fullName),
          currentFolder: this.folder,
          sent: this.sentFolder
        });
        if (result.folder && result.folder !== this.folder) await this.selectFolder(result.folder);
        this.view.showTranslation(result.search, result.explanation || "");
      } catch (error) {
        this.view.notice(explain(error));
      }
      return;
    }
    if (name === "run-search") {
      const field2 = document.querySelector("#translate-q");
      this.category = "all";
      this.view.pressCategory("all");
      await this.setSearch(field2?.value.trim() || "");
      return;
    }
    if (name === "summarize" && this.current) {
      this.view.setStrip({ ...this.strip(), loading: "Verlauf wird zusammengefasst \u2026", tldr: "" });
      try {
        const result = await plugin("AiSummarize", {
          folder: this.folder,
          uids: [this.current.uid],
          force: data.force === "1",
          sent: this.sentFolder
        });
        this.tldr = result.summary?.tldr || "";
        this.summaryCached = Boolean(result.cached);
        this.summaryModel = result.summary?.model || this.assistFlags?.provider || "";
        this.paintStrip();
      } catch (error) {
        this.view.setStrip({ ...this.strip(), error: explain(error) });
      }
      return;
    }
    if (name === "replies" && this.current) {
      this.view.setStrip({ ...this.strip(), loading: "Antwortvorschl\xE4ge werden erstellt \u2026" });
      try {
        const result = await plugin("AiQuickReplies", {
          folder: this.folder,
          uids: [this.current.uid],
          sent: this.sentFolder
        });
        this.replies = (result.replies || []).slice(0, 3);
        this.paintStrip();
      } catch (error) {
        this.view.setStrip({ ...this.strip(), error: explain(error) });
      }
      return;
    }
    if (name === "use-reply") {
      const reply = this.replies[Number(data.index || 0)];
      if (!reply || !this.current) return;
      this.replyKind = "reply";
      const author = this.current.replyTo[0] || this.current.from[0];
      this.view.openCompose({
        title: reply.label || "Antworten",
        mode: "reply",
        to: author ? address(author) : "",
        cc: "",
        subject: /^re:/i.test(this.current.subject) ? this.current.subject : `Re: ${this.current.subject}`,
        body: reply.body
      });
      return;
    }
    if (name === "triage") {
      this.view.notice("Absender, Betreff und Vorschau dieser Seite gehen an das Modell.");
      try {
        const result = await plugin("AiTriageLlm", {
          folder: this.folder,
          items: this.messages.map((message) => ({
            uid: message.uid,
            from: message.from.map(label).join(", "),
            subject: message.subject,
            preview: message.preview
          }))
        });
        this.view.notice(result.warning || `${result.stored || 0} Mails eingeordnet.`);
        await this.loadList(false);
      } catch (error) {
        this.view.notice(explain(error));
      }
      return;
    }
    if (name === "deadlines") {
      const items = this.alertItems.filter((item) => item.type !== "followup").slice(0, 8);
      if (!items.length) {
        this.view.notice("Keine Mails f\xFCr eine Frist.");
        return;
      }
      try {
        const result = await plugin("AiAlertsLlm", { items });
        const dues = (result.alerts || []).filter((item) => item.due).map((item) => `${item.due} ${item.title}`).join(" \xB7 ");
        this.view.setAlerts(
          this.alertItems.filter((item) => item.type === "reply").length,
          this.alertItems.filter((item) => item.type === "followup").length,
          this.alertItems.filter((item) => item.type === "invoice").length,
          dues
        );
      } catch (error) {
        this.view.notice(explain(error));
      }
      return;
    }
    if (name === "ask") {
      const text2 = (data.text || "").trim();
      if (!text2) return;
      this.chat.push({ role: "user", content: text2 });
      this.turns.push({ role: "user", text: text2, trace: [], actions: [] });
      this.view.setChat(this.turns, "Copilot arbeitet \u2026", this.contextLabel());
      try {
        const result = await plugin("AiChat", {
          messages: this.chat,
          context: this.useContext && this.current ? { folder: this.folder, uid: this.current.uid } : {},
          folders: this.folders.map((folder) => folder.fullName),
          sent: this.sentFolder
        });
        this.chat.push({ role: "assistant", content: result.reply || "" });
        this.chatActions = result.actions || [];
        this.turns.push({
          role: "assistant",
          text: result.reply || "",
          trace: (result.trace || []).map((item) => item.summary || "").filter(Boolean),
          actions: this.chatActions.map((action) => ({ label: String(action.label || action.type || ""), state: "" }))
        });
        this.view.setChat(this.turns, "", this.contextLabel());
      } catch (error) {
        this.view.setChat(this.turns, "!" + explain(error), this.contextLabel());
      }
      return;
    }
    if (name === "drop-context") {
      this.useContext = false;
      this.view.setChat(this.turns, "", "");
      return;
    }
    if (name === "dismiss-action") {
      const index = Number(data.index || 0);
      const turn = [...this.turns].reverse().find((item) => item.role === "assistant");
      if (turn?.actions[index]) turn.actions[index].state = "Verworfen";
      this.view.setChat(this.turns, "", this.contextLabel());
      return;
    }
    if (name === "run-action") {
      await this.runChatAction(Number(data.index || 0));
      return;
    }
    if (name === "generate") await this.generate();
    if (name === "stop-generate") this.draftAbort?.abort();
    if (name === "revert-draft") this.view.setDraftBody(this.draftBackup);
    if (name === "apply-subject") {
      const hint = document.querySelector("#subject-hint");
      const subject = hint?.dataset.subject || "";
      const field2 = document.querySelector("input[name='subject']");
      if (field2 && subject) field2.value = subject;
    }
  }
  contextLabel() {
    if (!this.useContext || !this.current) return "";
    return this.current.subject || "(ohne Betreff)";
  }
  async generate() {
    const options = this.view.draftOptions();
    this.draftBackup = options.body;
    this.draftAbort = new AbortController();
    this.view.setDraftBusy(true, "Entwurf wird geschrieben \u2026");
    let streamed = "";
    try {
      await streamEvents("AiStream", {
        mode: options.mode,
        tone: options.tone,
        instruction: options.instruction,
        current: options.body,
        wantSubject: options.mode === "new" || options.mode === "reply",
        folder: this.folder,
        uids: this.current ? [this.current.uid] : [],
        sent: this.sentFolder
      }, (event, payload) => {
        if (event === "delta") {
          streamed += String(payload.text || "");
          this.view.setDraftBody(streamed);
        }
        if (event === "done") {
          this.view.setDraftBody(String(payload.body || streamed));
          this.view.setSubjectHint(String(payload.subject || ""));
          this.summaryModel = String(payload.model || "");
        }
        if (event === "error") throw new ApiError(1, String(payload.error || "Verbindung unterbrochen."));
      }, this.draftAbort.signal);
      this.view.setDraftBusy(false, this.summaryModel);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        this.view.setDraftBusy(false, "Abgebrochen.");
        return;
      }
      this.view.setDraftBusy(false, explain(error));
    }
  }
  async runChatAction(index) {
    const action = this.chatActions[index];
    const turn = [...this.turns].reverse().find((item) => item.role === "assistant");
    if (!action || !turn?.actions[index] || turn.actions[index].state) return;
    const type = String(action.type || "");
    const folder = String(action.folder || this.folder);
    const uids = Array.isArray(action.uids) ? action.uids.map(String).join(",") : "";
    try {
      if (type === "delete") {
        if (!await this.view.confirmDelete()) return;
        await call("MessageDelete", { folder, uids });
      } else if (type === "archive") {
        if (!this.archiveFolder) throw new ApiError(1, "Kein Archiv-Ordner eingerichtet.");
        await call("MessageMove", { fromFolder: folder, toFolder: this.archiveFolder, uids });
      } else if (type === "move") {
        await call("MessageMove", { fromFolder: folder, toFolder: String(action.to || ""), uids });
      } else if (type === "mark_read" || type === "mark_unread") {
        await call("MessageSetSeen", { folder, uids, setAction: type === "mark_read" ? 1 : 0 });
      } else if (type === "flag" || type === "unflag") {
        await call("MessageSetFlagged", { folder, uids, setAction: type === "flag" ? 1 : 0 });
      } else if (type === "open" || type === "reply") {
        await this.selectFolder(folder);
        await this.selectMessage(Number(action.uid || 0));
        if (type === "reply") this.openReply(false);
        this.view.closeSheet();
      } else if (type === "compose") {
        this.openNew();
        this.view.openCompose({
          title: "Neue Nachricht",
          mode: "new",
          to: String(action.to || ""),
          cc: "",
          subject: String(action.subject || ""),
          body: ""
        });
      } else if (type === "search") {
        if (folder) await this.selectFolder(folder);
        await this.setSearch(String(action.search || ""));
      }
      turn.actions[index].state = "Erledigt";
      this.view.setChat(this.turns, "", this.contextLabel());
      if (uids) await this.loadList(false);
    } catch (error) {
      turn.actions[index].state = explain(error);
      this.view.setChat(this.turns, "", this.contextLabel());
    }
  }
  async markUnread() {
    if (!this.selected) return;
    const row2 = this.messages.find((message) => message.uid === this.selected);
    if (!row2) return;
    row2.flags = row2.flags.filter((flag) => flag.toLowerCase() !== "\\seen");
    const folder = this.folders.find((item) => item.fullName === this.folder);
    if (folder) folder.unread += 1;
    this.paintFolders();
    this.paintList();
    try {
      await call("MessageSetSeen", { folder: this.folder, uids: String(this.selected), setAction: 0 });
    } catch (error) {
      this.view.notice(explain(error));
    }
  }
};

// src/main.ts
applyAppearance(readAppearance());
watchSystemTheme(() => applyAppearance(readAppearance()));
var root2 = document.getElementById("app");
if (root2) void boot(root2);
