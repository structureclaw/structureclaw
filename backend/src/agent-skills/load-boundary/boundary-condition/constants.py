"""
边界条件常量定义 / Boundary Condition Constants

本模块定义了边界条件生成器中使用的所有工程常量，
包括有效长度系数、约束类型枚举、刚度默认值等。
"""

from enum import Enum
from typing import Dict, Any


# ============================================================================
# 有效长度系数 (Effective Length Factors)
# ============================================================================
# 参考规范：GB 50017-2017 钢结构设计标准
# 这些系数用于计算构件的稳定计算长度

LENGTH_FACTOR_FIXED = 0.5    # 固定约束的有效长度系数 μ=0.5
LENGTH_FACTOR_PINNED = 0.7   # 铰接约束的有效长度系数 μ=0.7
LENGTH_FACTOR_FREE = 1.0     # 自由端的有效长度系数 μ=1.0
LENGTH_FACTOR_GUIDED = 2.0   # 导向约束的有效长度系数 μ=2.0

# 柱的典型长度系数
COLUMN_LENGTH_FACTOR_BOTH_FIXED = 0.5      # 两端固定
COLUMN_LENGTH_FACTOR_FIXED_PINNED = 0.7     # 一端固定、一端铰接
COLUMN_LENGTH_FACTOR_BOTH_PINNED = 1.0      # 两端铰接
COLUMN_LENGTH_FACTOR_FIXED_FREE = 2.0       # 一端固定、一端自由

# 梁的典型长度系数
BEAM_LENGTH_FACTOR_CONTINUOUS = 0.5         # 连续梁
BEAM_LENGTH_FACTOR_SIMPLE = 1.0              # 简支梁
BEAM_LENGTH_FACTOR_CANTILEVER = 2.0          # 悬臂梁


# ============================================================================
# 约束类型枚举 (Constraint Type Enum)
# ============================================================================

class ConstraintType(str, Enum):
    """约束类型枚举 / Constraint Type Enumeration"""
    FIXED = "fixed"       # 固定约束 - 约束所有6个自由度
    PINNED = "pinned"     # 铰接约束 - 约束3个平动自由度
    ROLLING = "rolling"   # 滚动约束 - 约束部分平动自由度
    ELASTIC = "elastic"   # 弹性约束 - 提供刚度约束


# ============================================================================
# 滚动方向枚举 (Rolling Direction Enum)
# ============================================================================

class RollingDirection(str, Enum):
    """滚动方向枚举 / Rolling Direction Enumeration"""
    X = "x"  # X方向自由滚动
    Y = "y"  # Y方向自由滚动
    Z = "z"  # Z方向自由滚动


# ============================================================================
# 默认刚度矩阵 (Default Stiffness Matrix)
# ============================================================================
# 单位：kN/m (平动刚度)，kN·m/rad (转动刚度)

DEFAULT_STIFFNESS_MATRIX: Dict[str, float] = {
    'kxx': 1e6,      # X方向平动刚度 (kN/m)
    'kyy': 1e6,      # Y方向平动刚度 (kN/m)
    'kzz': 1e6,      # Z方向平动刚度 (kN/m)
    'kxx_rot': 1e5,  # X轴转动刚度 (kN·m/rad)
    'kyy_rot': 1e5,  # Y轴转动刚度 (kN·m/rad)
    'kzz_rot': 1e5,  # Z轴转动刚度 (kN·m/rad)
}

# 土壤地基刚度 (kN/m³)
SOIL_STIFFNESS = {
    'very_soft': 5e4,      # 很软的土
    'soft': 1e5,           # 软土
    'medium': 5e5,         # 中等土
    'stiff': 1e6,          # 硬土
    'very_stiff': 5e6,     # 很硬的土
    'rock': 1e7,           # 岩石
}


# ============================================================================
# V2 Schema 格式常量 (V2 Schema Format Constants)
# ============================================================================

# 自由度顺序 (V2 Schema 规定)
DOF_ORDER = ["ux", "uy", "uz", "rx", "ry", "rz"]

# 完全约束的 6DOF 约束数组 (V2 Schema 格式)
FULL_RESTRAINTS = [True, True, True, True, True, True]

# 仅约束平动的 3DOF 约束数组 (V2 Schema 格式)
TRANSLATIONAL_RESTRAINTS = [True, True, True, False, False, False]

# 完全自由的约束数组 (V2 Schema 格式)
FREE_RESTRAINTS = [False, False, False, False, False, False]

# X方向自由滚动约束 (V2 Schema 格式)
ROLLING_X_RESTRAINTS = [False, True, True, False, False, False]

# Y方向自由滚动约束 (V2 Schema 格式)
ROLLING_Y_RESTRAINTS = [True, False, True, False, False, False]

# Z方向自由滚动约束 (V2 Schema 格式)
ROLLING_Z_RESTRAINTS = [True, True, False, False, False, False]


# ============================================================================
# 杆端释放枚举 (Member End Release Enum)
# ============================================================================

class ReleaseType(str, Enum):
    """杆端释放类型枚举 / Member End Release Type Enumeration"""
    NONE = "none"           # 无释放
    PINNED = "pinned"       # 铰接 - 释放所有转动
    GUIDED = "guided"       # 导向 - 释放部分转动
    FREE = "free"           # 自由 - 释放所有自由度


# ============================================================================
# 计算长度方向 (Effective Length Direction)
# ============================================================================

class LengthDirection(str, Enum):
    """计算长度方向枚举 / Effective Length Direction Enumeration"""
    X = "x"      # 强轴方向 (X方向)
    Y = "y"      # 弱轴方向 (Y方向)
    WEAK = "weak"   # 弱轴
    STRONG = "strong"  # 强轴


# ============================================================================
# 辅助函数 (Helper Functions)
# ============================================================================

def get_length_factor(constraint_type: str) -> float:
    """
    根据约束类型获取有效长度系数

    Args:
        constraint_type: 约束类型 (fixed, pinned, free, guided)

    Returns:
        有效长度系数

    Raises:
        ValueError: 当约束类型无效时

    Examples:
        >>> get_length_factor("fixed")
        0.5
        >>> get_length_factor("pinned")
        0.7
        >>> get_length_factor("free")
        1.0
    """
    length_factors = {
        ConstraintType.FIXED.value: LENGTH_FACTOR_FIXED,
        ConstraintType.PINNED.value: LENGTH_FACTOR_PINNED,
        ConstraintType.FREE.value: LENGTH_FACTOR_FREE,
        ConstraintType.GUIDED.value: LENGTH_FACTOR_GUIDED,
    }

    if constraint_type not in length_factors:
        raise ValueError(
            f"未知的约束类型: {constraint_type}. "
            f"有效值为: {list(length_factors.keys())}"
        )

    return length_factors[constraint_type]


def get_restraints_by_constraint_type(
    constraint_type: ConstraintType,
    rolling_direction: RollingDirection = RollingDirection.Y
) -> list[bool]:
    """
    根据约束类型获取约束数组 (V2 Schema 格式)

    Args:
        constraint_type: 约束类型
        rolling_direction: 滚动方向 (仅对滚动约束有效)

    Returns:
        6个布尔值的列表，表示每个自由度是否被约束

    Examples:
        >>> get_restraints_by_constraint_type(ConstraintType.FIXED)
        [True, True, True, True, True, True]
        >>> get_restraints_by_constraint_type(ConstraintType.PINNED)
        [True, True, True, False, False, False]
        >>> get_restraints_by_constraint_type(ConstraintType.ROLLING, RollingDirection.X)
        [False, True, True, False, False, False]
    """
    if constraint_type == ConstraintType.FIXED:
        return FULL_RESTRAINTS.copy()
    elif constraint_type == ConstraintType.PINNED:
        return TRANSLATIONAL_RESTRAINTS.copy()
    elif constraint_type == ConstraintType.ROLLING:
        if rolling_direction == RollingDirection.X:
            return ROLLING_X_RESTRAINTS.copy()
        elif rolling_direction == RollingDirection.Y:
            return ROLLING_Y_RESTRAINTS.copy()
        else:  # Z
            return ROLLING_Z_RESTRAINTS.copy()
    elif constraint_type == ConstraintType.ELASTIC:
        return FREE_RESTRAINTS.copy()
    else:
        raise ValueError(f"未知的约束类型: {constraint_type}")


def get_constraint_description(constraint_type: ConstraintType) -> str:
    """
    获取约束类型的中文描述

    Args:
        constraint_type: 约束类型

    Returns:
        约束类型描述

    Examples:
        >>> get_constraint_description(ConstraintType.FIXED)
        '固定支座 (约束所有6个自由度)'
        >>> get_constraint_description(ConstraintType.PINNED)
        '铰支座 (约束3个平动自由度)'
    """
    descriptions = {
        ConstraintType.FIXED: "固定支座 (约束所有6个自由度)",
        ConstraintType.PINNED: "铰支座 (约束3个平动自由度)",
        ConstraintType.ROLLING: "滚动支座 (约束部分平动自由度)",
        ConstraintType.ELASTIC: "弹性支座 (提供刚度约束)"
    }

    return descriptions.get(constraint_type, "未知约束类型")
