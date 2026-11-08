# Plan: Geöffnete E-Mail im SnappyMail-Client verbessern

## 1. Arbeitsauftrag

Die Leseansicht einer einzelnen geöffneten E-Mail soll ruhiger, übersichtlicher und angenehmer zu bedienen werden. Der Fokus liegt auf:

1. **Lesen:** Betreff, Absender, Hinweise und Inhalt bekommen eine klare visuelle Reihenfolge.
2. **Handeln:** Häufige Aktionen bleiben sofort erreichbar; seltene Aktionen verdrängen sie nicht.
3. **Stabilität:** Kleine Änderungen am Kopf dürfen den Brief nicht neu laden oder die Leseposition verschieben.
4. **Zugänglichkeit:** Tastatur, Screenreader, Touch, Hell/Dunkel und schmale Breiten werden mitgeprüft.

Dieser Plan ist als Arbeitsgrundlage für eine andere Session gedacht. Er beschreibt bewusst konkrete Dateien, Schritte und Abnahmekriterien, ohne bereits Code zu ändern.

## 2. Annahmen und Abgrenzung

- Mit „Fenster einer geöffneten E-Mail“ ist die **Brief-Spalte im Hauptprogramm** gemeint, einschließlich ihres Vollbildmodus und der mobilen Einzelansicht.
- Nicht Teil des ersten Durchlaufs sind die Sammelansicht bei Mehrfachauswahl, der Composer, die Mail-Liste und das separate Druck-/Browserfenster aus `openLetterWindow()`.
- Die PHP-JSON-API und das Datenmodell sollen unverändert bleiben. Die Verbesserungen lassen sich überwiegend in TypeScript und CSS umsetzen.
- Der Brief bleibt im sandboxed iframe. CSP, Referrer-Policy, Bereinigung, Tracking-Schutz und die ausdrückliche Freigabe externer Bilder bleiben unangetastet.
- Es gibt keine neue vierte Spalte und keinen neuen Assistenten. Vorhandene Assistenten-Elemente bleiben Blatt beziehungsweise Strip über beziehungsweise vor dem Brief.
- Die folgende Bestandsaufnahme stammt aus dem Code. Vor der Umsetzung ist zusätzlich ein kurzer visueller Basistest im Browser vorgesehen.

## 3. Relevante Stellen im Code

| Datei | Heutige Aufgabe | Vorgesehene Änderung |
| --- | --- | --- |
| `ui/src/view.ts` | Aktionsleiste um Zeile 449, `paintBar()` um Zeile 725, Detail-Handler um Zeile 1019, `setReader()` um Zeile 2127 | Aktionsgruppen und responsives Overflow-Verhalten; Detailumschaltung entkoppeln; Lade-/Leerzustände stabilisieren |
| `ui/src/reader.ts` | `renderReader()` um Zeile 149 erzeugt Kopf, Hinweise, Kalender, Anhänge und iframe | Kopf semantisch gliedern; stabilen Detailcontainer schaffen; leere Schlagwortzeile vermeiden; Hinweise und Anhänge verdichten |
| `ui/src/letter.ts` | `srcdoc()` um Zeile 21 legt CSP und Basistypografie im iframe fest | Nur Innenabstand und Lesetypografie behutsam anpassen; Sicherheitsregeln nicht verändern |
| `ui/src/styles/shell.css` | Reader-Leiste um Zeilen 363–381 und 2311–2326; Briefstile um 1483–1575; allgemeine Tokens und Breakpoints | Gezielte Reader-Regeln, Container Queries, Abstände, Touch-Ziele und Zustände |
| `ui/src/styles/app-tokens.css` | Einzige Token-Datei | Bestehende Tokens verwenden; keine zweite Farbwelt und keine Marketing-Tokens einführen |
| `ui/src/mail.ts` | `paintLetter()` um Zeile 1312 erzeugt `ReaderData`; lädt und säubert den Brief | Nur anfassen, wenn für eine sichtbare Verbesserung tatsächlich zusätzliche Daten nötig sind |
| `ui/src/i18n.ts` sowie `snappymail/v/0.0.0/app/localization/de` und `en` | Übersetzungen | Neue sichtbare Texte über `t()` und vorhandene Schlüsselstruktur führen; deutscher Fallback im Aufruf |

## 4. Codebasierte Bestandsaufnahme und Zielbild

| Vorher | Nachher | Warum |
| --- | --- | --- |
| Die Reader-Leiste enthält viele gleichrangige Aktionen; `flex-wrap` kann bei Platzmangel eine mehrzeilige Werkzeugleiste erzeugen. | Feste Prioritäten: Antworten bleibt dominant, wenige Kernaktionen bleiben direkt sichtbar, der Rest geht kontrolliert in „Weitere Aktionen“. Keine zufällig umbrechende Leiste. | Die wichtigste Handlung ist schneller erkennbar und die Briefhöhe bleibt stabil. |
| „Details anzeigen“ ruft erneut `renderReader()` auf und ersetzt dabei auch das iframe. | Nur der Kopf-Detailcontainer und der Schalter werden aktualisiert; das bestehende iframe bleibt unangetastet. | Kein erneutes Laden des Briefs, kein Flackern und keine verlorenen Zustände im Brief beim bloßen Aufklappen von Metadaten. |
| Die Schlagwortzeile mit „Schlagwort hinzufügen“ wird auch dann ausgegeben, wenn keine Schlagworte existieren. | Bestehende Schlagworte bleiben sichtbar; eine leere Schlagwortzeile entfällt. Hinzufügen bleibt über das vorhandene Menü möglich. | Weniger dauerhafter UI-Lärm zwischen Metadaten und Inhalt. |
| Mehrere Hinweisleisten können untereinander stehen; Bildblockade und Ladefehler werden getrennt gemeldet. | Hinweise bilden eine klar geordnete Region. Bildblockade und nicht erreichbare Bilder können in einer gemeinsamen, weiterhin handlungsfähigen Bildnotiz zusammengefasst werden. Sicherheitskritische Zustände bleiben eigenständig und deutlich. | Der Brief beginnt früher, ohne Warnungen oder Wahlmöglichkeiten zu verstecken. |
| Anhänge stehen vollständig vor dem Brief und können bei vielen Dateien den Inhalt weit nach unten schieben. | Kompakte, gut scanbare Anhangsliste; bei vielen Anhängen zunächst eine kleine Auswahl mit lokalem „Alle anzeigen“. Vorschau und Download bleiben unverändert. | Der Inhalt hat Vorrang, Anhänge bleiben aber ohne Serveränderung erreichbar. |
| Kopf und iframe wirken eher wie aneinandergereihte technische Bereiche; das iframe hat einen harten Rahmen mit Radius 0. | Eine gemeinsame Lesespalte, ruhigere Typografie und eine zurückhaltende Papierfläche mit vorhandenem Radius und Haarlinie. | Die Mail wirkt als zusammenhängender Brief statt als Sammlung von Bedienelementen. |
| Laden wird durch einen einfachen Text im ansonsten geleerten Reader dargestellt. | Ein stabiler, klar benannter Ladezustand mit ausreichender Mindesthöhe; Fehler und Leerzustand bleiben unterscheidbar. | Weniger Sprünge und verständlichere Rückmeldung. |
| Der Detail-Schalter hat im ausgeklappten Zustand weiterhin den Titel „Details anzeigen“; das iframe heißt allgemein „Brief“. | Titel und `aria-expanded` beschreiben immer den aktuellen Zustand; der iframe-Titel enthält den Betreff. Die Aktionsleiste erhält eine Toolbar-Benennung. | Konsistentere Bedienung mit Hilfstechnologien und bessere Tooltips. |

## 5. Gewünschte Informationsarchitektur

### 5.1 Aktionsleiste

Die vorhandenen `data-action`-Namen und Mail-Aktionen bleiben erhalten. Die Verbesserung erfolgt durch Gruppierung und Sichtbarkeit, nicht durch neue Aktionslogik.

**Gruppen:**

1. **Navigation links:** mobiler Zurück-Knopf und vorhandener Ordner-/Kontexttext.
2. **Hauptaktionen:** `Antworten` als Tinten-Schalter, danach `Allen antworten` und `Weiterleiten`.
3. **Bearbeitung/Ablage:** Archivieren und Löschen dürfen bei ausreichender Breite direkt sichtbar bleiben. Ungelesen, Markieren, Verschieben und Spam sind Kandidaten für das vorhandene Menü, wenn die Leiste sonst zu dicht wird.
4. **Weitere und Blättern:** „Weitere Aktionen“ sowie vorherige/nächste Mail bilden den rechten Abschluss.
5. **Assistent:** Der vorhandene Auslöser wird nur eingefügt, wenn die Funktion aktiv ist. Er darf die Hauptaktion nicht verdrängen.

**Responsives Prinzip:**

- Sichtbarkeit an der tatsächlichen Reader-Breite über Container Queries ausrichten, nicht an der Fensterbreite.
- Bei schmaler Breite zuerst Textlabels reduzieren, danach sekundäre Aktionen ins Menü verschieben.
- Keine unbeabsichtigte zweite Werkzeugzeile. Falls ein Umbau des bisherigen `flex-wrap` nötig ist, muss jedes direkt sichtbare Element weiterhin per Tastatur erreichbar sein.
- Keine doppelten, widersprüchlichen Zustände: Direktaktion und Menüeintrag müssen von `paintBar()` gemeinsam und konsistent aktualisiert werden.
- Alle reinen Symbolknöpfe brauchen einen sprechenden `aria-label`-Text und einen Titel. Vorhandene Kurzhinweise wie J/K bleiben erhalten.

### 5.2 Briefkopf

Die Reihenfolge bleibt bewusst schlicht:

1. Betreff, optional mit vorhandener Markierung.
2. Absender als stärkste Metadatenzeile, Datum und Sicherheitsstatus auf derselben Zeile, sofern Platz vorhanden ist.
3. Kompakte Empfängerzeile im eingeklappten Zustand.
4. Aufklappbare vollständige Details.
5. Nur vorhandene Schlagworte; keine permanente leere Aktionszeile.

**Gestaltung:**

- Betreff auf schmalen Screens bei etwa 20 px belassen und bei ausreichender Breite moderat auf 22–24 px erhöhen; mehrzeilige und sehr lange Betreffe müssen umbrechen.
- Keine Avatar-Funktion, keine Kartenhierarchie und keine dekorativen Badges neu erfinden.
- Sekundärtext über den vorhandenen `--text-quiet`-Ausdruck beziehungsweise die vorgeschriebene `color-mix(...)`-Regel.
- Orange nur für Fokus, Auswahl und die bereits definierten Signale. Sicherheitsfehler verwenden weiterhin `--destructive`.

### 5.3 Hinweise, Kalender und Anhänge

- Hinweise bleiben zwischen Kopf und Brief, erhalten aber eine gemeinsame Struktur und konsistente Abstände.
- Bildblockade und Bildladefehler können zusammen eine Bildnotiz bilden. Beispiel: „3 externe Bilder blockiert · 1 Bild nicht erreichbar.“ Die Aktionen `Anzeigen` und `Immer für diesen Absender` bleiben erhalten und werden nicht automatisch ausgelöst.
- Ungültige Signatur, Virus-/Spamwarnung und Lesebestätigung nicht in einer Weise zusammenfassen, die ihre Bedeutung oder notwendigen Aktionen verwässert.
- Ein bereits verifizierter Sicherheitsstatus darf im Kopf als Badge genügen, sofern dieselbe Information in einer Hinweisleiste nur wiederholt wird. Aktionen wie Entschlüsseln oder Schlüsselübernahme müssen weiterhin sichtbar bleiben.
- Kalenderinformationen bleiben vor dem Brief, aber kompakt und ohne neue Karten auf Karten.
- Anhänge erst nach den Kernverbesserungen progressiv aufklappbar machen. Der Aufklappzustand ist reine lokale UI und darf weder Serveraufrufe noch die Maildaten verändern.

### 5.4 Brieffläche und Lesemaß

- `.read-measure` bleibt die gemeinsame Ausrichtung für Kopf und Inhalt. Die vorhandene Maximalbreite von 72 rem ist ein brauchbarer Ausgangspunkt und soll nur nach einem Screenshot-Vergleich angepasst werden.
- Reine Textmails behalten ein Lesemaß um 72 ch. HTML-Newsletter dürfen ihre notwendige Breite nutzen; keine starre 72-ch-Begrenzung auf alle HTML-Mails anwenden.
- Das iframe erhält eine zurückhaltende, zur Oberfläche passende Papierfläche. Den vorhandenen `--radius` verwenden; kein Radius 0 als neue Designentscheidung.
- Innenabstand im `srcdoc`: 16 px auf schmalen Screens, etwa 24 px bei ausreichender Breite. Vorhandene Bild-, Tabellen-, Blockquote- und Umbruchregeln beibehalten.
- Keine aufwendige Karte mit Schatten um jede Mail. Der Inhalt soll ruhiger wirken, nicht wie ein Dashboard.
- Beim Öffnen und beim J/K-Wechsel keine Einblend- oder Slide-Animation. Diese Aktionen sind häufig und teilweise tastaturgesteuert; sofortiges Anzeigen ist hier die bessere Politur.

## 6. Umsetzung in kleinen, prüfbaren Schritten

### Schritt 0: Sichtbaren Ist-Zustand sichern

- [ ] Docker-Vorschau nach `README.md` beziehungsweise `AGENTS.md` verwenden und mit dem Testkonto öffnen.
- [ ] Screenshots einer normalen HTML-Mail, einer Textmail und einer Mail mit Anhängen in Hell und Dunkel aufnehmen.
- [ ] Mindestens die Reader-Breiten schmal, mittel und sehr breit prüfen; zusätzlich mobile Einzelansicht und Vollbild.
- [ ] Eine Mail mit blockierten externen Bildern und eine mit aufklappbaren Details als Verhaltensbaseline nutzen.
- [ ] Festhalten, welche Probleme tatsächlich sichtbar sind. Keine große Umgestaltung allein aufgrund dieser codebasierten Bestandsaufnahme durchführen.

### Schritt 1: Detailumschaltung ohne iframe-Neuaufbau

- [ ] In `renderReader()` einen immer vorhandenen Detailcontainer einführen, der entweder die kompakte Empfängerzeile oder die vollständigen Details enthält.
- [ ] Die Erzeugung dieses Containers in eine kleine Hilfsfunktion auslagern, damit `renderReader()` und der Detail-Handler dieselbe Ausgabe verwenden.
- [ ] Im `m-details`-Zweig von `ui/src/view.ts` nur diesen Container und den Schalter aktualisieren. Nicht mehr `renderReader()` für die gesamte Mail aufrufen.
- [ ] `aria-expanded`, dynamisches `aria-label`, dynamischen `title` und Chevron gemeinsam setzen; Fokus mit `focus({ preventScroll: true })` erhalten.
- [ ] Scrollposition des Reader-Bodys erhalten und prüfen, dass das iframe kein neues `load`-Ereignis auslöst.
- [ ] `expanded` beim Wechsel auf eine andere Mail bewusst auf den bisher gewünschten Ausgangszustand zurücksetzen beziehungsweise das bestehende Verhalten unverändert dokumentieren; keinen versehentlichen Zustandsübertrag zwischen Mails einführen.

**Abnahme:** Das Auf- und Zuklappen verändert ausschließlich die Metadaten. Inhalt, iframe-Identität, Bildzustand und Leseposition bleiben stabil.

### Schritt 2: Kopf und semantische Details verbessern

- [ ] Leere Schlagwortzeile nicht mehr ausgeben; vorhandene Schlagworte und ihre Entfernen-Knöpfe unverändert unterstützen.
- [ ] Betreff, Absender, Datum und Empfänger über Abstände und Schriftgewicht staffeln, ohne neue Token-Familie einzuführen.
- [ ] iframe-Titel mit dem vorhandenen Betreff versehen; bei fehlendem Betreff den vorhandenen Fallback verwenden.
- [ ] Der Reader-Leiste eine passende Toolbar-Rolle und einen deutschen, übersetzten Namen geben, sofern dies nicht die vorhandenen Menü- und Tastaturmechaniken stört.
- [ ] Touch-Ziele der kleinen Detail-, Schlagwort- und Anhangsaktionen prüfen; auf groben Zeigern 44 px anstreben, ohne die Desktop-Dichte zu verlieren.
- [ ] Alle neuen sichtbaren Texte über `t()` führen und deutsche sowie englische Lokalisierung ergänzen.

**Abnahme:** Langer Betreff, unbekannter Absender, viele Empfänger, keine Empfänger und mehrere Schlagworte erzeugen weder Überlappung noch horizontales Scrollen.

### Schritt 3: Aktionsleiste priorisieren

- [ ] Die bestehenden Knöpfe in klar benannte Gruppen zusammenfassen, ohne Bulk-Leiste und Composer zu verändern.
- [ ] `Antworten` bleibt die einzige dauerhaft dominante Primäraktion; die bisherige Tintenfläche wird beibehalten.
- [ ] Breitenabhängige Sichtbarkeit zentral und nachvollziehbar in `paintBar()` halten. CSS darf die Darstellung ergänzen, aber keine verborgenen Aktionen logisch „verschwinden“ lassen, die im Menü dann fehlen.
- [ ] Schmale Container: zuerst nur Symbole, dann sekundäre Aktionen ins vorhandene Menü. Direktaktionen und Menüeinträge müssen denselben Zustand für Markierung, Gelesen, Spam und Löschen zeigen.
- [ ] Umbrechen der Reader-Leiste verhindern oder durch eine ausdrücklich gestaltete mobile Variante ersetzen. Keine zufällige Höhenänderung beim Wechsel zwischen Mails mit unterschiedlichen verfügbaren Aktionen.
- [ ] Menüfokus, Escape, Rückfokus und Tastaturaktionen nach dem Umbau testen.

**Abnahme:** Bei jeder Breite sind Antworten, Weitere und die mobile Rücknavigation erreichbar. Keine Aktion ist ausschließlich über Hover erreichbar; keine Leiste wächst unerwartet auf zwei Zeilen.

### Schritt 4: Hinweise und Brieffläche beruhigen

- [ ] Hinweise in einem gemeinsamen Container ausgeben und nur vorhandene Zustände rendern.
- [ ] Bildblockade und Ladefehler zusammenführen, sofern beide gleichzeitig vorliegen; Text und Aktionen bleiben vollständig.
- [ ] Doppelte, rein informative Kryptografie-Darstellung reduzieren, ohne schlechte Signaturen oder notwendige Aktionen abzuschwächen.
- [ ] Rahmen, Radius, Hintergrund und Abstände der Brieffläche an das Zielbild angleichen. Nur bestehende Tokens verwenden.
- [ ] `srcdoc()` ausschließlich für Innenabstand und nachweislich hilfreiche Lesetypografie anpassen. CSP, `sandbox`, `referrerPolicy` und externe Bildlogik nicht verändern.
- [ ] Ladezustand mit Mindesthöhe und klarer Statusmeldung gestalten; Fehler weiterhin als Fehler und nicht als leerer Brief ausgeben.

**Abnahme:** Eine einfache Mail wirkt ruhiger und beginnt näher am sichtbaren Anfang. Mehrere Warnungen bleiben verständlich und handlungsfähig. Externe Inhalte werden niemals automatisch freigegeben.

### Schritt 5: Anhänge nur bei nachgewiesenem Platzproblem erweitern

- [ ] Bei wenigen Anhängen die bestehende Liste lediglich visuell verdichten.
- [ ] Bei vielen Anhängen optional die ersten vier zeigen und einen lokalen Schalter „Alle N Anhänge anzeigen“ anbieten.
- [ ] Den Schalter als echten Button mit `aria-expanded` und beschrifteter Beziehung zur Liste umsetzen.
- [ ] Beim erneuten Rendern derselben Mail einen sinnvollen lokalen Zustand erhalten; beim Mailwechsel nicht versehentlich alle Anhänge der nächsten Mail aufklappen.
- [ ] ZIP, Vorschau, Download, einfache Listenansicht und Vorschaubilder unverändert testen.

**Abnahme:** Zwölf Anhänge verdrängen den Brief nicht dauerhaft; jede Datei bleibt mit Tastatur erreichbar und herunterladbar. Falls dieser Schritt das Verhalten unnötig komplex macht, weglassen und nur die kompakte Liste behalten.

## 7. Prüfmatrix

### Inhaltliche Fälle

- Normale HTML-Mail und reine Textmail.
- Sehr langer Betreff, fehlender Betreff, sehr lange Absenderadresse.
- Viele Empfänger, Cc/Bcc, abweichende Antwortadresse.
- Keine, ein und mehrere Schlagworte.
- Blockierte und fehlgeschlagene externe Bilder, jeweils getrennt und gemeinsam.
- Verifizierte und ungültige Signatur, verschlüsselte Mail, Autocrypt-Hinweis.
- Spam-/Virenwarnung, Lesebestätigung, als gelöscht markierte Mail.
- Kalendereintrag sowie ein, vier und zwölf Anhänge.
- Langer Newsletter, breite Tabelle, großes Bild, verschachtelte Zitate und lange URL.

### Darstellung und Bedienung

- Helles, dunkles und System-Erscheinungsbild.
- Schmale Reader-Spalte, geteilte Desktopansicht, Vollbild und mobile Breite um 320 px.
- `prefers-contrast: more` und `prefers-reduced-motion: reduce` prüfen.
- Reine Tastaturbedienung: Details, Adressmenü, Weitere, Anhänge, Antworten, Löschen und J/K-Navigation.
- Fokus sichtbar, kein Fokus-Sprung durch Scrollen, Rückfokus nach Menüschluss.
- Kein horizontaler Seiten- oder Reader-Scroll bei normalen Textmails. Absenderseitig zu breite HTML-Inhalte dürfen nicht unkontrolliert die komplette Anwendung sprengen.
- Nach Detailwechsel und Hinweisaktionen keine unerwartete Rückkehr zum Briefanfang.

### Technische Prüfung

In `ui/` ausführen:

```sh
npx tsc --noEmit
npm run build
```

Zusätzlich:

- [ ] Bei Styleänderungen die Token-Prüfung aus dem Skill `mistral-design` gemäß `AGENTS.md` ausführen: Schicht `app`, Ziel `ui/src`.
- [ ] Sichtbare Änderungen unter `http://localhost:8888` im Browser nachsehen.
- [ ] Kein lebendes KI-Modell für diese UI-Arbeit aufrufen; vorhandene Assistenten-Zustände nur mit lokalen/Mock-Daten prüfen.
- [ ] Vom Build veränderte Dateien unter `snappymail/v/0.0.0/static/` zum Umfang gehören lassen; keine nicht zusammenhängenden PHP- oder Admin-Änderungen erzeugen.

## 8. Definition of Done

Die Arbeit ist abgeschlossen, wenn:

- Der Brief beim Aufklappen der Details nachweislich nicht neu geladen wird.
- Betreff, Absender, Hinweise und Inhalt eine klare, ruhige Hierarchie haben.
- Die Aktionsleiste in schmalen und breiten Readern kontrolliert reagiert und keine Aktion verliert.
- Leere Schlagwort- und Hinweisbereiche keinen Platz verbrauchen.
- Text- und HTML-Mails in Hell und Dunkel gut lesbar bleiben.
- Tastatur, Fokus, Touch-Ziele und reduzierte Bewegung geprüft sind.
- Typecheck, Build und Token-Prüfung erfolgreich sind und die sichtbaren Ergebnisse im Browser kontrolliert wurden.

## 9. Empfohlene Lieferung

Nicht alles in einen einzigen großen Patch packen. Der sinnvollste erste Durchlauf umfasst **Schritte 0 bis 4**; Schritt 5 ist davon entkoppelt und nur bei sichtbarem Mehrwert umzusetzen.

Als kleinste wertvolle erste Änderung eignet sich **Schritt 1 plus die leere Schlagwortzeile und die korrekten Detail-Titel aus Schritt 2**. Danach folgen visuelle Hierarchie und Aktionsleiste. So lässt sich jedes Verhalten isoliert prüfen, ohne die Sicherheits- und Ladekette des Briefs umzubauen.
