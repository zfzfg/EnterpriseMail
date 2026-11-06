<?php

namespace AiCopilot;

/**
 * Laedt Mails ueber die IMAP-Sitzung des angemeldeten Kontos und macht daraus
 * kompakten Text fuer das Modell (ohne Zitate, ohne lange Signaturen, gekuerzt).
 */
class MailContext
{
	public const MAX_THREAD = 15;

	private \MailSo\Mail\MailClient $oMailClient;

	public function __construct(\MailSo\Mail\MailClient $oMailClient)
	{
		$this->oMailClient = $oMailClient;
	}

	/**
	 * @return array{subject:string, from:string, fromEmail:string, to:string, date:int, body:string, messageId:string}
	 */
	public function message(string $sFolder, int $iUid): array
	{
		if (!\strlen($sFolder) || 1 > $iUid) {
			throw new LlmException('Ungültige Mail-Angabe.', 400);
		}
		$oMessage = $this->oMailClient->Message($sFolder, $iUid, true);
		if (!$oMessage) {
			throw new LlmException('Mail nicht gefunden.', 404);
		}
		$a = \json_decode(\json_encode($oMessage), true) ?: [];
		$sPlain = (string) ($a['plain'] ?? '');
		$sHtml = (string) ($a['html'] ?? '');
		$sBody = \strlen(\trim($sPlain)) ? $sPlain : static::htmlToText($sHtml);
		return [
			'uid' => $iUid,
			'folder' => $sFolder,
			'subject' => (string) ($a['subject'] ?? ''),
			'from' => static::emails($a['from'] ?? null),
			'fromEmail' => static::firstEmail($a['from'] ?? null),
			'to' => static::emails($a['to'] ?? null),
			'cc' => static::emails($a['cc'] ?? null),
			'date' => (int) ($a['dateTimestamp'] ?? 0),
			'messageId' => (string) ($a['messageId'] ?? ''),
			'refs' => static::refs($a),
			'attachments' => static::attachmentNames($a['attachments'] ?? null),
			'body' => static::cleanBody($sBody)
		];
	}

	/**
	 * Laedt mehrere Mails (Thread), sortiert nach Datum, und baut einen Text
	 * innerhalb des Budgets. Neueste Mails bekommen den meisten Platz.
	 */
	/**
	 * Wie thread(), ergaenzt um eigene Antworten aus dem Gesendet-Ordner, die
	 * im Verlauf referenziert werden (SnappyMail-Threads gelten nur je Ordner).
	 */
	public function threadWithSent(string $sFolder, array $aUids, string $sSent, int $iBudget = 12000): array
	{
		$aThread = $this->thread($sFolder, $aUids, $iBudget);
		if (!$sSent || $sSent === $sFolder) {
			return $aThread;
		}
		$aWanted = [];
		$aHave = [];
		foreach ($aThread['messages'] as $m) {
			$aHave[\strtolower(\trim($m['messageId'], ' <>'))] = true;
			foreach ($m['refs'] as $id) {
				$aWanted[$id] = true;
			}
		}
		$aWanted = \array_diff_key($aWanted, $aHave);
		if (!$aWanted) {
			return $aThread;
		}
		try {
			$oParams = new \MailSo\Mail\MessageListParams;
			$oParams->sFolderName = $sSent;
			$oParams->sSearch = 'sentsince:' . \gmdate('Y-m-d', \time() - 180 * 86400);
			$oParams->iLimit = 300;
			$oParams->bUseSort = true;
			$aList = \json_decode(\json_encode($this->oMailClient->MessageList($oParams)), true) ?: [];
			$iAdded = 0;
			foreach (static::items($aList) as $s) {
				$sId = \strtolower(\trim((string) ($s['messageId'] ?? ''), ' <>'));
				if ($sId && isset($aWanted[$sId]) && $iAdded < 5) {
					try {
						$aThread['messages'][] = $this->message($sSent, (int) $s['uid']);
						++$iAdded;
					} catch (\Throwable $e) {
					}
				}
			}
			if ($iAdded) {
				\usort($aThread['messages'], fn($a, $b) => $a['date'] <=> $b['date']);
				$aThread['text'] = static::render($aThread['messages'], $iBudget);
			}
		} catch (\Throwable $e) {
		}
		return $aThread;
	}

	public function thread(string $sFolder, array $aUids, int $iBudget = 12000): array
	{
		$aUids = \array_values(\array_unique(\array_filter(\array_map('intval', $aUids), fn($i) => $i > 0)));
		\rsort($aUids);
		$aUids = \array_slice($aUids, 0, static::MAX_THREAD);
		$aMessages = [];
		foreach ($aUids as $iUid) {
			try {
				$aMessages[] = $this->message($sFolder, $iUid);
			} catch (\Throwable $e) {
				// einzelne fehlende Mail ueberspringen
			}
		}
		if (!$aMessages) {
			throw new LlmException('Mail nicht gefunden.', 404);
		}
		\usort($aMessages, fn($a, $b) => $a['date'] <=> $b['date']);
		return [
			'messages' => $aMessages,
			'text' => static::render($aMessages, $iBudget)
		];
	}

	public static function render(array $aMessages, int $iBudget): string
	{
		$n = \count($aMessages);
		$aParts = [];
		$iRemaining = $iBudget;
		// von hinten (neueste zuerst) Platz vergeben
		for ($i = $n - 1; $i >= 0; --$i) {
			$m = $aMessages[$i];
			$iShare = ($i === $n - 1) ? (int) ($iRemaining * 0.6) : (int) ($iRemaining / \max(1, $i + 1));
			$iShare = \max(400, $iShare);
			$sBody = $m['body'];
			if (\mb_strlen($sBody) > $iShare) {
				$sBody = \mb_substr($sBody, 0, $iShare) . "\n[... gekürzt]";
			}
			$sHead = 'Von: ' . $m['from']
				. "\nAn: " . $m['to']
				. ($m['cc'] ? "\nCc: " . $m['cc'] : '')
				. "\nDatum: " . ($m['date'] ? \gmdate('Y-m-d H:i', $m['date']) . ' UTC' : 'unbekannt')
				. "\nBetreff: " . $m['subject']
				. ($m['attachments'] ? "\nAnhänge: " . \implode(', ', $m['attachments']) : '');
			$sPart = "--- Nachricht " . ($i + 1) . " von {$n} ---\n{$sHead}\n\n{$sBody}";
			$iRemaining -= \mb_strlen($sPart);
			\array_unshift($aParts, $sPart);
			if ($iRemaining < 200) {
				if ($i > 0) {
					\array_unshift($aParts, "[{$i} ältere Nachricht(en) aus Platzgründen weggelassen]");
				}
				break;
			}
		}
		return \implode("\n\n", $aParts);
	}

	public static function htmlToText(string $sHtml): string
	{
		if (!\strlen($sHtml)) {
			return '';
		}
		try {
			return \MailSo\Base\HtmlUtils::ConvertHtmlToPlain($sHtml);
		} catch (\Throwable $e) {
			return \trim(\html_entity_decode(\strip_tags($sHtml), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
		}
	}

	/**
	 * Zitate, Antwortkoepfe, Signaturen und Leerzeilen-Wuesten entfernen.
	 */
	public static function cleanBody(string $sText): string
	{
		$sText = \str_replace(["\r\n", "\r"], "\n", $sText);
		$sText = \preg_replace('/[\x{00A0}\x{200B}]/u', ' ', $sText) ?? $sText;
		$aLines = \explode("\n", $sText);
		$aOut = [];
		foreach ($aLines as $i => $sLine) {
			$sTrim = \trim($sLine);
			// Beginn des zitierten Verlaufs
			$bOutlookHeader = \count($aOut) > 2
				&& \preg_match('/^\*?(Von|From):\*?\s.+$/u', $sTrim)
				&& \preg_match('/^\*?(Gesendet|Sent|Datum|Date):/um', \implode("\n", \array_slice($aLines, $i + 1, 4)));
			if ($bOutlookHeader
			 || \preg_match('/^(-{2,}\s*(Original|Ursprüngliche)\s*(Message|Nachricht)\s*-{2,})/iu', $sTrim)
			 || \preg_match('/^(Am|On)\s.{4,160}(schrieb|wrote)\s*.{0,100}:$/iu', $sTrim)
			) {
				break;
			}
			// Signaturtrenner
			if ('-- ' === $sLine || ('--' === $sTrim && \count($aOut) > 2)) {
				break;
			}
			if (\str_starts_with($sTrim, '>')) {
				continue;
			}
			$aOut[] = \rtrim($sLine);
		}
		$sText = \implode("\n", $aOut);
		$sText = \preg_replace("/\n{3,}/", "\n\n", $sText) ?? $sText;
		return \trim($sText);
	}

	/**
	 * Collections kommen je nach Typ als {"@Collection": [...]} oder als Liste.
	 */
	public static function items(mixed $m): array
	{
		if (!\is_array($m)) {
			return [];
		}
		if (isset($m['@Collection']) && \is_array($m['@Collection'])) {
			return $m['@Collection'];
		}
		return \array_is_list($m) ? $m : [];
	}

	public static function refs(array $a): array
	{
		$aIds = [];
		foreach (['inReplyTo', 'references'] as $k) {
			foreach (\preg_split('/\s+/', (string) ($a[$k] ?? '')) as $id) {
				$id = \strtolower(\trim($id, " <>\t"));
				if ($id) {
					$aIds[] = $id;
				}
			}
		}
		return \array_values(\array_unique($aIds));
	}

	public static function emails(?array $aCollection): string
	{
		$aList = [];
		foreach (static::items($aCollection) as $e) {
			$sEmail = (string) ($e['email'] ?? '');
			$sName = (string) ($e['name'] ?? '');
			if ($sEmail) {
				$aList[] = $sName && $sName !== $sEmail ? "{$sName} <{$sEmail}>" : $sEmail;
			}
		}
		return \implode(', ', $aList);
	}

	public static function firstEmail(?array $aCollection): string
	{
		foreach (static::items($aCollection) as $e) {
			if (!empty($e['email'])) {
				return \strtolower((string) $e['email']);
			}
		}
		return '';
	}

	public static function attachmentNames(?array $aCollection): array
	{
		$aNames = [];
		foreach (static::items($aCollection) as $att) {
			if (!empty($att['isInline']) || !empty($att['isLinked'])) {
				continue;
			}
			$sName = (string) ($att['fileName'] ?? '');
			if ($sName) {
				$aNames[] = $sName;
			}
		}
		return \array_slice($aNames, 0, 20);
	}
}
