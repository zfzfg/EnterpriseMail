import { icon } from "./icons";
import { t } from "./i18n";

/**
 * Erweiterte Suche im Format von `AdvancedSearch.js`: `from=…&to=…&since=…&attachment&unseen`.
 * Der Server liest das mit `parse_str` (`MailSo/Imap/SearchCriterias.php`, `parseQueryString`).
 */
export interface SearchCriteria {
  from: string;
  to: string;
  subject: string;
  text: string;
  keyword: string;
  since: string;
  until: string;
  period: string;
  larger: string;
  smaller: string;
  attachment: boolean;
  unseen: boolean;
  flagged: boolean;
  replied: "" | "yes" | "no";
  subtree: "" | "subtree" | "subtree-one";
}

export type QuickFlag = "unseen" | "flagged" | "attachment";
export const QUICK_FLAGS: QuickFlag[] = ["unseen", "flagged", "attachment"];

export const PERIODS: [string, string, string][] = [
  ["", "SEARCH.DATE_ALL", "Alle"],
  ["3", "SEARCH.SINCE_3_DAYS", "Nicht älter als 3 Tage"],
  ["7", "SEARCH.SINCE_7_DAYS", "Nicht älter als eine Woche"],
  ["30", "SEARCH.SINCE_MONTH", "Nicht älter als ein Monat"],
  ["90", "SEARCH.SINCE_3_MONTHS", "Nicht älter als 3 Monate"],
  ["180", "SEARCH.SINCE_6_MONTHS", "Nicht älter als 6 Monate"],
  ["365", "SEARCH.SINCE_YEAR", "Nicht älter als ein Jahr"],
  ["-3", "SEARCH.BEFORE_3_DAYS", "Älter als 3 Tage"],
  ["-7", "SEARCH.BEFORE_7_DAYS", "Älter als eine Woche"],
  ["-30", "SEARCH.BEFORE_MONTH", "Älter als ein Monat"],
  ["-90", "SEARCH.BEFORE_3_MONTHS", "Älter als 3 Monate"],
  ["-180", "SEARCH.BEFORE_6_MONTHS", "Älter als 6 Monate"],
  ["-365", "SEARCH.BEFORE_YEAR", "Älter als ein Jahr"]
];

const FLAG_KEYS = new Set(["attachment", "unseen", "flagged", "answered", "unanswered"]);
const VALUE_KEYS = ["from", "to", "subject", "text", "keyword", "since", "before", "larger", "smaller", "in"];

export function emptyCriteria(): SearchCriteria {
  return {
    from: "", to: "", subject: "", text: "", keyword: "", since: "", until: "", period: "", larger: "", smaller: "",
    attachment: false, unseen: false, flagged: false, replied: "", subtree: ""
  };
}

/** Nur die Zeichen kodieren, die `parse_str` sonst falsch trennt. Adressen bleiben lesbar. */
export function encodeValue(value: string): string {
  return value.replace(/[%&+=#]/g, (char) => encodeURIComponent(char));
}

function decodeValue(value: string): string {
  try { return decodeURIComponent(value.replace(/\+/g, " ")); } catch { return value; }
}

function isoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function shiftDay(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() + days);
  return isoDate(date);
}

/** Ist der Suchstring im Format `name=wert&…` bzw. besteht nur aus bekannten Merkern? */
export function isStructured(query: string): boolean {
  const parts = query.split("&").map((part) => part.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((part) => {
    const name = part.split("=")[0].toLowerCase();
    return part.includes("=") ? VALUE_KEYS.includes(name) || /^[a-z_[\]]+$/.test(name) : FLAG_KEYS.has(name);
  });
}

/** Suchstring in Formularwerte. Ein einfacher Text landet im Feld „Text“. */
export function parseSearch(query: string): SearchCriteria {
  const result = emptyCriteria();
  const trimmed = query.trim();
  if (!trimmed) return result;
  if (!isStructured(trimmed)) {
    result.text = trimmed;
    return result;
  }
  trimmed.split("&").forEach((part) => {
    if (!part) return;
    const at = part.indexOf("=");
    const name = (at < 0 ? part : part.slice(0, at)).toLowerCase();
    const value = at < 0 ? "" : decodeValue(part.slice(at + 1));
    switch (name) {
      case "from": case "to": case "subject": case "text": case "keyword": case "larger": case "smaller":
        result[name] = value;
        break;
      case "since": result.since = value; break;
      case "before": result.until = shiftDay(value, -1); break;
      case "in": result.subtree = value === "subtree" || value === "subtree-one" ? value : ""; break;
      case "attachment": result.attachment = true; break;
      case "unseen": result.unseen = true; break;
      case "flagged": result.flagged = true; break;
      case "answered": result.replied = "yes"; break;
      case "unanswered": result.replied = "no"; break;
      default: break;
    }
  });
  return result;
}

/** Formularwerte in den Suchstring. Ein Zeitraum ersetzt von/bis wie im alten Formular. */
export function serializeSearch(c: SearchCriteria, multisearch: boolean): string {
  const parts: string[] = [];
  const add = (name: string, value: string) => { if (value.trim()) parts.push(`${name}=${encodeValue(value.trim())}`); };
  add("from", c.from);
  add("to", c.to);
  add("subject", c.subject);
  add("text", c.text);
  add("keyword", c.keyword);
  if (multisearch && c.subtree) parts.push(`in=${c.subtree}`);
  const days = Number(c.period || 0);
  if (days > 0) {
    add("since", shiftDay(isoDate(new Date()), -days));
  } else if (days < 0) {
    add("before", shiftDay(isoDate(new Date()), days));
  } else {
    add("since", c.since);
    // „bis“ ist einschließlich, IMAP BEFORE nicht: einen Tag dazurechnen.
    if (c.until) add("before", shiftDay(c.until, 1));
  }
  add("larger", c.larger.replace(/\s+/g, "").toUpperCase());
  add("smaller", c.smaller.replace(/\s+/g, "").toUpperCase());
  if (c.attachment) parts.push("attachment");
  if (c.unseen) parts.push("unseen");
  if (c.flagged) parts.push("flagged");
  if (c.replied === "yes") parts.push("answered");
  if (c.replied === "no") parts.push("unanswered");
  return parts.join("&");
}

export function activeQuick(query: string): Set<QuickFlag> {
  const c = parseSearch(query);
  return new Set(QUICK_FLAGS.filter((flag) => c[flag]));
}

/** Schnellfilter ein- oder ausschalten, ohne die übrigen Bedingungen zu verlieren. */
export function toggleQuick(query: string, flag: QuickFlag, multisearch: boolean): string {
  const c = parseSearch(query);
  c[flag] = !c[flag];
  return serializeSearch(c, multisearch);
}

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  }[char] ?? char));
}

function sizeParts(value: string): [string, string] {
  const match = /^(\d+(?:[.,]\d+)?)\s*([KM]?)$/i.exec(value.trim());
  return match ? [match[1], (match[2] || "K").toUpperCase()] : ["", "K"];
}

function sizeField(name: "larger" | "smaller", label: string, value: string): string {
  const [num, unit] = sizeParts(value);
  return `<div class="field size-field"><span>${esc(label)}</span><div class="size-row">
    <input name="${name}" type="number" min="0" step="1" inputmode="numeric" value="${esc(num)}" aria-label="${esc(label)}">
    <select name="${name}Unit" aria-label="${esc(t("SEARCH_UI.UNIT", "Einheit"))}"><option value="K"${unit === "K" ? " selected" : ""}>KB</option><option value="M"${unit === "M" ? " selected" : ""}>MB</option></select>
  </div></div>`;
}

function input(name: string, label: string, value: string, type = "text", extra = ""): string {
  return `<label class="field"><span>${esc(label)}</span><input name="${name}" type="${type}" value="${esc(value)}" autocomplete="off" ${extra}></label>`;
}

function choice(name: string, label: string, on: boolean): string {
  return `<label class="check"><input type="checkbox" name="${name}"${on ? " checked" : ""}> ${esc(label)}</label>`;
}

/** Formularinhalt des Dialogs „Erweiterte Suche“. */
export function renderSearchForm(c: SearchCriteria, options: { multisearch: boolean; keywords: string[] }): string {
  const periodOptions = PERIODS.map(([value, key, fallback]) => `<option value="${value}"${c.period === value ? " selected" : ""}>${esc(t(key, fallback))}</option>`).join("");
  const replied = [["", t("SEARCH_UI.ANY", "Egal")], ["yes", t("GLOBAL.YES", "Ja")], ["no", t("GLOBAL.NO", "Nein")]]
    .map(([value, label]) => `<option value="${value}"${c.replied === value ? " selected" : ""}>${esc(label)}</option>`).join("");
  const keywordList = options.keywords.length
    ? `<datalist id="adv-keywords">${options.keywords.map((word) => `<option value="${esc(word)}"></option>`).join("")}</datalist>`
    : "";
  const subtree = options.multisearch
    ? `<label class="field"><span>${esc(t("SEARCH.SUBFOLDERS", "Unterordner"))}</span><select name="subtree">
        <option value=""${!c.subtree ? " selected" : ""}>${esc(t("SEARCH.SUBFOLDERS_NONE", "Keine"))}</option>
        <option value="subtree-one"${c.subtree === "subtree-one" ? " selected" : ""}>${esc(t("SEARCH.SUBFOLDERS_SUBTREE_ONE", "Eine Ebene"))}</option>
        <option value="subtree"${c.subtree === "subtree" ? " selected" : ""}>${esc(t("SEARCH.SUBFOLDERS_SUBTREE", "Alle"))}</option>
      </select></label>`
    : "";
  return `
    <div class="adv-grid">
      ${input("from", t("GLOBAL.FROM", "Von"), c.from)}
      ${input("to", t("GLOBAL.TO", "An"), c.to)}
      ${input("subject", t("GLOBAL.SUBJECT", "Betreff"), c.subject)}
      ${input("text", t("SEARCH.TEXT", "Text"), c.text)}
      ${input("keyword", t("SEARCH.KEYWORD", "Schlagwort"), c.keyword, "text", options.keywords.length ? `list="adv-keywords"` : "")}${keywordList}
      <label class="field"><span>${esc(t("SEARCH_UI.PERIOD", "Zeitraum"))}</span><select name="period">${periodOptions}</select></label>
      ${input("since", t("SEARCH_UI.DATE_FROM", "Datum von"), c.since, "date")}
      ${input("until", t("SEARCH_UI.DATE_TO", "Datum bis"), c.until, "date")}
      ${sizeField("larger", t("SEARCH_UI.MIN_SIZE", "Mindestgröße"), c.larger)}
      ${sizeField("smaller", t("SEARCH_UI.MAX_SIZE", "Höchstgröße"), c.smaller)}
      <label class="field"><span>${esc(t("SEARCH.REPLIED", "Beantwortet"))}</span><select name="replied">${replied}</select></label>
      ${subtree}
    </div>
    <fieldset class="choices">
      ${choice("attachment", t("SEARCH.HAS_ATTACHMENT", "Anhang vorhanden"), c.attachment)}
      ${choice("unseen", t("SEARCH.UNSEEN", "Ungelesen"), c.unseen)}
      ${choice("flagged", t("SEARCH.FLAGGED", "Markiert"), c.flagged)}
    </fieldset>
    <p class="quiet">${esc(t("SEARCH_UI.PERIOD_HINT", "Ein Zeitraum ersetzt „Datum von“ und „Datum bis“."))}</p>
    <div class="dialog-actions">
      <button type="button" class="text-btn" data-action="adv-reset">${icon("close")}<span class="btn-label">${esc(t("SEARCH_UI.RESET", "Zurücksetzen"))}</span></button>
      <button type="button" class="text-btn" data-action="close-dialog">${esc(t("GLOBAL.CANCEL", "Abbrechen"))}</button>
      <button type="submit" class="ink-btn">${icon("search")}<span class="btn-label">${esc(t("GLOBAL.SEARCH", "Suchen"))}</span></button>
    </div>`;
}

export function readSearchForm(form: HTMLFormElement): SearchCriteria {
  const data = new FormData(form);
  const get = (name: string) => String(data.get(name) || "").trim();
  const size = (name: string) => {
    const value = get(name);
    return value ? `${Math.max(0, Math.round(Number(value.replace(",", ".")) || 0))}${get(`${name}Unit`) || "K"}` : "";
  };
  const replied = get("replied");
  const subtree = get("subtree");
  return {
    from: get("from"), to: get("to"), subject: get("subject"), text: get("text"), keyword: get("keyword"),
    since: get("since"), until: get("until"), period: get("period"),
    larger: size("larger"), smaller: size("smaller"),
    attachment: data.get("attachment") === "on", unseen: data.get("unseen") === "on", flagged: data.get("flagged") === "on",
    replied: replied === "yes" || replied === "no" ? replied : "",
    subtree: subtree === "subtree" || subtree === "subtree-one" ? subtree : ""
  };
}
