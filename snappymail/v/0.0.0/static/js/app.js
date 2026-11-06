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
async function loadApp() {
  const response = await fetch(`${root()}?/AppData/0/${Math.random().toString().slice(2)}/`, {
    credentials: "same-origin",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) throw new ApiError(1, "Die Anwendung konnte nicht geladen werden.");
  const data = await response.json();
  const system = data.System;
  if (system?.token) token = system.token;
  return data;
}
async function call(action, params = {}) {
  const response = await fetch(`${root()}?/Json/&q[]=/0/`, {
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

// src/icons.ts
var svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true">${body}</svg>`;
var iconMenu = svg(
  `<rect x="5" y="5" width="4" height="4"/><rect x="13" y="5" width="4" height="4"/><rect x="21" y="5" width="4" height="4"/><rect x="5" y="13" width="4" height="4"/><rect x="13" y="13" width="4" height="4"/><rect x="21" y="13" width="4" height="4"/><rect x="5" y="21" width="4" height="4"/><rect x="13" y="21" width="4" height="4"/><rect x="21" y="21" width="4" height="4"/>`
);
var iconClose = svg(
  `<rect x="5" y="5" width="4" height="4"/><rect x="21" y="5" width="4" height="4"/><rect x="9" y="9" width="4" height="4"/><rect x="17" y="9" width="4" height="4"/><rect x="13" y="13" width="4" height="4"/><rect x="9" y="17" width="4" height="4"/><rect x="17" y="17" width="4" height="4"/><rect x="5" y="21" width="4" height="4"/><rect x="21" y="21" width="4" height="4"/>`
);

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

// src/view.ts
function esc(value) {
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
  const wide = () => matchMedia("(min-width: 800px)").matches;
  const docked = () => matchMedia("(min-width: 1280px)").matches;
  const showLogin = (title) => {
    document.title = title;
    root3.innerHTML = `
      <main class="login">
        <form class="login-card" novalidate>
          <h1 class="title">${esc(title)}</h1>
          <label class="field"><span>${esc(t("GLOBAL.EMAIL", "E-Mail"))}</span>
            <input name="email" type="email" autocomplete="email" inputmode="email" required>
          </label>
          <p class="error" data-for="email" hidden></p>
          <label class="field"><span>${esc(t("GLOBAL.PASSWORD", "Passwort"))}</span>
            <input name="password" type="password" autocomplete="current-password" required>
          </label>
          <p class="error" data-for="password" hidden></p>
          <label class="stay"><input name="stay" type="checkbox"> ${esc(t("LOGIN.LABEL_SIGN_ME", "Anmeldung merken"))}</label>
          <p class="error" data-for="form" hidden></p>
          <button type="submit" class="ink-btn">${esc(t("LOGIN.BUTTON_SIGN_IN", "Anmelden"))}</button>
        </form>
      </main>`;
    const form = root3.querySelector("form");
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form);
      actions.login(String(data.get("email") || ""), String(data.get("password") || ""), data.get("stay") === "on");
    });
  };
  const setLoginBusy = (busy) => {
    const button = root3.querySelector(".login-card button");
    if (button) button.disabled = busy;
  };
  const setLoginError = (text) => {
    const slot = root3.querySelector("[data-for='form']");
    if (!slot) return;
    slot.hidden = !text;
    slot.textContent = text;
  };
  const showMail = (email, folderName) => {
    root3.innerHTML = `
      <div class="shell" data-pane="list" data-sidebar="${docked() ? "open" : "closed"}">
        <button type="button" class="scrim" data-action="close-sidebar" aria-label="Ordner schlie\xDFen"></button>
        <aside class="sidebar" aria-label="Ordner">
          <div class="account">
            <button type="button" class="account-btn" data-action="account" aria-expanded="false" aria-controls="account-menu" aria-haspopup="menu"></button>
            <div class="menu" id="account-menu" role="menu" hidden>
              <button type="button" class="menu-item" role="menuitem" data-action="settings">${esc(t("GLOBAL.SETTINGS", "Einstellungen"))}</button>
              <button type="button" class="menu-item" role="menuitem" data-action="logout">${esc(t("GLOBAL.LOGOUT", "Abmelden"))}</button>
            </div>
          </div>
          <p class="group-label mono">${esc(t("FOLDER_LIST.INBOX_NAME", "Posteingang"))}</p>
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
            <button type="button" class="text-btn" data-action="back" hidden>${esc(t("GLOBAL.BACK", "Zur\xFCck"))}</button>
            <span class="quiet" id="reader-place"></span>
            <span class="spacer"></span>
            <button type="button" class="text-btn" data-action="reply" hidden>${esc(t("MESSAGE.BUTTON_REPLY", "Antworten"))}</button>
            <button type="button" class="text-btn" data-action="reply-all" hidden>${esc(t("MESSAGE.BUTTON_REPLY_ALL", "Allen antworten"))}</button>
            <button type="button" class="text-btn" data-action="forward" hidden>${esc(t("MESSAGE.BUTTON_FORWARD", "Weiterleiten"))}</button>
            <button type="button" class="text-btn" data-action="archive" hidden>${esc(t("GLOBAL.TO_ARCHIVE", "Archivieren"))}</button>
            <button type="button" class="text-btn" data-action="unread" hidden>Ungelesen</button>
            <button type="button" class="text-btn" data-action="delete" hidden>${esc(t("GLOBAL.DELETE", "L\xF6schen"))}</button>
          </div>
          <p class="quiet live" id="notice"></p>
          <div class="pane-body" id="reader-body">
            <p class="empty" id="reader-empty">W\xE4hlen Sie eine Mail.</p>
          </div>
        </section>
        <section class="composer" hidden aria-label="Neue Mail">
          <form class="composer-form">
            <div class="composer-bar">
              <button type="button" class="icon-btn" data-action="close-compose" aria-label="${esc(t("GLOBAL.CLOSE", "Schlie\xDFen"))}">${iconClose}</button>
              <span class="title title-md" id="compose-title">Neue Mail</span>
              <span class="spacer"></span>
              <button type="submit" class="ink-btn">${esc(t("COMPOSE.BUTTON_SEND", "Senden"))}</button>
            </div>
            <div class="fields">
              <p class="quiet" id="compose-from"></p>
              <label class="field"><span>${esc(t("GLOBAL.TO", "An"))}</span><input name="to" type="text" autocomplete="email"></label>
              <label class="field"><span>${esc(t("GLOBAL.CC", "Cc"))}</span><input name="cc" type="text" autocomplete="email"></label>
              <label class="field"><span>${esc(t("GLOBAL.SUBJECT", "Betreff"))}</span><input name="subject" type="text"></label>
              <label class="field"><span>Text</span><textarea name="body"></textarea></label>
              <p class="error" id="send-error" hidden></p>
            </div>
          </form>
        </section>
        <nav class="tabbar" aria-label="Navigation">
          <button type="button" class="text-btn" data-action="pane-folders">Ordner</button>
          <button type="button" class="text-btn" data-action="pane-search">Suche</button>
          <button type="button" class="ink-btn" data-action="compose">${esc(t("FOLDER_LIST.BUTTON_NEW_MESSAGE", "Neue Nachricht"))}</button>
        </nav>
        <dialog id="settings" aria-labelledby="settings-title">
          <div class="dialog-body">
            <div class="sheet-head" style="padding:0;border:0;min-height:0">
              <h2 id="settings-title" class="title title-md">Einstellungen</h2>
              <span class="spacer"></span>
              <button type="button" class="icon-btn" data-action="close-dialog" aria-label="${esc(t("GLOBAL.CLOSE", "Schlie\xDFen"))}">${iconClose}</button>
            </div>
            <fieldset class="choices">
              <legend class="mono">Erscheinungsbild</legend>
              <label><input type="radio" name="appearance" value="system"> System</label>
              <label><input type="radio" name="appearance" value="light"> Hell</label>
              <label><input type="radio" name="appearance" value="dark"> Dunkel</label>
            </fieldset>
          </div>
        </dialog>
        <dialog id="keys" aria-labelledby="keys-title">
          <div class="dialog-body">
            <div class="sheet-head" style="padding:0;border:0;min-height:0">
              <h2 id="keys-title" class="title title-md">Tasten</h2>
              <span class="spacer"></span>
              <button type="button" class="icon-btn" data-action="close-dialog" aria-label="${esc(t("GLOBAL.CLOSE", "Schlie\xDFen"))}">${iconClose}</button>
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
              <button type="button" class="text-btn" value="cancel">${esc(t("GLOBAL.CANCEL", "Abbrechen"))}</button>
              <button type="button" class="danger" value="ok">${esc(t("GLOBAL.DELETE", "L\xF6schen"))}</button>
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
    const button = shell?.querySelector("[data-action='account']");
    if (!menu || !button) return;
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
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
        const current = readAppearance();
        shell?.querySelectorAll("input[name='appearance']").forEach((input) => {
          input.checked = input.value === current;
        });
        (shell?.querySelector("#settings")).showModal();
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
      }
    });
    shell.addEventListener("submit", (event) => {
      const form = event.target;
      if (form.classList.contains("composer-form")) {
        event.preventDefault();
        const data = new FormData(form);
        actions.send({
          title: "",
          to: String(data.get("to") || ""),
          cc: String(data.get("cc") || ""),
          subject: String(data.get("subject") || ""),
          body: String(data.get("body") || "")
        });
      } else if (form.dataset.action === "search") {
        event.preventDefault();
        actions.search(form.querySelector("input").value.trim());
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
      const key = event.key.toLowerCase();
      if (event.key === "\\") {
        event.preventDefault();
        if (!wide()) pane(shell?.dataset.pane === "folders" ? "list" : "folders");
        else setSidebar(shell?.dataset.sidebar !== "open");
      } else if (event.key === "?") {
        event.preventDefault();
        (shell?.querySelector("#keys")).showModal();
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
      const button = event.target.closest("button");
      if (button) confirm.close(button.value);
    });
  }
  function moveSelection(delta) {
    const rows = [...shell?.querySelectorAll("[data-uid]") ?? []];
    if (!rows.length) return;
    const index = rows.findIndex((row2) => row2.getAttribute("aria-current") === "true");
    const next = delta === 0 ? Math.max(index, 0) : Math.min(rows.length - 1, Math.max(0, index + delta));
    const row = rows[next];
    if (!row) return;
    actions.selectMessage(Number(row.dataset.uid));
    row.scrollIntoView({ block: "nearest" });
    if (!wide()) pane("reader");
  }
  function folderButton(row) {
    const count = row.unread > 0 ? `<span class="count">${row.unread}</span>` : "";
    return `<button type="button" class="folder" data-folder="${esc(row.fullName)}" aria-current="${row.current ? "page" : "false"}" style="padding-left:${8 + row.depth * 12}px"><span>${esc(row.name)}</span>${count}</button>`;
  }
  return {
    showLogin,
    setLoginBusy,
    setLoginError,
    showMail,
    setFolders(rows) {
      const inbox = rows.filter((row) => row.inbox);
      const rest = rows.filter((row) => !inbox.includes(row));
      const inboxEl = shell?.querySelector("#folder-inbox");
      const restEl = shell?.querySelector("#folder-rest");
      if (inboxEl) inboxEl.innerHTML = inbox.map(folderButton).join("") || `<button type="button" class="folder" data-folder="INBOX">Posteingang</button>`;
      if (restEl) restEl.innerHTML = rest.map(folderButton).join("");
      const current = rows.find((row) => row.current);
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
        box.innerHTML = rows.map((row) => `
          <button type="button" class="msg${row.unseen ? " unseen" : ""}" data-uid="${row.uid}" aria-current="${row.current ? "true" : "false"}">
            <span class="who">${esc(row.who)}</span>
            <span class="when">${esc(row.when)}</span>
            <span class="subj">${esc(row.subject || "(ohne Betreff)")}</span>
            <span class="peek">${esc(row.preview)}</span>
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
    setReader(data, loading, error) {
      const body = shell?.querySelector("#reader-body");
      const buttons = ["reply", "reply-all", "forward", "archive", "unread", "delete"];
      buttons.forEach((name) => {
        const button = shell?.querySelector(`[data-action='${name}']`);
        if (button) button.hidden = !data;
      });
      if (!body) return;
      body.replaceChildren();
      if (loading) {
        const p = document.createElement("p");
        p.className = "quiet";
        p.textContent = loading;
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
      frame.srcdoc = data.html ? /<html[\s>]/i.test(data.html) ? data.html : `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"></head><body>${data.html}</body></html>` : `<!doctype html><meta charset="utf-8"><meta name="color-scheme" content="${scheme}"><style>body{margin:0;background:Canvas;color:CanvasText;white-space:pre-wrap;overflow-wrap:anywhere;font:16px/1.5 sans-serif}</style>${esc(data.plain || "")}`;
      body.append(frame);
    },
    openCompose(seed) {
      if (!shell) return;
      const composer = shell.querySelector(".composer");
      shell.querySelector("#compose-title").textContent = seed.title;
      const form = shell.querySelector(".composer-form");
      form.elements.namedItem("to").value = seed.to;
      form.elements.namedItem("cc").value = seed.cc;
      form.elements.namedItem("subject").value = seed.subject;
      form.elements.namedItem("body").value = seed.body;
      this.setSendState(false, "");
      if (!wide()) pane("compose");
      openLayer(composer, document.activeElement instanceof HTMLElement ? document.activeElement : null);
      form.elements.namedItem("to").focus({ preventScroll: true });
    },
    closeCompose() {
      const composer = shell?.querySelector(".composer");
      if (composer && !composer.hidden) closeLayer(composer);
    },
    setSendState(busy, error) {
      const button = shell?.querySelector(".composer-form button[type='submit']");
      const slot = shell?.querySelector("#send-error");
      if (button) {
        button.disabled = busy;
        button.textContent = busy ? "Wird gesendet \u2026" : t("COMPOSE.BUTTON_SEND", "Senden");
      }
      if (slot) {
        slot.hidden = !error;
        slot.textContent = error;
      }
    },
    notice(text) {
      const slot = shell?.querySelector("#notice");
      if (slot) slot.textContent = text;
    },
    confirmDelete() {
      const dialog = shell?.querySelector("#confirm");
      if (!dialog) return Promise.resolve(false);
      dialog.showModal();
      return new Promise((resolve) => {
        dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok"), { once: true });
      });
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
      send: (values) => void this.send(values),
      closeCompose: () => {
        this.replyKind = "";
      },
      back: () => void 0
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
    this.accountHash = String(data.accountHash || "");
    this.sentFolder = String(data.SentFolder || "");
    this.archiveFolder = String(data.ArchiveFolder || "");
    const page = Number(data.MessagesPerPage || PAGE_FALLBACK);
    this.pageSize = Math.min(50, Math.max(10, page || PAGE_FALLBACK));
    document.title = this.email || String(data.title || "Postfach");
    this.view.showMail(this.email, "Posteingang");
    await this.loadFolders();
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
        search: this.search,
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
      attachments
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
      current: message.uid === this.selected
    }));
  }
  paintList() {
    const empty = this.messages.length ? "" : this.search ? "Keine Mails f\xFCr diese Suche." : "Dieser Ordner ist leer.";
    this.view.setList(this.rows(), empty, "", this.hasMore, Boolean(this.search));
  }
  async setSearch(query) {
    this.search = query;
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
      const row = this.messages.find((item) => item.uid === uid);
      if (row && !seen(row.flags)) {
        row.flags.push("\\seen");
        const folder = this.folders.find((item) => item.fullName === this.folder);
        if (folder && folder.unread > 0) folder.unread -= 1;
        this.paintFolders();
        this.paintList();
        void call("MessageSetSeen", { folder: this.folder, uids: String(uid), setAction: 1 }).catch(() => void 0);
      }
      this.view.setReader(this.readerData(message), "", "");
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
    this.view.openCompose({ title: "Neue Nachricht", to: "", cc: "", subject: "", body: "" });
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
  async send(values) {
    if (!values.to.trim()) {
      this.view.setSendState(false, "Geben Sie bitte mindestens einen Empf\xE4nger an.");
      return;
    }
    this.view.setSendState(true, "");
    const message = this.current;
    const params = {
      from: this.email,
      to: values.to,
      cc: values.cc,
      bcc: "",
      subject: values.subject,
      plain: values.body,
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
  async markUnread() {
    if (!this.selected) return;
    const row = this.messages.find((message) => message.uid === this.selected);
    if (!row) return;
    row.flags = row.flags.filter((flag) => flag.toLowerCase() !== "\\seen");
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
