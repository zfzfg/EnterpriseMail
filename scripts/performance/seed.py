#!/usr/bin/env python3
"""Seed the isolated Docker mail server from immutable synthetic fixtures."""
from __future__ import annotations

import argparse
import base64
import json
from pathlib import Path

from common import DEFAULT_CONFIG, FIXTURES, BenchError, compose, load_config, verify_fixtures
from loadgen import Client

PASSWORD = "test1234"
USER = "test@example.com"

PHP_CONFIG = r'''
$base = '/var/lib/snappymail/_data_/_default_/';
$d = json_decode(file_get_contents($base . 'domains/default.json'), true);
if (!is_array($d)) { throw new RuntimeException('Default domain fixture is unavailable'); }
$d['IMAP']['host'] = 'mail.example.com'; $d['IMAP']['port'] = 993; $d['IMAP']['type'] = 1;
$d['IMAP']['disabled_capabilities'] = array_values(array_diff($d['IMAP']['disabled_capabilities'] ?? [], ['PREVIEW']));
$d['SMTP']['host'] = 'mail.example.com'; $d['SMTP']['port'] = 587; $d['SMTP']['type'] = 2; $d['SMTP']['useAuth'] = true;
foreach (['IMAP', 'SMTP'] as $k) { $d[$k]['ssl']['verify_peer'] = true; $d[$k]['ssl']['verify_peer_name'] = true; }
file_put_contents($base . 'domains/example.com.json', json_encode($d, JSON_PRETTY_PRINT));
$ini = file_get_contents($base . 'configs/application.ini');
$ini = preg_replace('/(\[plugins\][^\[]*?)enable = Off/s', '$1enable = On', $ini);
$ini = preg_replace('/enabled_list = "[^"]*"/', 'enabled_list = "ai-copilot"', $ini);
$ini = preg_replace('/^system_data = On/m', 'system_data = Off', $ini);
$ini = preg_replace('/^http = On/m', 'http = Off', $ini);
file_put_contents($base . 'configs/application.ini', $ini);
$provider = ['plugin' => [
    'feature_draft' => true,
    'profile_default' => 'llmster',
    'profile_triage' => '', 'profile_search' => '', 'profile_chat' => '',
    'llmster_base_url' => 'http://mock-llm:18080/v1',
    'llmster_model' => 'benchmark-success',
    'llmster_key_file' => '', 'llmster_api_key' => '',
    'llmster_timeout' => 30, 'llmster_json_mode' => 'none',
    // Fail closed if routing unexpectedly falls back to Mistral.
    'mistral_base_url' => 'http://127.0.0.1:9/v1',
    'mistral_model' => 'benchmark-disabled',
    'mistral_key_file' => '', 'mistral_api_key' => ''
]];
file_put_contents($base . 'configs/plugin-ai-copilot.json', json_encode($provider, JSON_PRETTY_PRINT));
'''


def seed(config: dict, candidate: int) -> dict:
    verify_fixtures()
    for address in (USER, "kollege@example.com"):
        existing = compose(config, ["exec", "-T", "mail", "setup", "email", "list"], candidate=candidate, check=False)
        if address.encode() not in existing.stdout:
            result = compose(config, ["exec", "-T", "mail", "setup", "email", "add", address, PASSWORD], candidate=candidate, check=False)
            if result.returncode and b"already" not in result.stderr.lower():
                raise BenchError(f"Could not create synthetic mail account {address}")
    compose(config, ["exec", "-T", "-u", "www-data", "snappymail", "php", "-r", PHP_CONFIG], candidate=candidate)

    fixture = json.loads((FIXTURES / "mail-fixtures.json").read_text(encoding="utf-8"))
    counts = {name: 0 for name in {record["mailbox"] for record in fixture["messages"]}}
    for mailbox in sorted(counts):
        compose(config, ["exec", "-T", "mail", "doveadm", "expunge", "-u", USER, "mailbox", mailbox, "all"], candidate=candidate, check=False)
    for record in fixture["messages"]:
        raw = base64.b64decode(record["rfc822_base64"], validate=True)
        compose(
            config,
            ["exec", "-T", "mail", "doveadm", "save", "-u", USER, "-m", record["mailbox"]],
            candidate=candidate,
            input_bytes=raw,
        )
        counts[record["mailbox"]] += 1
    for mailbox, expected in counts.items():
        found = compose(config, ["exec", "-T", "mail", "doveadm", "search", "-u", USER, "mailbox", mailbox, "all"], candidate=candidate)
        actual = len([line for line in found.stdout.splitlines() if line.strip()])
        if actual != expected:
            raise BenchError(f"Fixture count mismatch in {mailbox}: expected {expected}, found {actual}")

    client = Client(f"http://127.0.0.1:{config['port']}", config["timeout_seconds"], "seed", 0)
    client.save_consent()
    return {"status": "seeded", "messages": counts, "provider": "mock-llm:18080", "live_provider": False}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--candidate", type=int, choices=(8, 16, 30), required=True)
    args = parser.parse_args()
    result = seed(load_config(args.config), args.candidate)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
