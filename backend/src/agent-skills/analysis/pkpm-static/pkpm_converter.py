"""
V2 StructureModelV2 JSON → PKPM JWS (via APIPyInterface)

支持的结构类型: frame, braced-frame, reinforced-concrete frame
支持的截面:
  - H/I 型: kind="H" → IDSec_I  (PKPM字段: B=tw, H, U=bf, T=tf, D=bf, F=tf)
  - 箱型:   kind="Box"  → IDSec_Box
  - 管型:   kind="Tube" → IDSec_Tube
  - 矩形:   kind="Rectangle" / "rectangular" → IDSec_Rectangle
  标准型钢名称(standard_steel_name)优先于参数化 shape。
支持的钢材牌号: Q235, Q345, Q355, Q390, Q420, Q460 及 GJ 系列
支持的混凝土等级: C15, C20, C25, C30, C35, C40...
多层处理: 单标准层模板 + N 个自然层（楼层截面相同时适用）

单位约定:
  - V2 JSON: 坐标(m), 截面尺寸(mm), 力(kN), 应力(MPa)
  - PKPM APIPyInterface: 坐标(mm), 截面尺寸(mm)

重要: 不要调用 AddStandFloor()，直接用 SetCurrentStandFloor(1)。
      I截面字段映射参考 APIPythonTest.py:
      V2(H,B,tw,tf) → PKPM(H,B=tw,U=B,T=tf,D=B,F=tf)
"""
from __future__ import annotations

import math
import os
import re
import sys
from pathlib import Path
from typing import Any

import APIPyInterface


# ---------------------------------------------------------------------------
# Steel grade helpers
# ---------------------------------------------------------------------------

_GRADE_ALIASES: dict[str, str] = {
    "Q355B": "Q355",
    "Q345B": "Q345",
}


def _resolve_steel_grade(grade_str: str) -> Any:
    """Map V2 steel grade string to APIPyInterface.SteelGrade enum value."""
    sg = APIPyInterface.SteelGrade
    key = _GRADE_ALIASES.get(grade_str.strip().upper(), grade_str.strip().upper())
    if hasattr(sg, key):
        return getattr(sg, key)
    return sg.Q345


def _resolve_concrete_grade(grade_str: str) -> Any:
    """Map V2 concrete grade string to APIPyInterface.ConcreteGrade enum value."""
    cg = APIPyInterface.ConcreteGrade
    key = grade_str.strip().upper()
    if hasattr(cg, key):
        return getattr(cg, key)
    return cg.C30


_STEEL_GRADE_RE = re.compile(r"^[SQ]\d{3}", re.IGNORECASE)
_CONCRETE_GRADE_TOKEN_RE = re.compile(r"\bC\d{1,2}\b", re.IGNORECASE)


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _detect_material_family(data: dict) -> str:
    """Detect dominant material from model: 'steel' or 'concrete'."""
    metadata = data.get("metadata") if isinstance(data.get("metadata"), dict) else {}
    material_system = str(metadata.get("materialSystem", "")).lower()
    if "concrete" in material_system:
        return "concrete"
    if "steel" in material_system:
        return "steel"

    structure_system = data.get("structure_system") if isinstance(data.get("structure_system"), dict) else {}
    structure_extra = structure_system.get("extra") if isinstance(structure_system.get("extra"), dict) else {}
    structure_material = str(structure_extra.get("materialSystem", "")).lower()
    if "concrete" in structure_material:
        return "concrete"
    if "steel" in structure_material:
        return "steel"

    materials = data.get("materials")
    if not isinstance(materials, list):
        return "steel"

    for mat in materials:
        if not isinstance(mat, dict):
            continue
        family = str(mat.get("family", "")).lower()
        if family in ("steel", "concrete"):
            return family
        category = str(mat.get("category", "")).lower()
        if category in ("steel", "concrete"):
            return category
        name = str(mat.get("name", ""))
        if "concrete" in name.lower() or _CONCRETE_GRADE_TOKEN_RE.search(name):
            return "concrete"
        if _STEEL_GRADE_RE.match(name):
            return "steel"
    return "steel"


# ---------------------------------------------------------------------------
# Section helpers
# ---------------------------------------------------------------------------

_KIND_MAP: dict[str, Any] = {
    # PascalCase (legacy / internal)
    "H":           "IDSec_I",
    "I":           "IDSec_I",
    "Box":         "IDSec_Box",
    "Tube":        "IDSec_Tube",
    "Rectangle":   "IDSec_Rectangle",
    "Circle":      "IDSec_Circle",
    "T":           "IDSec_T",
    "L":           "IDSec_L",
    # V2 schema lowercase aliases
    "h":           "IDSec_I",
    "i":           "IDSec_I",
    "box":         "IDSec_Box",
    "tube":        "IDSec_Tube",
    "pipe":        "IDSec_Tube",   # V2 uses "pipe" for circular hollow
    "hollow-circular": "IDSec_Tube",
    "rectangular": "IDSec_Rectangle",
    "circular":    "IDSec_Circle",
    "t":           "IDSec_T",
    "l":           "IDSec_L",
}


def _make_section_shape(
    shape: dict,
    material_family: str = "steel",
) -> tuple[Any, APIPyInterface.SectionShape]:
    """Build (SectionKind, SectionShape) from a V2 shape dict.

    PKPM IDSec_I field mapping (per official APIPythonTest.py):
      B = web thickness (tw),  H = total height,
      U = top flange width,    T = top flange thickness (tf),
      D = bottom flange width, F = bottom flange thickness.

    V2 JSON uses: H=height, B=flange width, tw=web thickness, tf=flange thickness.
    """
    sk = APIPyInterface.SectionKind
    sh = APIPyInterface.SectionShape()

    kind = shape.get("kind", "Rectangle")
    sec_kind_attr = _KIND_MAP.get(kind, "IDSec_I")
    sec_kind = getattr(sk, sec_kind_attr, sk.IDSec_Rectangle)

    H  = shape.get("H") or shape.get("h")
    B  = shape.get("B") or shape.get("b")   # V2: flange width
    T  = shape.get("T") or shape.get("t")
    tw = shape.get("tw")                     # V2: web thickness
    tf = shape.get("tf")                     # V2: flange thickness
    D  = shape.get("D") or shape.get("d")    # V2: diameter (Tube/Circle)

    if sec_kind_attr == "IDSec_I":
        # PKPM I-section: B=tw, H=height, U=flange_width, T=tf, D=flange_width, F=tf
        if H  is not None: sh.Set_H(round(H))
        if tw is not None: sh.Set_B(round(tw))     # web thickness → B
        if B  is not None: sh.Set_U(round(B))      # flange width  → U (top)
        if tf is not None: sh.Set_T(round(tf))      # flange thick  → T (top)
        if B  is not None: sh.Set_D(round(B))      # flange width  → D (bottom, symmetric)
        if tf is not None: sh.Set_F(round(tf))      # flange thick  → F (bottom, symmetric)
    elif sec_kind_attr == "IDSec_Box":
        if H is not None: sh.Set_H(round(H))
        if B is not None: sh.Set_B(round(B))
        if T is not None: sh.Set_T(round(T))
    elif sec_kind_attr == "IDSec_Tube":
        if D is not None: sh.Set_D(round(D))
        if T is not None: sh.Set_T(round(T))
    else:
        if H is not None: sh.Set_H(round(H))
        if B is not None: sh.Set_B(round(B))
        if T is not None: sh.Set_T(round(T))
        if D is not None: sh.Set_D(round(D))

    # Material type: 5=steel, 6=concrete
    sh.Set_M(5 if material_family == "steel" else 6)

    return sec_kind, sh


def _dimension_to_mm(value: Any) -> float | None:
    """Normalize section dimensions from metres or millimetres to millimetres."""
    if value is None:
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if numeric <= 0:
        return None
    return numeric * 1000.0 if numeric <= 20.0 else numeric


def _shape_from_legacy_properties(sec: dict) -> dict | None:
    """Infer PKPM shape from generic StructureModel sections.

    The generic model builder emits rectangular sections as:
      { type: "rectangular", properties: { width: 0.6, height: 0.6 } }
    while the PKPM converter expects an explicit `shape` object with
    millimetre dimensions.  Keep this conversion local to PKPM so generic
    models remain schema-compatible with other engines.
    """
    raw_type = str(sec.get("type") or sec.get("kind") or "").strip().lower()
    if raw_type not in {"rectangular", "rectangle", "rect"}:
        return None

    props = sec.get("properties") if isinstance(sec.get("properties"), dict) else {}
    width = (
        props.get("width")
        or props.get("b")
        or props.get("B")
        or sec.get("width")
        or sec.get("b")
        or sec.get("B")
    )
    height = (
        props.get("height")
        or props.get("h")
        or props.get("H")
        or sec.get("height")
        or sec.get("h")
        or sec.get("H")
    )
    b_mm = _dimension_to_mm(width)
    h_mm = _dimension_to_mm(height)
    if b_mm is None or h_mm is None:
        return None
    return {"kind": "Rectangle", "B": b_mm, "H": h_mm}


def _infer_section_roles(data: dict) -> dict[str, str]:
    """Build {section_id: "col"|"beam"} by scanning element types.

    Falls back to sec.get("purpose") when no element references the section.
    A section used by both columns and beams is registered as "col" so that
    PKPM's AddColumn() receives a ColumnSection index.
    """
    roles: dict[str, str] = {}
    for elem in data.get("elements", []):
        sec_id = elem.get("section", "")
        if not sec_id:
            continue
        etype = elem.get("type", "beam")
        if etype == "column":
            roles[sec_id] = "col"   # column wins over beam
        elif sec_id not in roles:
            roles[sec_id] = "beam"
    return roles


def _safe_coord(node: dict, axis: str) -> float:
    try:
        return float(node.get(axis, 0.0))
    except (TypeError, ValueError):
        return 0.0


def _section_hint_map(data: dict) -> dict[str, str]:
    hints: dict[str, str] = {}
    for sec in data.get("sections", []):
        sec_id = str(sec.get("id", ""))
        if not sec_id:
            continue
        hints[sec_id] = " ".join([
            str(sec.get("id", "")),
            str(sec.get("name", "")),
            str(sec.get("purpose", "")),
            str(sec.get("type", "")),
        ]).lower()
    return hints


def _vertical_axis_score(data: dict, axis: str) -> float:
    """Score how likely an axis is the vertical axis.

    Generic LLM drafts sometimes use x/z as plan axes and y as height while
    still tagging metadata as global-z-up.  We detect this from element
    geometry instead of trusting metadata.
    """
    nodes_by_id = {str(n.get("id")): n for n in data.get("nodes", [])}
    other_axes = [candidate for candidate in ("x", "y", "z") if candidate != axis]
    section_hints = _section_hint_map(data)
    score = 0.0
    tol = 1e-6

    for elem in data.get("elements", []):
        node_ids = elem.get("nodes", [])
        if len(node_ids) < 2:
            continue
        n1 = nodes_by_id.get(str(node_ids[0]))
        n2 = nodes_by_id.get(str(node_ids[1]))
        if n1 is None or n2 is None:
            continue
        if abs(_safe_coord(n1, axis) - _safe_coord(n2, axis)) <= tol:
            continue
        if any(abs(_safe_coord(n1, other) - _safe_coord(n2, other)) > tol for other in other_axes):
            continue

        score += 1.0
        hint = section_hints.get(str(elem.get("section", "")), "")
        if any(token in hint for token in ("col", "column", "柱")):
            score += 2.0
        if any(token in hint for token in ("beam", "梁")):
            score -= 0.5

    return score


def _infer_vertical_axis(data: dict) -> str:
    stories = data.get("stories")
    typed_columns = sum(1 for elem in data.get("elements", []) if elem.get("type") == "column")
    z_score = _vertical_axis_score(data, "z")
    y_score = _vertical_axis_score(data, "y")

    if y_score > z_score and (not stories or typed_columns == 0):
        return "y"
    return "z"


def _dedupe_sorted_levels(values: list[float]) -> list[float]:
    levels: list[float] = []
    for value in sorted(values):
        if not levels or abs(value - levels[-1]) > 1e-6:
            levels.append(value)
    return levels


def _infer_stories_from_nodes(nodes: list[dict]) -> list[dict]:
    levels = _dedupe_sorted_levels([_safe_coord(node, "z") for node in nodes])
    if len(levels) < 2:
        return []

    stories: list[dict] = []
    for index, (lower, upper) in enumerate(zip(levels, levels[1:]), start=1):
        height = upper - lower
        if height <= 1e-6:
            continue
        stories.append({
            "id": f"S{index}",
            "level": index,
            "elevation": lower,
            "height": height,
        })
    return stories


def _normalize_generic_frame_for_pkpm(data: dict) -> tuple[dict, dict[str, Any]]:
    """Normalize generic frame drafts to PKPM's x/y-plan + z-height convention."""
    vertical_axis = _infer_vertical_axis(data)
    transform_y_up = vertical_axis == "y"

    nodes: list[dict] = []
    for node in data.get("nodes", []):
        normalized = dict(node)
        if transform_y_up:
            normalized["x"] = _safe_coord(node, "x")
            normalized["y"] = _safe_coord(node, "z")
            normalized["z"] = _safe_coord(node, "y")
        nodes.append(normalized)

    node_by_id = {str(node.get("id")): node for node in nodes}
    elements: list[dict] = []
    tol = 1e-6
    inferred_columns = 0
    for elem in data.get("elements", []):
        normalized = dict(elem)
        node_ids = list(normalized.get("nodes", []))
        if len(node_ids) >= 2:
            n1 = node_by_id.get(str(node_ids[0]))
            n2 = node_by_id.get(str(node_ids[1]))
            if n1 is not None and n2 is not None:
                same_plan = (
                    abs(_safe_coord(n1, "x") - _safe_coord(n2, "x")) <= tol
                    and abs(_safe_coord(n1, "y") - _safe_coord(n2, "y")) <= tol
                )
                vertical_delta = abs(_safe_coord(n1, "z") - _safe_coord(n2, "z"))
                if same_plan and vertical_delta > tol:
                    if normalized.get("type") != "column":
                        inferred_columns += 1
                    normalized["type"] = "column"
                    if _safe_coord(n1, "z") > _safe_coord(n2, "z"):
                        normalized["nodes"] = [node_ids[1], node_ids[0], *node_ids[2:]]
        elements.append(normalized)

    raw_stories = data.get("stories", [])
    stories = [dict(story) for story in raw_stories] if raw_stories else _infer_stories_from_nodes(nodes)

    normalized_data = dict(data)
    normalized_data["nodes"] = nodes
    normalized_data["elements"] = elements
    normalized_data["stories"] = stories
    if transform_y_up or inferred_columns or (not raw_stories and stories):
        metadata = dict(normalized_data.get("metadata") or {})
        metadata["pkpmCoordinateVerticalAxis"] = vertical_axis
        normalized_data["metadata"] = metadata

    return normalized_data, {
        "vertical_axis": vertical_axis,
        "inferred_columns": inferred_columns,
        "inferred_stories": len(stories) if not raw_stories else 0,
    }


def _register_section(
    model: APIPyInterface.Model,
    sec: dict,
    inferred_role: str,
    material_family: str = "steel",
) -> tuple[str, int]:
    """
    Register one V2 section entry.
    Returns (role, pm_section_idx) where role is "col" or "beam".

    Parametric shapes are preferred when present because they carry explicit
    H/B/tw/tf geometry into SATWE.  Standard steel names are used only when no
    shape is available; some APIPyInterface builds accept the standard-name
    call but leave SATWE section dimensions empty.
    """
    std_name: str | None = sec.get("standard_steel_name")
    shape_dict: dict | None = sec.get("shape") or _shape_from_legacy_properties(sec)
    use_standard_steel = bool(std_name) and material_family == "steel" and not shape_dict

    def _set_standard_steel(api_section: Any) -> Exception | None:
        if not std_name:
            return ValueError("standard steel section name is empty")
        try:
            api_section.SetStandSteelSect(std_name, APIPyInterface.SectionShape())
            return None
        except TypeError:
            try:
                api_section.SetStandSteelSect(std_name)
                return None
            except Exception as exc:
                return exc
        except Exception as exc:
            return exc

    if inferred_role == "col":
        csec = APIPyInterface.ColumnSection()
        if shape_dict:
            _sec_kind, sh = _make_section_shape(shape_dict, material_family)
            csec.SetUserSect(_sec_kind, sh)
        elif use_standard_steel:
            standard_error = _set_standard_steel(csec)
            if standard_error is not None:
                raise ValueError(f"Section '{sec['id']}' standard steel section failed: {standard_error}")
        else:
            raise ValueError(f"Section '{sec['id']}' has no usable PKPM section shape.")
        pm_idx = model.AddColumnSection(csec)
    else:
        bsec = APIPyInterface.BeamSection()
        if shape_dict:
            _sec_kind, sh = _make_section_shape(shape_dict, material_family)
            bsec.SetUserSect(_sec_kind, sh)
        elif use_standard_steel:
            standard_error = _set_standard_steel(bsec)
            if standard_error is not None:
                raise ValueError(f"Section '{sec['id']}' standard steel section failed: {standard_error}")
        else:
            raise ValueError(f"Section '{sec['id']}' has no usable PKPM section shape.")
        pm_idx = model.AddBeamSection(bsec)

    return inferred_role, pm_idx


def _build_section_registry(
    model: APIPyInterface.Model,
    sections: list[dict],
    data: dict,
    material_family: str = "steel",
) -> dict[str, tuple[str, int]]:
    """Register all sections. Returns {sec_id: (role, pm_idx)}."""
    inferred = _infer_section_roles(data)
    registry: dict[str, tuple[str, int]] = {}
    for sec in sections:
        purpose = sec.get("purpose", "beam")
        fallback_role = "col" if purpose == "column" else "beam"
        role = inferred.get(sec["id"], fallback_role)
        r, pm_idx = _register_section(model, sec, role, material_family)
        registry[sec["id"]] = (r, pm_idx)
    return registry


# ---------------------------------------------------------------------------
# Plan (x,y) node mapping
# ---------------------------------------------------------------------------

def _build_plan_nodes(
    floor: APIPyInterface.StandFloor,
    nodes: list[dict],
) -> tuple[dict[str, int], dict[str, tuple[float, float]]]:
    """
    Deduplicate nodes by (x,y) plan position and add them to the PKPM floor.
    Returns:
      v2_to_pm:  {v2_node_id → pm_node_id}
      v2_to_xy:  {v2_node_id → (x_mm, y_mm)}
    """
    m_to_mm = 1000.0
    xy_to_pm: dict[tuple[float, float], int] = {}
    v2_to_pm: dict[str, int] = {}
    v2_to_xy: dict[str, tuple[float, float]] = {}

    for n in nodes:
        x_mm = round(float(n["x"]) * m_to_mm, 3)
        y_mm = round(float(n["y"]) * m_to_mm, 3)
        xy = (x_mm, y_mm)

        if xy not in xy_to_pm:
            pm_node = floor.AddNode(x_mm, y_mm)
            xy_to_pm[xy] = pm_node.GetID()

        pm_id = xy_to_pm[xy]
        v2_to_pm[n["id"]] = pm_id
        v2_to_xy[n["id"]] = xy

    return v2_to_pm, v2_to_xy


# ---------------------------------------------------------------------------
# Element default steel grade fallback
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# SATWE design parameter configuration
# ---------------------------------------------------------------------------

def _configure_satwe_params(
    model: APIPyInterface.Model,
    material_family: str,
    site_seismic: dict[str, Any] | None = None,
    wind: dict[str, Any] | None = None,
    analysis_control: dict[str, Any] | None = None,
) -> None:
    """Set PMCAD/SATWE design parameters through the official API.

    `GetAllDesignPara` / `SetAllDesignPara` indices are defined in
    PKPMAPI5.0参考手册, "楼层-设计参数":
      24 = 设计地震分组
      25 = 地震烈度
      26 = 场地类别
      30 = 计算振型个数
      31 = 周期折减系数
      33 = 修正后的基本风压
      34 = 地面粗糙度类别
      35/36/37 = 体型变化分段数 / 第一段最高层号 / 第一段体型系数

    Some SATWE control values such as Tg and alpha max are persisted through
    PMProjectPara field ids from PKPM结构数据SQLite化数据表及字段说明:
      312 = 特征周期Tg
      313 = 多遇地震影响系数最大值
    The installed API stores 301/303 as compact internal values:
      301 = 0/1/2 for 第一/第二/第三组
      303 = 0/1/2/3/4 for I0/I1/II/III/IV
    """
    para = model.GetProjectPara()

    # Field 103: 结构材料信息
    if material_family == "steel":
        para.SetParaInt(103, 10303)   # 钢结构
    else:
        para.SetParaInt(103, 10301)   # 钢筋混凝土

    # Field 101: 结构体系 — default 框架结构
    para.SetParaInt(101, 10101)

    model.SaveProjectPara()

    project_para_updates_int: dict[int, int] = {}
    project_para_updates_double: dict[int, float] = {}
    design_param_updates: dict[int, float] = {}

    def _as_float(value: Any) -> float | None:
        try:
            if value is None:
                return None
            return float(value)
        except (TypeError, ValueError):
            return None

    def _design_group_code(value: Any) -> float | None:
        text = str(value or "")
        if "1" in text or "一" in text:
            return 1.0
        if "2" in text or "二" in text or "两" in text:
            return 2.0
        if "3" in text or "三" in text:
            return 3.0
        return None

    def _site_category_code(value: Any) -> float | None:
        text = str(value or "").strip().upper().replace("类", "")
        mapping = {
            "1": 1.0, "一": 1.0, "I": 1.0,
            "2": 2.0, "二": 2.0, "两": 2.0, "II": 2.0,
            "3": 3.0, "三": 3.0, "III": 3.0,
            "4": 4.0, "四": 4.0, "IV": 4.0,
        }
        return mapping.get(text)

    def _terrain_roughness_code(value: Any) -> float | None:
        text = str(value or "").strip().upper().replace("类", "")
        mapping = {"A": 1.0, "B": 2.0, "C": 3.0, "D": 4.0}
        return mapping.get(text)

    site_seismic = _as_dict(site_seismic)
    wind = _as_dict(wind)
    analysis_control = _as_dict(analysis_control)

    if site_seismic:
        intensity = _as_float(site_seismic.get("intensity"))
        site_category = _site_category_code(site_seismic.get("site_category"))
        design_group = _design_group_code(site_seismic.get("design_group"))
        if design_group is None:
            characteristic_period = _as_float(site_seismic.get("characteristic_period"))
            if site_category == 3.0 and characteristic_period is not None and characteristic_period >= 0.64:
                design_group = 3.0
            elif site_category == 2.0 and characteristic_period is not None and characteristic_period >= 0.44:
                design_group = 3.0
            elif characteristic_period is not None and characteristic_period >= 0.54:
                design_group = 2.0
        if intensity is not None:
            design_param_updates[25] = intensity
        if site_category is not None:
            design_param_updates[26] = site_category
            project_para_updates_int[303] = int(site_category)
        if design_group is not None:
            design_param_updates[24] = design_group
            project_para_updates_int[301] = max(int(design_group) - 1, 0)
        characteristic_period = _as_float(site_seismic.get("characteristic_period"))
        if characteristic_period is not None:
            project_para_updates_double[312] = characteristic_period
        max_influence_coefficient = _as_float(site_seismic.get("max_influence_coefficient"))
        if max_influence_coefficient is not None:
            project_para_updates_double[313] = max_influence_coefficient
        damping_ratio = _as_float(site_seismic.get("damping_ratio"))
        if damping_ratio is not None:
            project_para_updates_double[311] = damping_ratio * 100 if damping_ratio <= 1 else damping_ratio

    if wind:
        basic_pressure = _as_float(wind.get("basic_pressure"))
        shape_factor = _as_float(wind.get("shape_factor"))
        terrain_roughness = _terrain_roughness_code(wind.get("terrain_roughness"))
        if basic_pressure is not None:
            design_param_updates[33] = basic_pressure
            project_para_updates_double[202] = basic_pressure
        if terrain_roughness is not None:
            design_param_updates[34] = terrain_roughness
            project_para_updates_int[201] = int(terrain_roughness)
        if shape_factor is not None:
            design_param_updates[35] = 1.0
            design_param_updates[37] = shape_factor

    if analysis_control:
        modal_count = _as_float(analysis_control.get("modal_count"))
        if modal_count is not None:
            design_param_updates[30] = modal_count
            project_para_updates_int[308] = int(modal_count)
        period_reduction = _as_float(analysis_control.get("period_reduction_factor"))
        if period_reduction is not None:
            design_param_updates[31] = period_reduction
            project_para_updates_double[310] = period_reduction
        basement_count = _as_float(analysis_control.get("basement_count"))
        if basement_count is not None:
            design_param_updates[4] = basement_count
        importance_factor = _as_float(analysis_control.get("structure_importance_factor"))
        if importance_factor is not None:
            design_param_updates[2] = importance_factor

    explicit_design_params = _as_dict(analysis_control.get("design_params"))
    pkpm_design_params = _as_dict(explicit_design_params.get("pkpm"))
    satwe_indices = _as_dict(pkpm_design_params.get("satwe_indices"))
    for raw_index, raw_value in satwe_indices.items():
        try:
            index = int(raw_index)
        except (TypeError, ValueError):
            continue
        value = _as_float(raw_value)
        if value is not None:
            design_param_updates[index] = value

    for key, value in sorted(project_para_updates_int.items()):
        try:
            para.SetParaInt(key, value)
        except Exception as exc:
            sys.stderr.write(f"[pkpm_converter] ProjectPara.SetParaInt({key}, {value}) failed: {exc}\n")
    for key, value in sorted(project_para_updates_double.items()):
        try:
            para.SetParaDouble(key, value)
        except Exception as exc:
            sys.stderr.write(f"[pkpm_converter] ProjectPara.SetParaDouble({key}, {value}) failed: {exc}\n")
    if project_para_updates_int or project_para_updates_double:
        try:
            model.SaveProjectPara()
        except Exception as exc:
            sys.stderr.write(f"[pkpm_converter] SaveProjectPara failed: {exc}\n")

    if not design_param_updates:
        return

    try:
        design_params = list(model.GetAllDesignPara())
    except Exception:
        design_params = []
    if len(design_params) < 128:
        design_params.extend([0.0] * (128 - len(design_params)))
    for index, value in sorted(design_param_updates.items()):
        if 0 <= index < len(design_params):
            design_params[index] = value

    try:
        model.SetAllDesignPara(design_params)
        return
    except Exception as exc:
        sys.stderr.write(f"[pkpm_converter] SetAllDesignPara failed: {exc}\n")

    for index, value in sorted(design_param_updates.items()):
        try:
            model.SetOneDesignParaValue(index, value)
        except Exception as exc:
            sys.stderr.write(f"[pkpm_converter] SetOneDesignParaValue({index}, {value}) failed: {exc}\n")


def _log_design_params(model: APIPyInterface.Model) -> None:
    """Log meaningful SATWE design parameters for diagnostic index discovery."""
    try:
        all_params = model.GetAllDesignPara()
        for i, v in enumerate(all_params):
            # Skip garbage/uninitialized values (extremely large or zero)
            if abs(v) > 0.001 and abs(v) < 1e10:
                sys.stderr.write(f"[pkpm_satwe_param] index={i}, value={v}\n")
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Element default steel grade fallback
# ---------------------------------------------------------------------------

def _elem_grade(elem: dict, mat_id_to_grade: dict[str, str]) -> Any:
    """Resolve steel grade for one element."""
    grade = (
        elem.get("steel_grade")
        or mat_id_to_grade.get(elem.get("material", ""), "Q345")
    )
    return _resolve_steel_grade(grade)


def _elem_concrete_grade(elem: dict, mat_id_to_grade: dict[str, str]) -> Any:
    """Resolve concrete grade for one element."""
    grade = (
        elem.get("concrete_grade")
        or mat_id_to_grade.get(elem.get("material", ""), "C30")
    )
    return _resolve_concrete_grade(grade)


def _nonnegative_float(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return number if number > 0 else 0.0


def _story_dead_live_pair(story: dict[str, Any]) -> tuple[float, float]:
    return (
        _nonnegative_float(story.get("dead_load")),
        _nonnegative_float(story.get("live_load")),
    )


def _copy_standard_floor(model: APIPyInterface.Model, source_floor_index: int) -> int:
    """Copy an existing standard floor and return the new standard floor index."""
    try:
        new_index = model.AddStandFloor(source_floor_index)
    except TypeError:
        new_index = model.AddStandFloor()

    if isinstance(new_index, int) and new_index > 0:
        return new_index

    try:
        fallback_index = model.GetStandFloorCount()
    except Exception as exc:
        raise RuntimeError("PKPM AddStandFloor did not return a valid floor index.") from exc
    if isinstance(fallback_index, int) and fallback_index > 0:
        return fallback_index
    raise RuntimeError("PKPM AddStandFloor did not return a valid floor index.")


def _configure_story_standard_floor_loads(
    model: APIPyInterface.Model,
    stories: list[dict],
) -> tuple[list[int], list[dict[str, Any]]]:
    """Assign floor dead/live loads through per-load standard-floor copies.

    PKPM stores floor dead/live loads on StandFloor, while RealFloor only points
    to a standard-floor index.  Distinct story load pairs therefore need
    distinct standard-floor copies that share the same plan geometry.
    """
    story_floor_indices: list[int] = []
    load_to_standard_floor: dict[tuple[float, float], int] = {}
    load_mapping: list[dict[str, Any]] = []

    for story in stories:
        load_pair = _story_dead_live_pair(story)
        standard_floor_index = load_to_standard_floor.get(load_pair)
        if standard_floor_index is None:
            standard_floor_index = 1 if not load_to_standard_floor else _copy_standard_floor(model, 1)
            model.SetCurrentStandFloor(standard_floor_index)
            standard_floor = model.GetCurrentStandFloor()
            dead_load, live_load = load_pair
            if standard_floor_index > 1 or dead_load > 0 or live_load > 0:
                standard_floor.SetDeadLive(dead_load, live_load)
            load_to_standard_floor[load_pair] = standard_floor_index

        story_floor_indices.append(standard_floor_index)
        load_mapping.append({
            "story": story.get("id"),
            "stand_floor_index": standard_floor_index,
            "dead_load": load_pair[0],
            "live_load": load_pair[1],
        })

    model.SetCurrentStandFloor(1)
    return story_floor_indices, load_mapping


# ---------------------------------------------------------------------------
# Main converter
# ---------------------------------------------------------------------------

def convert_v2_to_jws(
    data: dict,
    work_dir: Path,
    project_name: str,
    material_family: str = "steel",
) -> tuple[Path, dict[str, Any]]:
    """
    Convert V2 StructureModelV2 JSON dict to a PKPM JWS file.

    Args:
        data:         Parsed V2 JSON (dict).
        work_dir:     Directory where PKPM will write JWS and support files.
        project_name: Base name for the JWS project (no extension).

    Returns:
        (jws_path, mappings) where mappings contains:
          - v2_to_pm: {v2_node_id: pkpm_plan_node_id}
          - v2_node_z: {v2_node_id: z_coordinate_m}
          - elem_map: {v2_elem_id: {pmid, type, floor_nodes}}

    Raises:
        ImportError:  If APIPyInterface is not available.
        ValueError:   If required model data is missing.
        RuntimeError: If PKPM API reports an error.
    """
    work_dir = work_dir.resolve()
    work_dir.mkdir(parents=True, exist_ok=True)
    jws_path = work_dir / f"{project_name}.JWS"
    data, normalization = _normalize_generic_frame_for_pkpm(data)

    # ---- Setup ----
    model = APIPyInterface.Model()
    model.CreatNewModel(str(work_dir), project_name)
    model.OpenPMModel(str(jws_path))

    # ---- Material → grade lookup ----
    mat_id_to_grade: dict[str, str] = {}
    for mat in data.get("materials", []):
        grade = mat.get("grade") or mat.get("name", "Q345")
        mat_id_to_grade[mat["id"]] = grade

    # ---- Design parameters from V2 model ----
    site_seismic = _as_dict(data.get("site_seismic"))
    structure_system = _as_dict(data.get("structure_system"))
    analysis_control = _as_dict(data.get("analysis_control"))
    wind = _as_dict(data.get("wind"))
    try:
        damping_ratio = float(site_seismic.get("damping_ratio", 0.0))
    except (TypeError, ValueError):
        damping_ratio = 0.0

    # ---- Sections ----
    sec_registry = _build_section_registry(model, data.get("sections", []), data, material_family)

    # Collect first col/beam section index for fallback when element has no section
    fallback_col_idx = next(
        (pm_idx for _, (role, pm_idx) in sec_registry.items() if role == "col"), -1
    )
    fallback_beam_idx = next(
        (pm_idx for _, (role, pm_idx) in sec_registry.items() if role == "beam"), -1
    )

    # ---- Standard floor 1 (plan template) ----
    # The model already has floor 1 available by default after CreatNewModel.
    # Extra standard floors are copied from this fully populated template only
    # when story dead/live loads differ.
    model.SetCurrentStandFloor(1)
    floor = model.GetCurrentStandFloor()

    nodes = data.get("nodes", [])
    v2_to_pm, v2_to_xy = _build_plan_nodes(floor, nodes)

    elements = data.get("elements", [])

    # Track which plan nodes already have a column so we don't double-add
    plan_nodes_with_col: set[int] = set()
    # Cache PKPM-assigned pmid per plan node (avoids stale col_obj reference)
    _col_pmid_cache: dict[int, int] = {}
    # Track beam nets to avoid duplicates
    added_nets: dict[tuple[int, int], int] = {}  # (pm_a, pm_b) → net_id
    # Track V2 element → PKPM mapping for result remapping
    elem_map: dict[str, dict[str, Any]] = {}

    # Build base restraint lookup: {pm_node_id: is_pinned}
    # V2 restraints: [ux, uy, uz, rx, ry, rz] — pinned = [T,T,T,F,F,F], fixed = [T,T,T,T,T,T]
    base_restraint: dict[int, bool] = {}  # pm_node_id → True if pinned (not fully fixed)
    for n in nodes:
        r = n.get("restraints")
        if r and len(r) == 6 and any(r):
            pm_id = v2_to_pm.get(n["id"])
            if pm_id is not None:
                all_fixed = all(r)
                if not all_fixed:
                    base_restraint[pm_id] = True  # pinned or partial

    for elem in elements:
        etype = elem.get("type", "")
        sec_id = elem.get("section", "")
        role, pm_sec_idx = sec_registry.get(sec_id, ("beam", -1))
        node_ids = elem.get("nodes", [])
        steel_grade = _elem_grade(elem, mat_id_to_grade) if material_family == "steel" else None
        concrete_grade = _elem_concrete_grade(elem, mat_id_to_grade) if material_family != "steel" else None

        if etype == "column":
            if pm_sec_idx < 0:
                pm_sec_idx = fallback_col_idx
            # Columns: use base (lower) plan node
            pm_node_id = v2_to_pm.get(node_ids[0], -1) if node_ids else -1
            if pm_node_id < 0:
                continue
            if pm_node_id not in plan_nodes_with_col:
                col_obj = floor.AddColumn(pm_sec_idx, pm_node_id)
                if material_family == "steel":
                    col_obj.SetSteelGrade(steel_grade)
                else:
                    col_obj.SetConcreteGrade(concrete_grade)
                # Apply base restraint if the base node has non-fixed restraints
                if pm_node_id in base_restraint:
                    try:
                        col_obj.SetSpecial(
                            APIPyInterface.SpecialColumn.IDSp_Constrain_Support, 1.0
                        )
                    except Exception:
                        sys.stderr.write(f"[pkpm_converter] SetSpecial(IDSp_Constrain_Support) failed "
                                         f"for column at node {pm_node_id}\n")
                plan_nodes_with_col.add(pm_node_id)
                _col_pmid_cache[pm_node_id] = getattr(col_obj, 'GetPmid', lambda: pm_node_id)()
            elem_map[elem.get("id", "")] = {
                "pmid": _col_pmid_cache.get(pm_node_id, pm_node_id),
                "type": "col",
                "floor_nodes": node_ids,
            }

        elif etype == "beam":
            if pm_sec_idx < 0:
                pm_sec_idx = fallback_beam_idx
            if len(node_ids) < 2:
                continue
            na, nb = node_ids[0], node_ids[1]
            pm_a = v2_to_pm.get(na, -1)
            pm_b = v2_to_pm.get(nb, -1)
            if pm_a < 0 or pm_b < 0 or pm_a == pm_b:
                continue

            net_key = (min(pm_a, pm_b), max(pm_a, pm_b))
            if net_key not in added_nets:
                net_obj = floor.AddLineNet(pm_a, pm_b)
                added_nets[net_key] = net_obj.GetID()

            net_id = added_nets[net_key]
            beam_obj = floor.AddBeamEx(pm_sec_idx, net_id, 0, 0, 0, 0.0)
            if material_family == "steel":
                beam_obj.SetSteelGrade(steel_grade)
            else:
                beam_obj.SetConcreteGrade(concrete_grade)
            elem_map[elem.get("id", "")] = {
                "pmid": getattr(beam_obj, 'GetPmid', lambda: net_id)(),
                "type": "beam",
                "floor_nodes": node_ids,
            }

        elif etype == "brace":
            # Braces: log a note, skip silently for now
            sys.stderr.write(f"[pkpm_converter] brace '{elem.get('id')}' skipped "
                             f"(AddBrace layer mapping not yet supported)\n")

    # ---- Natural floors (stories → real floors) ----
    stories = sorted(
        data.get("stories", []),
        key=lambda s: float(s.get("elevation", 0)),
    )
    story_standard_floor_indices, floor_load_mapping = _configure_story_standard_floor_loads(model, stories)
    m_to_mm = 1000.0
    for story_index, st in enumerate(stories):
        rf = APIPyInterface.RealFloor()
        rf.SetFloorHeight(float(st["height"]) * m_to_mm)
        rf.SetBottomElevation(float(st.get("elevation", 0)))
        rf.SetStandFloorIndex(story_standard_floor_indices[story_index])
        model.AddNaturalFloor(rf)

    # ---- Configure SATWE design parameters ----
    _configure_satwe_params(model, material_family, site_seismic, wind, analysis_control)
    if os.environ.get("PKPM_DEBUG_PARAMS"):
        _log_design_params(model)

    model.SavePMModel()
    return jws_path, {
        "v2_to_pm": v2_to_pm,
        "v2_node_z": {n["id"]: float(n.get("z", 0)) for n in nodes},
        "elem_map": elem_map,
        "stories": stories,
        "normalization": normalization,
        "material_family": material_family,
        "floor_load_mapping": floor_load_mapping,
        "design_conditions": {
            "site_seismic": site_seismic,
            "wind": wind,
            "analysis_control": analysis_control,
        },
    }
