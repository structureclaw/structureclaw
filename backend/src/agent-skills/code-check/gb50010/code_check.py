from __future__ import annotations

from typing import Any, Dict


def get_rules() -> Dict[str, Any]:
    return {
        'code': 'GB50010',
        'version': 'v1-minimal',
        'rules': [],
    }


def check_element(checker: Any, elem_id: str, context: Dict[str, Any]) -> Dict[str, Any]:
    checks = [
        {
            'name': '承载力验算',
            'items': [
                checker._calc_item(elem_id, '正截面受弯', context, 'GB50010-2010 6.2.1', 'M <= α1*f_c*b*x*(h0-0.5*x)', 0.95),
                checker._calc_item(elem_id, '斜截面受剪', context, 'GB50010-2010 6.3.1', 'V <= Vc + Vs', 0.95),
            ],
        },
        {
            'name': '正常使用验算',
            'items': [
                checker._calc_item(elem_id, '挠度', context, 'GB50010-2010 3.3.2', 'f <= l/250', 1.0),
                checker._calc_item(elem_id, '裂缝宽度', context, 'GB50010-2010 3.4.5', 'w_max <= w_lim', 1.0),
            ],
        },
    ]
    return checker._build_element_result(elem_id, 'beam', checks, 'GB50010-2010')
