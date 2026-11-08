<?php

namespace AiCopilot;

/** Bounded incremental parser for OpenAI-compatible upstream SSE. */
final class SseParser
{
	public const MAX_LINE_BYTES = 65536;
	public const MAX_EVENT_BYTES = 262144;

	private \Closure $fOnDelta;
	private string $sBuffer = '';
	private array $aDataLines = [];
	private int $iDataBytes = 0;
	private bool $bCompleted = false;

	public function __construct(callable $fOnDelta)
	{
		$this->fOnDelta = \Closure::fromCallable($fOnDelta);
	}

	public function push(string $sChunk): void
	{
		if ($this->bCompleted) {
			return;
		}
		$iOffset = 0;
		$iLength = \strlen($sChunk);
		while ($iOffset < $iLength) {
			$iPos = \strpos($sChunk, "\n", $iOffset);
			if (false === $iPos) {
				$this->append(\substr($sChunk, $iOffset));
				return;
			}
			$this->append(\substr($sChunk, $iOffset, $iPos - $iOffset));
			$this->consumeLine(\rtrim($this->sBuffer, "\r"));
			$this->sBuffer = '';
			$iOffset = $iPos + 1;
		}
	}

	public function finish(): void
	{
		if (!$this->bCompleted && '' !== $this->sBuffer) {
			$this->consumeLine(\rtrim($this->sBuffer, "\r"));
			$this->sBuffer = '';
		}
		if (!$this->bCompleted && $this->aDataLines) {
			$this->dispatch();
		}
		if (!$this->bCompleted) {
			throw new LlmException('Die Antwort des Anbieters war unvollständig.', 502, 'upstream_incomplete');
		}
	}

	public function completed(): bool
	{
		return $this->bCompleted;
	}

	private function append(string $sPart): void
	{
		if (\strlen($this->sBuffer) + \strlen($sPart) > static::MAX_LINE_BYTES) {
			throw new LlmException('Die Antwort des Anbieters überschreitet das Größenlimit.', 502, 'upstream_too_large');
		}
		$this->sBuffer .= $sPart;
	}

	private function consumeLine(string $sLine): void
	{
		if ('' === $sLine) {
			$this->dispatch();
			return;
		}
		if (':' === $sLine[0]) {
			return;
		}
		if ('data' === $sLine || \str_starts_with($sLine, 'data:')) {
			$sData = 'data' === $sLine ? '' : \substr($sLine, 5);
			if (\str_starts_with($sData, ' ')) {
				$sData = \substr($sData, 1);
			}
			$iBytes = \strlen($sData) + ($this->aDataLines ? 1 : 0);
			if ($this->iDataBytes + $iBytes > static::MAX_EVENT_BYTES) {
				throw new LlmException('Die Antwort des Anbieters überschreitet das Größenlimit.', 502, 'upstream_too_large');
			}
			$this->aDataLines[] = $sData;
			$this->iDataBytes += $iBytes;
		}
	}

	private function dispatch(): void
	{
		if (!$this->aDataLines) {
			return;
		}
		$sData = \implode("\n", $this->aDataLines);
		$this->aDataLines = [];
		$this->iDataBytes = 0;
		if ('' === \trim($sData)) {
			return;
		}
		if ('[DONE]' === \trim($sData)) {
			$this->bCompleted = true;
			return;
		}
		try {
			$aJson = \json_decode($sData, true, 64, JSON_THROW_ON_ERROR);
		} catch (\JsonException $e) {
			throw new LlmException('Der Anbieter hat ungültiges JSON gesendet.', 502, 'upstream_malformed_json');
		}
		if (!\is_array($aJson) || !\str_starts_with(\ltrim($sData), '{')) {
			throw new LlmException('Der Anbieter hat eine ungültige Antwort gesendet.', 502, 'upstream_malformed_json');
		}
		if (\array_key_exists('error', $aJson)) {
			throw new LlmException('Der Anbieter hat den Vorgang abgebrochen.', 502, 'upstream_error');
		}

		$sType = $aJson['type'] ?? '';
		$sStatus = $aJson['status'] ?? '';
		if ((\is_string($sType) && \in_array($sType, ['completed', 'response.completed'], true))
			|| (\is_string($sStatus) && 'completed' === $sStatus)
			|| true === ($aJson['done'] ?? false)) {
			$this->bCompleted = true;
			return;
		}

		if (!\array_key_exists('choices', $aJson)) {
			return;
		}
		if (!\is_array($aJson['choices'])) {
			throw new LlmException('Der Anbieter hat eine ungültige Antwort gesendet.', 502, 'upstream_malformed_json');
		}
		if (!isset($aJson['choices'][0])) {
			return;
		}
		$aChoice = $aJson['choices'][0];
		if (!\is_array($aChoice) || (isset($aChoice['delta']) && !\is_array($aChoice['delta']))) {
			throw new LlmException('Der Anbieter hat eine ungültige Antwort gesendet.', 502, 'upstream_malformed_json');
		}
		$mContent = $aChoice['delta']['content'] ?? null;
		if (null === $mContent || '' === $mContent) {
			return;
		}
		if (\is_string($mContent)) {
			($this->fOnDelta)($mContent);
			return;
		}
		if (!\is_array($mContent)) {
			throw new LlmException('Der Anbieter hat eine ungültige Antwort gesendet.', 502, 'upstream_malformed_json');
		}
		$sText = '';
		foreach ($mContent as $aPart) {
			if (!\is_array($aPart)) {
				continue;
			}
			if ('text' === ($aPart['type'] ?? '') && isset($aPart['text'])) {
				if (!\is_string($aPart['text'])) {
					throw new LlmException('Der Anbieter hat eine ungültige Antwort gesendet.', 502, 'upstream_malformed_json');
				}
				$sText .= $aPart['text'];
			}
		}
		if ('' !== $sText) {
			($this->fOnDelta)($sText);
		}
	}
}
