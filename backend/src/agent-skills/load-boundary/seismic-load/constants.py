"""
常量定义模块 / Constants Definition Module

定义地震荷载计算中使用的物理常量和单位转换因子
Defines physical constants and unit conversion factors for seismic load calculation
"""

from __future__ import annotations


# ===========================================================================
# 物理常量 / Physical Constants
# ===========================================================================

# 重力加速度 (m/s²)
GRAVITY = 9.81

# 单位转换: kg -> kN
KG_TO_KN = GRAVITY / 1000.0

# 单位转换: mm² -> m²
MM2_TO_M2 = 1.0 / 1_000_000.0

# 单位转换: mm⁴ -> m⁴
MM4_TO_M4 = 1.0 / 1_000_000_000_000.0

# 单位转换: mm -> m
MM_TO_M = 1.0 / 1000.0

# 单位转换: MPa -> kN/m²
MPA_TO_KN_M2 = 1000.0


# ===========================================================================
# 默认值 / Default Values
# ===========================================================================

# 默认楼层高度 (m)
DEFAULT_FLOOR_HEIGHT = 3.6

# 默认截面面积 (m²)
DEFAULT_SECTION_AREA = 0.01

# 默认惯性矩 (m⁴)
DEFAULT_INERTIA = 0.001

# 默认构件刚度 (kN/m)
DEFAULT_STIFFNESS = 1000.0


# ===========================================================================
# 验证范围 / Validation Ranges
# ===========================================================================

# 有效设防烈度列表
VALID_INTENSITIES = [6.0, 6.5, 7.0, 7.5, 8.0, 8.5, 9.0]

# 有效场地类别列表
VALID_SITE_CATEGORIES = ['I', 'II', 'III', 'IV']

# 有效设计地震分组列表
VALID_DESIGN_GROUPS = ['第一组', '第二组', '第三组']

# 有效阻尼比范围
DAMPING_RATIO_MIN = 0.01
DAMPING_RATIO_MAX = 0.20

# 有效活载组合值系数范围
LIVE_LOAD_FACTOR_MIN = 0.0
LIVE_LOAD_FACTOR_MAX = 1.0


# ===========================================================================
# 规范常量 / Code Constants (GB 50011-2010)
# ===========================================================================

# 阻尼调整系数 η_1 = 0.02 + (0.05 - ζ) / (1 + 3ζ), 最小值 0.55
# 已在 base_shear_calculator.py 中直接使用公式

# 活载组合值系数常用值
LIVE_LOAD_FACTOR_RESIDENTIAL = 0.5
LIVE_LOAD_FACTOR_OFFICE = 0.5
LIVE_LOAD_FACTOR_SCHOOL = 0.5
LIVE_LOAD_FACTOR_COMMERCIAL = 0.5
LIVE_LOAD_FACTOR_INDUSTRIAL = 0.7
LIVE_LOAD_FACTOR_WAREHOUSE = 0.8


# ===========================================================================
# 辅助函数 / Helper Functions
# ===========================================================================

def kg_to_kn(weight_kg: float) -> float:
    """
    将重量从 kg 转换为 kN

    Args:
        weight_kg: 重量

    Returns:
        重量
    """
    return weight_kg * KG_TO_KN


def mm2_to_m2(area_mm2: float) -> float:
    """
    将面积从 mm² 转换为 m²

    Args:
        area_mm2: 面积

    Returns:
        面积
    """
    return area_mm2 * MM2_TO_M2


def mm4_to_m4(inertia_mm4: float) -> float:
    """
    将惯性矩从 mm⁴ 转换为 m⁴

    Args:
        inertia_mm4: 惯性矩

    Returns:
        惯性矩
    """
    return inertia_mm4 * MM4_TO_M4


def mm_to_m(length_mm: float) -> float:
    """
    将长度从 mm 转换为 m

    Args:
        length_mm: 长度

    Returns:
        长度
    """
    return length_mm * MM_TO_M


def mpa_to_kn_m2(stress_mpa: float) -> float:
    """
    将应力从 MPa 转换为 kN/m²

    Args:
        stress_mpa: 应力

    Returns:
        应力
    """
    return stress_mpa * MPA_TO_KN_M2


def is_valid_intensity(intensity: float) -> bool:
    """检查设防烈度是否有效"""
    return intensity in VALID_INTENSITIES


def is_valid_site_category(site_category: str) -> bool:
    """检查场地类别是否有效"""
    return site_category in VALID_SITE_CATEGORIES


def is_valid_design_group(design_group: str) -> bool:
    """检查设计地震分组是否有效"""
    return design_group in VALID_DESIGN_GROUPS


def is_valid_damping_ratio(damping_ratio: float) -> bool:
    """检查阻尼比是否有效"""
    return DAMPING_RATIO_MIN <= damping_ratio <= DAMPING_RATIO_MAX


def is_valid_live_load_factor(live_load_factor: float) -> bool:
    """检查活载组合值系数是否有效"""
    return LIVE_LOAD_FACTOR_MIN <= live_load_factor <= LIVE_LOAD_FACTOR_MAX
