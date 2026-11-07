import { explain } from "../api";
import { t } from "../i18n";
import { esc, type Ctx } from "./util";

interface Info {
  core?: { version?: string; versionCompare?: number; warning?: boolean; updatable?: boolean; warnings?: string[] };
  php?: Array<{ name?: string; loaded?: boolean; version?: string | number }>;
}

export async function paintAbout(ctx: Ctx, slot: HTMLElement): Promise<void> {
  slot.innerHTML = `<h2 class="title title-md">${esc(t("TAB_ABOUT.LEGEND_ABOUT", "Über"))}</h2><p class="quiet" data-for="about">${esc(t("TAB_ABOUT.LABEL_CHECKING", "Überprüfe auf Aktualisierungen"))}</p><ul class="set-list" id="php"></ul><div class="action">
    <button type="button" class="text-btn" data-action="cache">${esc(t("UI.CACHE", "Cache leeren"))}</button>
    <button type="button" class="text-btn" data-action="backup">${esc(t("UI.BACKUP", "Sicherung herunterladen"))}</button>
    <button type="button" class="ink-btn" data-action="upgrade" hidden>${esc(t("UI.UPGRADE", "Core aktualisieren"))}</button>
  </div>
  <dialog id="upgrade"><div class="dialog-body"><h2 class="title title-md">${esc(t("UI.UPGRADE_SURE", "SnappyMail wirklich aktualisieren?"))}</h2><p class="quiet">${esc(t("TAB_ABOUT.HINT_READ_CHANGE_LOG", "Bitte Lesen Sie das Changelog vor dem Update."))}</p><div class="dialog-actions"><button type="button" class="text-btn" value="cancel">${esc(t("GLOBAL.CANCEL", "Abbrechen"))}</button><button type="button" class="ink-btn" value="ok">${esc(t("UI.UPGRADE", "Core aktualisieren"))}</button></div></div></dialog>`;
  const dialog = slot.querySelector("#upgrade") as HTMLDialogElement;
  dialog.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest("button");
    if (button) dialog.close(button.value);
  });
  slot.querySelector("[data-action='cache']")?.addEventListener("click", () => {
    void ctx.call("AdminClearCache").then(() => note(slot, t("UI.SAVED", "Gespeichert."))).catch((error) => note(slot, explain(error)));
  });
  slot.querySelector("[data-action='backup']")?.addEventListener("click", () => {
    window.location.href = `?/${encodeURIComponent(ctx.key)}/Backup/`;
  });
  slot.querySelector("[data-action='upgrade']")?.addEventListener("click", () => { void upgrade(ctx, slot, dialog); });
  try {
    const info = await ctx.call<Info>("AdminInfo");
    const core = info.core || {};
    const line = document.createElement("p");
    line.className = "quiet";
    const current = String((window as Window & { rl?: { SettingsGet?: (scope: string, key: string) => string } }).rl?.SettingsGet?.("version", "") || "");
    if (core.version && (core.versionCompare || 0) < 0) {
      line.textContent = t("TAB_ABOUT.HTML_NEW_VERSION", "Neue Version %VERSION% verfügbar.").replace("%VERSION%", core.version);
      slot.querySelector<HTMLButtonElement>("[data-action='upgrade']")!.hidden = false;
    } else {
      line.textContent = t("TAB_ABOUT.HINT_IS_UP_TO_DATE", "SnappyMail ist auf dem neusten Stand.") + (current ? ` ${current}` : "");
    }
    if (core.warnings?.length) line.textContent += ` ${core.warnings.join(" ")}`;
    slot.querySelector("[data-for='about']")?.replaceWith(line);
    const list = slot.querySelector("#php");
    if (list) {
      list.innerHTML = (info.php || []).map((item) =>
        `<li class="set-row"><span class="grow"><strong>${esc(String(item.name || ""))}</strong></span><span class="quiet">${esc(item.loaded ? String(item.version || t("GLOBAL.YES", "Ja")) : t("GLOBAL.NO", "Nein"))}</span></li>`).join("");
    }
  } catch (error) {
    note(slot, explain(error));
  }
}

function note(slot: HTMLElement, message: string): void {
  const node = slot.querySelector("[data-for='about'], .quiet");
  if (node) node.textContent = message;
}

async function upgrade(ctx: Ctx, slot: HTMLElement, dialog: HTMLDialogElement): Promise<void> {
  dialog.showModal();
  const ok = await new Promise<boolean>((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok"), { once: true });
  });
  if (!ok) return;
  note(slot, t("TAB_ABOUT.LABEL_UPDATING", "Aktualisiere"));
  try {
    await ctx.call("AdminUpgradeCore");
    note(slot, t("UI.SAVED", "Gespeichert."));
  } catch (error) {
    note(slot, explain(error));
  }
}
