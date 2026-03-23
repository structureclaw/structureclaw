from __future__ import annotations

from typing import Any, Dict, List

from code_check import CodeChecker


def run_code_check(model_id: str, code: str, elements: List[str], context: Dict[str, Any]) -> Dict[str, Any]:
    checker = CodeChecker(code)
    return checker.check(model_id, elements, context)
