import { explain } from "../api";
import { icon } from "../icons";
import { t } from "../i18n";
import { check, esc, field, type Ctx } from "./util";

interface DomainRow {
  name: string;
  disabled?: boolean;
  alias?: boolean;
}

interface Conn {
  host?: string;
  port?: number;
  type?: number;
  timeout?: number;
  shortLogin?: boolean;
  lowerLogin?: boolean;
  stripLogin?: string;
  sasl?: string[];
  ssl?: Record<string, unknown>;
  enabled?: boolean;
  authLiteral?: boolean;
  useAuth?: boolean;
  setSender?: boolean;
  usePhpMail?: boolean;
  authPlainLine?: boolean;
  message_list_limit?: number;
  search_filter?: string;
  spam_headers?: string;
  virus_headers?: string;
  disabled_capabilities?: string[];
  fast_simple_search?: boolean;
  force_select?: boolean;
  message_all_headers?: boolean;
  use_expunge_all_on_delete?: boolean;
}

interface DomainBody {
  name?: string;
  aliasName?: string;
  whiteList?: string;
  IMAP?: Conn;
  SMTP?: Conn;
  Sieve?: Conn;
}

const CAPS = ["LIST-STATUS", "METADATA", "MOVE", "SORT", "THREAD", "BINARY", "STATUS=SIZE", "PREVIEW"];

const SECURE: Array<[string, string]> = [
  ["0", "Ohne"],
  ["1", "SSL"],
  ["2", "STARTTLS"],
  ["9", "Auto"]
];

export async function paintDomains(ctx: Ctx, slot: HTMLElement): Promise<void> {
  slot.innerHTML = `
    <div class="action">
      <button type="button" class="ink-btn" data-action="add">${icon("plus")}<span class="btn-label">${esc(t("TAB_DOMAINS.BUTTON_ADD_DOMAIN", "Domain hinzufügen"))}</span></button>
      <button type="button" class="text-btn" data-action="alias">${icon("plus")}<span class="btn-label">${esc(t("TAB_DOMAINS.BUTTON_ADD_ALIAS", "Alias hinzufügen"))}</span></button>
    </div>
    <p class="error" data-for="list" hidden></p>
    <ul class="set-list" id="domains"></ul>
    <dialog id="domain-dialog" class="dialog-wide"></dialog>
    <dialog id="confirm"><div class="dialog-body">
      <h2 class="title title-md">${esc(t("TAB_DOMAINS.DELETE_ARE_YOU_SURE", "Sind Sie sicher?"))}</h2>
      <div class="dialog-actions"><button type="button" class="text-btn" value="cancel">${esc(t("GLOBAL.CANCEL", "Abbrechen"))}</button><button type="button" class="danger" value="ok">${icon("delete")}<span class="btn-label">${esc(t("GLOBAL.DELETE", "Löschen"))}</span></button></div>
    </div></dialog>`;
  const confirm = slot.querySelector("#confirm") as HTMLDialogElement;
  confirm.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest("button");
    if (button) confirm.close(button.value);
  });
  slot.querySelector("[data-action='add']")?.addEventListener("click", () => openDomain(ctx, slot, "", false));
  slot.querySelector("[data-action='alias']")?.addEventListener("click", () => openAlias(ctx, slot, ""));
  await loadList(ctx, slot);
}

async function loadList(ctx: Ctx, slot: HTMLElement): Promise<void> {
  const list = slot.querySelector("#domains");
  const error = slot.querySelector("[data-for='list']") as HTMLElement | null;
  if (!list) return;
  try {
    const result = await ctx.call<unknown>("AdminDomainList", { includeAliases: "1" });
    const rows = (Array.isArray(result) ? result : Object.values(result || {})) as DomainRow[];
    if (!rows.length) {
      list.innerHTML = `<li class="quiet">${esc(t("TAB_DOMAINS.EMPTY", "Keine Domains."))}</li>`;
      return;
    }
    list.innerHTML = rows.map((item) => {
      const name = String(item.name || "");
      const meta = [item.alias ? t("TAB_DOMAINS.LABEL_ALIAS", "Alias") : "", item.disabled ? t("GLOBAL.INACTIVE", "Inaktiv") : ""].filter(Boolean).join(" · ");
      const toggle = item.disabled ? t("TAB_DOMAINS.BUTTON_ENABLE", "Aktivieren") : t("TAB_DOMAINS.BUTTON_DISABLE", "Deaktivieren");
      return `<li class="set-row"><button type="button" class="text-btn grow" data-action="edit" data-name="${esc(name)}" data-alias="${item.alias ? "1" : "0"}"><span class="grow"><strong>${esc(name)}</strong>${meta ? `<span class="quiet">${esc(meta)}</span>` : ""}</span></button><button type="button" class="text-btn" data-action="toggle" data-name="${esc(name)}" data-disabled="${item.disabled ? "1" : "0"}">${icon(item.disabled ? "check" : "minus")}<span class="btn-label">${esc(toggle)}</span></button><button type="button" class="danger" data-action="delete" data-name="${esc(name)}">${icon("delete")}<span class="btn-label">${esc(t("GLOBAL.DELETE", "Löschen"))}</span></button></li>`;
    }).join("");
    list.querySelectorAll<HTMLButtonElement>("[data-action='edit']").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.alias === "1") openAlias(ctx, slot, button.dataset.name || "");
        else openDomain(ctx, slot, button.dataset.name || "", false);
      });
    });
    list.querySelectorAll<HTMLButtonElement>("[data-action='toggle']").forEach((button) => {
      button.addEventListener("click", () => {
        void ctx.call("AdminDomainDisable", {
          name: button.dataset.name || "",
          disabled: button.dataset.disabled === "1" ? "0" : "1"
        }).then(() => loadList(ctx, slot)).catch((error) => show(slot, explain(error)));
      });
    });
    list.querySelectorAll<HTMLButtonElement>("[data-action='delete']").forEach((button) => {
      button.addEventListener("click", () => { void remove(ctx, slot, button.dataset.name || ""); });
    });
    if (error) error.hidden = true;
  } catch (error) {
    show(slot, explain(error));
  }
}

function show(slot: HTMLElement, message: string): void {
  const error = slot.querySelector("[data-for='list']") as HTMLElement | null;
  if (!error) return;
  error.hidden = false;
  error.textContent = message;
}

async function remove(ctx: Ctx, slot: HTMLElement, name: string): Promise<void> {
  const dialog = slot.querySelector("#confirm") as HTMLDialogElement | null;
  if (!dialog || !name) return;
  dialog.showModal();
  const ok = await new Promise<boolean>((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok"), { once: true });
  });
  if (!ok) return;
  try {
    await ctx.call("AdminDomainDelete", { name });
    await loadList(ctx, slot);
  } catch (error) {
    show(slot, explain(error));
  }
}

function blank(): DomainBody {
  return {
    whiteList: "",
    IMAP: { host: "", port: 993, type: 1, timeout: 300, disabled_capabilities: [], ssl: {} },
    SMTP: { host: "", port: 465, type: 1, timeout: 60, useAuth: true, ssl: {} },
    Sieve: { host: "", port: 4190, type: 0, timeout: 10, enabled: false, ssl: {} }
  };
}

async function openDomain(ctx: Ctx, slot: HTMLElement, name: string, creating: boolean): Promise<void> {
  const dialog = slot.querySelector("#domain-dialog") as HTMLDialogElement | null;
  if (!dialog) return;
  let body = blank();
  if (name && !creating) {
    try {
      body = await ctx.call<DomainBody>("AdminDomainLoad", { name });
    } catch (error) {
      show(slot, explain(error));
      return;
    }
  }
  const imap = body.IMAP || {};
  const smtp = body.SMTP || {};
  const sieve = body.Sieve || {};
  const caps = new Set((imap.disabled_capabilities || []).map((item) => item.toUpperCase()));
  dialog.innerHTML = `<form class="dialog-body">
    <h2 class="title title-md">${esc(name ? t("POPUPS_DOMAIN.TITLE_EDIT_DOMAIN", "Domain bearbeiten").replace("%NAME%", name) : t("POPUPS_DOMAIN.TITLE_ADD_DOMAIN", "Domain hinzufügen"))}</h2>
    ${field("name", t("POPUPS_DOMAIN.LABEL_NAME", "Name"), name, creating || !name ? "" : "readonly")}
    <h3 class="title title-md">IMAP</h3>
    ${conn("IMAP", imap)}
    <p class="mono">${esc(t("POPUPS_DOMAIN.DISABLE_CAPABILITIES", "Funktionen deaktivieren"))}</p>
    ${CAPS.map((cap) => check(`cap-${cap}`, cap, caps.has(cap))).join("")}
    ${field("IMAP.message_list_limit", t("POPUPS_DOMAIN.LIMITS", "Grenzwerte"), String(imap.message_list_limit ?? 10000), "inputmode=\"numeric\"")}
    ${field("IMAP.search_filter", t("GLOBAL.SEARCH", "Suchen"), String(imap.search_filter || ""))}
    ${field("IMAP.spam_headers", t("POPUPS_DOMAIN.VALID_SPAM_HEADERS", "Spam-Header beachten"), String(imap.spam_headers || ""))}
    ${field("IMAP.virus_headers", t("POPUPS_DOMAIN.VALID_VIRUS_HEADERS", "Virus-Header beachten"), String(imap.virus_headers || ""))}
    ${check("IMAP.use_expunge_all_on_delete", t("APP_TEXT.EXPUNGE_ON_DELETE", "Expunge beim Löschen"), Boolean(imap.use_expunge_all_on_delete))}
    ${check("IMAP.fast_simple_search", t("APP_TEXT.FAST_SEARCH", "Schnelle Suche"), imap.fast_simple_search !== false)}
    ${check("IMAP.force_select", t("APP_TEXT.FORCE_SELECT", "SELECT erzwingen"), Boolean(imap.force_select))}
    ${check("IMAP.message_all_headers", t("APP_TEXT.ALL_HEADERS", "Alle Kopfzeilen"), Boolean(imap.message_all_headers))}
    <h3 class="title title-md">SMTP</h3>
    ${conn("SMTP", smtp)}
    ${check("SMTP.useAuth", t("POPUPS_DOMAIN.LABEL_USE_AUTH", "Authentifizierung verwenden"), Boolean(smtp.useAuth))}
    ${check("SMTP.setSender", t("POPUPS_DOMAIN.LABEL_SET_SENDER", "Login-Namen als Absender verwenden"), Boolean(smtp.setSender))}
    ${check("SMTP.usePhpMail", t("POPUPS_DOMAIN.LABEL_USE_PHP_MAIL", "PHPs mail()-Funktion verwenden"), Boolean(smtp.usePhpMail))}
    ${check("SMTP.authPlainLine", t("POPUPS_DOMAIN.LABEL_AUTH_PLAIN_LINE", "Einzelnen AUTH PLAIN Befehl bei der Anmeldung erzwingen"), Boolean(smtp.authPlainLine))}
    <h3 class="title title-md">Sieve</h3>
    ${check("Sieve.enabled", t("POPUPS_DOMAIN.LABEL_ALLOW_SIEVE_SCRIPTS", "Sieve-Skripte erlauben"), Boolean(sieve.enabled))}
    ${conn("Sieve", sieve)}
    ${check("Sieve.authLiteral", "AUTH LITERAL", sieve.authLiteral !== false)}
    <label class="field"><span>${esc(t("POPUPS_DOMAIN.BUTTON_WHITE_LIST", "Whitelist"))}</span><textarea class="short" name="whiteList">${esc(String(body.whiteList || ""))}</textarea></label>
    <p class="quiet">${esc(t("POPUPS_DOMAIN.WHITE_LIST_ALERT", "Liste der Domain-User, die Webmail verwenden dürfen. Verwenden Sie Leerzeichen als Trennsymbol."))}</p>
    <div class="action">
      <button type="button" class="ink-btn" data-action="save">${esc(t("GLOBAL.SAVE", "Speichern"))}</button>
      <button type="button" class="text-btn" data-action="test">${esc(t("UI.TEST_CONNECTION", "Verbindung testen"))}</button>
      <button type="button" class="text-btn" data-action="auto">${esc(t("UI.AUTOCONFIG", "Autoconfig"))}</button>
      <button type="button" class="text-btn" data-action="match">${esc(t("UI.MATCH", "Domain-Abgleich testen"))}</button>
      <button type="button" class="text-btn" value="cancel">${esc(t("GLOBAL.CANCEL", "Abbrechen"))}</button>
    </div>
    <div class="fields" data-for="tools" hidden>
      ${field("authUser", t("GLOBAL.USERNAME", "Nutzername"), "")}
      ${field("authPass", t("GLOBAL.PASSWORD", "Passwort"), "", "type=\"password\"")}
      ${field("matchUser", t("UI.MATCH", "Domain-Abgleich testen"), "")}
      <p class="quiet" data-for="result"></p>
    </div>
  </form>`;
  dialog.querySelector("[value='cancel']")?.addEventListener("click", () => dialog.close());
  dialog.querySelector("[data-action='save']")?.addEventListener("click", () => { void saveDomain(ctx, slot, dialog, Boolean(name) && !creating, body); });
  dialog.querySelector("[data-action='test']")?.addEventListener("click", () => { void testDomain(ctx, dialog, body); });
  dialog.querySelector("[data-action='auto']")?.addEventListener("click", () => { void auto(ctx, dialog); });
  dialog.querySelector("[data-action='match']")?.addEventListener("click", () => { void match(ctx, dialog); });
  const tools = dialog.querySelector("[data-for='tools']") as HTMLElement;
  dialog.querySelectorAll("[data-action='test'], [data-action='match']").forEach((button) => {
    button.addEventListener("click", () => { tools.hidden = false; });
  });
  dialog.showModal();
}

function conn(prefix: string, conn: Conn): string {
  const type = String(conn.type ?? 0);
  return [
    field(`${prefix}.host`, t("POPUPS_DOMAIN.LABEL_SERVER", "Server"), String(conn.host || "")),
    field(`${prefix}.port`, t("POPUPS_DOMAIN.LABEL_PORT", "Port"), String(conn.port ?? ""), "inputmode=\"numeric\""),
    `<label class="field"><span>${esc(t("POPUPS_DOMAIN.LABEL_SECURE", "Sicherheit"))}</span><select name="${prefix}.type">${SECURE.map(([value, label]) => [value, value === "0" ? t("APP_TEXT.NONE", "Ohne") : label] as [string, string]).map(([id, label]) => `<option value="${id}"${id === type ? " selected" : ""}>${esc(id === "0" ? t("POPUPS_DOMAIN.SECURE_OPTION_NONE", label) : label)}</option>`).join("")}</select></label>`,
    field(`${prefix}.timeout`, t("POPUPS_DOMAIN.TIMEOUT", "Timeout"), String(conn.timeout ?? ""), "inputmode=\"numeric\""),
    check(`${prefix}.shortLogin`, t("POPUPS_DOMAIN.LABEL_USE_SHORT_LOGIN", "Kurze Benutzernamen verwenden"), Boolean(conn.shortLogin)),
    check(`${prefix}.lowerLogin`, t("POPUPS_DOMAIN.LABEL_LOWERCASE_LOGIN", "Login in Kleinbuchstaben konvertieren"), Boolean(conn.lowerLogin)),
    field(`${prefix}.stripLogin`, t("APP_TEXT.REMOVE_LOGIN_SUFFIX", "Login-Suffix entfernen"), String(conn.stripLogin || ""))
  ].join("");
}

function readDomain(form: HTMLFormElement, previous: DomainBody, existed: boolean): Record<string, unknown> {
  const data = new FormData(form);
  const text = (name: string) => String(data.get(name) || "");
  const on = (name: string) => Boolean(form.querySelector<HTMLInputElement>(`[name='${name}']`)?.checked);
  const block = (prefix: string, extra: Record<string, unknown>, prior?: Conn) => ({
    host: text(`${prefix}.host`),
    port: Number(text(`${prefix}.port`) || 0),
    type: Number(text(`${prefix}.type`) || 0),
    timeout: Number(text(`${prefix}.timeout`) || 0),
    shortLogin: on(`${prefix}.shortLogin`),
    lowerLogin: on(`${prefix}.lowerLogin`),
    stripLogin: text(`${prefix}.stripLogin`),
    sasl: prior?.sasl || [],
    ssl: prior?.ssl || {},
    ...extra
  });
  return {
    name: text("name").trim().toLowerCase(),
    create: existed ? 0 : 1,
    whiteList: text("whiteList"),
    IMAP: block("IMAP", {
      message_list_limit: Number(text("IMAP.message_list_limit") || 0),
      search_filter: text("IMAP.search_filter"),
      spam_headers: text("IMAP.spam_headers"),
      virus_headers: text("IMAP.virus_headers"),
      expunge_all_on_delete: on("IMAP.use_expunge_all_on_delete"),
      fast_simple_search: on("IMAP.fast_simple_search"),
      force_select: on("IMAP.force_select"),
      message_all_headers: on("IMAP.message_all_headers"),
      disabled_capabilities: CAPS.filter((cap) => on(`cap-${cap}`))
    }, previous.IMAP),
    SMTP: block("SMTP", {
      useAuth: on("SMTP.useAuth"),
      setSender: on("SMTP.setSender"),
      usePhpMail: on("SMTP.usePhpMail"),
      authPlainLine: on("SMTP.authPlainLine")
    }, previous.SMTP),
    Sieve: block("Sieve", {
      enabled: on("Sieve.enabled"),
      authLiteral: on("Sieve.authLiteral")
    }, previous.Sieve)
  };
}

async function saveDomain(ctx: Ctx, slot: HTMLElement, dialog: HTMLDialogElement, existed: boolean, previous: DomainBody): Promise<void> {
  const form = dialog.querySelector("form");
  if (!form) return;
  try {
    await ctx.call("AdminDomainSave", readDomain(form, previous, existed));
    dialog.close();
    await loadList(ctx, slot);
  } catch (error) {
    result(dialog, explain(error));
  }
}

async function testDomain(ctx: Ctx, dialog: HTMLDialogElement, previous: DomainBody): Promise<void> {
  const form = dialog.querySelector("form");
  if (!form) return;
  const payload = readDomain(form, previous, true);
  const data = new FormData(form);
  try {
    const answer = await ctx.call<Record<string, unknown>>("AdminDomainTest", {
      ...payload,
      auth: { user: String(data.get("authUser") || ""), pass: String(data.get("authPass") || "") }
    });
    result(dialog, ["IMAP", "SMTP", "Sieve"].map((name) => `${name}: ${answer[name] === true ? "ok" : String(answer[name] || "")}`).join("\n"));
  } catch (error) {
    result(dialog, explain(error));
  }
}

async function auto(ctx: Ctx, dialog: HTMLDialogElement): Promise<void> {
  const form = dialog.querySelector("form");
  if (!form) return;
  const name = String(new FormData(form).get("name") || "").trim().toLowerCase();
  try {
    const answer = await ctx.call<{ config?: { incomingServer?: Array<Record<string, string>>; outgoingServer?: Array<Record<string, string>> } }>("AdminDomainAutoconfig", { domain: name });
    const incoming = answer.config?.incomingServer?.[0];
    const outgoing = answer.config?.outgoingServer?.[0];
    applyServer(form, "IMAP", incoming);
    applyServer(form, "SMTP", outgoing);
    result(dialog, answer.config ? t("UI.SAVED", "Gespeichert.") : t("ERRORS.UNKNOWN_ERROR", "Keine Autoconfig gefunden."));
  } catch (error) {
    result(dialog, explain(error));
  }
}

function applyServer(form: HTMLFormElement, prefix: string, server?: Record<string, string>): void {
  if (!server) return;
  const host = form.querySelector<HTMLInputElement>(`[name='${prefix}.host']`);
  const port = form.querySelector<HTMLInputElement>(`[name='${prefix}.port']`);
  const type = form.querySelector<HTMLSelectElement>(`[name='${prefix}.type']`);
  if (host && server.hostname) host.value = server.hostname;
  if (port && server.port) port.value = server.port;
  if (type && server.socketType) {
    const socket = server.socketType.toUpperCase();
    type.value = socket.includes("SSL") ? "1" : socket.includes("START") ? "2" : "0";
  }
}

async function match(ctx: Ctx, dialog: HTMLDialogElement): Promise<void> {
  const form = dialog.querySelector("form");
  if (!form) return;
  const username = String(new FormData(form).get("matchUser") || "");
  try {
    const answer = await ctx.call<Record<string, unknown>>("AdminDomainMatch", { username });
    result(dialog, `email ${String(answer.email || "")}\nlogin ${String(answer.login || "")}\nname ${String(answer.name || "")}\nwhitelist ${String(answer.whitelist)}`);
  } catch (error) {
    result(dialog, explain(error));
  }
}

function result(dialog: HTMLDialogElement, text: string): void {
  const box = dialog.querySelector("[data-for='tools']") as HTMLElement | null;
  const out = dialog.querySelector("[data-for='result']") as HTMLElement | null;
  if (box) box.hidden = false;
  if (out) out.textContent = text;
}

function openAlias(ctx: Ctx, slot: HTMLElement, alias: string): void {
  const dialog = slot.querySelector("#domain-dialog") as HTMLDialogElement | null;
  if (!dialog) return;
  dialog.innerHTML = `<form class="dialog-body">
    <h2 class="title title-md">${esc(t("POPUPS_DOMAIN_ALIAS.TITLE_ADD_DOMAIN_ALIAS", "Alias hinzufügen"))}</h2>
    ${field("alias", t("POPUPS_DOMAIN_ALIAS.LABEL_ALIAS", "Alias"), alias)}
    ${field("name", t("POPUPS_DOMAIN_ALIAS.LABEL_DOMAIN", "Domain"), "")}
    <div class="action">
      <button type="button" class="ink-btn" data-action="save">${esc(t("GLOBAL.SAVE", "Speichern"))}</button>
      <button type="button" class="text-btn" value="cancel">${esc(t("GLOBAL.CANCEL", "Abbrechen"))}</button>
    </div>
    <p class="error" data-for="alias" hidden></p>
  </form>`;
  dialog.querySelector("[value='cancel']")?.addEventListener("click", () => dialog.close());
  dialog.querySelector("[data-action='save']")?.addEventListener("click", () => {
    const form = dialog.querySelector("form");
    if (!form) return;
    const data = new FormData(form);
    void ctx.call("AdminDomainAliasSave", {
      alias: String(data.get("alias") || ""),
      name: String(data.get("name") || "")
    }).then(async () => {
      dialog.close();
      await loadList(ctx, slot);
    }).catch((error) => {
      const out = dialog.querySelector("[data-for='alias']") as HTMLElement;
      out.hidden = false;
      out.textContent = explain(error);
    });
  });
  dialog.showModal();
}
