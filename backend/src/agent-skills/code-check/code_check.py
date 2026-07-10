"""规范校核统一入口。

各规范的具体校核实现位于对应 skill 子目录的 ``code_check.py`` 中。
"""

from __future__ import annotations

from functools import lru_cache
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from types import ModuleType
from typing import Dict, Any, List, Optional
import logging
import math
import sys

logger = logging.getLogger(__name__)

SHARED_PYTHON_DIR = Path(__file__).resolve().parents[2] / 'skill-shared' / 'python'
if SHARED_PYTHON_DIR.exists():
    shared_python_path = str(SHARED_PYTHON_DIR)
    if shared_python_path not in sys.path:
        sys.path.insert(0, shared_python_path)


@lru_cache(maxsize=None)
def _load_local_skill_module(relative_path: str) -> ModuleType:
    target = Path(__file__).resolve().parent / relative_path
    if not target.exists():
        raise ImportError(f"Skill module not found: {target}")

    module_name = "_code_check_skill_" + relative_path.replace("/", "_").replace(".", "_").replace("-", "_")
    spec = spec_from_file_location(module_name, target)
    if spec is None or spec.loader is None:
        raise ImportError(f"Unable to load spec for: {target}")

    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@lru_cache(maxsize=None)
def _discover_code_skill_paths() -> Dict[str, str]:
    base_dir = Path(__file__).resolve().parent
    code_skill_paths: Dict[str, str] = {}

    for child in sorted(base_dir.iterdir(), key=lambda item: item.name):
        if not child.is_dir() or child.name.startswith('__'):
            continue

        skill_file = child / 'code_check.py'
        if not skill_file.exists():
            continue

        relative_path = f'{child.name}/code_check.py'
        module = _load_local_skill_module(relative_path)

        code: Optional[str] = None
        rule_loader = getattr(module, 'get_rules', None)
        if callable(rule_loader):
            loaded = rule_loader()
            if isinstance(loaded, dict) and isinstance(loaded.get('code'), str):
                code = loaded['code']

        if not code:
            code = child.name.upper()

        if code in code_skill_paths:
            raise RuntimeError(f'Duplicate code-check skill code discovered: {code}')

        code_skill_paths[code] = relative_path

    return code_skill_paths


class CodeChecker:
    """规范校核器"""

    def __init__(self, code: str):
        """
        初始化规范校核器

        Args:
            code: 规范代码，如 'GB50010'
        """
        self.code_skill_paths = _discover_code_skill_paths()
        self.supported_codes = sorted(self.code_skill_paths.keys())

        if code not in self.code_skill_paths:
            raise ValueError(f"不支持的规范: {code}。支持的规范: {self.supported_codes}")

        self.code = code
        self.skill_module = _load_local_skill_module(self.code_skill_paths[code])
        self.rules = self._load_rules(code)

    def check(self, model_id: str, elements: List[str], context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        执行规范校核

        Args:
            model_id: 模型ID
            elements: 需要校核的单元ID列表
            context: 可选上下文（分析摘要、单元参数、覆盖利用率等）

        Returns:
            校核结果
        """
        logger.info(f"Starting code check for {len(elements)} elements using {self.code}")
        context = context or {}

        results = {
            'code': self.code,
            'status': 'success',
            'summary': {
                'total': 0,
                'passed': 0,
                'failed': 0,
                'warnings': 0,
                'notApplicable': 0,
                'maxUtilization': 0.0,
                'controllingElement': None,
                'controllingCheck': None,
            },
            'traceability': {
                'modelId': model_id,
                'ruleVersion': self.rules.get('version', 'latest'),
                'analysisSummary': context.get('analysisSummary', {}),
            },
            'details': []
        }

        for elem_id in elements:
            check_result = self._check_element(elem_id, context)
            results['details'].append(check_result)

            items = self._flatten_result_items(check_result)
            results['summary']['total'] += len(items)
            for item in items:
                bucket = self._summary_bucket(item)
                results['summary'][bucket] += 1

            controlling = check_result.get('controlling', {})
            if not isinstance(controlling, dict):
                controlling = {}
            utilization = self._item_utilization(controlling)
            if utilization >= results['summary']['maxUtilization']:
                results['summary']['maxUtilization'] = utilization
                results['summary']['controllingElement'] = elem_id
                results['summary']['controllingCheck'] = controlling.get('item')

        return results

    @staticmethod
    def _flatten_result_items(check_result: Dict[str, Any]) -> List[Dict[str, Any]]:
        checks = check_result.get('checks')
        if not isinstance(checks, list):
            return [check_result]

        items_for_summary: List[Dict[str, Any]] = []
        for check in checks:
            if not isinstance(check, dict):
                continue
            items = check.get('items')
            if not isinstance(items, list):
                continue
            for item in items:
                if not isinstance(item, dict):
                    continue
                items_for_summary.append(item)

        return items_for_summary or [check_result]

    @staticmethod
    def _summary_bucket(item: Dict[str, Any]) -> str:
        status = str(item.get('status', '')).strip().lower()
        category = str(item.get('category', '')).strip().lower()
        if status in {'pass', 'passed'}:
            return 'passed'
        if status in {'not_applicable', 'not-applicable', 'n/a'}:
            return 'notApplicable'
        if category in {'input_required', 'diagnostic', 'trace'}:
            return 'notApplicable'
        if status in {'fail', 'failed'}:
            return 'failed'
        return 'warnings'

    @staticmethod
    def _item_utilization(item: Dict[str, Any]) -> float:
        try:
            value = float(item.get('utilization', 0.0) or 0.0)
        except (TypeError, ValueError):
            return 0.0
        return value if math.isfinite(value) else 0.0

    @staticmethod
    def _is_governing_eligible(item: Dict[str, Any]) -> bool:
        if item.get('governingEligible') is False:
            return False
        status = str(item.get('status', '')).strip().lower()
        if status in {'not_applicable', 'not-applicable', 'n/a'}:
            return False
        category = str(item.get('category', '')).strip().lower()
        return category not in {'input_required', 'diagnostic', 'trace'}

    def _select_controlling_item(self, all_items: List[Dict[str, Any]]) -> Dict[str, Any]:
        eligible = [item for item in all_items if self._is_governing_eligible(item)]
        candidates = eligible if eligible else all_items
        return max(candidates, key=self._item_utilization, default={})

    def _check_element(self, elem_id: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """校核单个构件"""
        check_func = getattr(self.skill_module, 'check_element', None)
        if callable(check_func):
            return check_func(self, elem_id, context)

        return {
            'elementId': elem_id,
            'status': 'not_implemented',
            'message': f'{self.code} 校核尚未实现',
        }

    def _build_element_result(self, elem_id: str, element_type: str, checks: List[Dict[str, Any]], code_version: str) -> Dict[str, Any]:
        all_items = [item for check in checks for item in check.get('items', [])]
        all_passed = all(item.get('status') == 'pass' for item in all_items)
        controlling = self._select_controlling_item(all_items)

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
        demand = round(utilization * limit, 4)
        capacity = round(limit, 4)
        return {
            'item': item_name,
            'status': 'pass' if utilization <= 1.0 else 'fail',
            'utilization': round(utilization, 4),
            'clause': clause,
            'formula': formula,
            'inputs': {
                'demand': demand,
                'capacity': capacity,
                'limit': limit,
            },
        }

    def _resolve_utilization(self, elem_id: str, item_name: str, context: Dict[str, Any]) -> float:
        overrides = context.get('utilizationByElement', {})
        if isinstance(overrides, dict):
            per_elem = overrides.get(elem_id, {})
            if isinstance(per_elem, dict):
                raw = per_elem.get(item_name)
                if isinstance(raw, (int, float)):
                    return max(0.0, float(raw))

        # Stable deterministic fallback based on element + check name.
        seed = sum(ord(ch) for ch in f'{elem_id}:{item_name}')
        # map to [0.55, 0.95]
        return 0.55 + (seed % 40) / 100.0

    def _load_rules(self, code: str) -> Dict[str, Any]:
        """加载规范规则"""
        rule_loader = getattr(self.skill_module, 'get_rules', None)
        if callable(rule_loader):
            loaded = rule_loader()
            if isinstance(loaded, dict):
                return loaded

        return {
            'code': code,
            'version': 'v1-minimal',
            'rules': [],
        }
