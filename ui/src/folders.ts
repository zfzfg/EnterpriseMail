import { icon, type IconName } from "./icons";
import { t, uiLocale } from "./i18n";

/** Ein Ordner aus `Folders`, ergänzt um Baumdaten. Fehlende Eltern werden als Konstruktionsknoten angelegt. */
export interface FolderInfo {
  fullName: string;
  name: string;
  delimiter: string;
  role: string;
  unread: number;
  total: number;
  uidNext: number;
  size: number;
  subscribed: boolean;
  exists: boolean;
  selectable: boolean;
  noInferiors: boolean;
  checkable: boolean;
  kolabType: string;
  metadata: Record<string, string>;
  constructed: boolean;
  parent: string;
  depth: number;
}

export interface FolderModel {
  folders: FolderInfo[];
  quotaUsage: number | null;
  quotaLimit: number | null;
  capabilities: string[];
}

export interface FolderNode {
  info: FolderInfo;
  children: FolderNode[];
}

/** Aktionen im Ordnermenü. Nicht verfügbare Aktionen fehlen in der Liste. */
export type FolderAction = "create-sub" | "rename" | "read-all" | "clear" | "settings";

export interface SidebarRow {
  info: FolderInfo;
  depth: number;
  role: string;
  hasChildren: boolean;
  collapsed: boolean;
  current: boolean;
  path: string;
  actions: FolderAction[];
}

export interface SidebarData {
  rows: SidebarRow[];
  count: number;
  filter: string;
  currentName: string;
  quota: QuotaInfo | null;
  canCreate: boolean;
}

export interface QuotaInfo {
  used: number;
  limit: number;
}

export const KOLAB_KEYS = ["/private/vendor/kolab/folder-type", "/shared/vendor/kolab/folder-type"];
export const KOLAB_TYPES: Record<string, string> = {
  configuration: "CONFIGURATION", event: "CALENDAR", contact: "CONTACTS", task: "TASKS", note: "NOTES", file: "FILES", journal: "JOURNAL"
};
const KOLAB_LABEL: Record<string, string> = {
  configuration: "Konfiguration", event: "Kalender", contact: "Kontakte", task: "Aufgaben", note: "Aufzeichnungen", file: "Dateien", journal: "Tagebuch"
};

export const ROLE_ICON: Record<string, IconName> = {
  inbox: "inbox", sent: "sent", drafts: "drafts", trash: "trash", archive: "archive", junk: "spam", spam: "spam"
};

/** IMAP-ACL-Rechte (RFC 4314) mit den vorhandenen Sprachschlüsseln `IMAP.ACL_*`. */
export const ACL_RIGHTS: [string, string][] = [
  ["l", "Ordner sehen"], ["r", "Mails lesen"], ["s", "Gelesen-Status setzen"], ["w", "Andere Merker setzen"],
  ["i", "Mails einfügen"], ["p", "An den Ordner senden"], ["k", "Unterordner anlegen"], ["x", "Ordner löschen oder umbenennen"],
  ["t", "Als gelöscht markieren"], ["e", "Gelöschte endgültig entfernen"], ["a", "Rechte verwalten"]
];

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  }[char] ?? char));
}

function collection(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  if (value && typeof value === "object") {
    const list = (value as { "@Collection"?: unknown })["@Collection"];
    if (Array.isArray(list)) return list as Record<string, unknown>[];
  }
  return [];
}

export function bytes(value: number): string {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
  return `${size.toLocaleString(uiLocale(), { maximumFractionDigits: size < 10 && unit ? 1 : 0 })} ${units[unit]}`;
}

function parentOf(fullName: string, delimiter: string): string {
  if (!delimiter) return "";
  const at = fullName.lastIndexOf(delimiter);
  return at > 0 ? fullName.slice(0, at) : "";
}

/** `Folders` vollständig auswerten: Attribute, Prüfung, Metadaten, Kontingent und Fähigkeiten. */
export function parseFolders(result: Record<string, unknown>): FolderModel {
  const map = new Map<string, FolderInfo>();
  collection(result).forEach((item) => {
    const fullName = String(item.fullName || "");
    if (!fullName) return;
    const attributes = (Array.isArray(item.attributes) ? item.attributes : []).map((value) => String(value).toLowerCase());
    const metadata: Record<string, string> = {};
    if (item.metadata && typeof item.metadata === "object") {
      Object.entries(item.metadata as Record<string, unknown>).forEach(([key, value]) => { if (value != null) metadata[key] = String(value); });
    }
    const delimiter = String(item.delimiter || "");
    const exists = !attributes.includes("\\nonexistent");
    const kolab = (metadata[KOLAB_KEYS[0]] || metadata[KOLAB_KEYS[1]] || "").split(".")[0];
    map.set(fullName, {
      fullName,
      name: String(item.name || fullName.split(delimiter || "\u0000").pop() || fullName),
      delimiter,
      role: String(item.role || "").toLowerCase(),
      unread: Number(item.unreadEmails || 0),
      total: Number(item.totalEmails || 0),
      uidNext: Number(item.uidNext || 0),
      size: Number(item.size || 0),
      subscribed: attributes.includes("\\subscribed"),
      exists,
      selectable: exists && !attributes.includes("\\noselect"),
      noInferiors: attributes.includes("\\noinferiors"),
      checkable: Boolean(item.checkable),
      kolabType: kolab && kolab !== "mail" ? kolab : "",
      metadata,
      constructed: false,
      parent: parentOf(fullName, delimiter),
      depth: 0
    });
  });
  // Fehlende Eltern als nicht auswählbare Knoten ergänzen, damit der Baum geschlossen ist.
  [...map.values()].forEach((folder) => {
    let parent = folder.parent;
    while (parent && !map.has(parent)) {
      map.set(parent, {
        fullName: parent,
        name: parent.split(folder.delimiter).pop() || parent,
        delimiter: folder.delimiter,
        role: "",
        unread: 0, total: 0, uidNext: 0, size: 0,
        subscribed: false, exists: false, selectable: false, noInferiors: false, checkable: false,
        kolabType: "", metadata: {}, constructed: true,
        parent: parentOf(parent, folder.delimiter),
        depth: 0
      });
      parent = parentOf(parent, folder.delimiter);
    }
  });
  map.forEach((folder) => {
    let depth = 0;
    let parent = folder.parent;
    while (parent) { depth += 1; parent = map.get(parent)?.parent || ""; }
    folder.depth = depth;
  });
  const quota = (value: unknown) => value == null || value === "" ? null : Number(value);
  return {
    folders: [...map.values()],
    quotaUsage: quota(result.quotaUsage),
    quotaLimit: quota(result.quotaLimit),
    capabilities: (Array.isArray(result.capabilities) ? result.capabilities : []).map((value) => String(value).toUpperCase())
  };
}

const ROLE_RANK: Record<string, number> = { inbox: 0, sent: 1, drafts: 2, junk: 3, spam: 3, trash: 4, archive: 5 };

/** Baum in beliebiger Tiefe; oben Posteingang und Systemordner, dann alphabetisch. */
export function buildTree(folders: FolderInfo[], roleOf: (folder: FolderInfo) => string): FolderNode[] {
  const nodes = new Map(folders.map((info) => [info.fullName, { info, children: [] as FolderNode[] }]));
  const roots: FolderNode[] = [];
  nodes.forEach((node) => {
    const parent = node.info.parent ? nodes.get(node.info.parent) : undefined;
    (parent ? parent.children : roots).push(node);
  });
  const rank = (node: FolderNode) => ROLE_RANK[roleOf(node.info)] ?? 10;
  const sort = (list: FolderNode[]) => {
    list.sort((a, b) => rank(a) - rank(b) || a.info.name.localeCompare(b.info.name, uiLocale(), { sensitivity: "base" }));
    list.forEach((node) => sort(node.children));
  };
  sort(roots);
  return roots;
}

const SYSTEM_NAME: Record<string, [string, string]> = {
  inbox: ["FOLDER_LIST.INBOX_NAME", "Posteingang"],
  sent: ["FOLDER_LIST.SENT_NAME", "Gesendet"],
  drafts: ["FOLDER_LIST.DRAFTS_NAME", "Entwürfe"],
  junk: ["FOLDERS_UI.ROLE_JUNK", "Spam"],
  trash: ["FOLDER_LIST.TRASH_NAME", "Papierkorb"],
  archive: ["FOLDER_LIST.ARCHIVE_NAME", "Archiv"]
};

/** Anzeigename: Systemordner auf oberster Ebene in der Sprache der Oberfläche, sonst der Servername. */
export function displayName(folder: FolderInfo, role: string): string {
  const system = SYSTEM_NAME[role];
  return system && folder.depth === 0 ? t(system[0], system[1]) : folder.name;
}

/**
 * Vollständiger lesbarer Pfad eines Ordners für Tooltips und Pfadangaben.
 * Übersetzt Systemordner (wie INBOX, Gesendet, Papierkorb etc.) in die Oberflächensprache.
 */
export function folderDisplayPath(folder: FolderInfo, role?: string): string {
  const currentRole = role || folder.role;
  const system = SYSTEM_NAME[currentRole];
  if (folder.delimiter) {
    const parts = folder.fullName.split(folder.delimiter);
    const translated = parts.map((part, index) => {
      if (index === 0 && part.toUpperCase() === "INBOX") {
        return t("FOLDER_LIST.INBOX_NAME", "Posteingang");
      }
      if (index === parts.length - 1 && system && (parts.length === 1 || folder.depth <= 1)) {
        return t(system[0], system[1]);
      }
      return part;
    });
    return translated.join(" / ");
  }
  if (system && folder.depth === 0) {
    return t(system[0], system[1]);
  }
  if (folder.fullName.toUpperCase() === "INBOX") {
    return t("FOLDER_LIST.INBOX_NAME", "Posteingang");
  }
  return folder.fullName;
}

export function folderPath(folder: FolderInfo, role?: string): string {
  return folderDisplayPath(folder, role);
}

/**
 * Sichtbare Zeilen der Seitenleiste. Beim Filtern bleiben passende Ordner und ihre Eltern stehen,
 * aufgeklappt und mit vollständigem Pfad.
 */
export function flattenTree(
  roots: FolderNode[],
  options: { collapsed: Set<string>; filter: string; hidden: (folder: FolderInfo) => boolean; current: string; roleOf: (folder: FolderInfo) => string; actions: (folder: FolderInfo, hasChildren: boolean) => FolderAction[] }
): SidebarRow[] {
  const query = options.filter.trim().toLowerCase();
  const rows: SidebarRow[] = [];
  const matches = (node: FolderNode): boolean => !query
    || node.info.name.toLowerCase().includes(query)
    || node.info.fullName.toLowerCase().includes(query)
    || node.children.some(matches);
  const walk = (list: FolderNode[], depth: number) => {
    list.forEach((node) => {
      if (options.hidden(node.info) || !matches(node)) return;
      const children = node.children.filter((child) => !options.hidden(child.info));
      const collapsed = !query && options.collapsed.has(node.info.fullName);
      rows.push({
        info: node.info,
        depth,
        role: options.roleOf(node.info),
        hasChildren: children.length > 0,
        collapsed,
        current: node.info.fullName === options.current,
        path: folderPath(node.info),
        actions: options.actions(node.info, children.length > 0)
      });
      if (!collapsed) walk(children, depth + 1);
    });
  };
  walk(roots, 0);
  return rows;
}

/** Ordnerzeilen der Seitenleiste. Auswählbare Ordner öffnen, Konstruktionsknoten klappen nur. */
export function renderSidebarRows(rows: SidebarRow[], filtering: boolean): string {
  if (!rows.length) return `<p class="quiet folder-empty">${esc(filtering ? t("FOLDERS_UI.NO_MATCH", "Kein Ordner gefunden.") : t("FOLDERS_UI.EMPTY", "Keine Ordner."))}</p>`;
  return rows.map((row) => {
    const name = displayName(row.info, row.role);
    const target = esc(row.info.fullName);
    const toggle = row.hasChildren
      ? `<button type="button" class="icon-btn ftoggle" data-action="f-toggle" data-target="${target}" tabindex="-1" aria-expanded="${row.collapsed ? "false" : "true"}" aria-label="${esc(`${t("FOLDERS_UI.SUBFOLDERS_OF", "Unterordner von")} ${name}`)}" title="${esc(row.collapsed ? t("FOLDERS_UI.EXPAND", "Aufklappen") : t("FOLDERS_UI.COLLAPSE", "Zuklappen"))}">${icon(row.collapsed ? "chevron-right" : "chevron-down")}</button>`
      : `<span class="ftoggle" aria-hidden="true"></span>`;
    const count = row.info.unread > 0 ? `<span class="count" aria-label="${row.info.unread} ${esc(t("FOLDERS_UI.UNREAD", "ungelesen"))}">${row.info.unread}</span>` : "";
    const symbol = icon(ROLE_ICON[row.role] || (row.hasChildren && !row.collapsed ? "folder-open" : "folder"));
    const pathNote = filtering && row.depth > 0 ? `<span class="sr"> (${esc(row.path)})</span>` : "";
    const label = `${symbol}<span class="folder-name">${esc(name)}${pathNote}</span>${count}`;
    const main = row.info.selectable
      ? `<button type="button" class="folder" data-folder="${target}" data-role="${esc(row.role || "")}" data-depth="${row.depth}" aria-current="${row.current ? "page" : "false"}" title="${esc(row.path)}">${label}</button>`
      : `<button type="button" class="folder is-group" data-action="f-toggle" data-target="${target}" data-role="${esc(row.role || "")}" data-depth="${row.depth}" title="${esc(`${row.path} · ${t("FOLDERS_UI.NOT_SELECTABLE", "nicht auswählbar")}`)}"${row.hasChildren ? ` aria-expanded="${row.collapsed ? "false" : "true"}"` : " disabled"}>${label}</button>`;
    const more = row.actions.length
      ? `<button type="button" class="icon-btn fmore" data-action="f-menu" data-target="${target}" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(`${t("FOLDERS_UI.ACTIONS_FOR", "Aktionen für")} ${name}`)}" title="${esc(t("FOLDERS_UI.ACTIONS", "Ordneraktionen"))}">${icon("more")}</button>`
      : "";
    return `<div class="frow" style="--depth:${row.depth}" data-row="${target}">${toggle}${main}${more}</div>`;
  }).join("");
}

export function quotaText(quota: QuotaInfo): string {
  const pct = quota.limit > 0 ? Math.min(100, Math.round((quota.used / quota.limit) * 100)) : 0;
  return `${bytes(quota.used)} ${t("FOLDERS_UI.OF", "von")} ${bytes(quota.limit)} ${t("FOLDERS_UI.USED", "belegt")} (${pct} %)`;
}

export function renderQuota(quota: QuotaInfo | null): string {
  if (!quota || !quota.limit) return "";
  const pct = Math.min(100, Math.round((quota.used / quota.limit) * 100));
  return `<p class="mono quota-label">${esc(t("FOLDERS_UI.QUOTA", "Speicher"))}</p>
    <div class="quota-bar${pct >= 90 ? " full" : ""}" aria-hidden="true"><span style="width:${pct}%"></span></div>
    <p class="quiet quota-text">${esc(quotaText(quota))}</p>`;
}

export const ACTION_LABEL: Record<FolderAction, [IconName, string, string]> = {
  "create-sub": ["folder-plus", "FOLDERS_UI.NEW_SUBFOLDER", "Neuer Unterordner"],
  rename: ["edit-as-new", "FOLDERS_UI.RENAME", "Umbenennen"],
  "read-all": ["mark-read", "MESSAGE_LIST.MENU_SET_ALL_SEEN", "Alle als gelesen markieren"],
  clear: ["delete-forever", "MESSAGE_LIST.BUTTON_EMPTY_FOLDER", "Ordner leeren"],
  settings: ["settings", "FOLDERS_UI.FOLDER_SETTINGS", "Ordnereinstellungen"]
};

export function renderFolderMenu(target: string, actions: FolderAction[]): string {
  return actions.map((action) => {
    const [name, key, fallback] = ACTION_LABEL[action];
    return `<li><button type="button" class="menu-item${action === "clear" ? " danger-item" : ""}" role="menuitem" data-action="f-${action}" data-target="${esc(target)}">${icon(name)}<span>${esc(t(key, fallback))}</span></button></li>`;
  }).join("");
}

/* ---------- Einstellungsabschnitt „Ordner“ ---------- */

export interface FolderDeskRow {
  info: FolderInfo;
  depth: number;
  role: string;
  hasChildren: boolean;
  canDelete: boolean;
  canClear: boolean;
  canRename: boolean;
}

export interface FolderDesk {
  rows: FolderDeskRow[];
  hideUnsubscribed: boolean;
  kolab: boolean;
  unhideKolab: boolean;
  acl: boolean;
  system: { sent: string; drafts: string; junk: string; trash: string; archive: string };
  quota: QuotaInfo | null;
  notice: string;
}

function option(value: string, label: string, selected: boolean): string {
  return `<option value="${esc(value)}"${selected ? " selected" : ""}>${esc(label)}</option>`;
}

function select(name: string, label: string, options: string): string {
  return `<label class="field"><span>${esc(label)}</span><select name="${name}">${options}</select></label>`;
}

function check(name: string, label: string, on: boolean): string {
  return `<label class="check"><input type="checkbox" name="${name}"${on ? " checked" : ""}> ${esc(label)}</label>`;
}

function deskButton(action: string, iconName: IconName, label: string, attrs: Record<string, string>, danger = false, pressed?: boolean, compact = false): string {
  const extra = Object.entries(attrs).map(([key, value]) => ` data-${key}="${esc(value)}"`).join("");
  const press = pressed == null ? "" : ` aria-pressed="${pressed ? "true" : "false"}"`;
  // Kompakt: nur Symbol, der Text bleibt zugänglicher Name und Tooltip.
  const text = compact ? `<span class="sr">${esc(label)}</span>` : `<span class="btn-label">${esc(label)}</span>`;
  const tip = compact ? ` title="${esc(label)}"` : "";
  return `<button type="button" class="${danger ? "danger" : "text-btn"}${compact ? " icon-only" : ""}" data-action="${action}"${extra}${press}${tip}>${icon(iconName)}${text}</button>`;
}

function indentLabel(row: { info: FolderInfo; depth: number; role: string }): string {
  return `${"  ".repeat(row.depth)}${displayName(row.info, row.role)}`;
}

/** Eltern für „Anlegen“/„Verschieben“: vorhandene Ordner, die Unterordner erlauben. */
function parentOptions(rows: FolderDeskRow[], selected: string, exclude = ""): string {
  const top = option("", t("FOLDERS_UI.TOP_LEVEL", "Oberste Ebene"), !selected);
  return top + rows
    .filter((row) => row.info.exists && !row.info.noInferiors && (!exclude || (row.info.fullName !== exclude && !row.info.fullName.startsWith(exclude + row.info.delimiter))))
    .map((row) => option(row.info.fullName, indentLabel(row), row.info.fullName === selected)).join("");
}

export function kolabLabel(type: string): string {
  return type ? `Kolab ${t(`SETTINGS_FOLDERS.TYPE_${KOLAB_TYPES[type] || ""}`, KOLAB_LABEL[type] || type)}` : "";
}

export function renderFolderDesk(desk: FolderDesk | null, edit: { kind: string; id: string; fresh: boolean } | null): string {
  const error = `<p class="error" id="settings-error" hidden></p>`;
  if (!desk) return `${error}<p class="quiet">${esc(t("SETTINGS_FOLDERS.LOADING_PROCESS", "Ordnerliste wird geladen"))} …</p>`;
  const note = desk.notice ? `<p class="quiet">${esc(desk.notice)}</p>` : "";
  const quota = desk.quota && desk.quota.limit ? `<p class="quiet">${esc(t("FOLDERS_UI.QUOTA", "Speicher"))}: ${esc(quotaText(desk.quota))}</p>` : "";

  const editing = edit?.kind === "folder" && !edit.fresh ? desk.rows.find((row) => row.info.fullName === edit.id) : undefined;
  const creating = edit?.kind === "folder" && edit.fresh;

  const rows = desk.rows.map((row) => {
    const name = displayName(row.info, row.role);
    const meta = [
      row.info.selectable ? `${row.info.total} ${row.info.total === 1 ? t("FOLDERS_UI.MAIL", "Mail") : t("FOLDERS_UI.MAILS", "Mails")}${row.info.unread ? `, ${row.info.unread} ${t("FOLDERS_UI.UNREAD", "ungelesen")}` : ""}` : t("FOLDERS_UI.NOT_SELECTABLE", "nicht auswählbar"),
      row.role && row.role !== "inbox" ? t(`FOLDERS_UI.ROLE_${row.role.toUpperCase()}`, ({ sent: "Gesendet", drafts: "Entwürfe", junk: "Spam", spam: "Spam", trash: "Papierkorb", archive: "Archiv" } as Record<string, string>)[row.role] || row.role) : "",
      row.info.exists && !row.info.subscribed ? t("FOLDERS_UI.NOT_SUBSCRIBED", "nicht abonniert") : "",
      row.info.checkable ? t("FOLDERS_UI.CHECKED", "wird geprüft") : "",
      kolabLabel(row.info.kolabType)
    ].filter(Boolean).join(" · ");
    const actions = [
      row.info.exists ? deskButton("settings-edit", "compose", t("SETTINGS_DESK.EDIT", "Bearbeiten"), { kind: "folder", id: row.info.fullName }) : "",
      row.info.selectable && row.role !== "inbox"
        ? deskButton("f-subscribe", row.info.subscribed ? "eye" : "eye-off", row.info.subscribed ? t("SETTINGS_FOLDERS.BUTTON_UNSUBSCRIBE", "Abonnement beenden") : t("SETTINGS_FOLDERS.BUTTON_SUBSCRIBE", "Abonnieren"), { target: row.info.fullName }, false, row.info.subscribed, true)
        : "",
      row.info.selectable
        ? deskButton("f-checkable", row.info.checkable ? "bell" : "bell-off", row.info.checkable ? t("FOLDERS_UI.CHECK_OFF", "Nicht mehr prüfen") : t("FOLDERS_UI.CHECK_ON", "Auf neue Mail prüfen"), { target: row.info.fullName }, false, row.info.checkable, true)
        : "",
      desk.acl && row.info.exists ? deskButton("f-acl", "folder-shared", t("FOLDERS_UI.SHARING", "Freigaben"), { target: row.info.fullName }, false, undefined, true) : "",
      row.canClear ? deskButton("f-clear", "delete-forever", t("MESSAGE_LIST.BUTTON_EMPTY_FOLDER", "Ordner leeren"), { target: row.info.fullName }, true, undefined, true) : "",
      row.canDelete ? deskButton("f-delete", "delete", t("GLOBAL.DELETE", "Löschen"), { target: row.info.fullName }, true, undefined, true) : ""
    ].join("");
    const indent = `style="padding-left:${row.depth * 16}px"`;
    return `<li class="set-row folder-set-row"><span class="grow" ${indent}><strong title="${esc(folderPath(row.info, row.role))}">${icon(ROLE_ICON[row.role] || "folder")} ${esc(name)}</strong>${meta ? `<span class="quiet">${esc(meta)}</span>` : ""}</span>${actions}</li>${editing === row ? "<!--EDIT-->" : ""}`;
  }).join("");

  const subscribeLabel = t("FOLDERS_UI.SUBSCRIBE", "Abonnieren");
  const createForm = `<form class="fields" data-action="settings-form" data-kind="folder-create">
      <p class="mono">${esc(t("POPUPS_CREATE_FOLDER.TITLE_CREATE_FOLDER", "Ordner anlegen"))}</p>
      <label class="field"><span>${esc(t("GLOBAL.NAME", "Name"))}</span><input name="folder" type="text" required autocomplete="off"></label>
      ${select("parent", t("POPUPS_CREATE_FOLDER.LABEL_PARENT", "Übergeordneter Ordner"), parentOptions(desk.rows, edit?.id || ""))}
      ${check("subscribe", subscribeLabel, true)}
      <div class="dialog-actions"><button type="button" class="text-btn" data-action="settings-cancel">${esc(t("GLOBAL.CANCEL", "Abbrechen"))}</button><button type="submit" class="ink-btn">${icon("folder-plus")}<span class="btn-label">${esc(t("POPUPS_CREATE_FOLDER.BUTTON_CREATE", "Anlegen"))}</span></button></div>
    </form>`;

  const kolabTypes = desk.kolab ? Object.keys(KOLAB_TYPES) : [];
  const editForm = editing ? `<form class="fields" data-action="settings-form" data-kind="folder-save">
      <p class="mono">${esc(folderPath(editing.info, editing.role))}</p>
      <input type="hidden" name="oldName" value="${esc(editing.info.fullName)}">
      ${editing.canRename ? `<label class="field"><span>${esc(t("GLOBAL.NAME", "Name"))}</span><input name="name" type="text" value="${esc(editing.info.name)}" required autocomplete="off"></label>
      ${select("parent", t("POPUPS_CREATE_FOLDER.LABEL_PARENT", "Übergeordneter Ordner"), parentOptions(desk.rows, editing.info.parent, editing.info.fullName))}` : `<input type="hidden" name="name" value="${esc(editing.info.name)}"><input type="hidden" name="parent" value="${esc(editing.info.parent)}"><p class="quiet">${esc(t("FOLDERS_UI.SYSTEM_NO_RENAME", "Systemordner werden nicht umbenannt."))}</p>`}
      ${editing.role === "inbox" ? `<input type="hidden" name="subscribe" value="1">` : check("subscribe", subscribeLabel, editing.info.subscribed)}
      ${editing.info.selectable ? check("checkable", t("FOLDERS_UI.CHECK_ON", "Auf neue Mail prüfen"), editing.info.checkable) : ""}
      ${kolabTypes.length ? select("kolab", t("FOLDERS_UI.KOLAB_TYPE", "Kolab-Typ"), option("", t("FOLDERS_UI.KOLAB_MAIL", "Mail"), !editing.info.kolabType) + kolabTypes.map((type) => option(type, kolabLabel(type), type === editing.info.kolabType)).join("")) : ""}
      <div class="dialog-actions"><button type="button" class="text-btn" data-action="settings-cancel">${esc(t("GLOBAL.CANCEL", "Abbrechen"))}</button><button type="submit" class="ink-btn">${icon("save")}<span class="btn-label">${esc(t("GLOBAL.SAVE", "Speichern"))}</span></button></div>
    </form>` : "";

  const selectable = desk.rows.filter((row) => row.info.selectable && row.role !== "inbox");
  const systemSelect = (name: keyof FolderDesk["system"], label: string) => select(name, label,
    option("", t("FOLDERS_UI.AUTOMATIC", "Automatisch (nach Rolle)"), !desk.system[name])
    + selectable.map((row) => option(row.info.fullName, indentLabel(row), row.info.fullName === desk.system[name])).join(""));
  const systemForm = `<details><summary>${esc(t("SETTINGS_FOLDERS.BUTTON_SYSTEM", "Systemordner"))}</summary>
    <form class="fields" data-action="settings-form" data-kind="folder-system">
      <p class="quiet">${esc(t("POPUPS_SYSTEM_FOLDERS.TITLE_SYSTEM_FOLDERS", "Wählen Sie die Systemordner aus"))}</p>
      ${systemSelect("sent", t("FOLDER_LIST.SENT_NAME", "Gesendet"))}
      ${systemSelect("drafts", t("FOLDER_LIST.DRAFTS_NAME", "Entwürfe"))}
      ${systemSelect("junk", t("FOLDERS_UI.ROLE_JUNK", "Spam"))}
      ${systemSelect("trash", t("FOLDER_LIST.TRASH_NAME", "Papierkorb"))}
      ${systemSelect("archive", t("FOLDER_LIST.ARCHIVE_NAME", "Archiv"))}
      <div class="dialog-actions"><button type="submit" class="ink-btn">${icon("save")}<span class="btn-label">${esc(t("GLOBAL.SAVE", "Speichern"))}</span></button></div>
    </form></details>`;

  const optionsForm = `<form class="fields" data-action="settings-form" data-kind="folder-options">
      ${check("hideUnsubscribed", t("SETTINGS_FOLDERS.HIDE_UNSUBSCRIBED", "Nicht abonnierte Ordner ausblenden"), desk.hideUnsubscribed)}
      ${desk.kolab ? check("unhideKolab", t("SETTINGS_FOLDERS.UNHIDE_KOLAB_FOLDERS", "Kolab-Ordner anzeigen"), desk.unhideKolab) : ""}
      <div class="dialog-actions"><button type="submit" class="text-btn">${icon("save")}<span class="btn-label">${esc(t("GLOBAL.SAVE", "Speichern"))}</span></button></div>
    </form>`;

  const add = creating ? createForm : deskButton("settings-edit", "folder-plus", t("SETTINGS_FOLDERS.BUTTON_CREATE", "Ordner anlegen"), { kind: "folder", fresh: "1", id: "" });
  return `${error}<p class="mono">${esc(t("SETTINGS_FOLDERS.LEGEND_FOLDERS", "Ordnerliste"))}</p>${note}${quota}
    ${optionsForm}
    ${add}
    <ul class="set-list">${rows.replace("<!--EDIT-->", editForm ? `<li class="set-edit">${editForm}</li>` : "")}</ul>
    ${systemForm}`;
}

/* ---------- Freigaben (ACL) ---------- */

export interface AclEntry { identifier: string; rights: string; mine: boolean }

export function parseAcl(result: unknown): AclEntry[] {
  return collection(result).map((item) => ({
    identifier: String(item.identifier || ""),
    rights: String(item.rights || ""),
    mine: Boolean(item.mine)
  }));
}

export function explainRights(rights: string): string {
  const parts = ACL_RIGHTS.filter(([letter]) => rights.includes(letter)).map(([letter, fallback]) => t(`IMAP.ACL_${letter.toUpperCase()}`, fallback));
  return parts.join(", ") || t("FOLDERS_UI.NO_RIGHTS", "keine Rechte");
}

export function renderAcl(folder: string, entries: AclEntry[], error: string): string {
  const mine = entries.find((entry) => entry.mine);
  const canAdmin = Boolean(mine?.rights.includes("a"));
  const others = entries.filter((entry) => !entry.mine);
  const list = others.map((entry) => `<li class="set-row"><span class="grow"><strong>${esc(entry.identifier)}</strong><span class="quiet">${esc(explainRights(entry.rights))}</span></span>${canAdmin ? deskButton("f-acl-delete", "delete", t("GLOBAL.DELETE", "Löschen"), { target: folder, id: entry.identifier }, true) : ""}</li>`).join("");
  const form = canAdmin ? `<form class="fields" data-action="settings-form" data-kind="folder-acl-set">
      <input type="hidden" name="folder" value="${esc(folder)}">
      <label class="field"><span>${esc(t("FOLDERS_UI.ACL_IDENTIFIER", "Benutzer oder Gruppe"))}</span><input name="identifier" type="text" required autocomplete="off"></label>
      <fieldset class="choices acl-rights"><legend class="mono">${esc(t("IMAP.ACL_RIGHTS", "Rechte"))}</legend>
        ${ACL_RIGHTS.map(([letter, fallback]) => check(`r_${letter}`, `${letter} · ${t(`IMAP.ACL_${letter.toUpperCase()}`, fallback)}`, letter === "l" || letter === "r")).join("")}
      </fieldset>
      <div class="dialog-actions"><button type="submit" class="ink-btn">${icon("check")}<span class="btn-label">${esc(t("FOLDERS_UI.ACL_SAVE", "Freigabe speichern"))}</span></button></div>
    </form>` : `<p class="quiet">${esc(t("FOLDERS_UI.ACL_READONLY", "Sie dürfen die Freigaben dieses Ordners nicht ändern."))}</p>`;
  return `${error ? `<p class="error">${esc(error)}</p>` : ""}
    ${mine ? `<p class="quiet">${esc(t("FOLDERS_UI.ACL_MINE", "Ihre Rechte"))}: ${esc(explainRights(mine.rights))}</p>` : ""}
    <ul class="set-list">${list}</ul>${list ? "" : `<p class="quiet">${esc(t("FOLDERS_UI.ACL_NONE", "Keine weiteren Freigaben."))}</p>`}
    ${form}`;
}
