<?php

namespace AiCopilot;

/**
 * Hinweise ohne Modell: offene Antworten, Nachfassen bei gesendeten Mails,
 * ungelesene Rechnungen. Datumssuche ueber den Date-Kopf (sentsince/sentbefore).
 */
class Alerts
{
	private Mailbox $oMailbox;
	private array $aOwn;

	public function __construct(Mailbox $oMailbox, array $aOwnAddresses)
	{
		$this->oMailbox = $oMailbox;
		$this->aOwn = \array_fill_keys(\array_map('strtolower', $aOwnAddresses), true);
	}

	private static function ids(array $m): array
	{
		$a = [];
		foreach (['inReplyTo', 'references'] as $k) {
			foreach (\preg_split('/\s+/', (string) ($m[$k] ?? '')) as $id) {
				$id = \strtolower(\trim($id, " <>\t"));
				if ($id) {
					$a[] = $id;
				}
			}
		}
		return $a;
	}

	private static function messageId(array $m): string
	{
		return \strtolower(\trim((string) ($m['messageId'] ?? ''), " <>\t"));
	}

	public function collect(string $sInbox, string $sSent, int $iReplyDays = 2, int $iFollowDays = 3, int $iFollowMaxDays = 14): array
	{
		$aAlerts = [];
		$iNow = \time();
		$sSince30 = \gmdate('Y-m-d', $iNow - 30 * 86400);

		$aInbox = [];
		try {
			$aInbox = $this->oMailbox->list($sInbox, "sentsince:{$sSince30}", 300);
		} catch (\Throwable $e) {
		}
		$aSent = [];
		if ($sSent && $sSent !== $sInbox) {
			try {
				$aSent = $this->oMailbox->list($sSent, "sentsince:{$sSince30}", 200);
			} catch (\Throwable $e) {
			}
		}

		// Von eingehenden Mails referenzierte IDs (= Antworten auf etwas)
		$aRefByInbox = [];
		foreach ($aInbox as $m) {
			foreach (static::ids($m) as $id) {
				$aRefByInbox[$id] = true;
			}
		}
		// Von eigenen gesendeten Mails referenzierte IDs (= bereits beantwortet)
		$aRefBySent = [];
		foreach ($aSent as $m) {
			foreach (static::ids($m) as $id) {
				$aRefBySent[$id] = true;
			}
		}

		foreach ($aInbox as $m) {
			$b = $this->oMailbox->brief($m);
			$sId = static::messageId($m);
			if ('needs_reply' === $b['category']) {
				// beantwortet (Flag oder eigene Antwort) oder durch neuere Mail im Verlauf ueberholt
				if ($b['answered'] || ($sId && (isset($aRefBySent[$sId]) || isset($aRefByInbox[$sId])))) {
					continue;
				}
				if ($b['date'] && $b['date'] < $iNow - $iReplyDays * 86400) {
					$iDays = (int) \floor(($iNow - $b['date']) / 86400);
					$aAlerts[] = [
						'type' => 'reply',
						'folder' => $sInbox,
						'uid' => $b['uid'],
						'title' => $b['subject'] ?: '(ohne Betreff)',
						'subtitle' => $b['from'],
						'detail' => "Antwort offen seit {$iDays} Tagen",
						'date' => $b['date'],
						'prio' => 3
					];
				}
			} else if ('invoice' === $b['category'] && ($b['unseen'] || $b['flagged'])) {
				$aAlerts[] = [
					'type' => 'invoice',
					'folder' => $sInbox,
					'uid' => $b['uid'],
					'title' => $b['subject'] ?: '(ohne Betreff)',
					'subtitle' => $b['from'],
					'detail' => $b['unseen'] ? 'Rechnung ungelesen' : 'Rechnung markiert',
					'date' => $b['date'],
					'prio' => 1
				];
			}
		}

		// Gesendete Mails ohne Antwort
		foreach ($aSent as $m) {
			$iDate = (int) ($m['dateTimestamp'] ?? 0);
			if (!$iDate || $iDate > $iNow - $iFollowDays * 86400 || $iDate < $iNow - $iFollowMaxDays * 86400) {
				continue;
			}
			$sId = static::messageId($m);
			if (!$sId || isset($aRefByInbox[$sId])) {
				continue;
			}
			// eigene Antworten auf fremde Mails nicht nachfassen, nur neue Anfragen
			if (!empty($m['inReplyTo'])) {
				continue;
			}
			$aTo = [];
			foreach (MailContext::items($m['to'] ?? null) as $e) {
				$sAddr = \strtolower((string) ($e['email'] ?? ''));
				if ($sAddr && !isset($this->aOwn[$sAddr]) && !Triage::isMachineSender($sAddr)) {
					$aTo[] = ($e['name'] ?? '') ?: $sAddr;
				}
			}
			if (!$aTo) {
				continue;
			}
			$iDays = (int) \floor(($iNow - $iDate) / 86400);
			$aAlerts[] = [
				'type' => 'followup',
				'folder' => $sSent,
				'uid' => (int) $m['uid'],
				'title' => (string) ($m['subject'] ?? '') ?: '(ohne Betreff)',
				'subtitle' => 'An ' . \implode(', ', \array_slice($aTo, 0, 3)),
				'detail' => "Keine Antwort seit {$iDays} Tagen",
				'date' => $iDate,
				'prio' => 2
			];
		}

		\usort($aAlerts, fn($a, $b) => [$b['prio'], $a['date']] <=> [$a['prio'], $b['date']]);
		return \array_slice($aAlerts, 0, 20);
	}
}
