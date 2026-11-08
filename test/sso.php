<?php

// Enable SnappyMail Api and include index file
$_ENV['SNAPPYMAIL_INCLUDE_AS_API'] = true;
require __DIR__ . '/../index.php';

$ssoHash = \RainLoop\Api::CreateUserSsoHash(
	'sso-test@example.invalid',
	'local-test-passphrase',
	array('Language' => 'en-US'),
	true
);
if (!is_string($ssoHash) || '' === $ssoHash) {
	throw new RuntimeException('SSO hash creation failed');
}
if (!\RainLoop\Api::ClearUserSsoHash($ssoHash)) {
	throw new RuntimeException('SSO hash cleanup failed');
}
echo "sso: ok\n";
