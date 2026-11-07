import { explain } from "../api";
import { t } from "../i18n";
import { esc, type Cfg, type Ctx } from "./util";

export function paintConfig(ctx: Ctx, slot: HTMLElement): void {
  const sections = Object.keys(ctx.cfg).filter((name) => name !== "version");
  slot.innerHTML = `<form>
    ${sections.map((section) => sectionBlock(section, ctx.cfg[section] || {})).join("")}
    <div class="action"><button type="button" class="ink-btn" data-action="save">${esc(t("GLOBAL.SAVE", "Speichern"))}</button></div>
    <p class="quiet" data-for="config" hidden></p>
  </form>`;
  slot.querySelector("[data-action='save']")?.addEventListener("click", () => { void save(ctx, slot); });
}

function sectionBlock(section: string, rows: Record<string, unknown[]>): string {
  const body = Object.keys(rows).map((key) => row(section, key, rows[key] || [])).join("");
  return `<details><summary class="mono">${esc(section)}</summary><table class="cfg"><tbody>${body}</tbody></table></details>`;
}

function row(section: string, key: string, tuple: unknown[]): string {
  const value = tuple[0];
  const comment = typeof tuple[1] === "string" ? tuple[1] : "";
  const options = Array.isArray(tuple[2]) ? tuple[2].map(String) : null;
  const secret = /pass|secret|token|key/i.test(key);
  let control = "";
  if (typeof value === "boolean") {
    control = `<input data-section="${esc(section)}" data-key="${esc(key)}" data-kind="bool" type="checkbox"${value ? " checked" : ""}>`;
  } else if (options) {
    control = `<select data-section="${esc(section)}" data-key="${esc(key)}" data-kind="text">${options.map((item) => `<option${item === String(value) ? " selected" : ""}>${esc(item)}</option>`).join("")}</select>`;
  } else if (typeof value === "number") {
    control = `<input data-section="${esc(section)}" data-key="${esc(key)}" data-kind="number" inputmode="decimal" value="${esc(String(value))}">`;
  } else {
    control = `<input data-section="${esc(section)}" data-key="${esc(key)}" data-kind="text" type="${secret ? "password" : "text"}" value="${esc(value == null ? "" : String(value))}">`;
  }
  return `<tr><th>${esc(key)}${comment ? `<span class="quiet">${esc(comment)}</span>` : ""}</th><td>${control}</td></tr>`;
}

async function save(ctx: Ctx, slot: HTMLElement): Promise<void> {
  const config: Cfg = {};
  slot.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-section]").forEach((input) => {
    const section = input.dataset.section || "";
    const key = input.dataset.key || "";
    config[section] ||= {};
    if (input instanceof HTMLInputElement && input.dataset.kind === "bool") config[section][key] = [input.checked];
    else if (input.dataset.kind === "number") config[section][key] = [Number(input.value)];
    else config[section][key] = [input.value];
  });
  const out = slot.querySelector("[data-for='config']") as HTMLElement | null;
  try {
    await ctx.call("AdminSettingsSet", { config });
    await ctx.reload();
    if (out) {
      out.hidden = false;
      out.textContent = t("UI.SAVED", "Gespeichert.");
    }
  } catch (error) {
    if (out) {
      out.hidden = false;
      out.textContent = explain(error);
    }
  }
}
