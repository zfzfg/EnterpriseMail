import type { AssistFlags } from "./assistant";
import { actionFacts, draftModeFor, type ChatAction } from "./assist-state";
import { Composer, type ComposeFile, type ComposeIdentity, type ComposePreferences, type ComposeSeed, type ComposeValues } from "./compose";
import { icon, type IconName } from "./icons";
import { t } from "./i18n";
import { paintReaderDetails, paintReaderFiles, renderBulk, renderReader, type BulkData, type ReaderData } from "./reader";
import { mountBook, type Book } from "./contacts";
import { renderDesk, type DeskEdit, type SettingsSnapshot } from "./settings";
import { ruleCard, syncFilterRow } from "./sieve/form";
import { compileFilterForm, parseFilterScript } from "./sieve/script";
import { renderFolderDesk, renderFolderMenu, renderQuota, renderSidebarRows, type FolderAction, type FolderDesk, type SidebarData } from "./folders";
import { readSearchForm, renderSearchForm, serializeSearch, type QuickFlag, type SearchCriteria } from "./search";
import { applyAppearance, type Appearance } from "./theme";

export type { ComposeFile, ComposeSeed } from "./compose";

export type { SidebarData } from "./folders";

/** Zustand der Liste: Sortierung, Unterhaltungen, Gruppierung. */
export interface ListMode {
  sortable: boolean;
  sort: string;
  threadsAvailable: boolean;
  useThreads: boolean;
  grouped: boolean;
  threadOpen: string;
}

export const SORTS: [string, string, string][] = [
  ["", "MESSAGE_LIST.SORT_DATE_DESC", "Datum absteigend"],
  ["DATE", "MESSAGE_LIST.SORT_DATE_ASC", "Datum aufsteigend"],
  ["FROM", "MESSAGE_LIST.SORT_FROM_ASC", "Von A-Z"],
  ["REVERSE FROM", "MESSAGE_LIST.SORT_FROM_DESC", "Von Z-A"],
  ["REVERSE SIZE", "MESSAGE_LIST.SORT_SIZE_DESC", "Größe absteigend"],
  ["SIZE", "MESSAGE_LIST.SORT_SIZE_ASC", "Größe aufsteigend"],
  ["SUBJECT", "MESSAGE_LIST.SORT_SUBJECT_ASC", "Betreff A-Z"],
  ["REVERSE SUBJECT", "MESSAGE_LIST.SORT_SUBJECT_DESC", "Betreff Z-A"],
  ["REVERSE ARRIVAL", "MESSAGE_LIST.SORT_ARRIVAL_DESC", "Eingang absteigend"],
  ["ARRIVAL", "MESSAGE_LIST.SORT_ARRIVAL_ASC", "Eingang aufsteigend"]
];

export interface MessageRow {
  uid: number;
  who: string;
  subject: string;
  preview: string;
  when: string;
  unseen: boolean;
  current: boolean;
  category?: string;
  flagged?: boolean;
  answered?: boolean;
  forwarded?: boolean;
  attachment?: boolean;
  checked?: boolean;
  deleted?: boolean;
  /** Anzahl Mails der Unterhaltung (nur Listenansicht mit Threads). */
  threadCount?: number;
  threadUnseen?: number;
  /** Datumsgruppe, die vor dieser Zeile beginnt. */
  group?: string;
}

export type { ReaderData } from "./reader";

export interface PickerFolder {
  fullName: string;
  name: string;
  depth: number;
  role: string;
}

export interface AccountItem {
  email: string;
  unread: number;
  current: boolean;
}

export interface StripState {
  loading: string;
  error: string;
  tldr: string;
  cached: boolean;
  points: string[];
  decisions: string[];
  actions: string[];
  next: string;
  replies: { label: string; body: string }[];
  model: string;
  showSummarize: boolean;
  showReplies: boolean;
}

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  trace: string[];
  actions: ChatAction[];
}

export interface DraftOptions {
  mode: string;
  tone: string;
  instruction: string;
  body: string;
  subject: string;
  context: { folder: string; uid: number } | null;
}

export interface MailActions {
  login(email: string, password: string, stay: boolean, totp?: string): void;
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
  markUnread(): void;
  markRead(): void;
  quotes(): void;
  askDelete(): void;
  send(values: ComposeValues): void;
  saveCompose(values: ComposeValues): Promise<{ folder: string; uid: number }>;
  closeCompose(discard: boolean): void;
  back(): void;
  assist?(name: string, data: Record<string, string | undefined>): void;
  settings?(name: string, data: Record<string, string>): void | Promise<void>;
  /** Mail-Aktionen aus Phase 1 (Auswahl, Markieren, Verschieben, Briefmenü …). */
  act(name: string, data: Record<string, string>): void;
}

const CATEGORY: Record<string, string> = {
  needs_reply: "Antwort nötig",
  personal: "Für mich",
  newsletter: "Newsletter",
  notification: "Benachrichtigungen",
  invoice: "Rechnungen"
};

function categoryMark(category?: string): string {
  if (!category || !CATEGORY[category]) return "";
  const mark = category === "needs_reply" ? `<i class="wait" aria-hidden="true"></i>` : "";
  return `<span class="cat">${mark}${esc(t("AI_COPILOT.CAT_" + category.toUpperCase(), CATEGORY[category]))}</span>`;
}

function rowMarks(row: MessageRow): string {
  const marks: [boolean | undefined, IconName, string][] = [
    [row.attachment, "attachment", "Mit Anhang"],
    [row.answered, "answered", "Beantwortet"],
    [row.forwarded, "forwarded", "Weitergeleitet"],
    [row.flagged, "flag-filled", "Markiert"]
  ];
  const html = marks.filter(([on]) => on).map(([, name, label]) => icon(name, label)).join("");
  return html ? `<span class="marks">${html}</span>` : "";
}

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  }[char] ?? char));
}

/** Knopfinhalt: Symbol plus Text. Der Text bleibt der zugängliche Name, auch wenn er schmal ausgeblendet ist. */
function withIcon(name: IconName, label: string): string {
  return `${icon(name)}<span class="btn-label">${esc(label)}</span>`;
}

/** Einheitliche Kennzeichnung für Knöpfe, die beim Klick ein KI-Modell aufrufen. */
function withAssist(label: string): string {
  return `${withIcon("assist", label)}<span class="ai-tag" aria-hidden="true">KI</span>`;
}

const ROLE_ICON: Record<string, IconName> = {
  inbox: "inbox", sent: "sent", drafts: "drafts", trash: "trash", archive: "archive", junk: "spam", spam: "spam"
};

export interface MailView {
  showLogin(title: string, options?: { languages?: Record<string, string>; language?: string; twoFactor?: boolean }): void;
  setLoginBusy(busy: boolean): void;
  setLoginError(text: string): void;
  showReauth(): void;
  hideReauth(): void;
  hasMail(): boolean;
  setLayout(mode: number): void;
  composerOpen(): boolean;
  minimizeCompose(): void;
  focusPane(pane: "folders" | "list" | "reader"): void;
  settingsSaved(): void;
  setAssist(flags: AssistFlags | null): void;
  showMail(email: string, folderName: string, assist?: AssistFlags | null): void;
  setFolders(data: SidebarData): void;
  setFolderDesk(desk: FolderDesk | null): void;
  showAcl(folder: string, html: string): void;
  setListMode(mode: ListMode): void;
  setSearch(query: string, quick: Set<QuickFlag>): void;
  openSearch(criteria: SearchCriteria, options: { multisearch: boolean; keywords: string[] }): void;
  folderDialog(options: { title: string; parents: { value: string; label: string }[]; parent: string }): Promise<{ name: string; parent: string; subscribe: boolean } | null>;
  openFolderSettings(fullName: string): void;
  setList(rows: MessageRow[], empty: string, error: string, more: boolean, searching: boolean): void;
  setReader(data: ReaderData | null, loading: string, error: string): void;
  setBulk(data: BulkData): void;
  setSelectionCount(count: number): void;
  setChecks(visible: boolean): void;
  setRefreshing(busy: boolean): void;
  setAccounts(items: AccountItem[]): void;
  pickFolder(title: string, folders: PickerFolder[], exclude: string): Promise<string | null>;
  ask(title: string, label: string, value?: string): Promise<string | null>;
  askSecret(title: string, label: string): Promise<{ value: string; remember: boolean } | null>;
  confirm(title: string, text: string, ok: string, danger?: boolean): Promise<boolean>;
  preview(name: string, url: string, kind: "image" | "pdf" | "text"): void;
  configureCompose(prefs: ComposePreferences, identities: ComposeIdentity[]): void;
  openCompose(seed: ComposeSeed): void;
  closeCompose(): void;
  attachCompose(items: { key: string; name: string; size: number }[]): Promise<void>;
  setSendState(busy: boolean, error: string): void;
  notice(text: string): void;
  confirmDelete(): Promise<boolean>;
  confirmConsent(text: string): Promise<boolean>;
  setAlerts(reply: number, follow: number, invoice: number, dues: { folder: string; uid: number; title: string; due: string }[]): void;
  showReaderPane(): void;
  setAssistBusy(action: string, busy: boolean): void;
  pressCategory(id: string): void;
  setStrip(state: StripState | null): void;
  setChat(turns: ChatTurn[], thinking: string, context?: string): void;
  openSheet(): void;
  closeSheet(): void;
  draftOptions(): DraftOptions;
  setDraftBody(text: string): void;
  setDraftBusy(busy: boolean, status: string): void;
  setSubjectHint(subject: string): void;
  showTranslation(search: string, explanation: string): void;
  showSettings(snap: SettingsSnapshot): void;
  settingsNotice(text: string): void;
  setBook(allowed: boolean, sync: boolean, mode: number): void;
  reloadBook(): Promise<void>;
}

export function createView(root: HTMLElement, actions: MailActions): MailView {
  let shell: HTMLElement | null = null;
  let opener: HTMLElement | null = null;
  let section = "look";
  let edit: DeskEdit | null = null;
  let snap: SettingsSnapshot | null = null;
  let composer: Composer | null = null;
  let assistTone = "professional";
  let book: Book | null = null;
  let composePrefs: ComposePreferences = {
    editor: "Plain", markdown: false, spellcheck: false, autosave: true, draftsFolder: "", sentFolder: "",
    replySameFolder: false, attachmentLimit: 0, readReceipt: false, dsn: false, requireTLS: false, pgpSign: false, pgpEncrypt: false, gnupg: false
  };
  let composeIdentities: ComposeIdentity[] = [];
  let lastListKey = "";

  const wide = () => matchMedia("(min-width: 800px)").matches;
  const docked = () => matchMedia("(min-width: 1280px)").matches;

  function chooseDialog(title: string, text: string, ok: string, alt = "", danger = true): Promise<"ok" | "alt" | "cancel"> {
    const dialog = shell?.querySelector("#confirm") as HTMLDialogElement | null;
    if (!dialog) return Promise.resolve("cancel");
    (dialog.querySelector("#confirm-title") as HTMLElement).textContent = title;
    const body = dialog.querySelector("#confirm-text") as HTMLElement;
    body.hidden = !text;
    body.textContent = text;
    const accept = dialog.querySelector("#confirm-ok") as HTMLButtonElement;
    accept.className = danger ? "danger" : "ink-btn";
    accept.innerHTML = withIcon(danger ? "delete" : "check", ok);
    const other = dialog.querySelector("#confirm-alt") as HTMLButtonElement;
    other.hidden = !alt;
    other.textContent = alt;
    dialog.returnValue = "";
    dialog.showModal();
    return new Promise((resolve) => {
      dialog.addEventListener("close", () => {
        const value = dialog.returnValue;
        resolve(value === "ok" || value === "alt" ? value : "cancel");
      }, { once: true });
    });
  }

  async function closeBook(): Promise<boolean> {
    if (shell?.dataset.surface !== "contacts") return true;
    if (book && !(await book.confirmLeave())) return false;
    if (!shell) return true;
    shell.dataset.surface = "mail";
    const node = shell.querySelector<HTMLElement>("#book");
    if (node) node.hidden = true;
    shell.querySelectorAll("[data-action='open-book']").forEach((button) => button.setAttribute("aria-pressed", "false"));
    return true;
  }

  async function openBook(): Promise<void> {
    if (!shell) return;
    if (shell.dataset.full === "true") toggleFullscreen(false);
    if (!docked()) setSidebar(false);
    shell.dataset.surface = "contacts";
    const node = shell.querySelector<HTMLElement>("#book");
    if (node) node.hidden = false;
    shell.querySelectorAll("[data-action='open-book']").forEach((button) => button.setAttribute("aria-pressed", "true"));
    if (!wide()) pane("list");
    await book?.open();
    shell.querySelector<HTMLElement>("#book-q")?.focus({ preventScroll: true });
  }

  const showLogin: MailView["showLogin"] = (title, options) => {
    document.title = title;
    const rawLanguages = options?.languages;
    const codes = Array.isArray(rawLanguages) ? rawLanguages : Object.keys(rawLanguages || {});
    const langNames: Record<string, string> = {
      de: t("LANGS_NAMES.de", "Deutsch"),
      en: t("LANGS_NAMES.en", "English")
    };
    const langField = options && codes.length ? `<label class="field"><span>${esc(t("GLOBAL.LANGUAGE", "Sprache"))}</span><select name="language">${codes.map((code) => `<option value="${esc(code)}"${code === options.language ? " selected" : ""}>${esc(langNames[code] || (rawLanguages && typeof rawLanguages === "object" && !Array.isArray(rawLanguages) ? (rawLanguages as Record<string, string>)[code] : code))}</option>`).join("")}</select></label>` : "";
    const codeField = options?.twoFactor ? `<label class="field"><span>${esc(t("LOGIN.TWO_FACTOR", "Code"))}</span><input name="totp" inputmode="numeric" autocomplete="one-time-code"></label>` : "";
    root.innerHTML = `
      <main class="login">
        <form class="login-card" novalidate>
          <h1 class="title">${esc(title)}</h1>
          ${langField}
          <label class="field"><span>${esc(t("GLOBAL.EMAIL", "E-Mail"))}</span>
            <input name="email" type="email" autocomplete="email" inputmode="email" required>
          </label>
          <p class="error" data-for="email" hidden></p>
          <label class="field"><span>${esc(t("GLOBAL.PASSWORD", "Passwort"))}</span>
            <input name="password" type="password" autocomplete="current-password" required>
          </label>
          <p class="error" data-for="password" hidden></p>
          ${codeField}
          <label class="stay"><input name="stay" type="checkbox"> ${esc(t("LOGIN.LABEL_SIGN_ME", "Anmeldung merken"))}</label>
          <p class="error" data-for="form" hidden></p>
          <button type="submit" class="ink-btn">${esc(t("LOGIN.BUTTON_SIGN_IN", "Anmelden"))}</button>
        </form>
      </main>`;
    const form = root.querySelector("form") as HTMLFormElement;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form);
      actions.login(String(data.get("email") || ""), String(data.get("password") || ""), data.get("stay") === "on", String(data.get("totp") || ""));
    });
    form.querySelector("select[name='language']")?.addEventListener("change", (event) => {
      actions.act("login-lang", { language: (event.target as HTMLSelectElement).value });
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

  const showMail: MailView["showMail"] = (email, folderName, assist) => {
    root.innerHTML = `
      <div class="shell" data-pane="list" data-layout="1" data-surface="mail" data-sidebar="${docked() ? "open" : "closed"}">
        <button type="button" class="scrim" data-action="close-sidebar" aria-label="Ordner schließen"></button>
        <aside class="sidebar" aria-label="Ordner">
          <div class="account">
            <button type="button" class="account-btn" data-action="account" aria-expanded="false" aria-controls="account-menu" aria-haspopup="menu"></button>
            <div class="menu" id="account-menu" role="menu" hidden>
              <div id="account-list"></div>
              <button type="button" class="menu-item" role="menuitem" data-action="open-book" data-book-entry hidden>${icon("contacts")}<span>${esc(t("GLOBAL.CONTACTS", "Kontakte"))}</span></button>
              <button type="button" class="menu-item" role="menuitem" data-action="settings">${icon("settings")}<span>${esc(t("GLOBAL.SETTINGS", "Einstellungen"))}</span></button>
              <button type="button" class="menu-item" role="menuitem" data-action="logout">${icon("logout")}<span>${esc(t("GLOBAL.LOGOUT", "Abmelden"))}</span></button>
            </div>
          </div>
          <p class="group-label mono">${esc(t("FOLDERS_UI.FOLDERS", "Ordner"))}</p>
          <div class="folder-filter" hidden>
            <label class="sr" for="folder-q">${esc(t("FOLDERS_UI.FILTER", "Ordner suchen"))}</label>
            <input class="search" id="folder-q" type="search" placeholder="${esc(t("FOLDERS_UI.FILTER", "Ordner suchen"))}" autocomplete="off">
          </div>
          <div id="folder-tree" class="folder-tree"></div>
          <button type="button" class="folder book-entry" data-action="open-book" data-book-entry hidden aria-pressed="false">${icon("contacts")}<span class="folder-name">${esc(t("GLOBAL.CONTACTS", "Kontakte"))}</span></button>
          <div class="sidebar-foot">
            <button type="button" class="text-btn" data-action="f-create" hidden>${withIcon("folder-plus", t("SETTINGS_FOLDERS.BUTTON_CREATE", "Ordner anlegen"))}</button>
            <div id="quota" class="quota"></div>
          </div>
          <ul class="menu folder-menu" id="folder-menu" role="menu" aria-label="${esc(t("FOLDERS_UI.ACTIONS", "Ordneraktionen"))}" hidden></ul>
        </aside>
        <section class="list-pane" aria-label="Mails">
          <div class="pane-head">
            <button type="button" class="icon-btn" data-action="toggle-sidebar" aria-label="Ordner ein- oder ausblenden">${icon("menu")}</button>
            <h1 class="title title-md" id="folder-title"></h1>
            <span class="spacer"></span>
            <div class="bar-more view-more">
              <button type="button" class="icon-btn" data-action="view-menu" aria-haspopup="menu" aria-expanded="false" aria-controls="view-menu" aria-label="${esc(t("FOLDERS_UI.VIEW_MENU", "Sortierung und Ansicht"))}" title="${esc(t("FOLDERS_UI.VIEW_MENU", "Sortierung und Ansicht"))}" hidden>${icon("sort")}</button>
              <div class="menu menu-right" id="view-menu" role="menu" hidden></div>
            </div>
            <div class="bar-more select-more">
              <button type="button" class="icon-btn select-btn" data-action="m-select-all" aria-label="${esc(t("MESSAGE_LIST.BUTTON_SELECT_ALL", "Alle auswählen"))}" title="${esc(t("MESSAGE_LIST.BUTTON_SELECT_ALL", "Alle auswählen"))} (Strg+A)">${icon("select-all")}</button>
              <button type="button" class="icon-btn select-menu-btn" data-action="select-menu" aria-haspopup="menu" aria-expanded="false" aria-controls="select-menu" aria-label="${esc(t("GLOBAL.SELECTION", "Auswahlmenü"))}" title="${esc(t("GLOBAL.SELECTION", "Auswahlmenü"))}">${icon("chevron-down")}</button>
              <div class="menu menu-right" id="select-menu" role="menu" hidden>
                <button type="button" class="menu-item" role="menuitem" data-action="select-filter" data-filter="all">${icon("checkbox-checked")}<span>${esc(t("MESSAGE_LIST.SELECT_ALL", "Alle"))}</span></button>
                <button type="button" class="menu-item" role="menuitem" data-action="select-filter" data-filter="unread">${icon("mark-unread")}<span>${esc(t("SEARCH.UNSEEN", "Ungelesene"))}</span></button>
                <button type="button" class="menu-item" role="menuitem" data-action="select-filter" data-filter="read">${icon("mark-read")}<span>${esc(t("MESSAGE_LIST.BUTTON_MARK_AS_READ", "Gelesene"))}</span></button>
                <button type="button" class="menu-item" role="menuitem" data-action="select-filter" data-filter="flagged">${icon("flag-filled")}<span>${esc(t("SEARCH.FLAGGED", "Markierte"))}</span></button>
                <button type="button" class="menu-item" role="menuitem" data-action="select-filter" data-filter="unflagged">${icon("flag")}<span>${esc(t("MESSAGE_LIST.FLAG_REMOVE", "Nicht markierte"))}</span></button>
                <hr class="menu-sep">
                <button type="button" class="menu-item" role="menuitem" data-action="select-filter" data-filter="none">${icon("close")}<span>${esc(t("MESSAGE_LIST.BUTTON_CLEAR_SELECTION", "Auswahl aufheben"))}</span></button>
              </div>
            </div>
            <button type="button" class="icon-btn" data-action="m-refresh" aria-label="Aktualisieren" title="Aktualisieren">${icon("refresh")}</button>
            <div class="selection-head" id="selection-head" hidden>
              <button type="button" class="icon-btn" data-action="m-clear-selection" aria-label="${esc(t("MESSAGE_LIST.BUTTON_CLEAR_SELECTION", "Auswahl aufheben"))}" title="${esc(t("MESSAGE_LIST.BUTTON_CLEAR_SELECTION", "Auswahl aufheben"))} (Esc)">${icon("close")}</button>
              <span class="selection-count mono" id="selection-count">0 ausgewählt</span>
              <span class="spacer"></span>
              <button type="button" class="icon-btn" data-action="m-unread-all" aria-label="${esc(t("MESSAGE.BUTTON_UNREAD", "Gelesen / ungelesen"))}" title="${esc(t("MESSAGE.BUTTON_UNREAD", "Gelesen / ungelesen"))}">${icon("mark-unread")}</button>
              <button type="button" class="icon-btn" data-action="m-flag-all" aria-label="${esc(t("MESSAGE_LIST.FLAG_SET", "Markieren"))}" title="${esc(t("MESSAGE_LIST.FLAG_SET", "Markieren"))}">${icon("flag")}</button>
              <button type="button" class="icon-btn" data-action="m-move" aria-label="${esc(t("MESSAGE_LIST.BUTTON_MOVE", "Verschieben"))}" title="${esc(t("MESSAGE_LIST.BUTTON_MOVE", "Verschieben"))}">${icon("move")}</button>
              <button type="button" class="icon-btn" data-action="delete" aria-label="${esc(t("GLOBAL.DELETE", "Löschen"))}" title="${esc(t("GLOBAL.DELETE", "Löschen"))}">${icon("delete")}</button>
            </div>
          </div>
          <form class="search-wrap" data-action="search">
            <label class="sr" for="search">Suche</label>
            <div class="search-field">
              ${icon("search")}
              <input class="search" id="search" type="search" placeholder="" autocomplete="off" aria-keyshortcuts="Escape">
              <button type="button" class="icon-btn search-clear" data-action="clear-search" data-clear="field" hidden aria-label="Suche löschen" title="Suche löschen">${icon("close")}</button>
            </div>
            <button type="button" class="icon-btn" data-action="adv-search" aria-haspopup="dialog" aria-label="${esc(t("SEARCH.TITLE_ADV", "Erweiterte Suche"))}" title="${esc(t("SEARCH.TITLE_ADV", "Erweiterte Suche"))}">${icon("filter")}</button>
          </form>
          <div class="criteria" id="criteria" hidden></div>
          <div class="quick" role="group" aria-label="${esc(t("SEARCH_UI.QUICK", "Schnellfilter"))}">
            <button type="button" class="chip" data-action="quick" data-flag="unseen" aria-pressed="false">${withIcon("mark-unread", t("SEARCH.UNSEEN", "Ungelesen"))}</button>
            <button type="button" class="chip" data-action="quick" data-flag="flagged" aria-pressed="false">${withIcon("flag", t("SEARCH.FLAGGED", "Markiert"))}</button>
            <button type="button" class="chip" data-action="quick" data-flag="attachment" aria-pressed="false">${withIcon("attachment", t("SEARCH_UI.WITH_ATTACHMENT", "Mit Anhang"))}</button>
          </div>
          <p class="list-status live" id="list-status" aria-live="polite"></p>
          <div class="thread-bar" id="thread-bar" hidden>
            <button type="button" class="text-btn" data-action="thread-back">${withIcon("back", t("FOLDERS_UI.BACK_TO_LIST", "Zurück zur Liste"))}</button>
            <span class="quiet" id="thread-label"></span>
          </div>
          <div class="pane-body" id="list-body">
            <div id="rows"></div>
            <p class="result-label mono" id="list-result" hidden></p>
            <div class="empty" id="list-empty" hidden>
              <span class="icon icon-lg">${icon("inbox")}</span>
              <p class="empty-title"></p>
              <span class="empty-hint mono">R Aktualisieren · / Suchen</span>
            </div>
            <button type="button" class="text-btn" data-action="clear-search" data-clear="list" hidden>Suche aufheben</button>
            <button type="button" class="text-btn more-row" data-action="more" hidden>${icon("chevron-down")}<span>Weitere</span></button>
            <p class="error" id="list-error" role="alert" hidden></p>
          </div>
        </section>
        <div class="splitter" role="separator" aria-orientation="vertical" aria-label="Breite der Liste" tabindex="0" aria-valuemin="288" aria-valuemax="640" aria-valuenow="384"></div>
        <section class="reader" aria-label="${esc(t("GLOBAL.MESSAGE", "Brief"))}">
          <div class="reader-bar" role="toolbar" aria-label="${esc(t("MESSAGE.TOOLBAR", "Aktionen für die geöffnete Mail"))}">
            <div class="bulk-bar" id="bulk-bar" hidden>
              <button type="button" class="icon-btn" data-action="back" aria-label="${esc(t("GLOBAL.BACK", "Zurück"))}" title="${esc(t("GLOBAL.BACK", "Zurück"))}" hidden>${icon("back")}</button>
              <span class="bulk-bar-count mono" id="bulk-bar-count">0 ausgewählt</span>
              <span class="spacer"></span>
              <button type="button" class="icon-btn" data-action="m-unread-all" aria-label="${esc(t("MESSAGE.BUTTON_UNREAD", "Gelesen / ungelesen"))}" title="${esc(t("MESSAGE.BUTTON_UNREAD", "Gelesen / ungelesen"))}">${icon("mark-unread")}</button>
              <button type="button" class="icon-btn" data-action="m-flag-all" aria-label="${esc(t("MESSAGE_LIST.FLAG_SET", "Markieren"))}" title="${esc(t("MESSAGE_LIST.FLAG_SET", "Markieren"))}">${icon("flag")}</button>
              <button type="button" class="icon-btn" data-action="m-move" aria-label="${esc(t("MESSAGE_LIST.BUTTON_MOVE", "Verschieben"))}" title="${esc(t("MESSAGE_LIST.BUTTON_MOVE", "Verschieben"))}">${icon("move")}</button>
              <button type="button" class="icon-btn" data-action="archive" data-bulk-archive hidden aria-label="${esc(t("GLOBAL.TO_ARCHIVE", "Archivieren"))}" title="${esc(t("GLOBAL.TO_ARCHIVE", "Archivieren"))}">${icon("archive")}</button>
              <button type="button" class="icon-btn" data-action="delete" aria-label="${esc(t("GLOBAL.DELETE", "Löschen"))}" title="${esc(t("GLOBAL.DELETE", "Löschen"))}">${icon("delete")}</button>
              <button type="button" class="icon-btn" data-action="m-clear-selection" aria-label="${esc(t("MESSAGE_LIST.BUTTON_CLEAR_SELECTION", "Auswahl aufheben"))}" title="${esc(t("MESSAGE_LIST.BUTTON_CLEAR_SELECTION", "Auswahl aufheben"))} (Esc)">${icon("close")}</button>
            </div>
            <div class="bar-group bar-navigation">
              <button type="button" class="text-btn bar-btn" data-action="back" aria-label="${esc(t("GLOBAL.BACK", "Zurück"))}" title="${esc(t("GLOBAL.BACK", "Zurück"))}" hidden>${withIcon("back", t("GLOBAL.BACK", "Zurück"))}</button>
              <span class="quiet" id="reader-place"></span>
            </div>
            <span class="spacer"></span>
            <div class="bar-group bar-primary" role="group" aria-label="${esc(t("MESSAGE.REPLY_ACTIONS", "Antworten und Weiterleiten"))}">
              <button type="button" class="text-btn bar-btn ink-btn" data-direct="1" data-action="m-edit-draft" title="${esc(t("MESSAGE.EDIT_DRAFT", "Entwurf bearbeiten"))}" hidden>${withIcon("compose", t("MESSAGE.EDIT_DRAFT", "Entwurf bearbeiten"))}</button>
              <button type="button" class="text-btn bar-btn reply-main" data-direct="1" data-action="reply" title="${esc(t("MESSAGE.BUTTON_REPLY", "Antworten"))}" hidden>${withIcon("reply", t("MESSAGE.BUTTON_REPLY", "Antworten"))}</button>
              <button type="button" class="text-btn bar-btn" data-direct="1" data-action="reply-all" title="${esc(t("MESSAGE.BUTTON_REPLY_ALL", "Allen antworten"))}" hidden>${withIcon("reply-all", t("MESSAGE.BUTTON_REPLY_ALL", "Allen antworten"))}</button>
              <button type="button" class="text-btn bar-btn" data-direct="1" data-action="forward" title="${esc(t("MESSAGE.BUTTON_FORWARD", "Weiterleiten"))}" hidden>${withIcon("forward", t("MESSAGE.BUTTON_FORWARD", "Weiterleiten"))}</button>
            </div>
            <div class="bar-group bar-organize" role="group" aria-label="${esc(t("MESSAGE.ORGANIZE_ACTIONS", "Bearbeiten und Ablage"))}">
              <button type="button" class="text-btn bar-btn" data-direct="1" data-action="archive" title="${esc(t("GLOBAL.TO_ARCHIVE", "Archivieren"))}" hidden>${withIcon("archive", t("GLOBAL.TO_ARCHIVE", "Archivieren"))}</button>
              <button type="button" class="text-btn bar-btn" data-direct="1" data-action="unread" title="${esc(t("MESSAGE.BUTTON_UNREAD", "Ungelesen"))}" hidden>${withIcon("mark-unread", t("MESSAGE.BUTTON_UNREAD", "Ungelesen"))}</button>
              <button type="button" class="text-btn bar-btn" data-direct="1" data-action="delete" title="${esc(t("GLOBAL.DELETE", "Löschen"))}" hidden>${withIcon("delete", t("GLOBAL.DELETE", "Löschen"))}</button>
              <button type="button" class="text-btn bar-btn" data-direct="1" data-action="m-flag" data-one="1" title="${esc(t("MESSAGE_LIST.FLAG_SET", "Markieren"))} (I)" aria-pressed="false" hidden>${withIcon("flag", t("MESSAGE_LIST.FLAG_SET", "Markieren"))}</button>
              <button type="button" class="text-btn bar-btn" data-direct="1" data-action="m-move" data-one="1" title="${esc(t("MESSAGE_LIST.BUTTON_MOVE", "Verschieben"))} (M)" hidden>${withIcon("move", t("MESSAGE_LIST.BUTTON_MOVE", "Verschieben"))}</button>
              <button type="button" class="text-btn bar-btn" data-direct="1" data-action="m-spam" data-one="1" title="${esc(t("MESSAGE.BUTTON_SPAM", "Spam"))}" hidden>${withIcon("spam", t("MESSAGE.BUTTON_SPAM", "Spam"))}</button>
              <button type="button" class="text-btn bar-btn" data-direct="1" data-action="m-notspam" data-one="1" title="${esc(t("MESSAGE.BUTTON_NOT_SPAM", "Kein Spam"))}" hidden>${withIcon("not-spam", t("MESSAGE.BUTTON_NOT_SPAM", "Kein Spam"))}</button>
            </div>
            <div class="bar-group bar-assist"></div>
            <div class="bar-group bar-end" role="group" aria-label="${esc(t("MESSAGE.MORE_AND_NAVIGATION", "Weitere Aktionen und Navigation"))}">
              <div class="bar-more">
                <button type="button" class="icon-btn" data-direct="1" data-action="m-more" data-one="1" aria-label="${esc(t("MESSAGE.MORE_ACTIONS", "Weitere Aktionen"))}" aria-haspopup="menu" aria-expanded="false" aria-controls="more-menu" title="${esc(t("MESSAGE.MORE_ACTIONS", "Weitere Aktionen"))}" hidden>${icon("more")}</button>
                <div class="menu menu-right" id="more-menu" role="menu" hidden>
                  <button type="button" class="menu-item narrow" role="menuitem" data-action="reply-all">${icon("reply-all")}<span>${esc(t("MESSAGE.BUTTON_REPLY_ALL", "Allen antworten"))}</span></button>
                  <button type="button" class="menu-item narrow" role="menuitem" data-action="forward">${icon("forward")}<span>${esc(t("MESSAGE.BUTTON_FORWARD", "Weiterleiten"))}</span></button>
                  <button type="button" class="menu-item narrow" role="menuitem" data-action="archive">${icon("archive")}<span>${esc(t("GLOBAL.TO_ARCHIVE", "Archivieren"))}</span></button>
                  <button type="button" class="menu-item narrow" role="menuitem" data-action="unread" data-narrow="unread">${icon("mark-unread")}<span>${esc(t("MESSAGE.BUTTON_UNREAD", "Gelesen / ungelesen"))}</span></button>
                  <button type="button" class="menu-item narrow" role="menuitem" data-action="m-flag">${icon("flag")}<span>${esc(t("MESSAGE_LIST.FLAG_SET", "Markieren"))}</span></button>
                  <button type="button" class="menu-item narrow" role="menuitem" data-action="m-move">${icon("move")}<span>${esc(t("MESSAGE_LIST.BUTTON_MOVE", "Verschieben …"))}</span></button>
                  <button type="button" class="menu-item narrow" role="menuitem" data-action="m-spam" data-narrow="spam">${icon("spam")}<span>${esc(t("MESSAGE.BUTTON_SPAM", "Spam"))}</span></button>
                  <button type="button" class="menu-item narrow" role="menuitem" data-action="m-notspam" data-narrow="notspam">${icon("not-spam")}<span>${esc(t("MESSAGE.BUTTON_NOT_SPAM", "Kein Spam"))}</span></button>
                  <button type="button" class="menu-item narrow" role="menuitem" data-action="delete">${icon("delete")}<span>${esc(t("GLOBAL.DELETE", "Löschen"))}</span></button>
                  <button type="button" class="menu-item narrow" role="menuitem" data-action="m-prev">${icon("chevron-up")}<span>${esc(t("MESSAGE.PREVIOUS", "Vorige Mail"))} (K)</span></button>
                  <button type="button" class="menu-item narrow" role="menuitem" data-action="m-next">${icon("chevron-down")}<span>${esc(t("MESSAGE.NEXT", "Nächste Mail"))} (J)</span></button>
                  <button type="button" class="menu-item" role="menuitem" data-action="m-edit-draft" hidden>${icon("compose")}<span>${esc(t("MESSAGE.EDIT_DRAFT", "Entwurf bearbeiten"))}</span></button>
                  <button type="button" class="menu-item" role="menuitem" data-action="m-edit-new">${icon("edit-as-new")}<span>${esc(t("MESSAGE.EDIT_AS_NEW", "Als neu bearbeiten"))}</span></button>
                  <button type="button" class="menu-item" role="menuitem" data-action="m-forward-att">${icon("forward-attachment")}<span>${esc(t("MESSAGE.FORWARD_ATTACHMENT", "Als Anhang weiterleiten"))}</span></button>
                  <hr class="menu-sep">
                  <button type="button" class="menu-item" role="menuitem" data-action="m-copy">${icon("copy")}<span>${esc(t("MESSAGE_LIST.BUTTON_COPY", "Kopieren nach …"))}</span></button>
                  <button type="button" class="menu-item" role="menuitem" data-action="m-tag">${icon("tag")}<span>${esc(t("MESSAGE.ACTION_ADD_TAG", "Schlagwort hinzufügen"))}</span></button>
                  <hr class="menu-sep">
                  <button type="button" class="menu-item" role="menuitem" data-action="m-mode" data-mode-item="1">${icon("source")}<span>${esc(t("MESSAGE.VIEW_PLAIN", "Nur Text anzeigen"))}</span></button>
                  <button type="button" class="menu-item" role="menuitem" data-action="m-swap">${icon("eye")}<span>${esc(t("MESSAGE.SWAP_COLORS", "Farben umkehren"))}</span></button>
                  <button type="button" class="menu-item" role="menuitem" data-action="m-unsubscribe" hidden>${icon("unsubscribe")}<span>${esc(t("MESSAGE.UNSUBSCRIBE_TITLE", "Vom Verteiler abmelden"))}</span></button>
                  <button type="button" class="menu-item" role="menuitem" data-action="m-print">${icon("print")}<span>${esc(t("GLOBAL.PRINT", "Drucken"))}</span></button>
                  <button type="button" class="menu-item" role="menuitem" data-action="m-window">${icon("external")}<span>${esc(t("MESSAGE.NEW_WINDOW", "In neuem Fenster"))}</span></button>
                  <button type="button" class="menu-item" role="menuitem" data-action="m-fullscreen">${icon("fullscreen")}<span>${esc(t("MESSAGE.FULLSCREEN", "Vollbild"))}</span></button>
                  <hr class="menu-sep">
                  <button type="button" class="menu-item" role="menuitem" data-action="m-source">${icon("code")}<span>${esc(t("MESSAGE.VIEW_SOURCE", "Quelltext anzeigen"))}</span></button>
                  <button type="button" class="menu-item" role="menuitem" data-action="m-eml">${icon("download")}<span>${esc(t("MESSAGE.DOWNLOAD_EML", "Als .eml laden"))}</span></button>
                  <hr class="menu-sep">
                  <button type="button" class="menu-item danger-item" role="menuitem" data-action="m-delete-forever">${icon("delete-forever")}<span>${esc(t("GLOBAL.DELETE_FOREVER", "Endgültig löschen"))}</span></button>
                </div>
              </div>
              <button type="button" class="icon-btn" data-direct="1" data-action="m-prev" data-one="1" aria-label="${esc(t("MESSAGE.PREVIOUS", "Vorige Mail"))} (K)" title="${esc(t("MESSAGE.PREVIOUS", "Vorige Mail"))} (K)" hidden>${icon("chevron-up")}</button>
              <button type="button" class="icon-btn" data-direct="1" data-action="m-next" data-one="1" aria-label="${esc(t("MESSAGE.NEXT", "Nächste Mail"))} (J)" title="${esc(t("MESSAGE.NEXT", "Nächste Mail"))} (J)" hidden>${icon("chevron-down")}</button>
            </div>
          </div>
          <p class="quiet live" id="notice" aria-live="polite"></p>
          <div class="pane-body" id="reader-body">
            <div class="empty reader-empty" id="reader-empty">
              <span class="icon icon-lg">${icon("inbox")}</span>
              <p class="empty-title">${esc(t("MESSAGE.SELECT_MESSAGE", "Wählen Sie eine Mail aus der Liste."))}</p>
              <span class="empty-hint mono">${esc(t("MESSAGE.SHORTCUTS_HINT", "J / K Navigieren · C Verfassen · ? Tastenkürzel"))}</span>
            </div>
          </div>
        </section>
        <section class="book" id="book" hidden aria-label="${esc(t("GLOBAL.CONTACTS", "Kontakte"))}"></section>
        <div id="compose-host"></div>
        <nav class="tabbar" aria-label="Navigation">
          <button type="button" class="text-btn" data-action="pane-folders">${withIcon("folder", "Ordner")}</button>
          <button type="button" class="text-btn" data-action="pane-search">${withIcon("search", "Suche")}</button>
          <button type="button" class="ink-btn" data-action="compose">${withIcon("compose", t("FOLDER_LIST.BUTTON_NEW_MESSAGE", "Neue Nachricht"))}</button>
        </nav>
        <dialog id="settings" class="dialog-wide dialog-settings" aria-labelledby="settings-title">
          <div class="settings-frame">
            <div class="settings-head">
              <h2 id="settings-title" class="title title-md">${esc(t("GLOBAL.SETTINGS", "Einstellungen"))}</h2>
              <span class="spacer"></span>
              <p class="quiet live" id="settings-live" aria-live="polite"></p>
              <button type="button" class="icon-btn" data-action="close-dialog" aria-label="${esc(t("GLOBAL.CLOSE", "Schließen"))}">${icon("close")}</button>
            </div>
            <div class="settings-body">
              <aside class="settings-sidebar">
                <nav class="settings-nav" aria-label="${esc(t("GLOBAL.SETTINGS", "Einstellungen"))}">
                  <span class="settings-nav-category" data-cat="personal">Persönlich</span>
                  <button type="button" class="text-btn" data-action="settings-section" data-section="look" aria-pressed="true">${withIcon("eye", t("SETTINGS_DESK.APPEARANCE", "Erscheinungsbild"))}</button>
                  <button type="button" class="text-btn" data-action="settings-section" data-section="general">${withIcon("settings", t("SETTINGS_LABELS.GENERAL", "Allgemein"))}</button>

                  <span class="settings-nav-category" data-cat="account">Konto</span>
                  <button type="button" class="text-btn" data-action="settings-section" data-section="security">${withIcon("key", t("SETTINGS_LABELS.SECURITY", "Sicherheit"))}</button>
                  <button type="button" class="text-btn" data-action="settings-section" data-section="accounts">${withIcon("users", t("SETTINGS_LABELS.ACCOUNTS", "Konten"))}</button>
                  <button type="button" class="text-btn" data-action="settings-section" data-section="identities">${withIcon("identity", t("SETTINGS_ACCOUNTS.LEGEND_IDENTITIES", "Identitäten"))}</button>

                  <span class="settings-nav-category" data-cat="mail">Postfach</span>
                  <button type="button" class="text-btn" data-action="settings-section" data-section="folders">${withIcon("folder", t("SETTINGS_LABELS.FOLDERS", "Ordner"))}</button>
                  <button type="button" class="text-btn" data-action="settings-section" data-section="filters" hidden>${withIcon("filter", t("SETTINGS_LABELS.FILTERS", "Filter"))}</button>

                  <span class="settings-nav-category" data-cat="advanced">Erweitert</span>
                  <button type="button" class="text-btn" data-action="settings-section" data-section="assistant" hidden>${withIcon("assist", t("AI_COPILOT.TITLE", "Assistent"))}</button>
                  <button type="button" class="text-btn" data-action="settings-section" data-section="contacts" hidden>${withIcon("contacts", t("SETTINGS_LABELS.CONTACTS", "Kontakte"))}</button>
                  <button type="button" class="text-btn" data-action="settings-section" data-section="keys">${withIcon("key", t("SETTINGS_DESK.KEYS", "Schlüssel"))}</button>
                </nav>
              </aside>
              <div class="settings-main dialog-body">
                <div id="settings-panel"></div>
              </div>
            </div>
          </div>
        </dialog>
        <dialog id="keys" aria-labelledby="keys-title">
          <div class="dialog-body">
            <div class="sheet-head" style="padding:0;border:0;min-height:0">
              <h2 id="keys-title" class="title title-md">Tasten</h2>
              <span class="spacer"></span>
              <button type="button" class="icon-btn" data-action="close-dialog" aria-label="${esc(t("GLOBAL.CLOSE", "Schließen"))}">${icon("close")}</button>
            </div>
            <ul class="keys">
              <li><span>Nächste, vorige Mail</span><kbd>J</kbd> <kbd>K</kbd></li>
              <li><span>Öffnen</span><kbd>Enter</kbd></li>
              <li><span>Unterhaltung öffnen</span><kbd>T</kbd></li>
              <li><span>Zurück zur Liste (Unterhaltung)</span><kbd>Esc</kbd></li>
              <li><span>Ordner auf-, zuklappen</span><kbd>←</kbd> <kbd>→</kbd></li>
              <li><span>Ordneraktionen</span><kbd>Umschalt</kbd> <kbd>F10</kbd></li>
              <li><span>Schreiben</span><kbd>C</kbd></li>
              <li><span>Antworten</span><kbd>R</kbd></li>
              <li><span>Allen antworten</span><kbd>A</kbd></li>
              <li><span>Weiterleiten</span><kbd>F</kbd></li>
              <li><span>Archivieren</span><kbd>E</kbd></li>
              <li><span>Markieren</span><kbd>I</kbd></li>
              <li><span>Gelesen / ungelesen</span><kbd>U</kbd></li>
              <li><span>Verschieben</span><kbd>M</kbd></li>
              <li><span>Löschen</span><kbd>#</kbd> <kbd>Entf</kbd></li>
              <li><span>Endgültig löschen</span><kbd>Umschalt</kbd> <kbd>Entf</kbd></li>
              <li><span>Alle auswählen</span><kbd>Strg</kbd> <kbd>A</kbd></li>
              <li><span>Auswahl erweitern</span><kbd>Umschalt</kbd> <kbd>Klick</kbd></li>
              <li><span>Aktualisieren</span><kbd>Umschalt</kbd> <kbd>R</kbd></li>
              <li><span>Seitenleiste</span><kbd>\\</kbd></li>
              <li><span>Gelesen</span><kbd>Umschalt</kbd> <kbd>U</kbd></li>
              <li><span>Ordner, Liste, Brief</span><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd></li>
              <li><span>Vollbild</span><kbd>V</kbd></li>
              <li><span>Zitate ein oder aus</span><kbd>Q</kbd></li>
              <li><span>Senden im Editor</span><kbd>Strg</kbd> <kbd>Enter</kbd></li>
              <li><span>Entwurf speichern</span><kbd>Strg</kbd> <kbd>S</kbd></li>
              <li><span>Editor minimieren</span><kbd>,</kbd></li>
              <li><span>Schließen</span><kbd>Esc</kbd></li>
              <li><span>Diese Liste</span><kbd>?</kbd></li>
            </ul>
          </div>
        </dialog>
        <dialog id="confirm" aria-labelledby="confirm-title">
          <div class="dialog-body">
            <h2 id="confirm-title" class="title title-md">Wirklich löschen?</h2>
            <p class="quiet" id="confirm-text" hidden></p>
            <div class="dialog-actions">
              <button type="button" class="text-btn" value="cancel">${esc(t("GLOBAL.CANCEL", "Abbrechen"))}</button>
              <button type="button" class="text-btn" value="alt" id="confirm-alt" hidden></button>
              <button type="button" class="danger" value="ok" id="confirm-ok">${withIcon("delete", t("GLOBAL.DELETE", "Löschen"))}</button>
            </div>
          </div>
        </dialog>
        <dialog id="picker" aria-labelledby="picker-title">
          <form class="dialog-body" method="dialog" data-action="picker">
            <div class="sheet-head" style="padding:0;border:0;min-height:0">
              <h2 id="picker-title" class="title title-md">Verschieben nach</h2>
              <span class="spacer"></span>
              <button type="button" class="icon-btn" data-action="close-dialog" aria-label="${esc(t("GLOBAL.CLOSE", "Schließen"))}">${icon("close")}</button>
            </div>
            <label class="sr" for="picker-q">Ordner suchen</label>
            <input class="search" id="picker-q" type="search" placeholder="Ordner suchen" autocomplete="off">
            <div class="picker-list" id="picker-list" role="listbox" aria-label="Ordner"></div>
          </form>
        </dialog>
        <dialog id="prompt-dlg" aria-labelledby="prompt-title">
          <form class="dialog-body" data-action="prompt-form">
            <h2 id="prompt-title" class="title title-md"></h2>
            <label class="field"><span id="prompt-label"></span><input id="prompt-input" type="text" autocomplete="off"></label>
            <label class="check" id="prompt-remember-row" hidden><input id="prompt-remember" type="checkbox"> ${esc(t("CRYPTO.REMEMBER_SESSION", "Für diese Sitzung merken"))}</label>
            <div class="dialog-actions">
              <button type="button" class="text-btn" data-action="close-dialog">${esc(t("GLOBAL.CANCEL", "Abbrechen"))}</button>
              <button type="submit" class="ink-btn">${withIcon("check", "Übernehmen")}</button>
            </div>
          </form>
        </dialog>
        <dialog id="lightbox" class="dialog-wide lightbox" aria-labelledby="lightbox-title">
          <div class="dialog-body">
            <div class="sheet-head" style="padding:0;border:0;min-height:0">
              <h2 id="lightbox-title" class="title title-md"></h2>
              <span class="spacer"></span>
              <a class="icon-btn" id="lightbox-open" target="_blank" rel="noopener" aria-label="In neuem Tab öffnen" title="In neuem Tab öffnen">${icon("external")}</a>
              <button type="button" class="icon-btn" data-action="close-dialog" aria-label="${esc(t("GLOBAL.CLOSE", "Schließen"))}">${icon("close")}</button>
            </div>
            <div class="lightbox-body" id="lightbox-body"></div>
          </div>
        </dialog>
        <dialog id="adv-search" class="dialog-wide" aria-labelledby="adv-title">
          <form class="dialog-body" data-action="adv-search-form">
            <div class="sheet-head" style="padding:0;border:0;min-height:0">
              <h2 id="adv-title" class="title title-md">${esc(t("SEARCH.TITLE_ADV", "Erweiterte Suche"))}</h2>
              <span class="spacer"></span>
              <button type="button" class="icon-btn" data-action="close-dialog" aria-label="${esc(t("GLOBAL.CLOSE", "Schließen"))}">${icon("close")}</button>
            </div>
            <div id="adv-body"></div>
          </form>
        </dialog>
        <dialog id="folder-dlg" aria-labelledby="folder-dlg-title">
          <form class="dialog-body" data-action="folder-dlg-form">
            <h2 id="folder-dlg-title" class="title title-md"></h2>
            <label class="field"><span>${esc(t("GLOBAL.NAME", "Name"))}</span><input id="folder-dlg-name" type="text" required autocomplete="off"></label>
            <label class="field"><span>${esc(t("POPUPS_CREATE_FOLDER.LABEL_PARENT", "Übergeordneter Ordner"))}</span><select id="folder-dlg-parent"></select></label>
            <label class="check"><input type="checkbox" id="folder-dlg-sub" checked> ${esc(t("FOLDERS_UI.SUBSCRIBE", "Abonnieren"))}</label>
            <div class="dialog-actions">
              <button type="button" class="text-btn" data-action="close-dialog">${esc(t("GLOBAL.CANCEL", "Abbrechen"))}</button>
              <button type="submit" class="ink-btn">${withIcon("folder-plus", t("POPUPS_CREATE_FOLDER.BUTTON_CREATE", "Anlegen"))}</button>
            </div>
          </form>
        </dialog>
        <dialog id="acl-dlg" class="dialog-wide" aria-labelledby="acl-title">
          <div class="dialog-body">
            <div class="sheet-head" style="padding:0;border:0;min-height:0">
              <h2 id="acl-title" class="title title-md"></h2>
              <span class="spacer"></span>
              <button type="button" class="icon-btn" data-action="close-dialog" aria-label="${esc(t("GLOBAL.CLOSE", "Schließen"))}">${icon("close")}</button>
            </div>
            <div id="acl-body"></div>
          </div>
        </dialog>
        <ul class="menu addr-menu" id="addr-menu" role="menu" hidden>
          <li><button type="button" class="menu-item" role="menuitem" data-action="m-addr-write">${icon("compose")}<span>Mail schreiben</span></button></li>
          <li><button type="button" class="menu-item" role="menuitem" data-action="m-addr-copy">${icon("copy")}<span>Adresse kopieren</span></button></li>
          <li><button type="button" class="menu-item" role="menuitem" data-action="m-addr-search">${icon("search")}<span>Mails von dieser Adresse</span></button></li>
          <li><button type="button" class="menu-item" role="menuitem" data-action="m-addr-contact" hidden>${icon("contacts")}<span>${esc(t("CONTACTS.BUTTON_ADD_CONTACT", "Kontakt hinzufügen"))}</span></button></li>
        </ul>
      </div>`;
    const next = root.querySelector(".shell") as HTMLElement | null;
    if (!next) return;
    shell = next;
    const account = next.querySelector(".account-btn") as HTMLButtonElement;
    account.innerHTML = `<span class="account-mail">${esc(email)}</span>${icon("chevron-down")}`;
    composer = new Composer(next.querySelector("#compose-host") as HTMLElement, composePrefs, {
      send: (values) => actions.send(values),
      save: (values) => actions.saveCompose(values),
      close: (discard) => actions.closeCompose(discard),
      mobile: (open) => { if (!wide()) pane(open ? "compose" : "list"); },
      notice: (text) => { const slot = shell?.querySelector("#notice"); if (slot) slot.textContent = text; },
      passphrase: (title, label) => promptDialog(title, label, "", true)
    });
    composer.configure(composePrefs, composeIdentities);
    book = mountBook(next.querySelector("#book") as HTMLElement, {
      confirm: (title, text, ok, danger = true) => chooseDialog(title, text, ok, "", danger).then((value) => value === "ok"),
      choose: (title, text, ok, alt) => chooseDialog(title, text, ok, alt, false),
      compose: (to) => actions.act("compose-to", { to }),
      pane: (name) => pane(name),
      wide
    });
    (next.querySelector("#folder-title") as HTMLElement).textContent = folderName;
    (next.querySelector("#reader-place") as HTMLElement).textContent = folderName;
    const search = next.querySelector("#search") as HTMLInputElement;
    search.placeholder = `In ${folderName} suchen`;
    wireShell();
    if (assist) installAssist(assist);
  };

  function pane(name: string): void {
    if (!shell) return;
    shell.dataset.pane = name;
    shell.querySelectorAll<HTMLButtonElement>("[data-action='back']").forEach((back) => {
      back.hidden = wide() || name !== "reader";
    });
  }

  let expanded = false;
  let filesExpanded = false;
  let keyHandler: ((event: KeyboardEvent) => void) | null = null;
  let lastReader: ReaderData | null = null;

  /** Verfügbarkeit und Breitenpriorität gelten für Direktaktion und Menüeintrag gemeinsam. */
  function paintBar(data: ReaderData | null): void {
    lastReader = data;
    if (!shell) return;
    const one = Boolean(data);
    const inDrafts = Boolean(data?.place.inDrafts);
    const width = shell.querySelector(".reader")?.clientWidth || 0;
    const available: Record<string, boolean> = {
      "m-edit-draft": one && inDrafts,
      reply: one && !inDrafts,
      "reply-all": one && !inDrafts,
      forward: one && !inDrafts,
      archive: one && Boolean(data?.place.archive),
      unread: one,
      delete: one,
      "m-flag": one,
      "m-move": one,
      "m-spam": one && Boolean(data?.place.spam) && !data?.place.inSpam,
      "m-notspam": one && Boolean(data?.place.inSpam),
      "m-prev": one,
      "m-next": one
    };
    const direct: Record<string, boolean> = {
      "m-edit-draft": true,
      reply: true,
      "reply-all": width >= 480,
      forward: true,
      archive: width >= 520,
      unread: width >= 900,
      delete: width >= 520,
      "m-flag": width >= 900,
      "m-move": width >= 900,
      "m-spam": width >= 1120,
      "m-notspam": width >= 1120,
      "m-prev": width >= 560,
      "m-next": width >= 560
    };
    Object.entries(available).forEach(([name, on]) => {
      const button = shell?.querySelector<HTMLElement>(`.reader-bar [data-direct='1'][data-action='${name}']`);
      const item = shell?.querySelector<HTMLElement>(`#more-menu .narrow[data-action='${name}']`);
      if (button) button.hidden = !(on && direct[name]);
      if (item) item.hidden = !(on && !direct[name]);
    });
    const more = shell.querySelector<HTMLElement>(".reader-bar [data-direct='1'][data-action='m-more']");
    if (more) more.hidden = !one;
    const menuShow = (name: string, on: boolean) => {
      const item = shell?.querySelector(`#more-menu [data-action='${name}']`) as HTMLElement | null;
      if (item) item.hidden = !on;
    };
    menuShow("m-edit-draft", Boolean(data?.place.inDrafts));
    menuShow("m-unsubscribe", Boolean(data?.unsubscribe));
    menuShow("m-mode", Boolean(data?.canToggleMode));
    menuShow("m-delete-forever", Boolean(data && !data.place.inTrash));
    if (!data) return;
    const flagLabel = data.flagged ? t("MESSAGE_LIST.FLAG_REMOVE", "Markierung entfernen") : t("MESSAGE_LIST.FLAG_SET", "Markieren");
    shell.querySelectorAll<HTMLElement>(".reader-bar [data-action='m-flag']").forEach((flag) => {
      flag.setAttribute("aria-pressed", data.flagged ? "true" : "false");
      flag.setAttribute("aria-label", flagLabel);
      flag.title = `${flagLabel} (I)`;
      flag.innerHTML = withIcon(data.flagged ? "flag-filled" : "flag", flagLabel);
    });
    const unreadLabel = data.seen ? t("MESSAGE.MARK_UNREAD", "Als ungelesen markieren") : t("MESSAGE.MARK_READ", "Als gelesen markieren");
    shell.querySelectorAll<HTMLElement>(".reader-bar [data-action='unread']").forEach((unread) => {
      unread.innerHTML = withIcon(data.seen ? "mark-unread" : "mark-read", unreadLabel);
      unread.title = `${unreadLabel} (U)`;
      unread.setAttribute("aria-label", unreadLabel);
    });
    const deleteLabel = data.place.inTrash ? t("GLOBAL.DELETE_FOREVER", "Endgültig löschen") : t("GLOBAL.DELETE", "Löschen");
    shell.querySelectorAll<HTMLElement>(".reader-bar [data-action='delete']").forEach((del) => {
      del.title = deleteLabel;
      del.setAttribute("aria-label", deleteLabel);
      del.innerHTML = withIcon(data.place.inTrash ? "delete-forever" : "delete", deleteLabel);
    });
    const mode = shell.querySelector("#more-menu [data-action='m-mode']") as HTMLElement | null;
    if (mode) mode.innerHTML = `${icon("source")}<span>${esc(data.mode === "html" ? t("MESSAGE.VIEW_PLAIN", "Nur Text anzeigen") : t("MESSAGE.VIEW_HTML", "HTML anzeigen"))}</span>`;
    const swap = shell.querySelector("#more-menu [data-action='m-swap']") as HTMLElement | null;
    if (swap) swap.innerHTML = `${icon("eye")}<span>${esc(data.swap ? t("MESSAGE.ORIGINAL_COLORS", "Originalfarben") : t("MESSAGE.SWAP_COLORS", "Farben umkehren"))}</span>`;
  }

  function setSidebar(open: boolean): void {
    if (shell) shell.dataset.sidebar = open ? "open" : "closed";
  }

  function closeMenu(): void {
    shell?.querySelectorAll<HTMLElement>("#account-menu, #more-menu, #addr-menu, #folder-menu, #view-menu, #select-menu").forEach((menu) => { menu.hidden = true; });
    shell?.querySelectorAll<HTMLElement>("[data-action='account'], [data-action='m-more'], [data-action='f-menu'], [data-action='view-menu'], [data-action='select-menu']").forEach((button) => {
      button.setAttribute("aria-expanded", "false");
    });
  }

  function anyMenuOpen(): boolean {
    return Boolean(shell?.querySelector("#account-menu:not([hidden]), #more-menu:not([hidden]), #addr-menu:not([hidden]), #folder-menu:not([hidden]), #view-menu:not([hidden]), #select-menu:not([hidden])"));
  }

  let addrTarget: { email: string; name: string } = { email: "", name: "" };
  /** Auslöser des offenen Menüs; bekommt beim Schließen per Esc den Fokus zurück. */
  let menuReturn: HTMLElement | null = null;
  let folderActions = new Map<string, FolderAction[]>();
  let folderDesk: FolderDesk | null = null;
  let listMode: ListMode = { sortable: false, sort: "", threadsAvailable: false, useThreads: false, grouped: false, threadOpen: "" };

  /** Ordnermenü am Knopf oder an der Zeile öffnen (Knopf, Rechtsklick, Kontextmenü-Taste). */
  function openFolderMenu(target: string, anchor: HTMLElement, point?: { x: number; y: number }): void {
    const menu = shell?.querySelector("#folder-menu") as HTMLElement | null;
    const sidebar = shell?.querySelector(".sidebar") as HTMLElement | null;
    const list = folderActions.get(target);
    if (!menu || !sidebar || !list?.length) return;
    closeMenu();
    menu.innerHTML = renderFolderMenu(target, list);
    const box = sidebar.getBoundingClientRect();
    const rect = anchor.getBoundingClientRect();
    const x = point ? point.x : rect.right - 8;
    const y = point ? point.y : rect.bottom;
    menu.style.left = `${Math.max(4, Math.min(x - box.left, box.width - 228))}px`;
    menu.style.top = `${y - box.top + sidebar.scrollTop + 4}px`;
    menu.hidden = false;
    // Unten zu wenig Platz (Tab-Leiste, Fensterrand): Menü über der Zeile öffnen.
    const limit = Math.min(window.innerHeight, (shell?.querySelector(".tabbar") as HTMLElement | null)?.getBoundingClientRect().top || window.innerHeight);
    const height = menu.getBoundingClientRect().height;
    if (y + 4 + height > limit) {
      const above = (point ? point.y : rect.top) - height - 4;
      menu.style.top = `${Math.max(4, above - box.top + sidebar.scrollTop)}px`;
    }
    const more = sidebar.querySelector<HTMLElement>(`.fmore[data-target="${CSS.escape(target)}"]`);
    more?.setAttribute("aria-expanded", "true");
    menuReturn = more || anchor;
    (menu.querySelector("button") as HTMLButtonElement | null)?.focus({ preventScroll: true });
  }

  function paintViewMenu(): void {
    const menu = shell?.querySelector("#view-menu") as HTMLElement | null;
    const button = shell?.querySelector("[data-action='view-menu']") as HTMLElement | null;
    if (!menu || !button) return;
    const sorts = listMode.sortable && !listMode.threadOpen
      ? `<p class="menu-label mono">${esc(t("MESSAGE_LIST.SORT", "Sortieren"))}</p>` + SORTS.map(([value, key, fallback]) =>
        `<button type="button" class="menu-item" role="menuitemradio" aria-checked="${listMode.sort === value ? "true" : "false"}" data-action="sort" data-sort="${esc(value)}">${icon(listMode.sort === value ? "check" : "sort")}<span>${esc(t(key, fallback))}</span></button>`).join("")
      : "";
    const threads = listMode.threadsAvailable
      ? `<button type="button" class="menu-item" role="menuitemcheckbox" aria-checked="${listMode.useThreads ? "true" : "false"}" data-action="threads-toggle">${icon(listMode.useThreads ? "checkbox-checked" : "checkbox")}<span>${esc(t("SETTINGS_GENERAL.USE_THREADS", "Als Unterhaltungen anzeigen"))}</span></button>`
      : "";
    const group = `<button type="button" class="menu-item" role="menuitemcheckbox" aria-checked="${listMode.grouped ? "true" : "false"}" data-action="group-toggle">${icon(listMode.grouped ? "checkbox-checked" : "checkbox")}<span>${esc(t("FOLDERS_UI.GROUP_BY_DATE", "Nach Datum gruppieren"))}</span></button>`;
    menu.innerHTML = sorts + (sorts ? `<hr class="menu-sep">` : "") + `<p class="menu-label mono">${esc(t("FOLDERS_UI.VIEW", "Ansicht"))}</p>` + threads + group;
    button.hidden = false;
  }

  /** Sichtbare Ordnerknöpfe in Reihenfolge, für Pfeiltasten. */
  function folderButtons(): HTMLElement[] {
    return [...(shell?.querySelectorAll<HTMLElement>("#folder-tree .folder:not([disabled])") ?? [])];
  }

  function openAddrMenu(target: HTMLElement): void {
    const menu = shell?.querySelector("#addr-menu") as HTMLElement | null;
    if (!menu || !shell) return;
    closeMenu();
    addrTarget = { email: target.dataset.email || "", name: target.dataset.name || "" };
    const box = shell.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(rect.left - box.left, box.width - 240))}px`;
    menu.style.top = `${rect.bottom - box.top + 4}px`;
    menu.hidden = false;
    menuReturn = target;
    (menu.querySelector("button") as HTMLButtonElement | null)?.focus({ preventScroll: true });
  }

  function openLayer(layer: HTMLElement, from: HTMLElement | null): void {
    opener = from;
    layer.hidden = false;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      layer.dataset.instant = "1";
      layer.dataset.open = "true";
      return;
    }
    delete layer.dataset.instant;
    layer.dataset.open = "false";
    requestAnimationFrame(() => { layer.dataset.open = "true"; });
  }

  function closeLayer(layer: HTMLElement): void {
    const back = opener;
    opener = null;
    back?.focus({ preventScroll: true });
    layer.dataset.open = "false";
    let settled = false;
    const finish = (event?: TransitionEvent) => {
      if (settled) return;
      if (event && (event.target !== layer || event.propertyName !== "transform")) return;
      settled = true;
      window.clearTimeout(timer);
      layer.removeEventListener("transitionend", finish);
      layer.hidden = true;
    };
    const timer = window.setTimeout(() => finish(), 320);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) finish();
    else layer.addEventListener("transitionend", finish);
  }

  function toggleFullscreen(force?: boolean): void {
    if (!shell) return;
    const on = force ?? shell.dataset.full !== "true";
    shell.dataset.full = on ? "true" : "false";
    const button = shell.querySelector("[data-action='m-fullscreen']") as HTMLElement | null;
    if (button) button.innerHTML = `${icon(on ? "fullscreen-exit" : "fullscreen")}<span>${on ? "Vollbild beenden" : "Vollbild"}</span>`;
    if (on && !wide()) pane("reader");
  }

  function wireShell(): void {
    if (!shell) return;
    const menu = shell.querySelector("#account-menu") as HTMLElement;
    const accountBtn = shell.querySelector("[data-action='account']") as HTMLButtonElement;
    const list = shell.querySelector(".list-pane") as HTMLElement;
    const separator = shell.querySelector(".splitter") as HTMLElement;
    const reader = shell.querySelector(".reader") as HTMLElement;
    new ResizeObserver(() => paintBar(lastReader)).observe(reader);

    const setListWidth = (px: number) => {
      const next = Math.min(640, Math.max(288, Math.round(px)));
      shell?.style.setProperty("--list-w", `${next}px`);
      separator.setAttribute("aria-valuenow", String(next));
    };

    const closeDialogWithAnimation = (dlg: HTMLDialogElement | null, returnValue?: string) => {
      if (!dlg || !dlg.open) return;
      dlg.classList.add("closing");
      window.setTimeout(() => {
        dlg.classList.remove("closing");
        try { dlg.close(returnValue); } catch {}
      }, 120);
    };

    shell.addEventListener("click", (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action], [data-folder], [data-uid]");
      if (!target?.closest("#book-menu, #book-add, [data-op='more'], [data-op='add-menu']")) {
        shell?.querySelectorAll<HTMLElement>("#book-menu, #book-add").forEach((menu) => { menu.hidden = true; });
        shell?.querySelectorAll<HTMLElement>("[data-op='more'], [data-op='add-menu']").forEach((button) => button.setAttribute("aria-expanded", "false"));
      }
      if (anyMenuOpen() && !target?.closest(".account, .bar-more, #addr-menu")) closeMenu();
      if (!target) return;
      const action = target.dataset.action;
      if (target.classList.contains("menu-item") && target.closest("#more-menu")) closeMenu();
      if (target.dataset.folder && !action) {
        void (async () => {
          if (!(await closeBook())) return;
          actions.selectFolder(target.dataset.folder || "");
          if (!wide()) pane("list");
          if (!docked()) setSidebar(false);
        })();
      } else if (target.dataset.uid) {
        const mouse = event as MouseEvent;
        if (mouse.shiftKey || mouse.ctrlKey || mouse.metaKey) {
          event.preventDefault();
          actions.act("select", { uid: target.dataset.uid, mode: mouse.shiftKey ? "range" : "toggle" });
          return;
        }
        actions.selectMessage(Number(target.dataset.uid));
        if (!wide()) pane("reader");
      } else if (action === "toggle-sidebar") {
        if (!wide()) pane("folders");
        else setSidebar(shell?.dataset.sidebar !== "open");
      } else if (action === "close-sidebar") setSidebar(false);
      else if (action === "account") {
        const open = menu.hidden;
        closeMenu();
        menu.hidden = !open;
        accountBtn.setAttribute("aria-expanded", open ? "true" : "false");
        if (open) actions.act("accounts", {});
      } else if (action === "m-more") {
        const more = shell?.querySelector("#more-menu") as HTMLElement;
        const open = more.hidden;
        closeMenu();
        more.hidden = !open;
        target.setAttribute("aria-expanded", open ? "true" : "false");
        menuReturn = target;
        if (open) (more.querySelector(".menu-item:not([hidden])") as HTMLElement | null)?.focus({ preventScroll: true });
      } else if (action === "f-toggle") {
        actions.act("f-toggle", { target: target.dataset.target || "" });
      } else if (action === "f-menu") {
        const open = target.getAttribute("aria-expanded") === "true";
        if (open) closeMenu();
        else openFolderMenu(target.dataset.target || "", target);
      } else if (action === "f-settings") {
        closeMenu();
        openFolderSettings(target.dataset.target || "");
      } else if (action?.startsWith("f-")) {
        if (target.closest(".menu")) closeMenu();
        const data: Record<string, string> = {};
        Object.entries(target.dataset).forEach(([key, value]) => { if (value != null) data[key] = value; });
        actions.act(action, data);
      } else if (action === "view-menu") {
        const menuEl = shell?.querySelector("#view-menu") as HTMLElement;
        const open = menuEl.hidden;
        closeMenu();
        if (open) {
          paintViewMenu();
          menuEl.hidden = false;
          target.setAttribute("aria-expanded", "true");
          menuReturn = target;
          (menuEl.querySelector(".menu-item") as HTMLElement | null)?.focus({ preventScroll: true });
        }
      } else if (action === "select-menu") {
        const menuEl = shell?.querySelector("#select-menu") as HTMLElement | null;
        if (!menuEl) return;
        const open = menuEl.hidden;
        closeMenu();
        if (open) {
          menuEl.hidden = false;
          target.setAttribute("aria-expanded", "true");
          menuReturn = target;
          (menuEl.querySelector(".menu-item") as HTMLElement | null)?.focus({ preventScroll: true });
        }
      } else if (action === "select-filter") {
        closeMenu();
        actions.act("select-filter", { filter: target.dataset.filter || "all" });
      } else if (action === "sort" || action === "threads-toggle" || action === "group-toggle") {
        closeMenu();
        (shell?.querySelector("[data-action='view-menu']") as HTMLElement | null)?.focus({ preventScroll: true });
        actions.act(action, { sort: target.dataset.sort || "" });
      } else if (action === "quick") {
        actions.act("quick", { flag: target.dataset.flag || "", query: (shell?.querySelector("#search") as HTMLInputElement).value.trim() });
      } else if (action === "adv-search") {
        actions.act("adv-search", { query: (shell?.querySelector("#search") as HTMLInputElement).value.trim() });
      } else if (action === "adv-reset") {
        const form = target.closest("form") as HTMLFormElement | null;
        form?.reset();
        form?.querySelectorAll<HTMLInputElement>("input").forEach((field) => { if (field.type === "checkbox") field.checked = false; else field.value = ""; });
        form?.querySelectorAll<HTMLSelectElement>("select").forEach((field) => { field.selectedIndex = 0; });
      } else if (action === "thread-back") {
        actions.act("thread-back", {});
      } else if (action === "m-address") {
        openAddrMenu(target);
      } else if (action === "m-addr-write" || action === "m-addr-copy" || action === "m-addr-search" || action === "m-addr-contact") {
        closeMenu();
        actions.act(action.slice(2), addrTarget);
      } else if (action === "m-check") {
        event.stopPropagation();
        const mouse = event as MouseEvent;
        actions.act("select", { uid: target.dataset.ref || "", mode: mouse.shiftKey ? "range" : "toggle" });
      } else if (action === "m-details") {
        expanded = !expanded;
        const body = shell?.querySelector("#reader-body") as HTMLElement | null;
        if (body && lastReader) {
          const top = body.scrollTop;
          paintReaderDetails(body, lastReader, expanded);
          body.scrollTop = top;
          (body.querySelector("[data-action='m-details']") as HTMLElement | null)?.focus({ preventScroll: true });
        }
      } else if (action === "m-files-toggle") {
        filesExpanded = !filesExpanded;
        const body = shell?.querySelector("#reader-body") as HTMLElement | null;
        if (body) {
          paintReaderFiles(body, filesExpanded);
          (body.querySelector("[data-action='m-files-toggle']") as HTMLElement | null)?.focus({ preventScroll: true });
        }
      } else if (action === "m-bulk-pane") {
        if (!wide()) pane("reader");
      } else if (action === "m-fullscreen") {
        closeMenu();
        toggleFullscreen();
      } else if (action?.startsWith("m-")) {
        if (target.closest(".menu")) closeMenu();
        const data: Record<string, string> = {};
        Object.entries(target.dataset).forEach(([key, value]) => { if (value != null) data[key] = value; });
        actions.act(action.slice(2), data);
      } else if (action === "settings") {
        closeMenu();
        section = "look";
        edit = null;
        paintSettings();
        (shell?.querySelector("#settings") as HTMLDialogElement).showModal();
        void actions.settings?.("open", {});
        actions.act("f-desk", {});
      } else if (action === "preview-sound") {
        const name = (shell?.querySelector("[data-pref='NotificationSound']") as HTMLSelectElement | null)?.value || "new-mail";
        const audio = new Audio(`${location.pathname.replace(/\/+$/, "")}/snappymail/v/0.0.0/static/sounds/${encodeURIComponent(name)}.mp3`);
        void audio.play().catch(() => undefined);
      } else if (action === "assist-revoke") {
        const box = shell?.querySelector<HTMLInputElement>("input[name='notice_ack']");
        if (box) box.checked = false;
        void actions.settings?.("assist-save", { notice_ack: "" });
      } else if (action === "rule-add" || action === "cond-add" || action === "act-add" || action === "rule-remove" || action === "cond-remove" || action === "act-remove") {
        editFilterDom(target, action);
      } else if (action === "script-mode") {
        toggleScriptMode(target);
      } else if (action === "settings-move") {
        const list = target.dataset.list || "";
        if (list === "rules") {
          const card = target.closest<HTMLElement>("[data-rule]");
          if (!card) return;
          const sibling = target.dataset.dir === "down" ? card.nextElementSibling : card.previousElementSibling;
          if (sibling) target.dataset.dir === "down" ? sibling.after(card) : sibling.before(card);
          return;
        }
        const dir = target.dataset.dir === "down" ? 1 : -1;
        const rows = [...(shell?.querySelectorAll<HTMLElement>(list === "accounts" ? "[data-sort='account']" : "[data-sort='identity']") || [])];
        const key = list === "accounts" ? "email" : "id";
        const order = rows.map((row) => row.dataset[key] || "").filter(Boolean);
        const index = order.indexOf(target.dataset[key] || "");
        const next = index + dir;
        if (index < 0 || next < 0 || next >= order.length) return;
        const swap = order[index];
        order[index] = order[next];
        order[next] = swap;
        void actions.settings?.(list === "accounts" ? "sort-accounts" : "sort-identities", { order: order.join(",") });
      } else if (action === "settings-export") {
        void actions.settings?.("export-key", { index: target.dataset.index || "" });
      } else if (action === "settings-import") {
        void actions.settings?.("import-account", { email: target.dataset.email || "" });
      } else if (action === "mailto-register") {
        try {
          const url = `${location.origin}${location.pathname.replace(/\/+$/, "")}/?/Mailto/&q[]=/0/?to=%s`;
          navigator.registerProtocolHandler("mailto", url);
          const slot = shell?.querySelector<HTMLElement>("#settings-error");
          if (slot) { slot.className = "quiet"; slot.hidden = false; slot.textContent = "Die Registrierung wurde im Browser angefragt."; }
        } catch {
          const slot = shell?.querySelector<HTMLElement>("#settings-error");
          if (slot) { slot.className = "error"; slot.hidden = false; slot.textContent = "Der Browser erlaubt diese Registrierung nicht."; }
        }
      } else if (action === "settings-section") {
        section = target.dataset.section || "look";
        edit = null;
        paintSettings();
        if (section === "folders") actions.act("f-desk", {});
      } else if (action === "settings-edit") {
        edit = { kind: target.dataset.kind || "", id: target.dataset.id || "", fresh: target.dataset.fresh === "1" };
        paintSettings();
      } else if (action === "settings-cancel") {
        edit = null;
        paintSettings();
      } else if (action === "settings-delete" || action === "settings-switch" || action === "settings-activate") {
        const name = action === "settings-delete"
          ? `delete-${target.dataset.kind || ""}`
          : action === "settings-switch" ? "switch-account" : "activate-script";
        const payload = {
          id: target.dataset.id || "",
          email: target.dataset.email || "",
          name: target.dataset.name || "",
          secret: target.dataset.secret || "",
          index: target.dataset.index || ""
        };
        void (async () => {
          if (action === "settings-delete") {
            const dialog = shell?.querySelector("#confirm") as HTMLDialogElement | null;
            if (!dialog) return;
            (dialog.querySelector("#confirm-title") as HTMLElement).textContent = "Wirklich löschen?";
            (dialog.querySelector("#confirm-text") as HTMLElement).hidden = true;
            const ok_ = dialog.querySelector("#confirm-ok") as HTMLElement;
            ok_.className = "danger";
            ok_.innerHTML = withIcon("delete", t("GLOBAL.DELETE", "Löschen"));
            (dialog.querySelector("#confirm-alt") as HTMLElement).hidden = true;
            dialog.returnValue = "";
            dialog.showModal();
            const ok = await new Promise<boolean>((resolve) => {
              dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok"), { once: true });
            });
            if (!ok) return;
          }
          await actions.settings?.(name, payload);
        })();
      } else if (action === "logout") actions.logout();
      else if (action === "close-dialog") closeDialogWithAnimation(target.closest("dialog"));
      else if (action === "search") { /* form */ }
      else if (action === "drop-criterion") {
        const input = shell?.querySelector("#search") as HTMLInputElement | null;
        if (!input) return;
        const params = new URLSearchParams(input.value);
        params.delete(target.dataset.key || "");
        input.value = params.toString();
        actions.search(input.value);
      }
      else if (action === "clear-search") {
        (shell?.querySelector("#search") as HTMLInputElement).value = "";
        actions.clearSearch();
      }
      else if (action === "more") actions.more();
      else if (action === "back") pane("list");
      else if (action === "pane-folders") pane("folders");
      else if (action === "pane-search") {
        pane("list");
        const field = shell?.dataset.surface === "contacts" ? "#book-q" : "#search";
        shell?.querySelector<HTMLElement>(field)?.focus({ preventScroll: true });
      } else if (action === "test-sync" || action === "sync-now") {
        const form = shell?.querySelector<HTMLFormElement>("form[data-kind='save-sync']");
        if (!form) return;
        const data: Record<string, string> = {};
        new FormData(form).forEach((value, key) => { data[key] = String(value); });
        void actions.settings?.(action, data);
      } else if (action === "open-book") {
        closeMenu();
        void openBook();
      } else if (action === "close-book") {
        void closeBook();
      } else if (action === "book") {
        const data: Record<string, string> = {};
        Object.entries(target.dataset).forEach(([key, value]) => { if (value != null) data[key] = value; });
        void book?.onAction(data.op || "", target, event);
      } else if (action === "compose") actions.compose();
      else if (action === "reply") actions.reply(false);
      else if (action === "reply-all") actions.reply(true);
      else if (action === "forward") actions.forward();
      else if (action === "archive") actions.archive();
      else if (action === "unread") actions.unread();
      else if (action === "delete") actions.askDelete();
      else if (action === "close-sheet") {
        const sheet = shell?.querySelector(".sheet") as HTMLElement | null;
        if (sheet) closeLayer(sheet);
      } else if (action === "open-sheet") {
        if (!wide()) pane("reader");
        const sheet = shell?.querySelector(".sheet") as HTMLElement | null;
        if (sheet) openLayer(sheet, target);
      } else if (action === "cat") {
        shell?.querySelectorAll<HTMLButtonElement>(".filter").forEach((button) => {
          button.setAttribute("aria-pressed", button.dataset.cat === target.dataset.cat ? "true" : "false");
        });
        actions.assist?.("cat", target.dataset);
      } else if (action === "mode" || action === "tone") {
        target.parentElement?.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
          button.setAttribute("aria-pressed", button === target ? "true" : "false");
        });
      } else if (action === "prompt") {
        const area = shell?.querySelector("#ask") as HTMLTextAreaElement | null;
        if (area) area.value = target.textContent || "";
        actions.assist?.("ask", { text: target.textContent || "" });
      } else if (action) actions.assist?.(action, target.dataset);
    });

    shell.addEventListener("dblclick", (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>("[data-uid]");
      if (!target || !target.dataset.uid) return;
      if (lastReader?.place.inDrafts || shell?.querySelector(".folder[aria-current='page']")?.getAttribute("data-role") === "drafts") {
        event.preventDefault();
        actions.act("edit-draft", { uid: target.dataset.uid });
      }
    });

    shell.addEventListener("submit", (event) => {
      const form = event.target as HTMLFormElement;
      if (form.classList.contains("composer-form")) return;
      if (form.dataset.action === "adv-search-form") {
        event.preventDefault();
        const query = serializeSearch(readSearchForm(form), form.dataset.multisearch === "1");
        (shell?.querySelector("#search") as HTMLInputElement).value = query;
        (form.closest("dialog") as HTMLDialogElement).close();
        actions.search(query);
        return;
      }
      if (form.dataset.action === "folder-dlg-form") return;
      if (form.dataset.action === "book-search") {
        event.preventDefault();
        return;
      }
      if (form.dataset.action === "search") {
        event.preventDefault();
        actions.search((form.querySelector("#search") as HTMLInputElement).value.trim());
      } else if (form.dataset.action === "ask") {
        event.preventDefault();
        const area = form.querySelector("textarea") as HTMLTextAreaElement;
        actions.assist?.("ask", { text: area.value });
      } else if (form.dataset.action === "settings-form") {
        event.preventDefault();
        const data: Record<string, string> = {};
        new FormData(form).forEach((value, key) => { data[key] = String(value); });
        form.querySelectorAll<HTMLInputElement>("input[type='checkbox']").forEach((box) => {
          if (box.name) data[box.name] = box.checked ? "1" : "";
        });
        if (form.dataset.kind === "save-script") {
          try {
            const capa = (form.querySelector("[data-sieve-capa]")?.getAttribute("data-sieve-capa") || "").split(" ").filter(Boolean);
            data.body = compileFilterForm(form, capa);
          } catch (error) {
            const slot = shell?.querySelector<HTMLElement>("#settings-error");
            if (slot) { slot.className = "error"; slot.hidden = false; slot.textContent = error instanceof Error ? error.message : "Das Skript lässt sich nicht speichern."; }
            return;
          }
        }
        void actions.settings?.(form.dataset.kind || "", data);
      }
    });

    // Rechtsklick und Kontextmenü-Taste auf einem Ordner öffnen dasselbe Menü wie der Knopf „Weitere“.
    shell.addEventListener("contextmenu", (event) => {
      const row = (event.target as HTMLElement).closest<HTMLElement>("#folder-tree .frow");
      if (!row) return;
      const name = row.dataset.row || "";
      if (!folderActions.get(name)?.length) return;
      event.preventDefault();
      const mouse = event as MouseEvent;
      const fromKeyboard = mouse.clientX === 0 && mouse.clientY === 0;
      openFolderMenu(name, row, fromKeyboard ? undefined : { x: mouse.clientX, y: mouse.clientY });
    });

    const folderFilter = shell.querySelector("#folder-q") as HTMLInputElement;
    folderFilter.addEventListener("input", () => actions.act("f-filter", { q: folderFilter.value }));

    // Pfeiltasten im Ordnerbaum: hoch/runter wechseln, rechts/links auf- und zuklappen bzw. zum Elternordner.
    shell.querySelector(".sidebar")?.addEventListener("keydown", (raw) => {
      const event = raw as KeyboardEvent;
      const current = (event.target as HTMLElement).closest<HTMLElement>("#folder-tree .folder");
      if (!current) {
        const menuEl = (event.target as HTMLElement).closest("#folder-menu");
        if (menuEl && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
          event.preventDefault();
          const items = [...menuEl.querySelectorAll<HTMLElement>(".menu-item")];
          const index = items.indexOf(event.target as HTMLElement);
          items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus({ preventScroll: true });
        }
        return;
      }
      const buttons = folderButtons();
      const index = buttons.indexOf(current);
      const row = current.closest<HTMLElement>(".frow");
      const name = row?.dataset.row || "";
      const toggle = row?.querySelector<HTMLElement>(".ftoggle[aria-expanded]");
      const go = (next: HTMLElement | undefined) => { if (next) { event.preventDefault(); next.focus({ preventScroll: true }); next.scrollIntoView({ block: "nearest" }); } };
      if (event.key === "ArrowDown") go(buttons[index + 1]);
      else if (event.key === "ArrowUp") go(buttons[index - 1]);
      else if (event.key === "Home") go(buttons[0]);
      else if (event.key === "End") go(buttons[buttons.length - 1]);
      else if (event.key === "ArrowRight") {
        event.preventDefault();
        if (toggle?.getAttribute("aria-expanded") === "false") actions.act("f-toggle", { target: name });
        else if (toggle) go(buttons[index + 1]);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (toggle?.getAttribute("aria-expanded") === "true") actions.act("f-toggle", { target: name });
        else {
          const depth = Number(current.dataset.depth || 0);
          if (depth > 0) go(buttons.slice(0, index).reverse().find((item) => Number(item.dataset.depth || 0) < depth));
        }
      }
    });

    shell.addEventListener("change", (event) => {
      const input = event.target as HTMLInputElement;
      const syncForm = input.closest<HTMLFormElement>("form[data-kind='save-sync']");
      if (syncForm) {
        const data: Record<string, string> = {};
        new FormData(syncForm).forEach((value, key) => { data[key] = String(value); });
        void actions.settings?.("save-sync", data);
        return;
      }
      if (input.name === "appearance") applyAppearance(input.value as Appearance);
      const filterPart = (event.target as HTMLElement).dataset?.part;
      if (filterPart === "field" || filterPart === "type") {
        const row = (event.target as HTMLElement).closest<HTMLElement>(".rule-line");
        if (row) syncFilterRow(row);
      }
      const pref = input.dataset.pref || (event.target as HTMLSelectElement).dataset?.pref;
      if (!pref) return;
      const control = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      let value = "value" in control ? control.value : "";
      if (control instanceof HTMLInputElement && control.type === "checkbox") value = control.checked ? "1" : "0";
      if (pref === "DesktopNotifications" && value === "1" && "Notification" in window && Notification.permission !== "granted") {
        void Notification.requestPermission().then((state) => {
          const slot = shell?.querySelector<HTMLElement>("#settings-error");
          if (state === "denied" && slot) {
            slot.className = "quiet";
            slot.hidden = false;
            slot.textContent = t("SETTINGS_GENERAL.CHROME_NOTIFICATION_DESC_DENIED", "Der Browser hat Hinweise abgelehnt. Die Freigabe liegt in den Browser-Einstellungen.");
          }
        });
      }
      void actions.settings?.("pref", { key: pref, value });
    });
    shell.addEventListener("dragstart", (event) => {
      const row = (event.target as HTMLElement).closest<HTMLElement>("[data-sort]");
      if (!row || !event.dataTransfer) return;
      if (row.dataset.sort === "rule") {
        row.classList.add("dragging-rule");
        event.dataTransfer.setData("application/x-sm-sort", "rule");
        event.dataTransfer.effectAllowed = "move";
        return;
      }
      event.dataTransfer.setData("application/x-sm-sort", `${row.dataset.sort}:${row.dataset.email || row.dataset.id || ""}`);
      event.dataTransfer.effectAllowed = "move";
    });
    shell.addEventListener("dragover", (event) => {
      const row = (event.target as HTMLElement).closest<HTMLElement>("[data-sort]");
      if (!row || !event.dataTransfer?.types.includes("application/x-sm-sort")) return;
      event.preventDefault();
    });
    shell.addEventListener("drop", (event) => {
      const row = (event.target as HTMLElement).closest<HTMLElement>("[data-sort]");
      const raw = event.dataTransfer?.getData("application/x-sm-sort") || "";
      if (!row || !raw) return;
      event.preventDefault();
      if (raw === "rule" && row.dataset.sort === "rule") {
        const from = shell?.querySelector<HTMLElement>(".dragging-rule");
        if (from && from !== row) {
          const nodes = [...(row.parentElement?.children || [])];
          if (nodes.indexOf(from) < nodes.indexOf(row)) row.after(from);
          else row.before(from);
        }
        return;
      }
      const [kind, id] = raw.split(":");
      if (row.dataset.sort !== kind || !id) return;
      const rows = [...(shell?.querySelectorAll<HTMLElement>(`[data-sort='${kind}']`) || [])];
      const order = rows.map((item) => (kind === "account" ? item.dataset.email : item.dataset.id) || "").filter(Boolean);
      const from = order.indexOf(id);
      const to = order.indexOf((kind === "account" ? row.dataset.email : row.dataset.id) || "");
      if (from < 0 || to < 0 || from === to) return;
      order.splice(from, 1);
      order.splice(to, 0, id);
      void actions.settings?.(kind === "account" ? "sort-accounts" : "sort-identities", { order: order.join(",") });
    });
    shell.addEventListener("dragend", () => shell?.querySelector(".dragging-rule")?.classList.remove("dragging-rule"));

    function editFilterDom(target: HTMLElement, action: string): void {
      const form = target.closest("form");
      if (!form) return;
      if (action === "rule-remove") { target.closest("[data-rule]")?.remove(); return; }
      if (action === "cond-remove") { target.closest("[data-cond]")?.remove(); return; }
      if (action === "act-remove") { target.closest("[data-act]")?.remove(); return; }
      const kind = action === "rule-add" ? "rule" : action === "cond-add" ? "cond" : "act";
      const template = form.querySelector<HTMLTemplateElement>(`[data-${kind}-template]`);
      const host = action === "rule-add" ? form.querySelector("[data-rule-list]")
        : target.closest("[data-rule]")?.querySelector(kind === "cond" ? ".conds" : ".acts");
      if (!template || !host) return;
      host.append(template.content.cloneNode(true));
      form.querySelector("[data-rule-empty]")?.remove();
      const added = host.lastElementChild as HTMLElement | null;
      added?.querySelectorAll<HTMLElement>(".rule-line").forEach((row) => syncFilterRow(row));
    }

    function toggleScriptMode(target: HTMLElement): void {
      const form = target.closest("form");
      if (!form) return;
      const rawBox = form.querySelector<HTMLInputElement>("[data-part='use-raw']");
      const rawPane = form.querySelector<HTMLElement>("[data-editor='raw']");
      const formPane = form.querySelector<HTMLElement>("[data-editor='form']");
      const area = form.querySelector<HTMLTextAreaElement>("textarea[name='body']");
      const slot = shell?.querySelector<HTMLElement>("#settings-error");
      const label = target.querySelector(".btn-label");
      const capa = (form.querySelector("[data-sieve-capa]")?.getAttribute("data-sieve-capa") || "").split(" ").filter(Boolean);
      const fail = (text: string) => { if (slot) { slot.className = "error"; slot.hidden = false; slot.textContent = text; } };
      if (!rawBox?.checked) {
        try {
          if (area) area.value = compileFilterForm(form, capa);
          rawBox && (rawBox.checked = true);
          if (rawPane) rawPane.hidden = false;
          if (formPane) formPane.hidden = true;
          if (label) label.textContent = t("SETTINGS_FILTERS.SHOW_RULES", "Als Regeln zeigen");
          if (slot) slot.hidden = true;
        } catch (error) {
          fail(error instanceof Error ? error.message : "Das Skript lässt sich nicht zeigen.");
        }
        return;
      }
      const parsed = parseFilterScript(area?.value || "");
      if (!parsed.ok) { fail(parsed.reason); return; }
      const list = form.querySelector("[data-rule-list]");
      if (list) list.innerHTML = parsed.script.rules.map((rule) => ruleCard(rule, [])).join("");
      const vacation = parsed.script.vacation;
      const set = (part: string, value: string) => {
        const node = form.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-part='${part}']`);
        if (node) node.value = value;
      };
      const on = form.querySelector<HTMLInputElement>("[data-part='vacation-on']");
      if (on) on.checked = Boolean(vacation?.on);
      set("vacation-from", vacation?.from || "");
      set("vacation-until", vacation?.until || "");
      set("vacation-days", vacation?.days || "7");
      set("vacation-subject", vacation?.subject || "");
      set("vacation-addresses", vacation?.addresses || "");
      set("vacation-text", vacation?.text || "");
      rawBox.checked = false;
      if (rawPane) rawPane.hidden = true;
      if (formPane) formPane.hidden = false;
      if (label) label.textContent = t("SETTINGS_FILTERS.EDIT_SCRIPT", "Skript bearbeiten");
      if (slot) slot.hidden = true;
      if (!parsed.script.rules.length && !list?.childElementCount) list?.insertAdjacentHTML("beforebegin", "");
    }

    if (keyHandler) document.removeEventListener("keydown", keyHandler);
    keyHandler = (event: KeyboardEvent) => {
      if (!shell?.isConnected || event.defaultPrevented) return;
      const typing = (event.target instanceof HTMLInputElement && !["checkbox", "radio", "button"].includes(event.target.type))
        || event.target instanceof HTMLTextAreaElement
        || event.target instanceof HTMLSelectElement
        || (event.target instanceof HTMLElement && event.target.isContentEditable);
      if (event.key === "Escape") {
        if (shell?.querySelector("dialog[open]")) return;
        if (anyMenuOpen()) {
          const back = menuReturn;
          closeMenu();
          menuReturn = null;
          back?.focus({ preventScroll: true });
          return;
        }
        if (shell?.dataset.full === "true") { toggleFullscreen(false); return; }
        if (!docked() && shell?.dataset.sidebar === "open") { setSidebar(false); return; }
        const selHead = shell?.querySelector("#selection-head:not([hidden])");
        if (selHead) {
          event.preventDefault();
          actions.act("clear-selection", {});
          return;
        }
        const bookMenu = shell.querySelector<HTMLElement>("#book-menu:not([hidden]), #book-add:not([hidden])");
        if (bookMenu) {
          bookMenu.hidden = true;
          const opener = shell.querySelector<HTMLElement>(bookMenu.id === "book-add" ? "[data-op='add-menu']" : "[data-op='more']");
          opener?.setAttribute("aria-expanded", "false");
          opener?.focus({ preventScroll: true });
          return;
        }
        const searchField = document.activeElement;
        if (searchField instanceof HTMLInputElement && searchField.id === "search" && searchField.value) {
          event.preventDefault();
          searchField.value = "";
          const status = shell.querySelector("#list-status");
          if (status) status.textContent = "Suche gelöscht";
          actions.clearSearch();
          return;
        }
        if (shell.dataset.surface === "contacts") {
          if (!wide() && shell.dataset.pane === "reader") { pane("list"); return; }
          void closeBook();
          return;
        }
        if (!typing && listMode.threadOpen) actions.act("thread-back", {});
        return;
      }
      if (typing || shell.querySelector("dialog[open]")) return;
      const focusedControl = event.target instanceof HTMLButtonElement && !event.target.dataset.uid;
      if (focusedControl && (event.key === "Enter" || event.key === " ")) return;
      if (shell.dataset.surface === "contacts" && event.key !== "\\" && event.key !== "?") {
        book?.onKey(event);
        return;
      }
      const key = event.key.toLowerCase();
      if (event.key === "\\") {
        event.preventDefault();
        if (!wide()) pane(shell?.dataset.pane === "folders" ? "list" : "folders");
        else setSidebar(shell?.dataset.sidebar !== "open");
      } else if (event.key === "?") {
        event.preventDefault();
        (shell?.querySelector("#keys") as HTMLDialogElement).showModal();
      } else if (event.key === "." && (event.ctrlKey || event.metaKey) && shell?.querySelector(".sheet")) {
        event.preventDefault();
        if (!wide()) pane("reader");
        openLayer(shell.querySelector(".sheet") as HTMLElement, null);
      } else if (key === "a" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        actions.act("select-all", {});
      } else if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      } else if (key === "r" && event.shiftKey) actions.act("refresh", {});
      else if (event.key === "Delete" && event.shiftKey) actions.act("delete-forever", {});
      else if (event.key === "Delete" || event.key === "#") actions.askDelete();
      else if (event.key === "*") actions.act("select-all", {});
      else if (key === "c") { event.preventDefault(); composer?.armInstant(); actions.compose(); }
      else if (key === "r") { event.preventDefault(); composer?.armInstant(); actions.reply(false); }
      else if (key === "a") { event.preventDefault(); composer?.armInstant(); actions.reply(true); }
      else if (key === "f") { event.preventDefault(); composer?.armInstant(); actions.forward(); }
      else if (key === "e") actions.archive();
      else if (key === "i") actions.act("flag", {});
      else if (key === "u" && event.shiftKey) actions.markRead();
      else if (key === "u") actions.markUnread();
      else if (key === "v") { event.preventDefault(); toggleFullscreen(); }
      else if (key === "q") { event.preventDefault(); actions.quotes(); }
      else if (event.key === "," && shell.querySelector(".composer:not([hidden])")) { event.preventDefault(); composer?.minimize(); }
      else if (key === "1" || key === "2" || key === "3") {
        event.preventDefault();
        const target = key === "1" ? "folders" : key === "2" ? "list" : "reader";
        if (!wide() || key === "1") pane(target === "folders" ? "folders" : target === "reader" ? "reader" : "list");
        const focus = shell.querySelector<HTMLElement>(key === "1" ? ".sidebar button" : key === "2" ? "[data-uid]" : ".reader button");
        focus?.focus({ preventScroll: true });
      }
      else if (key === "m") { event.preventDefault(); actions.act("move", {}); }
      else if (key === "t") { event.preventDefault(); actions.act("thread", {}); }
      else if (key === "j" || key === "k" || event.key === "Enter") {
        if (event.key === "Enter" && (lastReader?.place.inDrafts || shell.querySelector(".folder[aria-current='page']")?.getAttribute("data-role") === "drafts")) {
          const focused = document.activeElement?.closest<HTMLElement>("[data-uid]");
          if (focused?.dataset.uid) {
            event.preventDefault();
            actions.act("edit-draft", { uid: focused.dataset.uid });
            return;
          }
        }
        event.preventDefault();
        moveSelection(key === "k" ? -1 : key === "j" ? 1 : 0);
      }
    };
    document.addEventListener("keydown", keyHandler);

    // Ziehen und Ablegen: Zeilen auf Ordner. Mit Strg/Alt wird kopiert. Tastaturweg bleibt „Verschieben“ (M).
    shell.addEventListener("dragstart", (event) => {
      const row = (event.target as HTMLElement).closest<HTMLElement>("[data-uid]");
      if (!row || !event.dataTransfer) return;
      event.dataTransfer.setData("application/x-sm-uid", row.dataset.uid || "");
      event.dataTransfer.effectAllowed = "copyMove";
      shell?.classList.add("dragging");
    });
    shell.addEventListener("dragend", () => {
      shell?.classList.remove("dragging");
      shell?.querySelectorAll(".folder.drop").forEach((node) => node.classList.remove("drop"));
    });
    shell.addEventListener("dragover", (event) => {
      const folder = (event.target as HTMLElement).closest<HTMLElement>(".folder[data-folder]");
      if (!folder || !event.dataTransfer?.types.includes("application/x-sm-uid")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = event.ctrlKey || event.altKey ? "copy" : "move";
      shell?.querySelectorAll(".folder.drop").forEach((node) => { if (node !== folder) node.classList.remove("drop"); });
      folder.classList.add("drop");
    });
    shell.addEventListener("dragleave", (event) => {
      const folder = (event.target as HTMLElement).closest<HTMLElement>(".folder[data-folder]");
      if (folder && !folder.contains(event.relatedTarget as Node | null)) folder.classList.remove("drop");
    });
    shell.addEventListener("drop", (event) => {
      const folder = (event.target as HTMLElement).closest<HTMLElement>(".folder[data-folder]");
      const uid = event.dataTransfer?.getData("application/x-sm-uid");
      if (!folder || !uid) return;
      event.preventDefault();
      folder.classList.remove("drop");
      actions.act("drop", { uid, folder: folder.dataset.folder || "", copy: event.ctrlKey || event.altKey ? "1" : "" });
    });

    separator.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      separator.setPointerCapture(event.pointerId);
      separator.classList.add("dragging");
      const startX = event.clientX;
      const startW = list.getBoundingClientRect().width;
      const move = (ev: PointerEvent) => setListWidth(startW + ev.clientX - startX);
      const up = () => {
        separator.classList.remove("dragging");
        separator.removeEventListener("pointermove", move);
        separator.removeEventListener("pointerup", up);
        separator.removeEventListener("pointercancel", up);
      };
      separator.addEventListener("pointermove", move);
      separator.addEventListener("pointerup", up);
      separator.addEventListener("pointercancel", up);
    });
    separator.addEventListener("keydown", (event) => {
      if (event.key === "Home") {
        event.preventDefault();
        setListWidth(288);
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        setListWidth(640);
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const delta = event.key === "ArrowRight" ? 16 : -16;
      setListWidth(list.getBoundingClientRect().width + delta);
    });

    const confirm = shell.querySelector("#confirm") as HTMLDialogElement;
    confirm.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest("button");
      if (button) closeDialogWithAnimation(confirm, button.value);
    });

    shell.querySelectorAll("dialog").forEach((dlg) => {
      dlg.addEventListener("cancel", (e) => {
        e.preventDefault();
        closeDialogWithAnimation(dlg);
      });
      dlg.addEventListener("click", (e) => {
        if (e.target === dlg) closeDialogWithAnimation(dlg);
      });
    });

    // Emil Kowalski instant micro-tooltips with skip-delay choreography
    let tooltipEl: HTMLElement | null = null;
    let tooltipTimer = 0;
    let lastTooltipTime = 0;
    let currentTooltipTarget: HTMLElement | null = null;

    const hideTooltip = () => {
      window.clearTimeout(tooltipTimer);
      if (tooltipEl) {
        tooltipEl.remove();
        tooltipEl = null;
      }
    };

    const showTooltip = (target: HTMLElement, text: string) => {
      hideTooltip();
      const warm = Date.now() - lastTooltipTime < 400;
      const delay = warm ? 0 : 250;
      tooltipTimer = window.setTimeout(() => {
        if (!target.isConnected || currentTooltipTarget !== target) return;
        const rect = target.getBoundingClientRect();
        tooltipEl = document.createElement("div");
        tooltipEl.className = "sm-tooltip";
        if (warm) tooltipEl.dataset.instant = "true";
        tooltipEl.textContent = text;
        tooltipEl.style.top = "-9999px";
        tooltipEl.style.left = "-9999px";
        document.body.append(tooltipEl);
        const tipRect = tooltipEl.getBoundingClientRect();
        let top = Math.round(rect.bottom + 6);
        if (top + tipRect.height > window.innerHeight - 8) {
          top = Math.round(Math.max(8, rect.top - tipRect.height - 6));
        }
        let left = Math.round(rect.left + (rect.width - tipRect.width) / 2);
        left = Math.round(Math.max(8, Math.min(window.innerWidth - tipRect.width - 8, left)));
        tooltipEl.style.top = `${top}px`;
        tooltipEl.style.left = `${left}px`;
        lastTooltipTime = Date.now();
      }, delay);
    };

    shell.addEventListener("pointerover", (event) => {
      if (event.pointerType === "touch") return;
      const target = (event.target as HTMLElement).closest<HTMLElement>("[data-tooltip], [title]");
      if (!target || target.closest(".menu, .editor-tools, .sm-tooltip")) return;
      if (currentTooltipTarget === target) return;
      const text = target.getAttribute("data-tooltip") || target.getAttribute("title");
      if (!text) return;
      if (target.hasAttribute("title")) {
        target.setAttribute("data-tooltip", text);
        target.removeAttribute("title");
      }
      currentTooltipTarget = target;
      showTooltip(target, text);
    });

    shell.addEventListener("pointerout", (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>("[data-tooltip]");
      if (!target) return;
      const related = event.relatedTarget as Node | null;
      if (related && target.contains(related)) return;
      if (currentTooltipTarget === target) {
        currentTooltipTarget = null;
      }
      if (tooltipEl) {
        lastTooltipTime = Date.now();
      }
      hideTooltip();
    });

    shell.addEventListener("pointerdown", () => {
      currentTooltipTarget = null;
      hideTooltip();
    });

    window.addEventListener("scroll", () => {
      currentTooltipTarget = null;
      hideTooltip();
    }, { passive: true, capture: true });

    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        currentTooltipTarget = null;
        hideTooltip();
      }
    });

    window.addEventListener("blur", () => {
      currentTooltipTarget = null;
      hideTooltip();
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

  function chatPrompts(): string[] {
    return [
      t("AI_COPILOT.PROMPT_WAITING", "Welche Mails warten auf meine Antwort?"),
      t("AI_COPILOT.PROMPT_INVOICES", "Zeig mir Rechnungen vom letzten Monat"),
      t("AI_COPILOT.PROMPT_SUMMARIZE", "Fasse die geöffnete Mail zusammen")
    ];
  }

  /** States an action from validated data, so a mail cannot disguise it through the model's label. */
  function actionSummary(payload: Record<string, unknown>): string {
    const facts = actionFacts(payload);
    const names: Record<string, string> = {
      archive: t("AI_COPILOT.ACTION_ARCHIVE", "Archivieren"),
      delete: t("AI_COPILOT.ACTION_DELETE", "Löschen"),
      mark_read: t("AI_COPILOT.ACTION_MARK_READ", "Als gelesen markieren"),
      mark_unread: t("AI_COPILOT.ACTION_MARK_UNREAD", "Als ungelesen markieren"),
      flag: t("AI_COPILOT.ACTION_FLAG", "Markieren"),
      unflag: t("AI_COPILOT.ACTION_UNFLAG", "Markierung entfernen"),
      move: t("AI_COPILOT.ACTION_MOVE", "Verschieben"),
      open: t("AI_COPILOT.ACTION_OPEN", "Öffnen"),
      reply: t("AI_COPILOT.ACTION_REPLY", "Antworten"),
      compose: t("AI_COPILOT.ACTION_COMPOSE", "Neue Mail"),
      search: t("AI_COPILOT.ACTION_SEARCH", "Suchen")
    };
    const parts = [names[facts.type] || facts.type];
    if (facts.count) parts.push(facts.count === 1 ? t("AI_COPILOT.ONE_MAIL", "1 Mail") : t("AI_COPILOT.MANY_MAILS", "%COUNT% Mails").replace("%COUNT%", String(facts.count)));
    if (facts.folder) parts.push(facts.type === "move" && facts.to ? `${facts.folder} → ${facts.to}` : facts.folder);
    if (facts.type === "compose" && facts.to) parts.push(facts.to);
    if (facts.type === "search" && facts.search) parts.push(facts.search);
    return parts.join(" · ");
  }

  /** Every opened composer starts the assistant from its own context, not the previous one. */
  function presetDraftTools(seed: ComposeSeed): void {
    const tools = shell?.querySelector(".draft-tools");
    if (!tools) return;
    const press = (name: "mode" | "tone", value: string) => {
      const buttons = [...tools.querySelectorAll<HTMLButtonElement>(`[data-${name}]`)];
      const wanted = buttons.find((button) => button.dataset[name] === value) || buttons[0];
      buttons.forEach((button) => button.setAttribute("aria-pressed", button === wanted ? "true" : "false"));
    };
    press("mode", draftModeFor(seed));
    press("tone", assistTone);
    (tools.querySelector("#instruction") as HTMLInputElement).value = seed.instruction || "";
    (tools.querySelector("#subject-hint") as HTMLElement).hidden = true;
    (tools.querySelector("[data-action='revert-draft']") as HTMLElement).hidden = true;
    (tools.querySelector("#draft-status") as HTMLElement).textContent = "";
  }

  function installAssist(flags: AssistFlags): void {
    assistTone = flags.tone;
    shell?.querySelectorAll("[data-assist-node]").forEach((node) => node.remove());
    if (!shell) return;
    if (flags.alerts) {
      const block = document.createElement("div");
      const deadlineLabel = t("AI_COPILOT.CHECK_DUE", "Fristen mit KI auslesen");
      const deadlineHint = t("AI_COPILOT.CHECK_DUE_HINT", "Fristen und Fälligkeiten mit KI aus den Mails lesen");
      block.innerHTML = `
        <p class="group-label mono">${esc(t("AI_COPILOT.ALERTS_TODAY", "Heute"))}</p>
        <button type="button" class="count-row" data-action="alert" data-kind="reply"><span>${esc(t("AI_COPILOT.ALERT_REPLY", "Offene Antworten"))}</span><span class="count" data-count="reply">0</span></button>
        <button type="button" class="count-row" data-action="alert" data-kind="follow"><span>${esc(t("AI_COPILOT.ALERT_FOLLOW", "Ohne Antwort"))}</span><span class="count" data-count="follow">0</span></button>
        <button type="button" class="count-row" data-action="alert" data-kind="invoice"><span>${esc(t("AI_COPILOT.ALERT_INVOICE", "Rechnungen"))}</span><span class="count" data-count="invoice">0</span></button>
        <div class="dues" id="dues"></div>
        <button type="button" class="text-btn ai-action" data-action="deadlines" aria-label="${esc(deadlineHint)}" title="${esc(deadlineHint)}">${withAssist(deadlineLabel)}</button>`;
      shell.querySelector(".account")?.after(block);
    }
    const searchForm = shell.querySelector(".search-wrap");
    if (flags.triage && flags.tabs && searchForm) {
      const filters = document.createElement("div");
      filters.className = "filters";
      filters.setAttribute("role", "toolbar");
      filters.setAttribute("aria-label", "Filter");
      const cats = [["all", "Alle"], ...Object.entries(CATEGORY)] as [string, string][];
      const triageHint = t("AI_COPILOT.TRIAGE_LLM_HINT", "Mails dieser Seite mit KI einordnen");
      filters.innerHTML = cats.map(([id, label], index) =>
        `<button type="button" class="filter" data-action="cat" data-cat="${id}" aria-pressed="${index === 0 ? "true" : "false"}">${esc(id === "all" ? t("AI_COPILOT.TAB_ALL", label) : t("AI_COPILOT.CAT_" + id.toUpperCase(), label))}</button>`
      ).join("") + (flags.triageLlm ? `<button type="button" class="text-btn ai-action" data-action="triage" aria-label="${esc(triageHint)}" title="${esc(triageHint)}">${withAssist(t("AI_COPILOT.TRIAGE_LLM", "Mit KI einordnen"))}</button>` : "");
      searchForm.after(filters);
    }
    if (flags.search && searchForm) {
      const button = document.createElement("button");
      const searchHint = t("AI_COPILOT.SEARCH_HINT", "Suchtext als natürliche Sprache mit KI verstehen");
      button.type = "button";
      button.className = "text-btn ai-action";
      button.dataset.action = "lang-search";
      button.hidden = true;
      button.innerHTML = withAssist(t("AI_COPILOT.SEARCH_INTERPRET", "Suchanfrage mit KI interpretieren"));
      button.title = searchHint;
      button.setAttribute("aria-label", searchHint);
      searchForm.append(button);
      const hint = document.createElement("div");
      hint.id = "translated";
      hint.hidden = true;
      hint.className = "translate";
      hint.innerHTML = `<div class="translate-copy"><span class="mono quiet">${esc(t("AI_COPILOT.SEARCH_SUGGESTION", "Vorgeschlagene Suche"))}</span><p class="quiet" id="translate-why"></p></div><input class="search" id="translate-q" aria-label="${esc(t("AI_COPILOT.SEARCH_SUGGESTION", "Vorgeschlagene Suche"))}"><button type="button" class="ink-btn" data-action="run-search">${esc(t("AI_COPILOT.SEARCH_RUN", "Suchen"))}</button>`;
      searchForm.after(hint);
      const input = shell.querySelector("#search") as HTMLInputElement;
      input.addEventListener("input", () => { button.hidden = !input.value.trim(); });
    }
    if (flags.summarize || flags.replies) {
      const strip = document.createElement("section");
      strip.id = "strip";
      strip.className = "assist-strip";
      strip.setAttribute("aria-label", t("AI_COPILOT.PANEL_LABEL", "KI-Unterstützung für diese Mail"));
      strip.setAttribute("aria-live", "polite");
      shell.querySelector("#reader-body")?.before(strip);
    }
    if (flags.chat) {
      const ask = document.createElement("button");
      const askHint = t("AI_COPILOT.ASK_COPILOT_HINT", "Mit KI im Copilot-Chat zu dieser Mail fragen");
      ask.type = "button";
      ask.className = "text-btn assist-trigger ai-action";
      ask.dataset.action = "open-sheet";
      ask.innerHTML = withAssist(t("AI_COPILOT.ASK_COPILOT", "Copilot fragen"));
      ask.classList.add("bar-btn", "primary");
      ask.title = askHint;
      ask.setAttribute("aria-label", askHint);
      shell.querySelector(".reader-bar .bar-assist")?.append(ask);
      const sheet = document.createElement("aside");
      sheet.className = "sheet";
      sheet.hidden = true;
      sheet.setAttribute("aria-labelledby", "copilot-title");
      sheet.innerHTML = `
        <div class="sheet-head">
          <h2 class="title title-md" id="copilot-title">${esc(t("AI_COPILOT.ASK_COPILOT", "Copilot fragen"))}</h2>
          <span class="spacer"></span>
          <button type="button" class="icon-btn" data-action="close-sheet" aria-label="${esc(t("GLOBAL.CLOSE", "Schließen"))}">${icon("close")}</button>
        </div>
        <div class="sheet-meta mono quiet">${esc(flags.provider)}</div>
        <div class="sheet-log" id="chat-log">
          <p class="quiet">${esc(t("AI_COPILOT.CHAT_EMPTY", "Fragen Sie zum Beispiel, welche Mails auf eine Antwort warten."))}</p>
          <div class="prompts">${chatPrompts().map((text) => `<button type="button" class="prompt" data-action="prompt">${esc(text)}</button>`).join("")}</div>
        </div>
        <button type="button" class="text-btn context-chip" data-action="drop-context" id="context-chip" hidden></button>
        <form class="sheet-form" data-action="ask">
          <label class="sr" for="ask">${esc(t("AI_COPILOT.CHAT_PLACEHOLDER", "Nachricht an Copilot …"))}</label>
          <textarea id="ask" rows="2" placeholder="${esc(t("AI_COPILOT.CHAT_PLACEHOLDER", "Nachricht an Copilot …"))}"></textarea>
          <button type="submit" class="ink-btn">${esc(t("AI_COPILOT.SEND", "Senden"))}</button>
          <button type="button" class="text-btn" data-action="stop-chat" hidden>${withIcon("stop", t("AI_COPILOT.STOP", "Stopp"))}</button>
        </form>
        <p class="error sheet-error" id="chat-error" role="alert" hidden></p>`;
      shell.querySelector(".reader")?.append(sheet);
    }
    if (flags.draft) {
      const tools = document.createElement("div");
      tools.className = "draft-tools";
      const modes = [["new", "Neue Mail"], ["reply", "Antwort"], ["rewrite", "Umschreiben"], ["proofread", "Korrektur"]];
      const tones = [["professional", "Professionell"], ["friendly", "Freundlich"], ["casual", "Locker"], ["concise", "Knapp"], ["formal", "Förmlich"]];
      tools.innerHTML = `
        <div class="draft-heading"><span class="mono quiet">${esc(t("AI_COPILOT.DRAFT_ASSIST", "KI-Entwurf"))}</span><span class="quiet">${esc(t("AI_COPILOT.DRAFT_EDIT_HINT", "Sie können das Ergebnis vor dem Senden bearbeiten."))}</span></div>
        <div class="modes" role="toolbar" aria-label="${esc(t("AI_COPILOT.DRAFT_KIND", "Art"))}">
          ${modes.map(([id, label], index) => `<button type="button" class="seg" data-action="mode" data-mode="${id}" aria-pressed="${index === 0 ? "true" : "false"}">${esc(t("AI_COPILOT.MODE_" + id.toUpperCase(), label))}</button>`).join("")}
        </div>
        <label class="field"><span>${esc(t("AI_COPILOT.INSTRUCTION", "Anweisung"))}</span><input id="instruction" type="text" placeholder="${esc(t("AI_COPILOT.INSTRUCTION_PLACEHOLDER", "Was soll die Mail sagen?"))}"></label>
        <div class="tones" role="toolbar" aria-label="${esc(t("AI_COPILOT.DRAFT_TONE", "Ton"))}">
          ${tones.map(([id, label], index) => `<button type="button" class="seg" data-action="tone" data-tone="${id}" aria-pressed="${index === 0 ? "true" : "false"}">${esc(t("AI_COPILOT.TONE_" + id.toUpperCase(), label))}</button>`).join("")}
        </div>
        <div class="draft-actions">
          <button type="button" class="ink-btn ai-action" data-action="generate" title="${esc(t("AI_COPILOT.DRAFT_HINT", "Entwurf mit KI erzeugen"))}">${withAssist(t("AI_COPILOT.GENERATE", "Entwurf mit KI erzeugen"))}</button>
          <button type="button" class="text-btn" data-action="stop-generate" hidden>${withIcon("stop", t("AI_COPILOT.STOP", "Stopp"))}</button>
          <button type="button" class="text-btn" data-action="revert-draft" hidden>${esc(t("AI_COPILOT.REVERT_DRAFT", "Vorherigen Text wiederherstellen"))}</button>
        </div>
        <p class="subject-hint" id="subject-hint" hidden><span></span><button type="button" class="text-btn" data-action="apply-subject">${esc(t("AI_COPILOT.APPLY_SUBJECT", "Übernehmen"))}</button></p>
        <p class="quiet" id="draft-status" role="status" aria-live="polite"></p>`;
      shell.querySelector(".fields")?.prepend(tools);
    }
    const consent = document.createElement("dialog");
    consent.id = "consent";
    consent.innerHTML = `
      <div class="dialog-body">
        <h2 class="title title-md">Assistent</h2>
        <p id="consent-text"></p>
        <div class="dialog-actions">
          <button type="button" class="text-btn" value="cancel">${esc(t("GLOBAL.CANCEL", "Abbrechen"))}</button>
          <button type="button" class="ink-btn" value="ok">${esc(t("AI_COPILOT.CONTINUE", "Fortfahren"))}</button>
        </div>
      </div>`;
    consent.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest("button");
      if (button) consent.close(button.value);
    });
    shell.append(consent);
    shell.querySelectorAll<HTMLElement>(".filters, #strip, .sheet, .draft-tools, #consent, [data-action='open-sheet'], [data-action='lang-search'], #translated").forEach((node) => {
      node.dataset.assistNode = "1";
    });
    const alerts = shell.querySelector("[data-action='alert']")?.parentElement as HTMLElement | null;
    if (alerts) alerts.dataset.assistNode = "1";
  }

  function paintSettings(): void {
    const panel = shell?.querySelector("#settings-panel");
    if (!panel) return;
    shell?.querySelectorAll<HTMLButtonElement>("[data-section]").forEach((button) => {
      const id = button.dataset.section || "";
      button.setAttribute("aria-pressed", id === section ? "true" : "false");
      if (id === "contacts") button.hidden = !snap?.app.ContactsSync;
      if (id === "filters") button.hidden = !snap?.caps.sieve;
      if (id === "assistant") button.hidden = !((snap?.app.Plugins || {}) as Record<string, unknown>)["ai-copilot"];
    });
    panel.innerHTML = section === "folders" ? renderFolderDesk(folderDesk, edit) : renderDesk(section, snap, edit);
    if (edit) {
      const scope = section === "folders" ? panel.querySelector("form[data-kind='folder-save'], form[data-kind='folder-create']") || panel : panel;
      const field = scope.querySelector("input:not([type='hidden']), select, textarea") as HTMLElement | null;
      field?.focus({ preventScroll: true });
      // Das geöffnete Formular in den sichtbaren Bereich des Dialogs holen.
      if (section === "folders") field?.closest("form")?.scrollIntoView({ block: "nearest" });
    }
  }

  function openFolderSettings(fullName: string): void {
    const dialog = shell?.querySelector("#settings") as HTMLDialogElement | null;
    if (!dialog) return;
    section = "folders";
    edit = fullName ? { kind: "folder", id: fullName, fresh: false } : null;
    const opening = !dialog.open;
    if (opening && fullName) {
      // Nach dem Schließen zurück auf den Knopf „Aktionen“ des Ordners (die Zeile kann neu gezeichnet sein).
      dialog.addEventListener("close", () => {
        const back = shell?.querySelector<HTMLElement>(`.frow[data-row="${CSS.escape(fullName)}"] .fmore, .frow[data-row="${CSS.escape(fullName)}"] .folder`);
        back?.focus({ preventScroll: true });
      }, { once: true });
    }
    // Erst öffnen, dann zeichnen: sonst setzt showModal den Fokus auf den ersten Knopf zurück.
    if (opening) {
      if (!edit) dialog.showModal();
      else { paintSettings(); dialog.showModal(); }
      void actions.settings?.("open", {});
    }
    paintSettings();
    actions.act("f-desk", {});
  }

  function promptDialog(title: string, label: string, value: string, secret: boolean): Promise<{ value: string; remember: boolean } | null> {
    const dialog = shell?.querySelector("#prompt-dlg") as HTMLDialogElement | null;
    if (!dialog) return Promise.resolve(null);
    const input = dialog.querySelector("#prompt-input") as HTMLInputElement;
    const form = dialog.querySelector("form") as HTMLFormElement;
    const rememberRow = dialog.querySelector("#prompt-remember-row") as HTMLElement;
    const remember = dialog.querySelector("#prompt-remember") as HTMLInputElement;
    (dialog.querySelector("#prompt-title") as HTMLElement).textContent = title;
    (dialog.querySelector("#prompt-label") as HTMLElement).textContent = label;
    input.type = secret ? "password" : "text";
    input.autocomplete = secret ? "current-password" : "off";
    input.value = value;
    remember.checked = false;
    rememberRow.hidden = !secret;
    dialog.returnValue = "";
    dialog.showModal();
    input.focus({ preventScroll: true });
    return new Promise((resolve) => {
      const onSubmit = (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        dialog.close("ok");
      };
      form.addEventListener("submit", onSubmit);
      dialog.addEventListener("close", () => {
        form.removeEventListener("submit", onSubmit);
        input.type = "text";
        rememberRow.hidden = true;
        resolve(dialog.returnValue === "ok" ? { value: input.value, remember: remember.checked } : null);
      }, { once: true });
    });
  }

  return {
    showLogin,
    setLoginBusy,
    setLoginError,
    showMail,
    setFolders(data) {
      const tree = shell?.querySelector("#folder-tree") as HTMLElement | null;
      if (!tree || !shell) return;
      // Fokus über das Neuzeichnen retten (Auf-/Zuklappen per Tastatur).
      const active = document.activeElement as HTMLElement | null;
      const keep = active && tree.contains(active)
        ? { key: active.dataset.folder || active.dataset.target || "", cls: active.classList.contains("fmore") ? ".fmore" : active.classList.contains("ftoggle") ? ".ftoggle" : ".folder" }
        : null;
      folderActions = new Map(data.rows.map((row) => [row.info.fullName, row.actions]));
      tree.innerHTML = renderSidebarRows(data.rows, Boolean(data.filter.trim()));
      if (keep?.key) {
        const sel = keep.cls === ".folder" ? `.frow[data-row="${CSS.escape(keep.key)}"] .folder` : `.frow[data-row="${CSS.escape(keep.key)}"] ${keep.cls}`;
        (tree.querySelector(sel) as HTMLElement | null)?.focus({ preventScroll: true });
      }
      const filter = shell.querySelector(".folder-filter") as HTMLElement;
      filter.hidden = data.count <= 15 && !data.filter;
      (shell.querySelector("[data-action='f-create']") as HTMLElement).hidden = !data.canCreate;
      (shell.querySelector("#quota") as HTMLElement).innerHTML = renderQuota(data.quota);
      if (data.currentName) {
        const title = shell.querySelector("#folder-title") as HTMLElement;
        title.textContent = data.currentName;
        title.title = data.currentName;
        (shell.querySelector("#reader-place") as HTMLElement).textContent = data.currentName;
        const search = shell.querySelector("#search") as HTMLInputElement;
        if (document.activeElement !== search) search.placeholder = `In ${data.currentName} suchen`;
      }
    },
    setFolderDesk(desk) {
      folderDesk = desk;
      const dialog = shell?.querySelector("#settings") as HTMLDialogElement | null;
      // Ein offenes Formular nicht überschreiben (z. B. beim Abruf im Hintergrund).
      if (dialog?.open && section === "folders" && !edit) {
        const panel = shell?.querySelector("#settings-panel") as HTMLElement | null;
        const top = panel?.closest(".dialog-body")?.scrollTop || 0;
        paintSettings();
        const body = panel?.closest(".dialog-body");
        if (body) body.scrollTop = top;
      }
    },
    showAcl(folder, html) {
      const dialog = shell?.querySelector("#acl-dlg") as HTMLDialogElement | null;
      if (!dialog) return;
      (dialog.querySelector("#acl-title") as HTMLElement).textContent = `${t("FOLDERS_UI.SHARING", "Freigaben")}: ${folder}`;
      (dialog.querySelector("#acl-body") as HTMLElement).innerHTML = html;
      if (!dialog.open) dialog.showModal();
    },
    setListMode(mode) {
      listMode = mode;
      if (!shell) return;
      shell.dataset.thread = mode.threadOpen ? "open" : "";
      const bar = shell.querySelector("#thread-bar") as HTMLElement;
      bar.hidden = !mode.threadOpen;
      (shell.querySelector("#thread-label") as HTMLElement).textContent = mode.threadOpen ? `${t("FOLDERS_UI.THREAD", "Unterhaltung")}: ${mode.threadOpen}` : "";
      paintViewMenu();
    },
    setSearch(query, quick) {
      const input = shell?.querySelector("#search") as HTMLInputElement | null;
      if (input && input.value.trim() !== query) input.value = query;
      const fieldClear = shell?.querySelector(".search-clear") as HTMLButtonElement | null;
      if (fieldClear) fieldClear.hidden = !(input?.value.trim());
      const names: Record<string, string> = {
        from: "Von", to: "An", subject: "Betreff", text: "Text", body: "Text",
        since: "Seit", before: "Bis", attachment: "Mit Anhang", unseen: "Ungelesen", flagged: "Markiert"
      };
      const box = shell?.querySelector("#criteria") as HTMLElement | null;
      if (box) {
        const chips = query.includes("=") ? [...new URLSearchParams(query).entries()].flatMap(([key, value]) => {
          const name = names[key];
          if (!name) return [];
          const label = value ? `${name}: ${value}` : name;
          return [`<button type="button" class="chip criterion" data-action="drop-criterion" data-key="${esc(key)}" aria-label="${esc(label)} entfernen">${icon("filter")}<span>${esc(label)}</span>${icon("close")}</button>`];
        }) : [];
        box.hidden = chips.length === 0;
        box.innerHTML = chips.join("");
      }
      shell?.querySelectorAll<HTMLElement>("[data-action='quick']").forEach((button) => {
        button.setAttribute("aria-pressed", quick.has(button.dataset.flag as QuickFlag) ? "true" : "false");
      });
    },
    openSearch(criteria, options) {
      const dialog = shell?.querySelector("#adv-search") as HTMLDialogElement | null;
      if (!dialog) return;
      const form = dialog.querySelector("form") as HTMLFormElement;
      form.dataset.multisearch = options.multisearch ? "1" : "";
      (dialog.querySelector("#adv-body") as HTMLElement).innerHTML = renderSearchForm(criteria, options);
      dialog.showModal();
      (form.querySelector("input[name='from']") as HTMLInputElement | null)?.focus({ preventScroll: true });
    },
    folderDialog(options) {
      const dialog = shell?.querySelector("#folder-dlg") as HTMLDialogElement | null;
      if (!dialog) return Promise.resolve(null);
      const form = dialog.querySelector("form") as HTMLFormElement;
      const name = dialog.querySelector("#folder-dlg-name") as HTMLInputElement;
      const parent = dialog.querySelector("#folder-dlg-parent") as HTMLSelectElement;
      const sub = dialog.querySelector("#folder-dlg-sub") as HTMLInputElement;
      (dialog.querySelector("#folder-dlg-title") as HTMLElement).textContent = options.title;
      parent.innerHTML = options.parents.map((item) => `<option value="${esc(item.value)}"${item.value === options.parent ? " selected" : ""}>${esc(item.label)}</option>`).join("");
      name.value = "";
      sub.checked = true;
      dialog.returnValue = "";
      dialog.showModal();
      name.focus({ preventScroll: true });
      return new Promise((resolve) => {
        const onSubmit = (event: Event) => {
          event.preventDefault();
          if (!name.value.trim()) return;
          dialog.close("ok");
        };
        form.addEventListener("submit", onSubmit);
        dialog.addEventListener("close", () => {
          form.removeEventListener("submit", onSubmit);
          resolve(dialog.returnValue === "ok" ? { name: name.value.trim(), parent: parent.value, subscribe: sub.checked } : null);
        }, { once: true });
      });
    },
    openFolderSettings,
    setList(rows, empty, error, more, searching) {
      const box = shell?.querySelector("#rows");
      const emptyEl = shell?.querySelector("#list-empty") as HTMLElement | null;
      const errorEl = shell?.querySelector("#list-error") as HTMLElement | null;
      const moreBtn = shell?.querySelector("[data-action='more']") as HTMLButtonElement | null;
      const clearBtn = shell?.querySelector("[data-clear='list']") as HTMLButtonElement | null;
      const result = shell?.querySelector("#list-result") as HTMLElement | null;
      const currentKey = rows.map((r) => r.uid).join(",");
      const isFresh = Boolean(currentKey && currentKey !== lastListKey);
      lastListKey = currentKey;
      if (box) {
        box.innerHTML = rows.map((row) => {
          const subject = row.subject || "(ohne Betreff)";
          const group = row.group ? `<h2 class="list-group mono">${esc(row.group)}</h2>` : "";
          const threadText = row.threadCount
            ? `${t("FOLDERS_UI.THREAD_OPEN", "Unterhaltung öffnen")}: ${row.threadCount} ${t("FOLDERS_UI.MAILS", "Mails")}${row.threadUnseen ? `, ${row.threadUnseen} ${t("FOLDERS_UI.UNREAD", "ungelesen")}` : ""}`
            : "";
          const thread = row.threadCount
            ? `<button type="button" class="msg-thread${row.threadUnseen ? " unseen" : ""}" data-action="m-thread" data-ref="${row.uid}" aria-label="${esc(`${threadText} – ${subject}`)}" title="${esc(threadText)} (T)">${icon("thread")}<span>${row.threadCount}</span></button>`
            : "";
          return `${group}
          <div class="msg-row${isFresh ? " entering" : ""}${row.threadCount ? " has-thread" : ""}${row.checked ? " checked" : ""}${row.deleted ? " deleted" : ""}${row.unseen ? " unseen" : ""}">
            <span class="unread-slot" aria-hidden="true">${row.unseen ? `<span class="unread-mark"></span>` : ""}</span>
            <input type="checkbox" class="msg-check" data-action="m-check" data-ref="${row.uid}"${row.checked ? " checked" : ""} aria-label="Auswählen: ${esc(subject)}">
            <button type="button" class="msg${row.unseen ? " unseen" : ""}" data-uid="${row.uid}" draggable="true" aria-current="${row.current ? "true" : "false"}">
              <span class="who">${esc(row.who)}</span>
              <span class="when">${rowMarks({ ...row, flagged: false })}${esc(row.when)}</span>
              <span class="subj">${esc(subject)}${categoryMark(row.category)}</span>
              <span class="peek">${esc(row.preview)}</span>
            </button>
            ${thread}
            <div class="msg-actions" role="toolbar" aria-label="Schnellaktionen">
              <button type="button" class="msg-action msg-action-flag" data-action="m-flag" data-ref="${row.uid}" aria-pressed="${row.flagged ? "true" : "false"}" aria-label="${row.flagged ? t("MESSAGE_LIST.FLAG_REMOVE", "Markierung entfernen") : t("MESSAGE_LIST.FLAG_SET", "Markieren")}: ${esc(subject)}" title="${row.flagged ? t("MESSAGE_LIST.FLAG_REMOVE", "Markierung entfernen") : t("MESSAGE_LIST.FLAG_SET", "Markieren")}">${icon(row.flagged ? "flag-filled" : "flag")}</button>
              <button type="button" class="msg-action msg-action-archive" data-action="m-archive" data-ref="${row.uid}" aria-label="${esc(t("GLOBAL.TO_ARCHIVE", "Archivieren"))}: ${esc(subject)}" title="${esc(t("GLOBAL.TO_ARCHIVE", "Archivieren"))}">${icon("archive")}</button>
              <button type="button" class="msg-action msg-action-delete" data-action="m-delete" data-ref="${row.uid}" aria-label="${esc(t("GLOBAL.DELETE", "Löschen"))}: ${esc(subject)}" title="${esc(t("GLOBAL.DELETE", "Löschen"))}">${icon("delete")}</button>
            </div>
          </div>`;
        }).join("");
      }
      if (emptyEl) {
        emptyEl.hidden = !empty;
        const titleEl = emptyEl.querySelector(".empty-title") || emptyEl;
        titleEl.textContent = empty;
      }
      if (errorEl) {
        errorEl.hidden = !error;
        errorEl.textContent = error;
      }
      if (moreBtn) moreBtn.hidden = !more;
      if (clearBtn) clearBtn.hidden = !searching;
      if (result) {
        result.hidden = !searching;
        result.textContent = searching ? (rows.length ? `${t("SEARCH_UI.RESULTS", "Ergebnisse")} · ${rows.length}` : t("SEARCH_UI.NO_RESULTS", "Keine Treffer")) : "";
      }
    },
    setReader(data, loading, error) {
      if (shell) shell.dataset.reading = data ? "1" : "0";
      if (!data || data.uid !== lastReader?.uid) {
        expanded = false;
        filesExpanded = false;
      }
      const body = shell?.querySelector("#reader-body") as HTMLElement | null;
      const addContact = shell?.querySelector("[data-action='m-addr-contact']") as HTMLElement | null;
      if (addContact) addContact.hidden = !data?.contacts;
      paintBar(data);
      if (!body) return;
      body.replaceChildren();
      const say = (className: string, text: string, symbol: IconName, role: string) => {
        const box = document.createElement("div");
        box.className = `reader-state ${className}`;
        box.setAttribute("role", role);
        const p = document.createElement("p");
        p.textContent = text;
        box.innerHTML = icon(symbol);
        box.append(p);
        body.append(box);
      };
      if (loading) return say("quiet", loading, "loading", "status");
      if (error) return say("error", error, "error", "alert");
      if (!data) {
        body.innerHTML = `
          <div class="empty reader-empty">
            <span class="icon icon-lg">${icon("inbox")}</span>
            <p class="empty-title">${esc(t("MESSAGE.SELECT_MESSAGE", "Wählen Sie eine Mail aus der Liste."))}</p>
            <span class="empty-hint mono">${esc(t("MESSAGE.SHORTCUTS_HINT", "J / K Navigieren · C Verfassen · ? Tastenkürzel"))}</span>
          </div>`;
        return;
      }
      this.setSelectionCount(0);
      renderReader(body, data, expanded, filesExpanded);
      body.scrollTop = 0;
    },
    setSelectionCount(count) {
      if (!shell) return;
      const head = shell.querySelector("#selection-head") as HTMLElement | null;
      const paneHead = shell.querySelector(".list-pane .pane-head") as HTMLElement | null;
      const bulkBar = shell.querySelector("#bulk-bar") as HTMLElement | null;
      const countLabel = shell.querySelector("#selection-count") as HTMLElement | null;
      const bulkBarCount = shell.querySelector("#bulk-bar-count") as HTMLElement | null;
      const on = count > 0;
      paneHead?.classList.toggle("is-selecting", on);
      if (head) head.hidden = !on;
      if (bulkBar) bulkBar.hidden = !on;
      const text = count === 1 ? "1 ausgewählt" : `${count} ausgewählt`;
      if (countLabel) countLabel.textContent = text;
      if (bulkBarCount) bulkBarCount.textContent = text;
    },
    setBulk(data) {
      if (shell) shell.dataset.reading = "0";
      const body = shell?.querySelector("#reader-body") as HTMLElement | null;
      const readerPlace = shell?.querySelector("#reader-place") as HTMLElement | null;
      const notice = shell?.querySelector("#notice") as HTMLElement | null;
      if (readerPlace) readerPlace.textContent = "";
      if (notice) notice.textContent = "";
      this.setStrip(null);
      paintBar(null);
      this.setSelectionCount(data.count);
      const bulkArchive = shell?.querySelector("[data-bulk-archive]") as HTMLElement | null;
      if (bulkArchive) bulkArchive.hidden = !data.place.archive;
      if (body) renderBulk(body, data);
    },
    setChecks(visible) {
      shell?.classList.toggle("with-checks", visible);
    },
    setRefreshing(busy) {
      if (busy) lastListKey = "";
      const button = shell?.querySelector("[data-action='m-refresh']") as HTMLButtonElement | null;
      if (!button) return;
      button.disabled = busy;
      button.innerHTML = icon(busy ? "loading" : "refresh");
      const status = shell?.querySelector("#list-status");
      if (status) status.textContent = busy ? "Wird aktualisiert …" : "";
    },
    setAccounts(items) {
      const box = shell?.querySelector("#account-list") as HTMLElement | null;
      if (!box) return;
      const others = items.filter((item) => !item.current);
      box.innerHTML = others.length
        ? `<p class="menu-label mono">Konten</p>` + others.map((item) =>
          `<button type="button" class="menu-item" role="menuitem" data-action="m-switch" data-email="${esc(item.email)}">${icon("user")}<span class="grow">${esc(item.email)}</span>${item.unread ? `<span class="count">${item.unread}</span>` : ""}</button>`
        ).join("") + `<hr class="menu-sep">`
        : "";
    },
    pickFolder(title, folders, exclude) {
      const dialog = shell?.querySelector("#picker") as HTMLDialogElement | null;
      if (!dialog) return Promise.resolve(null);
      const list = dialog.querySelector("#picker-list") as HTMLElement;
      const query = dialog.querySelector("#picker-q") as HTMLInputElement;
      (dialog.querySelector("#picker-title") as HTMLElement).textContent = title;
      const paint = () => {
        const q = query.value.trim().toLowerCase();
        const rows = folders.filter((folder) => folder.fullName !== exclude && (!q || folder.fullName.toLowerCase().includes(q)));
        list.innerHTML = rows.map((folder) =>
          `<button type="button" class="folder" role="option" data-pick="${esc(folder.fullName)}" style="padding-left:${8 + (q ? 0 : folder.depth) * 12}px">${icon(ROLE_ICON[folder.role] || (folder.fullName.toUpperCase() === "INBOX" ? "inbox" : "folder"))}<span class="folder-name">${esc(q ? folder.fullName : folder.name)}</span></button>`
        ).join("") || `<p class="quiet">Kein Ordner gefunden.</p>`;
      };
      query.value = "";
      paint();
      dialog.returnValue = "";
      dialog.showModal();
      query.focus({ preventScroll: true });
      return new Promise((resolve) => {
        const onInput = () => paint();
        const onClick = (event: Event) => {
          const button = (event.target as HTMLElement).closest<HTMLElement>("[data-pick]");
          if (button) dialog.close(button.dataset.pick || "");
        };
        const onKey = (event: KeyboardEvent) => {
          if (event.key === "Enter" && event.target === query) {
            event.preventDefault();
            const first = list.querySelector<HTMLElement>("[data-pick]");
            if (first) dialog.close(first.dataset.pick || "");
          }
          if (event.key === "ArrowDown" && event.target === query) {
            event.preventDefault();
            list.querySelector<HTMLElement>("[data-pick]")?.focus();
          }
        };
        query.addEventListener("input", onInput);
        list.addEventListener("click", onClick);
        dialog.addEventListener("keydown", onKey);
        dialog.addEventListener("close", () => {
          query.removeEventListener("input", onInput);
          list.removeEventListener("click", onClick);
          dialog.removeEventListener("keydown", onKey);
          resolve(dialog.returnValue || null);
        }, { once: true });
      });
    },
    ask(title, label, value = "") {
      return promptDialog(title, label, value, false).then((row) => row?.value ?? null);
    },
    askSecret(title, label) {
      return promptDialog(title, label, "", true);
    },
    confirm(title, text, ok, danger = true) {
      return chooseDialog(title, text, ok, "", danger).then((value) => value === "ok");
    },
    setBook(allowed, sync, mode) {
      shell?.querySelectorAll<HTMLElement>("[data-book-entry]").forEach((button) => { button.hidden = !allowed; });
      book?.setSync(sync, mode);
      if (!allowed) void closeBook();
    },
    reloadBook() {
      return book?.reload() || Promise.resolve();
    },
    preview(name, url, kind) {
      const dialog = shell?.querySelector("#lightbox") as HTMLDialogElement | null;
      if (!dialog) return;
      (dialog.querySelector("#lightbox-title") as HTMLElement).textContent = name;
      (dialog.querySelector("#lightbox-open") as HTMLAnchorElement).href = url;
      const box = dialog.querySelector("#lightbox-body") as HTMLElement;
      box.replaceChildren();
      if (kind === "image") {
        const img = document.createElement("img");
        img.src = url;
        img.alt = name;
        box.append(img);
      } else {
        const frame = document.createElement("iframe");
        frame.src = url;
        frame.title = name;
        if (kind === "text") frame.setAttribute("sandbox", "");
        box.append(frame);
      }
      dialog.showModal();
    },
    configureCompose(prefs, identities) {
      composePrefs = prefs;
      composeIdentities = identities;
      composer?.configure(prefs, identities);
    },
    openCompose(seed) { composer?.open(seed); presetDraftTools(seed); },
    closeCompose() { composer?.sent(); },
    attachCompose(items) { return composer?.attachFrom(items) || Promise.resolve(); },
    setSendState(busy, error) { if (!busy || error) composer?.setError(error); },
    notice(text) {
      const slot = shell?.querySelector("#notice") as HTMLElement | null;
      if (slot) slot.textContent = text;
    },
    confirmDelete() {
      return this.confirm("Wirklich löschen?", "", t("GLOBAL.DELETE", "Löschen"));
    },
    confirmConsent(text) {
      const dialog = shell?.querySelector("#consent") as HTMLDialogElement | null;
      const slot = shell?.querySelector("#consent-text");
      if (!dialog || !slot) return Promise.resolve(true);
      slot.textContent = text;
      dialog.showModal();
      return new Promise((resolve) => {
        dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok"), { once: true });
      });
    },
    pressCategory(id) {
      shell?.querySelectorAll<HTMLButtonElement>(".filter").forEach((button) => {
        button.setAttribute("aria-pressed", button.dataset.cat === id ? "true" : "false");
      });
    },
    setAlerts(reply, follow, invoice, dues) {
      const write = (name: string, value: number) => {
        const slot = shell?.querySelector(`[data-count='${name}']`);
        if (slot) slot.textContent = String(value);
      };
      write("reply", reply);
      write("follow", follow);
      write("invoice", invoice);
      const line = shell?.querySelector("#dues");
      if (!line) return;
      line.replaceChildren(...dues.map((item) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "text-btn";
        button.dataset.action = "open-due";
        button.dataset.folder = item.folder;
        button.dataset.mailUid = String(item.uid);
        button.textContent = `${item.due} ${item.title}`;
        return button;
      }));
    },
    showReaderPane() {
      if (!wide()) pane("reader");
    },
    setAssistBusy(action, busy) {
      shell?.querySelectorAll<HTMLButtonElement>(`[data-action='${action}']`).forEach((button) => {
        button.disabled = busy;
        button.setAttribute("aria-busy", String(busy));
      });
    },
    setStrip(state) {
      const strip = shell?.querySelector("#strip") as HTMLElement | null;
      if (!strip) return;
      strip.replaceChildren();
      if (!state) {
        strip.hidden = true;
        return;
      }
      strip.hidden = false;
      if (state.loading) {
        const p = document.createElement("p");
        p.className = "assist-status quiet";
        p.setAttribute("role", "status");
        p.textContent = state.loading;
        strip.append(p);
        return;
      }
      if (state.error) {
        const p = document.createElement("p");
        p.className = "error assist-status";
        p.setAttribute("role", "alert");
        p.textContent = state.error;
        strip.append(p);
      }
      const actions = document.createElement("div");
      actions.className = "assist-actions";
      if (!state.tldr && state.showSummarize) {
        const button = document.createElement("button");
        const hint = t("AI_COPILOT.SUMMARIZE_HINT", "Verlauf mit KI zusammenfassen");
        button.type = "button";
        button.className = "text-btn assist-action ai-action";
        button.dataset.action = "summarize";
        button.innerHTML = withAssist(t("AI_COPILOT.SUMMARIZE", "Mit KI zusammenfassen"));
        button.title = hint;
        button.setAttribute("aria-label", hint);
        actions.append(button);
      }
      if (state.showReplies && !state.replies.length) {
        const replies = document.createElement("button");
        const hint = t("AI_COPILOT.QUICK_REPLIES_HINT", "Drei Antwortvorschläge mit KI erzeugen");
        replies.type = "button";
        replies.className = "text-btn assist-action ai-action";
        replies.dataset.action = "replies";
        replies.innerHTML = withAssist(t("AI_COPILOT.QUICK_REPLIES", "Antworten mit KI vorschlagen"));
        replies.title = hint;
        replies.setAttribute("aria-label", hint);
        actions.append(replies);
      }
      if (actions.childElementCount) strip.append(actions);
      if (state.tldr) {
        const result = document.createElement("div");
        result.className = "assist-result";
        const label = document.createElement("span");
        label.className = "mono quiet";
        label.textContent = t("AI_COPILOT.SUMMARY", "Zusammenfassung");
        const text = document.createElement("p");
        text.className = "assist-summary";
        text.textContent = state.tldr;
        const meta = document.createElement("div");
        meta.className = "assist-meta";
        const again = document.createElement("button");
        const hint = t("AI_COPILOT.SUMMARIZE_HINT", "Verlauf erneut mit KI zusammenfassen");
        again.type = "button";
        again.className = "text-btn ai-action";
        again.dataset.action = "summarize";
        again.dataset.force = "1";
        again.innerHTML = withAssist(t("AI_COPILOT.REGENERATE", "Mit KI neu erzeugen"));
        again.title = hint;
        again.setAttribute("aria-label", hint);
        meta.append(again);
        if (state.cached) {
          const note = document.createElement("span");
          note.className = "quiet";
          note.textContent = t("AI_COPILOT.CACHED", "Aus dem Zwischenspeicher");
          meta.append(note);
        }
        const caveat = document.createElement("p");
        caveat.className = "quiet assist-caveat";
        caveat.textContent = t("AI_COPILOT.SUMMARY_CAVEAT", "Bitte mit dem Brief abgleichen: Zusammenfassungen können Angaben falsch interpretieren.");
        result.append(label, text);
        ([
          [t("AI_COPILOT.POINTS", "Wichtige Punkte"), state.points],
          [t("AI_COPILOT.DECISIONS", "Entscheidungen"), state.decisions],
          [t("AI_COPILOT.TASKS", "Aufgaben"), state.actions],
          [t("AI_COPILOT.NEXT_STEP", "Nächster Schritt"), state.next ? [state.next] : []]
        ] as [string, string[]][]).forEach(([title, items]) => {
          if (!items.length) return;
          const heading = document.createElement("span");
          heading.className = "mono quiet";
          heading.textContent = title;
          const list = document.createElement("ul");
          list.className = "bulk-summary-points";
          items.forEach((entry) => {
            const row = document.createElement("li");
            row.textContent = entry;
            list.append(row);
          });
          result.append(heading, list);
        });
        result.append(meta, caveat);
        strip.append(result);
      }
      if (state.replies.length) {
        const group = document.createElement("div");
        group.className = "assist-replies";
        const label = document.createElement("p");
        label.className = "quiet";
        label.textContent = t("AI_COPILOT.REPLY_HINT", "Vorschlag auswählen und als bearbeitbaren Entwurf öffnen:");
        const prompts = document.createElement("div");
        prompts.className = "prompts reply-prompts";
        state.replies.forEach((reply, index) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "prompt";
          button.dataset.action = "use-reply";
          button.dataset.index = String(index);
          button.textContent = reply.label;
          prompts.append(button);
        });
        group.append(label, prompts);
        strip.append(group);
      }
      if (state.model) {
        const model = document.createElement("p");
        model.className = "mono quiet assist-model";
        model.textContent = state.model;
        strip.append(model);
      }
    },
    setChat(turns, thinking, context = "") {
      const log = shell?.querySelector("#chat-log");
      const chip = shell?.querySelector("#context-chip") as HTMLButtonElement | null;
      const error = shell?.querySelector("#chat-error") as HTMLElement | null;
      const busy = Boolean(thinking) && !thinking.startsWith("!");
      shell?.querySelectorAll<HTMLButtonElement>(".sheet-form button:not([data-action='stop-chat']), .sheet [data-action='prompt']").forEach((button) => { button.disabled = busy; });
      const area = shell?.querySelector("#ask") as HTMLTextAreaElement | null;
      if (area) area.setAttribute("aria-busy", String(busy));
      if (chip) {
        chip.hidden = !context;
        const name = document.createElement("span");
        name.className = "context-chip-name";
        name.textContent = `${t("AI_COPILOT.CONTEXT", "Bezug")}: ${context}`;
        const drop = document.createElement("span");
        drop.className = "context-chip-drop";
        drop.textContent = t("AI_COPILOT.DROP_CONTEXT", "Bezug entfernen");
        chip.replaceChildren(...(context ? [name, drop] : []));
        chip.title = context;
      }
      if (error) {
        error.hidden = !thinking.startsWith("!");
        error.textContent = thinking.startsWith("!") ? thinking.slice(1) : "";
      }
      const stop = shell?.querySelector("[data-action='stop-chat']") as HTMLElement | null;
      if (stop) stop.hidden = !busy;
      if (!log) return;
      log.setAttribute("aria-busy", String(busy));
      log.replaceChildren();
      if (!turns.length && !thinking) {
        const p = document.createElement("p");
        p.className = "quiet";
        p.textContent = t("AI_COPILOT.CHAT_EMPTY", "Fragen Sie zum Beispiel, welche Mails auf eine Antwort warten.");
        const prompts = document.createElement("div");
        prompts.className = "prompts";
        chatPrompts().forEach((text) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "prompt";
          button.dataset.action = "prompt";
          button.textContent = text;
          prompts.append(button);
        });
        log.append(p, prompts);
      }
      turns.forEach((turn, turnIndex) => {
        const item = document.createElement("article");
        item.className = turn.role === "user" ? "bubble" : "assistant";
        if (turn.trace.length) {
          const trace = document.createElement("p");
          trace.className = "mono quiet";
          trace.textContent = turn.trace.join(" · ");
          item.append(trace);
        }
        const text = document.createElement("p");
        text.textContent = turn.text;
        item.append(text);
        turn.actions.forEach((action, index) => {
          const card = document.createElement("div");
          card.className = "action";
          const label = document.createElement("p");
          label.textContent = actionSummary(action.payload);
          card.append(label);
          if (action.label && action.label !== String(action.payload.type || "")) {
            const note = document.createElement("p");
            note.className = "quiet";
            note.textContent = action.label;
            card.append(note);
          }
          if (!action.state) {
            const run = document.createElement("button");
            run.type = "button";
            run.className = "ink-btn";
            run.dataset.action = "run-action";
            run.dataset.turn = String(turnIndex);
            run.dataset.index = String(index);
            run.textContent = t("AI_COPILOT.RUN", "Ausführen");
            const dismiss = document.createElement("button");
            dismiss.type = "button";
            dismiss.className = "text-btn";
            dismiss.dataset.action = "dismiss-action";
            dismiss.dataset.turn = String(turnIndex);
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
      if (busy) {
        const p = document.createElement("p");
        p.className = "quiet thinking";
        p.setAttribute("role", "status");
        p.textContent = thinking;
        log.append(p);
      }
      log.scrollTop = log.scrollHeight;
    },
    openSheet() {
      const sheet = shell?.querySelector(".sheet") as HTMLElement | null;
      if (!sheet) return;
      if (!wide()) pane("reader");
      openLayer(sheet, document.activeElement instanceof HTMLElement ? document.activeElement : null);
      (shell?.querySelector("#ask") as HTMLTextAreaElement | null)?.focus({ preventScroll: true });
    },
    closeSheet() {
      const sheet = shell?.querySelector(".sheet") as HTMLElement | null;
      if (sheet && !sheet.hidden) closeLayer(sheet);
    },
    draftOptions() {
      const pressed = (selector: string) => shell?.querySelector<HTMLButtonElement>(`${selector}[aria-pressed="true"]`)?.dataset;
      return {
        mode: pressed("[data-mode]")?.mode || "new",
        tone: pressed("[data-tone]")?.tone || "professional",
        instruction: (shell?.querySelector("#instruction") as HTMLInputElement | null)?.value || "",
        body: composer?.draftText() || "",
        subject: composer?.subject() || "",
        context: composer?.replyContext() || null
      };
    },
    setDraftBody(text) { composer?.setDraftText(text); },
    setDraftBusy(busy, status) {
      const generate = shell?.querySelector("[data-action='generate']") as HTMLButtonElement | null;
      const stop = shell?.querySelector("[data-action='stop-generate']") as HTMLButtonElement | null;
      const revert = shell?.querySelector("[data-action='revert-draft']") as HTMLButtonElement | null;
      const slot = shell?.querySelector("#draft-status");
      if (generate) generate.hidden = busy;
      if (stop) stop.hidden = !busy;
      if (revert) revert.hidden = busy;
      if (slot) slot.textContent = status;
    },
    setSubjectHint(subject) {
      const hint = shell?.querySelector("#subject-hint") as HTMLElement | null;
      if (!hint) return;
      hint.hidden = !subject;
      const span = hint.querySelector("span");
      if (span) span.textContent = subject ? `Betreff: ${subject}` : "";
      hint.dataset.subject = subject;
    },
    showReauth() {
      if (!shell) return;
      let dialog = shell.querySelector("#reauth") as HTMLDialogElement | null;
      if (!dialog) {
        dialog = document.createElement("dialog");
        dialog.id = "reauth";
        dialog.innerHTML = `
          <form class="dialog-body">
            <h2 class="title title-md">${esc(t("LOGIN.SESSION", "Die Sitzung ist abgelaufen"))}</h2>
            <p class="quiet">${esc(t("LOGIN.SESSION_HINT", "Melden Sie sich erneut an. Der offene Entwurf bleibt erhalten."))}</p>
            <label class="field"><span>${esc(t("GLOBAL.EMAIL", "E-Mail"))}</span><input name="email" type="email" autocomplete="username" required></label>
            <label class="field"><span>${esc(t("GLOBAL.PASSWORD", "Passwort"))}</span><input name="password" type="password" autocomplete="current-password" required></label>
            <label class="field"><span>${esc(t("LOGIN.TWO_FACTOR", "Code"))}</span><input name="totp" inputmode="numeric" autocomplete="one-time-code"></label>
            <p class="error" data-for="reauth" hidden></p>
            <div class="dialog-actions"><button type="submit" class="ink-btn">${esc(t("LOGIN.BUTTON_SIGN_IN", "Anmelden"))}</button></div>
          </form>`;
        dialog.addEventListener("submit", (event) => {
          event.preventDefault();
          const form = event.target as HTMLFormElement;
          const data = new FormData(form);
          actions.login(String(data.get("email") || ""), String(data.get("password") || ""), false, String(data.get("totp") || ""));
        });
        dialog.addEventListener("cancel", (event) => event.preventDefault());
        shell.append(dialog);
      }
      if (!dialog.open) dialog.showModal();
    },
    hideReauth() {
      (shell?.querySelector("#reauth") as HTMLDialogElement | null)?.close();
    },
    hasMail() {
      return Boolean(shell?.isConnected);
    },
    setLayout(mode) {
      const validMode = mode === 2 ? 1 : mode;
      if (shell) shell.dataset.layout = String(validMode);
    },
    composerOpen() {
      return Boolean(shell?.querySelector(".composer:not([hidden])"));
    },
    minimizeCompose() {
      composer?.minimize();
    },
    focusPane(name) {
      const focus = shell?.querySelector<HTMLElement>(name === "folders" ? ".sidebar button" : name === "list" ? "[data-uid]" : ".reader button");
      focus?.focus({ preventScroll: true });
    },
    setAssist(flags) {
      if (!flags) {
        shell?.querySelectorAll("[data-assist-node]").forEach((node) => node.remove());
        return;
      }
      installAssist(flags);
    },
    settingsSaved() {
      const slot = shell?.querySelector("#settings-live") as HTMLElement | null;
      if (!slot) return;
      slot.innerHTML = `${icon("check")} <span>${esc(t("GLOBAL.SAVED", "Gespeichert"))}</span>`;
      slot.classList.add("visible");
      window.clearTimeout((slot as unknown as { _timer?: number })._timer);
      (slot as unknown as { _timer?: number })._timer = window.setTimeout(() => {
        slot.classList.remove("visible");
      }, 2500);
    },
    showSettings(next) {
      snap = next;
      // Der Ordnerabschnitt hat eigene Daten; ein offenes Ordnerformular bleibt stehen.
      if (section === "folders" && edit) return;
      edit = null;
      paintSettings();
    },
    settingsNotice(text) {
      const slot = shell?.querySelector("#settings-error") as HTMLElement | null;
      if (!slot) return;
      slot.hidden = !text;
      slot.textContent = text;
    },
    showTranslation(search, explanation) {
      const box = shell?.querySelector("#translated") as HTMLElement | null;
      if (!box) return;
      box.hidden = false;
      (box.querySelector("#translate-q") as HTMLInputElement).value = search;
      const why = box.querySelector("#translate-why");
      if (why) why.textContent = explanation;
    }
  };
}
