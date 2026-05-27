from __future__ import annotations

from typing import Any, Dict, List


def get_rules() -> Dict[str, Any]:
    return {
        'code': 'GB50010',
        'version': 'v2-rc-frame-member-checks',
        'rules': [
            {
                'name': '梁承载力与正常使用验算',
                'elementType': ['beam'],
                'checks': ['正截面受弯', '斜截面受剪', '挠度', '裂缝宽度'],
            },
            {
                'name': '柱承载力与稳定验算',
                'elementType': ['column'],
                'checks': ['轴压比', '偏心受压', '斜截面受剪', '长细比'],
            },
        ],
    }


def _resolve_element_context(elem_id: str, context: Dict[str, Any]) -> Dict[str, Any]:
    mapping = context.get('elementContextById', {})
    if isinstance(mapping, dict):
        value = mapping.get(elem_id)
        if isinstance(value, dict):
            return value
    return {}


def _resolve_element_type(elem_id: str, context: Dict[str, Any]) -> str:
    element_context = _resolve_element_context(elem_id, context)
    raw_type = element_context.get('type')
    if raw_type:
        normalized = str(raw_type).strip().lower()
        if normalized in {'beam', 'column'}:
            return normalized
        if 'column' in normalized:
            return 'column'
        if 'beam' in normalized:
            return 'beam'

    lower = elem_id.lower()
    if lower.startswith('c') or 'column' in lower or 'col' in lower:
        return 'column'
    return 'beam'


def _build_chapter_summaries(checks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    chapters = []
    for check in checks:
        chapter_name = check.get('chapter') or check.get('name')
        items = check.get('items', [])
        max_utilization = 0.0
        status = 'pass'
        controlling_clause = None
        for item in items:
            util_val = item.get('utilization')
            utilization = float(util_val) if util_val is not None else 0.0
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


def _check_beam(checker: Any, elem_id: str, context: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [
        {
            'chapter': '第6章 承载能力极限状态',
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


def _check_column(checker: Any, elem_id: str, context: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [
        {
            'chapter': '第6章 承载能力极限状态',
            'name': '柱承载力验算',
            'items': [
                checker._calc_item(elem_id, '轴压比', context, 'GB50010-2010 6.2.15', 'N/(f_c*A) <= 轴压比限值', 0.90),
                checker._calc_item(elem_id, '偏心受压', context, 'GB50010-2010 6.2.17', 'N-M interaction <= 1.0', 1.0),
                checker._calc_item(elem_id, '斜截面受剪', context, 'GB50010-2010 6.3.12', 'V <= Vc + Vs', 0.95),
            ],
        },
        {
            'chapter': '第7章 构造与稳定',
            'name': '柱稳定与构造验算',
            'items': [
                checker._calc_item(elem_id, '长细比', context, 'GB50010-2010 6.2.20', 'l0/i <= 限值', 1.0),
            ],
        },
    ]


def check_element(checker: Any, elem_id: str, context: Dict[str, Any]) -> Dict[str, Any]:
    element_context = _resolve_element_context(elem_id, context)
    element_type = _resolve_element_type(elem_id, context)
    checks = _check_column(checker, elem_id, context) if element_type == 'column' else _check_beam(checker, elem_id, context)
    result = checker._build_element_result(elem_id, element_type, checks, 'GB50010-2010')
    result['chapters'] = _build_chapter_summaries(checks)
    result['chapterCount'] = len(result['chapters'])
    result['elementContext'] = {
        'type': element_type,
        'section': element_context.get('section'),
        'material': element_context.get('material'),
        'concreteGrade': element_context.get('concreteGrade'),
        'rebarGrade': element_context.get('rebarGrade'),
    }
    return result
