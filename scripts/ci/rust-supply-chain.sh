#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

if [[ "$(uname -s)-$(uname -m)" != "Linux-x86_64" ]]; then
	echo 'Pinned scanner archives currently support x86_64 Linux only; use scripts/ci/rust-supply-chain-docker.sh on other hosts.' >&2
	exit 2
fi

for command in cargo curl git sha256sum tar; do
	command -v "$command" > /dev/null || {
		echo "Required command not found: $command" >&2
		exit 2
	}
done

audit_version='0.22.2'
deny_version='0.20.2'
audit_url="https://github.com/rustsec/rustsec/releases/download/cargo-audit/v${audit_version}/cargo-audit-x86_64-unknown-linux-musl-v${audit_version}.tgz"
deny_url="https://github.com/EmbarkStudios/cargo-deny/releases/download/${deny_version}/cargo-deny-${deny_version}-x86_64-unknown-linux-musl.tar.gz"
audit_sha256='7fb9497f8594b389e5fce5ef9b92db08432996895b2e0c5a0167a69ed445c428'
deny_sha256='9f12ed4c49936e09b48bf862b595cde2fe64fcbd9d74dfacac6131ca824c8d5f'

tools="$root/build/tmp/rust-supply-chain-tools"
out="$root/build/local/release/rust-supply-chain"
mkdir -p "$tools"
rm -rf "$out"
mkdir -p "$out"

fetch_tool() {
	local name="$1"
	local url="$2"
	local expected="$3"
	local archive="$tools/$name.tar.gz"
	local destination="$tools/$name"

	if ! printf '%s  %s\n' "$expected" "$archive" | sha256sum -c - > /dev/null 2>&1; then
		rm -f "$archive"
		curl --fail --location --proto '=https' --tlsv1.2 --retry 3 --output "$archive" "$url"
	fi
	printf '%s  %s\n' "$expected" "$archive" | sha256sum -c -
	rm -rf "$destination"
	mkdir -p "$destination"
	tar -xzf "$archive" -C "$destination" --strip-components=1
	test -x "$destination/$name"
}

fetch_tool cargo-audit "$audit_url" "$audit_sha256"
fetch_tool cargo-deny "$deny_url" "$deny_sha256"
audit="$tools/cargo-audit/cargo-audit"
deny="$tools/cargo-deny/cargo-deny"

{
	cargo --version
	rustc --version
	"$audit" --version
	"$deny" --version
	git --version
} | tee "$out/tool-versions.txt"
{
	printf 'cargo-audit %s\n%s\nsha256=%s\n\n' "$audit_version" "$audit_url" "$audit_sha256"
	printf 'cargo-deny %s\n%s\nsha256=%s\n' "$deny_version" "$deny_url" "$deny_sha256"
} > "$out/tool-sources.txt"

cd crates/snappy-ai-proxy
sha256sum Cargo.lock deny.toml > "$out/inputs.sha256"
status=0

if ! "$audit" audit --file Cargo.lock --deny warnings --json > "$out/cargo-audit.json" 2> "$out/cargo-audit.stderr.txt"; then
	status=1
fi
cat "$out/cargo-audit.json" "$out/cargo-audit.stderr.txt"

if ! "$deny" --locked list --format json --layout crate > "$out/rust-licenses.json" 2> "$out/rust-licenses.stderr.txt"; then
	status=1
fi
cat "$out/rust-licenses.stderr.txt"

if ! "$deny" --locked check --show-stats advisories licenses bans sources > "$out/cargo-deny.txt" 2>&1; then
	status=1
fi
cat "$out/cargo-deny.txt"

if ((status != 0)); then
	echo 'Rust supply-chain verification failed; see build/local/release/rust-supply-chain/.' >&2
	exit 1
fi
printf 'Rust supply-chain verification passed; reports: %s\n' "$out"
