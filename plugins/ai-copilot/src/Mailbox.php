<?php

namespace AiCopilot;

use MailSo\Imap\SequenceSet;

/**
 * IMAP-Hilfen: Listen, Suchen, Kategorien als Schlagwoerter.
 */
class Mailbox
{
	private \MailSo\Mail\MailClient $oMailClient;
	private Triage $oTriage;

	public function __construct(\MailSo\Mail\MailClient $oMailClient, Triage $oTriage)
	{
		$this->oMailClient = $oMailClient;
		$this->oTriage = $oTriage;
	}

	/**
	 * @return array Liste von Nachrichten (JSON-Form wie MessageList), neueste zuerst
	 */
	public function list(string $sFolder, string $sSearch = '', int $iLimit = 50, int $iOffset = 0): array
	{
		$oParams = new \MailSo\Mail\MessageListParams;
		$oParams->sFolderName = $sFolder;
		$oParams->sSearch = $sSearch;
		$oParams->iLimit = \max(1, \min(500, $iLimit));
		$oParams->iOffset = \max(0, $iOffset);
		$oParams->bUseSort = true;
		$oParams->bHideDeleted = true;
		$oCollection = $this->oMailClient->MessageList($oParams);
		$a = \json_decode(\json_encode($oCollection), true) ?: [];
		$aResult = [];
		foreach (($a['@Collection'] ?? []) as $m) {
			if (\is_array($m) && 'Object/Message' === ($m['@Object'] ?? '')) {
				$aResult[] = $m;
			}
		}
		return $aResult;
	}

	/**
	 * Kurzform fuer Modell und Oberflaeche.
	 */
	public function brief(array $m): array
	{
		$aFlags = \array_map('strtolower', (array) ($m['flags'] ?? []));
		return [
			'uid' => (int) ($m['uid'] ?? 0),
			'folder' => (string) ($m['folder'] ?? ''),
			'from' => MailContext::emails($m['from'] ?? null),
			'fromEmail' => MailContext::firstEmail($m['from'] ?? null),
			'subject' => (string) ($m['subject'] ?? ''),
			'date' => (int) ($m['dateTimestamp'] ?? 0),
			'unseen' => !\in_array('\\seen', $aFlags, true),
			'flagged' => \in_array('\\flagged', $aFlags, true),
			'answered' => \in_array('\\answered', $aFlags, true),
			'category' => $this->oTriage->classify($m)['category'] ?? '',
			'preview' => \mb_substr((string) ($m['preview'] ?? ''), 0, 160)
		];
	}

	/**
	 * Regelbasierte Kategorien als IMAP-Schlagwoerter setzen ($ai_*), nur fuer
	 * Nachrichten ohne vorhandenes $ai_-Schlagwort.
	 * @return array{tagged:int, checked:int}
	 */
	public function tagByRules(string $sFolder, int $iLimit = 300, string $sSent = ''): array
	{
		$aGroups = [];
		$iChecked = 0;
		$aList = $this->list($sFolder, '', $iLimit);

		// Mails, auf die schon geantwortet wurde (eigene Antwort im Gesendet-Ordner
		// oder neuere Mail im selben Verlauf), brauchen keine Antwort mehr.
		$aAnswered = [];
		$aSources = $aList;
		if ($sSent && $sSent !== $sFolder) {
			try {
				$aSources = \array_merge($aSources, $this->list($sSent, 'sentsince:' . \gmdate('Y-m-d', \time() - 60 * 86400), 300));
			} catch (\Throwable $e) {
			}
		}
		foreach ($aSources as $m) {
			foreach (['inReplyTo', 'references'] as $k) {
				foreach (\preg_split('/\s+/', (string) ($m[$k] ?? '')) as $id) {
					$id = \strtolower(\trim($id, " <>\t"));
					$id && $aAnswered[$id] = true;
				}
			}
		}

		$aSettled = [];
		foreach ($aList as $m) {
			++$iChecked;
			$sCat = $this->oTriage->classify($m)['category'] ?? null;
			$sId = \strtolower(\trim((string) ($m['messageId'] ?? ''), " <>\t"));
			if ('needs_reply' === $sCat && $sId && isset($aAnswered[$sId])) {
				$sCat = 'personal';
			}
			if ($sStored = Triage::fromFlags((array) ($m['flags'] ?? []))) {
				// A stored "needs reply" must leave that tab once it is settled.
				if ('needs_reply' === $sStored && 'personal' === $sCat) {
					$aSettled[(int) $m['uid']] = $sCat;
				}
				continue;
			}
			if ($sCat) {
				$aGroups[$sCat][] = (int) $m['uid'];
			}
		}
		$iTagged = 0;
		foreach ($aGroups as $sCat => $aUids) {
			$this->oMailClient->MessageSetFlag($sFolder, new SequenceSet($aUids), Triage::keyword($sCat), true);
			$iTagged += \count($aUids);
		}
		if ($aSettled) {
			$iTagged += $this->setCategories($sFolder, $aSettled);
		}
		return ['tagged' => $iTagged, 'checked' => $iChecked];
	}

	/**
	 * Setzt genau eine Kategorie (entfernt andere $ai_-Schlagwoerter).
	 */
	public function setCategories(string $sFolder, array $aUidToCategory): int
	{
		$aGroups = [];
		foreach ($aUidToCategory as $iUid => $sCat) {
			if (\in_array($sCat, Triage::CATEGORIES, true)) {
				$aGroups[$sCat][] = (int) $iUid;
			}
		}
		$aAll = \array_map('intval', \array_keys($aUidToCategory));
		if (!$aAll) {
			return 0;
		}
		$oAll = new SequenceSet($aAll);
		foreach (Triage::CATEGORIES as $sCat) {
			$this->oMailClient->MessageSetFlag($sFolder, $oAll, Triage::keyword($sCat), false, true);
		}
		$iCount = 0;
		foreach ($aGroups as $sCat => $aUids) {
			$this->oMailClient->MessageSetFlag($sFolder, new SequenceSet($aUids), Triage::keyword($sCat), true);
			$iCount += \count($aUids);
		}
		return $iCount;
	}

	public static function sanitizeSearch(string $sSearch): string
	{
		$sSearch = \trim(\preg_replace('/[\r\n\t]+/', ' ', $sSearch));
		// header: ist fehleranfaellig (leere Werte), nicht zulassen
		$sSearch = \preg_replace('/\bheader:("[^"]*"|\S+)/i', '', $sSearch);
		// older_than/newer_than: DateInterval braucht Grossbuchstaben (1M, 2W ...)
		$sSearch = \preg_replace_callback('/\b(older_than|newer_than):(\S+)/i', function ($m) {
			return \preg_match('/^(\d{1,4})([dwmy])$/i', $m[2], $v)
				? \strtolower($m[1]) . ':' . $v[1] . \strtoupper($v[2])
				: '';
		}, $sSearch);
		// Datumswerte pruefen
		$sSearch = \preg_replace_callback('/\b(since|before|on|sentsince|sentbefore|senton):(\S+)/i', function ($m) {
			return \preg_match('/^\d{4}-\d{2}-\d{2}$/', $m[2]) ? \strtolower($m[1]) . ':' . $m[2] : '';
		}, $sSearch);
		$sSearch = \trim(\preg_replace('/\s{2,}/', ' ', $sSearch));

		// SnappyMail wertet Kriterien nur aus, wenn die Suche mit einem Schluessel
		// beginnt, und verwirft dann freien Text. Darum: Schluessel nach vorne,
		// freien Text als text:"..." anhaengen.
		$sKeys = \MailSo\Imap\SearchCriterias::RegEx;
		$aKeyed = [];
		$sFree = \trim(\preg_replace_callback('/\b(' . $sKeys . '):("[^"]*"|\S+)/i', function ($m) use (&$aKeyed) {
			$aKeyed[] = \strtolower($m[1]) . ':' . $m[2];
			return ' ';
		}, $sSearch));
		$sFree = \trim(\preg_replace('/\s{2,}/', ' ', \str_replace('"', '', $sFree)));
		if ($aKeyed) {
			$sSearch = \implode(' ', $aKeyed) . (\strlen($sFree) ? ' text:"' . $sFree . '"' : '');
		}
		return \trim(\mb_substr($sSearch, 0, 300));
	}
}
