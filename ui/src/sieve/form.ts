import { icon } from "../icons";
import { t } from "../i18n";
import { blankRule, type Action, type Condition, type FilterScript, type Rule } from "./script";

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char] ?? char));
}

const FIELDS: [string, string, string][] = [
  ["from", "SETTINGS_FILTERS.FIELD_FROM", "Von"],
  ["to", "SETTINGS_FILTERS.FIELD_TO", "An"],
  ["subject", "SETTINGS_FILTERS.FIELD_SUBJECT", "Betreff"],
  ["header", "SETTINGS_FILTERS.FIELD_HEADER", "Kopfzeile"],
  ["body", "SETTINGS_FILTERS.FIELD_BODY", "Text"],
  ["size", "SETTINGS_FILTERS.FIELD_SIZE", "Größe"]
];

const OPS: [string, string, string][] = [
  ["contains", "SETTINGS_FILTERS.OP_CONTAINS", "enthält"],
  ["is", "SETTINGS_FILTERS.OP_IS", "ist"],
  ["starts", "SETTINGS_FILTERS.OP_STARTS", "beginnt mit"],
  ["ends", "SETTINGS_FILTERS.OP_ENDS", "endet mit"],
  ["regex", "SETTINGS_FILTERS.OP_REGEX", "Regex"],
  ["over", "SETTINGS_FILTERS.OP_OVER", "größer als"],
  ["under", "SETTINGS_FILTERS.OP_UNDER", "kleiner als"]
];

const ACTIONS: [string, string, string][] = [
  ["move", "SETTINGS_FILTERS.ACT_MOVE", "In Ordner verschieben"],
  ["copy", "SETTINGS_FILTERS.ACT_COPY", "In Ordner kopieren"],
  ["forward", "SETTINGS_FILTERS.ACT_FORWARD", "Weiterleiten, Kopie behalten"],
  ["forward-drop", "SETTINGS_FILTERS.ACT_FORWARD_DROP", "Weiterleiten, ohne Kopie"],
  ["reject", "SETTINGS_FILTERS.ACT_REJECT", "Ablehnen mit Text"],
  ["discard", "SETTINGS_FILTERS.ACT_DISCARD", "Verwerfen"],
  ["seen", "SETTINGS_FILTERS.ACT_SEEN", "Als gelesen markieren"],
  ["flag", "SETTINGS_FILTERS.ACT_FLAG", "Markieren"],
  ["stop", "SETTINGS_FILTERS.ACT_STOP", "Weitere Regeln stoppen"]
];

function options(rows: [string, string, string][], current: string): string {
  return rows.map(([id, key, fallback]) => `<option value="${id}"${id === current ? " selected" : ""}>${esc(t(key, fallback))}</option>`).join("");
}

function conditionRow(condition: Condition): string {
  const size = condition.field === "size";
  return `<div class="rule-line" data-cond>
    <select data-part="field" aria-label="${esc(t("SETTINGS_FILTERS.FIELD", "Feld"))}">${options(FIELDS, condition.field)}</select>
    <input data-part="header" value="${esc(condition.header)}" placeholder="${esc(t("SETTINGS_FILTERS.HEADER_NAME", "Name der Kopfzeile"))}" aria-label="${esc(t("SETTINGS_FILTERS.HEADER_NAME", "Name der Kopfzeile"))}"${condition.field === "header" ? "" : " hidden"}>
    <select data-part="op" aria-label="${esc(t("SETTINGS_FILTERS.OP", "Vergleich"))}">${options(OPS, condition.op)}</select>
    <input data-part="value" value="${esc(condition.value)}" placeholder="${esc(size ? t("SETTINGS_FILTERS.SIZE_VALUE", "z. B. 2M") : t("SETTINGS_FILTERS.VALUE", "Wert"))}" aria-label="${esc(t("SETTINGS_FILTERS.VALUE", "Wert"))}">
    <button type="button" class="icon-btn" data-action="cond-remove" aria-label="${esc(t("GLOBAL.DELETE", "Löschen"))}">${icon("delete")}</button>
  </div>`;
}

function actionRow(action: Action, folders: string[]): string {
  const needs = action.type === "move" || action.type === "copy" || action.type === "forward" || action.type === "forward-drop" || action.type === "reject" || action.type === "flag";
  const list = action.type === "move" || action.type === "copy" ? " list=\"filter-folders\"" : "";
  return `<div class="rule-line" data-act>
    <select data-part="type" aria-label="${esc(t("SETTINGS_FILTERS.ACTION", "Aktion"))}">${options(ACTIONS, action.type)}</select>
    <input data-part="avalue" value="${esc(action.value)}"${list}${needs ? "" : " hidden"} placeholder="${esc(placeholder(action.type))}" aria-label="${esc(placeholder(action.type))}">
    <button type="button" class="icon-btn" data-action="act-remove" aria-label="${esc(t("GLOBAL.DELETE", "Löschen"))}">${icon("delete")}</button>
  </div>`;
}

function placeholder(type: string): string {
  if (type === "move" || type === "copy") return t("SETTINGS_FILTERS.FOLDER", "Ordner");
  if (type === "forward" || type === "forward-drop") return t("GLOBAL.EMAIL", "E-Mail");
  if (type === "reject") return t("SETTINGS_FILTERS.REJECT_TEXT", "Text der Ablehnung");
  if (type === "flag") return t("SETTINGS_FILTERS.FLAG_NAME", "Markierung");
  return "";
}

export function ruleCard(rule: Rule, folders: string[]): string {
  return `<li class="set-row rule-card" draggable="true" data-sort="rule" data-rule>
    <div class="rule-line">
      <label class="check"><input type="checkbox" data-part="on"${rule.enabled ? " checked" : ""}> ${esc(t("SETTINGS_DESK.ACTIVE", "Aktiv"))}</label>
      <input data-part="name" value="${esc(rule.name)}" placeholder="${esc(t("GLOBAL.NAME", "Name"))}" aria-label="${esc(t("GLOBAL.NAME", "Name"))}">
      <select data-part="match" aria-label="${esc(t("SETTINGS_FILTERS.MATCH", "Bedingungen"))}">
        <option value="all"${rule.match === "all" ? " selected" : ""}>${esc(t("SETTINGS_FILTERS.MATCH_ALL", "Alle Bedingungen"))}</option>
        <option value="any"${rule.match === "any" ? " selected" : ""}>${esc(t("SETTINGS_FILTERS.MATCH_ANY", "Eine Bedingung"))}</option>
      </select>
      <button type="button" class="icon-btn" data-action="settings-move" data-list="rules" data-dir="up" aria-label="${esc(t("SETTINGS_DESK.UP", "Nach oben"))}">${icon("chevron-up")}</button>
      <button type="button" class="icon-btn" data-action="settings-move" data-list="rules" data-dir="down" aria-label="${esc(t("SETTINGS_DESK.DOWN", "Nach unten"))}">${icon("chevron-down")}</button>
      <button type="button" class="icon-btn" data-action="rule-remove" aria-label="${esc(t("GLOBAL.DELETE", "Löschen"))}">${icon("delete")}</button>
    </div>
    <div class="conds">${rule.conditions.map((item) => conditionRow(item)).join("")}</div>
    <button type="button" class="text-btn" data-action="cond-add">${icon("plus")}<span class="btn-label">${esc(t("SETTINGS_FILTERS.ADD_CONDITION", "Bedingung hinzufügen"))}</span></button>
    <div class="acts">${rule.actions.map((item) => actionRow(item, folders)).join("")}</div>
    <button type="button" class="text-btn" data-action="act-add">${icon("plus")}<span class="btn-label">${esc(t("SETTINGS_FILTERS.ADD_ACTION", "Aktion hinzufügen"))}</span></button>
  </li>`;
}

export function renderFilterEditor(name: string, body: string, parsed: FilterScript | null, reason: string, folders: string[], vacationAvailable: boolean, capa: string[]): string {
  const script = parsed || { rules: [], vacation: null };
  const raw = !parsed;
  const vacation = script.vacation;
  const showVacation = vacationAvailable || Boolean(vacation?.on);
  const folderList = folders.map((item) => `<option value="${esc(item)}"></option>`).join("");
  const cards = (parsed ? script.rules : []).map((rule) => ruleCard(rule, folders)).join("");
  const fresh = blankRule();
  return `<div data-sieve-capa="${esc(capa.join(" "))}"></div>
    <p class="quiet">${esc(raw ? reason : t("SETTINGS_FILTERS.FORM_HINT", "Regeln gelten von oben nach unten. Was sich nicht abbilden lässt, bleibt im Skript."))}</p>
    <button type="button" class="text-btn" data-action="script-mode">${icon("filter")}<span class="btn-label">${esc(raw ? t("SETTINGS_FILTERS.SHOW_RULES", "Als Regeln zeigen") : t("SETTINGS_FILTERS.EDIT_SCRIPT", "Skript bearbeiten"))}</span></button>
    <datalist id="filter-folders">${folderList}</datalist>
    <div data-editor="form"${raw ? " hidden" : ""}>
      ${showVacation ? `<fieldset class="fields vacation-box">
        <legend class="mono">${esc(t("SETTINGS_FILTERS.VACATION", "Abwesenheitsnotiz"))}</legend>
        <label class="check"><input type="checkbox" data-part="vacation-on"${vacation?.on ? " checked" : ""}> ${esc(t("SETTINGS_FILTERS.VACATION_ON", "Antwort automatisch senden"))}</label>
        <div class="rule-line">
          <label class="field"><span>${esc(t("SETTINGS_FILTERS.VACATION_FROM", "Von"))}</span><input data-part="vacation-from" type="date" value="${esc(vacation?.from || "")}"></label>
          <label class="field"><span>${esc(t("SETTINGS_FILTERS.VACATION_UNTIL", "Bis"))}</span><input data-part="vacation-until" type="date" value="${esc(vacation?.until || "")}"></label>
          <label class="field"><span>${esc(t("SETTINGS_FILTERS.VACATION_DAYS", "Intervall in Tagen"))}</span><input data-part="vacation-days" type="number" min="1" value="${esc(vacation?.days || "7")}"></label>
        </div>
        <label class="field"><span>${esc(t("SETTINGS_FILTERS.VACATION_SUBJECT", "Betreff"))}</span><input data-part="vacation-subject" value="${esc(vacation?.subject || "")}"></label>
        <label class="field"><span>${esc(t("SETTINGS_FILTERS.VACATION_ADDRESSES", "Adressen"))}</span><input data-part="vacation-addresses" value="${esc(vacation?.addresses || "")}" placeholder="${esc(t("SETTINGS_FILTERS.VACATION_ADDRESSES_HINT", "Kommagetrennt, leer für alle Empfänger"))}"></label>
        <label class="field"><span>${esc(t("SETTINGS_FILTERS.VACATION_TEXT", "Text"))}</span><textarea data-part="vacation-text">${esc(vacation?.text || "")}</textarea></label>
      </fieldset>` : ""}
      <p class="mono">${esc(t("SETTINGS_FILTERS.RULES", "Regeln"))}</p>
      <ul class="set-list" data-rule-list>${cards}</ul>
      ${cards ? "" : `<p class="quiet" data-rule-empty>${esc(t("SETTINGS_DESK.EMPTY", "Nichts vorhanden."))}</p>`}
      <button type="button" class="text-btn" data-action="rule-add">${icon("plus")}<span class="btn-label">${esc(t("SETTINGS_FILTERS.ADD_RULE", "Regel hinzufügen"))}</span></button>
    </div>
    <div data-editor="raw"${raw ? "" : " hidden"}>
      <label class="field"><span>${esc(t("SETTINGS_DESK.SCRIPT", "Skript"))}</span><textarea name="body" class="code">${esc(body)}</textarea></label>
    </div>
    <input type="checkbox" data-part="use-raw"${raw ? " checked" : ""} hidden>
    <template data-rule-template>${ruleCard(fresh, folders)}</template>
    <template data-cond-template>${conditionRow(fresh.conditions[0])}</template>
    <template data-act-template>${actionRow(fresh.actions[0], folders)}</template>
    <input type="hidden" name="script-name" value="${esc(name)}">`;
}

export function syncFilterRow(row: HTMLElement): void {
  const field = row.querySelector<HTMLSelectElement>("[data-part='field']");
  const type = row.querySelector<HTMLSelectElement>("[data-part='type']");
  if (field) {
    const header = row.querySelector<HTMLInputElement>("[data-part='header']");
    if (header) header.hidden = field.value !== "header";
    row.querySelectorAll<HTMLOptionElement>("[data-part='op'] option").forEach((option) => {
      const sizeOp = option.value === "over" || option.value === "under";
      option.hidden = field.value === "size" ? !sizeOp : sizeOp;
    });
    const op = row.querySelector<HTMLSelectElement>("[data-part='op']");
    if (op && op.selectedOptions[0]?.hidden) op.value = field.value === "size" ? "over" : "contains";
  }
  if (type) {
    const input = row.querySelector<HTMLInputElement>("[data-part='avalue']");
    if (!input) return;
    const needs = ["move", "copy", "forward", "forward-drop", "reject", "flag"].includes(type.value);
    input.hidden = !needs;
    input.placeholder = placeholder(type.value);
    input.setAttribute("aria-label", placeholder(type.value) || t("SETTINGS_FILTERS.VALUE", "Wert"));
    if (type.value === "move" || type.value === "copy") input.setAttribute("list", "filter-folders");
    else input.removeAttribute("list");
  }
}
