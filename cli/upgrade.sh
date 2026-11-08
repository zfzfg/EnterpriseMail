#!/usr/bin/env bash

# Upgrade this fork only from an explicitly selected release archive.
# Example:
#   SNAPPYMAIL_UPGRADE_URL=https://github.com/zfzfg/snappymail/releases/download/v3.0.1/snappymail-3.0.1.tar.gz \
#   SNAPPYMAIL_UPGRADE_SHA256=<published-sha256> ./cli/upgrade.sh
# Back up persistent data separately before every upgrade or rollback.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "${SCRIPT_DIR}/snappymail/v" ]; then
	INSTALL_DIR="${SCRIPT_DIR}"
elif [ -d "${SCRIPT_DIR}/../snappymail/v" ]; then
	INSTALL_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
else
	echo "This script must be in or below the SnappyMail installation directory" >&2
	exit 1
fi
cd "${INSTALL_DIR}"

LATEST_URL="${SNAPPYMAIL_UPGRADE_URL:-}"
if [ -z "${LATEST_URL}" ]; then
	echo "Remote upgrade is disabled. Set SNAPPYMAIL_UPGRADE_URL to a reviewed fork release archive." >&2
	exit 2
fi
case "${LATEST_URL}" in
	https://*) ;;
	*) echo "SNAPPYMAIL_UPGRADE_URL must use HTTPS" >&2; exit 2 ;;
esac

if [ "$(id -u)" -ne 0 ]; then
	echo "Please run as root" >&2
	exit 1
fi

for command in wget tar sha256sum; do
	command -v "${command}" > /dev/null || { echo "Missing required command: ${command}" >&2; exit 1; }
done

OWNERGROUP="$(stat -c '%U:%G' snappymail)"
OLD_VERSION="$(awk -F\' "/define\('APP_VERSION/ { print \$4; exit }" index.php)"
if [ -z "${OLD_VERSION}" ]; then
	echo "Could not determine the installed version" >&2
	exit 1
fi

ARCHIVE="$(mktemp /tmp/snappymail-upgrade.XXXXXXXX)"
trap 'rm -f "${ARCHIVE}"' EXIT INT TERM

echo "Downloading reviewed release: ${LATEST_URL}"
wget --https-only --max-redirect=5 -O "${ARCHIVE}" "${LATEST_URL}"

if [ -n "${SNAPPYMAIL_UPGRADE_SHA256:-}" ]; then
	printf '%s  %s\n' "${SNAPPYMAIL_UPGRADE_SHA256}" "${ARCHIVE}" | sha256sum -c -
fi

if tar -tf "${ARCHIVE}" | awk '/^(\/|.*\/\.\.(\/|$)|\.\.(\/|$))/ { exit 1 }'; then
	:
else
	echo "Archive contains an unsafe path" >&2
	exit 1
fi

NEW_VERSION="$(tar -tf "${ARCHIVE}" | awk -F/ '/^snappymail\/v\/[^\/]+\/index.php$/ { print $3 }' | sort -u)"
if [[ ! "${NEW_VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || [[ "${NEW_VERSION}" == *$'\n'* ]]; then
	echo "Archive must contain exactly one valid snappymail/v/VERSION/index.php" >&2
	exit 1
fi
if ! tar -tf "${ARCHIVE}" | awk '$0 == "index.php" { found = 1 } END { exit !found }'; then
	echo "Archive does not contain the root index.php" >&2
	exit 1
fi

if [ "${OLD_VERSION}" = "${NEW_VERSION}" ]; then
	echo "Version ${OLD_VERSION} is already installed; no files changed"
	exit 0
fi

DSTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="../backup_snappymail_${DSTAMP}.tar.gz"
echo "Backing up SnappyMail ${OLD_VERSION} to ${BACKUP}"
tar -czf "${BACKUP}" .

echo "Installing ${NEW_VERSION}"
tar -xzf "${ARCHIVE}"
find . -type d -exec chmod 755 {} \;
find . -type f -exec chmod 644 {} \;
if [ -x cli/upgrade.sh ] || [ -f cli/upgrade.sh ]; then
	chmod u+x cli/upgrade.sh
fi
chown -R "${OWNERGROUP}" "${INSTALL_DIR}"

echo "Upgraded SnappyMail from ${OLD_VERSION} to ${NEW_VERSION}. Backup: ${BACKUP}"
echo "Restart PHP-FPM/Apache or replace the container before serving the new version."
