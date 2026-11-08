<?php

namespace AiCopilot;

class LlmException extends \RuntimeException
{
	private string $sErrorCode;

	public function __construct(string $sMessage = '', int $iStatus = 0, string $sErrorCode = 'llm_error', ?\Throwable $oPrevious = null)
	{
		parent::__construct($sMessage, $iStatus, $oPrevious);
		$this->sErrorCode = $sErrorCode;
	}

	public function errorCode(): string
	{
		return $this->sErrorCode;
	}
}
