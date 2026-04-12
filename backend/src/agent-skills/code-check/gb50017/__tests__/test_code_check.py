"""Unit tests for GB50017-2017 钢结构构件校核模块。

可直接运行: python -m pytest backend/src/agent-skills/code-check/gb50017/__tests__/test_code_check.py
或: python backend/src/agent-skills/code-check/gb50017/__tests__/test_code_check.py
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict, List

import pytest

# Ensure the skill module is importable
_SKILL_DIR = str(Path(__file__).resolve().parent.parent)
if _SKILL_DIR not in sys.path:
    sys.path.insert(0, _SKILL_DIR)

import code_check as gb50017  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers — mock CodeChecker providing _calc_item / _build_element_result
# ---------------------------------------------------------------------------

class MockCodeChecker:
    """Minimal mock that replicates the CodeChecker interface used by check_element."""

    def __init__(self, overrides: Dict[str, Dict[str, float]] | None = None):
        self._overrides = overrides or {}

    def _resolve_utilization(self, elem_id: str, item_name: str, context: Dict[str, Any]) -> float:
        per_elem = self._overrides.get(elem_id, {})
        raw = per_elem.get(item_name)
        if isinstance(raw, (int, float)):
            return max(0.0, float(raw))
        ctx_overrides = context.get('utilizationByElement', {})
        if isinstance(ctx_overrides, dict):
            ctx_elem = ctx_overrides.get(elem_id, {})
            if isinstance(ctx_elem, dict):
                val = ctx_elem.get(item_name)
                if isinstance(val, (int, float)):
                    return max(0.0, float(val))
        # Deterministic fallback matching parent CodeChecker
        seed = sum(ord(ch) for ch in f'{elem_id}:{item_name}')
        return 0.55 + (seed % 40) / 100.0

    def _calc_item(
        self,
        elem_id: str,
        item_name: str,
        context: Dict[str, Any],
        clause: str,
        formula: str,
        limit: float,
    ) -> Dict[str, Any]:
        utilization = self._resolve_utilization(elem_id, item_name, context)
        return {
            'item': item_name,
            'status': 'pass' if utilization <= 1.0 else 'fail',
            'utilization': round(utilization, 4),
            'clause': clause,
            'formula': formula,
            'inputs': {
                'demand': round(utilization * limit, 4),
                'capacity': round(limit, 4),
                'limit': limit,
            },
        }

    def _build_element_result(
        self,
        elem_id: str,
        element_type: str,
        checks: List[Dict[str, Any]],
        code_version: str,
    ) -> Dict[str, Any]:
        all_items = [item for check in checks for item in check.get('items', [])]
        controlling = max(all_items, key=lambda i: float(i.get('utilization', 0.0)), default={})
        all_passed = all(i.get('status') == 'pass' for i in all_items)
        return {
            'elementId': elem_id,
            'elementType': element_type,
            'status': 'pass' if all_passed else 'fail',
            'checks': checks,
            'controlling': {
                'item': controlling.get('item'),
                'utilization': controlling.get('utilization', 0.0),
                'clause': controlling.get('clause'),
            },
            'code': code_version,
        }


def _make_beam_element_data(**overrides) -> Dict[str, Any]:
    """Create a default beam elementData entry."""
    return {
        **{
            'type': 'beam',
            'section': {'A': 5000.0, 'Wnx': 200000.0, 'Wx': 200000.0, 'i': 50.0,
                        'I': 1e7, 'S': 100000.0, 'tw': 8.0, 'As': 2000.0},
            'material': {'f': 215.0, 'fv': 125.0, 'fy': 235.0},
            'forces': {'N': 50000.0, 'V': 30000.0, 'Mx': 30000000.0},
            'length': 6000.0,
            'phi': 0.85,
        },
        **overrides,
    }


def _make_column_element_data(**overrides) -> Dict[str, Any]:
    return {
        **{
            'type': 'column',
            'section': {'A': 8000.0, 'imin': 40.0, 'i': 40.0, 'b': 200.0, 't': 12.0},
            'material': {'f': 215.0, 'fv': 125.0},
            'forces': {'N': 800000.0, 'V': 10000.0},
            'length': 4000.0,
            'phi': 0.75,
            'btLimit': 15.0,
            'lambdaLimit': 150.0,
        },
        **overrides,
    }


# ===========================================================================
# Tests
# ===========================================================================


class TestGetRules:
    def test_returns_correct_code_and_version(self):
        rules = gb50017.get_rules()
        assert rules['code'] == 'GB50017'
        assert rules['version'] == 'v2-member-checks'

    def test_rules_array_non_empty(self):
        rules = gb50017.get_rules()
        assert len(rules['rules']) >= 3

    def test_contains_expected_check_categories(self):
        rules = gb50017.get_rules()
        names = [r['name'] for r in rules['rules']]
        assert '强度验算' in names
        assert '稳定验算' in names
        assert '刚度验算' in names

    def test_strength_checks_include_normal_shear_equivalent(self):
        rules = gb50017.get_rules()
        strength = next(r for r in rules['rules'] if r['name'] == '强度验算')
        items = [c['item'] for c in strength['checks']]
        assert '正应力' in items
        assert '剪应力' in items
        assert '折算应力' in items

    def test_stability_checks_include_overall_local_axial(self):
        rules = gb50017.get_rules()
        stability = next(r for r in rules['rules'] if r['name'] == '稳定验算')
        items = [c['item'] for c in stability['checks']]
        assert '整体稳定' in items
        assert '轴压稳定' in items
        assert '局部稳定' in items

    def test_stiffness_checks_include_slenderness_deflection(self):
        rules = gb50017.get_rules()
        stiffness = next(r for r in rules['rules'] if r['name'] == '刚度验算')
        items = [c['item'] for c in stiffness['checks']]
        assert '长细比' in items
        assert '挠度' in items


class TestResolveElementType:
    def test_beam_from_context(self):
        ctx = {'elementData': {'B1': {'type': 'beam'}}}
        assert gb50017._resolve_element_type('B1', ctx) == 'beam'

    def test_column_from_context(self):
        ctx = {'elementData': {'C1': {'type': 'column'}}}
        assert gb50017._resolve_element_type('C1', ctx) == 'column'

    def test_brace_from_context(self):
        ctx = {'elementData': {'X1': {'type': 'brace'}}}
        assert gb50017._resolve_element_type('X1', ctx) == 'brace'

    def test_column_from_naming_heuristic_col(self):
        assert gb50017._resolve_element_type('C1-col', {}) == 'column'

    def test_column_from_naming_heuristic_C_prefix(self):
        # 'C' alone doesn't contain 'col', falls to default beam
        assert gb50017._resolve_element_type('C-1', {}) == 'beam'
        # But 'col' in name works
        assert gb50017._resolve_element_type('C-col-1', {}) == 'column'

    def test_brace_from_naming_heuristic_brace_in_name(self):
        assert gb50017._resolve_element_type('X1-brace-1', {}) == 'brace'

    def test_brace_from_naming_heuristic_br_prefix(self):
        # 'br-1' does not contain 'brace', falls to beam
        assert gb50017._resolve_element_type('br-1', {}) == 'beam'

    def test_default_beam_when_no_data(self):
        assert gb50017._resolve_element_type('B1', {}) == 'beam'

    def test_default_beam_when_empty_element_data(self):
        assert gb50017._resolve_element_type('B1', {'elementData': {}}) == 'beam'


class TestComputeUtilizationOverrides:
    """Tests for _compute_utilization_overrides (returns new dict, no mutation)."""

    def test_computes_normal_stress_with_bending(self):
        ctx: Dict[str, Any] = {
            'elementData': {'E1': _make_beam_element_data()},
        }
        result = gb50017._compute_utilization_overrides('E1', ctx)
        # N=50000, A=5000 -> sigma_axial=10, Mx=3e7, Wnx=2e5 -> sigma_bending=150
        # utilization = (10 + 150) / 215 ≈ 0.744
        assert '正应力' in result
        expected = (50000.0 / 5000.0 + 30000000.0 / 200000.0) / 215.0
        assert result['正应力'] == pytest.approx(expected, abs=0.001)

    def test_computes_normal_stress_axial_only(self):
        ctx: Dict[str, Any] = {
            'elementData': {'E1': {
                'section': {'A': 5000.0},
                'material': {'f': 215.0},
                'forces': {'N': 50000.0},
            }},
        }
        result = gb50017._compute_utilization_overrides('E1', ctx)
        assert result['正应力'] == pytest.approx(50000.0 / 5000.0 / 215.0, abs=0.001)

    def test_computes_shear_stress_with_S_I_tw(self):
        ctx: Dict[str, Any] = {
            'elementData': {'E1': _make_beam_element_data()},
        }
        result = gb50017._compute_utilization_overrides('E1', ctx)
        # V=30000, S=100000, I=1e7, tw=8 -> tau = 30000*100000/(1e7*8) = 37.5
        # fv=125 -> 37.5/125 = 0.3
        assert '剪应力' in result
        expected = 30000.0 * 100000.0 / (1e7 * 8.0) / 125.0
        assert result['剪应力'] == pytest.approx(expected, abs=0.001)

    def test_computes_shear_stress_with_As_fallback(self):
        ctx: Dict[str, Any] = {
            'elementData': {'E1': {
                'section': {'A': 5000.0, 'As': 2000.0},
                'material': {'fv': 125.0},
                'forces': {'V': 30000.0, 'N': 50000.0},
            }},
        }
        result = gb50017._compute_utilization_overrides('E1', ctx)
        assert '剪应力' in result
        expected = 30000.0 / 2000.0 / 125.0
        assert result['剪应力'] == pytest.approx(expected, abs=0.001)

    def test_computes_equivalent_stress_includes_bending(self):
        ctx: Dict[str, Any] = {
            'elementData': {'E1': _make_beam_element_data()},
        }
        result = gb50017._compute_utilization_overrides('E1', ctx)
        assert '折算应力' in result
        sigma_axial = 50000.0 / 5000.0  # 10
        sigma_bending = 30000000.0 / 200000.0  # 150
        tau = 30000.0 * 100000.0 / (1e7 * 8.0)  # 37.5
        expected = (sigma_axial ** 2 + sigma_bending ** 2
                    - sigma_axial * sigma_bending + 3 * tau ** 2) ** 0.5 / 215.0
        assert result['折算应力'] == pytest.approx(expected, abs=0.001)

    def test_computes_overall_stability(self):
        ctx: Dict[str, Any] = {
            'elementData': {'E1': _make_beam_element_data()},
        }
        result = gb50017._compute_utilization_overrides('E1', ctx)
        assert '整体稳定' in result
        assert result['整体稳定'] == pytest.approx(
            30000000.0 / (0.85 * 200000.0 * 215.0), abs=0.001
        )

    def test_computes_axial_compression_stability(self):
        ctx: Dict[str, Any] = {
            'elementData': {'C1': _make_column_element_data()},
        }
        result = gb50017._compute_utilization_overrides('C1', ctx)
        assert '轴压稳定' in result
        assert result['轴压稳定'] == pytest.approx(
            800000.0 / (0.75 * 8000.0 * 215.0), abs=0.001
        )

    def test_caller_override_not_overwritten(self):
        ctx: Dict[str, Any] = {
            'elementData': {'E1': _make_beam_element_data()},
            'utilizationByElement': {'E1': {'正应力': 0.73}},
        }
        result = gb50017._compute_utilization_overrides('E1', ctx)
        # Function returns computed values only; caller override is in ctx, not in result
        assert '正应力' not in result  # skipped because already in per_elem

    def test_no_computation_when_no_element_data(self):
        ctx: Dict[str, Any] = {}
        result = gb50017._compute_utilization_overrides('E1', ctx)
        assert result == {}

    def test_partial_data_computes_available_checks(self):
        ctx: Dict[str, Any] = {
            'elementData': {'E1': {
                'section': {'A': 5000.0},
                'material': {'f': 215.0},
                'forces': {'N': 50000.0},
            }},
        }
        result = gb50017._compute_utilization_overrides('E1', ctx)
        assert '正应力' in result
        assert '剪应力' not in result

    def test_computes_slenderness(self):
        ctx: Dict[str, Any] = {
            'elementData': {'C1': _make_column_element_data()},
        }
        result = gb50017._compute_utilization_overrides('C1', ctx)
        assert '长细比' in result
        assert result['长细比'] == pytest.approx(4000.0 / 40.0 / 150.0, abs=0.001)

    def test_computes_deflection_only_when_limit_provided(self):
        ctx: Dict[str, Any] = {
            'elementData': {'B1': {
                'section': {'A': 5000.0},
                'material': {'f': 215.0},
                'forces': {'N': 0, 'deflection': 12.0},
                'length': 6000.0,
                'deflectionLimitN': 250,
            }},
        }
        result = gb50017._compute_utilization_overrides('B1', ctx)
        assert '挠度' in result
        assert result['挠度'] == pytest.approx(12.0 / (6000.0 / 250.0), abs=0.001)

    def test_no_deflection_without_explicit_limit(self):
        ctx: Dict[str, Any] = {
            'elementData': {'B1': {
                'section': {'A': 5000.0},
                'material': {'f': 215.0},
                'forces': {'N': 0, 'deflection': 12.0},
                'length': 6000.0,
                # no deflectionLimitN
            }},
        }
        result = gb50017._compute_utilization_overrides('B1', ctx)
        assert '挠度' not in result

    def test_computes_local_stability(self):
        ctx: Dict[str, Any] = {
            'elementData': {'C1': _make_column_element_data()},
        }
        result = gb50017._compute_utilization_overrides('C1', ctx)
        assert '局部稳定' in result
        assert result['局部稳定'] == pytest.approx(200.0 / 12.0 / 15.0, abs=0.001)

    def test_zero_area_does_not_crash(self):
        ctx: Dict[str, Any] = {
            'elementData': {'E1': {
                'section': {'A': 0.0},
                'material': {'f': 215.0},
                'forces': {'N': 50000.0, 'V': 30000.0},
            }},
        }
        result = gb50017._compute_utilization_overrides('E1', ctx)
        assert '正应力' not in result

    def test_does_not_mutate_context(self):
        ctx: Dict[str, Any] = {
            'elementData': {'E1': _make_beam_element_data()},
        }
        original_keys = set(ctx.keys())
        gb50017._compute_utilization_overrides('E1', ctx)
        assert set(ctx.keys()) == original_keys
        assert 'utilizationByElement' not in ctx


class TestCheckElementBeam:
    def test_beam_has_strength_checks(self):
        checker = MockCodeChecker()
        ctx = {'elementData': {'B1': _make_beam_element_data()}}
        result = gb50017.check_element(checker, 'B1', ctx)
        strength = next(c for c in result['checks'] if c['name'] == '强度验算')
        items = [i['item'] for i in strength['items']]
        assert '正应力' in items
        assert '剪应力' in items
        assert '折算应力' in items

    def test_beam_has_stability_checks(self):
        checker = MockCodeChecker()
        ctx = {'elementData': {'B1': _make_beam_element_data()}}
        result = gb50017.check_element(checker, 'B1', ctx)
        stability = next(c for c in result['checks'] if c['name'] == '稳定验算')
        items = [i['item'] for i in stability['items']]
        assert '整体稳定' in items
        assert '局部稳定' in items

    def test_beam_has_deflection_check(self):
        checker = MockCodeChecker()
        ctx = {'elementData': {'B1': _make_beam_element_data()}}
        result = gb50017.check_element(checker, 'B1', ctx)
        stiffness = next(c for c in result['checks'] if c['name'] == '刚度验算')
        items = [i['item'] for i in stiffness['items']]
        assert '挠度' in items

    def test_beam_element_type_in_result(self):
        checker = MockCodeChecker()
        ctx = {'elementData': {'B1': _make_beam_element_data()}}
        result = gb50017.check_element(checker, 'B1', ctx)
        assert result['elementType'] == 'beam'
        assert result['code'] == 'GB50017-2017'

    def test_beam_computed_utilization_includes_bending(self):
        checker = MockCodeChecker()
        ctx = {'elementData': {'B1': _make_beam_element_data()}}
        result = gb50017.check_element(checker, 'B1', ctx)
        strength = next(c for c in result['checks'] if c['name'] == '强度验算')
        normal = next(i for i in strength['items'] if i['item'] == '正应力')
        expected = (50000.0 / 5000.0 + 30000000.0 / 200000.0) / 215.0
        assert normal['utilization'] == pytest.approx(expected, abs=0.001)


class TestCheckElementColumn:
    def test_column_has_axial_compression_stability(self):
        checker = MockCodeChecker()
        ctx = {'elementData': {'C1': _make_column_element_data()}}
        result = gb50017.check_element(checker, 'C1', ctx)
        stability = next(c for c in result['checks'] if c['name'] == '稳定验算')
        items = [i['item'] for i in stability['items']]
        assert '轴压稳定' in items

    def test_column_has_slenderness(self):
        checker = MockCodeChecker()
        ctx = {'elementData': {'C1': _make_column_element_data()}}
        result = gb50017.check_element(checker, 'C1', ctx)
        stiffness = next(c for c in result['checks'] if c['name'] == '刚度验算')
        items = [i['item'] for i in stiffness['items']]
        assert '长细比' in items

    def test_column_element_type_in_result(self):
        checker = MockCodeChecker()
        ctx = {'elementData': {'C1': _make_column_element_data()}}
        result = gb50017.check_element(checker, 'C1', ctx)
        assert result['elementType'] == 'column'

    def test_column_no_beam_overall_stability(self):
        checker = MockCodeChecker()
        ctx = {'elementData': {'C1': _make_column_element_data()}}
        result = gb50017.check_element(checker, 'C1', ctx)
        stability = next(c for c in result['checks'] if c['name'] == '稳定验算')
        items = [i['item'] for i in stability['items']]
        assert '整体稳定' not in items  # beam-only check


class TestCheckElementBrace:
    def test_brace_has_axial_strength(self):
        checker = MockCodeChecker()
        ctx = {'elementData': {'X1-brace-1': {'type': 'brace', 'section': {'A': 3000.0}, 'material': {'f': 215.0}, 'forces': {'N': 200000.0}}}}
        result = gb50017.check_element(checker, 'X1-brace-1', ctx)
        strength = next(c for c in result['checks'] if c['name'] == '强度验算')
        assert strength['items'][0]['item'] == '正应力'

    def test_brace_has_slenderness(self):
        checker = MockCodeChecker()
        ctx = {'elementData': {'X1-brace-1': {'type': 'brace', 'section': {'A': 3000.0, 'i': 30.0}, 'material': {'f': 215.0}, 'forces': {'N': 200000.0}, 'length': 5000.0, 'lambdaLimit': 200.0}}}
        result = gb50017.check_element(checker, 'X1-brace-1', ctx)
        stiffness = next(c for c in result['checks'] if c['name'] == '刚度验算')
        items = [i['item'] for i in stiffness['items']]
        assert '长细比' in items

    def test_brace_element_type_in_result(self):
        checker = MockCodeChecker()
        ctx = {'elementData': {'X1-brace-1': {'type': 'brace', 'section': {'A': 3000.0}, 'material': {'f': 215.0}, 'forces': {'N': 200000.0}}}}
        result = gb50017.check_element(checker, 'X1-brace-1', ctx)
        assert result['elementType'] == 'brace'


class TestBackwardCompatibility:
    def test_traceability_contract(self):
        """Replicates validate_code_check_traceability from analysis-runner.py."""
        checker = MockCodeChecker(overrides={'E1': {'正应力': 0.73}})
        ctx = {
            'analysisSummary': {'analysisType': 'static', 'success': True},
            'utilizationByElement': {'E1': {'正应力': 0.73}},
        }
        result = gb50017.check_element(checker, 'E1', ctx)

        assert result['code'] == 'GB50017-2017'
        item = result['checks'][0]['items'][0]
        assert item['clause'] == 'GB50017-2017 7.1.1'
        assert item['formula']
        assert item['inputs']['demand'] >= 0
        assert item['utilization'] >= 0

    def test_fallback_when_no_element_data(self):
        """Without elementData, deterministic seed fallback still works."""
        checker = MockCodeChecker()
        ctx = {'utilizationByElement': {}}
        result = gb50017.check_element(checker, 'E1', ctx)

        assert result['elementId'] == 'E1'
        assert result['status'] in ('pass', 'fail')
        all_items = [i for c in result['checks'] for i in c.get('items', [])]
        assert len(all_items) > 0
        for item in all_items:
            assert item['utilization'] >= 0

    def test_caller_override_priority(self):
        """When both elementData and utilizationByElement provide values, caller wins."""
        checker = MockCodeChecker()
        ctx = {
            'elementData': {'E1': _make_beam_element_data()},
            'utilizationByElement': {'E1': {'正应力': 0.90}},
        }
        result = gb50017.check_element(checker, 'E1', ctx)
        strength = next(c for c in result['checks'] if c['name'] == '强度验算')
        normal = next(i for i in strength['items'] if i['item'] == '正应力')
        assert normal['utilization'] == pytest.approx(0.90, abs=0.01)

    def test_first_check_is_strength_normal_stress(self):
        """First check group is 强度验算, first item is 正应力 — matches existing contract."""
        checker = MockCodeChecker()
        result = gb50017.check_element(checker, 'E1', {})
        assert result['checks'][0]['name'] == '强度验算'
        assert result['checks'][0]['items'][0]['item'] == '正应力'
        assert result['checks'][0]['items'][0]['clause'] == 'GB50017-2017 7.1.1'

    def test_context_not_mutated_by_check_element(self):
        """check_element should not mutate the original context."""
        checker = MockCodeChecker()
        ctx: Dict[str, Any] = {
            'elementData': {'E1': _make_beam_element_data()},
        }
        original_ctx = dict(ctx)
        gb50017.check_element(checker, 'E1', ctx)
        assert ctx == original_ctx


class TestClauseReferences:
    def test_beam_clauses_reference_gb50017_2017(self):
        checker = MockCodeChecker()
        ctx = {'elementData': {'B1': _make_beam_element_data()}}
        result = gb50017.check_element(checker, 'B1', ctx)
        all_items = [i for c in result['checks'] for i in c.get('items', [])]
        for item in all_items:
            assert item['clause'].startswith('GB50017-2017')

    def test_beam_strength_clause_7_1_1(self):
        checker = MockCodeChecker()
        ctx = {'elementData': {'B1': _make_beam_element_data()}}
        result = gb50017.check_element(checker, 'B1', ctx)
        normal = result['checks'][0]['items'][0]
        assert '7.1.1' in normal['clause']

    def test_column_axial_stability_clause_8_1_1(self):
        checker = MockCodeChecker()
        ctx = {'elementData': {'C1': _make_column_element_data()}}
        result = gb50017.check_element(checker, 'C1', ctx)
        stability = next(c for c in result['checks'] if c['name'] == '稳定验算')
        axial = next(i for i in stability['items'] if i['item'] == '轴压稳定')
        assert '8.1.1' in axial['clause']

    def test_column_slenderness_clause_10_1_1(self):
        checker = MockCodeChecker()
        ctx = {'elementData': {'C1': _make_column_element_data()}}
        result = gb50017.check_element(checker, 'C1', ctx)
        stiffness = next(c for c in result['checks'] if c['name'] == '刚度验算')
        slenderness = next(i for i in stiffness['items'] if i['item'] == '长细比')
        assert '10.1.1' in slenderness['clause']


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
