from __future__ import annotations

from typing import Any, Dict


def get_rules() -> Dict[str, Any]:
    return {
        'code': 'GB50017',
        'version': 'v1-minimal',
        'rules': [],
    }


def check_element(checker: Any, elem_id: str, context: Dict[str, Any]) -> Dict[str, Any]:
    checks = [
        {
            'name': '强度验算',
            'items': [
                checker._calc_item(elem_id, '正应力', context, 'GB50017-2017 7.1.1', 'σ = N/A <= f', 0.95),
                checker._calc_item(elem_id, '剪应力', context, 'GB50017-2017 7.1.2', 'τ = V/Aw <= f_v', 0.95),
                checker._calc_item(elem_id, '折算应力', context, 'GB50017-2017 7.1.4', 'sqrt(σ^2 + 3τ^2) <= f', 0.95),
            ],
        },
        {
            'name': '稳定验算',
            'items': [
                checker._calc_item(elem_id, '整体稳定', context, 'GB50017-2017 8.2.1', 'N/(φ*A*f) <= 1.0', 1.0),
                checker._calc_item(elem_id, '局部稳定', context, 'GB50017-2017 8.4.1', 'b/t <= λ_lim', 1.0),
            ],
        },
        {
            'name': '刚度验算',
            'items': [
                checker._calc_item(elem_id, '长细比', context, 'GB50017-2017 8.3.1', 'λ = l0/i <= λ_lim', 1.0),
                checker._calc_item(elem_id, '挠度', context, 'GB50017-2017 10.2.1', 'f <= l/250', 1.0),
            ],
        },
    ]
    return checker._build_element_result(elem_id, 'beam', checks, 'GB50017-2017')
