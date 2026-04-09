"""
地震力分配模块 / Seismic Force Distribution Module

实现多种地震力分配策略，包括按刚度比例、按距离、平均分配等
Implements multiple seismic force distribution strategies
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple
from enum import Enum
import logging

from .constants import DEFAULT_STIFFNESS, DEFAULT_INERTIA

logger = logging.getLogger(__name__)


class ForceDistributeMethod(str, Enum):
    """地震力分配方法枚举"""
    BY_STIFFNESS = "by_stiffness"  # 按刚度比例分配
    BY_DISTANCE = "by_distance"  # 按距离刚度中心分配
    EVENLY = "evenly"  # 平均分配
    AUTO = "auto"  # 自动选择


class ForceDistributor:
    """地震力分配器 / Seismic Force Distributor"""

    def __init__(
        self,
        model: Any,
        distribute_method: ForceDistributeMethod = ForceDistributeMethod.AUTO
    ):
        """
        初始化地震力分配器

        Args:
            model: 结构模型
            distribute_method: 分配方法
        """
        self.model = model
        self.distribute_method = distribute_method

    def distribute_force_to_floor(
        self,
        floor_elements: List[Any],
        total_force: float,
        direction: str,
        distribute_method: Optional[ForceDistributeMethod] = None
    ) -> Dict[str, Dict[str, Any]]:
        """
        将楼层地震力分配到构件

        Args:
            floor_elements: 楼层构件列表
            total_force: 楼层总地震力 (kN)
            direction: 地震方向 ('x', 'y', 'z', '-x', '-y', '-z')
            distribute_method: 分配方法

        Returns:
            构件力分配字典: {element_id: {"force": float, "direction": dict}}
        """
        if not floor_elements:
            logger.warning("楼层构件列表为空，无法分配地震力")
            return {}

        if total_force <= 0:
            logger.warning(f"楼层地震力为 {total_force}，无需分配")
            return {elem.id: {"force": 0.0, "direction": self._get_direction_vector(direction)}
                    for elem in floor_elements}

        # 确定分配方法
        method = distribute_method or self.distribute_method
        if method == ForceDistributeMethod.AUTO:
            method = self._auto_select_distribute_method(floor_elements, direction)

        logger.info(
            f"分配地震力: 总力={total_force:.2f}kN, "
            f"构件数={len(floor_elements)}, "
            f"方法={method.value}"
        )

        # 执行分配
        if method == ForceDistributeMethod.BY_STIFFNESS:
            return self._distribute_by_stiffness(floor_elements, total_force, direction)
        elif method == ForceDistributeMethod.BY_DISTANCE:
            return self._distribute_by_distance(floor_elements, total_force, direction)
        else:  # EVENLY
            return self._distribute_evenly(floor_elements, total_force, direction)

    def _auto_select_distribute_method(
        self,
        elements: List[Any],
        direction: str
    ) -> ForceDistributeMethod:
        """
        自动选择分配方法

        Args:
            elements: 构件列表
            direction: 地震方向

        Returns:
            推荐的分配方法
        """
        # 检查是否有刚度数据
        if self._has_stiffness_data(elements, direction):
            return ForceDistributeMethod.BY_STIFFNESS

        # 检查是否有几何数据
        if self._has_geometric_data(elements):
            return ForceDistributeMethod.BY_DISTANCE

        # 默认平均分配
        return ForceDistributeMethod.EVENLY

    def _has_stiffness_data(self, elements: List[Any], direction: str) -> bool:
        """检查是否有刚度数据"""
        for elem in elements:
            # 检查构件的 extra 或 metadata
            stiffness_key = f"stiffness_{direction}"
            if hasattr(elem, 'extra') and stiffness_key in elem.extra:
                return True
            if hasattr(elem, 'metadata') and stiffness_key in elem.metadata:
                return True

            # 检查截面属性
            if hasattr(elem, 'section'):
                section = self._get_section_by_id(elem.section)
                if section and hasattr(section, 'properties'):
                    if 'inertia_x' in section.properties or 'inertia_y' in section.properties:
                        return True

        return False

    def _has_geometric_data(self, elements: List[Any]) -> bool:
        """检查是否有几何数据"""
        for elem in elements:
            if len(elem.nodes) >= 2:
                return True
        return False

    def _distribute_by_stiffness(
        self,
        elements: List[Any],
        total_force: float,
        direction: str
    ) -> Dict[str, Dict[str, Any]]:
        """
        按刚度比例分配地震力

        根据构件的抗侧刚度分配地震力，适用于框架结构
        F_i = (k_i / Σk_j) × F_total

        Args:
            elements: 构件列表
            total_force: 总地震力
            direction: 地震方向

        Returns:
            构件力分配字典
        """
        element_forces = {}
        total_stiffness = 0.0

        # 计算总刚度
        element_stiffness = {}
        for elem in elements:
            stiffness = self._get_element_stiffness(elem, direction)
            element_stiffness[elem.id] = stiffness
            total_stiffness += stiffness

        if total_stiffness <= 0:
            logger.warning("总刚度为 0，回退到平均分配")
            return self._distribute_evenly(elements, total_force, direction)

        # 按刚度比例分配
        direction_vector = self._get_direction_vector(direction)
        for elem in elements:
            stiffness = element_stiffness[elem.id]
            element_force = (stiffness / total_stiffness) * total_force

            element_forces[elem.id] = {
                "force": element_force,
                "direction": direction_vector,
                "stiffness": stiffness,
                "stiffness_ratio": stiffness / total_stiffness
            }

        return element_forces

    def _distribute_by_distance(
        self,
        elements: List[Any],
        total_force: float,
        direction: str
    ) -> Dict[str, Dict[str, Any]]:
        """
        按距离刚度中心的距离分配地震力

        适用于框架结构，考虑扭转效应
        F_i = (k_i × d_i / Σ(k_j × d_j)) × F_total

        Args:
            elements: 构件列表
            total_force: 总地震力
            direction: 地震方向

        Returns:
            构件力分配字典
        """
        # 计算刚度中心
        stiffness_center = self._calculate_stiffness_center(elements)

        # 计算总刚度矩
        total_stiffness_moment = 0.0
        element_data = {}

        for elem in elements:
            element_center = self._get_element_center(elem)
            distance = self._calculate_distance(element_center, stiffness_center, direction)
            stiffness = self._get_element_stiffness(elem, direction)

            stiffness_moment = stiffness * distance
            total_stiffness_moment += stiffness_moment

            element_data[elem.id] = {
                "center": element_center,
                "distance": distance,
                "stiffness": stiffness,
                "stiffness_moment": stiffness_moment
            }

        if total_stiffness_moment <= 0:
            logger.warning("总刚度矩为 0，回退到平均分配")
            return self._distribute_evenly(elements, total_force, direction)

        # 分配地震力
        direction_vector = self._get_direction_vector(direction)
        element_forces = {}

        for elem_id, data in element_data.items():
            element_force = (data['stiffness_moment'] / total_stiffness_moment) * total_force

            element_forces[elem_id] = {
                "force": element_force,
                "direction": direction_vector,
                "distance": data['distance'],
                "stiffness": data['stiffness']
            }

        return element_forces

    def _distribute_evenly(
        self,
        elements: List[Any],
        total_force: float,
        direction: str
    ) -> Dict[str, Dict[str, Any]]:
        """
        平均分配地震力（简化方法）

        F_i = F_total / n

        Args:
            elements: 构件列表
            total_force: 总地震力
            direction: 地震方向

        Returns:
            构件力分配字典
        """
        element_forces = {}
        element_count = len(elements)

        if element_count > 0:
            element_force = total_force / element_count
        else:
            element_force = 0.0

        direction_vector = self._get_direction_vector(direction)

        for elem in elements:
            element_forces[elem.id] = {
                "force": element_force,
                "direction": direction_vector,
                "distribution_ratio": 1.0 / element_count if element_count > 0 else 0.0
            }

        return element_forces

    def _get_element_stiffness(self, element: Any, direction: str) -> float:
        """
        获取构件抗侧刚度

        Args:
            element: 构件
            direction: 地震方向

        Returns:
            刚度 (kN/m)
        """
        # 优先使用构件 extra 字段中的刚度
        stiffness_key = f"stiffness_{direction}"
        if hasattr(element, 'extra') and stiffness_key in element.extra:
            return float(element.extra[stiffness_key])

        if hasattr(element, 'metadata') and stiffness_key in element.metadata:
            return float(element.metadata[stiffness_key])

        # 基于截面和材料估算刚度
        try:
            section = self._get_section_by_id(element.section)
            material = self._get_material_by_id(element.material)

            if section and material:
                return self._estimate_stiffness(element, section, material, direction)

        except Exception as e:
            logger.warning(f"估算刚度失败: {e}")

        # 默认刚度
        return DEFAULT_STIFFNESS

    def _estimate_stiffness(
        self,
        element: Any,
        section: Any,
        material: Any,
        direction: str
    ) -> float:
        """
        估算构件抗侧刚度

        对于柱:
        - 两端固定: k = 12EI/L³
        - 一端固定一端铰接: k = 3EI/L³
        对于梁: k = 6EI/L²

        Args:
            element: 构件
            section: 截面
            material: 材料
            direction: 地震方向

        Returns:
            刚度 (kN/m)
        """
        # 计算构件长度 (m)
        length = self._calculate_element_length(element)
        if length <= 0:
            return DEFAULT_STIFFNESS

        # 获取截面惯性矩 (m⁴)
        inertia = self._get_section_inertia(section, direction)

        # 弹性模量 (MPa -> kN/m²)
        from .constants import MPA_TO_KN_M2
        E = material.E * MPA_TO_KN_M2

        # 估算刚度
        if element.type == "column":
            # 根据端部约束条件确定柱的刚度系数
            stiffness_coefficient = self._get_column_stiffness_coefficient(element, direction)
            stiffness = stiffness_coefficient * E * inertia / (length ** 3)
        elif element.type == "beam":
            # 梁: k = 6EI/L²
            stiffness = 6.0 * E * inertia / (length ** 2)
        else:
            # 默认值
            stiffness = DEFAULT_STIFFNESS

        return max(stiffness, 1.0)

    def _get_column_stiffness_coefficient(self, element: Any, direction: str) -> float:
        """
        根据柱端部约束条件确定刚度系数

        Args:
            element: 柱构件
            direction: 地震方向

        Returns:
            刚度系数: 12.0 (两端固定), 3.0 (一端固定一端铰接), 6.0 (默认)
        """
        # 获取构件两端节点
        try:
            # V2 Schema: ElementV2 使用 nodes: List[str] 属性
            if not hasattr(element, 'nodes') or len(element.nodes) < 2:
                logger.warning(f"构件 {element.id} 缺少节点信息，使用默认值")
                return 12.0

            # 从模型中获取节点对象
            node_i_id = element.nodes[0]
            node_j_id = element.nodes[1]

            # 通过模型的 nodes 字典获取节点对象
            node_i = self.model.nodes.get(node_i_id)
            node_j = self.model.nodes.get(node_j_id)

            if not node_i or not node_j:
                logger.warning(
                    f"构件 {element.id} 的节点 {node_i_id} 或 {node_j_id} 不存在，使用默认值"
                )
                return 12.0

            # 检查两端节点的转动约束
            # V2 Schema: restraints = [ux, uy, uz, rx, ry, rz]
            # rx, ry, rz 对应索引 3, 4, 5
            i_fixed = self._is_node_rotation_fixed(node_i, direction)
            j_fixed = self._is_node_rotation_fixed(node_j, direction)

            if i_fixed and j_fixed:
                # 两端固定: k = 12EI/L³
                return 12.0
            elif i_fixed != j_fixed:
                # 一端固定一端铰接: k = 3EI/L³
                return 3.0
            else:
                # 两端铰接: 这种情况下柱不能抵抗侧向力，使用较小值
                logger.warning(
                    f"柱 {element.id} 两端均为铰接，抗侧刚度极低，可能导致不稳定"
                )
                return 1.0

        except Exception as e:
            logger.warning(f"无法确定柱 {element.id} 的端部约束: {e}，使用默认值")
            # 无法确定约束条件，使用保守估计（介于固定和铰接之间）
            return 6.0

    def _is_node_rotation_fixed(self, node: Any, direction: str) -> bool:
        """
        检查节点在指定方向的转动是否被约束

        Args:
            node: 节点对象
            direction: 地震方向 ('x', 'y')

        Returns:
            True if rotation is fixed, False otherwise
        """
        try:
            # V2 Schema: restraints = [ux, uy, uz, rx, ry, rz]
            if hasattr(node, 'restraints') and node.restraints:
                restraints = node.restraints
                if len(restraints) >= 6:
                    if direction in ['x', '-x']:
                        # X方向地震，检查绕Y轴转动 (ry, 索引4)
                        return restraints[4]
                    elif direction in ['y', '-y']:
                        # Y方向地震，检查绕X轴转动 (rx, 索引3)
                        return restraints[3]

            # 检查节点是否有约束类型信息
            if hasattr(node, 'extra') and node.extra:
                constraint_type = node.extra.get('constraintType', '')
                if constraint_type == 'fixed':
                    return True
                elif constraint_type == 'pinned':
                    return False

            # 默认假设固定
            return True

        except Exception as e:
            logger.warning(f"检查节点转动约束时出错: {e}，默认为固定")
            return True

    def _get_section_inertia(self, section: Any, direction: str) -> float:
        """
        获取截面惯性矩 (m⁴)

        Args:
            section: 截面
            direction: 方向

        Returns:
            惯性矩 (m⁴)
        """
        # 优先使用 properties
        from .constants import MM4_TO_M4
        if hasattr(section, 'properties'):
            if direction in ['x', '-x'] and 'inertia_x' in section.properties:
                return float(section.properties['inertia_x']) * MM4_TO_M4
            if direction in ['y', '-y'] and 'inertia_y' in section.properties:
                return float(section.properties['inertia_y']) * MM4_TO_M4

        # 估算惯性矩
        from .constants import MM_TO_M
        section_type = section.type.lower()

        if section_type == "rectangular" and section.width and section.height:
            # 矩形截面: I_x = bh³/12, I_y = hb³/12
            b = section.width * MM_TO_M  # mm -> m
            h = section.height * MM_TO_M  # mm -> m

            if direction in ['x', '-x']:
                return b * (h ** 3) / 12.0
            else:
                return h * (b ** 3) / 12.0

        # 默认值
        return DEFAULT_INERTIA

    def _calculate_stiffness_center(self, elements: List[Any]) -> Tuple[float, float, float]:
        """
        计算刚度中心

        Args:
            elements: 构件列表

        Returns:
            刚度中心坐标 (x, y, z)
        """
        total_stiffness_x = 0.0
        total_stiffness_y = 0.0
        weighted_x = 0.0
        weighted_y = 0.0
        z = 0.0

        for elem in elements:
            center = self._get_element_center(elem)
            stiffness_x = self._get_element_stiffness(elem, 'x')
            stiffness_y = self._get_element_stiffness(elem, 'y')

            total_stiffness_x += stiffness_x
            total_stiffness_y += stiffness_y

            weighted_x += center[0] * stiffness_x
            weighted_y += center[1] * stiffness_y

            z = center[2]

        if total_stiffness_x > 0:
            center_x = weighted_x / total_stiffness_x
        else:
            center_x = sum(self._get_element_center(e)[0] for e in elements) / len(elements)

        if total_stiffness_y > 0:
            center_y = weighted_y / total_stiffness_y
        else:
            center_y = sum(self._get_element_center(e)[1] for e in elements) / len(elements)

        return (center_x, center_y, z)

    def _get_element_center(self, element: Any) -> Tuple[float, float, float]:
        """获取构件中心坐标"""
        if len(element.nodes) >= 2:
            node_dict = {n.id: n for n in self.model.nodes}

            start_node = node_dict.get(element.nodes[0])
            end_node = node_dict.get(element.nodes[1])

            if start_node and end_node:
                x = (start_node.x + end_node.x) / 2.0
                y = (start_node.y + end_node.y) / 2.0
                z = (start_node.z + end_node.z) / 2.0
                return (x, y, z)

        return (0.0, 0.0, 0.0)

    def _calculate_distance(
        self,
        point1: Tuple[float, float, float],
        point2: Tuple[float, float, float],
        direction: str
    ) -> float:
        """
        计算两点在指定方向垂直方向的距离（力臂）

        对于考虑扭转效应的地震力分配，力臂应垂直于力的方向：
        - X方向力：使用Y方向距离作为力臂
        - Y方向力：使用X方向距离作为力臂
        - Z方向力：在平面内考虑X和Y方向的力臂

        Args:
            point1: 点1
            point2: 点2
            direction: 力的方向

        Returns:
            垂直距离（力臂）
        """
        dx = point1[0] - point2[0]
        dy = point1[1] - point2[1]
        dz = point1[2] - point2[2]

        if direction in ['x', '-x']:
            # X方向力：使用Y方向距离作为力臂
            return abs(dy)
        elif direction in ['y', '-y']:
            # Y方向力：使用X方向距离作为力臂
            return abs(dx)
        else:
            # Z方向力：在平面内考虑X和Y的合成力臂
            return (dx**2 + dy**2)**0.5

    def _calculate_element_length(self, element: Any) -> float:
        """计算构件长度 (m)"""
        if len(element.nodes) < 2:
            return 0.0

        node_dict = {n.id: n for n in self.model.nodes}

        start_node = node_dict.get(element.nodes[0])
        end_node = node_dict.get(element.nodes[1])

        if not start_node or not end_node:
            return 0.0

        dx = end_node.x - start_node.x
        dy = end_node.y - start_node.y
        dz = end_node.z - start_node.z

        return (dx**2 + dy**2 + dz**2) ** 0.5

    def _get_section_by_id(self, section_id: str) -> Optional[Any]:
        """根据ID获取截面"""
        if hasattr(self.model, 'sections'):
            for section in self.model.sections:
                if section.id == section_id:
                    return section
        return None

    def _get_material_by_id(self, material_id: str) -> Optional[Any]:
        """根据ID获取材料"""
        if hasattr(self.model, 'materials'):
            for material in self.model.materials:
                if material.id == material_id:
                    return material
        return None

    def _get_direction_vector(self, direction: str) -> Dict[str, float]:
        """获取方向向量"""
        direction_map = {
            'x': {"x": 1.0, "y": 0.0, "z": 0.0},
            '-x': {"x": -1.0, "y": 0.0, "z": 0.0},
            'y': {"x": 0.0, "y": 1.0, "z": 0.0},
            '-y': {"x": 0.0, "y": -1.0, "z": 0.0},
            'z': {"x": 0.0, "y": 0.0, "z": 1.0},
            '-z': {"x": 0.0, "y": 0.0, "z": -1.0},
        }
        return direction_map.get(direction, {"x": 0.0, "y": 0.0, "z": 0.0})
