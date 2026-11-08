#!/usr/bin/env bash
# Isolated immutable-image fresh-install, previous-version upgrade and rollback drill.
set -euo pipefail

HERE=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(CDPATH= cd -- "${HERE}/../../../.." && pwd)
DOCKER=${DOCKER:-docker}
CURRENT_INPUT=${1:?Usage: run.sh CURRENT_IMAGE PREVIOUS_FORK_IMAGE [EVIDENCE_DIR]}
PREVIOUS_INPUT=${2:?Usage: run.sh CURRENT_IMAGE PREVIOUS_FORK_IMAGE [EVIDENCE_DIR]}
RUN_ID=$(date -u +%Y%m%dT%H%M%S)-$$
EVIDENCE_DIR=${3:-${ROOT}/build/local/upgrade/${RUN_ID}}
PREFIX=snappymail-release-drill-$$
APP_NAME=${PREFIX}-app
FRESH_VOLUME=${PREFIX}-fresh
UPGRADE_VOLUME=${PREFIX}-upgrade
ROUTE_VOLUME=${PREFIX}-routes
PROBE=${HERE}/probe.php
PLUGIN=${ROOT}/plugins/ai-copilot
PLUGIN_SHA256=$(sha256sum "${PLUGIN}/index.php" | cut -d" " -f1)
export MSYS_NO_PATHCONV=1

mkdir -p "${EVIDENCE_DIR}"
EVIDENCE_DIR=$(CDPATH= cd -- "${EVIDENCE_DIR}" && pwd)
if command -v cygpath >/dev/null 2>&1; then
	EVIDENCE_DOCKER=$(cygpath -w "${EVIDENCE_DIR}")
	PROBE_DOCKER=$(cygpath -w "${PROBE}")
	PLUGIN_DOCKER=$(cygpath -w "${PLUGIN}")
else
	EVIDENCE_DOCKER=${EVIDENCE_DIR}
	PROBE_DOCKER=${PROBE}
	PLUGIN_DOCKER=${PLUGIN}
fi

cleanup() {
	"${DOCKER}" rm -f -v "${APP_NAME}" >/dev/null 2>&1 || true
	"${DOCKER}" volume rm -f "${FRESH_VOLUME}" "${UPGRADE_VOLUME}" "${ROUTE_VOLUME}" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

image_id() {
	"${DOCKER}" image inspect "$1" --format '{{.Id}}'
}

version_of() {
	"${DOCKER}" run --rm --network none --entrypoint php "$1" -r '
		$source = file_get_contents("/snappymail/index.php");
		if (!preg_match("/define\\('"'"'APP_VERSION'"'"', '"'"'([^'"'"']+)'"'"'\\)/", $source, $match)) { exit(1); }
		if ("0.0.0" === $match[1]) { exit(2); }
		echo $match[1];
	'
}

asset_hashes() {
	local image=$1 version=$2
	"${DOCKER}" run --rm --network none --entrypoint sha256sum "${image}" \
		"/snappymail/snappymail/v/${version}/static/js/app.js" \
		"/snappymail/snappymail/v/${version}/static/js/admin.js" \
		"/snappymail/snappymail/v/${version}/static/css/app.css" \
		"/snappymail/snappymail/v/${version}/static/css/admin.css"
}

wait_ready() {
	local attempt
	for attempt in $(seq 1 90); do
		if "${DOCKER}" exec "${APP_NAME}" wget -q -T 2 -O /dev/null http://127.0.0.1:8888/ >/dev/null 2>&1; then
			return 0
		fi
		sleep 1
	done
	"${DOCKER}" logs "${APP_NAME}" >&2 || true
	echo "Release drill container did not become ready" >&2
	return 1
}

start_app() {
	local image=$1 volume=$2 rust=$3
	"${DOCKER}" create --name "${APP_NAME}" --network none --memory 512m --cpus 1 --pids-limit 128 \
		-e SECURE_COOKIES=false -e SNAPPY_AI_PROXY_ENABLED="${rust}" \
		-e SNAPPY_AI_PROXY_SERVICE_CREDENTIAL=release-drill-service-credential-32-bytes \
		-v "${volume}:/var/lib/snappymail" -v "${PLUGIN_DOCKER}:/opt/ai-copilot:ro" \
		"${image}" >/dev/null
	"${DOCKER}" cp "${PROBE_DOCKER}" "${APP_NAME}:/snappymail/release-drill-probe.php" >/dev/null
	"${DOCKER}" start "${APP_NAME}" >/dev/null
	wait_ready
	# The entrypoint creates the admin credential asynchronously after FPM starts.
	local attempt
	for attempt in $(seq 1 30); do
		if "${DOCKER}" exec "${APP_NAME}" test -s /var/lib/snappymail/_data_/_default_/admin_password.txt; then
			# Respect OPcache's default file-update-protection window, then warm
			# the coordinated root and versioned application entry points.
			sleep 3
			"${DOCKER}" exec "${APP_NAME}" wget -q -T 15 -O /dev/null http://127.0.0.1:8888/
			return 0
		fi
		sleep 1
	done
	echo "Release drill admin credential was not initialized" >&2
	return 1
}

replace_app() {
	"${DOCKER}" rm -f "${APP_NAME}" >/dev/null
	start_app "$@"
}

assert_release() {
	local expected_image=$1 expected_version=$2 expected_hashes=$3 actual_hashes
	actual_hashes=$("${DOCKER}" exec "${APP_NAME}" sha256sum \
		"/snappymail/snappymail/v/${expected_version}/static/js/app.js" \
		"/snappymail/snappymail/v/${expected_version}/static/js/admin.js" \
		"/snappymail/snappymail/v/${expected_version}/static/css/app.css" \
		"/snappymail/snappymail/v/${expected_version}/static/css/admin.css")
	if [[ "${actual_hashes}" != "${expected_hashes}" ]]; then
		echo "Versioned application/static assets differ from the selected image" >&2
		return 1
	fi
	"${DOCKER}" exec -e EXPECTED_IMAGE="${expected_image}" -e EXPECTED_VERSION="${expected_version}" "${APP_NAME}" php -r '
		$source = file_get_contents("/snappymail/index.php");
		if (!preg_match("/define\\('"'"'APP_VERSION'"'"', '"'"'([^'"'"']+)'"'"'\\)/", $source, $match) || getenv("EXPECTED_VERSION") !== $match[1]) { exit(1); }
		$versions = glob("/snappymail/snappymail/v/*", GLOB_ONLYDIR);
		if (1 !== count($versions) || basename($versions[0]) !== $match[1] || "0.0.0" === $match[1]) { exit(2); }
	'
}

PROBE_JSON=
probe() {
	PROBE_JSON=$("${DOCKER}" exec "${APP_NAME}" wget -q -T 15 -O- http://127.0.0.1:8888/release-drill-probe.php)
}

assert_probe() {
	local label=$1 expected_version=$2
	probe
	printf '%s\n' "${PROBE_JSON}" > "${EVIDENCE_DIR}/${label}.json"
	"${DOCKER}" exec -e JSON="${PROBE_JSON}" -e EXPECTED_VERSION="${expected_version}" "${APP_NAME}" php -r '
		$data = json_decode(getenv("JSON"), true, 512, JSON_THROW_ON_ERROR);
		$cache = $data["opcache"];
		if ($data["version"] !== getenv("EXPECTED_VERSION") || !$cache["enabled"]
		 || !$cache["root_index_cached"]
		 || $cache["cached_versions"] !== [getenv("EXPECTED_VERSION")]
		 || $cache["oom_restarts"] || $cache["hash_restarts"] || $cache["manual_restarts"]) {
			fwrite(STDERR, "Version/OPcache acceptance failed\n");
			exit(1);
		}
	' 2>/dev/null || {
		echo "Version/OPcache acceptance failed: ${label}" >&2
		return 1
	}
}

probe_start_time() {
	probe
	"${DOCKER}" exec -e JSON="${PROBE_JSON}" "${APP_NAME}" php -r '
		$data = json_decode(getenv("JSON"), true, 512, JSON_THROW_ON_ERROR);
		echo $data["opcache"]["start_time"];
	'
}

assert_safe_defaults() {
	"${DOCKER}" exec "${APP_NAME}" php -r '
		$config = parse_ini_file("/var/lib/snappymail/_data_/_default_/configs/application.ini", true, INI_SCANNER_TYPED);
		if (($config["repository"]["url"] ?? "missing") !== ""
		 || ($config["admin_panel"]["allow_update"] ?? true) !== false) {
			fwrite(STDERR, "Unsafe updater defaults in fresh installation\n");
			exit(1);
		}
	'
}

seed_persistent_data() {
	"${DOCKER}" exec "${APP_NAME}" /bin/sh -c '
		printf "\n[release_drill]\nmarker = \"volume-and-configuration-survive\"\n" >> /var/lib/snappymail/_data_/_default_/configs/application.ini
		printf "%s\n" "release-drill-persistent-data-v1" > /var/lib/snappymail/_data_/_default_/release-drill-sentinel.txt
	'
}

assert_persistent_data() {
	"${DOCKER}" exec "${APP_NAME}" php -r '
		$base = "/var/lib/snappymail/_data_/_default_/";
		$config = parse_ini_file($base . "configs/application.ini", true, INI_SCANNER_TYPED);
		if (($config["release_drill"]["marker"] ?? "") !== "volume-and-configuration-survive") { exit(1); }
		if (trim((string) file_get_contents($base . "release-drill-sentinel.txt")) !== "release-drill-persistent-data-v1") { exit(2); }
	'
}

admin_password_hash() {
	"${DOCKER}" exec "${APP_NAME}" sha256sum /var/lib/snappymail/_data_/_default_/admin_password.txt | cut -d" " -f1
}

enable_real_copilot_without_provider() {
	[[ "$("${DOCKER}" exec "${APP_NAME}" sha256sum /opt/ai-copilot/index.php | cut -d" " -f1 | tr -d '\r')" = "${PLUGIN_SHA256}" ]]
	"${DOCKER}" exec "${APP_NAME}" /bin/sh -c '
		mkdir -p /var/lib/snappymail/_data_/_default_/plugins
		ln -sfn /opt/ai-copilot /var/lib/snappymail/_data_/_default_/plugins/ai-copilot
	'
	"${DOCKER}" exec -u www-data "${APP_NAME}" php -r '
		$file = "/var/lib/snappymail/_data_/_default_/configs/application.ini";
		$ini = file_get_contents($file);
		$ini = preg_replace_callback("/(\\[plugins\\][^\\[]*?)enable = Off/s", function($matches) { return $matches[1] . "enable = On"; }, $ini, 1);
		$ini = preg_replace("/enabled_list = \"[^\"]*\"/", "enabled_list = \"ai-copilot\"", $ini, 1, $listed);
		$config = parse_ini_string($ini, true, INI_SCANNER_TYPED);
		$enabled = ($config["plugins"]["enable"] ?? false) === true;
		$listed = $listed && in_array("ai-copilot", array_map("trim", explode(",", $config["plugins"]["enabled_list"] ?? "")), true);
		if (!$listed || !$enabled) { fwrite(STDERR, "Copilot configuration could not be enabled\n"); exit(1); }
		if (false === file_put_contents($file, $ini)) { fwrite(STDERR, "Copilot configuration is not writable\n"); exit(2); }
	'
}

backup_volume() {
	local volume=$1 label=$2
	"${DOCKER}" run --rm --network none --entrypoint tar \
		-v "${volume}:/source:ro" -v "${EVIDENCE_DOCKER}:/backup" \
		"${CURRENT_ID}" -czf "/backup/${label}.tar.gz" -C /source . >/dev/null
	sha256sum "${EVIDENCE_DIR}/${label}.tar.gz" > "${EVIDENCE_DIR}/${label}.tar.gz.sha256"
}

request_status() {
	local path=$1 label=$2 output code
	output=$("${DOCKER}" exec "${APP_NAME}" wget -S -T 15 -O /dev/null --post-data='{}' --header='Content-Type: application/json' "http://127.0.0.1:8888${path}" 2>&1 || true)
	code=$(printf '%s\n' "${output}" | awk '/HTTP\/1\.[01] [0-9][0-9][0-9]/ { value=$2 } END { print value }')
	printf '%s\n' "${output}" > "${EVIDENCE_DIR}/${label}-http-response.txt"
	if [[ ! "${code}" =~ ^[0-9]{3}$ ]]; then
		echo "No HTTP status received for ${path}" >&2
		return 1
	fi
	printf '%s' "${code}"
}

assert_sse_response() {
	local label=$1 content_type
	content_type=$(awk 'tolower($1) == "content-type:" { value=$2 } END { gsub("\\r", "", value); print value }' "${EVIDENCE_DIR}/${label}-http-response.txt")
	case "${content_type}" in
		text/event-stream*) ;;
		*) echo "Streaming route did not return SSE (${content_type:-missing Content-Type})" >&2; return 1 ;;
	esac
}

assert_php_route() {
	local label=$1 code
	code=$(request_status '/?/AiStream/' "${label}")
	# The unauthenticated real plugin returns an SSE error without a provider.
	# Login HTML or a proxy error does not prove that the PHP stream survived.
	if [[ "${code}" != 200 ]]; then
		echo "PHP streaming route returned HTTP ${code}" >&2
		return 1
	fi
	assert_sse_response "${label}"
	if "${DOCKER}" exec "${APP_NAME}" pidof snappy-ai-proxy >/dev/null 2>&1; then
		echo "Rust sidecar is unexpectedly running in PHP-only mode" >&2
		return 1
	fi
	printf 'PHP-only streaming route: HTTP %s SSE, real plugin, sidecar absent\n' "${code}"
}

assert_rust_route() {
	local label=$1 code
	"${DOCKER}" exec "${APP_NAME}" pidof snappy-ai-proxy >/dev/null
	code=$(request_status '/api/ai/stream' "${label}")
	if [[ "${code}" != 200 ]]; then
		echo "Rust streaming route returned HTTP ${code}" >&2
		return 1
	fi
	assert_sse_response "${label}"
	printf 'Rust streaming route: HTTP %s SSE, sidecar running; no provider configured\n' "${code}"
}

CURRENT_ID=$(image_id "${CURRENT_INPUT}")
PREVIOUS_ID=$(image_id "${PREVIOUS_INPUT}")
if [[ "${CURRENT_ID}" = "${PREVIOUS_ID}" ]]; then
	echo "Current and previous images must be different" >&2
	exit 1
fi
CURRENT_VERSION=$(version_of "${CURRENT_ID}")
PREVIOUS_VERSION=$(version_of "${PREVIOUS_ID}")
if [[ "${CURRENT_VERSION}" = "${PREVIOUS_VERSION}" ]]; then
	echo "The previous fork image must contain a different packaged version" >&2
	exit 1
fi
CURRENT_HASHES=$(asset_hashes "${CURRENT_ID}" "${CURRENT_VERSION}")
PREVIOUS_HASHES=$(asset_hashes "${PREVIOUS_ID}" "${PREVIOUS_VERSION}")
{
	printf 'current_input=%s\ncurrent_id=%s\ncurrent_version=%s\n' "${CURRENT_INPUT}" "${CURRENT_ID}" "${CURRENT_VERSION}"
	printf 'previous_input=%s\nprevious_id=%s\nprevious_version=%s\n' "${PREVIOUS_INPUT}" "${PREVIOUS_ID}" "${PREVIOUS_VERSION}"
	printf 'docker_server=%s\n' "$("${DOCKER}" version --format '{{.Server.Os}}/{{.Server.Arch}} {{.Server.Version}}')"
	printf 'note=Local image IDs are content identities, not published registry digests.\n'
} | tee "${EVIDENCE_DIR}/images.txt"

printf '\n== Fresh install %s ==\n' "${CURRENT_VERSION}"
start_app "${CURRENT_ID}" "${FRESH_VOLUME}" false
assert_release "${CURRENT_ID}" "${CURRENT_VERSION}" "${CURRENT_HASHES}"
assert_safe_defaults
assert_probe fresh "${CURRENT_VERSION}"
replace_app "${CURRENT_ID}" "${FRESH_VOLUME}" false
assert_release "${CURRENT_ID}" "${CURRENT_VERSION}" "${CURRENT_HASHES}"
"${DOCKER}" exec "${APP_NAME}" test ! -e /var/lib/snappymail/_data_/_default_/release-drill-sentinel.txt
printf 'Fresh install and safe updater defaults: ok\n'
"${DOCKER}" rm -f "${APP_NAME}" >/dev/null

printf '\n== Previous fork installation %s ==\n' "${PREVIOUS_VERSION}"
start_app "${PREVIOUS_ID}" "${UPGRADE_VOLUME}" false
assert_release "${PREVIOUS_ID}" "${PREVIOUS_VERSION}" "${PREVIOUS_HASHES}"
assert_probe previous-before-upgrade "${PREVIOUS_VERSION}"
seed_persistent_data
ADMIN_BEFORE=$(admin_password_hash)
replace_app "${PREVIOUS_ID}" "${UPGRADE_VOLUME}" false
assert_persistent_data
[[ "${ADMIN_BEFORE}" = "$(admin_password_hash)" ]]
PREVIOUS_CACHE_START=$(probe_start_time)
"${DOCKER}" rm -f "${APP_NAME}" >/dev/null
backup_volume "${UPGRADE_VOLUME}" previous-stopped-volume

printf '\n== Immutable upgrade %s -> %s ==\n' "${PREVIOUS_VERSION}" "${CURRENT_VERSION}"
start_app "${CURRENT_ID}" "${UPGRADE_VOLUME}" false
assert_release "${CURRENT_ID}" "${CURRENT_VERSION}" "${CURRENT_HASHES}"
assert_persistent_data
[[ "${ADMIN_BEFORE}" = "$(admin_password_hash)" ]]
assert_probe current-after-upgrade "${CURRENT_VERSION}"
CURRENT_CACHE_START=$(probe_start_time)
[[ "${CURRENT_CACHE_START}" -ge "${PREVIOUS_CACHE_START}" ]]
printf 'Upgrade assets, persistent data, admin credential, and fresh OPcache: ok\n'

printf '\n== Immutable image rollback %s -> %s ==\n' "${CURRENT_VERSION}" "${PREVIOUS_VERSION}"
"${DOCKER}" rm -f "${APP_NAME}" >/dev/null
backup_volume "${UPGRADE_VOLUME}" current-stopped-volume
start_app "${PREVIOUS_ID}" "${UPGRADE_VOLUME}" false
assert_release "${PREVIOUS_ID}" "${PREVIOUS_VERSION}" "${PREVIOUS_HASHES}"
assert_persistent_data
[[ "${ADMIN_BEFORE}" = "$(admin_password_hash)" ]]
assert_probe previous-after-rollback "${PREVIOUS_VERSION}"
ROLLBACK_CACHE_START=$(probe_start_time)
[[ "${ROLLBACK_CACHE_START}" -ge "${CURRENT_CACHE_START}" ]]
printf 'Previous image, persistent data, admin credential, and fresh OPcache restored: ok\n'
"${DOCKER}" rm -f "${APP_NAME}" >/dev/null

# Exercise the new fork's real copilot separately. The previous tag predates it,
# so the cross-version rollback above intentionally carries no enabled copilot.
printf '\n== PHP-only route with the real copilot ==\n'
start_app "${CURRENT_ID}" "${ROUTE_VOLUME}" false
assert_release "${CURRENT_ID}" "${CURRENT_VERSION}" "${CURRENT_HASHES}"
assert_safe_defaults
seed_persistent_data
ROUTE_ADMIN_BEFORE=$(admin_password_hash)
enable_real_copilot_without_provider
assert_probe current-php-before-rust "${CURRENT_VERSION}"
assert_php_route php-before-rust

printf '\n== PHP-only to Rust route rollout ==\n'
replace_app "${CURRENT_ID}" "${ROUTE_VOLUME}" true
assert_release "${CURRENT_ID}" "${CURRENT_VERSION}" "${CURRENT_HASHES}"
assert_persistent_data
[[ "${ROUTE_ADMIN_BEFORE}" = "$(admin_password_hash)" ]]
assert_probe current-rust "${CURRENT_VERSION}"
assert_rust_route rust-route

printf '\n== Rust to PHP-only route rollback ==\n'
replace_app "${CURRENT_ID}" "${ROUTE_VOLUME}" false
assert_release "${CURRENT_ID}" "${CURRENT_VERSION}" "${CURRENT_HASHES}"
assert_persistent_data
[[ "${ROUTE_ADMIN_BEFORE}" = "$(admin_password_hash)" ]]
assert_probe current-php-rollback "${CURRENT_VERSION}"
assert_php_route php-after-rust-rollback

printf '\nRelease upgrade/rollback drill passed. Evidence: %s\n' "${EVIDENCE_DIR}"
printf 'No registry publication, remote upgrade, live model, or external mail service was used.\n'
