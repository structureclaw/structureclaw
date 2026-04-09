"""
几何计算辅助类 / Geometry Calculation Helper

提供常用的几何计算函数，用于消除代码重复。
"""

import math
from typing import Optional, Dict, Any
import logging

logger = logging.getLogger(__name__)


class GeometryHelper:
    """
    几何计算辅助类 / Geometry Calculation Helper
    
    提供常用的几何计算函数，用于消除代码重复。
    """

    @staticmethod
    def calculate_distance_3d(
        x1: float, y1: float, z1: float,
        x2: float, y2: float, z2: float
    ) -> float:
        """
        计算两点之间的3D距离

        Args:
            x1, y1, z1: 第一个点的坐标
            x2, y2, z2: 第二个点的坐标

        Returns:
            两点之间的距离

        Examples:
            >>> distance = GeometryHelper.calculate_distance_3d(0, 0, 0, 1, 0, 0)
            >>> distance
            1.0
        """
        dx = x2 - x1
        dy = y2 - y1
        dz = z2 - z1
        return math.sqrt(dx**2 + dy**2 + dz**2)

    @staticmethod
    def calculate_element_length(element: Any, node_helper: Any) -> Optional[float]:
        """
        计算构件几何长度

        Args:
            element: 构件对象
            node_helper: 节点数据辅助类

        Returns:
            构件几何长度，如果无法计算则返回 None

        Examples:
            >>> length = GeometryHelper.calculate_element_length(element, node_helper)
            >>> if length:
            ...     print(f"Element length: {length:.2f} m")
        """
        if not hasattr(element, 'nodes') or len(element.nodes) < 2:
            logger.warning(f"Element '{getattr(element, 'id', 'unknown')}' has invalid nodes")
            return None

        # 获取两端节点
        node_i = node_helper.get_node(element.nodes[0])
        node_j = node_helper.get_node(element.nodes[1])

        if not node_i or not node_j:
            logger.warning(
                f"Cannot find nodes for element '{getattr(element, 'id', 'unknown')}': "
                f"{element.nodes[0]}, {element.nodes[1]}"
            )
            return None

        # 计算距离
        return GeometryHelper.calculate_distance_3d(
            node_i.x, node_i.y, node_i.z,
            node_j.x, node_j.y, node_j.z
        )

    @staticmethod
    def calculate_section_area(section: Any) -> Optional[float]:
        """
        计算截面面积

        Args:
            section: 截面对象

        Returns:
            截面面积 (mm²)，如果无法计算则返回 None

        Examples:
            >>> # 矩形截面
            >>> section = type('Section', (), {
            ...     'type': 'rectangular',
            ...     'width': 300,
            ...     'height': 500,
            ...     'properties': {}
            ... })()
            >>> area = GeometryHelper.calculate_section_area(section)
            >>> area
            150000

            >>> # 圆形截面
            >>> section = type('Section', (), {
            ...     'type': 'circular',
            ...     'diameter': 500,
            ...     'properties': {}
            ... })()
            >>> import math
            >>> area = GeometryHelper.calculate_section_area(section)
            >>> area == math.pi * 250 ** 2
            True
        """
        # 根据截面类型计算面积
        if hasattr(section, 'type'):
            section_type = section.type

            if section_type == "rectangular":
                if hasattr(section, 'width') and hasattr(section, 'height'):
                    return float(section.width * section.height)

            elif section_type == "circular":
                if hasattr(section, 'diameter'):
                    return float(math.pi * (section.diameter / 2) ** 2)

            elif section_type == "box":
                if all(hasattr(section, attr) for attr in ['width', 'height', 'thickness']):
                    # 箱形截面面积 = 2*(width + height)*thickness
                    return float(2 * (section.width + section.height) * section.thickness)

        # 尝试从 properties 字段获取
        if hasattr(section, 'properties') and isinstance(section.properties, dict):
            if "area" in section.properties:
                try:
                    return float(section.properties["area"])
                except (ValueError, TypeError):
                    pass

        logger.warning(f"Cannot calculate area for section '{getattr(section, 'id', 'unknown')}'")
        return None

    @staticmethod
    def calculate_tributary_width_from_geometry(
        element: Any,
        model: Any,
        model_helper: Any = None
    ) -> Optional[float]:
        """
        从结构模型的几何关系计算受荷宽度（梁的受荷宽度）

        受荷宽度应该根据梁的间距、楼板布置等几何关系计算。
        这需要分析相邻梁的位置关系。

        Args:
            element: 单元对象
            model: 结构模型
            model_helper: 模型数据辅助类（可选）

        Returns:
            受荷宽度（米），如果无法计算则返回 None

        Note:
            这是一个简化的几何计算，实际应用中可能需要更复杂的楼板分析。
        """
        try:
            # 检查是否为梁
            if not hasattr(element, 'type') or element.type != 'beam':
                return None

            # 获取梁的两端节点
            if not hasattr(element, 'nodes') or len(element.nodes) < 2:
                return None

            # 使用模型辅助类获取节点（如果提供）
            if model_helper:
                node_i = model_helper.get_node(element.nodes[0])
                node_j = model_helper.get_node(element.nodes[1])
            else:
                # 从模型直接获取
                node_i = None
                node_j = None
                if hasattr(model, 'nodes'):
                    for node in model.nodes:
                        if node.id == element.nodes[0]:
                            node_i = node
                        elif node.id == element.nodes[1]:
                            node_j = node

            if not node_i or not node_j:
                return None

            # 计算梁的方向向量
            dx = node_j.x - node_i.x
            dy = node_j.y - node_i.y
            dz = node_j.z - node_i.z

            # 判断梁的方向（X向或Y向）
            # 忽略Z方向的差异（只考虑平面内的梁）
            if abs(dx) > abs(dy):
                # 梁沿X方向，寻找Y方向相邻的梁
                beam_direction = 'x'
                avg_y = (node_i.y + node_j.y) / 2
            else:
                # 梁沿Y方向，寻找X方向相邻的梁
                beam_direction = 'y'
                avg_x = (node_i.x + node_j.x) / 2

            # 查找同一楼层的所有梁
            if not hasattr(model, 'elements'):
                return None

            story_id = getattr(element, 'story', None)
            parallel_beams = []

            for elem in model.elements:
                # 只考虑同一楼层的梁
                if elem.id == element.id:
                    continue
                if not hasattr(elem, 'type') or elem.type != 'beam':
                    continue
                if story_id and hasattr(elem, 'story') and elem.story != story_id:
                    continue

                # 获取梁的节点
                if model_helper:
                    n_i = model_helper.get_node(elem.nodes[0])
                    n_j = model_helper.get_node(elem.nodes[1])
                else:
                    n_i = None
                    n_j = None
                    if hasattr(model, 'nodes'):
                        for node in model.nodes:
                            if node.id == elem.nodes[0]:
                                n_i = node
                            elif node.id == elem.nodes[1]:
                                n_j = node

                if not n_i or not n_j:
                    continue

                # 计算方向
                bdx = n_j.x - n_i.x
                bdy = n_j.y - n_i.y

                # 判断是否平行
                if beam_direction == 'x':
                    # 当前梁沿X方向，检查其他梁是否也沿X方向
                    if abs(bdx) > abs(bdy):
                        # 计算Y方向的距离（保留方向信息）
                        other_avg_y = (n_i.y + n_j.y) / 2
                        distance = other_avg_y - avg_y  # 有方向，正数在上方，负数在下方
                        parallel_beams.append((distance, elem))
                else:
                    # 当前梁沿Y方向，检查其他梁是否也沿Y方向
                    if abs(bdy) > abs(bdx):
                        # 计算X方向的距离（保留方向信息）
                        other_avg_x = (n_i.x + n_j.x) / 2
                        distance = other_avg_x - avg_x  # 有方向，正数在右方，负数在左方
                        parallel_beams.append((distance, elem))

            # 计算受荷宽度
            if len(parallel_beams) >= 2:
                # 分别找到正方向和负方向最近的平行梁
                positive_distances = [d for d, _ in parallel_beams if d > 0]
                negative_distances = [d for d, _ in parallel_beams if d < 0]

                left_distance = None
                right_distance = None

                if beam_direction == 'x':
                    # X方向：负方向是左侧，正方向是右侧
                    left_distance = min(abs(d) for d in negative_distances) if negative_distances else None
                    right_distance = min(positive_distances) if positive_distances else None
                else:
                    # Y方向：负方向是下方，正方向是上方
                    left_distance = min(abs(d) for d in negative_distances) if negative_distances else None
                    right_distance = min(positive_distances) if positive_distances else None

                # 根据找到的两侧梁计算受荷宽度
                if left_distance is not None and right_distance is not None:
                    # 两侧都有平行梁
                    tributary_width = (left_distance + right_distance) / 2
                    logger.debug(
                        f"Calculated tributary width for {element.id}: "
                        f"{tributary_width:.2f} m (left={left_distance:.2f}, right={right_distance:.2f})"
                    )
                    return tributary_width
                elif left_distance is not None:
                    # 只有单侧（左侧/下方）
                    tributary_width = left_distance / 2
                    logger.debug(
                        f"Calculated tributary width for {element.id}: "
                        f"{tributary_width:.2f} m (single side left)"
                    )
                    return tributary_width
                elif right_distance is not None:
                    # 只有单侧（右侧/上方）
                    tributary_width = right_distance / 2
                    logger.debug(
                        f"Calculated tributary width for {element.id}: "
                        f"{tributary_width:.2f} m (single side right)"
                    )
                    return tributary_width
                else:
                    # 所有梁在同一直线上，距离都为0
                    logger.warning(f"All parallel beams are on same line for {element.id}")
                    return 0.0
            elif len(parallel_beams) == 1:
                # 只有一侧的平行梁，受荷宽度 = 单侧距离的一半
                tributary_width = parallel_beams[0][0] / 2
                logger.debug(
                    f"Calculated tributary width for {element.id}: "
                    f"{tributary_width:.2f} m (single side)"
                )
                return tributary_width
            else:
                # 没有找到平行梁
                logger.debug(f"No parallel beams found for {element.id}")
                return None

        except Exception as e:
            logger.warning(f"Error calculating tributary width for {getattr(element, 'id', 'unknown')}: {e}")
            return None

    @staticmethod
    def calculate_element_direction_vector(element: Any, node_helper: Any) -> Optional[Dict[str, float]]:
        """
        计算构件轴向方向向量

        Args:
            element: 构件对象
            node_helper: 节点数据辅助类

        Returns:
            单位方向向量 {"x": dx, "y": dy, "z": dz}，如果无法计算则返回 None

        Examples:
            >>> direction = GeometryHelper.calculate_element_direction_vector(element, node_helper)
            >>> if direction:
            ...     print(f"Direction: ({direction['x']:.3f}, {direction['y']:.3f}, {direction['z']:.3f})")
        """
        if not hasattr(element, 'nodes') or len(element.nodes) < 2:
            logger.warning(f"Element '{getattr(element, 'id', 'unknown')}' has invalid nodes")
            return None

        # 获取两端节点
        node_i = node_helper.get_node(element.nodes[0])
        node_j = node_helper.get_node(element.nodes[1])

        if not node_i or not node_j:
            logger.warning(
                f"Cannot find nodes for element '{getattr(element, 'id', 'unknown')}': "
                f"{element.nodes[0]}, {element.nodes[1]}"
            )
            return None

        # 计算方向向量
        dx = node_j.x - node_i.x
        dy = node_j.y - node_i.y
        dz = node_j.z - node_i.z

        # 计算向量长度
        length = math.sqrt(dx**2 + dy**2 + dz**2)

        if length == 0:
            logger.warning(f"Element '{getattr(element, 'id', 'unknown')}' has zero length")
            return None

        # 归一化为单位向量
        return {"x": dx / length, "y": dy / length, "z": dz / length}