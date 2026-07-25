from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


TEST_DIR = Path(__file__).resolve().parent
PKPM_STATIC_DIR = TEST_DIR.parent
ANALYSIS_DIR = PKPM_STATIC_DIR.parent
RUNTIME_DIR = ANALYSIS_DIR / "runtime"

sys.path.insert(0, str(PKPM_STATIC_DIR))
sys.path.insert(0, str(RUNTIME_DIR))

from contracts import AnalysisCapabilityError  # noqa: E402


def _load_runtime_module():
    spec = importlib.util.spec_from_file_location(
        "pkpm_runtime_under_test", PKPM_STATIC_DIR / "runtime.py"
    )
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PkpmRuntimeCapabilityErrorTest(unittest.TestCase):
    def test_run_analysis_preserves_converter_capability_error(self) -> None:
        runtime = _load_runtime_module()
        error = AnalysisCapabilityError(
            engine="pkpm",
            capability="canonical-3d-building-model",
            reason="PKPM floor-model conversion requires a genuine canonical 3-D model",
        )
        converter = SimpleNamespace(
            _detect_material_family=lambda _model: "steel",
            convert_v2_to_jws=lambda *_args, **_kwargs: (_ for _ in ()).throw(error),
        )
        model = {
            "coordinate_system": {
                "semantics": "global-z-up",
                "version": 1,
                "dimension": "2d",
                "plane": "xz",
                "dof_order": ["ux", "uy", "uz", "rx", "ry", "rz"],
            },
            "nodes": [],
            "elements": [],
        }

        with (
            patch.object(runtime, "_check_pkpm_available", return_value=Path("JWSCYCLE.exe")),
            patch.object(runtime, "_import_apipyinterface"),
            patch.dict(sys.modules, {"pkpm_converter": converter}),
        ):
            with self.assertRaises(AnalysisCapabilityError) as caught:
                runtime.run_analysis(model, {})

        self.assertIs(caught.exception, error)
        self.assertEqual(caught.exception.error_code, "ENGINE_INPUT_UNSUPPORTED")


if __name__ == "__main__":
    unittest.main()
