<?php

namespace AiCopilot;

/** Legacy downstream SSE wire format. */
final class SseEvent
{
	public static function format(string $sEvent, array $aData): string
	{
		if (!\preg_match('/^[a-z][a-z0-9_-]*$/', $sEvent)) {
			throw new LlmException('Ungültiges SSE-Ereignis.', 500, 'internal_error');
		}
		return "event: {$sEvent}\ndata: "
			. \json_encode($aData, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE) . "\n\n";
	}
}
