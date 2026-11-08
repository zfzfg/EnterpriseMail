# Hinweise für Agenten / Agent Guidelines

Dieses Repo ist der Fork `zfzfg/snappymail`. Das PHP-JSON von SnappyMail bleibt die API für IMAP/SMTP und Kernaktionen. Die Oberfläche ist der moderne TypeScript-Client unter `ui/` (kein Knockout). Für Leistungs- und Architekturverbesserungen gilt der Plan [PLAN-performance-and-rust-expanded.md](file:///c:/Users/zfzfg/Documents/HammerMegaProjekte/SnappyMail-Tailwind-Mistral/snappymail/PLAN-performance-and-rust-expanded.md).

## Wo was liegt

- `ui/src/main.ts` startet das Postfach, `ui/src/admin.ts` den Admin. Beide sind getrennte esbuild-Bundles. Die Admin-Abschnitte liegen unter `ui/src/admin/`.
- `ui/src/api.ts` ist der einzige HTTP-Client. `call` spricht `/?/Json/`, `adminCall` spricht `/?/{adminKey}/Json/`, `plugin` hängt `Plugin` vor die Aktion, `streamEvents` liest SSE von `/?/AiStream/` (bzw. künftig `/api/ai/stream`). Keinen zweiten Client daneben bauen.
- `ui/src/mail.ts` hält die Sitzung und die Mail-Aktionen (`act`). `ui/src/view.ts` malt das Postfach, `ui/src/reader.ts` den Brief und die Sammelansicht.
- `ui/src/compose.ts` steuert den Mail-Editor (HTML/Plain, Adressvalidierung, Entwürfe speichern & wiederaufnehmen).
- `ui/src/clean.ts` säubert HTML-Mails (externe Bilder nur nach Freigabe, nie direkt), `ui/src/letter.ts` baut das srcdoc mit CSP, Druckansicht, ICS und List-Unsubscribe.
- `ui/src/assistant.ts` prüft, ob der KI-Assistent aktiv ist.
- `ui/src/contacts.ts` hält das Adressbuch (Liste, Karte, Import und Export), `ui/src/jcard.ts` die jCard.
- `ui/src/settings.ts` lädt Konten, Identitäten, Filter und Schlüssel und zeichnet Allgemein, Sicherheit, den Assistenten und CardDAV-Synchronisierung.
- `ui/src/sieve/` liest ein Sieve-Skript in Regeln und eine Abwesenheitsnotiz und schreibt diese Form wieder zurück.
- `ui/src/folders.ts` hält das Ordnermodell, den Baum der Seitenleiste, den Abschnitt „Ordner“ und die Freigaben (ACL).
- `ui/src/search.ts` baut die erweiterte Suche und die Schnellfilter.
- `ui/src/crypto.ts` spricht GnuPG und S/MIME (Entschlüsseln, Prüfen, Schlüssel, Autocrypt), ohne OpenPGP.js.
- Symbole: Quelle `ui/src/icons/icons.txt` (9×9-Pixelraster), `ui/scripts/icons.mjs` erzeugt `ui/src/icons.ts`. Nur `icon(name)` verwenden, keine fremden SVGs. Größe 20 px oder 40 px. Reine Symbolknöpfe brauchen `aria-label`.
- `ui/src/styles/app-tokens.css` ist die einzige Token-Datei. Der Dateiname muss `app-tokens.css` bleiben. Tailwind kommt über `ui/src/styles/app.css`, die Mail-Teile über `shell.css`.
- Ausgabe: `snappymail/v/0.0.0/static/css/app.css`, `static/css/admin.css`, `static/js/app.js`, `static/js/admin.js`, `static/fonts/`. `Service.php` zeigt für `data-admin="0"` auf `app.*` und für `data-admin="1"` auf `admin.*`.
- `plugins/ai-copilot` ist das PHP-Plugin für den Mistral-Copilot. Keine Knockout-Altlasten.
- `plugins/`: Nicht benötigte Legacy- und Hosting-Plugins (cPanel, Froxlor, Hestia, Avatare/Gravatar, Demo-Accounts, Schneefall) wurden entfernt. Die verbleibenden Plugins bedienen Enterprise-Anforderungen (2FA, OAuth2, LDAP, Redis).
- `crates/snappy-ai-proxy`: Optionaler/geplanter Rust-Streaming-Sidecar für Mistral ZDR (Axum + Tokio) nach dem Muster *Prepare in PHP, Stream in Rust*.
- `data/` und ein eigenes `include.php` im Wurzelverzeichnis sind lokal und nicht im Git.

## Oberfläche

Deutsch, Satzschrift, über `t(pfad, fallback)` und `rl.I18N`. Vorhandene Schlüssel behalten. Neue Sätze nach `snappymail/v/0.0.0/app/localization/de` und `en`, Fallback im Aufruf auf Deutsch.

Orange (`--primary`) ist das 6px-Quadrat für „Antwort nötig“, der 2px-Fokusring und `::selection`. Primäre Aktionen sind Tinte: Fläche `--foreground`, Text `--background`. Sekundärtext ist `color-mix(in srgb, var(--foreground) 68%, transparent)`, nicht `--muted-foreground` im Dunkelmodus. Kein Mistral-Logo, keine Wortmarke, keine Marketing-Tokens, kein Radius 0.

Erscheinungsbild nur in den Einstellungen (`sm-appearance`: `system`, `light`, `dark`). Der Brief bleibt im sandboxed iframe. Der Assistent ist ein Blatt über dem Brief, keine vierte Spalte. `hidden` an Knöpfen muss vor `.text-btn { display: inline-flex }` gewinnen. Hover nur unter `(hover: hover)`. Fokus nicht die Seite scrollen lassen: `focus({ preventScroll: true })`. `html`, `body`, `.shell` und der Leser bleiben `overflow: hidden`.

Ein Abschnitt in den Einstellungen bleibt zu, wenn die Fähigkeit fehlt (`Capa` in den AppData, sonst `Result: false`). OpenPGP und S/MIME nicht als neues Produkt bauen: die Server-Aktionen nutzen, Schlüssel listen, importieren und an den Identitätsfeldern lassen.

## Assistent & KI (Mistral ZDR)

Jede KI-Aktion erst auf Klick. `cacheOnly` und lokale Schritte (Schlagwort, Hinweiszähler) brauchen keine Einwilligung. Plugin fehlt, `enabled === false` oder keine Funktion an: kein Assistenten-Chrome, das Postfach bleibt wie ohne Plugin. Keinen erfundenen Zustand „nicht verbunden“ zeigen. Zerstören nur nach Bestätigung. Aktionen aus dem Fragen-Blatt laufen über die normalen Mail-Aktionen, Löschen über den vorhandenen Dialog.

Zero Data Retention (ZDR) ist ein vertragliches Provider-Merkmal von Mistral. Der lokale Dienst (PHP oder Rust-Sidecar) garantiert lokale Compliance: Niemals Prompts, E-Mail-Inhalte, Antworten oder Session-Tokens in Logs schreiben oder auf Festplatte zwischenspeichern.

## Speicher & Wartung (Storage Safety)

- **Keine direkten Eingriffe in SQLite-Sidecars:** Niemals `.wal`, `.shm` oder Rollback-Journale manuell löschen.
- **Konservative Aufbewahrungszeiten:** Temporäre Entwurfsanhänge in `.files/` bleiben mindestens 48 Stunden erhalten (keine vorzeitige Löschung aktiver Entwürfe).
- **Hintergrundwartung:** Die PHP-Wartung `AppDelayStart` wird von der UI asynchron nach dem Start angestoßen, um Caches und abgelaufene Temp-Dateien sicher über den bestehenden PHP-Mechanismus zu bereinigen.

## Prüfen

- In `ui/`: `npx tsc --noEmit` und `npm run build`.
- **Browser-Tests (Chrome Headless):** Änderungen an der sichtbaren Oberfläche und End-to-End-Prüfungen werden mit **Chrome Headless** durchgeführt (z. B. via Puppeteer / Playwright oder headless Chrome-CLI).
  - **Entwicklungsumgebung & Testserver:** Unter `plugins/ai-copilot/dev` (`docker compose up -d` unter http://localhost:8888, Login: `test@example.com` / `test1234`).
  - **Screenshots & Visuelle Verifikation:** Liegen bzw. gehören nach `plugins/ai-copilot/dev/shots/`.
  - Ohne laufenden Mailserver den Stand als Mock kennzeichnen. Ein lebendes Modell nur ansprechen, wenn der Nutzer das will und ein Schlüssel da ist.
- **Token-Prüfung:** Wenn Styles dazukommen: `python` auf `scripts/check_tokens.py` aus dem Skill `mistral-design`, Schicht `app`, Ziel `ui/src`.

## Git & Commits

- **Commit-Sprache:** Commits werden auf **Englisch** verfasst (z. B. `feat: add OPcache configuration to release Dockerfile` oder `fix: invoke AppDelayStart on application boot`).
- **Frequenz:** Commits **regelmäßig und inkrementell** nach jedem logisch abgeschlossenen und verifizierten Teilschritt durchführen (keine gigantischen uncommitted Änderungen anhäufen).
- **Staging:** Nur die Pfade stagen, die zur Änderung gehören. `ui/node_modules`, Lockfiles im Wurzelverzeichnis, `data/` und Scratch-Dateien bleiben draußen. CSS, JS und Schriften unter `static/` gehören dazu, wenn der Build sie geändert hat.
- Force-Push nur, wenn der Nutzer ihn ausdrücklich will, und dann nur nach `origin` dieses Forks.
