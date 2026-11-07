import type { AssistFlags } from "./assistant";
import { Composer, type ComposeFile, type ComposeIdentity, type ComposePreferences, type ComposeSeed, type ComposeValues } from "./compose";
import { icon, type IconName } from "./icons";
import { t } from "./i18n";
import { renderBulk, renderReader, type BulkData, type ReaderData } from "./reader";
import { renderDesk, type DeskEdit, type SettingsSnapshot } from "./settings";
import { applyAppearance, type Appearance } from "./theme";

export type { ComposeFile, ComposeSeed } from "./compose";

export interface FolderRow {
  fullName: string;
  name: string;
  depth: number;
  unread: number;
  current: boolean;
  inbox: boolean;
  role: string;
}

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
  showLogin(title: string): void;
  setLoginBusy(busy: boolean): void;
  setLoginError(text: string): void;
  showMail(email: string, folderName: string, assist?: AssistFlags | null): void;
  setFolders(rows: FolderRow[]): void;
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
}

export function createView(root: HTMLElement, actions: MailActions): MailView {
  let shell: HTMLElement | null = null;
  let opener: HTMLElement | null = null;
  let section = "look";
  let edit: DeskEdit | null = null;
  let snap: SettingsSnapshot | null = null;
  let composer: Composer | null = null;
  let composePrefs: ComposePreferences = {
    editor: "Plain", markdown: false, spellcheck: false, autosave: true, draftsFolder: "", sentFolder: "",
    replySameFolder: false, attachmentLimit: 0, readReceipt: false, dsn: false, requireTLS: false, pgpSign: false, pgpEncrypt: false
  };
  let composeIdentities: ComposeIdentity[] = [];

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

  const showMail: MailView["showMail"] = (email, folderName, assist) => {
    root.innerHTML = `
      <div class="shell" data-pane="list" data-sidebar="${docked() ? "open" : "closed"}">
        <button type="button" class="scrim" data-action="close-sidebar" aria-label="Ordner schließen"></button>
        <aside class="sidebar" aria-label="Ordner">
          <div class="account">
            <button type="button" class="account-btn" data-action="account" aria-expanded="false" aria-controls="account-menu" aria-haspopup="menu"></button>
            <div class="menu" id="account-menu" role="menu" hidden>
              <div id="account-list"></div>
              <button type="button" class="menu-item" role="menuitem" data-action="settings">${icon("settings")}<span>${esc(t("GLOBAL.SETTINGS", "Einstellungen"))}</span></button>
              <button type="button" class="menu-item" role="menuitem" data-action="logout">${icon("logout")}<span>${esc(t("GLOBAL.LOGOUT", "Abmelden"))}</span></button>
            </div>
          </div>
          <p class="group-label mono">${esc(t("FOLDER_LIST.INBOX_NAME", "Posteingang"))}</p>
          <div id="folder-inbox"></div>
          <p class="group-label mono">Ordner</p>
          <div id="folder-rest"></div>
        </aside>
        <section class="list-pane" aria-label="Mails">
          <div class="pane-head">
            <button type="button" class="icon-btn" data-action="toggle-sidebar" aria-label="Ordner ein- oder ausblenden">${icon("menu")}</button>
            <h1 class="title title-md" id="folder-title"></h1>
            <span class="spacer"></span>
            <button type="button" class="icon-btn" data-action="m-select-all" aria-label="Alle auswählen" title="Alle auswählen (Strg+A)">${icon("select-all")}</button>
            <button type="button" class="icon-btn" data-action="m-refresh" aria-label="Aktualisieren" title="Aktualisieren">${icon("refresh")}</button>
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
                <button type="button" class="text-btn" data-action="settings-section" data-section="accounts">${withIcon("users", t("SETTINGS_LABELS.ACCOUNTS", "Konten"))}</button>
                <button type="button" class="text-btn" data-action="settings-section" data-section="identities">${withIcon("identity", t("SETTINGS_ACCOUNTS.LEGEND_IDENTITIES", "Identitäten"))}</button>
                <button type="button" class="text-btn" data-action="settings-section" data-section="contacts" hidden>${withIcon("contacts", t("SETTINGS_LABELS.CONTACTS", "Kontakte"))}</button>
                <button type="button" class="text-btn" data-action="settings-section" data-section="filters" hidden>${withIcon("filter", t("SETTINGS_LABELS.FILTERS", "Filter"))}</button>
                <button type="button" class="text-btn" data-action="settings-section" data-section="keys">${withIcon("key", t("SETTINGS_DESK.KEYS", "Schlüssel"))}</button>
              </nav>
            </div>
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
              <li><span>Senden im Editor</span><kbd>Strg</kbd> <kbd>Enter</kbd></li>
              <li><span>Entwurf speichern</span><kbd>Strg</kbd> <kbd>S</kbd></li>
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
        <ul class="menu addr-menu" id="addr-menu" role="menu" hidden>
          <li><button type="button" class="menu-item" role="menuitem" data-action="m-addr-write">${icon("compose")}<span>Mail schreiben</span></button></li>
          <li><button type="button" class="menu-item" role="menuitem" data-action="m-addr-copy">${icon("copy")}<span>Adresse kopieren</span></button></li>
          <li><button type="button" class="menu-item" role="menuitem" data-action="m-addr-search">${icon("search")}<span>Mails von dieser Adresse</span></button></li>
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
    shell?.querySelectorAll<HTMLElement>("#account-menu, #more-menu, #addr-menu").forEach((menu) => { menu.hidden = true; });
    shell?.querySelectorAll<HTMLElement>("[data-action='account'], [data-action='m-more']").forEach((button) => {
      button.setAttribute("aria-expanded", "false");
    });
  }

  function anyMenuOpen(): boolean {
    return Boolean(shell?.querySelector("#account-menu:not([hidden]), #more-menu:not([hidden]), #addr-menu:not([hidden])"));
  }

  let addrTarget: { email: string; name: string } = { email: "", name: "" };

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
    opener?.focus();
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
      if (anyMenuOpen() && !target?.closest(".account, .bar-more, #addr-menu")) closeMenu();
      if (!target) return;
      const action = target.dataset.action;
      if (target.classList.contains("menu-item") && target.closest("#more-menu")) closeMenu();
      if (target.dataset.folder) {
        actions.selectFolder(target.dataset.folder);
        if (!wide()) pane("list");
        if (!docked()) setSidebar(false);
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
      } else if (action === "m-address") {
        openAddrMenu(target);
      } else if (action === "m-addr-write" || action === "m-addr-copy" || action === "m-addr-search") {
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

    shell.addEventListener("change", (event) => {
      const input = event.target as HTMLInputElement;
      if (input.name === "appearance") applyAppearance(input.value as Appearance);
    });

    if (keyHandler) document.removeEventListener("keydown", keyHandler);
    keyHandler = (event: KeyboardEvent) => {
      if (!shell?.isConnected) return;
      const typing = (event.target instanceof HTMLInputElement && !["checkbox", "radio", "button"].includes(event.target.type))
        || event.target instanceof HTMLTextAreaElement
        || event.target instanceof HTMLSelectElement
        || (event.target instanceof HTMLElement && event.target.isContentEditable);
      if (event.key === "Escape") {
        if (shell?.querySelector("dialog[open]")) return;
        if (anyMenuOpen()) { closeMenu(); return; }
        if (shell?.dataset.full === "true") { toggleFullscreen(false); return; }
        if (!docked() && shell?.dataset.sidebar === "open") setSidebar(false);
        return;
      }
      if (typing || shell.querySelector("dialog[open]")) return;
      const focusedControl = event.target instanceof HTMLButtonElement
        && !event.target.dataset.uid
        && !event.target.dataset.folder;
      if (focusedControl && (event.key === "Enter" || event.key === " ")) return;
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
      else if (key === "u") actions.unread();
      else if (key === "m") { event.preventDefault(); actions.act("move", {}); }
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
  }

  function paintSettings(): void {
    const panel = shell?.querySelector("#settings-panel");
    if (!panel) return;
    shell?.querySelectorAll<HTMLButtonElement>("[data-section]").forEach((button) => {
      const id = button.dataset.section || "";
      button.setAttribute("aria-pressed", id === section ? "true" : "false");
      if (id === "contacts") button.hidden = !snap?.caps.contacts;
      if (id === "filters") button.hidden = !snap?.caps.sieve;
    });
    panel.innerHTML = renderDesk(section, snap, edit);
    if (edit) {
      const field = panel.querySelector("input:not([type='hidden']), textarea") as HTMLElement | null;
      field?.focus({ preventScroll: true });
    }
  }

  function folderButton(row: FolderRow): string {
    const count = row.unread > 0 ? `<span class="count">${row.unread}</span>` : "";
    return `<button type="button" class="folder" data-folder="${esc(row.fullName)}" aria-current="${row.current ? "page" : "false"}" style="padding-left:${8 + row.depth * 12}px">${icon(ROLE_ICON[row.role] || (row.inbox ? "inbox" : "folder"))}<span class="folder-name">${esc(row.name)}</span>${count}</button>`;
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
      if (inboxEl) inboxEl.innerHTML = inbox.map(folderButton).join("") || `<button type="button" class="folder" data-folder="INBOX">${icon("inbox")}<span class="folder-name">Posteingang</span></button>`;
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
        box.innerHTML = rows.map((row) => {
          const subject = row.subject || "(ohne Betreff)";
          return `
          <div class="msg-row${row.checked ? " checked" : ""}${row.deleted ? " deleted" : ""}">
            <input type="checkbox" class="msg-check" data-action="m-check" data-ref="${row.uid}"${row.checked ? " checked" : ""} aria-label="Auswählen: ${esc(subject)}">
            <button type="button" class="msg${row.unseen ? " unseen" : ""}" data-uid="${row.uid}" draggable="true" aria-current="${row.current ? "true" : "false"}">
              <span class="who">${esc(row.who)}</span>
              <span class="when">${rowMarks({ ...row, flagged: false })}${esc(row.when)}</span>
              <span class="subj">${esc(subject)}${categoryMark(row.category)}</span>
              <span class="peek">${esc(row.preview)}</span>
            </button>
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
      const body = shell?.querySelector("#reader-body") as HTMLElement | null;
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
      const dialog = shell?.querySelector("#confirm") as HTMLDialogElement | null;
      if (!dialog) return Promise.resolve(false);
      (dialog.querySelector("#confirm-title") as HTMLElement).textContent = title;
      const p = dialog.querySelector("#confirm-text") as HTMLElement;
      p.hidden = !text;
      p.textContent = text;
      const button = dialog.querySelector("#confirm-ok") as HTMLButtonElement;
      button.className = danger ? "danger" : "ink-btn";
      button.innerHTML = withIcon(danger ? "delete" : "check", ok);
      dialog.returnValue = "";
      dialog.showModal();
      return new Promise((resolve) => {
        dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok"), { once: true });
      });
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
    showSettings(next) {
      snap = next;
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
