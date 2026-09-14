"""Field-by-field diff of two `eval.py --json-out` files: what changed between two runs.

    ../.venv/bin/python scripts/diff_eval.py old.json new.json [--only FILE ...]

Prints values to the terminal; never write its output into the repository (real documents).
"""
import argparse
import json
import sys
from pathlib import Path


def _flat(doc: dict) -> dict[str, object]:
    out: dict[str, object] = {"document_type": doc.get("document_type"), "verdict": (doc.get("validation") or {}).get("overall")}
    for name, field in (doc.get("fields") or {}).items():
        out[f"fields.{name}"] = field.get("value") if isinstance(field, dict) else field
    sefach = doc.get("sefach") or {}
    for name, value in sefach.items():
        if name == "children":
            for i, child in enumerate(value or []):
                for cname, cfield in (child or {}).items():
                    out[f"sefach.children[{i}].{cname}"] = cfield.get("value") if isinstance(cfield, dict) else cfield
        else:
            out[f"sefach.{name}"] = value.get("value") if isinstance(value, dict) else value
    out["warnings"] = len(doc.get("warnings") or [])
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("old", type=Path)
    parser.add_argument("new", type=Path)
    parser.add_argument("--only", nargs="+", default=None, help="file names to compare")
    args = parser.parse_args()
    old, new = json.loads(args.old.read_text()), json.loads(args.new.read_text())
    names = sorted(set(old) | set(new))
    if args.only:
        # A name in neither run is a typo, not an empty diff: say so rather than reporting
        # "0 file(s) differ" for a file that was never compared.
        for missing in sorted(set(args.only) - set(names)):
            print(f"warning: {missing} not in either run", file=sys.stderr)
        names = [n for n in names if n in args.only]
    files_diff = fields_diff = 0
    for name in names:
        a, b = _flat(old.get(name) or {}), _flat(new.get(name) or {})
        keys = [k for k in sorted(set(a) | set(b)) if a.get(k) != b.get(k)]
        if not keys:
            continue
        files_diff += 1
        fields_diff += len(keys)
        print(f"== {name}")
        for k in keys:
            print(f"  {k}: {a.get(k)!r} -> {b.get(k)!r}")
    print(f"\n{files_diff} file(s) differ, {fields_diff} field(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
