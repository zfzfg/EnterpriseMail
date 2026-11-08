<?php

// Temporary acceptance fixture mounted into an isolated release container.
// It is not part of the application image and must never be deployed.

header('Content-Type: application/json');
header('Cache-Control: no-store');

function opcacheSnapshot(): array
{
	$status = opcache_get_status(false);
	if (!is_array($status)) {
		throw new RuntimeException('OPcache status is unavailable');
	}
	return array(
		'php' => PHP_VERSION,
		'config' => array(
			'memory_consumption_mb' => (int) ini_get('opcache.memory_consumption'),
			'max_accelerated_files' => (int) ini_get('opcache.max_accelerated_files'),
			'validate_timestamps' => (bool) ini_get('opcache.validate_timestamps'),
			'revalidate_freq_seconds' => (int) ini_get('opcache.revalidate_freq'),
			'file_update_protection_seconds' => (int) ini_get('opcache.file_update_protection'),
			'save_comments' => (bool) ini_get('opcache.save_comments')
		),
		'memory_usage' => $status['memory_usage'],
		'opcache_statistics' => $status['opcache_statistics'],
		'interned_strings_usage' => $status['interned_strings_usage'] ?? null,
		'cache_full' => $status['cache_full'],
		'restart_pending' => $status['restart_pending'],
		'restart_in_progress' => $status['restart_in_progress']
	);
}

function respond(array $result): void
{
	echo json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR), "\n";
	exit;
}

$action = $_GET['action'] ?? 'status';
$fixture = '/snappymail/opcache-invalidation.php';

if ('warm' === $action) {
	set_time_limit(120);
	$files = array();
	$discovered = array();
	$nonProduction = 0;
	foreach (array('/snappymail', '/plugins') as $root) {
		$discovered[$root] = 0;
		// PHP's recursive iterator omits selected Predis directories on Docker
		// Desktop Windows bind mounts. BusyBox find exposes the complete mount.
		$command = 'find ' . escapeshellarg($root) . ' -type f -name ' . escapeshellarg('*.php') . ' -print';
		$paths = explode("\n", trim((string) shell_exec($command)));
		foreach ($paths as $path) {
			if ('' === $path) {
				continue;
			}
			if (preg_match('#/(?:dev|tests?)/#i', $path)) {
				++$nonProduction;
				continue;
			}
			$files[] = $path;
			++$discovered[$root];
		}
	}
	$uniqueFiles = array_unique($files);
	sort($uniqueFiles, SORT_STRING);
	$compiled = 0;
	$failed = 0;
	$cached = opcache_get_status(true)['scripts'];
	foreach ($uniqueFiles as $file) {
		if (isset($cached[$file]) || @opcache_compile_file($file)) {
			++$compiled;
		} else {
			++$failed;
		}
	}
	respond(array('compiled' => $compiled, 'failed' => $failed, 'discovered' => $discovered,
		'unique_files' => count($uniqueFiles), 'non_production_excluded' => $nonProduction,
		'status' => opcacheSnapshot()));
}

if ('script' === $action) {
	$status = opcache_get_status(true);
	$script = $status['scripts'][$fixture] ?? null;
	respond(array('cached' => is_array($script), 'script' => is_array($script) ? array(
		'hits' => $script['hits'],
		'timestamp' => $script['timestamp'],
		'last_used' => $script['last_used']
	) : null));
}

if ('invalidate' === $action) {
	respond(array('invalidated' => opcache_invalidate($fixture, true)));
}

respond(opcacheSnapshot());
