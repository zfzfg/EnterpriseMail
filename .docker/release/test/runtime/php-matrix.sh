#!/bin/sh
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$HERE/../../../.." && pwd)
if command -v cygpath >/dev/null 2>&1; then
	ROOT=$(cygpath -w "$ROOT")
fi
DOCKER=${DOCKER:-docker}
export MSYS_NO_PATHCONV=1

for version in 8.2 8.5; do
	echo "PHP $version full standalone test matrix"
	"$DOCKER" run --rm --network none --memory 512m --cpus 1 --pids-limit 128 --user www-data \
		-v "$ROOT/snappymail:/source/snappymail:ro" \
		-v "$ROOT/plugins:/source/plugins:ro" \
		-v "$ROOT/test:/source/test:ro" \
		-v "$ROOT/cli:/source/cli:ro" \
		-v "$ROOT/index.php:/source/index.php:ro" \
		-v "$ROOT/_include.php:/source/include.php:ro" \
		--tmpfs /source/data:rw,nosuid,nodev,size=64m,mode=1777 \
		-w /source --entrypoint /bin/sh "php:$version-cli" -c '
			set -eu
			php -v
			for test in test/*.php; do
				echo "==> $test"
				php -d zend.exception_ignore_args=1 "$test"
			done
		'
	"$DOCKER" run --rm --network none --memory 128m --cpus 1 --pids-limit 64 \
		-v "$ROOT/snappymail:/source/snappymail:ro" \
		-v "$ROOT/test:/source/test:ro" \
		-v "$ROOT/cli:/source/cli:ro" \
		-w /source --entrypoint php "php:$version-cli" \
		-d zend.exception_ignore_args=1 test/maintenance.php --root-check
done
