<?php

/**
 * AI Copilot fuer SnappyMail: Zusammenfassungen, Entwuerfe, Antwortvorschlaege,
 * Suche in natuerlicher Sprache, Kategorien, Copilot-Chat und Hinweise.
 * Anbieter: Mistral (direkt) oder llmster/LM Studio (OpenAI-kompatibel).
 * Es wird nur nach einem Klick des Benutzers etwas an den Anbieter gesendet.
 */

\spl_autoload_register(function (string $sClass) {
	if (\str_starts_with($sClass, 'AiCopilot\\')) {
		$sFile = __DIR__ . '/src/' . \substr($sClass, 10) . '.php';
		if (\is_file($sFile)) {
			require_once $sFile;
		}
	}
});

use AiCopilot\Alerts;
use AiCopilot\Chat;
use AiCopilot\DraftRequest;
use AiCopilot\LlmClient;
use AiCopilot\LlmException;
use AiCopilot\MailContext;
use AiCopilot\Mailbox;
use AiCopilot\Prompts;
use AiCopilot\SseEvent;
use AiCopilot\Triage;
use RainLoop\Enumerations\PluginPropertyType;
use RainLoop\Plugins\Property;
use RainLoop\Plugins\PropertyCollection;

class AiCopilotPlugin extends \RainLoop\Plugins\AbstractPlugin
{
	const
		NAME     = 'AI Copilot',
		AUTHOR   = 'zfzfg',
		URL      = 'https://github.com/zfzfg/snappymail',
		VERSION  = '0.1.0',
		RELEASE  = '2026-11-06',
		REQUIRED = '2.36.0',
		CATEGORY = 'General',
		LICENSE  = 'AGPL v3',
		DESCRIPTION = 'KI-Funktionen (Zusammenfassung, Entwürfe, Antwortvorschläge, Suche, Kategorien, Chat, Hinweise) mit Mistral oder llmster';

	const FEATURES = ['summarize', 'draft', 'quick_replies', 'search', 'triage', 'triage_llm', 'chat', 'alerts'];

	public function Init(): void
	{
		$this->UseLangs(true);


		$this->addJsonHook('AiGetSettings', 'DoGetSettings');
		$this->addJsonHook('AiSaveSettings', 'DoSaveSettings');
		$this->addJsonHook('AiSummarize', 'DoSummarize');
		$this->addJsonHook('AiDraft', 'DoDraft');
		$this->addJsonHook('AiQuickReplies', 'DoQuickReplies');
		$this->addJsonHook('AiSearch', 'DoSearch');
		$this->addJsonHook('AiTriageTag', 'DoTriageTag');
		$this->addJsonHook('AiTriageLlm', 'DoTriageLlm');
		$this->addJsonHook('AiChat', 'DoChat');
		$this->addJsonHook('AiAlerts', 'DoAlerts');
		$this->addJsonHook('AiAlertsLlm', 'DoAlertsLlm');
		$this->addPartHook('AiStream', 'ServiceStream');
		// Registered for the private FastCGI transport; ServicePrepare rejects public callers.
		$this->addPartHook('AiPrepare', 'ServicePrepare');

		$this->addHook('imap.message-headers', 'onMessageHeaders');
		$this->addHook('json.after-MessageList', 'onAfterMessageList');
	}

	/* ------------------------------------------------------------------ */
	/* Konfiguration                                                       */
	/* ------------------------------------------------------------------ */

	protected function configMapping(): array
	{
		$aProfiles = [
			['id' => 'mistral', 'name' => 'Mistral'],
			['id' => 'llmster', 'name' => 'llmster / LM Studio']
		];
		$aProfilesOrDefault = \array_merge([['id' => '', 'name' => '(Standard-Profil)']], $aProfiles);
		$aJsonModes = [
			['id' => 'json_object', 'name' => 'response_format json_object'],
			['id' => 'none', 'name' => 'ohne response_format (JSON aus Text lesen)']
		];

		$aFeatures = new PropertyCollection('Funktionen');
		$aFeatures->exchangeArray([
			Property::NewInstance('feature_summarize')->SetLabel('Zusammenfassung')
				->SetType(PluginPropertyType::BOOL)->SetDefaultValue(true),
			Property::NewInstance('feature_draft')->SetLabel('Entwürfe, Ton, Umschreiben, Korrekturlesen')
				->SetType(PluginPropertyType::BOOL)->SetDefaultValue(true),
			Property::NewInstance('feature_quick_replies')->SetLabel('Antwortvorschläge (3 Stück, auf Klick)')
				->SetType(PluginPropertyType::BOOL)->SetDefaultValue(true),
			Property::NewInstance('feature_search')->SetLabel('Suche in natürlicher Sprache (nur die Anfrage geht an das Modell)')
				->SetType(PluginPropertyType::BOOL)->SetDefaultValue(true),
			Property::NewInstance('feature_triage')->SetLabel('Kategorien und Tabs (Regeln, ohne Modell)')
				->SetType(PluginPropertyType::BOOL)->SetDefaultValue(true),
			Property::NewInstance('feature_triage_llm')->SetLabel('Kategorien mit KI einordnen (Absender, Betreff, Vorschau gehen an das Modell)')
				->SetType(PluginPropertyType::BOOL)->SetDefaultValue(false),
			Property::NewInstance('feature_chat')->SetLabel('Copilot-Chat (Seitenleiste)')
				->SetType(PluginPropertyType::BOOL)->SetDefaultValue(true),
			Property::NewInstance('feature_alerts')->SetLabel('Hinweise (offene Antworten, Nachfassen, Rechnungen)')
				->SetType(PluginPropertyType::BOOL)->SetDefaultValue(true),
			Property::NewInstance('store_keywords')->SetLabel('Kategorien als IMAP-Schlagwörter ($ai_*) speichern')
				->SetDescription('Nötig für die Tabs. Die Schlagwörter sind auch in anderen Mailprogrammen sichtbar.')
				->SetType(PluginPropertyType::BOOL)->SetDefaultValue(true),
			Property::NewInstance('context_budget')->SetLabel('Kontext-Budget in Zeichen pro Anfrage')
				->SetType(PluginPropertyType::INT)->SetDefaultValue(12000),
			Property::NewInstance('needs_reply_days')->SetLabel('„Antwort nötig“ nur für Mails der letzten N Tage')
				->SetType(PluginPropertyType::INT)->SetDefaultValue(14)
		]);

		$aRouting = new PropertyCollection('Profile je Funktion');
		$aRouting->exchangeArray([
			Property::NewInstance('profile_default')->SetLabel('Standard-Profil')
				->SetType(PluginPropertyType::SELECT)->SetOptions($aProfiles)->SetDefaultValue('mistral'),
			Property::NewInstance('profile_triage')->SetLabel('Profil für Kategorien mit KI')
				->SetType(PluginPropertyType::SELECT)->SetOptions($aProfilesOrDefault)->SetDefaultValue(''),
			Property::NewInstance('profile_search')->SetLabel('Profil für die Suche')
				->SetType(PluginPropertyType::SELECT)->SetOptions($aProfilesOrDefault)->SetDefaultValue(''),
			Property::NewInstance('profile_chat')->SetLabel('Profil für den Chat')
				->SetType(PluginPropertyType::SELECT)->SetOptions($aProfilesOrDefault)->SetDefaultValue('')
		]);

		$aMistral = new PropertyCollection('Profil Mistral');
		$aMistral->exchangeArray([
			Property::NewInstance('mistral_base_url')->SetLabel('Base-URL')
				->SetType(PluginPropertyType::URL)->SetDefaultValue('https://api.mistral.ai/v1'),
			Property::NewInstance('mistral_model')->SetLabel('Modell')
				->SetType(PluginPropertyType::STRING)->SetDefaultValue('zai-glm-5-3-flash'),
			Property::NewInstance('mistral_key_file')->SetLabel('Key-Datei')
				->SetDescription('Datei mit MISTRAL_API_KEY=... oder nur dem Key. Vorrang vor dem Feld darunter. Umgebungsvariable MISTRAL_API_KEY hat höchsten Vorrang.')
				->SetType(PluginPropertyType::STRING)->SetDefaultValue('/run/secrets/mistral.env'),
			Property::NewInstance('mistral_api_key')->SetLabel('API-Key (falls keine Datei)')
				->SetType(PluginPropertyType::PASSWORD)->SetEncrypted()->SetDefaultValue(''),
			Property::NewInstance('mistral_timeout')->SetLabel('Timeout in Sekunden')
				->SetType(PluginPropertyType::INT)->SetDefaultValue(90),
			Property::NewInstance('mistral_json_mode')->SetLabel('JSON-Modus')
				->SetType(PluginPropertyType::SELECT)->SetOptions($aJsonModes)->SetDefaultValue('json_object')
		]);

		$aLlmster = new PropertyCollection('Profil llmster / LM Studio');
		$aLlmster->exchangeArray([
			Property::NewInstance('llmster_base_url')->SetLabel('Base-URL')
				->SetDescription('Lokal z. B. http://host.docker.internal:1234/v1, auf dem NAS http://172.20.0.1:1234/v1')
				->SetType(PluginPropertyType::URL)->SetDefaultValue('http://host.docker.internal:1234/v1'),
			Property::NewInstance('llmster_model')->SetLabel('Modell (Chat-Modell, kein Embedding-Modell)')
				->SetType(PluginPropertyType::STRING)->SetDefaultValue(''),
			Property::NewInstance('llmster_key_file')->SetLabel('Key-Datei (optional)')
				->SetType(PluginPropertyType::STRING)->SetDefaultValue(''),
			Property::NewInstance('llmster_api_key')->SetLabel('API-Key (optional)')
				->SetType(PluginPropertyType::PASSWORD)->SetEncrypted()->SetDefaultValue(''),
			Property::NewInstance('llmster_timeout')->SetLabel('Timeout in Sekunden')
				->SetType(PluginPropertyType::INT)->SetDefaultValue(180),
			Property::NewInstance('llmster_json_mode')->SetLabel('JSON-Modus')
				->SetType(PluginPropertyType::SELECT)->SetOptions($aJsonModes)->SetDefaultValue('none')
		]);

		return [$aFeatures, $aRouting, $aMistral, $aLlmster];
	}

	private function conf(string $sName, mixed $mDefault = null): mixed
	{
		foreach ($this->ConfigProperties() as $oProp) {
			if ($oProp->Name() === $sName) {
				$mDefault = $oProp->DefaultValue();
				break;
			}
		}
		return $this->Config()->Get('plugin', $sName, $mDefault);
	}

	private function featureOn(string $sFeature): bool
	{
		if (!\in_array($sFeature, static::FEATURES, true) || !$this->conf('feature_' . $sFeature, false)) {
			return false;
		}
		$aUser = $this->userSettings();
		if (empty($aUser['enabled'])) {
			return false;
		}
		return !isset($aUser['features'][$sFeature]) || !empty($aUser['features'][$sFeature]);
	}

	private function readKeyFile(string $sFile, string $sVar): string
	{
		if (!$sFile || !\is_file($sFile) || !\is_readable($sFile)) {
			return '';
		}
		$sData = (string) @\file_get_contents($sFile, false, null, 0, 8192);
		foreach (\preg_split('/\r?\n/', $sData) as $sLine) {
			$sLine = \trim($sLine);
			if ('' === $sLine || '#' === $sLine[0]) {
				continue;
			}
			if (\preg_match('/^(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/', $sLine, $m)) {
				if ($m[1] === $sVar) {
					return \trim($m[2], " \t\"'");
				}
				continue;
			}
			return $sLine;
		}
		return '';
	}

	private function profileConfig(string $sProfile): array
	{
		if (!\in_array($sProfile, ['mistral', 'llmster'], true)) {
			$sProfile = 'mistral';
		}
		$sVar = \strtoupper($sProfile) . '_API_KEY';
		$sKey = (string) \getenv($sVar);
		if (!$sKey) {
			$sKey = $this->readKeyFile((string) $this->conf("{$sProfile}_key_file", ''), $sVar);
		}
		if (!$sKey) {
			$sKey = (string) $this->Config()->getDecrypted('plugin', "{$sProfile}_api_key", '');
		}
		return [
			'name' => 'mistral' === $sProfile ? 'Mistral' : 'llmster',
			'base_url' => (string) $this->conf("{$sProfile}_base_url", ''),
			'model' => (string) $this->conf("{$sProfile}_model", ''),
			'api_key' => $sKey,
			'timeout' => (int) $this->conf("{$sProfile}_timeout", 90),
			'json_mode' => (string) $this->conf("{$sProfile}_json_mode", 'json_object')
		];
	}

	private function profileFor(string $sFeature): string
	{
		$sDefault = (string) $this->conf('profile_default', 'mistral') ?: 'mistral';
		$sOverride = \in_array($sFeature, ['triage', 'search', 'chat'], true) ? (string) $this->conf('profile_' . $sFeature, '') : '';
		// Never fall back to another profile: a local setup must not silently reach a cloud provider.
		return $sOverride ?: $sDefault;
	}

	private function llm(string $sFeature): LlmClient
	{
		// Central defense for every current and future provider-dispatching action.
		$this->requireConsent($sFeature);
		$sProfile = $this->profileFor($sFeature);
		$a = $this->profileConfig($sProfile);
		if ('mistral' === $sProfile && !$a['api_key']) {
			throw new LlmException('Für Mistral ist kein API-Key hinterlegt (Admin → Erweiterungen → AI Copilot).', 401, 'provider_not_configured');
		}
		return $this->createLlmClient($a['name'], $a);
	}

	protected function createLlmClient(string $sProfileName, array $aProfile): LlmClient
	{
		return new LlmClient($sProfileName, $aProfile);
	}

	public function FilterAppDataPluginSection(bool $bAdmin, bool $bAuth, array &$aConfig): void
	{
		if ($bAdmin || !$bAuth) {
			return;
		}
		$aFeatures = [];
		foreach (static::FEATURES as $sFeature) {
			$aFeatures[$sFeature] = (bool) $this->conf('feature_' . $sFeature, false);
		}
		$aProviders = [];
		foreach (['default', 'triage', 'search', 'chat'] as $sFeature) {
			$sProfile = $this->profileFor($sFeature);
			$a = $this->profileConfig($sProfile);
			$aProviders[$sFeature] = [
				'name' => $a['name'],
				'model' => $a['model'],
				'local' => 'llmster' === $sProfile,
				'ready' => '' !== $a['model'] && ('llmster' === $sProfile || '' !== $a['api_key'])
			];
		}
		$aConfig['features'] = $aFeatures;
		$aConfig['providers'] = $aProviders;
		$aConfig['storeKeywords'] = (bool) $this->conf('store_keywords', true);

		// Absence means the legacy PHP endpoint. The route is relative so root() can retain a proxy prefix.
		$sDraftProfile = $this->profileFor('draft');
		$aDraftProfile = $this->profileConfig($sDraftProfile);
		$bProviderReady = '' !== $aDraftProfile['model']
			&& ('llmster' === $sDraftProfile || '' !== $aDraftProfile['api_key']);
		if (\AiCopilot\StreamPreparation::enabled()
		 && $bProviderReady
		 && \AiCopilot\StreamPreparation::profileEligible($sDraftProfile, \rtrim($aDraftProfile['base_url'], '/') . '/chat/completions')
		 && \AiCopilot\StreamPreparation::healthy()
		) {
			$aConfig['rustStream'] = ['route' => \AiCopilot\StreamPreparation::ROUTE];
		}
	}

	/* ------------------------------------------------------------------ */
	/* Benutzer, Konto, IMAP                                               */
	/* ------------------------------------------------------------------ */

	private function userSettings(): array
	{
		$a = $this->getUserSettings();
		return [
			'enabled' => $a['enabled'] ?? true,
			'features' => \is_array($a['features'] ?? null) ? $a['features'] : [],
			'tone' => (string) ($a['tone'] ?? 'professional'),
			'language' => (string) ($a['language'] ?? 'auto'),
			'name' => (string) ($a['name'] ?? ''),
			'style' => (string) ($a['style'] ?? ''),
			'addresses' => (string) ($a['addresses'] ?? ''),
			'notice_ack' => !empty($a['notice_ack']),
			'notice_profiles' => \array_values(\array_filter((array) ($a['notice_profiles'] ?? []), 'is_string'))
		];
	}

	/** Every profile the current routing can send mail content to. */
	private function routedProfiles(): array
	{
		$aProfiles = [];
		foreach (['default', 'triage', 'search', 'chat'] as $sFeature) {
			$aProfiles[] = $this->profileFor($sFeature);
		}
		return \array_values(\array_unique($aProfiles));
	}

	private function consentCovers(array $aProfiles): bool
	{
		$aUser = $this->userSettings();
		return !empty($aUser['notice_ack']) && !\array_diff($aProfiles, $aUser['notice_profiles']);
	}

	/** Browser view: a changed provider routing reads as missing consent, so the notice is shown again. */
	private function publicSettings(): array
	{
		$a = $this->userSettings();
		$a['notice_ack'] = $this->consentCovers($this->routedProfiles());
		unset($a['notice_profiles']);
		return $a;
	}

	private function account(): \RainLoop\Model\Account
	{
		return $this->Manager()->Actions()->getAccountFromToken();
	}

	private function mailClient(): \MailSo\Mail\MailClient
	{
		$oActions = $this->Manager()->Actions();
		$oAccount = $this->account();
		if (!$oActions->ImapClient()->IsLoggined()) {
			try {
				$oAccount->ImapConnectAndLogin($oActions->Plugins(), $oActions->ImapClient(), $oActions->Config());
			} catch (\MailSo\Net\Exceptions\ConnectionException $e) {
				throw new \RainLoop\Exceptions\ClientException(\RainLoop\Notifications::ConnectionError, $e);
			} catch (\Throwable $e) {
				throw new \RainLoop\Exceptions\ClientException(\RainLoop\Notifications::AuthError, $e);
			}
		}
		return $oActions->MailClient();
	}

	private function ownAddresses(): array
	{
		$oActions = $this->Manager()->Actions();
		$oAccount = $this->account();
		$a = [\strtolower($oAccount->Email())];
		try {
			foreach ($oActions->GetIdentities($oAccount) as $oIdentity) {
				$a[] = \strtolower($oIdentity->Email());
			}
		} catch (\Throwable $e) {
		}
		foreach (\preg_split('/[\s,;]+/', $this->userSettings()['addresses']) as $s) {
			if (\filter_var($s, FILTER_VALIDATE_EMAIL)) {
				$a[] = \strtolower($s);
			}
		}
		return \array_values(\array_unique(\array_filter($a)));
	}

	private function promptUser(): array
	{
		$a = $this->userSettings();
		$oAccount = $this->account();
		$a['email'] = $oAccount->Email();
		if (!\strlen($a['name'])) {
			// Name aus der ersten Identitaet fuer Grussformeln
			try {
				foreach ($this->Manager()->Actions()->GetIdentities($oAccount) as $oIdentity) {
					$sName = \trim($oIdentity->Name());
					if (\strlen($sName)) {
						$a['name'] = $sName;
						break;
					}
				}
			} catch (\Throwable $e) {
			}
		}
		return $a;
	}

	private function triage(): Triage
	{
		return new Triage($this->ownAddresses(), (int) $this->conf('needs_reply_days', 14));
	}

	/**
	 * Fuehrt eine Aktion aus und wandelt Fehler in eine lesbare Antwort um.
	 */
	private function respond(string $sFunction, callable $fn): array
	{
		try {
			return $this->jsonResponse($sFunction, $fn());
		} catch (LlmException $e) {
			return $this->jsonResponse($sFunction, ['error' => $e->getMessage(), 'status' => $e->getCode(), 'code' => $e->errorCode()]);
		} catch (\RainLoop\Exceptions\ClientException $e) {
			throw $e;
		} catch (\Throwable $e) {
			$this->Manager()->WriteLog('AiCopilot ' . $sFunction . ': operation failed.', \LOG_WARNING);
			return $this->jsonResponse($sFunction, ['error' => 'Interner Fehler.', 'status' => 500, 'code' => 'internal_error']);
		}
	}

	private function requireFeature(string $sFeature): void
	{
		if (!$this->featureOn($sFeature)) {
			throw new LlmException('Diese KI-Funktion ist deaktiviert.', 403, 'feature_disabled');
		}
	}

	private function requireConsent(string $sFeature): void
	{
		if (!$this->consentCovers([$this->profileFor($sFeature)])) {
			throw new LlmException('Bitte bestätigen Sie zuerst den Hinweis zur Übermittlung an den KI-Anbieter in den Einstellungen.', 403, 'consent_required');
		}
	}

	private function paramUids(): array
	{
		$m = $this->jsonParam('uids', []);
		if (!\is_array($m)) {
			$m = \explode(',', (string) $m);
		}
		$a = \array_values(\array_unique(\array_filter(\array_map('intval', $m), fn($i) => $i > 0)));
		$iUid = (int) $this->jsonParam('uid', 0);
		if ($iUid > 0 && !\in_array($iUid, $a, true)) {
			$a[] = $iUid;
		}
		return $a;
	}

	/** "Today" is the user's calendar day, which differs from UTC around midnight. */
	private function localDate(string $sFormat): string
	{
		try {
			$oZone = new \DateTimeZone((string) $this->jsonParam('timezone', 'UTC'));
		} catch (\Throwable $e) {
			$oZone = new \DateTimeZone('UTC');
		}
		return (new \DateTimeImmutable('now', $oZone))->format($sFormat);
	}

	private function paramFolders(): array
	{
		$m = $this->jsonParam('folders', []);
		return \is_array($m) ? \array_values(\array_filter(\array_map('strval', $m))) : [];
	}

	/* ------------------------------------------------------------------ */
	/* Hooks                                                               */
	/* ------------------------------------------------------------------ */

	public function onMessageHeaders(array &$aHeaders): void
	{
		if ($this->conf('feature_triage', true)) {
			foreach (Triage::HEADERS as $sHeader) {
				if (!\in_array($sHeader, $aHeaders, true)) {
					$aHeaders[] = $sHeader;
				}
			}
		}
	}

	public function onAfterMessageList(array &$aResponse): void
	{
		try {
			if ($this->featureOn('triage')) {
				$this->triage()->annotateList($aResponse);
			}
		} catch (\Throwable $e) {
			// Liste nie wegen Kategorien kaputt machen; keine Inhalte oder Interna protokollieren.
			$this->Manager()->WriteLog('AiCopilot triage: annotation failed.', \LOG_WARNING);
		}
	}

	/* ------------------------------------------------------------------ */
	/* Einstellungen                                                       */
	/* ------------------------------------------------------------------ */

	public function DoGetSettings(): array
	{
		return $this->respond(__FUNCTION__, function () {
			$this->account();
			return ['settings' => $this->publicSettings(), 'tones' => \array_keys(Prompts::TONES)];
		});
	}

	public function DoSaveSettings(): array
	{
		return $this->respond(__FUNCTION__, function () {
			$this->account();
			$a = (array) $this->jsonParam('settings', []);
			$aClean = [];
			if (\array_key_exists('enabled', $a)) {
				$aClean['enabled'] = !empty($a['enabled']);
			}
			if (isset($a['features']) && \is_array($a['features'])) {
				$aClean['features'] = [];
				foreach (static::FEATURES as $sFeature) {
					if (\array_key_exists($sFeature, $a['features'])) {
						$aClean['features'][$sFeature] = !empty($a['features'][$sFeature]);
					}
				}
			}
			if (isset($a['tone'])) {
				$aClean['tone'] = isset(Prompts::TONES[$a['tone']]) ? $a['tone'] : 'professional';
			}
			if (isset($a['language'])) {
				$aClean['language'] = \in_array($a['language'], ['auto', 'de', 'en'], true) ? $a['language'] : 'auto';
			}
			foreach (['name' => 100, 'style' => 500, 'addresses' => 500] as $k => $iMax) {
				if (isset($a[$k])) {
					$aClean[$k] = \mb_substr(\trim((string) $a[$k]), 0, $iMax);
				}
			}
			if (isset($a['notice_ack'])) {
				$aClean['notice_ack'] = !empty($a['notice_ack']);
				$aClean['notice_profiles'] = $aClean['notice_ack']
					? \array_values(\array_unique(\array_merge($this->userSettings()['notice_profiles'], $this->routedProfiles())))
					: [];
			}
			return ['saved' => $this->saveUserSettings($aClean), 'settings' => $this->publicSettings()];
		});
	}

	/* ------------------------------------------------------------------ */
	/* 1. Zusammenfassung                                                  */
	/* ------------------------------------------------------------------ */

	public function DoSummarize(): array
	{
		return $this->respond(__FUNCTION__, function () {
			$this->requireFeature('summarize');
			$sFolder = (string) $this->jsonParam('folder', '');
			$aUids = $this->paramUids();
			\sort($aUids);
			$this->requireConsent('summarize');
			$oContext = new MailContext($this->mailClient());
			// A selection is a set of unrelated mails, not one conversation to complete.
			$bSelection = !empty($this->jsonParam('selection', false));
			$aThread = $oContext->threadWithSent($sFolder, $aUids, $bSelection ? '' : (string) $this->jsonParam('sent', ''), (int) $this->conf('context_budget', 12000));
			$oLlm = $this->llm('summarize');
			$a = $oLlm->chatJson(Prompts::summarize($this->promptUser(), $aThread['text'], $bSelection), ['max_tokens' => 1200]);
			$aSummary = [
				'tldr' => \trim((string) ($a['tldr'] ?? '')),
				'points' => static::stringList($a['points'] ?? []),
				'decisions' => static::stringList($a['decisions'] ?? []),
				'actions' => [],
				'next' => \trim((string) ($a['next'] ?? '')),
				'count' => \count($aThread['messages']),
				'model' => $oLlm->profileName() . ' · ' . $oLlm->model()
			];
			foreach ((array) ($a['actions'] ?? []) as $act) {
				if (\is_array($act) && !empty($act['what'])) {
					$aSummary['actions'][] = [
						'who' => \mb_substr((string) ($act['who'] ?? ''), 0, 80),
						'what' => \mb_substr((string) $act['what'], 0, 300),
						'due' => \mb_substr((string) ($act['due'] ?? ''), 0, 40)
					];
				} else if (\is_string($act) && \strlen($act)) {
					$aSummary['actions'][] = ['who' => '', 'what' => \mb_substr($act, 0, 300), 'due' => ''];
				}
			}
			return ['summary' => $aSummary];
		});
	}

	private static function stringList(mixed $m): array
	{
		$a = [];
		foreach ((array) $m as $s) {
			if (\is_string($s) && \strlen(\trim($s))) {
				$a[] = \mb_substr(\trim($s), 0, 500);
			}
		}
		return \array_slice($a, 0, 10);
	}

	/* ------------------------------------------------------------------ */
	/* 2. Entwuerfe                                                        */
	/* ------------------------------------------------------------------ */

	private function draftParams(): array
	{
		$aInput = [];
		foreach (['mode' => 'new', 'tone' => '', 'instruction' => '', 'current' => '', 'wantSubject' => false,
			'folder' => '', 'uids' => [], 'uid' => 0, 'sent' => ''] as $sKey => $mDefault) {
			$aInput[$sKey] = $this->jsonParam($sKey, $mDefault);
		}
		return $aInput;
	}

	/** Shared by DoDraft, ServiceStream and the protected prepare RPC. */
	protected function prepareDraft(array $aInput): array
	{
		$a = DraftRequest::validate($aInput);
		$this->account();
		$this->requireFeature('draft');
		$this->requireConsent('draft');

		$sMode = $a['mode'];
		$aUser = $this->promptUser();
		$sTone = $a['tone'] ?: $aUser['tone'];
		$sInstruction = \trim($a['instruction']);
		$sCurrent = \trim($a['current']);
		$bWantSubject = $a['wantSubject'] && \in_array($sMode, ['new', 'reply'], true);
		$sContext = '';
		// Only a reply is about a mail; a new message must not carry whatever is open.
		if ($a['folder'] && $a['uids'] && 'reply' === $sMode) {
			$oContext = new MailContext($this->mailClient());
			$sContext = $oContext->threadWithSent($a['folder'], $a['uids'], $a['sent'], (int) $this->conf('context_budget', 12000))['text'];
		}
		if ('new' === $sMode && !\strlen($sInstruction) && !\strlen($sCurrent) && !\strlen($sContext)) {
			throw new LlmException('Bitte beschreiben, was die Mail enthalten soll.', 400, 'invalid_request');
		}
		if (\in_array($sMode, ['rewrite', 'proofread'], true) && !\strlen($sCurrent)) {
			throw new LlmException('Kein Text zum Bearbeiten vorhanden.', 400, 'invalid_request');
		}

		$oLlm = $this->llm('draft');
		return [
			'messages' => Prompts::draft($aUser, $sMode, $sTone, $sInstruction, $sContext, $sCurrent, $bWantSubject),
			'wantSubject' => $bWantSubject,
			'client' => $oLlm,
			'model' => $oLlm->profileName() . ' · ' . $oLlm->model(),
			'profile' => $this->profileFor('draft')
		];
	}

	protected function writePrepareResponse(int $iStatus, array $aData): void
	{
		\http_response_code($iStatus);
		echo \json_encode($aData, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
	}

	/** Private PHP -> Rust preparation RPC. It returns before any provider streaming begins. */
	public function ServicePrepare(...$aParts): bool
	{
		while (\ob_get_level()) {
			\ob_end_clean();
		}
		\header_remove('Content-Encoding');
		\header('Content-Type: application/json; charset=utf-8');
		\header('Cache-Control: no-store');

		try {
			if ('POST' !== ($_SERVER['REQUEST_METHOD'] ?? '')) {
				throw new LlmException('Nur POST erlaubt.', 405, 'method_not_allowed');
			}
			if (\AiCopilot\StreamPreparation::INTERNAL_MARKER !== (string) ($_SERVER['SNAPPY_AI_PREPARE'] ?? '')
			 || !\AiCopilot\StreamPreparation::loopbackAddress((string) ($_SERVER['REMOTE_ADDR'] ?? ''))
			) {
				throw new LlmException('Privater Transport erforderlich.', 403, 'prepare_forbidden');
			}
			$sCredential = (string) \getenv('SNAPPY_AI_PROXY_SERVICE_CREDENTIAL');
			$sProvided = (string) ($_SERVER['HTTP_X_SNAPPY_PROXY_KEY'] ?? '');
			if (\strlen($sCredential) < 16 || '' === $sProvided || !\hash_equals($sCredential, $sProvided)) {
				throw new LlmException('Ungültige Dienstberechtigung.', 403, 'prepare_forbidden');
			}
			if (!\AiCopilot\StreamPreparation::enabled()) {
				throw new LlmException('Rust-Streaming ist deaktiviert.', 503, 'prepare_disabled');
			}
			$sRequestId = (string) ($_SERVER['HTTP_X_REQUEST_ID'] ?? '');
			if (!\preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $sRequestId)) {
				throw new LlmException('Ungültige Anfrage.', 400, 'invalid_request');
			}
			\header('X-Request-ID: ' . $sRequestId);
			if (isset($_SERVER['HTTP_SEC_FETCH_SITE']) && 'same-origin' !== \strtolower((string) $_SERVER['HTTP_SEC_FETCH_SITE'])) {
				throw new LlmException('Herkunft der Anfrage nicht erlaubt.', 403, 'cross_site_request');
			}
			$sToken = (string) ($_SERVER['HTTP_X_SM_TOKEN'] ?? '');
			if (!$sToken || !\hash_equals(\RainLoop\Utils::GetCsrfToken(), $sToken)) {
				throw new LlmException('Ungültiges Token.', 403, 'invalid_csrf');
			}
			$iContentLength = null;
			if (isset($_SERVER['CONTENT_LENGTH']) && '' !== (string) $_SERVER['CONTENT_LENGTH']) {
				$sContentLength = (string) $_SERVER['CONTENT_LENGTH'];
				if (!\ctype_digit($sContentLength)) {
					throw new LlmException('Ungültige Anfrage.', 400, 'invalid_request');
				}
				$iContentLength = (int) $sContentLength;
				if ($iContentLength > DraftRequest::MAX_BODY_BYTES) {
					throw new LlmException('Die Anfrage ist zu groß.', 413, 'body_too_large');
				}
			}
			$aBody = DraftRequest::decode($this->readStreamBody(), (string) ($_SERVER['CONTENT_TYPE'] ?? ''), $iContentLength);
			$aPrepared = $this->prepareDraft($aBody);
			$sProfile = $aPrepared['profile'];
			$aTarget = $aPrepared['client']->rustPreparation(false);
			if (!\AiCopilot\StreamPreparation::profileEligible($sProfile, $aTarget['provider_url'])) {
				throw new LlmException('Dieses Anbieterprofil verwendet weiterhin PHP-Streaming.', 422, 'provider_not_eligible');
			}
			$aTarget['allow_local_provider'] = \AiCopilot\StreamPreparation::allowLocalProvider($sProfile, $aTarget['provider_url']);
			$this->writePrepareResponse(200, [
				'account_key' => \AiCopilot\StreamPreparation::accountKey($this->account()->Hash()),
				'messages' => $aPrepared['messages'],
				'provider_url' => $aTarget['provider_url'],
				'api_key' => $aTarget['api_key'],
				'model' => $aTarget['model'],
				'model_label' => $aPrepared['model'],
				'allow_local_provider' => $aTarget['allow_local_provider'],
				'want_subject' => $aPrepared['wantSubject'],
				'options' => $aTarget['options'],
				'timeouts' => $aTarget['timeouts']
			]);
		} catch (LlmException $e) {
			$iStatus = $e->getCode();
			$this->writePrepareResponse($iStatus >= 400 && $iStatus <= 599 ? $iStatus : 400, ['code' => $e->errorCode()]);
		} catch (\RainLoop\Exceptions\ClientException $e) {
			$this->writePrepareResponse(401, ['code' => 'unauthenticated']);
		} catch (\Throwable $e) {
			$this->Manager()->WriteLog('AiCopilot prepare: operation failed.', \LOG_WARNING);
			$this->writePrepareResponse(500, ['code' => 'prepare_failed']);
		}
		return true;
	}

	public static function splitSubject(string $sText, bool $bWantSubject): array
	{
		$sSubject = '';
		if (\preg_match('/^\s*(Betreff|Subject)\s*:\s*(.+?)\s*(\r?\n|$)/iu', $sText, $m)) {
			$sSubject = \trim($m[2]);
			$sText = \ltrim(\substr($sText, \strlen($m[0])));
		}
		return ['subject' => $bWantSubject ? $sSubject : '', 'body' => \trim($sText)];
	}

	public function DoDraft(): array
	{
		return $this->respond(__FUNCTION__, function () {
			$aPrepared = $this->prepareDraft($this->draftParams());
			$sText = $aPrepared['client']->chat($aPrepared['messages'], ['temperature' => 0.4, 'max_tokens' => 1500]);
			return static::splitSubject($sText, $aPrepared['wantSubject']) + ['model' => $aPrepared['model']];
		});
	}

	protected function readStreamBody(): string
	{
		$sBody = \file_get_contents('php://input', false, null, 0, DraftRequest::MAX_BODY_BYTES + 1);
		if (false === $sBody) {
			throw new LlmException('Der Anfrageinhalt konnte nicht gelesen werden.', 400, 'invalid_request');
		}
		return $sBody;
	}

	protected function writeStreamEvent(string $sEvent, array $aData): void
	{
		if (\connection_aborted()) {
			throw new LlmException('Die Client-Verbindung wurde beendet.', 499, 'client_disconnected');
		}
		echo SseEvent::format($sEvent, $aData);
		@\flush();
		if (\connection_aborted()) {
			throw new LlmException('Die Client-Verbindung wurde beendet.', 499, 'client_disconnected');
		}
	}

	/**
	 * Streaming per Server-Sent Events: /?/AiStream/
	 * Ereignisse: delta {text}, done {subject, body, model}, error {error, code}
	 * Fehler bleiben aus Kompatibilitätsgründen HTTP 200 mit SSE-Ereignis.
	 */
	public function ServiceStream(...$aParts): bool
	{
		while (\ob_get_level()) {
			\ob_end_clean();
		}
		\ignore_user_abort(false);
		\header_remove('Content-Encoding');
		\header('Content-Type: text/event-stream; charset=utf-8');
		\header('Cache-Control: no-cache, no-store');
		\header('X-Accel-Buffering: no');
		@\ini_set('zlib.output_compression', '0');
		@\set_time_limit(300);

		$send = function (string $sEvent, array $aData): void {
			$this->writeStreamEvent($sEvent, $aData);
		};
		$sendError = function (string $sMessage, string $sCode) use ($send): void {
			try {
				$send('error', ['error' => $sMessage, 'code' => $sCode]);
			} catch (\Throwable $e) {
				// Ein getrennter Client kann keine Fehlermeldung mehr empfangen.
			}
		};

		try {
			if ('POST' !== ($_SERVER['REQUEST_METHOD'] ?? '')) {
				throw new LlmException('Nur POST erlaubt.', 405, 'method_not_allowed');
			}
			if (isset($_SERVER['HTTP_SEC_FETCH_SITE']) && 'same-origin' !== \strtolower((string) $_SERVER['HTTP_SEC_FETCH_SITE'])) {
				throw new LlmException('Herkunft der Anfrage nicht erlaubt.', 403, 'cross_site_request');
			}
			$sToken = (string) ($_SERVER['HTTP_X_SM_TOKEN'] ?? '');
			if (!$sToken || !\hash_equals(\RainLoop\Utils::GetCsrfToken(), $sToken)) {
				throw new LlmException('Ungültiges Token.', 403, 'invalid_csrf');
			}
			$iContentLength = null;
			if (isset($_SERVER['CONTENT_LENGTH']) && '' !== (string) $_SERVER['CONTENT_LENGTH']) {
				$sContentLength = (string) $_SERVER['CONTENT_LENGTH'];
				if (!\ctype_digit($sContentLength)) {
					throw new LlmException('Ungültige Anfrage.', 400, 'invalid_request');
				}
				$iContentLength = (int) $sContentLength;
				if ($iContentLength > DraftRequest::MAX_BODY_BYTES) {
					throw new LlmException('Die Anfrage ist zu groß.', 413, 'body_too_large');
				}
			}
			$aBody = DraftRequest::decode($this->readStreamBody(), (string) ($_SERVER['CONTENT_TYPE'] ?? ''), $iContentLength);
			$aPrepared = $this->prepareDraft($aBody);
			$send('start', ['model' => $aPrepared['model']]);
			$sText = $aPrepared['client']->stream($aPrepared['messages'], function (string $sDelta) use ($send): void {
				$send('delta', ['text' => $sDelta]);
			}, ['temperature' => 0.4, 'max_tokens' => 1500]);
			$send('done', static::splitSubject($sText, $aPrepared['wantSubject']) + ['model' => $aPrepared['model']]);
		} catch (LlmException $e) {
			if (499 === $e->getCode() || \connection_aborted()) {
				return true;
			}
			$sendError($e->getMessage(), $e->errorCode());
		} catch (\Throwable $e) {
			if (\connection_aborted()) {
				return true;
			}
			$this->Manager()->WriteLog('AiCopilot stream: operation failed.', \LOG_WARNING);
			$sendError(
				$e instanceof \RainLoop\Exceptions\ClientException ? 'Nicht angemeldet oder Sitzung abgelaufen.' : 'Interner Fehler.',
				$e instanceof \RainLoop\Exceptions\ClientException ? 'unauthenticated' : 'internal_error'
			);
		}
		return true;
	}

	/* ------------------------------------------------------------------ */
	/* 3. Antwortvorschlaege                                               */
	/* ------------------------------------------------------------------ */

	public function DoQuickReplies(): array
	{
		return $this->respond(__FUNCTION__, function () {
			$this->requireFeature('quick_replies');
			$sFolder = (string) $this->jsonParam('folder', '');
			$aUids = $this->paramUids();
			$aUser = $this->promptUser();
			\sort($aUids);
			$this->requireConsent('quick_replies');
			$oContext = new MailContext($this->mailClient());
			$aThread = $oContext->threadWithSent($sFolder, $aUids, (string) $this->jsonParam('sent', ''), (int) \min(8000, $this->conf('context_budget', 12000)));
			$a = $this->llm('quick_replies')->chatJson(Prompts::quickReplies($aUser, $aThread['text'], $aUser['tone']), ['temperature' => 0.5, 'max_tokens' => 1800]);
			$aReplies = [];
			foreach ((array) ($a['replies'] ?? []) as $r) {
				if (\is_array($r) && !empty($r['body'])) {
					$aReplies[] = [
						'label' => \mb_substr(\trim((string) ($r['label'] ?? '')), 0, 40) ?: 'Antwort',
						'body' => \mb_substr(\trim((string) $r['body']), 0, 4000)
					];
				}
			}
			$aReplies = \array_slice($aReplies, 0, 3);
			if (!$aReplies) {
				throw new LlmException('Keine Vorschläge erhalten.', 502);
			}
			return ['replies' => $aReplies];
		});
	}

	/* ------------------------------------------------------------------ */
	/* 4. Suche                                                            */
	/* ------------------------------------------------------------------ */

	public function DoSearch(): array
	{
		return $this->respond(__FUNCTION__, function () {
			$this->requireFeature('search');
			$this->account();
			$sQuery = \trim((string) $this->jsonParam('query', ''));
			if (!\strlen($sQuery)) {
				throw new LlmException('Leere Anfrage.', 400);
			}
			$this->requireConsent('search');
			$aFolders = $this->paramFolders();
			$sCurrent = (string) $this->jsonParam('currentFolder', 'INBOX');
			$sToday = $this->localDate('Y-m-d (l)');
			$a = $this->llm('search')->chatJson(Prompts::search($this->promptUser(), $sQuery, $aFolders, $sToday, $sCurrent), ['temperature' => 0, 'max_tokens' => 400]);
			$sSearch = Mailbox::sanitizeSearch((string) ($a['search'] ?? ''));
			$sFolder = (string) ($a['folder'] ?? '');
			if ($sFolder && !\in_array($sFolder, $aFolders, true)) {
				$sFolder = '';
			}
			if (!\strlen($sSearch)) {
				throw new LlmException('Die Anfrage konnte nicht in eine Suche übersetzt werden.', 422);
			}
			// Kategorie-Suche braucht gesetzte Schlagwoerter
			$sTagFolder = $sFolder ?: $sCurrent;
			if (\str_contains($sSearch, 'keyword:$ai_') && $this->featureOn('triage') && $this->conf('store_keywords', true)) {
				try {
					(new Mailbox($this->mailClient(), $this->triage()))->tagByRules($sTagFolder, 300, (string) $this->jsonParam('sent', ''));
				} catch (\Throwable $e) {
				}
			}
			return [
				'search' => $sSearch,
				'folder' => $sFolder,
				'explanation' => \mb_substr(\trim((string) ($a['explanation'] ?? '')), 0, 300)
			];
		});
	}

	/* ------------------------------------------------------------------ */
	/* 5. Kategorien                                                       */
	/* ------------------------------------------------------------------ */

	public function DoTriageTag(): array
	{
		return $this->respond(__FUNCTION__, function () {
			$this->requireFeature('triage');
			if (!$this->conf('store_keywords', true)) {
				throw new LlmException('Das Speichern von Kategorien als Schlagwörter ist deaktiviert.', 403);
			}
			$sFolder = (string) $this->jsonParam('folder', 'INBOX');
			$iLimit = \max(20, \min(500, (int) $this->jsonParam('limit', 300)));
			try {
				return (new Mailbox($this->mailClient(), $this->triage()))->tagByRules($sFolder, $iLimit, (string) $this->jsonParam('sent', ''));
			} catch (\MailSo\RuntimeException $e) {
				throw new LlmException('Der Mailserver erlaubt keine eigenen Schlagwörter in diesem Ordner.', 422);
			}
		});
	}

	public function DoTriageLlm(): array
	{
		return $this->respond(__FUNCTION__, function () {
			$this->requireFeature('triage');
			$this->requireFeature('triage_llm');
			$this->requireConsent('triage');
			$sFolder = (string) $this->jsonParam('folder', 'INBOX');
			// Kopfdaten der sichtbaren Liste kommen vom Browser (eigene Mails des Benutzers)
			$aItems = [];
			foreach (\array_slice((array) $this->jsonParam('items', []), 0, 60) as $it) {
				$iUid = (int) ($it['uid'] ?? 0);
				if ($iUid > 0) {
					$aItems[] = [
						'uid' => $iUid,
						'from' => (string) ($it['from'] ?? ''),
						'to' => (string) ($it['to'] ?? ''),
						'cc' => (string) ($it['cc'] ?? ''),
						'subject' => (string) ($it['subject'] ?? ''),
						'preview' => (string) ($it['preview'] ?? ''),
						'bulk' => !empty($it['bulk'])
					];
				}
			}
			if (!$aItems) {
				throw new LlmException('Keine Mails in der Liste.', 400);
			}
			$aUids = \array_column($aItems, 'uid');
			$oMailbox = new Mailbox($this->mailClient(), $this->triage());
			$a = $this->llm('triage')->chatJson(Prompts::triage($this->promptUser(), $aItems), ['temperature' => 0, 'max_tokens' => 2000]);
			$aMap = [];
			foreach ((array) ($a['items'] ?? []) as $it) {
				$iUid = (int) ($it['uid'] ?? 0);
				$sCat = (string) ($it['category'] ?? '');
				if (\in_array($iUid, $aUids, true) && \in_array($sCat, Triage::CATEGORIES, true)) {
					$aMap[$iUid] = $sCat;
				}
			}
			$iStored = 0;
			$sError = '';
			if ($aMap && $this->conf('store_keywords', true)) {
				try {
					$iStored = $oMailbox->setCategories($sFolder, $aMap);
				} catch (\Throwable $e) {
					$sError = 'Kategorien konnten nicht gespeichert werden (Schlagwörter nicht erlaubt).';
				}
			}
			return ['categories' => $aMap, 'stored' => $iStored, 'warning' => $sError];
		});
	}

	/* ------------------------------------------------------------------ */
	/* 6. Chat                                                             */
	/* ------------------------------------------------------------------ */

	public function DoChat(): array
	{
		return $this->respond(__FUNCTION__, function () {
			$this->requireFeature('chat');
			$aHistory = Chat::cleanHistory((array) $this->jsonParam('messages', []));
			if (!$aHistory) {
				throw new LlmException('Leere Nachricht.', 400);
			}
			$this->requireConsent('chat');
			$aFolders = $this->paramFolders();
			if (!\in_array('INBOX', $aFolders, true)) {
				$aFolders[] = 'INBOX';
			}
			$oMailClient = $this->mailClient();
			$oTriage = $this->triage();
			$oMailbox = new Mailbox($oMailClient, $oTriage);
			$oContext = new MailContext($oMailClient);
			$sContext = '';
			$aKnown = \array_map('strval', \array_slice((array) $this->jsonParam('known', []), -Chat::MAX_KNOWN));
			$aCtx = (array) $this->jsonParam('context', []);
			if (!empty($aCtx['folder']) && !empty($aCtx['uid'])) {
				try {
					$m = $oContext->message((string) $aCtx['folder'], (int) $aCtx['uid']);
					$sContext = "folder: {$m['folder']}, uid: {$m['uid']}\nVon: {$m['from']}\nAn: {$m['to']}\nDatum: "
						. ($m['date'] ? \gmdate('Y-m-d H:i', $m['date']) : '') . "\nBetreff: {$m['subject']}\n\n"
						. \mb_substr($m['body'], 0, 4000);
					$aKnown[] = $m['folder'] . '|' . $m['uid'];
				} catch (\Throwable $e) {
				}
			}
			$bTag = $this->featureOn('triage') && $this->conf('store_keywords', true);
			$oChat = new Chat($this->llm('chat'), $oMailbox, $oContext, $aFolders,
				$bTag ? function (string $sFolder) use ($oMailbox) {
					$oMailbox->tagByRules($sFolder, 300, (string) $this->jsonParam('sent', ''));
				} : null);
			$aSystem = Prompts::chat($this->promptUser(), $sContext, $this->localDate('Y-m-d (l)'), $aFolders, $aKnown);
			return $oChat->run($aSystem, $aHistory, $aKnown);
		});
	}

	/* ------------------------------------------------------------------ */
	/* 7. Hinweise                                                         */
	/* ------------------------------------------------------------------ */

	public function DoAlerts(): array
	{
		return $this->respond(__FUNCTION__, function () {
			$this->requireFeature('alerts');
			$sInbox = (string) $this->jsonParam('inbox', 'INBOX') ?: 'INBOX';
			$sSent = (string) $this->jsonParam('sent', '');
			$oMailbox = new Mailbox($this->mailClient(), $this->triage());
			return ['alerts' => (new Alerts($oMailbox, $this->ownAddresses()))->collect($sInbox, $sSent)];
		});
	}

	public function DoAlertsLlm(): array
	{
		return $this->respond(__FUNCTION__, function () {
			$this->requireFeature('alerts');
			$this->requireConsent('alerts');
			$aItems = \array_slice((array) $this->jsonParam('items', []), 0, 8);
			$oContext = new MailContext($this->mailClient());
			$aParts = [];
			$aKnown = [];
			foreach ($aItems as $it) {
				$sFolder = (string) ($it['folder'] ?? '');
				$iUid = (int) ($it['uid'] ?? 0);
				if (!$sFolder || $iUid < 1) {
					continue;
				}
				try {
					$m = $oContext->message($sFolder, $iUid);
				} catch (\Throwable $e) {
					continue;
				}
				$aKnown[$iUid] = $sFolder;
				$aParts[] = "--- uid {$iUid} ---\nVon: {$m['from']}\nDatum: " . ($m['date'] ? \gmdate('Y-m-d', $m['date']) : '')
					. "\nBetreff: {$m['subject']}\n\n" . \mb_substr($m['body'], 0, 1500);
			}
			if (!$aParts) {
				return ['alerts' => []];
			}
			$a = $this->llm('alerts')->chatJson(Prompts::alertsExtract($this->promptUser(), \implode("\n\n", $aParts), $this->localDate('Y-m-d')), ['temperature' => 0, 'max_tokens' => 1000]);
			$aResult = [];
			foreach ((array) ($a['alerts'] ?? []) as $al) {
				$iUid = (int) ($al['uid'] ?? 0);
				if (isset($aKnown[$iUid]) && !empty($al['title'])) {
					$aResult[] = [
						'uid' => $iUid,
						'folder' => $aKnown[$iUid],
						'title' => \mb_substr((string) $al['title'], 0, 200),
						'due' => \preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($al['due'] ?? '')) ? $al['due'] : ''
					];
				}
			}
			return ['alerts' => $aResult];
		});
	}
}
