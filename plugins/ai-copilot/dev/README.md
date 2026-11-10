# Lokale Entwicklung ai-copilot

Alles läuft in Docker auf dem Entwicklungsrechner. Der Testmailserver enthält nur ausgedachte Mails.

```sh
cd plugins/ai-copilot/dev
docker compose up -d --build      # erster Build dauert einige Minuten
python seed.py                    # Konten, SnappyMail-Konfiguration, Testmails
```

- SnappyMail: http://localhost:8888, Anmeldung `test@example.com` / `test1234`
- Admin: http://localhost:8888/?admin, Passwort: `docker compose exec snappymail cat /var/lib/snappymail/_data_/_default_/admin_password.txt`
- Das Plugin ist per Symlink aus diesem Ordner eingehängt. PHP-Änderungen gelten sofort. Die Oberfläche des Assistenten liegt nicht im Plugin, sondern in `ui/src/` (`assist-controller.ts`, `assist-state.ts`, `view.ts`); nach Änderungen dort `npm run build --prefix ui` ausführen.
- Mistral-Key: Datei `../../../../MISTRAL-API-KEY.env` (außerhalb des Repos), anderer Pfad über `AI_KEY_FILE=...`.
- Windows-Checkout mit CRLF: Die Compose-Datei entfernt CR aus den Konfigurationsdateien des Images beim Start.

Tests:

```sh
python seed.py --mails                                   # Testmails zurücksetzen
python apitest.py list INBOX                             # Liste mit Kategorien
python apitest.py call AiSummarize '{"folder":"INBOX","uids":[8,9],"sent":"Sent"}'
python apitest.py stream '{"mode":"new","instruction":"..."}'
python mock_llm.py 18234                                  # Mock für das llmster-Profil
```

Die Themes Slate und SlateDark liegen im Repo `zfzfg/snappymail-themes-slate`, die alte Oberfläche ist entfernt.

`apitest.py` schickt bei KI-Funktionen die Testmails an den eingestellten Anbieter.

## Chrome-Headless-Verifikation

`browser-test.mjs` verwendet ausschließlich die ausgedachten lokalen Fixtures und ruft keinen KI-Anbieter auf. Es prüft Desktop und Mobile, Anmeldung, Ordner, Briefe, Entwürfe, Einstellungen/Admin, Kontowechsel, erneute Anmeldung, Cache-Aushandlung, deaktivierte Assistenten-Fähigkeiten sowie DOM- und Heap-Verhalten.

```sh
npm ci
TEST_PASSWORD=test1234 ADMIN_PASSWORD="$(docker compose exec snappymail cat /var/lib/snappymail/_data_/_default_/admin_password.txt)" node browser-test.mjs
```

Die KI-Abläufe laufen nur gegen den lokalen Mock und nur mit `BROWSER_AI_MOCK=1`, damit nie Testmails an einen echten Anbieter gehen:

```sh
python seed.py --mock-llm     # setzt das Profil llmster auf host.docker.internal:18234
python mock_llm.py 18234 &
BROWSER_AI_MOCK=1 BROWSER_SCENARIOS=desktop-assistant-flows TEST_PASSWORD=test1234 node browser-test.mjs
```

Der Lauf enthält standardmäßig einen 30-minütigen Soak mit Navigation, manueller Aktualisierung, Garbage Collection und wiederholter An-/Abmeldung. `SOAK_DURATION_MS` (maximal 3.600.000) und `SOAK_INTERVAL_MS` erlauben kürzere ausdrücklich diagnostische Läufe; die 30 Minuten sind keine optionale Abkürzung für die Abnahme. `BROWSER_SCENARIOS` wählt kommagetrennt einzelne Szenarien aus. `CHROME_PATH` kann den lokalen Chrome-Pfad setzen.

Der Bericht `shots/browser-results.json` enthält LCP, CLS, Long Tasks, Event-Timing-Latenz als Kurzlauf-INP-Näherung, Chrome-Parse-/Compile-/Evaluate-Traces, übertragene Bytes, DOM- und Speicherwerte. Fehlende Fähigkeiten werden als unbestätigt ausgewiesen. Beim Download verhindert eine lokale Kontrolle, dass eine Chrome-Umgebungsstörung als bestandener Datei-Download ausgegeben wird. Screenshots, Downloads und Berichte sind lokale Prüfnachweise und keine zu versionierenden Fixtures.
