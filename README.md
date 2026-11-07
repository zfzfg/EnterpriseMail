# SnappyMail

Fork von [the-djmaze/snappymail](https://github.com/the-djmaze/snappymail) (selbst ein Fork von RainLoop). Das PHP-Protokoll bleibt. Die Oberfläche ist ein eigener Client in TypeScript, und der KI-Assistent sitzt in dieser Oberfläche.

Postfach: drei Spalten, Brief in einem sandboxed iframe, Assistent als Blatt auf dem Brief. Deutsch, Satzschrift. Erscheinungsbild folgt `prefers-color-scheme`. Der Schalter dafür liegt in den Einstellungen.

## Bauen

Die Quellen liegen unter `ui/`. PHP lädt das Ergebnis aus `snappymail/v/0.0.0/static/`.

```sh
cd ui
npm install
npm run build
npm run typecheck
```

Vom Repo-Wurzelverzeichnis aus genügt `npm run build:ui`.

| Befehl | Ergebnis |
| --- | --- |
| `npm run build:js` | `static/js/app.js` und `static/js/admin.js` |
| `npm run build:css` | `static/css/app.css`, Kopie als `static/css/admin.css` |
| `npm run build:fonts` | Inter und Space Mono nach `static/fonts/` |

CSS, JS und Schriften werden mitcommittet. `ui/node_modules` nicht. Es gibt kein UI-Framework. Der Mail-Client startet bei `ui/src/main.ts`, der Admin bei `ui/src/admin.ts`.

## Vorschau

Die Entwicklungsumgebung steht in `plugins/ai-copilot/dev`. Der erste Start baut das Image und dauert. Danach hängt Compose `index.php` und `snappymail/` aus diesem Baum in den Container. Ein erneutes `npm run build` in `ui/` ist im Browser nach einem Reload sichtbar.

```sh
cd plugins/ai-copilot/dev
docker compose up -d
python seed.py
```

Die Seite ist nur auf dem eigenen Rechner erreichbar: http://localhost:8888

| | |
| --- | --- |
| Postfach | `test@example.com` / `test1234` |
| Zweites Konto | `kollege@example.com` / `test1234` |
| Admin | http://localhost:8888/?admin |

Benutzer im Admin ist `admin`. Das Passwort erzeugt die Installation selbst:

```sh
docker compose exec snappymail cat /var/lib/snappymail/_data_/_default_/admin_password.txt
```

`python seed.py` legt die Domain `example.com` an, schaltet das Plugin ein und schreibt Testdaten. `python seed.py --mails` setzt nur die Mails zurück. Der Testmailserver spricht IMAP und SMTP. ManageSieve ist in dieser Compose-Datei aus, deshalb bleibt der Filter-Abschnitt in der Vorschau zu, bis Sieve am Konto an ist.

Ein Mistral-Schlüssel ist für die Postfach-Oberfläche nicht nötig. Für echte Modellantworten liegt die Datei außerhalb des Repos, standardmäßig `MISTRAL-API-KEY.env` neben dem Checkout. Ein anderer Pfad geht über `AI_KEY_FILE`. Ohne Schlüssel bleiben die Klick-Aktionen ohne Modell.

## Assistent

Das Plugin ist `plugins/ai-copilot`. Zusammenfassung, Entwurf, Sprachsuche, Einordnung, Fragen und Fristen laufen über die vorhandenen JSON- und SSE-Hooks. Inhalt geht erst beim Klick an den Anbieter. Ist das Plugin aus oder das Konto abgeschaltet, sieht die Oberfläche aus wie das Postfach ohne Assistent.

Die Plugin-Beschreibung steht in `plugins/ai-copilot/README`. Die ältere Schilderung einer Seitenleiste und eines Zauberstabs gilt für diese Oberfläche nicht mehr. Der Assistent ist das Blatt auf dem Brief.

## Einstellungen und Admin

Einstellungen hängen am Konto-Menü: Erscheinungsbild, Allgemein, Sicherheit, Konten, Identitäten, Filter, Schlüssel und, wenn das Plugin aktiv ist, der Assistent. Das Adressbuch ist eine eigene Ansicht in der Seitenleiste und im Konto-Menü (`ui/src/contacts.ts`). In den Einstellungen bleibt davon nur die CardDAV-Synchronisierung, und nur wenn die AppData `ContactsSync` enthalten. Allgemein, Sicherheit und diese Synchronisierung speichern jedes Feld sofort. Ein Abschnitt bleibt zu, wenn der Server die Fähigkeit nicht hat. OpenPGP und S/MIME sind Liste, Import und die Felder an der Identität. Eine abgelaufene Sitzung öffnet den Anmelde-Dialog über dem Postfach.

Der Admin ist dieselbe Token-Datei, dicht, unter `/?admin`. Anmeldung, Domainliste, Aktivieren, Deaktivieren, Löschen, Abmelden.

## Was in diesem Baum gilt

- UI-Build ist npm in `ui/` mit Tailwind 4 und esbuild. Gulp, Yarn und Knockout sind nicht der Weg für diese Oberfläche.
- `index.php` lädt Version `0.0.0`. Die Release-Kette, die daraus eine Versionsnummer macht, liegt noch unter `cli/release.php` und `.docker/release`.
- PHP 8.2 ist die Untergrenze aus dem Upstream-Changelog. Das Vorschau-Image nutzt PHP 8.5.
- Konfiguration und Postfachdaten liegen unter `data/` bzw. im Container unter `/var/lib/snappymail`. Beides ist nicht Teil des Git-Baums.
- Designs Slate und SlateDark liegen nicht in diesem Repo.

## Lizenz

GNU Affero General Public License 3.0, Text in `LICENSE`.

Copyright der Upstream-Projekte bleibt bei SnappyMail und RainLoop. Dieser Fork ändert die Lizenz nicht.
