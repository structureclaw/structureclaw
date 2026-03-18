from __future__ import annotations

from typing import Any, Dict


def get_rules() -> Dict[str, Any]:
    return {
        'code': 'JGJ3',
        'version': 'v1-minimal',
        'rules': [],
    }


def check_element(checker: Any, elem_id: str, context: Dict[str, Any]) -> Dict[str, Any]:
    return {
        'elementId': elem_id,
        'status': 'not_implemented',
        'message': 'JGJ3 校核尚未实现',
    }
