#!/usr/bin/env bash
# Exercise cli/upgrade.sh with actual versioned archives over a local trusted HTTPS channel.
set -euo pipefail

HERE=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(CDPATH= cd -- "${HERE}/../../../.." && pwd)
DOCKER=${DOCKER:-docker}
CURRENT_INPUT=${1:?Usage: php-only.sh CURRENT_IMAGE CURRENT_TAR_GZ PREVIOUS_TAR_GZ [EVIDENCE_DIR]}
CURRENT_ARCHIVE_INPUT=${2:?Usage: php-only.sh CURRENT_IMAGE CURRENT_TAR_GZ PREVIOUS_TAR_GZ [EVIDENCE_DIR]}
PREVIOUS_ARCHIVE_INPUT=${3:?Usage: php-only.sh CURRENT_IMAGE CURRENT_TAR_GZ PREVIOUS_TAR_GZ [EVIDENCE_DIR]}
RUN_ID=$(date -u +%Y%m%dT%H%M%S)-$$
EVIDENCE_DIR=${4:-${ROOT}/build/local/upgrade-php/${RUN_ID}}
PREFIX=snappymail-archive-drill-$$
APP_NAME=${PREFIX}-app
SERVER_NAME=${PREFIX}-https
NETWORK=${PREFIX}-internal
VOLUME=${PREFIX}-data
SERVER_IMAGE=${SERVER_IMAGE:-python:3.12.8-alpine3.21@sha256:ba13ef990f6e5d13014e9e8d04c02a8fdb0fe53d6dccf6e19147f316e6cc3a84}
export MSYS_NO_PATHCONV=1

mkdir -p "${EVIDENCE_DIR}"
EVIDENCE_DIR=$(CDPATH= cd -- "${EVIDENCE_DIR}" && pwd)
ARCHIVES=${EVIDENCE_DIR}/archives
TLS=${EVIDENCE_DIR}/tls
INSTALL=${EVIDENCE_DIR}/install
mkdir -p "${ARCHIVES}" "${TLS}"

docker_path() {
	if command -v cygpath >/dev/null 2>&1; then
		cygpath -w "$1"
	else
		printf '%s' "$1"
	fi
}
EVIDENCE_DOCKER=$(docker_path "${EVIDENCE_DIR}")
ARCHIVES_DOCKER=$(docker_path "${ARCHIVES}")
TLS_DOCKER=$(docker_path "${TLS}")
INSTALL_DOCKER=$(docker_path "${INSTALL}")
SERVER_SCRIPT_DOCKER=$(docker_path "${HERE}/https_server.py")
CERT_DOCKER=$(docker_path "${TLS}/cert.pem")

cleanup() {
	"${DOCKER}" rm -f -v "${APP_NAME}" "${SERVER_NAME}" >/dev/null 2>&1 || true
	"${DOCKER}" network rm "${NETWORK}" >/dev/null 2>&1 || true
	"${DOCKER}" volume rm -f "${VOLUME}" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

archive_version() {
	tar -xOf "$1" index.php | awk -F\' "/define\('APP_VERSION/ { print \$4; exit }"
}

assert_archive_safe() {
	local archive=$1 version=$2
	if tar -tf "${archive}" | awk '/^(\/|.*\/\.\.(\/|$)|\.\.(\/|$))/ { exit 1 }'; then
		:
	else
		echo "Unsafe archive path in ${archive}" >&2
		return 1
	fi
	[[ "${version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]]
	[[ "${version}" != 0.0.0 ]]
	tar -tf "${archive}" | awk -v expected="snappymail/v/${version}/index.php" '$0 == expected { found=1 } END { exit !found }'
}

CURRENT_ID=$("${DOCKER}" image inspect "${CURRENT_INPUT}" --format '{{.Id}}')
CURRENT_VERSION=$(archive_version "${CURRENT_ARCHIVE_INPUT}")
PREVIOUS_VERSION=$(archive_version "${PREVIOUS_ARCHIVE_INPUT}")
if [[ -z "${CURRENT_VERSION}" || -z "${PREVIOUS_VERSION}" || "${CURRENT_VERSION}" = "${PREVIOUS_VERSION}" ]]; then
	echo "Current and previous archives must have distinct packaged versions" >&2
	exit 1
fi
assert_archive_safe "${CURRENT_ARCHIVE_INPUT}" "${CURRENT_VERSION}"
assert_archive_safe "${PREVIOUS_ARCHIVE_INPUT}" "${PREVIOUS_VERSION}"
CURRENT_ARCHIVE=${ARCHIVES}/snappymail-${CURRENT_VERSION}.tar.gz
PREVIOUS_ARCHIVE=${ARCHIVES}/snappymail-${PREVIOUS_VERSION}.tar.gz
cp "${CURRENT_ARCHIVE_INPUT}" "${CURRENT_ARCHIVE}"
cp "${PREVIOUS_ARCHIVE_INPUT}" "${PREVIOUS_ARCHIVE}"
cmp "${CURRENT_ARCHIVE_INPUT}" "${CURRENT_ARCHIVE}"
cmp "${PREVIOUS_ARCHIVE_INPUT}" "${PREVIOUS_ARCHIVE}"
CURRENT_SHA256=$(sha256sum "${CURRENT_ARCHIVE}" | cut -d" " -f1)
PREVIOUS_SHA256=$(sha256sum "${PREVIOUS_ARCHIVE}" | cut -d" " -f1)
{
	printf 'current_image_input=%s\ncurrent_image_id=%s\ncurrent_version=%s\ncurrent_archive_sha256=%s\n' "${CURRENT_INPUT}" "${CURRENT_ID}" "${CURRENT_VERSION}" "${CURRENT_SHA256}"
	printf 'previous_version=%s\nprevious_archive_sha256=%s\n' "${PREVIOUS_VERSION}" "${PREVIOUS_SHA256}"
	printf 'archive_url=https://archive:8443 (isolated internal network only)\n'
	printf 'note=No registry digest or remote release is asserted by this drill.\n'
} | tee "${EVIDENCE_DIR}/inputs.txt"
sha256sum "${CURRENT_ARCHIVE}" "${PREVIOUS_ARCHIVE}" > "${EVIDENCE_DIR}/archives.sha256"

command -v openssl >/dev/null
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj '/CN=archive' \
	-addext 'subjectAltName=DNS:archive' -keyout "$(docker_path "${TLS}/key.pem")" -out "$(docker_path "${TLS}/cert.pem")" >/dev/null 2>&1
"${DOCKER}" network create --internal "${NETWORK}" >/dev/null
"${DOCKER}" run -d --name "${SERVER_NAME}" --network "${NETWORK}" --network-alias archive \
	--memory 128m --cpus 0.5 --pids-limit 64 \
	-v "${ARCHIVES_DOCKER}:/srv/archives:ro" -v "${TLS_DOCKER}:/tls:ro" \
	-v "${SERVER_SCRIPT_DOCKER}:/opt/https_server.py:ro" \
	"${SERVER_IMAGE}" python /opt/https_server.py >/dev/null

"${DOCKER}" run --rm --network "${NETWORK}" --entrypoint /bin/sh \
	-v "${CERT_DOCKER}:/usr/local/share/ca-certificates/release-drill.crt:ro" \
	"${CURRENT_ID}" -c '
		update-ca-certificates >/dev/null 2>&1
		for attempt in $(seq 1 30); do
			if wget --spider -q -T 2 "https://archive:8443/'"$(basename "${CURRENT_ARCHIVE}")"'"; then exit 0; fi
			sleep 1
		done
		exit 1
	'

mkdir -p "${INSTALL}"
tar -xzf "${PREVIOUS_ARCHIVE}" -C "${INSTALL}"
# Test the current reviewed updater against the old application, and use the
# same external-data contract as the container runtime. No old PHP is replaced.
mkdir -p "${INSTALL}/cli"
tr -d '\r' < "${ROOT}/cli/upgrade.sh" > "${INSTALL}/cli/upgrade.sh"
chmod u+x "${INSTALL}/cli/upgrade.sh"
printf '<?php\ndefine('"'"'APP_DATA_FOLDER_PATH'"'"', '"'"'/var/lib/snappymail/'"'"');\n' > "${INSTALL}/include.php"
cp "${HERE}/probe.php" "${INSTALL}/release-drill-probe.php"

wait_ready() {
	local attempt
	for attempt in $(seq 1 90); do
		if "${DOCKER}" exec "${APP_NAME}" wget -q -T 2 -O /dev/null http://127.0.0.1:8888/ >/dev/null 2>&1; then
			break
		fi
		sleep 1
	done
	for attempt in $(seq 1 30); do
		if "${DOCKER}" exec "${APP_NAME}" test -s /var/lib/snappymail/_data_/_default_/admin_password.txt; then
			sleep 3
			"${DOCKER}" exec "${APP_NAME}" wget -q -T 15 -O /dev/null http://127.0.0.1:8888/
			return 0
		fi
		sleep 1
	done
	"${DOCKER}" logs "${APP_NAME}" >&2 || true
	echo "Archive drill application did not initialize" >&2
	return 1
}

start_app() {
	"${DOCKER}" run -d --name "${APP_NAME}" --network none --memory 512m --cpus 1 --pids-limit 128 \
		-e SECURE_COOKIES=false -e SNAPPY_AI_PROXY_ENABLED=false \
		-v "${INSTALL_DOCKER}:/snappymail" -v "${VOLUME}:/var/lib/snappymail" \
		"${CURRENT_ID}" >/dev/null
	wait_ready
}

stop_app() {
	"${DOCKER}" rm -f "${APP_NAME}" >/dev/null
}

assert_version_and_assets() {
	local expected_version=$1 archive=$2 label=$3 file actual expected
	"${DOCKER}" exec -e EXPECTED_VERSION="${expected_version}" "${APP_NAME}" php -r '
		$source = file_get_contents("/snappymail/index.php");
		if (!preg_match("/define\\('"'"'APP_VERSION'"'"', '"'"'([^'"'"']+)'"'"'\\)/", $source, $match)
		 || $match[1] !== getenv("EXPECTED_VERSION") || "0.0.0" === $match[1]) { exit(1); }
	'
	: > "${EVIDENCE_DIR}/${label}-assets.txt"
	for file in static/js/app.js static/js/admin.js static/css/app.css static/css/admin.css; do
		actual=$(sha256sum "${INSTALL}/snappymail/v/${expected_version}/${file}" | cut -d" " -f1)
		expected=$(tar -xOf "${archive}" "snappymail/v/${expected_version}/${file}" | sha256sum | cut -d" " -f1)
		[[ "${actual}" = "${expected}" ]]
		printf '%s  %s\n' "${actual}" "snappymail/v/${expected_version}/${file}" >> "${EVIDENCE_DIR}/${label}-assets.txt"
	done
}

assert_probe() {
	local label=$1 expected_version=$2 json
	json=$("${DOCKER}" exec "${APP_NAME}" wget -q -T 15 -O- http://127.0.0.1:8888/release-drill-probe.php)
	printf '%s\n' "${json}" > "${EVIDENCE_DIR}/${label}.json"
	"${DOCKER}" exec -e JSON="${json}" -e EXPECTED_VERSION="${expected_version}" "${APP_NAME}" php -r '
		$data = json_decode(getenv("JSON"), true, 512, JSON_THROW_ON_ERROR);
		$cache = $data["opcache"];
		if ($data["version"] !== getenv("EXPECTED_VERSION") || !$cache["enabled"]
		 || !$cache["root_index_cached"] || $cache["cached_versions"] !== [getenv("EXPECTED_VERSION")]
		 || $cache["oom_restarts"] || $cache["hash_restarts"] || $cache["manual_restarts"]) { exit(1); }
	'
	if "${DOCKER}" exec "${APP_NAME}" pidof snappy-ai-proxy >/dev/null 2>&1; then
		echo "PHP-only archive drill unexpectedly started Rust" >&2
		return 1
	fi
}

seed_data() {
	"${DOCKER}" exec "${APP_NAME}" /bin/sh -c '
		printf "\n[release_drill]\nmarker = \"archive-volume-and-configuration-survive\"\n" >> /var/lib/snappymail/_data_/_default_/configs/application.ini
		printf "%s\n" "release-drill-archive-persistent-data-v1" > /var/lib/snappymail/_data_/_default_/release-drill-sentinel.txt
	'
}

assert_data() {
	"${DOCKER}" exec "${APP_NAME}" php -r '
		$base = "/var/lib/snappymail/_data_/_default_/";
		$config = parse_ini_file($base . "configs/application.ini", true, INI_SCANNER_TYPED);
		if (($config["release_drill"]["marker"] ?? "") !== "archive-volume-and-configuration-survive") { exit(1); }
		if (trim((string) file_get_contents($base . "release-drill-sentinel.txt")) !== "release-drill-archive-persistent-data-v1") { exit(2); }
	'
}

assert_safe_updater() {
	"${DOCKER}" exec "${APP_NAME}" php -r '
		$config = parse_ini_file("/var/lib/snappymail/_data_/_default_/configs/application.ini", true, INI_SCANNER_TYPED);
		if (($config["repository"]["url"] ?? "") !== "" || ($config["admin_panel"]["allow_update"] ?? true) !== false) { exit(1); }
	'
}

admin_hash() {
	"${DOCKER}" exec "${APP_NAME}" sha256sum /var/lib/snappymail/_data_/_default_/admin_password.txt | cut -d" " -f1 | tr -d '\r'
}

backup_data() {
	"${DOCKER}" run --rm --network none --entrypoint tar \
		-v "${VOLUME}:/source:ro" -v "${EVIDENCE_DOCKER}:/backup" \
		"${CURRENT_ID}" -czf "/backup/$1.tar.gz" -C /source . >/dev/null
	sha256sum "${EVIDENCE_DIR}/$1.tar.gz" > "${EVIDENCE_DIR}/$1.tar.gz.sha256"
}

run_updater() {
	local archive=$1 checksum=$2 label=$3
	"${DOCKER}" run --rm --network "${NETWORK}" \
		-v "${INSTALL_DOCKER}:/snappymail" -v "${EVIDENCE_DOCKER}:/evidence" \
		-v "${CERT_DOCKER}:/usr/local/share/ca-certificates/release-drill.crt:ro" \
		-e SNAPPYMAIL_UPGRADE_URL="https://archive:8443/$(basename "${archive}")" \
		-e SNAPPYMAIL_UPGRADE_SHA256="${checksum}" \
		--entrypoint /bin/sh "${CURRENT_ID}" -c '
			set -eu
			update-ca-certificates >/dev/null 2>&1
			bash /snappymail/cli/upgrade.sh
			cp /backup_snappymail_*.tar.gz "/evidence/'"${label}"'-application-backup.tar.gz"
		' 2>&1 | tee "${EVIDENCE_DIR}/${label}-updater.log"
	sha256sum "${EVIDENCE_DIR}/${label}-application-backup.tar.gz" > "${EVIDENCE_DIR}/${label}-application-backup.tar.gz.sha256"
}

printf '\n== Archive-based previous fork installation %s ==\n' "${PREVIOUS_VERSION}"
start_app
assert_version_and_assets "${PREVIOUS_VERSION}" "${PREVIOUS_ARCHIVE}" previous
assert_probe archive-previous "${PREVIOUS_VERSION}"
seed_data
ADMIN_BEFORE=$(admin_hash)
stop_app
backup_data archive-previous-stopped-data

printf '\n== cli/upgrade.sh %s -> %s over reviewed local HTTPS ==\n' "${PREVIOUS_VERSION}" "${CURRENT_VERSION}"
run_updater "${CURRENT_ARCHIVE}" "${CURRENT_SHA256}" upgrade
start_app
assert_version_and_assets "${CURRENT_VERSION}" "${CURRENT_ARCHIVE}" current
assert_probe archive-current "${CURRENT_VERSION}"
assert_data
assert_safe_updater
[[ "${ADMIN_BEFORE}" = "$(admin_hash)" ]]
printf 'Shell upgrade assets, safe updater settings, data, credential, and OPcache restart: ok\n'
stop_app
backup_data archive-current-stopped-data

printf '\n== cli/upgrade.sh rollback %s -> %s ==\n' "${CURRENT_VERSION}" "${PREVIOUS_VERSION}"
run_updater "${PREVIOUS_ARCHIVE}" "${PREVIOUS_SHA256}" rollback
start_app
assert_version_and_assets "${PREVIOUS_VERSION}" "${PREVIOUS_ARCHIVE}" rollback
assert_probe archive-rollback "${PREVIOUS_VERSION}"
assert_data
[[ "${ADMIN_BEFORE}" = "$(admin_hash)" ]]
printf 'Shell rollback assets, data, credential, and OPcache restart: ok\n'

printf '\nPHP-only archive upgrade/rollback drill passed. Evidence: %s\n' "${EVIDENCE_DIR}"
printf 'Only a local internal HTTPS archive was used; no live model or remote release channel was contacted.\n'
