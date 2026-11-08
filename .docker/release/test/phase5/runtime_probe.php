<?php

declare(strict_types=1);

// Public test-only probe mounted only into the isolated Phase 5 fixture.
// It returns booleans for secret availability, never the secret values.
header('Content-Type: application/json');
header('Cache-Control: no-store');
$serviceCredential = getenv('SNAPPY_AI_PROXY_SERVICE_CREDENTIAL');
$providerKey = getenv('LLMSTER_API_KEY');
echo json_encode([
    'remote_addr' => $_SERVER['REMOTE_ADDR'] ?? '',
    'rust_enabled' => 'true' === getenv('SNAPPY_AI_PROXY_ENABLED'),
    'service_credential_available' => is_string($serviceCredential)
        && hash_equals('phase5-service-credential-32-bytes', $serviceCredential),
    'provider_key_available' => is_string($providerKey)
        && hash_equals('phase5-provider-key-marker', $providerKey),
    'unrelated_environment_absent' => false === getenv('PHASE5_UNRELATED_SECRET')
], JSON_UNESCAPED_SLASHES);
