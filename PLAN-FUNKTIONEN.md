# Plan: Alte Funktionen in die neue Oberfläche holen

Stand: 2026-11-07, Repo `zfzfg/snappymail`, Branch `master` (Phasen 0–5 erledigt, siehe Abschnitte 4a, 5, 6 und 7).
Bezugspunkt: Seit `90127a2d6` (Neue Mail-Hülle) läuft die Oberfläche als eigener TypeScript-Client unter `ui/`. Das alte Knockout-Frontend wurde in `388c3815d` entfernt. Den letzten vollständigen Stand des alten Frontends enthält **`387e27b19`**.

Dieser Plan ist für eine KI geschrieben, die ihn umsetzt. Arbeite die Phasen der Reihe nach ab. Jede Phase endet mit einem Commit und einer Prüfung im Browser.

---

## 0. Vorab lesen und Regeln

1. `AGENTS.md` lesen und befolgen. Diese Datei schlägt jede Abweichung in diesem Plan.
2. `README.md`, Abschnitte „Bauen“ und „Vorschau“.
3. Die Skills **`/mistral-design`** und **`/apple-design`** vor jeder Phase mit sichtbarer Oberfläche laden:
   - `mistral-design` gibt die Gestaltung vor: Tokens aus `ui/src/styles/app-tokens.css`, Schicht `app`, Hairlines, Space-Mono-Labels, Tintenknöpfe, Pixel-Icons. Kein Mistral-Logo, keine Pixel-Katze, kein Name „Mistral“ als Marke (siehe `AGENTS.md`).
   - `apple-design` prüft Bedienbarkeit: Hierarchie, Trefferflächen (mindestens 44×44 px auf Touch, 28 px am Desktop), Tastatur, Fokus, Kontrast, Dunkelmodus, Leerzustände, Bestätigungen, Formulare, Fehlermeldungen. Am Ende jeder Phase einen Review mit dem Skill über die geänderten Ansichten laufen lassen und die Befunde beheben.
4. Das alte Verhalten liest du so nach, ohne etwas auszuchecken:
   ```sh
   git show 387e27b19:dev/View/Popup/Compose.js
   git show 387e27b19:snappymail/v/0.0.0/app/templates/Views/User/PopupsCompose.html
   git ls-tree -r --name-only 387e27b19 -- dev
   ```
   Die Server-Aktionen stehen in `snappymail/v/0.0.0/app/libraries/RainLoop/Actions/*.php` (`Do<Aktion>`) und in `ServiceActions.php` (`Service<Name>` für Upload, Raw, Mailto, ProxyExternal).

### Feste Regeln

- **Keine Themes.** `Theme`, `theme`, Theme-Schriften (`fontSansSerif`, `fontSerif`, `fontMono`) und Hintergrundbilder (`ServiceUploadBackground`, `ClearUserBackground`) kommen nicht zurück. Das Erscheinungsbild bleibt `system` / `light` / `dark` über `sm-appearance`.
- Kein UI-Framework, kein Knockout, keine zweite HTTP-Schicht. Alle Aufrufe laufen über `ui/src/api.ts` (`call`, `adminCall`, `plugin`, `streamEvents`). Für Uploads `api.ts` um eine Funktion `upload()` erweitern, keinen zweiten Client bauen.
- Deutsch in Satzschrift. Texte über `t(pfad, fallback)`. Vorhandene Sprachschlüssel aus `snappymail/v/0.0.0/app/localization/de` und `en` wiederverwenden. Was fehlt, in beiden Dateien ergänzen.
- Fähigkeiten prüfen: Bietet der Server etwas nicht an (`Capa` in den AppData, IMAP-Capabilities wie `SORT`, `THREAD=…`, `ACL`, `QUOTA`), dann den Bedienweg weglassen, nicht ausgrauen.
- Der Brief bleibt im sandboxed `iframe` ohne `allow-same-origin` und ohne `allow-scripts`.
- Zerstörende Aktionen (endgültig löschen, Ordner leeren, Ordner löschen, Konto entfernen) nur nach Bestätigung im vorhandenen Dialog `#confirm`. Der Dialog bekommt dafür einen variablen Titel und Text.
- Hover nur unter `(hover: hover)`, `focus({ preventScroll: true })`, `html`/`body`/`.shell` bleiben `overflow: hidden` (siehe `AGENTS.md`).
- Der Assistent bleibt ein Blatt auf dem Brief. Neue Mail-Funktionen dürfen ihn nicht voraussetzen.
- `view.ts` hat heute 1155 Zeilen. Neue Teile in eigene Module legen, zum Beispiel `ui/src/compose.ts`, `ui/src/folders.ts`, `ui/src/reader.ts`, `ui/src/list.ts`, `ui/src/contacts.ts`, `ui/src/sieve.ts`, `ui/src/prefs.ts`, `ui/src/admin/*.ts`. `view.ts` behält die Hülle und verteilt die Ereignisse.

### Prüfen nach jeder Phase

```sh
cd ui
npx tsc --noEmit
npm run build
python ~/.claude/skills/mistral-design/scripts/check_tokens.py src --layer app   # aus ui/ heraus
```

Dann im Browser über die Docker-Vorschau (`plugins/ai-copilot/dev`, http://localhost:8888, `test@example.com` / `test1234`, `python seed.py`): hell, dunkel, 375 px, 800 px, 1280 px, nur Tastatur. Ohne laufenden Mailserver oder Sieve den Stand als „ungetestet“ oder „Mock“ kennzeichnen. Ehrlich berichten, was geprüft wurde.

Commit pro Phase, Betreff auf Deutsch in einem Satz. `static/css`, `static/js` und `static/fonts` mitcommitten, wenn der Build sie ändert.

---

## 1. Was die neue Oberfläche heute kann

Damit nichts doppelt gebaut wird:

| Bereich | Vorhanden |
|---|---|
| Anmeldung | E-Mail, Passwort, „Anmeldung merken“, Fehlertexte |
| Hülle | Drei Spalten, verschiebbarer Trenner, Seitenleiste ein/aus, mobile Ansicht mit Tab-Leiste, Konto-Menü (Einstellungen, Abmelden) |
| Ordner | Liste aus `Folders`, Posteingang oben, Einrückung bis Tiefe 2, Ungelesen-Zahl |
| Liste | `MessageList` mit „Weitere“, Suche (einfaches Feld), Absender, Betreff, Vorschau, Datum, ungelesen fett, KI-Kategorie-Filter |
| Brief | Betreff, Von, An, Datum, Anhänge als Download-Links, HTML oder Text im iframe, beim Öffnen als gelesen markieren |
| Aktionen | Antworten, Allen antworten, Weiterleiten (nur Text, ohne Anhänge), Archivieren, Ungelesen, Löschen mit Bestätigung |
| Schreiben | An, Cc, Betreff, Text (nur Text), Senden mit `inReplyTo`/`references`, Speichern in Gesendet |
| Tasten | J/K, Enter, C, R, E, #, `\`, Esc, ? |
| Einstellungen | Erscheinungsbild; Konten (hinzufügen, wechseln, löschen); Identitäten (alle Felder inkl. Signatur, PGP-Schalter, S/MIME-Felder); Kontakte (Name + eine E-Mail, Suche, löschen); Filter (Sieve-Skript als Rohtext, aktivieren, löschen); Schlüssel (PGP-Liste, Import, S/MIME-Liste, Import) |
| Assistent | Zusammenfassung, Antwortvorschläge, Entwurf (SSE), Sprachsuche, Einordnung, Fristen, Fragen-Blatt, Hinweise |
| Admin | Anmeldung (mit TOTP), Domainliste, Domain aktivieren/deaktivieren/löschen, Abmelden |
| Symbole | Nur zwei: `iconMenu`, `iconClose` in `ui/src/icons.ts` |

---

## 2. Phase 0: Symbolsystem (zuerst) – ERLEDIGT

> **Status: abgeschlossen am 2026-11-07.** Umgesetzt wie unten beschrieben, mit diesen Abweichungen und Ergebnissen:
> - Quelle ist **eine** Datei `ui/src/icons/icons.txt` (Blöcke `name:` + 9 Zeilen, Aliase `neu = alt`) statt einer Datei pro Symbol. `ui/scripts/icons.mjs` prüft das Raster, erzeugt `ui/src/icons.ts` (`icon(name, label?)`, `IconName`, `iconNames`) und die Vorschau `ui/icons.html` (nicht im Git). `npm run build` ruft `build:icons` auf.
> - 103 Symbole plus 8 Aliase, alle Namen aus 2.3 sind da. `iconMenu`/`iconClose` gibt es nicht mehr, `menu` ist jetzt drei Linien im selben Raster.
> - Eingebaut: Reader-Leiste (Symbol + Text ab 1280 px, darunter nur Symbol, Text bleibt als zugänglicher Name, Klasse `bar-btn`), Ordner-Rollen in der Seitenleiste, Merker in der Liste (Anhang, beantwortet, weitergeleitet, markiert; `MessageRow` hat dafür neue Felder), Konto-Menü, Tab-Leiste, Senden-Knopf (mit `loading` beim Senden), Einstellungsnavigation und -knöpfe, Bestätigungsdialog, Assistenten-Knöpfe, Admin-Knöpfe.
> - CSS in `shell.css`: `.icon` (20 px), `.icon-lg` (40 px), `.btn-label`, `.bar-btn`, `.marks`, Ladeanimation mit `prefers-reduced-motion`.
> - Geprüft: `tsc`, Build, Token-Prüfung (0 Fehler), Browser-Fotos in 1400 px hell/dunkel, 1000 px, 375 px und im Einstellungsdialog; kein sichtbarer Knopf ohne zugänglichen Namen. **Ungetestet:** die Listen-Merker, weil die Testmails keine Flags und Anhänge haben.
> - Beobachtet, nicht Teil von Phase 0: Wechselt das Farbschema, während ein HTML-Brief offen ist, bleibt der iframe im alten Schema (im hellen Modus schwarzer Brief). In Phase 1 behoben.

Alle folgenden Phasen brauchen Symbole. Deshalb zuerst ein vollständiger Satz.

### 2.1 Raster

Eine einheitliche Pixel-Sprache im Stil von `mistral-design` (`references/pixel-art.md`), aber feiner als die 5×5-Icons des Skills, damit Antworten, Allen antworten und Weiterleiten unterscheidbar bleiben:

- `viewBox="0 0 30 30"`, `fill="currentColor"`, `shape-rendering="crispEdges"`, `aria-hidden="true"`.
- **9×9-Raster, Blockgröße 3, Ursprung (1.5, 1.5).** Blockpositionen: 1.5, 4.5, 7.5 … 25.5.
- Standardgröße im UI **20 px**. Dann ist ein Block genau 2 px und der Ursprung liegt auf 1 px, alle Kanten treffen ganze Pixel. Zweite Größe 40 px für Leerzustände. Keine 15, 16, 18 oder 24 px.
- Strichstärke: Linien sind ein Block breit. Flächen nur, wo das Motiv es braucht (Ordner, Umschlag, Ordnerlasche).
- `iconMenu` und `iconClose` auf dasselbe Raster umbauen, damit alles eine Sprache spricht.
- Nur `currentColor`. Orange (`--primary`) bleibt für Fokusring, das 6-px-Quadrat „Antwort nötig“ und `::selection` reserviert. Symbole werden nie orange.

### 2.2 Erzeugung

- `ui/scripts/icons.mjs` schreiben: liest `ui/src/icons/*.txt` (je 9 Zeilen mit 9 Zeichen, `#` = Block, `.` = leer), fasst Blöcke einer Zeile zu breiten `rect` zusammen und erzeugt `ui/src/icons.ts` mit `export const icons = { reply: "<svg…>", … } as const` und `export type IconName = keyof typeof icons`.
- Helfer `icon(name: IconName, label?: string)` liefert das SVG. Steht das Symbol allein im Knopf, setzt der Knopf `aria-label` und `title`.
- `npm run build` ruft das Skript vor `build:js` auf.
- Eine Vorschau-Seite `ui/icons.html` (nicht ausgeliefert) zeigt alle Symbole in 20 und 40 px, hell und dunkel, für die Sichtprüfung.

### 2.3 Benötigte Symbole

| Gruppe | Namen |
|---|---|
| Navigation | `menu`, `close`, `back`, `chevron-left`, `chevron-right`, `chevron-down`, `chevron-up`, `more` (drei Punkte), `external`, `fullscreen`, `fullscreen-exit` |
| Ordner-Rollen | `inbox`, `sent`, `drafts`, `trash`, `archive`, `spam`, `folder`, `folder-open`, `folder-plus`, `folder-shared` |
| Mail-Aktionen | `compose`, `reply`, `reply-all`, `forward`, `forward-attachment`, `edit-as-new`, `delete`, `delete-forever`, `restore`, `move`, `copy`, `spam`, `not-spam`, `mark-read`, `mark-unread`, `flag`, `flag-filled`, `tag`, `print`, `source`, `download`, `download-zip`, `unsubscribe`, `receipt`, `refresh`, `select-all` |
| Liste | `attachment`, `answered`, `forwarded`, `important`, `thread`, `sort`, `filter`, `search`, `checkbox`, `checkbox-checked`, `checkbox-mixed` |
| Schreiben | `send`, `save`, `attach`, `upload`, `signature`, `identity`, `bold`, `italic`, `underline`, `list-bullet`, `list-number`, `quote`, `link`, `image`, `code`, `minimize` |
| Brief | `image-blocked`, `eye`, `eye-off`, `info`, `calendar`, `lock`, `lock-open`, `shield-check`, `shield-alert`, `warning`, `virus` |
| Einstellungen | `settings`, `user`, `users`, `contacts`, `key`, `certificate`, `funnel`, `vacation`, `bell`, `bell-off`, `sound`, `language`, `clock`, `logout`, `account-add`, `plug` (Plugins), `server`, `database`, `upgrade` |
| Status | `check`, `plus`, `minus`, `error`, `success`, `loading` (drei Blöcke, Animation per CSS-Opazität, mit `prefers-reduced-motion` statisch) |
| Assistent | `assist` (eigene abstrakte Pixel-Marke, keine Katze, kein Funkeln im Stil fremder Marken), `stop` |

### 2.4 Einsatz

- Reader-Leiste: Symbol plus Text ab 1280 px, darunter nur Symbol mit `aria-label`. Seltene Aktionen in ein Menü `more`.
- Ordnerliste: Rollen-Symbol vor jedem Ordner.
- Liste: kleine Symbole für Anhang, beantwortet, weitergeleitet, wichtig, markiert. Bedeutung nie nur über Farbe.
- Einstellungsnavigation: Symbol plus Text.
- Die vorhandenen Text-Knöpfe in `view.ts` und `settings.ts` umstellen.

**Fertig, wenn:** alle Namen aus 2.3 existieren, die Vorschau-Seite sauber aussieht, `apple-design` keine gemischten Symbolsprachen meldet und jeder reine Symbolknopf einen zugänglichen Namen hat.

---

## 3. Phase 1: Liste und Brief vervollständigen – ERLEDIGT

> **Status: abgeschlossen am 2026-11-07.** Alle Punkte 3.1 bis 3.11 sind umgesetzt. Neue Module: `ui/src/clean.ts` (HTML-Säuberung aus `dev/Common/Html.js` übertragen, Tracking-Filter, externe Bilder nur nach Freigabe), `ui/src/letter.ts` (srcdoc mit CSP, Druck-/Fensteransicht, ICS-Auswertung, List-Unsubscribe), `ui/src/reader.ts` (Briefkopf, Hinweisleisten, Anhänge, Sammelansicht). `api.ts` hat `rawUrl`, `fileHash`, `messageHash`, `proxyUrl`, `fetchDataUrl`. Die Aktionen laufen über `MailActions.act(name, data)` in `mail.ts`.
>
> Wichtige Entscheidungen und Korrekturen:
> - **Löschen verschiebt jetzt in den Papierkorb.** Vorher rief die neue Oberfläche `MessageDelete` direkt auf und löschte endgültig. Endgültig nur im Papierkorb, ohne Papierkorb oder über „Endgültig löschen“ (Umschalt+Entf), jeweils mit Bestätigung.
> - **Absender wurden in der Liste als „(unbekannt)“ gezeigt**, weil `from` vom Server ein Array ist. Behoben.
> - Der Brief bleibt im iframe ohne `allow-same-origin`. Inline-Bilder (`cid:`) und über den Server-Proxy geladene externe Bilder werden deshalb im Hauptfenster geholt und als `data:`-URL eingesetzt. Ohne Proxy (`proxyExternalImages` aus) erlaubt die CSP nach Freigabe `https:`/`http:`.
> - HTML-Mails stehen auf hellem Papier (wie vom Absender gestaltet), Text-Mails folgen dem Erscheinungsbild. „Farben umkehren“ im Menü. Der Farbschema-Fehler aus Phase 0 ist behoben (Brief wird bei `sm-appearance` neu gebaut).
> - System-Ordner: Kontoeinstellung, sonst Server-Rolle, sonst üblicher Name (z. B. `Archive` ohne Rolle).
> - Aus Phase 2 vorgezogen: Weiterleiten übernimmt die Original-Anhänge, „Als Anhang weiterleiten“, „Als neu bearbeiten“ und „Entwurf bearbeiten“ (der Entwurf wird nach dem Senden über `messageFolder`/`messageUid` entfernt). Der Editor zeigt dafür eine Anhangsliste (`setComposeFiles`). Eigene Dateien hochladen bleibt Phase 2.
> - Tastenkürzel hängen jetzt am Dokument, nicht an der Hülle; vorher gingen sie verloren, sobald die Liste neu gezeichnet wurde. Neu: A, F, I, U, M, Entf, Umschalt+Entf, Strg+A, `*`, Umschalt+R.
> - Schmale Brief-Spalte (unter 560 px, Container-Query): seltene Aktionen wandern ins Menü „Weitere“. Text an Knöpfen nur bei den Hauptaktionen und ab 1000 px Spaltenbreite.
> - Testdaten: `python seed.py --feature-mails` in `plugins/ai-copilot/dev` legt HTML-Mail mit externen Bildern, cid-Bild, Tracking, Lesebestätigung, List-Unsubscribe, Anhänge mit ICS, Spam-Mail und Entwurf an.
>
> Im Browser geprüft (Docker-Vorschau, headless Chrome, hell/dunkel, 375/900/1000/1400 px): externe Bilder blockiert, Freigabe, „Immer für diesen Absender“ (speichert `ViewImagesWhitelist` und `ViewImages=match`), Tracking-Leiste, Nur-Text-Umschaltung, Details im Kopf, Adressmenü mit Suche, Schlagwort hinzufügen/entfernen, Lesebestätigung senden, Abmelden per mailto, Anhangsliste mit Vorschaubild, Lightbox, ZIP, Termin-Karte, Spam-Hinweis, Mehrfachauswahl (Kästchen, Strg/Umschalt-Klick, Strg+A), Sammelansicht, Markieren in Zeile und per I, Verschieben-Dialog mit Suche, Ziehen auf Ordner, Löschen in den Papierkorb, endgültig mit Bestätigung, Spam/Kein Spam, Archivieren, Vor/Zurück, verzögertes Gelesen (5 s), Aktualisieren mit neuer Mail, Quelltext-URL, Weiterleiten mit Anhängen und Senden, Entwurf öffnen, Vollbild mit Esc.
>
> **Ungetestet:** Desktop-Benachrichtigung und Ton (headless ohne Erlaubnis und Lautsprecher; Erlaubnis wird erst in Phase 4 angefragt), Druckfenster und „In neuem Fenster“ (headless blockiert Pop-ups ohne echten Klick), externe Bilder über den Proxy mit echtem Internet (die Vorschau hat keins, es erscheint „nicht erreichbar“), Wiederherstellen von `\Deleted` (nur sichtbar, wenn `HideDeleted` aus ist; der Schalter kommt in Phase 4), Ungelesen-Zahlen weiterer Konten (in der Vorschau ist kein zweites Konto verknüpft), One-Click-Abmeldung per POST (bewusst nicht gebaut, es öffnet sich die Abmeldeseite nach Bestätigung).

### 3.1 Mehrfachauswahl und Sammelaktionen
Alt: `dev/View/User/MailBox/MessageList.js`, `Views/User/MailMessageList.html`.
- Auswahl per Klick mit Strg/Cmd und Umschalt, Kontrollkästchen pro Zeile (Einstellung `UseCheckboxesInList`), „Alle auswählen“ im Listenkopf, Taste `Strg+A` bzw. `*` wie alt (`LABEL_CHECK_ALL`).
- Bei mehr als einer Auswahl zeigt die Reader-Spalte eine Sammelleiste statt des Briefs: Verschieben, Kopieren, Archivieren, Löschen, Spam, Gelesen, Ungelesen, Markieren, Markierung entfernen, als Anhang weiterleiten, als ZIP laden.
- Aktionen: `MessageMove`, `MessageCopy`, `MessageDelete`, `MessageSetSeen`, `MessageSetFlagged`, `MessageSetSeenToAll` („Alle als gelesen“ im Ordnermenü), `AttachmentsActions` für ZIP.
- `uids` als kommagetrennte Liste wie heute.

### 3.2 Markieren (Flag) und Schlagworte
- Stern bzw. Flagge in jeder Zeile und im Brief, umschaltbar, `MessageSetFlagged`. Taste `I` wie alt (`LABEL_IMPORTANT`).
- Schlagworte (IMAP-Keywords) im Brief anzeigen, hinzufügen, entfernen: `MessageSetKeyword`. Die KI-Schlagworte `$ai_*` nicht als Tags anzeigen, die zeigt schon die Kategorie.

### 3.3 Verschieben und Kopieren
- Ordnerauswahl als Popover mit Suchfeld und Rollen-Symbolen. Taste `M` (`LABEL_MOVE`).
- Ziehen und Ablegen von Zeilen auf Ordner in der Seitenleiste (nur Zeigegerät; Tastaturweg bleibt das Popover). Mit Strg beim Ablegen kopieren.

### 3.4 Spam
- „Spam“ und im Spam-Ordner „Kein Spam“, verschiebt in den System-Ordner Spam bzw. Posteingang. Ordner aus den AppData (`SpamFolder`) lesen.
- Spam-Score und Virenwarnung im Briefkopf zeigen, wenn der Server sie liefert (`spamScore`, `spamResult`, `isSpam`, `hasVirus` im `Message`-Ergebnis).

### 3.5 Löschen ohne Papierkorb, Wiederherstellen
- „Endgültig löschen“ (Umschalt+Entf), nur mit Bestätigung. Bei Ordnern ohne Papierkorb oder im Papierkorb ist Löschen immer endgültig, Bestätigung nennt das.
- `HideDeleted`: als gelöscht markierte Mails ausblenden oder durchgestrichen zeigen, mit „Wiederherstellen“ (`MessageSetDeleted`).
- Nach Löschen/Archivieren die nächste Mail öffnen, wenn `showNextMessage` an ist.

### 3.6 Aktualisieren und neue Mail
- Knopf `refresh` im Listenkopf.
- Abruf im Intervall `CheckMailInterval` (Minuten, Untergrenze `minRefreshInterval` aus den AppData). Nur `Folders`/`FolderInformationMultiply` für die überwachten Ordner (`FolderCheckable`) und `MessageList` mit `uidNext` für den offenen Ordner. Bei verborgenem Tab pausieren, bei Rückkehr sofort prüfen.
- Ungelesen-Zahl im Fenstertitel, wenn `ShowUnreadCount` an ist.
- Desktop-Benachrichtigung bei neuer Mail (`DesktopNotifications`, Erlaubnis nur auf Klick in den Einstellungen anfragen), Ton (`SoundNotification`, `NotificationSound`; Töne liegen unter `static/sounds/`, Liste aus `newMailSounds` in den AppData, prüfen ob die Dateien nach dem Umbau noch existieren).
- Ungelesen-Zahlen anderer Konten im Kontowechsler: `AccountUnread`.

### 3.7 Briefkopf vollständig
- Klick auf den Kopf klappt Details auf: Von mit Adresse, An, Cc, Bcc (bei eigenen Mails), Antwort an, volles Datum, Größe (`toggleFullInfo` alt).
- Adressen anklickbar: Menü mit „Mail schreiben“, „Kopieren“, „Zu Kontakten“.
- Zurück/Weiter im Brief (`goUp`/`goDown`), Tasten wie alt.

### 3.8 Externe Bilder und Darstellung (Datenschutz, wichtig)
Alt: `dev/View/User/MailBox/MessageView.js`, Einstellungen `ViewImages`, `ViewImagesWhitelist`.
- Prüfen, was das PHP heute im `html` liefert (externe Bilder kommen als `data-x-src` bzw. werden über `ServiceProxyExternal` geleitet). Im iframe standardmäßig **keine** externen Inhalte laden. CSP-Meta im `srcdoc`: `img-src data: cid: <Proxy-URL>`, `style-src 'unsafe-inline'`, sonst nichts.
- Leiste über dem Brief: „Externe Bilder blockiert. Anzeigen“ und „Immer für diesen Absender“ (schreibt `ViewImagesWhitelist`, Aktion `SettingsUpdate`). Einstellung: Fragen / Nur für Liste / Immer.
- Inline-Bilder (`cid:`) über die Raw-Download-URL auflösen.
- „Nur Text anzeigen“ / „HTML anzeigen“ umschaltbar (`ViewHTML` als Vorgabe).
- `RemoveColors`, `AllowStyles`, `minFontSize`, `CollapseBlockquotes` und `MaxBlockquotesLevel` beim Aufbau des `srcdoc` anwenden. Im Dunkelmodus Farben des Briefs optional tauschen (`swapColors` alt). Zitat-Ein-/Ausklappen per Klick ist ohne Skript im iframe nicht möglich: Zitate vor dem Einfügen als `<details>` umbauen.
- Tracking-Links (alt `ENABLE_TRACKING_LINKS`): bereinigte Links nutzen, wie vom PHP geliefert, Schalter zum Original.

### 3.9 Anhänge
- Liste mit Symbol nach Typ, Größe, Download. Bilder als Vorschaubild, Klick öffnet eine Lightbox im `dialog`. PDF in neuem Tab.
- „Alle als ZIP“ (`AttachmentsActions`, Aktion `Zip`).
- `ListInlineAttachments`, `simpleAttachmentsList` beachten.
- ICS-Anhänge als Termin-Karte (ersetzt die Plugins `ics-viewer`/`view-ics`, siehe Phase 9).

### 3.10 Weitere Briefaktionen (Menü `more`)
- Drucken: eigenes Druck-Fenster mit Kopf und Brief (`printMessage` alt), `@media print` in `shell.css`.
- Quelltext anzeigen und `.eml` laden: Raw-URLs `?/Raw/…/ViewAsPlain/` und `…/Download/` (Aufbau aus `git show 387e27b19:dev/Common/Links.js`).
- In neuem Fenster öffnen (`messageNewWindow`), Vollbild (`toggleFullScreen`).
- Abmelden vom Newsletter, wenn `List-Unsubscribe` vorhanden (`BUTTON_UNSUBSCRIBE`): `mailto:` öffnet den Editor vorbefüllt, `https:` öffnet neuen Tab, One-Click nur nach Bestätigung.
- Lesebestätigung: Hinweisleiste, wenn der Absender sie anfordert, Senden mit `SendReadReceiptMessage`.
- „Als neu bearbeiten“, „Als Anhang weiterleiten“, im Entwürfe-Ordner „Bearbeiten“.

### 3.11 Gelesen-Verhalten
- `messageReadAuto` und `MessageReadDelay` (Sekunden): heute wird sofort markiert. Verzögert markieren, Abbruch beim Wechsel.

---

## 4. Phase 2: Schreiben – ERLEDIGT

> **Status: abgeschlossen am 2026-11-07.** Alle Punkte 4.1 bis 4.6 sind im neuen Modul `ui/src/compose.ts` umgesetzt. Die Oberfläche nutzt Identitäten mit Bcc und Signaturwechsel, Empfänger-Chips mit Kontaktvorschlägen, HTML- und Texteditor mit Markdown-Umwandlung, Uploads mit Fortschritt und Größenprüfung, Original-Anhänge, Entwürfe mit Autosave und Schließen-Nachfrage, Minimieren, Sendeoptionen sowie die Client-Verarbeitung von `mailto:`. Uploads laufen über `upload()` in `api.ts`; die Einstellungen enthalten die Registrierung als `mailto:`-Handler.
>
> Geprüft: `npx tsc --noEmit`, `npm run build`, beide Sprachdateien als JSON und Token-Prüfung mit 0 Fehlern; die fünf Roh-Hex-Warnungen in `letter.ts` waren bereits vorhanden. Im Browser hell/dunkel und bei 375/800/832/1280 px geprüft: Composer, Identitäten, Empfänger-Chips, ungültige Adressen, HTML-Inhalt, Upload und Entfernen, Minimieren und Wiederherstellen, Schließen-Dialog sowie reales Speichern, erneutes Öffnen und Verwerfen eines Entwurfs. `Suggestions` wurde korrekt aufgerufen, lieferte im Testkonto aber eine leere Liste.
>
> **Ungetestet bzw. in der Vorschau nicht bestätigbar:** der komplette `mailto:`-Weg über `ServiceMailto` (die Vorschau lieferte kein `mailToEmail` in den AppData), Upload-Abbruch mitten im Transfer, der tatsächliche 60-s-Autosave und sichtbare Kontaktvorschläge. Kein echter Versand nach den letzten Änderungen; Speichern und Löschen von Entwürfen wurden dagegen mit dem Server bestätigt.

Alt: `dev/View/Popup/Compose.js`, `Views/User/PopupsCompose.html`, `dev/Model/ComposeAttachment.js`.
Neues Modul `ui/src/compose.ts`.

### 4.1 Felder
- Absender-Auswahl aus den Identitäten (`AccountsAndIdentities`), Standard ist die Identität des Kontos bzw. bei Antworten die Identität, an die die Mail ging.
- Bcc und Antwort an einblendbar. Bcc der Identität automatisch eintragen.
- Empfängerfelder als Token-Eingabe (Chips), mit Vorschlägen aus `Suggestions` (Debounce 200 ms, Tastatur: Pfeile, Enter, Komma, Rücktaste). Ungültige Adressen markieren.
- Kontakt-Auswahl über das Adressbuch (Phase 5).

### 4.2 Anhänge
- Hinzufügen per Knopf und per Ablegen auf den Editor (`ATTACH_DROP_FILES_DESC`). Upload über `ServiceUpload` (`?/Upload/…`); `api.ts` bekommt `upload(file, onProgress)` mit `XMLHttpRequest` für Fortschritt. Fortschrittsbalken, Abbrechen, Entfernen.
- Größengrenze aus den AppData (`attachmentLimit`) vor dem Upload prüfen.
- Weiterleiten und „Als neu bearbeiten“ übernehmen die Original-Anhänge (`MessageUploadAttachments` mit den Download-Hashes, wie alt). Antworten übernimmt keine.
- Als Anhang weiterleiten (eine oder mehrere Mails als `.eml`).
- `attachments` beim `SendMessage` als Liste der Upload-Hashes mitschicken, Format aus `Compose.js` übernehmen.

### 4.3 Editor
- Vorgabe aus `EditorDefaultType` (`Html` oder `Plain`). Umschalter im Editor.
- HTML-Modus ohne Fremdbibliothek: `contenteditable` mit kleiner Leiste (Fett, Kursiv, Unterstrichen, Liste, nummerierte Liste, Zitat, Link, Format entfernen). Eingefügtes HTML säubern (Allowlist von Tags und Attributen). Ausgabe als `html` plus abgeleitetes `plain`.
- Markdown-Option (`markdown`), wenn alt aktiv: Text wird beim Senden zu HTML. Niedrige Priorität.
- Rechtschreibprüfung des Browsers per `allowSpellcheck`.
- Signatur der gewählten Identität einfügen und beim Identitätswechsel austauschen, `SignatureInsertBefore` bei Antworten beachten. HTML-Signaturen im HTML-Modus, sonst als Text.
- Zitat bei Antworten im HTML-Modus als `<blockquote>`.

### 4.4 Entwürfe
- „Speichern“ (`SaveMessage`, Ordner aus `DraftsFolder`), Taste `Strg+S`.
- Automatisch speichern, wenn `AllowDraftAutosave` an ist (alle 60 s nach Änderung, nicht bei leerem Entwurf).
- Beim Schließen mit Änderungen fragen: Speichern, Verwerfen, Abbrechen. Verwerfen löscht den gespeicherten Entwurf.
- Entwurf aus dem Entwürfe-Ordner öffnen und weiterschreiben; nach dem Senden den Entwurf entfernen (`draftInfo`, wie alt).
- Editor minimieren (`LABEL_MINIMIZE_COMPOSE_POPUP`): Leiste unten, damit man im Postfach nachsehen kann.

### 4.5 Optionen beim Senden
- Wichtig markieren, Lesebestätigung anfordern (`requestReadReceipt`), Zustellbestätigung (`requestDsn`), TLS erzwingen (`requireTLS`). Vorgaben aus den Einstellungen.
- PGP signieren/verschlüsseln und S/MIME (Phase 7), Vorgaben aus der Identität bzw. `pgpSign`/`pgpEncrypt`.
- Gesendet-Ordner: Identität (`sentFolder`) vor `ReplySameFolder` vor Standard.
- Tasten `Strg+Enter` Senden, Esc schließt mit Nachfrage.

### 4.6 Mailto
- `navigator.registerProtocolHandler('mailto', …)` per Knopf in den Einstellungen (`SETTINGS_GENERAL/MAILTO`), Ziel `ServiceMailto`. Beim Start einen übergebenen `mailto:` in den Editor laden.

---

## 4a. Nachbesserungen an Phase 0–2 (2026-11-07)

> Nach einem Codeabgleich mit den Commits `740fa6cf5`, `18db471cb` und `2c5598608` korrigiert:
> - **Hover:** Die restlichen Hover-Regeln in `shell.css` (Ordner, Menüeinträge, Text-/Symbolknöpfe, Filter, Tintenknopf) stehen jetzt in `@media (hover: hover)`. Der aktive Ordner (`aria-current`) bleibt außerhalb hervorgehoben.
> - **Fokus:** `closeLayer` in `view.ts` gibt den Fokus mit `preventScroll: true` zurück.
> - **„Zu Kontakten“** im Adressmenü des Briefs (fehlte aus 3.7). Nur sichtbar bei Kontakt-Fähigkeit (`caps.contacts`), speichert über `ContactSave` mit jCard (`writeProp` aus `settings.ts` wird dafür exportiert) und meldet das Ergebnis.
> - **`simpleAttachmentsList`** wird aus den AppData gelesen: einspaltige, kompakte Anhangsliste ohne Vorschaubilder. Vorschau/Lightbox über den Dateinamen, Download und ZIP bleiben.
> - **Virenwarnung** zusätzlich über ein Feld `hasVirus` im `Message`-Ergebnis; die Kopfzeilen-Erkennung bleibt der aktuelle Serverweg (der Server liefert `hasVirus` derzeit nicht).
> - **Veraltete Listenantworten:** `loadList` hat eine Anfragefolge (`listSeq`) und eine Kontextprüfung (Konto, Ordner, effektive Suche). Nur die Antwort zur aktuellen Auswahl wird gezeichnet, auch bei Fehlern. Phase 3 erweitert den Kontext um Sortierung und Thread.
> - **„Weitere“ bei KI-Kategorien:** Bei aktiver Kategorie gilt jetzt dieselbe Regel wie bei der Suche (volle Seite = es gibt mehr), statt der Gesamtzahl des Ordners.
> - **Suchsyntax:** Der Client nutzt das Format des alten `AdvancedSearch.js` (`name=wert&…`, z. B. `from=a%40b.de`, `keyword=%24ai_invoice&unanswered`), auch für „Mails von dieser Adresse“ und die KI-Kategorien. Der Server versteht zusätzlich das RainLoop-Format `from:… is:…`, das alte Frontend erzeugte es aber nicht.
>
> Geprüft: `npx tsc --noEmit`, `npm run build`, Token-Prüfung (0 Fehler, die fünf bekannten Roh-Hex-Warnungen in `letter.ts`). **Im Browser ungetestet**, weil die Docker-Vorschau bei dieser Nachbesserung nicht lief; das holt die Browserprüfung von Phase 3 nach.

## 5. Phase 3: Ordner und Suche – ERLEDIGT

> **Status: abgeschlossen am 2026-11-07.** Alle Punkte 5.1 bis 5.4 sind umgesetzt. Neue Module `ui/src/folders.ts` (Ordnermodell, Baum beliebiger Tiefe, Seitenleiste mit Kontextmenü und Kontingent, Abschnitt „Ordner“ mit Abo/Prüfen/Systemordnern, Freigaben/ACL) und `ui/src/search.ts` (erweiterte Suche im Format `name=wert&…`, Schnellfilter). Geändert: `mail.ts`, `view.ts`, `shell.css`, `de/en user.json` (Abschnitte `FOLDERS_UI`, `SEARCH_UI`, deutsche Texte für `SORT_ARRIVAL_*` und `IMAP.ACL_*`), `plugins/ai-copilot/dev/seed.py` (`--folder-mails`: verschachtelte Ordner, nicht abonnierter Ordner, Thread, große Mail, Spam, Kontingent 200 MB). Zusätzlich gebaut: Schalter „Als Unterhaltungen anzeigen“ und „Nach Datum gruppieren“ im Menü „Sortierung und Ansicht“ (speichern `UseThreads`/`listGrouped` per `SettingsUpdate`).
>
> Geprüft: `npx tsc --noEmit`, `npm run build`, Token-Prüfung (0 Fehler, 5 bekannte Warnungen in `letter.ts`). Sprachdateien de/en deckungsgleich. Reviews mit `/apple-design` und `/mistral-design` gelaufen: keine Critical- oder High-Befunde; Kontrast der Leistentexte 5,98:1 (hell) und 8,82:1 (dunkel), Trefferflächen 28/44 px, vollständiger Tastaturweg. Bewusste Abweichungen: mehr als zwei Seitenleisten-Ebenen (Plan-Forderung, Disclosure-Dreiecke) und „Ordner anlegen“/Kontingent unten in der Seitenleiste (Plan-Forderung, Alternativweg über das Kontextmenü).
>
> Im Browser geprüft (Docker-Vorschau, headless Chrome; hell/dunkel; 375/800/1280 px): Baum beliebiger Tiefe, nicht auswählbare Eltern, Auf-/Zuklappen (auch nach Neuladen), Pfeiltasten, Umschalt+F10, Rechtsklick und Knopf „Weitere“ mit gleichem Menü, Esc mit Fokus-Rückkehr, Ordner anlegen/Unterordner/umbenennen/verschieben/löschen (nur leer, mit Bestätigung), Abo und Prüfen umschalten, „Nicht abonnierte ausblenden“, Systemordner zuordnen und zurücksetzen, Alle gelesen, Spam leeren mit Bestätigung, Kontingent-Anzeige, alle Sortierungen, Threads an/aus, Thread öffnen (Klick und T), Zurück (Knopf und Esc), Datumsgruppen, Schnellfilter-Kombinationen, erweiterte Suche (Von, An, Betreff, Text, Schlagwort, Größe, beantwortet, Zeitraum), schnelle Ordner-/Suchwechsel und Aktualisieren ohne veraltete Antworten, Mobilmenü öffnet nach oben, Trefferflächen 44 px mobil.
>
> **Ungetestet:** ACL und Kolab (Dovecot der Vorschau meldet weder `ACL` noch `METADATA`), Unterordner-Suche (kein `MULTISEARCH`), Kontowechsel mit Ungelesen-Zahlen (nur ein Konto). Datumssuche liefert in der Vorschau nichts, weil IMAP `SINCE`/`BEFORE` das Eingangsdatum vergleicht und alle Testmails heute eingespielt wurden; nicht falsch, aber nicht mit Treffern bestätigt.
>
> Außerdem bereinigt: Der Docker-Neubau (`.docker/release/Dockerfile`) scheiterte an `COPY package.json yarn.lock` — der Fork nutzt npm und baut das Frontend vorab, `yarn.lock` und gulp gibt es nicht mehr. Das Dockerfile ruft jetzt `php release.php --skip-gulp` auf; die gulp-Abfrage in `cli/release.php` läuft nur noch, wenn gulp auch wirklich gestartet wird.

Alt: `dev/Settings/User/Folders.js`, `Views/User/SettingsFolders.html`, `SettingsFolderItem.html`, `Popups Folder*`, `dev/Common/Folders.js`.

### 5.1 Ordnerverwaltung (neuer Abschnitt „Ordner“ in den Einstellungen)
- Baum mit allen Ordnern, auch nicht abonnierten. Pro Ordner: Umbenennen (`FolderRename`), Löschen nur leer und nach Bestätigung (`FolderDelete`), Abonnieren (`FolderSubscribe`), Auf neue Mail prüfen (`FolderCheckable`), Unterordner anlegen (`FolderCreate`, mit Eltern-Auswahl).
- „Nicht abonnierte ausblenden“ (`HideUnsubscribed`).
- System-Ordner zuordnen: Gesendet, Entwürfe, Spam, Papierkorb, Archiv (`SystemFoldersUpdate`). Nach dem Speichern AppData neu laden.
- Ordner leeren (`FolderClear`) mit Bestätigung, im Kontextmenü von Papierkorb und Spam.
- Freigaben (`FolderACL`, `FolderSetACL`, `FolderDeleteACL`), nur bei Capability `ACL`. Niedrige Priorität.
- Kolab-Ordner (`UnhideKolabFolders`) nur, wenn Kolab aktiv ist. Niedrige Priorität.

### 5.2 Seitenleiste
- Rollen-Symbole, beliebige Tiefe statt Begrenzung auf 2, Unterordner auf- und zuklappbar (Zustand in `localStorage` pro Konto).
- Ordnersuche, wenn mehr als 15 Ordner (`foldersFilter` alt).
- Kontextmenü pro Ordner (Rechtsklick und Knopf `more`): Neuer Unterordner, Umbenennen, Alle gelesen, Leeren, Einstellungen.
- „Ordner anlegen“ unten in der Seitenleiste.
- Kontingent (Quota) unten anzeigen, wenn `Folders` `quotaUsage`/`quotaLimit` liefert (`Actions/Folders.php`), als Hairline-Balken mit Zahl.
- Zusätzliche Konten mit Ungelesen-Zahl oben im Konto-Menü, Wechsel mit einem Klick (`AccountSwitch`), nicht nur über die Einstellungen.

### 5.3 Erweiterte Suche
Alt: `dev/View/Popup/AdvancedSearch.js`.
- Knopf `filter` neben dem Suchfeld öffnet ein Formular: Von, An, Betreff, Text, Datum (von/bis oder Zeitraum), Größe, mit Anhang, ungelesen, markiert, beantwortet, Schlagwort, Unterordner einschließen.
- Ergebnis als Suchstring im SnappyMail-Format aus `AdvancedSearch.js`, URL-kodiert: `from=…&to=…&subject=…&text=…&since=…&before=…&keyword=…&larger=…&smaller=…&in=subtree` sowie die Merker `attachment`, `unseen`, `flagged`, `answered`/`unanswered` (siehe `parseQueryString` in `MailSo/Imap/SearchCriterias.php`). Der String steht danach sichtbar im Suchfeld.
- Schnellfilter-Chips unter dem Suchfeld: Ungelesen, Markiert, Mit Anhang.

### 5.4 Sortierung und Threads
- Sortiermenü (`sort` im `MessageList`-Aufruf, Werte aus `Settings/User/General.js`: `''`, `DATE`, `FROM`, `REVERSE FROM`, `SIZE`, `REVERSE SIZE`, `SUBJECT`, `REVERSE SUBJECT`, `ARRIVAL`, `REVERSE ARRIVAL`), nur bei Capability `SORT`. Vorgabe `defaultSort`.
- Threads (`UseThreads`, `threadAlgorithm`) bei Capability `THREAD=…`: Zeile zeigt Anzahl, Klick öffnet den Thread in der Liste (`threadUid` alt), „Zurück zur Liste“. Taste für „Thread öffnen“ wie alt.
- Gruppierung nach Datum (Heute, Gestern, Diese Woche …), wenn `listGrouped` an ist.

---

## 6. Phase 4: Einstellungen – ERLEDIGT

> **Status: abgeschlossen am 2026-11-07.** Abschnitte Allgemein, Sicherheit, Konten (Bearbeiten, Sortieren, Ungelesen, Import), Assistent, Tasten und Anmeldeseite sind im TypeScript-Client umgesetzt. Speichern pro Feld über `SettingsUpdate`, Bestätigung „Gespeichert“. Layout „ohne Teilung“ und „Brief unten“ sitzt an der Hülle. Abgelaufene Sitzung (Fehler 101) öffnet den Anmelde-Dialog über dem Postfach.
>
> Geprüft: `npx tsc --noEmit`, `npm run build`. Die Docker-Vorschau hängt `snappymail/` ein und liefert das neu gebaute `app.js` (Hash stimmt mit dem Arbeitsstand überein), ohne Image-Neubau.
>
> **Im Browser nicht durchgeklickt.** Offen und abhängig von Browser oder Plugin: Desktop-Hinweis und Ton, Zwei-Faktor, Passwort ändern, Konto-Import, Sprachwechsel mitten in der Sitzung, automatische Abmeldung.

Alle Werte schreibt `SettingsUpdate` (siehe `Actions/User.php`, `DoSettingsUpdate`). Die Namen dort sind verbindlich. Die Werte liest man beim Start aus den AppData.

### 6.1 Abschnitt „Allgemein“ (neu)
| Gruppe | Einstellung (Parameter) |
|---|---|
| Sprache und Zeit | Sprache (`language`, nur wenn `allowLanguagesOnSettings`; Sprachdatei über `ServiceLang` neu laden, danach neu zeichnen), 12/24 Stunden (`hourCycle`) |
| Postfach | Layout: ohne Teilung / Spalten / Brief unten (`Layout`, die drei Werte aus `Common/EnumsUser`; die Hülle muss den Modus „Brief unten“ und „ohne Teilung“ können), Mails pro Seite (`MessagesPerPage`, heute auf 10–50 begrenzt, Grenze an die Server-Werte anpassen), Abrufintervall (`CheckMailInterval`), Sortierung (`defaultSort`), Threads (`UseThreads`, `threadAlgorithm`), Kontrollkästchen (`UseCheckboxesInList`), Gruppieren (`listGrouped`), gelöschte ausblenden (`HideDeleted`), nicht abonnierte ausblenden (`HideUnsubscribed`), Ungelesen im Titel (`ShowUnreadCount`) |
| Lesen | Gelesen nach (`MessageReadDelay`, `messageReadAuto`), nächste Mail nach Löschen (`showNextMessage`), neues Fenster (`messageNewWindow`), Standard-Antwort (`MsgDefaultAction`: Antworten/Allen antworten), HTML bevorzugen (`ViewHTML`), externe Bilder (`ViewImages`) und Liste (`ViewImagesWhitelist`), Farben entfernen (`RemoveColors`), Stile erlauben (`AllowStyles`), Mindestschrift (`minFontSize`), Zitate einklappen (`CollapseBlockquotes`, `MaxBlockquotesLevel`), Inline-Anhänge listen (`ListInlineAttachments`), einfache Anhangsliste (`simpleAttachmentsList`) |
| Schreiben | Editor (`EditorDefaultType`, `editorWysiwyg` nur falls mehrere Editoren existieren, sonst weglassen), Markdown (`markdown`), Rechtschreibung (`allowSpellcheck`), Entwürfe automatisch (`AllowDraftAutosave`), in denselben Ordner antworten (`ReplySameFolder`), Kontakte automatisch speichern (`ContactsAutosave`), Lesebestätigung (`requestReadReceipt`), Zustellbestätigung (`requestDsn`), TLS (`requireTLS`), PGP-Vorgaben (`pgpSign`, `pgpEncrypt`), mailto-Handler |
| Benachrichtigungen | Desktop (`DesktopNotifications`, Erlaubnis-Status anzeigen, bei „verweigert“ den Hinweis `CHROME_NOTIFICATION_DESC_DENIED`), Ton (`SoundNotification`, `NotificationSound` mit Probehören) |

Bedienung: Speichern sofort pro Feld (wie alt), mit kurzer Bestätigung „Gespeichert“ in der Live-Region. Gruppen mit Mono-Label, dichte Formulare, Schalter für Ja/Nein, Auswahl für Listen.

### 6.2 Abschnitt „Sicherheit“ (neu)
- Automatisch abmelden nach (`AutoLogout`, Optionen aus `Settings/User/Security.js`). Der Client führt den Zeitgeber selbst und ruft `Logout`.
- Gespeichertes Schlüssel-Passwort vergessen (`keyPassForget`).
- Passwort ändern, wenn das Plugin `change-password` aktiv ist (Phase 9).
- Zwei-Faktor, wenn das Plugin `two-factor-auth` aktiv ist (Phase 9).

### 6.3 Abschnitt „Konten“ ergänzen
- Konto bearbeiten (Name, Passwort neu) über `AccountSetup` ohne `new`.
- Reihenfolge von Konten und Identitäten per Ziehen und per Auf/Ab-Knöpfe (`AccountsAndIdentitiesSortOrder`).
- Ungelesen-Zahl pro Konto (`AccountUnread`).
- Konto-Import (`AccountImport`) nur, wenn der Server es anbietet.

### 6.4 Abschnitt „Assistent“ (neu, nur wenn das Plugin aktiv ist)
Alt: `git show 653859c9c:plugins/ai-copilot/templates/AiCopilotSettingsTab.html` und `…/js/settings.js`.
- Assistent für dieses Konto an/aus (`enabled`), einzelne Funktionen an/aus (`features`), Standardton (`tone`), Sprache, Schreibstil, eigener Name, eigene Adressen (für „Antwort nötig“), Anbieter und Modell nur lesend, Datenschutzhinweis mit „Einwilligung zurücknehmen“ (`notice_ack: false`).
- Lesen über `AiGetSettings`, Schreiben über `AiSaveSettings`. Nach dem Speichern `readAssist` neu auswerten und die Assistenten-Teile ein- oder ausbauen, ohne Neuladen.

### 6.5 Tastenkürzel
- Liste im Dialog `#keys` auf den alten Umfang bringen (`PopupsKeyboardShortcutsHelp.html`): Postfach, Liste, Brief, Schreiben. Fehlende Kürzel einbauen: Allen antworten (A), Weiterleiten (F), Gelesen/Ungelesen (U/Umschalt+U), Wichtig (I), Verschieben (M), Alle auswählen, Thread öffnen, zur Ordnerliste/Liste/Brief wechseln, Vollbild, Zitate ein/aus, Senden, Speichern, Editor minimieren.
- Kürzel nie auslösen, während ein Eingabefeld oder `contenteditable` den Fokus hat.

### 6.6 Anmeldeseite
- Sprachauswahl auf der Anmeldeseite, wenn `allowLanguagesOnLogin` (alt `PopupsLanguages`).
- Sitzung abgelaufen (Fehler 101) mitten in der Arbeit: Anmelde-Dialog über der Hülle statt Seitenwechsel, offener Entwurf bleibt erhalten.

---

## 7. Phase 5: Kontakte – ERLEDIGT

> **Status: abgeschlossen am 2026-11-07.** Das Adressbuch ist eine eigene Ansicht (`ui/src/contacts.ts`, jCard in `ui/src/jcard.ts`): Eintrag unter den Ordnern und im Konto-Menü, Liste links, Karte rechts, mobil eine Spalte. Mehrere E-Mails, Telefon, URL, Adresse, Spitzname, Notiz, Organisation, Geburtstag und Krypto-Vorgaben kommen über „Hinzufügen“. Mehrfachauswahl, Löschen über `#confirm`, Mail an die Auswahl, Import und Export. Die Einstellungen zeigen nur noch CardDAV, und nur wenn die AppData `ContactsSync` enthalten.
>
> Geprüft: `npx tsc --noEmit`, `npm run build`, Token-Prüfung Schicht `app` ohne Fehler. In der Docker-Vorschau (Headless Chrome, `test@example.com`) angelegt, mit Telefon und Signaturvorgabe gespeichert, gesucht, importiert (eine vCard), als Mail geöffnet und nach Bestätigung gelöscht. Hell, Dunkel, 375 px, 800 px und 1280 px. Die Seitenleiste bleibt neben dem Buch, die Trefferflächen sind 28 px bzw. 44 px.
>
> Die Vorschau hatte `contacts.enable = Off`. Für die Prüfung steht es im Container auf `On` (`application.ini`, nicht im Git). **Nicht geprüft:** Blättern (zu wenige Kontakte), schreibgeschützte Karten, der Dialog bei ungespeicherten Änderungen, CardDAV. `allow_sync` ist aus, deshalb fehlt `ContactsSync` und die Sync-Oberfläche bleibt zu.

Alt: `dev/View/Popup/Contacts.js`, `Views/User/PopupsContacts.html`, `dev/Model/Contact.js`, `dev/DAV/*`, `Settings/User/Contacts.js`.
Neues Modul `ui/src/contacts.ts`. Kontakte bekommen eine eigene Ansicht (Eintrag in der Seitenleiste unter den Ordnern und im Konto-Menü), statt nur im Einstellungsdialog. Zwei Spalten: Liste links, Karte rechts. Mobil wie das Postfach.

- jCard vollständig: mehrere E-Mails, Telefone, Adressen, URLs, Spitzname, Notiz, Organisation, Abteilung, Titel, Geburtstag. Felder über „Feld hinzufügen“ (`ADD_MENU_*`). Bestehende `writeProp`-Logik in `settings.ts` dafür verallgemeinern und mitnehmen, nicht doppelt bauen.
- Krypto-Vorgaben pro Kontakt (Tab `CRYPTO`: signieren/verschlüsseln immer, wenn möglich, fragen, nie).
- Mehrfachauswahl, löschen (`ContactsDelete`), „Mail an Auswahl“, „Mail an alle Adressen des Kontakts“.
- Seitenweise laden statt „x / y“-Hinweis (`Contacts` mit `offset`/`limit`).
- Import vCard und CSV über `ServiceUploadContacts`. Export vCard und CSV über die Raw-URLs (alt `exportVcf`, `exportCsv`).
- CardDAV-Sync: Einstellungen URL, Benutzer, Passwort, an/aus (`SaveContactsSyncData`), Testen (`TestContactsSyncData`), „Jetzt synchronisieren“ (`ContactsSync`). Nur zeigen, wenn die AppData es erlauben.
- Aus dem Brief heraus „Zu Kontakten hinzufügen“ (Phase 1, 3.7).
- Der jetzige Kontakte-Abschnitt in den Einstellungen wird durch Sync-Einstellungen ersetzt.

---

## 8. Phase 6: Filter (Sieve) mit Formular – ERLEDIGT

> Umgesetzt in `ui/src/sieve/script.ts` und `ui/src/sieve/form.ts`, angebunden in `settings.ts` und `view.ts`.
>
> Ein Skript wird in Regeln zerlegt: Name, aktiv, alle oder eine Bedingung (Von, An, Betreff, Kopfzeile, Text, Größe; enthält, ist, beginnt, endet, Regex), Aktionen (verschieben, kopieren, weiterleiten mit und ohne Kopie, ablehnen, verwerfen, gelesen, markieren, stop). Die Abwesenheitsnotiz ist ein eigener Block (an/aus, Zeitraum über `currentdate`, Betreff, Text, Adressen, Intervall) und erscheint nur, wenn die Erweiterung `vacation` in `Filters` → `Capa` steht oder das Skript sie schon enthält. Sortierung per Ziehen und über Auf/Ab. „Skript bearbeiten“ öffnet den Rohtext. Was der Parser nicht abbildet, bleibt nur dort, mit dem Grund davor.
>
> Speichern läuft über `FiltersScriptSave`, Aktivieren über `FiltersScriptActivate`.
>
> Geprüft: `npx tsc --noEmit`, `npm run build`, Token-Prüfung Schicht `app` ohne neue Fehler. Ein Rundlauf aus Formularfeldern in Sieve und zurück hält Regeln, abgeschaltete Regeln und die Abwesenheitsnotiz. Ein `set` aus `variables` bleibt Rohtext.
>
> **Nicht geprüft:** der Filter-Abschnitt im Browser. In der Docker-Vorschau ist ManageSieve aus, der Abschnitt bleibt zu.

Alt: `dev/Sieve/**` (Parser, Modelle, Commands, Extensions), `dev/Settings/User/Filters.js`, `Views/User/SettingsFilters*.html`, `PopupsFilter.html`, `PopupsSieveScript.html`.

- Den Sieve-Parser aus `387e27b19:dev/Sieve` nach TypeScript übertragen (`ui/src/sieve/`). Er ist ohne Knockout nutzbar, nur die Modelle verwenden Observables. Diese durch einfache Objekte ersetzen.
- Skript in Regeln zerlegen. Jede Regel: Name, aktiv, Bedingungen (alle/eine; Feld Von/An/Betreff/Kopfzeile/Text/Größe; enthält/ist/beginnt/endet/Regex; Wert), Aktionen (in Ordner verschieben, kopieren, weiterleiten mit/ohne Kopie, ablehnen mit Text, verwerfen, als gelesen markieren, markieren, weitere Regeln stoppen).
- **Abwesenheitsnotiz** als eigener, gut sichtbarer Punkt: an/aus, Zeitraum, Betreff, Text, Adressen, Intervall in Tagen (Sieve `vacation`, alt `SettingsFiltersActionVacation.html`). Fehlt die Erweiterung `vacation` am Server, nicht anzeigen.
- Regeln per Ziehen und per Auf/Ab sortieren.
- Der Rohtext-Editor bleibt als „Skript bearbeiten“ für Fortgeschrittene. Ein Skript, das der Parser nicht in Regeln abbilden kann, nur im Rohtext öffnen und das sagen.
- Speichern über `FiltersScriptSave`, aktivieren über `FiltersScriptActivate`. Die Liste der verfügbaren Sieve-Erweiterungen kommt aus `Filters`.

Hinweis aus der README: In der Vorschau ist ManageSieve aus. Für die Prüfung Sieve im Test-Mailserver aktivieren oder den Stand als ungetestet melden.

---

## 9. Phase 7: Verschlüsselung

Alt: `dev/Stores/User/{OpenPGP,GnuPG,Pgp,SMime,Mailvelope}.js`, `dev/View/Popup/OpenPgp*.js`, `SMimeImport.js`, `Settings/User/Security.js`, `dev/Model/MimeHeaderAutocrypt.js`.
`AGENTS.md` sagt: kein neues Krypto-Produkt bauen. Also nur die Server-Wege (GnuPG, S/MIME) und die vorhandenen Aktionen nutzen. Browser-OpenPGP (OpenPGP.js) und Mailvelope nur, wenn der Benutzer es ausdrücklich will. Vorher fragen.

- Brief: verschlüsselte oder signierte Mails erkennen und Leiste zeigen: „Entschlüsseln“ (`GnupgDecrypt`, `SMimeDecryptMessage`), „Signatur prüfen“ (`PgpVerifyMessage`, `SMimeVerifyMessage`). Ergebnis mit `shield-check`/`shield-alert` und Klartext, wer signiert hat.
- Passwortabfrage für private Schlüssel im `dialog`, „für diese Sitzung merken“.
- Schreiben: Schalter Signieren/Verschlüsseln je nach vorhandenen Schlüsseln der Empfänger (`GetPGPKeys`, `PgpSearchKey`), Hinweis, wenn für einen Empfänger kein Schlüssel da ist.
- Schlüssel-Abschnitt ergänzen: Schlüssel anzeigen und exportieren (`GnupgExportKey`), löschen (`GnupgDeleteKey`, `DeletePGPKey`) mit Bestätigung, Schlüsselpaar erzeugen über GnuPG (`GnupgGenerateKey`), gespeicherte Schlüssel (`GetStoredPGPKeys`, `StorePGPKey`, `PgpStoreKeyPair`).
- S/MIME: Zertifikat erzeugen (`SMimeCreateCertificate`), privaten Schlüssel exportieren (`SMimeExportPrivateKey`), Zertifikate aus einer Mail übernehmen (`SMimeImportCertificatesFromMessage`).
- Autocrypt-Kopf beim Lesen: Schlüssel zum Import anbieten.

---

## 10. Phase 8: Admin

Alt: `dev/Settings/Admin/*.js`, `Views/Admin/*.html`, `dev/View/Popup/{Domain,DomainAlias,Plugin}.js`.
Neues Verzeichnis `ui/src/admin/`. Navigation links wie in den Benutzer-Einstellungen, dichte Formulare, dieselben Symbole.

| Abschnitt | Inhalt | Aktionen |
|---|---|---|
| Allgemein | Sprache, Admin-Sprache, Anhang-Grenze in MB, Sprachwahl für Benutzer erlauben. **Kein Theme-Feld.** | `AdminSettingsUpdate` |
| Anmeldung | Standard-Domain, weitere Anmelde-Optionen aus `AdminSettingsLogin.html` | `AdminSettingsUpdate` |
| Domains | Anlegen und Bearbeiten: IMAP, SMTP, Sieve (Server, Port, Verschlüsselung, Anmeldung, Zeitlimit), Ordner-Optionen, Limits, Spam-/Viren-Kopfzeilen, Fähigkeiten abschalten, Whitelist. Verbindung testen, Autoconfig, Domain-Abgleich testen, Aliase | `AdminDomainLoad`, `AdminDomainSave`, `AdminDomainTest`, `AdminDomainAutoconfig`, `AdminDomainMatch`, `AdminDomainAliasSave` |
| Kontakte | Speicher (Typ, DSN, Benutzer, Passwort), Testen, Grenze für Vorschläge | `AdminSettingsUpdate`, `AdminContactsTest` |
| Sicherheit | Admin-Benutzer und Passwort ändern, TOTP einrichten mit QR-Code, weitere Sicherheitsschalter | `AdminPasswordUpdate`, `AdminQRCode`, `AdminSettingsUpdate` |
| Branding | Seitentitel, Favicon-URL, Ladetext | `AdminSettingsUpdate` |
| Plugins und Pakete | Installierte, verfügbare und aktualisierbare Pakete; installieren, entfernen; Plugin an/aus; Plugin-Einstellungen als generisches Formular aus den Property-Typen (`AdminSettingsPluginProperty.html`) | `AdminPackagesList`, `AdminPackageInstall`, `AdminPackageDelete`, `AdminPluginDisable`, `AdminPluginLoad`, `AdminPluginSettingsUpdate` |
| Konfiguration | Alle Werte aus `application.ini` als gruppierte Tabelle, bearbeitbar | `AdminSettingsGet`, `AdminSettingsSet` |
| Über | Version, Update-Prüfung, Core-Update nur mit Bestätigung, Cache leeren, Sicherung | `AdminInfo`, `AdminUpgradeCore`, `AdminClearCache`, `AdminBackup` / `ServiceBackup` |

Hinweis „schwaches Admin-Passwort“ gibt es schon (`weak` in `admin.ts`), dort auf den Abschnitt Sicherheit verlinken.

---

## 11. Phase 9: Plugins mit eigener Oberfläche

Diese Plugins haben JS oder Templates für das alte Frontend und tun in der neuen Oberfläche nichts mehr:
`attachments-force-open`, `avatars`, `backup`, `change-password`, `compact-composer`, `contact-group-excel-paste`, `demo-account`, `example`, `haveibeenpwned`, `ics-viewer`, `kolab`, `login-gmail`, `login-o365`, `login-oauth2`, `login-register`, `nextcloud`, `proxy-auth`, `recaptcha`, `search-filters`, `send-save-in`, `snowfall-on-login-screen`, `two-factor-auth`, `video-on-login-screen`, `view-ics`, `wysiwyg-example`.

Vorgehen:
1. In der Ziel-Installation nachsehen, welche Plugins aktiv sind (`[plugins] enabled_list` in `application.ini`, im Admin unter Plugins). Nur aktive oder vom Benutzer gewünschte Plugins portieren. Die Liste vorher dem Benutzer zeigen.
2. Native Umsetzung statt Plugin-JS für diese, falls aktiv:
   - `change-password` → Abschnitt Sicherheit, PHP-Hook des Plugins aufrufen.
   - `two-factor-auth` → Abschnitt Sicherheit (Einrichten mit QR, Codes) und zweiter Schritt bei der Anmeldung.
   - `ics-viewer` / `view-ics` → Termin-Karte im Brief (Phase 1, 3.9).
   - `avatars` → Avatar in Liste und Briefkopf, mit Initialen als Rückfall im Pixel-Stil.
   - `login-oauth2` / `login-gmail` / `login-o365` → zusätzliche Anmeldeknöpfe.
   - `send-save-in` → Ordnerwahl „Gesendet speichern in“ im Editor.
   - `search-filters` → „Filter aus Suche anlegen“ in der erweiterten Suche.
3. Für den Rest eine kleine Erweiterungsschnittstelle nur dann bauen, wenn mindestens zwei aktive Plugins sie brauchen. Nicht vorab.
4. `snowfall-on-login-screen`, `video-on-login-screen`, `example`, `wysiwyg-example`, `demo-account` nicht portieren.

---

## 12. Bewusst nicht zurück

| Alt | Grund |
|---|---|
| Themes (`Settings/User/Themes.js`, `Stores/Theme.js`, Admin-Theme-Feld, `ServiceCss`-Themes) | Vom Benutzer ausgeschlossen. Erscheinungsbild bleibt System/Hell/Dunkel. |
| Hintergrundbild des Benutzers | Teil der Themes |
| Schriftwahl (`fontSansSerif`, `fontSerif`, `fontMono`) | Teil der Themes; das Design legt Inter und Space Mono fest. `minFontSize` bleibt. |
| Squire und andere WYSIWYG-Bibliotheken | Ersetzt durch den kleinen `contenteditable`-Editor |
| Mailvelope, Browser-OpenPGP | Nur auf ausdrücklichen Wunsch (`AGENTS.md`) |
| Alte KI-Seitenleiste, Zauberstab, `PopupsAiDraft` | Ersetzt durch das Blatt auf dem Brief |

---

## 13. Reihenfolge und Umfang

| Phase | Inhalt | Priorität |
|---|---|---|
| 0 | Symbolsystem | Erledigt |
| 1 | Liste und Brief (3.1–3.11) | Erledigt |
| 2 | Schreiben (Anhänge, Identität, Entwürfe, Vorschläge, Editor) | Erledigt |
| 3 | Ordner, Suche, Sortierung, Threads | Erledigt |
| 4 | Einstellungen Allgemein, Sicherheit, Konten, Assistent, Tasten | Erledigt |
| 5 | Kontakte | Erledigt |
| 6 | Sieve-Formular, Abwesenheitsnotiz | Erledigt |
| 7 | Verschlüsselung | Niedrig bis mittel |
| 8 | Admin | Mittel |
| 9 | Plugins | Nach Rückfrage beim Benutzer |

Große Phasen in mehrere Commits teilen, zum Beispiel Phase 1 in „Mehrfachauswahl und Sammelaktionen“, „Externe Bilder und Darstellung“, „Briefkopf und Briefmenü“.

## 14. Fertig, wenn

- Jede Funktion aus den Phasen 1 bis 8 ist im Browser benutzt worden, oder sie ist ausdrücklich als „ungetestet, weil …“ gemeldet.
- `npx tsc --noEmit`, `npm run build` und die Token-Prüfung laufen ohne Fehler.
- Ein Review mit `/apple-design` über Postfach, Editor, Einstellungen, Kontakte und Admin hat keine offenen Befunde der Stufe „hoch“.
- Ein Review mit `/mistral-design` bestätigt: nur Tokens aus `app-tokens.css`, ein Symbolsatz, Orange nur für Fokus, Auswahl und „Antwort nötig“.
- Ohne Plugin `ai-copilot` sieht das Postfach vollständig und ohne Assistenten-Reste aus.
- `README.md` (Abschnitt „Einstellungen und Admin“) und `AGENTS.md` (Abschnitt „Wo was liegt“) beschreiben die neuen Module.
