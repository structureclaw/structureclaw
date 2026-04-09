"""
底部剪力计算模块 / Base Shear Calculator Module

根据《建筑抗震设计规范》GB 50011-2010 实现底部剪力法计算
Base shear method implementation according to GB 50011-2010
"""

from __future__ import annotations

from typing import Any, Dict, Optional, Literal
from enum import Enum
import logging

from .constants import (
    KG_TO_KN,
    MM2_TO_M2,
    DEFAULT_SECTION_AREA
)

logger = logging.getLogger(__name__)


class WeightCalculationMethod(str, Enum):
    """重量计算方法枚举"""
    FROM_MODEL_DIRECT = "from_model_direct"  # 从模型直接获取
    FROM_ELEMENTS = "from_elements"  # 从构件计算
    FROM_FLOORS = "from_floors"  # 从楼层计算
    AUTO = "auto"  # 自动选择


class ForceDistributeMethod(str, Enum):
    """地震力分配方法枚举"""
    BY_STIFFNESS = "by_stiffness"  # 按刚度比例分配
    BY_DISTANCE = "by_distance"  # 按距离刚度中心分配
    EVENLY = "evenly"  # 平均分配
    AUTO = "auto"  # 自动选择


class BaseShearCalculator:
    """底部剪力计算器 / Base Shear Calculator"""

    # 地震影响系数最大值 α_max (GB 50011-2010 表 5.1.4-1)
    ALPHA_MAX = {
        6.0: 0.04,  # 6度 (0.05g)
        6.5: 0.05,
        7.0: 0.08,  # 7度 (0.10g)
        7.5: 0.12,  # 7.5度 (0.15g)
        8.0: 0.16,  # 8度 (0.20g)
        8.5: 0.24,  # 8.5度 (0.30g)
        9.0: 0.32,  # 9度 (0.40g)
    }

    # 特征周期 Tg (GB 50011-2010 表 5.1.4-2)
    CHARACTERISTIC_PERIOD = {
        ('I', '第一组'): 0.25,
        ('I', '第二组'): 0.30,
        ('I', '第三组'): 0.35,
        ('II', '第一组'): 0.35,
        ('II', '第二组'): 0.40,
        ('II', '第三组'): 0.45,
        ('III', '第一组'): 0.45,
        ('III', '第二组'): 0.55,
        ('III', '第三组'): 0.65,
        ('IV', '第一组'): 0.65,
        ('IV', '第二组'): 0.75,
        ('IV', '第三组'): 0.90,
    }

    def __init__(
        self,
        model: Any,
        weight_calculation_method: WeightCalculationMethod = WeightCalculationMethod.AUTO
    ):
        """
        初始化底部剪力计算器

        Args:
            model: 结构模型
            weight_calculation_method: 重量计算方法
        """
        self.model = model
        self.weight_calculation_method = weight_calculation_method
        self._weight_cache: Optional[float] = None

    def calculate_base_shear(
        self,
        intensity: float,
        site_category: str,
        design_group: str,
        damping_ratio: float = 0.05,
        live_load_factor: float = 0.5,
        weight_calculation_method: Optional[WeightCalculationMethod] = None
    ) -> Dict[str, Any]:
        """
        计算底部剪力

        Args:
            intensity: 设防烈度 (6.0-9.0)
            site_category: 场地类别 (I, II, III, IV)
            design_group: 设计地震分组 (第一组, 第二组, 第三组)
            damping_ratio: 阻尼比
            live_load_factor: 活载组合值系数
            weight_calculation_method: 重量计算方法

        Returns:
            计算结果字典
        """
        # 确定重量计算方法
        method = weight_calculation_method or self.weight_calculation_method
        if method == WeightCalculationMethod.AUTO:
            method = self._auto_select_weight_method()

        # 计算结构总重量（重力荷载代表值）
        total_weight = self._calculate_total_weight(
            method=method,
            live_load_factor=live_load_factor
        )

        # 获取地震影响系数最大值
        alpha_max = self._get_alpha_max(intensity)

        # 获取特征周期
        characteristic_period = self._get_characteristic_period(site_category, design_group)

        # 计算地震影响系数 (简化: 取最大值)
        alpha1 = alpha_max

        # 底部剪力: F_ek = α_max * G_eq (G_eq = 0.85 * G)
        # G_eq 为结构等效重力荷载代表值，GB 50011-2010 规定 G_eq = 0.85 * G
        equivalent_weight = 0.85 * total_weight
        base_shear = alpha1 * equivalent_weight

        # 阻尼调整系数 (GB 50011-2010 公式 5.1.5-3)
        if damping_ratio != 0.05:
            # η_2 = 1 + (0.05 - ζ) / (0.08 + 1.2ζ)
            # Where ζ is damping ratio
            eta2 = 1.0 + (0.05 - damping_ratio) / (0.08 + 1.2 * damping_ratio)
            eta2 = max(min(eta2, 1.5), 0.55)
            base_shear *= eta2

        logger.info(
            f"底部剪力计算: "
            f"烈度={intensity}, "
            f"场地={site_category}, "
            f"分组={design_group}, "
            f"总重量={total_weight:.2f}kN, "
            f"α_max={alpha_max:.4f}, "
            f"底部剪力={base_shear:.2f}kN"
        )

        return {
            "base_shear": base_shear,
            "total_weight": total_weight,
            "alpha_max": alpha_max,
            "characteristic_period": characteristic_period,
            "alpha1": alpha1,
            "damping_adjustment": eta2 if damping_ratio != 0.05 else 1.0,
            "weight_calculation_method": method.value
        }

    def _auto_select_weight_method(self) -> WeightCalculationMethod:
        """
        自动选择重量计算方法

        Returns:
            推荐的计算方法

        Raises:
            ValueError: 如果模型数据不足以计算重量
        """
        # 优先级: 从模型直接获取 > 从楼层计算 > 从构件计算
        if hasattr(self.model, 'metadata') and 'total_weight' in self.model.metadata:
            return WeightCalculationMethod.FROM_MODEL_DIRECT

        if hasattr(self.model, 'stories') and self.model.stories:
            return WeightCalculationMethod.FROM_FLOORS

        if hasattr(self.model, 'elements') and self.model.elements:
            return WeightCalculationMethod.FROM_ELEMENTS

        raise ValueError(
            "无法计算结构重量: 模型数据不完整。"
            "请确保模型包含以下信息之一:\n"
            "  1. model.metadata.total_weight (直接指定总重量)\n"
            "  2. model.stories (包含楼层信息)\n"
            "  3. model.elements (包含构件信息)\n"
            "建议: 先运行恒载计算生成完整的重量数据。"
        )

    def _calculate_total_weight(
        self,
        method: WeightCalculationMethod,
        live_load_factor: float
    ) -> float:
        """
        计算结构总重量

        重力荷载代表值 = 1.0*恒载标准值 + ψ_L*活载标准值
        根据 GB 50011-2010 第 5.1.3 条

        Args:
            method: 计算方法
            live_load_factor: 活载组合值系数

        Returns:
            总重量 (kN)

        Raises:
            ValueError: 如果计算失败或结果无效
        """
        if self._weight_cache is not None:
            return self._weight_cache

        total_weight = 0.0

        try:
            if method == WeightCalculationMethod.FROM_MODEL_DIRECT:
                total_weight = self._weight_from_model_direct()

            elif method == WeightCalculationMethod.FROM_FLOORS:
                total_weight = self._weight_from_floors(live_load_factor)

            elif method == WeightCalculationMethod.FROM_ELEMENTS:
                total_weight = self._weight_from_elements(live_load_factor)

            else:
                raise ValueError(f"未知的重量计算方法: {method}")

        except Exception as e:
            raise ValueError(
                f"结构重量计算失败 (方法: {method}): {e}\n"
                "建议:\n"
                "  1. 检查模型数据完整性\n"
                "  2. 确保已运行恒载计算\n"
                "  3. 在模型 metadata 中手动指定 total_weight"
            ) from e

        if total_weight <= 0:
            raise ValueError(
                f"计算出的结构总重量无效: {total_weight} kN\n"
                "可能原因:\n"
                "  1. 模型中构件或楼层数据不完整\n"
                "  2. 材料密度或截面面积设置错误\n"
                "  3. 恒载工况未正确生成\n"
                "建议: 检查模型数据并重新运行恒载计算"
            )

        self._weight_cache = total_weight
        return total_weight

    def _weight_from_model_direct(self) -> float:
        """从模型直接获取总重量"""
        if hasattr(self.model, 'metadata') and 'total_weight' in self.model.metadata:
            return float(self.model.metadata['total_weight'])

        if hasattr(self.model, 'total_weight'):
            return float(self.model.total_weight)

        raise ValueError("模型不包含总重量信息")

    def _weight_from_floors(self, live_load_factor: float) -> float:
        """从楼层信息计算总重量"""
        total_weight = 0.0

        if not hasattr(self.model, 'stories') or not self.model.stories:
            raise ValueError("模型不包含楼层信息")

        for story in self.model.stories:
            # 楼面恒载 (kN/m²)
            floor_dead_load = 0.0
            floor_live_load = 0.0
            floor_area = 0.0

            # 从 floor_loads 获取荷载
            if hasattr(story, 'floor_loads') and story.floor_loads:
                for load in story.floor_loads:
                    if load.type == "dead":
                        floor_dead_load = load.value
                    elif load.type == "live":
                        floor_live_load = load.value

            # 估算楼层面积 (基于构件范围)
            if floor_area == 0.0:
                floor_area = self._estimate_floor_area(story.id)

            # 楼层重力荷载代表值
            floor_representative_weight = (
                floor_dead_load + live_load_factor * floor_live_load
            ) * floor_area

            # 加上竖向构件重量
            vertical_elements_weight = self._calculate_floor_vertical_elements_weight(story.id)
            floor_total_weight = floor_representative_weight + vertical_elements_weight

            total_weight += floor_total_weight

        return total_weight

    def _weight_from_elements(self, live_load_factor: float) -> float:
        """从构件计算总重量"""
        total_weight = 0.0

        if not hasattr(self.model, 'elements') or not self.model.elements:
            raise ValueError("模型不包含构件信息")

        # 创建材料和截面的查找字典
        material_dict = {m.id: m for m in self.model.materials}
        section_dict = {s.id: s for s in self.model.sections}

        for elem in self.model.elements:
            # 跳过非结构构件
            if elem.type not in ["beam", "column", "wall", "slab"]:
                continue

            material = material_dict.get(elem.material)
            section = section_dict.get(elem.section)

            if not material or not section:
                logger.warning(f"构件 {elem.id} 缺少材料或截面定义，跳过重量计算")
                continue

            # 计算构件重量
            element_weight = self._calculate_element_weight(elem, material, section)

            # 构件恒载
            dead_load = element_weight

            # 构件活载 (如果有)
            live_load = self._get_element_live_load(elem)

            # 重力荷载代表值
            element_representative_weight = dead_load + live_load_factor * live_load

            total_weight += element_representative_weight

        return total_weight

    def _calculate_floor_vertical_elements_weight(self, story_id: str) -> float:
        """计算楼层竖向构件重量"""
        weight = 0.0

        material_dict = {m.id: m for m in self.model.materials}
        section_dict = {s.id: s for s in self.model.sections}

        for elem in self.model.elements:
            if elem.story != story_id:
                continue

            if elem.type not in ["column", "wall"]:
                continue

            material = material_dict.get(elem.material)
            section = section_dict.get(elem.section)

            if not material or not section:
                continue

            weight += self._calculate_element_weight(elem, material, section)

        return weight

    def _calculate_element_weight(
        self,
        element: Any,
        material: Any,
        section: Any
    ) -> float:
        """
        计算单个构件重量

        Args:
            element: 构件
            material: 材料
            section: 截面

        Returns:
            重量 (kN)
        """
        # 计算构件长度 (m)
        elem_length = self._calculate_element_length(element)
        if elem_length <= 0:
            return 0.0

        # 计算构件面积 (m²)
        area = self._calculate_section_area(section)

        # 计算体积 (m³)
        volume = area * elem_length

        # 计算重量 (kg -> kN)
        weight_kg = volume * material.rho
        weight_kn = weight_kg * KG_TO_KN

        return weight_kn

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

        length = (dx**2 + dy**2 + dz**2) ** 0.5

        return length

    def _calculate_section_area(self, section: Any) -> float:
        """计算截面面积 (m²)"""
        # 优先使用 properties 中的面积
        if hasattr(section, 'properties') and 'area' in section.properties:
            return float(section.properties['area'])

        # 根据截面类型计算面积
        section_type = section.type.lower()

        if section_type == "rectangular" and section.width and section.height:
            # 矩形截面: A = b × h (mm² -> m²)
            area_mm2 = section.width * section.height
            return area_mm2 * MM2_TO_M2

        elif section_type == "circular" and section.diameter:
            # 圆形截面: A = π × d² / 4 (mm² -> m²)
            area_mm2 = 3.14159 * (section.diameter ** 2) / 4
            return area_mm2 * MM2_TO_M2

        elif section_type in ["i", "t", "box"]:
            if section.width and section.height and section.thickness:
                # I形、T形、箱形截面 (简化估算)
                # 注：0.8系数用于考虑截面圆角/倒角导致的内孔面积减小
                # 这是基于工程经验的估算值，实际精确计算应根据截面详细几何参数
                outer_area = section.width * section.height
                inner_area = 0.8 * (section.width - 2 * section.thickness) * (section.height - 2 * section.thickness)
                area_mm2 = outer_area - inner_area
                return max(area_mm2, 0.0) * MM2_TO_M2

        logger.warning(f"无法计算截面 {section.id} 的面积，使用默认值 {DEFAULT_SECTION_AREA:.2f} m²")
        return DEFAULT_SECTION_AREA

    def _get_element_live_load(self, element: Any) -> float:
        """获取构件活载"""
        # 检查构件的 extra 字段或 metadata
        if hasattr(element, 'extra') and 'live_load' in element.extra:
            return float(element.extra['live_load'])

        if hasattr(element, 'metadata') and 'live_load' in element.metadata:
            return float(element.metadata['live_load'])

        return 0.0

    def _estimate_floor_area(self, story_id: str) -> float:
        """估算楼层面积 (m²)"""
        node_dict = {n.id: n for n in self.model.nodes}

        x_coords = []
        y_coords = []

        for node in self.model.nodes:
            if node.story == story_id:
                x_coords.append(node.x)
                y_coords.append(node.y)

        if not x_coords:
            return 100.0  # 默认值

        width = max(x_coords) - min(x_coords)
        depth = max(y_coords) - min(y_coords)

        return max(width * depth, 1.0)

    def _get_alpha_max(self, intensity: float) -> float:
        """获取地震影响系数最大值"""
        for key, value in sorted(self.ALPHA_MAX.items()):
            if intensity <= key:
                return value
        return self.ALPHA_MAX[9.0]

    def _get_characteristic_period(
        self,
        site_category: str,
        design_group: str
    ) -> float:
        """获取特征周期"""
        key = (site_category, design_group)
        return self.CHARACTERISTIC_PERIOD.get(key, 0.40)
