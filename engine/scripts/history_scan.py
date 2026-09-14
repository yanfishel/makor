"""Scan git history and the working tree for values that look like real personal data.

Before the repository goes public. Reports:
  id         a 9-digit number with a valid Israeli check digit that is not a known synthetic value
  candidate  any other 8–10-digit run not in the synthetic list (cheque/account numbers look like this)
  value      an exact, case-insensitive match of a line from the values file (real IDs, names,
             phones, old sample file names — written by hand, git-ignored, never committed)

Usage (from engine/):  python scripts/history_scan.py [--repo ..] [--values ../samples/private-values.txt]
Exit 1 on any hit. Values are printed masked; nothing is written to disk.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.mrz_check import israeli_id_checksum_valid  # noqa: E402

SYNTHETIC = {"123456782", "200000008", "300000007", "400000006", "510000003", "123456783",
             "80001234", "0000123456", "012345678", "000000000",
             # this repository's own documented synthetic test constants: the plan-doc
             # example, the cheque fixture in tests/test_cheque.py, and VALID_ISRAELI_ID
             # in tests/test_mrz_check.py.
             "111111118", "060000007", "012345674",
             # synthetic ח.פ. company fixtures for web/tests/registries-fixtures.ts.
             "510000011", "510000029",
             # a permutation of 123456782 that still passes the check digit: the misread ID
             # in the re-read tests (tests/test_anthropic_path.py, tests/test_sefach.py).
             "123456287"}
_DIGITS = re.compile(r"(?<!\d)\d{8,10}(?!\d)")
# A 40-hex git sha CAN contain a spurious 8-10 decimal-digit run (hex digits 0-9 are
# decimal digits too) — the scan is safe not because hashes are hex, but because it
# never feeds a full sha to find_hits: only lines starting with "+" (and the extracted
# "+++ b/<path>" path) are scanned, and shas only ever appear on "commit "/"index " lines,
# which this scan never passes through find_hits. Package-lock integrity strings are
# base64 and likewise never scanned as such.
_COMMIT_LINE = re.compile(r"^commit [0-9a-f]{4,40}$")
_MSG_END = "\x01makor-scan-msg-end\x01"


def mask(value: str) -> str:
    if len(value) <= 2:
        return "…"
    return f"{value[:2]}…{value[-2:]}" if len(value) > 4 else f"{value[0]}…{value[-1]}"


def find_hits(text: str, values: list[str]) -> list[tuple[str, str]]:
    hits: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for m in _DIGITS.finditer(text):
        v = m.group(0)
        if v in SYNTHETIC:
            continue
        kind = "id" if len(v) == 9 and israeli_id_checksum_valid(v) else "candidate"
        if (kind, v) not in seen:
            seen.add((kind, v))
            hits.append((kind, v))
    lower = text.lower()
    for needle in values:
        n = needle.strip().lower()
        if not n:
            continue
        i = lower.find(n)
        while i != -1:
            original = text[i: i + len(n)]
            if ("value", original) not in seen:
                seen.add(("value", original))
                hits.append(("value", original))
            i = lower.find(n, i + 1)
    return hits


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True, errors="replace").stdout


def scan_repo(repo: Path, values: list[str]) -> list[tuple[str, str, str]]:
    out: list[tuple[str, str, str]] = []
    # history: every commit message, every changed file path, and every added line of
    # every commit's diff — attributed to <sha>:(message), <sha>:(path) <path>, or
    # <sha>:<path> respectively.
    log = _git(repo, "log", "-p", "--all", "--no-color", f"--format=commit %h%n%B{_MSG_END}")
    sha, path, in_message = "", "", False
    for line in log.splitlines():
        if _COMMIT_LINE.match(line):
            sha, path, in_message = line[len("commit "):], "", True
            continue
        if in_message:
            if line == _MSG_END:
                in_message = False
                continue
            for kind, v in find_hits(line, values):
                out.append((kind, f"{sha}:(message)", v))
            continue
        if line.startswith("+++ b/"):
            path = line[6:]
            for kind, v in find_hits(path, values):
                out.append((kind, f"{sha}:(path) {path}", v))
        elif line.startswith("+") and not line.startswith("+++"):
            for kind, v in find_hits(line[1:], values):
                out.append((kind, f"{sha}:{path}", v))
    # tree: every tracked file as it is now
    for rel in _git(repo, "ls-files").splitlines():
        p = repo / rel
        try:
            text = p.read_text(errors="replace")
        except (OSError, UnicodeDecodeError):
            continue
        for kind, v in find_hits(text, values):
            out.append((kind, f"tree:{rel}", v))
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo", default="..", help="repository root (default: ..)")
    ap.add_argument("--values", default="../samples/private-values.txt", help="git-ignored file with one real value per line")
    ap.add_argument("--show-candidates", action="store_true", help="also print the 8–10-digit runs that are not known synthetic values")
    args = ap.parse_args(argv)
    values_path = Path(args.values)
    values = values_path.read_text().splitlines() if values_path.exists() else []
    if not values:
        print(f"note: no values file at {values_path} — scanning for check-digit-valid IDs and digit runs only", file=sys.stderr)
    hits = scan_repo(Path(args.repo).resolve(), values)
    ids = [h for h in hits if h[0] == "id"]
    vals = [h for h in hits if h[0] == "value"]
    cands = [h for h in hits if h[0] == "candidate"]
    for kind, where, v in ids + vals:
        print(f"{kind}\t{where}\t{mask(v)}")
    print(
        f"{len(ids)} id hit(s), {len(vals)} value hit(s), "
        f"{len(cands)} digit-run candidate(s) (print with --show-candidates)",
        file=sys.stderr,
    )
    if args.show_candidates:
        for kind, where, v in cands:
            print(f"{kind}\t{where}\t{mask(v)}")
    return 1 if ids or vals else 0


if __name__ == "__main__":
    sys.exit(main())
