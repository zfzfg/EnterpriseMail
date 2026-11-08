#!/usr/bin/env python3
"""Verify all immutable fixtures, or deliberately regenerate their manifest."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from common import FIXTURES, sha256_file, verify_fixtures


def write_manifest() -> None:
    entries = []
    for path in sorted(FIXTURES.rglob("*")):
        if path.is_symlink():
            raise SystemExit(f"Fixture symlinks are not allowed: {path}")
        if path.is_file() and path.name != "manifest.json":
            entries.append(
                {
                    "path": path.relative_to(FIXTURES).as_posix(),
                    "bytes": path.stat().st_size,
                    "sha256": sha256_file(path),
                }
            )
    value = {"schema_version": 1, "files": entries}
    temporary = FIXTURES / "manifest.json.tmp"
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(FIXTURES / "manifest.json")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="Rehash fixtures after an intentional fixture change")
    args = parser.parse_args()
    if args.write:
        write_manifest()
    result = verify_fixtures()
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
