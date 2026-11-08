#!/usr/bin/env python3
"""Generate or verify deterministic, synthetic RFC 822 benchmark fixtures."""
from __future__ import annotations

import argparse
import base64
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from email.policy import SMTP
from email.utils import format_datetime
import json
from pathlib import Path

from common import FIXTURES

OUTPUT = FIXTURES / "mail-fixtures.json"


def message(index: int, mailbox: str) -> bytes:
    mail = EmailMessage(policy=SMTP)
    mail["From"] = "Benchmark Sender <sender@example.com>"
    mail["To"] = "Benchmark User <test@example.com>"
    mail["Subject"] = f"Synthetic benchmark message {index:04d}"
    mail["Date"] = format_datetime(datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(minutes=index))
    mail["Message-ID"] = f"<benchmark-{index:04d}@example.com>"
    mail.set_content(
        f"This is immutable synthetic benchmark message {index:04d}.\n"
        "No real person, provider, or production mailbox is involved.\n",
        charset="utf-8",
        cte="quoted-printable",
    )
    return mail.as_bytes()


def render() -> bytes:
    records = []
    for index in range(120):
        records.append(
            {
                "mailbox": "INBOX",
                "rfc822_base64": base64.b64encode(message(index, "INBOX")).decode("ascii"),
            }
        )
    for index in range(120, 124):
        records.append(
            {
                "mailbox": "Sent",
                "rfc822_base64": base64.b64encode(message(index, "Sent")).decode("ascii"),
            }
        )
    value = {"schema_version": 1, "description": "Synthetic immutable messages; fixed timestamps and IDs", "messages": records}
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--write", action="store_true")
    group.add_argument("--check", action="store_true")
    args = parser.parse_args()
    expected = render()
    if args.check:
        if not OUTPUT.is_file() or OUTPUT.read_bytes() != expected:
            parser.error("mail-fixtures.json is missing or differs from deterministic generation")
        print(f"OK: {OUTPUT} matches deterministic generation")
    else:
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_bytes(expected)
        print(f"Wrote {OUTPUT}; regenerate manifest.json explicitly")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
