import { explain } from "../api";
import { icon } from "../icons";
import { t } from "../i18n";
import { bind, cell, check, DUMMY, esc, field, flag, langSelect, select, type Ctx } from "./util";

export function paintGeneral(ctx: Ctx, slot: HTMLElement): void {
  const langs = ctx.app.Admin?.languages || ["de", "en"];
  slot.innerHTML = `<form class="fields">
    <h2 class="title title-md">${esc(t("TAB_GENERAL.LEGEND_MAIN", "Allgemein"))}</h2>
    ${langSelect("language", t("TAB_GENERAL.LABEL_LANGUAGE", "Sprache"), String(cell(ctx.cfg, "webmail", "language") || ""), langs)}
    ${langSelect("languageAdmin", t("TAB_GENERAL.LABEL_LANGUAGE_ADMIN", "Sprache (Adminpanel)"), String(ctx.app.Admin?.language || cell(ctx.cfg, "admin_panel", "language") || ""), langs)}
    ${field("attachmentLimit", t("TAB_GENERAL.LABEL_ATTACHMENT_SIZE_LIMIT", "Größenlimit für Anhänge"), String(cell(ctx.cfg, "webmail", "attachment_size_limit") ?? ""), "inputmode=\"numeric\"")}
    <p class="quiet">${esc(t("UI.MB", "Angabe in MB. 0 hebt die Grenze auf."))}</p>
    ${check("allowLanguagesOnSettings", t("TAB_GENERAL.LABEL_ALLOW_LANGUAGES_ON_SETTINGS", "Sprachauswahl in den Einstellungen zulassen"), flag(cell(ctx.cfg, "webmail", "allow_languages_on_settings")))}
    <button type="button" class="ink-btn" data-save>${esc(t("GLOBAL.SAVE", "Speichern"))}</button>
  </form>`;
  bind(ctx, slot);
}

export function paintLogin(ctx: Ctx, slot: HTMLElement): void {
  slot.innerHTML = `<form class="fields">
    <h2 class="title title-md">${esc(t("TAB_LOGIN.LEGEND_LOGIN_SCREEN", "Anmeldebildschirm"))}</h2>
    ${field("loginDefaultDomain", t("TAB_LOGIN.LABEL_DEFAULT_DOMAIN", "Standarddomain"), String(cell(ctx.cfg, "login", "default_domain") || ""))}
    ${check("determineUserDomain", t("TAB_LOGIN.LABEL_DETERMINE_USER_DOMAIN", "Domain des Benutzers automatisch ermitteln"), flag(cell(ctx.cfg, "login", "determine_user_domain")))}
    ${check("allowLanguagesOnLogin", t("TAB_LOGIN.LABEL_ALLOW_LANGUAGES_ON_LOGIN", "Sprachauswahl bei der Anmeldung zulassen"), flag(cell(ctx.cfg, "login", "allow_languages_on_login")))}
    ${check("determineUserLanguage", t("TAB_LOGIN.LABEL_DETERMINE_USER_LANGUAGE", "Sprache des Benutzers automatisch ermitteln"), flag(cell(ctx.cfg, "login", "determine_user_language")))}
    <button type="button" class="ink-btn" data-save>${esc(t("GLOBAL.SAVE", "Speichern"))}</button>
  </form>`;
  bind(ctx, slot);
}

export function paintBranding(ctx: Ctx, slot: HTMLElement): void {
  slot.innerHTML = `<form class="fields">
    <h2 class="title title-md">${esc(t("TAB_BRANDING.LEGEND_BRANDING", "Branding"))}</h2>
    ${field("title", t("TAB_BRANDING.LABEL_PAGE_TITLE", "Seitentitel"), String(cell(ctx.cfg, "webmail", "title") || ""))}
    ${field("loadingDescription", t("TAB_BRANDING.LABEL_LOADING_DESCRIPTION", "Beschreibungstext für Ladevorgang"), String(cell(ctx.cfg, "webmail", "loading_description") || ""))}
    ${field("faviconUrl", t("TAB_BRANDING.LABEL_FAVICON_URL", "Favicon"), String(cell(ctx.cfg, "webmail", "favicon_url") || ""))}
    <button type="button" class="ink-btn" data-save>${esc(t("GLOBAL.SAVE", "Speichern"))}</button>
  </form>`;
  bind(ctx, slot);
}

export function paintContacts(ctx: Ctx, slot: HTMLElement): void {
  const drivers = (ctx.app.supportedPdoDrivers || ["sqlite"]).map((id) => [id, id] as [string, string]);
  const type = String(cell(ctx.cfg, "contacts", "type") || "sqlite");
  slot.innerHTML = `<form class="fields">
    <h2 class="title title-md">${esc(t("TAB_CONTACTS.LEGEND_STORAGE", "Speicher (PDO)"))}</h2>
    ${check("contactsEnable", t("TAB_CONTACTS.LABEL_ENABLE_CONTACTS", "Kontakte aktivieren"), flag(cell(ctx.cfg, "contacts", "enable")))}
    ${check("contactsSync", t("TAB_CONTACTS.LABEL_ALLOW_SYNC", "Synchronisierung von Kontakten erlauben (mit externem CardDAV-Server)"), flag(cell(ctx.cfg, "contacts", "allow_sync")))}
    ${select("contactsPdoType", t("TAB_CONTACTS.LABEL_STORAGE_TYPE", "Typ"), type, drivers)}
    ${field("contactsPdoDsn", t("TAB_CONTACTS.LABEL_STORAGE_DSN", "DSN"), String(cell(ctx.cfg, "contacts", "pdo_dsn") || ""))}
    ${field("contactsPdoUser", t("TAB_CONTACTS.LABEL_STORAGE_USER", "Benutzer"), String(cell(ctx.cfg, "contacts", "pdo_user") || ""))}
    ${field("contactsPdoPassword", t("TAB_CONTACTS.LABEL_STORAGE_PASSWORD", "Passwort"), DUMMY, "type=\"password\" autocomplete=\"new-password\"")}
    ${field("contactsMySQLSSLCA", "MySQL SSL CA", String(cell(ctx.cfg, "contacts", "mysql_ssl_ca") || ""))}
    ${check("contactsMySQLSSLVerify", t("APP_TEXT.VERIFY_MYSQL_SSL", "MySQL SSL prüfen"), flag(cell(ctx.cfg, "contacts", "mysql_ssl_verify")))}
    ${field("contactsMySQLSSLCiphers", "MySQL SSL Ciphers", String(cell(ctx.cfg, "contacts", "mysql_ssl_ciphers") || ""))}
    ${check("contactsSQLiteGlobal", t("TAB_CONTACTS.SQLITE_GLOBAL", "Eine globale DB verwenden statt einer pro Account"), flag(cell(ctx.cfg, "contacts", "sqlite_global")))}
    ${field("contactsSuggestionsLimit", t("TAB_CONTACTS.SUGGESTIONS_LIMIT", "Limit für Empfehlungen"), String(cell(ctx.cfg, "contacts", "suggestions_limit") ?? "20"), "inputmode=\"numeric\"")}
    <div class="action">
      <button type="button" class="ink-btn" data-save>${esc(t("GLOBAL.SAVE", "Speichern"))}</button>
      <button type="button" class="text-btn" data-action="test">${icon("check")}<span class="btn-label">${esc(t("GLOBAL.TEST", "Testen"))}</span></button>
    </div>
    <p class="quiet" data-for="test" hidden></p>
  </form>`;
  bind(ctx, slot);
  slot.querySelector("[data-action='test']")?.addEventListener("click", () => { void testContacts(ctx, slot); });
}

async function testContacts(ctx: Ctx, slot: HTMLElement): Promise<void> {
  const form = slot.querySelector("form");
  const out = slot.querySelector("[data-for='test']") as HTMLElement | null;
  if (!form || !out) return;
  const data = new FormData(form);
  out.hidden = false;
  out.textContent = t("TAB_ABOUT.LABEL_CHECKING", "Überprüfe auf Aktualisierungen");
  try {
    const result = await ctx.call<{ Result?: boolean; Message?: string }>("AdminContactsTest", {
      PdoType: String(data.get("contactsPdoType") || ""),
      PdoDsn: String(data.get("contactsPdoDsn") || ""),
      PdoUser: String(data.get("contactsPdoUser") || ""),
      PdoPassword: String(data.get("contactsPdoPassword") || ""),
      MySQLSSLCA: String(data.get("contactsMySQLSSLCA") || ""),
      MySQLSSLVerify: form.querySelector<HTMLInputElement>("[name='contactsMySQLSSLVerify']")?.checked ? "1" : "0",
      MySQLSSLCiphers: String(data.get("contactsMySQLSSLCiphers") || ""),
      SQLiteGlobal: form.querySelector<HTMLInputElement>("[name='contactsSQLiteGlobal']")?.checked ? "1" : "0"
    });
    out.textContent = result.Result ? t("UI.SAVED", "Verbindung in Ordnung.") : (result.Message || t("ERRORS.UNKNOWN_ERROR", "Unbekannter Fehler"));
  } catch (error) {
    out.textContent = explain(error);
  }
}

export function paintSecurity(ctx: Ctx, slot: HTMLElement): void {
  slot.innerHTML = `<form class="fields" id="security-form">
    <h2 class="title title-md">${esc(t("TAB_SECURITY.LEGEND_SECURITY", "Sicherheit"))}</h2>
    ${check("proxyExternalImages", t("TAB_SECURITY.LABEL_USE_IMAGE_PROXY", "Lokalen Proxy für externe Bilder verwenden"), flag(cell(ctx.cfg, "labs", "use_local_proxy_for_external_images")))}
    ${check("autoVerifySignatures", t("TAB_SECURITY.LABEL_AUTO_VERIFY", "Signaturen automatisch überprüfen"), flag(cell(ctx.cfg, "security", "auto_verify_signatures")))}
    ${check("CapaAdditionalAccounts", t("TAB_GENERAL.LABEL_ALLOW_ADDITIONAL_ACCOUNTS", "Zusätzliche Konten erlauben"), flag(cell(ctx.cfg, "webmail", "allow_additional_accounts")))}
    ${check("CapaIdentities", t("TAB_GENERAL.LABEL_ALLOW_IDENTITIES", "Mehrere Identitäten erlauben"), flag(cell(ctx.cfg, "webmail", "allow_additional_identities")))}
    ${check("CapaAttachmentThumbnails", t("TAB_GENERAL.LABEL_SHOW_THUMBNAILS", "Vorschaubilder anzeigen (Anhänge)"), flag(cell(ctx.cfg, "interface", "show_attachment_thumbnail")))}
    ${check("capaGnuPG", t("UI.GNUPG", "GnuPG erlauben"), flag(cell(ctx.cfg, "security", "gnupg")))}
    ${check("capaOpenPGP", t("UI.OPENPGP", "OpenPGP erlauben"), flag(cell(ctx.cfg, "security", "openpgp")))}
    ${check("pluginsEnable", t("TAB_PACKAGES.LABEL_ENABLE_PLUGINS", "Erweiterungen aktivieren"), flag(cell(ctx.cfg, "plugins", "enable")))}
    <button type="button" class="ink-btn" data-save>${esc(t("GLOBAL.SAVE", "Speichern"))}</button>
  </form>
  <form class="fields" id="access-form">
    <h2 class="title title-md">${esc(t("TAB_SECURITY.LEGEND_ADMIN_PANEL_ACCESS_CREDENTIALS", "Adminpanel-Zugangsdaten"))}</h2>
    ${field("Login", t("GLOBAL.USERNAME", "Nutzername"), String(ctx.app.adminLogin || "admin"), "autocomplete=\"username\"")}
    ${field("Password", t("TAB_SECURITY.LABEL_CURRENT_PASSWORD", "Aktuelles Passwort"), "", "type=\"password\" autocomplete=\"current-password\" required")}
    ${field("newPassword", t("TAB_SECURITY.LABEL_NEW_PASSWORD", "Neues Passwort"), "", "type=\"password\" autocomplete=\"new-password\"")}
    ${field("repeat", t("TAB_SECURITY.LABEL_REPEAT_PASSWORD", "Wiederholen"), "", "type=\"password\" autocomplete=\"new-password\"")}
    ${field("TOTP", t("LOGIN.LABEL_TOTP", "TOTP-Code"), String(ctx.app.adminTOTP || ""), "autocomplete=\"off\" spellcheck=\"false\"")}
    <div class="action">
      <button type="button" class="ink-btn" data-action="password">${esc(t("GLOBAL.SAVE", "Speichern"))}</button>
      <button type="button" class="text-btn" data-action="qr">${icon("key")}<span class="btn-label">${esc(t("UI.TOTP_SETUP", "TOTP einrichten"))}</span></button>
      <button type="button" class="text-btn" data-action="clear-totp">${esc(t("UI.TOTP_CLEAR", "TOTP entfernen"))}</button>
    </div>
    <div data-for="qr" hidden></div>
    <p class="quiet" data-for="access" hidden></p>
  </form>`;
  bind(ctx, slot);
  slot.querySelector("[data-action='password']")?.addEventListener("click", () => { void saveAccess(ctx, slot, false); });
  slot.querySelector("[data-action='qr']")?.addEventListener("click", () => { void setupTotp(ctx, slot); });
  slot.querySelector("[data-action='clear-totp']")?.addEventListener("click", () => {
    const input = slot.querySelector<HTMLInputElement>("[name='TOTP']");
    if (input) input.value = "";
    void saveAccess(ctx, slot, true);
  });
}

async function saveAccess(ctx: Ctx, slot: HTMLElement, clearTotp: boolean): Promise<void> {
  const form = slot.querySelector("#access-form") as HTMLFormElement | null;
  const out = slot.querySelector("[data-for='access']") as HTMLElement | null;
  if (!form || !out) return;
  const data = new FormData(form);
  const next = String(data.get("newPassword") || "");
  const repeat = String(data.get("repeat") || "");
  if (next && next !== repeat) {
    out.hidden = false;
    out.textContent = t("UI.PASSWORD_MISMATCH", "Die neuen Passwörter stimmen nicht überein.");
    return;
  }
  out.hidden = true;
  try {
    const result = await ctx.call<{ Weak?: boolean } | false>("AdminPasswordUpdate", {
      Login: String(data.get("Login") || ""),
      Password: String(data.get("Password") || ""),
      newPassword: next,
      TOTP: clearTotp ? "" : String(data.get("TOTP") || "")
    });
    if (!result) throw new Error(t("ERRORS.UNKNOWN_ERROR", "Unbekannter Fehler"));
    await ctx.reload();
    out.hidden = false;
    out.textContent = result.Weak
      ? t("TAB_DOMAINS.WEAK_PASSWORD", "Das Admin-Passwort steht noch in der Standarddatei.")
      : t("UI.SAVED", "Gespeichert.");
  } catch (error) {
    out.hidden = false;
    out.textContent = explain(error);
  }
}

function secret(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => alphabet[byte % 32]).join("");
}

async function setupTotp(ctx: Ctx, slot: HTMLElement): Promise<void> {
  const input = slot.querySelector<HTMLInputElement>("[name='TOTP']");
  const box = slot.querySelector("[data-for='qr']") as HTMLElement | null;
  const user = slot.querySelector<HTMLInputElement>("[name='Login']");
  if (!input || !box) return;
  const value = secret();
  input.value = value;
  try {
    const svg = await ctx.call<string>("AdminQRCode", { username: user?.value || "admin", TOTP: value });
    box.hidden = false;
    if (typeof svg === "string" && svg.trim().startsWith("<svg")) box.innerHTML = svg;
    else {
      box.textContent = typeof svg === "string" ? svg : "";
    }
  } catch (error) {
    ctx.note(explain(error), true);
  }
}

