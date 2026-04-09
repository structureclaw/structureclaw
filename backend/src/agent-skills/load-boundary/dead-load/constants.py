"""
恒载常量定义 / Dead Load Constants

本模块定义了恒载生成器中使用的所有工程常量，
包括材料密度、单位换算系数等。
"""

# ============================================================================
# 材料密度数据库 (Material Density Database)
# ============================================================================
# 单位：kg/m³
# 参考规范：GB 50009-2012 建筑结构荷载规范

MATERIAL_DENSITIES = {
    # 混凝土
    'concrete': 2500,           # 普通混凝土
    'concrete_c15': 2300,       # C15混凝土
    'concrete_c20': 2400,       # C20混凝土
    'concrete_c25': 2500,       # C25混凝土
    'concrete_c30': 2500,       # C30混凝土
    'concrete_c35': 2500,       # C35混凝土
    'concrete_c40': 2500,       # C40混凝土
    'concrete_light': 1900,      # 轻骨料混凝土
    'concrete_reinforced': 2500, # 钢筋混凝土

    # 钢材
    'steel': 7850,              # 普通钢材
    'steel_q235': 7850,         # Q235钢材
    'steel_q345': 7850,         # Q345钢材
    'steel_stainless': 7900,     # 不锈钢
    'steel_galvanized': 7850,   # 镀锌钢材

    # 铝材
    'aluminum': 2700,           # 普通铝材
    'aluminum_alloy': 2700,     # 铝合金

    # 木材
    'wood': 600,                # 普通木材
    'wood_pine': 500,           # 松木
    'wood_oak': 700,            # 橡木
    'wood_bamboo': 600,         # 竹材

    # 砌体
    'brick': 1800,              # 普通砖
    'brick_hollow': 1400,        # 空心砖
    'concrete_block': 2300,      # 混凝土砌块
    'aerated_concrete': 600,     # 加气混凝土

    # 复合材料
    'composite': 1800,           # 复合材料
    'gfrp': 2000,              # 玻璃纤维增强塑料
    'cfrp': 1600,              # 碳纤维增强塑料

    # 其他
    'glass': 2500,              # 玻璃
    'plastic': 1200,            # 塑料
    'rubber': 1100,             # 橡胶
}


# ============================================================================
# 单位换算系数 (Unit Conversion Factors)
# ============================================================================

# 重力加速度 (m/s²)
GRAVITY = 9.81

# 密度到荷载的换算系数 (kg/m³ × g = kN/m³)
DENSITY_TO_LOAD = GRAVITY

# mm² 到 m² 的换算系数
MM2_TO_M2 = 1e-6

# 完整的线荷载换算系数：密度 × g × 面积
# 单位换算：kg/m³ × (N/kg) × mm² → kN/m
# = kg/m³ × 0.00981 kN/kg × 1e-6 m² = 9.80665e-9
LINEAR_LOAD_CONVERSION = 9.80665e-9


# ============================================================================
# 荷载类型 (Load Types)
# ============================================================================

class LoadType:
    """荷载类型常量"""
    DISTRIBUTED_LOAD = "distributed_load"  # 均布荷载
    POINT_FORCE = "point_force"           # 集中力
    POINT_MOMENT = "point_moment"         # 集中力矩
    TRAPEZOIDAL_LOAD = "trapezoidal_load" # 梯形荷载


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
# 荷载工况 (Load Cases)
# ============================================================================

class LoadCaseID:
    """荷载工况ID常量"""
    DEAD = "LC_DE"           # 恒载工况
    DEAD_CUSTOM = "LC_DE_C"  # 自定义恒载工况


# ============================================================================
# 荷载值范围 (Load Value Ranges)
# ============================================================================

# 荷载值最小值 (kN/m 或 kN)
MIN_LOAD_VALUE = 0.0

# 荷载值最大值 (kN/m 或 kN)
# 用于输入验证，防止异常值
MAX_DISTRIBUTED_LOAD = 1000.0   # 最大均布荷载 (kN/m)
MAX_POINT_LOAD = 10000.0         # 最大集中荷载 (kN)


# ============================================================================
# 截面类型 (Section Types)
# ============================================================================

class SectionType:
    """截面类型常量"""
    RECTANGULAR = "rectangular"  # 矩形截面
    CIRCULAR = "circular"       # 圆形截面
    BOX = "box"                # 箱形截面
    I_SECTION = "i_section"    # 工字形截面
    T_SECTION = "t_section"    # T形截面
    CHANNEL = "channel"        # 槽钢
    ANGLE = "angle"           # 角钢
    CUSTOM = "custom"          # 自定义截面


# ============================================================================
# 单元类型 (Element Types)
# ============================================================================

class ElementType:
    """单元类型常量"""
    BEAM = "beam"       # 梁
    COLUMN = "column"   # 柱
    SLAB = "slab"       # 板
    WALL = "wall"       # 墙
    TRUSS = "truss"     # 桁架
    BRACE = "brace"     # 支撑


# ============================================================================
# 辅助函数 (Helper Functions)
# ============================================================================

def get_material_density(material_category: str, material_obj: Any = None) -> float:
    """
    获取材料密度

    优先从材料对象获取，否则从数据库获取。

    Args:
        material_category: 材料类别
        material_obj: 材料对象 (可选)

    Returns:
        材料密度 (kg/m³)

    Examples:
        >>> get_material_density('concrete')
        2500
        >>> get_material_density('steel')
        7850

        >>> # 从材料对象获取
        >>> class Material:
        ...     def __init__(self, rho):
        ...         self.rho = rho
        >>> mat = Material(2400)
        >>> get_material_density('concrete', mat)
        2400
    """
    # 优先从材料对象获取
    if material_obj and hasattr(material_obj, 'rho') and material_obj.rho:
        return float(material_obj.rho)

    # 从数据库获取
    density = MATERIAL_DENSITIES.get(material_category, 2500)

    if material_category not in MATERIAL_DENSITIES:
        import logging
        logger = logging.getLogger(__name__)
        logger.warning(
            f"Unknown material category '{material_category}', "
            f"using default density {density} kg/m³"
        )

    return density


def validate_load_value(load_value: float, load_type: str = LoadType.DISTRIBUTED_LOAD) -> bool:
    """
    验证荷载值是否在合理范围内

    Args:
        load_value: 荷载值
        load_type: 荷载类型

    Returns:
        是否有效

    Raises:
        ValueError: 当荷载值无效时

    Examples:
        >>> validate_load_value(10.5)  # 有效
        True
        >>> validate_load_value(-1.0)   # 无效（负值）
        False
        >>> validate_load_value(2000.0)  # 无效（超过最大值）
        False
    """
    # 检查是否为数字
    if not isinstance(load_value, (int, float)):
        raise TypeError(f"荷载值必须是数字类型，得到: {type(load_value)}")

    # 检查是否为负数
    if load_value < MIN_LOAD_VALUE:
        raise ValueError(
            f"荷载值不能为负数，得到: {load_value}"
        )

    # 检查是否超过最大值
    max_value = MAX_DISTRIBUTED_LOAD if load_type == LoadType.DISTRIBUTED_LOAD else MAX_POINT_LOAD
    if load_value > max_value:
        raise ValueError(
            f"荷载值超过最大值 {max_value} kN，得到: {load_value}"
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

    Examples:
        >>> validate_element_type('beam')
        True
        >>> validate_element_type('invalid')
        False
    """
    valid_types = [
        ElementType.BEAM,
        ElementType.COLUMN,
        ElementType.SLAB,
        ElementType.WALL,
        ElementType.TRUSS,
        ElementType.BRACE
    ]

    if element_type not in valid_types:
        raise ValueError(
            f"无效的单元类型: {element_type}. "
            f"有效值为: {valid_types}"
        )

    return True
