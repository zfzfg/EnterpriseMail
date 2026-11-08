<?php

$_ENV['SNAPPYMAIL_INCLUDE_AS_API'] = true;
require dirname(__DIR__) . '/index.php';

$assertions = 0;
function check(bool $condition, string $message): void
{
	global $assertions;
	++$assertions;
	if (!$condition) {
		throw new RuntimeException($message);
	}
}

$login = new \SnappyMail\SASL\Login();
$login->base64 = true;
check('am9obg==' === $login->authenticate('john', 'doe', 'VXNlcm5hbWU6'), 'LOGIN username challenge failed');
check('am9obg==' === $login->authenticate('john', 'doe', 'VXNlcm5hbWU6CG'), 'LOGIN compatibility challenge failed');
check('ZG9l' === $login->challenge('UGFzc3dvcmQ6'), 'LOGIN password challenge failed');

try {
	$login->authenticate('john', 'doe', 'UGFzc3dvcmQ6');
	throw new RuntimeException('LOGIN accepted a password prompt as the username prompt');
} catch (Exception $error) {
	check(str_contains($error->getMessage(), 'Invalid response'), 'LOGIN rejected the wrong prompt for an unexpected reason');
}

echo 'sasl: ok (' . $assertions . " assertions)\n";
