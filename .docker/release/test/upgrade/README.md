# Isolated release upgrade and rollback drills

These drills test a locally built release without publishing an image, contacting a model provider, or using the development fixture on port 8888. They create unique containers, networks, and named volumes and remove those resources on exit. JSON results, HTTP headers, updater logs, checksums, and backups remain in a timestamped evidence directory under `build/local/`.

## Prerequisites and inputs

Run from the repository root with Bash, Docker, `tar`, and `sha256sum`. The PHP-only drill also needs OpenSSL on the host. Its HTTPS server uses the pinned Python image in `php-only.sh`; no host Python server is started.

Use two locally built images containing different, non-`0.0.0` packaged versions. A tag alone does not establish identity: each drill resolves and records the local image ID, then uses that ID for every container. These image IDs are not registry or GHCR manifest digests.

The immutable-image drill mounts the real `plugins/ai-copilot` from this checkout for the current-image route tests. The previous version must be an actual earlier fork version. The Phase 13 baseline was fork tag `v2.38.2.1`, commit `208f1c7298e5fc2f99cfeae97570d5fe04c3c48b`; its historical Dockerfile needed only CR removal from `entrypoint.sh` to run from a Git for Windows checkout. That local build is not evidence of a historical registry digest.

## Immutable image drill

Resolve both inputs before starting so the recorded command uses immutable local IDs:

```sh
export DOCKER_CONFIG="$PWD/build/docker-config"
export MSYS_NO_PATHCONV=1
DOCKER=${DOCKER:-docker}
# Git Bash with Docker Desktop, if docker is not on PATH:
# DOCKER='/c/Program Files/Docker/Docker/resources/bin/docker.exe'

CURRENT_IMAGE=$("$DOCKER" image inspect snappymail/snappymail:test --format '{{.Id}}')
PREVIOUS_IMAGE=$("$DOCKER" image inspect snappymail-fork-previous:2.38.2.1 --format '{{.Id}}')
test "$CURRENT_IMAGE" != "$PREVIOUS_IMAGE"
DOCKER="$DOCKER" bash .docker/release/test/upgrade/run.sh \
  "$CURRENT_IMAGE" "$PREVIOUS_IMAGE"
```

An optional third argument selects the evidence directory. The drill verifies:

- fresh installation, coordinated versioned JS/CSS assets, and safe updater defaults;
- restart persistence and the absence of drill data in a fresh volume;
- upgrade from the previous fork version and immutable-image rollback;
- unchanged configuration sentinel and admin credential;
- stopped-volume TAR backups before upgrade and rollback;
- OPcache enabled with only the selected packaged version cached and no restarts;
- the real plugin's PHP SSE route with the sidecar absent;
- rollout to the Rust SSE route and rollback to PHP on the same data volume, without configuring a provider.

The route assertions require HTTP 200 and `text/event-stream`; login HTML does not count as a successful streaming-route test. They do not prove authenticated mailbox or live-provider behavior.

## PHP-only archive drill

Use real TAR archives produced by the corresponding builder stages. The current and previous archives must contain different versions. The following names are examples for the Phase 13 local inputs:

```sh
export DOCKER_CONFIG="$PWD/build/docker-config"
export MSYS_NO_PATHCONV=1
DOCKER=${DOCKER:-docker}
# Git Bash with Docker Desktop, if docker is not on PATH:
# DOCKER='/c/Program Files/Docker/Docker/resources/bin/docker.exe'

CURRENT_IMAGE=$("$DOCKER" image inspect snappymail/snappymail:test --format '{{.Id}}')
CURRENT_ARCHIVE="$PWD/build/local/phase13-archives/snappymail-3.0.0.tar.gz"
PREVIOUS_ARCHIVE="$PWD/build/local/phase13-archives/snappymail-2.38.2.1.tar.gz"
test -f "$CURRENT_ARCHIVE"
test -f "$PREVIOUS_ARCHIVE"
DOCKER="$DOCKER" bash .docker/release/test/upgrade/php-only.sh \
  "$CURRENT_IMAGE" "$CURRENT_ARCHIVE" "$PREVIOUS_ARCHIVE"
```

An optional fourth argument selects the evidence directory. The script copies both inputs into that directory, compares the copies, records SHA-256 checksums, creates a one-day test CA, and serves only these archives on an internal-only Docker network. It then exercises the reviewed `cli/upgrade.sh` with an explicit HTTPS URL and SHA-256 for both upgrade and downgrade.

The application container has no network and runs with `SNAPPY_AI_PROXY_ENABLED=false`. The drill verifies the selected root version, archive-identical coordinated assets, configuration and credential persistence, safe updater settings, PHP-only operation, and OPcache after restart. Application backups and stopped-data backups are copied into the evidence directory and checksummed.

`cli/upgrade.sh` overlays versioned archives; it does not remove every old version directory. The drill therefore asserts the selected root version, selected assets, and OPcache contents rather than requiring deletion of old directories.

## Evidence boundaries

Both drills are local acceptance tests, normally on `linux/amd64`. They do not establish ARM64 or 386 behavior, a staging/production canary, external IMAP/SMTP interoperability, live Mistral behavior, or a published multi-architecture GHCR manifest digest. No registry publication is performed. Review the recorded image IDs and archive hashes separately from any later registry-provided digest.
