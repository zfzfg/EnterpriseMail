#!/bin/sh
set -eu

case "${BENCH_FPM_MAX_CHILDREN:-}" in
    8|16|30) ;;
    *) echo "BENCH_FPM_MAX_CHILDREN must be 8, 16, or 30" >&2; exit 64 ;;
esac

# Match the development override's CRLF handling without editing its files.
for f in /entrypoint.sh /supervisor.conf /listener.php /etc/nginx/nginx.conf /usr/local/etc/php-fpm.d/php-fpm.conf; do
    if [ -f "$f" ]; then
        tr -d '\r' < "$f" > /tmp/benchmark-crlf
        cat /tmp/benchmark-crlf > "$f"
    fi
done
rm -f /tmp/benchmark-crlf

fpm_conf=/usr/local/etc/php-fpm.d/php-fpm.conf
sed -i "s/^pm.max_children = .*/pm.max_children = ${BENCH_FPM_MAX_CHILDREN}/" "$fpm_conf"
test "$(grep -c '^pm.max_children = ' "$fpm_conf")" -eq 1
grep -q "^pm.max_children = ${BENCH_FPM_MAX_CHILDREN}$" "$fpm_conf"

cp /certs/demoCA/cacert.pem /usr/local/share/ca-certificates/dev-ca.crt
update-ca-certificates >/dev/null 2>&1 || true
mkdir -p /var/lib/snappymail/_data_/_default_/plugins
ln -sfn /opt/ai-copilot /var/lib/snappymail/_data_/_default_/plugins/ai-copilot
printf '{"candidate":%s,"source":"benchmark/container-entrypoint.sh"}\n' "$BENCH_FPM_MAX_CHILDREN" > /run/benchmark-fpm.json
exec /entrypoint.sh
