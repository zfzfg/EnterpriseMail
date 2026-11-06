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
  const text = known[error.code] || error.message || "Die Anfrage ist fehlgeschlagen.";
  return error.detail ? `${text} ${error.detail}` : text;
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
function loadAdminApp() {
  return readApp(`${root()}?/AdminAppData/0/${Math.random().toString().slice(2)}/`);
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
function adminCall(adminKey2, action, params = {}) {
  const key = /^[a-z0-9._-]+$/i.test(adminKey2) && !adminKey2.includes("..") ? adminKey2 : "admin";
  return postJson(`${root()}?/${key}/Json/&q[]=/0/`, action, params);
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

// src/admin.ts
applyAppearance(readAppearance());
watchSystemTheme(() => applyAppearance(readAppearance()));
var adminKey = "admin";
function esc(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char] ?? char);
}
function boot(root3) {
  void start(root3);
}
async function start(root3) {
  try {
    const data = await loadAdminApp();
    adminKey = data.Admin?.path || "admin";
    if (data.Auth) await showDomains(root3, Boolean(data.weakPassword));
    else showLogin(root3, "");
  } catch (error) {
    root3.replaceChildren(Object.assign(document.createElement("p"), {
      className: "error",
      textContent: explain(error)
    }));
  }
}
function showLogin(root3, error) {
  root3.innerHTML = `
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
  const form = root3.querySelector("form");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    void submitLogin(root3, form, String(data.get("login") || ""), String(data.get("password") || ""), String(data.get("totp") || ""));
  });
}
async function submitLogin(root3, form, login, password, totp) {
  const slot = form.querySelector("[data-for='form']");
  const button = form.querySelector("button");
  if (!login.trim() || !password) {
    slot.hidden = false;
    slot.textContent = "Benutzer und Passwort eintragen.";
    return;
  }
  button.disabled = true;
  slot.hidden = true;
  try {
    const data = await adminCall(adminKey, "AdminLogin", { Login: login.trim(), Password: password, TOTP: totp });
    if (data.Admin?.path) adminKey = data.Admin.path;
    await showDomains(root3, Boolean(data.weakPassword));
  } catch (error) {
    button.disabled = false;
    slot.hidden = false;
    slot.textContent = explain(error);
  }
}
async function showDomains(root3, weak) {
  root3.innerHTML = `
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
            <button type="button" class="danger" value="ok">${esc(t("GLOBAL.DELETE", "L\xF6schen"))}</button>
          </div>
        </div>
      </dialog>
    </main>`;
  const dialog = root3.querySelector("#confirm");
  dialog.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (button) dialog.close(button.value);
  });
  root3.querySelector("[data-action='logout']")?.addEventListener("click", () => {
    void adminCall(adminKey, "AdminLogout").finally(() => showLogin(root3, ""));
  });
  await paintDomains(root3);
}
async function paintDomains(root3) {
  const list = root3.querySelector("#domains");
  const slot = root3.querySelector("#admin-error");
  if (!list || !slot) return;
  try {
    const result = await adminCall(adminKey, "AdminDomainList", { includeAliases: "1" });
    const domains = Array.isArray(result) ? result : Object.values(result || {});
    if (!domains.length) {
      list.innerHTML = `<li class="quiet">${esc(t("TAB_DOMAINS.EMPTY", "Keine Domains."))}</li>`;
      return;
    }
    list.innerHTML = domains.map((item) => {
      const name = String(item.name || "");
      const meta = [item.alias ? t("TAB_DOMAINS.LABEL_ALIAS", "Alias") : "", item.disabled ? t("GLOBAL.INACTIVE", "Inaktiv") : ""].filter(Boolean).join(" \xB7 ");
      const toggle = item.disabled ? t("TAB_DOMAINS.BUTTON_ENABLE", "Aktivieren") : t("TAB_DOMAINS.BUTTON_DISABLE", "Deaktivieren");
      return `<li class="set-row"><span class="grow"><strong title="${esc(name)}">${esc(name)}</strong>${meta ? `<span class="quiet">${esc(meta)}</span>` : ""}</span><button type="button" class="text-btn" data-action="toggle" data-name="${esc(name)}" data-disabled="${item.disabled ? "1" : "0"}">${esc(toggle)}</button><button type="button" class="danger" data-action="delete" data-name="${esc(name)}">${esc(t("GLOBAL.DELETE", "L\xF6schen"))}</button></li>`;
    }).join("");
    list.querySelectorAll("[data-action='toggle']").forEach((button) => {
      button.addEventListener("click", () => {
        void run(root3, () => adminCall(adminKey, "AdminDomainDisable", {
          name: button.dataset.name || "",
          disabled: button.dataset.disabled === "1" ? "0" : "1"
        }));
      });
    });
    list.querySelectorAll("[data-action='delete']").forEach((button) => {
      button.addEventListener("click", () => {
        void removeDomain(root3, button.dataset.name || "");
      });
    });
  } catch (error) {
    slot.hidden = false;
    slot.textContent = explain(error);
  }
}
async function removeDomain(root3, name) {
  const dialog = root3.querySelector("#confirm");
  if (!dialog || !name) return;
  dialog.showModal();
  const ok = await new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok"), { once: true });
  });
  if (!ok) return;
  await run(root3, () => adminCall(adminKey, "AdminDomainDelete", { name }));
}
async function run(root3, task) {
  const slot = root3.querySelector("#admin-error");
  try {
    await task();
    if (slot) slot.hidden = true;
    await paintDomains(root3);
  } catch (error) {
    if (slot) {
      slot.hidden = false;
      slot.textContent = explain(error);
    }
  }
}
var root2 = document.getElementById("app");
if (root2) boot(root2);
