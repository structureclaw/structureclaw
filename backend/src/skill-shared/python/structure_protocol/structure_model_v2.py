"""
StructureModelV2 — Unified structural analysis JSON schema.

Extends V1 with project info, structure system, seismic/wind
parameters, story definitions, and analysis control fields
required by PKPM and other commercial engines.

Backward-compatible: all V1 payloads validate under V2 after
migration (new fields default to None / empty).
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, model_validator


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
        default=None, description="抗震等级"
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
    """楼面荷载 / Floor area loads."""
    type: Literal["dead", "live", "other"] = "other"
    value: float = Field(..., description="荷载值 (kN/m²)")
    description: Optional[str] = None


class StoryDef(BaseModel):
    """楼层定义 / Story definition."""
    id: str = Field(..., min_length=1)
    height: float = Field(..., gt=0, description="层高 (m)")
    elevation: Optional[float] = Field(
        default=None, description="标高 (m)"
    )
    is_basement: bool = Field(default=False, description="是否为地下室层")
    rigid_diaphragm: bool = Field(
        default=True, description="刚性楼板假定"
    )
    floor_loads: List[FloorLoad] = Field(default_factory=list)
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
    extra: Dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Extended core models (backward-compatible with V1)
# ---------------------------------------------------------------------------

class NodeV2(BaseModel):
    """节点 / Node — same as V1."""
    id: str = Field(..., min_length=1)
    x: float
    y: float
    z: float
    restraints: Optional[List[bool]] = Field(
        default=None,
        min_length=6,
        max_length=6,
        description="[ux, uy, uz, rx, ry, rz]",
    )
    story: Optional[str] = Field(
        default=None, description="所属楼层 id"
    )


class ElementV2(BaseModel):
    """单元 / Element — extended from V1."""
    id: str = Field(..., min_length=1)
    type: Literal["beam", "column", "truss", "shell", "solid", "wall", "slab", "link"] = "beam"
    nodes: List[str] = Field(..., min_length=2)
    material: str = Field(..., min_length=1)
    section: str = Field(..., min_length=1)
    story: Optional[str] = Field(default=None, description="所属楼层 id")
    releases: Optional[Dict[str, Any]] = Field(
        default=None,
        description="端部释放条件 / end releases",
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
    # Chinese-code material grades
    grade: Optional[str] = Field(
        default=None,
        description="规范材料等级, e.g. 'C30', 'HRB400', 'Q355'",
    )
    category: Optional[Literal["concrete", "rebar", "steel", "other"]] = Field(
        default=None, description="材料类别"
    )
    extra: Dict[str, Any] = Field(default_factory=dict)


class SectionV2(BaseModel):
    """截面 / Section — extended from V1 with standard shapes."""
    id: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)
    type: str = Field(..., min_length=1, description="e.g. 'rectangular', 'circular', 'I', 'T', 'box', 'custom'")
    properties: Dict[str, Any] = Field(default_factory=dict)
    # Convenience dimensions for common shapes
    width: Optional[float] = Field(default=None, gt=0, description="截面宽度 b (mm)")
    height: Optional[float] = Field(default=None, gt=0, description="截面高度 h (mm)")
    diameter: Optional[float] = Field(default=None, gt=0, description="直径 d (mm)")
    thickness: Optional[float] = Field(default=None, gt=0, description="壁厚 t (mm)")
    extra: Dict[str, Any] = Field(default_factory=dict)


class LoadCaseV2(BaseModel):
    """荷载工况 / Load case — extended types."""
    id: str = Field(..., min_length=1)
    type: Literal[
        "dead", "live", "wind", "seismic",
        "temperature", "settlement", "crane",
        "snow", "other",
    ] = "other"
    loads: List[Dict[str, Any]] = Field(default_factory=list)
    description: Optional[str] = None
    extra: Dict[str, Any] = Field(default_factory=dict)


class LoadCombinationV2(BaseModel):
    """荷载组合 / Load combination — with code reference."""
    id: str = Field(..., min_length=1)
    factors: Dict[str, float] = Field(default_factory=dict)
    combination_type: Optional[Literal["uls", "sls", "accidental"]] = Field(
        default=None, description="组合类型: 承载能力极限状态 / 正常使用极限状态 / 偶然"
    )
    code_reference: Optional[str] = Field(
        default=None, description="规范条文号"
    )
    extra: Dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Root model
# ---------------------------------------------------------------------------

class StructureModelV2(BaseModel):
    """
    Unified structural analysis JSON schema V2.

    Covers the core parameters required by OpenSeesPy, PKPM, and other
    mainstream structural analysis engines.
    """
    schema_version: str = Field(default="2.0.0")
    unit_system: str = Field(default="SI")

    # --- NEW in V2 ---
    project: Optional[ProjectInfo] = None
    structure_system: Optional[StructureSystem] = None
    site_seismic: Optional[SiteSeismicParams] = None
    wind: Optional[WindParams] = None
    stories: List[StoryDef] = Field(default_factory=list)
    analysis_control: Optional[AnalysisControl] = None

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
    def validate_references(self):
        """Cross-reference validation identical to V1."""
        node_ids = {n.id for n in self.nodes}
        material_ids = {m.id for m in self.materials}
        section_ids = {s.id for s in self.sections}
        story_ids = {s.id for s in self.stories} if self.stories else set()

        for elem in self.elements:
            for node_id in elem.nodes:
                if node_id not in node_ids:
                    raise ValueError(
                        f"Element '{elem.id}' references unknown node '{node_id}'"
                    )
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

        # Validate node → story references
        for node in self.nodes:
            if node.story and node.story not in story_ids:
                raise ValueError(
                    f"Node '{node.id}' references unknown story '{node.story}'"
                )

        # Validate load combination → load case references
        load_case_ids = {lc.id for lc in self.load_cases}
        for combo in self.load_combinations:
            for case_id in combo.factors:
                if case_id not in load_case_ids:
                    raise ValueError(
                        f"LoadCombination '{combo.id}' references unknown load case '{case_id}'"
                    )

        return self
