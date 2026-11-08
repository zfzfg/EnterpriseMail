#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
mkdir -p build/local

printf 'PHP runtime: '
php -r 'echo PHP_VERSION, "\n";'

count=0
while IFS= read -r -d '' file; do
	if ! php -l "$file" > build/local/php-lint.out 2>&1; then
		cat build/local/php-lint.out
		exit 1
	fi
	count=$((count + 1))
done < <(git ls-files -z -- '*.php')
echo "PHP syntax: ${count} tracked files passed"

# Executable offline/unit tests. carddav.php and sasl.php are diagnostic
# fixtures; sso.php is an incomplete integration example, not a test.
tests=(
	test/crypt-forgery.php
	test/header-injection.php
	test/header-unfold.php
	test/maintenance.php
	test/raw-inline-type.php
	test/repository.php
	test/service-privacy.php
	test/smime-partid.php
	test/smime-verify.php
	test/ssrf-ranges.php
	test/two-factor-reauth.php
)
for test_file in "${tests[@]}"; do
	php "$test_file"
done
