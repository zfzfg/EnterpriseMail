<?php

namespace AiCopilot;

/**
 * OpenAI-kompatibler Chat-Client fuer Mistral und llmster/LM Studio.
 *
 * - zai-* Modelle: reasoning_effort=low, content kann als Liste mit
 *   Thinking-Bloecken kommen, es werden nur die Textteile behalten
 *   (gleiche Logik wie mistral-chat-proxy/proxy.py).
 * - Lokale Reasoning-Modelle: <think>...</think> wird entfernt.
 * - Keys und Inhalte werden nie geloggt.
 */
class LlmClient
{
	public const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
	public const MAX_STREAM_BYTES = 4 * 1024 * 1024;
	public const MAX_TEXT_BYTES = 1024 * 1024;
	/** Shared by the JSON, PHP streaming and Rust streaming paths of a draft. */
	public const DRAFT_OPTIONS = ['temperature' => 0.4, 'max_tokens' => 1500];

	private string $baseUrl;
	private string $model;
	private string $apiKey;
	private int $timeout;
	private string $jsonMode;
	private string $profileName;
	private ?\Closure $fTransport;

	public function __construct(string $profileName, array $profile, ?callable $fTransport = null)
	{
		$this->profileName = $profileName;
		$this->baseUrl = \rtrim((string) ($profile['base_url'] ?? ''), '/');
		$this->model = (string) ($profile['model'] ?? '');
		$this->apiKey = (string) ($profile['api_key'] ?? '');
		$this->timeout = \max(5, (int) ($profile['timeout'] ?? 90));
		$this->jsonMode = (string) ($profile['json_mode'] ?? 'json_object');
		$this->fTransport = $fTransport ? \Closure::fromCallable($fTransport) : null;
		if (!\preg_match('#^https?://#i', $this->baseUrl)) {
			throw new LlmException('Für das Profil „' . $profileName . '“ ist keine gültige Base-URL eingetragen.', 0, 'provider_not_configured');
		}
		if (!$this->model) {
			throw new LlmException('Für das Profil „' . $profileName . '“ ist kein Modell eingetragen.', 0, 'provider_not_configured');
		}
	}

	public function profileName(): string
	{
		return $this->profileName;
	}

	public function model(): string
	{
		return $this->model;
	}

	/** Internal transient preparation data; the caller must never log or cache the result. */
	public function rustPreparation(bool $bAllowLocalProvider): array
	{
		$aOptions = static::DRAFT_OPTIONS;
		if (\str_starts_with($this->model, 'zai-')) {
			$aOptions['reasoning_effort'] = 'low';
		}
		$iTotalMs = $this->timeout * 1000;
		return [
			'provider_url' => $this->baseUrl . '/chat/completions',
			'api_key' => $this->apiKey,
			'model' => $this->model,
			'allow_local_provider' => $bAllowLocalProvider,
			'options' => $aOptions,
			'timeouts' => [
				'connect_ms' => 10000,
				'idle_ms' => \min(30000, $iTotalMs),
				'total_ms' => $iTotalMs
			]
		];
	}

	/**
	 * Entfernt Thinking: Liste -> nur type=text, <think> Bloecke weg.
	 */
	public static function flatten(mixed $content): string
	{
		if (\is_array($content)) {
			$text = '';
			foreach ($content as $part) {
				if (\is_array($part) && 'text' === ($part['type'] ?? '') && isset($part['text']) && \is_string($part['text'])) {
					$text .= $part['text'];
				}
			}
			$content = $text;
		}
		$content = (string) $content;
		$content = \preg_replace('#<think>.*?</think>#su', '', $content);
		// offener think-Block ohne Ende (abgeschnitten)
		$content = \preg_replace('#<think>.*$#su', '', $content);
		return \trim($content);
	}

	private function buildPayload(array $messages, array $opts, bool $stream): array
	{
		$payload = [
			'model' => $this->model,
			'messages' => $messages,
			'temperature' => $opts['temperature'] ?? 0.3,
			'stream' => $stream
		];
		if (!empty($opts['max_tokens'])) {
			$payload['max_tokens'] = (int) $opts['max_tokens'];
		}
		if (\str_starts_with($this->model, 'zai-')) {
			$payload['reasoning_effort'] = 'low';
		}
		if (!empty($opts['json']) && 'json_object' === $this->jsonMode) {
			$payload['response_format'] = ['type' => 'json_object'];
		}
		return $payload;
	}

	/** A dispatched generation is never retried automatically. */
	private function curl(array $payload, ?callable $writeFn = null): array
	{
		if ($this->fTransport) {
			$aResult = ($this->fTransport)($payload, $writeFn);
			if (!\is_array($aResult) || !isset($aResult[0]) || !\is_string($aResult[1] ?? null)) {
				throw new LlmException('Ungültige Testtransport-Antwort.', 500, 'internal_error');
			}
			if (200 !== (int) $aResult[0]) {
				throw new LlmException(static::httpErrorText((int) $aResult[0], $aResult[1], $this->profileName), (int) $aResult[0], 'upstream_http');
			}
			if (!$writeFn && \strlen($aResult[1]) > static::MAX_RESPONSE_BYTES) {
				throw new LlmException('Die Antwort des Anbieters überschreitet das Größenlimit.', 502, 'upstream_too_large');
			}
			return $aResult;
		}
		return $this->curlOnce($payload, $writeFn);
	}

	private function curlOnce(array $payload, ?callable $writeFn = null): array
	{
		if (!\function_exists('curl_init')) {
			throw new LlmException('PHP-Erweiterung curl fehlt.', 0, 'provider_unavailable');
		}
		$c = \curl_init($this->baseUrl . '/chat/completions');
		if (false === $c) {
			throw new LlmException('Der Anbieter-Client konnte nicht gestartet werden.', 500, 'provider_unavailable');
		}
		$headers = [
			'Content-Type: application/json',
			'Accept: ' . ($writeFn ? 'text/event-stream' : 'application/json')
		];
		if ($this->apiKey) {
			$headers[] = 'Authorization: Bearer ' . $this->apiKey;
		}
		$body = '';
		$bResponseTooLarge = false;
		\curl_setopt_array($c, [
			CURLOPT_POST => true,
			CURLOPT_POSTFIELDS => \json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE),
			CURLOPT_HTTPHEADER => $headers,
			CURLOPT_CONNECTTIMEOUT => 10,
			CURLOPT_TIMEOUT => $this->timeout,
			CURLOPT_SSL_VERIFYPEER => true,
			CURLOPT_SSL_VERIFYHOST => 2,
			CURLOPT_FOLLOWLOCATION => false,
			CURLOPT_USERAGENT => 'SnappyMail-AiCopilot',
			CURLOPT_WRITEFUNCTION => function ($ch, string $chunk) use (&$body, &$bResponseTooLarge, $writeFn) {
				$code = (int) \curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
				if ($writeFn && 200 === $code) {
					if (\connection_aborted()) {
						return 0;
					}
					$writeFn($chunk);
					return \strlen($chunk);
				}
				$iLimit = !$writeFn && 200 === $code ? static::MAX_RESPONSE_BYTES : 65536;
				$iRemaining = \max(0, $iLimit - \strlen($body));
				$body .= \substr($chunk, 0, $iRemaining);
				if (!$writeFn && 200 === $code && \strlen($chunk) > $iRemaining) {
					$bResponseTooLarge = true;
					return 0;
				}
				return \strlen($chunk);
			}
		]);
		if (\defined('CURLOPT_NOSIGNAL')) {
			\curl_setopt($c, CURLOPT_NOSIGNAL, true);
		}
		try {
			$ok = \curl_exec($c);
			$code = (int) \curl_getinfo($c, CURLINFO_RESPONSE_CODE);
			$errno = \curl_errno($c);
		} finally {
			\curl_close($c);
		}

		if (false === $ok || $errno) {
			if ($writeFn && \connection_aborted()) {
				throw new LlmException('Die Client-Verbindung wurde beendet.', 499, 'client_disconnected');
			}
			if ($bResponseTooLarge) {
				throw new LlmException('Die Antwort des Anbieters überschreitet das Größenlimit.', 502, 'upstream_too_large');
			}
			if (CURLE_OPERATION_TIMEDOUT === $errno) {
				throw new LlmException('Zeitüberschreitung bei „' . $this->profileName . '“ (' . $this->timeout . ' s).', 504, 'upstream_timeout');
			}
			throw new LlmException('„' . $this->profileName . '“ ist nicht erreichbar.', 502, 'upstream_unavailable');
		}
		if (200 !== $code) {
			throw new LlmException(static::httpErrorText($code, $body, $this->profileName), $code, 'upstream_http');
		}
		return [$code, $body];
	}

	public static function httpErrorText(int $code, string $body, string $profile): string
	{
		switch ($code) {
			case 401:
			case 403:
				$text = 'API-Key ungültig oder fehlt';
				break;
			case 404:
				$text = 'Modell oder Endpunkt nicht gefunden';
				break;
			case 413:
				$text = 'Anfrage zu groß';
				break;
			case 429:
				$text = 'Zu viele Anfragen oder Kontingent erschöpft, bitte kurz warten';
				break;
			default:
				$text = $code >= 500 ? 'Fehler beim Anbieter' : 'Anfrage abgelehnt';
		}
		return "{$profile}: {$text} (HTTP {$code})";
	}

	/**
	 * @return string Antworttext ohne Thinking
	 */
	public function chat(array $messages, array $opts = []): string
	{
		[, $body] = $this->curl($this->buildPayload($messages, $opts, false));
		$json = \json_decode($body, true);
		if (!\is_array($json) || !isset($json['choices'][0]['message'])) {
			throw new LlmException('Unerwartete Antwort von „' . $this->profileName . '“.', 502, 'upstream_unexpected');
		}
		return static::flatten($json['choices'][0]['message']['content'] ?? '');
	}

	/** Erwartet ein JSON-Objekt; eine Generation wird nicht erneut abgesetzt. */
	public function chatJson(array $messages, array $opts = []): array
	{
		$opts['json'] = true;
		$data = static::extractJson($this->chat($messages, $opts));
		if (null === $data) {
			throw new LlmException('Das Modell hat kein gültiges JSON geliefert.', 502, 'upstream_malformed_json');
		}
		return $data;
	}

	public static function extractJson(string $text): ?array
	{
		$text = \trim($text);
		if (\preg_match('#```(?:json)?\s*(.+?)```#su', $text, $m)) {
			$text = \trim($m[1]);
		}
		$data = \json_decode($text, true);
		if (\is_array($data)) {
			return $data;
		}
		$start = \strpos($text, '{');
		$end = \strrpos($text, '}');
		if (false !== $start && false !== $end && $end > $start) {
			$data = \json_decode(\substr($text, $start, $end - $start + 1), true);
			if (\is_array($data)) {
				return $data;
			}
		}
		return null;
	}

	/**
	 * Streamt die Antwort. $onDelta bekommt nur Text (ohne Thinking).
	 * @return string kompletter Text
	 */
	public function stream(array $messages, callable $onDelta, array $opts = []): string
	{
		$oFilter = new ReasoningFilter();
		$sFull = '';
		$deliver = function (string $sOut) use (&$sFull, $onDelta): void {
			if ('' === $sOut) {
				return;
			}
			if ('' === $sFull) {
				$sOut = \ltrim($sOut);
				if ('' === $sOut) {
					return;
				}
			}
			if (\strlen($sFull) + \strlen($sOut) > static::MAX_TEXT_BYTES) {
				throw new LlmException('Die Antwort des Anbieters überschreitet das Größenlimit.', 502, 'upstream_too_large');
			}
			$sFull .= $sOut;
			$onDelta($sOut);
		};
		$oParser = new SseParser(function (string $sText) use ($oFilter, $deliver): void {
			$deliver($oFilter->push($sText));
		});
		$iUpstreamBytes = 0;
		$this->curl($this->buildPayload($messages, $opts, true), function (string $sChunk) use (&$iUpstreamBytes, $oParser): void {
			if (\connection_aborted()) {
				throw new LlmException('Die Client-Verbindung wurde beendet.', 499, 'client_disconnected');
			}
			$iUpstreamBytes += \strlen($sChunk);
			if ($iUpstreamBytes > static::MAX_STREAM_BYTES) {
				throw new LlmException('Die Antwort des Anbieters überschreitet das Größenlimit.', 502, 'upstream_too_large');
			}
			$oParser->push($sChunk);
		});
		$oParser->finish();
		$deliver($oFilter->finish());
		return \trim($sFull);
	}
}
