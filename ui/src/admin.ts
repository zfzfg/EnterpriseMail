import { adminCall, explain, loadAdminApp } from "./api";
import { paintAbout } from "./admin/about";
import { paintConfig } from "./admin/config";
import { paintDomains } from "./admin/domains";
import { paintPackages } from "./admin/packages";
import { paintBranding, paintContacts, paintGeneral, paintLogin, paintSecurity } from "./admin/settings-forms";
import { esc, type AppSnap, type Cfg, type Ctx, type Section } from "./admin/util";
import { icon } from "./icons";
import { t } from "./i18n";
import { applyAppearance, readAppearance, watchSystemTheme } from "./theme";

applyAppearance(readAppearance());
watchSystemTheme(() => applyAppearance(readAppearance()));

const NAV: Array<[Section, string, string]> = [
  ["general", "SETTINGS_LABELS.GENERAL", "Allgemein"],
  ["login", "SETTINGS_LABELS.LOGIN", "Anmeldung"],
  ["domains", "SETTINGS_LABELS.DOMAINS", "Domains"],
  ["contacts", "SETTINGS_LABELS.CONTACTS", "Kontakte"],
  ["security", "SETTINGS_LABELS.SECURITY", "Sicherheit"],
  ["branding", "SETTINGS_LABELS.BRANDING", "Branding"],
  ["packages", "UI.PLUGINS", "Plugins und Pakete"],
  ["config", "SETTINGS_LABELS.CONFIG", "Konfigurationsdatei"],
  ["about", "SETTINGS_LABELS.ABOUT", "Über"]
];

let adminKey = "admin";
let section: Section = "general";
let app: AppSnap = {};
let cfg: Cfg = {};

function boot(root: HTMLElement): void {
  void start(root);
}

async function start(root: HTMLElement): Promise<void> {
  try {
    const data = await loadAdminApp() as AppSnap & { Auth?: boolean };
    adminKey = data.Admin?.path || "admin";
    app = data;
    if (data.Auth) await showShell(root);
    else showLogin(root, "");
  } catch (error) {
    root.replaceChildren(Object.assign(document.createElement("p"), {
      className: "error",
      textContent: explain(error)
    }));
  }
}

function showLogin(root: HTMLElement, error: string): void {
  root.innerHTML = `
    <main class="login">
      <form class="login-card" novalidate>
        <h1 class="title">${esc(t("TOP_PANEL.LABEL_ADMIN_PANEL", "Adminpanel"))}</h1>
        <label class="field"><span>${esc(t("LOGIN.LABEL_LOGIN", "Benutzer"))}</span>
          <input name="login" type="text" autocomplete="username" required>
        </label>
        <label class="field"><span>${esc(t("GLOBAL.PASSWORD", "Passwort"))}</span>
          <input name="password" type="password" autocomplete="current-password" required>
        </label>
        <label class="field"><span>${esc(t("LOGIN.LABEL_TOTP", "TOTP-Code"))}</span>
          <input name="totp" type="text" inputmode="numeric" autocomplete="one-time-code">
        </label>
        <p class="quiet">${esc(t("LOGIN.TOTP_HINT", "Nur wenn eingerichtet."))}</p>
        <p class="error" data-for="form"${error ? "" : " hidden"}>${esc(error)}</p>
        <button type="submit" class="ink-btn">${esc(t("LOGIN.BUTTON_LOGIN", "Im Adminpanel anmelden"))}</button>
      </form>
    </main>`;
  const form = root.querySelector("form") as HTMLFormElement;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    void submitLogin(root, form, String(data.get("login") || ""), String(data.get("password") || ""), String(data.get("totp") || ""));
  });
  form.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
}

async function submitLogin(root: HTMLElement, form: HTMLFormElement, login: string, password: string, totp: string): Promise<void> {
  const slot = form.querySelector("[data-for='form']") as HTMLElement;
  const button = form.querySelector("button") as HTMLButtonElement;
  if (!login.trim() || !password) {
    slot.hidden = false;
    slot.textContent = "Benutzer und Passwort eintragen.";
    return;
  }
  button.disabled = true;
  slot.hidden = true;
  try {
    const data = await adminCall<AppSnap>(adminKey, "AdminLogin", { Login: login.trim(), Password: password, TOTP: totp });
    if (data.Admin?.path) adminKey = data.Admin.path;
    app = data;
    section = "general";
    await showShell(root);
  } catch (error) {
    button.disabled = false;
    slot.hidden = false;
    slot.textContent = explain(error);
  }
}

function ctx(root: HTMLElement): Ctx {
  return {
    key: adminKey,
    app,
    cfg,
    goto(next) {
      section = next;
      void showShell(root);
    },
    note(message, error = false) {
      const slot = root.querySelector("#admin-note") as HTMLElement | null;
      if (!slot) return;
      slot.hidden = !message;
      slot.className = error ? "error" : "quiet";
      slot.textContent = message;
    },
    async reload() {
      cfg = await adminCall<Cfg>(adminKey, "AdminSettingsGet");
      const fresh = await loadAdminApp() as AppSnap;
      if (fresh.Auth) app = fresh;
    },
    call(action, params = {}) {
      return adminCall(adminKey, action, params);
    }
  };
}

async function showShell(root: HTMLElement): Promise<void> {
  const keep = root.querySelector("#admin-slot");
  if (!keep) {
    root.innerHTML = `
      <main class="admin">
        <div class="admin-head">
          <h1 class="title">${esc(t("TOP_PANEL.LABEL_ADMIN_PANEL", "Adminpanel"))}</h1>
          <span class="spacer"></span>
          <button type="button" class="text-btn" data-action="logout">${icon("logout")}<span class="btn-label">${esc(t("GLOBAL.LOGOUT", "Abmelden"))}</span></button>
        </div>
        <div class="admin-layout">
          <nav class="settings-nav" aria-label="${esc(t("TOP_PANEL.LABEL_ADMIN_PANEL", "Adminpanel"))}"></nav>
          <div class="admin-main">
            <p class="error" id="weak" hidden></p>
            <p id="admin-note" hidden></p>
            <div id="admin-slot"></div>
          </div>
        </div>
      </main>`;
    root.querySelector("[data-action='logout']")?.addEventListener("click", () => {
      void adminCall(adminKey, "AdminLogout").finally(() => showLogin(root, ""));
    });
  }
  const nav = root.querySelector(".settings-nav");
  if (nav) {
    nav.innerHTML = NAV.map(([id, path, label]) =>
      `<button type="button" class="text-btn" data-section="${id}" aria-pressed="${id === section ? "true" : "false"}">${esc(t(path, label))}</button>`).join("");
    nav.querySelectorAll<HTMLButtonElement>("[data-section]").forEach((button) => {
      button.addEventListener("click", () => {
        section = (button.dataset.section || "general") as Section;
        void showShell(root);
      });
    });
  }
  const weak = root.querySelector("#weak") as HTMLElement | null;
  if (weak) {
    weak.hidden = !app.weakPassword;
    weak.innerHTML = "";
    if (app.weakPassword) {
      weak.append(t("TAB_DOMAINS.WEAK_PASSWORD", "Das Admin-Passwort steht noch in der Standarddatei."), " ");
      const link = document.createElement("button");
      link.type = "button";
      link.className = "text-btn";
      link.textContent = t("SETTINGS_LABELS.SECURITY", "Sicherheit");
      link.addEventListener("click", () => {
        section = "security";
        void showShell(root);
      });
      weak.append(link);
    }
  }
  try {
    if (!Object.keys(cfg).length) cfg = await adminCall<Cfg>(adminKey, "AdminSettingsGet");
  } catch (error) {
    ctx(root).note(explain(error), true);
  }
  const slot = root.querySelector("#admin-slot");
  if (!slot) return;
  slot.innerHTML = "";
  const current = ctx(root);
  if (section === "general") paintGeneral(current, slot as HTMLElement);
  else if (section === "login") paintLogin(current, slot as HTMLElement);
  else if (section === "branding") paintBranding(current, slot as HTMLElement);
  else if (section === "contacts") paintContacts(current, slot as HTMLElement);
  else if (section === "security") paintSecurity(current, slot as HTMLElement);
  else if (section === "domains") await paintDomains(current, slot as HTMLElement);
  else if (section === "packages") await paintPackages(current, slot as HTMLElement);
  else if (section === "config") paintConfig(current, slot as HTMLElement);
  else await paintAbout(current, slot as HTMLElement);
}

const root = document.getElementById("app");
if (root) boot(root);
