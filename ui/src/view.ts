import { iconClose, iconMenu } from "./icons";
import { t } from "./i18n";
import { applyAppearance, readAppearance, type Appearance } from "./theme";

export interface FolderRow {
  fullName: string;
  name: string;
  depth: number;
  unread: number;
  current: boolean;
  inbox: boolean;
}

export interface MessageRow {
  uid: number;
  who: string;
  subject: string;
  preview: string;
  when: string;
  unseen: boolean;
  current: boolean;
}

export interface AttachmentRow {
  name: string;
  size: string;
  href: string;
}

export interface ReaderData {
  subject: string;
  from: string;
  to: string;
  when: string;
  html: string | null;
  plain: string | null;
  attachments: AttachmentRow[];
}

export interface ComposeSeed {
  title: string;
  to: string;
  cc: string;
  subject: string;
  body: string;
}

export interface MailActions {
  login(email: string, password: string, stay: boolean): void;
  logout(): void;
  selectFolder(fullName: string): void;
  selectMessage(uid: number): void;
  search(query: string): void;
  clearSearch(): void;
  more(): void;
  compose(): void;
  reply(all: boolean): void;
  forward(): void;
  archive(): void;
  unread(): void;
  askDelete(): void;
  send(values: ComposeSeed): void;
  closeCompose(): void;
  back(): void;
}

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  }[char] ?? char));
}

export interface MailView {
  showLogin(title: string): void;
  setLoginBusy(busy: boolean): void;
  setLoginError(text: string): void;
  showMail(email: string, folderName: string): void;
  setFolders(rows: FolderRow[]): void;
  setList(rows: MessageRow[], empty: string, error: string, more: boolean, searching: boolean): void;
  setReader(data: ReaderData | null, loading: string, error: string): void;
  openCompose(seed: ComposeSeed): void;
  closeCompose(): void;
  setSendState(busy: boolean, error: string): void;
  notice(text: string): void;
  confirmDelete(): Promise<boolean>;
}

export function createView(root: HTMLElement, actions: MailActions): MailView {
  let shell: HTMLElement | null = null;
  let opener: HTMLElement | null = null;

  const wide = () => matchMedia("(min-width: 800px)").matches;
  const docked = () => matchMedia("(min-width: 1280px)").matches;

  const showLogin: MailView["showLogin"] = (title) => {
    document.title = title;
    root.innerHTML = `
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
    const form = root.querySelector("form") as HTMLFormElement;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form);
      actions.login(String(data.get("email") || ""), String(data.get("password") || ""), data.get("stay") === "on");
    });
  };

  const setLoginBusy: MailView["setLoginBusy"] = (busy) => {
    const button = root.querySelector(".login-card button") as HTMLButtonElement | null;
    if (button) button.disabled = busy;
  };

  const setLoginError: MailView["setLoginError"] = (text) => {
    const slot = root.querySelector("[data-for='form']") as HTMLElement | null;
    if (!slot) return;
    slot.hidden = !text;
    slot.textContent = text;
  };

  const showMail: MailView["showMail"] = (email, folderName) => {
    root.innerHTML = `
      <div class="shell" data-pane="list" data-sidebar="${docked() ? "open" : "closed"}">
        <button type="button" class="scrim" data-action="close-sidebar" aria-label="Ordner schließen"></button>
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
            <button type="button" class="text-btn" data-action="back" hidden>${esc(t("GLOBAL.BACK", "Zurück"))}</button>
            <span class="quiet" id="reader-place"></span>
            <span class="spacer"></span>
            <button type="button" class="text-btn" data-action="reply" hidden>${esc(t("MESSAGE.BUTTON_REPLY", "Antworten"))}</button>
            <button type="button" class="text-btn" data-action="reply-all" hidden>${esc(t("MESSAGE.BUTTON_REPLY_ALL", "Allen antworten"))}</button>
            <button type="button" class="text-btn" data-action="forward" hidden>${esc(t("MESSAGE.BUTTON_FORWARD", "Weiterleiten"))}</button>
            <button type="button" class="text-btn" data-action="archive" hidden>${esc(t("GLOBAL.TO_ARCHIVE", "Archivieren"))}</button>
            <button type="button" class="text-btn" data-action="unread" hidden>Ungelesen</button>
            <button type="button" class="text-btn" data-action="delete" hidden>${esc(t("GLOBAL.DELETE", "Löschen"))}</button>
          </div>
          <p class="quiet live" id="notice"></p>
          <div class="pane-body" id="reader-body">
            <p class="empty" id="reader-empty">Wählen Sie eine Mail.</p>
          </div>
        </section>
        <section class="composer" hidden aria-label="Neue Mail">
          <form class="composer-form">
            <div class="composer-bar">
              <button type="button" class="icon-btn" data-action="close-compose" aria-label="${esc(t("GLOBAL.CLOSE", "Schließen"))}">${iconClose}</button>
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
              <button type="button" class="icon-btn" data-action="close-dialog" aria-label="${esc(t("GLOBAL.CLOSE", "Schließen"))}">${iconClose}</button>
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
              <button type="button" class="icon-btn" data-action="close-dialog" aria-label="${esc(t("GLOBAL.CLOSE", "Schließen"))}">${iconClose}</button>
            </div>
            <ul class="keys">
              <li><span>Nächste, vorige Mail</span><kbd>J</kbd> <kbd>K</kbd></li>
              <li><span>Öffnen</span><kbd>Enter</kbd></li>
              <li><span>Schreiben</span><kbd>C</kbd></li>
              <li><span>Antworten</span><kbd>R</kbd></li>
              <li><span>Archivieren</span><kbd>E</kbd></li>
              <li><span>Löschen</span><kbd>#</kbd></li>
              <li><span>Seitenleiste</span><kbd>\\</kbd></li>
              <li><span>Schließen</span><kbd>Esc</kbd></li>
              <li><span>Diese Liste</span><kbd>?</kbd></li>
            </ul>
          </div>
        </dialog>
        <dialog id="confirm" aria-labelledby="confirm-title">
          <div class="dialog-body">
            <h2 id="confirm-title" class="title title-md">Wirklich löschen?</h2>
            <div class="dialog-actions">
              <button type="button" class="text-btn" value="cancel">${esc(t("GLOBAL.CANCEL", "Abbrechen"))}</button>
              <button type="button" class="danger" value="ok">${esc(t("GLOBAL.DELETE", "Löschen"))}</button>
            </div>
          </div>
        </dialog>
      </div>`;
    const next = root.querySelector(".shell") as HTMLElement | null;
    if (!next) return;
    shell = next;
    const account = next.querySelector(".account-btn") as HTMLButtonElement;
    account.textContent = email;
    (next.querySelector("#compose-from") as HTMLElement).textContent = `${t("GLOBAL.FROM", "Von")} ${email}`;
    (next.querySelector("#folder-title") as HTMLElement).textContent = folderName;
    (next.querySelector("#reader-place") as HTMLElement).textContent = folderName;
    const search = next.querySelector("#search") as HTMLInputElement;
    search.placeholder = `In ${folderName} suchen`;
    wireShell();
  };

  function pane(name: string): void {
    if (!shell) return;
    shell.dataset.pane = name;
    const back = shell.querySelector("[data-action='back']") as HTMLButtonElement;
    back.hidden = wide() || name !== "reader";
  }

  function setSidebar(open: boolean): void {
    if (shell) shell.dataset.sidebar = open ? "open" : "closed";
  }

  function closeMenu(): void {
    const menu = shell?.querySelector("#account-menu") as HTMLElement | undefined;
    const button = shell?.querySelector("[data-action='account']") as HTMLButtonElement | undefined;
    if (!menu || !button) return;
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
  }

  function openLayer(layer: HTMLElement, from: HTMLElement | null): void {
    opener = from;
    layer.hidden = false;
    layer.dataset.open = "false";
    requestAnimationFrame(() => { layer.dataset.open = "true"; });
  }

  function closeLayer(layer: HTMLElement): void {
    layer.dataset.open = "false";
    const finish = () => { layer.hidden = true; };
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) finish();
    else layer.addEventListener("transitionend", finish, { once: true });
    opener?.focus();
    opener = null;
  }

  function wireShell(): void {
    if (!shell) return;
    const menu = shell.querySelector("#account-menu") as HTMLElement;
    const accountBtn = shell.querySelector("[data-action='account']") as HTMLButtonElement;
    const list = shell.querySelector(".list-pane") as HTMLElement;
    const separator = shell.querySelector(".splitter") as HTMLElement;
    const composer = shell.querySelector(".composer") as HTMLElement;

    const setListWidth = (px: number) => {
      const next = Math.min(640, Math.max(288, Math.round(px)));
      shell?.style.setProperty("--list-w", `${next}px`);
      separator.setAttribute("aria-valuenow", String(next));
    };

    shell.addEventListener("click", (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action], [data-folder], [data-uid]");
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
        shell?.querySelectorAll<HTMLInputElement>("input[name='appearance']").forEach((input) => {
          input.checked = input.value === current;
        });
        (shell?.querySelector("#settings") as HTMLDialogElement).showModal();
      } else if (action === "logout") actions.logout();
      else if (action === "close-dialog") (target.closest("dialog") as HTMLDialogElement | null)?.close();
      else if (action === "search") { /* form */ }
      else if (action === "clear-search") actions.clearSearch();
      else if (action === "more") actions.more();
      else if (action === "back") pane("list");
      else if (action === "pane-folders") pane("folders");
      else if (action === "pane-search") {
        pane("list");
        (shell?.querySelector("#search") as HTMLInputElement).focus();
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
      const form = event.target as HTMLFormElement;
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
        actions.search((form.querySelector("input") as HTMLInputElement).value.trim());
      }
    });

    shell.addEventListener("change", (event) => {
      const input = event.target as HTMLInputElement;
      if (input.name === "appearance") applyAppearance(input.value as Appearance);
    });

    shell.addEventListener("keydown", (event) => {
      const typing = event.target instanceof HTMLInputElement
        || event.target instanceof HTMLTextAreaElement
        || (event.target instanceof HTMLElement && event.target.isContentEditable);
      if (event.key === "Escape") {
        if (shell?.querySelector("dialog[open]")) return;
        if (!menu.hidden) { closeMenu(); return; }
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
        (shell?.querySelector("#keys") as HTMLDialogElement).showModal();
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
      const move = (ev: PointerEvent) => setListWidth(startW + ev.clientX - startX);
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

    const confirm = shell.querySelector("#confirm") as HTMLDialogElement;
    confirm.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest("button");
      if (button) confirm.close(button.value);
    });
  }

  function moveSelection(delta: number): void {
    const rows = [...(shell?.querySelectorAll<HTMLButtonElement>("[data-uid]") ?? [])];
    if (!rows.length) return;
    const index = rows.findIndex((row) => row.getAttribute("aria-current") === "true");
    const next = delta === 0 ? Math.max(index, 0) : Math.min(rows.length - 1, Math.max(0, index + delta));
    const row = rows[next];
    if (!row) return;
    actions.selectMessage(Number(row.dataset.uid));
    row.scrollIntoView({ block: "nearest" });
    if (!wide()) pane("reader");
  }

  function folderButton(row: FolderRow): string {
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
        (shell.querySelector("#folder-title") as HTMLElement).textContent = current.name;
        (shell.querySelector("#reader-place") as HTMLElement).textContent = current.name;
        const search = shell.querySelector("#search") as HTMLInputElement;
        if (document.activeElement !== search) search.placeholder = `In ${current.name} suchen`;
      }
    },
    setList(rows, empty, error, more, searching) {
      const box = shell?.querySelector("#rows");
      const emptyEl = shell?.querySelector("#list-empty") as HTMLElement | null;
      const errorEl = shell?.querySelector("#list-error") as HTMLElement | null;
      const moreBtn = shell?.querySelector("[data-action='more']") as HTMLButtonElement | null;
      const clearBtn = shell?.querySelector("[data-action='clear-search']") as HTMLButtonElement | null;
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
        const button = shell?.querySelector(`[data-action='${name}']`) as HTMLButtonElement | null;
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
        p.textContent = "Wählen Sie eine Mail.";
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
      meta.textContent = `${data.from} · ${data.when}`;
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
      frame.srcdoc = data.html
        ? (/<html[\s>]/i.test(data.html) ? data.html : `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"></head><body>${data.html}</body></html>`)
        : `<!doctype html><meta charset="utf-8"><meta name="color-scheme" content="${scheme}"><style>body{margin:0;background:Canvas;color:CanvasText;white-space:pre-wrap;overflow-wrap:anywhere;font:16px/1.5 sans-serif}</style>${esc(data.plain || "")}`;
      body.append(frame);
    },
    openCompose(seed) {
      if (!shell) return;
      const composer = shell.querySelector(".composer") as HTMLElement;
      (shell.querySelector("#compose-title") as HTMLElement).textContent = seed.title;
      const form = shell.querySelector(".composer-form") as HTMLFormElement;
      (form.elements.namedItem("to") as HTMLInputElement).value = seed.to;
      (form.elements.namedItem("cc") as HTMLInputElement).value = seed.cc;
      (form.elements.namedItem("subject") as HTMLInputElement).value = seed.subject;
      (form.elements.namedItem("body") as HTMLTextAreaElement).value = seed.body;
      this.setSendState(false, "");
      if (!wide()) pane("compose");
      openLayer(composer, document.activeElement instanceof HTMLElement ? document.activeElement : null);
      (form.elements.namedItem("to") as HTMLInputElement).focus({ preventScroll: true });
    },
    closeCompose() {
      const composer = shell?.querySelector(".composer") as HTMLElement | null;
      if (composer && !composer.hidden) closeLayer(composer);
    },
    setSendState(busy, error) {
      const button = shell?.querySelector(".composer-form button[type='submit']") as HTMLButtonElement | null;
      const slot = shell?.querySelector("#send-error") as HTMLElement | null;
      if (button) {
        button.disabled = busy;
        button.textContent = busy ? "Wird gesendet …" : t("COMPOSE.BUTTON_SEND", "Senden");
      }
      if (slot) {
        slot.hidden = !error;
        slot.textContent = error;
      }
    },
    notice(text) {
      const slot = shell?.querySelector("#notice") as HTMLElement | null;
      if (slot) slot.textContent = text;
    },
    confirmDelete() {
      const dialog = shell?.querySelector("#confirm") as HTMLDialogElement | null;
      if (!dialog) return Promise.resolve(false);
      dialog.showModal();
      return new Promise((resolve) => {
        dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok"), { once: true });
      });
    }
  };
}
