#!/bin/sh
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$HERE/../../../.." && pwd)
if command -v cygpath >/dev/null 2>&1; then
	HERE=$(cygpath -w "$HERE")
	ROOT=$(cygpath -w "$ROOT")
fi
DOCKER=${DOCKER:-docker}
IMAGE=${1:-snappymail/snappymail:test}
NAME=snappymail-runtime-acceptance-$$
export MSYS_NO_PATHCONV=1

cleanup() {
	"$DOCKER" rm -f -v "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

request() {
	"$DOCKER" exec "$NAME" wget -q -T 120 -O- "http://127.0.0.1:8888/opcache-acceptance.php?action=$1"
}

assert_json() {
	JSON=$1 MODE=$2 "$DOCKER" exec -e JSON -e MODE "$NAME" php -r '
		$data = json_decode(getenv("JSON"), true, 512, JSON_THROW_ON_ERROR);
		$mode = getenv("MODE");
		if ("warm" === $mode) {
			$s = $data["status"];
			$m = $s["memory_usage"];
			$o = $s["opcache_statistics"];
			if (0 !== $data["failed"] || 606 !== $data["discovered"]["/plugins"]
			 || 2 !== $data["non_production_excluded"]
			 || $data["unique_files"] !== $data["compiled"]
			 || $o["num_cached_scripts"] < $data["compiled"]
			 || 0 >= $m["used_memory"] || 0 >= $m["free_memory"]
			 || $m["free_memory"] * 10 < $m["used_memory"] + $m["free_memory"]
			 || $o["max_cached_keys"] < 2 * $o["num_cached_keys"]
			 || $s["cache_full"] || $s["restart_pending"] || $s["restart_in_progress"]
			 || $o["oom_restarts"] || $o["hash_restarts"] || $o["manual_restarts"]) {
				fwrite(STDERR, "OPcache warm-cache capacity acceptance failed\n");
				exit(1);
			}
		} elseif ("hits" === $mode) {
			$before = $data["before"]["opcache_statistics"];
			$after = $data["after"]["opcache_statistics"];
			if ($after["hits"] <= $before["hits"] || $after["misses"] !== $before["misses"]
			 || $after["oom_restarts"] || $after["hash_restarts"] || $after["manual_restarts"]) {
				fwrite(STDERR, "OPcache warm-hit acceptance failed\n");
				exit(1);
			}
		} elseif ("final" === $mode) {
			$o = $data["opcache_statistics"];
			if ($data["cache_full"] || $data["restart_pending"] || $data["restart_in_progress"]
			 || $o["oom_restarts"] || $o["hash_restarts"] || $o["manual_restarts"]) {
				fwrite(STDERR, "OPcache final capacity acceptance failed\n");
				exit(1);
			}
		} elseif ("script" === $mode) {
			if (!$data["cached"] || !is_array($data["script"])) {
				fwrite(STDERR, "OPcache invalidation fixture was not cached\n");
				exit(1);
			}
		} elseif ("invalidate" === $mode) {
			if (true !== $data["invalidated"]) {
				fwrite(STDERR, "Explicit OPcache invalidation failed\n");
				exit(1);
			}
		}
	'
}

"$DOCKER" run -d --name "$NAME" --network none --memory 512m --cpus 1 --pids-limit 128 \
	-v "$ROOT/plugins:/plugins:ro" \
	-v "$ROOT/.docker/release/files/usr/local/etc/php/conf.d/opcache.ini:/usr/local/etc/php/conf.d/opcache.ini:ro" \
	-v "$HERE/opcache_probe.php:/snappymail/opcache-acceptance.php:ro" \
	--entrypoint /bin/sh "$IMAGE" -c 'exec /entrypoint.sh' >/dev/null

ready=0
for attempt in $(seq 1 90); do
	if "$DOCKER" exec "$NAME" wget -q -T 2 -O /dev/null http://127.0.0.1:8888/healthz >/dev/null 2>&1; then
		ready=1
		break
	fi
	sleep 1
done
if [ "$ready" != 1 ]; then
	echo 'Isolated release container did not become healthy' >&2
	exit 1
fi

"$DOCKER" exec "$NAME" php -r 'foreach (["apcu", "gd", "gnupg", "imagick", "intl", "ldap", "pdo_mysql", "pdo_pgsql", "pdo_sqlite", "redis", "tidy", "uuid", "xxtea", "zip", "Zend OPcache"] as $extension) { if (!extension_loaded($extension)) { fwrite(STDERR, "Missing retained extension: $extension\n"); exit(1); } }'
"$DOCKER" exec "$NAME" /bin/sh -c 'test -f /snappymail/snappymail/v/*/app/libraries/lessphp/lessc.php'

warm=$(request warm)
assert_json "$warm" warm
printf '%s\n' "$warm"
before=$(request status)
for attempt in 1 2 3 4 5; do
	"$DOCKER" exec "$NAME" wget -q -T 15 -O /dev/null http://127.0.0.1:8888/
	"$DOCKER" exec "$NAME" wget -q -T 15 -O /dev/null 'http://127.0.0.1:8888/?admin'
	request status >/dev/null
done
after=$(request status)
assert_json "{\"before\":$before,\"after\":$after}" hits
printf '%s\n' "$after"

"$DOCKER" exec "$NAME" /bin/sh -c "printf '%s\n' '<?php echo \"OPCACHE_GENERATION_ONE\";' > /snappymail/opcache-invalidation.php"
# Respect the production opcache.file_update_protection window before caching.
sleep 3
first=$("$DOCKER" exec "$NAME" wget -q -T 15 -O- http://127.0.0.1:8888/opcache-invalidation.php)
[ "$first" = 'OPCACHE_GENERATION_ONE' ]
script_before=$(request script)
assert_json "$script_before" script
"$DOCKER" exec "$NAME" /bin/sh -c "printf '%s\n' '<?php echo \"OPCACHE_GENERATION_TWO\";' > /snappymail/opcache-invalidation.php"
sleep 3
second=$("$DOCKER" exec "$NAME" wget -q -T 15 -O- http://127.0.0.1:8888/opcache-invalidation.php)
[ "$second" = 'OPCACHE_GENERATION_TWO' ]
script_after=$(request script)
assert_json "$script_after" script
printf '%s\n' "$script_before" "$script_after"

"$DOCKER" exec "$NAME" /bin/sh -c "printf '%s\n' '<?php echo \"OPCACHE_GENERATION_THREE\";' > /snappymail/opcache-invalidation.php"
invalidated=$(request invalidate)
assert_json "$invalidated" invalidate
third=$("$DOCKER" exec "$NAME" wget -q -T 15 -O- http://127.0.0.1:8888/opcache-invalidation.php)
[ "$third" = 'OPCACHE_GENERATION_THREE' ]
final=$(request status)
assert_json "$final" final
printf '%s\n' "$final"
echo "opcache-runtime: ok (automatic and explicit invalidation verified)"

output=$("$DOCKER" run --rm --network none --memory 512m --cpus 1 --pids-limit 64 \
	-v "$ROOT/test:/source/test:ro" \
	-v "$ROOT/snappymail:/source/snappymail:ro" \
	-v "$ROOT/.docker/release/files/etc/ImageMagick-7/policy.xml:/etc/ImageMagick-7/policy.xml:ro" \
	--entrypoint php "$IMAGE" /source/test/imagick.php 2>&1) || {
	echo 'Imagick acceptance failed; output withheld to avoid decoder-content disclosure' >&2
	exit 1
}
case $output in
	*PRIVATE-IMAGE-SENTINEL-9f27c1*)
		echo 'Imagick acceptance emitted its sensitive sentinel' >&2
		exit 1
		;;
esac
printf '%s\n' "$output"
