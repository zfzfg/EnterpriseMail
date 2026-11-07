import { ApiError, call, explain, upload, type UploadTask } from "./api";
import { icon, type IconName } from "./icons";
import { t } from "./i18n";
import type { IdentityRow } from "./settings";

export interface ComposeIdentity extends IdentityRow {}

export interface ComposePreferences {
  editor: "Html" | "Plain";
  markdown: boolean;
  spellcheck: boolean;
  autosave: boolean;
  draftsFolder: string;
  sentFolder: string;
  replySameFolder: boolean;
  attachmentLimit: number;
  readReceipt: boolean;
  dsn: boolean;
  requireTLS: boolean;
  pgpSign: boolean;
  pgpEncrypt: boolean;
}

export interface ComposeFile {
  name: string;
  size: string;
  state?: "busy" | "error" | "";
  error?: string;
  progress?: number;
}

interface Attachment extends ComposeFile {
  tempName: string;
  type: string;
  bytes: number;
  task?: UploadTask;
}

export interface ComposeSeed {
  title: string;
  to: string;
  cc: string;
  bcc?: string;
  replyTo?: string;
  subject: string;
  body: string;
  html?: string;
  mode?: string;
  identityId?: string;
  sourceFolder?: string;
  draftRef?: { folder: string; uid: number } | null;
  files?: ComposeFile[];
}

export interface ComposeValues extends ComposeSeed {
  bcc: string;
  replyTo: string;
  identityID: string;
  from: string;
  plain: string;
  html: string;
  saveFolder: string;
  attachments: Record<string, { name: string; inline: boolean; cId: string; location: string; type: string }>;
  markAsImportant: number;
  readReceiptRequest: number;
  dsn: number;
  requireTLS: number;
  pgpSign: number;
  pgpEncrypt: number;
  messageFolder: string;
  messageUid: number;
}

interface ComposeCallbacks {
  send(values: ComposeValues): void;
  save(values: ComposeValues): Promise<{ folder: string; uid: number }>;
  close(discard: boolean): void;
  mobile(open: boolean): void;
  notice(text: string): void;
}

interface RecipientField {
  name: "to" | "cc" | "bcc";
  box: HTMLElement;
  input: HTMLInputElement;
  list: HTMLElement;
  values: string[];
  suggestions: string[];
  active: number;
  timer: number;
  request: number;
}

const ADDRESS = /^(?:[^\s@]+@[^\s@]+\.[^\s@]+|[^\s@]+@[^\s@]+)$/;
const ALLOWED_TAGS = new Set(["A", "B", "BLOCKQUOTE", "BR", "CODE", "DIV", "EM", "I", "LI", "OL", "P", "PRE", "S", "STRONG", "U", "UL"]);
const ALLOWED_ATTR = new Set(["href", "title"]);

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char] ?? char));
}

function button(action: string, symbol: IconName, label: string, extra = ""): string {
  return `<button type="button" class="icon-btn" data-compose="${action}" aria-label="${esc(label)}" title="${esc(label)}" ${extra}>${icon(symbol)}</button>`;
}

function sizeLabel(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function addresses(value: string): string[] {
  const result: string[] = [];
  let current = "";
  let quoted = false;
  let angle = 0;
  for (const char of value) {
    if (char === '"') quoted = !quoted;
    if (!quoted && char === "<") angle++;
    if (!quoted && char === ">") angle = Math.max(0, angle - 1);
    if (!quoted && !angle && (char === "," || char === ";")) {
      if (current.trim()) result.push(current.trim());
      current = "";
    } else current += char;
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

function emailOf(value: string): string {
  return (value.match(/<([^>]+)>/)?.[1] || value).trim();
}

function validAddress(value: string): boolean {
  return ADDRESS.test(emailOf(value));
}

function htmlToPlain(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("br").forEach((node) => node.replaceWith("\n"));
  doc.querySelectorAll("p,div,li,blockquote,pre").forEach((node) => node.append("\n"));
  doc.querySelectorAll("li").forEach((node) => node.prepend("• "));
  return (doc.body.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
}

function plainToHtml(text: string, quoted = false): string {
  const lines = text.replace(/\r/g, "").split("\n");
  const normal: string[] = [];
  const quote: string[] = [];
  const flush = () => {
    if (quote.length) {
      const content = quote.map((line) => esc(line.replace(/^> ?/, ""))).join("<br>");
      normal.push(`<blockquote>${content}</blockquote>`);
      quote.length = 0;
    }
  };
  lines.forEach((line) => {
    if (quoted && /^>/.test(line)) quote.push(line);
    else {
      flush();
      normal.push(esc(line));
    }
  });
  flush();
  return normal.join("<br>");
}

/** Bewusst kleiner Markdown-Umrichter für die vorhandene Server-Option. */
function markdownToHtml(text: string): string {
  const escaped = esc(text.replace(/\r/g, ""));
  const blocks = escaped.split(/\n{2,}/).map((block) => {
    if (/^```/.test(block)) return `<pre><code>${block.replace(/^```[^\n]*\n?|```$/g, "")}</code></pre>`;
    if (/^(?:&gt; ?)/.test(block)) return `<blockquote>${block.replace(/^&gt; ?/gm, "").replace(/\n/g, "<br>")}</blockquote>`;
    const lines = block.split("\n");
    if (lines.every((line) => /^[-*] /.test(line))) return `<ul>${lines.map((line) => `<li>${line.slice(2)}</li>`).join("")}</ul>`;
    if (lines.every((line) => /^\d+\. /.test(line))) return `<ol>${lines.map((line) => `<li>${line.replace(/^\d+\. /, "")}</li>`).join("")}</ol>`;
    const heading = block.match(/^(#{1,3}) (.+)$/);
    if (heading) return `<p><strong>${heading[2]}</strong></p>`;
    return `<p>${block
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/_([^_]+)_/g, "<em>$1</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
      .replace(/\n/g, "<br>")}</p>`;
  });
  return blocks.join("");
}

/** Nur die kleine Editor-Allowlist übersteht Einfügen, Moduswechsel und Senden. */
function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const clean = (node: Element): void => {
    [...node.children].forEach((child) => {
      clean(child);
      if (!ALLOWED_TAGS.has(child.tagName)) {
        child.replaceWith(...child.childNodes);
        return;
      }
      [...child.attributes].forEach((attr) => {
        if (!ALLOWED_ATTR.has(attr.name.toLowerCase()) || (child.tagName !== "A" && attr.name.toLowerCase() === "href")) child.removeAttribute(attr.name);
      });
      if (child.tagName === "A") {
        const href = child.getAttribute("href") || "";
        if (!/^(https?:|mailto:)/i.test(href)) child.removeAttribute("href");
        child.setAttribute("rel", "noopener noreferrer");
      }
    });
  };
  clean(doc.body);
  return doc.body.innerHTML;
}

export class Composer {
  readonly root: HTMLElement;
  private form: HTMLFormElement;
  private editor: HTMLElement;
  private plain: HTMLTextAreaElement;
  private identities: ComposeIdentity[] = [];
  private prefs: ComposePreferences;
  private files: Attachment[] = [];
  private fields = new Map<string, RecipientField>();
  private seed: ComposeSeed | null = null;
  private mode: "html" | "plain" = "plain";
  private draftRef: { folder: string; uid: number } | null = null;
  private baseline = "";
  private autosaveTimer = 0;
  private saving = false;
  private sending = false;
  private minimized = false;
  private fileInput: HTMLInputElement;
  private closeDialog: HTMLDialogElement;
  private opener: HTMLElement | null = null;

  constructor(host: HTMLElement, prefs: ComposePreferences, private callbacks: ComposeCallbacks) {
    this.prefs = prefs;
    host.innerHTML = `<section class="composer" hidden aria-label="${esc(t("COMPOSE.NEW_MESSAGE", "Neue Mail"))}">
      <form class="composer-form">
        <div class="composer-bar">
          ${button("close", "close", t("GLOBAL.CLOSE", "Schließen"))}
          <span class="title title-md" id="compose-title">${esc(t("COMPOSE.NEW_MESSAGE", "Neue Mail"))}</span><span class="spacer"></span>
          ${button("save", "save", t("COMPOSE.BUTTON_SAVE", "Entwurf speichern"))}
          ${button("minimize", "minimize", t("COMPOSE.BUTTON_MINIMIZE", "Minimieren"))}
          <button type="submit" class="ink-btn">${icon("send")}<span>${esc(t("COMPOSE.BUTTON_SEND", "Senden"))}</span></button>
        </div>
        <div class="compose-scroll">
          <div class="fields compose-fields">
            <label class="field"><span>${esc(t("GLOBAL.FROM", "Von"))}</span><select name="identity" id="compose-identity"></select></label>
            <div class="compose-recipient"><span class="field-label">${esc(t("GLOBAL.TO", "An"))}</span><div class="recipient-box" data-recipient="to"></div><button type="button" class="text-btn compose-more" data-compose="more-fields">Cc · Bcc · ${esc(t("GLOBAL.REPLY_TO", "Antwort an"))}</button></div>
            <div class="compose-recipient" data-extra="cc" hidden><span class="field-label">${esc(t("GLOBAL.CC", "Cc"))}</span><div class="recipient-box" data-recipient="cc"></div></div>
            <div class="compose-recipient" data-extra="bcc" hidden><span class="field-label">${esc(t("GLOBAL.BCC", "Bcc"))}</span><div class="recipient-box" data-recipient="bcc"></div></div>
            <label class="field" data-extra="reply" hidden><span>${esc(t("GLOBAL.REPLY_TO", "Antwort an"))}</span><input name="replyTo" type="email" autocomplete="email"></label>
            <label class="field"><span>${esc(t("GLOBAL.SUBJECT", "Betreff"))}</span><input name="subject" type="text"></label>
          </div>
          <ul class="compose-files" id="compose-files" aria-label="${esc(t("GLOBAL.ATTACHMENTS", "Anhänge"))}" hidden></ul>
          <div class="compose-editor-wrap">
            <div class="editor-tools" role="toolbar" aria-label="${esc(t("COMPOSE.FORMAT_TEXT", "Text formatieren"))}">
              ${button("bold", "bold", t("COMPOSE.BOLD", "Fett"))}${button("italic", "italic", t("COMPOSE.ITALIC", "Kursiv"))}${button("underline", "underline", t("COMPOSE.UNDERLINE", "Unterstrichen"))}
              <span class="tool-separator"></span>${button("insertUnorderedList", "list-bullet", t("COMPOSE.BULLETED_LIST", "Aufzählung"))}${button("insertOrderedList", "list-number", t("COMPOSE.NUMBERED_LIST", "Nummerierte Liste"))}
              ${button("quote", "quote", t("COMPOSE.QUOTE", "Zitat"))}${button("link", "link", t("COMPOSE.INSERT_LINK", "Link einfügen"))}${button("removeFormat", "close", t("COMPOSE.REMOVE_FORMAT", "Format entfernen"))}
              <span class="spacer"></span><button type="button" class="seg" data-compose="mode" aria-pressed="false">HTML</button>
            </div>
            <div class="compose-html" contenteditable="true" role="textbox" aria-multiline="true" aria-label="${esc(t("GLOBAL.TEXT", "Nachricht"))}" data-placeholder="${esc(t("COMPOSE.BODY_PLACEHOLDER", "Nachricht schreiben …"))}"></div>
            <textarea class="compose-plain" name="body" aria-label="${esc(t("GLOBAL.TEXT", "Nachricht"))}" placeholder="${esc(t("COMPOSE.BODY_PLACEHOLDER", "Nachricht schreiben …"))}"></textarea>
          </div>
          <div class="compose-bottom">
            <input type="file" id="compose-upload" multiple hidden>
            <button type="button" class="text-btn" data-compose="attach">${icon("attach")}<span>${esc(t("COMPOSE.ATTACH_FILES", "Anhängen"))}</span></button>
            <details class="compose-options"><summary>${esc(t("COMPOSE.SEND_OPTIONS", "Sendeoptionen"))}</summary><div class="compose-option-grid">
              <label class="check"><input type="checkbox" name="important"> ${esc(t("COMPOSE.BUTTON_MARK_AS_IMPORTANT", "Wichtig markieren"))}</label>
              <label class="check"><input type="checkbox" name="receipt"> ${esc(t("COMPOSE.BUTTON_REQUEST_READ_RECEIPT", "Lesebestätigung anfordern"))}</label>
              <label class="check"><input type="checkbox" name="dsn"> ${esc(t("COMPOSE.BUTTON_REQUEST_DSN", "Zustellbestätigung anfordern"))}</label>
              <label class="check"><input type="checkbox" name="tls"> ${esc(t("COMPOSE.BUTTON_REQUIRE_TLS", "TLS erzwingen"))}</label>
            </div></details>
            <span class="spacer"></span><span class="quiet live" id="compose-status"></span>
          </div>
          <p class="error" id="send-error" role="alert" hidden></p>
          <p class="quiet compose-drop-hint">${esc(t("COMPOSE.ATTACH_DROP_FILES_DESC", "Dateien hier ablegen, um sie anzuhängen."))}</p>
        </div>
      </form>
    </section>
    <button type="button" class="compose-dock" hidden data-compose="restore">${icon("compose")}<span id="compose-dock-title">${esc(t("COMPOSE.RESUME_DRAFT", "Entwurf fortsetzen"))}</span>${icon("chevron-up")}</button>
    <dialog id="compose-close" aria-labelledby="compose-close-title"><div class="dialog-body">
      <h2 id="compose-close-title" class="title title-md">${esc(t("COMPOSE.SAVE_DRAFT", "Entwurf speichern?"))}</h2><p class="quiet">${esc(t("COMPOSE.UNSAVED_WARNING", "Die Änderungen gehen sonst verloren."))}</p>
      <div class="dialog-actions compose-close-actions"><button type="button" class="text-btn" value="cancel">${esc(t("COMPOSE.CONTINUE_WRITING", "Weiter schreiben"))}</button><button type="button" class="danger" value="discard">${esc(t("COMPOSE.DISCARD", "Verwerfen"))}</button><button type="button" class="ink-btn" value="save">${icon("save")}<span>${esc(t("GLOBAL.SAVE", "Speichern"))}</span></button></div>
    </div></dialog>`;
    this.root = host.querySelector(".composer") as HTMLElement;
    this.form = host.querySelector(".composer-form") as HTMLFormElement;
    this.editor = host.querySelector(".compose-html") as HTMLElement;
    this.plain = host.querySelector(".compose-plain") as HTMLTextAreaElement;
    this.fileInput = host.querySelector("#compose-upload") as HTMLInputElement;
    this.closeDialog = host.querySelector("#compose-close") as HTMLDialogElement;
    ["to", "cc", "bcc"].forEach((name) => this.makeRecipients(name as "to" | "cc" | "bcc"));
    this.wire();
    this.setMode(prefs.editor === "Html" ? "html" : "plain");
  }

  configure(prefs: ComposePreferences, identities: ComposeIdentity[]): void {
    this.prefs = prefs;
    this.identities = identities;
    const select = this.form.elements.namedItem("identity") as HTMLSelectElement;
    const current = select.value;
    select.replaceChildren(...identities.map((identity) => {
      const option = document.createElement("option");
      option.value = identity.id;
      option.textContent = `${identity.name ? `${identity.name} ` : ""}<${identity.email}>`;
      return option;
    }));
    select.value = identities.some((item) => item.id === current) ? current : identities[0]?.id || "";
    select.disabled = identities.length < 2;
    this.editor.spellcheck = prefs.spellcheck;
    this.plain.spellcheck = prefs.spellcheck;
    (hostSave(this.root)).hidden = !prefs.draftsFolder;
  }

  private makeRecipients(name: "to" | "cc" | "bcc"): void {
    const box = this.root.querySelector(`[data-recipient='${name}']`) as HTMLElement;
    box.innerHTML = `<div class="recipient-chips"></div><input type="text" autocomplete="off" aria-label="${esc(name === "to" ? "An" : name === "cc" ? "Cc" : "Bcc")}"><div class="recipient-suggestions" role="listbox" hidden></div>`;
    const field: RecipientField = { name, box, input: box.querySelector("input") as HTMLInputElement, list: box.querySelector(".recipient-suggestions") as HTMLElement, values: [], suggestions: [], active: -1, timer: 0, request: 0 };
    this.fields.set(name, field);
    field.input.addEventListener("input", () => this.suggestions(field));
    field.input.addEventListener("keydown", (event) => this.fieldKey(event, field));
    field.input.addEventListener("blur", () => window.setTimeout(() => { this.commitInput(field); field.list.hidden = true; }, 100));
    box.addEventListener("click", (event) => { if (!(event.target as HTMLElement).closest("button")) field.input.focus({ preventScroll: true }); });
  }

  private wire(): void {
    this.root.addEventListener("click", (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>("[data-compose]");
      if (!target) return;
      const action = target.dataset.compose || "";
      if (["bold", "italic", "underline", "insertUnorderedList", "insertOrderedList", "removeFormat"].includes(action)) {
        this.editor.focus({ preventScroll: true });
        document.execCommand(action);
        this.changed();
      } else if (action === "quote") {
        this.editor.focus({ preventScroll: true });
        document.execCommand("formatBlock", false, "blockquote");
        this.changed();
      } else if (action === "link") {
        const href = window.prompt(t("COMPOSE.LINK_ADDRESS", "Link-Adresse"), "https://");
        if (href && /^https?:\/\//i.test(href)) {
          this.editor.focus({ preventScroll: true });
          document.execCommand("createLink", false, href);
          this.changed();
        }
      } else if (action === "mode") this.setMode(this.mode === "html" ? "plain" : "html");
      else if (action === "more-fields") this.root.querySelectorAll<HTMLElement>("[data-extra]").forEach((row) => { row.hidden = false; });
      else if (action === "attach") this.fileInput.click();
      else if (action === "save") void this.save(false);
      else if (action === "close") void this.requestClose();
      else if (action === "minimize") this.minimize();
    });
    this.root.parentElement?.querySelector("[data-compose='restore']")?.addEventListener("click", () => this.restore());
    this.fileInput.addEventListener("change", () => { this.addFiles([...(this.fileInput.files || [])]); this.fileInput.value = ""; });
    this.form.addEventListener("submit", (event) => { event.preventDefault(); this.send(); });
    this.form.addEventListener("input", (event) => { if (!(event.target as HTMLElement).closest(".recipient-box")) this.changed(); });
    this.form.addEventListener("change", () => this.changed());
    (this.form.elements.namedItem("identity") as HTMLSelectElement).addEventListener("change", () => this.changeIdentity());
    this.editor.addEventListener("paste", (event) => {
      event.preventDefault();
      const html = event.clipboardData?.getData("text/html") || "";
      const text = event.clipboardData?.getData("text/plain") || "";
      document.execCommand("insertHTML", false, html ? sanitizeHtml(html) : plainToHtml(text));
      this.changed();
    });
    this.root.addEventListener("dragover", (event) => { event.preventDefault(); this.root.classList.add("dragging"); });
    this.root.addEventListener("dragleave", (event) => { if (!this.root.contains(event.relatedTarget as Node)) this.root.classList.remove("dragging"); });
    this.root.addEventListener("drop", (event) => { event.preventDefault(); this.root.classList.remove("dragging"); this.addFiles([...(event.dataTransfer?.files || [])]); });
    this.closeDialog.querySelectorAll<HTMLButtonElement>("button[value]").forEach((button) => {
      button.addEventListener("click", () => this.closeDialog.close(button.value));
    });
    this.closeDialog.addEventListener("close", () => {
      if (this.closeDialog.returnValue === "save") void this.save(true);
      else if (this.closeDialog.returnValue === "discard") this.finishClose(true);
      this.closeDialog.returnValue = "";
    });
    document.addEventListener("keydown", (event) => {
      if (this.root.hidden || this.minimized || this.closeDialog.open) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void this.save(false); }
      else if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); this.send(); }
      else if (event.key === "Escape" && !this.root.querySelector("dialog[open]")) { event.preventDefault(); void this.requestClose(); }
    });
  }

  open(seed: ComposeSeed): void {
    this.seed = seed;
    this.draftRef = seed.draftRef || null;
    this.files = [];
    (this.root.querySelector("#compose-title") as HTMLElement).textContent = seed.title;
    (this.root.parentElement?.querySelector("#compose-dock-title") as HTMLElement).textContent = seed.subject || seed.title;
    this.fields.forEach((field, name) => {
      field.values = addresses(String(seed[name as "to" | "cc" | "bcc"] || ""));
      field.input.value = "";
      this.paintRecipients(field);
    });
    (this.form.elements.namedItem("subject") as HTMLInputElement).value = seed.subject;
    (this.form.elements.namedItem("replyTo") as HTMLInputElement).value = seed.replyTo || "";
    this.root.querySelectorAll<HTMLElement>("[data-extra]").forEach((row) => { row.hidden = true; });
    if (seed.cc) (this.root.querySelector("[data-extra='cc']") as HTMLElement).hidden = false;
    if (seed.bcc) (this.root.querySelector("[data-extra='bcc']") as HTMLElement).hidden = false;
    if (seed.replyTo) (this.root.querySelector("[data-extra='reply']") as HTMLElement).hidden = false;
    const identity = this.identities.find((item) => item.id === seed.identityId) || this.identities[0];
    (this.form.elements.namedItem("identity") as HTMLSelectElement).value = identity?.id || "";
    this.mode = this.prefs.editor === "Html" ? "html" : "plain";
    this.plain.value = seed.body;
    this.editor.innerHTML = seed.html ? sanitizeHtml(seed.html) : plainToHtml(seed.body, seed.mode === "reply");
    this.paintMode();
    this.setOptions();
    this.applyIdentity(identity, true);
    this.setStatus("");
    this.setError("");
    this.root.hidden = false;
    this.root.dataset.open = "false";
    this.minimized = false;
    (this.root.parentElement?.querySelector(".compose-dock") as HTMLElement).hidden = true;
    requestAnimationFrame(() => { this.root.dataset.open = "true"; });
    this.callbacks.mobile(true);
    this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target = seed.to ? (seed.subject ? (this.mode === "html" ? this.editor : this.plain) : this.form.elements.namedItem("subject") as HTMLElement) : this.fields.get("to")?.input;
    target?.focus({ preventScroll: true });
    this.baseline = this.fingerprint();
    this.scheduleAutosave();
  }

  private setOptions(): void {
    const identity = this.identity();
    const set = (name: string, value: boolean) => { (this.form.elements.namedItem(name) as HTMLInputElement).checked = value; };
    set("important", false);
    set("receipt", this.prefs.readReceipt);
    set("dsn", this.prefs.dsn);
    set("tls", this.prefs.requireTLS);
    this.root.dataset.pgpSign = String(identity?.pgpSign || this.prefs.pgpSign);
    this.root.dataset.pgpEncrypt = String(identity?.pgpEncrypt || this.prefs.pgpEncrypt);
  }

  private identity(): ComposeIdentity | undefined {
    return this.identities.find((item) => item.id === (this.form.elements.namedItem("identity") as HTMLSelectElement).value) || this.identities[0];
  }

  private signature(identity: ComposeIdentity, html: boolean): string {
    let signature = identity.signature || "";
    const isHtml = signature.startsWith(":HTML:");
    if (isHtml) signature = signature.slice(6);
    const from = `${identity.name ? `${identity.name} ` : ""}<${identity.email}>`;
    signature = signature.replace(/{{FROM-FULL}}|{{FROM}}/g, from).replace(/{{DATE}}/g, new Date().toLocaleString()).replace(/{{TIME}}/g, new Date().toLocaleTimeString()).replace(/{{MOMENT:[^}]+}}/g, "");
    return html ? (isHtml ? sanitizeHtml(signature) : plainToHtml(signature)) : (isHtml ? htmlToPlain(signature) : signature);
  }

  private applyIdentity(identity: ComposeIdentity | undefined, initial: boolean): void {
    if (!identity) return;
    if (initial || this.seed?.mode === "new" || !this.seed?.mode) {
      if (identity.replyTo && !(this.form.elements.namedItem("replyTo") as HTMLInputElement).value) {
        (this.form.elements.namedItem("replyTo") as HTMLInputElement).value = identity.replyTo;
        (this.root.querySelector("[data-extra='reply']") as HTMLElement).hidden = false;
      }
      const bcc = this.fields.get("bcc");
      if (bcc && identity.bcc && !bcc.values.length) {
        bcc.values = addresses(identity.bcc);
        this.paintRecipients(bcc);
        (this.root.querySelector("[data-extra='bcc']") as HTMLElement).hidden = false;
      }
    }
    this.root.querySelectorAll(".compose-signature").forEach((node) => node.remove());
    const signature = this.signature(identity, this.mode === "html");
    if (!signature) return;
    if (this.mode === "html") {
      const node = document.createElement("div");
      node.className = "compose-signature";
      node.innerHTML = `<br>${signature}`;
      if (identity.signatureInsertBefore) this.editor.prepend(node);
      else this.editor.append(node);
    } else {
      const cleaned = this.plain.value.replace(/\n*-- \n[\s\S]*?(?=\n\n|$)/g, "");
      this.plain.value = identity.signatureInsertBefore ? `\n\n-- \n${signature}${cleaned}` : `${cleaned}\n\n-- \n${signature}`;
    }
  }

  private changeIdentity(): void {
    const identity = this.identity();
    this.applyIdentity(identity, false);
    this.root.dataset.pgpSign = String(identity?.pgpSign || this.prefs.pgpSign);
    this.root.dataset.pgpEncrypt = String(identity?.pgpEncrypt || this.prefs.pgpEncrypt);
    this.changed();
  }

  private setMode(mode: "html" | "plain"): void {
    if (mode === this.mode) { this.paintMode(); return; }
    if (mode === "html") this.editor.innerHTML = this.prefs.markdown ? markdownToHtml(this.plain.value) : plainToHtml(this.plain.value, true);
    else this.plain.value = htmlToPlain(this.editor.innerHTML);
    this.mode = mode;
    this.paintMode();
    this.changed();
  }

  private paintMode(): void {
    this.editor.hidden = this.mode !== "html";
    this.plain.hidden = this.mode === "html";
    this.root.querySelectorAll<HTMLElement>(".editor-tools > [data-compose]:not([data-compose='mode']), .tool-separator").forEach((item) => { item.hidden = this.mode !== "html"; });
    const toggle = this.root.querySelector("[data-compose='mode']") as HTMLButtonElement;
    toggle.textContent = this.mode === "html" ? "Text" : "HTML";
    toggle.setAttribute("aria-pressed", this.mode === "html" ? "true" : "false");
  }

  private paintRecipients(field: RecipientField): void {
    const chips = field.box.querySelector(".recipient-chips") as HTMLElement;
    chips.innerHTML = field.values.map((value, index) => `<span class="recipient-chip${validAddress(value) ? "" : " invalid"}" title="${esc(validAddress(value) ? value : t("COMPOSE.INVALID_ADDRESS", "Ungültige Adresse"))}">${esc(value)}<button type="button" data-chip="${index}" aria-label="${esc(t("COMPOSE.REMOVE_RECIPIENT", "%ADDRESS% entfernen").replace("%ADDRESS%", value))}">${icon("close")}</button></span>`).join("");
    chips.querySelectorAll<HTMLButtonElement>("button").forEach((button) => button.addEventListener("click", () => {
      field.values.splice(Number(button.dataset.chip), 1);
      this.paintRecipients(field);
      this.changed();
      field.input.focus({ preventScroll: true });
    }));
  }

  private commitInput(field: RecipientField): boolean {
    const value = field.input.value.trim().replace(/[,;]$/, "");
    if (!value) return false;
    addresses(value).forEach((item) => field.values.push(item));
    field.input.value = "";
    field.list.hidden = true;
    this.paintRecipients(field);
    this.changed();
    return true;
  }

  private suggestions(field: RecipientField): void {
    const query = field.input.value.trim();
    window.clearTimeout(field.timer);
    if (!query) { field.list.hidden = true; return; }
    const request = ++field.request;
    field.timer = window.setTimeout(async () => {
      try {
        const result = await call<[string, string][]>("Suggestions", { Query: query });
        if (request !== field.request) return;
        field.suggestions = (result || []).filter((row) => row?.[0]).map((row) => row[1] ? `${row[1]} <${row[0]}>` : row[0]);
        field.active = -1;
        field.list.innerHTML = field.suggestions.map((value, index) => `<button type="button" role="option" aria-selected="false" data-suggestion="${index}">${esc(value)}</button>`).join("");
        field.list.hidden = !field.suggestions.length;
        field.list.querySelectorAll<HTMLButtonElement>("button").forEach((button) => button.addEventListener("mousedown", (event) => {
          event.preventDefault();
          field.input.value = field.suggestions[Number(button.dataset.suggestion)];
          this.commitInput(field);
        }));
      } catch { field.list.hidden = true; }
    }, 200);
  }

  private fieldKey(event: KeyboardEvent, field: RecipientField): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (field.list.hidden) return;
      event.preventDefault();
      field.active = (field.active + (event.key === "ArrowDown" ? 1 : -1) + field.suggestions.length) % field.suggestions.length;
      field.list.querySelectorAll("button").forEach((button, index) => button.setAttribute("aria-selected", index === field.active ? "true" : "false"));
    } else if (event.key === "Enter" || event.key === "," || event.key === ";") {
      event.preventDefault();
      if (event.key === "Enter" && field.active >= 0) field.input.value = field.suggestions[field.active];
      this.commitInput(field);
    } else if (event.key === "Backspace" && !field.input.value && field.values.length) {
      field.values.pop();
      this.paintRecipients(field);
      this.changed();
    } else if (event.key === "Escape") field.list.hidden = true;
  }

  private addFiles(list: File[]): void {
    list.forEach((file) => {
      const item: Attachment = { name: file.name, size: sizeLabel(file.size), bytes: file.size, state: "busy", progress: 0, tempName: "", type: file.type };
      this.files.push(item);
      if (this.prefs.attachmentLimit > 0 && file.size > this.prefs.attachmentLimit) {
        item.state = "error";
        item.error = t("COMPOSE.ATTACHMENT_TOO_LARGE", "Die Datei überschreitet die Grenze von %SIZE%.").replace("%SIZE%", sizeLabel(this.prefs.attachmentLimit));
      } else {
        item.task = upload(file, (percent) => { item.progress = percent; this.paintFiles(); });
        void item.task.promise.then((result) => {
          item.name = result.name;
          item.bytes = result.size;
          item.size = sizeLabel(result.size);
          item.tempName = result.tempName;
          item.type = result.mimeType;
          item.state = "";
        }).catch((error) => { item.state = "error"; item.error = explain(error); }).finally(() => { item.task = undefined; this.paintFiles(); });
      }
      this.paintFiles();
    });
    this.changed();
  }

  async attachFrom(items: { key: string; name: string; size: number }[]): Promise<void> {
    if (!items.length) return;
    const added: Attachment[] = items.map((item) => ({ name: item.name, size: sizeLabel(item.size), bytes: item.size, state: "busy", tempName: "", type: "" }));
    this.files.push(...added);
    this.paintFiles();
    try {
      const result = await call<({ tempName?: string; mimeType?: string } | false)[]>("MessageUploadAttachments", { attachments: items.map((item) => item.key) });
      added.forEach((file, index) => {
        const row = Array.isArray(result) ? result[index] : null;
        if (row && row.tempName) { file.tempName = row.tempName; file.type = String(row.mimeType || ""); file.state = ""; }
        else { file.state = "error"; file.error = t("COMPOSE.ORIGINAL_ATTACHMENT_ERROR", "Der Original-Anhang konnte nicht übernommen werden."); }
      });
    } catch (error) { added.forEach((file) => { file.state = "error"; file.error = explain(error); }); }
    this.paintFiles();
  }

  private paintFiles(): void {
    const box = this.root.querySelector("#compose-files") as HTMLElement;
    box.hidden = !this.files.length;
    box.innerHTML = this.files.map((file, index) => {
      const action = file.state === "busy"
        ? t("COMPOSE.CANCEL_UPLOAD", "Upload von %NAME% abbrechen").replace("%NAME%", file.name)
        : t("COMPOSE.REMOVE_RECIPIENT", "%ADDRESS% entfernen").replace("%ADDRESS%", file.name);
      return `<li class="compose-file">${icon(file.state === "busy" ? "loading" : file.state === "error" ? "error" : "attachment")}<span class="grow" title="${esc(file.error || file.name)}">${esc(file.name)}</span><span class="quiet">${esc(file.state === "error" ? file.error || t("COMPOSE.ATTACHMENTS_ERROR_DESC", "Fehler") : file.size)}</span>${file.state === "busy" ? `<progress max="100" value="${file.progress || 0}" aria-label="${esc(t("COMPOSE.UPLOAD_PROGRESS", "Upload-Fortschritt"))}"></progress>` : ""}<button type="button" class="icon-btn" data-file="${index}" aria-label="${esc(action)}" title="${esc(action)}">${icon("close")}</button></li>`;
    }).join("");
    box.querySelectorAll<HTMLButtonElement>("[data-file]").forEach((button) => button.addEventListener("click", () => {
      const index = Number(button.dataset.file);
      this.files[index]?.task?.abort();
      this.files.splice(index, 1);
      this.paintFiles();
      this.changed();
    }));
  }

  private values(saveFolder: string): ComposeValues {
    this.fields.forEach((field) => this.commitInput(field));
    const identity = this.identity();
    if (!identity) throw new ApiError(0, t("COMPOSE.NO_IDENTITY", "Keine Absender-Identität vorhanden."));
    const invalid = [...this.fields.values()].flatMap((field) => field.values).filter((value) => !validAddress(value));
    if (invalid.length) throw new ApiError(303, `${t("COMPOSE.INVALID_ADDRESS", "Ungültige Adresse")}: ${invalid[0]}`);
    const html = this.mode === "html" ? sanitizeHtml(this.editor.innerHTML) : this.prefs.markdown ? markdownToHtml(this.plain.value) : "";
    const plain = this.mode === "html" ? htmlToPlain(html) : this.plain.value;
    const attachments: ComposeValues["attachments"] = {};
    this.files.filter((file) => file.tempName && file.state !== "error").forEach((file) => {
      attachments[file.tempName] = { name: file.name, inline: false, cId: "", location: "", type: file.type || "application/octet-stream" };
    });
    return {
      ...(this.seed as ComposeSeed),
      to: this.fields.get("to")?.values.join(", ") || "",
      cc: this.fields.get("cc")?.values.join(", ") || "",
      bcc: this.fields.get("bcc")?.values.join(", ") || "",
      replyTo: String((this.form.elements.namedItem("replyTo") as HTMLInputElement).value || ""),
      subject: String((this.form.elements.namedItem("subject") as HTMLInputElement).value || ""),
      body: plain,
      plain,
      html,
      identityID: identity.id,
      from: `${identity.name ? `${identity.name} ` : ""}<${identity.email}>`,
      saveFolder,
      attachments,
      markAsImportant: (this.form.elements.namedItem("important") as HTMLInputElement).checked ? 1 : 0,
      readReceiptRequest: (this.form.elements.namedItem("receipt") as HTMLInputElement).checked ? 1 : 0,
      dsn: (this.form.elements.namedItem("dsn") as HTMLInputElement).checked ? 1 : 0,
      requireTLS: (this.form.elements.namedItem("tls") as HTMLInputElement).checked ? 1 : 0,
      pgpSign: this.root.dataset.pgpSign === "true" ? 1 : 0,
      pgpEncrypt: this.root.dataset.pgpEncrypt === "true" ? 1 : 0,
      messageFolder: this.draftRef?.folder || "",
      messageUid: this.draftRef?.uid || 0
    };
  }

  send(): void {
    if (this.sending || this.saving) return;
    try {
      const values = this.values(this.saveFolder());
      if (!values.to && !values.cc && !values.bcc) throw new ApiError(303, t("COMPOSE.EMPTY_TO_ERROR_DESC", "Geben Sie bitte mindestens einen Empfänger an."));
      if (this.files.some((file) => file.state === "busy")) throw new ApiError(0, t("COMPOSE.ATTACHMENTS_UPLOAD_ERROR_DESC", "Anhänge werden noch hochgeladen."));
      if (this.files.some((file) => file.state === "error")) throw new ApiError(0, t("COMPOSE.ATTACHMENTS_ERROR_DESC", "Entfernen Sie die fehlgeschlagenen Anhänge vor dem Senden."));
      this.sending = true;
      this.setBusy(true, t("COMPOSE.SENDING", "Wird gesendet …"));
      this.callbacks.send(values);
    } catch (error) { this.setError(explain(error)); }
  }

  private saveFolder(): string {
    const identity = this.identity();
    if (identity?.sentFolder && identity.sentFolder !== "-") return identity.sentFolder;
    if (this.prefs.replySameFolder && this.seed?.mode && ["reply", "forward"].includes(this.seed.mode) && this.seed.sourceFolder) return this.seed.sourceFolder;
    return this.prefs.sentFolder;
  }

  async save(closeAfter: boolean): Promise<void> {
    if (this.saving || this.sending) return;
    if (!this.prefs.draftsFolder) { this.setError(t("COMPOSE.NO_DRAFTS_FOLDER", "Kein Entwürfe-Ordner eingerichtet.")); return; }
    let status = "";
    try {
      if (this.empty()) { if (closeAfter) this.finishClose(false); return; }
      if (this.files.some((file) => file.state === "busy")) throw new ApiError(0, t("COMPOSE.ATTACHMENTS_UPLOAD_ERROR_DESC", "Anhänge werden noch hochgeladen."));
      this.setError("");
      this.saving = true;
      this.setBusy(true, t("COMPOSE.SAVING", "Wird gespeichert …"));
      const values = this.values(this.prefs.draftsFolder);
      const saved = await this.callbacks.save(values);
      this.draftRef = saved;
      this.baseline = this.fingerprint();
      status = t("COMPOSE.SAVED_TIME", "Gespeichert um %TIME%").replace("%TIME%", new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      if (closeAfter) this.finishClose(false);
    } catch (error) { this.setError(explain(error)); }
    finally { this.saving = false; this.setBusy(false, status); this.scheduleAutosave(); }
  }

  private empty(): boolean {
    const content = this.mode === "html" ? htmlToPlain(this.editor.innerHTML) : this.plain.value;
    const subject = (this.form.elements.namedItem("subject") as HTMLInputElement).value.trim();
    return ![...this.fields.values()].some((field) => field.values.length || field.input.value.trim()) && !subject && !content.trim() && !this.files.length;
  }

  private fingerprint(): string {
    return JSON.stringify({
      to: [...this.fields.values()].map((field) => field.values),
      subject: (this.form.elements.namedItem("subject") as HTMLInputElement).value,
      replyTo: (this.form.elements.namedItem("replyTo") as HTMLInputElement).value,
      identity: this.identity()?.id,
      body: this.mode === "html" ? this.editor.innerHTML : this.plain.value,
      files: this.files.map((file) => file.tempName || file.name),
      options: ["important", "receipt", "dsn", "tls"].map((name) => (this.form.elements.namedItem(name) as HTMLInputElement).checked)
    });
  }

  private changed(): void { this.scheduleAutosave(); }

  private scheduleAutosave(): void {
    window.clearTimeout(this.autosaveTimer);
    if (!this.prefs.autosave || this.root.hidden) return;
    this.autosaveTimer = window.setTimeout(() => {
      if (!this.root.hidden && !this.minimized && !this.empty() && this.fingerprint() !== this.baseline) void this.save(false);
      else this.scheduleAutosave();
    }, 60_000);
  }

  async requestClose(): Promise<void> {
    if (this.empty() && !this.draftRef) { this.finishClose(false); return; }
    if (this.fingerprint() === this.baseline) { this.finishClose(false); return; }
    this.closeDialog.showModal();
  }

  private minimize(): void {
    this.minimized = true;
    this.root.hidden = true;
    (this.root.parentElement?.querySelector(".compose-dock") as HTMLElement).hidden = false;
    this.callbacks.mobile(false);
    this.opener?.focus({ preventScroll: true });
  }

  private restore(): void {
    this.minimized = false;
    this.root.hidden = false;
    (this.root.parentElement?.querySelector(".compose-dock") as HTMLElement).hidden = true;
    this.callbacks.mobile(true);
    (this.mode === "html" ? this.editor : this.plain).focus({ preventScroll: true });
  }

  private finishClose(discard: boolean): void {
    window.clearTimeout(this.autosaveTimer);
    this.files.forEach((file) => file.task?.abort());
    this.root.hidden = true;
    this.root.dataset.open = "false";
    (this.root.parentElement?.querySelector(".compose-dock") as HTMLElement).hidden = true;
    this.minimized = false;
    this.callbacks.mobile(false);
    this.callbacks.close(discard);
    this.opener?.focus({ preventScroll: true });
  }

  sent(): void {
    this.sending = false;
    this.setBusy(false, "");
    this.finishClose(false);
  }

  setError(error: string): void {
    this.sending = false;
    this.setBusy(false, "");
    const slot = this.root.querySelector("#send-error") as HTMLElement;
    slot.hidden = !error;
    slot.textContent = error;
  }

  private setBusy(busy: boolean, status: string): void {
    const submit = this.form.querySelector("button[type='submit']") as HTMLButtonElement;
    submit.disabled = busy;
    submit.innerHTML = `${icon(busy ? "loading" : "send")}<span>${esc(busy && this.sending ? t("COMPOSE.SENDING", "Wird gesendet …") : t("COMPOSE.BUTTON_SEND", "Senden"))}</span>`;
    this.setStatus(status);
  }

  private setStatus(text: string): void { (this.root.querySelector("#compose-status") as HTMLElement).textContent = text; }

  setBody(text: string): void {
    if (this.mode === "html") this.editor.innerHTML = plainToHtml(text);
    else this.plain.value = text;
    this.changed();
  }

  body(): string { return this.mode === "html" ? htmlToPlain(this.editor.innerHTML) : this.plain.value; }
  subject(): string { return (this.form.elements.namedItem("subject") as HTMLInputElement).value; }
  isOpen(): boolean { return !this.root.hidden; }
}

function hostSave(root: HTMLElement): HTMLElement {
  return root.querySelector("[data-compose='save']") as HTMLElement;
}
