<?php

// Run with: php test/repository.php (configuration fixtures only; no network)

$_ENV['SNAPPYMAIL_INCLUDE_AS_API'] = true;
require __DIR__ . '/../index.php';

use SnappyMail\Repository;

function check(bool $condition, string $message): void
{
	if (!$condition) {
		throw new RuntimeException($message);
	}
}

$config = \RainLoop\Api::Config();
$method = new ReflectionMethod(Repository::class, 'baseUrl');
$readUrl = static fn(): string => $method->invoke(null);

// The fork must not contact or install from the upstream repository by default.
$config->Set('repository', 'url', '');
check('' === $readUrl(), 'empty repository URL was not disabled');
check(null === Repository::getLatestCoreInfo(), 'disabled core repository returned remote data');
check(!Repository::canUpdateCore(), 'disabled core repository allowed an update');
$list = Repository::getPackagesList();
check(false === $list['Real'], 'disabled plugin repository claimed to be remote');
foreach ($list['List'] as $package) {
	check('' === $package['file'] && !$package['canBeUpdated'], 'installed package retained a remote update path');
}

// A reviewed fork or security repository remains an explicit deployment option.
$config->Set('repository', 'url', 'https://updates.example.com/fork/repository/v2/');
check('https://updates.example.com/fork/repository/v2/' === $readUrl(), 'explicit HTTPS repository not retained');
$config->Set('repository', 'url', 'https://updates.example.com/fork/repository/v2');
check('https://updates.example.com/fork/repository/v2/' === $readUrl(), 'repository URL not normalized');

foreach ([
	'http://updates.example.com/repository/',
	'https://user:password@updates.example.com/repository/',
	'https://updates.example.com/repository/?channel=upstream',
	'https://updates.example.com/repository/#upstream',
	"https://updates.example.com/repository/\r\nX-Test: injected"
] as $url) {
	$config->Set('repository', 'url', $url);
	try {
		$readUrl();
		throw new RuntimeException("unsafe repository URL accepted: {$url}");
	} catch (RuntimeException $error) {
		check(str_contains($error->getMessage(), 'HTTPS URL'), "wrong validation error for {$url}");
	}
}

$config->Set('repository', 'url', '');
echo "repository: ok\n";
