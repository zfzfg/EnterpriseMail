// Brief-Spalte: Kopf, Hinweisleisten, Anhänge, iframe und die Sammelansicht bei Mehrfachauswahl.
import { icon, type IconName } from "./icons";
import { t } from "./i18n";
import type { CalendarEvent } from "./letter";

export interface ReaderPerson { name: string; email: string }

export interface ReaderFile {
  index: number;
  name: string;
  size: string;
  href: string;
  view: string;
  thumb: string;
  kind: "image" | "pdf" | "calendar" | "text" | "archive" | "other";
}

export interface ReaderPlace {
  inSpam: boolean;
  inTrash: boolean;
  inDrafts: boolean;
  archive: boolean;
  spam: boolean;
}

export interface ReaderData {
  uid: number;
  subject: string;
  from: ReaderPerson[];
  to: ReaderPerson[];
  cc: ReaderPerson[];
  bcc: ReaderPerson[];
  replyTo: ReaderPerson[];
  when: string;
  whenFull: string;
  size: string;
  flagged: boolean;
  seen: boolean;
  deleted: boolean;
  keywords: string[];
  srcdoc: string;
  mode: "html" | "plain";
  canToggleMode: boolean;
  blocked: number;
  failed: number;
  tracking: boolean;
  originalLinks: boolean;
  swap: boolean;
  spam: string;
  receipt: string;
  unsubscribe: boolean;
  files: ReaderFile[];
  /** Einfache Anhangsliste (`simpleAttachmentsList`): kompakte Zeilen ohne Vorschaubild. */
  simpleFiles: boolean;
  /** Kontakte verfügbar: Adressmenü bietet „Zu Kontakten“. */
  contacts: boolean;
  zip: boolean;
  calendar: CalendarEvent | null;
  place: ReaderPlace;
  /** Verschlüsselung oder Signatur, leer wenn die Mail keines von beiden trägt. */
  crypto: ReaderCrypto | null;
}

export interface ReaderCrypto {
  encrypted: boolean;
  signed: boolean;
  autocrypt: boolean;
  smime: boolean;
  /** ok, bad oder noch offen. */
  state: "" | "ok" | "bad";
  text: string;
}

export interface BulkMessageSummary {
  uid: number;
  who: string;
  subject: string;
  when: string;
  unseen: boolean;
  flagged: boolean;
}

export interface BulkReplyItem {
  uid: number;
  subject: string;
  who: string;
  replies: { label: string; body: string }[];
}

export interface BulkSummaryState {
  tldr: string;
  points: string[];
  decisions?: string[];
  actions?: string[];
  next?: string;
  shown?: number;
  cached?: boolean;
  model?: string;
}

export interface BulkAssistState {
  summarize: boolean;
  replies: boolean;
  loadingSummary?: string;
  loadingReplies?: string;
  error?: string;
  summary?: BulkSummaryState | null;
  repliesList?: BulkReplyItem[];
  repliesNote?: string;
}

export interface BulkData {
  count: number;
  place: ReaderPlace;
  zip: boolean;
  folderName?: string;
  totalInFolder?: number;
  unseenCount?: number;
  flaggedCount?: number;
  messages?: BulkMessageSummary[];
  assist?: BulkAssistState | null;
}

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c] ?? c));
}

function person(item: ReaderPerson): string {
  const text = item.name ? `${item.name} <${item.email}>` : item.email;
  return `<button type="button" class="addr" data-action="m-address" data-email="${esc(item.email)}" data-name="${esc(item.name)}" title="${esc(item.email)}">${esc(item.name || item.email)}</button><span class="sr">${esc(text)}</span>`;
}

function people(list: ReaderPerson[]): string {
  return list.map(person).join('<span class="sep">, </span>');
}

function line(label: string, list: ReaderPerson[]): string {
  if (!list.length) return "";
  return `<div class="head-line"><span class="head-key mono">${esc(label)}</span><span class="head-val">${people(list)}</span></div>`;
}

const FILE_ICON: Record<ReaderFile["kind"], IconName> = {
  image: "image", pdf: "drafts", calendar: "calendar", text: "drafts", archive: "download-zip", other: "attachment"
};

function bar(kind: string, iconName: IconName, text: string, actions: string): string {
  return `<div class="note-bar" data-kind="${kind}" role="status">${icon(iconName)}<span class="grow">${esc(text)}</span>${actions}</div>`;
}

function textButton(action: string, label: string, extra = ""): string {
  return `<button type="button" class="text-btn" data-action="${action}"${extra}>${esc(label)}</button>`;
}

function detailsMarkup(data: ReaderData, expanded: boolean, secBadge: string): string {
  if (expanded) return `
    <div class="head-details">
      ${line(t("MESSAGE.FORWARD_FROM", "Von"), data.from)}
      ${line(t("MESSAGE.FORWARD_TO", "An"), data.to)}
      ${line("Cc", data.cc)}
      ${line("Bcc", data.bcc)}
      ${line(t("MESSAGE.REPLY_TO", "Antwort an"), data.replyTo)}
      <div class="head-line"><span class="head-key mono">${esc(t("MESSAGE.FORWARD_DATE", "Datum"))}</span><span class="head-val">${esc(data.whenFull)}</span></div>
      ${data.crypto ? `<div class="head-line"><span class="head-key mono">${esc(t("CRYPTO.TITLE_SECURITY", "Sicherheit"))}</span><span class="head-val">${secBadge || `<span class="quiet">${esc(t("CRYPTO.STANDARD", "Standard"))}</span>`}</span></div>` : ""}
      ${data.size ? `<div class="head-line"><span class="head-key mono">${esc(t("MESSAGE_LIST.SORT_SIZE", "Größe"))}</span><span class="head-val">${esc(data.size)}</span></div>` : ""}
    </div>`;
  return data.to.length ? `<div class="head-line head-summary quiet"><span class="head-key mono">${esc(t("MESSAGE.FORWARD_TO", "An"))}</span><span class="head-val">${people(data.to.slice(0, 3))}${data.to.length + data.cc.length > 3 ? ` <span class="quiet">+${data.to.length + data.cc.length - 3}</span>` : ""}</span></div>` : "";
}

/** Nur Metadaten und Schalter aktualisieren; Brief und Hinweise bleiben unangetastet. */
export function paintReaderDetails(body: HTMLElement, data: ReaderData, expanded: boolean): void {
  const secBadge = body.querySelector(".head-main .badge-sec")?.outerHTML || "";
  const slot = body.querySelector(".head-details-slot");
  if (slot) slot.innerHTML = detailsMarkup(data, expanded, secBadge);
  const button = body.querySelector("[data-action='m-details']") as HTMLElement | null;
  if (!button) return;
  const label = expanded ? t("MESSAGE.DETAILS_COLLAPSE", "Details ausblenden") : t("MESSAGE.DETAILS_EXPAND", "Details anzeigen");
  button.setAttribute("aria-expanded", expanded ? "true" : "false");
  button.setAttribute("aria-label", label);
  button.title = label;
  button.innerHTML = icon(expanded ? "chevron-up" : "chevron-down");
}

export function paintReaderFiles(body: HTMLElement, showAll: boolean): void {
  body.querySelectorAll<HTMLElement>(".file-overflow").forEach((file) => { file.hidden = !showAll; });
  const button = body.querySelector("[data-action='m-files-toggle']") as HTMLElement | null;
  if (!button) return;
  const count = Number(button.dataset.count || 0);
  const label = showAll
    ? t("MESSAGE.ATTACHMENTS_SHOW_LESS", "Weniger Anhänge anzeigen")
    : t("MESSAGE.ATTACHMENTS_SHOW_ALL", "Alle %COUNT% Anhänge anzeigen").replace("%COUNT%", String(count));
  button.setAttribute("aria-expanded", showAll ? "true" : "false");
  button.setAttribute("aria-label", label);
  button.title = label;
  button.innerHTML = `${icon(showAll ? "chevron-up" : "chevron-down")}<span class="btn-label">${esc(label)}</span>`;
}

export function renderReader(body: HTMLElement, data: ReaderData, expanded: boolean, showAllFiles = false): void {
  const tags = data.keywords.map((tag) =>
    `<span class="tag">${icon("tag")}<span>${esc(tag)}</span><button type="button" class="tag-x" data-action="m-untag" data-tag="${esc(tag)}" aria-label="${esc(t("MESSAGE_TAGS.REMOVE_TAG", "Schlagwort %TAG% entfernen").replace("%TAG%", tag))}" title="${esc(t("MESSAGE_TAGS.REMOVE_TAG", "Schlagwort %TAG% entfernen").replace("%TAG%", tag))}">${icon("close")}</button></span>`
  ).join("");
  const secBadge = data.crypto && (data.crypto.signed || data.crypto.encrypted)
    ? `<span class="badge-sec ${data.crypto.state === "bad" ? "badge-sec--bad" : "badge-sec--ok"}" title="${esc(data.crypto.text || (data.crypto.state === "bad" ? t("CRYPTO.VERIFY_BAD", "Signatur ungültig") : t("CRYPTO.VERIFY_OK", "Kryptografisch verifiziert")))}">${icon(data.crypto.state === "bad" ? "shield-alert" : "shield-check")}<span>${esc(data.crypto.state === "bad" ? t("CRYPTO.INVALID", "Ungültig") : t("CRYPTO.VERIFIED", "Verifiziert"))}</span></span>`
    : "";
  const from = data.from[0];
  const detailsLabel = expanded ? t("MESSAGE.DETAILS_COLLAPSE", "Details ausblenden") : t("MESSAGE.DETAILS_EXPAND", "Details anzeigen");
  const summary = `
    <div class="head-line head-main">
      <span class="head-val">${from ? person(from) : `<span class="quiet">${esc(t("MESSAGE.UNKNOWN_SENDER", "(unbekannt)"))}</span>`}</span>
      <span class="spacer"></span>
      ${secBadge}
      <time class="quiet" title="${esc(data.whenFull)}">${esc(data.when)}</time>
      <button type="button" class="icon-btn details-toggle" data-action="m-details" aria-expanded="${expanded ? "true" : "false"}" aria-controls="reader-details" aria-label="${esc(detailsLabel)}" title="${esc(detailsLabel)}">${icon(expanded ? "chevron-up" : "chevron-down")}</button>
    </div>`;

  const bars: string[] = [];
  if (data.place.inDrafts) bars.push(bar("draft", "compose", t("MESSAGE.IS_DRAFT", "Dies ist ein noch nicht gesendeter Entwurf."), textButton("m-edit-draft", t("MESSAGE.EDIT_DRAFT", "Entwurf bearbeiten"))));
  if (data.deleted) bars.push(bar("deleted", "trash", t("MESSAGE.MARKED_AS_DELETED", "Als gelöscht markiert."), textButton("m-restore", t("MESSAGE.RESTORED", "Wiederherstellen"))));
  if (data.spam) bars.push(bar("spam", "spam", data.spam, ""));
  if (data.blocked || data.failed) {
    const notes: string[] = [];
    if (data.blocked) notes.push(data.blocked === 1
      ? t("MESSAGE.IMAGES_BLOCKED_ONE", "Ein externes Bild blockiert")
      : t("MESSAGE.IMAGES_BLOCKED_MANY", "%COUNT% externe Bilder blockiert").replace("%COUNT%", String(data.blocked)));
    if (data.failed) notes.push(data.failed === 1
      ? t("MESSAGE.IMAGES_FAILED_ONE", "Ein Bild nicht erreichbar")
      : t("MESSAGE.IMAGES_FAILED_MANY", "%COUNT% Bilder nicht erreichbar").replace("%COUNT%", String(data.failed)));
    bars.push(bar("images", "image-blocked", `${notes.join(" · ")}.`,
      data.blocked ? textButton("m-images", t("MESSAGE.SHOW_IMAGES", "Anzeigen")) + (from ? textButton("m-images-always", t("MESSAGE.SHOW_IMAGES_FOR_SENDER", "Immer für diesen Absender")) : "") : ""));
  }
  if (data.tracking) {
    bars.push(bar("tracking", "shield-check",
      data.originalLinks ? t("MESSAGE.TRACKING_ORIGINAL", "Links zeigen auf die Originaladressen mit Tracking.") : t("MESSAGE.TRACKING_REMOVED", "Tracking in Links und Bildern wurde entfernt."),
      textButton("m-links", data.originalLinks ? t("MESSAGE.CLEANED_LINKS", "Bereinigte Links") : t("MESSAGE.ORIGINAL_LINKS", "Originallinks"))));
  }
  if (data.receipt) {
    bars.push(bar("receipt", "receipt", t("MESSAGE.RECEIPT_REQUEST", "Der Absender bittet um eine Lesebestätigung an %ADDRESS%.").replace("%ADDRESS%", data.receipt),
      textButton("m-receipt", t("MESSAGE.SEND_RECEIPT", "Bestätigung senden")) + textButton("m-receipt-skip", t("MESSAGE.SKIP_RECEIPT", "Nicht senden"))));
  }
  if (data.crypto && (data.crypto.encrypted || data.crypto.signed || data.crypto.autocrypt)) {
    const actions = [
      data.crypto.encrypted ? textButton("m-decrypt", t("CRYPTO.DECRYPT", "Entschlüsseln")) : "",
      data.crypto.signed ? textButton("m-verify", t("CRYPTO.VERIFY", "Signatur prüfen")) : "",
      data.crypto.smime ? textButton("m-smime-certs", t("SMIME.IMPORT_FROM_MAIL", "Zertifikate übernehmen")) : "",
      data.crypto.autocrypt ? textButton("m-autocrypt", t("CRYPTO.IMPORT_AUTOCRYPT", "Schlüssel übernehmen")) : ""
    ].join("");
    const mark = data.crypto.state === "bad" ? "shield-alert" : "shield-check";
    const fallback = data.crypto.encrypted && data.crypto.signed
      ? t("CRYPTO.BOTH", "Diese Mail ist verschlüsselt und signiert.")
      : data.crypto.encrypted
        ? t("CRYPTO.ENCRYPTED", "Diese Mail ist verschlüsselt.")
        : data.crypto.signed
          ? t("CRYPTO.SIGNED", "Diese Mail ist signiert.")
          : t("CRYPTO.AUTOCRYPT", "Der Absender legt einen Schlüssel bei.");
    if (actions || data.crypto.state !== "ok") bars.push(bar("crypto", mark, data.crypto.text || fallback, actions));
  }

  const cal = data.calendar ? `
    <section class="cal-card" aria-label="${esc(t("MESSAGE.CALENDAR_EVENT", "Termin"))}">
      ${icon("calendar", t("MESSAGE.CALENDAR_EVENT", "Termin"))}
      <div class="grow">
        <p class="cal-title">${esc(data.calendar.summary || t("MESSAGE.CALENDAR_EVENT", "Termin"))}</p>
        <p class="quiet">${esc([data.calendar.start, data.calendar.end].filter(Boolean).join(" – "))}</p>
        ${data.calendar.location ? `<p class="quiet">${esc(data.calendar.location)}</p>` : ""}
        ${data.calendar.organizer ? `<p class="quiet">${esc(t("MESSAGE.CALENDAR_ORGANIZER", "Organisiert von %NAME%").replace("%NAME%", data.calendar.organizer))}</p>` : ""}
      </div>
    </section>` : "";

  const files = data.files.length ? `
    <section class="files" aria-label="${esc(t("MESSAGE.PRINT_LABEL_ATTACHMENTS", "Anhänge"))}">
      <div class="files-head"><span class="mono">${data.files.length === 1 ? t("MESSAGE.ATTACHMENT_ONE", "1 Anhang") : t("MESSAGE.ATTACHMENTS_COUNT", "%COUNT% Anhänge").replace("%COUNT%", String(data.files.length))}</span><span class="spacer"></span>
        ${data.files.length > 4 ? `<button type="button" class="text-btn files-toggle" data-action="m-files-toggle" data-count="${data.files.length}" aria-expanded="${showAllFiles ? "true" : "false"}" aria-controls="reader-files">${icon(showAllFiles ? "chevron-up" : "chevron-down")}<span class="btn-label">${esc(showAllFiles ? t("MESSAGE.ATTACHMENTS_SHOW_LESS", "Weniger Anhänge anzeigen") : t("MESSAGE.ATTACHMENTS_SHOW_ALL", "Alle %COUNT% Anhänge anzeigen").replace("%COUNT%", String(data.files.length)))}</span></button>` : ""}
        ${data.zip && data.files.length > 1 ? `<button type="button" class="text-btn" data-action="m-zip">${icon("download-zip")}<span class="btn-label">${esc(t("MESSAGE.ALL_AS_ZIP", "Alle als ZIP"))}</span></button>` : ""}
      </div>
      <ul class="file-list${data.simpleFiles ? " simple" : ""}" id="reader-files">
        ${data.files.map((file, fileIndex) => `
          <li class="file${fileIndex >= 4 ? " file-overflow" : ""}"${fileIndex >= 4 && !showAllFiles ? " hidden" : ""}>
            ${file.thumb && !data.simpleFiles
              ? `<button type="button" class="file-thumb" data-action="m-preview" data-index="${file.index}" aria-label="${esc(t("MESSAGE.ATTACHMENT_VIEW", "%NAME% ansehen").replace("%NAME%", file.name))}"><img src="${esc(file.thumb)}" alt="" loading="lazy"></button>`
              : `<span class="file-icon">${icon(FILE_ICON[file.kind])}</span>`}
            <span class="file-meta">
              ${file.kind === "image" || file.kind === "pdf" || file.kind === "text"
                ? `<button type="button" class="file-name" data-action="m-preview" data-index="${file.index}" title="${esc(file.name)}">${esc(file.name)}</button>`
                : `<span class="file-name" title="${esc(file.name)}">${esc(file.name)}</span>`}
              <span class="quiet">${esc(file.size)}</span>
            </span>
            <a class="icon-btn" href="${esc(file.href)}" download="${esc(file.name)}" aria-label="${esc(file.name)} ${esc(t("GLOBAL.DOWNLOAD", "laden"))}" title="${esc(t("GLOBAL.DOWNLOAD", "Laden"))}">${icon("download")}</a>
          </li>`).join("")}
      </ul>
    </section>` : "";

  body.innerHTML = `
    <div class="read-measure">
    <header class="letter-head">
      <h2 class="title">${data.flagged ? `<span class="flag-mark">${icon("flag-filled", t("SEARCH.FLAGGED", "Markiert"))}</span>` : ""}${esc(data.subject || t("MESSAGE.NO_SUBJECT", "(ohne Betreff)"))}</h2>
      ${summary}
      <div class="head-details-slot" id="reader-details"></div>
      ${tags ? `<div class="tags">${tags}</div>` : ""}
    </header>
    ${bars.length ? `<div class="reader-notices" aria-label="${esc(t("MESSAGE.NOTICES", "Hinweise zu dieser Mail"))}">${bars.join("")}</div>` : ""}
    ${cal}
    ${files}
    </div>`;
  paintReaderDetails(body, data, expanded);
  const frame = document.createElement("iframe");
  frame.className = "letter";
  // Ohne Skripte im Brief darf der Leser die Dokumenthöhe auslesen. So scrollt
  // die Mail mit dem äußeren Leserbereich statt in einem abgeschnittenen iframe.
  frame.setAttribute("sandbox", "allow-same-origin allow-popups allow-popups-to-escape-sandbox");
  frame.referrerPolicy = "no-referrer";
  frame.title = t("MESSAGE.LETTER_FRAME", "Brief: %SUBJECT%").replace("%SUBJECT%", data.subject || t("MESSAGE.NO_SUBJECT", "(ohne Betreff)"));
  const fit = () => {
    const doc = frame.contentDocument;
    if (!doc) return;
    const height = Math.max(doc.documentElement?.scrollHeight ?? 0, doc.body?.scrollHeight ?? 0);
    if (height) frame.style.height = `${Math.max(240, Math.ceil(height))}px`;
  };
  frame.addEventListener("load", () => {
    fit();
    const doc = frame.contentDocument;
    if (!doc) return;
    const observer = new ResizeObserver(fit);
    if (doc.documentElement) observer.observe(doc.documentElement);
    if (doc.body) observer.observe(doc.body);
    void doc.fonts?.ready.then(fit);
  });
  frame.srcdoc = data.srcdoc;
  body.querySelector(".read-measure")?.append(frame);
}

function withAssist(label: string): string {
  return `${icon("assist")}<span class="btn-label">${esc(label)}</span><span class="ai-tag" aria-hidden="true">KI</span>`;
}

export function renderBulk(body: HTMLElement, data: BulkData): void {
  const b = (action: string, name: IconName, label: string, danger = false) =>
    `<button type="button" class="${danger ? "danger" : "text-btn"} bulk-btn" data-action="${action}">${icon(name)}<span class="btn-label">${esc(label)}</span></button>`;

  const countText = data.count === 1
    ? t("MESSAGE_LIST.ONE_MAIL_SELECTED", "1 Mail ausgewählt")
    : t("MESSAGE_LIST.PLURAL_MAILS_SELECTED", "%COUNT% Mails ausgewählt").replace("%COUNT%", String(data.count));

  const badges: string[] = [];
  if (data.folderName) {
    badges.push(`<span class="chip chip-static">${icon("folder")}<span>${esc(data.folderName)}</span></span>`);
  }
  if (data.unseenCount) {
    badges.push(`<span class="chip chip-static">${icon("mark-unread")}<span>${data.unseenCount === 1 ? t("MESSAGE.ONE_UNREAD", "1 ungelesen") : `${data.unseenCount} ungelesen`}</span></span>`);
  }
  if (data.flaggedCount) {
    badges.push(`<span class="chip chip-static">${icon("flag-filled")}<span>${data.flaggedCount === 1 ? t("MESSAGE.ONE_FLAGGED", "1 markiert") : `${data.flaggedCount} markiert`}</span></span>`);
  }

  const bulkList = (title: string, items?: string[]): string => items?.length ? `
      <span class="mono quiet">${esc(title)}</span>
      <ul class="bulk-summary-points">${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>` : "";

  const aiStatus = (data.assist && (data.assist.loadingSummary || data.assist.loadingReplies || data.assist.error)) ? `
    <div class="bulk-ai-status ${data.assist.error ? "error" : "quiet"}" role="${data.assist.error ? "alert" : "status"}">
      ${icon(data.assist.error ? "error" : "loading")}
      <span>${esc(data.assist.error || data.assist.loadingSummary || data.assist.loadingReplies || "")}</span>
    </div>` : "";

  const aiSummary = data.assist?.summary ? `
    <section class="bulk-ai-card bulk-ai-summary" aria-label="${esc(t("AI_COPILOT.BULK_SUMMARY_TITLE", "Zusammenfassung der ausgewählten Mails"))}">
      <div class="bulk-ai-head">
        <span class="mono quiet">${withAssist(t("AI_COPILOT.BULK_SUMMARY_TITLE", "Zusammenfassung aller ausgewählten Mails"))}</span>
        <span class="quiet">(${data.assist.summary.shown && data.assist.summary.shown < data.count ? `${data.assist.summary.shown} / ${data.count}` : data.count} Mails)</span>
      </div>
      <p class="bulk-summary-tldr">${esc(data.assist.summary.tldr)}</p>
      ${data.assist.summary.points && data.assist.summary.points.length ? `
        <ul class="bulk-summary-points">
          ${data.assist.summary.points.map((pt) => `<li>${esc(pt)}</li>`).join("")}
        </ul>` : ""}
      ${bulkList(t("AI_COPILOT.DECISIONS", "Entscheidungen"), data.assist.summary.decisions)}
      ${bulkList(t("AI_COPILOT.TASKS", "Aufgaben"), data.assist.summary.actions)}
      ${bulkList(t("AI_COPILOT.NEXT_STEP", "Nächster Schritt"), data.assist.summary.next ? [data.assist.summary.next] : [])}
      <div class="bulk-summary-meta">
        <button type="button" class="text-btn ai-action text-btn-sm" data-action="m-bulk-summarize" data-force="1">
          ${withAssist(t("AI_COPILOT.REGENERATE", "Mit KI neu erzeugen"))}
        </button>
        ${data.assist.summary.cached ? `<span class="quiet text-xs">${esc(t("AI_COPILOT.CACHED", "Aus dem Zwischenspeicher"))}</span>` : ""}
      </div>
      <p class="quiet assist-caveat">${esc(t("AI_COPILOT.SUMMARY_CAVEAT", "Bitte mit den Mails abgleichen: Zusammenfassungen können Angaben falsch interpretieren."))}</p>
    </section>` : "";

  const aiReplies = (data.assist?.repliesList && data.assist.repliesList.length) ? `
    <section class="bulk-ai-card bulk-ai-replies" aria-label="${esc(t("AI_COPILOT.BULK_REPLIES_TITLE", "Antwortvorschläge für ausgewählte Mails"))}">
      <div class="bulk-ai-head">
        <span class="mono quiet">${withAssist(t("AI_COPILOT.BULK_REPLIES_TITLE", "Antwortvorschläge für ausgewählte Mails"))}</span>
        <p class="quiet">${esc(t("AI_COPILOT.BULK_REPLIES_SUBTITLE", "Vorschlag auswählen, um eine Antwort auf die jeweilige Mail zu verfassen:"))}</p>
        ${data.assist.repliesNote ? `<p class="quiet">${esc(data.assist.repliesNote)}</p>` : ""}
      </div>
      <div class="bulk-replies-list">
        ${data.assist.repliesList.map((item) => `
          <div class="bulk-reply-row">
            <div class="bulk-reply-mail-head">
              <span class="bulk-reply-icon">${icon("reply")}</span>
              <strong class="bulk-reply-title">${esc(item.subject || "(ohne Betreff)")}</strong>
              <span class="bulk-reply-sender quiet">${esc(item.who)}</span>
            </div>
            <div class="prompts reply-prompts">
              ${item.replies.length ? item.replies.map((reply, rIndex) => `
                <button type="button" class="prompt reply-chip" data-action="m-use-bulk-reply" data-uid="${item.uid}" data-index="${rIndex}" title="${esc(reply.body)}">
                  ${esc(reply.label || "Antwort")}
                </button>
              `).join("") : `<span class="quiet">${esc(t("AI_COPILOT.NO_REPLIES_FOR_MAIL", "Keine Vorschläge für diese Mail."))}`}
            </div>
          </div>
        `).join("")}
      </div>
    </section>` : "";

  const previewList = (data.messages && data.messages.length) ? `
    <section class="bulk-preview" aria-label="${esc(t("BULK.PREVIEW_TITLE", "Ausgewählte Nachrichten"))}">
      <div class="bulk-preview-head">
        <h3 class="mono">${esc(t("BULK.PREVIEW_TITLE", "Ausgewählte Nachrichten"))} <span class="quiet">(${data.messages.length})</span></h3>
      </div>
      <ul class="bulk-msg-list">
        ${data.messages.map((msg) => `
          <li class="bulk-msg-item">
            <span class="bulk-msg-status" aria-hidden="true">${msg.unseen ? '<span class="unread-mark"></span>' : ""}${msg.flagged ? icon("flag-filled") : ""}</span>
            <div class="bulk-msg-meta">
              <span class="bulk-msg-who">${esc(msg.who || "(unbekannt)")}</span>
              <span class="bulk-msg-subj">${esc(msg.subject || "(ohne Betreff)")}</span>
            </div>
            <time class="bulk-msg-when quiet">${esc(msg.when)}</time>
            <button type="button" class="icon-btn bulk-msg-remove" data-action="m-check" data-ref="${msg.uid}" aria-label="${esc(t("BULK.DESELECT_MAIL", "Aus Auswahl entfernen: %SUBJ%").replace("%SUBJ%", msg.subject || ""))}" title="${esc(t("BULK.DESELECT", "Aus Auswahl entfernen"))}">${icon("close")}</button>
          </li>
        `).join("")}
      </ul>
    </section>` : "";

  body.innerHTML = `
    <div class="bulk read-measure">
      <header class="bulk-head">
        <div class="bulk-title-row">
          <div class="bulk-title-wrap">
            <h2 class="title title-md">${esc(countText)}</h2>
            ${badges.length ? `<div class="bulk-badges">${badges.join("")}</div>` : ""}
          </div>
          <button type="button" class="text-btn bulk-clear-btn" data-action="m-clear-selection" title="${esc(t("MESSAGE_LIST.BUTTON_CLEAR_SELECTION", "Auswahl aufheben"))} (Esc)">
            ${icon("close")}
            <span class="btn-label">${esc(t("MESSAGE_LIST.BUTTON_CLEAR_SELECTION", "Auswahl aufheben"))}</span>
          </button>
        </div>
      </header>

      <div class="bulk-bento">
        <div class="bulk-card">
          <h3 class="bulk-card-title mono">${esc(t("BULK.STATUS_TITLE", "Status & Markierung"))}</h3>
          <div class="bulk-btn-group">
            ${b("m-read", "mark-read", t("MESSAGE_LIST.BUTTON_MARK_AS_READ", "Als gelesen markieren"))}
            ${b("m-unread-all", "mark-unread", t("MESSAGE_LIST.BUTTON_MARK_AS_UNREAD", "Als ungelesen markieren"))}
            ${b("m-flag-all", "flag-filled", t("MESSAGE_LIST.FLAG_SET", "Markieren"))}
            ${b("m-unflag-all", "flag", t("MESSAGE_LIST.FLAG_REMOVE", "Markierung entfernen"))}
          </div>
        </div>

        <div class="bulk-card">
          <h3 class="bulk-card-title mono">${esc(t("BULK.ORGANIZE_TITLE", "Ablage & Ordnung"))}</h3>
          <div class="bulk-btn-group">
            ${b("m-move", "move", t("MESSAGE_LIST.BUTTON_MOVE", "In Ordner verschieben …"))}
            ${b("m-copy", "copy", t("MESSAGE_LIST.BUTTON_COPY", "In Ordner kopieren …"))}
            ${data.place.archive ? b("m-archive", "archive", t("GLOBAL.TO_ARCHIVE", "Archivieren")) : ""}
            ${data.place.inSpam ? b("m-notspam", "not-spam", t("MESSAGE.BUTTON_NOT_SPAM", "Kein Spam")) : data.place.spam ? b("m-spam", "spam", t("MESSAGE.BUTTON_SPAM", "Spam")) : ""}
          </div>
        </div>

        <div class="bulk-card">
          <h3 class="bulk-card-title mono">${esc(t("BULK.EXPORT_TITLE", "Weiterleiten & Export"))}</h3>
          <div class="bulk-btn-group">
            ${b("m-forward-att", "forward-attachment", t("COMPOSE.TITLE_FORWARD_ATTACHMENT", "Als Anhang weiterleiten"))}
            ${data.zip ? b("m-zip-mails", "download-zip", t("MESSAGE_LIST.BUTTON_DOWNLOAD_ZIP", "Als ZIP laden")) : ""}
          </div>
        </div>

        ${(data.assist && (data.assist.summarize || data.assist.replies)) ? `
          <div class="bulk-card bulk-card--ai">
            <h3 class="bulk-card-title mono">${withAssist(t("AI_COPILOT.CARD_TITLE", "KI-Unterstützung"))}</h3>
            <div class="bulk-btn-group">
              ${data.assist.summarize ? `<button type="button" class="text-btn bulk-btn ai-action" data-action="m-bulk-summarize" title="${esc(t("AI_COPILOT.BULK_SUMMARIZE_HINT", "Alle ausgewählten Mails mit KI zusammenfassen"))}">${withAssist(t("AI_COPILOT.BULK_SUMMARIZE", "Auswahl zusammenfassen"))}</button>` : ""}
              ${data.assist.replies ? `<button type="button" class="text-btn bulk-btn ai-action" data-action="m-bulk-replies" title="${esc(t("AI_COPILOT.BULK_REPLIES_HINT", "Antwortvorschläge für jede ausgewählte Mail erstellen"))}">${withAssist(t("AI_COPILOT.BULK_REPLIES", "Antworten für alle vorschlagen"))}</button>` : ""}
            </div>
          </div>` : ""}

        <div class="bulk-card bulk-card--danger">
          <h3 class="bulk-card-title mono">${esc(t("BULK.DANGER_TITLE", "Löschen"))}</h3>
          <div class="bulk-btn-group">
            ${b("delete", "delete", data.place.inTrash ? t("MESSAGE.CONFIRM_DELETE", "Endgültig löschen") : t("GLOBAL.DELETE", "In den Papierkorb verschieben"), true)}
            ${data.place.inTrash ? "" : b("m-delete-forever", "delete-forever", t("MESSAGE.CONFIRM_DELETE", "Endgültig löschen"), true)}
          </div>
        </div>
      </div>

      ${aiStatus}
      ${aiSummary}
      ${aiReplies}

      ${previewList}
    </div>`;
}
