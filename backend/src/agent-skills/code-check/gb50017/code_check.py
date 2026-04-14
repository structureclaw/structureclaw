from __future__ import annotations

from typing import Any, Dict


RULE_VERSION = 'gb50017-chaptered-v1'
CODE_VERSION = 'GB50017-2017'

CHAPTERS = [
    {
        'id': 'chapter-7-strength',
        'title': '第7章 强度验算',
        'checks': ['正应力', '剪应力', '折算应力'],
    },
    {
        'id': 'chapter-8-stability',
        'title': '第8章 稳定验算',
        'checks': ['整体稳定', '局部稳定', '长细比'],
    },
    {
        'id': 'chapter-10-serviceability',
        'title': '第10章 正常使用极限状态',
        'checks': ['挠度'],
    },
]


def get_rules() -> Dict[str, Any]:
    return {
        'code': 'GB50017',
        'version': RULE_VERSION,
        'chapters': CHAPTERS,
    }


def check_element(checker: Any, elem_id: str, context: Dict[str, Any]) -> Dict[str, Any]:
    element_context = _resolve_element_context(elem_id, context)
    element_type = _resolve_element_type(element_context)
    checks = _build_checks(checker, elem_id, context, element_type)
    result = checker._build_element_result(elem_id, element_type, checks, CODE_VERSION)
    result['chapters'] = _build_chapter_summaries(checks)
    result['chapterCount'] = len(result['chapters'])
    result['elementContext'] = {
        'type': element_type,
        'section': element_context.get('section'),
        'material': element_context.get('material'),
    }
    return result


def _resolve_element_context(elem_id: str, context: Dict[str, Any]) -> Dict[str, Any]:
    mapping = context.get('elementContextById', {})
    if isinstance(mapping, dict):
        value = mapping.get(elem_id)
        if isinstance(value, dict):
            return value
    return {}


def _resolve_element_type(element_context: Dict[str, Any]) -> str:
    raw_type = element_context.get('type')
    normalized = str(raw_type or '').strip().lower()
    if normalized in {'column', 'brace', 'beam'}:
        return normalized
    if 'column' in normalized:
        return 'column'
    if 'brace' in normalized:
        return 'brace'
    return 'beam'


def _build_checks(checker: Any, elem_id: str, context: Dict[str, Any], element_type: str):
    checks = []
    checks.extend(_build_strength_checks(checker, elem_id, context, element_type))
    checks.extend(_build_stability_checks(checker, elem_id, context, element_type))
    checks.extend(_build_serviceability_checks(checker, elem_id, context, element_type))
    return checks


def _build_strength_checks(checker: Any, elem_id: str, context: Dict[str, Any], element_type: str):
    items = []
    if element_type in {'beam', 'column'}:
        items.append(checker._calc_item(elem_id, '正应力', context, 'GB50017-2017 7.1.1', 'σ = N/A <= f', 0.95))
    if element_type in {'beam', 'brace'}:
        items.append(checker._calc_item(elem_id, '剪应力', context, 'GB50017-2017 7.1.2', 'τ = V/Aw <= f_v', 0.95))
    items.append(checker._calc_item(elem_id, '折算应力', context, 'GB50017-2017 7.1.4', 'sqrt(σ^2 + 3τ^2) <= f', 0.95))
    return [{
        'chapter': '第7章 强度验算',
        'name': '强度验算',
        'items': items,
    }]


def _build_stability_checks(checker: Any, elem_id: str, context: Dict[str, Any], element_type: str):
    items = [
        checker._calc_item(elem_id, '整体稳定', context, 'GB50017-2017 8.2.1', 'N/(φ*A*f) <= 1.0', 1.0),
        checker._calc_item(elem_id, '局部稳定', context, 'GB50017-2017 8.4.1', 'b/t <= λ_lim', 1.0),
    ]
    if element_type != 'beam':
        items.append(checker._calc_item(elem_id, '长细比', context, 'GB50017-2017 8.3.1', 'λ = l0/i <= λ_lim', 1.0))
    return [{
        'chapter': '第8章 稳定验算',
        'name': '稳定验算',
        'items': items,
    }]


def _build_serviceability_checks(checker: Any, elem_id: str, context: Dict[str, Any], element_type: str):
    limit = 1.0 if element_type == 'beam' else 0.95
    return [{
        'chapter': '第10章 正常使用极限状态',
        'name': '刚度验算',
        'items': [
            checker._calc_item(elem_id, '挠度', context, 'GB50017-2017 10.2.1', 'f <= l/250', limit),
        ],
    }]


def _build_chapter_summaries(checks):
    chapters = []
    for check in checks:
        chapter_name = check.get('chapter') or check.get('name')
        items = check.get('items', [])
        max_utilization = 0.0
        status = 'pass'
        controlling_clause = None
        for item in items:
            utilization = float(item.get('utilization', 0.0))
            if utilization >= max_utilization:
                max_utilization = utilization
                controlling_clause = item.get('clause')
            if item.get('status') != 'pass':
                status = 'fail'
        chapters.append({
            'chapter': chapter_name,
            'status': status,
            'itemCount': len(items),
            'maxUtilization': round(max_utilization, 4),
            'controllingClause': controlling_clause,
        })
    return chapters
