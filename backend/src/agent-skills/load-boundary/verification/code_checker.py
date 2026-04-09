"""
规范校验模块
Code Checker Module
实现荷载值、系数、边界条件校验功能
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from core.load_case import LoadCase
from core.nodal_constraint import NodalConstraint
from core.member_end_release import MemberEndRelease
import logging

logger = logging.getLogger(__name__)


class CodeChecker:
    """规范校验器 / Code Checker"""

    # 荷载标准值参考
    LOAD_STANDARDS = {
        "GB50009-2012": {
            "floor_live_residential": 2.0,  # 住宅楼面活载 (kN/m²)
            "floor_live_office": 2.0,  # 办公楼面活载 (kN/m²)
            "floor_live_school": 2.5,  # 教学楼面活载 (kN/m²)
            "floor_live_corridor": 3.5,  # 走廊楼面活载 (kN/m²)
            "roof_live": 0.5,  # 屋面活载 (不上人) (kN/m²)
            "wind_pressure_min": 0.3,  # 基本风压最小值 (kN/m²)
        }
    }

    def __init__(self):
        """
        初始化规范校验器
        """
        self.errors = []
        self.warnings = []

    def check_load_case(self, load_case: LoadCase) -> Dict[str, Any]:
        """
        校验荷载工况

        Args:
            load_case: 荷载工况

        Returns:
            校验结果字典
        """
        result = {
            "valid": True,
            "errors": [],
            "warnings": []
        }

        # 校验工况ID
        if not load_case.case_id or not load_case.case_id.strip():
            result["valid"] = False
            result["errors"].append("工况ID不能为空")
            logger.warning(f"Load case ID is empty")
            return result

        # 校验工况类型
        valid_types = ["dead", "live", "wind", "seismic", "temperature", "settlement", "crane", "snow", "other"]
        if load_case.case_type not in valid_types:
            result["valid"] = False
            result["errors"].append(f"工况类型 '{load_case.case_type}' 不在有效列表中")
            logger.warning(f"Invalid load case type: {load_case.case_type}")

        # 校验工况描述
        if not load_case.description:
            result["warnings"].append("建议添加工况描述以提高可读性")

        return result

    def check_load_values(
        self,
        load_actions: List[Dict[str, Any]],
        case_type: str
    ) -> Dict[str, Any]:
        """
        校验荷载值

        Args:
            load_actions: 荷载动作列表（对齐 V2 Schema）
            case_type: 工况类型

        Returns:
            校验结果字典
        """
        result = {
            "valid": True,
            "errors": [],
            "warnings": []
        }

        for action in load_actions:
            # 校验荷载值 - 使用 V2 Schema 驼峰命名 (loadValue)
            if "loadValue" in action:
                load_value = action["loadValue"]
                if load_value <= 0:
                    result["valid"] = False
                    result["errors"].append(f"荷载值必须大于0，当前值：{load_value}")
                    logger.warning(f"Invalid load value: {load_value}")

                # 校验恒载最大值
                if case_type == "dead":
                    if load_value > 100:  # kN/m²
                        result["warnings"].append(f"恒载值 {load_value} kN/m² 超出典型范围，建议复核")

                # 校验活载最小值
                if case_type == "live":
                    if load_value < 0.5:  # kN/m²
                        result["valid"] = False
                        result["errors"].append(f"活载值 {load_value} kN/m² 小于规范最小值 0.5")
                        logger.warning(f"Live load too small: {load_value}")

        return result

    def check_load_factors(
        self,
        combinations: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        校验荷载组合系数

        Args:
            combinations: 荷载组合列表

        Returns:
            校验结果字典
        """
        result = {
            "valid": True,
            "errors": [],
            "warnings": []
        }

        for combo in combinations:
            factors = combo.get("factors", {})
            total_factor = sum(factors.values())

            # 校验总系数
            if total_factor <= 0:
                result["valid"] = False
                result["errors"].append(f"荷载组合总系数必须大于0，当前值：{total_factor}")
                logger.warning(f"Invalid total factor: {total_factor}")

            # 校验系数合理性（总系数不超过5.0）
            if total_factor > 5.0:
                result["warnings"].append(f"荷载组合总系数 {total_factor} 超出建议值 5.0，请确认")

        return result

    def check_boundary_conditions(
        self,
        constraints: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        校验边界条件

        Args:
            constraints: 节点约束列表（对齐 V2 Schema）
                         支持 NodalConstraint.to_dict() 输出格式：
                         - nodeId (顶层字段)
                         - constraintType (在 extra 中)
                         - restraints (顶层字段，V2 Schema)

        Returns:
            校验结果字典
        """
        result = {
            "valid": True,
            "errors": [],
            "warnings": []
        }

        # 校验每个节点至少有一个约束 - 使用 V2 Schema 驼峰命名
        node_constraints = {}
        for constraint in constraints:
            # 获取节点ID - 支持驼峰命名
            node_id = constraint.get("nodeId") or constraint.get("node_id")
            if not node_id:
                continue

            if node_id not in node_constraints:
                node_constraints[node_id] = []

            # 获取约束类型 - 可能直接在顶层或在 extra 中
            constraint_type = (
                constraint.get("constraintType") or
                (constraint.get("extra", {}).get("constraintType") if constraint.get("extra") else None)
            )

            # 如果有约束类型，记录；否则检查是否有 restraints
            if constraint_type:
                node_constraints[node_id].append(constraint_type)
            elif constraint.get("restraints"):
                # V2 Schema 使用 restraints 数组，有约束即表示有边界条件
                node_constraints[node_id].append("restraints")

        # 检查未定义约束的节点
        for node_id, types in node_constraints.items():
            if len(types) == 0:
                result["warnings"].append(f"节点 '{node_id}' 未定义任何边界条件，可能是自由节点")
                logger.warning(f"Node '{node_id}' has no constraints")

        # 校验是否存在过约束节点（多个约束同时作用于一个节点）
        over_constrained = []
        for node_id, types in node_constraints.items():
            if len(types) > 1:
                over_constrained.append(node_id)
                result["warnings"].append(f"节点 '{node_id}' 定义了 {len(types)} 个约束，可能导致分析冲突")

        if over_constrained:
            logger.warning(f"Over-constrained nodes: {over_constrained}")

        return result

    def generate_report(self) -> Dict[str, Any]:
        """
        生成校验报告

        Returns:
            校验报告字典
        """
        return {
            "total_errors": len(self.errors),
            "total_warnings": len(self.warnings),
            "errors": self.errors,
            "warnings": self.warnings
        }
