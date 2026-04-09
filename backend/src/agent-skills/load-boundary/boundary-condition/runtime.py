from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict, List, Optional
from datetime import datetime

from structure_protocol.structure_model_v2 import StructureModelV2
import logging
import math

# 添加当前目录路径用于同级导入
current_path = Path(__file__).parent
if str(current_path) not in sys.path:
    sys.path.insert(0, str(current_path))

from constants import (
    ConstraintType,
    RollingDirection,
    get_length_factor,
    get_restraints_by_constraint_type,
    get_constraint_description,
    DEFAULT_STIFFNESS_MATRIX,
    FULL_RESTRAINTS,
    TRANSLATIONAL_RESTRAINTS,
    FREE_RESTRAINTS
)

logger = logging.getLogger(__name__)


class BoundaryConditionGenerator:
    """边界条件生成器 / Boundary Condition Generator"""

    def __init__(self, model: StructureModelV2):
        """
        初始化边界条件生成器

        Args:
            model: V2 结构模型
        """
        self.model = model
        self.nodal_constraints = {}
        self.member_end_releases = {}
        self.effective_lengths = {}

    def apply_fixed_support(
        self,
        node_ids: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        施加固定支座 (约束所有6个自由度)

        Args:
            node_ids: 节点ID列表，如果为None则默认基础节点

        Returns:
            节点约束字典
        """
        if node_ids is None:
            # 自动识别基础节点 (z坐标最小的节点)
            min_z = min(node.z for node in self.model.nodes)
            node_ids = [node.id for node in self.model.nodes if abs(node.z - min_z) < 0.001]

        logger.info(f"Applying fixed supports to {len(node_ids)} nodes")

        for node_id in node_ids:
            self.nodal_constraints[node_id] = self._create_constraint(
                node_id=node_id,
                constraint_type=ConstraintType.FIXED
            )

        return {
            "constraints": self.nodal_constraints,
            "count": len(node_ids)
        }

    def apply_pinned_support(
        self,
        node_ids: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        施加铰支座 (约束3个平动自由度)

        Args:
            node_ids: 节点ID列表

        Returns:
            节点约束字典
        """
        if node_ids is None:
            min_z = min(node.z for node in self.model.nodes)
            node_ids = [node.id for node in self.model.nodes if abs(node.z - min_z) < 0.001]

        logger.info(f"Applying pinned supports to {len(node_ids)} nodes")

        for node_id in node_ids:
            self.nodal_constraints[node_id] = self._create_constraint(
                node_id=node_id,
                constraint_type=ConstraintType.PINNED
            )

        return {
            "constraints": self.nodal_constraints,
            "count": len(node_ids)
        }

    def apply_rolling_support(
        self,
        node_ids: List[str],
        rolling_direction: str = 'y'
    ) -> Dict[str, Any]:
        """
        施加滚动支座 (约束部分平动自由度)

        Args:
            node_ids: 节点ID列表
            rolling_direction: 滚动方向 ('x', 'y', 'z')

        Returns:
            节点约束字典
        """
        # 验证滚动方向
        if rolling_direction not in ['x', 'y', 'z']:
            raise ValueError(
                f"无效的滚动方向: {rolling_direction}. "
                f"有效值为: ['x', 'y', 'z']"
            )

        # 转换为枚举类型
        direction_enum = RollingDirection(rolling_direction)

        logger.info(f"Applying rolling supports to {len(node_ids)} nodes, direction={rolling_direction}")

        for node_id in node_ids:
            self.nodal_constraints[node_id] = self._create_constraint(
                node_id=node_id,
                constraint_type=ConstraintType.ROLLING,
                rolling_direction=direction_enum
            )

        return {
            "constraints": self.nodal_constraints,
            "count": len(node_ids)
        }

    def apply_elastic_support(
        self,
        node_ids: Optional[List[str]] = None,
        stiffness_matrix: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        施加弹性支座 (提供刚度约束)

        Args:
            node_ids: 节点ID列表，如果为None则默认基础节点
            stiffness_matrix: 6x6 刚度矩阵字典

        Returns:
            节点约束字典
        """
        if node_ids is None:
            min_z = min(node.z for node in self.model.nodes)
            node_ids = [node.id for node in self.model.nodes if abs(node.z - min_z) < 0.001]

        # 默认刚度矩阵 (对角矩阵)
        if stiffness_matrix is None:
            stiffness_matrix = DEFAULT_STIFFNESS_MATRIX.copy()

        logger.info(f"Applying elastic supports to {len(node_ids)} nodes")

        for node_id in node_ids:
            self.nodal_constraints[node_id] = self._create_constraint(
                node_id=node_id,
                constraint_type=ConstraintType.ELASTIC,
                stiffness_matrix=stiffness_matrix
            )

        return {
            "constraints": self.nodal_constraints,
            "count": len(node_ids)
        }

    def apply_hinged_member_ends(
        self,
        member_ids: List[str] = None
    ) -> Dict[str, Any]:
        """
        施加杆端铰接 (两端释放转动自由度)

        Args:
            member_ids: 杆件ID列表，如果为None则应用于所有杆件

        Returns:
            杆端释放字典
        """
        if member_ids is None:
            member_ids = [elem.id for elem in self.model.elements if elem.type in ["beam", "column"]]

        logger.info(f"Applying hinged ends to {len(member_ids)} members")

        for member_id in member_ids:
            self.member_end_releases[member_id] = {
                "memberId": member_id,
                "releaseI": {
                    "ux": False,
                    "uy": False,
                    "uz": False,
                    "rx": True,   # I端释放转动
                    "ry": True,
                    "rz": True
                },
                "releaseJ": {
                    "ux": False,
                    "uy": False,
                    "uz": False,
                    "rx": True,   # J端释放转动
                    "ry": True,
                    "rz": True
                }
            }

        return {
            "releases": self.member_end_releases,
            "count": len(member_ids)
        }

    def apply_pinned_one_end(
        self,
        member_id: str,
        pinned_end: str = 'i'
    ) -> Dict[str, Any]:
        """
        施加一端铰接

        Args:
            member_id: 杆件ID
            pinned_end: 铰接端 ('i' 或 'j')

        Returns:
            杆端释放字典
        """
        logger.info(f"Applying pinned end at {pinned_end} for member {member_id}")

        if pinned_end.lower() == 'i':
            release_i = {
                "ux": False,
                "uy": False,
                "uz": False,
                "rx": True,
                "ry": True,
                "rz": True
            }
            release_j = {
                "ux": False,
                "uy": False,
                "uz": False,
                "rx": False,
                "ry": False,
                "rz": False
            }
        else:
            release_i = {
                "ux": False,
                "uy": False,
                "uz": False,
                "rx": False,
                "ry": False,
                "rz": False
            }
            release_j = {
                "ux": False,
                "uy": False,
                "uz": False,
                "rx": True,
                "ry": True,
                "rz": True
            }

        self.member_end_releases[member_id] = {
            "memberId": member_id,
            "releaseI": release_i,
            "releaseJ": release_j
        }

        return {
            "releases": self.member_end_releases,
            "count": 1
        }

    def calculate_effective_lengths(
        self,
        member_ids: List[str] = None,
        default_length_factor: float = 1.0
    ) -> Dict[str, Any]:
        """
        计算杆件计算长度

        Args:
            member_ids: 杆件ID列表，如果为None则应用于所有杆件
            default_length_factor: 默认长度系数

        Returns:
            计算长度字典
        """
        if member_ids is None:
            member_ids = [elem.id for elem in self.model.elements if elem.type in ["beam", "column"]]

        logger.info(f"Calculating effective lengths for {len(member_ids)} members")

        for member_id in member_ids:
            # 计算几何长度
            calc_length = self._calculate_member_length(member_id)

            if calc_length is None:
                logger.warning(f"Cannot calculate length for member {member_id}")
                continue

            # 应用长度系数
            effective_length = calc_length * default_length_factor

            # 为两个轴向方向创建计算长度
            self.effective_lengths[f"{member_id}_x"] = {
                "memberId": member_id,
                "direction": "x",
                "calcLength": calc_length,
                "lengthFactor": default_length_factor,
                "effectiveLength": effective_length
            }

            self.effective_lengths[f"{member_id}_y"] = {
                "memberId": member_id,
                "direction": "y",
                "calcLength": calc_length,
                "lengthFactor": default_length_factor,
                "effectiveLength": effective_length
            }

        return {
            "effective_lengths": self.effective_lengths,
            "count": len(member_ids)
        }

    def apply_column_effective_lengths(
        self,
        member_ids: List[str] = None
    ) -> Dict[str, Any]:
        """
        应用柱的计算长度 (根据边界条件自动确定长度系数)

        Args:
            member_ids: 柱ID列表

        Returns:
            计算长度字典
        """
        if member_ids is None:
            member_ids = [elem.id for elem in self.model.elements if elem.type == "column"]

        logger.info(f"Applying column effective lengths for {len(member_ids)} columns")

        for member_id in member_ids:
            # 计算几何长度
            calc_length = self._calculate_member_length(member_id)

            if calc_length is None:
                continue

            # 判断边界条件，确定长度系数
            length_factor_i = self._determine_column_length_factor(member_id, 'i')
            length_factor_j = self._determine_column_length_factor(member_id, 'j')

            # 创建弱轴和强轴的计算长度
            self.effective_lengths[f"{member_id}_weak"] = {
                "memberId": member_id,
                "direction": "y",  # 弱轴Y方向
                "calcLength": calc_length,
                "lengthFactor": length_factor_i,
                "effectiveLength": calc_length * length_factor_i
            }

            self.effective_lengths[f"{member_id}_strong"] = {
                "memberId": member_id,
                "direction": "x",  # 强轴X方向
                "calcLength": calc_length,
                "lengthFactor": length_factor_j,
                "effectiveLength": calc_length * length_factor_j
            }

        return {
            "effective_lengths": self.effective_lengths,
            "count": len(member_ids)
        }

    def get_nodal_constraints(self) -> Dict[str, Any]:
        """获取所有节点约束"""
        return self.nodal_constraints

    def get_member_end_releases(self) -> Dict[str, Any]:
        """获取所有杆端释放"""
        return self.member_end_releases

    def get_effective_lengths(self) -> Dict[str, Any]:
        """获取所有计算长度"""
        return self.effective_lengths

    def _create_constraint(
        self,
        node_id: str,
        constraint_type: ConstraintType,
        rolling_direction: Optional[RollingDirection] = None,
        stiffness_matrix: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        创建节点约束 - 统一 V2 Schema 格式

        Args:
            node_id: 节点ID
            constraint_type: 约束类型
            rolling_direction: 滚动方向 (仅对滚动支座)
            stiffness_matrix: 刚度矩阵 (仅对弹性支座)

        Returns:
            约束字典 (V2 Schema 格式)

        Examples:
            >>> # 固定约束
            >>> constraint = generator._create_constraint(
            ...     "N1", ConstraintType.FIXED
            ... )
            >>> constraint["restraints"]
            [True, True, True, True, True, True]

            >>> # 铰接约束
            >>> constraint = generator._create_constraint(
            ...     "N2", ConstraintType.PINNED
            ... )
            >>> constraint["restraints"]
            [True, True, True, False, False, False]

            >>> # 滚动约束
            >>> constraint = generator._create_constraint(
            ...     "N3", ConstraintType.ROLLING,
            ...     rolling_direction=RollingDirection.X
            ... )
            >>> constraint["restraints"]
            [False, True, True, False, False, False]
        """
        # 获取约束数组 (V2 格式: [ux, uy, uz, rx, ry, rz])
        restraints = get_restraints_by_constraint_type(
            constraint_type, rolling_direction
        )

        # 创建基础约束字典
        constraint = {
            "nodeId": node_id,
            "restraints": restraints,  # V2 Schema 格式
            "extra": {
                "constraintType": constraint_type.value,
                "description": get_constraint_description(constraint_type),
                "timestamp": datetime.now().isoformat()  # 可选：添加时间戳
            }
        }

        # 添加滚动方向 (仅对滚动支座)
        if constraint_type == ConstraintType.ROLLING and rolling_direction:
            constraint["extra"]["rollingDirection"] = rolling_direction.value

        # 添加刚度矩阵 (仅对弹性支座)
        if constraint_type == ConstraintType.ELASTIC and stiffness_matrix:
            constraint["stiffness"] = stiffness_matrix

        return constraint

    def _calculate_member_length(self, member_id: str) -> float:
        """
        计算杆件几何长度

        Args:
            member_id: 杆件ID

        Returns:
            几何长度
        """
        elem = None
        for e in self.model.elements:
            if e.id == member_id:
                elem = e
                break

        if not elem or len(elem.nodes) < 2:
            return None

        # 获取两端节点坐标
        node_i = None
        node_j = None
        for node in self.model.nodes:
            if node.id == elem.nodes[0]:
                node_i = node
            elif node.id == elem.nodes[1]:
                node_j = node

        if not node_i or not node_j:
            return None

        # 计算距离
        
        dx = node_j.x - node_i.x
        dy = node_j.y - node_i.y
        dz = node_j.z - node_i.z
        length = math.sqrt(dx**2 + dy**2 + dz**2)

        return length

    def _determine_column_length_factor(self, member_id: str, end: str) -> float:
        """
        确定柱的计算长度系数

        Args:
            member_id: 杆件ID
            end: 端部 ('i' 或 'j')

        Returns:
            长度系数

        Examples:
            >>> # 固定端返回 0.5
            >>> generator._determine_column_length_factor("C1", "i")
            0.5
            >>> # 铰接端返回 0.7
            >>> generator._determine_column_length_factor("C1", "j")
            0.7
        """
        # 检查节点是否有约束
        elem = None
        for e in self.model.elements:
            if e.id == member_id:
                elem = e
                break

        if not elem:
            logger.warning(f"Element '{member_id}' not found, using default length factor 1.0")
            return 1.0

        node_id = elem.nodes[0] if end == 'i' else elem.nodes[1]

        # 检查节点约束
        constraint = self.nodal_constraints.get(node_id)

        if constraint:
            # 从约束中提取 constraintType (位于 extra 字段)
            constraint_type = constraint.get("extra", {}).get("constraintType")
            if constraint_type:
                try:
                    # 使用常量函数获取长度系数
                    return get_length_factor(constraint_type)
                except ValueError as e:
                    logger.warning(f"Invalid constraint type for node {node_id}: {e}, using default 1.0")
                    return 1.0
            else:
                logger.warning(f"Node {node_id} constraint missing 'constraintType', using default 1.0")
                return 1.0
        else:
            logger.debug(f"Node {node_id} has no constraint, using default length factor 1.0")
            return 1.0  # 无约束


def apply_boundary_conditions(model: StructureModelV2, parameters: Dict[str, Any]) -> Dict[str, Any]:
    """
    施加边界条件的主函数

    Args:
        model: V2 结构模型
        parameters: 参数字典
            - support_type: 支座类型 (fixed, pinned, roller)
            - node_ids: 节点ID列表 (可选)
            - member_ids: 杆件ID列表 (可选)
            - apply_hinged_ends: 是否施加杆端铰接 (默认 False)
            - calculate_effective_lengths: 是否计算计算长度 (默认 True)

    Returns:
        生成结果
    """
    generator = BoundaryConditionGenerator(model)

    # 参数解析
    support_type = parameters.get("support_type", "fixed")
    node_ids = parameters.get("node_ids")
    member_ids = parameters.get("member_ids")
    apply_hinged_ends = parameters.get("apply_hinged_ends", False)
    calculate_effective_lengths = parameters.get("calculate_effective_lengths", True)
    roller_direction = parameters.get("roller_direction", "y")

    # 施加节点约束
    if support_type == "fixed":
        generator.apply_fixed_support(node_ids)
    elif support_type == "pinned":
        generator.apply_pinned_support(node_ids)
    elif support_type == "roller":
        generator.apply_rolling_support(node_ids, roller_direction)

    # 施加杆端释放
    if apply_hinged_ends:
        generator.apply_hinged_member_ends(member_ids)

    # 计算计算长度
    if calculate_effective_lengths:
        elements_dict = {e.id: e for e in generator.model.elements}
        if member_ids and all(m in elements_dict and elements_dict[m].type == "column"
                           for m in member_ids):
            generator.apply_column_effective_lengths(member_ids)
        else:
            generator.calculate_effective_lengths(member_ids)

    return {
        "status": "success",
        "nodal_constraints": generator.get_nodal_constraints(),
        "member_end_releases": generator.get_member_end_releases(),
        "effective_lengths": generator.get_effective_lengths(),
        "summary": {
            "constraint_count": len(generator.get_nodal_constraints()),
            "release_count": len(generator.get_member_end_releases()),
            "effective_length_count": len(generator.get_effective_lengths()),
            "support_type": support_type
        }
    }
