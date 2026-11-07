import { explain } from "../api";
import { icon } from "../icons";
import { t } from "../i18n";
import { DUMMY, esc, type Ctx } from "./util";

interface PackageRow {
  id?: string;
  name?: string;
  type?: string;
  version?: string;
  installed?: string;
  enabled?: boolean;
  file?: string;
  desc?: string;
  canBeDeleted?: boolean;
  canBeUpdated?: boolean;
}

interface Prop {
  "@Object"?: string;
  name?: string;
  type?: number;
  label?: string;
  value?: unknown;
  desc?: string;
  options?: string[] | Record<string, string>;
  config?: Prop[];
}

export async function paintPackages(ctx: Ctx, slot: HTMLElement): Promise<void> {
  slot.innerHTML = `<p class="error" data-for="packages" hidden></p><div id="package-lists"></div><dialog id="plugin-dialog" class="dialog-wide"></dialog>`;
  try {
    const data = await ctx.call<{ Real?: boolean; List?: PackageRow[]; Error?: string }>("AdminPackagesList");
    const list = data.List || [];
    const installed = list.filter((item) => item.installed);
    const updates = installed.filter((item) => item.canBeUpdated);
    const available = list.filter((item) => !item.installed);
    const host = slot.querySelector("#package-lists");
    if (!host) return;
    host.innerHTML = [
      data.Error ? `<p class="error">${esc(data.Error || t("TAB_PACKAGES.ALERT_CANNOT_ACCESS_REPOSITORY", "Momentan kann nicht auf das Repository zugegriffen werden."))}</p>` : "",
      group(t("TAB_PACKAGES.LEGEND_INSTALLED_PACKAGES", "Installierte Erweiterungen"), installed, true),
      group(t("TAB_PACKAGES.LEGEND_AVAILABLE_FOR_UPDATE", "Zur Aktualisierung verfügbar"), updates, true),
      group(t("TAB_PACKAGES.LEGEND_AVAILABLE_FOR_INSTALLATION", "Zur Installation verfügbar"), available, false)
    ].join("");
    host.querySelectorAll<HTMLButtonElement>("[data-action='toggle']").forEach((button) => {
      button.addEventListener("click", () => {
        void ctx.call("AdminPluginDisable", {
          id: button.dataset.id || "",
          disabled: button.dataset.enabled === "1" ? "1" : "0"
        }).then(() => paintPackages(ctx, slot)).catch((error) => fail(slot, explain(error)));
      });
    });
    host.querySelectorAll<HTMLButtonElement>("[data-action='install']").forEach((button) => {
      button.addEventListener("click", () => {
        void ctx.call("AdminPackageInstall", {
          id: button.dataset.id || "",
          type: button.dataset.type || "plugin",
          file: button.dataset.file || ""
        }).then(() => paintPackages(ctx, slot)).catch((error) => fail(slot, explain(error)));
      });
    });
    host.querySelectorAll<HTMLButtonElement>("[data-action='delete']").forEach((button) => {
      button.addEventListener("click", () => {
        void ctx.call("AdminPackageDelete", { id: button.dataset.id || "" })
          .then(() => paintPackages(ctx, slot)).catch((error) => fail(slot, explain(error)));
      });
    });
    host.querySelectorAll<HTMLButtonElement>("[data-action='config']").forEach((button) => {
      button.addEventListener("click", () => { void openPlugin(ctx, slot, button.dataset.id || ""); });
    });
  } catch (error) {
    fail(slot, explain(error));
  }
}

function fail(slot: HTMLElement, message: string): void {
  const node = slot.querySelector("[data-for='packages']") as HTMLElement | null;
  if (!node) return;
  node.hidden = false;
  node.textContent = message;
}

function group(title: string, rows: PackageRow[], installed: boolean): string {
  if (!rows.length) return "";
  const items = rows.map((item) => {
    const id = String(item.id || "");
    const name = String(item.name || id);
    const meta = [item.installed || item.version || "", item.type || ""].filter(Boolean).join(" · ");
    const toggle = item.enabled
      ? t("TAB_DOMAINS.BUTTON_DISABLE", "Deaktivieren")
      : t("TAB_DOMAINS.BUTTON_ENABLE", "Aktivieren");
    const buttons = [
      installed && item.type !== "plugin" ? "" : installed
        ? `<button type="button" class="text-btn" data-action="toggle" data-id="${esc(id)}" data-enabled="${item.enabled ? "1" : "0"}">${esc(toggle)}</button>`
        : "",
      installed ? `<button type="button" class="text-btn" data-action="config" data-id="${esc(id)}">${esc(t("POPUPS_PLUGIN.TITLE_PLUGIN", "Erweiterung"))}</button>` : "",
      !installed || item.canBeUpdated ? `<button type="button" class="text-btn" data-action="install" data-id="${esc(id)}" data-type="${esc(String(item.type || "plugin"))}" data-file="${esc(String(item.file || ""))}">${esc(item.canBeUpdated ? t("GLOBAL.UPDATE", "Aktualisieren") : t("GLOBAL.ADD", "Hinzufügen"))}</button>` : "",
      item.canBeDeleted ? `<button type="button" class="danger" data-action="delete" data-id="${esc(id)}">${icon("delete")}<span class="btn-label">${esc(t("GLOBAL.DELETE", "Löschen"))}</span></button>` : ""
    ].join("");
    return `<li class="set-row"><span class="grow"><strong>${esc(name)}</strong><span class="quiet">${esc(meta)}</span></span>${buttons}</li>`;
  }).join("");
  return `<h2 class="title title-md">${esc(title)}</h2><ul class="set-list">${items}</ul>`;
}

async function openPlugin(ctx: Ctx, slot: HTMLElement, id: string): Promise<void> {
  const dialog = slot.querySelector("#plugin-dialog") as HTMLDialogElement | null;
  if (!dialog || !id) return;
  const plugin = await ctx.call<{ name?: string; readme?: string; config?: Prop[] }>("AdminPluginLoad", { id });
  const config = plugin.config || [];
  dialog.innerHTML = `<form class="dialog-body">
    <h2 class="title title-md">${esc(plugin.name || id)}</h2>
    ${plugin.readme ? `<p class="quiet">${esc(plugin.readme)}</p>` : ""}
    ${config.length ? config.map((item) => prop(item)).join("") : `<p class="quiet">${esc(t("POPUPS_PLUGIN.DESC_NOTHING_TO_CONFIGURE", "Nichts zu konfigurieren"))}</p>`}
    <div class="action">
      <button type="button" class="ink-btn" data-action="save">${esc(t("GLOBAL.SAVE", "Speichern"))}</button>
      <button type="button" class="text-btn" value="cancel">${esc(t("GLOBAL.CLOSE", "Schließen"))}</button>
    </div>
    <p class="error" data-for="plugin" hidden></p>
  </form>`;
  dialog.querySelector("[value='cancel']")?.addEventListener("click", () => dialog.close());
  dialog.querySelector("[data-action='save']")?.addEventListener("click", () => {
    const form = dialog.querySelector("form");
    if (!form) return;
    const settings: Record<string, unknown> = {};
    form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("[data-prop]").forEach((input) => {
      const key = input.dataset.prop || "";
      if (input instanceof HTMLInputElement && input.type === "checkbox") settings[key] = input.checked;
      else settings[key] = input.value;
    });
    void ctx.call("AdminPluginSettingsUpdate", { id, settings }).then(() => dialog.close()).catch((error) => {
      const out = dialog.querySelector("[data-for='plugin']") as HTMLElement;
      out.hidden = false;
      out.textContent = explain(error);
    });
  });
  dialog.showModal();
}

function prop(item: Prop): string {
  if (item.type === 7) {
    return `<fieldset class="vacation-box"><legend>${esc(String(item.label || ""))}</legend>${(item.config || []).map((child) => prop(child)).join("")}</fieldset>`;
  }
  const name = String(item.name || "");
  const label = String(item.label || name);
  const value = item.value == null ? "" : String(item.value);
  const hint = item.desc ? `<p class="quiet">${esc(String(item.desc))}</p>` : "";
  if (item.type === 5) {
    return `<label class="check"><input data-prop="${esc(name)}" type="checkbox"${item.value ? " checked" : ""}><span>${esc(label)}</span></label>${hint}`;
  }
  if (item.type === 2) {
    return `<label class="field"><span>${esc(label)}</span><textarea class="short" data-prop="${esc(name)}">${esc(value)}</textarea></label>${hint}`;
  }
  if (item.type === 4 || item.type === 8) {
    const options = Array.isArray(item.options)
      ? item.options.map((entry) => [String(entry), String(entry)] as [string, string])
      : Object.entries(item.options || {});
    return `<label class="field"><span>${esc(label)}</span><select data-prop="${esc(name)}">${options.map(([id, text]) => `<option value="${esc(id)}"${id === value ? " selected" : ""}>${esc(text)}</option>`).join("")}</select></label>${hint}`;
  }
  const type = item.type === 3 ? "password" : item.type === 1 ? "number" : item.type === 6 ? "url" : "text";
  const shown = item.type === 3 ? DUMMY : value;
  return `<label class="field"><span>${esc(label)}</span><input data-prop="${esc(name)}" type="${type}" value="${esc(shown)}"></label>${hint}`;
}
