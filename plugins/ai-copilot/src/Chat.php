<?php

namespace AiCopilot;

/**
 * Copilot-Chat mit Werkzeugen (JSON-Protokoll, funktioniert auch mit Modellen
 * ohne Function Calling). Aktionen werden nur vorgeschlagen und validiert,
 * ausgefuehrt werden sie im Browser nach Bestaetigung.
 */
class Chat
{
	public const MAX_ROUNDS = 4;
	public const MAX_HISTORY = 12;
	public const MAX_KNOWN = 500;
	/** Seconds after which no further tool round starts, to free the PHP worker. */
	public const TIME_BUDGET = 120;

	public const ACTION_TYPES = ['archive', 'delete', 'mark_read', 'mark_unread', 'flag', 'unflag', 'move', 'open', 'reply', 'compose', 'search'];

	private LlmClient $oLlm;
	private Mailbox $oMailbox;
	private MailContext $oContext;
	private array $aFolders;
	private ?\Closure $fTagFolder;
	private \Closure $fClock;

	public function __construct(LlmClient $oLlm, Mailbox $oMailbox, MailContext $oContext, array $aFolders, ?\Closure $fTagFolder = null, ?\Closure $fClock = null)
	{
		$this->fClock = $fClock ?? fn(): int => \time();
		$this->oLlm = $oLlm;
		$this->oMailbox = $oMailbox;
		$this->oContext = $oContext;
		$this->aFolders = \array_values(\array_filter(\array_map('strval', $aFolders)));
		$this->fTagFolder = $fTagFolder;
	}

	public static function cleanHistory(array $aMessages): array
	{
		$aResult = [];
		foreach ($aMessages as $m) {
			if (!\is_array($m)) {
				continue;
			}
			$sRole = (string) ($m['role'] ?? '');
			$sContent = \trim((string) ($m['content'] ?? ''));
			if (\in_array($sRole, ['user', 'assistant'], true) && \strlen($sContent)) {
				$aResult[] = ['role' => $sRole, 'content' => \mb_substr($sContent, 0, 4000)];
			}
		}
		$aResult = \array_slice($aResult, -static::MAX_HISTORY);
		// muss mit user beginnen
		while ($aResult && 'user' !== $aResult[0]['role']) {
			\array_shift($aResult);
		}
		return $aResult;
	}

	/**
	 * @param array $aKnown "folder|uid" entries from earlier turns and the open mail
	 * @return array{reply:string, actions:array, trace:array, known:array}
	 */
	public function run(array $aSystem, array $aHistory, array $aKnown = []): array
	{
		$aConversation = \array_merge([$aSystem], $aHistory);
		$aTrace = [];
		$aSeen = []; // folder|uid aus Werkzeug-Ergebnissen und Kontext
		foreach ($aKnown as $sKnown) {
			if (\preg_match('/^(.+)\|[1-9]\d*$/s', (string) $sKnown, $m) && $this->folderOk($m[1])) {
				$aSeen[(string) $sKnown] = true;
			}
		}
		$aData = [];
		$iDeadline = ($this->fClock)() + static::TIME_BUDGET;
		$iLastRound = static::MAX_ROUNDS - 1;
		for ($i = 0; $i <= $iLastRound; ++$i) {
			$aData = $this->requestTurn($aConversation);
			$aTool = $aData['tool'] ?? null;
			if (!\is_array($aTool) || empty($aTool['name']) || $i === $iLastRound) {
				break;
			}
			if (($this->fClock)() >= $iDeadline) {
				$iLastRound = $i + 1;
			}
			$sName = (string) $aTool['name'];
			$aArgs = \is_array($aTool['args'] ?? null) ? $aTool['args'] : [];
			[$sSummary, $mResult, $sCode, $aParams] = $this->tool($sName, $aArgs, $aSeen);
			$aTrace[] = ['tool' => $sName, 'summary' => $sSummary, 'code' => $sCode, 'params' => $aParams];
			$aConversation[] = ['role' => 'assistant', 'content' => \json_encode($aData, JSON_UNESCAPED_UNICODE)];
			$aConversation[] = ['role' => 'user', 'content' => "Werkzeug-Ergebnis ({$sName}):\n"
				. Prompts::mailData((string) \json_encode($mResult, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE))
				. ($i === $iLastRound - 1
					? "\nDies war das letzte Werkzeug. Gib jetzt deine endgültige Antwort im JSON-Format mit tool = null."
					: "\nAntworte jetzt erneut im JSON-Format.")];
		}

		$sReply = \trim((string) ($aData['reply'] ?? ''));
		$aActions = $this->validateActions(\is_array($aData['actions'] ?? null) ? $aData['actions'] : [], $aSeen);
		// The browser words an empty reply in the user's language.
		if (!\strlen($sReply)) {
			$sReply = '';
		}
		return ['reply' => $sReply, 'actions' => $aActions, 'trace' => $aTrace, 'known' => \array_slice(\array_keys($aSeen), -static::MAX_KNOWN)];
	}

	/**
	 * Plain prose from a model that ignored the JSON format is still an answer.
	 * Truncated JSON is not, and raw JSON must never reach the user.
	 */
	private function requestTurn(array $aConversation): array
	{
		$sText = $this->oLlm->chat($aConversation, ['json' => true, 'temperature' => 0.2, 'max_tokens' => 1500]);
		$aData = LlmClient::extractJson($sText);
		if (null !== $aData) {
			return $aData;
		}
		if (\str_starts_with(\ltrim($sText), '{')) {
			throw new LlmException('Das Modell hat kein gültiges JSON geliefert.', 502, 'upstream_malformed_json');
		}
		return ['reply' => $sText, 'tool' => null, 'actions' => []];
	}

	private function folderOk(string $sFolder): bool
	{
		return \in_array($sFolder, $this->aFolders, true);
	}

	private function tool(string $sName, array $aArgs, array &$aSeen): array
	{
		try {
			switch ($sName) {
				case 'search_mail':
					$sFolder = (string) ($aArgs['folder'] ?? '');
					if (!$sFolder || !$this->folderOk($sFolder)) {
						$sFolder = 'INBOX';
					}
					$sSearch = Mailbox::sanitizeSearch((string) ($aArgs['search'] ?? $aArgs['query'] ?? ''));
					if (\str_contains($sSearch, 'keyword:$ai_') && $this->fTagFolder) {
						try {
							($this->fTagFolder)($sFolder);
						} catch (\Throwable $e) {
						}
					}
					$aItems = [];
					foreach ($this->oMailbox->list($sFolder, $sSearch, 20) as $m) {
						$b = $this->oMailbox->brief($m);
						$aSeen[$sFolder . '|' . $b['uid']] = true;
						$aItems[] = [
							'uid' => $b['uid'],
							'folder' => $sFolder,
							'from' => $b['from'],
							'subject' => $b['subject'],
							'date' => $b['date'] ? \gmdate('Y-m-d', $b['date']) : '',
							'unseen' => $b['unseen'],
							'answered' => $b['answered'],
							'category' => $b['category']
						];
					}
					return [\count($aItems) . ' Treffer in ' . $sFolder . ($sSearch ? " für „{$sSearch}“" : ''), ['folder' => $sFolder, 'search' => $sSearch, 'results' => $aItems],
						$sSearch ? 'search_query' : 'search', ['count' => \count($aItems), 'folder' => $sFolder, 'query' => $sSearch]];

				case 'read_mail':
					$sFolder = (string) ($aArgs['folder'] ?? 'INBOX');
					$iUid = (int) ($aArgs['uid'] ?? 0);
					if (!$this->folderOk($sFolder)) {
						return ['Ordner unbekannt', ['error' => 'Ordner unbekannt'], 'folder_unknown', []];
					}
					$m = $this->oContext->message($sFolder, $iUid);
					$aSeen[$sFolder . '|' . $iUid] = true;
					return ['Mail gelesen: ' . $m['subject'], [
						'uid' => $iUid,
						'folder' => $sFolder,
						'from' => $m['from'],
						'to' => $m['to'],
						'date' => $m['date'] ? \gmdate('Y-m-d H:i', $m['date']) : '',
						'subject' => $m['subject'],
						'body' => \mb_substr($m['body'], 0, 4000)
					], 'read', ['subject' => $m['subject']]];
			}
		} catch (\Throwable $e) {
			return ['Werkzeugfehler', ['error' => 'Werkzeug fehlgeschlagen.'], 'failed', []];
		}
		return ['Unbekanntes Werkzeug', ['error' => 'Unbekanntes Werkzeug.'], 'unknown_tool', []];
	}

	/**
	 * Actions may only touch mails the model actually received, so an instruction
	 * hidden in a mail cannot aim them at arbitrary UIDs.
	 */
	public function validateActions(array $aActions, array $aSeen): array
	{
		$aResult = [];
		foreach (\array_slice($aActions, 0, 8) as $a) {
			if (!\is_array($a)) {
				continue;
			}
			$sType = (string) ($a['type'] ?? '');
			if (!\in_array($sType, static::ACTION_TYPES, true)) {
				continue;
			}
			$aClean = [
				'type' => $sType,
				'label' => \mb_substr(\trim((string) ($a['label'] ?? '')), 0, 160)
			];
			$sFolder = (string) ($a['folder'] ?? '');
			switch ($sType) {
				case 'archive':
				case 'delete':
				case 'mark_read':
				case 'mark_unread':
				case 'flag':
				case 'unflag':
				case 'move':
					if (!$this->folderOk($sFolder)) {
						continue 2;
					}
					$aUids = \array_values(\array_unique(\array_filter(\array_map('intval', (array) ($a['uids'] ?? [])), fn($u) => $u > 0 && isset($aSeen[$sFolder . '|' . $u]))));
					if (!$aUids) {
						continue 2;
					}
					$aClean['folder'] = $sFolder;
					$aClean['uids'] = \array_slice($aUids, 0, 200);
					if ('move' === $sType) {
						$sTo = (string) ($a['to'] ?? '');
						if (!$this->folderOk($sTo) || $sTo === $sFolder) {
							continue 2;
						}
						$aClean['to'] = $sTo;
					}
					break;
				case 'open':
				case 'reply':
					$iUid = (int) ($a['uid'] ?? 0);
					if (!$this->folderOk($sFolder) || $iUid < 1 || !isset($aSeen[$sFolder . '|' . $iUid])) {
						continue 2;
					}
					$aClean['folder'] = $sFolder;
					$aClean['uid'] = $iUid;
					if ('reply' === $sType) {
						$aClean['instruction'] = \mb_substr((string) ($a['instruction'] ?? ''), 0, 1000);
					}
					break;
				case 'compose':
					$sTo = \trim((string) ($a['to'] ?? ''));
					if ($sTo && !\filter_var($sTo, FILTER_VALIDATE_EMAIL)) {
						$sTo = '';
					}
					$aClean['to'] = $sTo;
					$aClean['subject'] = \mb_substr((string) ($a['subject'] ?? ''), 0, 200);
					$aClean['instruction'] = \mb_substr((string) ($a['instruction'] ?? ''), 0, 1000);
					break;
				case 'search':
					$aClean['search'] = Mailbox::sanitizeSearch((string) ($a['search'] ?? ''));
					$aClean['folder'] = $this->folderOk($sFolder) ? $sFolder : '';
					break;
			}
			if (!\strlen($aClean['label'])) {
				$aClean['label'] = $sType;
			}
			$aResult[] = $aClean;
		}
		return $aResult;
	}
}
