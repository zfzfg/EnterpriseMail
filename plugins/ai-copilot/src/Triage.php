<?php

namespace AiCopilot;

/**
 * Regelbasierte Einordnung ohne Modell (laeuft lokal auf dem Server).
 * Arbeitet auf dem JSON einer Nachricht aus MessageList (Kopfzeilen, Flags, Adressen).
 */
class Triage
{
	public const CATEGORIES = ['needs_reply', 'personal', 'newsletter', 'notification', 'invoice'];

	public const KEYWORD_PREFIX = '$ai_';

	/** Zusaetzliche Kopfzeilen, die fuer die Regeln geholt werden */
	public const HEADERS = ['List-Id', 'Precedence', 'Auto-Submitted', 'X-Spam-Flag', 'X-Auto-Response-Suppress', 'Feedback-ID'];

	private array $aOwn;
	private int $iNeedsReplyDays;

	public function __construct(array $aOwnAddresses, int $iNeedsReplyDays = 14)
	{
		$this->aOwn = \array_fill_keys(\array_map('strtolower', \array_filter($aOwnAddresses)), true);
		$this->iNeedsReplyDays = \max(1, $iNeedsReplyDays);
	}

	public static function keyword(string $sCategory): string
	{
		return static::KEYWORD_PREFIX . $sCategory;
	}

	/**
	 * Kategorie aus gesetztem Schlagwort ($ai_*), falls vorhanden.
	 */
	public static function fromFlags(array $aFlags): ?string
	{
		foreach ($aFlags as $sFlag) {
			$sFlag = \strtolower((string) $sFlag);
			if (\str_starts_with($sFlag, static::KEYWORD_PREFIX)) {
				$sCat = \substr($sFlag, \strlen(static::KEYWORD_PREFIX));
				if (\in_array($sCat, static::CATEGORIES, true)) {
					return $sCat;
				}
			}
		}
		return null;
	}

	private static function headerMap(array $aMessage): array
	{
		$aMap = [];
		foreach (($aMessage['headers']['@Collection'] ?? []) as $h) {
			$sName = \strtolower((string) ($h['name'] ?? ''));
			if ($sName && !isset($aMap[$sName])) {
				$aMap[$sName] = (string) ($h['value'] ?? '');
			}
		}
		return $aMap;
	}

	private static function addresses(?array $aCollection): array
	{
		$a = [];
		foreach (MailContext::items($aCollection) as $e) {
			if (!empty($e['email'])) {
				$a[] = \strtolower((string) $e['email']);
			}
		}
		return $a;
	}

	public static function isBulk(array $aHeaders): bool
	{
		if (!empty($aHeaders['list-unsubscribe']) || !empty($aHeaders['list-id']) || !empty($aHeaders['feedback-id'])) {
			return true;
		}
		if (isset($aHeaders['precedence']) && \preg_match('/bulk|list|junk/i', $aHeaders['precedence'])) {
			return true;
		}
		if (isset($aHeaders['auto-submitted']) && !\preg_match('/^\s*no\s*$/i', $aHeaders['auto-submitted'])) {
			return true;
		}
		return false;
	}

	public static function isMachineSender(string $sEmail): bool
	{
		$sLocal = \strstr($sEmail, '@', true) ?: $sEmail;
		return (bool) \preg_match('/^(no-?reply|do-?not-?reply|donotreply|noreply-.*|.*-noreply|notifications?|notify|alerts?|mailer-daemon|postmaster|bounces?(\+.*)?|news(letter)?|marketing|automated|system|support-noreply)$/i', $sLocal);
	}

	public static function isInvoiceSubject(string $sSubject): bool
	{
		return (bool) \preg_match('/\b(rechnung|rechnungen|rechnungsnummer|invoice|zahlungserinnerung|mahnung|beleg|quittung|receipt|gutschrift|kontoauszug|abrechnung|zahlungsaufforderung|payment due)\b/iu', $sSubject);
	}

	public static function isNewsletterSubject(string $sSubject): bool
	{
		return (bool) \preg_match('/\b(newsletter|angebot|rabatt|sale|deals?|gutschein|%\s*off|webinar)\b/iu', $sSubject);
	}

	/**
	 * @return array{category: ?string, bulk: bool}
	 */
	public function classify(array $aMessage): array
	{
		$aHeaders = static::headerMap($aMessage);
		$aFlags = \array_map('strtolower', (array) ($aMessage['flags'] ?? []));
		$aFrom = static::addresses($aMessage['from'] ?? null);
		$sFrom = $aFrom[0] ?? '';
		$aTo = static::addresses($aMessage['to'] ?? null);
		$aCc = static::addresses($aMessage['cc'] ?? null);
		$sSubject = (string) ($aMessage['subject'] ?? '');
		$iDate = (int) ($aMessage['dateTimestamp'] ?? 0);
		$bBulk = static::isBulk($aHeaders);
		$bAnswered = \in_array('\\answered', $aFlags, true) || \in_array('$replied', $aFlags, true);
		$bRecent = !$iDate || $iDate > \time() - $this->iNeedsReplyDays * 86400;

		$sStored = static::fromFlags($aFlags);
		if ($sStored) {
			// Beantwortete oder zu alte Mails warten nicht mehr auf eine Antwort.
			if ('needs_reply' === $sStored && ($bAnswered || !$bRecent)) {
				$sStored = 'personal';
			}
			return ['category' => $sStored, 'bulk' => $bBulk];
		}

		if (!$sFrom || isset($this->aOwn[$sFrom])) {
			return ['category' => null, 'bulk' => $bBulk];
		}
		if (isset($aHeaders['x-spam-flag']) && \preg_match('/yes/i', $aHeaders['x-spam-flag'])) {
			return ['category' => null, 'bulk' => true];
		}

		$bMachine = static::isMachineSender($sFrom);

		if (static::isInvoiceSubject($sSubject)) {
			return ['category' => 'invoice', 'bulk' => $bBulk];
		}
		if ($bBulk && (!empty($aHeaders['list-unsubscribe']) || static::isNewsletterSubject($sSubject))) {
			return ['category' => 'newsletter', 'bulk' => true];
		}
		if ($bBulk || $bMachine) {
			return ['category' => 'notification', 'bulk' => $bBulk];
		}

		$bDirect = false;
		foreach ($aTo as $sAddr) {
			if (isset($this->aOwn[$sAddr])) {
				$bDirect = true;
				break;
			}
		}
		$bCc = false;
		if (!$bDirect) {
			foreach ($aCc as $sAddr) {
				if (isset($this->aOwn[$sAddr])) {
					$bCc = true;
					break;
				}
			}
		}

		if ($bDirect && !$bAnswered && $bRecent) {
			return ['category' => 'needs_reply', 'bulk' => false];
		}
		if ($bDirect || $bCc) {
			return ['category' => 'personal', 'bulk' => false];
		}
		return ['category' => null, 'bulk' => false];
	}

	/**
	 * Haengt aiCategory an jede Nachricht einer MessageList-Antwort.
	 */
	public function annotateList(array &$aResponse): void
	{
		if (empty($aResponse['Result']['@Collection']) || !\is_array($aResponse['Result']['@Collection'])) {
			return;
		}
		foreach ($aResponse['Result']['@Collection'] as &$aMessage) {
			if (\is_array($aMessage) && 'Object/Message' === ($aMessage['@Object'] ?? '')) {
				$r = $this->classify($aMessage);
				$aMessage['aiCategory'] = $r['category'] ?? '';
			}
		}
	}
}
