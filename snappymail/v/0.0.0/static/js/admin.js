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
var onExpired = null;
function root() {
  return location.pathname.replace(/\/+$/, "") + "/";
}
function explain(error) {
  if (!(error instanceof ApiError)) return t("NOTIFICATIONS.UnknownError", "Die Anfrage ist fehlgeschlagen.");
  const known = {
    101: ["NOTIFICATIONS.InvalidToken", "Die Sitzung ist abgelaufen. Seite neu laden."],
    102: ["NOTIFICATIONS.AuthError", "Anmeldung fehlgeschlagen. Adresse oder Passwort pr\xFCfen."],
    104: ["NOTIFICATIONS.ConnectionError", "Der Mailserver ist nicht erreichbar."],
    109: ["NOTIFICATIONS.DomainNotAllowed", "Diese Domain ist nicht erlaubt."],
    110: ["NOTIFICATIONS.AccountNotAllowed", "Dieses Konto ist nicht erlaubt."],
    140: ["NOTIFICATIONS.ContactsSyncError", "Die Kontakte konnten nicht synchronisiert werden."],
    201: ["NOTIFICATIONS.CantGetMessageList", "Die Liste konnte nicht geladen werden."],
    202: ["NOTIFICATIONS.CantGetMessage", "Der Brief konnte nicht geladen werden."],
    203: ["NOTIFICATIONS.CantDeleteMessage", "L\xF6schen ist fehlgeschlagen."],
    204: ["NOTIFICATIONS.CantMoveMessage", "Verschieben ist fehlgeschlagen."],
    302: ["NOTIFICATIONS.CantSendMessage", "Senden ist fehlgeschlagen."],
    303: ["NOTIFICATIONS.InvalidRecipients", "Empf\xE4nger pr\xFCfen."],
    901: ["NOTIFICATIONS.MailServerError", "Der Mailserver hat die Anfrage abgelehnt."]
  };
  const item = known[error.code];
  const text = item ? t(item[0], item[1]) : error.message || t("NOTIFICATIONS.UnknownError", "Die Anfrage ist fehlgeschlagen.");
  return error.detail ? `${text} ${error.detail}` : text;
}
async function readApp(url) {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) throw new ApiError(1, t("LOGIN.ERROR_APP_LOAD", "Die Anwendung konnte nicht geladen werden."));
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
  const result2 = data.Result;
  if (result2 && typeof result2 === "object" && result2.System?.token) token = result2.System.token;
  if (data.Result === false || data.Result == null) {
    const code = data.code || 999;
    if (code === 101) onExpired?.();
    throw new ApiError(code, data.message || "", data.messageAdditional || "");
  }
  return data.Result;
}
function adminCall(adminKey2, action, params = {}) {
  const key = /^[a-z0-9._-]+$/i.test(adminKey2) && !adminKey2.includes("..") ? adminKey2 : "admin";
  return postJson(`${root()}?/${key}/Json/&q[]=/0/`, action, params);
}

// src/admin/util.ts
var DUMMY = "********";
function esc(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char] ?? char);
}
function cell(cfg2, section2, key) {
  const row2 = cfg2[section2]?.[key];
  return Array.isArray(row2) ? row2[0] : "";
}
function flag(value) {
  return value === true || value === 1 || value === "1";
}
function bind(ctx2, root3) {
  root3.querySelectorAll("[data-save]").forEach((button) => {
    button.addEventListener("click", () => {
      const form = button.closest("form");
      if (!form) return;
      void save(ctx2, form, button);
    });
  });
}
async function save(ctx2, form, button) {
  button.disabled = true;
  const params = {};
  new FormData(form).forEach((value, key) => {
    params[key] = typeof value === "string" ? value : "";
  });
  form.querySelectorAll("input[type='checkbox'][name]").forEach((box) => {
    params[box.name] = box.checked ? "1" : "0";
  });
  try {
    await ctx2.call("AdminSettingsUpdate", params);
    await ctx2.reload();
    ctx2.note(t("UI.SAVED", "Gespeichert."));
  } catch (error) {
    ctx2.note(explain(error), true);
  } finally {
    button.disabled = false;
  }
}
function check(name, label, on) {
  return `<label class="check"><input type="checkbox" name="${esc(name)}"${on ? " checked" : ""}><span>${esc(label)}</span></label>`;
}
function field(name, label, value, extra = "") {
  return `<label class="field"><span>${esc(label)}</span><input name="${esc(name)}" value="${esc(value)}" ${extra}></label>`;
}
function select(name, label, value, options) {
  const items = options.map(([id, text]) => `<option value="${esc(id)}"${id === value ? " selected" : ""}>${esc(text)}</option>`).join("");
  return `<label class="field"><span>${esc(label)}</span><select name="${esc(name)}">${items}</select></label>`;
}
function langSelect(name, label, value, list) {
  const names = {
    de: t("LANGS_NAMES.de", "Deutsch"),
    en: t("LANGS_NAMES.en", "English")
  };
  return select(name, label, value, list.map((id) => [id, names[id] || id]));
}

// src/admin/about.ts
async function paintAbout(ctx2, slot) {
  slot.innerHTML = `<h2 class="title title-md">${esc(t("TAB_ABOUT.LEGEND_ABOUT", "\xDCber"))}</h2><p class="quiet" data-for="about">${esc(t("TAB_ABOUT.LABEL_CHECKING", "\xDCberpr\xFCfe auf Aktualisierungen"))}</p><ul class="set-list" id="php"></ul><div class="action">
    <button type="button" class="text-btn" data-action="cache">${esc(t("UI.CACHE", "Cache leeren"))}</button>
    <button type="button" class="text-btn" data-action="backup">${esc(t("UI.BACKUP", "Sicherung herunterladen"))}</button>
    <button type="button" class="ink-btn" data-action="upgrade" hidden>${esc(t("UI.UPGRADE", "Core aktualisieren"))}</button>
  </div>
  <dialog id="upgrade"><div class="dialog-body"><h2 class="title title-md">${esc(t("UI.UPGRADE_SURE", "SnappyMail wirklich aktualisieren?"))}</h2><p class="quiet">${esc(t("TAB_ABOUT.HINT_READ_CHANGE_LOG", "Bitte Lesen Sie das Changelog vor dem Update."))}</p><div class="dialog-actions"><button type="button" class="text-btn" value="cancel">${esc(t("GLOBAL.CANCEL", "Abbrechen"))}</button><button type="button" class="ink-btn" value="ok">${esc(t("UI.UPGRADE", "Core aktualisieren"))}</button></div></div></dialog>`;
  const dialog = slot.querySelector("#upgrade");
  dialog.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (button) dialog.close(button.value);
  });
  slot.querySelector("[data-action='cache']")?.addEventListener("click", () => {
    void ctx2.call("AdminClearCache").then(() => note(slot, t("UI.SAVED", "Gespeichert."))).catch((error) => note(slot, explain(error)));
  });
  slot.querySelector("[data-action='backup']")?.addEventListener("click", () => {
    window.location.href = `?/${encodeURIComponent(ctx2.key)}/Backup/`;
  });
  slot.querySelector("[data-action='upgrade']")?.addEventListener("click", () => {
    void upgrade(ctx2, slot, dialog);
  });
  try {
    const info = await ctx2.call("AdminInfo");
    const core = info.core || {};
    const line = document.createElement("p");
    line.className = "quiet";
    const current = String(window.rl?.SettingsGet?.("version", "") || "");
    if (core.version && (core.versionCompare || 0) < 0) {
      line.textContent = t("TAB_ABOUT.HTML_NEW_VERSION", "Neue Version %VERSION% verf\xFCgbar.").replace("%VERSION%", core.version);
      slot.querySelector("[data-action='upgrade']").hidden = false;
    } else {
      line.textContent = t("TAB_ABOUT.HINT_IS_UP_TO_DATE", "SnappyMail ist auf dem neusten Stand.") + (current ? ` ${current}` : "");
    }
    if (core.warnings?.length) line.textContent += ` ${core.warnings.join(" ")}`;
    slot.querySelector("[data-for='about']")?.replaceWith(line);
    const list = slot.querySelector("#php");
    if (list) {
      list.innerHTML = (info.php || []).map((item) => `<li class="set-row"><span class="grow"><strong>${esc(String(item.name || ""))}</strong></span><span class="quiet">${esc(item.loaded ? String(item.version || t("GLOBAL.YES", "Ja")) : t("GLOBAL.NO", "Nein"))}</span></li>`).join("");
    }
  } catch (error) {
    note(slot, explain(error));
  }
}
function note(slot, message) {
  const node = slot.querySelector("[data-for='about'], .quiet");
  if (node) node.textContent = message;
}
async function upgrade(ctx2, slot, dialog) {
  dialog.showModal();
  const ok = await new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok"), { once: true });
  });
  if (!ok) return;
  note(slot, t("TAB_ABOUT.LABEL_UPDATING", "Aktualisiere"));
  try {
    await ctx2.call("AdminUpgradeCore");
    note(slot, t("UI.SAVED", "Gespeichert."));
  } catch (error) {
    note(slot, explain(error));
  }
}

// src/admin/config.ts
function paintConfig(ctx2, slot) {
  const sections = Object.keys(ctx2.cfg).filter((name) => name !== "version");
  slot.innerHTML = `<form>
    ${sections.map((section2) => sectionBlock(section2, ctx2.cfg[section2] || {})).join("")}
    <div class="action"><button type="button" class="ink-btn" data-action="save">${esc(t("GLOBAL.SAVE", "Speichern"))}</button></div>
    <p class="quiet" data-for="config" hidden></p>
  </form>`;
  slot.querySelector("[data-action='save']")?.addEventListener("click", () => {
    void save2(ctx2, slot);
  });
}
function sectionBlock(section2, rows) {
  const body = Object.keys(rows).map((key) => row(section2, key, rows[key] || [])).join("");
  return `<details><summary class="mono">${esc(section2)}</summary><table class="cfg"><tbody>${body}</tbody></table></details>`;
}
function row(section2, key, tuple) {
  const value = tuple[0];
  const comment = typeof tuple[1] === "string" ? tuple[1] : "";
  const options = Array.isArray(tuple[2]) ? tuple[2].map(String) : null;
  const secret2 = /pass|secret|token|key/i.test(key);
  let control = "";
  if (typeof value === "boolean") {
    control = `<input data-section="${esc(section2)}" data-key="${esc(key)}" data-kind="bool" type="checkbox"${value ? " checked" : ""}>`;
  } else if (options) {
    control = `<select data-section="${esc(section2)}" data-key="${esc(key)}" data-kind="text">${options.map((item) => `<option${item === String(value) ? " selected" : ""}>${esc(item)}</option>`).join("")}</select>`;
  } else if (typeof value === "number") {
    control = `<input data-section="${esc(section2)}" data-key="${esc(key)}" data-kind="number" inputmode="decimal" value="${esc(String(value))}">`;
  } else {
    control = `<input data-section="${esc(section2)}" data-key="${esc(key)}" data-kind="text" type="${secret2 ? "password" : "text"}" value="${esc(value == null ? "" : String(value))}">`;
  }
  return `<tr><th>${esc(key)}${comment ? `<span class="quiet">${esc(comment)}</span>` : ""}</th><td>${control}</td></tr>`;
}
async function save2(ctx2, slot) {
  const config = {};
  slot.querySelectorAll("[data-section]").forEach((input) => {
    const section2 = input.dataset.section || "";
    const key = input.dataset.key || "";
    config[section2] ||= {};
    if (input instanceof HTMLInputElement && input.dataset.kind === "bool") config[section2][key] = [input.checked];
    else if (input.dataset.kind === "number") config[section2][key] = [Number(input.value)];
    else config[section2][key] = [input.value];
  });
  const out = slot.querySelector("[data-for='config']");
  try {
    await ctx2.call("AdminSettingsSet", { config });
    await ctx2.reload();
    if (out) {
      out.hidden = false;
      out.textContent = t("UI.SAVED", "Gespeichert.");
    }
  } catch (error) {
    if (out) {
      out.hidden = false;
      out.textContent = explain(error);
    }
  }
}

// src/icons.ts
var bodies = {
  "account-add": '<rect x="7.5" y="1.5" width="9" height="3"/><rect x="4.5" y="4.5" width="3" height="3"/><rect x="16.5" y="4.5" width="3" height="3"/><rect x="4.5" y="7.5" width="3" height="3"/><rect x="16.5" y="7.5" width="3" height="3"/><rect x="7.5" y="10.5" width="9" height="3"/><rect x="22.5" y="10.5" width="3" height="3"/><rect x="19.5" y="13.5" width="9" height="3"/><rect x="1.5" y="16.5" width="12" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="13.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="3" height="3"/><rect x="13.5" y="22.5" width="3" height="3"/>',
  "answered": '<rect x="10.5" y="4.5" width="3" height="3"/><rect x="7.5" y="7.5" width="3" height="3"/><rect x="4.5" y="10.5" width="18" height="3"/><rect x="7.5" y="13.5" width="3" height="3"/><rect x="22.5" y="13.5" width="3" height="3"/><rect x="10.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="22.5" y="19.5" width="3" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/>',
  "archive": '<rect x="1.5" y="1.5" width="27" height="3"/><rect x="1.5" y="4.5" width="3" height="3"/><rect x="25.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="27" height="3"/><rect x="4.5" y="10.5" width="3" height="3"/><rect x="22.5" y="10.5" width="3" height="3"/><rect x="4.5" y="13.5" width="3" height="3"/><rect x="10.5" y="13.5" width="9" height="3"/><rect x="22.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="4.5" y="19.5" width="3" height="3"/><rect x="22.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="21" height="3"/>',
  "assist": '<rect x="7.5" y="1.5" width="3" height="3"/><rect x="4.5" y="4.5" width="9" height="3"/><rect x="7.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="15" height="3"/><rect x="19.5" y="10.5" width="9" height="3"/><rect x="7.5" y="13.5" width="3" height="3"/><rect x="19.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="9" height="3"/><rect x="7.5" y="19.5" width="3" height="3"/>',
  "attach": '<rect x="10.5" y="1.5" width="9" height="3"/><rect x="7.5" y="4.5" width="3" height="3"/><rect x="19.5" y="4.5" width="3" height="3"/><rect x="7.5" y="7.5" width="3" height="3"/><rect x="13.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="3" height="3"/><rect x="7.5" y="10.5" width="3" height="3"/><rect x="13.5" y="10.5" width="3" height="3"/><rect x="19.5" y="10.5" width="3" height="3"/><rect x="7.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="19.5" y="13.5" width="3" height="3"/><rect x="7.5" y="16.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="19.5" y="16.5" width="3" height="3"/><rect x="7.5" y="19.5" width="3" height="3"/><rect x="19.5" y="19.5" width="3" height="3"/><rect x="10.5" y="22.5" width="9" height="3"/>',
  "attachment": '<rect x="10.5" y="1.5" width="9" height="3"/><rect x="7.5" y="4.5" width="3" height="3"/><rect x="19.5" y="4.5" width="3" height="3"/><rect x="7.5" y="7.5" width="3" height="3"/><rect x="13.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="3" height="3"/><rect x="7.5" y="10.5" width="3" height="3"/><rect x="13.5" y="10.5" width="3" height="3"/><rect x="19.5" y="10.5" width="3" height="3"/><rect x="7.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="19.5" y="13.5" width="3" height="3"/><rect x="7.5" y="16.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="19.5" y="16.5" width="3" height="3"/><rect x="7.5" y="19.5" width="3" height="3"/><rect x="19.5" y="19.5" width="3" height="3"/><rect x="10.5" y="22.5" width="9" height="3"/>',
  "back": '<rect x="13.5" y="4.5" width="3" height="3"/><rect x="10.5" y="7.5" width="3" height="3"/><rect x="7.5" y="10.5" width="3" height="3"/><rect x="4.5" y="13.5" width="21" height="3"/><rect x="7.5" y="16.5" width="3" height="3"/><rect x="10.5" y="19.5" width="3" height="3"/><rect x="13.5" y="22.5" width="3" height="3"/>',
  "bell": '<rect x="13.5" y="1.5" width="3" height="3"/><rect x="7.5" y="4.5" width="15" height="3"/><rect x="4.5" y="7.5" width="3" height="3"/><rect x="22.5" y="7.5" width="3" height="3"/><rect x="4.5" y="10.5" width="3" height="3"/><rect x="22.5" y="10.5" width="3" height="3"/><rect x="4.5" y="13.5" width="3" height="3"/><rect x="22.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="27" height="3"/><rect x="10.5" y="25.5" width="9" height="3"/>',
  "bell-off": '<rect x="1.5" y="1.5" width="3" height="3"/><rect x="13.5" y="1.5" width="3" height="3"/><rect x="4.5" y="4.5" width="18" height="3"/><rect x="4.5" y="7.5" width="6" height="3"/><rect x="22.5" y="7.5" width="3" height="3"/><rect x="4.5" y="10.5" width="3" height="3"/><rect x="10.5" y="10.5" width="3" height="3"/><rect x="22.5" y="10.5" width="3" height="3"/><rect x="4.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="22.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="16.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="19.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="21" height="3"/><rect x="25.5" y="22.5" width="3" height="3"/><rect x="10.5" y="25.5" width="9" height="3"/><rect x="25.5" y="25.5" width="3" height="3"/>',
  "bold": '<rect x="7.5" y="4.5" width="15" height="3"/><rect x="7.5" y="7.5" width="6" height="3"/><rect x="19.5" y="7.5" width="6" height="3"/><rect x="7.5" y="10.5" width="6" height="3"/><rect x="19.5" y="10.5" width="6" height="3"/><rect x="7.5" y="13.5" width="15" height="3"/><rect x="7.5" y="16.5" width="6" height="3"/><rect x="19.5" y="16.5" width="6" height="3"/><rect x="7.5" y="19.5" width="6" height="3"/><rect x="19.5" y="19.5" width="6" height="3"/><rect x="7.5" y="22.5" width="15" height="3"/>',
  "calendar": '<rect x="7.5" y="1.5" width="3" height="3"/><rect x="19.5" y="1.5" width="3" height="3"/><rect x="1.5" y="4.5" width="27" height="3"/><rect x="1.5" y="7.5" width="27" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="7.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="19.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="7.5" y="19.5" width="3" height="3"/><rect x="13.5" y="19.5" width="3" height="3"/><rect x="19.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="3" height="3"/><rect x="25.5" y="22.5" width="3" height="3"/><rect x="1.5" y="25.5" width="27" height="3"/>',
  "certificate": '<rect x="1.5" y="1.5" width="27" height="3"/><rect x="1.5" y="4.5" width="3" height="3"/><rect x="25.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="7.5" y="7.5" width="15" height="3"/><rect x="25.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="7.5" y="13.5" width="9" height="3"/><rect x="19.5" y="13.5" width="9" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="19.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="18" height="3"/><rect x="22.5" y="19.5" width="6" height="3"/><rect x="16.5" y="22.5" width="3" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/><rect x="16.5" y="25.5" width="3" height="3"/><rect x="22.5" y="25.5" width="3" height="3"/>',
  "check": '<rect x="25.5" y="4.5" width="3" height="3"/><rect x="22.5" y="7.5" width="3" height="3"/><rect x="19.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="16.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="7.5" y="19.5" width="6" height="3"/>',
  "checkbox": '<rect x="4.5" y="4.5" width="21" height="3"/><rect x="4.5" y="7.5" width="3" height="3"/><rect x="22.5" y="7.5" width="3" height="3"/><rect x="4.5" y="10.5" width="3" height="3"/><rect x="22.5" y="10.5" width="3" height="3"/><rect x="4.5" y="13.5" width="3" height="3"/><rect x="22.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="4.5" y="19.5" width="3" height="3"/><rect x="22.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="21" height="3"/>',
  "checkbox-checked": '<rect x="4.5" y="4.5" width="21" height="3"/><rect x="4.5" y="7.5" width="3" height="3"/><rect x="22.5" y="7.5" width="3" height="3"/><rect x="4.5" y="10.5" width="3" height="3"/><rect x="19.5" y="10.5" width="6" height="3"/><rect x="4.5" y="13.5" width="3" height="3"/><rect x="10.5" y="13.5" width="3" height="3"/><rect x="16.5" y="13.5" width="3" height="3"/><rect x="22.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="4.5" y="19.5" width="3" height="3"/><rect x="22.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="21" height="3"/>',
  "checkbox-mixed": '<rect x="4.5" y="4.5" width="21" height="3"/><rect x="4.5" y="7.5" width="3" height="3"/><rect x="22.5" y="7.5" width="3" height="3"/><rect x="4.5" y="10.5" width="3" height="3"/><rect x="22.5" y="10.5" width="3" height="3"/><rect x="4.5" y="13.5" width="3" height="3"/><rect x="10.5" y="13.5" width="9" height="3"/><rect x="22.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="4.5" y="19.5" width="3" height="3"/><rect x="22.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="21" height="3"/>',
  "chevron-down": '<rect x="4.5" y="10.5" width="3" height="3"/><rect x="22.5" y="10.5" width="3" height="3"/><rect x="7.5" y="13.5" width="3" height="3"/><rect x="19.5" y="13.5" width="3" height="3"/><rect x="10.5" y="16.5" width="3" height="3"/><rect x="16.5" y="16.5" width="3" height="3"/><rect x="13.5" y="19.5" width="3" height="3"/>',
  "chevron-left": '<rect x="16.5" y="4.5" width="3" height="3"/><rect x="13.5" y="7.5" width="3" height="3"/><rect x="10.5" y="10.5" width="3" height="3"/><rect x="7.5" y="13.5" width="3" height="3"/><rect x="10.5" y="16.5" width="3" height="3"/><rect x="13.5" y="19.5" width="3" height="3"/><rect x="16.5" y="22.5" width="3" height="3"/>',
  "chevron-right": '<rect x="10.5" y="4.5" width="3" height="3"/><rect x="13.5" y="7.5" width="3" height="3"/><rect x="16.5" y="10.5" width="3" height="3"/><rect x="19.5" y="13.5" width="3" height="3"/><rect x="16.5" y="16.5" width="3" height="3"/><rect x="13.5" y="19.5" width="3" height="3"/><rect x="10.5" y="22.5" width="3" height="3"/>',
  "chevron-up": '<rect x="13.5" y="7.5" width="3" height="3"/><rect x="10.5" y="10.5" width="3" height="3"/><rect x="16.5" y="10.5" width="3" height="3"/><rect x="7.5" y="13.5" width="3" height="3"/><rect x="19.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/>',
  "clock": '<rect x="7.5" y="1.5" width="15" height="3"/><rect x="4.5" y="4.5" width="3" height="3"/><rect x="22.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="13.5" y="7.5" width="3" height="3"/><rect x="25.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="13.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="9" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="3" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/><rect x="7.5" y="25.5" width="15" height="3"/>',
  "close": '<rect x="4.5" y="4.5" width="3" height="3"/><rect x="22.5" y="4.5" width="3" height="3"/><rect x="7.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="3" height="3"/><rect x="10.5" y="10.5" width="3" height="3"/><rect x="16.5" y="10.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="10.5" y="16.5" width="3" height="3"/><rect x="16.5" y="16.5" width="3" height="3"/><rect x="7.5" y="19.5" width="3" height="3"/><rect x="19.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="3" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/>',
  "code": '<rect x="7.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="3" height="3"/><rect x="4.5" y="10.5" width="3" height="3"/><rect x="13.5" y="10.5" width="3" height="3"/><rect x="22.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="7.5" y="19.5" width="3" height="3"/><rect x="19.5" y="19.5" width="3" height="3"/>',
  "compose": '<rect x="19.5" y="1.5" width="6" height="3"/><rect x="16.5" y="4.5" width="3" height="3"/><rect x="25.5" y="4.5" width="3" height="3"/><rect x="13.5" y="7.5" width="3" height="3"/><rect x="22.5" y="7.5" width="3" height="3"/><rect x="10.5" y="10.5" width="3" height="3"/><rect x="19.5" y="10.5" width="3" height="3"/><rect x="7.5" y="13.5" width="3" height="3"/><rect x="16.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="4.5" y="19.5" width="3" height="3"/><rect x="10.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="6" height="3"/>',
  "contacts": '<rect x="4.5" y="1.5" width="21" height="3"/><rect x="1.5" y="4.5" width="6" height="3"/><rect x="22.5" y="4.5" width="3" height="3"/><rect x="4.5" y="7.5" width="3" height="3"/><rect x="13.5" y="7.5" width="3" height="3"/><rect x="22.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="6" height="3"/><rect x="10.5" y="10.5" width="3" height="3"/><rect x="16.5" y="10.5" width="3" height="3"/><rect x="22.5" y="10.5" width="3" height="3"/><rect x="4.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="22.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="6" height="3"/><rect x="10.5" y="16.5" width="9" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="4.5" y="19.5" width="3" height="3"/><rect x="22.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="6" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/><rect x="4.5" y="25.5" width="21" height="3"/>',
  "copy": '<rect x="1.5" y="1.5" width="18" height="3"/><rect x="1.5" y="4.5" width="3" height="3"/><rect x="16.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="16.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="10.5" y="10.5" width="18" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="10.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="12" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="10.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="10.5" y="22.5" width="3" height="3"/><rect x="25.5" y="22.5" width="3" height="3"/><rect x="10.5" y="25.5" width="18" height="3"/>',
  "database": '<rect x="4.5" y="1.5" width="21" height="3"/><rect x="1.5" y="4.5" width="3" height="3"/><rect x="25.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="6" height="3"/><rect x="22.5" y="7.5" width="6" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="7.5" y="10.5" width="15" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="6" height="3"/><rect x="22.5" y="16.5" width="6" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="7.5" y="19.5" width="15" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="3" height="3"/><rect x="25.5" y="22.5" width="3" height="3"/><rect x="4.5" y="25.5" width="21" height="3"/>',
  "delete": '<rect x="10.5" y="1.5" width="9" height="3"/><rect x="1.5" y="4.5" width="27" height="3"/><rect x="4.5" y="7.5" width="3" height="3"/><rect x="22.5" y="7.5" width="3" height="3"/><rect x="4.5" y="10.5" width="3" height="3"/><rect x="10.5" y="10.5" width="3" height="3"/><rect x="16.5" y="10.5" width="3" height="3"/><rect x="22.5" y="10.5" width="3" height="3"/><rect x="4.5" y="13.5" width="3" height="3"/><rect x="10.5" y="13.5" width="3" height="3"/><rect x="16.5" y="13.5" width="3" height="3"/><rect x="22.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="10.5" y="16.5" width="3" height="3"/><rect x="16.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="4.5" y="19.5" width="3" height="3"/><rect x="10.5" y="19.5" width="3" height="3"/><rect x="16.5" y="19.5" width="3" height="3"/><rect x="22.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="3" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/><rect x="4.5" y="25.5" width="21" height="3"/>',
  "delete-forever": '<rect x="10.5" y="1.5" width="9" height="3"/><rect x="1.5" y="4.5" width="27" height="3"/><rect x="4.5" y="7.5" width="3" height="3"/><rect x="22.5" y="7.5" width="3" height="3"/><rect x="4.5" y="10.5" width="6" height="3"/><rect x="19.5" y="10.5" width="6" height="3"/><rect x="4.5" y="13.5" width="3" height="3"/><rect x="10.5" y="13.5" width="3" height="3"/><rect x="16.5" y="13.5" width="3" height="3"/><rect x="22.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="4.5" y="19.5" width="3" height="3"/><rect x="10.5" y="19.5" width="3" height="3"/><rect x="16.5" y="19.5" width="3" height="3"/><rect x="22.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="6" height="3"/><rect x="19.5" y="22.5" width="6" height="3"/><rect x="4.5" y="25.5" width="21" height="3"/>',
  "download": '<rect x="13.5" y="1.5" width="3" height="3"/><rect x="13.5" y="4.5" width="3" height="3"/><rect x="13.5" y="7.5" width="3" height="3"/><rect x="7.5" y="10.5" width="3" height="3"/><rect x="13.5" y="10.5" width="3" height="3"/><rect x="19.5" y="10.5" width="3" height="3"/><rect x="10.5" y="13.5" width="9" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="1.5" y="22.5" width="3" height="3"/><rect x="25.5" y="22.5" width="3" height="3"/><rect x="1.5" y="25.5" width="27" height="3"/>',
  "download-zip": '<rect x="13.5" y="1.5" width="3" height="3"/><rect x="7.5" y="4.5" width="3" height="3"/><rect x="13.5" y="4.5" width="3" height="3"/><rect x="19.5" y="4.5" width="3" height="3"/><rect x="10.5" y="7.5" width="9" height="3"/><rect x="13.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="27" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="3" height="3"/><rect x="13.5" y="22.5" width="3" height="3"/><rect x="25.5" y="22.5" width="3" height="3"/><rect x="1.5" y="25.5" width="27" height="3"/>',
  "drafts": '<rect x="4.5" y="1.5" width="15" height="3"/><rect x="4.5" y="4.5" width="3" height="3"/><rect x="16.5" y="4.5" width="6" height="3"/><rect x="4.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="6" height="3"/><rect x="4.5" y="10.5" width="3" height="3"/><rect x="10.5" y="10.5" width="9" height="3"/><rect x="22.5" y="10.5" width="3" height="3"/><rect x="4.5" y="13.5" width="3" height="3"/><rect x="22.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="10.5" y="16.5" width="9" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="4.5" y="19.5" width="3" height="3"/><rect x="22.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="3" height="3"/><rect x="10.5" y="22.5" width="9" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/><rect x="4.5" y="25.5" width="21" height="3"/>',
  "edit-as-new": '<rect x="4.5" y="1.5" width="15" height="3"/><rect x="4.5" y="4.5" width="3" height="3"/><rect x="16.5" y="4.5" width="6" height="3"/><rect x="4.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="6" height="3"/><rect x="4.5" y="10.5" width="3" height="3"/><rect x="13.5" y="10.5" width="3" height="3"/><rect x="22.5" y="10.5" width="3" height="3"/><rect x="4.5" y="13.5" width="3" height="3"/><rect x="10.5" y="13.5" width="9" height="3"/><rect x="22.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="4.5" y="19.5" width="3" height="3"/><rect x="22.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="3" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/><rect x="4.5" y="25.5" width="21" height="3"/>',
  "error": '<rect x="7.5" y="1.5" width="15" height="3"/><rect x="4.5" y="4.5" width="3" height="3"/><rect x="22.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="7.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="3" height="3"/><rect x="25.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="10.5" y="10.5" width="3" height="3"/><rect x="16.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="10.5" y="16.5" width="3" height="3"/><rect x="16.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="7.5" y="19.5" width="3" height="3"/><rect x="19.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="3" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/><rect x="7.5" y="25.5" width="15" height="3"/>',
  "external": '<rect x="16.5" y="1.5" width="12" height="3"/><rect x="1.5" y="4.5" width="12" height="3"/><rect x="22.5" y="4.5" width="6" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="3" height="3"/><rect x="25.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="16.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="22.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="3" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/><rect x="1.5" y="25.5" width="24" height="3"/>',
  "eye": '<rect x="7.5" y="7.5" width="15" height="3"/><rect x="4.5" y="10.5" width="3" height="3"/><rect x="22.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="10.5" y="13.5" width="9" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="7.5" y="19.5" width="15" height="3"/>',
  "eye-off": '<rect x="1.5" y="1.5" width="3" height="3"/><rect x="4.5" y="4.5" width="3" height="3"/><rect x="7.5" y="7.5" width="15" height="3"/><rect x="4.5" y="10.5" width="3" height="3"/><rect x="10.5" y="10.5" width="3" height="3"/><rect x="22.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="10.5" y="13.5" width="9" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="16.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="7.5" y="19.5" width="15" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/><rect x="25.5" y="25.5" width="3" height="3"/>',
  "filter": '<rect x="1.5" y="1.5" width="27" height="3"/><rect x="4.5" y="4.5" width="3" height="3"/><rect x="22.5" y="4.5" width="3" height="3"/><rect x="7.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="3" height="3"/><rect x="10.5" y="10.5" width="3" height="3"/><rect x="16.5" y="10.5" width="3" height="3"/><rect x="10.5" y="13.5" width="3" height="3"/><rect x="16.5" y="13.5" width="3" height="3"/><rect x="10.5" y="16.5" width="3" height="3"/><rect x="16.5" y="16.5" width="3" height="3"/><rect x="10.5" y="19.5" width="3" height="3"/><rect x="16.5" y="19.5" width="3" height="3"/><rect x="10.5" y="22.5" width="9" height="3"/>',
  "flag": '<rect x="4.5" y="1.5" width="3" height="3"/><rect x="4.5" y="4.5" width="21" height="3"/><rect x="4.5" y="7.5" width="3" height="3"/><rect x="22.5" y="7.5" width="3" height="3"/><rect x="4.5" y="10.5" width="3" height="3"/><rect x="19.5" y="10.5" width="3" height="3"/><rect x="4.5" y="13.5" width="3" height="3"/><rect x="22.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="21" height="3"/><rect x="4.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="3" height="3"/><rect x="4.5" y="25.5" width="3" height="3"/>',
  "flag-filled": '<rect x="4.5" y="1.5" width="3" height="3"/><rect x="4.5" y="4.5" width="21" height="3"/><rect x="4.5" y="7.5" width="21" height="3"/><rect x="4.5" y="10.5" width="18" height="3"/><rect x="4.5" y="13.5" width="21" height="3"/><rect x="4.5" y="16.5" width="21" height="3"/><rect x="4.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="3" height="3"/><rect x="4.5" y="25.5" width="3" height="3"/>',
  "folder": '<rect x="1.5" y="4.5" width="12" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="13.5" y="7.5" width="15" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="27" height="3"/>',
  "folder-open": '<rect x="1.5" y="4.5" width="12" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="13.5" y="7.5" width="12" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="22.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="10.5" y="13.5" width="18" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="7.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="6" height="3"/><rect x="22.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="21" height="3"/>',
  "folder-plus": '<rect x="1.5" y="4.5" width="12" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="13.5" y="7.5" width="15" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="13.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="10.5" y="13.5" width="9" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="27" height="3"/>',
  "folder-shared": '<rect x="1.5" y="4.5" width="12" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="13.5" y="7.5" width="15" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="7.5" y="13.5" width="3" height="3"/><rect x="19.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="10.5" y="16.5" width="9" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="27" height="3"/>',
  "format-clear": '<rect x="16.5" y="1.5" width="6" height="3"/><rect x="10.5" y="4.5" width="6" height="3"/><rect x="7.5" y="7.5" width="6" height="3"/><rect x="4.5" y="10.5" width="6" height="3"/><rect x="1.5" y="13.5" width="6" height="3"/><rect x="4.5" y="16.5" width="18" height="3"/>',
  "forward": '<rect x="16.5" y="4.5" width="3" height="3"/><rect x="19.5" y="7.5" width="3" height="3"/><rect x="7.5" y="10.5" width="18" height="3"/><rect x="4.5" y="13.5" width="3" height="3"/><rect x="19.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="16.5" y="16.5" width="3" height="3"/><rect x="4.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="3" height="3"/>',
  "forward-attachment": '<rect x="16.5" y="1.5" width="3" height="3"/><rect x="19.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="24" height="3"/><rect x="19.5" y="10.5" width="3" height="3"/><rect x="16.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="15" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="13.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="3" height="3"/><rect x="13.5" y="22.5" width="3" height="3"/><rect x="1.5" y="25.5" width="15" height="3"/>',
  "forwarded": '<rect x="16.5" y="4.5" width="3" height="3"/><rect x="19.5" y="7.5" width="3" height="3"/><rect x="7.5" y="10.5" width="18" height="3"/><rect x="4.5" y="13.5" width="3" height="3"/><rect x="19.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="16.5" y="16.5" width="3" height="3"/><rect x="4.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="3" height="3"/>',
  "fullscreen": '<rect x="1.5" y="1.5" width="9" height="3"/><rect x="19.5" y="1.5" width="9" height="3"/><rect x="1.5" y="4.5" width="3" height="3"/><rect x="25.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="25.5" y="7.5" width="3" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="3" height="3"/><rect x="25.5" y="22.5" width="3" height="3"/><rect x="1.5" y="25.5" width="9" height="3"/><rect x="19.5" y="25.5" width="9" height="3"/>',
  "fullscreen-exit": '<rect x="7.5" y="1.5" width="3" height="3"/><rect x="19.5" y="1.5" width="3" height="3"/><rect x="7.5" y="4.5" width="3" height="3"/><rect x="19.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="9" height="3"/><rect x="19.5" y="7.5" width="9" height="3"/><rect x="1.5" y="19.5" width="9" height="3"/><rect x="19.5" y="19.5" width="9" height="3"/><rect x="7.5" y="22.5" width="3" height="3"/><rect x="19.5" y="22.5" width="3" height="3"/><rect x="7.5" y="25.5" width="3" height="3"/><rect x="19.5" y="25.5" width="3" height="3"/>',
  "funnel": '<rect x="1.5" y="1.5" width="27" height="3"/><rect x="4.5" y="4.5" width="3" height="3"/><rect x="22.5" y="4.5" width="3" height="3"/><rect x="7.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="3" height="3"/><rect x="10.5" y="10.5" width="3" height="3"/><rect x="16.5" y="10.5" width="3" height="3"/><rect x="10.5" y="13.5" width="3" height="3"/><rect x="16.5" y="13.5" width="3" height="3"/><rect x="10.5" y="16.5" width="3" height="3"/><rect x="16.5" y="16.5" width="3" height="3"/><rect x="10.5" y="19.5" width="3" height="3"/><rect x="16.5" y="19.5" width="3" height="3"/><rect x="10.5" y="22.5" width="9" height="3"/>',
  "identity": '<rect x="10.5" y="1.5" width="9" height="3"/><rect x="7.5" y="4.5" width="3" height="3"/><rect x="19.5" y="4.5" width="3" height="3"/><rect x="7.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="3" height="3"/><rect x="7.5" y="10.5" width="3" height="3"/><rect x="19.5" y="10.5" width="3" height="3"/><rect x="10.5" y="13.5" width="9" height="3"/><rect x="4.5" y="19.5" width="21" height="3"/><rect x="1.5" y="22.5" width="3" height="3"/><rect x="25.5" y="22.5" width="3" height="3"/><rect x="1.5" y="25.5" width="3" height="3"/><rect x="25.5" y="25.5" width="3" height="3"/>',
  "image": '<rect x="1.5" y="1.5" width="27" height="3"/><rect x="1.5" y="4.5" width="3" height="3"/><rect x="25.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="7.5" y="7.5" width="6" height="3"/><rect x="25.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="7.5" y="10.5" width="6" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="19.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="10.5" y="16.5" width="3" height="3"/><rect x="16.5" y="16.5" width="12" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="7.5" y="19.5" width="21" height="3"/><rect x="1.5" y="22.5" width="27" height="3"/>',
  "image-blocked": '<rect x="1.5" y="1.5" width="27" height="3"/><rect x="1.5" y="4.5" width="6" height="3"/><rect x="25.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="7.5" y="7.5" width="3" height="3"/><rect x="25.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="10.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="16.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="19.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="3" height="3"/><rect x="22.5" y="22.5" width="6" height="3"/><rect x="1.5" y="25.5" width="27" height="3"/>',
  "important": '<rect x="10.5" y="1.5" width="9" height="3"/><rect x="10.5" y="4.5" width="9" height="3"/><rect x="10.5" y="7.5" width="9" height="3"/><rect x="10.5" y="10.5" width="9" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="10.5" y="19.5" width="9" height="3"/><rect x="10.5" y="22.5" width="9" height="3"/>',
  "inbox": '<rect x="13.5" y="1.5" width="3" height="3"/><rect x="13.5" y="4.5" width="3" height="3"/><rect x="7.5" y="7.5" width="3" height="3"/><rect x="13.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="3" height="3"/><rect x="10.5" y="10.5" width="9" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="9" height="3"/><rect x="19.5" y="19.5" width="9" height="3"/><rect x="1.5" y="22.5" width="3" height="3"/><rect x="25.5" y="22.5" width="3" height="3"/><rect x="1.5" y="25.5" width="27" height="3"/>',
  "info": '<rect x="7.5" y="1.5" width="15" height="3"/><rect x="4.5" y="4.5" width="3" height="3"/><rect x="22.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="13.5" y="7.5" width="3" height="3"/><rect x="25.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="13.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="3" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/><rect x="7.5" y="25.5" width="15" height="3"/>',
  "italic": '<rect x="13.5" y="4.5" width="12" height="3"/><rect x="16.5" y="7.5" width="3" height="3"/><rect x="16.5" y="10.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="10.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="12" height="3"/>',
  "key": '<rect x="4.5" y="7.5" width="9" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="13.5" y="10.5" width="15" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="7.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="19.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="4.5" y="19.5" width="9" height="3"/>',
  "language": '<rect x="7.5" y="1.5" width="15" height="3"/><rect x="4.5" y="4.5" width="3" height="3"/><rect x="13.5" y="4.5" width="3" height="3"/><rect x="22.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="10.5" y="7.5" width="3" height="3"/><rect x="16.5" y="7.5" width="3" height="3"/><rect x="25.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="27" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="10.5" y="13.5" width="3" height="3"/><rect x="16.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="27" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="10.5" y="19.5" width="3" height="3"/><rect x="16.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="3" height="3"/><rect x="13.5" y="22.5" width="3" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/><rect x="7.5" y="25.5" width="15" height="3"/>',
  "link": '<rect x="4.5" y="7.5" width="6" height="3"/><rect x="19.5" y="7.5" width="6" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="10.5" y="10.5" width="3" height="3"/><rect x="16.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="10.5" y="13.5" width="9" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="10.5" y="16.5" width="3" height="3"/><rect x="16.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="4.5" y="19.5" width="6" height="3"/><rect x="19.5" y="19.5" width="6" height="3"/>',
  "list-bullet": '<rect x="1.5" y="4.5" width="3" height="3"/><rect x="10.5" y="4.5" width="18" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="10.5" y="13.5" width="18" height="3"/><rect x="1.5" y="22.5" width="3" height="3"/><rect x="10.5" y="22.5" width="18" height="3"/>',
  "list-number": '<rect x="4.5" y="1.5" width="3" height="3"/><rect x="1.5" y="4.5" width="6" height="3"/><rect x="13.5" y="4.5" width="15" height="3"/><rect x="4.5" y="7.5" width="3" height="3"/><rect x="4.5" y="10.5" width="3" height="3"/><rect x="1.5" y="16.5" width="6" height="3"/><rect x="7.5" y="19.5" width="3" height="3"/><rect x="13.5" y="19.5" width="15" height="3"/><rect x="4.5" y="22.5" width="3" height="3"/><rect x="1.5" y="25.5" width="9" height="3"/>',
  "loading": '<rect x="4.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="22.5" y="13.5" width="3" height="3"/>',
  "lock": '<rect x="7.5" y="1.5" width="15" height="3"/><rect x="4.5" y="4.5" width="3" height="3"/><rect x="22.5" y="4.5" width="3" height="3"/><rect x="4.5" y="7.5" width="3" height="3"/><rect x="22.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="27" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="13.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="3" height="3"/><rect x="25.5" y="22.5" width="3" height="3"/><rect x="1.5" y="25.5" width="27" height="3"/>',
  "lock-open": '<rect x="7.5" y="1.5" width="15" height="3"/><rect x="4.5" y="4.5" width="3" height="3"/><rect x="22.5" y="4.5" width="3" height="3"/><rect x="4.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="27" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="13.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="3" height="3"/><rect x="25.5" y="22.5" width="3" height="3"/><rect x="1.5" y="25.5" width="27" height="3"/>',
  "logout": '<rect x="1.5" y="1.5" width="15" height="3"/><rect x="1.5" y="4.5" width="3" height="3"/><rect x="13.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="13.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="19.5" y="10.5" width="6" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="7.5" y="13.5" width="21" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="19.5" y="16.5" width="6" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="13.5" y="19.5" width="3" height="3"/><rect x="19.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="3" height="3"/><rect x="13.5" y="22.5" width="3" height="3"/><rect x="1.5" y="25.5" width="15" height="3"/>',
  "mark-read": '<rect x="13.5" y="1.5" width="3" height="3"/><rect x="10.5" y="4.5" width="3" height="3"/><rect x="16.5" y="4.5" width="3" height="3"/><rect x="7.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="3" height="3"/><rect x="4.5" y="10.5" width="3" height="3"/><rect x="22.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="6" height="3"/><rect x="22.5" y="13.5" width="6" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="7.5" y="16.5" width="3" height="3"/><rect x="19.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="10.5" y="19.5" width="3" height="3"/><rect x="16.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="3" height="3"/><rect x="13.5" y="22.5" width="3" height="3"/><rect x="25.5" y="22.5" width="3" height="3"/><rect x="1.5" y="25.5" width="27" height="3"/>',
  "mark-unread": '<rect x="1.5" y="4.5" width="27" height="3"/><rect x="1.5" y="7.5" width="6" height="3"/><rect x="22.5" y="7.5" width="6" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="7.5" y="10.5" width="3" height="3"/><rect x="19.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="10.5" y="13.5" width="3" height="3"/><rect x="16.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="27" height="3"/>',
  "menu": '<rect x="4.5" y="4.5" width="21" height="3"/><rect x="4.5" y="13.5" width="21" height="3"/><rect x="4.5" y="22.5" width="21" height="3"/>',
  "minimize": '<rect x="4.5" y="22.5" width="21" height="3"/>',
  "minus": '<rect x="4.5" y="13.5" width="21" height="3"/>',
  "more": '<rect x="4.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="22.5" y="13.5" width="3" height="3"/>',
  "move": '<rect x="1.5" y="4.5" width="12" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="13.5" y="7.5" width="15" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="16.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="7.5" y="13.5" width="15" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="16.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="27" height="3"/>',
  "not-spam": '<rect x="7.5" y="1.5" width="15" height="3"/><rect x="4.5" y="4.5" width="3" height="3"/><rect x="22.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="25.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="19.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="16.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="7.5" y="16.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="10.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="3" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/><rect x="7.5" y="25.5" width="15" height="3"/>',
  "plug": '<rect x="7.5" y="1.5" width="3" height="3"/><rect x="19.5" y="1.5" width="3" height="3"/><rect x="7.5" y="4.5" width="3" height="3"/><rect x="19.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="27" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="7.5" y="19.5" width="15" height="3"/><rect x="13.5" y="22.5" width="3" height="3"/><rect x="13.5" y="25.5" width="3" height="3"/>',
  "plus": '<rect x="13.5" y="4.5" width="3" height="3"/><rect x="13.5" y="7.5" width="3" height="3"/><rect x="13.5" y="10.5" width="3" height="3"/><rect x="4.5" y="13.5" width="21" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="13.5" y="19.5" width="3" height="3"/><rect x="13.5" y="22.5" width="3" height="3"/>',
  "print": '<rect x="7.5" y="1.5" width="15" height="3"/><rect x="7.5" y="4.5" width="3" height="3"/><rect x="19.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="27" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="19.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="7.5" y="16.5" width="15" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="9" height="3"/><rect x="19.5" y="19.5" width="9" height="3"/><rect x="7.5" y="22.5" width="3" height="3"/><rect x="19.5" y="22.5" width="3" height="3"/><rect x="7.5" y="25.5" width="15" height="3"/>',
  "quote": '<rect x="4.5" y="7.5" width="6" height="3"/><rect x="16.5" y="7.5" width="6" height="3"/><rect x="4.5" y="10.5" width="6" height="3"/><rect x="16.5" y="10.5" width="6" height="3"/><rect x="7.5" y="13.5" width="3" height="3"/><rect x="19.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="16.5" y="16.5" width="3" height="3"/>',
  "receipt": '<rect x="4.5" y="1.5" width="15" height="3"/><rect x="4.5" y="4.5" width="3" height="3"/><rect x="16.5" y="4.5" width="6" height="3"/><rect x="4.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="6" height="3"/><rect x="4.5" y="10.5" width="3" height="3"/><rect x="19.5" y="10.5" width="6" height="3"/><rect x="4.5" y="13.5" width="3" height="3"/><rect x="10.5" y="13.5" width="3" height="3"/><rect x="16.5" y="13.5" width="3" height="3"/><rect x="22.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="4.5" y="19.5" width="3" height="3"/><rect x="22.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="3" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/><rect x="4.5" y="25.5" width="21" height="3"/>',
  "refresh": '<rect x="7.5" y="1.5" width="12" height="3"/><rect x="22.5" y="1.5" width="3" height="3"/><rect x="4.5" y="4.5" width="3" height="3"/><rect x="19.5" y="4.5" width="6" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="16.5" y="7.5" width="9" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="4.5" y="19.5" width="3" height="3"/><rect x="22.5" y="19.5" width="3" height="3"/><rect x="7.5" y="22.5" width="15" height="3"/>',
  "reply": '<rect x="10.5" y="4.5" width="3" height="3"/><rect x="7.5" y="7.5" width="3" height="3"/><rect x="4.5" y="10.5" width="18" height="3"/><rect x="7.5" y="13.5" width="3" height="3"/><rect x="22.5" y="13.5" width="3" height="3"/><rect x="10.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="22.5" y="19.5" width="3" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/>',
  "reply-all": '<rect x="7.5" y="4.5" width="3" height="3"/><rect x="16.5" y="4.5" width="3" height="3"/><rect x="4.5" y="7.5" width="3" height="3"/><rect x="13.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="10.5" y="10.5" width="15" height="3"/><rect x="4.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="7.5" y="16.5" width="3" height="3"/><rect x="16.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="25.5" y="22.5" width="3" height="3"/>',
  "restore": '<rect x="10.5" y="1.5" width="9" height="3"/><rect x="1.5" y="4.5" width="27" height="3"/><rect x="4.5" y="7.5" width="3" height="3"/><rect x="13.5" y="7.5" width="3" height="3"/><rect x="22.5" y="7.5" width="3" height="3"/><rect x="4.5" y="10.5" width="3" height="3"/><rect x="10.5" y="10.5" width="9" height="3"/><rect x="22.5" y="10.5" width="3" height="3"/><rect x="4.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="22.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="4.5" y="19.5" width="3" height="3"/><rect x="13.5" y="19.5" width="3" height="3"/><rect x="22.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="3" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/><rect x="4.5" y="25.5" width="21" height="3"/>',
  "save": '<rect x="1.5" y="1.5" width="21" height="3"/><rect x="1.5" y="4.5" width="3" height="3"/><rect x="7.5" y="4.5" width="3" height="3"/><rect x="16.5" y="4.5" width="3" height="3"/><rect x="22.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="7.5" y="7.5" width="12" height="3"/><rect x="25.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="7.5" y="16.5" width="15" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="7.5" y="19.5" width="3" height="3"/><rect x="19.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="3" height="3"/><rect x="7.5" y="22.5" width="3" height="3"/><rect x="19.5" y="22.5" width="3" height="3"/><rect x="25.5" y="22.5" width="3" height="3"/><rect x="1.5" y="25.5" width="27" height="3"/>',
  "search": '<rect x="4.5" y="1.5" width="12" height="3"/><rect x="1.5" y="4.5" width="3" height="3"/><rect x="16.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="16.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="16.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="16.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="12" height="3"/><rect x="19.5" y="16.5" width="3" height="3"/><rect x="22.5" y="19.5" width="3" height="3"/><rect x="25.5" y="22.5" width="3" height="3"/>',
  "select-all": '<rect x="1.5" y="1.5" width="18" height="3"/><rect x="1.5" y="4.5" width="3" height="3"/><rect x="16.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="10.5" y="7.5" width="18" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="10.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="10.5" y="13.5" width="3" height="3"/><rect x="22.5" y="13.5" width="6" height="3"/><rect x="1.5" y="16.5" width="15" height="3"/><rect x="19.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="10.5" y="19.5" width="3" height="3"/><rect x="16.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="10.5" y="22.5" width="3" height="3"/><rect x="25.5" y="22.5" width="3" height="3"/><rect x="10.5" y="25.5" width="18" height="3"/>',
  "send": '<rect x="22.5" y="1.5" width="6" height="3"/><rect x="16.5" y="4.5" width="6" height="3"/><rect x="25.5" y="4.5" width="3" height="3"/><rect x="10.5" y="7.5" width="6" height="3"/><rect x="22.5" y="7.5" width="3" height="3"/><rect x="4.5" y="10.5" width="6" height="3"/><rect x="19.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="16.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="6" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="10.5" y="19.5" width="6" height="3"/><rect x="10.5" y="22.5" width="3" height="3"/>',
  "sent": '<rect x="22.5" y="1.5" width="6" height="3"/><rect x="16.5" y="4.5" width="6" height="3"/><rect x="25.5" y="4.5" width="3" height="3"/><rect x="10.5" y="7.5" width="6" height="3"/><rect x="22.5" y="7.5" width="3" height="3"/><rect x="4.5" y="10.5" width="6" height="3"/><rect x="19.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="16.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="6" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="10.5" y="19.5" width="6" height="3"/><rect x="10.5" y="22.5" width="3" height="3"/>',
  "server": '<rect x="1.5" y="1.5" width="27" height="3"/><rect x="1.5" y="4.5" width="3" height="3"/><rect x="7.5" y="4.5" width="3" height="3"/><rect x="25.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="27" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="7.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="27" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="7.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="27" height="3"/><rect x="13.5" y="22.5" width="3" height="3"/><rect x="7.5" y="25.5" width="15" height="3"/>',
  "settings": '<rect x="13.5" y="1.5" width="3" height="3"/><rect x="4.5" y="4.5" width="3" height="3"/><rect x="10.5" y="4.5" width="9" height="3"/><rect x="22.5" y="4.5" width="3" height="3"/><rect x="7.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="3" height="3"/><rect x="4.5" y="10.5" width="3" height="3"/><rect x="22.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="9" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="19.5" y="13.5" width="9" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="7.5" y="19.5" width="3" height="3"/><rect x="19.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="3" height="3"/><rect x="10.5" y="22.5" width="9" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/><rect x="13.5" y="25.5" width="3" height="3"/>',
  "shield-alert": '<rect x="1.5" y="1.5" width="27" height="3"/><rect x="1.5" y="4.5" width="3" height="3"/><rect x="25.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="13.5" y="7.5" width="3" height="3"/><rect x="25.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="13.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="4.5" y="19.5" width="3" height="3"/><rect x="13.5" y="19.5" width="3" height="3"/><rect x="22.5" y="19.5" width="3" height="3"/><rect x="7.5" y="22.5" width="3" height="3"/><rect x="19.5" y="22.5" width="3" height="3"/><rect x="10.5" y="25.5" width="9" height="3"/>',
  "shield-check": '<rect x="1.5" y="1.5" width="27" height="3"/><rect x="1.5" y="4.5" width="3" height="3"/><rect x="25.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="3" height="3"/><rect x="25.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="16.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="7.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="10.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="4.5" y="19.5" width="3" height="3"/><rect x="22.5" y="19.5" width="3" height="3"/><rect x="7.5" y="22.5" width="3" height="3"/><rect x="19.5" y="22.5" width="3" height="3"/><rect x="10.5" y="25.5" width="9" height="3"/>',
  "signature": '<rect x="4.5" y="10.5" width="3" height="3"/><rect x="19.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="7.5" y="13.5" width="3" height="3"/><rect x="16.5" y="13.5" width="3" height="3"/><rect x="22.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="10.5" y="16.5" width="6" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="22.5" width="27" height="3"/>',
  "sort": '<rect x="7.5" y="1.5" width="3" height="3"/><rect x="4.5" y="4.5" width="9" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="7.5" y="7.5" width="3" height="3"/><rect x="13.5" y="7.5" width="3" height="3"/><rect x="7.5" y="10.5" width="3" height="3"/><rect x="19.5" y="10.5" width="3" height="3"/><rect x="7.5" y="13.5" width="3" height="3"/><rect x="19.5" y="13.5" width="3" height="3"/><rect x="7.5" y="16.5" width="3" height="3"/><rect x="19.5" y="16.5" width="3" height="3"/><rect x="13.5" y="19.5" width="3" height="3"/><rect x="19.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="16.5" y="22.5" width="9" height="3"/><rect x="19.5" y="25.5" width="3" height="3"/>',
  "sound": '<rect x="13.5" y="1.5" width="3" height="3"/><rect x="10.5" y="4.5" width="6" height="3"/><rect x="22.5" y="4.5" width="3" height="3"/><rect x="7.5" y="7.5" width="3" height="3"/><rect x="13.5" y="7.5" width="3" height="3"/><rect x="25.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="9" height="3"/><rect x="13.5" y="10.5" width="3" height="3"/><rect x="19.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="19.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="9" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="19.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="7.5" y="19.5" width="3" height="3"/><rect x="13.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="10.5" y="22.5" width="6" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/><rect x="13.5" y="25.5" width="3" height="3"/>',
  "source": '<rect x="7.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="3" height="3"/><rect x="4.5" y="10.5" width="3" height="3"/><rect x="13.5" y="10.5" width="3" height="3"/><rect x="22.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="7.5" y="19.5" width="3" height="3"/><rect x="19.5" y="19.5" width="3" height="3"/>',
  "spam": '<rect x="7.5" y="1.5" width="15" height="3"/><rect x="4.5" y="4.5" width="3" height="3"/><rect x="22.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="13.5" y="7.5" width="3" height="3"/><rect x="25.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="13.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="13.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="3" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/><rect x="7.5" y="25.5" width="15" height="3"/>',
  "stop": '<rect x="7.5" y="7.5" width="15" height="3"/><rect x="7.5" y="10.5" width="15" height="3"/><rect x="7.5" y="13.5" width="15" height="3"/><rect x="7.5" y="16.5" width="15" height="3"/><rect x="7.5" y="19.5" width="15" height="3"/>',
  "success": '<rect x="7.5" y="1.5" width="15" height="3"/><rect x="4.5" y="4.5" width="3" height="3"/><rect x="22.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="25.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="19.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="16.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="7.5" y="16.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="10.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="3" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/><rect x="7.5" y="25.5" width="15" height="3"/>',
  "tag": '<rect x="1.5" y="1.5" width="15" height="3"/><rect x="1.5" y="4.5" width="3" height="3"/><rect x="13.5" y="4.5" width="6" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="7.5" y="7.5" width="3" height="3"/><rect x="16.5" y="7.5" width="6" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="19.5" y="10.5" width="6" height="3"/><rect x="1.5" y="13.5" width="6" height="3"/><rect x="22.5" y="13.5" width="6" height="3"/><rect x="4.5" y="16.5" width="6" height="3"/><rect x="19.5" y="16.5" width="6" height="3"/><rect x="7.5" y="19.5" width="6" height="3"/><rect x="16.5" y="19.5" width="6" height="3"/><rect x="10.5" y="22.5" width="9" height="3"/><rect x="13.5" y="25.5" width="3" height="3"/>',
  "thread": '<rect x="1.5" y="1.5" width="18" height="3"/><rect x="1.5" y="4.5" width="3" height="3"/><rect x="16.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="10.5" y="7.5" width="18" height="3"/><rect x="1.5" y="10.5" width="12" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="4.5" y="13.5" width="3" height="3"/><rect x="10.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="10.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="10.5" y="19.5" width="18" height="3"/><rect x="13.5" y="22.5" width="3" height="3"/>',
  "trash": '<rect x="10.5" y="1.5" width="9" height="3"/><rect x="1.5" y="4.5" width="27" height="3"/><rect x="4.5" y="7.5" width="3" height="3"/><rect x="22.5" y="7.5" width="3" height="3"/><rect x="4.5" y="10.5" width="3" height="3"/><rect x="10.5" y="10.5" width="3" height="3"/><rect x="16.5" y="10.5" width="3" height="3"/><rect x="22.5" y="10.5" width="3" height="3"/><rect x="4.5" y="13.5" width="3" height="3"/><rect x="10.5" y="13.5" width="3" height="3"/><rect x="16.5" y="13.5" width="3" height="3"/><rect x="22.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="10.5" y="16.5" width="3" height="3"/><rect x="16.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="4.5" y="19.5" width="3" height="3"/><rect x="10.5" y="19.5" width="3" height="3"/><rect x="16.5" y="19.5" width="3" height="3"/><rect x="22.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="3" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/><rect x="4.5" y="25.5" width="21" height="3"/>',
  "underline": '<rect x="7.5" y="1.5" width="3" height="3"/><rect x="19.5" y="1.5" width="3" height="3"/><rect x="7.5" y="4.5" width="3" height="3"/><rect x="19.5" y="4.5" width="3" height="3"/><rect x="7.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="3" height="3"/><rect x="7.5" y="10.5" width="3" height="3"/><rect x="19.5" y="10.5" width="3" height="3"/><rect x="7.5" y="13.5" width="3" height="3"/><rect x="19.5" y="13.5" width="3" height="3"/><rect x="10.5" y="16.5" width="9" height="3"/><rect x="4.5" y="22.5" width="21" height="3"/>',
  "unsubscribe": '<rect x="1.5" y="1.5" width="27" height="3"/><rect x="1.5" y="4.5" width="6" height="3"/><rect x="22.5" y="4.5" width="6" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="7.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="3" height="3"/><rect x="25.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="10.5" y="10.5" width="3" height="3"/><rect x="16.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="27" height="3"/><rect x="7.5" y="22.5" width="15" height="3"/>',
  "upgrade": '<rect x="1.5" y="1.5" width="27" height="3"/><rect x="13.5" y="7.5" width="3" height="3"/><rect x="10.5" y="10.5" width="9" height="3"/><rect x="7.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="19.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="13.5" y="19.5" width="3" height="3"/><rect x="13.5" y="22.5" width="3" height="3"/><rect x="13.5" y="25.5" width="3" height="3"/>',
  "upload": '<rect x="13.5" y="1.5" width="3" height="3"/><rect x="10.5" y="4.5" width="9" height="3"/><rect x="7.5" y="7.5" width="3" height="3"/><rect x="13.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="3" height="3"/><rect x="13.5" y="10.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="1.5" y="22.5" width="3" height="3"/><rect x="25.5" y="22.5" width="3" height="3"/><rect x="1.5" y="25.5" width="27" height="3"/>',
  "user": '<rect x="10.5" y="1.5" width="9" height="3"/><rect x="7.5" y="4.5" width="3" height="3"/><rect x="19.5" y="4.5" width="3" height="3"/><rect x="7.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="3" height="3"/><rect x="7.5" y="10.5" width="3" height="3"/><rect x="19.5" y="10.5" width="3" height="3"/><rect x="10.5" y="13.5" width="9" height="3"/><rect x="4.5" y="19.5" width="21" height="3"/><rect x="1.5" y="22.5" width="3" height="3"/><rect x="25.5" y="22.5" width="3" height="3"/><rect x="1.5" y="25.5" width="3" height="3"/><rect x="25.5" y="25.5" width="3" height="3"/>',
  "users": '<rect x="4.5" y="1.5" width="6" height="3"/><rect x="19.5" y="1.5" width="6" height="3"/><rect x="1.5" y="4.5" width="3" height="3"/><rect x="10.5" y="4.5" width="3" height="3"/><rect x="16.5" y="4.5" width="3" height="3"/><rect x="25.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="10.5" y="7.5" width="3" height="3"/><rect x="16.5" y="7.5" width="3" height="3"/><rect x="25.5" y="7.5" width="3" height="3"/><rect x="4.5" y="10.5" width="6" height="3"/><rect x="19.5" y="10.5" width="6" height="3"/><rect x="1.5" y="16.5" width="12" height="3"/><rect x="16.5" y="16.5" width="12" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="10.5" y="19.5" width="3" height="3"/><rect x="16.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="3" height="3"/><rect x="10.5" y="22.5" width="3" height="3"/><rect x="16.5" y="22.5" width="3" height="3"/><rect x="25.5" y="22.5" width="3" height="3"/>',
  "vacation": '<rect x="13.5" y="1.5" width="3" height="3"/><rect x="4.5" y="4.5" width="3" height="3"/><rect x="22.5" y="4.5" width="3" height="3"/><rect x="10.5" y="7.5" width="9" height="3"/><rect x="7.5" y="10.5" width="15" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="7.5" y="13.5" width="15" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="7.5" y="16.5" width="15" height="3"/><rect x="10.5" y="19.5" width="9" height="3"/><rect x="4.5" y="22.5" width="3" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/><rect x="13.5" y="25.5" width="3" height="3"/>',
  "virus": '<rect x="1.5" y="1.5" width="3" height="3"/><rect x="13.5" y="1.5" width="3" height="3"/><rect x="25.5" y="1.5" width="3" height="3"/><rect x="4.5" y="4.5" width="3" height="3"/><rect x="10.5" y="4.5" width="9" height="3"/><rect x="22.5" y="4.5" width="3" height="3"/><rect x="7.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="3" height="3"/><rect x="4.5" y="10.5" width="3" height="3"/><rect x="22.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="6" height="3"/><rect x="22.5" y="13.5" width="6" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="7.5" y="19.5" width="3" height="3"/><rect x="19.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="3" height="3"/><rect x="10.5" y="22.5" width="9" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/><rect x="1.5" y="25.5" width="3" height="3"/><rect x="13.5" y="25.5" width="3" height="3"/><rect x="25.5" y="25.5" width="3" height="3"/>',
  "warning": '<rect x="13.5" y="1.5" width="3" height="3"/><rect x="10.5" y="4.5" width="3" height="3"/><rect x="16.5" y="4.5" width="3" height="3"/><rect x="10.5" y="7.5" width="3" height="3"/><rect x="16.5" y="7.5" width="3" height="3"/><rect x="7.5" y="10.5" width="3" height="3"/><rect x="13.5" y="10.5" width="3" height="3"/><rect x="19.5" y="10.5" width="3" height="3"/><rect x="7.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="19.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="4.5" y="19.5" width="3" height="3"/><rect x="22.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="3" height="3"/><rect x="13.5" y="22.5" width="3" height="3"/><rect x="25.5" y="22.5" width="3" height="3"/><rect x="1.5" y="25.5" width="27" height="3"/>'
};
var iconNames = Object.keys(bodies);
function icon(name, label = "") {
  const a11y = label ? ` role="img" aria-label="${label.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c)}"` : ` aria-hidden="true"`;
  return `<svg class="icon icon-${name}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30" fill="currentColor" shape-rendering="crispEdges" focusable="false"${a11y}>${bodies[name]}</svg>`;
}

// src/admin/domains.ts
var CAPS = ["LIST-STATUS", "METADATA", "MOVE", "SORT", "THREAD", "BINARY", "STATUS=SIZE", "PREVIEW"];
var SECURE = [
  ["0", "Ohne"],
  ["1", "SSL"],
  ["2", "STARTTLS"],
  ["9", "Auto"]
];
async function paintDomains(ctx2, slot) {
  slot.innerHTML = `
    <div class="action">
      <button type="button" class="ink-btn" data-action="add">${icon("plus")}<span class="btn-label">${esc(t("TAB_DOMAINS.BUTTON_ADD_DOMAIN", "Domain hinzuf\xFCgen"))}</span></button>
      <button type="button" class="text-btn" data-action="alias">${icon("plus")}<span class="btn-label">${esc(t("TAB_DOMAINS.BUTTON_ADD_ALIAS", "Alias hinzuf\xFCgen"))}</span></button>
    </div>
    <p class="error" data-for="list" hidden></p>
    <ul class="set-list" id="domains"></ul>
    <dialog id="domain-dialog" class="dialog-wide"></dialog>
    <dialog id="confirm"><div class="dialog-body">
      <h2 class="title title-md">${esc(t("TAB_DOMAINS.DELETE_ARE_YOU_SURE", "Sind Sie sicher?"))}</h2>
      <div class="dialog-actions"><button type="button" class="text-btn" value="cancel">${esc(t("GLOBAL.CANCEL", "Abbrechen"))}</button><button type="button" class="danger" value="ok">${icon("delete")}<span class="btn-label">${esc(t("GLOBAL.DELETE", "L\xF6schen"))}</span></button></div>
    </div></dialog>`;
  const confirm = slot.querySelector("#confirm");
  confirm.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (button) confirm.close(button.value);
  });
  slot.querySelector("[data-action='add']")?.addEventListener("click", () => openDomain(ctx2, slot, "", false));
  slot.querySelector("[data-action='alias']")?.addEventListener("click", () => openAlias(ctx2, slot, ""));
  await loadList(ctx2, slot);
}
async function loadList(ctx2, slot) {
  const list = slot.querySelector("#domains");
  const error = slot.querySelector("[data-for='list']");
  if (!list) return;
  try {
    const result2 = await ctx2.call("AdminDomainList", { includeAliases: "1" });
    const rows = Array.isArray(result2) ? result2 : Object.values(result2 || {});
    if (!rows.length) {
      list.innerHTML = `<li class="quiet">${esc(t("TAB_DOMAINS.EMPTY", "Keine Domains."))}</li>`;
      return;
    }
    list.innerHTML = rows.map((item) => {
      const name = String(item.name || "");
      const meta = [item.alias ? t("TAB_DOMAINS.LABEL_ALIAS", "Alias") : "", item.disabled ? t("GLOBAL.INACTIVE", "Inaktiv") : ""].filter(Boolean).join(" \xB7 ");
      const toggle = item.disabled ? t("TAB_DOMAINS.BUTTON_ENABLE", "Aktivieren") : t("TAB_DOMAINS.BUTTON_DISABLE", "Deaktivieren");
      return `<li class="set-row"><button type="button" class="text-btn grow" data-action="edit" data-name="${esc(name)}" data-alias="${item.alias ? "1" : "0"}"><span class="grow"><strong>${esc(name)}</strong>${meta ? `<span class="quiet">${esc(meta)}</span>` : ""}</span></button><button type="button" class="text-btn" data-action="toggle" data-name="${esc(name)}" data-disabled="${item.disabled ? "1" : "0"}">${icon(item.disabled ? "check" : "minus")}<span class="btn-label">${esc(toggle)}</span></button><button type="button" class="danger" data-action="delete" data-name="${esc(name)}">${icon("delete")}<span class="btn-label">${esc(t("GLOBAL.DELETE", "L\xF6schen"))}</span></button></li>`;
    }).join("");
    list.querySelectorAll("[data-action='edit']").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.alias === "1") openAlias(ctx2, slot, button.dataset.name || "");
        else openDomain(ctx2, slot, button.dataset.name || "", false);
      });
    });
    list.querySelectorAll("[data-action='toggle']").forEach((button) => {
      button.addEventListener("click", () => {
        void ctx2.call("AdminDomainDisable", {
          name: button.dataset.name || "",
          disabled: button.dataset.disabled === "1" ? "0" : "1"
        }).then(() => loadList(ctx2, slot)).catch((error2) => show(slot, explain(error2)));
      });
    });
    list.querySelectorAll("[data-action='delete']").forEach((button) => {
      button.addEventListener("click", () => {
        void remove(ctx2, slot, button.dataset.name || "");
      });
    });
    if (error) error.hidden = true;
  } catch (error2) {
    show(slot, explain(error2));
  }
}
function show(slot, message) {
  const error = slot.querySelector("[data-for='list']");
  if (!error) return;
  error.hidden = false;
  error.textContent = message;
}
async function remove(ctx2, slot, name) {
  const dialog = slot.querySelector("#confirm");
  if (!dialog || !name) return;
  dialog.showModal();
  const ok = await new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok"), { once: true });
  });
  if (!ok) return;
  try {
    await ctx2.call("AdminDomainDelete", { name });
    await loadList(ctx2, slot);
  } catch (error) {
    show(slot, explain(error));
  }
}
function blank() {
  return {
    whiteList: "",
    IMAP: { host: "", port: 993, type: 1, timeout: 300, disabled_capabilities: [], ssl: {} },
    SMTP: { host: "", port: 465, type: 1, timeout: 60, useAuth: true, ssl: {} },
    Sieve: { host: "", port: 4190, type: 0, timeout: 10, enabled: false, ssl: {} }
  };
}
async function openDomain(ctx2, slot, name, creating) {
  const dialog = slot.querySelector("#domain-dialog");
  if (!dialog) return;
  let body = blank();
  if (name && !creating) {
    try {
      body = await ctx2.call("AdminDomainLoad", { name });
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
    <h2 class="title title-md">${esc(name ? t("POPUPS_DOMAIN.TITLE_EDIT_DOMAIN", "Domain bearbeiten").replace("%NAME%", name) : t("POPUPS_DOMAIN.TITLE_ADD_DOMAIN", "Domain hinzuf\xFCgen"))}</h2>
    ${field("name", t("POPUPS_DOMAIN.LABEL_NAME", "Name"), name, creating || !name ? "" : "readonly")}
    <h3 class="title title-md">IMAP</h3>
    ${conn("IMAP", imap)}
    <p class="mono">${esc(t("POPUPS_DOMAIN.DISABLE_CAPABILITIES", "Funktionen deaktivieren"))}</p>
    ${CAPS.map((cap) => check(`cap-${cap}`, cap, caps.has(cap))).join("")}
    ${field("IMAP.message_list_limit", t("POPUPS_DOMAIN.LIMITS", "Grenzwerte"), String(imap.message_list_limit ?? 1e4), 'inputmode="numeric"')}
    ${field("IMAP.search_filter", t("GLOBAL.SEARCH", "Suchen"), String(imap.search_filter || ""))}
    ${field("IMAP.spam_headers", t("POPUPS_DOMAIN.VALID_SPAM_HEADERS", "Spam-Header beachten"), String(imap.spam_headers || ""))}
    ${field("IMAP.virus_headers", t("POPUPS_DOMAIN.VALID_VIRUS_HEADERS", "Virus-Header beachten"), String(imap.virus_headers || ""))}
    ${check("IMAP.use_expunge_all_on_delete", "Expunge beim L\xF6schen", Boolean(imap.use_expunge_all_on_delete))}
    ${check("IMAP.fast_simple_search", "Schnelle Suche", imap.fast_simple_search !== false)}
    ${check("IMAP.force_select", "SELECT erzwingen", Boolean(imap.force_select))}
    ${check("IMAP.message_all_headers", "Alle Kopfzeilen", Boolean(imap.message_all_headers))}
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
    <p class="quiet">${esc(t("POPUPS_DOMAIN.WHITE_LIST_ALERT", "Liste der Domain-User, die Webmail verwenden d\xFCrfen. Verwenden Sie Leerzeichen als Trennsymbol."))}</p>
    <div class="action">
      <button type="button" class="ink-btn" data-action="save">${esc(t("GLOBAL.SAVE", "Speichern"))}</button>
      <button type="button" class="text-btn" data-action="test">${esc(t("UI.TEST_CONNECTION", "Verbindung testen"))}</button>
      <button type="button" class="text-btn" data-action="auto">${esc(t("UI.AUTOCONFIG", "Autoconfig"))}</button>
      <button type="button" class="text-btn" data-action="match">${esc(t("UI.MATCH", "Domain-Abgleich testen"))}</button>
      <button type="button" class="text-btn" value="cancel">${esc(t("GLOBAL.CANCEL", "Abbrechen"))}</button>
    </div>
    <div class="fields" data-for="tools" hidden>
      ${field("authUser", t("GLOBAL.USERNAME", "Nutzername"), "")}
      ${field("authPass", t("GLOBAL.PASSWORD", "Passwort"), "", 'type="password"')}
      ${field("matchUser", t("UI.MATCH", "Domain-Abgleich testen"), "")}
      <p class="quiet" data-for="result"></p>
    </div>
  </form>`;
  dialog.querySelector("[value='cancel']")?.addEventListener("click", () => dialog.close());
  dialog.querySelector("[data-action='save']")?.addEventListener("click", () => {
    void saveDomain(ctx2, slot, dialog, Boolean(name) && !creating, body);
  });
  dialog.querySelector("[data-action='test']")?.addEventListener("click", () => {
    void testDomain(ctx2, dialog, body);
  });
  dialog.querySelector("[data-action='auto']")?.addEventListener("click", () => {
    void auto(ctx2, dialog);
  });
  dialog.querySelector("[data-action='match']")?.addEventListener("click", () => {
    void match(ctx2, dialog);
  });
  const tools = dialog.querySelector("[data-for='tools']");
  dialog.querySelectorAll("[data-action='test'], [data-action='match']").forEach((button) => {
    button.addEventListener("click", () => {
      tools.hidden = false;
    });
  });
  dialog.showModal();
}
function conn(prefix, conn2) {
  const type = String(conn2.type ?? 0);
  return [
    field(`${prefix}.host`, t("POPUPS_DOMAIN.LABEL_SERVER", "Server"), String(conn2.host || "")),
    field(`${prefix}.port`, t("POPUPS_DOMAIN.LABEL_PORT", "Port"), String(conn2.port ?? ""), 'inputmode="numeric"'),
    `<label class="field"><span>${esc(t("POPUPS_DOMAIN.LABEL_SECURE", "Sicherheit"))}</span><select name="${prefix}.type">${SECURE.map(([id, label]) => `<option value="${id}"${id === type ? " selected" : ""}>${esc(id === "0" ? t("POPUPS_DOMAIN.SECURE_OPTION_NONE", label) : label)}</option>`).join("")}</select></label>`,
    field(`${prefix}.timeout`, t("POPUPS_DOMAIN.TIMEOUT", "Timeout"), String(conn2.timeout ?? ""), 'inputmode="numeric"'),
    check(`${prefix}.shortLogin`, t("POPUPS_DOMAIN.LABEL_USE_SHORT_LOGIN", "Kurze Benutzernamen verwenden"), Boolean(conn2.shortLogin)),
    check(`${prefix}.lowerLogin`, t("POPUPS_DOMAIN.LABEL_LOWERCASE_LOGIN", "Login in Kleinbuchstaben konvertieren"), Boolean(conn2.lowerLogin)),
    field(`${prefix}.stripLogin`, "Login-Suffix entfernen", String(conn2.stripLogin || ""))
  ].join("");
}
function readDomain(form, previous, existed) {
  const data = new FormData(form);
  const text = (name) => String(data.get(name) || "");
  const on = (name) => Boolean(form.querySelector(`[name='${name}']`)?.checked);
  const block = (prefix, extra, prior) => ({
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
async function saveDomain(ctx2, slot, dialog, existed, previous) {
  const form = dialog.querySelector("form");
  if (!form) return;
  try {
    await ctx2.call("AdminDomainSave", readDomain(form, previous, existed));
    dialog.close();
    await loadList(ctx2, slot);
  } catch (error) {
    result(dialog, explain(error));
  }
}
async function testDomain(ctx2, dialog, previous) {
  const form = dialog.querySelector("form");
  if (!form) return;
  const payload = readDomain(form, previous, true);
  const data = new FormData(form);
  try {
    const answer = await ctx2.call("AdminDomainTest", {
      ...payload,
      auth: { user: String(data.get("authUser") || ""), pass: String(data.get("authPass") || "") }
    });
    result(dialog, ["IMAP", "SMTP", "Sieve"].map((name) => `${name}: ${answer[name] === true ? "ok" : String(answer[name] || "")}`).join("\n"));
  } catch (error) {
    result(dialog, explain(error));
  }
}
async function auto(ctx2, dialog) {
  const form = dialog.querySelector("form");
  if (!form) return;
  const name = String(new FormData(form).get("name") || "").trim().toLowerCase();
  try {
    const answer = await ctx2.call("AdminDomainAutoconfig", { domain: name });
    const incoming = answer.config?.incomingServer?.[0];
    const outgoing = answer.config?.outgoingServer?.[0];
    applyServer(form, "IMAP", incoming);
    applyServer(form, "SMTP", outgoing);
    result(dialog, answer.config ? t("UI.SAVED", "Gespeichert.") : t("ERRORS.UNKNOWN_ERROR", "Keine Autoconfig gefunden."));
  } catch (error) {
    result(dialog, explain(error));
  }
}
function applyServer(form, prefix, server) {
  if (!server) return;
  const host = form.querySelector(`[name='${prefix}.host']`);
  const port = form.querySelector(`[name='${prefix}.port']`);
  const type = form.querySelector(`[name='${prefix}.type']`);
  if (host && server.hostname) host.value = server.hostname;
  if (port && server.port) port.value = server.port;
  if (type && server.socketType) {
    const socket = server.socketType.toUpperCase();
    type.value = socket.includes("SSL") ? "1" : socket.includes("START") ? "2" : "0";
  }
}
async function match(ctx2, dialog) {
  const form = dialog.querySelector("form");
  if (!form) return;
  const username = String(new FormData(form).get("matchUser") || "");
  try {
    const answer = await ctx2.call("AdminDomainMatch", { username });
    result(dialog, `email ${String(answer.email || "")}
login ${String(answer.login || "")}
name ${String(answer.name || "")}
whitelist ${String(answer.whitelist)}`);
  } catch (error) {
    result(dialog, explain(error));
  }
}
function result(dialog, text) {
  const box = dialog.querySelector("[data-for='tools']");
  const out = dialog.querySelector("[data-for='result']");
  if (box) box.hidden = false;
  if (out) out.textContent = text;
}
function openAlias(ctx2, slot, alias) {
  const dialog = slot.querySelector("#domain-dialog");
  if (!dialog) return;
  dialog.innerHTML = `<form class="dialog-body">
    <h2 class="title title-md">${esc(t("POPUPS_DOMAIN_ALIAS.TITLE_ADD_DOMAIN_ALIAS", "Alias hinzuf\xFCgen"))}</h2>
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
    void ctx2.call("AdminDomainAliasSave", {
      alias: String(data.get("alias") || ""),
      name: String(data.get("name") || "")
    }).then(async () => {
      dialog.close();
      await loadList(ctx2, slot);
    }).catch((error) => {
      const out = dialog.querySelector("[data-for='alias']");
      out.hidden = false;
      out.textContent = explain(error);
    });
  });
  dialog.showModal();
}

// src/admin/packages.ts
async function paintPackages(ctx2, slot) {
  slot.innerHTML = `<p class="error" data-for="packages" hidden></p><div id="package-lists"></div><dialog id="plugin-dialog" class="dialog-wide"></dialog>`;
  try {
    const data = await ctx2.call("AdminPackagesList");
    const list = data.List || [];
    const installed = list.filter((item) => item.installed);
    const updates = installed.filter((item) => item.canBeUpdated);
    const available = list.filter((item) => !item.installed);
    const host = slot.querySelector("#package-lists");
    if (!host) return;
    host.innerHTML = [
      data.Error ? `<p class="error">${esc(data.Error || t("TAB_PACKAGES.ALERT_CANNOT_ACCESS_REPOSITORY", "Momentan kann nicht auf das Repository zugegriffen werden."))}</p>` : "",
      group(t("TAB_PACKAGES.LEGEND_INSTALLED_PACKAGES", "Installierte Erweiterungen"), installed, true),
      group(t("TAB_PACKAGES.LEGEND_AVAILABLE_FOR_UPDATE", "Zur Aktualisierung verf\xFCgbar"), updates, true),
      group(t("TAB_PACKAGES.LEGEND_AVAILABLE_FOR_INSTALLATION", "Zur Installation verf\xFCgbar"), available, false)
    ].join("");
    host.querySelectorAll("[data-action='toggle']").forEach((button) => {
      button.addEventListener("click", () => {
        void ctx2.call("AdminPluginDisable", {
          id: button.dataset.id || "",
          disabled: button.dataset.enabled === "1" ? "1" : "0"
        }).then(() => paintPackages(ctx2, slot)).catch((error) => fail(slot, explain(error)));
      });
    });
    host.querySelectorAll("[data-action='install']").forEach((button) => {
      button.addEventListener("click", () => {
        void ctx2.call("AdminPackageInstall", {
          id: button.dataset.id || "",
          type: button.dataset.type || "plugin",
          file: button.dataset.file || ""
        }).then(() => paintPackages(ctx2, slot)).catch((error) => fail(slot, explain(error)));
      });
    });
    host.querySelectorAll("[data-action='delete']").forEach((button) => {
      button.addEventListener("click", () => {
        void ctx2.call("AdminPackageDelete", { id: button.dataset.id || "" }).then(() => paintPackages(ctx2, slot)).catch((error) => fail(slot, explain(error)));
      });
    });
    host.querySelectorAll("[data-action='config']").forEach((button) => {
      button.addEventListener("click", () => {
        void openPlugin(ctx2, slot, button.dataset.id || "");
      });
    });
  } catch (error) {
    fail(slot, explain(error));
  }
}
function fail(slot, message) {
  const node = slot.querySelector("[data-for='packages']");
  if (!node) return;
  node.hidden = false;
  node.textContent = message;
}
function group(title, rows, installed) {
  if (!rows.length) return "";
  const items = rows.map((item) => {
    const id = String(item.id || "");
    const name = String(item.name || id);
    const meta = [item.installed || item.version || "", item.type || ""].filter(Boolean).join(" \xB7 ");
    const toggle = item.enabled ? t("TAB_DOMAINS.BUTTON_DISABLE", "Deaktivieren") : t("TAB_DOMAINS.BUTTON_ENABLE", "Aktivieren");
    const buttons = [
      installed && item.type !== "plugin" ? "" : installed ? `<button type="button" class="text-btn" data-action="toggle" data-id="${esc(id)}" data-enabled="${item.enabled ? "1" : "0"}">${esc(toggle)}</button>` : "",
      installed ? `<button type="button" class="text-btn" data-action="config" data-id="${esc(id)}">${esc(t("POPUPS_PLUGIN.TITLE_PLUGIN", "Erweiterung"))}</button>` : "",
      !installed || item.canBeUpdated ? `<button type="button" class="text-btn" data-action="install" data-id="${esc(id)}" data-type="${esc(String(item.type || "plugin"))}" data-file="${esc(String(item.file || ""))}">${esc(item.canBeUpdated ? t("GLOBAL.UPDATE", "Aktualisieren") : t("GLOBAL.ADD", "Hinzuf\xFCgen"))}</button>` : "",
      item.canBeDeleted ? `<button type="button" class="danger" data-action="delete" data-id="${esc(id)}">${icon("delete")}<span class="btn-label">${esc(t("GLOBAL.DELETE", "L\xF6schen"))}</span></button>` : ""
    ].join("");
    return `<li class="set-row"><span class="grow"><strong>${esc(name)}</strong><span class="quiet">${esc(meta)}</span></span>${buttons}</li>`;
  }).join("");
  return `<h2 class="title title-md">${esc(title)}</h2><ul class="set-list">${items}</ul>`;
}
async function openPlugin(ctx2, slot, id) {
  const dialog = slot.querySelector("#plugin-dialog");
  if (!dialog || !id) return;
  const plugin = await ctx2.call("AdminPluginLoad", { id });
  const config = plugin.config || [];
  dialog.innerHTML = `<form class="dialog-body">
    <h2 class="title title-md">${esc(plugin.name || id)}</h2>
    ${plugin.readme ? `<p class="quiet">${esc(plugin.readme)}</p>` : ""}
    ${config.length ? config.map((item) => prop(item)).join("") : `<p class="quiet">${esc(t("POPUPS_PLUGIN.DESC_NOTHING_TO_CONFIGURE", "Nichts zu konfigurieren"))}</p>`}
    <div class="action">
      <button type="button" class="ink-btn" data-action="save">${esc(t("GLOBAL.SAVE", "Speichern"))}</button>
      <button type="button" class="text-btn" value="cancel">${esc(t("GLOBAL.CLOSE", "Schlie\xDFen"))}</button>
    </div>
    <p class="error" data-for="plugin" hidden></p>
  </form>`;
  dialog.querySelector("[value='cancel']")?.addEventListener("click", () => dialog.close());
  dialog.querySelector("[data-action='save']")?.addEventListener("click", () => {
    const form = dialog.querySelector("form");
    if (!form) return;
    const settings = {};
    form.querySelectorAll("[data-prop]").forEach((input) => {
      const key = input.dataset.prop || "";
      if (input instanceof HTMLInputElement && input.type === "checkbox") settings[key] = input.checked;
      else settings[key] = input.value;
    });
    void ctx2.call("AdminPluginSettingsUpdate", { id, settings }).then(() => dialog.close()).catch((error) => {
      const out = dialog.querySelector("[data-for='plugin']");
      out.hidden = false;
      out.textContent = explain(error);
    });
  });
  dialog.showModal();
}
function prop(item) {
  if (item.type === 7) {
    return `<fieldset class="vacation-box"><legend>${esc(String(item.label || ""))}</legend>${(item.config || []).map((child) => prop(child)).join("")}</fieldset>`;
  }
  const name = String(item.name || "");
  const label = String(item.label || name);
  const value = item.value == null ? "" : String(item.value);
  const hint = item.desc ? `<p class="quiet">${esc(String(item.desc))}</p>` : "";
  if (item.type === 5) {
    return `<label class="check"><input data-prop="${esc(name)}" type="checkbox"${item.value ? " checked" : ""}><span>${esc(label)}</span></label>${hint}`;
  }
  if (item.type === 2) {
    return `<label class="field"><span>${esc(label)}</span><textarea class="short" data-prop="${esc(name)}">${esc(value)}</textarea></label>${hint}`;
  }
  if (item.type === 4 || item.type === 8) {
    const options = Array.isArray(item.options) ? item.options.map((entry) => [String(entry), String(entry)]) : Object.entries(item.options || {});
    return `<label class="field"><span>${esc(label)}</span><select data-prop="${esc(name)}">${options.map(([id, text]) => `<option value="${esc(id)}"${id === value ? " selected" : ""}>${esc(text)}</option>`).join("")}</select></label>${hint}`;
  }
  const type = item.type === 3 ? "password" : item.type === 1 ? "number" : item.type === 6 ? "url" : "text";
  const shown = item.type === 3 ? DUMMY : value;
  return `<label class="field"><span>${esc(label)}</span><input data-prop="${esc(name)}" type="${type}" value="${esc(shown)}"></label>${hint}`;
}

// src/admin/settings-forms.ts
function paintGeneral(ctx2, slot) {
  const langs = ctx2.app.Admin?.languages || ["de", "en"];
  slot.innerHTML = `<form class="fields">
    <h2 class="title title-md">${esc(t("TAB_GENERAL.LEGEND_MAIN", "Allgemein"))}</h2>
    ${langSelect("language", t("TAB_GENERAL.LABEL_LANGUAGE", "Sprache"), String(cell(ctx2.cfg, "webmail", "language") || ""), langs)}
    ${langSelect("languageAdmin", t("TAB_GENERAL.LABEL_LANGUAGE_ADMIN", "Sprache (Adminpanel)"), String(ctx2.app.Admin?.language || cell(ctx2.cfg, "admin_panel", "language") || ""), langs)}
    ${field("attachmentLimit", t("TAB_GENERAL.LABEL_ATTACHMENT_SIZE_LIMIT", "Gr\xF6\xDFenlimit f\xFCr Anh\xE4nge"), String(cell(ctx2.cfg, "webmail", "attachment_size_limit") ?? ""), 'inputmode="numeric"')}
    <p class="quiet">${esc(t("UI.MB", "Angabe in MB. 0 hebt die Grenze auf."))}</p>
    ${check("allowLanguagesOnSettings", t("TAB_GENERAL.LABEL_ALLOW_LANGUAGES_ON_SETTINGS", "Sprachauswahl in den Einstellungen zulassen"), flag(cell(ctx2.cfg, "webmail", "allow_languages_on_settings")))}
    <button type="button" class="ink-btn" data-save>${esc(t("GLOBAL.SAVE", "Speichern"))}</button>
  </form>`;
  bind(ctx2, slot);
}
function paintLogin(ctx2, slot) {
  slot.innerHTML = `<form class="fields">
    <h2 class="title title-md">${esc(t("TAB_LOGIN.LEGEND_LOGIN_SCREEN", "Anmeldebildschirm"))}</h2>
    ${field("loginDefaultDomain", t("TAB_LOGIN.LABEL_DEFAULT_DOMAIN", "Standarddomain"), String(cell(ctx2.cfg, "login", "default_domain") || ""))}
    ${check("determineUserDomain", t("TAB_LOGIN.LABEL_DETERMINE_USER_DOMAIN", "Domain des Benutzers automatisch ermitteln"), flag(cell(ctx2.cfg, "login", "determine_user_domain")))}
    ${check("allowLanguagesOnLogin", t("TAB_LOGIN.LABEL_ALLOW_LANGUAGES_ON_LOGIN", "Sprachauswahl bei der Anmeldung zulassen"), flag(cell(ctx2.cfg, "login", "allow_languages_on_login")))}
    ${check("determineUserLanguage", t("TAB_LOGIN.LABEL_DETERMINE_USER_LANGUAGE", "Sprache des Benutzers automatisch ermitteln"), flag(cell(ctx2.cfg, "login", "determine_user_language")))}
    <button type="button" class="ink-btn" data-save>${esc(t("GLOBAL.SAVE", "Speichern"))}</button>
  </form>`;
  bind(ctx2, slot);
}
function paintBranding(ctx2, slot) {
  slot.innerHTML = `<form class="fields">
    <h2 class="title title-md">${esc(t("TAB_BRANDING.LEGEND_BRANDING", "Branding"))}</h2>
    ${field("title", t("TAB_BRANDING.LABEL_PAGE_TITLE", "Seitentitel"), String(cell(ctx2.cfg, "webmail", "title") || ""))}
    ${field("loadingDescription", t("TAB_BRANDING.LABEL_LOADING_DESCRIPTION", "Beschreibungstext f\xFCr Ladevorgang"), String(cell(ctx2.cfg, "webmail", "loading_description") || ""))}
    ${field("faviconUrl", t("TAB_BRANDING.LABEL_FAVICON_URL", "Favicon"), String(cell(ctx2.cfg, "webmail", "favicon_url") || ""))}
    <button type="button" class="ink-btn" data-save>${esc(t("GLOBAL.SAVE", "Speichern"))}</button>
  </form>`;
  bind(ctx2, slot);
}
function paintContacts(ctx2, slot) {
  const drivers = (ctx2.app.supportedPdoDrivers || ["sqlite"]).map((id) => [id, id]);
  const type = String(cell(ctx2.cfg, "contacts", "type") || "sqlite");
  slot.innerHTML = `<form class="fields">
    <h2 class="title title-md">${esc(t("TAB_CONTACTS.LEGEND_STORAGE", "Speicher (PDO)"))}</h2>
    ${check("contactsEnable", t("TAB_CONTACTS.LABEL_ENABLE_CONTACTS", "Kontakte aktivieren"), flag(cell(ctx2.cfg, "contacts", "enable")))}
    ${check("contactsSync", t("TAB_CONTACTS.LABEL_ALLOW_SYNC", "Synchronisierung von Kontakten erlauben (mit externem CardDAV-Server)"), flag(cell(ctx2.cfg, "contacts", "allow_sync")))}
    ${select("contactsPdoType", t("TAB_CONTACTS.LABEL_STORAGE_TYPE", "Typ"), type, drivers)}
    ${field("contactsPdoDsn", t("TAB_CONTACTS.LABEL_STORAGE_DSN", "DSN"), String(cell(ctx2.cfg, "contacts", "pdo_dsn") || ""))}
    ${field("contactsPdoUser", t("TAB_CONTACTS.LABEL_STORAGE_USER", "Benutzer"), String(cell(ctx2.cfg, "contacts", "pdo_user") || ""))}
    ${field("contactsPdoPassword", t("TAB_CONTACTS.LABEL_STORAGE_PASSWORD", "Passwort"), DUMMY, 'type="password" autocomplete="new-password"')}
    ${field("contactsMySQLSSLCA", "MySQL SSL CA", String(cell(ctx2.cfg, "contacts", "mysql_ssl_ca") || ""))}
    ${check("contactsMySQLSSLVerify", "MySQL SSL pr\xFCfen", flag(cell(ctx2.cfg, "contacts", "mysql_ssl_verify")))}
    ${field("contactsMySQLSSLCiphers", "MySQL SSL Ciphers", String(cell(ctx2.cfg, "contacts", "mysql_ssl_ciphers") || ""))}
    ${check("contactsSQLiteGlobal", t("TAB_CONTACTS.SQLITE_GLOBAL", "Eine globale DB verwenden statt einer pro Account"), flag(cell(ctx2.cfg, "contacts", "sqlite_global")))}
    ${field("contactsSuggestionsLimit", t("TAB_CONTACTS.SUGGESTIONS_LIMIT", "Limit f\xFCr Empfehlungen"), String(cell(ctx2.cfg, "contacts", "suggestions_limit") ?? "20"), 'inputmode="numeric"')}
    <div class="action">
      <button type="button" class="ink-btn" data-save>${esc(t("GLOBAL.SAVE", "Speichern"))}</button>
      <button type="button" class="text-btn" data-action="test">${icon("check")}<span class="btn-label">${esc(t("GLOBAL.TEST", "Testen"))}</span></button>
    </div>
    <p class="quiet" data-for="test" hidden></p>
  </form>`;
  bind(ctx2, slot);
  slot.querySelector("[data-action='test']")?.addEventListener("click", () => {
    void testContacts(ctx2, slot);
  });
}
async function testContacts(ctx2, slot) {
  const form = slot.querySelector("form");
  const out = slot.querySelector("[data-for='test']");
  if (!form || !out) return;
  const data = new FormData(form);
  out.hidden = false;
  out.textContent = t("TAB_ABOUT.LABEL_CHECKING", "\xDCberpr\xFCfe auf Aktualisierungen");
  try {
    const result2 = await ctx2.call("AdminContactsTest", {
      PdoType: String(data.get("contactsPdoType") || ""),
      PdoDsn: String(data.get("contactsPdoDsn") || ""),
      PdoUser: String(data.get("contactsPdoUser") || ""),
      PdoPassword: String(data.get("contactsPdoPassword") || ""),
      MySQLSSLCA: String(data.get("contactsMySQLSSLCA") || ""),
      MySQLSSLVerify: form.querySelector("[name='contactsMySQLSSLVerify']")?.checked ? "1" : "0",
      MySQLSSLCiphers: String(data.get("contactsMySQLSSLCiphers") || ""),
      SQLiteGlobal: form.querySelector("[name='contactsSQLiteGlobal']")?.checked ? "1" : "0"
    });
    out.textContent = result2.Result ? t("UI.SAVED", "Verbindung in Ordnung.") : result2.Message || t("ERRORS.UNKNOWN_ERROR", "Unbekannter Fehler");
  } catch (error) {
    out.textContent = explain(error);
  }
}
function paintSecurity(ctx2, slot) {
  slot.innerHTML = `<form class="fields" id="security-form">
    <h2 class="title title-md">${esc(t("TAB_SECURITY.LEGEND_SECURITY", "Sicherheit"))}</h2>
    ${check("proxyExternalImages", t("TAB_SECURITY.LABEL_USE_IMAGE_PROXY", "Lokalen Proxy f\xFCr externe Bilder verwenden"), flag(cell(ctx2.cfg, "labs", "use_local_proxy_for_external_images")))}
    ${check("autoVerifySignatures", t("TAB_SECURITY.LABEL_AUTO_VERIFY", "Signaturen automatisch \xFCberpr\xFCfen"), flag(cell(ctx2.cfg, "security", "auto_verify_signatures")))}
    ${check("CapaAdditionalAccounts", t("TAB_GENERAL.LABEL_ALLOW_ADDITIONAL_ACCOUNTS", "Zus\xE4tzliche Konten erlauben"), flag(cell(ctx2.cfg, "webmail", "allow_additional_accounts")))}
    ${check("CapaIdentities", t("TAB_GENERAL.LABEL_ALLOW_IDENTITIES", "Mehrere Identit\xE4ten erlauben"), flag(cell(ctx2.cfg, "webmail", "allow_additional_identities")))}
    ${check("CapaAttachmentThumbnails", t("TAB_GENERAL.LABEL_SHOW_THUMBNAILS", "Vorschaubilder anzeigen (Anh\xE4nge)"), flag(cell(ctx2.cfg, "interface", "show_attachment_thumbnail")))}
    ${check("capaGnuPG", t("UI.GNUPG", "GnuPG erlauben"), flag(cell(ctx2.cfg, "security", "gnupg")))}
    ${check("capaOpenPGP", t("UI.OPENPGP", "OpenPGP erlauben"), flag(cell(ctx2.cfg, "security", "openpgp")))}
    ${check("pluginsEnable", t("TAB_PACKAGES.LABEL_ENABLE_PLUGINS", "Erweiterungen aktivieren"), flag(cell(ctx2.cfg, "plugins", "enable")))}
    <button type="button" class="ink-btn" data-save>${esc(t("GLOBAL.SAVE", "Speichern"))}</button>
  </form>
  <form class="fields" id="access-form">
    <h2 class="title title-md">${esc(t("TAB_SECURITY.LEGEND_ADMIN_PANEL_ACCESS_CREDENTIALS", "Adminpanel-Zugangsdaten"))}</h2>
    ${field("Login", t("GLOBAL.USERNAME", "Nutzername"), String(ctx2.app.adminLogin || "admin"), 'autocomplete="username"')}
    ${field("Password", t("TAB_SECURITY.LABEL_CURRENT_PASSWORD", "Aktuelles Passwort"), "", 'type="password" autocomplete="current-password" required')}
    ${field("newPassword", t("TAB_SECURITY.LABEL_NEW_PASSWORD", "Neues Passwort"), "", 'type="password" autocomplete="new-password"')}
    ${field("repeat", t("TAB_SECURITY.LABEL_REPEAT_PASSWORD", "Wiederholen"), "", 'type="password" autocomplete="new-password"')}
    ${field("TOTP", t("LOGIN.LABEL_TOTP", "TOTP-Code"), String(ctx2.app.adminTOTP || ""), 'autocomplete="off" spellcheck="false"')}
    <div class="action">
      <button type="button" class="ink-btn" data-action="password">${esc(t("GLOBAL.SAVE", "Speichern"))}</button>
      <button type="button" class="text-btn" data-action="qr">${icon("key")}<span class="btn-label">${esc(t("UI.TOTP_SETUP", "TOTP einrichten"))}</span></button>
      <button type="button" class="text-btn" data-action="clear-totp">${esc(t("UI.TOTP_CLEAR", "TOTP entfernen"))}</button>
    </div>
    <div data-for="qr" hidden></div>
    <p class="quiet" data-for="access" hidden></p>
  </form>`;
  bind(ctx2, slot);
  slot.querySelector("[data-action='password']")?.addEventListener("click", () => {
    void saveAccess(ctx2, slot, false);
  });
  slot.querySelector("[data-action='qr']")?.addEventListener("click", () => {
    void setupTotp(ctx2, slot);
  });
  slot.querySelector("[data-action='clear-totp']")?.addEventListener("click", () => {
    const input = slot.querySelector("[name='TOTP']");
    if (input) input.value = "";
    void saveAccess(ctx2, slot, true);
  });
}
async function saveAccess(ctx2, slot, clearTotp) {
  const form = slot.querySelector("#access-form");
  const out = slot.querySelector("[data-for='access']");
  if (!form || !out) return;
  const data = new FormData(form);
  const next = String(data.get("newPassword") || "");
  const repeat = String(data.get("repeat") || "");
  if (next && next !== repeat) {
    out.hidden = false;
    out.textContent = t("UI.PASSWORD_MISMATCH", "Die neuen Passw\xF6rter stimmen nicht \xFCberein.");
    return;
  }
  out.hidden = true;
  try {
    const result2 = await ctx2.call("AdminPasswordUpdate", {
      Login: String(data.get("Login") || ""),
      Password: String(data.get("Password") || ""),
      newPassword: next,
      TOTP: clearTotp ? "" : String(data.get("TOTP") || "")
    });
    if (!result2) throw new Error(t("ERRORS.UNKNOWN_ERROR", "Unbekannter Fehler"));
    await ctx2.reload();
    out.hidden = false;
    out.textContent = result2.Weak ? t("TAB_DOMAINS.WEAK_PASSWORD", "Das Admin-Passwort steht noch in der Standarddatei.") : t("UI.SAVED", "Gespeichert.");
  } catch (error) {
    out.hidden = false;
    out.textContent = explain(error);
  }
}
function secret() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => alphabet[byte % 32]).join("");
}
async function setupTotp(ctx2, slot) {
  const input = slot.querySelector("[name='TOTP']");
  const box = slot.querySelector("[data-for='qr']");
  const user = slot.querySelector("[name='Login']");
  if (!input || !box) return;
  const value = secret();
  input.value = value;
  try {
    const svg = await ctx2.call("AdminQRCode", { username: user?.value || "admin", TOTP: value });
    box.hidden = false;
    if (typeof svg === "string" && svg.trim().startsWith("<svg")) box.innerHTML = svg;
    else {
      box.textContent = typeof svg === "string" ? svg : "";
    }
  } catch (error) {
    ctx2.note(explain(error), true);
  }
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
  window.dispatchEvent(new CustomEvent("sm-appearance", { detail: { dark } }));
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
var NAV = [
  ["general", "SETTINGS_LABELS.GENERAL", "Allgemein"],
  ["login", "SETTINGS_LABELS.LOGIN", "Anmeldung"],
  ["domains", "SETTINGS_LABELS.DOMAINS", "Domains"],
  ["contacts", "SETTINGS_LABELS.CONTACTS", "Kontakte"],
  ["security", "SETTINGS_LABELS.SECURITY", "Sicherheit"],
  ["branding", "SETTINGS_LABELS.BRANDING", "Branding"],
  ["packages", "UI.PLUGINS", "Plugins und Pakete"],
  ["config", "SETTINGS_LABELS.CONFIG", "Konfigurationsdatei"],
  ["about", "SETTINGS_LABELS.ABOUT", "\xDCber"]
];
var adminKey = "admin";
var section = "general";
var app = {};
var cfg = {};
function boot(root3) {
  void start(root3);
}
async function start(root3) {
  try {
    const data = await loadAdminApp();
    adminKey = data.Admin?.path || "admin";
    app = data;
    if (data.Auth) await showShell(root3);
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
  form.querySelector("input")?.focus({ preventScroll: true });
}
async function submitLogin(root3, form, login, password, totp) {
  const slot = form.querySelector("[data-for='form']");
  const button = form.querySelector("button");
  if (!login.trim() || !password) {
    slot.hidden = false;
    slot.textContent = t("ADMIN.ENTER_CREDENTIALS", "Benutzer und Passwort eintragen.");
    return;
  }
  button.disabled = true;
  slot.hidden = true;
  try {
    const data = await adminCall(adminKey, "AdminLogin", { Login: login.trim(), Password: password, TOTP: totp });
    if (data.Admin?.path) adminKey = data.Admin.path;
    app = data;
    section = "general";
    await showShell(root3);
  } catch (error) {
    button.disabled = false;
    slot.hidden = false;
    slot.textContent = explain(error);
  }
}
function ctx(root3) {
  return {
    key: adminKey,
    app,
    cfg,
    goto(next) {
      section = next;
      void showShell(root3);
    },
    note(message, error = false) {
      const slot = root3.querySelector("#admin-note");
      if (!slot) return;
      slot.hidden = !message;
      slot.className = error ? "error" : "quiet";
      slot.textContent = message;
    },
    async reload() {
      cfg = await adminCall(adminKey, "AdminSettingsGet");
      const fresh = await loadAdminApp();
      if (fresh.Auth) app = fresh;
    },
    call(action, params = {}) {
      return adminCall(adminKey, action, params);
    }
  };
}
async function showShell(root3) {
  const keep = root3.querySelector("#admin-slot");
  if (!keep) {
    root3.innerHTML = `
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
    root3.querySelector("[data-action='logout']")?.addEventListener("click", () => {
      void adminCall(adminKey, "AdminLogout").finally(() => showLogin(root3, ""));
    });
  }
  const nav = root3.querySelector(".settings-nav");
  if (nav) {
    nav.innerHTML = NAV.map(([id, path, label]) => `<button type="button" class="text-btn" data-section="${id}" aria-pressed="${id === section ? "true" : "false"}">${esc(t(path, label))}</button>`).join("");
    nav.querySelectorAll("[data-section]").forEach((button) => {
      button.addEventListener("click", () => {
        section = button.dataset.section || "general";
        void showShell(root3);
      });
    });
  }
  const weak = root3.querySelector("#weak");
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
        void showShell(root3);
      });
      weak.append(link);
    }
  }
  try {
    if (!Object.keys(cfg).length) cfg = await adminCall(adminKey, "AdminSettingsGet");
  } catch (error) {
    ctx(root3).note(explain(error), true);
  }
  const slot = root3.querySelector("#admin-slot");
  if (!slot) return;
  slot.innerHTML = "";
  const current = ctx(root3);
  if (section === "general") paintGeneral(current, slot);
  else if (section === "login") paintLogin(current, slot);
  else if (section === "branding") paintBranding(current, slot);
  else if (section === "contacts") paintContacts(current, slot);
  else if (section === "security") paintSecurity(current, slot);
  else if (section === "domains") await paintDomains(current, slot);
  else if (section === "packages") await paintPackages(current, slot);
  else if (section === "config") paintConfig(current, slot);
  else await paintAbout(current, slot);
}
var root2 = document.getElementById("app");
if (root2) boot(root2);
