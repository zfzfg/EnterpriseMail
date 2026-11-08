#!/bin/sh
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if command -v cygpath >/dev/null 2>&1; then
    HERE=$(cygpath -w "$HERE")
fi
COMPOSE=${COMPOSE:-docker compose}
export MSYS_NO_PATHCONV=1

# COMPOSE intentionally supports either 'docker compose' or 'docker-compose'.
compose() {
    $COMPOSE -p snappymail-phase5 -f "$HERE/docker-compose.yml" "$@"
}

compose up -d --build
trap 'compose down' EXIT INT TERM
python "$HERE/integration.py"
