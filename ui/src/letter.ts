// Der Brief im sandboxed iframe: srcdoc mit CSP, Druckfenster, Kalendereinträge, Abmelde-Links.

export interface LetterLook {
  dark: boolean;
  swap: boolean;
  removeColors: boolean;
  /** Direkte externe Adressen erlaubt (ohne Server-Proxy). */
  remote: boolean;
}

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c] ?? c));
}

/**
 * HTML-Mails stehen auf hellem Papier, wie der Absender sie gestaltet hat. Im Dunkelmodus nur dann dunkel,
 * wenn „Farben entfernen“ an ist oder der Nutzer „Farben umkehren“ wählt.
 * Text-Mails folgen immer dem Erscheinungsbild.
 */
export function srcdoc(body: string, kind: "html" | "plain", look: LetterLook): string {
  const img = look.remote ? "data: https: http:" : "data:";
  const csp = `default-src 'none'; img-src ${img}; style-src 'unsafe-inline'; font-src data:; media-src 'none'; form-action 'none'`;
  const followScheme = kind === "plain" || look.removeColors;
  const scheme = followScheme ? (look.dark ? "dark" : "light") : "light";
  const paper = followScheme ? "background:Canvas;color:CanvasText" : "background:#fff;color:#1c1917";
  const swap = look.swap
    ? "html{filter:invert(1) hue-rotate(180deg)}img,[style*='background-image']{filter:invert(1) hue-rotate(180deg)}"
    : "";
  const base = [
    `html{color-scheme:${scheme}}`,
    `body{margin:0;padding:16px;${paper};font:15px/1.5 Inter,ui-sans-serif,system-ui,sans-serif;overflow-wrap:anywhere}`,
    kind === "plain" ? "body{white-space:pre-wrap}" : "",
    "img{max-width:100%;height:auto}",
    "table{max-width:100%}",
    "a{color:inherit}",
    "a[href]{text-decoration:underline;text-underline-offset:2px}",
    "pre{white-space:pre-wrap}",
    "blockquote{margin:8px 0;padding-left:12px;border-left:2px solid color-mix(in srgb,currentColor 25%,transparent)}",
    "details.sm-bq>summary{cursor:pointer;list-style:none;display:inline-block;padding:0 6px;border-radius:4px;font:12px/18px ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase;opacity:.7;background:color-mix(in srgb,currentColor 10%,transparent)}",
    "details.sm-bq>summary::-webkit-details-marker{display:none}",
    swap
  ].join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><meta name="color-scheme" content="${scheme}"><base target="_blank"><style>${base}</style></head><body>${body}</body></html>`;
}

export interface PrintData {
  subject: string;
  from: string;
  to: string;
  cc: string;
  when: string;
  body: string;
  kind: "html" | "plain";
  attachments: { name: string; href: string }[];
}

/** Brief in einem eigenen Fenster öffnen, optional direkt drucken. */
export function openLetterWindow(data: PrintData, print: boolean): boolean {
  const win = window.open("", "_blank");
  if (!win) return false;
  const files = data.attachments.length
    ? `<p class="files">${data.attachments.map((file) => `<a href="${esc(file.href)}">${esc(file.name)}</a>`).join(" · ")}</p>`
    : "";
  const content = data.kind === "plain" ? `<div style="white-space:pre-wrap">${data.body}</div>` : data.body;
  win.document.open();
  win.document.write(`<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${esc(data.subject || "Mail")}</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'">
<style>
  body{margin:24px;font:14px/1.5 Inter,ui-sans-serif,system-ui,sans-serif;color:#1c1917;background:#fff}
  header{border-bottom:1px solid #27272a33;padding-bottom:12px;margin-bottom:16px}
  h1{font-size:20px;margin:0 0 8px}
  header p{margin:2px 0;color:color-mix(in srgb,#1c1917 68%,transparent)}
  .files{margin-top:16px;border-top:1px solid #27272a33;padding-top:8px}
  img{max-width:100%;height:auto}
  details.sm-bq>summary{display:none}
  details.sm-bq{display:block}
  @media print{body{margin:0}a{color:inherit}}
</style></head><body>
<header><h1>${esc(data.subject || "(ohne Betreff)")}</h1>
<p>Von: ${esc(data.from)}</p><p>An: ${esc(data.to)}</p>${data.cc ? `<p>Cc: ${esc(data.cc)}</p>` : ""}<p>${esc(data.when)}</p></header>
${content}${files}
</body></html>`);
  win.document.close();
  win.document.querySelectorAll("details").forEach((node) => node.setAttribute("open", ""));
  if (print) setTimeout(() => { win.focus(); win.print(); }, 150);
  return true;
}

export interface CalendarEvent {
  summary: string;
  start: string;
  end: string;
  location: string;
  organizer: string;
  method: string;
}

function icsDate(value: string): string {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/);
  if (!m) return value;
  if (!m[4]) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "long", year: "numeric" });
  }
  const args = [Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] || 0)] as const;
  const date = m[7] ? new Date(Date.UTC(...args)) : new Date(...args);
  return date.toLocaleString("de-DE", { weekday: "short", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Einfache Auswertung von text/calendar: erste VEVENT. */
export function parseIcs(text: string): CalendarEvent | null {
  const lines = text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const event: CalendarEvent = { summary: "", start: "", end: "", location: "", organizer: "", method: "" };
  let inside = false;
  let found = false;
  const unescape = (value: string) => value.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
  for (const line of lines) {
    const index = line.indexOf(":");
    if (index < 0) continue;
    const key = line.slice(0, index).split(";")[0].toUpperCase();
    const value = line.slice(index + 1);
    if (key === "METHOD") event.method = value.trim();
    if (key === "BEGIN" && value.trim() === "VEVENT") { inside = true; found = true; continue; }
    if (key === "END" && value.trim() === "VEVENT") break;
    if (!inside) continue;
    if (key === "SUMMARY") event.summary = unescape(value);
    if (key === "DTSTART") event.start = icsDate(value.trim());
    if (key === "DTEND") event.end = icsDate(value.trim());
    if (key === "LOCATION") event.location = unescape(value);
    if (key === "ORGANIZER") event.organizer = (line.match(/CN=([^;:]+)/i)?.[1] || value.replace(/^mailto:/i, "")).replace(/^"|"$/g, "");
  }
  return found ? event : null;
}

export interface Unsubscribe {
  mailto: string;
  http: string;
  oneClick: boolean;
}

/** List-Unsubscribe auswerten (RFC 2369, RFC 8058). */
export function parseUnsubscribe(header: string, post: string): Unsubscribe | null {
  if (!header) return null;
  const links = [...header.matchAll(/<([^>]+)>/g)].map((m) => m[1].trim());
  const mailto = links.find((link) => /^mailto:/i.test(link)) || "";
  const http = links.find((link) => /^https:/i.test(link)) || links.find((link) => /^http:/i.test(link)) || "";
  if (!mailto && !http) return null;
  return { mailto, http, oneClick: Boolean(http) && /List-Unsubscribe=One-Click/i.test(post) };
}

/** mailto:-Adresse in Empfänger, Betreff und Text zerlegen. */
export function parseMailto(link: string): { to: string; subject: string; body: string } {
  const [address, query = ""] = link.replace(/^mailto:/i, "").split("?");
  const params = new URLSearchParams(query);
  return {
    to: decodeURIComponent(address || ""),
    subject: params.get("subject") || "",
    body: params.get("body") || ""
  };
}
