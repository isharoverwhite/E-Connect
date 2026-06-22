#!/usr/bin/env python3
# Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.

"""Apply and audit repository-wide copyright notices."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OWNER = "Đinh Trung Kiên"
YEAR = "2026"
NOTICE = f"Copyright (c) {YEAR} {OWNER}. All rights reserved."
LICENSE_FILE = ROOT / "LICENSE"
TARGET_ROOTS = (".",)
SKIP_PARTS = {
    "node_modules",
    ".next",
    "dist",
    "build",
    "coverage",
    "venv",
    "__pycache__",
}
COMMENT_STYLES = {
    ".py": "#",
    ".ts": "block",
    ".tsx": "block",
    ".js": "block",
    ".jsx": "block",
    ".mjs": "block",
    ".cjs": "block",
    ".css": "block",
    ".cpp": "block",
    ".h": "block",
    ".sh": "#",
    ".yaml": "#",
    ".yml": "#",
}


def list_tracked_files() -> list[Path]:
    command = ["git", "ls-files", *TARGET_ROOTS]
    result = subprocess.run(
        command,
        cwd=ROOT,
        check=True,
        text=True,
        capture_output=True,
    )
    files: list[Path] = []
    for rel_path in result.stdout.splitlines():
        path = ROOT / rel_path
        if not path.is_file():
            continue
        if any(part in SKIP_PARTS for part in path.parts):
            continue
        if path.suffix not in COMMENT_STYLES:
            continue
        files.append(path)
    return files


def render_header(path: Path) -> str:
    style = COMMENT_STYLES[path.suffix]
    if style == "#":
        return f"# {NOTICE}\n\n"
    return f"/* {NOTICE} */\n\n"


def has_header(text: str) -> bool:
    preview = "\n".join(text.splitlines()[:5])
    return NOTICE in preview


def apply_header(path: Path) -> bool:
    original = path.read_text(encoding="utf-8")
    if has_header(original):
        return False

    header = render_header(path)
    if original.startswith("#!"):
        first_line_end = original.find("\n")
        if first_line_end == -1:
            updated = f"{original}\n{header}"
        else:
            updated = f"{original[: first_line_end + 1]}{header}{original[first_line_end + 1:]}"
    else:
        updated = f"{header}{original}"

    path.write_text(updated, encoding="utf-8")
    return True


def audit() -> int:
    failures: list[str] = []

    if not LICENSE_FILE.is_file():
        failures.append("missing LICENSE")

    for path in list_tracked_files():
        content = path.read_text(encoding="utf-8")
        if not has_header(content):
            failures.append(str(path.relative_to(ROOT)))

    if failures:
        for failure in failures:
            print(f"FAIL {failure}")
        return 1

    print(f"PASS repository protection audit for {len(list_tracked_files())} files")
    return 0


def apply() -> int:
    changed = 0
    files = list_tracked_files()
    for path in files:
        if apply_header(path):
            changed += 1
            print(f"UPDATED {path.relative_to(ROOT)}")

    print(f"Applied headers to {changed} of {len(files)} files")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command",
        choices=("apply", "audit"),
        help="Apply headers or audit repository protection state.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.command == "apply":
        return apply()
    if args.command == "audit":
        return audit()
    print(f"Unsupported command: {args.command}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
