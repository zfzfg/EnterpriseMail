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
```

Die Themes Slate und SlateDark liegen im Repo `zfzfg/snappymail-themes-slate`, die alte Oberfläche ist entfernt.

`apitest.py` schickt bei KI-Funktionen die Testmails an den eingestellten Anbieter.
