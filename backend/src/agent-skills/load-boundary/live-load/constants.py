"""
活载常量定义 / Live Load Constants

本模块定义了活载生成器中使用的所有工程常量，
包括标准活载值、受荷宽度、荷载输出模式等。
"""

from enum import Enum
from typing import Optional


# ============================================================================
# 标准活载数据库 (Standard Live Load Database)
# ============================================================================
# 单位：kN/m²
# 参考规范：GB 50009-2012 建筑结构荷载规范

STANDARD_LIVE_LOADS = {
    # 居住建筑
    'residential': 2.0,          # 住宅、宿舍、旅馆
    'hotel': 2.0,                # 旅馆客房
    'apartment': 2.0,             # 公寓

    # 办公建筑
    'office': 2.0,               # 办公室、会议室
    'conference': 2.0,            # 会议室
    'reception': 2.0,             # 接待室

    # 教育建筑
    'classroom': 2.5,            # 教室、阅览室
    'library': 2.5,               # 图书馆阅览室
    'laboratory': 2.5,            # 实验室
    'auditorium': 3.0,            # 阶梯教室、大礼堂

    # 商业建筑
    'shop': 3.5,                 # 商店
    'supermarket': 3.5,           # 超市
    'market': 3.5,                # 市场
    'restaurant': 2.5,            # 餐厅、食堂

    # 交通建筑
    'corridor': 2.5,              # 走廊、门厅、楼梯
    'stair': 3.5,                # 楼梯
    'elevator_hall': 2.5,         # 电梯厅
    'balcony': 2.5,               # 阳台

    # 屋面
    'roof': 0.5,                 # 上人屋面
    'roof_uninhabited': 0.5,       # 不上人屋面
    'roof_garden': 3.0,            # 屋顶花园

    # 工业建筑
    'equipment': 5.0,             # 设备房
    'storage': 5.0,               # 仓库
    'warehouse': 5.0,             # 库房
    'workshop': 4.0,              # 车间
    'factory': 4.0,               # 厂房

    # 其他
    'parking': 2.5,               # 停车场
    'garage': 4.0,                # 车库
    'gymnasium': 4.0,             # 体育馆
    'swimming_pool': 2.5,         # 游泳池
    'hospital': 2.0,              # 医院
    'theater': 3.0,               # 剧院
}


# ============================================================================
# 活载组合值系数 (Live Load Combination Factors)
# ============================================================================
# 参考：GB 50009-2012 表5.1.2

LIVE_LOAD_COMBINATION_FACTORS = {
    # 居住建筑
    'residential': 0.7,
    'hotel': 0.7,
    'apartment': 0.7,

    # 办公建筑
    'office': 0.7,
    'conference': 0.7,
    'reception': 0.7,

    # 教育建筑
    'classroom': 0.7,
    'library': 0.7,
    'laboratory': 0.7,

    # 商业建筑
    'shop': 0.7,
    'supermarket': 0.7,
    'market': 0.7,
    'restaurant': 0.7,

    # 交通建筑
    'corridor': 0.7,
    'stair': 0.7,
    'balcony': 0.7,

    # 屋面
    'roof': 0.7,
    'roof_uninhabited': 0.7,

    # 工业建筑
    'equipment': 0.9,
    'storage': 0.9,
    'warehouse': 0.9,
    'workshop': 0.9,
    'factory': 0.9,

    # 其他
    'parking': 0.7,
    'garage': 0.7,
    'gymnasium': 0.7,
    'swimming_pool': 0.7,
    'hospital': 0.7,
}


# ============================================================================
# 默认受荷宽度（单位：mm）
# ============================================================================

DEFAULT_WIDTH_BEAM = 3000.0      # 梁默认受荷宽度（3m）
DEFAULT_WIDTH_SLAB = 1000.0      # 板默认受荷宽度（1m）
DEFAULT_WIDTH_GENERAL = 1000.0    # 通用默认宽度
DEFAULT_WIDTH_WALL = 2000.0       # 墙默认受荷宽度（2m）


# ============================================================================
# 荷载输出模式 (Load Output Modes)
# ============================================================================

class OutputMode(str, Enum):
    """荷载输出模式枚举 / Load Output Mode Enumeration"""
    LINEAR = "linear"       # 输出线荷载（kN/m）- 与现有分析引擎兼容
    AREA = "area"           # 输出面荷载（kN/m²）- 供后续环节转换


# 默认输出模式
DEFAULT_OUTPUT_MODE = OutputMode.LINEAR


# ============================================================================
# 荷载单位 (Load Units)
# ============================================================================

class LoadUnit:
    """荷载单位常量"""
    KN_PER_M2 = "kN/m²"      # 面荷载单位（kN/平方米）
    KN_PER_M = "kN/m"         # 线荷载单位（kN/米）
    KN = "kN"                # 集中荷载单位（kN）


# ============================================================================
# 受荷宽度来源 (Tributary Width Source)
# ============================================================================

class TributaryWidthSource(str, Enum):
    """受荷宽度来源枚举 / Tributary Width Source Enumeration"""
    GEOMETRY = "geometry"    # 从几何关系计算
    DEFAULT = "default"      # 使用默认值
    MODEL = "model"          # 从模型读取
    CUSTOM = "custom"        # 用户自定义


# ============================================================================
# 荷载工况ID (Load Case IDs)
# ============================================================================

class LoadCaseID:
    """荷载工况ID常量"""
    LIVE = "LC_LL"               # 活载工况
    LIVE_CUSTOM = "LC_LL_C"       # 自定义活载工况


# ============================================================================
# 单元类型 (Element Types)
# ============================================================================

class ElementType:
    """单元类型常量"""
    BEAM = "beam"        # 梁
    SLAB = "slab"        # 板
    COLUMN = "column"      # 柱
    WALL = "wall"        # 墙
    TRUSS = "truss"      # 桁架


# ============================================================================
# 荷载类型 (Load Types)
# ============================================================================

class LoadType:
    """荷载类型常量"""
    DISTRIBUTED_LOAD = "distributed_load"  # 均布荷载
    POINT_FORCE = "point_force"           # 集中力
    POINT_MOMENT = "point_moment"         # 集中力矩


# ============================================================================
# 荷载方向 (Load Directions)
# ============================================================================

class LoadDirection:
    """荷载方向常量"""
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

MIN_LIVE_LOAD = 0.0           # 最小活载 (kN/m²)
MAX_LIVE_LOAD = 50.0          # 最大活载 (kN/m²)


# ============================================================================
# 缓存配置 (Cache Configuration)
# ============================================================================

SECTION_CACHE_SIZE = 1000        # 截面缓存大小
MODEL_CACHE_ENABLED = True       # 是否启用模型缓存


# ============================================================================
# 辅助函数 (Helper Functions)
# ============================================================================

def get_standard_live_load(floor_type: str) -> float:
    """
    获取标准活载值

    Args:
        floor_type: 楼面类型

    Returns:
        标准活载值 (kN/m²)

    Raises:
        ValueError: 当楼面类型无效时

    Examples:
        >>> get_standard_live_load('office')
        2.0
        >>> get_standard_live_load('classroom')
        2.5
        >>> get_standard_live_load('equipment')
        5.0
    """
    if floor_type not in STANDARD_LIVE_LOADS:
        raise ValueError(
            f"无效的楼面荷载类型: {floor_type}. "
            f"有效值为: {list(STANDARD_LIVE_LOADS.keys())}"
        )

    return STANDARD_LIVE_LOADS[floor_type]


def get_combination_factor(floor_type: str) -> float:
    """
    获取活载组合值系数

    Args:
        floor_type: 楼面类型

    Returns:
        组合值系数

    Examples:
        >>> get_combination_factor('office')
        0.7
        >>> get_combination_factor('equipment')
        0.9
    """
    # 如果未定义，默认使用 0.7
    return LIVE_LOAD_COMBINATION_FACTORS.get(floor_type, 0.7)


def validate_floor_load_type(floor_type: str) -> bool:
    """
    验证楼面荷载类型是否有效

    Args:
        floor_type: 楼面类型

    Returns:
        是否有效

    Raises:
        ValueError: 当楼面类型无效时

    Examples:
        >>> validate_floor_load_type('office')
        True
        >>> validate_floor_load_type('invalid')
        False
    """
    if floor_type not in STANDARD_LIVE_LOADS:
        raise ValueError(
            f"无效的楼面荷载类型: {floor_type}. "
            f"有效值为: {list(STANDARD_LIVE_LOADS.keys())}"
        )

    return True


def validate_live_load_value(load_value: float) -> bool:
    """
    验证活载值是否在合理范围内

    Args:
        load_value: 活载值 (kN/m²)

    Returns:
        是否有效

    Raises:
        ValueError: 当活载值无效时

    Examples:
        >>> validate_live_load_value(2.0)
        True
        >>> validate_live_load_value(-1.0)
        False
        >>> validate_live_load_value(100.0)
        False
    """
    # 检查是否为数字
    if not isinstance(load_value, (int, float)):
        raise TypeError(f"活载值必须是数字类型，得到: {type(load_value)}")

    # 检查是否为负数
    if load_value < MIN_LIVE_LOAD:
        raise ValueError(
            f"活载值不能为负数，得到: {load_value}"
        )

    # 检查是否超过最大值
    if load_value > MAX_LIVE_LOAD:
        raise ValueError(
            f"活载值超过最大值 {MAX_LIVE_LOAD} kN/m²，得到: {load_value}"
        )

    return True


def get_default_tributary_width(element_type: str) -> float:
    """
    获取默认受荷宽度

    Args:
        element_type: 单元类型

    Returns:
        默认受荷宽度（米）

    Examples:
        >>> get_default_tributary_width('beam')
        3.0
        >>> get_default_tributary_width('slab')
        1.0
    """
    width_mm = DEFAULT_WIDTH_GENERAL

    if element_type == ElementType.BEAM:
        width_mm = DEFAULT_WIDTH_BEAM
    elif element_type == ElementType.SLAB:
        width_mm = DEFAULT_WIDTH_SLAB
    elif element_type == ElementType.WALL:
        width_mm = DEFAULT_WIDTH_WALL

    return width_mm / 1000.0  # mm → m
