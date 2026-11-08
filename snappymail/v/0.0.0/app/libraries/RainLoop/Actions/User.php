<?php

namespace RainLoop\Actions;

use RainLoop\Enumerations\Capa;
use RainLoop\Exceptions\ClientException;
use RainLoop\Notifications;
use RainLoop\Providers\Suggestions;
use RainLoop\Utils;

trait User
{
	use Accounts;
	use Contacts;
	use Filters;
	use Folders;
	use Messages;
	use Attachments;
	use Pgp;
	use SMime;

	private ?Suggestions $oSuggestionsProvider = null;

	public function SuggestionsProvider(): Suggestions
	{
		if (null === $this->oSuggestionsProvider) {
			$this->oSuggestionsProvider = new Suggestions($this->fabrica('suggestions'));
		}

		return $this->oSuggestionsProvider;
	}

	/**
	 * @throws \MailSo\RuntimeException
	 */
	public function DoLogin() : array
	{
		try {
			$oAccount = $this->LoginProcess(
				\MailSo\Base\Utils::Trim($this->GetActionParam('Email', '')),
				new \SnappyMail\SensitiveString($this->GetActionParam('Password', ''))
			);
		} catch (\Throwable $oException) {
			$this->loginErrorDelay();
			throw $oException;
		}

		empty($this->GetActionParam('signMe', 0)) || $this->SetSignMeToken($oAccount);

		$sLanguage = $this->GetActionParam('language', '');
		if ($oAccount && $sLanguage) {
			$oSettings = $this->SettingsProvider()->Load($oAccount);
			if ($oSettings) {
				$sLanguage = $this->ValidateLanguage($sLanguage);
				$sCurrentLanguage = $oSettings->GetConf('language', '');

				if ($sCurrentLanguage !== $sLanguage) {
					$oSettings->SetConf('language', $sLanguage);
					$oSettings->save();
				}
			}
		}

		return $this->DefaultResponse($this->AppData(false));
	}

	public function DoLogout() : array
	{
		$bMain = true; // empty($_COOKIE[self::AUTH_ADDITIONAL_TOKEN_KEY]);
		$this->Logout($bMain);
		$bMain && $this->ClearSignMeData();
		return $this->TrueResponse();
	}

	public function DoAppDelayStart() : array
	{
		Utils::UpdateConnectionToken();

		$sCachePath = \RainLoop\Maintenance\Service::configuredCachePath($this->Config(), $this->Cacher());
		$oMaintenance = new \RainLoop\Maintenance\Service(\APP_PRIVATE_DATA, $sCachePath);
		return $this->DefaultResponse($oMaintenance->run());
	}

	public function DoSettingsUpdate() : array
	{
		$oAccount = $this->getAccountFromToken();

		$self = $this;
		$oConfig = $this->Config();

		$oSettings = $this->SettingsProvider()->Load($oAccount);
		$oSettingsLocal = $this->SettingsProvider(true)->Load($oAccount);

		if ($oConfig->Get('webmail', 'allow_languages_on_settings', true)) {
			$this->setSettingsFromParams($oSettings, 'language', 'string', function ($sLanguage) use ($self) {
				return $self->ValidateLanguage($sLanguage);
			});
		} else {
//			$oSettings->SetConf('language', $this->ValidateLanguage($oConfig->Get('webmail', 'language', 'en')));
		}
		$this->setSettingsFromParams($oSettings, 'hourCycle', 'string');

		if ($this->GetCapa(Capa::THEMES)) {
			$this->setSettingsFromParams($oSettingsLocal, 'Theme', 'string', function ($sTheme) use ($self) {
				return $self->ValidateTheme($sTheme);
			});
			$this->setSettingsFromParams($oSettings, 'fontSansSerif', 'string');
			$this->setSettingsFromParams($oSettings, 'fontSerif', 'string');
			$this->setSettingsFromParams($oSettings, 'fontMono', 'string');
		} else {
//			$oSettingsLocal->SetConf('Theme', $this->ValidateTheme($oConfig->Get('webmail', 'theme', 'Default')));
		}

		$this->setSettingsFromParams($oSettings, 'MessagesPerPage', 'int', function ($iValue) {
			return \min(100, \max(10, $iValue));
		});

		$this->setSettingsFromParams($oSettings, 'Layout', 'int',
			fn(int $iValue) => (
				\RainLoop\Enumerations\Layout::tryFrom($iValue) ?: \RainLoop\Enumerations\Layout::SIDE_PREVIEW
			)->value
		);

		$this->setSettingsFromParams($oSettings, 'EditorDefaultType', 'string');
		$this->setSettingsFromParams($oSettings, 'editorWysiwyg', 'string');
		$this->setSettingsFromParams($oSettings, 'requestReadReceipt', 'bool');
		$this->setSettingsFromParams($oSettings, 'requestDsn', 'bool');
		$this->setSettingsFromParams($oSettings, 'requireTLS', 'bool');
		$this->setSettingsFromParams($oSettings, 'pgpSign', 'bool');
		$this->setSettingsFromParams($oSettings, 'pgpEncrypt', 'bool');
		$this->setSettingsFromParams($oSettings, 'allowSpellcheck', 'bool');

		$this->setSettingsFromParams($oSettings, 'ViewHTML', 'bool');
		$this->setSettingsFromParams($oSettings, 'ViewImages', 'string');
		$this->setSettingsFromParams($oSettings, 'ViewImagesWhitelist', 'string');
		$this->setSettingsFromParams($oSettings, 'RemoveColors', 'bool');
		$this->setSettingsFromParams($oSettings, 'AllowStyles', 'bool');
		$this->setSettingsFromParams($oSettings, 'ListInlineAttachments', 'bool');
		$this->setSettingsFromParams($oSettings, 'CollapseBlockquotes', 'bool');
		$this->setSettingsFromParams($oSettings, 'MaxBlockquotesLevel', 'int');
		$this->setSettingsFromParams($oSettings, 'minFontSize', 'int');
		$this->setSettingsFromParams($oSettings, 'simpleAttachmentsList', 'bool');
		$this->setSettingsFromParams($oSettings, 'listGrouped', 'bool');
		$this->setSettingsFromParams($oSettings, 'ContactsAutosave', 'bool');
		$this->setSettingsFromParams($oSettings, 'DesktopNotifications', 'bool');
		$this->setSettingsFromParams($oSettings, 'SoundNotification', 'bool');
		$this->setSettingsFromParams($oSettings, 'NotificationSound', 'string');
		$this->setSettingsFromParams($oSettings, 'UseCheckboxesInList', 'bool');
		$this->setSettingsFromParams($oSettings, 'AllowDraftAutosave', 'bool');
		$this->setSettingsFromParams($oSettings, 'AutoLogout', 'int');
		$this->setSettingsFromParams($oSettings, 'keyPassForget', 'int');
		$this->setSettingsFromParams($oSettings, 'messageNewWindow', 'bool');
		$this->setSettingsFromParams($oSettings, 'messageReadAuto', 'bool');
		$this->setSettingsFromParams($oSettings, 'MessageReadDelay', 'int');
		$this->setSettingsFromParams($oSettings, 'MsgDefaultAction', 'int');
		$this->setSettingsFromParams($oSettings, 'showNextMessage', 'bool');
		$this->setSettingsFromParams($oSettings, 'markdown', 'bool');

		$this->setSettingsFromParams($oSettings, 'Resizer4Width', 'int');
		$this->setSettingsFromParams($oSettings, 'Resizer5Width', 'int');
		$this->setSettingsFromParams($oSettings, 'Resizer5Height', 'int');

		$this->setSettingsFromParams($oSettingsLocal, 'defaultSort', 'string');
		$this->setSettingsFromParams($oSettingsLocal, 'UseThreads', 'bool');
		$this->setSettingsFromParams($oSettingsLocal, 'threadAlgorithm', 'string');
		$this->setSettingsFromParams($oSettingsLocal, 'ReplySameFolder', 'bool');
		$this->setSettingsFromParams($oSettingsLocal, 'HideUnsubscribed', 'bool');
		$this->setSettingsFromParams($oSettingsLocal, 'HideDeleted', 'bool');
		$this->setSettingsFromParams($oSettingsLocal, 'UnhideKolabFolders', 'bool');
		$this->setSettingsFromParams($oSettingsLocal, 'ShowUnreadCount', 'bool');
		$this->setSettingsFromParams($oSettingsLocal, 'CheckMailInterval', 'int');

		return $this->DefaultResponse($oSettings->save() && $oSettingsLocal->save());
	}

	public function DoQuota() : array
	{
		$oAccount = $this->initMailClientConnection();
		try
		{
			return $this->DefaultResponse($this->ImapClient()->QuotaRoot() ?: [0, 0, 0, 0]);
		}
		catch (\Throwable $oException)
		{
			throw new ClientException(Notifications::MailServerError, $oException);
		}
	}

	public function DoSuggestions() : array
	{
		$oAccount = $this->getAccountFromToken();

		$sQuery = \trim($this->GetActionParam('Query', ''));
		$iLimit = (int) $this->Config()->Get('contacts', 'suggestions_limit', 20);

		$this->Plugins()->RunHook('json.suggestions-input-parameters', array(&$sQuery, &$iLimit, $oAccount));

		$aResult = array();

		if ($oSuggestionsProvider = $this->SuggestionsProvider()) {
			$aResult = $oSuggestionsProvider->Process($oAccount, $sQuery, $iLimit);
		}

		return $this->DefaultResponse($aResult);
	}

	public function DoClearUserBackground() : array
	{
		if (!$this->GetCapa(Capa::USER_BACKGROUND)) {
			return $this->FalseResponse();
		}

		$oAccount = $this->getAccountFromToken();
		$oSettings = $this->SettingsProvider()->Load($oAccount);
		if ($oAccount && $oSettings) {
			$this->StorageProvider()->Clear($oAccount,
				\RainLoop\Providers\Storage\Enumerations\StorageType::CONFIG,
				'background'
			);

			$oSettings->SetConf('UserBackgroundName', '');
			$oSettings->SetConf('UserBackgroundHash', '');
		}

		return $this->DefaultResponse($oAccount && $oSettings ? $oSettings->save() : false);
	}

	private function setSettingsFromParams(\RainLoop\Settings $oSettings, string $sConfigName, string $sType = 'string', ?callable $cCallback = null) : void
	{
		if ($this->HasActionParam($sConfigName)) {
			$sValue = $this->GetActionParam($sConfigName, '');
			switch ($sType)
			{
				default:
				case 'string':
					$sValue = (string) $sValue;
					if ($cCallback) {
						$sValue = $cCallback($sValue);
					}
					$oSettings->SetConf($sConfigName, (string) $sValue);
					break;

				case 'int':
					$iValue = (int) $sValue;
					if ($cCallback) {
						$sValue = $cCallback($iValue);
					}
					$oSettings->SetConf($sConfigName, $iValue);
					break;

				case 'bool':
					$oSettings->SetConf($sConfigName, !empty($sValue) && 'false' !== $sValue);
					break;
			}
		}
	}
}
