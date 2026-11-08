#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if command -v cygpath > /dev/null 2>&1; then
	root="$(cygpath -m "$root")"
fi

docker_bin="${DOCKER:-docker}"
image='rust:1.93.0-alpine3.23@sha256:69d7b9d9aeaf108a1419d9a7fcf7860dcc043e9dbd1ab7ce88e44228774d99e9'
export MSYS_NO_PATHCONV=1

"$docker_bin" run --rm \
	--volume "${root}:/work" \
	--workdir /work \
	"$image" \
	sh -c 'apk add --no-cache bash curl git && bash scripts/ci/rust-supply-chain.sh'
