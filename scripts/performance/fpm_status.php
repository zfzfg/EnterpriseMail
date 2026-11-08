<?php
/** Query FPM's private status directly over loopback FastCGI. No HTTP listener. */

function fcgiLength(int $length): string {
    return $length < 128 ? chr($length) : pack('N', $length | 0x80000000);
}

function fcgiPair(string $name, string $value): string {
    return fcgiLength(strlen($name)) . fcgiLength(strlen($value)) . $name . $value;
}

function fcgiPacket(int $type, int $requestId, string $content = ''): string {
    $padding = (8 - (strlen($content) % 8)) % 8;
    return pack('CCnnCC', 1, $type, $requestId, strlen($content), $padding, 0)
        . $content . ($padding ? str_repeat("\0", $padding) : '');
}

function fcgiRead($socket, int $length): string {
    $result = '';
    while (strlen($result) < $length && !feof($socket)) {
        $chunk = fread($socket, $length - strlen($result));
        if (false === $chunk || '' === $chunk) {
            $meta = stream_get_meta_data($socket);
            if (!empty($meta['timed_out'])) {
                throw new RuntimeException('FastCGI timeout');
            }
            if ('' === $chunk) {
                break;
            }
        }
        $result .= $chunk;
    }
    if (strlen($result) !== $length) {
        throw new RuntimeException('Incomplete FastCGI packet');
    }
    return $result;
}

function fcgiStatus(): string {
    $socket = stream_socket_client('tcp://127.0.0.1:9000', $errno, $error, 3);
    if (false === $socket) {
        throw new RuntimeException('Loopback FastCGI unavailable');
    }
    stream_set_timeout($socket, 3);
    $params = [
        'GATEWAY_INTERFACE' => 'FastCGI/1.0',
        'REQUEST_METHOD' => 'GET',
        'SCRIPT_FILENAME' => '/status',
        'SCRIPT_NAME' => '/status',
        'REQUEST_URI' => '/status?full',
        'QUERY_STRING' => 'full',
        'SERVER_PROTOCOL' => 'HTTP/1.1',
        'REMOTE_ADDR' => '127.0.0.1'
    ];
    $encoded = '';
    foreach ($params as $name => $value) {
        $encoded .= fcgiPair($name, $value);
    }
    $request = fcgiPacket(1, 1, pack('nCx5', 1, 0))
        . fcgiPacket(4, 1, $encoded) . fcgiPacket(4, 1)
        . fcgiPacket(5, 1);
    $remaining = strlen($request);
    $offset = 0;
    while ($remaining) {
        $written = fwrite($socket, substr($request, $offset));
        if (false === $written || 0 === $written) {
            throw new RuntimeException('Could not write FastCGI request');
        }
        $offset += $written;
        $remaining -= $written;
    }
    $stdout = '';
    $ended = false;
    while (!$ended && !feof($socket)) {
        $header = fcgiRead($socket, 8);
        $parts = unpack('Cversion/Ctype/nrequestId/nlength/Cpadding/Creserved', $header);
        $content = $parts['length'] ? fcgiRead($socket, $parts['length']) : '';
        if ($parts['padding']) {
            fcgiRead($socket, $parts['padding']);
        }
        if (6 === $parts['type']) {
            $stdout .= $content;
        } elseif (3 === $parts['type']) {
            $ended = true;
        }
    }
    fclose($socket);
    // Strip a FastCGI HTTP header if FPM emitted one.
    $position = strpos($stdout, "\r\n\r\n");
    if (false !== $position && str_starts_with($stdout, 'Status:')) {
        $stdout = substr($stdout, $position + 4);
    }
    return $stdout;
}

function statusValue(string $value): mixed {
    return is_numeric($value) ? (float) $value + 0 : $value;
}

function parseStatus(string $raw): array {
    $summaryKeys = [
        'pool' => 'pool', 'process manager' => 'process_manager',
        'start time' => 'start_time', 'start since' => 'start_since',
        'accepted conn' => 'accepted_conn', 'listen queue' => 'listen_queue',
        'max listen queue' => 'max_listen_queue', 'listen queue len' => 'listen_queue_len',
        'idle processes' => 'idle_processes', 'active processes' => 'active_processes',
        'total processes' => 'total_processes', 'max active processes' => 'max_active_processes',
        'max children reached' => 'max_children_reached', 'slow requests' => 'slow_requests'
    ];
    $workerKeys = [
        'pid' => 'pid', 'state' => 'state', 'start since' => 'start_since',
        'requests' => 'requests', 'request duration' => 'request_duration',
        'last request cpu' => 'last_request_cpu', 'last request memory' => 'last_request_memory'
    ];
    $summary = [];
    $workers = [];
    $current = null;
    foreach (preg_split('/\r?\n/', $raw) as $line) {
        if (str_starts_with($line, '*')) {
            if (null !== $current) {
                $workers[] = $current;
            }
            $current = [];
            continue;
        }
        if (!str_contains($line, ':')) {
            continue;
        }
        [$key, $value] = explode(':', $line, 2);
        $key = strtolower(trim($key));
        $value = trim($value);
        if (null !== $current) {
            if (isset($workerKeys[$key])) {
                $current[$workerKeys[$key]] = statusValue($value);
            }
            // Deliberately omit request URI, query, script, and auth/user fields.
        } elseif (isset($summaryKeys[$key])) {
            $summary[$summaryKeys[$key]] = statusValue($value);
        }
    }
    if (null !== $current) {
        $workers[] = $current;
    }
    return ['status' => $summary, 'workers' => $workers];
}

try {
    $raw = fcgiStatus();
    $result = parseStatus($raw);
    if (!$result['status']) {
        throw new RuntimeException('FPM returned no status fields');
    }
    echo json_encode([
        'available' => true,
        'transport' => 'loopback_fastcgi',
        'collected_at_unix' => microtime(true)
    ] + $result, JSON_UNESCAPED_SLASHES), "\n";
} catch (Throwable $error) {
    echo json_encode([
        'available' => false,
        'transport' => 'loopback_fastcgi',
        'reason' => $error->getMessage()
    ], JSON_UNESCAPED_SLASHES), "\n";
}
