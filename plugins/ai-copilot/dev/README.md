# Lokale Entwicklung ai-copilot

Alles läuft in Docker auf dem Entwicklungsrechner. Der Testmailserver enthält nur ausgedachte Mails.

```sh
cd plugins/ai-copilot/dev
docker compose up -d --build      # erster Build dauert einige Minuten
python seed.py                    # Konten, SnappyMail-Konfiguration, Testmails
```

- SnappyMail: http://localhost:8888, Anmeldung `test@example.com` / `test1234`
- Admin: http://localhost:8888/?admin, Passwort: `docker compose exec snappymail cat /var/lib/snappymail/_data_/_default_/admin_password.txt`
- Das Plugin ist per Symlink aus diesem Ordner eingehängt. PHP- und JS-Änderungen gelten sofort (JS-Cache ist in der Dev-Konfiguration aus).
- Mistral-Key: Datei `../../../../MISTRAL-API-KEY.env` (außerhalb des Repos), anderer Pfad über `AI_KEY_FILE=...`.
- Windows-Checkout mit CRLF: Die Compose-Datei entfernt CR aus den Konfigurationsdateien des Images beim Start.

Tests:

```sh
python seed.py --mails                                   # Testmails zurücksetzen
python apitest.py list INBOX                             # Liste mit Kategorien
python apitest.py call AiSummarize '{"folder":"INBOX","uids":[8,9],"sent":"Sent"}'
python apitest.py stream '{"mode":"new","instruction":"..."}'
python mock_llm.py 18234                                  # Mock für das llmster-Profil
npm i puppeteer-core && node uitest.mjs open summary quick sidebar chat
```

Themes (`Slate`, `SlateDark` in `snappymail/v/0.0.0/themes/`, ohne KI-Aufrufe):

```sh
python seed.py --theme-mails                 # Grenzfälle: HTML-Newsletter, langer Betreff, Anhänge, RTL, ohne Betreff
node themeshots.mjs Slate SlateDark Default  # Screenshots nach shots/themes/
node themeshots.mjs --login Slate            # Anmeldeseite (Theme aus webmail.theme der Konfiguration)
python ../../../cli/theme-slate-dark.py ../../../snappymail/v/0.0.0/themes   # SlateDark nach Änderungen an Slate neu erzeugen
```

Themes stecken im Image: nach Änderungen `docker compose up -d --build`. Zum schnellen Ausprobieren den Theme-Ordner nach `/snappymail/themes/<Name>` einhängen, er erscheint dann als `<Name>@custom`.

`apitest.py` und `uitest.mjs` schicken bei KI-Funktionen die Testmails an den eingestellten Anbieter.
