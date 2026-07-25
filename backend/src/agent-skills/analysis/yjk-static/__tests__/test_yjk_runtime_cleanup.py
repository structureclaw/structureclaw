from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import SimpleNamespace


YJK_STATIC_DIR = Path(__file__).resolve().parents[1]
ANALYSIS_RUNTIME_DIR = YJK_STATIC_DIR.parent / "runtime"


def _load_runtime_module():
    for directory in (YJK_STATIC_DIR, ANALYSIS_RUNTIME_DIR):
        text = str(directory)
        if text not in sys.path:
            sys.path.insert(0, text)
    spec = importlib.util.spec_from_file_location(
        "yjk_runtime_cleanup_under_test",
        YJK_STATIC_DIR / "runtime.py",
    )
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_empty_get_process_result_is_an_empty_snapshot(monkeypatch):
    runtime = _load_runtime_module()
    monkeypatch.setattr(
        runtime.subprocess,
        "run",
        lambda *args, **kwargs: SimpleNamespace(
            returncode=1,
            stdout="",
            stderr="Cannot find a process with the name 'yjks'.",
        ),
    )

    assert runtime._process_ids_by_name("yjks") == set()


def test_nonempty_failed_process_query_remains_unavailable(monkeypatch):
    runtime = _load_runtime_module()
    monkeypatch.setattr(
        runtime.subprocess,
        "run",
        lambda *args, **kwargs: SimpleNamespace(
            returncode=1,
            stdout="unexpected output",
            stderr="query failed",
        ),
    )

    assert runtime._process_ids_by_name("yjks") is None
