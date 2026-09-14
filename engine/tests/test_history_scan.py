import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import history_scan  # noqa: E402

from app.mrz_check import israeli_id_checksum_valid  # noqa: E402

# A check-digit-valid 9-digit ID that is deliberately not one of this repository's
# documented synthetic constants, so history_scan must always flag it. Derived, not
# a literal, so this test file itself never contains a real-looking ID for the
# scanner to flag forever.
REAL_LOOKING = next(f"22222222{d}" for d in range(10) if israeli_id_checksum_valid(f"22222222{d}"))
assert REAL_LOOKING not in history_scan.SYNTHETIC


def test_find_hits_flags_a_valid_id_that_is_not_synthetic():
    # REAL_LOOKING has a valid Israeli check digit and is not in the synthetic allow-list.
    hits = history_scan.find_hits(f"id {REAL_LOOKING} and 123456782 and 12345678 here", [])
    kinds = {(k, v) for k, v in hits}
    assert ("id", REAL_LOOKING) in kinds
    assert ("id", "123456782") not in kinds          # synthetic
    assert ("candidate", "12345678") in kinds        # 8 digits, unknown
    assert all(v != "123456782" for _, v in hits)


def test_find_hits_matches_values_case_insensitively():
    hits = history_scan.find_hits("Found TZ-Sample.jpg in the log", ["tz-sample.jpg"])
    assert ("value", "TZ-Sample.jpg") in hits


def test_find_hits_is_not_fooled_by_a_nearby_date():
    assert ("id", REAL_LOOKING) in history_scan.find_hits("2026-09-06 " + REAL_LOOKING, [])
    assert ("id", REAL_LOOKING) in history_scan.find_hits(REAL_LOOKING + " 2026-09-06", [])
    assert ("id", REAL_LOOKING) in history_scan.find_hits(f"id:2026-09-06T12:00:00Z,{REAL_LOOKING}", [])


def test_mask_keeps_only_the_ends():
    assert history_scan.mask(REAL_LOOKING) == f"{REAL_LOOKING[:2]}…{REAL_LOOKING[-2:]}"
    assert history_scan.mask("abc") == "a…c"


@pytest.fixture
def repo(tmp_path):
    subprocess.run(["git", "init", "-q", "-b", "main", str(tmp_path)], check=True)
    env = {"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@x", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@x"}
    (tmp_path / "clean.txt").write_text("synthetic 123456782 only\n")
    subprocess.run(["git", "-C", str(tmp_path), "add", "."], check=True)
    subprocess.run(["git", "-C", str(tmp_path), "commit", "-q", "-m", "clean"], check=True, env={**env, "PATH": "/usr/bin:/bin"})
    (tmp_path / "leak.txt").write_text(f"real-looking {REAL_LOOKING}\n")
    subprocess.run(["git", "-C", str(tmp_path), "add", "."], check=True)
    subprocess.run(["git", "-C", str(tmp_path), "commit", "-q", "-m", "leak"], check=True, env={**env, "PATH": "/usr/bin:/bin"})
    (tmp_path / "leak.txt").write_text("removed\n")
    subprocess.run(["git", "-C", str(tmp_path), "commit", "-qam", "fix"], check=True, env={**env, "PATH": "/usr/bin:/bin"})
    return tmp_path


def test_scan_repo_finds_the_leak_in_history_but_not_the_synthetic_value(repo):
    hits = history_scan.scan_repo(repo, [])
    assert any(k == "id" and v == REAL_LOOKING and where.endswith(":leak.txt") for k, where, v in hits)
    assert not any(v == "123456782" for _, _, v in hits)
    assert not any(where.startswith("tree:") for _, where, _ in hits)  # the "fix" commit removed it from the tree


def test_scan_repo_reports_tree_hits_for_values(repo):
    (repo / "notes.md").write_text("see Private-Name in samples\n")
    subprocess.run(["git", "-C", str(repo), "add", "notes.md"], check=True)
    hits = history_scan.scan_repo(repo, ["private-name"])
    assert ("value", "tree:notes.md", "Private-Name") in hits


_GIT_ENV = {
    "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@x",
    "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@x",
    "PATH": "/usr/bin:/bin",
}


def test_scan_repo_finds_a_leak_in_a_commit_message(tmp_path):
    subprocess.run(["git", "init", "-q", "-b", "main", str(tmp_path)], check=True)
    (tmp_path / "clean.txt").write_text("nothing here\n")
    subprocess.run(["git", "-C", str(tmp_path), "add", "."], check=True)
    msg = f"oops pasted {REAL_LOOKING} into the message"
    subprocess.run(["git", "-C", str(tmp_path), "commit", "-q", "-m", msg], check=True, env=_GIT_ENV)
    hits = history_scan.scan_repo(tmp_path, [])
    assert any(k == "id" and v == REAL_LOOKING and where.endswith(":(message)") for k, where, v in hits)


def test_scan_repo_finds_a_leak_in_a_file_name(tmp_path):
    subprocess.run(["git", "init", "-q", "-b", "main", str(tmp_path)], check=True)
    (tmp_path / f"{REAL_LOOKING}.txt").write_text("clean content\n")
    subprocess.run(["git", "-C", str(tmp_path), "add", "."], check=True)
    subprocess.run(["git", "-C", str(tmp_path), "commit", "-q", "-m", "add file"], check=True, env=_GIT_ENV)
    hits = history_scan.scan_repo(tmp_path, [])
    assert any(k == "id" and v == REAL_LOOKING and where.endswith(f"(path) {REAL_LOOKING}.txt") for k, where, v in hits)
