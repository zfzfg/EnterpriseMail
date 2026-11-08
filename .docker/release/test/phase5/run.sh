#!/bin/sh
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
COMPOSE=${COMPOSE:-docker-compose}
export MSYS_NO_PATHCONV=1

"$COMPOSE" -p snappymail-phase5 -f "$HERE/docker-compose.yml" up -d --build
trap '"$COMPOSE" -p snappymail-phase5 -f "$HERE/docker-compose.yml" down' EXIT INT TERM
python "$HERE/integration.py"
