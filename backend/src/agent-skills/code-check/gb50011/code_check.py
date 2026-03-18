from __future__ import annotations

from typing import Any, Dict


def get_rules() -> Dict[str, Any]:
    return {
        'code': 'GB50011',
        'version': 'v1-minimal',
        'rules': [],
    }


def check_element(checker: Any, elem_id: str, context: Dict[str, Any]) -> Dict[str, Any]:
    checks = [
        {
            'name': '截面抗震验算',
            'items': [
                checker._calc_item(elem_id, '轴压比', context, 'GB50011-2010 6.3.6', 'N/(fc*A) <= ξ_lim', 1.0),
                checker._calc_item(elem_id, '剪跨比', context, 'GB50011-2010 6.3.7', 'a/h0 >= 2.0', 1.0),
            ],
        },
        {
            'name': '位移验算',
            'items': [
                checker._calc_item(elem_id, '弹性层间位移角', context, 'GB50011-2010 5.5.1', 'θ_e <= θ_lim', 1.0),
            ],
        },
    ]
    return checker._build_element_result(elem_id, 'column', checks, 'GB50011-2010')
