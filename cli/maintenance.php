#!/usr/bin/php
<?php

/**
 * Run one maintenance pass for an existing SnappyMail installation.
 *
 * Use the same unprivileged UID/GID that owns the configured private data
 * (normally www-data), never root or sudo. The command obtains that data root
 * from the installation's normal include.php configuration; it has no path
 * override and leaves SQLite databases and their state files untouched.
 *
 *   php cli/maintenance.php
 *   php cli/maintenance.php --domain=example.com  # MULTIDOMAIN installations
 *
 * Host cron example (adapt the local paths and data-owning account):
 *   17 * * * * www-data /usr/bin/php /srv/snappymail/cli/maintenance.php
 *
 * Stdout is one JSON object containing aggregate counters and job states only.
 * Exit status is 1 for errors and 0 for completed, waiting, or lock-skipped runs.
 */

$emitError = static function(): void
{
	echo '{"status":"error","failures":1}', "\n";
	exit(1);
};

// PHP warnings must not corrupt the machine-readable aggregate response.
\ini_set('display_errors', '0');

if ('cli' !== \PHP_SAPI) {
	$emitError();
}

if (\function_exists('posix_geteuid')) {
	if (0 === \posix_geteuid()) {
		$emitError();
	}
} elseif ('Windows' !== \PHP_OS_FAMILY) {
	// Refuse to run when a Unix process identity cannot be verified.
	$emitError();
}

$sDomain = null;
foreach (\array_slice($argv, 1) as $sArgument) {
	if (\str_starts_with($sArgument, '--domain=')) {
		$sDomain = \substr($sArgument, 9);
		if (!\preg_match('/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]+)?$/i', $sDomain)) {
			$emitError();
		}
	} else {
		$emitError();
	}
}

try {
	$sRootPath = \dirname(__DIR__) . \DIRECTORY_SEPARATOR;

	// Load only the installation configuration first. This lets MULTIDOMAIN
	// select its configured data root deliberately instead of using a CLI host.
	$sCustomInclude = $sRootPath . 'include.php';
	if (\is_file($sCustomInclude)) {
		require_once $sCustomInclude;
	}
	if (\defined('MULTIDOMAIN') && \MULTIDOMAIN) {
		if (null === $sDomain) {
			$emitError();
		}
		$_SERVER['HTTP_HOST'] = $_SERVER['SERVER_NAME'] = $sDomain;
	} elseif (null !== $sDomain) {
		$emitError();
	}

	$_ENV['SNAPPYMAIL_INCLUDE_AS_API'] = '1';
	require $sRootPath . 'index.php';

	if (\function_exists('posix_geteuid')) {
		$iOwner = @\fileowner(\APP_PRIVATE_DATA);
		if (false === $iOwner || \posix_geteuid() !== $iOwner) {
			$emitError();
		}
	}

	$oActions = \RainLoop\Api::Actions();
	$sCachePath = \RainLoop\Maintenance\Service::configuredCachePath($oActions->Config(), $oActions->Cacher());
	$aResult = (new \RainLoop\Maintenance\Service(\APP_PRIVATE_DATA, $sCachePath))->run();
	$sJson = \json_encode($aResult, \JSON_UNESCAPED_SLASHES);
	if (!\is_string($sJson)) {
		$emitError();
	}
	echo $sJson, "\n";
	exit('error' === $aResult['status'] ? 1 : 0);
} catch (\Throwable $oException) {
	$emitError();
}
