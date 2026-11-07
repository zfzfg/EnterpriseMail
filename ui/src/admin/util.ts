import { adminCall, explain } from "../api";
import { t } from "../i18n";

export const DUMMY = "********";

export type Cfg = Record<string, Record<string, unknown[]>>;

export interface AppSnap {
  adminLogin?: string;
  adminTOTP?: string;
  weakPassword?: boolean;
  pluginsEnable?: boolean;
  supportedPdoDrivers?: string[];
  Admin?: { path?: string; languages?: string[]; language?: string };
  [key: string]: unknown;
}

export type Section =
  | "general" | "login" | "domains" | "contacts" | "security"
  | "branding" | "packages" | "config" | "about";

export interface Ctx {
  key: string;
  app: AppSnap;
  cfg: Cfg;
  goto(section: Section): void;
  note(message: string, error?: boolean): void;
  reload(): Promise<void>;
  call<T>(action: string, params?: Record<string, unknown>): Promise<T>;
}

export function esc(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  }[char] ?? char));
}

export function cell(cfg: Cfg, section: string, key: string): unknown {
  const row = cfg[section]?.[key];
  return Array.isArray(row) ? row[0] : "";
}

export function flag(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

export function languages(app: AppSnap): string[] {
  const list = app.Admin?.languages;
  return Array.isArray(list) ? list.map(String) : ["de", "en"];
}

export function bind(ctx: Ctx, root: ParentNode): void {
  root.querySelectorAll<HTMLButtonElement>("[data-save]").forEach((button) => {
    button.addEventListener("click", () => {
      const form = button.closest("form");
      if (!form) return;
      void save(ctx, form, button);
    });
  });
}

async function save(ctx: Ctx, form: HTMLFormElement, button: HTMLButtonElement): Promise<void> {
  button.disabled = true;
  const params: Record<string, unknown> = {};
  new FormData(form).forEach((value, key) => {
    params[key] = typeof value === "string" ? value : "";
  });
  form.querySelectorAll<HTMLInputElement>("input[type='checkbox'][name]").forEach((box) => {
    params[box.name] = box.checked ? "1" : "0";
  });
  try {
    await ctx.call("AdminSettingsUpdate", params);
    await ctx.reload();
    ctx.note(t("UI.SAVED", "Gespeichert."));
  } catch (error) {
    ctx.note(explain(error), true);
  } finally {
    button.disabled = false;
  }
}

export function check(name: string, label: string, on: boolean): string {
  return `<label class="check"><input type="checkbox" name="${esc(name)}"${on ? " checked" : ""}><span>${esc(label)}</span></label>`;
}

export function field(name: string, label: string, value: string, extra = ""): string {
  return `<label class="field"><span>${esc(label)}</span><input name="${esc(name)}" value="${esc(value)}" ${extra}></label>`;
}

export function select(name: string, label: string, value: string, options: Array<[string, string]>): string {
  const items = options.map(([id, text]) =>
    `<option value="${esc(id)}"${id === value ? " selected" : ""}>${esc(text)}</option>`).join("");
  return `<label class="field"><span>${esc(label)}</span><select name="${esc(name)}">${items}</select></label>`;
}

export function langSelect(name: string, label: string, value: string, list: string[]): string {
  const names: Record<string, string> = {
    de: t("LANGS_NAMES.de", "Deutsch"),
    en: t("LANGS_NAMES.en", "English")
  };
  return select(name, label, value, list.map((id) => [id, names[id] || id]));
}
