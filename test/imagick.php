<?php

// Run in the release image with /etc/ImageMagick-7/policy.xml installed.
// The Docker acceptance runner uses --network none and a 512 MiB memory limit.

use SnappyMail\Image\IMagick;

ini_set('zend.exception_ignore_args', '1');
$assertions = 0;
$diagnostics = '';
$sentinel = 'PRIVATE-IMAGE-SENTINEL-9f27c1';
$log = sys_get_temp_dir() . '/snappymail-imagick-test-' . getmypid() . '.log';

function check(bool $condition, string $message): void
{
	global $assertions;
	++$assertions;
	if (!$condition) {
		throw new RuntimeException($message);
	}
}

function captureDiagnostics(string $output, Throwable $error): void
{
	global $diagnostics;
	$diagnostics .= "\n" . $output . "\n" . $error->getMessage();
}

function assertNoSensitiveData(): void
{
	global $assertions, $diagnostics, $sentinel, $log;
	clearstatcache(true, $log);
	$logged = is_file($log) ? file_get_contents($log) : '';
	check(!str_contains($diagnostics . $logged, $sentinel), 'image content entered diagnostics');
}

function assertRejected(string &$data): void
{
	ob_start();
	try {
		$image = IMagick::createFromString($data);
		$image->clear();
		ob_end_clean();
		throw new RuntimeException('unsafe or malformed image was accepted');
	} catch (InvalidArgumentException $error) {
		$output = ob_get_clean();
		check('Failed to load image' === $error->getMessage(), 'decoder failure exposed its original message');
		check(null === $error->getPrevious(), 'decoder failure retained a sensitive exception chain');
		captureDiagnostics($output, $error);
		assertNoSensitiveData();
	}
}

function assertPolicyDenied(callable $operation): void
{
	ob_start();
	try {
		$operation();
		ob_end_clean();
		throw new RuntimeException('disabled decoder was accepted');
	} catch (ImagickException $error) {
		$output = ob_get_clean();
		$message = strtolower($error->getMessage());
		check(str_contains($message, 'security policy') || str_contains($message, 'failed to read the file'),
			'disabled decoder was not rejected');
		captureDiagnostics($output, $error);
		assertNoSensitiveData();
	}
}

function gdFixture(string $format, int $width = 7, int $height = 5): string
{
	$gd = imagecreatetruecolor($width, $height);
	$transparent = imagecolorallocatealpha($gd, 20, 40, 60, 'GIF' === $format ? 0 : 80);
	imagefill($gd, 0, 0, $transparent);
	if ('GIF' === $format) {
		imagecolortransparent($gd, $transparent);
	} else {
		imagesavealpha($gd, true);
	}
	ob_start();
	switch ($format) {
		case 'JPEG': $result = imagejpeg($gd, null, 85); break;
		case 'PNG': $result = imagepng($gd, null, 9); break;
		case 'GIF': $result = imagegif($gd); break;
		case 'BMP': $result = imagebmp($gd); break;
		default: throw new RuntimeException('unknown fixture format');
	}
	$data = ob_get_clean();
	imagedestroy($gd);
	check($result && is_string($data) && 0 < strlen($data), 'could not create image fixture');
	return $data;
}

function pngChunk(string $type, string $data): string
{
	return pack('N', strlen($data)) . $type . $data . pack('N', crc32($type . $data));
}

function oversizedPng(int $width, int $height, string $sentinel): string
{
	return "\x89PNG\r\n\x1a\n"
		. pngChunk('IHDR', pack('N2CCCCC', $width, $height, 8, 6, 0, 0, 0))
		. pngChunk('tEXt', "Comment\0" . $sentinel)
		. pngChunk('IEND', '');
}

function verifyThumbnail(string &$data, bool $alpha = false): void
{
	$image = IMagick::createFromString($data);
	check($image->valid(), 'valid image did not load');
	check($image->cropThumbnailImage(48, 48), 'thumbnail crop failed');
	check($image->stripImage(), 'metadata stripping failed');
	check($image->setImageFormat('png'), 'PNG output selection failed');
	$blob = $image->getImageBlob();
	check(0 < strlen($blob), 'thumbnail output was empty');
	$output = new Imagick();
	check($output->readImageBlob($blob), 'thumbnail output did not decode');
	check(48 === $output->getImageWidth() && 48 === $output->getImageHeight(), 'thumbnail dimensions were incorrect');
	check('image/png' === $output->getImageMimeType(), 'thumbnail MIME type was incorrect');
	if ($alpha) {
		check($output->getImageAlphaChannel(), 'transparency was not preserved');
	}
	$output->clear();
	$image->clear();
}

function nativePeakBytes(): int
{
	$status = @file_get_contents('/proc/self/status');
	return $status && preg_match('/^VmHWM:\s+(\d+) kB$/m', $status, $match) ? (int) $match[1] * 1024 : 0;
}

if (!extension_loaded('imagick')) {
	echo "imagick: skipped (extension absent)\n";
	exit(0);
}
if (!extension_loaded('gd')) {
	throw new RuntimeException('imagick acceptance fixtures require GD');
}

ini_set('display_errors', '1');
ini_set('log_errors', '1');
ini_set('error_log', $log);
set_error_handler(static function (int $type, string $message) use (&$diagnostics): bool {
	$diagnostics .= "\n" . $message;
	return true;
});

require dirname(__DIR__) . '/snappymail/v/0.0.0/app/libraries/snappymail/image.php';
require dirname(__DIR__) . '/snappymail/v/0.0.0/app/libraries/snappymail/image/imagick.php';

try {
	$resources = array(
		'MEMORY' => 64 * 1024 * 1024,
		'MAP' => 128 * 1024 * 1024,
		'DISK' => 128 * 1024 * 1024,
		'AREA' => 16000000,
		'WIDTH' => 8000,
		'HEIGHT' => 8000,
		'TIME' => 10,
		'THREAD' => 1
	);
	foreach ($resources as $name => $expected) {
		$actual = Imagick::getResourceLimit(constant('Imagick::RESOURCETYPE_' . $name));
		check($expected === (int) $actual, 'ImageMagick resource limit was not effective: ' . $name);
	}
	$policy = shell_exec('magick -list policy 2>&1');
	check(is_string($policy) && str_contains($policy, 'name: list-length') && preg_match('/name: list-length\s+value: 32/', $policy),
		'ImageMagick animation length policy was not effective');

	foreach (array('JPEG', 'PNG', 'GIF', 'BMP') as $format) {
		$data = gdFixture($format);
		verifyThumbnail($data, in_array($format, array('PNG', 'GIF'), true));
	}
	foreach (array('WEBP', 'AVIF') as $format) {
		if (!Imagick::queryFormats($format)) {
			echo 'imagick: ' . $format . " decoder absent in this build\n";
		}
	}

	$malformed = "not an image\n" . $sentinel . "\nAuthorization: Bearer private-token";
	assertRejected($malformed);
	$oversizedWidth = oversizedPng(100000, 100000, $sentinel);
	assertRejected($oversizedWidth);
	$oversizedArea = oversizedPng(5000, 5000, $sentinel);
	assertRejected($oversizedArea);

	$mvg = "push graphic-context\n# " . $sentinel . "\nviewbox 0 0 1 1\npop graphic-context";
	assertPolicyDenied(static function () use ($mvg): void {
		$image = new Imagick();
		$image->setFormat('MVG');
		$image->readImageBlob($mvg);
	});
	$msl = '<!-- ' . $sentinel . ' --><image><read filename="null:" /></image>';
	assertPolicyDenied(static function () use ($msl): void {
		$image = new Imagick();
		$image->setFormat('MSL');
		$image->readImageBlob($msl);
	});
	assertPolicyDenied(static function () use ($sentinel): void {
		$image = new Imagick();
		$image->readImage('HTTPS://127.0.0.1:9/' . $sentinel);
	});

	$large = gdFixture('PNG', 2048, 2048);
	$cpuBefore = getrusage();
	$started = hrtime(true);
	verifyThumbnail($large, true);
	$elapsed = (hrtime(true) - $started) / 1e9;
	$cpuAfter = getrusage();
	$cpu = ($cpuAfter['ru_utime.tv_sec'] - $cpuBefore['ru_utime.tv_sec'])
		+ ($cpuAfter['ru_utime.tv_usec'] - $cpuBefore['ru_utime.tv_usec']) / 1e6
		+ ($cpuAfter['ru_stime.tv_sec'] - $cpuBefore['ru_stime.tv_sec'])
		+ ($cpuAfter['ru_stime.tv_usec'] - $cpuBefore['ru_stime.tv_usec']) / 1e6;
	check(15 > $elapsed, 'large image exceeded the acceptance deadline');
	assertNoSensitiveData();

	echo 'imagick: ok (' . $assertions . " assertions)\n";
	echo 'imagick: large_png_native_peak_bytes=' . nativePeakBytes()
		. ' cpu_seconds=' . number_format($cpu, 3, '.', '')
		. ' elapsed_seconds=' . number_format($elapsed, 3, '.', '') . "\n";
} finally {
	restore_error_handler();
	$diagnostics .= is_file($log) ? file_get_contents($log) : '';
	check(!str_contains($diagnostics, $sentinel), 'image content entered final diagnostics');
	@unlink($log);
}
