import { readAssist, type AssistFlags } from "./assistant";
import { assistKey, AssistScopes, chatActionAt, type AssistScope } from "./assist-state";
import {
  ApiError, call, explain, fetchDataUrl, fetchText, fileHash, loadApp, loadLanguage, messageHash, plugin, proxyUrl, rawUrl, streamEvents, syncContacts, watchSession
} from "./api";
import { cleanHtml, externalUrls, fillInline, originalLinks, plainToHtml, revealExternals } from "./clean";
import { openLetterWindow, parseIcs, parseMailto, parseUnsubscribe, srcdoc, type CalendarEvent } from "./letter";
import type { BulkAssistState, BulkMessageSummary, BulkReplyItem, BulkSummaryState, ReaderFile, ReaderPlace } from "./reader";
import { applyDesk, loadDesk, readCaps, writeProp, type Caps, type IdentityRow, type SettingsSnapshot } from "./settings";
import type { ComposeValues } from "./compose";
import {
  buildTree, displayName, flattenTree, folderPath, parseAcl, parseFolders, renderAcl, KOLAB_KEYS,
  type FolderAction, type FolderDesk, type FolderInfo, type FolderModel
} from "./folders";
import {
  autocryptHeader, autocryptKey, bodyFromDecrypt, clearRememberedPasses, emptyParts, gnupgDecrypt, loadGnuKeys, readParts,
  pgpVerify, rememberedPass, rememberPass, smimeDecrypt, smimeVerify, downloadText, type CryptoParts
} from "./crypto";
import { t } from "./i18n";
import { BoundedCache, pollBackoff } from "./runtime";
import { activeQuick, encodeValue, parseSearch, toggleQuick, type QuickFlag } from "./search";
import {
  createView, type ChatTurn, type ComposeSeed, type ListMode, type MailView, type MessageRow,
  type PickerFolder, type ReaderData, type StripState
} from "./view";

interface Person { name: string; email: string }
type Folder = FolderInfo;
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
  inReplyTo: string;
  draftInfo: [string, number, string] | null;
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
  threads: number[];
  threadUnseen: number[];
  headers: Record<string, string>;
  auth: { spf: string; dkim: string; dmarc: string };
  crypto: CryptoParts;
  autocrypt: string;
  cryptoState: "" | "ok" | "bad";
  cryptoText: string;
}

interface ListResult {
  "@Collection"?: Record<string, unknown>[];
  totalEmails?: number;
  offset?: number;
  totalThreads?: number;
  threadUid?: number;
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
  hideUnsubscribed: boolean;
  unhideKolab: boolean;
  kolab: boolean;
  defaultSort: string;
  useThreads: boolean;
  threadAlgorithm: string;
  listGrouped: boolean;
}

const PAGE_FALLBACK = 20;
/** Matches DraftRequest's limit for the `current` field. */
const DRAFT_TEXT_LIMIT = 8000;
const AI_CACHE_ENTRIES = 200;
const AI_CACHE_BYTES = 2 * 1024 * 1024;

interface AssistSummary {
  tldr?: string;
  points?: string[];
  decisions?: string[];
  actions?: { who?: string; what?: string; due?: string }[];
  next?: string;
  model?: string;
  count?: number;
}

interface AssistReply {
  label: string;
  body: string;
}
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

let hourCycle: "h12" | "h23" | undefined;

function when(stamp: number): string {
  if (!stamp) return "";
  const date = new Date(stamp * 1000);
  const now = new Date();
  const clock = hourCycle ? { hourCycle } : {};
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", ...clock });
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
  private chatBusy = false;
  private chatKnown: string[] = [];
  private assistScopes = new AssistScopes();
  /** AI output stays in this tab's memory; the server keeps none of it. */
  private summaryCache = new BoundedCache<string, AssistSummary>(AI_CACHE_ENTRIES, AI_CACHE_BYTES, (value) => JSON.stringify(value).length);
  private replyCache = new BoundedCache<string, AssistReply[]>(AI_CACHE_ENTRIES, AI_CACHE_BYTES, (value) => JSON.stringify(value).length);
  private replies: { label: string; body: string }[] = [];
  private bulkSummary: BulkSummaryState | null = null;
  private bulkSummaryLoading = "";
  private bulkSummaryError = "";
  private bulkRepliesList: BulkReplyItem[] = [];
  private bulkRepliesLoading = "";
  private bulkRepliesError = "";
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
  private prefs: Prefs = {
    viewImages: "ask", whitelist: "", proxy: false, removeColors: false, allowStyles: false, minFontSize: 5,
    maxBlockquotes: 0, collapseBlockquotes: true, viewHtml: true, hideDeleted: true, showNext: false, readAuto: true,
    readDelay: 5, checkInterval: 15, showUnreadCount: false, desktop: true, sound: true, soundName: "new-mail",
    useChecks: true, listInline: false, simpleFiles: false, newWindow: false, zip: false, thumbs: false, webPath: "",
    hideUnsubscribed: false, unhideKolab: false, kolab: false, defaultSort: "", useThreads: false, threadAlgorithm: "", listGrouped: false
  };
  private folderModel: FolderModel = { folders: [], quotaUsage: null, quotaLimit: null, capabilities: [] };
  private collapsed = new Set<string>();
  private folderFilter = "";
  private systemSettings = { sent: "", drafts: "", junk: "", trash: "", archive: "" };
  private sort = "";
  private threadUid = 0;
  private threadSubject = "";
  private deskNotice = "";
  private trashFolder = "";
  private junkFolder = "";
  private draftsFolder = "";
  private isExistingDraft = false;
  private checked = new Set<number>();
  private anchor = 0;
  private readTimer = 0;
  private pollTimer = 0;
  private logoutTimer = 0;
  private lastPoll = 0;
  private pollFailures = 0;
  private pollRetryAt = 0;
  private polling = false;
  private accountGeneration = 0;
  private listAbort: AbortController | null = null;
  private messageAbort: AbortController | null = null;
  private letterAbort: AbortController | null = null;
  private pollAbort: AbortController | null = null;
  private inboxUid = 0;
  private inboxUnread = -1;
  private letter = { uid: 0, mode: "html" as "html" | "plain", images: false, links: false, swap: false };
  private inlineCache = new BoundedCache<string, string>(64, 24 * 1024 * 1024,
    (value, key) => key.length + value.length);
  private calendarCache = new BoundedCache<string, CalendarEvent | null>(32, 1024 * 1024,
    (value, key) => key.length * 2 + (value ? Object.values(value).reduce((sum, text) => sum + text.length * 2, 0) : 0));
  private receiptSkipped = new BoundedCache<string, true>(256, 64 * 1024, (_value, key) => key.length * 2);
  private draftRef: { folder: string; uid: number } | null = null;
  private composeData: Record<string, unknown> = {};
  private boot: Record<string, unknown> = {};
  private identities: IdentityRow[] = [];
  private renderToken = 0;

  constructor(root: HTMLElement) {
    window.addEventListener("sm-appearance", () => { if (this.current) void this.paintLetter(); });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && this.email && Date.now() - this.lastPoll > 60_000) void this.poll(false);
    });
    watchSession(() => { if (this.email) this.view.showReauth(); });
    this.view = createView(root, {
      login: (email, password, stay, totp) => void this.login(email, password, stay, totp),
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
      markUnread: () => void this.forceSeen(false),
      markRead: () => void this.forceSeen(true),
      quotes: () => void this.toggleQuotes(),
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
    this.boot = data;
    const title = String(data.title || "SnappyMail");
    if (data.Auth) await this.enter(data);
    else {
      const system = (data.System || {}) as { languages?: Record<string, string> };
      this.view.showLogin(title, {
        languages: data.allowLanguagesOnLogin ? system.languages : undefined,
        language: String(data.language || ""),
        twoFactor: "RequireTwoFactor" in data
      });
    }
  }

  private async login(email: string, password: string, stay: boolean, totp = ""): Promise<void> {
    if (!email.trim() || !password) {
      this.view.setLoginError(t("LOGIN.ENTER_CREDENTIALS", "Adresse und Passwort eintragen."));
      return;
    }
    this.view.setLoginBusy(true);
    this.view.setLoginError("");
    try {
      const result = await call<Record<string, unknown>>("Login", {
        Email: email.trim(),
        Password: password,
        language: document.documentElement.lang || "",
        signMe: stay ? 1 : 0,
        totp_code: totp
      });
      await this.enter(result, this.view.hasMail());
    } catch (error) {
      this.view.setLoginError(explain(error));
    } finally {
      this.view.setLoginBusy(false);
    }
  }

  private invalidateAccount(clear: boolean): void {
    this.accountGeneration += 1;
    this.listSeq += 1;
    this.renderToken += 1;
    this.listAbort?.abort();
    this.messageAbort?.abort();
    this.letterAbort?.abort();
    this.pollAbort?.abort();
    this.draftAbort?.abort();
    this.polling = false;
    this.pollFailures = 0;
    this.pollRetryAt = 0;
    this.lastPoll = 0;
    window.clearTimeout(this.readTimer);
    if (!clear) return;
    this.inlineCache.clear();
    this.calendarCache.clear();
    this.receiptSkipped.clear();
    this.aboCache = null;
    this.tagged.clear();
    this.alertItems = [];
    this.chat = [];
    this.turns = [];
    this.chatKnown = [];
    this.summaryCache.clear();
    this.replyCache.clear();
    this.clearMessageAssist();
    this.clearBulkState();
    this.current = null;
    this.selected = 0;
    this.messages = [];
    this.identities = [];
    this.checked.clear();
    clearRememberedPasses();
  }

  private async logout(): Promise<void> {
    const request = call("Logout");
    this.invalidateAccount(true);
    window.clearInterval(this.pollTimer);
    this.email = "";
    try {
      await request;
      // Logout clears the account cookies. Re-read the anonymous CSRF state
      // before allowing an immediate login in the same document.
      await loadApp();
    } catch { /* the screen still returns to login */ }
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
      webPath: String(system.webVersionPath || "snappymail/v/0.0.0/"),
      hideUnsubscribed: bool(data.HideUnsubscribed, false),
      unhideKolab: bool(data.UnhideKolabFolders, false),
      kolab: Boolean(capa.Kolab),
      defaultSort: String(data.defaultSort || ""),
      useThreads: bool(data.useThreads ?? data.UseThreads, false),
      threadAlgorithm: String(data.threadAlgorithm || ""),
      listGrouped: bool(data.listGrouped, false)
    };
    this.systemSettings = {
      sent: String(data.SentFolder || ""), drafts: String(data.DraftsFolder || ""), junk: String(data.JunkFolder || ""),
      trash: String(data.TrashFolder || ""), archive: String(data.ArchiveFolder || "")
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
    this.configureComposer();
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

  private async enter(data: Record<string, unknown>, keep = false): Promise<void> {
    if (keep && this.view.hasMail()) {
      this.email = String(data.Email || this.email);
      this.composeData = { ...this.composeData, ...data };
      this.view.hideReauth();
      this.armLogout();
      return;
    }
    const nextEmail = String(data.Email || "");
    const nextHash = String(data.accountHash || "");
    const changed = Boolean(this.email) && (this.email !== nextEmail
      || Boolean(this.accountHash || nextHash) && this.accountHash !== nextHash);
    this.invalidateAccount(changed);
    const generation = this.accountGeneration;
    this.email = nextEmail;
    this.mainEmail = String(data.mainEmail || data.Email || "");
    this.caps = readCaps(data);
    this.accountHash = nextHash;
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
    this.sort = this.prefs.defaultSort;
    this.threadUid = 0;
    this.folderFilter = "";
    this.collapsed = this.readCollapsed();
    const page = Number(data.MessagesPerPage || PAGE_FALLBACK);
    this.pageSize = Math.min(100, Math.max(10, page || PAGE_FALLBACK));
    document.title = this.email || String(data.title || "Postfach");
    const assistFlags = await readAssist(data, async () => {
      const result = await plugin<{ settings: { enabled?: boolean; features?: Record<string, boolean>; notice_ack?: boolean } }>("AiGetSettings");
      return result.settings;
    });
    if (generation !== this.accountGeneration) return;
    this.assistFlags = assistFlags;
    this.noticeAck = Boolean(this.assistFlags?.noticeAck);
    const cycle = String(data.hourCycle || "");
    hourCycle = cycle === "h12" || cycle === "h23" ? cycle : undefined;
    this.view.showMail(this.email, "Posteingang", this.assistFlags);
    const sync = data.ContactsSync;
    this.view.setBook(this.caps.contacts, Boolean(sync && typeof sync === "object"), Number((sync as { Mode?: unknown } | null)?.Mode || 0));
    const layoutMode = Number(data.Layout ?? 1);
    this.view.setLayout(layoutMode === 2 ? 1 : layoutMode);
    this.view.setChecks(this.prefs.useChecks);
    this.desk = {
      caps: this.caps,
      mainEmail: this.mainEmail,
      currentEmail: this.email,
      accounts: [{ email: this.mainEmail, name: "", current: true, main: true, unread: null }],
      identities: [],
      scripts: this.caps.sieve ? [] : null,
      sieveCapa: [],
      folderNames: [],
      keys: [],
      certs: [],
      notes: { accounts: "", contacts: "", filters: "", keys: "", certs: "" },
      app: this.composeData,
      twoFactor: null,
      passwordPlugin: Boolean(((this.composeData.Plugins || {}) as Record<string, unknown>)["change-password"]),
      assist: null,
      assistTones: []
    };
    this.view.showSettings(this.desk);
    this.view.setFolderDesk(this.folderDesk());
    this.armLogout();
    if (this.assistFlags?.alerts) void this.loadAlerts();
    await Promise.all([this.loadFolders(), this.loadComposeIdentities()]);
    if (generation !== this.accountGeneration) return;
    this.configureComposer();
    const mailto = String(data.mailToEmail || "");
    if (mailto) {
      const seed = parseMailto(mailto);
      this.view.openCompose({ title: t("COMPOSE.TITLE_NEW_MESSAGE", "Neue Nachricht"), to: seed.to, cc: seed.cc, bcc: seed.bcc, subject: seed.subject, body: seed.body, mode: "new" });
    }
    window.clearInterval(this.pollTimer);
    this.pollTimer = window.setInterval(() => { if (!document.hidden) void this.poll(false); }, this.prefs.checkInterval * 60_000);
  }

  private async settings(name: string, data: Record<string, string>): Promise<void> {
    if (name.startsWith("folder-")) {
      await this.folderForm(name, data);
      return;
    }
    try {
      if (name === "export-key") {
        const row = this.desk?.keys[Number(data.index)];
        if (!row) return;
        if (row.source === "gnupg" && row.id) {
          let pass = "";
          if (row.secret) {
            pass = rememberedPass(row.id);
            if (!pass) {
              const answer = await this.view.askSecret(t("CRYPTO.PASSPHRASE_TITLE", "Passphrase"), t("CRYPTO.PASSPHRASE", "Passphrase"));
              if (!answer) return;
              pass = answer.value;
              rememberPass(row.id, pass, answer.remember);
            }
          }
          const pem = await call<string>("GnupgExportKey", { keyId: row.id, isPrivate: row.secret ? 1 : 0, passphrase: pass });
          if (typeof pem === "string" && pem) downloadText(`${row.email || row.id}.asc`, pem);
          return;
        }
        if (row.armored) downloadText(`${row.email || "key"}.asc`, row.armored);
        return;
      }
      if (name === "open") {
        if (this.desk) this.view.showSettings(this.desk);
        this.view.setFolderDesk(this.folderDesk());
        this.desk = await loadDesk(this.caps, this.email, this.mainEmail, this.composeData);
        this.view.showSettings(this.desk);
        return;
      }
      if (name === "test-sync") {
        await call("TestContactsSyncData", { Mode: Number(data.Mode || 0), Url: data.Url || "", User: data.User || "", Password: data.Password || "" });
        this.view.settingsNotice(t("CONTACTS.TEST_OK", "Die Verbindung steht."));
        return;
      }
      if (name === "sync-now") {
        if (this.desk) {
          await applyDesk("save-sync", data, this.desk);
          this.view.showSettings(this.desk);
        }
        if (Number(data.Mode || 0) === 0) {
          this.view.settingsNotice("Die Synchronisierung ist aus.");
          this.view.setBook(this.caps.contacts, true, 0);
          return;
        }
        await syncContacts();
        this.view.setBook(this.caps.contacts, true, Number(data.Mode || 0));
        this.view.settingsNotice(t("CONTACTS.SYNC_OK", "Synchronisiert."));
        await this.view.reloadBook();
        return;
      }
      if (name === "pref") {
        await this.savePref(data.key || "", data.value || "");
        return;
      }
      if (!this.desk) return;
      const next = await applyDesk(name, data, this.desk);
      if (name === "assist-save") {
        this.assistFlags = await readAssist(this.composeData, async () => {
          const result = await plugin<{ settings: { enabled?: boolean; features?: Record<string, boolean>; notice_ack?: boolean } }>("AiGetSettings");
          return result.settings;
        });
        this.view.setAssist(this.assistFlags);
        this.noticeAck = Boolean(this.assistFlags?.noticeAck);
        // Tone, language or provider may have changed, so earlier results no longer fit.
        this.summaryCache.clear();
        this.replyCache.clear();
      }
      if (next === "session") {
        await this.enter(await loadApp());
        return;
      }
      if (next === "keep") {
        this.view.showSettings(this.desk);
        this.view.settingsSaved();
        const sync = this.desk.app.ContactsSync as { Mode?: unknown } | null;
        if (sync && typeof sync === "object") this.view.setBook(this.caps.contacts, true, Number(sync.Mode || 0));
        return;
      }
      this.desk = await loadDesk(this.caps, this.email, this.mainEmail, this.composeData);
      this.view.showSettings(this.desk);
    } catch (error) {
      this.view.settingsNotice(explain(error));
    }
  }

  private async loadFolders(): Promise<void> {
    const generation = this.accountGeneration;
    try {
      const result = await call<Record<string, unknown>>("Folders");
      if (generation !== this.accountGeneration) return;
      this.folderModel = parseFolders(result);
      this.folders = this.folderModel.folders;
      this.resolveSystemFolders(null);
      const inbox = this.folders.find((folder) => folder.role === "inbox" || folder.fullName.toUpperCase() === "INBOX");
      if (inbox) { this.inboxUid = inbox.uidNext; this.inboxUnread = inbox.unread; }
      this.paintTitle();
      await this.selectFolder(inbox?.fullName || this.folders.find((folder) => folder.selectable)?.fullName || "INBOX");
    } catch (error) {
      if (generation === this.accountGeneration) this.view.setList([], "", explain(error), false, false);
    }
  }

  /** Ordner nach einer Änderung neu laden; der offene Ordner bleibt, wenn es ihn noch gibt. */
  private async reloadFolders(open = ""): Promise<void> {
    try {
      this.folderModel = parseFolders(await call<Record<string, unknown>>("Folders"));
      this.folders = this.folderModel.folders;
      this.resolveSystemFolders(null);
      const keep = open || this.folder;
      const target = this.folders.find((folder) => folder.fullName === keep && folder.selectable)
        || this.folders.find((folder) => folder.role === "inbox" || folder.fullName.toUpperCase() === "INBOX");
      if (target && target.fullName !== this.folder) await this.selectFolder(target.fullName);
      else this.paintFolders();
    } catch (error) {
      this.view.notice(explain(error));
    }
  }

  private capability(name: string): boolean {
    return this.folderModel.capabilities.includes(name);
  }

  private threadsAvailable(): boolean {
    return this.folderModel.capabilities.some((capa) => capa.startsWith("THREAD="));
  }

  private threadsOn(): boolean {
    return this.threadsAvailable() && this.prefs.useThreads;
  }

  private collapseKey(): string {
    return `sm-folders-collapsed:${this.accountHash || this.email}`;
  }

  private readCollapsed(): Set<string> {
    try {
      const raw = localStorage.getItem(this.collapseKey());
      const list = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(list) ? list.map(String) : []);
    } catch {
      return new Set();
    }
  }

  private writeCollapsed(): void {
    try { localStorage.setItem(this.collapseKey(), JSON.stringify([...this.collapsed])); } catch { /* ohne Speicher bleibt es für diese Sitzung */ }
  }

  private isSystem(folder: Folder): boolean {
    const role = this.roleOf(folder);
    return Boolean(role) || [this.sentFolder, this.draftsFolder, this.trashFolder, this.junkFolder, this.archiveFolder].includes(folder.fullName);
  }

  private aboCache: { source: Folder[]; keep: Set<string> } | null = null;

  /** Bei „Nicht abonnierte ausblenden“ bleiben abonnierte Ordner und ihre Eltern stehen (wie `hasSubscriptions` alt). */
  private subscribedTree(): Set<string> {
    if (this.aboCache?.source === this.folders) return this.aboCache.keep;
    const keep = new Set<string>();
    const byName = new Map(this.folders.map((folder) => [folder.fullName, folder]));
    this.folders.forEach((folder) => {
      if (!folder.subscribed && this.roleOf(folder) !== "inbox") return;
      let current: Folder | undefined = folder;
      while (current && !keep.has(current.fullName)) {
        keep.add(current.fullName);
        current = current.parent ? byName.get(current.parent) : undefined;
      }
    });
    this.aboCache = { source: this.folders, keep };
    return keep;
  }

  private hiddenFolder(folder: Folder): boolean {
    if (this.prefs.hideUnsubscribed && !this.subscribedTree().has(folder.fullName)) return true;
    return this.prefs.kolab && this.capability("METADATA") && Boolean(folder.kolabType) && !this.prefs.unhideKolab;
  }

  /** Aktionen im Ordnermenü; was nicht geht, fehlt. */
  private folderActions(folder: Folder, hasChildren: boolean): FolderAction[] {
    const role = this.roleOf(folder);
    const list: FolderAction[] = [];
    if (folder.exists && !folder.noInferiors) list.push("create-sub");
    if (folder.exists && folder.selectable && !this.isSystem(folder)) list.push("rename");
    if (folder.selectable && folder.unread > 0) list.push("read-all");
    if (folder.selectable && (role === "trash" || role === "junk" || role === "spam") && folder.total > 0) list.push("clear");
    if (folder.exists) list.push("settings");
    void hasChildren;
    return list;
  }

  private folderDesk(): FolderDesk {
    const roots = buildTree(this.folders, (folder) => this.roleOf(folder));
    const rows = flattenTree(roots, {
      collapsed: new Set(), filter: "", hidden: () => false, current: this.folder,
      roleOf: (folder) => this.roleOf(folder), actions: () => []
    });
    return {
      rows: rows.map((row) => ({
        info: row.info,
        depth: row.depth,
        role: row.role,
        hasChildren: row.hasChildren,
        canDelete: row.info.exists && row.info.selectable && !this.isSystem(row.info) && row.info.total === 0 && !row.hasChildren,
        canClear: row.info.selectable && ["trash", "junk", "spam"].includes(row.role) && row.info.total > 0,
        canRename: row.info.exists && row.info.selectable && !this.isSystem(row.info)
      })),
      hideUnsubscribed: this.prefs.hideUnsubscribed,
      kolab: this.prefs.kolab && this.capability("METADATA"),
      unhideKolab: this.prefs.unhideKolab,
      acl: this.capability("ACL"),
      system: { ...this.systemSettings },
      quota: this.quota(),
      notice: this.deskNotice
    };
  }

  private quota(): { used: number; limit: number } | null {
    const { quotaUsage, quotaLimit } = this.folderModel;
    return quotaLimit ? { used: quotaUsage || 0, limit: quotaLimit } : null;
  }

  private folderName(folder: Folder | undefined): string {
    if (!folder) return "";
    return displayName(folder, this.roleOf(folder));
  }

  /** Eltern für „Neuer Ordner“: vorhandene Ordner mit Unterordnern erlaubt. */
  private parentChoices(): { value: string; label: string }[] {
    const roots = buildTree(this.folders, (folder) => this.roleOf(folder));
    const rows = flattenTree(roots, {
      collapsed: new Set(), filter: "", hidden: (folder) => this.hiddenFolder(folder), current: "",
      roleOf: (folder) => this.roleOf(folder), actions: () => []
    });
    return [{ value: "", label: "Oberste Ebene" }].concat(rows
      .filter((row) => row.info.exists && !row.info.noInferiors)
      .map((row) => ({ value: row.info.fullName, label: `${"\u00a0\u00a0".repeat(row.depth)}${this.folderName(row.info)}` })));
  }

  private async createFolder(name: string, parent: string, subscribe: boolean): Promise<void> {
    if (!name.trim()) return;
    const delimiter = this.folders.find((folder) => folder.fullName === parent)?.delimiter || this.folders[0]?.delimiter || "/";
    if (delimiter && name.includes(delimiter)) {
      this.view.notice(`Der Name darf das Trennzeichen „${delimiter}“ nicht enthalten.`);
      this.deskNotice = `Der Name darf das Trennzeichen „${delimiter}“ nicht enthalten.`;
      return;
    }
    await call("FolderCreate", { folder: name.trim(), parent, subscribe: subscribe ? 1 : 0 });
    if (parent) { this.collapsed.delete(parent); this.writeCollapsed(); }
    this.deskNotice = t("FOLDERS_UI.FOLDER_CREATED", "Ordner «%NAME%» angelegt.").replace("%NAME%", name.trim());
    this.view.notice(this.deskNotice);
    await this.reloadFolders();
  }

  /** Formulare aus dem Einstellungsabschnitt „Ordner“ und dem Freigabe-Dialog. */
  private async folderForm(name: string, data: Record<string, string>): Promise<void> {
    try {
      this.deskNotice = "";
      if (name === "folder-create") {
        await this.createFolder(data.folder || "", data.parent || "", Boolean(data.subscribe));
        this.view.openFolderSettings("");
        return;
      }
      if (name === "folder-save") {
        const old = this.folders.find((folder) => folder.fullName === data.oldName);
        if (!old) return;
        const leaf = (data.name || old.name).trim();
        const delimiter = old.delimiter || "/";
        if (!leaf) throw new ApiError(0, "Name eintragen.");
        if (delimiter && leaf.includes(delimiter)) throw new ApiError(0, `Der Name darf das Trennzeichen „${delimiter}“ nicht enthalten.`);
        const parent = data.parent ?? old.parent;
        const target = parent ? `${parent}${delimiter}${leaf}` : leaf;
        const kolab = this.prefs.kolab && this.capability("METADATA")
          ? { type: KOLAB_KEYS[0], value: data.kolab || "" }
          : null;
        if (target !== old.fullName) {
          await call("FolderRename", {
            oldName: old.fullName, newName: target, subscribe: data.subscribe ? 1 : 0, checkable: data.checkable ? 1 : 0,
            ...(kolab ? { kolab } : {})
          });
          this.deskNotice = t("FOLDERS_UI.FOLDER_RENAMED", "«%OLD%» heißt jetzt «%NEW%».").replace("%OLD%", folderPath(old)).replace("%NEW%", target);
        } else {
          if (Boolean(data.subscribe) !== old.subscribed && this.roleOf(old) !== "inbox") await call("FolderSubscribe", { folder: old.fullName, subscribe: data.subscribe ? 1 : 0 });
          if (old.selectable && Boolean(data.checkable) !== old.checkable) await call("FolderCheckable", { folder: old.fullName, checkable: data.checkable ? 1 : 0 });
          if (kolab && (data.kolab || "") !== old.kolabType) await call("FolderSetMetadata", { folder: old.fullName, key: KOLAB_KEYS[0], value: data.kolab || "" });
          this.deskNotice = "Gespeichert.";
        }
        this.view.notice(this.deskNotice);
        await this.reloadFolders(this.folder === old.fullName ? target : "");
        this.view.openFolderSettings("");
        return;
      }
      if (name === "folder-system") {
        await call("SystemFoldersUpdate", { sent: data.sent || "", drafts: data.drafts || "", junk: data.junk || "", trash: data.trash || "", archive: data.archive || "" });
        const app = await loadApp();
        this.readPrefs(app);
        this.resolveSystemFolders(app);
        this.composeData = app;
        this.configureComposer();
        this.deskNotice = t("FOLDERS_UI.SYSTEM_FOLDERS_SAVED", "Systemordner gespeichert.");
        this.view.notice(this.deskNotice);
        this.paintFolders();
        return;
      }
      if (name === "folder-options") {
        const params: Record<string, unknown> = { HideUnsubscribed: data.hideUnsubscribed ? 1 : 0 };
        if (this.prefs.kolab) params.UnhideKolabFolders = data.unhideKolab ? 1 : 0;
        await call("SettingsUpdate", params);
        this.prefs.hideUnsubscribed = Boolean(data.hideUnsubscribed);
        this.prefs.unhideKolab = Boolean(data.unhideKolab);
        this.deskNotice = "Gespeichert.";
        this.view.notice(this.deskNotice);
        await this.reloadFolders();
        return;
      }
      if (name === "folder-acl-set") {
        const rights = ["l", "r", "s", "w", "i", "p", "k", "x", "t", "e", "a"].filter((letter) => data[`r_${letter}`]).join("");
        if (!data.identifier?.trim()) throw new ApiError(0, t("FOLDERS_UI.ENTER_USER_OR_GROUP", "Benutzer oder Gruppe eintragen."));
        await call("FolderSetACL", { folder: data.folder, identifier: data.identifier.trim(), rights });
        await this.showAcl(data.folder || "", "");
        return;
      }
    } catch (error) {
      this.deskNotice = explain(error);
      if (name === "folder-acl-set") await this.showAcl(data.folder || "", explain(error));
      else {
        this.view.settingsNotice(explain(error));
        this.view.setFolderDesk(this.folderDesk());
        this.view.settingsNotice(explain(error));
      }
    }
  }

  private async showAcl(folder: string, error: string): Promise<void> {
    try {
      const entries = parseAcl(await call("FolderACL", { folder }));
      this.view.showAcl(folder, renderAcl(folder, entries, error));
    } catch (failure) {
      this.view.showAcl(folder, renderAcl(folder, [], error || explain(failure)));
    }
  }

  /** Ordneraktionen aus Seitenleiste, Menü und Einstellungen. */
  private async folderAction(name: string, data: Record<string, string>): Promise<void> {
    const folder = this.folders.find((item) => item.fullName === data.target);
    try {
      switch (name) {
        case "f-toggle":
          if (!data.target) return;
          if (this.collapsed.has(data.target)) this.collapsed.delete(data.target);
          else this.collapsed.add(data.target);
          this.writeCollapsed();
          this.paintFolders();
          return;
        case "f-filter":
          this.folderFilter = data.q || "";
          this.paintFolders();
          return;
        case "f-desk":
          this.view.setFolderDesk(this.folderDesk());
          return;
        case "f-create":
        case "f-create-sub": {
          const result = await this.view.folderDialog({
            title: name === "f-create" ? t("FOLDERS_UI.TITLE_CREATE", "Ordner anlegen") : t("FOLDERS_UI.TITLE_CREATE_SUB", "Neuer Unterordner in «%NAME%»").replace("%NAME%", this.folderName(folder)),
            parents: this.parentChoices(),
            parent: name === "f-create-sub" ? data.target || "" : ""
          });
          if (result) await this.createFolder(result.name, result.parent, result.subscribe);
          return;
        }
        case "f-rename": {
          if (!folder) return;
          const next = await this.view.ask(t("FOLDERS_UI.TITLE_RENAME", "Ordner umbenennen"), t("FOLDERS_UI.LABEL_NEW_NAME", "Neuer Name"), folder.name);
          if (!next || next === folder.name) return;
          if (folder.delimiter && next.includes(folder.delimiter)) {
            this.view.notice(`Der Name darf das Trennzeichen „${folder.delimiter}“ nicht enthalten.`);
            return;
          }
          const target = folder.parent ? `${folder.parent}${folder.delimiter}${next}` : next;
          await call("FolderRename", { oldName: folder.fullName, newName: target, subscribe: folder.subscribed ? 1 : 0, checkable: folder.checkable ? 1 : 0 });
          if (this.collapsed.delete(folder.fullName)) { this.collapsed.add(target); this.writeCollapsed(); }
          this.view.notice(`Umbenannt in „${next}“.`);
          await this.reloadFolders(this.folder === folder.fullName ? target : "");
          return;
        }
        case "f-read-all": {
          if (!folder) return;
          await call("MessageSetSeenToAll", { folder: folder.fullName, setAction: 1 });
          folder.unread = 0;
          if (folder.fullName === this.folder) this.messages.forEach((message) => { if (!seen(message.flags)) message.flags.push("\\Seen"); });
          this.view.notice(t("FOLDERS_UI.ALL_MARKED_READ", "Alle Mails in «%NAME%» sind gelesen.").replace("%NAME%", this.folderName(folder)));
          this.paintFolders();
          if (folder.fullName === this.folder) this.paintList();
          return;
        }
        case "f-clear": {
          if (!folder) return;
          const ok = await this.view.confirm(
            t("FOLDERS_UI.CONFIRM_CLEAR_TITLE", "Endgültig leeren"),
            t("FOLDERS_UI.CONFIRM_CLEAR_DESC", "Alle %COUNT% Mails in diesem Ordner werden endgültig gelöscht. Das lässt sich nicht rückgängig machen.").replace("%COUNT%", String(folder.total)),
            t("FOLDERS_UI.CONFIRM_CLEAR_TITLE", "Endgültig leeren")
          );
          if (!ok) return;
          await call("FolderClear", { folder: folder.fullName });
          this.view.notice(`„${this.folderName(folder)}“ ist leer.`);
          if (folder.fullName === this.folder) {
            this.current = null;
            this.selected = 0;
            this.checked.clear();
            this.view.setReader(null, "", "");
          }
          await this.reloadFolders();
          if (folder.fullName === this.folder) await this.loadList(false);
          return;
        }
        case "f-delete": {
          if (!folder || folder.total > 0 || this.isSystem(folder)) return;
          const ok = await this.view.confirm(t("FOLDERS_UI.CONFIRM_DELETE_TITLE", "Ordner «%NAME%» löschen?").replace("%NAME%", folder.name), t("FOLDERS_UI.CONFIRM_DELETE_DESC", "Der leere Ordner wird auf dem Server gelöscht."), t("FOLDERS_UI.ACL_DELETE", "Ordner löschen"));
          if (!ok) return;
          await call("FolderDelete", { folder: folder.fullName });
          this.collapsed.delete(folder.fullName);
          this.writeCollapsed();
          this.deskNotice = t("FOLDERS_UI.FOLDER_DELETED", "Ordner «%NAME%» gelöscht.").replace("%NAME%", folder.name);
          this.view.notice(this.deskNotice);
          await this.reloadFolders(this.folder === folder.fullName ? "INBOX" : "");
          return;
        }
        case "f-subscribe":
          if (!folder) return;
          await call("FolderSubscribe", { folder: folder.fullName, subscribe: folder.subscribed ? 0 : 1 });
          this.deskNotice = folder.subscribed ? t("FOLDERS_UI.NOT_SUBSCRIBED", "nicht mehr abonniert") : t("FOLDERS_UI.CHECKED", "abonniert");
          await this.reloadFolders();
          return;
        case "f-checkable":
          if (!folder) return;
          await call("FolderCheckable", { folder: folder.fullName, checkable: folder.checkable ? 0 : 1 });
          this.deskNotice = folder.checkable ? t("FOLDERS_UI.CHECK_OFF", "«%NAME%» wird nicht mehr geprüft.").replace("%NAME%", folder.name) : t("FOLDERS_UI.CHECK_ON", "«%NAME%» wird auf neue Mail geprüft.").replace("%NAME%", folder.name);
          await this.reloadFolders();
          return;
        case "f-acl":
          if (folder) await this.showAcl(folder.fullName, "");
          return;
        case "f-acl-delete": {
          if (!data.target || !data.id) return;
          const ok = await this.view.confirm(t("FOLDERS_UI.CONFIRM_REVOKE_TITLE", "Freigabe für «%ID%» entfernen?").replace("%ID%", data.id), t("FOLDERS_UI.CONFIRM_REVOKE_DESC", "Diese Person oder Gruppe verliert den Zugriff auf den Ordner."), t("GLOBAL.DELETE", "Entfernen"));
          if (!ok) return;
          await call("FolderDeleteACL", { folder: data.target, identifier: data.id });
          await this.showAcl(data.target, "");
          return;
        }
        default:
          return;
      }
    } catch (error) {
      this.deskNotice = explain(error);
      this.view.notice(explain(error));
      this.view.setFolderDesk(this.folderDesk());
    }
  }

  private async selectFolder(fullName: string): Promise<void> {
    window.clearTimeout(this.readTimer);
    this.messageAbort?.abort();
    this.letterAbort?.abort();
    this.renderToken += 1;
    this.folder = fullName;
    this.offset = 0;
    this.search = "";
    this.threadUid = 0;
    this.view.setSearch("", new Set());
    this.selected = 0;
    this.current = null;
    this.checked.clear();
    this.view.setReader(null, "", "");
    this.paintFolders();
    await this.loadList(false);
  }

  private paintFolders(): void {
    const roots = buildTree(this.folders, (folder) => this.roleOf(folder));
    const rows = flattenTree(roots, {
      collapsed: this.collapsed,
      filter: this.folderFilter,
      hidden: (folder) => this.hiddenFolder(folder),
      current: this.folder,
      roleOf: (folder) => this.roleOf(folder),
      actions: (folder, children) => this.folderActions(folder, children)
    });
    const current = this.folders.find((folder) => folder.fullName === this.folder);
    this.view.setFolders({
      rows,
      count: this.folders.filter((folder) => !this.hiddenFolder(folder)).length,
      filter: this.folderFilter,
      currentName: this.folderName(current),
      quota: this.quota(),
      canCreate: true
    });
    this.view.setFolderDesk(this.folderDesk());
    this.paintMode();
    this.paintTitle();
  }

  private paintMode(): void {
    const mode: ListMode = {
      sortable: this.capability("SORT"),
      sort: this.sort,
      threadsAvailable: this.threadsAvailable(),
      useThreads: this.prefs.useThreads,
      grouped: this.prefs.listGrouped,
      threadOpen: this.threadUid ? (this.threadSubject || "(ohne Betreff)") : ""
    };
    this.view.setListMode(mode);
  }

  /** Rolle für das Symbol: Server-Rolle oder die erkannten System-Ordner. */
  private roleOf(folder: Folder): string {
    if (folder.role) return folder.role === "spam" ? "junk" : folder.role;
    if (folder.fullName.toUpperCase() === "INBOX") return "inbox";
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
    const keyword = (name: string) => `keyword=${encodeValue("$ai_" + name)}`;
    if (this.category === "needs_reply") return `${keyword("needs_reply")}&unanswered`;
    if (["personal", "newsletter", "notification", "invoice"].includes(this.category)) return keyword(this.category);
    return this.search;
  }

  /** Kennung des Listenkontexts; Antworten zu einem anderen Kontext werden verworfen. */
  private listContext(): string {
    return JSON.stringify([this.accountHash, this.folder, this.listQuery(), this.sort, this.threadsOn(), this.threadUid]);
  }

  private async loadList(append: boolean, quiet = false): Promise<void> {
    this.listAbort?.abort();
    const controller = new AbortController();
    this.listAbort = controller;
    const generation = this.accountGeneration;
    const start = append ? this.offset : 0;
    const query = this.listQuery();
    const context = this.listContext();
    const seq = ++this.listSeq;
    // Eine neuere Anfrage ersetzt und beendet die ältere; Kontext und Generierung schützen zusätzlich.
    const stale = () => seq !== this.listSeq || generation !== this.accountGeneration || context !== this.listContext();
    if (!append && !quiet) this.view.setList([], "Mails werden geladen …", "", false, Boolean(query));
    try {
      const result = await call<ListResult>("MessageList", {
        folder: this.folder,
        offset: start,
        limit: quiet && !append ? Math.max(this.pageSize, this.messages.length) : this.pageSize,
        search: query,
        sort: this.capability("SORT") ? this.sort : "",
        uidNext: this.folders.find((folder) => folder.fullName === this.folder)?.uidNext || 0,
        ...(this.threadsOn() ? { useThreads: 1, threadAlgorithm: this.prefs.threadAlgorithm, threadUid: this.threadUid } : {})
      }, controller.signal);
      if (stale()) return;
      const batch = (result["@Collection"] || []).map((item) => this.parseMessage(item));
      this.messages = append ? this.messages.concat(batch) : batch;
      this.offset = start + batch.length;
      this.total = this.threadsOn() && !this.threadUid && Number(result.totalThreads)
        ? Number(result.totalThreads)
        : Number(result.totalEmails ?? result.folder?.totalEmails ?? this.messages.length);
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
      if (stale() || error instanceof Error && error.name === "AbortError") return;
      if (!(error instanceof ApiError)) throw error;
      this.hasMore = false;
      this.view.setList(this.rows(), "", explain(error), false, Boolean(this.search));
    } finally {
      if (this.listAbort === controller) this.listAbort = null;
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
    const inReplyTo = String(item.inReplyTo || headers["in-reply-to"] || "");
    const draftInfo = (Array.isArray(item.draftInfo) && item.draftInfo.length === 3)
      ? [String(item.draftInfo[0]), Number(item.draftInfo[1]), String(item.draftInfo[2])] as [string, number, string]
      : null;
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
      inReplyTo,
      draftInfo,
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
      threads: Array.isArray(item.threads) ? item.threads.map(Number).filter(Boolean) : [],
      threadUnseen: Array.isArray(item.threadUnseen) ? item.threadUnseen.map(Number).filter(Boolean) : [],
      headers,
      auth: { spf: authStatus(item.spf), dkim: authStatus(item.dkim), dmarc: authStatus(item.dmarc) },
      crypto: full ? readParts(item) : emptyParts(),
      autocrypt: full ? autocryptHeader(headers) : "",
      cryptoState: "",
      cryptoText: ""
    };
  }

  private visible(): Msg[] {
    return this.prefs.hideDeleted ? this.messages.filter((message) => !hasFlag(message.flags, "\\deleted")) : this.messages;
  }

  /** Datumsgruppen nur bei Datumssortierung und nicht in einer geöffneten Unterhaltung. */
  private grouping(): boolean {
    return this.prefs.listGrouped && !this.threadUid && (this.sort === "" || this.sort === "DATE");
  }

  private groupOf(stamp: number): string {
    if (!stamp) return t("MESSAGE_LIST.NO_DATE", "Ohne Datum");
    const date = new Date(stamp * 1000);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const day = 86_400_000;
    if (date >= start) return t("MESSAGE_LIST.TODAY", "Heute");
    if (date.getTime() >= start.getTime() - day) return t("MESSAGE_LIST.YESTERDAY", "Gestern");
    const weekStart = new Date(start.getTime() - ((start.getDay() + 6) % 7) * day);
    if (date >= weekStart) return t("MESSAGE_LIST.THIS_WEEK", "Diese Woche");
    return date.toLocaleDateString(document.documentElement.lang === "en" ? "en-US" : "de-DE", { month: "long", year: "numeric" });
  }

  private rows(): MessageRow[] {
    const grouped = this.grouping();
    let last = "";
    return this.visible().map((message) => {
      const group = grouped ? this.groupOf(message.date) : "";
      const start = group && group !== last ? group : "";
      if (group) last = group;
      const threaded = this.threadsOn() && !this.threadUid && message.threads.length > 1;
      return {
      group: start,
      threadCount: threaded ? message.threads.length : 0,
      threadUnseen: threaded ? message.threadUnseen.length : 0,
      uid: message.uid,
      who: label(message.from[0] || { name: "", email: "" }) || t("GLOBAL.UNKNOWN", "(unbekannt)"),
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
      };
    });
  }

  private paintList(): void {
    const empty = this.visible().length
      ? ""
      : this.category !== "all" ? "Keine Mails für diesen Filter."
      : this.search ? t("FOLDERS_UI.NO_MATCH", "Keine Treffer. Suche anpassen oder Filter entfernen.") : t("FOLDERS_UI.EMPTY_FOLDER", "Dieser Ordner ist leer.");
    this.view.setList(this.rows(), empty, "", this.hasMore, Boolean(this.search) || this.category !== "all");
  }

  private async setSearch(query: string): Promise<void> {
    this.search = query;
    this.threadUid = 0;
    this.paintMode();
    this.view.setSearch(query, activeQuick(query));
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
    this.messageAbort?.abort();
    this.letterAbort?.abort();
    this.renderToken += 1;
    const controller = new AbortController();
    this.messageAbort = controller;
    const generation = this.accountGeneration;
    const folder = this.folder;
    this.selected = uid;
    this.checked.clear();
    this.clearMessageAssist();
    this.paintList();
    this.view.setReader(null, "Brief wird geladen …", "");
    try {
      const result = await call<Record<string, unknown>>("Message", { folder, uid }, controller.signal);
      if (this.selected !== uid || this.folder !== folder || generation !== this.accountGeneration) return;
      const message = this.parseMessage(result, true);
      this.current = message;
      this.letter = { uid, mode: this.prefs.viewHtml && message.html ? "html" : "plain", images: false, links: false, swap: false };
      const row = this.messages.find((item) => item.uid === uid);
      if (row) row.flags = message.flags.slice();
      this.scheduleSeen(message);
      await this.paintLetter();
      if (this.current !== message || generation !== this.accountGeneration) return;
      this.restoreMessageAssist();
      this.paintStrip();
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      if (this.selected === uid && this.folder === folder && generation === this.accountGeneration) {
        this.view.setReader(null, "", explain(error));
      }
    } finally {
      if (this.messageAbort === controller) this.messageAbort = null;
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
    this.letterAbort?.abort();
    const controller = new AbortController();
    this.letterAbort = controller;
    const signal = controller.signal;
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
          try {
            const value = await fetchDataUrl(rawUrl("View", hash), 8 * 1024 * 1024, signal);
            if (!signal.aborted) this.inlineCache.set(hash, value);
          } catch { /* Bild fehlt oder der Brief ist nicht mehr aktuell. */ }
        }));
        if (signal.aborted) return;
        body = fillInline(body, this.inlineCache);
      }
      if (cleaned.externals) {
        if (this.imagesAllowed(message)) {
          if (this.prefs.proxy) {
            const loaded = new Map<string, string>();
            const urls = externalUrls(body).slice(0, 40);
            await Promise.all(urls.map(async (url) => {
              try {
                const value = await fetchDataUrl(proxyUrl(url), 4 * 1024 * 1024, signal);
                if (!signal.aborted) loaded.set(url, value);
              } catch { /* Bild nicht erreichbar oder nicht mehr aktuell. */ }
            }));
            if (signal.aborted) return;
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
    if (signal.aborted || token !== this.renderToken || this.current !== message) return;

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
        try {
          const text = await fetchText(rawUrl("ViewAsPlain", ics.hash), 2 * 1024 * 1024, signal);
          if (signal.aborted) return;
          this.calendarCache.set(ics.hash, parseIcs(text));
        } catch {
          if (signal.aborted) return;
          this.calendarCache.set(ics.hash, null);
        }
      }
      calendar = this.calendarCache.get(ics.hash) || null;
      if (signal.aborted || token !== this.renderToken || this.current !== message) return;
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
      place: this.place(),
      crypto: message.crypto.pgpEncrypted || message.crypto.pgpSigned || message.crypto.smimeEncrypted || message.crypto.smimeSigned || message.autocrypt
        ? {
          encrypted: Boolean(message.crypto.pgpEncrypted || message.crypto.smimeEncrypted),
          signed: Boolean(message.crypto.pgpSigned || message.crypto.smimeSigned),
          autocrypt: Boolean(message.autocrypt),
          smime: Boolean(message.crypto.smimeSigned || message.crypto.smimeEncrypted),
          state: message.cryptoState,
          text: message.cryptoText
        }
        : null
    };
    this.view.setReader(data, "", "");
  }

  private async loadComposeIdentities(): Promise<void> {
    const generation = this.accountGeneration;
    try {
      const result = await call<{ Identities?: unknown }>("AccountsAndIdentities");
      if (generation !== this.accountGeneration) return;
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
    } catch {
      if (generation !== this.accountGeneration) return;
      this.identities = [];
    }
    if (!this.identities.length) this.identities = [{ id: "", label: "", email: this.email, name: "", replyTo: "", bcc: "", signature: "", signatureInsertBefore: false, sentFolder: "", pgpEncrypt: false, pgpSign: false, smimeKey: "", smimeCertificate: "", smimeCertificateChain: "" }];
  }

  private configureComposer(): void {
    const data = this.composeData;
    this.view.configureCompose({
      editor: String(data.EditorDefaultType || "Plain") === "Html" ? "Html" : "Plain",
      markdown: Boolean(data.markdown), spellcheck: Boolean(data.allowSpellcheck), autosave: Boolean(data.AllowDraftAutosave ?? true),
      draftsFolder: this.draftsFolder, sentFolder: this.sentFolder, replySameFolder: Boolean(data.ReplySameFolder),
      attachmentLimit: Number(data.attachmentLimit || 0), readReceipt: Boolean(data.requestReadReceipt), dsn: Boolean(data.requestDsn),
      requireTLS: Boolean(data.requireTLS), pgpSign: Boolean(data.pgpSign), pgpEncrypt: Boolean(data.pgpEncrypt),
      gnupg: this.caps.gnupg
    }, this.identities);
  }

  private replyIdentity(message: Msg): string {
    const recipients = [...message.to, ...message.cc, ...message.bcc];
    return this.identities.find((identity) => recipients.some((person) => person.email.toLowerCase() === identity.email.toLowerCase()))?.id || this.identities[0]?.id || "";
  }

  private openNew(preset: Partial<ComposeSeed> = {}): void {
    this.replyKind = "";
    this.draftRef = null;
    this.isExistingDraft = false;
    this.view.openCompose({ title: t("COMPOSE.TITLE_NEW_MESSAGE", "Neue Nachricht"), to: "", cc: "", subject: "", body: "", mode: "new", ...preset });
  }

  /** The one way to start a reply; assistant suggestions and chat actions reuse it for threading and identity. */
  private openReply(all: boolean, options: { message?: Msg; text?: string; title?: string; instruction?: string } = {}): void {
    const message = options.message || this.current;
    if (!message) return;
    this.replyKind = all ? "reply-all" : "reply";
    this.draftRef = null;
    this.isExistingDraft = false;
    const author = message.replyTo[0] || message.from[0];
    const others = [...message.to, ...message.cc].filter((person) => person.email.toLowerCase() !== this.email.toLowerCase());
    const body = message.plain || plainFromHtml(message.html);
    const subject = /^re:/i.test(message.subject) ? message.subject : `Re: ${message.subject}`;
    this.view.openCompose({
      title: options.title || (all ? t("COMPOSE.TITLE_REPLY_ALL", "Allen antworten") : t("COMPOSE.TITLE_REPLY", "Antworten")), mode: "reply", identityId: this.replyIdentity(message), sourceFolder: message.folder,
      instruction: options.instruction,
      to: author ? address(author) : "", cc: all ? others.map(address).join(", ") : "", subject,
      inReplyTo: message.messageId,
      references: [message.references, message.messageId].filter(Boolean).join(" "),
      draftInfo: [this.replyKind, message.uid, message.folder],
      body: `${options.text || ""}\n\nAm ${when(message.date)} schrieb ${author ? label(author) : ""}:\n${quote(body)}`
    });
  }

  private openForward(): void {
    const message = this.current;
    if (!message) return;
    this.replyKind = "forward";
    this.draftRef = null;
    this.isExistingDraft = false;
    const body = message.plain || plainFromHtml(message.html);
    const subject = /^fw:/i.test(message.subject) ? message.subject : `Fw: ${message.subject}`;
    this.view.openCompose({
      title: t("COMPOSE.TITLE_FORWARD", "Weiterleiten"), mode: "forward", to: "", cc: "", subject, identityId: this.replyIdentity(message), sourceFolder: message.folder,
      inReplyTo: message.messageId,
      references: [message.references, message.messageId].filter(Boolean).join(" "),
      draftInfo: ["forward", message.uid, message.folder],
      body: `\n\n${t("MESSAGE.FORWARD_HEADER", "-------- Weitergeleitete Nachricht --------")}\n${t("MESSAGE.FORWARD_FROM", "Von")}: ${message.from.map(label).join(", ")}\n${t("MESSAGE.FORWARD_SUBJECT", "Betreff")}: ${message.subject}\n\n${body}`
    });
    void this.view.attachCompose(message.attachments.filter((file) => !file.inline).map((file) => ({ key: file.hash, name: file.name, size: file.size })));
  }

  private async saveDraft(values: ComposeValues): Promise<{ folder: string; uid: number }> {
    const result = await call<{ folder?: string; uid?: number } | boolean>("SaveMessage", { ...values });
    if (!result) throw new ApiError(0, t("COMPOSE.ERROR_DRAFT_SAVE", "Der Entwurf konnte nicht gespeichert werden."));
    const folder = (typeof result === "object" && result?.folder) ? result.folder : (values.saveFolder || this.draftsFolder);
    const uid = (typeof result === "object" && result?.uid) ? result.uid : (this.draftRef?.uid || 0);
    this.draftRef = { folder, uid };
    if (this.folder === this.draftsFolder) {
      if (this.selected && uid) {
        this.selected = uid;
        if (this.current) this.current.uid = uid;
      }
      void this.loadList(false, true);
    }
    return this.draftRef;
  }

  private async closeCompose(discard: boolean): Promise<void> {
    if (discard && this.draftRef && !this.isExistingDraft) {
      try { await call("MessageDelete", { folder: this.draftRef.folder, uids: String(this.draftRef.uid) }); }
      catch (error) { this.view.notice(explain(error)); }
    }
    this.replyKind = "";
    this.draftRef = null;
    this.isExistingDraft = false;
    await this.loadList(false, true);
  }

  private async send(values: ComposeValues): Promise<void> {
    const message = this.current;
    const params: Record<string, unknown> = { ...values };
    if (values.inReplyTo) params.inReplyTo = values.inReplyTo;
    if (values.references) params.references = values.references;
    if (values.draftInfo) params.draftInfo = values.draftInfo;
    // The seed already names the replied-to mail; the open message may have changed since.
    if (message && this.replyKind && !values.draftInfo) {
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
      const wasDraft = Boolean(this.draftRef) || this.isExistingDraft;
      this.draftRef = null;
      this.isExistingDraft = false;
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

  private async archive(uid?: number): Promise<void> {
    const uids = uid ? [uid] : this.targets();
    if (!uids.length) return;
    if (!this.archiveFolder) {
      this.view.notice(t("MESSAGE.NO_ARCHIVE", "Kein Archiv-Ordner eingerichtet."));
      return;
    }
    if (this.folder === this.archiveFolder) {
      this.view.notice("Die Mail liegt schon im Archiv.");
      return;
    }
    await this.moveTo(uids, this.archiveFolder, false, uids.length === 1 ? "Archiviert." : `${uids.length} Mails archiviert.`);
  }

  /** Löschen: in den Papierkorb verschieben. Im Papierkorb oder ohne Papierkorb endgültig, dann mit Bestätigung. */
  private async remove(forever = false, uid?: number): Promise<void> {
    const uids = uid ? [uid] : this.targets();
    if (!uids.length) return;
    const permanent = forever || !this.trashFolder || this.folder === this.trashFolder;
    if (permanent) {
      const ok = await this.view.confirm(t("MESSAGE.CONFIRM_DELETE", "Endgültig löschen?"), uids.length === 1 ? t("MESSAGE.CONFIRM_DELETE_DESC", "Damit wird die Mail sofort entfernt. Das lässt sich nicht rückgängig machen.") : t("MESSAGE.CONFIRM_DELETE_DESC_PLURAL", "Damit werden %COUNT% Mails sofort entfernt. Das lässt sich nicht rückgängig machen.").replace("%COUNT%", String(uids.length)), t("MESSAGE.CONFIRM_DELETE", "Endgültig löschen"));
      if (!ok) return;
      try {
        await call("MessageDelete", { folder: this.folder, uids: uids.join(",") });
        this.view.notice(uids.length === 1 ? t("MESSAGE_LIST.DELETED_ONE", "Endgültig gelöscht.") : t("MESSAGE_LIST.DELETED_COUNT", "%COUNT% Mails endgültig gelöscht.").replace("%COUNT%", String(uids.length)));
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

  private async forceSeen(value: boolean): Promise<void> {
    const uids = this.targets();
    if (!uids.length) return;
    window.clearTimeout(this.readTimer);
    await this.setSeen(uids, value);
  }

  private async toggleQuotes(): Promise<void> {
    this.prefs.collapseBlockquotes = !this.prefs.collapseBlockquotes;
    this.composeData.CollapseBlockquotes = this.prefs.collapseBlockquotes;
    if (this.current) await this.paintLetter();
    try {
      await call("SettingsUpdate", { CollapseBlockquotes: this.prefs.collapseBlockquotes ? 1 : 0 });
    } catch (error) {
      this.view.notice(explain(error));
    }
  }

  private logoutWatch = false;

  private armLogout(): void {
    window.clearTimeout(this.logoutTimer);
    const minutes = Number(this.composeData.AutoLogout ?? 0);
    if (!this.logoutWatch) {
      this.logoutWatch = true;
      const reset = () => this.armLogout();
      window.addEventListener("pointerdown", reset);
      window.addEventListener("keydown", reset);
    }
    if (!minutes || !this.email) return;
    this.logoutTimer = window.setTimeout(() => { void this.logout(); }, minutes * 60_000);
  }

  private async savePref(key: string, raw: string): Promise<void> {
    const numeric = ["MessagesPerPage", "CheckMailInterval", "MessageReadDelay", "MsgDefaultAction", "minFontSize", "MaxBlockquotesLevel", "Layout", "AutoLogout", "keyPassForget"];
    const bools = ["UseThreads", "UseCheckboxesInList", "listGrouped", "HideDeleted", "HideUnsubscribed", "ShowUnreadCount", "messageReadAuto", "showNextMessage", "messageNewWindow", "ViewHTML", "RemoveColors", "AllowStyles", "CollapseBlockquotes", "ListInlineAttachments", "simpleAttachmentsList", "markdown", "allowSpellcheck", "AllowDraftAutosave", "ReplySameFolder", "ContactsAutosave", "requestReadReceipt", "requestDsn", "requireTLS", "pgpSign", "pgpEncrypt", "DesktopNotifications", "SoundNotification"];
    const value: unknown = numeric.includes(key) ? Number(raw) : bools.includes(key) ? (raw === "1" ? 1 : 0) : raw;
    await call("SettingsUpdate", { [key]: value });
    this.composeData[key] = numeric.includes(key) ? Number(raw) : bools.includes(key) ? raw === "1" : raw;
    if (key === "UseThreads") this.composeData.useThreads = raw === "1";
    if (key === "hourCycle") hourCycle = raw === "h12" || raw === "h23" ? raw : undefined;
    if (key === "Layout") {
      const mode = Number(raw);
      this.view.setLayout(mode === 2 ? 1 : mode);
    }
    if (key === "UseCheckboxesInList") this.view.setChecks(raw === "1");
    if (key === "MessagesPerPage") this.pageSize = Math.min(100, Math.max(10, Number(raw) || 25));
    if (key === "defaultSort") this.sort = raw;
    if (key === "ShowUnreadCount" || key === "HideDeleted" || key === "HideUnsubscribed") await this.loadFolders();
    if (["MessagesPerPage", "defaultSort", "UseThreads", "threadAlgorithm", "listGrouped", "HideDeleted"].includes(key)) await this.loadList(false, true);
    if (key === "CheckMailInterval") {
      this.prefs.checkInterval = Math.max(1, Number(raw) || 15);
      window.clearInterval(this.pollTimer);
      this.pollTimer = window.setInterval(() => { if (!document.hidden) void this.poll(false); }, this.prefs.checkInterval * 60_000);
    }
    if (key === "AutoLogout") this.armLogout();
    if (key === "language") {
      await loadLanguage(raw);
      document.documentElement.lang = raw;
      if (!this.view.composerOpen()) location.reload();
      else this.view.notice(t("SETTINGS_GENERAL.NOTICE_RELOAD", "Die Sprache gilt vollständig nach dem nächsten Laden."));
    }
    const readKeys = ["RemoveColors", "AllowStyles", "minFontSize", "MaxBlockquotesLevel", "CollapseBlockquotes", "ViewHTML", "ViewImages", "ViewImagesWhitelist", "ListInlineAttachments", "simpleAttachmentsList"];
    if (readKeys.includes(key)) {
      this.readPrefs(this.composeData);
      if (this.current) await this.paintLetter();
    }
    const writeKeys = ["EditorDefaultType", "markdown", "allowSpellcheck", "AllowDraftAutosave", "ReplySameFolder", "requestReadReceipt", "requestDsn", "requireTLS", "pgpSign", "pgpEncrypt"];
    if (writeKeys.includes(key)) this.configureComposer();
    if (key === "NotificationSound") this.prefs.soundName = raw;
    if (key === "SoundNotification") this.prefs.sound = raw === "1";
    if (key === "DesktopNotifications") this.prefs.desktop = raw === "1";
    if (key === "messageReadAuto") this.prefs.readAuto = raw === "1";
    if (key === "MessageReadDelay") this.prefs.readDelay = Number(raw) || 0;
    if (key === "showNextMessage") this.prefs.showNext = raw === "1";
    if (key === "messageNewWindow") this.prefs.newWindow = raw === "1";
    this.view.settingsSaved();
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
    const rows = flattenTree(buildTree(this.folders, (folder) => this.roleOf(folder)), {
      collapsed: new Set(), filter: "", hidden: (folder) => this.hiddenFolder(folder), current: "",
      roleOf: (folder) => this.roleOf(folder), actions: () => []
    });
    return rows.filter((row) => row.info.selectable)
      .map((row) => ({ fullName: row.info.fullName, name: this.folderName(row.info), depth: row.depth, role: row.role }));
  }

  private clearBulkState(): void {
    this.bulkSummary = null;
    this.bulkSummaryLoading = "";
    this.bulkSummaryError = "";
    this.bulkRepliesList = [];
    this.bulkRepliesLoading = "";
    this.bulkRepliesError = "";
  }

  private paintBulk(): void {
    if (!this.checked.size) {
      this.clearBulkState();
      this.view.setSelectionCount?.(0);
      if (this.current) void this.paintLetter();
      else this.view.setReader(null, "", "");
      return;
    }
    this.view.setStrip(null);
    this.view.notice("");
    if (this.bulkRepliesList.length) {
      this.bulkRepliesList = this.bulkRepliesList.filter((r) => this.checked.has(r.uid));
    }
    const checkedUids = [...this.checked];
    const selectedMsgs = checkedUids
      .map((uid) => this.messages.find((m) => m.uid === uid))
      .filter((m): m is Msg => Boolean(m));

    const unseenCount = selectedMsgs.filter((m) => !seen(m.flags)).length;
    const flaggedCount = selectedMsgs.filter((m) => hasFlag(m.flags, "\\flagged")).length;

    const summaries: BulkMessageSummary[] = selectedMsgs.map((m) => ({
      uid: m.uid,
      who: label(m.from[0] || { name: "", email: "" }) || t("GLOBAL.UNKNOWN", "(unbekannt)"),
      subject: m.subject || "(ohne Betreff)",
      when: when(m.date),
      unseen: !seen(m.flags),
      flagged: hasFlag(m.flags, "\\flagged")
    }));

    const assist: BulkAssistState | undefined = (this.assistFlags?.summarize || this.assistFlags?.replies)
      ? {
          summarize: Boolean(this.assistFlags?.summarize),
          replies: Boolean(this.assistFlags?.replies),
          loadingSummary: this.bulkSummaryLoading || undefined,
          loadingReplies: this.bulkRepliesLoading || undefined,
          error: this.bulkSummaryError || this.bulkRepliesError || undefined,
          summary: this.bulkSummary,
          repliesList: this.bulkRepliesList.length ? this.bulkRepliesList : undefined
        }
      : undefined;

    this.view.setSelectionCount?.(this.checked.size);
    this.view.setBulk({
      count: this.checked.size,
      place: this.place(),
      zip: this.prefs.zip,
      folderName: this.folder,
      totalInFolder: this.total,
      unseenCount,
      flaggedCount,
      messages: summaries,
      assist
    });
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
    if (!this.email || this.polling || !manual && Date.now() < this.pollRetryAt) return;
    this.polling = true;
    const generation = this.accountGeneration;
    const controller = new AbortController();
    this.pollAbort = controller;
    this.lastPoll = Date.now();
    if (manual) this.view.setRefreshing(true);
    try {
      const result = await call<{ "@Collection"?: Record<string, unknown>[] }>("Folders", {}, controller.signal);
      if (generation !== this.accountGeneration) return;
      const fresh = new Map((result["@Collection"] || []).map((item) => [String(item.fullName || ""), item]));
      let changed = manual;
      this.folders.forEach((folder) => {
        const item = fresh.get(folder.fullName);
        if (!item) return;
        const uidNext = Number(item.uidNext || 0);
        if (folder.fullName === this.folder && uidNext && uidNext !== folder.uidNext) changed = true;
        folder.unread = Number(item.unreadEmails || 0);
        folder.total = Number(item.totalEmails || 0);
        if (uidNext) folder.uidNext = uidNext;
      });
      if (result && typeof result === "object" && "quotaLimit" in result) {
        const raw = result as Record<string, unknown>;
        this.folderModel.quotaUsage = raw.quotaUsage == null ? null : Number(raw.quotaUsage);
        this.folderModel.quotaLimit = raw.quotaLimit == null ? null : Number(raw.quotaLimit);
      }
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
      this.pollFailures = 0;
      this.pollRetryAt = 0;
      this.paintFolders();
      if (changed && generation === this.accountGeneration) await this.loadList(false, true);
    } catch (error) {
      if (generation !== this.accountGeneration || error instanceof Error && error.name === "AbortError") return;
      this.pollFailures += 1;
      this.pollRetryAt = Date.now() + pollBackoff(this.pollFailures);
      if (manual) this.view.notice(explain(error));
    } finally {
      if (this.pollAbort === controller) this.pollAbort = null;
      if (generation === this.accountGeneration) {
        this.polling = false;
        if (manual) this.view.setRefreshing(false);
      }
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
  private async passFor(id: string): Promise<string | null> {
    const known = rememberedPass(id);
    if (known) return known;
    const answer = await this.view.askSecret(t("CRYPTO.PASSPHRASE_TITLE", "Passphrase"), t("CRYPTO.PASSPHRASE", "Passphrase"));
    if (!answer) return null;
    rememberPass(id, answer.value, answer.remember);
    return answer.value;
  }

  private async decryptOpen(): Promise<void> {
    const message = this.current;
    if (!message) return;
    try {
      let raw = "";
      if (message.crypto.pgpEncrypted && this.caps.gnupg) {
        const keys = await loadGnuKeys();
        const secret = keys.find((key) => key.secret) || null;
        const pass = await this.passFor(secret?.id || "gnupg");
        if (pass == null) return;
        raw = await gnupgDecrypt(message.folder, message.uid, message.crypto.pgpEncrypted.partId, secret?.id || "", pass);
      } else if (message.crypto.smimeEncrypted) {
        const identity = this.identities.find((item) => item.smimeKey && item.smimeCertificate) || null;
        const pass = await this.passFor(`smime:${identity?.id || ""}`);
        if (pass == null) return;
        raw = await smimeDecrypt(message.folder, message.uid, message.crypto.smimeEncrypted.partId, identity?.smimeCertificate || "", identity?.smimeKey || "", pass);
      } else return;
      if (!raw) throw new ApiError(0, t("CRYPTO.DECRYPT_FAIL", "Die Mail ließ sich nicht entschlüsseln."));
      const body = bodyFromDecrypt(raw);
      if (body.html) { message.html = body.html; this.letter.mode = "html"; }
      if (body.plain) message.plain = body.plain;
      message.cryptoState = "ok";
      message.cryptoText = t("CRYPTO.DECRYPTED", "Entschlüsselt.");
      await this.paintLetter();
    } catch (error) {
      message.cryptoState = "bad";
      message.cryptoText = explain(error);
      await this.paintLetter();
    }
  }

  private async verifyOpen(): Promise<void> {
    const message = this.current;
    if (!message) return;
    try {
      const result = message.crypto.pgpSigned
        ? await pgpVerify(message.folder, message.uid, message.crypto.pgpSigned)
        : message.crypto.smimeSigned
          ? await smimeVerify(message.folder, message.uid, message.crypto.smimeSigned)
          : null;
      if (!result) return;
      message.cryptoState = result.ok ? "ok" : "bad";
      message.cryptoText = result.text;
    } catch (error) {
      message.cryptoState = "bad";
      message.cryptoText = explain(error);
    }
    await this.paintLetter();
  }

  private async importAutocrypt(): Promise<void> {
    const message = this.current;
    const parsed = message ? autocryptKey(message.autocrypt) : null;
    if (!message || !parsed) return;
    try {
      await call("PgpImportKey", { key: parsed.key, keyId: "", email: parsed.email, backup: 1, gnuPG: this.caps.gnupg ? 1 : 0 });
      this.view.notice(t("CRYPTO.KEY_IMPORTED", "Schlüssel übernommen."));
    } catch (error) {
      this.view.notice(explain(error));
    }
  }

  private async importSmimeCerts(): Promise<void> {
    const message = this.current;
    const part = message?.crypto.smimeSigned || message?.crypto.smimeEncrypted;
    if (!message || !part) return;
    try {
      try {
        await call("SMimeImportCertificatesFromMessage", {
          folder: message.folder, uid: message.uid, partId: part.partId, sigPartId: part.sigPartId
        });
      } catch { /* Die Server-Aktion speichert die Zertifikate beim Prüfen. */ }
      if (message.crypto.smimeSigned) await smimeVerify(message.folder, message.uid, message.crypto.smimeSigned);
      this.view.notice(t("SMIME.IMPORTED", "Zertifikate übernommen, soweit der Server sie lesen konnte."));
    } catch (error) {
      this.view.notice(explain(error));
    }
  }

  private async act(name: string, data: Record<string, string>): Promise<void> {
    const message = this.current;
    const ref = Number(data.ref || data.uid || 0);
    switch (name) {
      case "login-lang": {
        if (!data.language) return;
        try {
          await loadLanguage(data.language);
          document.documentElement.lang = data.language;
          if (!this.view.hasMail()) {
            const system = (this.boot.System || {}) as { languages?: Record<string, string> };
            this.view.showLogin(String(this.boot.title || "SnappyMail"), {
              languages: this.boot.allowLanguagesOnLogin ? system.languages : undefined,
              language: data.language,
              twoFactor: "RequireTwoFactor" in this.boot
            });
          }
        } catch (error) {
          this.view.setLoginError(explain(error));
        }
        return;
      }
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
      case "select-filter": {
        const filter = data.filter || "all";
        const visibleMsgs = this.visible();
        this.checked.clear();
        if (filter === "all") {
          visibleMsgs.forEach((m) => this.checked.add(m.uid));
        } else if (filter === "unread") {
          visibleMsgs.filter((m) => !seen(m.flags)).forEach((m) => this.checked.add(m.uid));
        } else if (filter === "read") {
          visibleMsgs.filter((m) => seen(m.flags)).forEach((m) => this.checked.add(m.uid));
        } else if (filter === "flagged") {
          visibleMsgs.filter((m) => hasFlag(m.flags, "\\flagged")).forEach((m) => this.checked.add(m.uid));
        } else if (filter === "unflagged") {
          visibleMsgs.filter((m) => !hasFlag(m.flags, "\\flagged")).forEach((m) => this.checked.add(m.uid));
        }
        this.paintList();
        this.paintBulk();
        return;
      }
      case "select-folder": {
        this.messages.forEach((m) => this.checked.add(m.uid));
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
        const target = await this.view.pickFolder(copy ? t("MESSAGE.ACTION_COPY_TO", "Kopieren nach") : t("MESSAGE.ACTION_MOVE_TO", "Verschieben nach"), this.pickerFolders(), copy ? "" : this.folder);
        if (!target) return;
        const n = uids.length === 1 ? t("MESSAGE.ONE_MAIL", "Mail") : t("MESSAGE.PLURAL_MAILS", "%COUNT% Mails").replace("%COUNT%", String(uids.length));
        await this.moveTo(uids, target, copy, (copy ? t("MESSAGE.COPIED_TO", "%N% kopiert nach %TARGET%.") : t("MESSAGE.MOVED_TO", "%N% verschoben nach %TARGET%.")).replace("%N%", n).replace("%TARGET%", target));
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
        await this.archive(ref || undefined);
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
      case "delete":
        await this.remove(false, ref || undefined);
        return;
      case "delete-forever":
        await this.remove(true, ref || undefined);
        return;
      case "restore": {
        const uids = this.targets();
        await this.setFlag(uids, "\\deleted", false, "MessageSetDeleted");
        this.view.notice("Wiederhergestellt.");
        return;
      }
      case "tag": {
        if (!message) return;
        const value = await this.view.ask(t("MESSAGE.ACTION_ADD_TAG", "Schlagwort hinzufügen"), t("MESSAGE_TAGS.LABEL_NAME", "Schlagwort"));
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
          this.view.notice(t("MESSAGE.SHOW_IMAGES_ALWAYS", "Bilder von %SENDER% werden künftig angezeigt.").replace("%SENDER%", sender));
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
      case "decrypt":
        await this.decryptOpen();
        return;
      case "verify":
        await this.verifyOpen();
        return;
      case "autocrypt":
        await this.importAutocrypt();
        return;
      case "smime-certs":
        await this.importSmimeCerts();
        return;
      case "receipt":
      case "receipt-skip": {
        if (!message) return;
        this.receiptSkipped.set(`${message.folder}:${message.uid}`, true);
        if (name === "receipt") {
          try {
            await call("SendReadReceiptMessage", {
              messageFolder: message.folder,
              messageUid: message.uid,
              readReceipt: message.readReceipt,
              subject: t("MESSAGE.READ_RECEIPT_SUBJECT", "Gelesen: %SUBJECT%").replace("%SUBJECT%", message.subject),
              plain: t("MESSAGE.READ_RECEIPT_BODY", "Ihre Nachricht an %EMAIL% wurde gelesen.").replace("%EMAIL%", this.email)
            });
            message.flags.push("$mdnsent");
            this.view.notice(t("MESSAGE.READ_RECEIPT_SENT", "Lesebestätigung gesendet."));
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
          this.view.openCompose({ title: t("MESSAGE.UNSUBSCRIBE_TITLE", "Vom Verteiler abmelden"), to: seed.to, cc: seed.cc, bcc: seed.bcc, subject: seed.subject || "unsubscribe", body: seed.body, mode: "new" });
          return;
        }
        const host = (() => { try { return new URL(info.http).host; } catch { return info.http; } })();
        const ok = await this.view.confirm(t("MESSAGE.UNSUBSCRIBE_CONFIRM", "Vom Verteiler abmelden?"), t("MESSAGE.UNSUBSCRIBE_DESC", "Die Abmeldeseite von %HOST% öffnet sich in einem neuen Tab.").replace("%HOST%", host), t("MESSAGE.UNSUBSCRIBE_OPEN_BTN", "Seite öffnen"), false);
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
        let targetMsg = message;
        const targetUid = Number(data.uid || 0);
        if (targetUid && (!targetMsg || targetMsg.uid !== targetUid)) {
          try {
            const raw = await call<Record<string, unknown>>("Message", { folder: this.folder, uid: targetUid });
            targetMsg = this.parseMessage(raw, true);
            this.current = targetMsg;
            this.selected = targetUid;
            this.paintList();
          } catch (error) {
            this.view.notice(explain(error));
            return;
          }
        }
        if (!targetMsg) return;
        this.replyKind = "";
        this.isExistingDraft = name === "edit-draft";
        this.draftRef = name === "edit-draft" ? { folder: targetMsg.folder, uid: targetMsg.uid } : null;
        this.view.openCompose({
          title: name === "edit-draft" ? t("COMPOSE.TITLE_EDIT_DRAFT", "Entwurf") : t("COMPOSE.TITLE_NEW_MESSAGE", "Neue Nachricht"),
          to: targetMsg.to.map(address).join(", "), cc: targetMsg.cc.map(address).join(", "), bcc: targetMsg.bcc.map(address).join(", "),
          replyTo: targetMsg.replyTo.map(address).join(", "), subject: targetMsg.subject, body: targetMsg.plain || plainFromHtml(targetMsg.html),
          html: targetMsg.html, mode: name === "edit-draft" ? "draft" : "new", draftRef: this.draftRef,
          inReplyTo: targetMsg.inReplyTo, references: targetMsg.references, draftInfo: targetMsg.draftInfo || undefined,
          identityId: this.identities.find((identity) => targetMsg.from.some((person) => person.email.toLowerCase() === identity.email.toLowerCase()))?.id
        });
        void this.view.attachCompose(targetMsg.attachments.filter((file) => !file.inline).map((file) => ({ key: file.hash, name: file.name, size: file.size })));
        return;
      }
      case "forward-att": {
        const uids = this.targets();
        const list = uids.map((uid) => (message && message.uid === uid ? message : this.messages.find((item) => item.uid === uid))).filter(Boolean) as Msg[];
        if (!list.length) return;
        this.replyKind = "";
        this.draftRef = null;
        const subject = list.length === 1 ? (/^fw:/i.test(list[0].subject) ? list[0].subject : `Fw: ${list[0].subject}`) : t("MESSAGE.FORWARDED_MESSAGES_SUBJECT", "Weitergeleitete Nachrichten");
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
        this.view.openCompose({ title: t("COMPOSE.TITLE_NEW_MESSAGE", "Neue Nachricht"), to: address({ name: data.name || "", email: data.email || "" }), cc: "", subject: "", body: "", mode: "new" });
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
          const query = `from=${encodeValue(data.email)}`;
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
            this.view.notice(t("CONTACTS.ADDED", "%NAME% wurde zu den Kontakten hinzugefügt.").replace("%NAME%", data.name || data.email));
            await this.view.reloadBook();
          } catch (error) {
            this.view.notice(explain(error));
          }
        }
        return;
      case "compose-to":
        this.replyKind = "";
        this.draftRef = null;
        this.view.openCompose({ title: t("COMPOSE.TITLE_NEW_MESSAGE", "Neue Nachricht"), to: data.to || "", cc: "", subject: "", body: "", mode: "new" });
        return;
      case "accounts":
        await this.loadAccounts();
        return;
      case "sort":
        if (!this.capability("SORT")) return;
        this.sort = data.sort || "";
        await this.reloadList();
        return;
      case "threads-toggle":
        if (!this.threadsAvailable()) return;
        this.prefs.useThreads = !this.prefs.useThreads;
        this.threadUid = 0;
        try { await call("SettingsUpdate", { UseThreads: this.prefs.useThreads ? 1 : 0 }); } catch (error) { this.view.notice(explain(error)); }
        await this.reloadList();
        return;
      case "group-toggle":
        this.prefs.listGrouped = !this.prefs.listGrouped;
        try { await call("SettingsUpdate", { listGrouped: this.prefs.listGrouped ? 1 : 0 }); } catch (error) { this.view.notice(explain(error)); }
        this.paintMode();
        this.paintList();
        return;
      case "thread": {
        if (!this.threadsOn() || this.threadUid) return;
        const uid = ref || this.selected;
        const row = this.messages.find((item) => item.uid === uid);
        if (!row || row.threads.length < 2) return;
        this.threadUid = row.uid;
        this.threadSubject = row.subject;
        await this.reloadList();
        return;
      }
      case "thread-back":
        if (!this.threadUid) return;
        this.threadUid = 0;
        await this.reloadList();
        return;
      case "quick": {
        const flag = data.flag as QuickFlag;
        if (!["unseen", "flagged", "attachment"].includes(flag)) return;
        const base = data.query ?? this.search;
        await this.setSearch(toggleQuick(base, flag, this.capability("MULTISEARCH")));
        return;
      }
      case "adv-search": {
        const query = data.query ?? this.search;
        const keywords = [...new Set(this.messages.flatMap((item) => item.flags).filter((flag) => !SYSTEM_FLAGS.test(flag)))].sort();
        this.view.openSearch(parseSearch(query), { multisearch: this.capability("MULTISEARCH"), keywords });
        return;
      }
      case "switch":
        if (!data.email) return;
        try {
          await call("AccountSwitch", { Email: data.email });
          await this.enter(await loadApp());
        } catch (error) {
          this.view.notice(explain(error));
        }
        return;
      case "bulk-summarize":
        await this.assist("bulk-summarize", data);
        return;
      case "bulk-replies":
        await this.assist("bulk-replies", data);
        return;
      case "use-bulk-reply":
        await this.assist("use-bulk-reply", data);
        return;
      default:
        if (name.startsWith("f-")) await this.folderAction(name, data);
        return;
    }
  }

  /** Liste ab Offset 0 neu laden; Suche und Ordner bleiben. */
  private async reloadList(): Promise<void> {
    this.offset = 0;
    this.selected = 0;
    this.current = null;
    this.checked.clear();
    this.view.setReader(null, "", "");
    this.paintMode();
    await this.loadList(false);
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

  private clearMessageAssist(): void {
    this.assistScopes.reset();
    this.replies = [];
    this.tldr = "";
    this.summaryCached = false;
    this.summaryModel = "";
  }

  /** Scope for a provider request about the open message; stale once another message is shown. */
  private messageScope(): AssistScope {
    const generation = this.accountGeneration;
    return this.assistScopes.begin(() =>
      this.current && generation === this.accountGeneration ? `${this.folder}\n${this.current.uid}` : ""
    );
  }

  private applySummary(summary: AssistSummary, cached: boolean): void {
    this.tldr = summary.tldr || "";
    this.summaryCached = cached;
    this.summaryModel = summary.model || this.assistFlags?.provider || "";
  }

  /** Shows results from this session again without another provider request. */
  private restoreMessageAssist(): void {
    if (!this.current) return;
    const key = assistKey(this.folder, [this.current.uid]);
    const summary = this.summaryCache.get(key);
    if (summary && this.assistFlags?.summarize) this.applySummary(summary, true);
    const replies = this.replyCache.get(key);
    if (replies && this.assistFlags?.replies) this.replies = replies;
  }

  private async consent(kind: "mail" | "query" = "mail"): Promise<boolean> {
    if (this.noticeAck) return true;
    const name = this.assistFlags?.providerName || "den Anbieter";
    const text = kind === "query"
      ? `Ihre Suchanfrage geht an ${name}, die Mails bleiben dabei auf dem Server. Diese Einwilligung gilt auch für spätere KI-Aktionen, die nach einem Klick Mailinhalte an ${name} senden. Fortfahren?`
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
    const generation = this.accountGeneration;
    const inbox = this.folders.find((folder) => folder.role === "inbox")?.fullName || "INBOX";
    try {
      const result = await plugin<{ alerts: { type: string; folder: string; uid: number; title: string }[] }>("AiAlerts", {
        inbox,
        sent: this.sentFolder
      });
      if (generation !== this.accountGeneration) return;
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
      if (!this.assistFlags?.tabs) {
        const item = this.alertItems.find((entry) => entry.type === (data.kind === "invoice" ? "invoice" : "reply"));
        if (!item) return;
        if (item.folder !== this.folder) await this.selectFolder(item.folder);
        await this.selectMessage(item.uid);
        return;
      }
      await this.assist("cat", { cat: data.kind === "invoice" ? "invoice" : "needs_reply" });
      this.view.pressCategory(data.kind === "invoice" ? "invoice" : "needs_reply");
      return;
    }
    if (name === "ask") {
      if (this.chatBusy) return;
      this.chatBusy = true;
      if (!await this.consent()) {
        this.chatBusy = false;
        this.view.setChat(this.turns, "", this.contextLabel());
        return;
      }
    }
    if (name === "summarize" || name === "replies" || name === "generate" || name === "triage" || name === "deadlines") {
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
      const scope = this.messageScope();
      const key = assistKey(this.folder, [this.current.uid]);
      const known = data.force === "1" ? undefined : this.summaryCache.get(key);
      if (known) {
        this.applySummary(known, true);
        this.paintStrip();
        return;
      }
      this.view.setStrip({ ...this.strip(), loading: "Verlauf wird zusammengefasst …", tldr: "" });
      try {
        const result = await plugin<{ summary: AssistSummary }>("AiSummarize", {
          folder: this.folder,
          uids: [this.current.uid],
          sent: this.sentFolder
        }, scope.signal);
        this.summaryCache.set(key, result.summary || {});
        if (!scope.live()) return;
        this.applySummary(result.summary || {}, false);
        this.paintStrip();
      } catch (error) {
        if (scope.live()) this.view.setStrip({ ...this.strip(), error: explain(error) });
      }
      return;
    }
    if (name === "replies" && this.current) {
      const scope = this.messageScope();
      this.view.setStrip({ ...this.strip(), loading: t("AI_COPILOT.GENERATING_REPLIES", "Antwortvorschläge werden erstellt …") });
      try {
        const key = assistKey(this.folder, [this.current.uid]);
        const result = await plugin<{ replies: AssistReply[] }>("AiQuickReplies", {
          folder: this.folder,
          uids: [this.current.uid],
          sent: this.sentFolder
        }, scope.signal);
        const replies = (result.replies || []).slice(0, 3);
        this.replyCache.set(key, replies);
        if (!scope.live()) return;
        this.replies = replies;
        this.paintStrip();
      } catch (error) {
        if (scope.live()) this.view.setStrip({ ...this.strip(), error: explain(error) });
      }
      return;
    }
    if (name === "use-reply") {
      const reply = this.replies[Number(data.index || 0)];
      if (!reply || !this.current) return;
      this.openReply(false, { text: reply.body, title: reply.label });
      return;
    }
    if (name === "bulk-summarize") {
      if (!this.checked.size) return;
      if (!await this.consent()) return;
      this.bulkSummaryLoading = t("AI_COPILOT.BULK_SUMMARIZING", "Ausgewählte Mails werden zusammengefasst …");
      this.bulkSummaryError = "";
      this.paintBulk();
      try {
        const key = assistKey(this.folder, [...this.checked]);
        const known = data.force === "1" ? undefined : this.summaryCache.get(key);
        const summary = known || (await plugin<{ summary: AssistSummary }>("AiSummarize", {
          folder: this.folder,
          uids: [...this.checked],
          sent: this.sentFolder
        })).summary || {};
        this.summaryCache.set(key, summary);
        this.bulkSummary = {
          tldr: summary.tldr || "",
          points: Array.isArray(summary.points) ? summary.points : [],
          cached: Boolean(known),
          model: summary.model || this.assistFlags?.provider || ""
        };
        this.bulkSummaryLoading = "";
      } catch (error) {
        this.bulkSummaryLoading = "";
        this.bulkSummaryError = explain(error);
      }
      this.paintBulk();
      return;
    }
    if (name === "bulk-replies") {
      if (!this.checked.size) return;
      if (!await this.consent()) return;
      this.bulkRepliesLoading = t("AI_COPILOT.GENERATING_BULK_REPLIES", "Antwortvorschläge für ausgewählte Mails werden erstellt …");
      this.bulkRepliesError = "";
      this.paintBulk();
      const checkedUids = [...this.checked];
      const targetMsgs = checkedUids
        .map((uid) => this.messages.find((m) => m.uid === uid))
        .filter((m): m is Msg => Boolean(m))
        .slice(0, 10);
      try {
        const results = await Promise.allSettled(
          targetMsgs.map(async (msg) => {
            const key = assistKey(this.folder, [msg.uid]);
            const replies = this.replyCache.get(key) || ((await plugin<{ replies: AssistReply[] }>("AiQuickReplies", {
              folder: this.folder,
              uids: [msg.uid],
              sent: this.sentFolder
            })).replies || []).slice(0, 3);
            this.replyCache.set(key, replies);
            return {
              uid: msg.uid,
              subject: msg.subject || "(ohne Betreff)",
              who: label(msg.from[0] || { name: "", email: "" }) || t("GLOBAL.UNKNOWN", "(unbekannt)"),
              replies
            };
          })
        );
        const successful: BulkReplyItem[] = [];
        for (const r of results) {
          if (r.status === "fulfilled" && r.value.replies.length > 0) {
            successful.push(r.value);
          }
        }
        if (!successful.length) {
          this.bulkRepliesError = t("AI_COPILOT.NO_REPLIES_GENERATED", "Keine Antwortvorschläge für die ausgewählten Mails erhalten.");
        } else {
          this.bulkRepliesList = successful;
        }
        this.bulkRepliesLoading = "";
      } catch (error) {
        this.bulkRepliesLoading = "";
        this.bulkRepliesError = explain(error);
      }
      this.paintBulk();
      return;
    }
    if (name === "use-bulk-reply") {
      const uid = Number(data.uid || 0);
      const index = Number(data.index || 0);
      const item = this.bulkRepliesList.find((r) => r.uid === uid);
      const reply = item?.replies[index];
      if (!reply) return;
      const generation = this.accountGeneration;
      try {
        // List rows carry no body, so the quote needs the full message.
        const message = this.parseMessage(await call<Record<string, unknown>>("Message", { folder: this.folder, uid }), true);
        if (generation === this.accountGeneration) this.openReply(false, { message, text: reply.body, title: reply.label });
      } catch (error) {
        this.view.notice(explain(error));
      }
      return;
    }
    if (name === "triage") {
      this.view.notice(t("AI_COPILOT.TRIAGE_DISCLOSURE", "Absender, Betreff und Vorschau dieser Seite gehen an das Modell."));
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
        this.view.notice(result.warning || t("AI_COPILOT.TRIAGE_SAVED", "%COUNT% Mails eingeordnet.").replace("%COUNT%", String(result.stored || 0)));
        await this.loadList(false);
      } catch (error) {
        this.view.notice(explain(error));
      }
      return;
    }
    if (name === "deadlines") {
      const items = this.alertItems.filter((item) => item.type !== "followup").slice(0, 8);
      if (!items.length) {
        this.view.notice(t("AI_COPILOT.NO_DEADLINES", "Keine Mails für eine Frist."));
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
      if (!text) {
        this.chatBusy = false;
        return;
      }
      const area = document.querySelector("#ask") as HTMLTextAreaElement | null;
      if (area) area.value = "";
      this.chat.push({ role: "user", content: text });
      this.turns.push({ role: "user", text, trace: [], actions: [] });
      this.view.setChat(this.turns, "Copilot arbeitet …", this.contextLabel());
      try {
        const result = await plugin<{ reply: string; actions?: Record<string, unknown>[]; trace?: { summary?: string }[]; known?: string[] }>("AiChat", {
          messages: this.chat,
          context: this.useContext && this.current ? { folder: this.folder, uid: this.current.uid } : {},
          folders: this.folders.map((folder) => folder.fullName),
          known: this.chatKnown,
          sent: this.sentFolder
        });
        this.chatKnown = result.known || [];
        this.chat.push({ role: "assistant", content: result.reply || "" });
        this.turns.push({
          role: "assistant",
          text: result.reply || "",
          trace: (result.trace || []).map((item) => item.summary || "").filter(Boolean),
          actions: (result.actions || []).map((payload) => ({ label: String(payload.label || payload.type || ""), state: "", payload }))
        });
        this.view.setChat(this.turns, "", this.contextLabel());
      } catch (error) {
        this.view.setChat(this.turns, "!" + explain(error), this.contextLabel());
      } finally {
        this.chatBusy = false;
      }
      return;
    }
    if (name === "drop-context") {
      this.useContext = false;
      this.view.setChat(this.turns, "", "");
      return;
    }
    if (name === "dismiss-action") {
      const action = chatActionAt(this.turns, Number(data.turn), Number(data.index));
      if (action && !action.state) action.state = "Verworfen";
      this.view.setChat(this.turns, "", this.contextLabel());
      return;
    }
    if (name === "run-action") {
      await this.runChatAction(Number(data.turn), Number(data.index));
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
    return this.current.subject || t("MESSAGE.NO_SUBJECT", "(ohne Betreff)");
  }

  private async generate(): Promise<void> {
    const options = this.view.draftOptions();
    if (options.body.length > DRAFT_TEXT_LIMIT) {
      this.view.setDraftBusy(false, t("AI_COPILOT.DRAFT_TOO_LONG", "Der Text ist für die KI zu lang (höchstens %MAX% Zeichen).").replace("%MAX%", String(DRAFT_TEXT_LIMIT)));
      return;
    }
    // Only an actual reply carries a message; a new mail must not leak whatever is open.
    const context = options.mode === "reply"
      ? options.context || (this.current ? { folder: this.current.folder, uid: this.current.uid } : null)
      : null;
    this.draftBackup = options.body;
    this.draftAbort = new AbortController();
    this.view.setDraftBusy(true, t("AI_COPILOT.DRAFT_WRITING", "Entwurf wird geschrieben …"));
    let streamed = "";
    try {
      await streamEvents("AiStream", {
        mode: options.mode,
        tone: options.tone,
        instruction: options.instruction,
        current: options.body,
        wantSubject: options.mode === "new" || options.mode === "reply",
        folder: context?.folder || "",
        uids: context ? [context.uid] : [],
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
        if (event === "error") throw new ApiError(1, String(payload.error || t("AI_COPILOT.ERROR_STREAM", "Verbindung unterbrochen.")));
      }, this.draftAbort.signal);
      this.view.setDraftBusy(false, `${t("AI_COPILOT.DRAFT_INSERTED", "Entwurf eingefügt.")}${this.summaryModel ? ` · ${this.summaryModel}` : ""}`);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        this.view.setDraftBusy(false, t("AI_COPILOT.ERROR_ABORT", "Abgebrochen."));
        return;
      }
      this.view.setDraftBusy(false, explain(error));
    }
  }

  private async runChatAction(turnIndex: number, index: number): Promise<void> {
    const entry = chatActionAt(this.turns, turnIndex, index);
    if (!entry || entry.state) return;
    const action = entry.payload;
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
        if (type === "reply") this.openReply(false, { instruction: String(action.instruction || "") });
        this.view.closeSheet();
      } else if (type === "compose") {
        this.openNew({ to: String(action.to || ""), subject: String(action.subject || ""), instruction: String(action.instruction || "") });
        this.view.closeSheet();
      } else if (type === "search") {
        if (folder) await this.selectFolder(folder);
        await this.setSearch(String(action.search || ""));
      }
      entry.state = t("AI_COPILOT.ACTION_DONE", "Erledigt");
      this.view.setChat(this.turns, "", this.contextLabel());
      if (uids) await this.loadList(false);
    } catch (error) {
      entry.state = explain(error);
      this.view.setChat(this.turns, "", this.contextLabel());
    }
  }
}
