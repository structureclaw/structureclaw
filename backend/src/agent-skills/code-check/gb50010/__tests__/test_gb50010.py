"""Unit tests for GB50010 (混凝土设计规范) code-check module."""
from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any, Dict

import pytest

_MODULE_PATH = str(Path(__file__).resolve().parent.parent / "code_check.py")
_spec = importlib.util.spec_from_file_location("gb50010_code_check", _MODULE_PATH)
gb50010 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gb50010)


class MockCodeChecker:

    def __init__(self, overrides: Dict[str, Dict[str, float]] | None = None):
        self._overrides = overrides or {}

    def _resolve_utilization(self, elem_id, item_name, context):
        per_elem = self._overrides.get(elem_id, {})
        raw = per_elem.get(item_name)
        if isinstance(raw, (int, float)):
            return max(0.0, float(raw))
        return 0.55

    def _calc_item(self, elem_id, item_name, context, clause, formula, limit):
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

    def _build_element_result(self, elem_id, element_type, checks, code_version):
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


class TestGetRules:

    def test_code_field(self):
        assert gb50010.get_rules()['code'] == 'GB50010'

    def test_version_field(self):
        assert gb50010.get_rules()['version'] == 'v1-minimal'

    def test_rules_empty(self):
        assert gb50010.get_rules()['rules'] == []


class TestCheckElementStructure:

    def test_returns_dict(self):
        checker = MockCodeChecker()
        result = gb50010.check_element(checker, 'B1', {})
        assert isinstance(result, dict)

    def test_two_check_groups(self):
        checker = MockCodeChecker()
        result = gb50010.check_element(checker, 'B1', {})
        assert len(result['checks']) == 2

    def test_bearing_capacity_group(self):
        checker = MockCodeChecker()
        result = gb50010.check_element(checker, 'B1', {})
        group1 = result['checks'][0]
        assert group1['name'] == '承载力验算'
        assert len(group1['items']) == 2

    def test_serviceability_group(self):
        checker = MockCodeChecker()
        result = gb50010.check_element(checker, 'B1', {})
        group2 = result['checks'][1]
        assert group2['name'] == '正常使用验算'
        assert len(group2['items']) == 2


class TestClauseReferences:

    def test_flexure_clause(self):
        checker = MockCodeChecker()
        result = gb50010.check_element(checker, 'B1', {})
        items = result['checks'][0]['items']
        assert items[0]['clause'] == 'GB50010-2010 6.2.1'

    def test_shear_clause(self):
        checker = MockCodeChecker()
        result = gb50010.check_element(checker, 'B1', {})
        items = result['checks'][0]['items']
        assert items[1]['clause'] == 'GB50010-2010 6.3.1'

    def test_deflection_clause(self):
        checker = MockCodeChecker()
        result = gb50010.check_element(checker, 'B1', {})
        items = result['checks'][1]['items']
        assert items[0]['clause'] == 'GB50010-2010 3.3.2'

    def test_crack_clause(self):
        checker = MockCodeChecker()
        result = gb50010.check_element(checker, 'B1', {})
        items = result['checks'][1]['items']
        assert items[1]['clause'] == 'GB50010-2010 3.4.5'


class TestCheckElementResult:

    def test_element_type_beam(self):
        checker = MockCodeChecker()
        result = gb50010.check_element(checker, 'B1', {})
        assert result['elementType'] == 'beam'

    def test_code_version(self):
        checker = MockCodeChecker()
        result = gb50010.check_element(checker, 'B1', {})
        assert result['code'] == 'GB50010-2010'

    def test_all_pass_default(self):
        checker = MockCodeChecker()
        result = gb50010.check_element(checker, 'B1', {})
        assert result['status'] == 'pass'

    def test_fail_with_high_utilization(self):
        checker = MockCodeChecker(overrides={'B1': {'正截面受弯': 1.5}})
        result = gb50010.check_element(checker, 'B1', {})
        assert result['status'] == 'fail'

    def test_element_id_echoed(self):
        checker = MockCodeChecker()
        result = gb50010.check_element(checker, 'E5', {})
        assert result['elementId'] == 'E5'


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
