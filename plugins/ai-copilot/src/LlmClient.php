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
	private string $baseUrl;
	private string $model;
	private string $apiKey;
	private int $timeout;
	private string $jsonMode;
	private string $profileName;

	public function __construct(string $profileName, array $profile)
	{
		$this->profileName = $profileName;
		$this->baseUrl = \rtrim((string) ($profile['base_url'] ?? ''), '/');
		$this->model = (string) ($profile['model'] ?? '');
		$this->apiKey = (string) ($profile['api_key'] ?? '');
		$this->timeout = \max(5, (int) ($profile['timeout'] ?? 90));
		$this->jsonMode = (string) ($profile['json_mode'] ?? 'json_object');
		if (!\preg_match('#^https?://#i', $this->baseUrl)) {
			throw new LlmException('Für das Profil „' . $profileName . '“ ist keine gültige Base-URL eingetragen.', 0);
		}
		if (!$this->model) {
			throw new LlmException('Für das Profil „' . $profileName . '“ ist kein Modell eingetragen.', 0);
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

	/**
	 * Mit Wiederholung bei Ueberlast (429/502/503), bis zu 2 weitere Versuche.
	 */
	private function curl(array $payload, ?callable $writeFn = null): array
	{
		for ($i = 0; ; ++$i) {
			try {
				return $this->curlOnce($payload, $writeFn);
			} catch (LlmException $e) {
				if ($i >= 2 || !\in_array($e->getCode(), [429, 502, 503], true)) {
					throw $e;
				}
				\sleep(2 * ($i + 1));
			}
		}
	}

	private function curlOnce(array $payload, ?callable $writeFn = null): array
	{
		if (!\function_exists('curl_init')) {
			throw new LlmException('PHP-Erweiterung curl fehlt.', 0);
		}
		$c = \curl_init($this->baseUrl . '/chat/completions');
		$headers = [
			'Content-Type: application/json',
			'Accept: ' . ($writeFn ? 'text/event-stream' : 'application/json')
		];
		if ($this->apiKey) {
			$headers[] = 'Authorization: Bearer ' . $this->apiKey;
		}
		$body = '';
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
			CURLOPT_WRITEFUNCTION => function ($ch, string $chunk) use (&$body, $writeFn) {
				$code = (int) \curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
				if ($writeFn && 200 === $code) {
					$writeFn($chunk);
				} else if (\strlen($body) < 2 * 1024 * 1024) {
					$body .= $chunk;
				}
				return \strlen($chunk);
			}
		]);
		if (\defined('CURLOPT_NOSIGNAL')) {
			\curl_setopt($c, CURLOPT_NOSIGNAL, true);
		}
		$ok = \curl_exec($c);
		$code = (int) \curl_getinfo($c, CURLINFO_RESPONSE_CODE);
		$errno = \curl_errno($c);
		$error = \curl_error($c);
		\curl_close($c);

		if (false === $ok || $errno) {
			if (CURLE_OPERATION_TIMEDOUT === $errno) {
				throw new LlmException('Zeitüberschreitung bei „' . $this->profileName . '“ (' . $this->timeout . ' s).', 504);
			}
			throw new LlmException('„' . $this->profileName . '“ nicht erreichbar (' . $errno . ': ' . $error . ').', 502);
		}
		if (200 !== $code) {
			throw new LlmException(static::httpErrorText($code, $body, $this->profileName), $code);
		}
		return [$code, $body];
	}

	public static function httpErrorText(int $code, string $body, string $profile): string
	{
		$detail = '';
		$json = \json_decode($body, true);
		if (\is_array($json)) {
			$msg = $json['error']['message'] ?? $json['message'] ?? $json['detail'] ?? '';
			if (\is_array($msg)) {
				$msg = \json_encode($msg, JSON_UNESCAPED_UNICODE);
			}
			$detail = \mb_substr((string) $msg, 0, 200);
		}
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
		return "{$profile}: {$text} (HTTP {$code})" . ($detail ? ": {$detail}" : '');
	}

	/**
	 * @return string Antworttext ohne Thinking
	 */
	public function chat(array $messages, array $opts = []): string
	{
		[, $body] = $this->curl($this->buildPayload($messages, $opts, false));
		$json = \json_decode($body, true);
		if (!\is_array($json) || !isset($json['choices'][0]['message'])) {
			throw new LlmException('Unerwartete Antwort von „' . $this->profileName . '“.', 502);
		}
		return static::flatten($json['choices'][0]['message']['content'] ?? '');
	}

	/**
	 * Erwartet ein JSON-Objekt als Antwort. Bei kaputtem JSON ein zweiter Versuch.
	 */
	public function chatJson(array $messages, array $opts = []): array
	{
		$opts['json'] = true;
		$text = $this->chat($messages, $opts);
		$data = static::extractJson($text);
		if (null === $data) {
			$messages[] = ['role' => 'assistant', 'content' => \mb_substr($text, 0, 4000)];
			$messages[] = ['role' => 'user', 'content' => 'Das war kein gültiges JSON. Antworte ausschließlich mit dem JSON-Objekt, ohne Erklärung und ohne Codeblock.'];
			$text = $this->chat($messages, $opts);
			$data = static::extractJson($text);
		}
		if (null === $data) {
			throw new LlmException('Das Modell hat kein gültiges JSON geliefert.', 502);
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
		$buffer = '';
		$full = '';
		$inThink = false;
		$emit = function (string $text) use (&$full, &$inThink, $onDelta) {
			// <think> Bloecke auch beim Streamen unterdruecken
			$out = '';
			while ('' !== $text) {
				if ($inThink) {
					$pos = \strpos($text, '</think>');
					if (false === $pos) {
						return;
					}
					$text = \substr($text, $pos + 8);
					$inThink = false;
				} else {
					$pos = \strpos($text, '<think>');
					if (false === $pos) {
						$out .= $text;
						break;
					}
					$out .= \substr($text, 0, $pos);
					$text = \substr($text, $pos + 7);
					$inThink = true;
				}
			}
			if ('' !== $out) {
				if ('' === $full) {
					$out = \ltrim($out);
					if ('' === $out) {
						return;
					}
				}
				$full .= $out;
				$onDelta($out);
			}
		};
		$this->curl($this->buildPayload($messages, $opts, true), function (string $chunk) use (&$buffer, $emit) {
			$buffer .= $chunk;
			while (false !== ($pos = \strpos($buffer, "\n"))) {
				$line = \rtrim(\substr($buffer, 0, $pos), "\r");
				$buffer = \substr($buffer, $pos + 1);
				if (!\str_starts_with($line, 'data:')) {
					continue;
				}
				$data = \trim(\substr($line, 5));
				if ('' === $data || '[DONE]' === $data) {
					continue;
				}
				$json = \json_decode($data, true);
				if (!\is_array($json)) {
					continue;
				}
				$delta = $json['choices'][0]['delta']['content'] ?? null;
				if (\is_array($delta)) {
					$text = '';
					foreach ($delta as $part) {
						if (\is_array($part) && 'text' === ($part['type'] ?? '') && \is_string($part['text'] ?? null)) {
							$text .= $part['text'];
						}
					}
					$delta = $text;
				}
				if (\is_string($delta) && '' !== $delta) {
					$emit($delta);
				}
			}
		});
		return \trim($full);
	}
}
