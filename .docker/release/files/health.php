<?php
// Deliberately avoid application bootstrap, private data, and external providers.
// PHP-only deployments retain the original 204 response.
if ('true' !== (string) getenv('SNAPPY_AI_PROXY_ENABLED')) {
    http_response_code(204);
    return;
}

$errno = 0;
$error = '';
$socket = @fsockopen('127.0.0.1', 3001, $errno, $error, 0.25);
$response = '';
if (is_resource($socket)) {
    stream_set_timeout($socket, 0, 250000);
    if (false !== @fwrite($socket, "GET /healthz HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")) {
        $response = (string) @stream_get_contents($socket, 4096);
    }
    @fclose($socket);
}
$healthy = 1 === preg_match('#^HTTP/\d(?:\.\d)? 200 #', $response)
    && 1 === preg_match('#\r?\n\r?\nok\n$#', $response);
http_response_code($healthy ? 204 : 503);
