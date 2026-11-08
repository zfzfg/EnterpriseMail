<?php

namespace RainLoop\Maintenance;

/**
 * Age-based cleanup for one explicitly allowlisted directory.
 * Only regular files are candidates; the root itself is never removed.
 */
class FileCleaner
{
	public function clean(string $sRoot, int $iRetention, int $iNow): array
	{
		$aResult = self::metrics();
		$sRoot = \rtrim(\trim($sRoot), '\\/');
		if ('' === $sRoot || 0 > $iRetention || \preg_match('/^[a-z]:$/i', $sRoot)) {
			$aResult['failures'] = 1;
			return $aResult;
		}

		$aStat = @\lstat($sRoot);
		if (false === $aStat) {
			// Missing roots are normal until an account uses the feature.
			return $aResult;
		}
		if (!self::isDirectory($aStat) || self::isLink($aStat)) {
			$aResult['skipped'] = 1;
			return $aResult;
		}

		$iCutoff = $iNow - $iRetention;
		$aStack = array(array($sRoot, false));
		while ($aStack) {
			list($sPath, $bPostOrder) = \array_pop($aStack);
			$aStat = @\lstat($sPath);
			if (false === $aStat) {
				// The owner or another process removed it during the scan.
				continue;
			}

			if (self::isLink($aStat)) {
				++$aResult['skipped'];
				continue;
			}

			if (self::isDirectory($aStat)) {
				if ($bPostOrder) {
					if ($sPath === $sRoot) {
						continue;
					}
					if (@\rmdir($sPath)) {
						++$aResult['directories'];
						continue;
					}
					$aCurrent = @\lstat($sPath);
					if (false === $aCurrent || !self::isDirectory($aCurrent) || self::isLink($aCurrent)) {
						continue;
					}
					$aEntries = @\scandir($sPath);
					// A newly populated directory is active, not a cleanup failure.
					if (\is_array($aEntries) && 2 < \count($aEntries)) {
						continue;
					}
					++$aResult['failures'];
					continue;
				}

				$aEntries = @\scandir($sPath);
				if (false === $aEntries) {
					++$aResult['failures'];
					continue;
				}
				$aStack[] = array($sPath, true);
				foreach ($aEntries as $sEntry) {
					if ('.' !== $sEntry && '..' !== $sEntry) {
						$aStack[] = array($sPath . '/' . $sEntry, false);
					}
				}
				continue;
			}

			if (!self::isRegular($aStat)) {
				++$aResult['skipped'];
				continue;
			}

			++$aResult['scanned'];
			if (self::isSQLiteState($sPath) || (int) $aStat['mtime'] >= $iCutoff) {
				++$aResult['skipped'];
				continue;
			}

			// Recheck identity, type and age immediately before unlinking.
			$aCurrent = @\lstat($sPath);
			if (false === $aCurrent) {
				continue;
			}
			if (!self::isRegular($aCurrent) || self::isLink($aCurrent)
			 || !self::sameFile($aStat, $aCurrent)
			 || (int) $aCurrent['mtime'] >= $iCutoff
			 || self::isSQLiteState($sPath)) {
				++$aResult['skipped'];
				continue;
			}

			if (@\unlink($sPath)) {
				++$aResult['deleted'];
				$aResult['bytes'] += \max(0, (int) $aCurrent['size']);
			} elseif (false !== @\lstat($sPath)) {
				++$aResult['failures'];
			}
		}

		return $aResult;
	}

	public static function metrics(): array
	{
		return array(
			'scanned' => 0,
			'deleted' => 0,
			'bytes' => 0,
			'directories' => 0,
			'skipped' => 0,
			'failures' => 0
		);
	}

	private static function sameFile(array $aBefore, array $aAfter): bool
	{
		foreach (array('dev', 'ino', 'mode', 'size', 'mtime') as $sKey) {
			if ((int) $aBefore[$sKey] !== (int) $aAfter[$sKey]) {
				return false;
			}
		}
		return true;
	}

	private static function isLink(array $aStat): bool
	{
		return 0120000 === ((int) $aStat['mode'] & 0170000);
	}

	private static function isDirectory(array $aStat): bool
	{
		return 0040000 === ((int) $aStat['mode'] & 0170000);
	}

	private static function isRegular(array $aStat): bool
	{
		return 0100000 === ((int) $aStat['mode'] & 0170000);
	}

	private static function isSQLiteState(string $sPath): bool
	{
		$sName = \strtolower(\basename($sPath));
		return (bool) \preg_match('/\.(?:db3?|s3db|sqlite3?)(?:-(?:wal2?|shm2?|journal|stmtjrnl|mj[0-9a-f]+))?$/', $sName)
			|| (bool) \preg_match('/-(?:wal2?|shm2?|journal|stmtjrnl|mj[0-9a-f]+)$/', $sName);
	}
}
