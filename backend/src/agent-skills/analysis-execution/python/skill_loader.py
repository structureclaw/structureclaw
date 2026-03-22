from __future__ import annotations

from functools import lru_cache
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import sys
from types import ModuleType
from typing import Any


class SkillNotLoadedError(RuntimeError):
    def __init__(self, skill_path: str, reason: Exception | None = None, symbol: str | None = None):
        self.skill_path = skill_path
        self.reason = reason
        self.symbol = symbol
        detail = f" (symbol={symbol})" if symbol else ""
        reason_text = f": {reason}" if reason else ""
        super().__init__(f"Skill not loaded: {skill_path}{detail}{reason_text}")


def build_missing_skill_detail(error: SkillNotLoadedError, capability: str | None = None) -> dict[str, Any]:
    hint = (
        "Please install/enable related local skill markdown and implementation, then retry the analysis runtime."
    )
    hint_zh = "请安装/启用对应本地 skill（Markdown+实现），然后重试分析运行时。"
    capability_text = capability or "requested capability"
    return {
        "errorCode": "SKILL_NOT_LOADED",
        "message": f"Skill for {capability_text} is not loaded.",
        "messageZh": f"{capability_text} 对应的 skill 未加载。",
        "skillPath": error.skill_path,
        "symbol": error.symbol,
        "reason": str(error.reason) if error.reason else None,
        "hint": hint,
        "hintZh": hint_zh,
    }


@lru_cache(maxsize=None)
def load_skill_module(relative_path: str) -> ModuleType:
    """Load migrated Python module from backend skill path."""
    skill_root = Path(__file__).resolve().parents[2]
    target = skill_root / relative_path
    if not target.exists():
        raise ImportError(f"Skill module not found: {target}")

    module_name = "_skill_migrated_" + relative_path.replace("/", "_").replace(".", "_").replace("-", "_")
    spec = spec_from_file_location(module_name, target)
    if spec is None or spec.loader is None:
        raise ImportError(f"Unable to load spec for: {target}")

    # Ensure dataclass/type-introspection can resolve module metadata while executing.
    module = module_from_spec(spec)
    sys.modules[module_name] = module

    # For geometry-input converters, force absolute import "converters.*" to resolve
    # from the backend skill tree instead of the removed legacy analysis package.
    injected_path: str | None = None
    if relative_path.startswith("geometry-input/converters/"):
        injected_path = str(target.parent.parent)
        if injected_path not in sys.path:
            sys.path.insert(0, injected_path)

    try:
        spec.loader.exec_module(module)
    except Exception:
        sys.modules.pop(module_name, None)
        raise
    finally:
        if injected_path and sys.path and sys.path[0] == injected_path:
            sys.path.pop(0)

    return module


def require_skill_module(relative_path: str) -> ModuleType:
    try:
        return load_skill_module(relative_path)
    except Exception as exc:
        raise SkillNotLoadedError(relative_path, reason=exc) from exc


def load_skill_symbol(relative_path: str, symbol: str) -> Any:
    module = require_skill_module(relative_path)
    value = getattr(module, symbol, None)
    if value is None:
        raise SkillNotLoadedError(relative_path, symbol=symbol)
    return value
