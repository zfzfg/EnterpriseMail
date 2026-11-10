import { ApiError, call, explain, plugin, streamEvents } from "./api";
import { readAssist, type AssistFlags } from "./assistant";
import { assistKey, AssistScopes, chatActionAt, fillTemplate, summaryActionText, type AssistScope } from "./assist-state";
import type { Msg, Person } from "./mail";
import type { BulkAssistState, BulkReplyItem, BulkSummaryState } from "./reader";
import type { FolderInfo } from "./folders";
import { t } from "./i18n";
import { BoundedCache, ConcurrencyLimiter } from "./runtime";
import type { ChatTurn, ComposeSeed, MailView, StripState } from "./view";

/** Matches DraftRequest's limit for the `current` field. */
const DRAFT_TEXT_LIMIT = 8000;
const AI_CACHE_ENTRIES = 200;
const AI_CACHE_BYTES = 2 * 1024 * 1024;
const TAG_MAX_AGE_MS = 5 * 60 * 1000;
const ALERT_MIN_INTERVAL_MS = 60 * 1000;
const BULK_REPLY_LIMIT = 10;
/** Every suggestion occupies a PHP worker while the provider answers. */
const bulkReplySlots = new ConcurrencyLimiter(3);
/** Actions that must not run twice at once: each extra click would be another provider request. */
const SINGLE_RUN_ACTIONS = new Set(["lang-search", "triage", "deadlines", "bulk-summarize", "bulk-replies"]);
const timezone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

interface AssistSummary {
  tldr?: string;
  points?: string[];
  decisions?: string[];
  actions?: { who?: string; what?: string; due?: string }[];
  next?: string;
  model?: string;
  count?: number;
}

interface DueItem {
  folder: string;
  uid: number;
  title: string;
  due: string;
}

interface ChatTrace {
  summary?: string;
  code?: string;
  params?: Record<string, unknown>;
}

function traceText(item: ChatTrace): string {
  if (!item.code) return item.summary || "";
  return fillTemplate(t(`AI_COPILOT.TRACE_${item.code.toUpperCase()}`, item.summary || ""), item.params || {});
}

interface AssistReply {
  label: string;
  body: string;
}

export interface ReplyOptions {
  message?: Msg;
  text?: string;
  title?: string;
  instruction?: string;
  assisted?: boolean;
}

/** What the assistant needs from the mailbox session. */
export interface AssistHost {
  readonly view: MailView;
  readonly sentFolder: string;
  readonly archiveFolder: string;
  readonly folders: FolderInfo[];
  readonly folder: string;
  readonly messages: Msg[];
  readonly current: Msg | null;
  readonly checked: Set<number>;
  readonly accountGeneration: number;
  offset: number;
  category: string;
  personLabel(person: Person): string;
  personAddress(person: Person): string;
  selectFolder(fullName: string): Promise<void>;
  selectMessage(uid: number): Promise<void>;
  setSearch(query: string): Promise<void>;
  loadList(append: boolean, quiet?: boolean): Promise<void>;
  parseMessage(item: Record<string, unknown>, full?: boolean): Msg;
  openReply(all: boolean, options?: ReplyOptions): void;
  openNew(preset?: Partial<ComposeSeed>): void;
  paintBulk(): void;
}

/** All assistant behaviour of the mail UI: state, provider requests, and their results. */
export class AssistController {
  private assistFlags: AssistFlags | null = null;
  private noticeAck = false;
  private useContext = true;
  private chat: { role: "user" | "assistant"; content: string }[] = [];
  private turns: ChatTurn[] = [];
  private chatBusy = false;
  private chatAbort: AbortController | null = null;
  /** Counts conversations: an answer that arrives for an earlier one is dropped. */
  private chatSession = 0;
  private assistRunning = new Set<string>();
  private translatedFolder = "";
  private chatKnown: string[] = [];
  private assistScopes = new AssistScopes();
  /** AI output stays in this tab's memory; the server keeps none of it. */
  private summaryCache = new BoundedCache<string, AssistSummary>(AI_CACHE_ENTRIES, AI_CACHE_BYTES, (value) => JSON.stringify(value).length);
  private replyCache = new BoundedCache<string, AssistReply[]>(AI_CACHE_ENTRIES, AI_CACHE_BYTES, (value) => JSON.stringify(value).length);
  private replies: { label: string; body: string }[] = [];
  private bulkSummary: BulkSummaryState | null = null;
  /** The selection the bulk summary describes; any other selection must not show it. */
  private bulkSummaryKey = "";
  private bulkErrorAction: "m-bulk-summarize" | "m-bulk-replies" | "" = "";
  private bulkSummaryLoading = "";
  private bulkSummaryError = "";
  private bulkRepliesList: BulkReplyItem[] = [];
  private bulkRepliesLoading = "";
  private bulkRepliesError = "";
  private draftBackup = "";
  private draftAbort: AbortController | null = null;
  /** When each folder was last tagged; only user actions tag, background polling never writes. */
  private tagged = new Map<string, number>();
  private alertItems: { folder: string; uid: number; type: string; title: string }[] = [];
  private alertDues: DueItem[] = [];
  private alertCursor: Record<string, number> = {};
  private alertsLoadedAt = 0;

  constructor(private readonly host: AssistHost) {}

  get flags(): AssistFlags | null {
    return this.assistFlags;
  }

  setFlags(flags: AssistFlags | null): void {
    this.assistFlags = flags;
    this.noticeAck = Boolean(flags?.noticeAck);
  }

  loadFlags(app: Record<string, unknown>): Promise<AssistFlags | null> {
    return readAssist(app, async () => {
      const result = await plugin<{ settings: { enabled?: boolean; features?: Record<string, boolean>; notice_ack?: boolean } }>("AiGetSettings");
      return result.settings;
    });
  }

  async reloadSettings(app: Record<string, unknown>): Promise<void> {
    this.setFlags(await this.loadFlags(app));
    this.host.view.setAssist(this.assistFlags);
    // Tone, language or provider may have changed, so earlier results no longer fit.
    this.summaryCache.clear();
    this.replyCache.clear();
  }

  abortDraft(): void {
    this.draftAbort?.abort();
  }

  resetAccount(): void {
    this.tagged.clear();
    this.alertItems = [];
    this.alertDues = [];
    this.alertCursor = {};
    this.alertsLoadedAt = 0;
    this.chat = [];
    this.turns = [];
    this.chatKnown = [];
    this.summaryCache.clear();
    this.replyCache.clear();
    this.clearMessage();
    this.clearBulkState();
  }

  showMessage(): void {
    this.restoreMessageAssist();
    this.paintStrip();
    this.useContext = true;
    if (this.assistFlags?.chat && !this.chatBusy) this.host.view.setChat(this.turns, "", this.contextLabel());
  }

  /** Polling itself never writes keywords; only a manual refresh tags again. */
  async folderChanged(manual: boolean): Promise<void> {
    this.tagged.delete(this.host.folder);
    if (!manual) return;
    try { await this.ensureTagged(); } catch { /* Der Filter zeigt dann den letzten Stand. */ }
  }

  /** Results follow the selection: replies of unchecked mails go, and a summary of another selection is dropped. */
  syncBulkSelection(): void {
    if (this.bulkRepliesList.length) this.bulkRepliesList = this.bulkRepliesList.filter((r) => this.host.checked.has(r.uid));
    if (this.bulkSummary && this.bulkSummaryKey !== this.bulkKey()) this.bulkSummary = null;
  }

  private bulkKey(): string {
    return assistKey(this.host.folder, [...this.host.checked]);
  }

  bulkState(): BulkAssistState | undefined {
    return (this.assistFlags?.summarize || this.assistFlags?.replies)
      ? {
          summarize: Boolean(this.assistFlags?.summarize),
          replies: Boolean(this.assistFlags?.replies),
          loadingSummary: this.bulkSummaryLoading || undefined,
          loadingReplies: this.bulkRepliesLoading || undefined,
          error: this.bulkSummaryError || this.bulkRepliesError || undefined,
          errorAction: this.bulkErrorAction || undefined,
          summary: this.bulkSummary,
          repliesList: this.bulkRepliesList.length ? this.bulkRepliesList : undefined,
          repliesNote: this.bulkRepliesList.length && this.host.checked.size > BULK_REPLY_LIMIT
            ? t("AI_COPILOT.BULK_REPLIES_LIMIT", "Vorschläge gibt es für die ersten %LIMIT% von %COUNT% Mails.").replace("%LIMIT%", String(BULK_REPLY_LIMIT)).replace("%COUNT%", String(this.host.checked.size))
            : undefined
        }
      : undefined;
  }

  clearBulkState(): void {
    this.bulkSummary = null;
    this.bulkSummaryKey = "";
    this.bulkErrorAction = "";
    this.bulkSummaryLoading = "";
    this.bulkSummaryError = "";
    this.bulkRepliesList = [];
    this.bulkRepliesLoading = "";
    this.bulkRepliesError = "";
  }

  private strip(): StripState {
    return {
      loading: "",
      error: "",
      tldr: this.tldr,
      cached: this.summaryCached,
      points: this.summaryDetail?.points || [],
      decisions: this.summaryDetail?.decisions || [],
      actions: (this.summaryDetail?.actions || []).map(summaryActionText),
      next: this.summaryDetail?.next || "",
      replies: this.replies,
      model: this.summaryModel,
      showSummarize: Boolean(this.assistFlags?.summarize),
      showReplies: Boolean(this.assistFlags?.replies)
    };
  }

  private tldr = "";
  private summaryCached = false;
  private summaryModel = "";
  private summaryDetail: AssistSummary | null = null;

  private paintStrip(): void {
    if (!this.assistFlags?.summarize && !this.assistFlags?.replies) return;
    this.host.view.setStrip(this.host.current ? this.strip() : null);
  }

  clearMessage(): void {
    this.assistScopes.reset();
    this.replies = [];
    this.tldr = "";
    this.summaryCached = false;
    this.summaryModel = "";
    this.summaryDetail = null;
  }

  /** The open mail's conversation; replying only considers what came before it. */
  private conversationUids(upToCurrent = false): number[] {
    const message = this.host.current;
    if (!message) return [];
    const row = this.host.messages.find((item) => item.uid === message.uid);
    const all = [...new Set([message.uid, ...(row?.threads || []), ...message.threads])];
    return upToCurrent ? all.filter((uid) => uid <= message.uid) : all;
  }

  /** Scope for a provider request about the open message; stale once another message is shown. */
  private messageScope(): AssistScope {
    const generation = this.host.accountGeneration;
    return this.assistScopes.begin(() =>
      this.host.current && generation === this.host.accountGeneration ? `${this.host.folder}\n${this.host.current.uid}` : ""
    );
  }

  private applySummary(summary: AssistSummary, cached: boolean): void {
    this.tldr = summary.tldr || "";
    this.summaryCached = cached;
    this.summaryModel = summary.model || this.assistFlags?.provider || "";
    this.summaryDetail = summary;
  }

  /** Shows results from this session again without another provider request. */
  private restoreMessageAssist(): void {
    if (!this.host.current) return;
    const summary = this.summaryCache.get(assistKey(this.host.folder, this.conversationUids()));
    if (summary && this.assistFlags?.summarize) this.applySummary(summary, true);
    const replies = this.replyCache.get(assistKey(this.host.folder, this.conversationUids(true)));
    if (replies && this.assistFlags?.replies) this.replies = replies;
  }

  private async consent(kind: "mail" | "query" = "mail"): Promise<boolean> {
    if (this.noticeAck) return true;
    const name = this.assistFlags?.providerName || t("AI_COPILOT.THE_PROVIDER", "den Anbieter");
    const text = (kind === "query"
      ? t("AI_COPILOT.CONSENT_QUERY", "Ihre Suchanfrage geht an %PROVIDER%, die Mails bleiben dabei auf dem Server. Diese Einwilligung gilt auch für spätere KI-Aktionen, die nach einem Klick Mailinhalte an %PROVIDER% senden. Fortfahren?")
      : t("AI_COPILOT.CONSENT_MAIL", "Diese KI-Funktion sendet den Inhalt der betroffenen Mails an %PROVIDER%. Es wird nur gesendet, wenn Sie eine KI-Aktion anklicken. Fortfahren?")
    ).replace(/%PROVIDER%/g, name);
    const ok = await this.host.view.confirmConsent(text);
    if (!ok) return false;
    try {
      await plugin("AiSaveSettings", { settings: { notice_ack: true } });
    } catch { /* the choice still stands for this session */ }
    this.noticeAck = true;
    return true;
  }

  /** Tags on explicit user actions only, and not more often than needed. */
  private async ensureTagged(): Promise<void> {
    if (this.host.category === "all" || !this.assistFlags?.triage || !this.assistFlags.tabs) return;
    if (Date.now() - (this.tagged.get(this.host.folder) || 0) < TAG_MAX_AGE_MS) return;
    await plugin("AiTriageTag", { folder: this.host.folder, sent: this.host.sentFolder });
    this.tagged.set(this.host.folder, Date.now());
  }

  refreshAlerts(force: boolean): void {
    if (!this.assistFlags?.alerts) return;
    if (force || Date.now() - this.alertsLoadedAt >= ALERT_MIN_INTERVAL_MS) void this.loadAlerts();
  }

  private async openAssistMail(folder: string, uid: number): Promise<void> {
    if (folder !== this.host.folder) await this.host.selectFolder(folder);
    await this.host.selectMessage(uid);
    this.host.view.showReaderPane();
  }

  private async loadAlerts(): Promise<void> {
    const generation = this.host.accountGeneration;
    const inbox = this.host.folders.find((folder) => folder.role === "inbox")?.fullName || "INBOX";
    try {
      this.alertsLoadedAt = Date.now();
      const result = await plugin<{ alerts: { type: string; folder: string; uid: number; title: string }[] }>("AiAlerts", {
        inbox,
        sent: this.host.sentFolder
      });
      if (generation !== this.host.accountGeneration) return;
      this.alertItems = result.alerts || [];
      this.alertCursor = {};
      const count = (type: string) => this.alertItems.filter((item) => item.type === type).length;
      this.host.view.setAlerts(count("reply"), count("followup"), count("invoice"), this.alertDues);
    } catch {
      /* Hinweise sind ergänzend */
    }
  }

  /** Text for an assistant failure. Missing consent reopens the notice instead of a dead end. */
  private assistError(error: unknown, retry?: () => void): string {
    if (error instanceof ApiError && error.reason === "consent_required") {
      this.noticeAck = false;
      if (retry) void this.consent().then((granted) => { if (granted) retry(); });
      return t("AI_COPILOT.ERROR_CONSENT_REQUIRED", "Bitte bestätigen Sie zuerst den Hinweis zur Übermittlung an den KI-Anbieter.");
    }
    return error instanceof ApiError && error.reason ? t(`AI_COPILOT.ERROR_${error.reason.toUpperCase()}`, explain(error)).replace("%STATUS%", String(error.code)) : explain(error);
  }

  async assist(name: string, data: Record<string, string | undefined>): Promise<void> {
    if (!SINGLE_RUN_ACTIONS.has(name)) {
      await this.runAssist(name, data);
      return;
    }
    if (this.assistRunning.has(name)) return;
    this.assistRunning.add(name);
    this.host.view.setAssistBusy(name, true);
    try {
      await this.runAssist(name, data);
    } finally {
      this.assistRunning.delete(name);
      this.host.view.setAssistBusy(name, false);
    }
  }

  private async runAssist(name: string, data: Record<string, string | undefined>): Promise<void> {
    if (name === "cat") {
      this.host.category = data.cat || "all";
      try {
        await this.ensureTagged();
      } catch (error) {
        this.host.view.assistNote("list", explain(error), "error");
        return;
      }
      this.host.offset = 0;
      await this.host.loadList(false);
      return;
    }
    if (name === "alert") {
      // The counter and the clicks cover exactly the same mails: each click opens the next one.
      const type = data.kind === "follow" ? "followup" : data.kind === "invoice" ? "invoice" : "reply";
      const items = this.alertItems.filter((item) => item.type === type);
      if (!items.length) return;
      const position = (this.alertCursor[type] || 0) % items.length;
      this.alertCursor[type] = position + 1;
      await this.openAssistMail(items[position].folder, items[position].uid);
      return;
    }
    if (name === "open-due") {
      const uid = Number(data.mailUid || 0);
      if (uid && data.folder) await this.openAssistMail(data.folder, uid);
      return;
    }
    if (name === "ask") {
      if (this.chatBusy) return;
      this.chatBusy = true;
      if (!await this.consent()) {
        this.chatBusy = false;
        this.host.view.setChat(this.turns, "", this.contextLabel());
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
      this.host.view.assistNote("list", t("AI_COPILOT.WORKING", "Wird erstellt …"));
      try {
        const result = await plugin<{ search: string; explanation?: string; folder?: string }>("AiSearch", {
          query: text,
          folders: this.host.folders.map((folder) => folder.fullName),
          currentFolder: this.host.folder,
          sent: this.host.sentFolder,
          timezone: timezone()
        });
        // Nothing changes until the user accepts the suggestion with "Suchen".
        this.translatedFolder = result.folder || "";
        this.host.view.assistNote("list", "");
        this.host.view.showTranslation(result.search, [result.explanation, result.folder].filter(Boolean).join(" · "));
      } catch (error) {
        this.host.view.assistNote("list", this.assistError(error, () => void this.assist(name, data)), "error");
      }
      return;
    }
    if (name === "run-search") {
      const field = document.querySelector("#translate-q") as HTMLInputElement | null;
      const query = field?.value.trim() || "";
      this.host.category = "all";
      this.host.view.pressCategory("all");
      if (this.translatedFolder && this.translatedFolder !== this.host.folder) await this.host.selectFolder(this.translatedFolder);
      this.translatedFolder = "";
      this.host.view.hideTranslation();
      await this.host.setSearch(query);
      return;
    }
    if (name === "summarize" && this.host.current) {
      const scope = this.messageScope();
      const uids = this.conversationUids();
      const key = assistKey(this.host.folder, uids);
      const known = data.force === "1" ? undefined : this.summaryCache.get(key);
      if (known) {
        this.applySummary(known, true);
        this.paintStrip();
        return;
      }
      this.host.view.setStrip({ ...this.strip(), loading: t("AI_COPILOT.SUMMARIZING", "Verlauf wird zusammengefasst …") });
      try {
        const result = await plugin<{ summary: AssistSummary }>("AiSummarize", {
          folder: this.host.folder,
          uids,
          sent: this.host.sentFolder
        }, scope.signal);
        this.summaryCache.set(key, result.summary || {});
        if (!scope.live()) return;
        this.applySummary(result.summary || {}, false);
        this.paintStrip();
      } catch (error) {
        if (scope.live()) this.host.view.setStrip({ ...this.strip(), error: this.assistError(error, () => void this.assist(name, data)) });
      }
      return;
    }
    if (name === "replies" && this.host.current) {
      const scope = this.messageScope();
      this.host.view.setStrip({ ...this.strip(), loading: t("AI_COPILOT.GENERATING_REPLIES", "Antwortvorschläge werden erstellt …") });
      try {
        const uids = this.conversationUids(true);
        const key = assistKey(this.host.folder, uids);
        const result = await plugin<{ replies: AssistReply[] }>("AiQuickReplies", {
          folder: this.host.folder,
          uids,
          sent: this.host.sentFolder
        }, scope.signal);
        const replies = (result.replies || []).slice(0, 3);
        this.replyCache.set(key, replies);
        if (!scope.live()) return;
        this.replies = replies;
        this.paintStrip();
      } catch (error) {
        if (scope.live()) this.host.view.setStrip({ ...this.strip(), error: this.assistError(error, () => void this.assist(name, data)) });
      }
      return;
    }
    if (name === "hide-summary") {
      // Only the display goes; asking again answers from this tab's cache.
      this.tldr = "";
      this.summaryCached = false;
      this.summaryDetail = null;
      this.paintStrip();
      return;
    }
    if (name === "use-reply") {
      const reply = this.replies[Number(data.index || 0)];
      if (!reply || !this.host.current) return;
      this.host.openReply(false, { text: reply.body, assisted: true });
      return;
    }
    if (name === "bulk-summarize") {
      if (!this.host.checked.size) return;
      if (!await this.consent()) return;
      this.bulkSummaryLoading = t("AI_COPILOT.BULK_SUMMARIZING", "Ausgewählte Mails werden zusammengefasst …");
      this.bulkSummaryError = "";
      this.bulkErrorAction = "";
      const key = this.bulkKey();
      const selected = this.host.checked.size;
      this.host.paintBulk();
      try {
        const known = data.force === "1" ? undefined : this.summaryCache.get(key);
        const summary = known || (await plugin<{ summary: AssistSummary }>("AiSummarize", {
          folder: this.host.folder,
          uids: [...this.host.checked],
          selection: true
        })).summary || {};
        this.summaryCache.set(key, summary);
        this.bulkSummaryLoading = "";
        // The selection moved on while the provider answered: keep the result cached, show nothing stale.
        if (key !== this.bulkKey()) {
          this.host.paintBulk();
          return;
        }
        this.bulkSummaryKey = key;
        this.bulkSummary = {
          tldr: summary.tldr || "",
          points: Array.isArray(summary.points) ? summary.points : [],
          decisions: Array.isArray(summary.decisions) ? summary.decisions : [],
          actions: (Array.isArray(summary.actions) ? summary.actions : []).map(summaryActionText),
          next: summary.next || "",
          shown: Number(summary.count) || selected,
          cached: Boolean(known),
          model: summary.model || this.assistFlags?.provider || ""
        };
        this.bulkSummaryLoading = "";
      } catch (error) {
        this.bulkSummaryLoading = "";
        this.bulkSummaryError = this.assistError(error, () => void this.assist(name, data));
        this.bulkErrorAction = "m-bulk-summarize";
      }
      this.host.paintBulk();
      return;
    }
    if (name === "bulk-replies") {
      if (!this.host.checked.size) return;
      if (!await this.consent()) return;
      this.bulkRepliesLoading = t("AI_COPILOT.GENERATING_BULK_REPLIES", "Antwortvorschläge für ausgewählte Mails werden erstellt …");
      this.bulkRepliesError = "";
      this.bulkErrorAction = "";
      this.host.paintBulk();
      const checkedUids = [...this.host.checked];
      const targetMsgs = checkedUids
        .map((uid) => this.host.messages.find((m) => m.uid === uid))
        .filter((m): m is Msg => Boolean(m))
        .slice(0, BULK_REPLY_LIMIT);
      try {
        const results = await Promise.allSettled(
          targetMsgs.map((msg) => bulkReplySlots.run(async () => {
            const key = assistKey(this.host.folder, [msg.uid]);
            const replies = this.replyCache.get(key) || ((await plugin<{ replies: AssistReply[] }>("AiQuickReplies", {
              folder: this.host.folder,
              uids: [msg.uid],
              sent: this.host.sentFolder
            })).replies || []).slice(0, 3);
            this.replyCache.set(key, replies);
            return {
              uid: msg.uid,
              subject: msg.subject || t("MESSAGE.NO_SUBJECT", "(ohne Betreff)"),
              who: this.host.personLabel(msg.from[0] || { name: "", email: "" }) || t("GLOBAL.UNKNOWN", "(unbekannt)"),
              replies
            };
          }))
        );
        const successful: BulkReplyItem[] = [];
        for (const r of results) {
          if (r.status === "fulfilled" && r.value.replies.length > 0) {
            successful.push(r.value);
          }
        }
        if (!successful.length) {
          this.bulkRepliesError = t("AI_COPILOT.NO_REPLIES_GENERATED", "Keine Antwortvorschläge für die ausgewählten Mails erhalten.");
          this.bulkErrorAction = "m-bulk-replies";
        } else {
          this.bulkRepliesList = successful;
        }
        this.bulkRepliesLoading = "";
      } catch (error) {
        this.bulkRepliesLoading = "";
        this.bulkRepliesError = this.assistError(error, () => void this.assist(name, data));
        this.bulkErrorAction = "m-bulk-replies";
      }
      this.host.paintBulk();
      return;
    }
    if (name === "use-bulk-reply") {
      const uid = Number(data.uid || 0);
      const index = Number(data.index || 0);
      const item = this.bulkRepliesList.find((r) => r.uid === uid);
      const reply = item?.replies[index];
      if (!reply) return;
      const generation = this.host.accountGeneration;
      try {
        // List rows carry no body, so the quote needs the full message.
        const message = this.host.parseMessage(await call<Record<string, unknown>>("Message", { folder: this.host.folder, uid }), true);
        if (generation === this.host.accountGeneration) this.host.openReply(false, { message, text: reply.body, assisted: true });
      } catch (error) {
        this.host.view.notice(explain(error));
      }
      return;
    }
    if (name === "triage") {
      this.host.view.assistNote("list", t("AI_COPILOT.TRIAGE_DISCLOSURE", "Absender, Betreff und Vorschau dieser Seite gehen an das Modell."));
      try {
        const result = await plugin<{ stored?: number; warning?: string }>("AiTriageLlm", {
          folder: this.host.folder,
          items: this.host.messages.map((message) => ({
            uid: message.uid,
            from: message.from.map(this.host.personLabel).join(", "),
            to: message.to.map(this.host.personAddress).join(", "),
            cc: message.cc.map(this.host.personAddress).join(", "),
            subject: message.subject,
            preview: message.preview,
            bulk: message.category === "newsletter" || message.category === "notification"
          }))
        });
        if (result.warning) this.host.view.assistNote("list", t("APP_TEXT.CATEGORIES_COULD_NOT_BE_SAVED_KEYWORDS_NOT_ALLOW", "Kategorien konnten nicht gespeichert werden (Schlagwörter nicht erlaubt)."), "error");
        else this.host.view.assistNote("list", t("AI_COPILOT.TRIAGE_SAVED", "%COUNT% Mails eingeordnet.").replace("%COUNT%", String(result.stored || 0)), "done");
        await this.host.loadList(false);
      } catch (error) {
        this.host.view.assistNote("list", this.assistError(error, () => void this.assist(name, data)), "error");
      }
      return;
    }
    if (name === "deadlines") {
      const items = this.alertItems.filter((item) => item.type !== "followup").slice(0, 8);
      if (!items.length) {
        this.host.view.assistNote("sidebar", t("AI_COPILOT.NO_DEADLINES", "Keine Mails für eine Frist."), "done");
        return;
      }
      this.host.view.assistNote("sidebar", t("AI_COPILOT.WORKING", "Wird erstellt …"));
      try {
        const result = await plugin<{ alerts: DueItem[] }>("AiAlertsLlm", { items, timezone: timezone() });
        this.alertDues = (result.alerts || []).filter((item) => item.due);
        this.host.view.setAlerts(
          this.alertItems.filter((item) => item.type === "reply").length,
          this.alertItems.filter((item) => item.type === "followup").length,
          this.alertItems.filter((item) => item.type === "invoice").length,
          this.alertDues
        );
        this.host.view.assistNote("sidebar", this.alertDues.length ? "" : t("AI_COPILOT.NO_DEADLINES", "Keine Mails für eine Frist."), "done");
      } catch (error) {
        this.host.view.assistNote("sidebar", this.assistError(error, () => void this.assist(name, data)), "error");
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
      this.host.view.setChat(this.turns, t("AI_COPILOT.CHAT_WORKING", "Assistent arbeitet …"), this.contextLabel());
      const controller = new AbortController();
      this.chatAbort = controller;
      const session = this.chatSession;
      try {
        const result = await plugin<{ reply: string; actions?: Record<string, unknown>[]; trace?: ChatTrace[]; known?: string[] }>("AiChat", {
          messages: this.chat,
          context: this.useContext && this.host.current ? { folder: this.host.folder, uid: this.host.current.uid } : {},
          folders: this.host.folders.map((folder) => folder.fullName),
          known: this.chatKnown,
          sent: this.host.sentFolder,
          timezone: timezone()
        }, controller.signal);
        if (session !== this.chatSession) return;
        this.chatKnown = result.known || [];
        const reply = result.reply || ((result.actions || []).length ? t("APP_TEXT.SUGGESTIONS", "Vorschläge:") : t("APP_TEXT.NO_ANSWER_RECEIVED", "Keine Antwort erhalten."));
        this.chat.push({ role: "assistant", content: reply });
        this.turns.push({
          role: "assistant",
          text: reply,
          trace: (result.trace || []).map(traceText).filter(Boolean),
          actions: (result.actions || []).map((payload) => ({ label: String(payload.label || payload.type || ""), state: "", payload }))
        });
        this.host.view.setChat(this.turns, "", this.contextLabel());
      } catch (error) {
        if (session !== this.chatSession) return;
        // Take the question back so sending it again is one deliberate click.
        this.chat.pop();
        this.turns.pop();
        if (area) area.value = text;
        const aborted = error instanceof Error && error.name === "AbortError";
        this.host.view.setChat(this.turns, aborted ? "" : "!" + this.assistError(error, () => void this.assist(name, data)), this.contextLabel());
      } finally {
        this.chatBusy = false;
        this.chatAbort = null;
      }
      return;
    }
    if (name === "new-chat") {
      this.chatSession++;
      this.chatAbort?.abort();
      this.chat = [];
      this.turns = [];
      this.chatKnown = [];
      this.useContext = true;
      this.host.view.setChat(this.turns, "", this.contextLabel());
      this.host.view.openSheet();
      return;
    }
    if (name === "stop-chat") {
      this.chatAbort?.abort();
      return;
    }
    if (name === "drop-context") {
      this.useContext = false;
      this.host.view.setChat(this.turns, "", "");
      return;
    }
    if (name === "dismiss-action") {
      const action = chatActionAt(this.turns, Number(data.turn), Number(data.index));
      if (action && !action.state) action.state = t("AI_COPILOT.ACTION_DISMISSED", "Verworfen");
      this.host.view.setChat(this.turns, "", this.contextLabel());
      return;
    }
    if (name === "run-action") {
      await this.runChatAction(Number(data.turn), Number(data.index));
      return;
    }
    if (name === "generate") await this.generate();
    if (name === "stop-generate") this.draftAbort?.abort();
    if (name === "revert-draft") {
      this.host.view.revertDraft(this.draftBackup);
      this.host.view.setDraftBusy(false, t("AI_COPILOT.DRAFT_REVERTED", "Vorheriger Text wiederhergestellt."));
    }
    if (name === "apply-subject") {
      const hint = document.querySelector("#subject-hint") as HTMLElement | null;
      const subject = hint?.dataset.subject || "";
      const field = document.querySelector("input[name='subject']") as HTMLInputElement | null;
      if (field && subject) field.value = subject;
    }
  }

  private contextLabel(): string {
    if (!this.useContext || !this.host.current) return "";
    return this.host.current.subject || t("MESSAGE.NO_SUBJECT", "(ohne Betreff)");
  }

  private async generate(): Promise<void> {
    const options = this.host.view.draftOptions();
    if (options.body.length > DRAFT_TEXT_LIMIT) {
      this.host.view.setDraftBusy(false, t("AI_COPILOT.DRAFT_TOO_LONG", "Der Text ist für die KI zu lang (höchstens %MAX% Zeichen).").replace("%MAX%", String(DRAFT_TEXT_LIMIT)));
      return;
    }
    // Only an actual reply carries a message; a new mail must not leak whatever is open.
    const context = options.mode === "reply"
      ? options.context || (this.host.current ? { folder: this.host.current.folder, uid: this.host.current.uid } : null)
      : null;
    this.draftBackup = options.body;
    const contextUids = context
      ? (context.uid === this.host.current?.uid && context.folder === this.host.folder ? this.conversationUids(true) : [context.uid])
      : [];
    this.draftAbort = new AbortController();
    this.host.view.setDraftBusy(true, t("AI_COPILOT.DRAFT_WRITING", "Entwurf wird geschrieben …"));
    let streamed = "";
    // Only a generation that wrote into the mail has something to take back.
    let wrote = false;
    try {
      await streamEvents("AiStream", {
        mode: options.mode,
        tone: options.tone,
        instruction: options.instruction,
        current: options.body,
        wantSubject: options.mode === "new" || options.mode === "reply",
        folder: context?.folder || "",
        uids: contextUids,
        sent: this.host.sentFolder
      }, (event, payload) => {
        if (event === "delta") {
          streamed += String(payload.text || "");
          this.host.view.setDraftBody(streamed);
          wrote = true;
        }
        if (event === "done") {
          this.host.view.setDraftBody(String(payload.body || streamed));
          wrote = true;
          this.host.view.setSubjectHint(String(payload.subject || ""));
          this.summaryModel = String(payload.model || "");
        }
        if (event === "error") throw new ApiError(1, String(payload.error || t("AI_COPILOT.ERROR_STREAM", "Verbindung unterbrochen.")), "", String(payload.code || ""));
      }, this.draftAbort.signal);
      this.host.view.setDraftBusy(false, `${t("AI_COPILOT.DRAFT_INSERTED", "Entwurf eingefügt.")}${this.summaryModel ? ` · ${this.summaryModel}` : ""}`, wrote);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        this.host.view.setDraftBusy(false, t("AI_COPILOT.ERROR_ABORT", "Abgebrochen."), wrote);
        return;
      }
      this.host.view.setDraftBusy(false, this.assistError(error, () => void this.generate()), wrote);
    }
  }

  private async runChatAction(turnIndex: number, index: number): Promise<void> {
    const entry = chatActionAt(this.turns, turnIndex, index);
    if (!entry || entry.state) return;
    const action = entry.payload;
    const type = String(action.type || "");
    const folder = String(action.folder || this.host.folder);
    const uids = Array.isArray(action.uids) ? action.uids.map(String).join(",") : "";
    try {
      if (type === "delete") {
        if (!await this.host.view.confirmDelete()) return;
        await call("MessageDelete", { folder, uids });
      } else if (type === "archive") {
        if (!this.host.archiveFolder) throw new ApiError(1, t("AI_COPILOT.NO_ARCHIVE", "Kein Archiv-Ordner eingerichtet."));
        await call("MessageMove", { fromFolder: folder, toFolder: this.host.archiveFolder, uids });
      } else if (type === "move") {
        await call("MessageMove", { fromFolder: folder, toFolder: String(action.to || ""), uids });
      } else if (type === "mark_read" || type === "mark_unread") {
        await call("MessageSetSeen", { folder, uids, setAction: type === "mark_read" ? 1 : 0 });
      } else if (type === "flag" || type === "unflag") {
        await call("MessageSetFlagged", { folder, uids, setAction: type === "flag" ? 1 : 0 });
      } else if (type === "open" || type === "reply") {
        await this.host.selectFolder(folder);
        await this.host.selectMessage(Number(action.uid || 0));
        if (type === "reply") this.host.openReply(false, { instruction: String(action.instruction || "") });
        this.host.view.closeSheet();
      } else if (type === "compose") {
        this.host.openNew({ to: String(action.to || ""), subject: String(action.subject || ""), instruction: String(action.instruction || "") });
        this.host.view.closeSheet();
      } else if (type === "search") {
        if (folder) await this.host.selectFolder(folder);
        await this.host.setSearch(String(action.search || ""));
      }
      entry.state = t("AI_COPILOT.ACTION_DONE", "Erledigt");
      this.host.view.setChat(this.turns, "", this.contextLabel());
      if (uids) {
        await this.host.loadList(false);
        this.refreshAlerts(true);
      }
    } catch (error) {
      entry.state = explain(error);
      this.host.view.setChat(this.turns, "", this.contextLabel());
    }
  }
}
