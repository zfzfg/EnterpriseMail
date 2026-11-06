import { adminCall, explain, loadAdminApp } from "./api";
import { t } from "./i18n";
import { applyAppearance, readAppearance, watchSystemTheme } from "./theme";

applyAppearance(readAppearance());
watchSystemTheme(() => applyAppearance(readAppearance()));

interface Domain {
  name: string;
  disabled: boolean;
  alias: boolean;
}

interface AdminData {
  Auth?: boolean;
  weakPassword?: boolean;
  Admin?: { path?: string };
}

let adminKey = "admin";

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  }[char] ?? char));
}

function boot(root: HTMLElement): void {
  void start(root);
}

async function start(root: HTMLElement): Promise<void> {
  try {
    const data = await loadAdminApp() as AdminData;
    adminKey = data.Admin?.path || "admin";
    if (data.Auth) await showDomains(root, Boolean(data.weakPassword));
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
    const data = await adminCall<AdminData>(adminKey, "AdminLogin", { Login: login.trim(), Password: password, TOTP: totp });
    if (data.Admin?.path) adminKey = data.Admin.path;
    await showDomains(root, Boolean(data.weakPassword));
  } catch (error) {
    button.disabled = false;
    slot.hidden = false;
    slot.textContent = explain(error);
  }
}

async function showDomains(root: HTMLElement, weak: boolean): Promise<void> {
  root.innerHTML = `
    <main class="admin">
      <div class="admin-head">
        <h1 class="title">${esc(t("TOP_PANEL.LABEL_ADMIN_PANEL", "Adminpanel"))}</h1>
        <span class="spacer"></span>
        <button type="button" class="text-btn" data-action="logout">${esc(t("GLOBAL.LOGOUT", "Abmelden"))}</button>
      </div>
      ${weak ? `<p class="error">${esc(t("TAB_DOMAINS.WEAK_PASSWORD", "Das Admin-Passwort steht noch in der Standarddatei."))}</p>` : ""}
      <p class="mono">${esc(t("SETTINGS_LABELS.DOMAINS", "Domains"))}</p>
      <p class="error" id="admin-error" hidden></p>
      <ul class="set-list" id="domains"></ul>
      <dialog id="confirm" aria-labelledby="confirm-title">
        <div class="dialog-body">
          <h2 id="confirm-title" class="title title-md">${esc(t("TAB_DOMAINS.DELETE_ARE_YOU_SURE", "Sind Sie sicher?"))}</h2>
          <div class="dialog-actions">
            <button type="button" class="text-btn" value="cancel">${esc(t("GLOBAL.CANCEL", "Abbrechen"))}</button>
            <button type="button" class="danger" value="ok">${esc(t("GLOBAL.DELETE", "Löschen"))}</button>
          </div>
        </div>
      </dialog>
    </main>`;
  const dialog = root.querySelector("#confirm") as HTMLDialogElement;
  dialog.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest("button");
    if (button) dialog.close(button.value);
  });
  root.querySelector("[data-action='logout']")?.addEventListener("click", () => {
    void adminCall(adminKey, "AdminLogout").finally(() => showLogin(root, ""));
  });
  await paintDomains(root);
}

async function paintDomains(root: HTMLElement): Promise<void> {
  const list = root.querySelector("#domains");
  const slot = root.querySelector("#admin-error") as HTMLElement | null;
  if (!list || !slot) return;
  try {
    const result = await adminCall<unknown>(adminKey, "AdminDomainList", { includeAliases: "1" });
    const domains = (Array.isArray(result) ? result : Object.values(result || {})) as Domain[];
    if (!domains.length) {
      list.innerHTML = `<li class="quiet">${esc(t("TAB_DOMAINS.EMPTY", "Keine Domains."))}</li>`;
      return;
    }
    list.innerHTML = domains.map((item) => {
      const name = String(item.name || "");
      const meta = [item.alias ? t("TAB_DOMAINS.LABEL_ALIAS", "Alias") : "", item.disabled ? t("GLOBAL.INACTIVE", "Inaktiv") : ""].filter(Boolean).join(" · ");
      const toggle = item.disabled
        ? t("TAB_DOMAINS.BUTTON_ENABLE", "Aktivieren")
        : t("TAB_DOMAINS.BUTTON_DISABLE", "Deaktivieren");
      return `<li class="set-row"><span class="grow"><strong title="${esc(name)}">${esc(name)}</strong>${meta ? `<span class="quiet">${esc(meta)}</span>` : ""}</span><button type="button" class="text-btn" data-action="toggle" data-name="${esc(name)}" data-disabled="${item.disabled ? "1" : "0"}">${esc(toggle)}</button><button type="button" class="danger" data-action="delete" data-name="${esc(name)}">${esc(t("GLOBAL.DELETE", "Löschen"))}</button></li>`;
    }).join("");
    list.querySelectorAll<HTMLButtonElement>("[data-action='toggle']").forEach((button) => {
      button.addEventListener("click", () => {
        void run(root, () => adminCall(adminKey, "AdminDomainDisable", {
          name: button.dataset.name || "",
          disabled: button.dataset.disabled === "1" ? "0" : "1"
        }));
      });
    });
    list.querySelectorAll<HTMLButtonElement>("[data-action='delete']").forEach((button) => {
      button.addEventListener("click", () => {
        void removeDomain(root, button.dataset.name || "");
      });
    });
  } catch (error) {
    slot.hidden = false;
    slot.textContent = explain(error);
  }
}

async function removeDomain(root: HTMLElement, name: string): Promise<void> {
  const dialog = root.querySelector("#confirm") as HTMLDialogElement | null;
  if (!dialog || !name) return;
  dialog.showModal();
  const ok = await new Promise<boolean>((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok"), { once: true });
  });
  if (!ok) return;
  await run(root, () => adminCall(adminKey, "AdminDomainDelete", { name }));
}

async function run(root: HTMLElement, task: () => Promise<unknown>): Promise<void> {
  const slot = root.querySelector("#admin-error") as HTMLElement | null;
  try {
    await task();
    if (slot) slot.hidden = true;
    await paintDomains(root);
  } catch (error) {
    if (slot) {
      slot.hidden = false;
      slot.textContent = explain(error);
    }
  }
}

const root = document.getElementById("app");
if (root) boot(root);
