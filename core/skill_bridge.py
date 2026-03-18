from __future__ import annotations

from functools import lru_cache
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from types import ModuleType


@lru_cache(maxsize=None)
def load_skill_module(relative_path: str) -> ModuleType:
    """Load migrated Python module from backend skill path."""
    repo_root = Path(__file__).resolve().parents[1]
    target = repo_root / "backend" / "src" / "agent-skills" / relative_path
    if not target.exists():
        raise ImportError(f"Skill module not found: {target}")

    module_name = "_skill_migrated_" + relative_path.replace("/", "_").replace(".", "_").replace("-", "_")
    spec = spec_from_file_location(module_name, target)
    if spec is None or spec.loader is None:
        raise ImportError(f"Unable to load spec for: {target}")

    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
