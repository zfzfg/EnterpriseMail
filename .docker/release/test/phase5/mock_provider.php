<?php

declare(strict_types=1);

// Deterministic fixture only. It records test requests in /tmp, outside application logs.
const LOG_FILE = '/tmp/phase5-provider.jsonl';

function recordProvider(string $event, array $data = []): void
{
    file_put_contents(LOG_FILE, json_encode(['event' => $event] + $data, JSON_UNESCAPED_UNICODE) . "\n", FILE_APPEND | LOCK_EX);
}

function sendProviderEvent(array $data): void
{
    echo 'data: ' . json_encode($data, JSON_UNESCAPED_UNICODE) . "\n\n";
    if (ob_get_level()) {
        @ob_flush();
    }
    flush();
}

$body = (string) file_get_contents('php://input');
$payload = json_decode($body, true);
$text = is_array($payload) ? json_encode($payload['messages'] ?? [], JSON_UNESCAPED_UNICODE) : '';
recordProvider('request', [
    'path' => $_SERVER['REQUEST_URI'] ?? '',
    'model' => is_array($payload) ? ($payload['model'] ?? '') : '',
    'reasoning_effort' => is_array($payload) ? ($payload['reasoning_effort'] ?? null) : null,
    'stream' => is_array($payload) ? ($payload['stream'] ?? null) : null,
    'auth_ok' => 'Bearer phase5-provider-key-marker' === ($_SERVER['HTTP_AUTHORIZATION'] ?? ''),
    'prompt' => $text
]);

if ('/v1/chat/completions' !== ($_SERVER['REQUEST_URI'] ?? '') || !is_array($payload)) {
    http_response_code(404);
    header('Content-Type: application/json');
    echo '{"error":"invalid fixture request"}';
    return;
}
if (str_contains($text, 'FAIL_PHASE5')) {
    http_response_code(500);
    header('Content-Type: application/json');
    echo '{"error":"controlled fixture failure"}';
    return;
}

header('Content-Type: text/event-stream');
header('Cache-Control: no-store');
if (str_contains($text, 'CANCEL_PHASE5')) {
    for ($i = 0; $i < 30; ++$i) {
        sendProviderEvent(['choices' => [['delta' => ['content' => 'cancel-' . $i . ' ']]]]);
        if (connection_aborted()) {
            recordProvider('cancelled');
            return;
        }
        sleep(1);
    }
    recordProvider('cancellation_not_observed');
    return;
}

sendProviderEvent(['choices' => [['delta' => ['content' => [
    ['type' => 'thinking', 'thinking' => 'PRIVATE_FIXTURE_THINKING'],
    ['type' => 'text', 'text' => "Betreff: Grüße ✓\n\nHallo "]
]]]]]);
sendProviderEvent(['choices' => [['delta' => ['content' => 'Phase 5 ✓']]]]);
echo "data: [DONE]\n\n";
if (ob_get_level()) {
    @ob_flush();
}
flush();
recordProvider('done');
