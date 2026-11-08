#!/bin/sh
set -eu

# Isolated test provider: loopback only, fixture data only, no live provider.
php -S 127.0.0.1:18080 /opt/phase5/mock_provider.php > /tmp/phase5-provider-server.log 2>&1 &
cp /certs/demoCA/cacert.pem /usr/local/share/ca-certificates/phase5-ca.crt
update-ca-certificates > /dev/null 2>&1
mkdir -p /var/lib/snappymail/_data_/_default_/plugins
ln -sfn /opt/ai-copilot /var/lib/snappymail/_data_/_default_/plugins/ai-copilot
exec /entrypoint.sh
