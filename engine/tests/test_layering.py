"""The import graph must stay acyclic and layered: a module may import only from the
tiers above it. Without this test the next refactor quietly reintroduces a cycle."""
import ast
import pathlib

APP = pathlib.Path(__file__).resolve().parents[1] / "app"

TIERS = {
    "schemas": 0, "errors": 0, "doctypes": 0, "config": 0, "gate": 0, "orientation": 0, "banks": 0,
    "mrz_check": 1, "imaging": 1, "triage": 1, "resolution": 1,
    "anchors": 2, "cheque_check": 2, "cropping": 2, "regions": 2,
    "postprocess": 3,
    "reading": 4, "assemble": 4,
    "pipeline": 5, "main": 6,
}
# orientation sits at tier 0, not 1: it imports nothing from this package at all (only
# numpy, PIL and the OCR package), so it is a leaf like schemas/errors/doctypes/config/gate
# rather than a peer of imaging (which orientation's own importer, cropping at tier 2,
# also imports — both must sit strictly below cropping, but neither has to sit level with
# the other).
#
# mrz_check, anchors, cheque_check, postprocess and reading sit one tier higher than an
# earlier draft of this table placed them (that draft put mrz_check at tier 0, level with
# schemas, which it imports — a same-tier import is a violation by the rule below, not an
# exception the rule makes for tier 0). The real edges: mrz_check imports schemas;
# anchors and cheque_check both import mrz_check; postprocess imports anchors; reading
# imports postprocess. Each of those needs its importer strictly above it, which forces
# mrz_check to 1, anchors/cheque_check to 2, postprocess to 3 and reading to 4 — the
# tiers below reflect the actual import graph (verified by AST-walking every module),
# not the first guess at grouping.


def _module_name(path: pathlib.Path) -> str:
    return "reading" if path.parent.name == "reading" else path.stem


def _local_imports(path: pathlib.Path) -> set[str]:
    """Every other `app/` module this file imports, by node name (a `reading/*.py` file
    collapses to "reading", same as _module_name). Sees relative imports ("from . import
    x", "from .x import y"), absolute imports of this package ("from app import x",
    "from app.x import y", "from app.reading.backend_ollama import z" -> "reading"), and
    plain "import app.x" (with or without "as"). Cannot see an import built at runtime
    (importlib.import_module, __import__, getattr on a module) — nothing under app/ does
    that today, but a future one would be invisible to this check."""
    tree = ast.parse(path.read_text())
    found = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            if node.level:  # "from . import x" / "from .x import y"
                if node.module:
                    found.add(node.module.split(".")[0])
                else:
                    found.update(a.name.split(".")[0] for a in node.names)
            elif node.module == "app" or (node.module and node.module.startswith("app.")):
                # "from app import x" (module carries only "app", the names carry "x") or
                # "from app.x import y" / "from app.x.y import z" (module carries "x", or
                # "x.y" — either way the submodule we care about is parts[1]).
                parts = node.module.split(".")
                if len(parts) > 1:
                    found.add(parts[1])
                else:
                    found.update(a.name.split(".")[0] for a in node.names)
        elif isinstance(node, ast.Import):
            for alias in node.names:  # "import app.x" / "import app.x as y"
                parts = alias.name.split(".")
                if parts[0] == "app" and len(parts) > 1:
                    found.add(parts[1])
    return found


def test_every_module_has_a_tier():
    for path in APP.rglob("*.py"):
        if path.stem == "__init__":
            continue
        assert _module_name(path) in TIERS, f"{path.name} has no tier"


def test_imports_only_go_downhill():
    violations = []
    for path in APP.rglob("*.py"):
        name = _module_name(path)
        if name not in TIERS:
            continue
        for imported in _local_imports(path):
            if imported not in TIERS or imported == name:
                continue
            if TIERS[imported] >= TIERS[name]:
                violations.append(f"{name} (tier {TIERS[name]}) imports {imported} (tier {TIERS[imported]})")
    assert not violations, "import layering broken:\n" + "\n".join(violations)
