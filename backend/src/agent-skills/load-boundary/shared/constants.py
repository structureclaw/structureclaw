"""
荷载与边界条件共享常量
Load and Boundary Shared Constants
统一管理所有荷载类型、单位等常量
"""

from enum import Enum
from typing import Dict, Any, Optional


# ============================================================================
# 荷载类型枚举 (Load Type Enum) - 对齐 V2 Schema
# ============================================================================

class LoadType(str, Enum):
    """荷载类型枚举 / Load Type Enumeration - 对齐 V2 Schema"""
    DISTRIBUTED_LOAD = "distributed_load"  # 均布荷载
    POINT_FORCE = "point_force"         # 集中力
    MOMENT = "moment"                 # 弯矩
    TORQUE = "torque"                # 扭矩
    AXIAL_FORCE = "axial_force"        # 轴向力


# ============================================================================
# 单元类型枚举 (Element Type Enum)
# ============================================================================

class ElementType(str, Enum):
    """单元类型枚举 / Element Type Enumeration"""
    BEAM = "beam"       # 梁
    COLUMN = "column"   # 柱
    SLAB = "slab"       # 板
    WALL = "wall"       # 墙
    TRUSS = "truss"     # 桁架
    BRACE = "brace"     # 支撑
    SHELL = "shell"     # 壳
    SOLID = "solid"     # 实体
    LINK = "link"       # 连接单元


# ============================================================================
# 荷载方向常量 (Load Direction Constants)
# ============================================================================

class LoadDirection:
    """荷载方向常量 / Load Direction Constants"""
    # 主方向
    POSITIVE_X = {"x": 1.0, "y": 0.0, "z": 0.0}   # +X方向
    NEGATIVE_X = {"x": -1.0, "y": 0.0, "z": 0.0}  # -X方向
    POSITIVE_Y = {"x": 0.0, "y": 1.0, "z": 0.0}   # +Y方向
    NEGATIVE_Y = {"x": 0.0, "y": -1.0, "z": 0.0}  # -Y方向
    POSITIVE_Z = {"x": 0.0, "y": 0.0, "z": 1.0}   # +Z方向
    NEGATIVE_Z = {"x": 0.0, "y": 0.0, "z": -1.0}  # -Z方向 (重力方向)
    
    # 重力方向 (默认)
    GRAVITY = NEGATIVE_Z


# ============================================================================
# 荷载值范围 (Load Value Ranges)
# ============================================================================

MIN_LOAD_VALUE = 0.0           # 最小荷载值 (kN/m² 或 kN)
MAX_DISTRIBUTED_LOAD = 1000.0  # 最大均布荷载 (kN/m)
MAX_POINT_LOAD = 10000.0        # 最大集中荷载 (kN)
MAX_AREA_LOAD = 50.0           # 最大面荷载 (kN/m²)


# ============================================================================
# 单位转换常量 (Unit Conversion Constants)
# ============================================================================

KG_TO_KN = 0.00980665  # kg → kN
MM2_TO_M2 = 1e-6       # mm² → m²
MM_TO_M = 0.001        # mm → m
LINEAR_LOAD_CONVERSION = 9.80665e-9  # kg/m³ * mm² → kN/m


# ============================================================================
# 默认几何参数 (Default Geometry Parameters)
# ============================================================================

DEFAULT_WIDTH_BEAM = 600.0   # 梁默认高度 (mm)
DEFAULT_WIDTH_COLUMN = 500.0 # 柱子默认宽度 (mm)
DEFAULT_WIDTH_TRUSS = 200.0  # 桁架默认尺寸 (mm)
DEFAULT_WIDTH_SLAB = 1000.0  # 板默认宽度 (mm)
DEFAULT_FLOOR_HEIGHT = 3.0   # 默认楼层高度 (m)
DEFAULT_SECTION_AREA = 0.01  # 默认截面面积 (m²)


# ============================================================================
# 材料密度常量 (Material Density Constants)
# ============================================================================

MATERIAL_DENSITIES = {
    "concrete": 2500.0,  # 混凝土 (kg/m³)
    "steel": 7850.0,     # 钢材 (kg/m³)
    "timber": 600.0,     # 木材 (kg/m³)
    "aluminum": 2700.0,  # 铝合金 (kg/m³)
}


# ============================================================================
# 标准活载值 (Standard Live Load Values)
# ============================================================================

STANDARD_LIVE_LOADS = {
    "residential": 2.0,   # 住宅 (kN/m²)
    "office": 2.0,        # 办公 (kN/m²)
    "classroom": 2.5,    # 教室 (kN/m²)
    "corridor": 2.5,     # 走廊 (kN/m²)
    "stairs": 3.5,       # 楼梯 (kN/m²)
    "roof": 0.5,         # 屋面 (kN/m²)
    "parking": 2.5,      # 停车场 (kN/m²)
    "warehouse": 5.0,    # 仓库 (kN/m²)
}


# ============================================================================
# 荷载工况ID常量 (Load Case ID Constants)
# ============================================================================

class LoadCaseID:
    """荷载工况ID常量 / Load Case ID Constants"""
    DEAD = "LC_DE"         # 恒载
    LIVE = "LC_LL"         # 活载
    WIND = "LC_W"          # 风载
    SEISMIC = "LC_E"       # 地震
    SNOW = "LC_S"          # 雪载
    TEMPERATURE = "LC_T"  # 温度
    CRANE = "LC_C"         # 吊车


# ============================================================================
# 输出模式常量 (Output Mode Constants)
# ============================================================================

class OutputMode(str):
    """输出模式常量 / Output Mode Constants"""
    LINEAR = "linear"  # 线荷载模式 (kN/m)
    AREA = "area"      # 面荷载模式 (kN/m²)


DEFAULT_OUTPUT_MODE = OutputMode.LINEAR


# ============================================================================
# 受荷宽度来源常量 (Tributary Width Source Constants)
# ============================================================================

class TributaryWidthSource(str):
    """受荷宽度来源常量 / Tributary Width Source Constants"""
    GEOMETRY = "geometry"  # 从几何关系计算
    DEFAULT = "default"    # 使用默认值


def get_default_tributary_width(element_type: str) -> float:
    """
    获取默认受荷宽度

    Args:
        element_type: 单元类型

    Returns:
        默认受荷宽度 (m)
    """
    if element_type == ElementType.BEAM:
        return DEFAULT_WIDTH_BEAM / 1000.0
    elif element_type == ElementType.SLAB:
        return 1.0
    else:
        return 1.0


def get_standard_live_load(floor_type: str) -> float:
    """
    获取标准活载值

    Args:
        floor_type: 楼面类型

    Returns:
        活载值 (kN/m²)
    """
    return STANDARD_LIVE_LOADS.get(floor_type, 2.0)


def get_material_density(material_category: str) -> float:
    """
    获取材料密度

    Args:
        material_category: 材料类别

    Returns:
        材料密度 (kg/m³)
    """
    return MATERIAL_DENSITIES.get(material_category, 2500.0)


def validate_floor_load_type(floor_load_type: str) -> bool:
    """
    验证楼面荷载类型

    Args:
        floor_load_type: 楼面荷载类型

    Returns:
        是否有效

    Raises:
        ValueError: 当类型无效时
    """
    valid_types = list(STANDARD_LIVE_LOADS.keys())
    if floor_load_type not in valid_types:
        raise ValueError(
            f"无效的楼面荷载类型: {floor_load_type}. "
            f"有效值为: {valid_types}"
        )
    return True


def validate_live_load_value(load_value: float) -> bool:
    """
    验证活载值

    Args:
        load_value: 活载值 (kN/m²)

    Returns:
        是否有效

    Raises:
        TypeError: 当类型错误时
        ValueError: 当值无效时
    """
    if not isinstance(load_value, (int, float)):
        raise TypeError(f"活载值必须是数字类型，得到: {type(load_value)}")

    if load_value < 0:
        raise ValueError(f"活载值不能为负数，得到: {load_value}")

    if load_value > MAX_AREA_LOAD:
        raise ValueError(
            f"活载值不能超过 {MAX_AREA_LOAD} kN/m²，得到: {load_value}"
        )

    return True


# ============================================================================
# 验证辅助函数 (Validation Helper Functions)
# ============================================================================

def validate_load_value(
    load_value: float,
    load_type: str = LoadType.DISTRIBUTED_LOAD
) -> bool:
    """
    验证荷载值是否在合理范围内
    
    Args:
        load_value: 荷载值
        load_type: 荷载类型
    
    Returns:
        是否有效
    
    Raises:
        TypeError: 当参数类型错误时
        ValueError: 当荷载值无效时
    """
    # 检查是否为数字
    if not isinstance(load_value, (int, float)):
        raise TypeError(f"荷载值必须是数字类型，得到: {type(load_value)}")
    
    # 检查是否为负数
    if load_value < MIN_LOAD_VALUE:
        raise ValueError(f"荷载值不能为负数，得到: {load_value}")
    
    # 检查是否超过最大值
    if load_type == LoadType.DISTRIBUTED_LOAD:
        max_value = MAX_DISTRIBUTED_LOAD
    elif load_type == LoadType.AXIAL_FORCE or load_type == LoadType.POINT_FORCE:
        max_value = MAX_POINT_LOAD
    else:
        max_value = MAX_AREA_LOAD
    
    if load_value > max_value:
        raise ValueError(
            f"荷载值超过最大值 {max_value}，得到: {load_value}"
        )
    
    return True


def validate_element_type(element_type: str) -> bool:
    """
    验证单元类型是否有效
    
    Args:
        element_type: 单元类型
    
    Returns:
        是否有效
    
    Raises:
        ValueError: 当单元类型无效时
    """
    valid_types = [
        ElementType.BEAM,
        ElementType.COLUMN,
        ElementType.SLAB,
        ElementType.WALL,
        ElementType.TRUSS,
        ElementType.BRACE,
        ElementType.SHELL,
        ElementType.SOLID,
        ElementType.LINK
    ]
    
    if element_type not in valid_types:
        raise ValueError(
            f"无效的单元类型: {element_type}. "
            f"有效值为: {valid_types}"
        )
    
    return True


def validate_string_id(
    value: str,
    field_name: str = "ID"
) -> bool:
    """
    验证字符串ID
    
    Args:
        value: 字符串值
        field_name: 字段名称
    
    Returns:
        是否有效
    
    Raises:
        TypeError: 当类型错误时
        ValueError: 当值为空时
    """
    if not isinstance(value, str):
        raise TypeError(
            f"{field_name}必须是字符串类型，得到: {type(value)}"
        )
    
    if not value or not value.strip():
        raise ValueError(
            f"{field_name}不能为空"
        )
    
    return True


def validate_dict_value(
    value: Dict[str, Any],
    field_name: str = "字典值",
    required_keys: Optional[list] = None
) -> bool:
    """
    验证字典值
    
    Args:
        value: 字典值
        field_name: 字段名称
        required_keys: 必需的键列表
    
    Returns:
        是否有效
    
    Raises:
        TypeError: 当类型错误时
        ValueError: 当缺少必需键时
    """
    if not isinstance(value, dict):
        raise TypeError(
            f"{field_name}必须是字典类型，得到: {type(value)}"
        )
    
    if required_keys:
        missing_keys = [k for k in required_keys if k not in value]
        if missing_keys:
            raise ValueError(
                f"{field_name}缺少必需键: {missing_keys}"
            )
    
    return True


def validate_numeric_value(
    value: float,
    field_name: str = "数值",
    min_value: Optional[float] = None,
    max_value: Optional[float] = None,
    allow_negative: bool = False
) -> bool:
    """
    验证数值
    
    Args:
        value: 数值
        field_name: 字段名称
        min_value: 最小值
        max_value: 最大值
        allow_negative: 是否允许负数
    
    Returns:
        是否有效
    
    Raises:
        TypeError: 当类型错误时
        ValueError: 当数值无效时
    """
    if not isinstance(value, (int, float)):
        raise TypeError(
            f"{field_name}必须是数字类型，得到: {type(value)}"
        )
    
    if not allow_negative and value < 0:
        raise ValueError(
            f"{field_name}不能为负数，得到: {value}"
        )
    
    if min_value is not None and value < min_value:
        raise ValueError(
            f"{field_name}不能小于 {min_value}，得到: {value}"
        )
    
    if max_value is not None and value > max_value:
        raise ValueError(
            f"{field_name}不能大于 {max_value}，得到: {value}"
        )
    
    return True
