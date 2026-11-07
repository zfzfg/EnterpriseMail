import type { AssistFlags } from "./assistant";
import { Composer, type ComposeFile, type ComposeIdentity, type ComposePreferences, type ComposeSeed, type ComposeValues } from "./compose";
import { icon, type IconName } from "./icons";
import { t } from "./i18n";
import { renderBulk, renderReader, type BulkData, type ReaderData } from "./reader";
import { mountBook, type Book } from "./contacts";
import { renderDesk, type DeskEdit, type SettingsSnapshot } from "./settings";
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
  actions: { label: string; state: string }[];
}

export interface DraftOptions {
  mode: string;
  tone: string;
  instruction: string;
  body: string;
  subject: string;
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
  setChecks(visible: boolean): void;
  setRefreshing(busy: boolean): void;
  setAccounts(items: AccountItem[]): void;
  pickFolder(title: string, folders: PickerFolder[], exclude: string): Promise<string | null>;
  ask(title: string, label: string, value?: string): Promise<string | null>;
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
  setAlerts(reply: number, follow: number, invoice: number, dues: string): void;
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
  let book: Book | null = null;
  let composePrefs: ComposePreferences = {
    editor: "Plain", markdown: false, spellcheck: false, autosave: true, draftsFolder: "", sentFolder: "",
    replySameFolder: false, attachmentLimit: 0, readReceipt: false, dsn: false, requireTLS: false, pgpSign: false, pgpEncrypt: false
  };
  let composeIdentities: ComposeIdentity[] = [];

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
    const languages = options?.languages || {};
    const codes = Object.keys(languages);
    const langField = options && codes.length ? `<label class="field"><span>${esc(t("GLOBAL.LANGUAGE", "Sprache"))}</span><select name="language">${codes.map((code) => `<option value="${esc(code)}"${code === options.language ? " selected" : ""}>${esc(languages[code] || code)}</option>`).join("")}</select></label>` : "";
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
            <button type="button" class="icon-btn" data-action="m-select-all" aria-label="Alle auswählen" title="Alle auswählen (Strg+A)">${icon("select-all")}</button>
            <button type="button" class="icon-btn" data-action="m-refresh" aria-label="Aktualisieren" title="Aktualisieren">${icon("refresh")}</button>
          </div>
          <form class="search-wrap" data-action="search">
            <label class="sr" for="search">Suche</label>
            <input class="search" id="search" type="search" placeholder="" autocomplete="off">
            <button type="button" class="icon-btn" data-action="adv-search" aria-haspopup="dialog" aria-label="${esc(t("SEARCH.TITLE_ADV", "Erweiterte Suche"))}" title="${esc(t("SEARCH.TITLE_ADV", "Erweiterte Suche"))}">${icon("filter")}</button>
          </form>
          <div class="quick" role="group" aria-label="${esc(t("SEARCH_UI.QUICK", "Schnellfilter"))}">
            <button type="button" class="chip" data-action="quick" data-flag="unseen" aria-pressed="false">${esc(t("SEARCH.UNSEEN", "Ungelesen"))}</button>
            <button type="button" class="chip" data-action="quick" data-flag="flagged" aria-pressed="false">${esc(t("SEARCH.FLAGGED", "Markiert"))}</button>
            <button type="button" class="chip" data-action="quick" data-flag="attachment" aria-pressed="false">${esc(t("SEARCH_UI.WITH_ATTACHMENT", "Mit Anhang"))}</button>
          </div>
          <div class="thread-bar" id="thread-bar" hidden>
            <button type="button" class="text-btn" data-action="thread-back">${withIcon("back", t("FOLDERS_UI.BACK_TO_LIST", "Zurück zur Liste"))}</button>
            <span class="quiet" id="thread-label"></span>
          </div>
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
            <button type="button" class="text-btn bar-btn" data-action="back" title="${esc(t("GLOBAL.BACK", "Zurück"))}" hidden>${withIcon("back", t("GLOBAL.BACK", "Zurück"))}</button>
            <span class="quiet" id="reader-place"></span>
            <span class="spacer"></span>
            <button type="button" class="text-btn bar-btn primary" data-action="reply" title="${esc(t("MESSAGE.BUTTON_REPLY", "Antworten"))}" hidden>${withIcon("reply", t("MESSAGE.BUTTON_REPLY", "Antworten"))}</button>
            <button type="button" class="text-btn bar-btn primary wide-only" data-action="reply-all" title="${esc(t("MESSAGE.BUTTON_REPLY_ALL", "Allen antworten"))}" hidden>${withIcon("reply-all", t("MESSAGE.BUTTON_REPLY_ALL", "Allen antworten"))}</button>
            <button type="button" class="text-btn bar-btn primary" data-action="forward" title="${esc(t("MESSAGE.BUTTON_FORWARD", "Weiterleiten"))}" hidden>${withIcon("forward", t("MESSAGE.BUTTON_FORWARD", "Weiterleiten"))}</button>
            <button type="button" class="text-btn bar-btn primary" data-action="archive" title="${esc(t("GLOBAL.TO_ARCHIVE", "Archivieren"))}" hidden>${withIcon("archive", t("GLOBAL.TO_ARCHIVE", "Archivieren"))}</button>
            <button type="button" class="text-btn bar-btn wide-only" data-action="unread" title="Ungelesen" hidden>${withIcon("mark-unread", "Ungelesen")}</button>
            <button type="button" class="text-btn bar-btn primary" data-action="delete" title="${esc(t("GLOBAL.DELETE", "Löschen"))}" hidden>${withIcon("delete", t("GLOBAL.DELETE", "Löschen"))}</button>
            <button type="button" class="text-btn bar-btn wide-only" data-action="m-flag" data-one="1" title="Markieren (I)" aria-pressed="false" hidden>${withIcon("flag", "Markieren")}</button>
            <button type="button" class="text-btn bar-btn wide-only" data-action="m-move" data-one="1" title="Verschieben (M)" hidden>${withIcon("move", "Verschieben")}</button>
            <button type="button" class="text-btn bar-btn wide-only" data-action="m-spam" data-one="1" title="Spam" hidden>${withIcon("spam", "Spam")}</button>
            <button type="button" class="text-btn bar-btn wide-only" data-action="m-notspam" data-one="1" title="Kein Spam" hidden>${withIcon("not-spam", "Kein Spam")}</button>
            <div class="bar-more">
              <button type="button" class="icon-btn" data-action="m-more" data-one="1" aria-label="Weitere Aktionen" aria-haspopup="menu" aria-expanded="false" aria-controls="more-menu" title="Weitere Aktionen" hidden>${icon("more")}</button>
              <div class="menu menu-right" id="more-menu" role="menu" hidden>
                <button type="button" class="menu-item narrow" role="menuitem" data-action="reply-all">${icon("reply-all")}<span>${esc(t("MESSAGE.BUTTON_REPLY_ALL", "Allen antworten"))}</span></button>
                <button type="button" class="menu-item narrow" role="menuitem" data-action="unread" data-narrow="unread">${icon("mark-unread")}<span>Gelesen / ungelesen</span></button>
                <button type="button" class="menu-item narrow" role="menuitem" data-action="m-flag">${icon("flag")}<span>Markieren</span></button>
                <button type="button" class="menu-item narrow" role="menuitem" data-action="m-move">${icon("move")}<span>Verschieben …</span></button>
                <button type="button" class="menu-item narrow" role="menuitem" data-action="m-spam" data-narrow="spam">${icon("spam")}<span>Spam</span></button>
                <button type="button" class="menu-item narrow" role="menuitem" data-action="m-notspam" data-narrow="notspam">${icon("not-spam")}<span>Kein Spam</span></button>
                <button type="button" class="menu-item" role="menuitem" data-action="m-edit-draft" hidden>${icon("compose")}<span>Entwurf bearbeiten</span></button>
                <button type="button" class="menu-item" role="menuitem" data-action="m-edit-new">${icon("edit-as-new")}<span>Als neu bearbeiten</span></button>
                <button type="button" class="menu-item" role="menuitem" data-action="m-forward-att">${icon("forward-attachment")}<span>Als Anhang weiterleiten</span></button>
                <button type="button" class="menu-item" role="menuitem" data-action="m-copy">${icon("copy")}<span>Kopieren nach …</span></button>
                <button type="button" class="menu-item" role="menuitem" data-action="m-tag">${icon("tag")}<span>Schlagwort hinzufügen</span></button>
                <button type="button" class="menu-item" role="menuitem" data-action="m-mode" data-mode-item="1">${icon("source")}<span>Nur Text anzeigen</span></button>
                <button type="button" class="menu-item" role="menuitem" data-action="m-swap">${icon("eye")}<span>Farben umkehren</span></button>
                <button type="button" class="menu-item" role="menuitem" data-action="m-unsubscribe" hidden>${icon("unsubscribe")}<span>Vom Verteiler abmelden</span></button>
                <button type="button" class="menu-item" role="menuitem" data-action="m-print">${icon("print")}<span>Drucken</span></button>
                <button type="button" class="menu-item" role="menuitem" data-action="m-window">${icon("external")}<span>In neuem Fenster</span></button>
                <button type="button" class="menu-item" role="menuitem" data-action="m-fullscreen">${icon("fullscreen")}<span>Vollbild</span></button>
                <button type="button" class="menu-item" role="menuitem" data-action="m-source">${icon("code")}<span>Quelltext anzeigen</span></button>
                <button type="button" class="menu-item" role="menuitem" data-action="m-eml">${icon("download")}<span>Als .eml laden</span></button>
                <button type="button" class="menu-item danger-item" role="menuitem" data-action="m-delete-forever">${icon("delete-forever")}<span>Endgültig löschen</span></button>
              </div>
            </div>
            <button type="button" class="icon-btn wide-only" data-action="m-prev" data-one="1" aria-label="Vorige Mail (K)" title="Vorige Mail (K)" hidden>${icon("chevron-up")}</button>
            <button type="button" class="icon-btn wide-only" data-action="m-next" data-one="1" aria-label="Nächste Mail (J)" title="Nächste Mail (J)" hidden>${icon("chevron-down")}</button>
          </div>
          <p class="quiet live" id="notice"></p>
          <div class="pane-body" id="reader-body">
            <p class="empty" id="reader-empty">Wählen Sie eine Mail.</p>
          </div>
        </section>
        <section class="book" id="book" hidden aria-label="${esc(t("GLOBAL.CONTACTS", "Kontakte"))}"></section>
        <div id="compose-host"></div>
        <nav class="tabbar" aria-label="Navigation">
          <button type="button" class="text-btn" data-action="pane-folders">${withIcon("folder", "Ordner")}</button>
          <button type="button" class="text-btn" data-action="pane-search">${withIcon("search", "Suche")}</button>
          <button type="button" class="ink-btn" data-action="compose">${withIcon("compose", t("FOLDER_LIST.BUTTON_NEW_MESSAGE", "Neue Nachricht"))}</button>
        </nav>
        <dialog id="settings" class="dialog-wide" aria-labelledby="settings-title">
          <div class="dialog-body">
            <div class="settings-sticky">
              <div class="sheet-head" style="padding:0;border:0;min-height:0">
                <h2 id="settings-title" class="title title-md">${esc(t("GLOBAL.SETTINGS", "Einstellungen"))}</h2>
                <span class="spacer"></span>
                <button type="button" class="icon-btn" data-action="close-dialog" aria-label="${esc(t("GLOBAL.CLOSE", "Schließen"))}">${icon("close")}</button>
              </div>
              <nav class="settings-nav" aria-label="${esc(t("GLOBAL.SETTINGS", "Einstellungen"))}">
                <button type="button" class="text-btn" data-action="settings-section" data-section="look" aria-pressed="true">${withIcon("eye", t("SETTINGS_DESK.APPEARANCE", "Erscheinungsbild"))}</button>
                <button type="button" class="text-btn" data-action="settings-section" data-section="general">${withIcon("settings", t("SETTINGS_LABELS.GENERAL", "Allgemein"))}</button>
                <button type="button" class="text-btn" data-action="settings-section" data-section="security">${withIcon("key", t("SETTINGS_LABELS.SECURITY", "Sicherheit"))}</button>
                <button type="button" class="text-btn" data-action="settings-section" data-section="assistant" hidden>${withIcon("assist", t("AI_COPILOT.TITLE", "Assistent"))}</button>
                <button type="button" class="text-btn" data-action="settings-section" data-section="folders">${withIcon("folder", t("SETTINGS_LABELS.FOLDERS", "Ordner"))}</button>
                <button type="button" class="text-btn" data-action="settings-section" data-section="accounts">${withIcon("users", t("SETTINGS_LABELS.ACCOUNTS", "Konten"))}</button>
                <button type="button" class="text-btn" data-action="settings-section" data-section="identities">${withIcon("identity", t("SETTINGS_ACCOUNTS.LEGEND_IDENTITIES", "Identitäten"))}</button>
                <button type="button" class="text-btn" data-action="settings-section" data-section="contacts" hidden>${withIcon("contacts", t("SETTINGS_LABELS.CONTACTS", "Kontakte"))}</button>
                <button type="button" class="text-btn" data-action="settings-section" data-section="filters" hidden>${withIcon("filter", t("SETTINGS_LABELS.FILTERS", "Filter"))}</button>
                <button type="button" class="text-btn" data-action="settings-section" data-section="keys">${withIcon("key", t("SETTINGS_DESK.KEYS", "Schlüssel"))}</button>
              </nav>
            </div>
            <p class="quiet live" id="settings-live" aria-live="polite"></p>
            <div id="settings-panel"></div>
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
    account.textContent = email;
    composer = new Composer(next.querySelector("#compose-host") as HTMLElement, composePrefs, {
      send: (values) => actions.send(values),
      save: (values) => actions.saveCompose(values),
      close: (discard) => actions.closeCompose(discard),
      mobile: (open) => { if (!wide()) pane(open ? "compose" : "list"); },
      notice: (text) => { const slot = shell?.querySelector("#notice"); if (slot) slot.textContent = text; }
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
    const back = shell.querySelector("[data-action='back']") as HTMLButtonElement;
    back.hidden = wide() || name !== "reader";
  }

  let expanded = false;
  let keyHandler: ((event: KeyboardEvent) => void) | null = null;
  let lastReader: ReaderData | null = null;

  /** Knöpfe der Brief-Leiste je nach Brief und Ordner zeigen. */
  function paintBar(data: ReaderData | null): void {
    lastReader = data;
    if (!shell) return;
    const show = (name: string, on: boolean) => {
      shell?.querySelectorAll<HTMLElement>(`.reader-bar > [data-action='${name}'], .reader-bar > .bar-more > [data-action='${name}']`).forEach((button) => { button.hidden = !on; });
    };
    const one = Boolean(data);
    ["reply", "reply-all", "forward", "delete", "m-flag", "m-move", "m-more", "m-prev", "m-next", "unread"].forEach((name) => show(name, one));
    show("archive", one && Boolean(data?.place.archive));
    show("m-spam", one && Boolean(data?.place.spam) && !data?.place.inSpam);
    show("m-notspam", one && Boolean(data?.place.inSpam));
    if (!data) return;
    const flag = shell.querySelector(".reader-bar > [data-action='m-flag']") as HTMLElement | null;
    if (flag) {
      flag.setAttribute("aria-pressed", data.flagged ? "true" : "false");
      flag.innerHTML = withIcon(data.flagged ? "flag-filled" : "flag", data.flagged ? "Markiert" : "Markieren");
    }
    const unread = shell.querySelector(".reader-bar > [data-action='unread']") as HTMLElement | null;
    if (unread) {
      unread.innerHTML = withIcon(data.seen ? "mark-unread" : "mark-read", data.seen ? "Ungelesen" : "Gelesen");
      unread.title = data.seen ? "Als ungelesen markieren (U)" : "Als gelesen markieren (U)";
    }
    const del = shell.querySelector(".reader-bar > [data-action='delete']") as HTMLElement | null;
    if (del) del.title = data.place.inTrash ? "Endgültig löschen" : t("GLOBAL.DELETE", "Löschen");
    const menuShow = (name: string, on: boolean) => {
      const item = shell?.querySelector(`#more-menu [data-action='${name}']`) as HTMLElement | null;
      if (item) item.hidden = !on;
    };
    menuShow("m-edit-draft", data.place.inDrafts);
    shell.querySelectorAll<HTMLElement>("#more-menu [data-narrow='spam']").forEach((item) => { item.hidden = !(data.place.spam && !data.place.inSpam); });
    shell.querySelectorAll<HTMLElement>("#more-menu [data-narrow='notspam']").forEach((item) => { item.hidden = !data.place.inSpam; });
    menuShow("m-unsubscribe", data.unsubscribe);
    menuShow("m-mode", data.canToggleMode);
    menuShow("m-delete-forever", !data.place.inTrash);
    const mode = shell.querySelector("#more-menu [data-action='m-mode']") as HTMLElement | null;
    if (mode) mode.innerHTML = `${icon("source")}<span>${data.mode === "html" ? "Nur Text anzeigen" : "HTML anzeigen"}</span>`;
    const swap = shell.querySelector("#more-menu [data-action='m-swap']") as HTMLElement | null;
    if (swap) swap.innerHTML = `${icon("eye")}<span>${data.swap ? "Originalfarben" : "Farben umkehren"}</span>`;
  }

  function setSidebar(open: boolean): void {
    if (shell) shell.dataset.sidebar = open ? "open" : "closed";
  }

  function closeMenu(): void {
    shell?.querySelectorAll<HTMLElement>("#account-menu, #more-menu, #addr-menu, #folder-menu, #view-menu").forEach((menu) => { menu.hidden = true; });
    shell?.querySelectorAll<HTMLElement>("[data-action='account'], [data-action='m-more'], [data-action='f-menu'], [data-action='view-menu']").forEach((button) => {
      button.setAttribute("aria-expanded", "false");
    });
  }

  function anyMenuOpen(): boolean {
    return Boolean(shell?.querySelector("#account-menu:not([hidden]), #more-menu:not([hidden]), #addr-menu:not([hidden]), #folder-menu:not([hidden]), #view-menu:not([hidden])"));
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
    (menu.querySelector("button") as HTMLButtonElement | null)?.focus({ preventScroll: true });
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
    opener?.focus({ preventScroll: true });
    opener = null;
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

    const setListWidth = (px: number) => {
      const next = Math.min(640, Math.max(288, Math.round(px)));
      shell?.style.setProperty("--list-w", `${next}px`);
      separator.setAttribute("aria-valuenow", String(next));
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
          renderReader(body, lastReader, expanded);
          body.scrollTop = top;
          (body.querySelector("[data-action='m-details']") as HTMLElement | null)?.focus({ preventScroll: true });
        }
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
        snap = null;
        paintSettings();
        (shell?.querySelector("#settings") as HTMLDialogElement).showModal();
        void actions.settings?.("open", {});
      } else if (action === "preview-sound") {
        const name = (shell?.querySelector("[data-pref='NotificationSound']") as HTMLSelectElement | null)?.value || "new-mail";
        const audio = new Audio(`${location.pathname.replace(/\/+$/, "")}/snappymail/v/0.0.0/static/sounds/${encodeURIComponent(name)}.mp3`);
        void audio.play().catch(() => undefined);
      } else if (action === "assist-revoke") {
        const box = shell?.querySelector<HTMLInputElement>("input[name='notice_ack']");
        if (box) box.checked = false;
        void actions.settings?.("assist-save", { notice_ack: "" });
      } else if (action === "settings-move") {
        const list = target.dataset.list || "";
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
          name: target.dataset.name || ""
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
      else if (action === "close-dialog") (target.closest("dialog") as HTMLDialogElement | null)?.close();
      else if (action === "search") { /* form */ }
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
        area.value = "";
      } else if (form.dataset.action === "settings-form") {
        event.preventDefault();
        const data: Record<string, string> = {};
        new FormData(form).forEach((value, key) => { data[key] = String(value); });
        form.querySelectorAll<HTMLInputElement>("input[type='checkbox']").forEach((box) => {
          data[box.name] = box.checked ? "1" : "";
        });
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
        const bookMenu = shell.querySelector<HTMLElement>("#book-menu:not([hidden]), #book-add:not([hidden])");
        if (bookMenu) {
          bookMenu.hidden = true;
          const opener = shell.querySelector<HTMLElement>(bookMenu.id === "book-add" ? "[data-op='add-menu']" : "[data-op='more']");
          opener?.setAttribute("aria-expanded", "false");
          opener?.focus({ preventScroll: true });
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
      else if (key === "c") { event.preventDefault(); actions.compose(); }
      else if (key === "r") { event.preventDefault(); actions.reply(false); }
      else if (key === "a") { event.preventDefault(); actions.reply(true); }
      else if (key === "f") { event.preventDefault(); actions.forward(); }
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

  function installAssist(flags: AssistFlags): void {
    shell?.querySelectorAll("[data-assist-node]").forEach((node) => node.remove());
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
      const cats = [["all", "Alle"], ...Object.entries(CATEGORY)] as [string, string][];
      filters.innerHTML = cats.map(([id, label], index) =>
        `<button type="button" class="filter" data-action="cat" data-cat="${id}" aria-pressed="${index === 0 ? "true" : "false"}">${esc(id === "all" ? t("AI_COPILOT.TAB_ALL", label) : t("AI_COPILOT.CAT_" + id.toUpperCase(), label))}</button>`
      ).join("") + (flags.triageLlm ? `<button type="button" class="text-btn" data-action="triage">${esc(t("AI_COPILOT.TRIAGE_LLM", "Mit KI einordnen"))}</button>` : "");
      searchForm.after(filters);
    }
    if (flags.search && searchForm) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "text-btn";
      button.dataset.action = "lang-search";
      button.hidden = true;
      button.textContent = "Als Sprache verstehen";
      searchForm.append(button);
      const hint = document.createElement("div");
      hint.id = "translated";
      hint.hidden = true;
      hint.className = "translate";
      hint.innerHTML = `<p class="quiet" id="translate-why"></p><input class="search" id="translate-q" aria-label="Übersetzte Suche"><button type="button" class="text-btn" data-action="run-search">Suchen</button>`;
      searchForm.after(hint);
      const input = shell.querySelector("#search") as HTMLInputElement;
      input.addEventListener("input", () => { button.hidden = !input.value.trim(); });
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
      ask.innerHTML = withIcon("assist", t("AI_COPILOT.ASK_COPILOT", "Copilot fragen"));
      ask.classList.add("bar-btn", "primary");
      ask.title = t("AI_COPILOT.ASK_COPILOT", "Copilot fragen");
      shell.querySelector(".reader-bar")?.append(ask);
      const sheet = document.createElement("aside");
      sheet.className = "sheet";
      sheet.hidden = true;
      sheet.innerHTML = `
        <div class="sheet-head">
          <span class="title title-md">${esc(t("AI_COPILOT.ASK_COPILOT", "Copilot fragen"))}</span>
          <span class="mono quiet">${esc(flags.provider)}</span>
          <span class="spacer"></span>
          <button type="button" class="icon-btn" data-action="close-sheet" aria-label="${esc(t("GLOBAL.CLOSE", "Schließen"))}">${icon("close")}</button>
        </div>
        <div class="sheet-log" id="chat-log">
          <p class="quiet">${esc(t("AI_COPILOT.CHAT_EMPTY", "Fragen Sie zum Beispiel, welche Mails auf eine Antwort warten."))}</p>
          <div class="prompts">
            <button type="button" class="prompt" data-action="prompt">Welche Mails warten auf meine Antwort?</button>
            <button type="button" class="prompt" data-action="prompt">Zeig mir Rechnungen vom letzten Monat</button>
            <button type="button" class="prompt" data-action="prompt">Fasse die geöffnete Mail zusammen</button>
          </div>
        </div>
        <button type="button" class="text-btn" data-action="drop-context" id="context-chip" hidden></button>
        <form class="sheet-form" data-action="ask">
          <textarea id="ask" rows="2" placeholder="${esc(t("AI_COPILOT.CHAT_PLACEHOLDER", "Nachricht an Copilot …"))}"></textarea>
          <button type="submit" class="ink-btn">${esc(t("AI_COPILOT.SEND", "Senden"))}</button>
        </form>
        <p class="error" id="chat-error" hidden></p>`;
      shell.querySelector(".reader")?.append(sheet);
    }
    if (flags.draft) {
      const tools = document.createElement("div");
      tools.className = "draft-tools";
      const tones = [["professional", "Professionell"], ["friendly", "Freundlich"], ["casual", "Locker"], ["concise", "Knapp"], ["formal", "Förmlich"]];
      tools.innerHTML = `
        <div class="modes" role="toolbar" aria-label="Art">
          <button type="button" class="seg" data-action="mode" data-mode="new" aria-pressed="true">Neue Mail</button>
          <button type="button" class="seg" data-action="mode" data-mode="reply" aria-pressed="false">Antwort</button>
          <button type="button" class="seg" data-action="mode" data-mode="rewrite" aria-pressed="false">Umschreiben</button>
          <button type="button" class="seg" data-action="mode" data-mode="proofread" aria-pressed="false">Korrektur</button>
        </div>
        <label class="field"><span>Anweisung</span><input id="instruction" type="text" placeholder="${esc(t("AI_COPILOT.INSTRUCTION_PLACEHOLDER", "Was soll die Mail sagen?"))}"></label>
        <div class="tones" role="toolbar" aria-label="Ton">
          ${tones.map(([id, label], index) => `<button type="button" class="seg" data-action="tone" data-tone="${id}" aria-pressed="${index === 0 ? "true" : "false"}">${esc(t("AI_COPILOT.TONE_" + id.toUpperCase(), label))}</button>`).join("")}
        </div>
        <div class="draft-actions">
          <button type="button" class="text-btn" data-action="generate">${withIcon("assist", t("AI_COPILOT.GENERATE", "Erzeugen"))}</button>
          <button type="button" class="text-btn" data-action="stop-generate" hidden>${withIcon("stop", t("AI_COPILOT.STOP", "Stopp"))}</button>
          <button type="button" class="text-btn" data-action="revert-draft" hidden>Zurück</button>
        </div>
        <p class="subject-hint" id="subject-hint" hidden><span></span><button type="button" class="text-btn" data-action="apply-subject">${esc(t("AI_COPILOT.APPLY_SUBJECT", "Übernehmen"))}</button></p>
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
          <button type="button" class="text-btn" value="cancel">${esc(t("GLOBAL.CANCEL", "Abbrechen"))}</button>
          <button type="button" class="ink-btn" value="ok">Fortfahren</button>
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
        (shell.querySelector("#folder-title") as HTMLElement).textContent = data.currentName;
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
      const clearBtn = shell?.querySelector("[data-action='clear-search']") as HTMLButtonElement | null;
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
          <div class="msg-row${row.threadCount ? " has-thread" : ""}${row.checked ? " checked" : ""}${row.deleted ? " deleted" : ""}">
            <input type="checkbox" class="msg-check" data-action="m-check" data-ref="${row.uid}"${row.checked ? " checked" : ""} aria-label="Auswählen: ${esc(subject)}">
            <button type="button" class="msg${row.unseen ? " unseen" : ""}" data-uid="${row.uid}" draggable="true" aria-current="${row.current ? "true" : "false"}">
              <span class="who">${esc(row.who)}</span>
              <span class="when">${rowMarks({ ...row, flagged: false })}${esc(row.when)}</span>
              <span class="subj">${esc(subject)}${categoryMark(row.category)}</span>
              <span class="peek">${esc(row.preview)}</span>
            </button>
            ${thread}
            <button type="button" class="msg-flag" data-action="m-flag" data-ref="${row.uid}" aria-pressed="${row.flagged ? "true" : "false"}" aria-label="${row.flagged ? "Markierung entfernen" : "Markieren"}: ${esc(subject)}" title="${row.flagged ? "Markierung entfernen" : "Markieren"}">${icon(row.flagged ? "flag-filled" : "flag")}</button>
          </div>`;
        }).join("");
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
      if (shell) shell.dataset.reading = data ? "1" : "0";
      const body = shell?.querySelector("#reader-body") as HTMLElement | null;
      const addContact = shell?.querySelector("[data-action='m-addr-contact']") as HTMLElement | null;
      if (addContact) addContact.hidden = !data?.contacts;
      paintBar(data);
      if (!body) return;
      body.replaceChildren();
      const say = (className: string, text: string) => {
        const p = document.createElement("p");
        p.className = className;
        p.textContent = text;
        body.append(p);
      };
      if (loading) return say("quiet", loading);
      if (error) return say("error", error);
      if (!data) return say("empty", "Wählen Sie eine Mail.");
      renderReader(body, data, expanded);
      body.scrollTop = 0;
    },
    setBulk(data) {
      const body = shell?.querySelector("#reader-body") as HTMLElement | null;
      paintBar(null);
      if (body) renderBulk(body, data);
      if (!wide()) pane("reader");
    },
    setChecks(visible) {
      shell?.classList.toggle("with-checks", visible);
    },
    setRefreshing(busy) {
      const button = shell?.querySelector("[data-action='m-refresh']") as HTMLButtonElement | null;
      if (!button) return;
      button.disabled = busy;
      button.innerHTML = icon(busy ? "loading" : "refresh");
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
      const dialog = shell?.querySelector("#prompt-dlg") as HTMLDialogElement | null;
      if (!dialog) return Promise.resolve(null);
      const input = dialog.querySelector("#prompt-input") as HTMLInputElement;
      const form = dialog.querySelector("form") as HTMLFormElement;
      (dialog.querySelector("#prompt-title") as HTMLElement).textContent = title;
      (dialog.querySelector("#prompt-label") as HTMLElement).textContent = label;
      input.value = value;
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
          resolve(dialog.returnValue === "ok" ? input.value.trim() : null);
        }, { once: true });
      });
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
    openCompose(seed) { composer?.open(seed); },
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
      const row = document.createElement("div");
      row.className = "strip-row";
      if (!state.tldr && state.showSummarize) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "text-btn";
        button.dataset.action = "summarize";
        button.textContent = t("AI_COPILOT.SUMMARIZE", "Zusammenfassen");
        row.append(button);
      } else if (state.tldr) {
        const label = document.createElement("span");
        label.className = "mono";
        label.textContent = "Zusammenfassung";
        const text = document.createElement("p");
        text.textContent = state.tldr;
        const again = document.createElement("button");
        again.type = "button";
        again.className = "text-btn";
        again.dataset.action = "summarize";
        again.dataset.force = "1";
        again.textContent = t("AI_COPILOT.REGENERATE", "Neu erzeugen");
        row.append(label, text, again);
        if (state.cached) {
          const note = document.createElement("p");
          note.className = "quiet";
          note.textContent = "aus dem Zwischenspeicher";
          row.append(note);
        }
        const caveat = document.createElement("p");
        caveat.className = "quiet";
        caveat.textContent = "Kann Angaben enthalten, die so nicht in der Mail stehen. Der Brief darunter ist die Quelle.";
        row.append(caveat);
      }
      if (state.showReplies && !state.replies.length) {
        const replies = document.createElement("button");
        replies.type = "button";
        replies.className = "text-btn";
        replies.dataset.action = "replies";
        replies.textContent = t("AI_COPILOT.QUICK_REPLIES", "Antwortvorschläge");
        row.append(replies);
      }
      state.replies.forEach((reply, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "prompt";
        button.dataset.action = "use-reply";
        button.dataset.index = String(index);
        button.textContent = reply.label;
        row.append(button);
      });
      if (state.model) {
        const model = document.createElement("p");
        model.className = "mono quiet";
        model.textContent = state.model;
        row.append(model);
      }
      strip.append(row);
    },
    setChat(turns, thinking, context = "") {
      const log = shell?.querySelector("#chat-log");
      const chip = shell?.querySelector("#context-chip") as HTMLButtonElement | null;
      const error = shell?.querySelector("#chat-error") as HTMLElement | null;
      if (chip) {
        chip.hidden = !context;
        chip.textContent = context ? `${context} · ohne Bezug` : "";
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
        ["Welche Mails warten auf meine Antwort?", "Zeig mir Rechnungen vom letzten Monat", "Fasse die geöffnete Mail zusammen"].forEach((text) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "prompt";
          button.dataset.action = "prompt";
          button.textContent = text;
          prompts.append(button);
        });
        log.append(p, prompts);
      }
      turns.forEach((turn) => {
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
          label.textContent = action.label;
          card.append(label);
          if (!action.state) {
            const run = document.createElement("button");
            run.type = "button";
            run.className = "text-btn";
            run.dataset.action = "run-action";
            run.dataset.index = String(index);
            run.textContent = t("AI_COPILOT.RUN", "Ausführen");
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
        body: composer?.body() || "",
        subject: composer?.subject() || ""
      };
    },
    setDraftBody(text) { composer?.setBody(text); },
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
      if (shell) shell.dataset.layout = String(mode);
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
      slot.textContent = "";
      slot.textContent = t("GLOBAL.SAVED", "Gespeichert");
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
