<?php

namespace RainLoop\Maintenance;

/**
 * Shared web/CLI maintenance scheduler. All responses contain aggregate
 * counters only: no account names, user content, or filesystem paths.
 */
class Service
{
	public const CACHE_INTERVAL = 82800; // 23 hours
	public const SESSION_INTERVAL = 82800; // 23 hours
	public const SIGN_ME_INTERVAL = 82800; // 23 hours
	public const ATTACHMENT_INTERVAL = 90000; // 25 hours

	public const CACHE_RETENTION = 172800; // 48 hours
	public const SESSION_RETENTION = 10800; // 3 hours
	public const SIGN_ME_RETENTION = 2592000; // 30 days
	public const ATTACHMENT_RETENTION = 172800; // 48 hours

	private const RETRY_BASE = 60;
	private const RETRY_MAX = 3600;

	private string $sDataPath;
	private ?string $sCachePath;
	private FileCleaner $oCleaner;

	/** @var callable */
	private $cClock;

	public function __construct(string $sDataPath, ?string $sCachePath, ?FileCleaner $oCleaner = null, ?callable $cClock = null)
	{
		$this->sDataPath = \rtrim(\trim($sDataPath), '\\/');
		$this->sCachePath = null === $sCachePath ? null : \rtrim(\trim($sCachePath), '\\/');
		$this->oCleaner = $oCleaner ?: new FileCleaner();
		$this->cClock = $cClock ?: static fn(): int => \time();
	}

	public static function configuredCachePath(\RainLoop\Config\Application $oConfig, \MailSo\Cache\CacheClient $oCacher): ?string
	{
		$oDriverProperty = new \ReflectionProperty($oCacher, 'oDriver');
		$oCacheDriver = $oDriverProperty->getValue($oCacher);
		return $oCacheDriver instanceof \MailSo\Cache\Drivers\File
			? (\trim($oConfig->Get('cache', 'path', '')) ?: \APP_PRIVATE_DATA . 'cache')
			: null;
	}

	public function run(): array
	{
		$fStarted = \microtime(true);
		$iNow = (int) \call_user_func($this->cClock);
		$aResult = $this->emptyResult();
		$oLock = null;

		try {
			if (!$this->ensureStateDirectory()) {
				throw new \RuntimeException('Maintenance state unavailable');
			}

			$oLock = new Lock($this->statePath() . '/run.lock');
			if (!$oLock->acquire()) {
				if ($oLock->wouldBlock()) {
					$aResult['status'] = 'locked';
					$aResult['lock_skips'] = 1;
					$aResult['jobs'] = \array_fill_keys(\array_keys($aResult['jobs']), 'skipped');
				} else {
					$aResult['status'] = 'error';
					$aResult['failures'] = 1;
				}
				return $this->finish($aResult, $fStarted);
			}

			$aState = $this->readState();
			foreach ($this->schedules() as $sJob => $iInterval) {
				$aJobState = $this->jobState($aState[$sJob] ?? null);
				if ($iNow < $aJobState['retry_at']
				 || (0 < $aJobState['completed_at'] && $iNow < $aJobState['completed_at'] + $iInterval)) {
					$aResult['jobs'][$sJob] = 'waiting';
					continue;
				}

				$aMetrics = FileCleaner::metrics();
				$bException = false;
				try {
					$aMetrics = $this->runJob($sJob, $iNow);
				} catch (\Throwable $oException) {
					$bException = true;
				}
				$this->mergeMetrics($aResult, $aMetrics);
				if ($bException) {
					++$aResult['failures'];
				}

				if (!$bException && 0 === $aMetrics['failures']) {
					$aJobState['completed_at'] = $iNow;
					$aJobState['failures'] = 0;
					$aJobState['retry_at'] = 0;
					$aState[$sJob] = $aJobState;
					if ($this->writeState($aState)) {
						$aResult['jobs'][$sJob] = 'cache' === $sJob && null === $this->sCachePath ? 'noop' : 'ok';
					} else {
						++$aResult['failures'];
						$aResult['jobs'][$sJob] = 'failed';
					}
					continue;
				}

				// Preserve the previous completion timestamp and only delay retry.
				++$aJobState['failures'];
				$aJobState['retry_at'] = $iNow + $this->retryDelay($aJobState['failures']);
				$aState[$sJob] = $aJobState;
				if (!$this->writeState($aState)) {
					++$aResult['failures'];
				}
				$aResult['jobs'][$sJob] = 'failed';
			}

			if (0 < $aResult['failures']) {
				$aResult['status'] = 'error';
			}
		} catch (\Throwable $oException) {
			$aResult['status'] = 'error';
			++$aResult['failures'];
		} finally {
			$oLock && $oLock->release();
		}

		return $this->finish($aResult, $fStarted);
	}

	private function schedules(): array
	{
		return array(
			'cache' => self::CACHE_INTERVAL,
			'sessions' => self::SESSION_INTERVAL,
			'sign_me' => self::SIGN_ME_INTERVAL,
			'attachments' => self::ATTACHMENT_INTERVAL
		);
	}

	private function runJob(string $sJob, int $iNow): array
	{
		if ('cache' === $sJob && null === $this->sCachePath) {
			// APCu, Redis, Memcache and custom drivers own their retention.
			return FileCleaner::metrics();
		}

		switch ($sJob) {
			case 'cache':
				if (!$this->cachePathIsSafe()) {
					$aMetrics = FileCleaner::metrics();
					$aMetrics['failures'] = 1;
					return $aMetrics;
				}
				return $this->cleanRoots(array($this->sCachePath), self::CACHE_RETENTION, $iNow);
			case 'sessions':
				return $this->cleanRoots($this->storageRoots('.sessions'), self::SESSION_RETENTION, $iNow);
			case 'sign_me':
				return $this->cleanRoots($this->storageRoots('.sign_me'), self::SIGN_ME_RETENTION, $iNow);
			case 'attachments':
				$aRoots = array($this->storagePath() . '/files'); // Legacy layout
				foreach ($this->accountDirectories() as $sAccountPath) {
					$aRoots[] = $sAccountPath . '/.files';
					foreach ($this->childDirectories($sAccountPath) as $sAdditionalPath) {
						$aRoots[] = $sAdditionalPath . '/.files';
					}
				}
				return $this->cleanRoots($aRoots, self::ATTACHMENT_RETENTION, $iNow);
		}
		throw new \RuntimeException('Unknown maintenance job');
	}

	private function cleanRoots(array $aRoots, int $iRetention, int $iNow): array
	{
		$aResult = FileCleaner::metrics();
		foreach (\array_unique($aRoots) as $sRoot) {
			$this->mergeMetrics($aResult, $this->oCleaner->clean((string) $sRoot, $iRetention, $iNow));
		}
		return $aResult;
	}

	private function storageRoots(string $sLeaf): array
	{
		$aRoots = array();
		foreach ($this->accountDirectories() as $sAccountPath) {
			$aRoots[] = $sAccountPath . '/' . $sLeaf;
		}
		return $aRoots;
	}

	private function accountDirectories(): array
	{
		$aResult = array();
		foreach ($this->childDirectories($this->storagePath()) as $sDomainPath) {
			foreach ($this->childDirectories($sDomainPath) as $sAccountPath) {
				$aResult[] = $sAccountPath;
			}
		}
		return $aResult;
	}

	private function childDirectories(string $sPath): array
	{
		$aStat = @\lstat($sPath);
		if (false === $aStat) {
			return array();
		}
		if (0040000 !== ((int) $aStat['mode'] & 0170000)
		 || 0120000 === ((int) $aStat['mode'] & 0170000)) {
			return array();
		}

		$aEntries = @\scandir($sPath);
		if (false === $aEntries) {
			throw new \RuntimeException('Storage scan failed');
		}
		$aResult = array();
		foreach ($aEntries as $sEntry) {
			if ('.' === $sEntry || '..' === $sEntry) {
				continue;
			}
			$sChild = $sPath . '/' . $sEntry;
			$aStat = @\lstat($sChild);
			if (false !== $aStat && 0040000 === ((int) $aStat['mode'] & 0170000)) {
				$aResult[] = $sChild;
			}
		}
		return $aResult;
	}

	private function cachePathIsSafe(): bool
	{
		if (null === $this->sCachePath || '' === $this->sCachePath) {
			return false;
		}
		$sCache = self::normalizePath($this->sCachePath);
		$sData = self::normalizePath($this->sDataPath);
		$sStorage = self::normalizePath($this->storagePath());
		$sTemp = self::normalizePath(\sys_get_temp_dir());
		if ('/' === $sCache || \preg_match('/^[a-z]:$/i', $sCache)
		 || \preg_match('~(?:^|/)\.\.(?:/|$)~', $sCache)) {
			return false;
		}

		// The dedicated cache may live below private data or the system temp
		// directory, but it must never contain those roots or account storage.
		return !self::pathWithin($sData, $sCache)
			&& !self::pathWithin($sCache, $sStorage)
			&& !self::pathWithin($sStorage, $sCache)
			&& !self::pathWithin($sTemp, $sCache);
	}

	private static function normalizePath(string $sPath): string
	{
		return \rtrim(\str_replace('\\', '/', $sPath), '/');
	}

	private static function pathWithin(string $sPath, string $sParent): bool
	{
		if ('' === $sPath || '' === $sParent) {
			return true;
		}
		if ('\\' === \DIRECTORY_SEPARATOR) {
			$sPath = \strtolower($sPath);
			$sParent = \strtolower($sParent);
		}
		return $sPath === $sParent || \str_starts_with($sPath, \rtrim($sParent, '/') . '/');
	}

	private function ensureStateDirectory(): bool
	{
		$sPath = $this->statePath();
		$aStat = @\lstat($sPath);
		if (false !== $aStat) {
			return 0040000 === ((int) $aStat['mode'] & 0170000)
				&& 0120000 !== ((int) $aStat['mode'] & 0170000);
		}
		if (!@\mkdir($sPath, 0700, true)) {
			$aStat = @\lstat($sPath);
			return false !== $aStat && 0040000 === ((int) $aStat['mode'] & 0170000)
				&& 0120000 !== ((int) $aStat['mode'] & 0170000);
		}
		return true;
	}

	private function readState(): array
	{
		$sState = @\file_get_contents($this->statePath() . '/state.json');
		$aState = \is_string($sState) && '' !== $sState ? \json_decode($sState, true) : array();
		return \is_array($aState) ? $aState : array();
	}

	private function writeState(array $aState): bool
	{
		$sState = \json_encode($aState, \JSON_UNESCAPED_SLASHES);
		if (!\is_string($sState)) {
			return false;
		}
		$sPath = $this->statePath() . '/state.json';
		$sTemporary = $sPath . '.tmp';
		if (false === @\file_put_contents($sTemporary, $sState, \LOCK_EX)) {
			return false;
		}
		@\chmod($sTemporary, 0600);
		if (@\rename($sTemporary, $sPath)) {
			return true;
		}
		@\unlink($sTemporary);
		return false;
	}

	private function jobState(mixed $mState): array
	{
		$mState = \is_array($mState) ? $mState : array();
		return array(
			'completed_at' => $this->nonNegativeInt($mState['completed_at'] ?? 0),
			'failures' => $this->nonNegativeInt($mState['failures'] ?? 0),
			'retry_at' => $this->nonNegativeInt($mState['retry_at'] ?? 0)
		);
	}

	private function nonNegativeInt(mixed $mValue): int
	{
		return \is_int($mValue) || (\is_string($mValue) && \ctype_digit($mValue)) ? \max(0, (int) $mValue) : 0;
	}

	private function retryDelay(int $iFailures): int
	{
		$iExponent = \min(10, \max(0, $iFailures - 1));
		return \min(self::RETRY_MAX, self::RETRY_BASE * (1 << $iExponent));
	}

	private function storagePath(): string
	{
		return $this->sDataPath . '/storage';
	}

	private function statePath(): string
	{
		return $this->sDataPath . '/maintenance';
	}

	private function mergeMetrics(array &$aTarget, array $aMetrics): void
	{
		foreach (array('scanned', 'deleted', 'bytes', 'directories', 'skipped', 'failures') as $sKey) {
			$iValue = isset($aMetrics[$sKey]) && \is_numeric($aMetrics[$sKey]) ? (int) $aMetrics[$sKey] : 0;
			$aTarget[$sKey] += \max(0, $iValue);
		}
	}

	private function emptyResult(): array
	{
		return \array_merge(array(
			'status' => 'ok',
			'duration_ms' => 0,
			'lock_skips' => 0,
			'jobs' => array(
				'cache' => 'waiting',
				'sessions' => 'waiting',
				'sign_me' => 'waiting',
				'attachments' => 'waiting'
			)
		), FileCleaner::metrics());
	}

	private function finish(array $aResult, float $fStarted): array
	{
		$aResult['duration_ms'] = \max(0, (int) \round((\microtime(true) - $fStarted) * 1000));
		return $aResult;
	}
}
