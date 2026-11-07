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

export interface BulkData {
  count: number;
  place: ReaderPlace;
  zip: boolean;
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

export function renderReader(body: HTMLElement, data: ReaderData, expanded: boolean): void {
  const tags = data.keywords.map((tag) =>
    `<span class="tag">${icon("tag")}<span>${esc(tag)}</span><button type="button" class="tag-x" data-action="m-untag" data-tag="${esc(tag)}" aria-label="Schlagwort ${esc(tag)} entfernen">${icon("close")}</button></span>`
  ).join("");
  const secBadge = data.crypto && (data.crypto.signed || data.crypto.encrypted)
    ? `<span class="badge-sec ${data.crypto.state === "bad" ? "badge-sec--bad" : "badge-sec--ok"}" title="${esc(data.crypto.text || (data.crypto.state === "bad" ? "Signatur ungültig" : "Kryptografisch verifiziert"))}">${icon(data.crypto.state === "bad" ? "shield-alert" : "shield-check")}<span>${esc(data.crypto.state === "bad" ? "Ungültig" : "Verifiziert")}</span></span>`
    : "";
  const from = data.from[0];
  const summary = `
    <div class="head-line head-main">
      <span class="head-val">${from ? person(from) : '<span class="quiet">(unbekannt)</span>'}</span>
      <span class="spacer"></span>
      ${secBadge}
      <time class="quiet" title="${esc(data.whenFull)}">${esc(data.when)}</time>
      <button type="button" class="icon-btn" data-action="m-details" aria-expanded="${expanded ? "true" : "false"}" aria-label="${expanded ? "Details ausblenden" : "Details anzeigen"}" title="Details">${icon(expanded ? "chevron-up" : "chevron-down")}</button>
    </div>`;
  const details = expanded ? `
    <div class="head-details">
      ${line("Von", data.from)}
      ${line("An", data.to)}
      ${line("Cc", data.cc)}
      ${line("Bcc", data.bcc)}
      ${line("Antwort an", data.replyTo)}
      <div class="head-line"><span class="head-key mono">Datum</span><span class="head-val">${esc(data.whenFull)}</span></div>
      ${data.crypto ? `<div class="head-line"><span class="head-key mono">Sicherheit</span><span class="head-val">${secBadge || `<span class="quiet">Standard</span>`}</span></div>` : ""}
      ${data.size ? `<div class="head-line"><span class="head-key mono">Größe</span><span class="head-val">${esc(data.size)}</span></div>` : ""}
    </div>` : (data.to.length ? `<div class="head-line quiet"><span class="head-key mono">An</span><span class="head-val">${people(data.to.slice(0, 3))}${data.to.length + data.cc.length > 3 ? ` <span class="quiet">+${data.to.length + data.cc.length - 3}</span>` : ""}</span></div>` : "");

  const bars: string[] = [];
  if (data.deleted) bars.push(bar("deleted", "trash", "Als gelöscht markiert.", textButton("m-restore", "Wiederherstellen")));
  if (data.spam) bars.push(bar("spam", "spam", data.spam, ""));
  if (data.blocked) {
    bars.push(bar("images", "image-blocked",
      data.blocked === 1 ? "Ein externes Bild wurde blockiert." : `${data.blocked} externe Bilder wurden blockiert.`,
      textButton("m-images", "Anzeigen") + (from ? textButton("m-images-always", "Immer für diesen Absender") : "")));
  }
  if (data.failed) {
    bars.push(bar("images", "image-blocked",
      data.failed === 1 ? "Ein externes Bild ist nicht erreichbar." : `${data.failed} externe Bilder sind nicht erreichbar.`, ""));
  }
  if (data.tracking) {
    bars.push(bar("tracking", "shield-check",
      data.originalLinks ? "Links zeigen auf die Originaladressen mit Tracking." : "Tracking in Links und Bildern wurde entfernt.",
      textButton("m-links", data.originalLinks ? "Bereinigte Links" : "Originallinks")));
  }
  if (data.receipt) {
    bars.push(bar("receipt", "receipt", `Der Absender bittet um eine Lesebestätigung an ${data.receipt}.`,
      textButton("m-receipt", "Bestätigung senden") + textButton("m-receipt-skip", "Nicht senden")));
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
    bars.push(bar("crypto", mark, data.crypto.text || fallback, actions));
  }

  const cal = data.calendar ? `
    <section class="cal-card" aria-label="Termin">
      ${icon("calendar", "Termin")}
      <div class="grow">
        <p class="cal-title">${esc(data.calendar.summary || "Termin")}</p>
        <p class="quiet">${esc([data.calendar.start, data.calendar.end].filter(Boolean).join(" – "))}</p>
        ${data.calendar.location ? `<p class="quiet">${esc(data.calendar.location)}</p>` : ""}
        ${data.calendar.organizer ? `<p class="quiet">Organisiert von ${esc(data.calendar.organizer)}</p>` : ""}
      </div>
    </section>` : "";

  const files = data.files.length ? `
    <section class="files" aria-label="Anhänge">
      <div class="files-head"><span class="mono">${data.files.length === 1 ? "1 Anhang" : `${data.files.length} Anhänge`}</span><span class="spacer"></span>
        ${data.zip && data.files.length > 1 ? `<button type="button" class="text-btn" data-action="m-zip">${icon("download-zip")}<span class="btn-label">Alle als ZIP</span></button>` : ""}
      </div>
      <ul class="file-list${data.simpleFiles ? " simple" : ""}">
        ${data.files.map((file) => `
          <li class="file">
            ${file.thumb && !data.simpleFiles
              ? `<button type="button" class="file-thumb" data-action="m-preview" data-index="${file.index}" aria-label="${esc(file.name)} ansehen"><img src="${esc(file.thumb)}" alt="" loading="lazy"></button>`
              : `<span class="file-icon">${icon(FILE_ICON[file.kind])}</span>`}
            <span class="file-meta">
              ${file.kind === "image" || file.kind === "pdf" || file.kind === "text"
                ? `<button type="button" class="file-name" data-action="m-preview" data-index="${file.index}" title="${esc(file.name)}">${esc(file.name)}</button>`
                : `<span class="file-name" title="${esc(file.name)}">${esc(file.name)}</span>`}
              <span class="quiet">${esc(file.size)}</span>
            </span>
            <a class="icon-btn" href="${esc(file.href)}" download="${esc(file.name)}" aria-label="${esc(file.name)} laden" title="Laden">${icon("download")}</a>
          </li>`).join("")}
      </ul>
    </section>` : "";

  body.innerHTML = `
    <div class="read-measure">
    <header class="letter-head">
      <h2 class="title">${data.flagged ? `<span class="flag-mark">${icon("flag-filled", "Markiert")}</span>` : ""}${esc(data.subject || "(ohne Betreff)")}</h2>
      ${summary}
      ${details}
      <div class="tags">${tags}<button type="button" class="text-btn tag-add" data-action="m-tag">${icon("plus")}<span class="btn-label">Schlagwort</span></button></div>
    </header>
    ${bars.join("")}
    ${cal}
    ${files}
    </div>`;
  const frame = document.createElement("iframe");
  frame.className = "letter";
  // Ohne Skripte im Brief darf der Leser die Dokumenthöhe auslesen. So scrollt
  // die Mail mit dem äußeren Leserbereich statt in einem abgeschnittenen iframe.
  frame.setAttribute("sandbox", "allow-same-origin allow-popups allow-popups-to-escape-sandbox");
  frame.referrerPolicy = "no-referrer";
  frame.title = "Brief";
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

export function renderBulk(body: HTMLElement, data: BulkData): void {
  const b = (action: string, name: IconName, label: string, danger = false) =>
    `<button type="button" class="${danger ? "danger" : "text-btn"} bulk-btn" data-action="${action}">${icon(name)}<span class="btn-label">${esc(label)}</span></button>`;
  body.innerHTML = `
    <div class="bulk">
      <p class="title title-md">${data.count} Mails ausgewählt</p>
      <div class="bulk-grid">
        ${b("m-read", "mark-read", "Als gelesen markieren")}
        ${b("m-unread-all", "mark-unread", "Als ungelesen markieren")}
        ${b("m-flag-all", "flag-filled", "Markieren")}
        ${b("m-unflag-all", "flag", "Markierung entfernen")}
        ${b("m-move", "move", "Verschieben …")}
        ${b("m-copy", "copy", "Kopieren …")}
        ${data.place.archive ? b("m-archive", "archive", "Archivieren") : ""}
        ${data.place.inSpam ? b("m-notspam", "not-spam", "Kein Spam") : data.place.spam ? b("m-spam", "spam", "Spam") : ""}
        ${b("m-forward-att", "forward-attachment", "Als Anhang weiterleiten")}
        ${data.zip ? b("m-zip-mails", "download-zip", "Als ZIP laden") : ""}
        ${b("delete", "delete", data.place.inTrash ? "Endgültig löschen" : "Löschen", true)}
        ${data.place.inTrash ? "" : b("m-delete-forever", "delete-forever", "Endgültig löschen", true)}
      </div>
      <button type="button" class="text-btn" data-action="m-clear-selection">${icon("close")}<span class="btn-label">Auswahl aufheben</span></button>
    </div>`;
}
