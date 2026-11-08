<?php

namespace AiCopilot;

/**
 * Deployment and transport policy for the optional Rust draft streamer.
 * No request, account, provider secret, or response content is logged here.
 */
final class StreamPreparation
{
	public const INTERNAL_MARKER = 'rust-ai-prepare-v1';
	public const ROUTE = 'api/ai/stream';

	public static function enabled(): bool
	{
		return 'true' === (string) \getenv('SNAPPY_AI_PROXY_ENABLED');
	}

	/** Remote providers require HTTPS; plain HTTP is only the explicit llmster loopback profile. */
	public static function profileEligible(string $sProfile, string $sProviderUrl): bool
	{
		$a = \parse_url($sProviderUrl);
		if (!\is_array($a) || empty($a['host']) || isset($a['user']) || isset($a['pass']) || isset($a['fragment'])) {
			return false;
		}
		$sScheme = \strtolower((string) ($a['scheme'] ?? ''));
		if ('https' === $sScheme) {
			return true;
		}
		return 'http' === $sScheme && 'llmster' === $sProfile && static::loopbackAddress((string) $a['host']);
	}

	public static function allowLocalProvider(string $sProfile, string $sProviderUrl): bool
	{
		$a = \parse_url($sProviderUrl);
		return \is_array($a)
			&& 'http' === \strtolower((string) ($a['scheme'] ?? ''))
			&& 'llmster' === $sProfile
			&& !empty($a['host'])
			&& static::loopbackAddress((string) $a['host']);
	}

	public static function loopbackAddress(string $sAddress): bool
	{
		$sAddress = \trim($sAddress, '[]');
		if ('localhost' === \strtolower($sAddress)) {
			return true;
		}
		$sPacked = @\inet_pton($sAddress);
		if (false === $sPacked) {
			return false;
		}
		return 4 === \strlen($sPacked)
			? 127 === \ord($sPacked[0])
			: (16 === \strlen($sPacked) && $sPacked === \inet_pton('::1'));
	}

	/** Stable installation-scoped pseudonym; neither the email nor account hash is returned. */
	public static function accountKey(string $sAccountHash): string
	{
		if (!\defined('APP_SALT') || '' === (string) \APP_SALT) {
			throw new LlmException('Der Streaming-Dienst ist nicht konfiguriert.', 503, 'provider_unavailable');
		}
		return \hash_hmac('sha256', 'ai-copilot/rust-account/v1|' . $sAccountHash, (string) \APP_SALT);
	}

	/** Minimal loopback health probe; it never calls PHP prepare or an AI provider. */
	public static function healthy(): bool
	{
		if (!static::enabled()) {
			return false;
		}
		$iErrno = 0;
		$sError = '';
		$oSocket = @\fsockopen('127.0.0.1', 3001, $iErrno, $sError, 0.25);
		if (!\is_resource($oSocket)) {
			return false;
		}
		\stream_set_timeout($oSocket, 0, 250000);
		$sResponse = '';
		if (false !== @\fwrite($oSocket, "GET /healthz HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")) {
			$sResponse = (string) @\stream_get_contents($oSocket, 4096);
		}
		@\fclose($oSocket);
		return 1 === \preg_match('#^HTTP/\d(?:\.\d)? 200 #', $sResponse)
			&& 1 === \preg_match('#\r?\n\r?\nok\n$#', $sResponse);
	}
}
