"""GB50017-2017 钢结构设计标准 — 构件校核实现。

覆盖第 7 章（强度）、第 8 章（稳定）、第 10 章（刚度）中梁、柱、支撑的
构件级验算。连接校核（第 9 章）不在本迭代范围内。
"""
from __future__ import annotations

from typing import Any, Dict, List


RULE_VERSION = 'v2-member-checks'
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
        'checks': ['整体稳定', '轴压稳定', '局部稳定', '长细比'],
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
        'rules': [
            {
                'name': '强度验算',
                'clause': 'GB50017-2017 Chapter 7',
                'elementType': ['beam', 'column', 'brace'],
                'checks': [
                    {
                        'item': '正应力',
                        'clause': '7.1.1',
                        'formula': 'σ = N/Aₙ ≤ f',
                        'limit': 1.0,
                        'params': ['N', 'A', 'f'],
                    },
                    {
                        'item': '剪应力',
                        'clause': '7.1.2',
                        'formula': 'τ = V/(Aₙ·t) ≤ f_v',
                        'limit': 1.0,
                        'params': ['V', 'A', 'fv'],
                    },
                    {
                        'item': '折算应力',
                        'clause': '7.1.4',
                        'formula': '√(σ² + 3τ²) ≤ β₁·f',
                        'limit': 1.0,
                        'params': ['sigma', 'tau', 'f'],
                    },
                ],
            },
            {
                'name': '稳定验算',
                'clause': 'GB50017-2017 Chapter 8',
                'elementType': ['beam', 'column', 'brace'],
                'checks': [
                    {
                        'item': '整体稳定',
                        'clause': '8.2.1',
                        'formula': 'M/(φb·Wₓ·f) ≤ 1.0',
                        'limit': 1.0,
                        'params': ['Mx', 'phi', 'Wnx', 'f'],
                    },
                    {
                        'item': '轴压稳定',
                        'clause': '8.1.1',
                        'formula': 'N/(φ·A·f) ≤ 1.0',
                        'limit': 1.0,
                        'params': ['N', 'phi', 'A', 'f'],
                    },
                    {
                        'item': '局部稳定',
                        'clause': '8.4.1',
                        'formula': 'b/t ≤ [b/t]',
                        'limit': 1.0,
                        'params': ['b', 't', 'btLimit'],
                    },
                ],
            },
            {
                'name': '刚度验算',
                'clause': 'GB50017-2017 Chapter 10',
                'elementType': ['beam', 'column', 'brace'],
                'checks': [
                    {
                        'item': '长细比',
                        'clause': '8.3.1',
                        'formula': 'λ = l₀/i ≤ [λ]',
                        'limit': 1.0,
                        'params': ['l0', 'i', 'lambdaLimit'],
                    },
                    {
                        'item': '挠度',
                        'clause': '10.2.1',
                        'formula': 'f_max ≤ L/n',
                        'limit': 1.0,
                        'params': ['deflection', 'L', 'deflectionLimitN'],
                    },
                ],
            },
        ],
    }


# ---------------------------------------------------------------------------
# Element type resolution
# ---------------------------------------------------------------------------

def _resolve_element_context(elem_id: str, context: Dict[str, Any]) -> Dict[str, Any]:
    """Resolve element context from elementContextById (upstream PR #134)."""
    mapping = context.get('elementContextById', {})
    if isinstance(mapping, dict):
        value = mapping.get(elem_id)
        if isinstance(value, dict):
            return value
    return {}


def _resolve_element_type(elem_id: str, context: Dict[str, Any]) -> str:
    """Determine element type from context or naming heuristics."""
    # Prefer elementContextById (upstream)
    element_context = _resolve_element_context(elem_id, context)
    raw_type = element_context.get('type')
    if raw_type:
        normalized = str(raw_type).strip().lower()
        if normalized in {'column', 'brace', 'beam'}:
            return normalized
        if 'column' in normalized:
            return 'column'
        if 'brace' in normalized:
            return 'brace'

    # Fallback: elementData
    element_data = context.get('elementData', {})
    if isinstance(element_data, dict):
        elem = element_data.get(elem_id, {})
        if isinstance(elem, dict) and 'type' in elem:
            return str(elem['type']).lower()

    # Fallback: naming heuristics
    lower = elem_id.lower()
    if 'col' in lower:
        return 'column'
    if 'brace' in lower or lower.startswith('br'):
        return 'brace'
    return 'beam'


# ---------------------------------------------------------------------------
# Utilization computation from elementData
# ---------------------------------------------------------------------------

def _ensure_utilization_overrides(elem_id: str, context: Dict[str, Any]) -> None:
    """Pre-populate utilizationByElement from elementData where possible.

    Only adds values that are not already present — caller overrides win.
    """
    element_data = context.get('elementData', {})
    if not isinstance(element_data, dict):
        return
    elem = element_data.get(elem_id)
    if not isinstance(elem, dict):
        return

    section = elem.get('section', {})
    material = elem.get('material', {})
    forces = elem.get('forces', {})
    if not isinstance(section, dict) or not isinstance(material, dict) or not isinstance(forces, dict):
        return

    overrides = context.setdefault('utilizationByElement', {})
    per_elem = overrides.setdefault(elem_id, {})

    A = section.get('A')
    f = material.get('f')
    fv = material.get('fv')
    N = forces.get('N')
    V = forces.get('V')
    Mx = forces.get('Mx')

    # Normal stress: |N| / A / f
    if '正应力' not in per_elem and A is not None and f is not None and N is not None:
        try:
            per_elem['正应力'] = abs(float(N)) / float(A) / float(f)
        except (ZeroDivisionError, ValueError, TypeError):
            pass

    # Shear stress: |V| / A / fv
    if '剪应力' not in per_elem and A is not None and fv is not None and V is not None:
        try:
            per_elem['剪应力'] = abs(float(V)) / float(A) / float(fv)
        except (ZeroDivisionError, ValueError, TypeError):
            pass

    # Equivalent stress: sqrt(sigma^2 + 3*tau^2) / f
    if '折算应力' not in per_elem and A is not None and f is not None and N is not None and V is not None:
        try:
            sigma = abs(float(N)) / float(A)
            tau = abs(float(V)) / float(A)
            per_elem['折算应力'] = (sigma ** 2 + 3 * tau ** 2) ** 0.5 / float(f)
        except (ZeroDivisionError, ValueError, TypeError):
            pass

    # Overall beam stability: |Mx| / (phi * Wnx * f)
    if '整体稳定' not in per_elem:
        phi = elem.get('phi')
        Wnx = section.get('Wnx') or section.get('Wx')
        if phi is not None and Wnx is not None and f is not None and Mx is not None:
            try:
                per_elem['整体稳定'] = abs(float(Mx)) / (float(phi) * float(Wnx) * float(f))
            except (ZeroDivisionError, ValueError, TypeError):
                pass

    # Axial compression stability: |N| / (phi * A * f)
    if '轴压稳定' not in per_elem:
        phi = elem.get('phi')
        if phi is not None and A is not None and f is not None and N is not None:
            try:
                per_elem['轴压稳定'] = abs(float(N)) / (float(phi) * float(A) * float(f))
            except (ZeroDivisionError, ValueError, TypeError):
                pass

    # Local plate stability: (b/t) / bt_limit
    if '局部稳定' not in per_elem:
        b = section.get('flangeWidth') or section.get('b')
        t = section.get('flangeThickness') or section.get('t')
        bt_limit = elem.get('btLimit')
        if b is not None and t is not None and bt_limit is not None:
            try:
                per_elem['局部稳定'] = (float(b) / float(t)) / float(bt_limit)
            except (ZeroDivisionError, ValueError, TypeError):
                pass

    # Slenderness ratio: (l0 / i) / lambda_limit
    if '长细比' not in per_elem:
        l0 = elem.get('length') or elem.get('l0')
        i_min = section.get('imin') or section.get('i')
        lambda_limit = elem.get('lambdaLimit')
        if l0 is not None and i_min is not None and lambda_limit is not None:
            try:
                per_elem['长细比'] = float(l0) / float(i_min) / float(lambda_limit)
            except (ZeroDivisionError, ValueError, TypeError):
                pass

    # Deflection: f_max / (L / n)
    if '挠度' not in per_elem:
        f_max = forces.get('deflection') or elem.get('deflection')
        L = elem.get('length')
        n_limit = elem.get('deflectionLimitN', 250)
        if f_max is not None and L is not None:
            try:
                per_elem['挠度'] = abs(float(f_max)) / (float(L) / float(n_limit))
            except (ZeroDivisionError, ValueError, TypeError):
                pass


# ---------------------------------------------------------------------------
# Element-type-specific check builders
# ---------------------------------------------------------------------------

def _check_beam(checker: Any, elem_id: str, context: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [
        {
            'chapter': '第7章 强度验算',
            'name': '强度验算',
            'items': [
                checker._calc_item(elem_id, '正应力', context, 'GB50017-2017 7.1.1', 'σ = N/Aₙ ≤ f', 1.0),
                checker._calc_item(elem_id, '剪应力', context, 'GB50017-2017 7.1.2', 'τ = V/(Aₙ·t) ≤ f_v', 1.0),
                checker._calc_item(elem_id, '折算应力', context, 'GB50017-2017 7.1.4', '√(σ² + 3τ²) ≤ β₁·f', 1.0),
            ],
        },
        {
            'chapter': '第8章 稳定验算',
            'name': '稳定验算',
            'items': [
                checker._calc_item(elem_id, '整体稳定', context, 'GB50017-2017 8.2.1', 'M/(φb·Wₓ·f) ≤ 1.0', 1.0),
                checker._calc_item(elem_id, '局部稳定', context, 'GB50017-2017 8.4.1', 'b/t ≤ [b/t]', 1.0),
            ],
        },
        {
            'chapter': '第10章 正常使用极限状态',
            'name': '刚度验算',
            'items': [
                checker._calc_item(elem_id, '挠度', context, 'GB50017-2017 10.2.1', 'f_max ≤ L/n', 1.0),
            ],
        },
    ]


def _check_column(checker: Any, elem_id: str, context: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [
        {
            'chapter': '第7章 强度验算',
            'name': '强度验算',
            'items': [
                checker._calc_item(elem_id, '正应力', context, 'GB50017-2017 7.1.1', 'σ = N/Aₙ ≤ f', 1.0),
            ],
        },
        {
            'chapter': '第8章 稳定验算',
            'name': '稳定验算',
            'items': [
                checker._calc_item(elem_id, '轴压稳定', context, 'GB50017-2017 8.1.1', 'N/(φ·A·f) ≤ 1.0', 1.0),
                checker._calc_item(elem_id, '局部稳定', context, 'GB50017-2017 8.4.1', 'b/t ≤ [b/t]', 1.0),
            ],
        },
        {
            'chapter': '第10章 正常使用极限状态',
            'name': '刚度验算',
            'items': [
                checker._calc_item(elem_id, '长细比', context, 'GB50017-2017 8.3.1', 'λ = l₀/i ≤ [λ]', 1.0),
            ],
        },
    ]


def _check_brace(checker: Any, elem_id: str, context: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [
        {
            'chapter': '第7章 强度验算',
            'name': '强度验算',
            'items': [
                checker._calc_item(elem_id, '正应力', context, 'GB50017-2017 7.1.1', 'σ = N/Aₙ ≤ f', 1.0),
            ],
        },
        {
            'chapter': '第8章 稳定验算',
            'name': '稳定验算',
            'items': [
                checker._calc_item(elem_id, '轴压稳定', context, 'GB50017-2017 8.1.1', 'N/(φ·A·f) ≤ 1.0', 1.0),
                checker._calc_item(elem_id, '局部稳定', context, 'GB50017-2017 8.4.1', 'b/t ≤ [b/t]', 1.0),
            ],
        },
        {
            'chapter': '第10章 正常使用极限状态',
            'name': '刚度验算',
            'items': [
                checker._calc_item(elem_id, '长细比', context, 'GB50017-2017 8.3.1', 'λ = l₀/i ≤ [λ]', 1.0),
            ],
        },
    ]


# ---------------------------------------------------------------------------
# Chapter summaries (from upstream PR #134)
# ---------------------------------------------------------------------------

def _build_chapter_summaries(checks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
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


# ---------------------------------------------------------------------------
# Main dispatcher
# ---------------------------------------------------------------------------

_BUILDERS = {
    'beam': _check_beam,
    'column': _check_column,
    'brace': _check_brace,
}


def check_element(checker: Any, elem_id: str, context: Dict[str, Any]) -> Dict[str, Any]:
    """GB50017-2017 构件校核入口。"""
    element_context = _resolve_element_context(elem_id, context)
    element_type = _resolve_element_type(elem_id, context)
    _ensure_utilization_overrides(elem_id, context)
    builder = _BUILDERS.get(element_type, _check_beam)
    checks = builder(checker, elem_id, context)
    result = checker._build_element_result(elem_id, element_type, checks, CODE_VERSION)
    result['chapters'] = _build_chapter_summaries(checks)
    result['chapterCount'] = len(result['chapters'])
    result['elementContext'] = {
        'type': element_type,
        'section': element_context.get('section'),
        'material': element_context.get('material'),
    }
    return result
