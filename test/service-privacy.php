<?php

// Run with: php test/service-privacy.php (framework fixtures only; no network)

$_ENV['SNAPPYMAIL_INCLUDE_AS_API'] = true;
require __DIR__ . '/../index.php';

use RainLoop\Actions;
use RainLoop\Config\Application;
use RainLoop\Plugins\Manager;
use RainLoop\ServiceActions;

$assertions = 0;
function check(bool $condition, string $message): void
{
	global $assertions;
	++$assertions;
	if (!$condition) {
		throw new RuntimeException($message);
	}
}

final class MemoryLogDriver extends \MailSo\Log\Driver
{
	public array $lines = array();

	protected function writeImplementation($description): bool
	{
		$this->lines[] = (string) $description;
		return true;
	}
}

final class PrivacyConfig extends Application
{
	public function __construct()
	{
	}

	public function Get(string $section, string $name, mixed $default = null): mixed
	{
		return 'webmail' === $section && 'attachment_size_limit' === $name ? 25 : $default;
	}
}

final class PrivacyActions extends Actions
{
	public array $messages = array();
	public bool $fail = false;

	public function __construct()
	{
		$this->oLogger = \RainLoop\Api::Logger();
		$this->oConfig = new PrivacyConfig();
		$this->oPlugins = (new ReflectionClass(Manager::class))->newInstanceWithoutConstructor();
		$enabled = new ReflectionProperty(Manager::class, 'bIsEnabled');
		$enabled->setValue($this->oPlugins, false);
	}

	public function logWrite(string $description, int $type = LOG_INFO, string $name = '', bool $displayCrLf = false): bool
	{
		$this->messages[] = $description;
		return parent::logWrite($description, $type, $name, $displayCrLf);
	}

	public function logException(Throwable $exception, int $type = LOG_NOTICE, string $name = ''): void
	{
		// Deliberately mimic the old logger: any caller taking this path makes
		// the marker-based regression test fail instead of silently passing.
		$this->logWrite((string) $exception, $type, $name);
	}

	public function DoLogout(): array
	{
		echo 'PRIVACY-MARKER incidental output';
		if ($this->fail) {
			throw new RuntimeException(
				'PRIVACY-MARKER exception response',
				0,
				new RuntimeException('PRIVACY-MARKER previous exception')
			);
		}
		return array('Result' => array('draft' => 'PRIVACY-MARKER JSON response'));
	}

	public function Upload(?array $file, int $error): array
	{
		echo 'PRIVACY-MARKER upload output';
		return array('Result' => array(
			'Attachment' => array('name' => $file['name'] ?? ''),
			'draft' => 'PRIVACY-MARKER upload response'
		));
	}

	public function RawPrivacy(): bool
	{
		throw new RuntimeException('PRIVACY-MARKER previous exception');
	}
}

$driver = new MemoryLogDriver();
\RainLoop\Api::Logger()->append($driver);
$actions = new PrivacyActions();
$http = new \MailSo\Base\Http();
$service = new ServiceActions($http, $actions);
$markers = array(
	'PRIVACY-MARKER prompt', 'PRIVACY-MARKER draft', 'PRIVACY-MARKER mail body',
	'PRIVACY-MARKER JSON response', 'PRIVACY-MARKER upload response',
	'PRIVACY-MARKER cookie', 'PRIVACY-MARKER csrf', 'PRIVACY-MARKER password',
	'PRIVACY-MARKER provider key', 'PRIVACY-MARKER incidental output',
	'PRIVACY-MARKER upload output', 'PRIVACY-MARKER exception response',
	'PRIVACY-MARKER previous exception', 'PRIVACY-MARKER filename'
);

function assertNoMarkers(array $markers, string $logs): void
{
	foreach ($markers as $marker) {
		check(!str_contains($logs, $marker), 'Sensitive marker entered logs: ' . $marker . "\n" . $logs);
	}
}

try {
	$_SERVER['REQUEST_METHOD'] = 'POST';
	$_COOKIE['smsession'] = 'PRIVACY-MARKER cookie';
	$_POST = array(
		'Action' => 'Logout',
		'instruction' => 'PRIVACY-MARKER prompt',
		'current' => 'PRIVACY-MARKER draft',
		'message' => 'PRIVACY-MARKER mail body',
		'XToken' => 'PRIVACY-MARKER csrf',
		'password' => 'PRIVACY-MARKER password',
		'api_key' => 'PRIVACY-MARKER provider key'
	);
	$result = $service->ServiceJson();
	check(str_contains($result, 'PRIVACY-MARKER JSON response'), 'JSON response was not preserved');
	assertNoMarkers($markers, implode("\n", array_merge($actions->messages, $driver->lines)));

	$actions->fail = true;
	$result = $service->ServiceJson();
	check(str_contains($result, 'PRIVACY-MARKER exception response'), 'Exception response fixture did not execute');
	assertNoMarkers($markers, implode("\n", array_merge($actions->messages, $driver->lines)));

	$actions->fail = false;
	$_POST = array('Action' => 'NotLogout', 'XToken' => 'PRIVACY-MARKER csrf');
	$_SERVER['HTTP_X_SM_TOKEN'] = 'PRIVACY-MARKER csrf';
	$service->ServiceJson();
	assertNoMarkers($markers, implode("\n", array_merge($actions->messages, $driver->lines)));
	unset($_SERVER['HTTP_X_SM_TOKEN']);
	$service->ServiceJson();
	assertNoMarkers($markers, implode("\n", array_merge($actions->messages, $driver->lines)));

	$_FILES = array('uploader' => array(
		'name' => 'PRIVACY-MARKER filename',
		'tmp_name' => __FILE__,
		'size' => 10,
		'error' => UPLOAD_ERR_OK
	));
	$result = $service->ServiceUpload();
	check(str_contains($result, 'PRIVACY-MARKER upload response'), 'Upload response was not preserved: ' . $result);
	assertNoMarkers($markers, implode("\n", array_merge($actions->messages, $driver->lines)));

	$service->SetPaths(array('', '', 'Privacy', 'PRIVACY-MARKER csrf'));
	$service->ServiceRaw();
	assertNoMarkers($markers, implode("\n", array_merge($actions->messages, $driver->lines)));

	// Keep the logging sinks themselves content-free even when a Throwable's
	// string representation contains both the current and previous messages.
	check(0 < count($actions->messages), 'No action diagnostics were captured');
	check(0 < count($driver->lines), 'The enabled logger did not receive diagnostics');
	echo 'service-privacy: ok (' . $assertions . " assertions)\n";
} finally {
	$_POST = array();
	$_FILES = array();
}
