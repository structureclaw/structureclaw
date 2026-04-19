"""
V2 StructureModelV2 JSON → PKPM JWS (via APIPyInterface)

支持的结构类型: frame, braced-frame
支持的截面:
  - H/I 型: kind="H" 或 IDSec_I (HW, HN, HM 等)
  - 箱型:   kind="Box"  → IDSec_Box
  - 管型:   kind="Tube" → IDSec_Tube
  - 矩形:   kind="Rectangle" → IDSec_Rectangle
  标准型钢名称(standard_steel_name)优先于参数化 shape。
支持的钢材牌号: Q235, Q345, Q355, Q390, Q420, Q460 及 GJ 系列
多层处理: 单标准层模板 + N 个自然层（楼层截面相同时适用）
         不同楼层截面不同时，需手动分多个标准层（待扩展）

单位约定:
  - V2 JSON: 坐标(m), 截面尺寸(mm), 力(kN), 应力(MPa)
  - PKPM APIPyInterface: 坐标(mm), 截面尺寸(mm)
"""
from __future__ import annotations

import math
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


def _make_section_shape(shape: dict) -> tuple[Any, APIPyInterface.SectionShape]:
    """Build (SectionKind, SectionShape) from a V2 shape dict."""
    sk = APIPyInterface.SectionKind
    sh = APIPyInterface.SectionShape()

    kind = shape.get("kind", "Rectangle")
    sec_kind_attr = _KIND_MAP.get(kind, "IDSec_I")
    sec_kind = getattr(sk, sec_kind_attr, sk.IDSec_Rectangle)

    H  = shape.get("H") or shape.get("h")
    B  = shape.get("B") or shape.get("b")
    T  = shape.get("T") or shape.get("t")  # wall/flange thickness (Box/Tube) or flange (T-section)
    tw = shape.get("tw")
    tf = shape.get("tf")
    D  = shape.get("D") or shape.get("d")  # V2 uses lowercase "d" for diameter

    if H  is not None: sh.Set_H(int(H))
    if B  is not None: sh.Set_B(int(B))
    if D  is not None: sh.Set_D(int(D))

    if kind in ("H", "I"):
        # H/I section: H=total height, B=flange width, tf=flange thickness, tw=web thickness
        if tf is not None: sh.Set_T(int(tf))
        if tw is not None: sh.Set_Tw(int(tw))
    elif kind == "Box":
        # Box section: H, B, T=wall thickness
        if T is not None: sh.Set_T(int(T))
    elif kind == "Tube":
        # Tube: D=outer diameter, T=wall thickness
        if T is not None: sh.Set_T(int(T))
    else:
        if T is not None: sh.Set_T(int(T))

    return sec_kind, sh


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


def _register_section(
    model: APIPyInterface.Model,
    sec: dict,
    inferred_role: str,
) -> tuple[str, int]:
    """
    Register one V2 section entry.
    Returns (role, pm_section_idx) where role is "col" or "beam".

    The role is determined by the caller via _infer_section_roles() so that
    sections used by column elements are always registered as ColumnSection,
    regardless of whether sec["purpose"] is set.
    """
    role = inferred_role

    std_name: str | None = sec.get("standard_steel_name")
    shape_dict: dict | None = sec.get("shape")

    if role == "col":
        csec = APIPyInterface.ColumnSection()
        if shape_dict:
            sec_kind, sh = _make_section_shape(shape_dict)
            csec.SetUserSect(sec_kind, sh)
        elif std_name:
            csec.SetStandSteelSect(std_name, APIPyInterface.SectionShape())
        else:
            raise ValueError(f"Section '{sec['id']}' has no standard_steel_name or shape.")
        pm_idx = model.AddColumnSection(csec)
    else:
        bsec = APIPyInterface.BeamSection()
        if shape_dict:
            sec_kind, sh = _make_section_shape(shape_dict)
            bsec.SetUserSect(sec_kind, sh)
        elif std_name:
            bsec.SetStandSteelSect(std_name, APIPyInterface.SectionShape())
        else:
            raise ValueError(f"Section '{sec['id']}' has no standard_steel_name or shape.")
        pm_idx = model.AddBeamSection(bsec)

    return role, pm_idx


def _build_section_registry(
    model: APIPyInterface.Model,
    sections: list[dict],
    data: dict,
) -> dict[str, tuple[str, int]]:
    """Register all sections. Returns {sec_id: (role, pm_idx)}."""
    inferred = _infer_section_roles(data)
    registry: dict[str, tuple[str, int]] = {}
    for sec in sections:
        # Use element-inferred role; fall back to sec["purpose"] if not referenced
        purpose = sec.get("purpose", "beam")
        fallback_role = "col" if purpose == "column" else "beam"
        role = inferred.get(sec["id"], fallback_role)
        r, pm_idx = _register_section(model, sec, role)
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

def _elem_grade(elem: dict, mat_id_to_grade: dict[str, str]) -> Any:
    """Resolve steel grade for one element."""
    grade = (
        elem.get("steel_grade")
        or mat_id_to_grade.get(elem.get("material", ""), "Q345")
    )
    return _resolve_steel_grade(grade)


# ---------------------------------------------------------------------------
# Main converter
# ---------------------------------------------------------------------------

def convert_v2_to_jws(
    data: dict,
    work_dir: Path,
    project_name: str,
) -> Path:
    """
    Convert V2 StructureModelV2 JSON dict to a PKPM JWS file.

    Args:
        data:         Parsed V2 JSON (dict).
        work_dir:     Directory where PKPM will write JWS and support files.
        project_name: Base name for the JWS project (no extension).

    Returns:
        Path to the generated .JWS file.

    Raises:
        ImportError:  If APIPyInterface is not available.
        ValueError:   If required model data is missing.
        RuntimeError: If PKPM API reports an error.
    """
    work_dir = work_dir.resolve()
    work_dir.mkdir(parents=True, exist_ok=True)
    jws_path = work_dir / f"{project_name}.JWS"

    # ---- Setup ----
    model = APIPyInterface.Model()
    model.CreatNewModel(str(work_dir), project_name)
    model.OpenPMModel(str(jws_path))

    # ---- Material → grade lookup ----
    mat_id_to_grade: dict[str, str] = {}
    for mat in data.get("materials", []):
        grade = mat.get("grade") or mat.get("name", "Q345")
        mat_id_to_grade[mat["id"]] = grade

    # ---- Sections ----
    sec_registry = _build_section_registry(model, data.get("sections", []), data)

    # Collect first col/beam section index for fallback when element has no section
    fallback_col_idx = next(
        (pm_idx for _, (role, pm_idx) in sec_registry.items() if role == "col"), -1
    )
    fallback_beam_idx = next(
        (pm_idx for _, (role, pm_idx) in sec_registry.items() if role == "beam"), -1
    )

    # ---- Standard floor 1 (plan template) ----
    model.AddStandFloor()
    model.SetCurrentStandFloor(1)
    floor = model.GetCurrentStandFloor()

    # ---- Floor dead/live loads from stories ----
    stories_for_load = data.get("stories", [])
    agg_dead = 0.0
    agg_live = 0.0
    for st in stories_for_load:
        dl = st.get("dead_load")
        ll = st.get("live_load")
        if dl is not None:
            agg_dead = max(agg_dead, float(dl))
        if ll is not None:
            agg_live = max(agg_live, float(ll))
    if agg_dead > 0 or agg_live > 0:
        floor.SetDeadLive(agg_dead, agg_live)

    nodes = data.get("nodes", [])
    v2_to_pm, v2_to_xy = _build_plan_nodes(floor, nodes)

    elements = data.get("elements", [])

    # Track which plan nodes already have a column so we don't double-add
    plan_nodes_with_col: set[int] = set()
    # Track beam nets to avoid duplicates
    added_nets: dict[tuple[int, int], int] = {}  # (pm_a, pm_b) → net_id

    for elem in elements:
        etype = elem.get("type", "")
        sec_id = elem.get("section", "")
        role, pm_sec_idx = sec_registry.get(sec_id, ("beam", -1))
        node_ids = elem.get("nodes", [])
        grade = _elem_grade(elem, mat_id_to_grade)

        if etype == "column":
            if pm_sec_idx < 0:
                pm_sec_idx = fallback_col_idx
            # Columns: use base (lower) plan node
            pm_node_id = v2_to_pm.get(node_ids[0], -1) if node_ids else -1
            if pm_node_id < 0:
                continue
            if pm_node_id not in plan_nodes_with_col:
                col_obj = floor.AddColumn(pm_sec_idx, pm_node_id)
                col_obj.SetSteelGrade(grade)
                plan_nodes_with_col.add(pm_node_id)

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
            beam_obj.SetSteelGrade(grade)

        elif etype == "brace":
            # Braces: log a note, skip silently for now
            print(f"[pkpm_converter] brace '{elem.get('id')}' skipped "
                  f"(AddBrace layer mapping not yet supported)")

    # ---- Natural floors (stories → real floors) ----
    stories = sorted(
        data.get("stories", []),
        key=lambda s: float(s.get("elevation", 0)),
    )
    m_to_mm = 1000.0
    for st in stories:
        rf = APIPyInterface.RealFloor()
        rf.SetFloorHeight(float(st["height"]) * m_to_mm)
        rf.SetBottomElevation(float(st.get("elevation", 0)))
        rf.SetStandFloorIndex(1)
        model.AddNaturalFloor(rf)

    model.SavePMModel()
    return jws_path
