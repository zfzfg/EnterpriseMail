<?php

declare(strict_types=1);

require __DIR__ . '/stubs.php';
require \dirname(__DIR__) . '/index.php';

use AiCopilot\DraftRequest;
use AiCopilot\LlmClient;
use AiCopilot\LlmException;
use AiCopilot\SseEvent;
use AiCopilot\SseParser;

$iAssertions = 0;

function check(bool $bCondition, string $sMessage): void
{
	global $iAssertions;
	++$iAssertions;
	if (!$bCondition) {
		throw new \RuntimeException($sMessage);
	}
}

function same(mixed $mExpected, mixed $mActual, string $sMessage): void
{
	check($mExpected === $mActual, $sMessage . '\nExpected: ' . \json_encode($mExpected, JSON_UNESCAPED_UNICODE)
		. '\nActual: ' . \json_encode($mActual, JSON_UNESCAPED_UNICODE));
}

function expectLlm(string $sCode, callable $fCall): LlmException
{
	try {
		$fCall();
	} catch (LlmException $e) {
		same($sCode, $e->errorCode(), 'Unexpected exception code.');
		return $e;
	}
	throw new \RuntimeException('Expected LlmException ' . $sCode . '.');
}

function mockProfile(): array
{
	return [
		'base_url' => 'https://mock.invalid/v1',
		'model' => 'mock-model',
		'api_key' => 'test-only-key',
		'timeout' => 5,
		'json_mode' => 'json_object'
	];
}

function mockClient(callable $fTransport): LlmClient
{
	return new LlmClient('Mock', mockProfile(), $fTransport);
}

function streamResult(array $aChunks, bool $bByteWise = false): array
{
	$iCalls = 0;
	$aPayloads = [];
	$oClient = mockClient(function (array $aPayload, ?callable $fWrite) use (&$iCalls, &$aPayloads, $aChunks, $bByteWise): array {
		++$iCalls;
		$aPayloads[] = $aPayload;
		if ($bByteWise) {
			$aChunks = \str_split(\implode('', $aChunks));
		}
		foreach ($aChunks as $sChunk) {
			$fWrite($sChunk);
		}
		return [200, ''];
	});
	$aDeltas = [];
	try {
		$sText = $oClient->stream([['role' => 'user', 'content' => 'deterministic fixture']], function (string $sDelta) use (&$aDeltas): void {
			$aDeltas[] = $sDelta;
		});
		return ['text' => $sText, 'deltas' => $aDeltas, 'calls' => $iCalls, 'payloads' => $aPayloads];
	} catch (LlmException $e) {
		return ['exception' => $e, 'deltas' => $aDeltas, 'calls' => $iCalls, 'payloads' => $aPayloads];
	}
}

/* Request body, media type, schema, UTF-8, field and UID boundaries. */
$aValid = DraftRequest::decode(\json_encode([
	'mode' => 'reply', 'tone' => 'freundlich ✓', 'instruction' => 'Antworte kurz.',
	'current' => 'Entwurf', 'wantSubject' => true, 'folder' => 'INBOX',
	'uids' => [1, 2, 1, 4294967295], 'uid' => 3, 'sent' => 'Sent'
], JSON_UNESCAPED_UNICODE), 'application/json; charset=UTF-8');
same('reply', $aValid['mode'], 'Valid mode was not retained.');
same([1, 2, 4294967295, 3], $aValid['uids'], 'UID normalization changed unexpectedly.');
same(true, $aValid['wantSubject'], 'Boolean type was not retained.');
foreach (['new', 'reply', 'rewrite', 'proofread'] as $sMode) {
	same($sMode, DraftRequest::validate(['mode' => $sMode])['mode'], 'Draft mode rejected.');
}
same([], DraftRequest::decode('{}', 'APPLICATION/JSON')['uids'], 'Empty object or media-type case rejected.');

foreach (['text/plain', 'application/json-patch+json', 'application/json; charset=iso-8859-1', 'application/json; boundary=x', ''] as $sType) {
	expectLlm('invalid_content_type', fn() => DraftRequest::decode('{}', $sType));
}
foreach (['{', ''] as $sBody) {
	expectLlm('invalid_json', fn() => DraftRequest::decode($sBody, 'application/json'));
}
foreach (['[]', 'null', '"text"', '[1]'] as $sBody) {
	expectLlm('invalid_request', fn() => DraftRequest::decode($sBody, 'application/json'));
}
expectLlm('invalid_json', fn() => DraftRequest::decode("{\"instruction\":\"\xB1\"}", 'application/json'));
expectLlm('body_too_large', fn() => DraftRequest::decode(\str_repeat(' ', DraftRequest::MAX_BODY_BYTES + 1), 'application/json'));
expectLlm('body_too_large', fn() => DraftRequest::decode('{}', 'application/json', DraftRequest::MAX_BODY_BYTES + 1));
expectLlm('body_too_large', fn() => DraftRequest::decode('{}', 'application/json', -1));
expectLlm('invalid_json', fn() => DraftRequest::decode(\str_repeat(' ', DraftRequest::MAX_BODY_BYTES), 'application/json'));

$aInvalidInputs = [
	['base_url' => 'https://attacker.invalid'],
	['notice_ack' => true],
	['mode' => 'invalid'],
	['mode' => null],
	['wantSubject' => 1],
	['current' => []],
	['instruction' => null],
	['uids' => '1,2'],
	['uids' => [0]],
	['uids' => ['1']],
	['uids' => [1.0]],
	['uids' => [4294967296]],
	['uids' => \range(1, DraftRequest::MAX_UIDS + 1)],
	['uids' => [1 => 1]],
	['uid' => -1],
	['tone' => \str_repeat('ä', 201)],
	['instruction' => \str_repeat('ä', 2001)],
	['current' => \str_repeat('ä', 8001)],
	['folder' => \str_repeat('ä', 513)],
	['sent' => \str_repeat('ä', 513)]
];
foreach ($aInvalidInputs as $aInput) {
	try {
		DraftRequest::validate($aInput);
		throw new \RuntimeException('Invalid draft input accepted: ' . \json_encode($aInput));
	} catch (LlmException $e) {
		check(400 === $e->getCode(), 'Invalid input did not produce a client error.');
	}
}

/* Downstream golden wire format and subject compatibility. */
same("event: delta\ndata: {\"text\":\"Grüße ✓\\nZeile\"}\n\n", SseEvent::format('delta', ['text' => "Grüße ✓\nZeile"]), 'SSE golden format changed.');
same(['subject' => 'Grüße ✓', 'body' => 'Text'], AiCopilotPlugin::splitSubject(" \nBetreff: Grüße ✓\r\n\r\n Text ", true), 'Subject splitting changed.');
same(['subject' => '', 'body' => 'Text'], AiCopilotPlugin::splitSubject("Subject: Hidden\nText", false), 'Unwanted subject was retained.');
same(['subject' => '', 'body' => 'Nur Text'], AiCopilotPlugin::splitSubject('Nur Text', true), 'Plain body changed.');

/* Every fixture works as supplied and with every byte boundary split. */
$aFixtures = \json_decode((string) \file_get_contents(__DIR__ . '/fixtures/stream_cases.json'), true, 512, JSON_THROW_ON_ERROR);
foreach ($aFixtures as $sName => $aFixture) {
	foreach ([false, true] as $bByteWise) {
		$aResult = streamResult($aFixture['chunks'], $bByteWise);
		same(1, $aResult['calls'], $sName . ' dispatched more than once.');
		same(true, $aResult['payloads'][0]['stream'], $sName . ' did not use streaming.');
		if (isset($aFixture['expected'])) {
			check(!isset($aResult['exception']), $sName . ' unexpectedly failed.');
			same($aFixture['expected'], $aResult['text'], $sName . ' text mismatch.');
			same($aFixture['expected'], \trim(\implode('', $aResult['deltas'])), $sName . ' delta mismatch.');
		} else {
			check(isset($aResult['exception']), $sName . ' unexpectedly succeeded.');
			same($aFixture['error'], $aResult['exception']->errorCode(), $sName . ' error mismatch.');
		}
	}
}
check(!\str_contains(streamResult($aFixtures['provider_error_event']['chunks'])['exception']->getMessage(), 'private upstream detail'), 'Provider error detail leaked.');

/* Bounded parser and responses. */
$aResult = streamResult(['data: ' . \str_repeat('x', SseParser::MAX_LINE_BYTES + 1)]);
same('upstream_too_large', $aResult['exception']->errorCode(), 'Unterminated line was not bounded.');
$aResult = streamResult([\str_repeat('x', LlmClient::MAX_STREAM_BYTES + 1)]);
same('upstream_too_large', $aResult['exception']->errorCode(), 'Raw upstream stream was not bounded.');
$iCalls = 0;
$oClient = mockClient(function () use (&$iCalls): array {
	++$iCalls;
	return [200, \str_repeat('x', LlmClient::MAX_RESPONSE_BYTES + 1)];
});
expectLlm('upstream_too_large', fn() => $oClient->chat([]));
same(1, $iCalls, 'Oversized response was retried.');

/* No automatic retry/replay for HTTP, timeout, malformed JSON, or partial streams. */
foreach ([401, 403, 413, 429, 500, 502, 503] as $iStatus) {
	$iCalls = 0;
	$oClient = mockClient(function () use (&$iCalls, $iStatus): array {
		++$iCalls;
		return [$iStatus, '{"error":{"message":"private prompt or response"}}'];
	});
	$e = expectLlm('upstream_http', fn() => $oClient->chat([]));
	same($iStatus, $e->getCode(), 'HTTP status was not preserved.');
	same(1, $iCalls, 'HTTP ' . $iStatus . ' caused an automatic retry.');
	check(!\str_contains($e->getMessage(), 'private prompt'), 'Provider response body leaked.');
}
foreach ([502, 504] as $iStatus) {
	$iCalls = 0;
	$oClient = mockClient(function () use (&$iCalls, $iStatus): array {
		++$iCalls;
		throw new LlmException('Controlled transport failure.', $iStatus, 'transport_failure');
	});
	expectLlm('transport_failure', fn() => $oClient->chat([]));
	same(1, $iCalls, 'Transport failure caused an automatic retry.');
}
$iCalls = 0;
$oClient = mockClient(function () use (&$iCalls): array {
	++$iCalls;
	return [200, '{"choices":[{"message":{"content":"not json"}}]}'];
});
expectLlm('upstream_malformed_json', fn() => $oClient->chatJson([]));
same(1, $iCalls, 'Malformed JSON caused a second generation.');

$iCalls = 0;
$aDeltas = [];
$oClient = mockClient(function (array $aPayload, callable $fWrite) use (&$iCalls): array {
	++$iCalls;
	$fWrite("data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n");
	throw new LlmException('Controlled post-dispatch failure.', 502, 'transport_failure');
});
expectLlm('transport_failure', function () use ($oClient, &$aDeltas): void {
	$oClient->stream([], function (string $sDelta) use (&$aDeltas): void {
		$aDeltas[] = $sDelta;
	});
});
same(['partial'], $aDeltas, 'Partial delta was lost before the controlled failure.');
same(1, $iCalls, 'Partial stream was replayed.');

/* Non-stream content arrays and reasoning removal remain compatible. */
$oClient = mockClient(fn(): array => [200, '{"choices":[{"message":{"content":[{"type":"thinking","thinking":"secret"},{"type":"text","text":"<think>secret</think> Sichtbar ✓"}]}}]}']);
same('Sichtbar ✓', $oClient->chat([]), 'Non-stream flattening changed.');

/** Plugin double with a counting deterministic provider transport. */
class TestableAiCopilotPlugin extends AiCopilotPlugin
{
	public int $providerCalls = 0;
	public array $payloads = [];
	public array $events = [];
	public array $streamChunks = [];
	public string $chatContent = 'Antwort ✓';
	public ?\Throwable $factoryException = null;
	public ?string $rawBody = null;

	public function __construct(array $aParams = [], bool $bNoticeAck = false)
	{
		parent::__construct();
		$this->params = $aParams;
		$this->settings = [
			'enabled' => true,
			'features' => [],
			'notice_ack' => $bNoticeAck,
			'tone' => 'professional',
			'language' => 'de',
			'name' => 'Test',
			'style' => '',
			'addresses' => ''
		];
		foreach (static::FEATURES as $sFeature) {
			$this->config['feature_' . $sFeature] = true;
		}
		$this->config += [
			'profile_default' => 'mistral',
			'mistral_base_url' => 'https://mock.invalid/v1',
			'mistral_model' => 'mock-model',
			'mistral_key_file' => '',
			'mistral_api_key' => 'test-only-key',
			'mistral_timeout' => 5,
			'mistral_json_mode' => 'json_object'
		];
	}

	protected function createLlmClient(string $sProfileName, array $aProfile): LlmClient
	{
		if ($this->factoryException) {
			throw $this->factoryException;
		}
		return new LlmClient($sProfileName, $aProfile, function (array $aPayload, ?callable $fWrite = null): array {
			++$this->providerCalls;
			$this->payloads[] = $aPayload;
			if (!empty($aPayload['stream'])) {
				foreach ($this->streamChunks as $sChunk) {
					$fWrite($sChunk);
				}
				return [200, ''];
			}
			return [200, \json_encode(['choices' => [['message' => ['content' => $this->chatContent]]]], JSON_UNESCAPED_UNICODE)];
		});
	}

	protected function readStreamBody(): string
	{
		return $this->rawBody ?? \json_encode($this->params, JSON_UNESCAPED_UNICODE);
	}

	protected function writeStreamEvent(string $sEvent, array $aData): void
	{
		$this->events[] = ['event' => $sEvent, 'data' => $aData];
	}
}

function draftParams(string $sMode = 'proofread'): array
{
	return [
		'mode' => $sMode,
		'tone' => '',
		'instruction' => \in_array($sMode, ['new', 'reply'], true) ? 'Schreibe eine kurze Antwort.' : '',
		'current' => \in_array($sMode, ['rewrite', 'proofread'], true) ? '  Text mit Fehler.  ' : '',
		'wantSubject' => \in_array($sMode, ['new', 'reply'], true),
		'folder' => '',
		'uids' => [],
		'sent' => ''
	];
}

function runService(StreamTestPlugin $oPlugin, array $aServer = []): void
{
	$_SERVER['REQUEST_METHOD'] = 'POST';
	$_SERVER['HTTP_X_SM_TOKEN'] = 'test-token';
	$_SERVER['CONTENT_TYPE'] = 'application/json';
	unset($_SERVER['HTTP_SEC_FETCH_SITE']);
	foreach ($aServer as $sKey => $mValue) {
		$_SERVER[$sKey] = $mValue;
	}
	if (!\array_key_exists('CONTENT_LENGTH', $aServer)) {
		$_SERVER['CONTENT_LENGTH'] = (string) \strlen($oPlugin->readStreamBodyForTest());
	}
	$oPlugin->ServiceStream();
}

/** Public wrapper around the test double's body source, not production state. */
class StreamTestPlugin extends TestableAiCopilotPlugin
{
	public function readStreamBodyForTest(): string
	{
		return $this->readStreamBody();
	}
}

/* Every provider-dispatching JSON operation rejects missing persisted consent. */
$aOperations = [
	'draft' => fn(StreamTestPlugin $p) => $p->DoDraft(),
	'summarize' => fn(StreamTestPlugin $p) => $p->DoSummarize(),
	'quick_replies' => fn(StreamTestPlugin $p) => $p->DoQuickReplies(),
	'search' => fn(StreamTestPlugin $p) => $p->DoSearch(),
	'triage_llm' => fn(StreamTestPlugin $p) => $p->DoTriageLlm(),
	'chat' => fn(StreamTestPlugin $p) => $p->DoChat(),
	'alerts_llm' => fn(StreamTestPlugin $p) => $p->DoAlertsLlm()
];
foreach ($aOperations as $sName => $fOperation) {
	$aParams = draftParams();
	if ('summarize' === $sName || 'quick_replies' === $sName) {
		$aParams = ['folder' => 'INBOX', 'uids' => [1], 'sent' => ''];
	} else if ('search' === $sName) {
		$aParams = ['query' => 'Rechnungen', 'folders' => [], 'currentFolder' => 'INBOX'];
	} else if ('triage_llm' === $sName) {
		$aParams = ['folder' => 'INBOX', 'items' => [['uid' => 1, 'subject' => 'Test']]];
	} else if ('chat' === $sName) {
		$aParams = ['messages' => [['role' => 'user', 'content' => 'Hallo']], 'folders' => [], 'context' => []];
	} else if ('alerts_llm' === $sName) {
		$aParams = ['items' => [['folder' => 'INBOX', 'uid' => 1]]];
	}
	// A browser-supplied acknowledgement must not replace persisted consent.
	$aParams['notice_ack'] = true;
	$oPlugin = new StreamTestPlugin($aParams, false);
	$aResult = $fOperation($oPlugin);
	same('consent_required', $aResult['code'] ?? '', $sName . ' did not enforce consent.');
	same(0, $oPlugin->providerCalls, $sName . ' dispatched without consent.');
}

$oPlugin = new StreamTestPlugin(['folder' => 'INBOX', 'uids' => [1], 'cacheOnly' => true], false);
$aResult = $oPlugin->DoSummarize();
same(null, $aResult['summary'] ?? null, 'cacheOnly did not stay local.');
same(0, $oPlugin->providerCalls, 'cacheOnly dispatched to the provider.');

/* Feature/account gates precede provider creation. */
foreach (['admin', 'user', 'user_feature'] as $sGate) {
	$oPlugin = new StreamTestPlugin(draftParams(), true);
	if ('admin' === $sGate) {
		$oPlugin->config['feature_draft'] = false;
	} else if ('user' === $sGate) {
		$oPlugin->settings['enabled'] = false;
	} else {
		$oPlugin->settings['features']['draft'] = false;
	}
	$aResult = $oPlugin->DoDraft();
	same('feature_disabled', $aResult['code'] ?? '', $sGate . ' gate was not enforced.');
	same(0, $oPlugin->providerCalls, $sGate . ' gate allowed provider dispatch.');
}
$oPlugin = new StreamTestPlugin(draftParams(), true);
$oPlugin->accountException = new \RainLoop\Exceptions\ClientException('private session detail');
try {
	$oPlugin->DoDraft();
	throw new \RuntimeException('Missing account was accepted.');
} catch (\RainLoop\Exceptions\ClientException $e) {
	same(0, $oPlugin->providerCalls, 'Missing account allowed provider dispatch.');
}

/* Persisted acknowledgement enables later calls; all modes share preparation. */
$oPlugin = new StreamTestPlugin(['settings' => ['notice_ack' => true]], false);
same(true, $oPlugin->DoSaveSettings()['saved'] ?? false, 'Consent was not persisted.');
$oPlugin->params = draftParams();
$aResult = $oPlugin->DoDraft();
same('Antwort ✓', $aResult['body'] ?? '', 'Consent-enabled draft failed.');
same(1, $oPlugin->providerCalls, 'Consent-enabled draft did not dispatch exactly once.');
foreach (['new', 'reply', 'rewrite', 'proofread'] as $sMode) {
	$oPlugin = new StreamTestPlugin(draftParams($sMode), true);
	$aResult = $oPlugin->DoDraft();
	check(!isset($aResult['error']), 'Draft mode ' . $sMode . ' failed.');
	same(1, $oPlugin->providerCalls, 'Draft mode ' . $sMode . ' dispatched unexpectedly.');
	same(\in_array($sMode, ['new', 'reply'], true), !\str_contains($oPlugin->payloads[0]['messages'][0]['content'], 'Beginne') ? false : true, 'Subject prompt mode mismatch.');
}

/* DoDraft and ServiceStream use identical shared messages and parameters. */
$oPlugin = new StreamTestPlugin(draftParams(), true);
$oPlugin->streamChunks = [
	"data: {\"choices\":[{\"delta\":{\"content\":\"Korrigiert ✓\"}}]}\r\n\r\n",
	'data: [DONE]'
];
$oPlugin->DoDraft();
runService($oPlugin);
same(2, $oPlugin->providerCalls, 'Shared preparation test did not run both paths.');
same($oPlugin->payloads[0]['messages'], $oPlugin->payloads[1]['messages'], 'JSON and SSE prepared different prompts.');
same(['start', 'delta', 'done'], \array_column($oPlugin->events, 'event'), 'Legacy SSE sequence changed.');
same('Korrigiert ✓', $oPlugin->events[2]['data']['body'] ?? '', 'SSE done body mismatch.');
$iHttpStatus = \http_response_code();
check(false === $iHttpStatus || 200 === $iHttpStatus, 'Legacy SSE HTTP status was explicitly changed.');

$oPlugin = new StreamTestPlugin(draftParams('new'), true);
$oPlugin->streamChunks = [
	"data: {\"choices\":[{\"delta\":{\"content\":\"Betreff: Grüße ✓\\n\\nHallo\"}}]}\n\n",
	"data: [DONE]\n\n"
];
runService($oPlugin);
same('Grüße ✓', $oPlugin->events[2]['data']['subject'] ?? '', 'SSE subject mismatch.');
same('Hallo', $oPlugin->events[2]['data']['body'] ?? '', 'SSE subject/body split mismatch.');

/* Direct stream authorization/protocol failures produce only an error event and zero calls. */
$aRejections = [
	'method_not_allowed' => ['server' => ['REQUEST_METHOD' => 'GET'], 'notice' => true],
	'invalid_csrf' => ['server' => ['HTTP_X_SM_TOKEN' => 'wrong'], 'notice' => true],
	'cross_site_request' => ['server' => ['HTTP_SEC_FETCH_SITE' => 'cross-site'], 'notice' => true],
	'invalid_content_type' => ['server' => ['CONTENT_TYPE' => 'text/plain'], 'notice' => true],
	'body_too_large' => ['server' => ['CONTENT_LENGTH' => '65537'], 'notice' => true],
	'invalid_request' => ['server' => [], 'notice' => true, 'body' => ['mode' => 'proofread', 'current' => 'Text', 'notice_ack' => true]],
	'consent_required' => ['server' => [], 'notice' => false]
];
foreach ($aRejections as $sCode => $aCase) {
	$oPlugin = new StreamTestPlugin(draftParams(), $aCase['notice']);
	if (isset($aCase['body'])) {
		$oPlugin->rawBody = \json_encode($aCase['body']);
	}
	runService($oPlugin, $aCase['server']);
	same(['error'], \array_column($oPlugin->events, 'event'), $sCode . ' emitted start/delta/done.');
	same($sCode, $oPlugin->events[0]['data']['code'] ?? '', $sCode . ' error code mismatch.');
	same(0, $oPlugin->providerCalls, $sCode . ' reached the provider.');
}
$oPlugin = new StreamTestPlugin(draftParams(), true);
$oPlugin->config['feature_draft'] = false;
runService($oPlugin);
same('feature_disabled', $oPlugin->events[0]['data']['code'] ?? '', 'Stream feature gate missing.');
same(0, $oPlugin->providerCalls, 'Disabled stream feature reached provider.');

/* Malformed/incomplete upstream responses emit error and never done. */
foreach (['malformed_json', 'missing_completion'] as $sName) {
	$oPlugin = new StreamTestPlugin(draftParams(), true);
	$oPlugin->streamChunks = $aFixtures[$sName]['chunks'];
	runService($oPlugin);
	$aEvents = \array_column($oPlugin->events, 'event');
	check(!\in_array('done', $aEvents, true), $sName . ' emitted done.');
	same('error', \end($aEvents) ?: '', $sName . ' did not end with error.');
	same($aFixtures[$sName]['error'], $oPlugin->events[\array_key_last($oPlugin->events)]['data']['code'] ?? '', $sName . ' wrong terminal code.');
	same(1, $oPlugin->providerCalls, $sName . ' was replayed.');
}

/* Generic exceptions and logs cannot expose content, tokens, or internals. */
$oPlugin = new StreamTestPlugin(draftParams(), true);
$oPlugin->factoryException = new \RuntimeException('private prompt cookie csrf api-key');
$aResult = $oPlugin->DoDraft();
same('internal_error', $aResult['code'] ?? '', 'Generic error was not normalized.');
$sPublic = \json_encode([$aResult, $oPlugin->logs], JSON_UNESCAPED_UNICODE);
check(!\str_contains($sPublic, 'private prompt'), 'Exception detail leaked to response or log.');
same(0, $oPlugin->providerCalls, 'Factory failure dispatched to provider.');

print 'OK: ' . $iAssertions . " assertions; deterministic mock only, no live provider.\n";
