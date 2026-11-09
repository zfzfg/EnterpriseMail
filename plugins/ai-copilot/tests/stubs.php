<?php

/** Minimal framework doubles; no SnappyMail bootstrap, network, or provider SDK. */
namespace RainLoop\Plugins {
	abstract class AbstractPlugin
	{
		public array $params = [];
		public array $settings = [];
		public array $config = [];
		public array $logs = [];
		public int $cacherCalls = 0;
		public ?\Throwable $accountException = null;

		public function __construct()
		{
		}

		public function ConfigProperties(): iterable
		{
			return [];
		}

		public function Config(): \RainLoop\Config\Plugin
		{
			return new \RainLoop\Config\Plugin($this);
		}

		public function Manager(): Manager
		{
			return new Manager($this);
		}

		protected function jsonResponse(string $sFunction, mixed $mData): array
		{
			return $mData;
		}

		public function jsonParam(string $sKey, mixed $mDefault = null): mixed
		{
			return \array_key_exists($sKey, $this->params) ? $this->params[$sKey] : $mDefault;
		}

		public function getUserSettings(): array
		{
			return $this->settings;
		}

		public function saveUserSettings(array $aSettings): bool
		{
			$this->settings = \array_merge($this->settings, $aSettings);
			return true;
		}
	}

	class Manager
	{
		public function __construct(private AbstractPlugin $oPlugin)
		{
		}

		public function Actions(): \RainLoop\Actions
		{
			return new \RainLoop\Actions($this->oPlugin);
		}

		public function WriteLog(string $sMessage, int $iLevel): void
		{
			$this->oPlugin->logs[] = $sMessage;
		}
	}
}

namespace RainLoop\Config {
	class Plugin
	{
		public function __construct(private \RainLoop\Plugins\AbstractPlugin $oPlugin)
		{
		}

		public function Get(string $sSection, string $sName, mixed $mDefault = null): mixed
		{
			return \array_key_exists($sName, $this->oPlugin->config) ? $this->oPlugin->config[$sName] : $mDefault;
		}

		public function getDecrypted(string $sSection, string $sName, mixed $mDefault = null): mixed
		{
			return $this->Get($sSection, $sName, $mDefault);
		}
	}
}

namespace RainLoop {
	class Actions
	{
		public function __construct(private \RainLoop\Plugins\AbstractPlugin $oPlugin)
		{
		}

		public function getAccountFromToken(): \RainLoop\Model\Account
		{
			if ($this->oPlugin->accountException) {
				throw $this->oPlugin->accountException;
			}
			return new \RainLoop\Model\Account();
		}

		public function GetIdentities(\RainLoop\Model\Account $oAccount): array
		{
			return [];
		}

		public function Cacher(\RainLoop\Model\Account $oAccount): never
		{
			++$this->oPlugin->cacherCalls;
			throw new \RuntimeException('No cache in unit tests.');
		}
	}

	class Utils
	{
		public static function GetCsrfToken(): string
		{
			return 'test-token';
		}
	}
}

namespace MailSo\Imap {
	class SearchCriterias
	{
		public const RegEx = 'from|to|subject|text|body|has|is|since|before|on|sentsince|sentbefore|senton|newer_than|older_than|larger|smaller|keyword';

		public static function escapeSearchString(object $oImapClient, string $sValue): string
		{
			return '"' . $sValue . '"';
		}
	}
}

namespace MailSo\Mail {
	/** Serves canned messages and answers Message-ID searches, recording what was asked. */
	class MailClient
	{
		public array $searches = [];
		public array $examined = [];
		public array $messagesByFolder = [];

		public function ImapClient(): self
		{
			return $this;
		}

		public function FolderExamine(string $sFolder): void
		{
			$this->examined[] = $sFolder;
		}

		public function MessageSearch(string $sSearch, bool $bUid): array
		{
			$this->searches[] = $sSearch;
			$sFolder = (string) \end($this->examined);
			$aUids = [];
			foreach ($this->messagesByFolder[$sFolder] ?? [] as $iUid => $aMessage) {
				if (\str_contains($sSearch, '"' . \trim($aMessage['messageId'], '<>') . '"')) {
					$aUids[] = $iUid;
				}
			}
			return $aUids;
		}

		public function Message(string $sFolder, int $iUid, bool $bBody): ?array
		{
			return $this->messagesByFolder[$sFolder][$iUid] ?? null;
		}
	}
}

namespace RainLoop\Model {
	class Account
	{
		public function Email(): string
		{
			return 'test@example.com';
		}

		public function Hash(): string
		{
			return 'test-account';
		}
	}
}

namespace RainLoop\Exceptions {
	class ClientException extends \RuntimeException
	{
	}
}
