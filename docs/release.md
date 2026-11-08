# Release, Aktualisierung und Rollback

Dieser Fork veröffentlicht Container ausschließlich unter `ghcr.io/zfzfg/snappymail`. Docker Hub und die Upstream-Updatekanäle sind keine Release- oder Updatequelle dieses Forks.

## 1. Überprüfbare Release-Eingaben

- Die Node-Version steht in `.node-version`; die Frontend-Abhängigkeiten kommen aus `ui/package-lock.json`.
- Die Rust-Version und ihre Komponenten stehen in `crates/snappy-ai-proxy/rust-toolchain.toml`; Cargo wird mit `--locked` ausgeführt.
- GitHub Actions, Container-Basisimages, die Testwerkzeuge, externe Integrationsfixtures und die PECL-Erweiterungen sind auf Commits, Digests oder feste Versionen festgelegt.
- CI baut die TypeScript-Quellen neu und vergleicht die erzeugten Schriften, Symbole, CSS- und JS-Dateien mit dem committeten Stand. Anschließend laufen Bundle-Budgets, PHP-Syntax-/Offline-Tests, Rust-Tests und die isolierte HTTP-Integration.
- `php cli/release.php --frontend-dist` packt bewusst die geprüften, committeten Frontend-Artefakte. `--skip-gulp` bleibt nur als veralteter Alias bestehen.

Ein Release-Tag muss exakt `v` plus der Version aus `package.json` lauten. Bei Version `3.0.0` ist also nur `v3.0.0` gültig. Der Workflow erzeugt daraus die GHCR-Tags `v3.0.0` und `3.0.0`; ein abweichender Tag bricht vor den Container-Tests ab.

Die Veröffentlichung erfolgt erst nach CI und den HTTP-Laufzeittests für AMD64, ARM64 und 386. Das Image- und GHCR-Digest werden als Workflow-Artefakte protokolliert. ZIP/TAR-Archive werden bei einem Tag ebenfalls als zeitlich begrenzte Workflow-Artefakte abgelegt. Das erzeugt weder ein GitHub Release noch dessen Download-Assets; das Hochladen eines geprüften Archivs bleibt ein separater, bewusster Release-Schritt.

## 2. Archive und PHP-only-Betrieb

Lokal aus dem Repo-Wurzelverzeichnis:

```sh
npm ci --prefix ui --no-audit --no-fund
npm run build --prefix ui
php cli/release.php --frontend-dist
```

Die Archive liegen anschließend unter `build/dist/releases/webmail/VERSION/`. Das Tar-Archiv kann mit `bash scripts/ci/package.sh` zusätzlich auf Inhalt, Frontend-Abgleich, sichere Update-Standardwerte und einen isolierten PHP-Bootstrap geprüft werden.

Für eine PHP-only-Installation wird ein geprüftes ZIP- oder TAR-Archiv in ein leeres Anwendungsverzeichnis entpackt und mit dem vorhandenen PHP-/Webserver betrieben. Dabei bleiben das persistente `data/`-Verzeichnis, dessen Eigentümerrechte und ein separat angelegtes Backup erhalten. PHP führt den KI-Stream weiterhin selbst aus; Rust, Docker und Supervisor sind dafür nicht erforderlich. Vor einem Wechsel müssen Anwendungs- und Asset-Dateien aus derselben Version gemeinsam bereitstehen.

Im Container ist `SNAPPY_AI_PROXY_ENABLED=false` der Standard und damit der PHP-only-Pfad. AMD64 und ARM64 enthalten den optionalen Rust-Sidecar; er wird nur nach ausdrücklicher Aktivierung gestartet. Das 386-Image ist bewusst PHP-only, enthält keinen Sidecar und verweigert `SNAPPY_AI_PROXY_ENABLED=true`. Es gibt keinen stillen Wechsel zwischen den Streaming-Backends.

## 3. Admin-Updatekanal

Die Standardkonfiguration enthält:

```ini
[repository]
url = ""

[admin_panel]
allow_update = false
```

Mit leerer Repository-URL werden keine entfernten Core- oder Plugin-Pakete abgefragt oder aktualisiert. Installierte Plugins bleiben sichtbar und unverändert.

Ein Fork- oder Security-Kanal ist eine bewusste Administrationsentscheidung. Dafür wird eine kontrollierte HTTPS-Basis-URL mit `core.json`, `packages.json` und den referenzierten signierten Plugin-Paketen in `[repository] url` eingetragen. Zugangsdaten in der URL, Query-Parameter, Fragmente und unverschlüsseltes HTTP werden abgelehnt. Für ein Core-Update muss zusätzlich `[admin_panel] allow_update = true` gesetzt sein. Die Paketquelle und ihre Signatur-/Vertrauenskette werden vor der Aktivierung geprüft; eine Upstream-URL wird nicht übernommen.

Nach jedem In-place-Core- oder Plugin-Update ist PHP-FPM beziehungsweise Apache neu zu starten oder OPcache ausdrücklich zu invalidieren. Container werden stattdessen vollständig ersetzt. Erst danach wird die neue Version freigeschaltet.

## 4. Shell-Upgrade

`cli/upgrade.sh` lädt nichts automatisch. Es benötigt ein ausdrücklich ausgewähltes HTTPS-Archiv; eine SHA-256-Prüfsumme sollte immer aus einem unabhängig geprüften Release-Kanal stammen und mitgegeben werden:

```sh
export SNAPPYMAIL_UPGRADE_URL='https://github.com/zfzfg/snappymail/releases/download/vX.Y.Z/snappymail-X.Y.Z.tar.gz'
export SNAPPYMAIL_UPGRADE_SHA256='64-stelliger-sha256-wert'
sudo --preserve-env=SNAPPYMAIL_UPGRADE_URL,SNAPPYMAIL_UPGRADE_SHA256 bash cli/upgrade.sh
```

Das Skript prüft Archivpfade und Versionsstruktur, legt vor der Änderung ein eindeutig benanntes Backup `../backup_snappymail_ZEITSTEMPEL.tar.gz` an und weist auf den erforderlichen PHP-FPM-/Apache-Neustart hin. Dieses Anwendungsbackup ersetzt kein separates Backup des persistenten Datenbestands. `X.Y.Z` und die Prüfsumme sind Platzhalter, keine Aussage über bereits vorhandene Releases.

Für ein Rollback wird der vorherige, zusammengehörige Anwendungsstand aus dem geprüften Archiv oder Backup wiederhergestellt. Daten werden nur nach einer Kompatibilitätsprüfung zurückgespielt; anschließend ist erneut der PHP-/Webserver-Neustart erforderlich.

## 5. Canary, Daten und Rollback

Vor der Produktivfreigabe:

1. Image-Digest, Release-Archiv und Prüfsumme festhalten; bisherigen Digest und persistente Daten separat sichern.
2. Fresh Install sowie Upgrade von einer vorherigen Fork-Version mit Kopien der realen Plugins, Konfiguration und Daten testen. Fork-UI, Plugin-Dateien, PHP-Änderungen und Konfiguration müssen erhalten bleiben.
3. Auf Staging und anschließend einem kleinen Canary die Laufzeit-, Login-, IMAP/SMTP-, Plugin-, Krypto-, Thumbnail- und PHP-only-Pfade prüfen. Mailbox- und kombinierte KI-Last mit denselben Host-Limits und Metriken gegen den alten Digest vergleichen.
4. Beim Rust-Canary nur ausdrücklich aktivieren, alte und neue Clients gemeinsam testen, aktive Streams möglichst abklingen lassen und Verbindungs-/Concurrency-Messwerte wieder auf den Ausgangswert prüfen.
5. Bei Korrektheits-, Sicherheits-, Speicher-, Latenz-, Queueing-, Authentifizierungs-, Datenbank- oder Krypto-Regressionen stoppen und den vorherigen Image-Digest ohne Datenmigration wiederherstellen.

Container-Rollback erfolgt durch erneutes Deployment mit `ghcr.io/zfzfg/snappymail@sha256:ALTER_DIGEST`, nicht durch ein bewegliches Tag. Alternativ kann zunächst `SNAPPY_AI_PROXY_ENABLED=false` den PHP-Pfad wiederherstellen. Ein bereits an den Provider abgesetzter Request wird niemals automatisch auf einem anderen Backend wiederholt; ein neuer Versuch ist eine bewusste Nutzeraktion.

Diese Schritte sind das vorgesehene Prüf- und Rollbackverfahren. Sie gelten erst als durchgeführt, wenn ihre Ergebnisse für die jeweilige Version und Umgebung tatsächlich protokolliert wurden.
