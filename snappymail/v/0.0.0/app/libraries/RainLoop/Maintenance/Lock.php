<?php

namespace RainLoop\Maintenance;

/** Nonblocking, process-local handle for the shared maintenance flock. */
class Lock
{
	private string $sPath;

	/** @var resource|null */
	private $rHandle = null;

	private bool $bWouldBlock = false;

	public function __construct(string $sPath)
	{
		$this->sPath = $sPath;
	}

	public function acquire(): bool
	{
		$this->bWouldBlock = false;
		if (\is_resource($this->rHandle)) {
			return true;
		}

		$aStat = @\lstat($this->sPath);
		if (false !== $aStat && 0100000 !== ((int) $aStat['mode'] & 0170000)) {
			return false;
		}

		$rHandle = @\fopen($this->sPath, 'c');
		if (false === $rHandle) {
			return false;
		}

		$bWouldBlock = false;
		if (!@\flock($rHandle, \LOCK_EX | \LOCK_NB, $bWouldBlock)) {
			$this->bWouldBlock = $bWouldBlock;
			@\fclose($rHandle);
			return false;
		}

		$aStat = @\lstat($this->sPath);
		$aOpenStat = @\fstat($rHandle);
		if (false === $aStat || false === $aOpenStat
		 || 0100000 !== ((int) $aStat['mode'] & 0170000)
		 || (int) $aStat['dev'] !== (int) $aOpenStat['dev']
		 || (int) $aStat['ino'] !== (int) $aOpenStat['ino']) {
			@\flock($rHandle, \LOCK_UN);
			@\fclose($rHandle);
			return false;
		}

		$this->rHandle = $rHandle;
		return true;
	}

	public function wouldBlock(): bool
	{
		return $this->bWouldBlock;
	}

	public function release(): void
	{
		if (\is_resource($this->rHandle)) {
			@\flock($this->rHandle, \LOCK_UN);
			@\fclose($this->rHandle);
		}
		$this->rHandle = null;
	}

	public function __destruct()
	{
		$this->release();
	}
}
