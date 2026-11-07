import { readAssist, type AssistFlags } from "./assistant";
import {
  ApiError, call, explain, fetchDataUrl, fetchText, fileHash, loadApp, messageHash, plugin, proxyUrl, rawUrl, streamEvents
} from "./api";
import { cleanHtml, externalUrls, fillInline, originalLinks, plainToHtml, revealExternals } from "./clean";
import { openLetterWindow, parseIcs, parseMailto, parseUnsubscribe, srcdoc, type CalendarEvent } from "./letter";
import type { ReaderFile, ReaderPlace } from "./reader";
import { applyDesk, loadDesk, readCaps, writeProp, type Caps, type IdentityRow, type SettingsSnapshot } from "./settings";
import type { ComposeValues } from "./compose";
import {
  createView, type ChatTurn, type ComposeSeed, type FolderRow, type MailView, type MessageRow,
  type PickerFolder, type ReaderData, type StripState
} from "./view";

interface Person { name: string; email: string }
interface Folder {
  fullName: string;
  name: string;
  delimiter: string;
  role: string;
  unread: number;
  total: number;
  uidNext: number;
}
interface MsgFile {
  name: string;
  size: number;
  mimeType: string;
  mimeIndex: string;
  cid: string;
  location: string;
  inline: boolean;
  hash: string;
  href: string;
}
interface Msg {
  uid: number;
  folder: string;
  hash: string;
  subject: string;
  preview: string;
  from: Person[];
  to: Person[];
  cc: Person[];
  bcc: Person[];
  replyTo: Person[];
  date: number;
  size: number;
  flags: string[];
  messageId: string;
  references: string;
  html: string;
  plain: string;
  attachments: MsgFile[];
  hasAttachment: boolean;
  category: string;
  spamScore: number;
  spamResult: string;
  isSpam: boolean;
  hasVirus: boolean;
  readReceipt: string;
  headers: Record<string, string>;
  auth: { spf: string; dkim: string; dmarc: string };
}

interface ListResult {
  "@Collection"?: Record<string, unknown>[];
  totalEmails?: number;
  offset?: number;
  folder?: { totalEmails?: number; unreadEmails?: number; uidNext?: number };
}

/** Einstellungen aus den AppData, die Liste und Brief beeinflussen. */
interface Prefs {
  viewImages: string;
  whitelist: string;
  proxy: boolean;
  removeColors: boolean;
  allowStyles: boolean;
  minFontSize: number;
  maxBlockquotes: number;
  collapseBlockquotes: boolean;
  viewHtml: boolean;
  hideDeleted: boolean;
  showNext: boolean;
  readAuto: boolean;
  readDelay: number;
  checkInterval: number;
  showUnreadCount: boolean;
  desktop: boolean;
  sound: boolean;
  soundName: string;
  useChecks: boolean;
  listInline: boolean;
  simpleFiles: boolean;
  newWindow: boolean;
  zip: boolean;
  thumbs: boolean;
  webPath: string;
}

const PAGE_FALLBACK = 20;
const SYSTEM_FLAGS = /^(\\|\$ai_|\$forwarded$|\$mdnsent$|\$junk$|\$notjunk$|\$label|nonjunk$|junk$|\$phishing$|\$submitpending$|\$submitted$|\$hasattachment$|\$hasnoattachment$|\$important$|\$muted$|\$followed$)/i;

function people(value: unknown): Person[] {
  const list = Array.isArray(value)
    ? value
    : value && typeof value === "object" ? (value as { "@Collection"?: unknown[] })["@Collection"] : null;
  if (!Array.isArray(list)) return [];
  return list.map((item) => {
    const row = (item || {}) as Record<string, unknown>;
    return { name: String(row.name || ""), email: String(row.email || "") };
  }).filter((item) => item.email || item.name);
}

function collection(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  if (value && typeof value === "object") {
    const list = (value as { "@Collection"?: unknown }) ["@Collection"];
    if (Array.isArray(list)) return list as Record<string, unknown>[];
  }
  return [];
}

function label(person: Person): string {
  return person.name || person.email;
}

function address(person: Person): string {
  if (!person.email) return person.name;
  return person.name ? `${person.name} <${person.email}>` : person.email;
}

function when(stamp: number): string {
  if (!stamp) return "";
  const date = new Date(stamp * 1000);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { day: "numeric", month: "short" });
}

function whenFull(stamp: number): string {
  if (!stamp) return "";
  return new Date(stamp * 1000).toLocaleString([], { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function hasFlag(flags: string[], name: string): boolean {
  return flags.some((flag) => flag.toLowerCase() === name);
}

function seen(flags: string[]): boolean {
  return hasFlag(flags, "\\seen");
}

function plainFromHtml(html: string): string {
  return new DOMParser().parseFromString(html, "text/html").body.textContent || "";
}

function quote(body: string): string {
  return body.replace(/\r\n/g, "\n").split("\n").map((line) => `> ${line}`).join("\n");
}

function sizeLabel(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileKind(file: MsgFile): ReaderFile["kind"] {
  const type = file.mimeType.toLowerCase();
  const name = file.name.toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (type === "text/calendar" || name.endsWith(".ics")) return "calendar";
  if (type.startsWith("text/") || /\.(txt|csv|log|md)$/.test(name)) return "text";
  if (/zip|compressed|tar|rar|7z/.test(type) || /\.(zip|rar|7z|tgz|gz)$/.test(name)) return "archive";
  return "other";
}

function authStatus(value: unknown): string {
  const first = Array.isArray(value) ? value[0] : null;
  return Array.isArray(first) ? String(first[0] || "") : "";
}

export async function boot(root: HTMLElement): Promise<void> {
  const session = new Session(root);
  try {
    await session.start(await loadApp());
  } catch (error) {
    root.replaceChildren(Object.assign(document.createElement("p"), {
      className: "error",
      textContent: explain(error)
    }));
  }
}

class Session {
  private view: MailView;
  private email = "";
  private accountHash = "";
  private sentFolder = "";
  private archiveFolder = "";
  private pageSize = PAGE_FALLBACK;
  private folders: Folder[] = [];
  private folder = "INBOX";
  private messages: Msg[] = [];
  private total = 0;
  private offset = 0;
  private search = "";
  private selected = 0;
  private hasMore = false;
  private current: Msg | null = null;
  private replyKind: "" | "reply" | "reply-all" | "forward" = "";
  private assistFlags: AssistFlags | null = null;
  private noticeAck = false;
  private useContext = true;
  private chat: { role: "user" | "assistant"; content: string }[] = [];
  private turns: ChatTurn[] = [];
  private chatActions: Record<string, unknown>[] = [];
  private replies: { label: string; body: string }[] = [];
  private draftBackup = "";
  private draftAbort: AbortController | null = null;
  private tagged = new Set<string>();
  private alertItems: { folder: string; uid: number; type: string; title: string }[] = [];
  private category = "all";
  /** Laufende Nummer der Listenanfragen. */
  private listSeq = 0;
  private mainEmail = "";
  private caps: Caps = { accounts: false, identities: false, contacts: false, sieve: false, openpgp: false, gnupg: false };
  private desk: SettingsSnapshot | null = null;
  private contactSearch = "";
  private prefs: Prefs = {
    viewImages: "ask", whitelist: "", proxy: false, removeColors: false, allowStyles: false, minFontSize: 5,
    maxBlockquotes: 0, collapseBlockquotes: true, viewHtml: true, hideDeleted: true, showNext: false, readAuto: true,
    readDelay: 5, checkInterval: 15, showUnreadCount: false, desktop: true, sound: true, soundName: "new-mail",
    useChecks: true, listInline: false, simpleFiles: false, newWindow: false, zip: false, thumbs: false, webPath: ""
  };
  private trashFolder = "";
  private junkFolder = "";
  private draftsFolder = "";
  private checked = new Set<number>();
  private anchor = 0;
  private readTimer = 0;
  private pollTimer = 0;
  private lastPoll = 0;
  private inboxUid = 0;
  private inboxUnread = -1;
  private letter = { uid: 0, mode: "html" as "html" | "plain", images: false, links: false, swap: false };
  private inlineCache = new Map<string, string>();
  private calendarCache = new Map<string, CalendarEvent | null>();
  private receiptSkipped = new Set<string>();
  private draftRef: { folder: string; uid: number } | null = null;
  private composeData: Record<string, unknown> = {};
  private identities: IdentityRow[] = [];
  private renderToken = 0;

  constructor(root: HTMLElement) {
    window.addEventListener("sm-appearance", () => { if (this.current) void this.paintLetter(); });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && this.email && Date.now() - this.lastPoll > 60_000) void this.poll(false);
    });
    this.view = createView(root, {
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
      saveCompose: (values) => this.saveDraft(values),
      closeCompose: (discard) => { void this.closeCompose(discard); },
      back: () => undefined,
      assist: (name, data) => void this.assist(name, data),
      settings: (name, data) => this.settings(name, data),
      act: (name, data) => void this.act(name, data)
    });
  }

  async start(data: Record<string, unknown>): Promise<void> {
    const title = String(data.title || "SnappyMail");
    if (data.Auth) await this.enter(data);
    else this.view.showLogin(title);
  }

  private async login(email: string, password: string, stay: boolean): Promise<void> {
    if (!email.trim() || !password) {
      this.view.setLoginError("Adresse und Passwort eintragen.");
      return;
    }
    this.view.setLoginBusy(true);
    this.view.setLoginError("");
    try {
      const result = await call<Record<string, unknown>>("Login", {
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

  private async logout(): Promise<void> {
    try { await call("Logout"); } catch { /* the screen still returns to login */ }
    window.clearInterval(this.pollTimer);
    window.clearTimeout(this.readTimer);
    this.email = "";
    this.view.showLogin(document.title || "SnappyMail");
  }

  private readPrefs(data: Record<string, unknown>): void {
    const num = (value: unknown, fallback: number) => Number.isFinite(Number(value)) && value !== "" && value != null ? Number(value) : fallback;
    const bool = (value: unknown, fallback: boolean) => value == null ? fallback : Boolean(value);
    const capa = (data.Capa || {}) as Record<string, unknown>;
    const system = (data.System || {}) as Record<string, unknown>;
    const minInterval = Math.max(1, num(data.minRefreshInterval, 5));
    this.prefs = {
      viewImages: String(data.ViewImages || "ask"),
      whitelist: String(data.ViewImagesWhitelist || ""),
      proxy: Boolean(data.proxyExternalImages),
      removeColors: bool(data.RemoveColors, false),
      allowStyles: bool(data.AllowStyles, false),
      minFontSize: num(data.minFontSize, 5),
      maxBlockquotes: num(data.MaxBlockquotesLevel, 0),
      collapseBlockquotes: bool(data.CollapseBlockquotes, true),
      viewHtml: bool(data.ViewHTML, true),
      hideDeleted: bool(data.HideDeleted, true),
      showNext: bool(data.showNextMessage, false),
      readAuto: bool(data.messageReadAuto, true),
      readDelay: Math.max(0, num(data.MessageReadDelay, 5)),
      checkInterval: Math.max(minInterval, num(data.CheckMailInterval, 15)),
      showUnreadCount: bool(data.ShowUnreadCount, false),
      desktop: bool(data.DesktopNotifications, true),
      sound: bool(data.SoundNotification, true),
      soundName: String(data.NotificationSound || "new-mail"),
      useChecks: bool(data.UseCheckboxesInList, true),
      listInline: bool(data.ListInlineAttachments, false),
      simpleFiles: bool(data.simpleAttachmentsList, false),
      newWindow: bool(data.messageNewWindow, false),
      zip: Boolean(capa.AttachmentsActions),
      thumbs: Boolean(capa.AttachmentThumbnails),
      webPath: String(system.webVersionPath || "snappymail/v/0.0.0/")
    };
  }

  /** System-Ordner: Einstellung des Kontos, sonst Rolle vom Server, sonst üblicher Name. */
  private resolveSystemFolders(data: Record<string, unknown> | null): void {
    const known = (name: string) => Boolean(name) && this.folders.some((folder) => folder.fullName === name);
    const byRole = (...roles: string[]) => this.folders.find((folder) => roles.includes(folder.role.toLowerCase()))?.fullName || "";
    const byName = (...names: string[]) => this.folders.find((folder) => names.includes(folder.fullName.toLowerCase()) || names.includes(folder.name.toLowerCase()))?.fullName || "";
    const pick = (setting: unknown, roles: string[], names: string[]) => {
      const value = String(setting || "");
      return known(value) ? value : byRole(...roles) || byName(...names);
    };
    const src = data || {};
    this.sentFolder = pick(src.SentFolder ?? this.sentFolder, ["sent"], ["sent", "gesendet", "sent items", "gesendete elemente"]);
    this.draftsFolder = pick(src.DraftsFolder ?? this.draftsFolder, ["drafts"], ["drafts", "entwürfe", "entwurf"]);
    this.trashFolder = pick(src.TrashFolder ?? this.trashFolder, ["trash"], ["trash", "papierkorb", "deleted items", "gelöschte elemente"]);
    this.junkFolder = pick(src.JunkFolder ?? this.junkFolder, ["junk", "spam"], ["junk", "spam", "junk-e-mail"]);
    this.archiveFolder = pick(src.ArchiveFolder ?? this.archiveFolder, ["archive", "all"], ["archive", "archiv"]);
  }

  private place(): ReaderPlace {
    return {
      inSpam: Boolean(this.junkFolder) && this.folder === this.junkFolder,
      inTrash: !this.trashFolder || this.folder === this.trashFolder,
      inDrafts: Boolean(this.draftsFolder) && this.folder === this.draftsFolder,
      archive: Boolean(this.archiveFolder) && this.folder !== this.archiveFolder,
      spam: Boolean(this.junkFolder)
    };
  }

  private async enter(data: Record<string, unknown>): Promise<void> {
    this.email = String(data.Email || "");
    this.mainEmail = String(data.mainEmail || data.Email || "");
    this.caps = readCaps(data);
    this.accountHash = String(data.accountHash || "");
    this.sentFolder = String(data.SentFolder || "");
    this.archiveFolder = String(data.ArchiveFolder || "");
    this.draftsFolder = String(data.DraftsFolder || "");
    this.trashFolder = String(data.TrashFolder || "");
    this.junkFolder = String(data.JunkFolder || "");
    this.readPrefs(data);
    this.composeData = data;
    this.checked.clear();
    this.inboxUid = 0;
    this.inboxUnread = -1;
    const page = Number(data.MessagesPerPage || PAGE_FALLBACK);
    this.pageSize = Math.min(50, Math.max(10, page || PAGE_FALLBACK));
    document.title = this.email || String(data.title || "Postfach");
    this.assistFlags = await readAssist(data, async () => {
      const result = await plugin<{ settings: { enabled?: boolean; features?: Record<string, boolean>; notice_ack?: boolean } }>("AiGetSettings");
      return result.settings;
    });
    this.noticeAck = Boolean(this.assistFlags?.noticeAck);
    this.view.showMail(this.email, "Posteingang", this.assistFlags);
    this.view.setChecks(this.prefs.useChecks);
    if (this.assistFlags?.alerts) void this.loadAlerts();
    await this.loadFolders();
    await this.loadComposeIdentities();
    this.configureComposer();
    const mailto = String(data.mailToEmail || "");
    if (mailto) {
      const seed = parseMailto(mailto);
      this.view.openCompose({ title: "Neue Nachricht", to: seed.to, cc: seed.cc, bcc: seed.bcc, subject: seed.subject, body: seed.body, mode: "new" });
    }
    window.clearInterval(this.pollTimer);
    this.pollTimer = window.setInterval(() => { if (!document.hidden) void this.poll(false); }, this.prefs.checkInterval * 60_000);
  }

  private async settings(name: string, data: Record<string, string>): Promise<void> {
    try {
      if (name === "open") this.contactSearch = "";
      if (name === "search-contacts") this.contactSearch = data.search || "";
      if (name === "open" || name === "search-contacts") {
        this.desk = await loadDesk(this.caps, this.email, this.mainEmail, this.contactSearch);
        this.view.showSettings(this.desk);
        return;
      }
      if (!this.desk) return;
      const next = await applyDesk(name, data, this.desk);
      if (next === "session") {
        await this.enter(await loadApp());
        return;
      }
      this.desk = await loadDesk(this.caps, this.email, this.mainEmail, this.contactSearch);
      this.view.showSettings(this.desk);
    } catch (error) {
      this.view.settingsNotice(explain(error));
    }
  }

  private async loadFolders(): Promise<void> {
    try {
      const result = await call<{ "@Collection"?: Record<string, unknown>[] }>("Folders");
      this.folders = (result["@Collection"] || []).map((item) => ({
        fullName: String(item.fullName || ""),
        name: String(item.name || item.fullName || ""),
        delimiter: String(item.delimiter || "/"),
        role: String(item.role || ""),
        unread: Number(item.unreadEmails || 0),
        total: Number(item.totalEmails || 0),
        uidNext: Number(item.uidNext || 0)
      })).filter((folder) => folder.fullName);
      this.resolveSystemFolders(null);
      const inbox = this.folders.find((folder) => folder.role === "inbox" || folder.fullName.toUpperCase() === "INBOX");
      if (inbox) { this.inboxUid = inbox.uidNext; this.inboxUnread = inbox.unread; }
      this.paintTitle();
      await this.selectFolder(inbox?.fullName || this.folders[0]?.fullName || "INBOX");
    } catch (error) {
      this.view.setList([], "", explain(error), false, false);
    }
  }

  private async selectFolder(fullName: string): Promise<void> {
    window.clearTimeout(this.readTimer);
    this.folder = fullName;
    this.offset = 0;
    this.search = "";
    this.selected = 0;
    this.current = null;
    this.checked.clear();
    this.view.setReader(null, "", "");
    this.paintFolders();
    await this.loadList(false);
  }

  private paintFolders(): void {
    const rows: FolderRow[] = this.folders
      .slice()
      .sort((a, b) => Number(b.role === "inbox") - Number(a.role === "inbox") || a.fullName.localeCompare(b.fullName))
      .map((folder) => {
        const parts = folder.delimiter ? folder.fullName.split(folder.delimiter).filter(Boolean) : [folder.fullName];
        return {
          fullName: folder.fullName,
          name: folder.name,
          depth: Math.min(2, Math.max(0, parts.length - 1)),
          unread: folder.unread,
          current: folder.fullName === this.folder,
          inbox: folder.role === "inbox" || folder.fullName.toUpperCase() === "INBOX",
          role: this.roleOf(folder)
        };
      });
    this.view.setFolders(rows);
    this.paintTitle();
  }

  /** Rolle für das Symbol: Server-Rolle oder die erkannten System-Ordner. */
  private roleOf(folder: Folder): string {
    if (folder.role) return folder.role;
    if (folder.fullName === this.archiveFolder) return "archive";
    if (folder.fullName === this.sentFolder) return "sent";
    if (folder.fullName === this.draftsFolder) return "drafts";
    if (folder.fullName === this.trashFolder) return "trash";
    if (folder.fullName === this.junkFolder) return "junk";
    return "";
  }

  private paintTitle(): void {
    if (!this.email) return;
    const inbox = this.folders.find((folder) => folder.role === "inbox" || folder.fullName.toUpperCase() === "INBOX");
    const count = this.prefs.showUnreadCount && inbox?.unread ? `(${inbox.unread}) ` : "";
    document.title = `${count}${this.email}`;
  }

  /** Suchstring, den der Server bekommt: KI-Kategorie oder die Suche (Format `name=wert&…` wie `AdvancedSearch.js`). */
  private listQuery(): string {
    const keyword = (name: string) => `keyword=${encodeURIComponent("$ai_" + name)}`;
    if (this.category === "needs_reply") return `${keyword("needs_reply")}&unanswered`;
    if (["personal", "newsletter", "notification", "invoice"].includes(this.category)) return keyword(this.category);
    return this.search;
  }

  /** Kennung des Listenkontexts; Antworten zu einem anderen Kontext werden verworfen. */
  private listContext(): string {
    return JSON.stringify([this.accountHash, this.folder, this.listQuery()]);
  }

  private async loadList(append: boolean, quiet = false): Promise<void> {
    const start = append ? this.offset : 0;
    const query = this.listQuery();
    const context = this.listContext();
    const seq = ++this.listSeq;
    // Eine neuere Anfrage im selben Kontext ersetzt die ältere; eine Antwort zu einem alten Kontext zeichnet nie.
    const stale = () => seq !== this.listSeq || context !== this.listContext();
    if (!append && !quiet) this.view.setList([], "Mails werden geladen …", "", false, Boolean(query));
    try {
      const result = await call<ListResult>("MessageList", {
        folder: this.folder,
        offset: start,
        limit: quiet && !append ? Math.max(this.pageSize, this.messages.length) : this.pageSize,
        search: query,
        sort: "",
        uidNext: this.folders.find((folder) => folder.fullName === this.folder)?.uidNext || 0
      });
      if (stale()) return;
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
      const present = new Set(this.messages.map((message) => message.uid));
      [...this.checked].forEach((uid) => { if (!present.has(uid)) this.checked.delete(uid); });
      this.hasMore = query ? batch.length >= this.pageSize : this.offset < this.total;
      this.paintList();
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (stale()) return;
      this.hasMore = false;
      this.view.setList(this.rows(), "", explain(error), false, Boolean(this.search));
    }
  }

  private parseMessage(item: Record<string, unknown>, full = false): Msg {
    const flags = Array.isArray(item.flags) ? item.flags.map((flag) => String(flag)) : [];
    const folder = String(item.folder || this.folder);
    const uid = Number(item.uid || 0);
    const rawFiles = collection(item.attachments);
    const attachments: MsgFile[] = full ? rawFiles.map((file) => {
      const key = {
        folder,
        uid,
        mimeIndex: String(file.mimeIndex || ""),
        mimeType: String(file.mimeType || "application/octet-stream"),
        fileName: String(file.fileName || "anhang"),
        accountHash: this.accountHash
      };
      const hash = fileHash(key);
      return {
        name: String(file.fileName || "Anhang"),
        size: Number(file.estimatedSize || 0),
        mimeType: key.mimeType,
        mimeIndex: key.mimeIndex,
        cid: String(file.cId || "").replace(/^<|>$/g, ""),
        location: String(file.contentLocation || ""),
        inline: Boolean(file.isInline),
        hash,
        href: rawUrl("Download", hash)
      };
    }) : [];
    const headers: Record<string, string> = {};
    collection(item.headers).forEach((header) => {
      const name = String(header.name || "").toLowerCase();
      if (name && !(name in headers)) headers[name] = String(header.value || "");
    });
    const contentType = (headers["content-type"] || "").toLowerCase();
    const references = Array.isArray(item.references) ? item.references.map(String).join(" ") : String(item.references || "");
    return {
      uid,
      folder,
      hash: String(item.hash || ""),
      subject: String(item.subject || ""),
      preview: String(item.preview || ""),
      from: people(item.from),
      to: people(item.to),
      cc: people(item.cc),
      bcc: people(item.bcc),
      replyTo: people(item.replyTo),
      date: Number(item.dateTimestamp || 0),
      size: Number(item.size || 0),
      flags,
      messageId: String(item.messageId || ""),
      references,
      html: String(item.html || ""),
      plain: String(item.plain || ""),
      attachments,
      hasAttachment: rawFiles.some((file) => !file.isInline) || contentType.startsWith("multipart/mixed"),
      category: String(item.aiCategory || ""),
      spamScore: Number(item.spamScore || 0),
      spamResult: String(item.spamResult || ""),
      isSpam: Boolean(item.isSpam),
      hasVirus: Boolean(item.hasVirus),
      readReceipt: String(item.readReceipt || ""),
      headers,
      auth: { spf: authStatus(item.spf), dkim: authStatus(item.dkim), dmarc: authStatus(item.dmarc) }
    };
  }

  private visible(): Msg[] {
    return this.prefs.hideDeleted ? this.messages.filter((message) => !hasFlag(message.flags, "\\deleted")) : this.messages;
  }

  private rows(): MessageRow[] {
    return this.visible().map((message) => ({
      uid: message.uid,
      who: label(message.from[0] || { name: "", email: "" }) || "(unbekannt)",
      subject: message.subject,
      preview: message.preview,
      when: when(message.date),
      unseen: !seen(message.flags),
      current: message.uid === this.selected && !this.checked.size,
      category: message.category,
      flagged: hasFlag(message.flags, "\\flagged"),
      answered: hasFlag(message.flags, "\\answered"),
      forwarded: hasFlag(message.flags, "$forwarded"),
      attachment: message.hasAttachment,
      checked: this.checked.has(message.uid),
      deleted: hasFlag(message.flags, "\\deleted")
    }));
  }

  private paintList(): void {
    const empty = this.visible().length
      ? ""
      : this.category !== "all" ? "Keine Mails für diesen Filter."
      : this.search ? "Keine Mails für diese Suche." : "Dieser Ordner ist leer.";
    this.view.setList(this.rows(), empty, "", this.hasMore, Boolean(this.search) || this.category !== "all");
  }

  private async setSearch(query: string): Promise<void> {
    this.search = query;
    this.category = "all";
    this.view.pressCategory("all");
    this.offset = 0;
    this.selected = 0;
    this.current = null;
    this.checked.clear();
    this.view.setReader(null, "", "");
    await this.loadList(false);
  }

  private async selectMessage(uid: number): Promise<void> {
    window.clearTimeout(this.readTimer);
    this.selected = uid;
    this.checked.clear();
    this.paintList();
    this.view.setReader(null, "Brief wird geladen …", "");
    try {
      const result = await call<Record<string, unknown>>("Message", { folder: this.folder, uid });
      if (this.selected !== uid) return;
      const message = this.parseMessage(result, true);
      this.current = message;
      this.letter = { uid, mode: this.prefs.viewHtml && message.html ? "html" : "plain", images: false, links: false, swap: false };
      const row = this.messages.find((item) => item.uid === uid);
      if (row) row.flags = message.flags.slice();
      this.scheduleSeen(message);
      await this.paintLetter();
      this.paintStrip();
      void this.loadCachedSummary();
    } catch (error) {
      if (this.selected === uid) this.view.setReader(null, "", explain(error));
    }
  }

  /** Gelesen nach `MessageReadDelay` Sekunden, nur wenn `messageReadAuto` an ist. */
  private scheduleSeen(message: Msg): void {
    if (seen(message.flags) || !this.prefs.readAuto) return;
    const mark = () => {
      if (this.selected !== message.uid || this.current?.uid !== message.uid) return;
      void this.setSeen([message.uid], true);
    };
    if (this.prefs.readDelay <= 0) mark();
    else this.readTimer = window.setTimeout(mark, this.prefs.readDelay * 1000);
  }

  private whitelisted(message: Msg): boolean {
    const sender = (message.from[0]?.email || "").toLowerCase();
    if (!sender) return false;
    return this.prefs.whitelist.split(/[\s,;]+/).some((raw) => {
      const [rule, ...checks] = raw.trim().toLowerCase().split("+");
      if (!rule || !sender.includes(rule)) return false;
      return checks.every((check) => {
        if (check === "spf") return message.auth.spf === "pass";
        if (check === "dkim") return message.auth.dkim === "pass";
        if (check === "dmarc") return message.auth.dmarc === "pass";
        return true;
      });
    });
  }

  private imagesAllowed(message: Msg): boolean {
    if (this.letter.images) return true;
    if (message.isSpam || (this.junkFolder && this.folder === this.junkFolder)) return false;
    if (this.prefs.viewImages === "always") return true;
    if (this.prefs.viewImages === "match") return this.whitelisted(message);
    return false;
  }

  /** Brief neu aufbauen: säubern, Inline-Bilder holen, freigegebene externe Bilder einsetzen, srcdoc bauen. */
  private async paintLetter(): Promise<void> {
    const message = this.current;
    if (!message || this.checked.size) return;
    const token = ++this.renderToken;
    const dark = document.documentElement.classList.contains("dark");
    let body = "";
    let blocked = 0;
    let failed = 0;
    let tracking = false;
    let remote = false;
    const linked = new Set<string>();
    if (this.letter.mode === "html" && message.html) {
      const byCid = new Map<string, string>();
      message.attachments.forEach((file) => {
        if (file.cid) byCid.set(file.cid.toLowerCase(), file.hash);
        if (file.location) byCid.set(file.location.toLowerCase(), file.hash);
      });
      const cleaned = cleanHtml(message.html, {
        allowStyles: this.prefs.allowStyles,
        removeColors: this.prefs.removeColors,
        minFontSize: this.prefs.minFontSize,
        maxBlockquotes: this.prefs.maxBlockquotes,
        collapseBlockquotes: this.prefs.collapseBlockquotes,
        inline: (ref) => byCid.get(ref.replace(/^<|>$/g, "").toLowerCase()) || null
      });
      tracking = cleaned.tracking;
      cleaned.linked.forEach((hash) => linked.add(hash));
      body = cleaned.html;
      if (cleaned.linked.length) {
        await Promise.all(cleaned.linked.map(async (hash) => {
          if (this.inlineCache.has(hash)) return;
          try { this.inlineCache.set(hash, await fetchDataUrl(rawUrl("View", hash))); } catch { /* Bild fehlt, Platzhalter bleibt */ }
        }));
        body = fillInline(body, this.inlineCache);
      }
      if (cleaned.externals) {
        if (this.imagesAllowed(message)) {
          if (this.prefs.proxy) {
            const loaded = new Map<string, string>();
            const urls = externalUrls(body).slice(0, 40);
            await Promise.all(urls.map(async (url) => {
              try { loaded.set(url, await fetchDataUrl(proxyUrl(url), 4 * 1024 * 1024)); } catch { /* Bild nicht erreichbar */ }
            }));
            failed = urls.length - loaded.size;
            const shown = revealExternals(body, (url) => loaded.has(url), (url) => loaded.get(url) || "");
            body = shown.html;
          } else {
            body = revealExternals(body, () => true, (url) => url).html;
            remote = true;
          }
        } else {
          blocked = cleaned.externals;
        }
      }
      if (this.letter.links) body = originalLinks(body);
    } else {
      body = plainToHtml(message.plain || plainFromHtml(message.html), this.prefs.collapseBlockquotes);
    }
    if (token !== this.renderToken || this.current !== message) return;

    const files: ReaderFile[] = message.attachments
      .map((file, index) => ({ file, index }))
      .filter(({ file }) => !file.inline || this.prefs.listInline || !linked.has(file.hash))
      .filter(({ file }) => this.prefs.listInline || !(file.inline && linked.has(file.hash)))
      .map(({ file, index }) => {
        const kind = fileKind(file);
        return {
          index,
          name: file.name,
          size: sizeLabel(file.size),
          href: file.href,
          view: rawUrl(kind === "text" || kind === "calendar" ? "ViewAsPlain" : "View", file.hash),
          thumb: kind === "image" && this.prefs.thumbs ? rawUrl("ViewThumbnail", file.hash) : "",
          kind
        };
      });

    const ics = message.attachments.find((file) => fileKind(file) === "calendar");
    let calendar: CalendarEvent | null = null;
    if (ics) {
      if (!this.calendarCache.has(ics.hash)) {
        try { this.calendarCache.set(ics.hash, parseIcs(await fetchText(rawUrl("ViewAsPlain", ics.hash)))); } catch { this.calendarCache.set(ics.hash, null); }
      }
      calendar = this.calendarCache.get(ics.hash) || null;
      if (token !== this.renderToken || this.current !== message) return;
    }

    // Feld `hasVirus` (falls ein Server es liefert), sonst die Kopfzeilen wie bisher.
    const virus = message.hasVirus || /infected|virus/i.test(message.headers["x-virus-status"] || message.headers["x-virus-scanned"] || "")
      && !/clean|no/i.test(message.headers["x-virus-status"] || "clean");
    const spam = virus ? "Virenwarnung: Der Server hat in dieser Mail einen Virus gemeldet."
      : message.isSpam ? `Als Spam erkannt${message.spamScore ? ` (Wert ${message.spamScore})` : ""}${message.spamResult ? ` · ${message.spamResult}` : ""}.`
      : message.spamScore > 0 ? `Spam-Wert ${message.spamScore}${message.spamResult ? ` · ${message.spamResult}` : ""}.`
      : "";
    const receiptKey = `${message.folder}:${message.uid}`;
    const data: ReaderData = {
      uid: message.uid,
      subject: message.subject,
      from: message.from,
      to: message.to,
      cc: message.cc,
      bcc: message.bcc,
      replyTo: message.replyTo.filter((person) => !message.from.some((sender) => sender.email === person.email)),
      when: when(message.date),
      whenFull: whenFull(message.date),
      size: sizeLabel(message.size),
      flagged: hasFlag(message.flags, "\\flagged"),
      seen: seen(message.flags),
      deleted: hasFlag(message.flags, "\\deleted"),
      keywords: message.flags.filter((flag) => !SYSTEM_FLAGS.test(flag)),
      srcdoc: srcdoc(body, this.letter.mode === "html" && message.html ? "html" : "plain", {
        dark, swap: this.letter.swap, removeColors: this.prefs.removeColors, remote
      }),
      mode: this.letter.mode,
      canToggleMode: Boolean(message.html),
      blocked,
      failed,
      tracking,
      originalLinks: this.letter.links,
      swap: this.letter.swap,
      spam,
      receipt: message.readReceipt && !hasFlag(message.flags, "$mdnsent") && !this.receiptSkipped.has(receiptKey)
        && message.folder !== this.sentFolder ? message.readReceipt : "",
      unsubscribe: Boolean(parseUnsubscribe(message.headers["list-unsubscribe"] || "", message.headers["list-unsubscribe-post"] || "")),
      files,
      simpleFiles: this.prefs.simpleFiles,
      contacts: this.caps.contacts,
      zip: this.prefs.zip,
      calendar,
      place: this.place()
    };
    this.view.setReader(data, "", "");
  }

  private async loadComposeIdentities(): Promise<void> {
    try {
      const result = await call<{ Identities?: unknown }>("AccountsAndIdentities");
      const rows = Array.isArray(result.Identities) ? result.Identities : Object.values((result.Identities || {}) as object);
      this.identities = rows.map((value) => {
        const item = value as Record<string, unknown>;
        return {
          id: String(item.id || ""), label: String(item.label || ""), email: String(item.email || ""), name: String(item.name || ""),
          replyTo: String(item.replyTo || ""), bcc: String(item.bcc || ""), signature: String(item.signature || ""),
          signatureInsertBefore: Boolean(item.signatureInsertBefore), sentFolder: String(item.sentFolder || ""),
          pgpEncrypt: Boolean(item.pgpEncrypt), pgpSign: Boolean(item.pgpSign), smimeKey: String(item.smimeKey || ""),
          smimeCertificate: String(item.smimeCertificate || ""), smimeCertificateChain: String(item.smimeCertificateChain || "")
        };
      }).filter((item) => item.email);
    } catch { this.identities = []; }
    if (!this.identities.length) this.identities = [{ id: "", label: "", email: this.email, name: "", replyTo: "", bcc: "", signature: "", signatureInsertBefore: false, sentFolder: "", pgpEncrypt: false, pgpSign: false, smimeKey: "", smimeCertificate: "", smimeCertificateChain: "" }];
  }

  private configureComposer(): void {
    const data = this.composeData;
    this.view.configureCompose({
      editor: String(data.EditorDefaultType || "Plain") === "Html" ? "Html" : "Plain",
      markdown: Boolean(data.markdown), spellcheck: Boolean(data.allowSpellcheck), autosave: Boolean(data.AllowDraftAutosave ?? true),
      draftsFolder: this.draftsFolder, sentFolder: this.sentFolder, replySameFolder: Boolean(data.ReplySameFolder),
      attachmentLimit: Number(data.attachmentLimit || 0), readReceipt: Boolean(data.requestReadReceipt), dsn: Boolean(data.requestDsn),
      requireTLS: Boolean(data.requireTLS), pgpSign: Boolean(data.pgpSign), pgpEncrypt: Boolean(data.pgpEncrypt)
    }, this.identities);
  }

  private replyIdentity(message: Msg): string {
    const recipients = [...message.to, ...message.cc, ...message.bcc];
    return this.identities.find((identity) => recipients.some((person) => person.email.toLowerCase() === identity.email.toLowerCase()))?.id || this.identities[0]?.id || "";
  }

  private openNew(): void {
    this.replyKind = "";
    this.draftRef = null;
    this.view.openCompose({ title: "Neue Nachricht", to: "", cc: "", subject: "", body: "", mode: "new" });
  }

  private openReply(all: boolean): void {
    const message = this.current;
    if (!message) return;
    this.replyKind = all ? "reply-all" : "reply";
    this.draftRef = null;
    const author = message.replyTo[0] || message.from[0];
    const others = [...message.to, ...message.cc].filter((person) => person.email.toLowerCase() !== this.email.toLowerCase());
    const body = message.plain || plainFromHtml(message.html);
    const subject = /^re:/i.test(message.subject) ? message.subject : `Re: ${message.subject}`;
    this.view.openCompose({
      title: all ? "Allen antworten" : "Antworten", mode: "reply", identityId: this.replyIdentity(message), sourceFolder: message.folder,
      to: author ? address(author) : "", cc: all ? others.map(address).join(", ") : "", subject,
      body: `\n\nAm ${when(message.date)} schrieb ${author ? label(author) : ""}:\n${quote(body)}`
    });
  }

  private openForward(): void {
    const message = this.current;
    if (!message) return;
    this.replyKind = "forward";
    this.draftRef = null;
    const body = message.plain || plainFromHtml(message.html);
    const subject = /^fw:/i.test(message.subject) ? message.subject : `Fw: ${message.subject}`;
    this.view.openCompose({
      title: "Weiterleiten", to: "", cc: "", subject, identityId: this.replyIdentity(message), sourceFolder: message.folder,
      body: `\n\n-------- Weitergeleitete Nachricht --------\nVon: ${message.from.map(label).join(", ")}\nBetreff: ${message.subject}\n\n${body}`
    });
    void this.view.attachCompose(message.attachments.filter((file) => !file.inline).map((file) => ({ key: file.hash, name: file.name, size: file.size })));
  }

  private async saveDraft(values: ComposeValues): Promise<{ folder: string; uid: number }> {
    const result = await call<{ folder?: string; uid?: number } | true>("SaveMessage", { ...values });
    if (result === true || !result.folder || !result.uid) throw new ApiError(0, "Der Entwurf konnte nicht gespeichert werden.");
    this.draftRef = { folder: result.folder, uid: result.uid };
    return this.draftRef;
  }

  private async closeCompose(discard: boolean): Promise<void> {
    if (discard && this.draftRef) {
      try { await call("MessageDelete", { folder: this.draftRef.folder, uids: String(this.draftRef.uid) }); }
      catch (error) { this.view.notice(explain(error)); }
    }
    this.replyKind = "";
    this.draftRef = null;
    await this.loadList(false, true);
  }

  private async send(values: ComposeValues): Promise<void> {
    const message = this.current;
    const params: Record<string, unknown> = { ...values };
    if (message && this.replyKind) {
      params.inReplyTo = message.messageId;
      params.references = [message.references, message.messageId].filter(Boolean).join(" ");
      params.draftInfo = [this.replyKind === "forward" ? "forward" : "reply", message.uid, message.folder];
    }
    if (this.draftRef) { params.messageFolder = this.draftRef.folder; params.messageUid = this.draftRef.uid; }
    try {
      await call("SendMessage", params);
      this.view.closeCompose();
      this.view.notice("Gesendet.");
      this.replyKind = "";
      const wasDraft = Boolean(this.draftRef);
      this.draftRef = null;
      this.offset = 0;
      if (wasDraft && this.current) { this.current = null; this.selected = 0; this.view.setReader(null, "", ""); }
      await this.loadList(false, true);
    } catch (error) { this.view.setSendState(false, explain(error)); }
  }

  /** Ziel der Aktion: die angehakten Mails, sonst die offene. */
  private targets(): number[] {
    if (this.checked.size) return [...this.checked];
    return this.selected ? [this.selected] : [];
  }

  private async archive(): Promise<void> {
    const uids = this.targets();
    if (!uids.length) return;
    if (!this.archiveFolder) {
      this.view.notice("Kein Archiv-Ordner eingerichtet.");
      return;
    }
    if (this.folder === this.archiveFolder) {
      this.view.notice("Die Mail liegt schon im Archiv.");
      return;
    }
    await this.moveTo(uids, this.archiveFolder, false, uids.length === 1 ? "Archiviert." : `${uids.length} Mails archiviert.`);
  }

  /** Löschen: in den Papierkorb verschieben. Im Papierkorb oder ohne Papierkorb endgültig, dann mit Bestätigung. */
  private async remove(forever = false): Promise<void> {
    const uids = this.targets();
    if (!uids.length) return;
    const permanent = forever || !this.trashFolder || this.folder === this.trashFolder;
    if (permanent) {
      const what = uids.length === 1 ? "diese Mail" : `diese ${uids.length} Mails`;
      const ok = await this.view.confirm("Endgültig löschen?", `Damit wird ${what} sofort entfernt. Das lässt sich nicht rückgängig machen.`, "Endgültig löschen");
      if (!ok) return;
      try {
        await call("MessageDelete", { folder: this.folder, uids: uids.join(",") });
        this.view.notice(uids.length === 1 ? "Endgültig gelöscht." : `${uids.length} Mails endgültig gelöscht.`);
        await this.afterRemoval(uids);
      } catch (error) {
        this.view.notice(explain(error));
      }
      return;
    }
    await this.moveTo(uids, this.trashFolder, false, uids.length === 1 ? "In den Papierkorb verschoben." : `${uids.length} Mails in den Papierkorb verschoben.`);
  }

  private async moveTo(uids: number[], target: string, copy: boolean, done: string): Promise<void> {
    if (!target || (!copy && target === this.folder)) return;
    try {
      await call(copy ? "MessageCopy" : "MessageMove", { fromFolder: this.folder, toFolder: target, uids: uids.join(",") });
      this.view.notice(done);
      const unread = this.messages.filter((message) => uids.includes(message.uid) && !seen(message.flags)).length;
      const to = this.folders.find((folder) => folder.fullName === target);
      if (to) to.unread += unread;
      if (copy) {
        this.paintFolders();
        return;
      }
      const from = this.folders.find((folder) => folder.fullName === this.folder);
      if (from) from.unread = Math.max(0, from.unread - unread);
      await this.afterRemoval(uids);
    } catch (error) {
      this.view.notice(explain(error));
    }
  }

  private async afterRemoval(uids: number[]): Promise<void> {
    const order = this.visible().map((message) => message.uid);
    const openGone = uids.includes(this.selected);
    let next = 0;
    if (openGone && this.prefs.showNext && !this.checked.size) {
      const index = order.indexOf(this.selected);
      next = order.slice(index + 1).find((uid) => !uids.includes(uid)) || order.slice(0, index).reverse().find((uid) => !uids.includes(uid)) || 0;
    }
    this.messages = this.messages.filter((message) => !uids.includes(message.uid));
    uids.forEach((uid) => this.checked.delete(uid));
    this.offset = Math.max(0, this.offset - uids.length);
    if (openGone) {
      this.selected = 0;
      this.current = null;
      this.view.setReader(null, "", "");
    }
    this.paintFolders();
    await this.loadList(false, true);
    if (next) await this.selectMessage(next);
    else if (this.checked.size) this.paintBulk();
  }

  private async setSeen(uids: number[], value: boolean): Promise<void> {
    let delta = 0;
    this.messages.forEach((message) => {
      if (!uids.includes(message.uid)) return;
      const was = seen(message.flags);
      if (was === value) return;
      delta += value ? -1 : 1;
      message.flags = value ? message.flags.concat("\\seen") : message.flags.filter((flag) => flag.toLowerCase() !== "\\seen");
    });
    if (this.current && uids.includes(this.current.uid)) {
      this.current.flags = value ? [...new Set(this.current.flags.concat("\\seen"))] : this.current.flags.filter((flag) => flag.toLowerCase() !== "\\seen");
    }
    const folder = this.folders.find((item) => item.fullName === this.folder);
    if (folder) folder.unread = Math.max(0, folder.unread + delta);
    this.paintFolders();
    this.paintList();
    if (this.current && uids.includes(this.current.uid) && !this.checked.size) void this.paintLetter();
    try {
      await call("MessageSetSeen", { folder: this.folder, uids: uids.join(","), setAction: value ? 1 : 0 });
    } catch (error) {
      this.view.notice(explain(error));
    }
  }

  private async markUnread(): Promise<void> {
    const uids = this.targets();
    if (!uids.length) return;
    if (this.checked.size) {
      await this.setSeen(uids, false);
      return;
    }
    window.clearTimeout(this.readTimer);
    const message = this.messages.find((item) => item.uid === uids[0]) || this.current;
    await this.setSeen(uids, !(message && seen(message.flags)) ? true : false);
  }

  private async setFlag(uids: number[], flag: string, value: boolean, action: string): Promise<void> {
    const apply = (list: string[]) => value ? [...new Set(list.concat(flag))] : list.filter((item) => item.toLowerCase() !== flag.toLowerCase());
    this.messages.forEach((message) => { if (uids.includes(message.uid)) message.flags = apply(message.flags); });
    if (this.current && uids.includes(this.current.uid)) this.current.flags = apply(this.current.flags);
    this.paintList();
    if (this.current && uids.includes(this.current.uid) && !this.checked.size) void this.paintLetter();
    try {
      const params: Record<string, unknown> = { folder: this.folder, uids: uids.join(","), setAction: value ? 1 : 0 };
      if (action === "MessageSetKeyword") params.keyword = flag;
      await call(action, params);
    } catch (error) {
      this.view.notice(explain(error));
    }
  }

  private pickerFolders(): PickerFolder[] {
    return this.folders
      .slice()
      .sort((a, b) => Number(b.role === "inbox") - Number(a.role === "inbox") || a.fullName.localeCompare(b.fullName))
      .map((folder) => {
        const parts = folder.delimiter ? folder.fullName.split(folder.delimiter).filter(Boolean) : [folder.fullName];
        return { fullName: folder.fullName, name: folder.name, depth: Math.min(4, parts.length - 1), role: this.roleOf(folder) };
      });
  }

  private paintBulk(): void {
    if (!this.checked.size) {
      if (this.current) void this.paintLetter();
      else this.view.setReader(null, "", "");
      return;
    }
    this.view.setBulk({ count: this.checked.size, place: this.place(), zip: this.prefs.zip });
  }

  private letterPrint(): { subject: string; from: string; to: string; cc: string; when: string; body: string; kind: "html" | "plain"; attachments: { name: string; href: string }[] } | null {
    const message = this.current;
    if (!message) return null;
    let body: string;
    let kind: "html" | "plain" = "plain";
    if (this.letter.mode === "html" && message.html) {
      kind = "html";
      const cleaned = cleanHtml(message.html, {
        allowStyles: false, removeColors: false, minFontSize: this.prefs.minFontSize, maxBlockquotes: 0, collapseBlockquotes: false,
        inline: (ref) => message.attachments.find((file) => file.cid.toLowerCase() === ref.replace(/^<|>$/g, "").toLowerCase())?.hash || null
      });
      body = fillInline(cleaned.html, this.inlineCache);
      if (this.imagesAllowed(message) && !this.prefs.proxy) body = revealExternals(body, () => true, (url) => url).html;
    } else {
      body = plainToHtml(message.plain || plainFromHtml(message.html), false);
    }
    return {
      subject: message.subject,
      from: message.from.map(address).join(", "),
      to: message.to.map(address).join(", "),
      cc: message.cc.map(address).join(", "),
      when: whenFull(message.date),
      body,
      kind,
      attachments: message.attachments.filter((file) => !file.inline).map((file) => ({ name: file.name, href: new URL(file.href, location.href).href }))
    };
  }

  private messageKey(message: Msg): string {
    return messageHash(message.folder, message.uid, message.subject, message.hash, this.accountHash);
  }

  /** Neue Mails prüfen: Ordnerzahlen, Liste des offenen Ordners, Hinweis und Ton bei neuer Mail im Posteingang. */
  private async poll(manual: boolean): Promise<void> {
    if (!this.email) return;
    this.lastPoll = Date.now();
    if (manual) this.view.setRefreshing(true);
    try {
      const result = await call<{ "@Collection"?: Record<string, unknown>[] }>("Folders");
      const fresh = new Map((result["@Collection"] || []).map((item) => [String(item.fullName || ""), item]));
      let changed = manual;
      this.folders.forEach((folder) => {
        const item = fresh.get(folder.fullName);
        if (!item) return;
        const uidNext = Number(item.uidNext || 0);
        if (folder.fullName === this.folder && uidNext && uidNext !== folder.uidNext) changed = true;
        folder.unread = Number(item.unreadEmails || 0);
        folder.total = Number(item.totalEmails || 0);
      });
      const inbox = this.folders.find((folder) => folder.role === "inbox" || folder.fullName.toUpperCase() === "INBOX");
      if (inbox) {
        const item = fresh.get(inbox.fullName);
        const uidNext = Number(item?.uidNext || inbox.uidNext);
        if (this.inboxUid && uidNext > this.inboxUid && inbox.unread > this.inboxUnread && this.inboxUnread >= 0) {
          this.announce(Math.max(1, inbox.unread - this.inboxUnread));
        }
        this.inboxUid = uidNext;
        this.inboxUnread = inbox.unread;
      }
      this.paintFolders();
      if (changed) await this.loadList(false, true);
    } catch (error) {
      if (manual) this.view.notice(explain(error));
    } finally {
      if (manual) this.view.setRefreshing(false);
    }
  }

  private announce(count: number): void {
    if (this.prefs.sound && this.prefs.soundName) {
      try {
        const audio = new Audio(`${location.pathname.replace(/\/+$/, "")}/${this.prefs.webPath.replace(/^\/+/, "")}static/sounds/${encodeURIComponent(this.prefs.soundName)}.mp3`);
        void audio.play().catch(() => undefined);
      } catch { /* kein Ton möglich */ }
    }
    if (this.prefs.desktop && "Notification" in window && Notification.permission === "granted" && document.hidden) {
      try {
        const note = new Notification(count === 1 ? "Eine neue Mail" : `${count} neue Mails`, { body: this.email, tag: "sm-new-mail" });
        note.onclick = () => { window.focus(); note.close(); };
      } catch { /* Browser ohne Hinweise */ }
    }
  }

  private async loadAccounts(): Promise<void> {
    try {
      const result = await call<{ Accounts?: unknown }>("AccountsAndIdentities");
      const list = (Array.isArray(result.Accounts) ? result.Accounts : Object.values((result.Accounts || {}) as object)) as { email?: string }[];
      const main = this.mainEmail || this.email;
      const emails = [main, ...list.map((item) => String(item.email || ""))].filter((email, index, all) => email && all.indexOf(email) === index);
      const items = emails.map((email) => ({ email, unread: 0, current: email === this.email }));
      this.view.setAccounts(items);
      await Promise.all(items.filter((item) => !item.current && item.email !== main).map(async (item) => {
        try {
          const info = await call<{ unreadEmails?: number }>("AccountUnread", { email: item.email });
          item.unread = Number(info.unreadEmails || 0);
        } catch { /* Konto gerade nicht erreichbar */ }
      }));
      this.view.setAccounts(items);
    } catch {
      this.view.setAccounts([]);
    }
  }

  /** Mail-Aktionen aus der Oberfläche (Phase 1). */
  private async act(name: string, data: Record<string, string>): Promise<void> {
    const message = this.current;
    const ref = Number(data.ref || data.uid || 0);
    switch (name) {
      case "select": {
        const uid = Number(data.uid || 0);
        if (!uid) return;
        const order = this.visible().map((item) => item.uid);
        if (!this.checked.size && this.selected && this.selected !== uid && data.mode !== "range") this.checked.add(this.selected);
        if (data.mode === "range" && (this.anchor || this.selected)) {
          const from = order.indexOf(this.anchor || this.selected);
          const to = order.indexOf(uid);
          if (from >= 0 && to >= 0) order.slice(Math.min(from, to), Math.max(from, to) + 1).forEach((item) => this.checked.add(item));
        } else if (this.checked.has(uid)) this.checked.delete(uid);
        else this.checked.add(uid);
        this.anchor = uid;
        window.clearTimeout(this.readTimer);
        this.paintList();
        this.paintBulk();
        return;
      }
      case "select-all": {
        const order = this.visible().map((item) => item.uid);
        if (order.length && order.every((uid) => this.checked.has(uid))) this.checked.clear();
        else order.forEach((uid) => this.checked.add(uid));
        this.paintList();
        this.paintBulk();
        return;
      }
      case "clear-selection":
        this.checked.clear();
        this.paintList();
        this.paintBulk();
        return;
      case "refresh":
        await this.poll(true);
        return;
      case "flag": {
        const uids = ref ? [ref] : this.targets();
        if (!uids.length) return;
        const all = uids.every((uid) => hasFlag((this.messages.find((item) => item.uid === uid) || message)?.flags || [], "\\flagged"));
        await this.setFlag(uids, "\\flagged", !all, "MessageSetFlagged");
        return;
      }
      case "flag-all":
      case "unflag-all":
        await this.setFlag(this.targets(), "\\flagged", name === "flag-all", "MessageSetFlagged");
        return;
      case "read":
        await this.setSeen(this.targets(), true);
        return;
      case "unread-all":
        await this.setSeen(this.targets(), false);
        return;
      case "move":
      case "copy": {
        const uids = this.targets();
        if (!uids.length) return;
        const copy = name === "copy";
        const target = await this.view.pickFolder(copy ? "Kopieren nach" : "Verschieben nach", this.pickerFolders(), copy ? "" : this.folder);
        if (!target) return;
        const n = uids.length === 1 ? "Mail" : `${uids.length} Mails`;
        await this.moveTo(uids, target, copy, `${n} ${copy ? "kopiert" : "verschoben"} nach ${target}.`);
        return;
      }
      case "drop": {
        const uid = Number(data.uid || 0);
        const uids = this.checked.has(uid) ? [...this.checked] : [uid];
        const copy = data.copy === "1";
        if (!data.folder || (!copy && data.folder === this.folder)) return;
        const n = uids.length === 1 ? "Mail" : `${uids.length} Mails`;
        await this.moveTo(uids, data.folder, copy, `${n} ${copy ? "kopiert" : "verschoben"} nach ${data.folder}.`);
        return;
      }
      case "archive":
        await this.archive();
        return;
      case "spam":
      case "notspam": {
        const uids = this.targets();
        const inbox = this.folders.find((folder) => folder.role === "inbox" || folder.fullName.toUpperCase() === "INBOX")?.fullName || "INBOX";
        const target = name === "spam" ? this.junkFolder : inbox;
        if (!uids.length || !target) return;
        await this.moveTo(uids, target, false, name === "spam" ? "Als Spam verschoben." : "In den Posteingang verschoben.");
        return;
      }
      case "delete-forever":
        await this.remove(true);
        return;
      case "restore": {
        const uids = this.targets();
        await this.setFlag(uids, "\\deleted", false, "MessageSetDeleted");
        this.view.notice("Wiederhergestellt.");
        return;
      }
      case "tag": {
        if (!message) return;
        const value = await this.view.ask("Schlagwort hinzufügen", "Schlagwort");
        const keyword = (value || "").replace(/[\s\\()"{}%*\]]+/g, "");
        if (!keyword) return;
        await this.setFlag([message.uid], keyword, true, "MessageSetKeyword");
        return;
      }
      case "untag":
        if (message && data.tag) await this.setFlag([message.uid], data.tag, false, "MessageSetKeyword");
        return;
      case "images":
        this.letter.images = true;
        await this.paintLetter();
        return;
      case "images-always": {
        const sender = message?.from[0]?.email;
        if (!sender) return;
        this.letter.images = true;
        const list = this.prefs.whitelist.split(/[\s,;]+/).filter(Boolean);
        if (!list.includes(sender)) list.push(sender);
        this.prefs.whitelist = list.join("\n");
        if (this.prefs.viewImages === "ask") this.prefs.viewImages = "match";
        await this.paintLetter();
        try {
          await call("SettingsUpdate", { ViewImagesWhitelist: this.prefs.whitelist, ViewImages: this.prefs.viewImages });
          this.view.notice(`Bilder von ${sender} werden künftig angezeigt.`);
        } catch (error) {
          this.view.notice(explain(error));
        }
        return;
      }
      case "links":
        this.letter.links = !this.letter.links;
        await this.paintLetter();
        return;
      case "mode":
        this.letter.mode = this.letter.mode === "html" ? "plain" : "html";
        await this.paintLetter();
        return;
      case "swap":
        this.letter.swap = !this.letter.swap;
        await this.paintLetter();
        return;
      case "receipt":
      case "receipt-skip": {
        if (!message) return;
        this.receiptSkipped.add(`${message.folder}:${message.uid}`);
        if (name === "receipt") {
          try {
            await call("SendReadReceiptMessage", {
              messageFolder: message.folder,
              messageUid: message.uid,
              readReceipt: message.readReceipt,
              subject: `Gelesen: ${message.subject}`,
              plain: `Ihre Nachricht an ${this.email} wurde gelesen.`
            });
            message.flags.push("$mdnsent");
            this.view.notice("Lesebestätigung gesendet.");
          } catch (error) {
            this.receiptSkipped.delete(`${message.folder}:${message.uid}`);
            this.view.notice(explain(error));
          }
        }
        await this.paintLetter();
        return;
      }
      case "unsubscribe": {
        if (!message) return;
        const info = parseUnsubscribe(message.headers["list-unsubscribe"] || "", message.headers["list-unsubscribe-post"] || "");
        if (!info) return;
        if (info.mailto) {
          const seed = parseMailto(info.mailto);
          this.replyKind = "";
          this.draftRef = null;
          this.view.openCompose({ title: "Vom Verteiler abmelden", to: seed.to, cc: seed.cc, bcc: seed.bcc, subject: seed.subject || "unsubscribe", body: seed.body, mode: "new" });
          return;
        }
        const host = (() => { try { return new URL(info.http).host; } catch { return info.http; } })();
        const ok = await this.view.confirm("Vom Verteiler abmelden?", `Die Abmeldeseite von ${host} öffnet sich in einem neuen Tab.`, "Seite öffnen", false);
        if (ok) window.open(info.http, "_blank", "noopener,noreferrer");
        return;
      }
      case "print":
      case "window": {
        const print = this.letterPrint();
        if (!print) return;
        if (!openLetterWindow(print, name === "print")) this.view.notice("Das Fenster wurde vom Browser blockiert.");
        return;
      }
      case "source":
        if (message) window.open(rawUrl("ViewAsPlain", this.messageKey(message)), "_blank", "noopener");
        return;
      case "eml":
        if (message) {
          const link = document.createElement("a");
          link.href = rawUrl("Download", this.messageKey(message));
          link.download = `${message.subject || "mail"}.eml`;
          document.body.append(link);
          link.click();
          link.remove();
        }
        return;
      case "edit-draft":
      case "edit-new": {
        if (!message) return;
        this.replyKind = "";
        this.draftRef = name === "edit-draft" ? { folder: message.folder, uid: message.uid } : null;
        this.view.openCompose({
          title: name === "edit-draft" ? "Entwurf" : "Neue Nachricht",
          to: message.to.map(address).join(", "), cc: message.cc.map(address).join(", "), bcc: message.bcc.map(address).join(", "),
          replyTo: message.replyTo.map(address).join(", "), subject: message.subject, body: message.plain || plainFromHtml(message.html),
          html: message.html, mode: name === "edit-draft" ? "draft" : "new", draftRef: this.draftRef,
          identityId: this.identities.find((identity) => message.from.some((person) => person.email.toLowerCase() === identity.email.toLowerCase()))?.id
        });
        void this.view.attachCompose(message.attachments.filter((file) => !file.inline).map((file) => ({ key: file.hash, name: file.name, size: file.size })));
        return;
      }
      case "forward-att": {
        const uids = this.targets();
        const list = uids.map((uid) => (message && message.uid === uid ? message : this.messages.find((item) => item.uid === uid))).filter(Boolean) as Msg[];
        if (!list.length) return;
        this.replyKind = "";
        this.draftRef = null;
        const subject = list.length === 1 ? (/^fw:/i.test(list[0].subject) ? list[0].subject : `Fw: ${list[0].subject}`) : "Weitergeleitete Nachrichten";
        this.view.openCompose({ title: "Als Anhang weiterleiten", to: "", cc: "", subject, body: "", mode: "new" });
        void this.view.attachCompose(list.map((item) => ({ key: this.messageKey(item), name: `${(item.subject || "Mail").slice(0, 60)}.eml`, size: item.size })));
        return;
      }
      case "preview": {
        const file = message?.attachments[Number(data.index || -1)];
        if (!file) return;
        const kind = fileKind(file);
        if (kind === "pdf") {
          window.open(rawUrl("View", file.hash), "_blank", "noopener");
          return;
        }
        this.view.preview(file.name, rawUrl(kind === "image" ? "View" : "ViewAsPlain", file.hash), kind === "image" ? "image" : "text");
        return;
      }
      case "zip":
      case "zip-mails": {
        const hashes = name === "zip"
          ? (message?.attachments.filter((file) => !file.inline).map((file) => file.hash) || [])
          : this.targets().map((uid) => this.messages.find((item) => item.uid === uid)).filter(Boolean).map((item) => this.messageKey(item as Msg));
        if (!hashes.length) return;
        try {
          const result = await call<{ fileHash?: string }>("AttachmentsActions", {
            target: "zip",
            filename: name === "zip" ? (message?.subject || "Anhänge") : "Mails",
            hashes,
            folder: this.folder
          });
          if (!result.fileHash) throw new ApiError(1, "ZIP konnte nicht erstellt werden.");
          const link = document.createElement("a");
          link.href = rawUrl("Download", result.fileHash);
          link.download = `${result.fileHash}.zip`;
          document.body.append(link);
          link.click();
          link.remove();
        } catch (error) {
          this.view.notice(explain(error));
        }
        return;
      }
      case "prev":
      case "next": {
        const order = this.visible().map((item) => item.uid);
        const index = order.indexOf(this.selected);
        const uid = order[index + (name === "next" ? 1 : -1)];
        if (uid) await this.selectMessage(uid);
        else if (name === "next" && this.hasMore) {
          await this.loadList(true);
          const more = this.visible().map((item) => item.uid)[index + 1];
          if (more) await this.selectMessage(more);
        }
        return;
      }
      case "addr-write":
        this.replyKind = "";
        this.draftRef = null;
        this.view.openCompose({ title: "Neue Nachricht", to: address({ name: data.name || "", email: data.email || "" }), cc: "", subject: "", body: "", mode: "new" });
        return;
      case "addr-copy":
        try {
          await navigator.clipboard.writeText(data.email || "");
          this.view.notice("Adresse kopiert.");
        } catch {
          this.view.notice(data.email || "");
        }
        return;
      case "addr-search":
        if (data.email) {
          const input = document.querySelector("#search") as HTMLInputElement | null;
          const query = `from=${encodeURIComponent(data.email)}`;
          if (input) input.value = query;
          await this.setSearch(query);
        }
        return;
      case "addr-contact":
        if (data.email && this.caps.contacts) {
          try {
            let card = writeProp(undefined, "fn", (data.name || "").trim() || data.email);
            card = writeProp(card, "email", data.email);
            await call("ContactSave", { uid: "", jCard: card });
            this.view.notice(`${data.name || data.email} wurde zu den Kontakten hinzugefügt.`);
          } catch (error) {
            this.view.notice(explain(error));
          }
        }
        return;
      case "accounts":
        await this.loadAccounts();
        return;
      case "switch":
        if (!data.email) return;
        try {
          await call("AccountSwitch", { Email: data.email });
          await this.enter(await loadApp());
        } catch (error) {
          this.view.notice(explain(error));
        }
        return;
      default:
        return;
    }
  }

  private strip(): StripState {
    return {
      loading: "",
      error: "",
      tldr: this.tldr,
      cached: this.summaryCached,
      decisions: [],
      actions: [],
      next: "",
      replies: this.replies,
      model: this.summaryModel,
      showSummarize: Boolean(this.assistFlags?.summarize),
      showReplies: Boolean(this.assistFlags?.replies)
    };
  }

  private tldr = "";
  private summaryCached = false;
  private summaryModel = "";

  private paintStrip(): void {
    if (!this.assistFlags?.summarize && !this.assistFlags?.replies) return;
    this.view.setStrip(this.current ? this.strip() : null);
  }

  private async loadCachedSummary(): Promise<void> {
    if (!this.assistFlags?.summarize || !this.current) return;
    try {
      const result = await plugin<{ summary: { tldr?: string; model?: string } | null; cached?: boolean }>("AiSummarize", {
        folder: this.folder,
        uids: [this.current.uid],
        cacheOnly: true,
        sent: this.sentFolder
      });
      this.tldr = result.summary?.tldr || "";
      this.summaryCached = Boolean(result.cached);
      this.summaryModel = result.summary?.model || "";
      this.paintStrip();
    } catch {
      this.paintStrip();
    }
  }

  private async consent(kind: "mail" | "query" = "mail"): Promise<boolean> {
    if (this.noticeAck) return true;
    const name = this.assistFlags?.providerName || "den Anbieter";
    const text = kind === "query"
      ? `Nur die Suchanfrage geht an ${name}. Die Mails selbst bleiben auf dem Server. Fortfahren?`
      : `Diese KI-Funktion sendet den Inhalt der betroffenen Mails an ${name}. Es wird nur gesendet, wenn Sie eine KI-Aktion anklicken. Fortfahren?`;
    const ok = await this.view.confirmConsent(text);
    if (!ok) return false;
    try {
      await plugin("AiSaveSettings", { settings: { notice_ack: true } });
    } catch { /* the choice still stands for this session */ }
    this.noticeAck = true;
    return true;
  }

  private async loadAlerts(): Promise<void> {
    const inbox = this.folders.find((folder) => folder.role === "inbox")?.fullName || "INBOX";
    try {
      const result = await plugin<{ alerts: { type: string; folder: string; uid: number; title: string }[] }>("AiAlerts", {
        inbox,
        sent: this.sentFolder
      });
      this.alertItems = result.alerts || [];
      const count = (type: string) => this.alertItems.filter((item) => item.type === type).length;
      this.view.setAlerts(count("reply"), count("followup"), count("invoice"), "");
    } catch {
      /* Hinweise sind ergänzend */
    }
  }

  private async assist(name: string, data: Record<string, string | undefined>): Promise<void> {
    if (name === "cat") {
      this.category = data.cat || "all";
      if (this.category !== "all" && this.assistFlags?.triage && !this.tagged.has(this.folder)) {
        try {
          await plugin("AiTriageTag", { folder: this.folder, sent: this.sentFolder });
          this.tagged.add(this.folder);
        } catch (error) {
          this.view.notice(explain(error));
          return;
        }
      }
      this.offset = 0;
      await this.loadList(false);
      return;
    }
    if (name === "alert") {
      if (data.kind === "follow") {
        const sent = this.folders.find((folder) => folder.role === "sent")?.fullName || this.sentFolder;
        if (sent) await this.selectFolder(sent);
        return;
      }
      await this.assist("cat", { cat: data.kind === "invoice" ? "invoice" : "needs_reply" });
      this.view.pressCategory(data.kind === "invoice" ? "invoice" : "needs_reply");
      return;
    }
    if (name === "summarize" || name === "replies" || name === "generate" || name === "triage" || name === "deadlines" || name === "ask") {
      if (!await this.consent()) return;
    }
    if (name === "lang-search") {
      if (!await this.consent("query")) return;
      const query = data.text || "";
      const input = document.querySelector("#search") as HTMLInputElement | null;
      const text = query || input?.value.trim() || "";
      if (!text) return;
      try {
        const result = await plugin<{ search: string; explanation?: string; folder?: string }>("AiSearch", {
          query: text,
          folders: this.folders.map((folder) => folder.fullName),
          currentFolder: this.folder,
          sent: this.sentFolder
        });
        if (result.folder && result.folder !== this.folder) await this.selectFolder(result.folder);
        this.view.showTranslation(result.search, result.explanation || "");
      } catch (error) {
        this.view.notice(explain(error));
      }
      return;
    }
    if (name === "run-search") {
      const field = document.querySelector("#translate-q") as HTMLInputElement | null;
      this.category = "all";
      this.view.pressCategory("all");
      await this.setSearch(field?.value.trim() || "");
      return;
    }
    if (name === "summarize" && this.current) {
      this.view.setStrip({ ...this.strip(), loading: "Verlauf wird zusammengefasst …", tldr: "" });
      try {
        const result = await plugin<{ summary: { tldr?: string; model?: string }; cached?: boolean }>("AiSummarize", {
          folder: this.folder,
          uids: [this.current.uid],
          force: data.force === "1",
          sent: this.sentFolder
        });
        this.tldr = result.summary?.tldr || "";
        this.summaryCached = Boolean(result.cached);
        this.summaryModel = result.summary?.model || this.assistFlags?.provider || "";
        this.paintStrip();
      } catch (error) {
        this.view.setStrip({ ...this.strip(), error: explain(error) });
      }
      return;
    }
    if (name === "replies" && this.current) {
      this.view.setStrip({ ...this.strip(), loading: "Antwortvorschläge werden erstellt …" });
      try {
        const result = await plugin<{ replies: { label: string; body: string }[] }>("AiQuickReplies", {
          folder: this.folder,
          uids: [this.current.uid],
          sent: this.sentFolder
        });
        this.replies = (result.replies || []).slice(0, 3);
        this.paintStrip();
      } catch (error) {
        this.view.setStrip({ ...this.strip(), error: explain(error) });
      }
      return;
    }
    if (name === "use-reply") {
      const reply = this.replies[Number(data.index || 0)];
      if (!reply || !this.current) return;
      this.replyKind = "reply";
      const author = this.current.replyTo[0] || this.current.from[0];
      this.view.openCompose({
        title: reply.label || "Antworten",
        mode: "reply",
        to: author ? address(author) : "",
        cc: "",
        subject: /^re:/i.test(this.current.subject) ? this.current.subject : `Re: ${this.current.subject}`,
        body: reply.body
      });
      return;
    }
    if (name === "triage") {
      this.view.notice("Absender, Betreff und Vorschau dieser Seite gehen an das Modell.");
      try {
        const result = await plugin<{ stored?: number; warning?: string }>("AiTriageLlm", {
          folder: this.folder,
          items: this.messages.map((message) => ({
            uid: message.uid,
            from: message.from.map(label).join(", "),
            subject: message.subject,
            preview: message.preview
          }))
        });
        this.view.notice(result.warning || `${result.stored || 0} Mails eingeordnet.`);
        await this.loadList(false);
      } catch (error) {
        this.view.notice(explain(error));
      }
      return;
    }
    if (name === "deadlines") {
      const items = this.alertItems.filter((item) => item.type !== "followup").slice(0, 8);
      if (!items.length) {
        this.view.notice("Keine Mails für eine Frist.");
        return;
      }
      try {
        const result = await plugin<{ alerts: { title: string; due: string }[] }>("AiAlertsLlm", { items });
        const dues = (result.alerts || []).filter((item) => item.due).map((item) => `${item.due} ${item.title}`).join(" · ");
        this.view.setAlerts(
          this.alertItems.filter((item) => item.type === "reply").length,
          this.alertItems.filter((item) => item.type === "followup").length,
          this.alertItems.filter((item) => item.type === "invoice").length,
          dues
        );
      } catch (error) {
        this.view.notice(explain(error));
      }
      return;
    }
    if (name === "ask") {
      const text = (data.text || "").trim();
      if (!text) return;
      this.chat.push({ role: "user", content: text });
      this.turns.push({ role: "user", text, trace: [], actions: [] });
      this.view.setChat(this.turns, "Copilot arbeitet …", this.contextLabel());
      try {
        const result = await plugin<{ reply: string; actions?: Record<string, unknown>[]; trace?: { summary?: string }[] }>("AiChat", {
          messages: this.chat,
          context: this.useContext && this.current ? { folder: this.folder, uid: this.current.uid } : {},
          folders: this.folders.map((folder) => folder.fullName),
          sent: this.sentFolder
        });
        this.chat.push({ role: "assistant", content: result.reply || "" });
        this.chatActions = result.actions || [];
        this.turns.push({
          role: "assistant",
          text: result.reply || "",
          trace: (result.trace || []).map((item) => item.summary || "").filter(Boolean),
          actions: this.chatActions.map((action) => ({ label: String(action.label || action.type || ""), state: "" }))
        });
        this.view.setChat(this.turns, "", this.contextLabel());
      } catch (error) {
        this.view.setChat(this.turns, "!" + explain(error), this.contextLabel());
      }
      return;
    }
    if (name === "drop-context") {
      this.useContext = false;
      this.view.setChat(this.turns, "", "");
      return;
    }
    if (name === "dismiss-action") {
      const index = Number(data.index || 0);
      const turn = [...this.turns].reverse().find((item) => item.role === "assistant");
      if (turn?.actions[index]) turn.actions[index].state = "Verworfen";
      this.view.setChat(this.turns, "", this.contextLabel());
      return;
    }
    if (name === "run-action") {
      await this.runChatAction(Number(data.index || 0));
      return;
    }
    if (name === "generate") await this.generate();
    if (name === "stop-generate") this.draftAbort?.abort();
    if (name === "revert-draft") this.view.setDraftBody(this.draftBackup);
    if (name === "apply-subject") {
      const hint = document.querySelector("#subject-hint") as HTMLElement | null;
      const subject = hint?.dataset.subject || "";
      const field = document.querySelector("input[name='subject']") as HTMLInputElement | null;
      if (field && subject) field.value = subject;
    }
  }

  private contextLabel(): string {
    if (!this.useContext || !this.current) return "";
    return this.current.subject || "(ohne Betreff)";
  }

  private async generate(): Promise<void> {
    const options = this.view.draftOptions();
    this.draftBackup = options.body;
    this.draftAbort = new AbortController();
    this.view.setDraftBusy(true, "Entwurf wird geschrieben …");
    let streamed = "";
    try {
      await streamEvents("AiStream", {
        mode: options.mode,
        tone: options.tone,
        instruction: options.instruction,
        current: options.body,
        wantSubject: options.mode === "new" || options.mode === "reply",
        folder: this.folder,
        uids: this.current ? [this.current.uid] : [],
        sent: this.sentFolder
      }, (event, payload) => {
        if (event === "delta") {
          streamed += String(payload.text || "");
          this.view.setDraftBody(streamed);
        }
        if (event === "done") {
          this.view.setDraftBody(String(payload.body || streamed));
          this.view.setSubjectHint(String(payload.subject || ""));
          this.summaryModel = String(payload.model || "");
        }
        if (event === "error") throw new ApiError(1, String(payload.error || "Verbindung unterbrochen."));
      }, this.draftAbort.signal);
      this.view.setDraftBusy(false, this.summaryModel);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        this.view.setDraftBusy(false, "Abgebrochen.");
        return;
      }
      this.view.setDraftBusy(false, explain(error));
    }
  }

  private async runChatAction(index: number): Promise<void> {
    const action = this.chatActions[index];
    const turn = [...this.turns].reverse().find((item) => item.role === "assistant");
    if (!action || !turn?.actions[index] || turn.actions[index].state) return;
    const type = String(action.type || "");
    const folder = String(action.folder || this.folder);
    const uids = Array.isArray(action.uids) ? action.uids.map(String).join(",") : "";
    try {
      if (type === "delete") {
        if (!await this.view.confirmDelete()) return;
        await call("MessageDelete", { folder, uids });
      } else if (type === "archive") {
        if (!this.archiveFolder) throw new ApiError(1, "Kein Archiv-Ordner eingerichtet.");
        await call("MessageMove", { fromFolder: folder, toFolder: this.archiveFolder, uids });
      } else if (type === "move") {
        await call("MessageMove", { fromFolder: folder, toFolder: String(action.to || ""), uids });
      } else if (type === "mark_read" || type === "mark_unread") {
        await call("MessageSetSeen", { folder, uids, setAction: type === "mark_read" ? 1 : 0 });
      } else if (type === "flag" || type === "unflag") {
        await call("MessageSetFlagged", { folder, uids, setAction: type === "flag" ? 1 : 0 });
      } else if (type === "open" || type === "reply") {
        await this.selectFolder(folder);
        await this.selectMessage(Number(action.uid || 0));
        if (type === "reply") this.openReply(false);
        this.view.closeSheet();
      } else if (type === "compose") {
        this.openNew();
        this.view.openCompose({
          title: "Neue Nachricht",
          mode: "new",
          to: String(action.to || ""),
          cc: "",
          subject: String(action.subject || ""),
          body: ""
        });
      } else if (type === "search") {
        if (folder) await this.selectFolder(folder);
        await this.setSearch(String(action.search || ""));
      }
      turn.actions[index].state = "Erledigt";
      this.view.setChat(this.turns, "", this.contextLabel());
      if (uids) await this.loadList(false);
    } catch (error) {
      turn.actions[index].state = explain(error);
      this.view.setChat(this.turns, "", this.contextLabel());
    }
  }
}
