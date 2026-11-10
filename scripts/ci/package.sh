#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
mkdir -p build/local build/tmp

version="$(node -p 'require("./package.json").version')"
archive="build/dist/releases/webmail/${version}/snappymail-${version}.tar.gz"
zip="build/dist/releases/webmail/${version}/snappymail-${version}.zip"

php cli/release.php --frontend-dist
test -s "$archive"
test -s "$zip"

contents="build/local/release-package-contents.txt"
tar -tzf "$archive" > "$contents"
for path in index.php \
	docs/release.md \
	cli/upgrade.sh \
	"snappymail/v/${version}/index.php" \
	"snappymail/v/${version}/static/js/app.js" \
	"snappymail/v/${version}/static/js/admin.js" \
	"snappymail/v/${version}/static/css/app.css" \
	"snappymail/v/${version}/static/css/admin.css"; do
	if ! awk -v expected="$path" '$0 == expected { found = 1 } END { exit !found }' "$contents"; then
		echo "Release archive is missing ${path}" >&2
		exit 1
	fi
done

smoke="build/tmp/package-smoke"
rm -rf "$smoke"
mkdir -p "$smoke"
tar -xzf "$archive" -C "$smoke"
cmp "snappymail/v/0.0.0/static/js/app.js" "$smoke/snappymail/v/${version}/static/js/app.js"
cmp "snappymail/v/0.0.0/static/css/app.css" "$smoke/snappymail/v/${version}/static/css/app.css"

# Exercise the PHP-only, non-Docker bootstrap with isolated application data.
php "$smoke/index.php" > build/local/package-smoke.out
config="$smoke/data/_data_/_default_/configs/application.ini"
test -s "$config"
php -r '$c = parse_ini_file($argv[1], true, INI_SCANNER_TYPED); if (($c["repository"]["url"] ?? "missing") !== "" || ($c["admin_panel"]["allow_update"] ?? true) !== false) { fwrite(STDERR, "Unsafe updater defaults in release archive\n"); exit(1); }' "$config"

printf 'Release package and PHP-only bootstrap passed for %s\n' "$version"
