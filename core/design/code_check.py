"""Code-check compatibility facade.

Single source of truth lives in backend skill module:
backend/src/agent-skills/code-check/code_check.py
"""

from __future__ import annotations

from skill_bridge import load_skill_module

_SKILL_MODULE = load_skill_module("code-check/code_check.py")
CodeChecker = _SKILL_MODULE.CodeChecker

__all__ = ["CodeChecker"]
