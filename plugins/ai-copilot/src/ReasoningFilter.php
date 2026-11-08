<?php

namespace AiCopilot;

/** Incrementally removes think blocks without leaking split opening tags. */
final class ReasoningFilter
{
	private bool $bInThink = false;
	private string $sPending = '';

	public function push(string $sText): string
	{
		$sText = $this->sPending . $sText;
		$this->sPending = '';
		$sOut = '';
		while ('' !== $sText) {
			$sTag = $this->bInThink ? '</think>' : '<think>';
			$iPos = \strpos($sText, $sTag);
			if (false === $iPos) {
				$iKeep = static::partialTagSuffix($sText, $sTag);
				$iSafe = \strlen($sText) - $iKeep;
				if (!$this->bInThink && $iSafe > 0) {
					$sOut .= \substr($sText, 0, $iSafe);
				}
				$this->sPending = $iKeep ? \substr($sText, -$iKeep) : '';
				break;
			}
			if (!$this->bInThink && $iPos > 0) {
				$sOut .= \substr($sText, 0, $iPos);
			}
			$sText = \substr($sText, $iPos + \strlen($sTag));
			$this->bInThink = !$this->bInThink;
		}
		return $sOut;
	}

	public function finish(): string
	{
		$sOut = $this->bInThink ? '' : $this->sPending;
		$this->sPending = '';
		return $sOut;
	}

	private static function partialTagSuffix(string $sText, string $sTag): int
	{
		$iMax = \min(\strlen($sText), \strlen($sTag) - 1);
		for ($i = $iMax; $i > 0; --$i) {
			if (\substr($sText, -$i) === \substr($sTag, 0, $i)) {
				return $i;
			}
		}
		return 0;
	}
}
