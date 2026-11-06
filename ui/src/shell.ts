import { iconClose, iconMenu } from "./icons";
import { t } from "./i18n";
import { applyAppearance, readAppearance, type Appearance } from "./theme";

const FILTERS = [
  ["all", "Alle"],
  ["needs_reply", "Antwort nötig"],
  ["personal", "Für mich"],
  ["newsletter", "Newsletter"],
  ["notification", "Benachrichtigungen"],
  ["invoice", "Rechnungen"]
] as const;

const TONES = [
  ["professional", "TONE_PROFESSIONAL", "Professionell"],
  ["friendly", "TONE_FRIENDLY", "Freundlich"],
  ["casual", "TONE_CASUAL", "Locker"],
  ["concise", "TONE_CONCISE", "Knapp"],
  ["formal", "TONE_FORMAL", "Förmlich"],
  ["custom", "TONE_CUSTOM", "Eigener"]
] as const;

function filters(): string {
  return FILTERS.map(([id, label], index) => {
    const text = id === "needs_reply"
      ? t("AI_COPILOT.CAT_NEEDS_REPLY", label)
      : id === "personal" ? t("AI_COPILOT.CAT_PERSONAL", label)
      : id === "newsletter" ? t("AI_COPILOT.CAT_NEWSLETTER", label)
      : id === "notification" ? t("AI_COPILOT.CAT_NOTIFICATION", label)
      : id === "invoice" ? t("AI_COPILOT.CAT_INVOICE", label)
      : t("AI_COPILOT.TAB_ALL", label);
    return `<button type="button" class="filter" data-action="filter" data-filter="${id}" aria-pressed="${index === 0 ? "true" : "false"}">${text}</button>`;
  }).join("");
}

function tones(): string {
  return TONES.map(([id, key, label], index) =>
    `<button type="button" class="seg" data-action="tone" data-tone="${id}" aria-pressed="${index === 0 ? "true" : "false"}">${t("AI_COPILOT." + key, label)}</button>`
  ).join("");
}

function markup(): string {
  const ask = t("AI_COPILOT.ASK_COPILOT", "Copilot fragen");
  const close = t("AI_COPILOT.CLOSE", "Schließen");
  const send = t("AI_COPILOT.SEND", "Senden");
  return `
    <div class="shell" data-pane="list" data-sidebar="open">
      <button type="button" class="scrim" data-action="close-sidebar" aria-label="Ordner schließen"></button>
      <aside class="sidebar" aria-label="Ordner">
        <div class="account">
          <button type="button" class="account-btn" data-action="account" aria-expanded="false" aria-controls="account-menu" aria-haspopup="menu">Konto</button>
          <div class="menu" id="account-menu" role="menu" hidden>
            <button type="button" class="menu-item" role="menuitem" data-action="settings">Einstellungen</button>
            <button type="button" class="menu-item" role="menuitem" disabled>Abmelden</button>
          </div>
        </div>
        <p class="group-label mono">Heute</p>
        <button type="button" class="count-row" data-action="filter" data-filter="needs_reply"><span>Offene Antworten</span><span class="count">0</span></button>
        <button type="button" class="count-row" data-action="soon"><span>Ohne Antwort</span><span class="count">0</span></button>
        <button type="button" class="count-row" data-action="filter" data-filter="invoice"><span>Rechnungen</span><span class="count">0</span></button>
        <p class="group-label mono">Posteingang</p>
        <button type="button" class="folder" aria-current="page">Posteingang</button>
        <p class="group-label mono">Ordner</p>
        <p class="quiet" style="padding:0 8px">Ordner erscheinen nach der Anmeldung.</p>
      </aside>
      <section class="list-pane" aria-label="Mails">
        <div class="pane-head">
          <button type="button" class="icon-btn" data-action="toggle-sidebar" aria-label="Ordner ein- oder ausblenden">${iconMenu}</button>
          <h1 class="title" style="font-size:1rem">Posteingang</h1>
        </div>
        <form class="search-wrap" data-action="search">
          <label class="sr" for="search">Suche</label>
          <input class="search" id="search" type="search" name="q" placeholder="In Posteingang suchen" autocomplete="off">
        </form>
        <div class="filters" role="toolbar" aria-label="Filter">${filters()}</div>
        <div class="pane-body">
          <div class="empty" id="list-empty">
            <p>Dieser Ordner ist leer.</p>
            <button type="button" class="text-btn" data-action="clear-filter" hidden>Filter aufheben</button>
          </div>
          <p class="quiet live" id="search-live"></p>
        </div>
      </section>
      <div class="splitter" role="separator" aria-orientation="vertical" aria-label="Breite der Liste" tabindex="0" aria-valuemin="288" aria-valuemax="640" aria-valuenow="384"></div>
      <section class="reader" aria-label="Brief">
        <div class="reader-bar">
          <button type="button" class="text-btn" data-action="back" hidden>Zurück</button>
          <span class="quiet">Posteingang</span>
          <span class="spacer"></span>
          <button type="button" class="text-btn" data-action="open-sheet">${ask}</button>
        </div>
        <div class="pane-body">
          <div class="empty">
            <p>Wählen Sie eine Mail.</p>
          </div>
        </div>
        <aside class="sheet" hidden aria-label="${ask}">
          <div class="sheet-head">
            <span class="title" style="font-size:13px;letter-spacing:-0.01em">${ask}</span>
            <span class="mono quiet">Nicht verbunden</span>
            <span class="spacer"></span>
            <button type="button" class="icon-btn" data-action="close-sheet" aria-label="${close}">${iconClose}</button>
          </div>
          <div class="sheet-log">
            <p class="quiet">${t("AI_COPILOT.CHAT_EMPTY", "Fragen Sie zum Beispiel, welche Mails auf eine Antwort warten.")}</p>
            <div class="prompts">
              <button type="button" class="prompt" data-action="prompt">Welche Mails warten auf meine Antwort?</button>
              <button type="button" class="prompt" data-action="prompt">Zeig mir Rechnungen vom letzten Monat</button>
              <button type="button" class="prompt" data-action="prompt">Fasse die geöffnete Mail zusammen</button>
            </div>
          </div>
          <form class="sheet-form" data-action="ask">
            <label class="sr" for="ask">${ask}</label>
            <textarea id="ask" rows="2" placeholder="${t("AI_COPILOT.CHAT_PLACEHOLDER", "Nachricht an Copilot …")}"></textarea>
            <button type="submit" class="ink-btn">${send}</button>
          </form>
          <p class="quiet live" id="ask-live" style="padding:0 12px 12px"></p>
        </aside>
      </section>
      <section class="composer" hidden aria-label="Neue Mail">
        <div class="composer-bar">
          <button type="button" class="icon-btn" data-action="close-compose" aria-label="${close}">${iconClose}</button>
          <span class="title" style="font-size:1rem">Neue Mail</span>
          <span class="spacer"></span>
          <button type="button" class="ink-btn" data-action="send-mail">Senden</button>
        </div>
        <div class="fields">
          <label class="field"><span>An</span><input type="email" name="to" autocomplete="email"></label>
          <label class="field"><span>Betreff</span><input type="text" name="subject"></label>
          <div class="modes" role="toolbar" aria-label="Art des Texts">
            <button type="button" class="seg" data-action="mode" data-mode="new" aria-pressed="true">Neue Mail</button>
            <button type="button" class="seg" data-action="mode" data-mode="reply" aria-pressed="false">Antwort</button>
            <button type="button" class="seg" data-action="mode" data-mode="rewrite" aria-pressed="false">Umschreiben</button>
            <button type="button" class="seg" data-action="mode" data-mode="proofread" aria-pressed="false">Korrektur</button>
          </div>
          <label class="field"><span>Anweisung</span><input type="text" name="instruction" placeholder="${t("AI_COPILOT.INSTRUCTION_PLACEHOLDER", "Was soll die Mail sagen?")}"></label>
          <div class="tones" role="toolbar" aria-label="${t("AI_COPILOT.TONE", "Ton")}">${tones()}</div>
          <label class="field"><span>Text</span><textarea name="body"></textarea></label>
          <p class="quiet live" id="send-live"></p>
        </div>
      </section>
      <nav class="tabbar" aria-label="Navigation">
        <button type="button" class="text-btn" data-action="pane" data-pane="folders">Ordner</button>
        <button type="button" class="text-btn" data-action="pane" data-pane="search">Suche</button>
        <button type="button" class="ink-btn" data-action="open-compose">Schreiben</button>
      </nav>
      <dialog id="settings" aria-labelledby="settings-title">
        <div class="dialog-body">
          <div class="sheet-head" style="padding:0;border:0;min-height:0">
            <h2 id="settings-title" class="title" style="font-size:1.25rem">Einstellungen</h2>
            <span class="spacer"></span>
            <button type="button" class="icon-btn" data-action="close-dialog" aria-label="${close}">${iconClose}</button>
          </div>
          <fieldset style="border:0;padding:0;margin:0;display:flex;flex-direction:column;gap:8px">
            <legend class="mono">Erscheinungsbild</legend>
            <label><input type="radio" name="appearance" value="system"> System</label>
            <label><input type="radio" name="appearance" value="light"> Hell</label>
            <label><input type="radio" name="appearance" value="dark"> Dunkel</label>
          </fieldset>
        </div>
      </dialog>
      <dialog id="keys" aria-labelledby="keys-title">
        <div class="dialog-body">
          <div class="sheet-head" style="padding:0;border:0;min-height:0">
            <h2 id="keys-title" class="title" style="font-size:1.25rem">Tasten</h2>
            <span class="spacer"></span>
            <button type="button" class="icon-btn" data-action="close-dialog" aria-label="${close}">${iconClose}</button>
          </div>
          <ul class="keys">
            <li><span>Seitenleiste</span><kbd>\\</kbd></li>
            <li><span>Fragen</span><kbd>Strg</kbd> <kbd>.</kbd></li>
            <li><span>Schließen</span><kbd>Esc</kbd></li>
            <li><span>Diese Liste</span><kbd>?</kbd></li>
          </ul>
        </div>
      </dialog>
    </div>`;
}

function clampList(px: number): number {
  return Math.min(640, Math.max(288, Math.round(px)));
}

export function mountShell(root: HTMLElement): void {
  root.innerHTML = markup();
  const shell = root.querySelector(".shell") as HTMLElement;
  const list = shell.querySelector(".list-pane") as HTMLElement;
  const separator = shell.querySelector(".splitter") as HTMLElement;
  const sheet = shell.querySelector(".sheet") as HTMLElement;
  const composer = shell.querySelector(".composer") as HTMLElement;
  const menu = shell.querySelector("#account-menu") as HTMLElement;
  const accountBtn = shell.querySelector("[data-action='account']") as HTMLButtonElement;
  const listEmptyBtn = shell.querySelector("[data-action='clear-filter']") as HTMLButtonElement;
  const backBtn = shell.querySelector("[data-action='back']") as HTMLButtonElement;
  let filter = "all";
  let opener: HTMLElement | null = null;

  const wide = () => matchMedia("(min-width: 800px)").matches;
  const docked = () => matchMedia("(min-width: 1280px)").matches;

  const setListWidth = (px: number) => {
    const next = clampList(px);
    shell.style.setProperty("--list-w", `${next}px`);
    separator.setAttribute("aria-valuenow", String(next));
  };

  const syncPaneChrome = () => {
    const pane = shell.dataset.pane;
    backBtn.hidden = wide() || pane !== "reader";
    if (!wide() && shell.dataset.sidebar === "open" && pane !== "folders") {
      /* mobile uses the pane, not the overlay flag */
    }
  };

  const setPane = (pane: string) => {
    if (pane === "search") {
      shell.dataset.pane = "list";
      (shell.querySelector("#search") as HTMLInputElement).focus();
    } else {
      shell.dataset.pane = pane;
    }
    syncPaneChrome();
  };

  const setSidebar = (open: boolean) => {
    shell.dataset.sidebar = open ? "open" : "closed";
  };

  const showEmpty = () => {
    const text = shell.querySelector("#list-empty p") as HTMLElement;
    const filtered = filter !== "all";
    text.textContent = filtered ? "Keine Mails für diesen Filter." : "Dieser Ordner ist leer.";
    listEmptyBtn.hidden = !filtered;
  };

  const press = (selector: string, attr: string, value: string) => {
    shell.querySelectorAll<HTMLButtonElement>(selector).forEach((button) => {
      button.setAttribute("aria-pressed", button.dataset[attr] === value ? "true" : "false");
    });
  };

  const openLayer = (layer: HTMLElement, from: HTMLElement | null) => {
    opener = from;
    layer.hidden = false;
    layer.dataset.open = "false";
    requestAnimationFrame(() => { layer.dataset.open = "true"; });
  };

  const closeLayer = (layer: HTMLElement) => {
    layer.dataset.open = "false";
    const finish = () => { layer.hidden = true; };
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) finish();
    else layer.addEventListener("transitionend", finish, { once: true });
    opener?.focus();
    opener = null;
  };

  const closeMenu = () => {
    menu.hidden = true;
    accountBtn.setAttribute("aria-expanded", "false");
  };

  shell.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
    if (!menu.hidden && !target?.closest(".account")) closeMenu();
    if (!target || target.closest(".shell") !== shell) return;
    const action = target.dataset.action;
    if (action === "toggle-sidebar") {
      if (!wide()) setPane("folders");
      else setSidebar(shell.dataset.sidebar !== "open");
    } else if (action === "close-sidebar") {
      setSidebar(false);
    } else if (action === "account") {
      const open = menu.hidden;
      menu.hidden = !open;
      accountBtn.setAttribute("aria-expanded", open ? "true" : "false");
    } else if (action === "settings") {
      closeMenu();
      const dialog = shell.querySelector("#settings") as HTMLDialogElement;
      const current = readAppearance();
      shell.querySelectorAll<HTMLInputElement>("input[name='appearance']").forEach((input) => {
        input.checked = input.value === current;
      });
      dialog.showModal();
    } else if (action === "close-dialog") {
      (target.closest("dialog") as HTMLDialogElement | null)?.close();
    } else if (action === "soon") {
      (shell.querySelector("#search-live") as HTMLElement).textContent = "Dieser Hinweis ist noch nicht mit dem Postfach verbunden.";
    } else if (action === "filter") {
      filter = target.dataset.filter ?? "all";
      press(".filter", "filter", filter);
      showEmpty();
      if (!wide()) setPane("list");
    } else if (action === "clear-filter") {
      filter = "all";
      press(".filter", "filter", filter);
      showEmpty();
    } else if (action === "back") {
      setPane("list");
    } else if (action === "pane") {
      const pane = target.dataset.pane ?? "list";
      if (pane === "folders") setPane("folders");
      else setPane(pane);
    } else if (action === "open-sheet") {
      if (!wide()) setPane("reader");
      openLayer(sheet, target);
      (shell.querySelector("#ask") as HTMLTextAreaElement).focus({ preventScroll: true });
    } else if (action === "close-sheet") {
      closeLayer(sheet);
    } else if (action === "prompt") {
      const area = shell.querySelector("#ask") as HTMLTextAreaElement;
      area.value = target.textContent ?? "";
      area.focus();
    } else if (action === "open-compose") {
      if (!wide()) setPane("compose");
      openLayer(composer, target);
    } else if (action === "close-compose") {
      closeLayer(composer);
      if (!wide()) setPane("list");
    } else if (action === "mode") {
      press("[data-action='mode']", "mode", target.dataset.mode ?? "new");
    } else if (action === "tone") {
      press("[data-action='tone']", "tone", target.dataset.tone ?? "professional");
    } else if (action === "send-mail") {
      (shell.querySelector("#send-live") as HTMLElement).textContent = "Noch nicht verbunden. Die Mail wird nicht gesendet.";
    }
  });

  shell.addEventListener("submit", (event) => {
    const form = (event.target as HTMLElement).closest("form");
    if (!form) return;
    event.preventDefault();
    if (form.dataset.action === "search") {
      const query = (form.querySelector("input") as HTMLInputElement).value.trim();
      (shell.querySelector("#search-live") as HTMLElement).textContent = query
        ? "Die Suche ist noch nicht mit dem Postfach verbunden. Es wird nichts abgefragt."
        : "";
    } else if (form.dataset.action === "ask") {
      (shell.querySelector("#ask-live") as HTMLElement).textContent = "Noch nicht verbunden. Es wird nichts gesendet.";
    }
  });

  shell.addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement;
    if (input.name !== "appearance") return;
    applyAppearance(input.value as Appearance);
  });

  shell.addEventListener("keydown", (event) => {
    const typing = event.target instanceof HTMLInputElement
      || event.target instanceof HTMLTextAreaElement
      || (event.target instanceof HTMLElement && event.target.isContentEditable);
    if (event.key === "Escape") {
      if (shell.querySelector("dialog[open]")) return;
      if (!menu.hidden) { closeMenu(); return; }
      if (!sheet.hidden) { closeLayer(sheet); return; }
      if (!composer.hidden) { closeLayer(composer); if (!wide()) setPane("list"); return; }
      if (!docked() && shell.dataset.sidebar === "open") setSidebar(false);
      return;
    }
    if (typing) return;
    if (event.key === "\\") {
      event.preventDefault();
      if (!wide()) setPane(shell.dataset.pane === "folders" ? "list" : "folders");
      else setSidebar(shell.dataset.sidebar !== "open");
    } else if (event.key === "?") {
      event.preventDefault();
      (shell.querySelector("#keys") as HTMLDialogElement).showModal();
    } else if (event.key === "." && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      if (!wide()) setPane("reader");
      openLayer(sheet, document.activeElement instanceof HTMLElement ? document.activeElement : null);
    }
  });

  separator.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    separator.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startW = list.getBoundingClientRect().width;
    const move = (ev: PointerEvent) => setListWidth(startW + ev.clientX - startX);
    const up = () => {
      separator.removeEventListener("pointermove", move);
      separator.removeEventListener("pointerup", up);
    };
    separator.addEventListener("pointermove", move);
    separator.addEventListener("pointerup", up);
  });

  separator.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowRight" ? 16 : -16;
    setListWidth(list.getBoundingClientRect().width + delta);
  });

  const onResize = () => {
    if (wide() && shell.dataset.pane !== "list" && shell.dataset.pane !== "reader") shell.dataset.pane = "list";
    syncPaneChrome();
  };
  matchMedia("(min-width: 800px)").addEventListener("change", onResize);
  matchMedia("(min-width: 1280px)").addEventListener("change", onResize);
  if (!docked()) setSidebar(false);
  syncPaneChrome();
  showEmpty();
}
