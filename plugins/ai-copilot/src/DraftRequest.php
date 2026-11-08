<?php

namespace AiCopilot;

/**
 * Strict, bounded input for draft generation and the future prepare RPC.
 */
final class DraftRequest
{
	public const MAX_BODY_BYTES = 65536;
	public const MAX_UIDS = 100;
	public const MAX_UID = 4294967295;

	private const FIELDS = ['mode', 'tone', 'instruction', 'current', 'wantSubject', 'folder', 'uids', 'uid', 'sent'];
	private const MODES = ['new', 'reply', 'rewrite', 'proofread'];

	public static function decode(string $sBody, string $sContentType, ?int $iContentLength = null): array
	{
		if (null !== $iContentLength && ($iContentLength < 0 || $iContentLength > static::MAX_BODY_BYTES)) {
			throw new LlmException('Die Anfrage ist zu groß.', 413, 'body_too_large');
		}
		if (!static::isJsonContentType($sContentType)) {
			throw new LlmException('Content-Type muss application/json sein.', 415, 'invalid_content_type');
		}
		if (\strlen($sBody) > static::MAX_BODY_BYTES) {
			throw new LlmException('Die Anfrage ist zu groß.', 413, 'body_too_large');
		}
		try {
			$aBody = \json_decode($sBody, true, 32, JSON_THROW_ON_ERROR);
		} catch (\JsonException $e) {
			throw new LlmException('Ungültiges JSON.', 400, 'invalid_json');
		}
		if (!\is_array($aBody) || !\str_starts_with(\ltrim($sBody), '{')) {
			throw new LlmException('Ungültige Anfrage.', 400, 'invalid_request');
		}
		return static::validate($aBody);
	}

	public static function validate(array $aInput): array
	{
		foreach (\array_keys($aInput) as $sKey) {
			if (!\is_string($sKey) || !\in_array($sKey, static::FIELDS, true)) {
				throw new LlmException('Die Anfrage enthält unbekannte Felder.', 400, 'invalid_request');
			}
		}

		$sMode = static::stringField($aInput, 'mode', 'new', 20);
		if (!\in_array($sMode, static::MODES, true)) {
			throw new LlmException('Ungültiger Entwurfsmodus.', 400, 'invalid_mode');
		}
		$bWantSubject = \array_key_exists('wantSubject', $aInput) ? $aInput['wantSubject'] : false;
		if (!\is_bool($bWantSubject)) {
			throw new LlmException('Ungültiger Anfrageparameter.', 400, 'invalid_field');
		}

		$mUids = \array_key_exists('uids', $aInput) ? $aInput['uids'] : [];
		if (!\is_array($mUids) || !\array_is_list($mUids) || \count($mUids) > static::MAX_UIDS) {
			throw new LlmException('Ungültige UID-Liste.', 400, 'invalid_uids');
		}
		$aUids = [];
		foreach ($mUids as $mUid) {
			if (!\is_int($mUid) || $mUid < 1 || $mUid > static::MAX_UID) {
				throw new LlmException('Ungültige UID-Liste.', 400, 'invalid_uids');
			}
			$aUids[] = $mUid;
		}
		$iUid = \array_key_exists('uid', $aInput) ? $aInput['uid'] : 0;
		if (!\is_int($iUid) || $iUid < 0 || $iUid > static::MAX_UID) {
			throw new LlmException('Ungültige UID.', 400, 'invalid_uids');
		}
		if ($iUid > 0) {
			$aUids[] = $iUid;
		}

		return [
			'mode' => $sMode,
			'tone' => static::stringField($aInput, 'tone', '', 200),
			'instruction' => static::stringField($aInput, 'instruction', '', 2000),
			'current' => static::stringField($aInput, 'current', '', 8000),
			'wantSubject' => $bWantSubject,
			'folder' => static::stringField($aInput, 'folder', '', 512),
			'uids' => \array_values(\array_unique($aUids)),
			'sent' => static::stringField($aInput, 'sent', '', 512)
		];
	}

	private static function stringField(array $aInput, string $sKey, string $sDefault, int $iMax): string
	{
		$mValue = \array_key_exists($sKey, $aInput) ? $aInput[$sKey] : $sDefault;
		if (!\is_string($mValue) || 1 !== \preg_match('//u', $mValue) || \mb_strlen($mValue) > $iMax) {
			throw new LlmException('Ungültiger oder zu langer Anfrageparameter.', 400, 'invalid_field');
		}
		return $mValue;
	}

	private static function isJsonContentType(string $sContentType): bool
	{
		$aParts = \explode(';', $sContentType);
		if ('application/json' !== \strtolower(\trim(\array_shift($aParts)))) {
			return false;
		}
		foreach ($aParts as $sPart) {
			if ('' !== \trim($sPart) && !\preg_match('/^\s*charset\s*=\s*"?utf-8"?\s*$/i', $sPart)) {
				return false;
			}
		}
		return true;
	}
}
