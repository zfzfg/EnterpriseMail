import { ApiError, call, explain, rawPath, syncContacts, uploadContacts } from "./api";
import { icon } from "./icons";
import { t } from "./i18n";
import {
  blankCard, displayName, formatAddress, parseCard, toJCard,
  type ContactCard, type CryptoPref, type JAddress
} from "./jcard";

const PAGE = 50;

export interface BookHooks {
  confirm(title: string, text: string, ok: string, danger?: boolean): Promise<boolean>;
  choose(title: string, text: string, ok: string, alt: string): Promise<"ok" | "alt" | "cancel">;
  compose(to: string): void;
  pane(name: "list" | "reader"): void;
  wide(): boolean;
}

/** Adressbuch: Liste links, Karte rechts. Die Daten kommen über die JSON-Aktionen. */
export class Book {
  private search = "";
  private page = 1;
  private count = 0;
  private rows: ContactCard[] = [];
  private draft: ContactCard | null = null;
  private saved = "";
  private checked = new Set<string>();
  private anchor = -1;
  private tab: "person" | "work" | "crypto" = "person";
  private busy = false;
  private request = 0;
  private syncAllowed = false;
  private syncMode = 0;
  private timer = 0;

  constructor(private host: HTMLElement, private hooks: BookHooks) {
    this.host.innerHTML = this.shell();
    matchMedia("(min-width: 800px)").addEventListener("change", () => {
      if (this.host.isConnected) this.renderCard();
    });
    this.host.addEventListener("input", (event) => this.onInput(event));
    this.host.addEventListener("change", (event) => this.onChange(event));
    this.host.querySelector("#book-file")?.addEventListener("change", (event) => {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = "";
      if (file) void this.importFile(file);
    });
    this.renderRows();
    this.renderCard();
  }

  setSync(allowed: boolean, mode: number): void {
    this.syncAllowed = allowed;
    this.syncMode = mode;
    const button = this.host.querySelector<HTMLElement>("[data-op='sync']");
    if (button) button.hidden = !allowed;
  }

  async open(): Promise<void> {
    await this.load();
    this.host.querySelector<HTMLElement>("#book-q")?.focus({ preventScroll: true });
  }

  reload(): Promise<void> {
    return this.load();
  }

  async confirmLeave(): Promise<boolean> {
    if (!this.dirty()) return true;
    const choice = await this.hooks.choose(
      t("GLOBAL.SAVE_CHANGES", "Änderungen speichern?"),
      t("CONTACTS.UNSAVED", "Die Änderungen an diesem Kontakt sind nicht gespeichert."),
      t("GLOBAL.SAVE", "Speichern"),
      t("COMPOSE.DISCARD", "Verwerfen")
    );
    if (choice === "cancel") return false;
    if (choice === "ok") return this.save();
    this.revert();
    return true;
  }

  onKey(event: KeyboardEvent): void {
    const key = event.key.toLowerCase();
    if ((key === "a" && (event.ctrlKey || event.metaKey)) || event.key === "*") {
      event.preventDefault();
      this.rows.forEach((row) => { if (row.id) this.checked.add(row.id); });
      this.renderRows();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (key === "c" || key === "w") {
      event.preventDefault();
      this.write(false);
      return;
    }
    if (event.key === "Delete" || event.key === "#") {
      event.preventDefault();
      void this.remove();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const target = event.target as HTMLElement;
      if (target.getAttribute("role") === "tab" && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        const order: Book["tab"][] = ["person", "work", "crypto"];
        const index = Math.max(0, order.indexOf(this.tab));
        const next = order[(index + (event.key === "ArrowRight" ? 1 : order.length - 1)) % order.length];
        this.tab = next;
        this.renderCard();
        this.host.querySelector<HTMLElement>(`[data-tab='${next}']`)?.focus({ preventScroll: true });
        return;
      }
      if (target.closest(".book-card")) return;
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      this.move(event.key === "ArrowDown" ? 1 : -1);
    }
  }

  async onAction(op: string, target: HTMLElement, event: Event): Promise<void> {
    if (op === "more" || op === "add-menu") {
      this.toggleMenu(op === "more" ? "#book-menu" : "#book-add", target);
      return;
    }
    this.closeMenus();
    if (op === "check") {
      const mouse = event as MouseEvent;
      this.toggleCheck(target.dataset.id || "", mouse.shiftKey);
      return;
    }
    if (op === "open") {
      await this.select(target.dataset.id || "");
      return;
    }
    if (op === "new") { await this.create(); return; }
    if (op === "save") { await this.save(); return; }
    if (op === "delete") { await this.remove(); return; }
    if (op === "write") { this.write(false); return; }
    if (op === "write-all") { this.write(true); return; }
    if (op === "import") { this.host.querySelector<HTMLInputElement>("#book-file")?.click(); return; }
    if (op === "sync") { await this.sync(); return; }
    if (op === "clear-search") { this.setSearch(""); return; }
    if (op === "page") { await this.turn(target.dataset.dir === "next" ? 1 : -1); return; }
    if (op === "back-list") { this.hooks.pane("list"); return; }
    if (op === "tab") {
      this.tab = (target.dataset.tab as Book["tab"]) || "person";
      this.renderCard();
      this.host.querySelector<HTMLElement>(`[data-tab='${this.tab}']`)?.focus({ preventScroll: true });
      return;
    }
    if (op === "add") { this.addField(target.dataset.field || ""); return; }
    if (op === "drop") { this.dropField(target.dataset.field || "", Number(target.dataset.index || 0)); return; }
  }

  private shell(): string {
    const vcf = rawPath("ContactsVcf");
    const csv = rawPath("ContactsCsv");
    return `
      <div class="book-list">
        <div class="pane-head">
          <button type="button" class="icon-btn" data-action="close-book" aria-label="${esc(t("CONTACTS.BACK_TO_MAIL", "Zum Postfach"))}" title="${esc(t("CONTACTS.BACK_TO_MAIL", "Zum Postfach"))}">${icon("back")}</button>
          <h1 class="title title-md">${esc(t("GLOBAL.CONTACTS", "Kontakte"))}</h1>
          <span class="spacer"></span>
          <button type="button" class="icon-btn" data-action="book" data-op="new" aria-label="${esc(t("CONTACTS.BUTTON_ADD_CONTACT", "Kontakt hinzufügen"))}" title="${esc(t("CONTACTS.BUTTON_ADD_CONTACT", "Kontakt hinzufügen"))}">${icon("plus")}</button>
          <button type="button" class="icon-btn" data-action="book" data-op="write" aria-label="${esc(t("CONTACTS.MAIL_SELECTION", "Mail an Auswahl"))}" title="${esc(t("CONTACTS.MAIL_SELECTION", "Mail an Auswahl"))}">${icon("compose")}</button>
          <button type="button" class="icon-btn" data-action="book" data-op="delete" aria-label="${esc(t("GLOBAL.DELETE", "Löschen"))}" title="${esc(t("GLOBAL.DELETE", "Löschen"))}">${icon("delete")}</button>
          <div class="bar-more">
            <button type="button" class="icon-btn" data-action="book" data-op="more" aria-haspopup="menu" aria-expanded="false" aria-controls="book-menu" aria-label="${esc(t("GLOBAL.MORE", "Mehr"))}" title="${esc(t("GLOBAL.MORE", "Mehr"))}">${icon("more")}</button>
            <div class="menu menu-right" id="book-menu" role="menu" hidden>
              <button type="button" class="menu-item" role="menuitem" data-action="book" data-op="import">${icon("upload")}<span>${esc(t("CONTACTS.BUTTON_IMPORT", "Import (csv, vcf, vCard)"))}</span></button>
              <a class="menu-item" role="menuitem" href="${esc(vcf)}" download="contacts.vcf">${icon("download")}<span>${esc(t("CONTACTS.BUTTON_EXPORT_VCARD", "Export (vcf, vCard)"))}</span></a>
              <a class="menu-item" role="menuitem" href="${esc(csv)}" download="contacts.csv">${icon("download")}<span>${esc(t("CONTACTS.BUTTON_EXPORT_CSV", "Export (csv)"))}</span></a>
              <button type="button" class="menu-item" role="menuitem" data-action="book" data-op="write-all">${icon("compose")}<span>${esc(t("CONTACTS.SEND_TO_ALL_CONTACT_EMAILS", "An alle E-Mail-Adressen schreiben"))}</span></button>
              <button type="button" class="menu-item" role="menuitem" data-action="book" data-op="sync" hidden>${icon("refresh")}<span>${esc(t("CONTACTS.SYNC_NOW", "Jetzt synchronisieren"))}</span></button>
            </div>
          </div>
        </div>
        <form class="search-wrap" data-action="book-search">
          <label class="sr" for="book-q">${esc(t("GLOBAL.SEARCH", "Suchen"))}</label>
          <input class="search" id="book-q" type="search" placeholder="${esc(t("GLOBAL.SEARCH", "Suchen"))}" autocomplete="off">
          <button type="button" class="icon-btn" data-action="book" data-op="clear-search" hidden aria-label="${esc(t("CONTACTS.CLEAR_SEARCH", "Suche leeren"))}">${icon("close")}</button>
        </form>
        <p class="error" id="book-error" hidden></p>
        <div class="pane-body" id="book-rows"></div>
        <div class="book-pager" id="book-pager"></div>
      </div>
      <div class="book-card">
        <div id="book-card"></div>
      </div>
      <p class="sr" id="book-live" aria-live="polite"></p>
      <input id="book-file" type="file" accept=".csv,.vcf,.vcard,text/csv,text/vcard,text/x-vcard" hidden>`;
  }

  private async load(): Promise<void> {
    const ticket = ++this.request;
    this.busy = true;
    this.note("");
    try {
      const result = await call<{ Count?: number; List?: unknown[] }>("Contacts", {
        Search: this.search, Offset: (this.page - 1) * PAGE, Limit: PAGE
      });
      if (ticket !== this.request) return;
      const list = Array.isArray(result.List) ? result.List : result.List ? Object.values(result.List) : [];
      this.rows = list.map((item) => parseCard(item as { id?: unknown; readOnly?: boolean; jCard?: unknown }));
      this.count = Number(result.Count || 0);
      const pages = Math.max(1, Math.ceil(this.count / PAGE));
      if (this.page > pages) {
        this.page = pages;
        await this.load();
        return;
      }
      if (this.draft?.id && !this.rows.some((row) => row.id === this.draft?.id) && !this.dirty()) this.draft = null;
      this.checked.forEach((id) => { if (!this.rows.some((row) => row.id === id)) this.checked.delete(id); });
    } catch (error) {
      if (ticket !== this.request) return;
      this.rows = [];
      this.count = 0;
      this.fail(error);
    } finally {
      if (ticket === this.request) {
        this.busy = false;
        this.renderRows();
        this.renderPager();
        if (!this.draft) this.renderCard();
      }
    }
  }

  private async select(id: string): Promise<void> {
    if (this.draft?.id === id && id) {
      if (!this.hooks.wide()) this.hooks.pane("reader");
      return;
    }
    if (!(await this.confirmLeave())) return;
    const row = this.rows.find((item) => item.id === id);
    this.draft = row ? clone(row) : null;
    this.tab = "person";
    this.remember();
    this.renderRows();
    this.renderCard();
    if (!this.hooks.wide()) this.hooks.pane("reader");
    this.host.querySelector<HTMLElement>(".book-card input, .book-card button")?.focus({ preventScroll: true });
  }

  private async create(): Promise<void> {
    if (!(await this.confirmLeave())) return;
    this.draft = blankCard();
    this.tab = "person";
    this.remember();
    this.renderRows();
    this.renderCard();
    if (!this.hooks.wide()) this.hooks.pane("reader");
    this.host.querySelector<HTMLInputElement>("[data-field='given']")?.focus({ preventScroll: true });
  }

  private dirty(): boolean {
    return Boolean(this.draft) && JSON.stringify(toJCard(this.draft as ContactCard)) !== this.saved;
  }

  private remember(): void {
    this.saved = this.draft ? JSON.stringify(toJCard(this.draft)) : "";
  }

  /** Verwirft ungespeicherte Eingaben und stellt den zuletzt geladenen Kontakt her. */
  private revert(): void {
    if (!this.draft?.id) {
      this.draft = null;
      this.saved = "";
      this.renderCard();
      return;
    }
    const row = this.rows.find((item) => item.id === this.draft?.id);
    this.draft = row ? clone(row) : null;
    this.remember();
    this.renderCard();
  }

  private async save(): Promise<boolean> {
    const card = this.draft;
    if (!card || card.readOnly) return false;
    if (!displayName(card)) {
      this.fail(new ApiError(0, t("CONTACTS.NEED_NAME", "Name oder E-Mail eintragen.")));
      return false;
    }
    this.busy = true;
    try {
      const result = await call<{ ResultID?: string | number; Result?: boolean }>("ContactSave", {
        uid: card.id, jCard: toJCard(card)
      });
      if (result.Result === false) throw new ApiError(1, t("CONTACTS.ERROR_SAVE", "Der Kontakt konnte nicht gespeichert werden."));
      card.id = String(result.ResultID || card.id);
      card.source = toJCard(card);
      this.remember();
      this.live(t("CONTACTS.SAVED", "Gespeichert"));
      await this.load();
      const fresh = this.rows.find((row) => row.id === card.id);
      if (fresh) this.draft = clone(fresh);
      this.remember();
      this.renderCard();
      return true;
    } catch (error) {
      this.fail(error);
      return false;
    } finally {
      this.busy = false;
    }
  }

  private targets(): ContactCard[] {
    const picked = this.rows.filter((row) => row.id && this.checked.has(row.id));
    if (picked.length) return picked;
    return this.draft ? [this.draft] : [];
  }

  private async remove(): Promise<void> {
    const rows = this.targets().filter((row) => row.id && !row.readOnly);
    if (!rows.length || this.busy) return;
    const what = rows.length === 1
      ? t("CONTACTS.DELETE_ONE", "%NAME% wird aus dem Adressbuch entfernt.").replace("%NAME%", displayName(rows[0]) || t("CONTACTS.THIS_CONTACT", "Dieser Kontakt"))
      : t("CONTACTS.DELETE_MANY", "%N% Kontakte werden aus dem Adressbuch entfernt.").replace("%N%", String(rows.length));
    const ok = await this.hooks.confirm(t("CONTACTS.DELETE_TITLE", "Kontakte löschen?"), what, t("GLOBAL.DELETE", "Löschen"));
    if (!ok) return;
    this.busy = true;
    try {
      await call("ContactsDelete", { uids: rows.map((row) => row.id).join(",") });
      rows.forEach((row) => this.checked.delete(row.id));
      if (this.draft && rows.some((row) => row.id === this.draft?.id)) this.draft = null;
      this.live(rows.length === 1
        ? t("CONTACTS.DELETED_ONE", "Kontakt gelöscht.")
        : t("CONTACTS.DELETED_MANY", "%N% Kontakte gelöscht.").replace("%N%", String(rows.length)));
      await this.load();
      this.renderCard();
    } catch (error) {
      this.fail(error);
    } finally {
      this.busy = false;
    }
  }

  private write(all: boolean): void {
    const lines: string[] = [];
    this.targets().forEach((card) => {
      const emails = card.emails.map((item) => item.trim()).filter(Boolean);
      const use = all || card.sendAll ? emails : emails.slice(0, 1);
      const name = displayName(card);
      use.forEach((email) => lines.push(formatAddress(name, email)));
    });
    if (!lines.length) {
      this.live(t("CONTACTS.NO_EMAIL", "Keine E-Mail-Adresse in der Auswahl."));
      return;
    }
    this.hooks.compose(lines.join(", "));
  }

  private async importFile(file: File): Promise<void> {
    this.busy = true;
    this.note("");
    try {
      const count = await uploadContacts(file);
      this.live(t("CONTACTS.IMPORT_OK", "%N% Kontakte übernommen.").replace("%N%", String(count)));
      this.page = 1;
      await this.load();
    } catch (error) {
      this.fail(error);
    } finally {
      this.busy = false;
    }
  }

  private async sync(): Promise<void> {
    if (!this.syncAllowed) return;
    if (!this.syncMode) {
      this.live(t("CONTACTS.SYNC_OFF", "Die Synchronisierung ist in den Einstellungen aus."));
      return;
    }
    this.busy = true;
    this.note("");
    try {
      await syncContacts();
      this.live(t("CONTACTS.SYNC_OK", "Synchronisiert."));
      await this.load();
    } catch (error) {
      this.fail(error);
    } finally {
      this.busy = false;
    }
  }

  private setSearch(value: string): void {
    this.search = value;
    const input = this.host.querySelector<HTMLInputElement>("#book-q");
    if (input && input.value !== value) input.value = value;
    const clear = this.host.querySelector<HTMLElement>("[data-op='clear-search']");
    if (clear) clear.hidden = !value;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.page = 1;
      void this.load();
    }, 250);
  }

  private async turn(dir: number): Promise<void> {
    const pages = Math.max(1, Math.ceil(this.count / PAGE));
    const next = Math.min(pages, Math.max(1, this.page + dir));
    if (next === this.page) return;
    if (!(await this.confirmLeave())) return;
    this.page = next;
    this.draft = null;
    await this.load();
    this.renderCard();
    this.host.querySelector<HTMLElement>("[data-op='open']")?.focus({ preventScroll: true });
  }

  private move(dir: number): void {
    if (!this.rows.length) return;
    const index = this.rows.findIndex((row) => row.id === this.draft?.id);
    const next = this.rows[Math.min(this.rows.length - 1, Math.max(0, index + dir))];
    if (next) void this.select(next.id);
  }

  private toggleCheck(id: string, range: boolean): void {
    if (!id) return;
    const ids = this.rows.map((row) => row.id);
    const index = ids.indexOf(id);
    if (range && this.anchor >= 0 && index >= 0) {
      const [from, to] = [this.anchor, index].sort((a, b) => a - b);
      for (let cursor = from; cursor <= to; cursor += 1) if (ids[cursor]) this.checked.add(ids[cursor]);
    } else if (this.checked.has(id)) this.checked.delete(id);
    else this.checked.add(id);
    this.anchor = index;
    this.renderRows();
  }

  private addField(field: string): void {
    const card = this.draft;
    if (!card || card.readOnly) return;
    if (field === "email") card.emails.push("");
    else if (field === "phone") card.phones = (card.phones || []).concat("");
    else if (field === "url") card.urls = (card.urls || []).concat("");
    else if (field === "address") card.addresses = (card.addresses || []).concat(emptyAddress());
    else if (field === "nickname") card.nickname = card.nickname ?? "";
    else if (field === "note") card.note = card.note ?? "";
    else if (field === "birthday") card.birthday = card.birthday ?? "";
    else if (field === "tags") card.tags = card.tags ?? "";
    this.tab = field === "tags" ? "person" : this.tab;
    this.renderCard();
    const selector = field === "address" ? "[data-field='street']" : `[data-field='${field === "phone" ? "phone" : field === "email" ? "email" : field}']`;
    const nodes = this.host.querySelectorAll<HTMLElement>(selector);
    nodes[nodes.length - 1]?.focus({ preventScroll: true });
  }

  private dropField(field: string, index: number): void {
    const card = this.draft;
    if (!card || card.readOnly) return;
    if (field === "email") {
      card.emails.splice(index, 1);
      if (!card.emails.length) card.emails = [""];
    } else if (field === "phone" && card.phones) {
      card.phones.splice(index, 1);
      if (!card.phones.length) card.phones = null;
    } else if (field === "url" && card.urls) {
      card.urls.splice(index, 1);
      if (!card.urls.length) card.urls = null;
    } else if (field === "address" && card.addresses) {
      card.addresses.splice(index, 1);
      if (!card.addresses.length) card.addresses = null;
    } else if (field === "nickname") card.nickname = null;
    else if (field === "note") card.note = null;
    else if (field === "birthday") card.birthday = null;
    else if (field === "tags") card.tags = null;
    this.renderCard();
  }

  private onInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.id === "book-q") {
      this.setSearch(input.value);
      return;
    }
    this.patch(input);
  }

  private onChange(event: Event): void {
    const input = event.target as HTMLInputElement | HTMLSelectElement;
    if (input.dataset.field) this.patch(input);
  }

  private patch(input: HTMLInputElement | HTMLSelectElement): void {
    const card = this.draft;
    const field = input.dataset.field || "";
    if (!card || !field) return;
    const index = Number(input.dataset.index || 0);
    const value = input.value;
    if (field === "given") card.given = value;
    else if (field === "middle") card.middle = value;
    else if (field === "surname") card.surname = value;
    else if (field === "prefix") card.prefix = value;
    else if (field === "suffix") card.suffix = value;
    else if (field === "nickname") card.nickname = value;
    else if (field === "note") card.note = value;
    else if (field === "birthday") card.birthday = value;
    else if (field === "org") card.org = value;
    else if (field === "department") card.department = value;
    else if (field === "title") card.title = value;
    else if (field === "tags") card.tags = value;
    else if (field === "email") card.emails[index] = value;
    else if (field === "phone" && card.phones) card.phones[index] = value;
    else if (field === "url" && card.urls) card.urls[index] = value;
    else if (field === "sign" || field === "encrypt") card[field] = value as CryptoPref;
    else if (card.addresses && ["pobox", "ext", "street", "locality", "region", "code", "country"].includes(field)) {
      card.addresses[index][field as keyof JAddress] = value;
    } else if (field === "send-all") card.sendAll = (input as HTMLInputElement).checked;
    if (["given", "middle", "surname", "prefix", "suffix", "nickname", "email"].includes(field)) this.renderRows();
  }

  private renderRows(): void {
    const box = this.host.querySelector("#book-rows");
    const clear = this.host.querySelector<HTMLElement>("[data-op='clear-search']");
    if (clear) clear.hidden = !this.search;
    if (!box) return;
    if (!this.rows.length && !this.busy) {
      const empty = this.search
        ? t("CONTACTS.EMPTY_SEARCH", "Keine Kontakte gefunden")
        : t("CONTACTS.EMPTY_LIST", "Keine Kontakte");
      box.innerHTML = `<div class="empty"><span class="icon icon-lg">${icon("contacts")}</span><p>${esc(empty)}</p>${this.search ? "" : `<button type="button" class="ink-btn" data-action="book" data-op="new">${icon("plus")}<span class="btn-label">${esc(t("CONTACTS.BUTTON_ADD_CONTACT", "Kontakt hinzufügen"))}</span></button>`}</div>`;
      return;
    }
    if (!this.rows.length) {
      box.innerHTML = `<p class="quiet">${esc(t("GLOBAL.LOADING", "Wird geladen"))} …</p>`;
      return;
    }
    box.innerHTML = `<div class="book-rows" role="list">${this.rows.map((row) => {
      const shown = this.draft?.id === row.id ? this.draft : row;
      const name = displayName(shown) || t("CONTACTS.BUTTON_ADD_CONTACT", "Kontakt");
      const mail = shown.emails.find((item) => item.trim()) || "";
      const current = this.draft?.id === row.id;
      const on = this.checked.has(row.id);
      return `<div class="book-row" role="listitem"${current ? ` aria-current="true"` : ""}>
        <label class="book-check"><input type="checkbox" data-action="book" data-op="check" data-id="${esc(row.id)}"${on ? " checked" : ""} aria-label="${esc(t("CONTACTS.SELECT", "Auswählen: %NAME%").replace("%NAME%", name))}"></label>
        <button type="button" class="book-open" data-action="book" data-op="open" data-id="${esc(row.id)}">
          <strong>${esc(name)}</strong>
          ${mail ? `<span class="quiet">${esc(mail)}</span>` : ""}
        </button>
      </div>`;
    }).join("")}</div>`;
  }

  private renderPager(): void {
    const box = this.host.querySelector("#book-pager");
    if (!box) return;
    const pages = Math.max(1, Math.ceil(this.count / PAGE));
    if (pages < 2) {
      box.innerHTML = "";
      box.setAttribute("hidden", "");
      return;
    }
    box.removeAttribute("hidden");
    const label = t("CONTACTS.PAGE_STATUS", "Seite %P% von %N%").replace("%P%", String(this.page)).replace("%N%", String(pages));
    box.innerHTML = `
      <button type="button" class="text-btn" data-action="book" data-op="page" data-dir="prev"${this.page <= 1 ? " disabled" : ""}>${icon("chevron-left")}<span class="btn-label">${esc(t("GLOBAL.BACK", "Zurück"))}</span></button>
      <span class="quiet">${esc(label)}</span>
      <button type="button" class="text-btn" data-action="book" data-op="page" data-dir="next"${this.page >= pages ? " disabled" : ""}><span class="btn-label">${esc(t("CONTACTS.NEXT_PAGE", "Weiter"))}</span>${icon("chevron-right")}</button>`;
  }

  private renderCard(): void {
    const box = this.host.querySelector("#book-card");
    if (!box) return;
    const card = this.draft;
    if (!card) {
      box.innerHTML = `<div class="empty"><span class="icon icon-lg">${icon("contacts")}</span><p>${esc(t("CONTACTS.CONTACT_VIEW_DESC", "Kontakt aus der Liste wählen, um ihn anzuzeigen."))}</p></div>`;
      return;
    }
    const lock = card.readOnly;
    const dis = lock ? " disabled" : "";
    const canEdit = !lock;
    const back = this.hooks.wide() ? "" : `<button type="button" class="icon-btn" data-action="book" data-op="back-list" aria-label="${esc(t("GLOBAL.BACK", "Zurück"))}">${icon("back")}</button>`;
    const heading = displayName(card) || t("CONTACTS.BUTTON_CREATE_CONTACT", "Kontakt anlegen");
    box.innerHTML = `
      <div class="book-card-head">
        ${back}
        <h2 class="title title-md">${esc(heading)}</h2>
        ${lock ? `<p class="quiet">${esc(t("CONTACTS.LABEL_READ_ONLY", "Schreibgeschützt"))}</p>` : `<button type="button" class="ink-btn" data-action="book" data-op="save">${icon("save")}<span class="btn-label">${esc(card.id ? t("GLOBAL.SAVE", "Speichern") : t("CONTACTS.BUTTON_CREATE_CONTACT", "Kontakt anlegen"))}</span></button>`}
      </div>
      <div class="book-tabs" role="tablist" aria-label="${esc(t("GLOBAL.CONTACTS", "Kontakte"))}">
        ${this.tabButton("person", t("CONTACTS.TAB_CONTACT", "Kontakt"))}
        ${this.tabButton("work", t("CONTACTS.TAB_BUSINESS", "Unternehmen"))}
        ${this.tabButton("crypto", t("CONTACTS.TAB_CRYPTO", "Verschlüsselung"))}
      </div>
      <div class="book-panels">
        <div role="tabpanel" id="book-panel-person" ${this.tab === "person" ? "" : "hidden"}>
          ${this.text("prefix", t("CONTACTS.NAME_PREFIX", "Vorsatz"), card.prefix, "honorific-prefix", dis)}
          ${this.text("given", t("CONTACTS.FIRST_NAME", "Vorname"), card.given, "given-name", dis)}
          ${this.text("middle", t("CONTACTS.MIDDLE_NAME", "Weiterer Vorname"), card.middle, "additional-name", dis)}
          ${this.text("surname", t("CONTACTS.LAST_NAME", "Nachname"), card.surname, "family-name", dis)}
          ${this.text("suffix", t("CONTACTS.NAME_SUFFIX", "Nachsatz"), card.suffix, "honorific-suffix", dis)}
          ${card.nickname == null ? "" : this.text("nickname", t("CONTACTS.NICK_NAME", "Spitzname"), card.nickname, "nickname", dis, canEdit)}
          <fieldset class="book-group">
            <legend class="mono">${esc(t("GLOBAL.EMAIL", "E-Mail"))}</legend>
            <label class="check"><input type="checkbox" data-field="send-all"${card.sendAll ? " checked" : ""}${dis}> ${esc(t("CONTACTS.SEND_TO_ALL_CONTACT_EMAILS", "An alle E-Mail-Adressen schreiben"))}</label>
            ${card.emails.map((value, index) => this.row("email", value, index, "email", dis, canEdit && card.emails.length > 1)).join("")}
          </fieldset>
          ${card.phones ? this.group(t("CONTACTS.ADD_MENU_PHONE", "Telefon"), card.phones.map((value, index) => this.row("phone", value, index, "tel", dis, canEdit)).join("")) : ""}
          ${card.urls ? this.group(t("CONTACTS.ADD_MENU_URL", "URL"), card.urls.map((value, index) => this.row("url", value, index, "url", dis, canEdit)).join("")) : ""}
          ${card.addresses ? card.addresses.map((item, index) => this.address(item, index, dis, canEdit)).join("") : ""}
          ${card.birthday == null ? "" : this.text("birthday", t("CONTACTS.LABEL_BIRTHDAY", "Geburtstag"), card.birthday, "bday", dis, canEdit, "date")}
          ${card.note == null ? "" : this.area("note", t("CONTACTS.ADD_MENU_NOTE", "Anmerkung"), card.note, dis, canEdit)}
          ${card.tags == null ? "" : this.text("tags", t("CONTACTS.ADD_MENU_TAGS", "Schlagwörter"), card.tags, "off", dis, canEdit)}
        </div>
        <div role="tabpanel" id="book-panel-work" ${this.tab === "work" ? "" : "hidden"}>
          ${this.text("org", t("CONTACTS.LABEL_ORGANIZATION", "Organisation"), card.org, "organization", dis)}
          ${this.text("department", t("CONTACTS.LABEL_DEPARTMENT", "Abteilung"), card.department, "organization", dis)}
          ${this.text("title", t("CONTACTS.LABEL_TITLE", "Titel"), card.title, "organization-title", dis)}
        </div>
        <div role="tabpanel" id="book-panel-crypto" ${this.tab === "crypto" ? "" : "hidden"}>
          ${this.crypto("sign", t("CRYPTO.SIGN", "Unterschreiben"), card.sign, dis)}
          ${this.crypto("encrypt", t("CRYPTO.ENCRYPT", "Verschlüsseln"), card.encrypt, dis)}
        </div>
      </div>
      ${lock ? "" : `<div class="book-add bar-more">
        <button type="button" class="text-btn" data-action="book" data-op="add-menu" aria-haspopup="menu" aria-expanded="false" aria-controls="book-add">${icon("plus")}<span class="btn-label">${esc(t("CONTACTS.ADD_MENU_LABEL", "Hinzufügen"))}</span></button>
        <div class="menu" id="book-add" role="menu" hidden>
          ${card.nickname == null ? this.addItem("nickname", t("CONTACTS.ADD_MENU_NICKNAME", "Spitzname")) : ""}
          ${this.addItem("email", t("GLOBAL.EMAIL", "E-Mail"))}
          ${this.addItem("phone", t("CONTACTS.ADD_MENU_PHONE", "Telefon"))}
          ${this.addItem("url", t("CONTACTS.ADD_MENU_URL", "URL"))}
          ${this.addItem("address", t("CONTACTS.ADD_MENU_ADDRESS", "Adresse"))}
          ${card.birthday == null ? this.addItem("birthday", t("CONTACTS.ADD_MENU_BIRTHDAY", "Geburtstag")) : ""}
          ${card.note == null ? this.addItem("note", t("CONTACTS.ADD_MENU_NOTE", "Anmerkung")) : ""}
          ${card.tags == null ? this.addItem("tags", t("CONTACTS.ADD_MENU_TAGS", "Schlagwörter")) : ""}
        </div>
      </div>`}`;
  }

  private tabButton(id: Book["tab"], label: string): string {
    const on = this.tab === id;
    return `<button type="button" role="tab" id="book-tab-${id}" aria-controls="book-panel-${id}" aria-selected="${on ? "true" : "false"}" tabindex="${on ? "0" : "-1"}" data-action="book" data-op="tab" data-tab="${id}">${esc(label)}</button>`;
  }

  private text(field: string, label: string, value: string, auto: string, dis: string, drop = false, type = "text"): string {
    return `<label class="field"><span>${esc(label)}</span><span class="book-line"><input data-field="${field}" type="${type}" value="${esc(value)}" autocomplete="${esc(auto)}"${dis}>${drop ? this.drop(field, 0, label) : ""}</span></label>`;
  }

  private area(field: string, label: string, value: string, dis: string, drop: boolean): string {
    return `<label class="field"><span>${esc(label)}</span><span class="book-line"><textarea data-field="${field}"${dis}>${esc(value)}</textarea>${drop ? this.drop(field, 0, label) : ""}</span></label>`;
  }

  private row(field: string, value: string, index: number, auto: string, dis: string, drop: boolean): string {
    const type = field === "email" ? "email" : field === "phone" ? "tel" : field === "url" ? "url" : "text";
    return `<span class="book-line"><input data-field="${field}" data-index="${index}" type="${type}" value="${esc(value)}" autocomplete="${auto}"${field === "url" ? ` placeholder="https://"` : ""}${dis}>${drop ? this.drop(field, index, field) : ""}</span>`;
  }

  private address(item: JAddress, index: number, dis: string, drop: boolean): string {
    const line = (field: keyof JAddress, label: string, auto: string) =>
      `<label class="field"><span>${esc(label)}</span><input data-field="${field}" data-index="${index}" type="text" value="${esc(item[field])}" autocomplete="${auto}"${dis}></label>`;
    return `<fieldset class="book-group"><legend class="mono">${esc(t("CONTACTS.ADD_MENU_ADDRESS", "Adresse"))}</legend>
      ${line("street", t("CONTACTS.STREET", "Straße"), "street-address")}
      ${line("ext", t("CONTACTS.EXT", "Adresszusatz"), "off")}
      ${line("code", t("CONTACTS.POSTCODE", "Postleitzahl"), "postal-code")}
      ${line("locality", t("CONTACTS.LOCALITY", "Ort"), "address-level2")}
      ${line("region", t("CONTACTS.REGION", "Region"), "address-level1")}
      ${line("country", t("CONTACTS.COUNTRY", "Land"), "country-name")}
      ${line("pobox", t("CONTACTS.POBOX", "Postfach"), "off")}
      ${drop ? this.drop("address", index, t("CONTACTS.ADD_MENU_ADDRESS", "Adresse")) : ""}
    </fieldset>`;
  }

  private crypto(field: "sign" | "encrypt", label: string, value: CryptoPref, dis: string): string {
    const options: [CryptoPref, string][] = [
      ["Ask", t("CONTACTS.ASK", "Fragen")],
      ["IfPossible", t("CONTACTS.ALWAYS_IF_POSSIBLE", "Wenn möglich")],
      ["Always", t("CONTACTS.ALWAYS", "Immer")],
      ["Never", t("CONTACTS.NEVER", "Niemals")]
    ];
    return `<label class="field"><span>${esc(label)}</span><select data-field="${field}"${dis}>${options.map(([id, text]) => `<option value="${id}"${id === value ? " selected" : ""}>${esc(text)}</option>`).join("")}</select></label>`;
  }

  private group(legend: string, inner: string): string {
    return `<fieldset class="book-group"><legend class="mono">${esc(legend)}</legend>${inner}</fieldset>`;
  }

  private addItem(field: string, label: string): string {
    return `<button type="button" class="menu-item" role="menuitem" data-action="book" data-op="add" data-field="${field}">${icon("plus")}<span>${esc(label)}</span></button>`;
  }

  private drop(field: string, index: number, label: string): string {
    return `<button type="button" class="icon-btn" data-action="book" data-op="drop" data-field="${field}" data-index="${index}" aria-label="${esc(t("CONTACTS.REMOVE_FIELD", "Feld entfernen") + ": " + label)}">${icon("minus")}</button>`;
  }

  private toggleMenu(selector: string, source: HTMLElement): void {
    const menu = this.host.querySelector<HTMLElement>(selector);
    if (!menu) return;
    const open = menu.hidden;
    this.closeMenus();
    menu.hidden = !open;
    source.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) menu.querySelector<HTMLElement>("[role='menuitem']")?.focus({ preventScroll: true });
  }

  private closeMenus(): void {
    this.host.querySelectorAll<HTMLElement>("#book-menu, #book-add").forEach((menu) => { menu.hidden = true; });
    this.host.querySelectorAll<HTMLElement>("[data-op='more'], [data-op='add-menu']").forEach((button) => button.setAttribute("aria-expanded", "false"));
  }

  private note(text: string): void {
    const slot = this.host.querySelector<HTMLElement>("#book-error");
    if (!slot) return;
    slot.hidden = !text;
    slot.textContent = text;
  }

  private fail(error: unknown): void {
    const text = error instanceof ApiError && error.code === 0 ? error.message : explain(error);
    this.note(text);
  }

  private live(text: string): void {
    this.note("");
    const slot = this.host.querySelector("#book-live");
    if (slot) slot.textContent = text;
  }
}

function emptyAddress(): JAddress {
  return { pobox: "", ext: "", street: "", locality: "", region: "", code: "", country: "" };
}

function clone(card: ContactCard): ContactCard {
  return {
    ...card,
    emails: card.emails.slice(),
    phones: card.phones ? card.phones.slice() : null,
    urls: card.urls ? card.urls.slice() : null,
    addresses: card.addresses ? card.addresses.map((item) => ({ ...item })) : null,
    source: card.source
  };
}

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  }[char] ?? char));
}

export function mountBook(host: HTMLElement, hooks: BookHooks): Book {
  return new Book(host, hooks);
}
