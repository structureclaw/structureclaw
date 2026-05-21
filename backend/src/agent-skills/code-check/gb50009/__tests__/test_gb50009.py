"""Unit tests for GB50009 (风荷载) code-check stub."""
from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

_MODULE_PATH = str(Path(__file__).resolve().parent.parent / "code_check.py")
_spec = importlib.util.spec_from_file_location("gb50009_code_check", _MODULE_PATH)
gb50009 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gb50009)


class TestGetRules:

    def test_returns_dict(self):
        rules = gb50009.get_rules()
        assert isinstance(rules, dict)

    def test_code_field(self):
        assert gb50009.get_rules()['code'] == 'GB50009'

    def test_version_field(self):
        assert gb50009.get_rules()['version'] == 'v1-minimal'

    def test_rules_empty(self):
        assert gb50009.get_rules()['rules'] == []


class TestCheckElement:

    def test_returns_not_implemented(self):
        result = gb50009.check_element(None, 'B1', {})
        assert result['status'] == 'not_implemented'

    def test_returns_element_id(self):
        result = gb50009.check_element(None, 'B1', {})
        assert result['elementId'] == 'B1'

    def test_has_message(self):
        result = gb50009.check_element(None, 'B1', {})
        assert 'message' in result


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
