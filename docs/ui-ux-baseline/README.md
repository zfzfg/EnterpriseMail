# Phase 0 — Sicht- und Interaktionsbasis

Stand der Oberfläche vor der Politur aus `docs/ui-ux-polish-plan.md`. Aufgenommen am 2026-11-07 gegen die lokale Docker-Vorschau `http://127.0.0.1:8888` mit `test@example.com`. Quellstand `bca953869`. Diese Phase ändert kein Layout und keine Funktion; sie hält den Ist-Zustand fest.

Die Aufnahmen liegen als JPEG unter `screenshots/`. Hell und dunkel kommen aus `localStorage` (`sm-appearance`), nicht aus einer zweiten Gestaltung.

## Breiten

Posteingang, je hell und dunkel:

| Datei | Breite | Höhe |
| --- | ---: | ---: |
| `*-w375-inbox.jpg` | 375 | 812 |
| `*-w799-inbox.jpg` | 799 | 812 |
| `*-w800-inbox.jpg` | 800 | 900 |
| `*-w1279-inbox.jpg` | 1279 | 900 |
| `*-w1280-inbox.jpg` | 1280 | 900 |
| `*-w1600-inbox.jpg` | 1600 | 900 |

`light-w1600-reader.jpg` und `dark-w1600-reader.jpg` zeigen den offenen Brief auf der breiten Lesefläche.

## Zustände bei 1280 px

| Datei | Inhalt |
| --- | --- |
| `*-w1280-current.jpg` | offene Zeile (`aria-current`) |
| `*-w1280-checked.jpg` | zweite Zeile angehakt |
| `*-w1280-flagged.jpg` | Markierung der ersten Zeile umgeschaltet |
| `*-w1280-thread.jpg` | Unterhaltungen kurz eingeschaltet, Zähler sichtbar, Einstellung danach wieder aus |
| `*-w1280-empty.jpg` | Suche `zzzz-leer-baseline`, leere Liste |
| `*-w1280-attachment.jpg` | Suche `Anhänge`, Brief mit Anhang |
| `*-w1280-security.jpg` | Suche `gewonnen`, Hinweis im Brief |
| `*-w1280-long-subject.jpg` | Suche `Sehr`, langer Betreff aus dem Seed |
| `*-w1280-long-labels.jpg` | Ordner- und Kontotext nur für die Aufnahme verlängert, danach neu geladen |
| `*-w1280-menu.jpg` | Ansichtsmenü |
| `*-w1280-account-menu.jpg` | Kontomenü |
| `*-w1280-composer.jpg` | Editor |
| `*-w375-composer.jpg` | derselbe Editor bei 375 px |
| `*-w1280-assistant.jpg` | Blatt „Copilot fragen“ |

Ungelesen und gelesen liegen im Posteingang der Inbox-Aufnahmen nebeneinander. Die langen Beschriftungen sind eingesetzter Text im DOM, kein Produktstand.

## Tastatur und Fokus

Vertrag im Quellstand (`ui/src/view.ts`, `closeLayer`, Ordnerpfeile, `compose.ts`):

- Escape schließt das offene Menü und setzt den Fokus auf den Auslöser (`menuReturn`). Ein offener Dialog schluckt Escape vorher.
- Escape bei abgedockter Seitenleiste schließt sie. Auf schmalen Breiten wechselt Escape im Adressbuch von der Karte zur Liste, sonst schließt es das Buch.
- `\` klappt unter 800 px zwischen Ordnern und Liste, darüber die Seitenleiste. In Eingabefeldern gilt die Taste nicht.
- `1`, `2`, `3` setzen den Fokus auf den ersten Ordnerknopf, die aktuelle Zeile oder den ersten Knopf im Leser. Den Bereich wechseln sie nur unter 800 px, Taste `1` auch darüber.
- `J` und `K` wandern in der Liste, Enter öffnet die aktuelle Zeile. Auf schmalen Breiten wechselt die Auswahl in den Leser. Kein animiertes Scrollen.
- `?` öffnet den Tasten-Dialog `#keys`.
- `C` öffnet den Editor. Schließen gibt den Fokus an den Auslöser zurück (`compose.ts`).
- `closeLayer` gibt den Fokus an den Auslöser zurück, auch wenn die Schließbewegung noch läuft.
- Ordnerpfeile rufen `focus({ preventScroll: true })` und danach `scrollIntoView({ block: "nearest" })`.

Gemessen in derselben Sitzung (`flows.json`):

- `J`/`K`/Enter wechseln die aktuelle UID und öffnen den Brief. Enter landete auf „Undelivered Mail Returned to Sender“.
- Ansichtsmenü: erster Eintrag hat den Fokus, Escape schließt und der Fokus liegt wieder auf `[data-action=view-menu]`.
- `C` fokussiert ein Eingabefeld. Schließen räumt den Editor ab. Der Fokus lag danach auf `view-menu`, weil dieser Knopf vorher aktiv war, nicht auf „Neue Nachricht“.
- Bei 1280 px: Taste `2` fokussiert eine Zeile, Taste `1` die Seitenleiste. Taste `3` landete nicht in `.reader`.
- Bei 375 px: Taste `2` bleibt bei der Liste, Taste `3` öffnet den Leser. `\` hat in diesem Lauf den Bereich nicht verlassen; der Fokus kann in einem Feld gelegen haben.
- `?` öffnet `#keys`.

Diese Abweichungen sind der Ausgangspunkt für Phase 5, keine Änderung in Phase 0.
