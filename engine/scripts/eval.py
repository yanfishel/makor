#!/usr/bin/env python3
"""Run a folder of document photos through Makor and print a summary.

Usage:
    python scripts/eval.py samples/            # against local server
    python scripts/eval.py samples/ --url http://myserver:8000 --secret abc123

Put test photos into samples/ (git-ignored). The script prints per-file
results and an aggregate: how many came back verified / partial / mismatch,
and which fields the model was unsure about. Use it to compare backends:
run once with ollama, once with anthropic, same folder.
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

import httpx

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff", ".pdf"}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", type=Path, help="folder with document photos")
    parser.add_argument("--url", default="http://127.0.0.1:8000", help="engine base URL")
    parser.add_argument("--secret", default=os.environ.get("MAKOR_ENGINE_SECRET", ""),
                        help="X-Engine-Secret (defaults to $MAKOR_ENGINE_SECRET)")
    parser.add_argument("--json-out", type=Path, default=None, help="dump raw responses to a JSON file")
    args = parser.parse_args()

    images = sorted(p for p in args.folder.iterdir() if p.suffix.lower() in IMAGE_EXTS)
    if not images:
        print(f"No images found in {args.folder}", file=sys.stderr)
        return 1

    headers = {"X-Engine-Secret": args.secret} if args.secret else {}
    verdicts: dict[str, int] = {}
    low_confidence: dict[str, int] = {}
    raw_results = {}
    total_seconds = 0.0
    micr_parsed = 0

    with httpx.Client(timeout=600) as client:
        for path in images:
            started = time.monotonic()
            try:
                response = client.post(
                    f"{args.url}/extract",
                    headers=headers,
                    files={"file": (path.name, path.read_bytes())},
                )
                elapsed = time.monotonic() - started
                total_seconds += elapsed
                if response.status_code != 200:
                    print(f"✗ {path.name}: HTTP {response.status_code} — {response.text[:120]}")
                    verdicts["error"] = verdicts.get("error", 0) + 1
                    continue
                data = response.json()
            except httpx.HTTPError as exc:
                print(f"✗ {path.name}: {exc}")
                verdicts["error"] = verdicts.get("error", 0) + 1
                continue

            raw_results[path.name] = data
            verdict = data["validation"]["overall"]
            verdicts[verdict] = verdicts.get(verdict, 0) + 1
            micr_parsed += bool(data["validation"].get("micr_parsed"))

            shaky = [
                name
                for name, field in data["fields"].items()
                if isinstance(field, dict)
                and field.get("value")
                and field.get("confidence") in ("medium", "low")
            ]
            for name in shaky:
                low_confidence[name] = low_confidence.get(name, 0) + 1

            marker = {"verified": "✓", "partial": "~", "unverified": "?", "mismatch": "✗"}.get(verdict, "?")
            shaky_note = f"  (uncertain: {', '.join(shaky)})" if shaky else ""
            sefach = data.get("sefach")
            sefach_note = ""
            if sefach:
                parts = [f"{len(sefach.get('children') or [])} children"]
                if sefach.get("address"):
                    parts.append("address")
                if sefach.get("spouse"):
                    parts.append("spouse")
                if sefach.get("marital_status_code"):
                    parts.append(sefach["marital_status_code"])
                sefach_note = f"  +sefach ({', '.join(parts)})"
            print(f"{marker} {path.name}: {data['document_type']} → {verdict} [{elapsed:.1f}s]{shaky_note}{sefach_note}")

    print("\n=== Summary ===")
    total = len(images)
    for verdict in ("verified", "partial", "unverified", "mismatch", "error"):
        if verdicts.get(verdict):
            print(f"  {verdict:11} {verdicts[verdict]:3}  ({100 * verdicts[verdict] / total:.0f}%)")
    if total:
        print(f"  avg latency  {total_seconds / max(total - verdicts.get('error', 0), 1):.1f}s/doc")
    if micr_parsed:
        print(f"  MICR parsed  {micr_parsed:3}")
    if low_confidence:
        print("  fields flagged medium/low most often:")
        for name, count in sorted(low_confidence.items(), key=lambda kv: -kv[1]):
            print(f"    {name}: {count}")

    if args.json_out:
        args.json_out.write_text(json.dumps(raw_results, ensure_ascii=False, indent=2))
        print(f"\nRaw responses saved to {args.json_out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
