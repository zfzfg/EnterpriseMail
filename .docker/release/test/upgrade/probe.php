<?php

declare(strict_types=1);

header('Content-Type: application/json');
header('Cache-Control: no-store');

$index = file_get_contents('/snappymail/index.php');
if (false === $index || !preg_match("/define\\('APP_VERSION', '([^']+)'\\)/", $index, $match)) {
	http_response_code(500);
	echo json_encode(['error' => 'version unavailable']);
	exit;
}

$version = $match[1];
$status = function_exists('opcache_get_status') ? opcache_get_status() : false;
$scripts = is_array($status) && isset($status['scripts']) ? $status['scripts'] : [];
$versions = [];
foreach ($scripts as $path => $script) {
	if (preg_match('@^/snappymail/snappymail/v/([^/]+)/@', $path, $versionMatch)) {
		$versions[$versionMatch[1]] = true;
	}
}
$versions = array_keys($versions);
sort($versions);

echo json_encode([
	'version' => $version,
	'php' => PHP_VERSION,
	'opcache' => [
		'enabled' => (bool) filter_var(ini_get('opcache.enable'), FILTER_VALIDATE_BOOL),
		'validate_timestamps' => (bool) filter_var(ini_get('opcache.validate_timestamps'), FILTER_VALIDATE_BOOL),
		'start_time' => is_array($status) ? $status['opcache_statistics']['start_time'] : 0,
		'root_index_cached' => isset($scripts['/snappymail/index.php']),
		'version_index_cached' => isset($scripts["/snappymail/snappymail/v/{$version}/index.php"]),
		'cached_versions' => $versions,
		'oom_restarts' => is_array($status) ? $status['opcache_statistics']['oom_restarts'] : -1,
		'hash_restarts' => is_array($status) ? $status['opcache_statistics']['hash_restarts'] : -1,
		'manual_restarts' => is_array($status) ? $status['opcache_statistics']['manual_restarts'] : -1,
	],
], JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT), "\n";
