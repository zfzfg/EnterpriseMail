<?php
$stdIn = STDIN;
$stdOut = STDOUT;

fwrite($stdOut, "READY\n");
fflush($stdOut);

while (false !== $header = fgets($stdIn)) {
    if (!preg_match('/\blen:(\d+)(?:\s|$)/', $header, $lengthMatch)) {
        continue;
    }
    $length = (int) $lengthMatch[1];
    $payload = '';
    while (strlen($payload) < $length && !feof($stdIn)) {
        $chunk = fread($stdIn, $length - strlen($payload));
        if (false === $chunk) {
            break 2;
        }
        $payload .= $chunk;
    }

    preg_match('/\beventname:([^\s]+)/', $header, $eventMatch);
    $event = $eventMatch[1] ?? '';
    $fields = [];
    foreach (explode(' ', trim($payload)) as $part) {
        $pieces = explode(':', $part, 2);
        if (2 === count($pieces)) {
            $fields[$pieces[0]] = $pieces[1];
        }
    }

    // Only an unexpected Rust exit is recoverable; Supervisor applies autorestart=unexpected.
    $restartableRustExit = 'PROCESS_STATE_EXITED' === $event
        && 'snappy-ai-proxy' === ($fields['groupname'] ?? '')
        && '0' === ($fields['expected'] ?? '');
    if (in_array($event, ['PROCESS_STATE_EXITED', 'PROCESS_STATE_STOPPED', 'PROCESS_STATE_FATAL'], true)
        && !$restartableRustExit
    ) {
        $pid = (int) trim((string) @file_get_contents('/run/supervisord.pid'));
        if ($pid > 0) {
            exec('kill -15 ' . $pid);
        }
    }

    fwrite($stdOut, "RESULT 2\nOK");
    fflush($stdOut);
    fwrite($stdOut, "READY\n");
    fflush($stdOut);
}