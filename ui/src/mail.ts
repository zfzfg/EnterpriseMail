import { ApiError, call, downloadUrl, explain, loadApp } from "./api";
import { createView, type ComposeSeed, type FolderRow, type MailView, type MessageRow, type ReaderData } from "./view";

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
interface Msg {
  uid: number;
  subject: string;
  preview: string;
  from: Person[];
  to: Person[];
  cc: Person[];
  replyTo: Person[];
  date: number;
  flags: string[];
  messageId: string;
  references: string;
  html: string;
  plain: string;
  attachments: { name: string; size: number; href: string }[];
}

interface ListResult {
  "@Collection"?: Record<string, unknown>[];
  totalEmails?: number;
  offset?: number;
  folder?: { totalEmails?: number; unreadEmails?: number; uidNext?: number };
}

const PAGE_FALLBACK = 20;

function people(value: unknown): Person[] {
  const list = value && typeof value === "object" ? (value as { "@Collection"?: Record<string, unknown>[] })["@Collection"] : null;
  if (!Array.isArray(list)) return [];
  return list.map((item) => ({
    name: String(item.name || ""),
    email: String(item.email || "")
  })).filter((item) => item.email || item.name);
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

function seen(flags: string[]): boolean {
  return flags.some((flag) => flag.toLowerCase() === "\\seen");
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

  constructor(root: HTMLElement) {
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
      closeCompose: () => { this.replyKind = ""; },
      back: () => undefined
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
    this.view.showLogin(document.title || "SnappyMail");
  }

  private async enter(data: Record<string, unknown>): Promise<void> {
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
      const inbox = this.folders.find((folder) => folder.role === "inbox" || folder.fullName.toUpperCase() === "INBOX");
      await this.selectFolder(inbox?.fullName || this.folders[0]?.fullName || "INBOX");
    } catch (error) {
      this.view.setList([], "", explain(error), false, false);
    }
  }

  private async selectFolder(fullName: string): Promise<void> {
    this.folder = fullName;
    this.offset = 0;
    this.search = "";
    this.selected = 0;
    this.current = null;
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
          inbox: folder.role === "inbox" || folder.fullName.toUpperCase() === "INBOX"
        };
      });
    this.view.setFolders(rows);
  }

  private async loadList(append: boolean): Promise<void> {
    const start = append ? this.offset : 0;
    if (!append) this.view.setList([], "Mails werden geladen …", "", false, Boolean(this.search));
    try {
      const result = await call<ListResult>("MessageList", {
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

  private parseMessage(item: Record<string, unknown>, full = false): Msg {
    const flags = Array.isArray(item.flags) ? item.flags.map(String) : [];
    const attachments = full && item.attachments && typeof item.attachments === "object"
      ? ((item.attachments as { "@Collection"?: Record<string, unknown>[] })["@Collection"] || [])
        .filter((file) => !file.isInline)
        .map((file) => ({
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
        }))
      : [];
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

  private rows(): MessageRow[] {
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

  private paintList(): void {
    const empty = this.messages.length
      ? ""
      : this.search ? "Keine Mails für diese Suche." : "Dieser Ordner ist leer.";
    this.view.setList(this.rows(), empty, "", this.hasMore, Boolean(this.search));
  }

  private async setSearch(query: string): Promise<void> {
    this.search = query;
    this.offset = 0;
    this.selected = 0;
    this.current = null;
    this.view.setReader(null, "", "");
    await this.loadList(false);
  }

  private async selectMessage(uid: number): Promise<void> {
    this.selected = uid;
    this.paintList();
    this.view.setReader(null, "Brief wird geladen …", "");
    try {
      const result = await call<Record<string, unknown>>("Message", { folder: this.folder, uid });
      const message = this.parseMessage(result, true);
      this.current = message;
      const row = this.messages.find((item) => item.uid === uid);
      if (row && !seen(row.flags)) {
        row.flags.push("\\seen");
        const folder = this.folders.find((item) => item.fullName === this.folder);
        if (folder && folder.unread > 0) folder.unread -= 1;
        this.paintFolders();
        this.paintList();
        void call("MessageSetSeen", { folder: this.folder, uids: String(uid), setAction: 1 }).catch(() => undefined);
      }
      this.view.setReader(this.readerData(message), "", "");
    } catch (error) {
      this.view.setReader(null, "", explain(error));
    }
  }

  private readerData(message: Msg): ReaderData {
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

  private openNew(): void {
    this.replyKind = "";
    this.view.openCompose({ title: "Neue Nachricht", to: "", cc: "", subject: "", body: "" });
  }

  private openReply(all: boolean): void {
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
      body: `\n\nAm ${when(message.date)} schrieb ${author ? label(author) : ""}:\n${quote(body)}`
    });
  }

  private openForward(): void {
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
      body: `\n\n-------- Weitergeleitete Nachricht --------\nVon: ${message.from.map(label).join(", ")}\nBetreff: ${message.subject}\n\n${body}`
    });
  }

  private async send(values: ComposeSeed): Promise<void> {
    if (!values.to.trim()) {
      this.view.setSendState(false, "Geben Sie bitte mindestens einen Empfänger an.");
      return;
    }
    this.view.setSendState(true, "");
    const message = this.current;
    const params: Record<string, unknown> = {
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

  private async archive(): Promise<void> {
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

  private async remove(): Promise<void> {
    if (!this.selected) return;
    if (!await this.view.confirmDelete()) return;
    try {
      await call("MessageDelete", { folder: this.folder, uids: String(this.selected) });
      this.view.notice("Gelöscht.");
      await this.afterRemoval();
    } catch (error) {
      this.view.notice(explain(error));
    }
  }

  private async afterRemoval(): Promise<void> {
    this.messages = this.messages.filter((message) => message.uid !== this.selected);
    this.selected = 0;
    this.current = null;
    this.view.setReader(null, "", "");
    this.offset = Math.max(0, this.offset - 1);
    await this.loadList(false);
  }

  private async markUnread(): Promise<void> {
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
}
