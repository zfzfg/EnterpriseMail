# Hinweise für Agenten

Dieses Repo ist der Fork `zfzfg/snappymail`. Das PHP-JSON von SnappyMail bleibt die API. Die Oberfläche ist der TypeScript-Client unter `ui/`. Lies die README, bevor du Installationswege aus dem Upstream übernimmst.

## Wo was liegt

- `ui/src/main.ts` startet das Postfach, `ui/src/admin.ts` den Admin. Beide sind getrennte esbuild-Bundles.
- `ui/src/api.ts` ist der einzige HTTP-Client. `call` spricht `/?/Json/`, `adminCall` spricht `/?/{adminKey}/Json/`, `plugin` hängt `Plugin` vor die Aktion, `streamEvents` liest SSE von `/?/AiStream/`. Keinen zweiten Client daneben bauen.
- `ui/src/mail.ts` hält die Sitzung. `ui/src/view.ts` malt das Postfach. `ui/src/assistant.ts` liest, ob der Assistent überhaupt an ist. `ui/src/settings.ts` lädt Konten, Identitäten, Kontakte, Filter und Schlüssel.
- Symbole: Quelle `ui/src/icons/icons.txt` (9×9-Pixelraster), `ui/scripts/icons.mjs` erzeugt `ui/src/icons.ts`. Nur `icon(name)` verwenden, keine fremden SVGs. Größe 20 px oder 40 px. Reine Symbolknöpfe brauchen `aria-label`.
- `ui/src/styles/app-tokens.css` ist die einzige Token-Datei. Der Dateiname muss `app-tokens.css` bleiben. Tailwind kommt über `ui/src/styles/app.css`, die Mail-Teile über `shell.css`.
- Ausgabe: `snappymail/v/0.0.0/static/css/app.css`, `static/css/admin.css`, `static/js/app.js`, `static/js/admin.js`, `static/fonts/`. `Service.php` zeigt für `data-admin="0"` auf `app.*` und für `data-admin="1"` auf `admin.*`.
- `plugins/ai-copilot` ist PHP plus Sprachdateien. Kein eigenes `style.css` und kein Knockout. Die Hooks sind die Schnittstelle.
- `data/` und ein eigenes `include.php` im Wurzelverzeichnis sind lokal und nicht im Git.

## Oberfläche

Deutsch, Satzschrift, über `t(pfad, fallback)` und `rl.I18N`. Vorhandene Schlüssel behalten. Neue Sätze nach `snappymail/v/0.0.0/app/localization/de` und `en`, Fallback im Aufruf auf Deutsch.

Orange (`--primary`) ist das 6px-Quadrat für „Antwort nötig“, der 2px-Fokusring und `::selection`. Primäre Aktionen sind Tinte: Fläche `--foreground`, Text `--background`. Sekundärtext ist `color-mix(in srgb, var(--foreground) 68%, transparent)`, nicht `--muted-foreground` im Dunkelmodus. Kein Mistral-Logo, keine Wortmarke, keine Marketing-Tokens, kein Radius 0.

Erscheinungsbild nur in den Einstellungen (`sm-appearance`: `system`, `light`, `dark`). Der Brief bleibt im sandboxed iframe. Der Assistent ist ein Blatt über dem Brief, keine vierte Spalte. `hidden` an Knöpfen muss vor `.text-btn { display: inline-flex }` gewinnen. Hover nur unter `(hover: hover)`. Fokus nicht die Seite scrollen lassen: `focus({ preventScroll: true })`. `html`, `body`, `.shell` und der Leser bleiben `overflow: hidden`.

Ein Abschnitt in den Einstellungen bleibt zu, wenn die Fähigkeit fehlt (`Capa` in den AppData, sonst `Result: false`). OpenPGP und S/MIME nicht als neues Produkt bauen: listen, importieren, an den Identitätsfeldern lassen. Filter sind die Sieve-Skripte, die der Server schon hat. Kontakte sind jCard.

Der Admin teilt die Token-Datei. Dichte Formulare, kein zweites Erscheinungsbild.

## Assistent

Jede KI-Aktion erst auf Klick. `cacheOnly` und lokale Schritte (Schlagwort, Hinweiszähler) brauchen keine Einwilligung. Plugin fehlt, `enabled === false` oder keine Funktion an: kein Assistenten-Chrome, das Postfach bleibt wie ohne Plugin. Keinen erfundenen Zustand „nicht verbunden“ zeigen. Zerstören nur nach Bestätigung. Aktionen aus dem Fragen-Blatt laufen über die normalen Mail-Aktionen, Löschen über den vorhandenen Dialog.

## Prüfen

In `ui/`: `npx tsc --noEmit` und `npm run build`. Token-Prüfung, wenn Styles dazukommen: `python` auf `scripts/check_tokens.py` aus dem Skill `mistral-design`, Schicht `app`, Ziel `ui/src`.

Eine Änderung an der sichtbaren Oberfläche im Browser nachsehen. Die Docker-Vorschau steht in `plugins/ai-copilot/dev` (http://localhost:8888, `test@example.com` / `test1234`). Ohne laufenden Mailserver den Stand als Mock kennzeichnen. Ein lebendes Modell nur ansprechen, wenn der Nutzer das will und ein Schlüssel da ist.

## Git

Commit-Betreff auf Deutsch, ein Satz, darunter kurz der Körper. Nur die Pfade stagen, die zur Änderung gehören. `ui/node_modules`, ein Lockfile im Wurzelverzeichnis und `data/` bleiben draußen. CSS, JS und Schriften unter `static/` gehören dazu, wenn der Build sie geändert hat. Force-Push nur, wenn der Nutzer ihn ausdrücklich will, und dann nur nach `origin` dieses Forks.
