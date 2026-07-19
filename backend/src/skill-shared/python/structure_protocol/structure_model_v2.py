"""
StructureModelV2 — Unified structural analysis JSON schema, version 2.0.0.

Extends V1 with project info, structure system, seismic/wind parameters,
story definitions, parametric section shapes, per-element material grades,
wall/slab openings, and expanded analysis control fields required by PKPM,
YJK, and other commercial analysis engines.

Backward-compatible: all V1 payloads validate under V2 after migration via
``migrate_v1_to_v2()``; every new field defaults to ``None`` / empty list.

Unit conventions
----------------
Dimension                    Unit
---------------------------  ----
Global coordinates (x,y,z)   m
Story height / elevation      m
Section dimensions            mm   (SectionShape fields: H, B, tw, tf, …)
Floor loads (dead/live)       kN/m²
Concentrated forces           kN
Distributed loads             kN/m or kN/m²
Moments                       kN·m
Elastic modulus E             MPa
Yield strength fy             MPa
Density rho                   kg/m³
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, StrictBool, model_validator


def _resolve_entity_alias(
    record: Dict[str, Any], keys: tuple[str, ...], label: str
) -> Optional[str]:
    values = [str(record[key]) for key in keys if record.get(key) is not None]
    if any(not value for value in values):
        raise ValueError(f"{label} must have a non-empty id")
    unique = set(values)
    if len(unique) > 1:
        raise ValueError(f"{label} contains conflicting aliases")
    return values[0] if values else None


# ---------------------------------------------------------------------------
# Project-level information
# ---------------------------------------------------------------------------

class ProjectInfo(BaseModel):
    """项目基本信息 / Project metadata."""

    name: Optional[str] = Field(default=None, description="项目名称")
    code_standard: Optional[str] = Field(
        default=None,
        description="设计规范版本, e.g. 'GB50011-2010', 'GB50010-2010'",
    )
    design_life: Optional[int] = Field(
        default=None, gt=0, description="设计基准期 (年)"
    )
    importance_class: Optional[str] = Field(
        default=None, description="建筑重要性类别, e.g. '甲', '乙', '丙', '丁'"
    )
    extra: Dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Structure system
# ---------------------------------------------------------------------------

STRUCTURE_TYPES = Literal[
    "frame",
    "frame-shear-wall",
    "shear-wall",
    "frame-tube",
    "tube-in-tube",
    "braced-frame",
    "masonry",
    "other",
]

SEISMIC_GRADES = Literal["special", "first", "second", "third", "fourth", "none"]


class StructureSystem(BaseModel):
    """结构体系描述 / Structure system definition."""

    type: Optional[STRUCTURE_TYPES] = Field(default=None, description="结构类型")
    seismic_grade: Optional[SEISMIC_GRADES] = Field(
        default=None, description="抗震等级（全局默认，可被构件级 seismic_grade 覆盖）"
    )
    direction_x_system: Optional[str] = Field(
        default=None, description="X 向抗侧力体系"
    )
    direction_y_system: Optional[str] = Field(
        default=None, description="Y 向抗侧力体系"
    )
    extra: Dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Site & seismic parameters (Chinese code–oriented)
# ---------------------------------------------------------------------------

class SiteSeismicParams(BaseModel):
    """场地与地震参数 / Site and seismic design parameters."""

    intensity: Optional[float] = Field(
        default=None,
        description="设防烈度, e.g. 7, 7.5, 8",
    )
    design_group: Optional[str] = Field(
        default=None,
        description="设计地震分组, e.g. '第一组', '第二组', '第三组'",
    )
    site_category: Optional[str] = Field(
        default=None,
        description="场地类别, e.g. 'I', 'II', 'III', 'IV'",
    )
    characteristic_period: Optional[float] = Field(
        default=None, ge=0,
        description="特征周期 Tg (s)",
    )
    max_influence_coefficient: Optional[float] = Field(
        default=None, gt=0,
        description="水平地震影响系数最大值 αmax",
    )
    damping_ratio: Optional[float] = Field(
        default=0.05, ge=0, le=1.0,
        description="阻尼比 ζ",
    )
    extra: Dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Wind parameters
# ---------------------------------------------------------------------------

class WindParams(BaseModel):
    """风荷载参数 / Wind load parameters."""

    basic_pressure: Optional[float] = Field(
        default=None, ge=0,
        description="基本风压 w0 (kN/m²)",
    )
    terrain_roughness: Optional[Literal["A", "B", "C", "D"]] = Field(
        default=None,
        description="地面粗糙度类别",
    )
    shape_factor: Optional[float] = Field(
        default=None,
        description="风荷载体型系数 μs",
    )
    height_variation_factor: Optional[float] = Field(
        default=None,
        description="风压高度变化系数 μz",
    )
    extra: Dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Story definitions
# ---------------------------------------------------------------------------

class FloorLoad(BaseModel):
    """楼面荷载 / Floor area loads (kN/m²)."""

    type: Literal["dead", "live", "other"] = "other"
    value: float = Field(..., description="荷载值 (kN/m²)")
    description: Optional[str] = None


class StoryDef(BaseModel):
    """楼层定义 / Story definition."""

    id: str = Field(..., min_length=1)
    height: float = Field(..., gt=0, description="层高 (m)")
    elevation: Optional[float] = Field(
        default=None, description="楼层底部标高 (m)"
    )
    is_basement: bool = Field(default=False, description="是否为地下室层")
    rigid_diaphragm: bool = Field(default=True, description="刚性楼板假定")
    floor_loads: List[FloorLoad] = Field(default_factory=list)

    # PKPM standard-floor grouping: stories sharing the same group id are
    # modelled as a single representative floor in PKPM's floor-based system.
    standard_floor_group: Optional[str] = Field(
        default=None,
        description="标准层分组 id，相同 group 的楼层共用同一 PKPM 标准层定义",
    )
    # Convenience fields (override / supplement floor_loads when present)
    dead_load: Optional[float] = Field(
        default=None, ge=0,
        description="恒荷载标准值 (kN/m²)，对应 PKPM SysInfoDetail.DeadLoad",
    )
    live_load: Optional[float] = Field(
        default=None, ge=0,
        description="活荷载标准值 (kN/m²)，对应 PKPM SysInfoDetail.LiveLoad",
    )
    extra: Dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Parametric section shape
# ---------------------------------------------------------------------------

SECTION_SHAPE_KINDS = Literal[
    "rectangular",      # 矩形实心（混凝土常用）
    "circular",         # 圆形实心
    "I",                # 工字形 / 标准 I 形钢
    "H",                # H 型钢（宽翼缘）
    "T",                # T 形
    "L",                # 等肢角钢
    "box",              # 箱形（空心矩形）
    "hollow-circular",  # 空心圆（圆管混凝土 CFST 除外）
    "channel",          # 槽钢（C 形）
    "Z",                # Z 形
    "cross",            # 十字形
    "thin-walled-I",    # 薄壁工字形
    "built-up-I",       # 焊接组合 I 形
    "built-up-box",     # 焊接箱形
    "pipe",             # 圆钢管
    "double-angle",     # 双拼角钢
    "unequal-angle",    # 不等肢角钢
    "CFT-circular",     # 圆钢管混凝土
    "CFT-rectangular",  # 方（矩）钢管混凝土
    "SRC",              # 型钢混凝土
    "cold-formed-C",    # 冷弯 C 形截面
    "custom",           # 自定义（用 properties 传完整参数）
]

SECTION_PURPOSE = Literal[
    "beam",       # 梁
    "column",     # 柱
    "wall",       # 剪力墙
    "slab",       # 楼板
    "brace",      # 支撑
    "other",      # 其他
]


class SectionShape(BaseModel):
    """参数化截面形状 / Parametric section geometry (all dimensions in mm).

    The 16 fields cover the geometry of all 22 SECTION_SHAPE_KINDS.
    Only the fields relevant to the chosen ``kind`` need to be set.

    Common field → kind mapping
    ---------------------------
    H, B                    rectangular, I, H, T, channel, Z, cross, built-up-I, SRC
    H, B, T                 box, built-up-box, CFT-rectangular
    d                       circular, pipe, CFT-circular, hollow-circular
    d, T                    pipe, CFT-circular, hollow-circular (T = wall thickness)
    a, t                    L (equal leg angle)
    a, a2, t                unequal-angle
    H, B, tw, tf            I, H, T, channel
    H, B, tw, tf, tf2, B2   built-up-I with unequal flanges

    Wall sections (purpose="wall")
    --------------------------------
    Use kind="rectangular" with ``T`` (wall thickness in mm). The other
    parameters are not required. Maps to PKPM WallSection.SetSect().
    """

    kind: SECTION_SHAPE_KINDS = Field(..., description="截面种类")

    # Overall dimensions
    H: Optional[float] = Field(default=None, gt=0, description="截面总高度 (mm)")
    B: Optional[float] = Field(default=None, gt=0, description="截面总宽度 / 翼缘宽度 (mm)")

    # Web / flanges
    tw: Optional[float] = Field(default=None, gt=0, description="腹板厚度 tw (mm)")
    tf: Optional[float] = Field(default=None, gt=0, description="上翼缘厚度 tf (mm)")
    tf2: Optional[float] = Field(default=None, gt=0, description="下翼缘厚度 tf2 (mm，不等翼缘时使用)")
    B2: Optional[float] = Field(default=None, gt=0, description="下翼缘宽度 B2 (mm，不等翼缘时使用)")

    # Wall thickness / hollow sections
    T: Optional[float] = Field(default=None, gt=0, description="壁厚 T (mm，管/箱/空心截面)")

    # Circular / pipe
    d: Optional[float] = Field(default=None, gt=0, description="外径 d (mm)")
    d2: Optional[float] = Field(default=None, gt=0, description="内径 d2 (mm，空心圆)")

    # Angle sections
    a: Optional[float] = Field(default=None, gt=0, description="角钢肢长 a (mm)")
    a2: Optional[float] = Field(default=None, gt=0, description="不等肢角钢第二肢长 a2 (mm)")
    t: Optional[float] = Field(default=None, gt=0, description="角钢肢厚 t (mm)")

    # Built-up / clear dimensions
    hw: Optional[float] = Field(default=None, gt=0, description="腹板净高 hw (mm，组合截面)")
    r: Optional[float] = Field(default=None, ge=0, description="圆角半径 r (mm)")

    # Generic secondary thickness (cold-formed, SRC encased, etc.)
    t2: Optional[float] = Field(default=None, gt=0, description="辅助厚度 t2 (mm)")


# ---------------------------------------------------------------------------
# Extended core models (backward-compatible with V1)
# ---------------------------------------------------------------------------

class NodeV2(BaseModel):
    """节点 / Node — same as V1."""

    id: str = Field(..., min_length=1)
    x: float = Field(..., allow_inf_nan=False)
    y: float = Field(..., allow_inf_nan=False)
    z: float = Field(..., allow_inf_nan=False)
    restraints: Optional[List[StrictBool]] = Field(
        default=None,
        min_length=6,
        max_length=6,
        description="[ux, uy, uz, rx, ry, rz]",
    )
    story: Optional[str] = Field(default=None, description="所属楼层 id")


class ElementV2(BaseModel):
    """单元 / Element — extended from V1 with per-element grades and geometry."""

    id: str = Field(..., min_length=1)
    type: Literal[
        "beam", "column", "truss", "shell", "solid",
        "wall", "slab", "link", "brace",
    ] = "beam"
    nodes: List[str] = Field(..., min_length=2)
    material: str = Field(..., min_length=1)
    section: str = Field(..., min_length=1)
    story: Optional[str] = Field(default=None, description="所属楼层 id")
    releases: Optional[Dict[str, Any]] = Field(
        default=None,
        description="端部释放条件 / end releases",
    )

    # Per-element material grade overrides (take precedence over global material)
    concrete_grade: Optional[str] = Field(
        default=None,
        description="混凝土强度等级, e.g. 'C30', 'C35'。对应 PKPM ColumnSection/BeamSection.SetConcrete()",
    )
    steel_grade: Optional[str] = Field(
        default=None,
        description="钢材牌号, e.g. 'Q355', 'Q420'。对应 PKPM SteelColumn/SteelBeam.SetSteel()",
    )
    rebar_grade: Optional[str] = Field(
        default=None,
        description="纵筋强度等级, e.g. 'HRB400', 'HRB500'",
    )
    seismic_grade: Optional[SEISMIC_GRADES] = Field(
        default=None,
        description="构件级抗震等级（覆盖 StructureSystem.seismic_grade）",
    )

    # Geometry overrides
    rotation_angle: Optional[float] = Field(
        default=None,
        allow_inf_nan=False,
        description="截面绕构件轴的旋转角 (度)，对应 PKPM SetAngle()",
    )
    offsets: Optional[Dict[str, float]] = Field(
        default=None,
        description=(
            "端部偏心距 (m)，keys: 'i_x', 'i_y', 'i_z', 'j_x', 'j_y', 'j_z'。"
            "对应 PKPM SetExcentricity()"
        ),
    )

    extra: Dict[str, Any] = Field(default_factory=dict)


class MaterialV2(BaseModel):
    """材料 / Material — extended from V1 with code-grade support."""

    id: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)
    E: float = Field(..., gt=0, description="弹性模量 (MPa)")
    nu: float = Field(..., ge=0, le=0.5, description="泊松比")
    rho: float = Field(..., gt=0, description="密度 (kg/m³)")
    fy: Optional[float] = Field(default=None, gt=0, description="屈服强度 (MPa)")
    grade: Optional[str] = Field(
        default=None,
        description="规范材料等级, e.g. 'C30', 'HRB400', 'Q355'",
    )
    category: Optional[Literal["concrete", "rebar", "steel", "other"]] = Field(
        default=None, description="材料类别"
    )
    extra: Dict[str, Any] = Field(default_factory=dict)


class SectionV2(BaseModel):
    """截面 / Section — extended from V1 with parametric shapes.

    Section source priority when converting to engine-specific format:
      1. ``standard_steel_name`` (if set) → engine uses standard library lookup,
         e.g. PKPM SetStandSteelSect(name, shape_code).
      2. ``shape`` (if set) → engine uses parametric dimensions from SectionShape.
      3. Legacy ``type`` / ``width`` / ``height`` / ``thickness`` / ``diameter``
         fields remain for backward compatibility.

    ``standard_steel_name`` and ``shape`` are mutually exclusive as section
    *sources*; if both are provided, ``standard_steel_name`` takes precedence.
    """

    id: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)

    # Legacy type string (kept for backward compat; prefer shape.kind)
    type: str = Field(
        ..., min_length=1,
        description="e.g. 'rectangular', 'circular', 'I', 'H', 'box', 'custom'",
    )

    # Parametric shape (V2 preferred)
    purpose: Optional[SECTION_PURPOSE] = Field(
        default=None,
        description="截面用途，用于引擎选择建模 API（beam/column/wall/slab/brace/other）",
    )
    shape: Optional[SectionShape] = Field(
        default=None,
        description=(
            "参数化截面几何。purpose='wall' 时只需 kind='rectangular' + T (厚度 mm)。"
            "与 standard_steel_name 互斥，standard_steel_name 优先。"
        ),
    )
    standard_steel_name: Optional[str] = Field(
        default=None,
        description=(
            "国标型钢名称, e.g. 'HN400x200', 'HW200x200', 'L100x10'。"
            "对应 PKPM SetStandSteelSect(name, shape_code)。"
            "与 shape 互斥，优先级高于 shape。"
        ),
    )

    # Legacy convenience dimensions (all in mm)
    properties: Dict[str, Any] = Field(default_factory=dict)
    width: Optional[float] = Field(default=None, gt=0, description="截面宽度 b (mm)")
    height: Optional[float] = Field(default=None, gt=0, description="截面高度 h (mm)")
    diameter: Optional[float] = Field(default=None, gt=0, description="直径 d (mm)")
    thickness: Optional[float] = Field(default=None, gt=0, description="壁厚 t (mm)")

    extra: Dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_section_source(self) -> "SectionV2":
        """Document that standard_steel_name takes precedence over shape."""
        # No strict enforcement to preserve backward compatibility with
        # existing payloads that use only the legacy type/width/height fields.
        return self


# ---------------------------------------------------------------------------
# Wall and slab openings
# ---------------------------------------------------------------------------

class WallOpening(BaseModel):
    """墙洞 / Opening in a wall element.

    Coordinates are relative to the wall element's local system:
      x_offset — horizontal distance from wall i-node (m)
      z_offset — vertical distance from the story bottom elevation (m)
    """

    id: str = Field(..., min_length=1)
    wall_element_id: str = Field(..., description="所在墙单元 id")
    x_offset: float = Field(..., ge=0, description="洞口水平偏移（距 i 节点，m）")
    z_offset: float = Field(..., ge=0, description="洞口底部垂直偏移（距楼层底，m）")
    width: float = Field(..., gt=0, description="洞口宽度 (m)")
    height: float = Field(..., gt=0, description="洞口高度 (m)")
    extra: Dict[str, Any] = Field(default_factory=dict)


class SlabOpening(BaseModel):
    """板洞 / Opening in a floor slab."""

    id: str = Field(..., min_length=1)
    story_id: str = Field(..., description="所在楼层 id")
    x: float = Field(..., description="洞口中心 X 坐标 (m)")
    y: float = Field(..., description="洞口中心 Y 坐标 (m)")
    width: float = Field(..., gt=0, description="洞口宽度 X 方向 (m)")
    depth: float = Field(..., gt=0, description="洞口深度 Y 方向 (m)")
    shape: Literal["rectangular", "circular"] = Field(
        default="rectangular", description="洞口形状"
    )
    extra: Dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Load case / combination
# ---------------------------------------------------------------------------

class LoadCaseV2(BaseModel):
    """荷载工况 / Load case."""

    id: str = Field(..., min_length=1)
    type: Literal[
        "dead", "live", "wind", "seismic",
        "temperature", "settlement", "crane",
        "snow", "other",
    ] = "other"
    kind: Optional[Literal["permanent", "variable", "accidental"]] = Field(
        default=None,
        description=(
            "荷载种类（GB50009/EN1990 分类）: "
            "permanent=永久, variable=可变, accidental=偶然"
        ),
    )
    loads: List[Dict[str, Any]] = Field(default_factory=list)
    description: Optional[str] = None
    extra: Dict[str, Any] = Field(default_factory=dict)


class LoadCombinationV2(BaseModel):
    """荷载组合 / Load combination — with code reference."""

    id: str = Field(..., min_length=1)
    factors: Dict[str, float] = Field(default_factory=dict)
    combination_type: Optional[Literal["uls", "sls", "accidental"]] = Field(
        default=None,
        description="组合类型: 承载能力极限状态 / 正常使用极限状态 / 偶然",
    )
    code_reference: Optional[str] = Field(
        default=None, description="规范条文号"
    )
    extra: Dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Analysis control
# ---------------------------------------------------------------------------

class AnalysisControl(BaseModel):
    """分析控制参数 / Analysis control settings."""

    p_delta: bool = Field(default=False, description="考虑 P-Δ 效应")
    rigid_floor: bool = Field(default=True, description="刚性楼板假定")
    period_reduction_factor: Optional[float] = Field(
        default=None, ge=0, le=1.0,
        description="周期折减系数",
    )
    accidental_eccentricity: Optional[float] = Field(
        default=None, ge=0,
        description="偶然偏心比",
    )
    consideration_torsion: bool = Field(
        default=True, description="考虑扭转耦联"
    )
    modal_count: Optional[int] = Field(
        default=None, gt=0,
        description="振型数",
    )

    # Extended fields for commercial engines (PKPM / YJK)
    basement_count: Optional[int] = Field(
        default=None, ge=0,
        description="地下室层数，对应 PKPM SysInfoDetail.UnderGroundFloorNum",
    )
    vibration_mode_method: Optional[Literal["ritz", "subspace", "lanczos"]] = Field(
        default=None,
        description="振型计算方法",
    )
    live_load_reduction: Optional[bool] = Field(
        default=None,
        description="活荷载折减，对应 PKPM SysInfoDetail.LiveLoadReductionFlag",
    )
    structure_importance_factor: Optional[float] = Field(
        default=None, gt=0,
        description="结构重要性系数 γ0，对应 PKPM SysInfoDetail.StructureImportanceFactor",
    )
    damping_ratio_wind: Optional[float] = Field(
        default=None, ge=0, le=1.0,
        description="风振计算阻尼比（可与 SiteSeismicParams.damping_ratio 不同）",
    )
    design_params: Dict[str, Any] = Field(
        default_factory=dict,
        description="引擎专用扩展设计参数，e.g. {'pkpm': {'satwe_params': {...}}}",
    )
    extra: Dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Root model
# ---------------------------------------------------------------------------

class CoordinateSystemV2(BaseModel):
    """Canonical global coordinate and DOF contract.

    StructureClaw uses a right-handed global Z-up system.  Two-dimensional
    structures are represented only in the global X-Z plane; Y is their
    out-of-plane axis.
    """

    semantics: Literal["global-z-up"]
    version: Literal[1]
    dimension: Literal["2d", "3d"]
    plane: Optional[Literal["xz"]]
    dof_order: List[Literal["ux", "uy", "uz", "rx", "ry", "rz"]] = Field(
        ...,
        min_length=6,
        max_length=6,
    )

    @model_validator(mode="after")
    def validate_dimension_plane(self) -> "CoordinateSystemV2":
        expected_order = ["ux", "uy", "uz", "rx", "ry", "rz"]
        if list(self.dof_order) != expected_order:
            raise ValueError(f"dof_order must be {expected_order}")
        if self.dimension == "2d" and self.plane != "xz":
            raise ValueError("Canonical 2-D structures must use the global X-Z plane")
        if self.dimension == "3d" and self.plane is not None:
            raise ValueError("Three-dimensional structures cannot declare a 2-D plane")
        return self

class StructureModelV2(BaseModel):
    """Unified structural analysis JSON schema V2.

    Covers the core parameters required by OpenSeesPy, PKPM, YJK, and other
    mainstream structural analysis engines.  Migrated V1 payloads receive an
    explicit typed coordinate contract before V2 validation.
    """

    schema_version: str = Field(default="2.0.0")
    unit_system: str = Field(default="SI")
    coordinate_system: CoordinateSystemV2

    # --- NEW in V2 ---
    project: Optional[ProjectInfo] = None
    structure_system: Optional[StructureSystem] = None
    site_seismic: Optional[SiteSeismicParams] = None
    wind: Optional[WindParams] = None
    stories: List[StoryDef] = Field(default_factory=list)
    analysis_control: Optional[AnalysisControl] = None

    # Openings
    wall_openings: List[WallOpening] = Field(default_factory=list)
    slab_openings: List[SlabOpening] = Field(default_factory=list)

    # --- Carried from V1 (extended models) ---
    nodes: List[NodeV2] = Field(default_factory=list)
    elements: List[ElementV2] = Field(default_factory=list)
    materials: List[MaterialV2] = Field(default_factory=list)
    sections: List[SectionV2] = Field(default_factory=list)
    load_cases: List[LoadCaseV2] = Field(default_factory=list)
    load_combinations: List[LoadCombinationV2] = Field(default_factory=list)

    metadata: Dict[str, Any] = Field(default_factory=dict)
    extensions: Dict[str, Any] = Field(
        default_factory=dict,
        description="Engine-specific extension fields, e.g. {'pkpm': {...}}",
    )

    @model_validator(mode="after")
    def validate_references(self) -> "StructureModelV2":
        """Cross-reference validation across all entity collections."""
        declared_dimension = self.coordinate_system.dimension

        metadata_semantics = self.metadata.get("coordinateSemantics")
        if metadata_semantics not in {None, "global-z-up"}:
            raise ValueError(
                f"metadata.coordinateSemantics '{metadata_semantics}' conflicts with the canonical contract"
            )
        metadata_version = self.metadata.get("coordinateContractVersion")
        if metadata_version not in {None, 1}:
            raise ValueError(
                f"metadata.coordinateContractVersion '{metadata_version}' conflicts with the canonical contract"
            )
        metadata_dimension = self.metadata.get("frameDimension")
        if metadata_dimension is not None and metadata_dimension not in {"2d", "3d"}:
            raise ValueError("metadata.frameDimension must be '2d' or '3d'")
        if metadata_dimension is not None and metadata_dimension != declared_dimension:
            raise ValueError(
                f"metadata.frameDimension '{metadata_dimension}' conflicts with coordinate_system.dimension "
                f"'{declared_dimension}'"
            )

        self.metadata = {
            **self.metadata,
            "coordinateSemantics": "global-z-up",
            "coordinateContractVersion": 1,
            "frameDimension": declared_dimension,
        }

        if declared_dimension == "2d":
            for node in self.nodes:
                if abs(float(node.y)) > 1e-9:
                    raise ValueError(
                        f"Node '{node.id}' has non-zero global Y in a canonical X-Z 2-D model"
                    )

        node_ids = {n.id for n in self.nodes}
        nodes_by_id = {node.id: node for node in self.nodes}
        material_ids = {m.id for m in self.materials}
        section_ids = {s.id for s in self.sections}
        story_ids = {s.id for s in self.stories} if self.stories else set()
        element_ids = {e.id for e in self.elements}

        for collection_name, values in (
            ("node", [node.id for node in self.nodes]),
            ("element", [element.id for element in self.elements]),
            ("material", [material.id for material in self.materials]),
            ("section", [section.id for section in self.sections]),
            ("load case", [load_case.id for load_case in self.load_cases]),
        ):
            if len(values) != len(set(values)):
                raise ValueError(f"Duplicate {collection_name} id")

        for elem in self.elements:
            if elem.type in {"beam", "column", "truss", "brace", "link"} and len(elem.nodes) != 2:
                raise ValueError(f"Line element '{elem.id}' must reference exactly two nodes")
            if declared_dimension == "2d" and abs(float(elem.rotation_angle or 0.0)) > 1e-9:
                raise ValueError(
                    f"Element '{elem.id}' cannot rotate its section axes in a canonical 2-D model"
                )
            for node_id in elem.nodes:
                if node_id not in node_ids:
                    raise ValueError(
                        f"Element '{elem.id}' references unknown node '{node_id}'"
                    )
            if len(set(elem.nodes)) != len(elem.nodes):
                raise ValueError(f"Element '{elem.id}' contains duplicate node references")
            if len(elem.nodes) >= 2 and all(node_id in nodes_by_id for node_id in elem.nodes[:2]):
                start = nodes_by_id[elem.nodes[0]]
                end = nodes_by_id[elem.nodes[1]]
                length = math.sqrt(
                    (float(end.x) - float(start.x)) ** 2
                    + (float(end.y) - float(start.y)) ** 2
                    + (float(end.z) - float(start.z)) ** 2
                )
                if length <= 1e-9:
                    raise ValueError(f"Element '{elem.id}' has zero length")
            if elem.offsets is not None:
                for key, value in elem.offsets.items():
                    if not math.isfinite(float(value)):
                        raise ValueError(f"Element '{elem.id}' offset '{key}' must be finite")
            if elem.material not in material_ids:
                raise ValueError(
                    f"Element '{elem.id}' references unknown material '{elem.material}'"
                )
            if elem.section not in section_ids:
                raise ValueError(
                    f"Element '{elem.id}' references unknown section '{elem.section}'"
                )
            if elem.story and elem.story not in story_ids:
                raise ValueError(
                    f"Element '{elem.id}' references unknown story '{elem.story}'"
                )

        reference_vectors = self.metadata.get("elementReferenceVectors")
        if reference_vectors is not None:
            if declared_dimension == "2d":
                raise ValueError(
                    "Canonical 2-D local axes are fixed; elementReferenceVectors are not allowed"
                )
            if not isinstance(reference_vectors, dict):
                raise ValueError("metadata.elementReferenceVectors must be an object")
            for element_id, raw_vector in reference_vectors.items():
                normalized_id = str(element_id)
                element = next((item for item in self.elements if item.id == normalized_id), None)
                if element is None:
                    raise ValueError(f"Reference vector targets unknown element '{normalized_id}'")
                if not isinstance(raw_vector, list) or len(raw_vector) != 3:
                    raise ValueError(
                        f"Element '{normalized_id}' reference vector must contain three finite numbers"
                    )
                try:
                    vector = [float(value) for value in raw_vector]
                except (TypeError, ValueError) as error:
                    raise ValueError(
                        f"Element '{normalized_id}' reference vector must contain three finite numbers"
                    ) from error
                if not all(math.isfinite(value) for value in vector):
                    raise ValueError(
                        f"Element '{normalized_id}' reference vector must contain three finite numbers"
                    )
                start = nodes_by_id[element.nodes[0]]
                end = nodes_by_id[element.nodes[1]]
                direction = [
                    float(end.x) - float(start.x),
                    float(end.y) - float(start.y),
                    float(end.z) - float(start.z),
                ]
                vector_length = math.sqrt(sum(value * value for value in vector))
                direction_length = math.sqrt(sum(value * value for value in direction))
                cross = [
                    vector[1] * direction[2] - vector[2] * direction[1],
                    vector[2] * direction[0] - vector[0] * direction[2],
                    vector[0] * direction[1] - vector[1] * direction[0],
                ]
                cross_length = math.sqrt(sum(value * value for value in cross))
                if (
                    vector_length <= 1e-9
                    or cross_length / (vector_length * direction_length) <= 1e-9
                ):
                    raise ValueError(
                        f"Element '{normalized_id}' reference vector cannot be zero or parallel to its axis"
                    )

        for node in self.nodes:
            if node.story and node.story not in story_ids:
                raise ValueError(
                    f"Node '{node.id}' references unknown story '{node.story}'"
                )

        load_case_ids = {lc.id for lc in self.load_cases}
        for load_case in self.load_cases:
            for load in load_case.loads:
                reference_frame = load.get("reference_frame", "global")
                if reference_frame not in {"global", "element-local"}:
                    raise ValueError(
                        f"Load in '{load_case.id}' has invalid reference_frame '{reference_frame}'"
                    )
                load["reference_frame"] = reference_frame
                node_ref = _resolve_entity_alias(
                    load, ("node", "nodeId", "node_id"), "Nodal load target"
                )
                element_ref = _resolve_entity_alias(
                    load, ("element", "elementId", "element_id"), "Member load target"
                )
                if (node_ref is None) == (element_ref is None):
                    raise ValueError("Every structural load must target exactly one node or element")
                if node_ref is not None and node_ref not in node_ids:
                    raise ValueError(f"Load in '{load_case.id}' references unknown node '{node_ref}'")
                if element_ref is not None and element_ref not in element_ids:
                    raise ValueError(f"Load in '{load_case.id}' references unknown element '{element_ref}'")
                legacy_component_names = [
                    key for key in (
                        "Fx", "Fy", "Fz", "Mx", "My", "Mz",
                        "momentX", "momentY", "momentZ",
                    )
                    if key in load
                ]
                if legacy_component_names:
                    raise ValueError(
                        "V2 load components must use lowercase fx/fy/fz/mx/my/mz: "
                        + ", ".join(legacy_component_names)
                    )
                if node_ref is not None and any(key in load for key in ("wx", "wy", "wz")):
                    raise ValueError(
                        "Nodal loads must use fx/fy/fz and mx/my/mz, not member-load w components"
                    )
                if element_ref is not None and any(
                    key in load for key in ("fx", "fy", "fz", "mx", "my", "mz", "forces")
                ):
                    raise ValueError(
                        "Member loads must use wx/wy/wz, not nodal force or moment components"
                    )
                for key in (
                    "fx", "fy", "fz", "mx", "my", "mz",
                    "wx", "wy", "wz",
                ):
                    if key not in load or load.get(key) is None:
                        continue
                    try:
                        numeric_value = float(load[key])
                    except (TypeError, ValueError) as error:
                        raise ValueError(f"Load component '{key}' must be finite") from error
                    if not math.isfinite(numeric_value):
                        raise ValueError(f"Load component '{key}' must be finite")
                forces = load.get("forces")
                if forces is not None:
                    if any(
                        key in load
                        for key in (
                            "fx", "fy", "fz", "mx", "my", "mz",
                            "value", "magnitude", "direction", "axis",
                        )
                    ):
                        raise ValueError(
                            "Nodal load forces cannot be combined with component or directional aliases"
                        )
                    if not isinstance(forces, list) or len(forces) != 6:
                        raise ValueError("Load forces must contain [fx, fy, fz, mx, my, mz]")
                    try:
                        numeric_forces = [float(value) for value in forces]
                    except (TypeError, ValueError) as error:
                        raise ValueError("Load forces must contain six finite values") from error
                    if not all(math.isfinite(value) for value in numeric_forces):
                        raise ValueError("Load forces must contain six finite values")
                is_distributed = (
                    str(load.get("type", "")).lower() == "distributed"
                    or element_ref is not None
                )
                if reference_frame == "element-local" and not is_distributed:
                    raise ValueError("Only member loads may use reference_frame='element-local'")
                if declared_dimension == "2d" and reference_frame == "global":
                    inactive_values = {
                        "fy": load.get("fy", 0.0),
                        "mx": load.get("mx", 0.0),
                        "mz": load.get("mz", 0.0),
                        "wy": load.get("wy", 0.0),
                    }
                    if isinstance(forces, list) and len(forces) >= 6:
                        inactive_values.update({
                            "forces[1]": forces[1],
                            "forces[3]": forces[3],
                            "forces[5]": forces[5],
                        })
                    nonzero = [
                        key for key, value in inactive_values.items()
                        if abs(float(value or 0.0)) > 1e-9
                    ]
                    if nonzero:
                        raise ValueError(
                            "Out-of-plane load components are not allowed in a canonical X-Z 2-D model: "
                            + ", ".join(nonzero)
                        )
                if declared_dimension == "2d" and reference_frame == "element-local":
                    if abs(float(load.get("wy", 0.0) or 0.0)) > 1e-9:
                        raise ValueError(
                            "Local wy is out of plane for a canonical X-Z 2-D member load"
                        )

        for combo in self.load_combinations:
            for case_id in combo.factors:
                if case_id not in load_case_ids:
                    raise ValueError(
                        f"LoadCombination '{combo.id}' references unknown load case '{case_id}'"
                    )

        for opening in self.wall_openings:
            if opening.wall_element_id not in element_ids:
                raise ValueError(
                    f"WallOpening '{opening.id}' references unknown element '{opening.wall_element_id}'"
                )

        for opening in self.slab_openings:
            if opening.story_id not in story_ids:
                raise ValueError(
                    f"SlabOpening '{opening.id}' references unknown story '{opening.story_id}'"
                )

        return self
