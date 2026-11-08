<?php

// Run with: php test/maintenance.php (framework-free; uses isolated fixtures)

use RainLoop\Maintenance\FileCleaner;
use RainLoop\Maintenance\Lock;
use RainLoop\Maintenance\Service;

$library = dirname(__DIR__) . '/snappymail/v/0.0.0/app/libraries/RainLoop/Maintenance/';
require $library . 'FileCleaner.php';
require $library . 'Lock.php';
require $library . 'Service.php';

$assertions = 0;
$symlinkTested = false;
$fifoTested = false;
$root = sys_get_temp_dir() . '/snappymail-maintenance-test-' . bin2hex(random_bytes(6));

function check(bool $condition, string $message): void
{
	global $assertions;
	++$assertions;
	if (!$condition) {
		throw new RuntimeException($message);
	}
}

function fileAt(string $path, int $mtime): void
{
	$directory = dirname($path);
	if (!is_dir($directory)) {
		mkdir($directory, 0700, true);
	}
	file_put_contents($path, 'fixture');
	touch($path, $mtime);
}

function readState(string $dataPath): array
{
	return json_decode(file_get_contents($dataPath . '/maintenance/state.json'), true);
}

function removeTree(string $path): void
{
	if (is_link($path) || is_file($path)) {
		@unlink($path);
		return;
	}
	if (is_dir($path)) {
		foreach (scandir($path) ?: array() as $entry) {
			if ('.' !== $entry && '..' !== $entry) {
				removeTree($path . '/' . $entry);
			}
		}
		@rmdir($path);
	}
}

function runCommand(array $command): array
{
	$process = proc_open($command, array(
		0 => array('pipe', 'r'),
		1 => array('pipe', 'w'),
		2 => array('pipe', 'w')
	), $pipes);
	if (!is_resource($process)) {
		throw new RuntimeException('Could not start CLI fixture');
	}
	fclose($pipes[0]);
	$stdout = stream_get_contents($pipes[1]);
	$stderr = stream_get_contents($pipes[2]);
	fclose($pipes[1]);
	fclose($pipes[2]);
	return array('stdout' => $stdout, 'stderr' => $stderr, 'exit' => proc_close($process));
}

function decodeJsonResult(array $commandResult): array
{
	$result = json_decode($commandResult['stdout'], true);
	check(is_array($result), 'CLI stdout was not one JSON object: ' . $commandResult['stdout'] . $commandResult['stderr']);
	return $result;
}

// This opt-in check is run as root in a read-only container. The command must
// refuse before loading installation configuration or touching private data.
if (in_array('--root-check', $argv, true)) {
	try {
		check(function_exists('posix_geteuid') && 0 === posix_geteuid(), 'root-check requires root');
		$commandResult = runCommand(array(PHP_BINARY, dirname(__DIR__) . '/cli/maintenance.php'));
		$result = decodeJsonResult($commandResult);
		check(0 !== $commandResult['exit'], 'CLI accepted root');
		check('error' === $result['status'] && 0 < $result['failures'], 'root refusal was not a JSON error');
		echo 'maintenance: ok (' . $assertions . " root-refusal assertions)\n";
	} finally {
		removeTree($root);
	}
	exit;
}

class FakeCleaner extends FileCleaner
{
	public array $calls = array();
	public int $failuresRemaining = 0;

	public function clean(string $sRoot, int $iRetention, int $iNow): array
	{
		$this->calls[] = array($sRoot, $iRetention, $iNow);
		if (0 < $this->failuresRemaining) {
			--$this->failuresRemaining;
			throw new RuntimeException('Injected failure');
		}
		$result = self::metrics();
		$result['scanned'] = 1;
		return $result;
	}
}

try {
	// Independent schedules: attachments retain their separate 25-hour cadence.
	check(172800 === Service::ATTACHMENT_RETENTION, 'attachment retention is no longer 48 hours');
	$now = 1000000;
	mkdir($root . '/schedule/storage/example.test/main', 0700, true);
	$cleaner = new FakeCleaner();
	$service = new Service($root . '/schedule', $root . '/schedule-cache', $cleaner, static fn(): int => $GLOBALS['now']);
	$result = $service->run();
	check('ok' === $result['status'] && 5 === count($cleaner->calls), 'initial run did not execute all four jobs');
	$now += Service::CACHE_INTERVAL - 1;
	$service->run();
	check(5 === count($cleaner->calls), 'jobs ran before their schedules were due');
	++$now;
	$service->run();
	check(8 === count($cleaner->calls), 'cache, session and sign-me schedules were not independent of attachments');

	// A non-file cache driver is a successful no-op, not a failed cleanup.
	$now = 2000000;
	mkdir($root . '/non-file/storage/example.test/main', 0700, true);
	$nonFileCleaner = new FakeCleaner();
	$nonFile = new Service($root . '/non-file', null, $nonFileCleaner, static fn(): int => $GLOBALS['now']);
	$result = $nonFile->run();
	check('noop' === $result['jobs']['cache'] && 'ok' === $result['status'], 'non-file cache was not treated as a no-op');
	check(4 === count($nonFileCleaner->calls), 'non-file cache still invoked the file cleaner');

	// Failure preserves completion time, backs off, and does not block other jobs.
	$now = 3000000;
	mkdir($root . '/retry/storage/example.test/main', 0700, true);
	$retryCleaner = new FakeCleaner();
	$retryCleaner->failuresRemaining = 1;
	$retry = new Service($root . '/retry', $root . '/retry-cache', $retryCleaner, static fn(): int => $GLOBALS['now']);
	$result = $retry->run();
	$state = readState($root . '/retry');
	check('failed' === $result['jobs']['cache'] && 'ok' === $result['jobs']['sessions'], 'one failed job blocked an independent job');
	check(0 === $state['cache']['completed_at'] && $now + 60 === $state['cache']['retry_at'], 'failure advanced completion or set the wrong retry');
	check($now === $state['sessions']['completed_at'], 'successful job did not record its completion');
	$now += 30;
	$retry->run();
	check(5 === count($retryCleaner->calls), 'failed job retried before its backoff elapsed');
	$now += 30;
	$retry->run();
	$state = readState($root . '/retry');
	check(6 === count($retryCleaner->calls) && $now === $state['cache']['completed_at'], 'failed job did not recover after backoff');

	// Repeated failures use an exponential delay capped at one hour.
	$now = 4000000;
	mkdir($root . '/capped/storage/example.test/main', 0700, true);
	$cappedCleaner = new FakeCleaner();
	$cappedCleaner->failuresRemaining = 1000;
	$capped = new Service($root . '/capped', $root . '/capped-cache', $cappedCleaner, static fn(): int => $GLOBALS['now']);
	for ($i = 0; $i < 10; ++$i) {
		$cappedResult = $capped->run();
		$state = readState($root . '/capped');
		$delay = $state['cache']['retry_at'] - $now;
		check(60 <= $delay && 3600 >= $delay, 'retry delay escaped its bounds: ' . $delay . ' at iteration ' . $i . '; state=' . json_encode($state['cache']) . '; result=' . json_encode($cappedResult));
		$now += 3600;
	}
	check(3600 === $delay, 'retry backoff was not capped');
	check(0 === $state['cache']['completed_at'], 'repeated failures advanced the completion timestamp');

	// The same flock coordinates independent service instances.
	mkdir($root . '/locks', 0700, true);
	$firstLock = new Lock($root . '/locks/run.lock');
	$secondLock = new Lock($root . '/locks/run.lock');
	check($firstLock->acquire(), 'first lock acquisition failed');
	check(!$secondLock->acquire() && $secondLock->wouldBlock(), 'contending lock blocked or acquired');
	$firstLock->release();
	check($secondLock->acquire(), 'lock was not reusable after release');
	$secondLock->release();

	mkdir($root . '/locked/maintenance', 0700, true);
	$heldLock = new Lock($root . '/locked/maintenance/run.lock');
	check($heldLock->acquire(), 'service fixture lock acquisition failed');
	$lockedCleaner = new FakeCleaner();
	$locked = new Service($root . '/locked', $root . '/locked-cache', $lockedCleaner, static fn(): int => 5000000);
	$result = $locked->run();
	check('locked' === $result['status'] && 1 === $result['lock_skips'], 'overlap was not reported as a lock skip');
	check(0 === count($lockedCleaner->calls), 'overlapping service ran cleanup jobs');
	$heldLock->release();

	// Real file fixtures verify retention and all supported attachment layouts.
	$now = 2000000000;
	$data = $root . '/files';
	$storage = $data . '/storage';
	$primary = $storage . '/example.test/main';
	$attachments = $primary . '/.files';
	$additional = $primary . '/additional@example.test/.files';
	$legacy = $storage . '/files';
	$sessions = $primary . '/.sessions';
	$signMe = $primary . '/.sign_me';
	$cache = $data . '/cache';

	$oldAttachment = $attachments . '/old';
	$freshAttachment = $attachments . '/fresh';
	$oldAdditional = $additional . '/old';
	$oldLegacy = $legacy . '/old';
	$oldSession = $sessions . '/old';
	$freshSession = $sessions . '/fresh';
	$oldSignMe = $signMe . '/old';
	$freshSignMe = $signMe . '/fresh';
	$oldCache = $cache . '/old';
	$freshCache = $cache . '/fresh';

	fileAt($oldAttachment, $now - Service::ATTACHMENT_RETENTION - 1);
	fileAt($freshAttachment, $now - Service::ATTACHMENT_RETENTION + 60);
	fileAt($oldAdditional, $now - Service::ATTACHMENT_RETENTION - 1);
	fileAt($oldLegacy, $now - Service::ATTACHMENT_RETENTION - 1);
	fileAt($oldSession, $now - Service::SESSION_RETENTION - 1);
	fileAt($freshSession, $now - 3600);
	fileAt($oldSignMe, $now - Service::SIGN_ME_RETENTION - 1);
	fileAt($freshSignMe, $now - 3600);
	fileAt($oldCache, $now - Service::CACHE_RETENTION - 1);
	fileAt($freshCache, $now - 3600);

	$sqlite = array('AddressBook.sqlite', 'AddressBook.sqlite-wal', 'AddressBook.sqlite-shm',
		'AddressBook.sqlite-journal', 'contacts.db', 'contacts.db-journal', 'notes.sqlite3-mj0123abcd');
	foreach ($sqlite as $name) {
		fileAt($cache . '/' . $name, $now - Service::CACHE_RETENTION - 1);
	}

	// Real PDO CRUD and integrity checks bracket an explicitly active WAL
	// fixture. The reader and writer remain open while cleanup sees old mtimes.
	$database = $cache . '/ActiveAddressBook.db';
	$options = array(PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION);
	$pdo = new PDO('sqlite:' . $database, null, null, $options);
	$pdo->exec('PRAGMA busy_timeout = 2000');
	check('wal' === strtolower((string) $pdo->query('PRAGMA journal_mode = WAL')->fetchColumn()), 'WAL fixture was not enabled');
	$pdo->exec('CREATE TABLE contacts (id INTEGER PRIMARY KEY, email TEXT NOT NULL, display_name TEXT NOT NULL)');
	$statement = $pdo->prepare('INSERT INTO contacts (email, display_name) VALUES (?, ?)');
	$statement->execute(array('before@example.test', 'Before maintenance'));
	$statement->execute(array('delete@example.test', 'Delete before maintenance'));
	$deleteId = (int) $pdo->lastInsertId();
	$pdo->exec("UPDATE contacts SET display_name = 'Updated before maintenance' WHERE email = 'before@example.test'");
	check('Updated before maintenance' === $pdo->query("SELECT display_name FROM contacts WHERE email = 'before@example.test'")->fetchColumn(), 'SQLite update/read failed before cleanup');
	$statement = $pdo->prepare('DELETE FROM contacts WHERE id = ?');
	$statement->execute(array($deleteId));
	check(1 === (int) $pdo->query('SELECT COUNT(*) FROM contacts')->fetchColumn(), 'SQLite delete failed before cleanup');
	check('ok' === strtolower((string) $pdo->query('PRAGMA integrity_check')->fetchColumn()), 'SQLite integrity failed before cleanup');

	$reader = new PDO('sqlite:' . $database, null, null, $options);
	$writer = new PDO('sqlite:' . $database, null, null, $options);
	$reader->exec('PRAGMA busy_timeout = 2000');
	$writer->exec('PRAGMA busy_timeout = 2000');
	$reader->beginTransaction();
	check(1 === (int) $reader->query('SELECT COUNT(*) FROM contacts')->fetchColumn(), 'active reader snapshot was not established');
	$writer->beginTransaction();
	$statement = $writer->prepare('INSERT INTO contacts (email, display_name) VALUES (?, ?)');
	$statement->execute(array('writer@example.test', 'Active writer'));
	check($reader->inTransaction() && $writer->inTransaction(), 'WAL reader/writer transactions were not active');
	check(is_file($database . '-wal') && is_file($database . '-shm'), 'active WAL sidecars were not created');
	fileAt($database . '-journal', $now - Service::CACHE_RETENTION - 1);
	foreach (array($database, $database . '-wal', $database . '-shm') as $stateFile) {
		touch($stateFile, $now - Service::CACHE_RETENTION - 1);
	}

	$outside = $root . '/outside';
	$outsideFile = $outside . '/old';
	fileAt($outsideFile, $now - Service::ATTACHMENT_RETENTION - 1);
	$link = $attachments . '/linked';
	if (@symlink($outside, $link)) {
		$symlinkTested = true;
	}
	if (function_exists('posix_mkfifo')) {
		$fifoTested = @posix_mkfifo($attachments . '/fifo', 0600);
	}

	$result = (new Service($data, $cache, null, static fn(): int => $now))->run();
	check('ok' === $result['status'], 'real cleanup reported a failure');
	check(6 === $result['deleted'] && 0 < $result['bytes'], 'aggregate deletion metrics were incorrect');
	check(!file_exists($oldAttachment) && file_exists($freshAttachment), 'attachment retention was incorrect');
	check(!file_exists($oldAdditional), 'additional-account attachment was not reclaimed');
	check(!file_exists($oldLegacy) && is_dir($legacy), 'legacy attachment cleanup or root preservation failed');
	check(!file_exists($oldSession) && file_exists($freshSession), 'session retention was incorrect');
	check(!file_exists($oldSignMe) && file_exists($freshSignMe), 'sign-me retention was incorrect');
	check(!file_exists($oldCache) && file_exists($freshCache), 'file-cache retention was incorrect');
	foreach (array($attachments, $additional, $sessions, $signMe, $cache) as $directory) {
		check(is_dir($directory), 'an allowlisted root was removed');
	}
	foreach ($sqlite as $name) {
		check(file_exists($cache . '/' . $name), 'SQLite database or sidecar was removed');
	}
	clearstatcache();
	foreach (array($database, $database . '-wal', $database . '-shm', $database . '-journal') as $stateFile) {
		check(is_file($stateFile), 'cleanup removed an active SQLite database or state file');
	}
	check($reader->inTransaction() && $writer->inTransaction(), 'cleanup disturbed active WAL transactions');
	check(1 === (int) $reader->query('SELECT COUNT(*) FROM contacts')->fetchColumn(), 'active reader lost its WAL snapshot');
	$writer->commit();
	check(1 === (int) $reader->query('SELECT COUNT(*) FROM contacts')->fetchColumn(), 'reader snapshot changed after writer commit');
	$reader->commit();
	check(2 === (int) $pdo->query('SELECT COUNT(*) FROM contacts')->fetchColumn(), 'committed WAL writer data was lost');

	$statement = $pdo->prepare('INSERT INTO contacts (email, display_name) VALUES (?, ?)');
	$statement->execute(array('after@example.test', 'Created after maintenance'));
	$afterId = (int) $pdo->lastInsertId();
	$statement = $pdo->prepare('SELECT display_name FROM contacts WHERE id = ?');
	$statement->execute(array($afterId));
	check('Created after maintenance' === $statement->fetchColumn(), 'SQLite create/read failed after cleanup');
	$statement = $pdo->prepare('UPDATE contacts SET display_name = ? WHERE id = ?');
	$statement->execute(array('Updated after maintenance', $afterId));
	$statement = $pdo->prepare('SELECT display_name FROM contacts WHERE id = ?');
	$statement->execute(array($afterId));
	check('Updated after maintenance' === $statement->fetchColumn(), 'SQLite update/read failed after cleanup');
	$statement = $pdo->prepare('DELETE FROM contacts WHERE id = ?');
	$statement->execute(array($afterId));
	$statement = $pdo->prepare('SELECT COUNT(*) FROM contacts WHERE id = ?');
	$statement->execute(array($afterId));
	check(0 === (int) $statement->fetchColumn(), 'SQLite delete failed after cleanup');
	check('ok' === strtolower((string) $pdo->query('PRAGMA integrity_check')->fetchColumn()), 'SQLite integrity failed after cleanup');
	$reader = $writer = $pdo = null;

	if ($symlinkTested) {
		check(is_link($link) && file_exists($outsideFile), 'directory symlink was removed or followed');
	}
	if ($fifoTested) {
		check(file_exists($attachments . '/fifo'), 'non-regular file was removed');
	}
	$encoded = json_encode($result);
	check(!str_contains($encoded, $root) && !str_contains($encoded, 'example.test'), 'metrics exposed a path or account name');

	// Exercise the real command in a temporary deployment whose include.php
	// configures isolated data and cache roots. Nothing points at repository data.
	$deployment = $root . '/cli-deployment';
	mkdir($deployment . '/cli', 0700, true);
	check(copy(dirname(__DIR__) . '/cli/maintenance.php', $deployment . '/cli/maintenance.php'), 'could not copy CLI fixture');
	check(copy(dirname(__DIR__) . '/index.php', $deployment . '/index.php'), 'could not copy application entry fixture');
	check(symlink(dirname(__DIR__) . '/snappymail', $deployment . '/snappymail'), 'could not link application fixture');
	$appData = $root . '/configured-data';
	$privateData = $appData . '/_data_/_default_';
	$cliCache = $root . '/configured-cache';
	mkdir($privateData . '/configs', 0700, true);
	file_put_contents($appData . '/INSTALLED', '0.0.0');
	file_put_contents($appData . '/SALT.php', '<?php //' . bin2hex(random_bytes(48)));
	file_put_contents($deployment . '/include.php', '<?php define("APP_DATA_FOLDER_PATH", ' . var_export($appData . '/', true) . ');');
	file_put_contents($privateData . '/configs/application.ini', "[cache]\npath = " . var_export($cliCache, true) . "\n");
	$cliOldAttachment = $privateData . '/storage/cli.example/main/.files/old';
	$cliFreshAttachment = $privateData . '/storage/cli.example/main/.files/fresh';
	$cliOldCache = $cliCache . '/old';
	$cliNow = time();
	fileAt($cliOldAttachment, $cliNow - 172801);
	fileAt($cliFreshAttachment, $cliNow - 172800 + 60);
	fileAt($cliOldCache, $cliNow - 172801);

	mkdir($privateData . '/maintenance', 0700, true);
	$cliLock = new Lock($privateData . '/maintenance/run.lock');
	check($cliLock->acquire(), 'CLI fixture lock acquisition failed');
	$commandResult = runCommand(array(PHP_BINARY, $deployment . '/cli/maintenance.php'));
	$cliResult = decodeJsonResult($commandResult);
	check(0 === $commandResult['exit'] && 'locked' === $cliResult['status'], 'CLI did not honor the shared lock: ' . $commandResult['stderr']);
	check(1 === $cliResult['lock_skips'] && file_exists($cliOldAttachment) && file_exists($cliOldCache), 'locked CLI still cleaned files');
	$cliLock->release();

	$commandResult = runCommand(array(PHP_BINARY, $deployment . '/cli/maintenance.php'));
	$cliResult = decodeJsonResult($commandResult);
	check(0 === $commandResult['exit'] && 'ok' === $cliResult['status'], 'CLI maintenance failed: ' . $commandResult['stderr']);
	check(2 === $cliResult['deleted'], 'CLI did not use configured private-data and cache roots');
	check(!file_exists($cliOldAttachment) && file_exists($cliFreshAttachment), 'CLI attachment retention failed');
	check(!file_exists($cliOldCache), 'CLI configured cache cleanup failed');
	check(is_file($privateData . '/maintenance/state.json'), 'CLI did not persist independent job state');
	check(!str_contains($commandResult['stdout'], $root) && !str_contains($commandResult['stdout'], 'cli.example'), 'CLI JSON exposed paths or account names');

	removeTree($privateData . '/maintenance');
	file_put_contents($privateData . '/maintenance', 'not a directory');
	$commandResult = runCommand(array(PHP_BINARY, $deployment . '/cli/maintenance.php'));
	$cliResult = decodeJsonResult($commandResult);
	check(0 !== $commandResult['exit'] && 'error' === $cliResult['status'] && 0 < $cliResult['failures'], 'CLI error did not produce JSON and a nonzero exit');

	echo 'maintenance: ok (' . $assertions . " assertions)\n";
	if (!$symlinkTested) {
		echo "maintenance: symlink fixture skipped (platform restriction)\n";
	}
	if (!$fifoTested) {
		echo "maintenance: FIFO fixture skipped (platform restriction)\n";
	}
} finally {
	removeTree($root);
}
