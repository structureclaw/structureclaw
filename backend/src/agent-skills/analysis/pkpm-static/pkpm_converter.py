"""
V2 StructureModelV2 JSON → PKPM JWS (via APIPyInterface)

支持的结构类型: frame, braced-frame
支持的截面:
  - H/I 型: kind="H" → IDSec_I  (PKPM字段: B=tw, H, U=bf, T=tf, D=bf, F=tf)
  - 箱型:   kind="Box"  → IDSec_Box
  - 管型:   kind="Tube" → IDSec_Tube
  - 矩形:   kind="Rectangle" → IDSec_Rectangle
  标准型钢名称(standard_steel_name)优先于参数化 shape。
支持的钢材牌号: Q235, Q345, Q355, Q390, Q420, Q460 及 GJ 系列
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
_CONCRETE_GRADE_RE = re.compile(r"^[C]\d{1,2}$", re.IGNORECASE)


def _detect_material_family(data: dict) -> str:
    """Detect dominant material from model: 'steel' or 'concrete'."""
    for mat in data.get("materials", []):
        family = str(mat.get("family", "")).lower()
        if family in ("steel", "concrete"):
            return family
        name = str(mat.get("name", ""))
        if _CONCRETE_GRADE_RE.match(name):
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
    material_family: str = "steel",
) -> tuple[str, int]:
    """
    Register one V2 section entry.
    Returns (role, pm_section_idx) where role is "col" or "beam".

    Uses SetUserSect with shape.Set_M(5) for steel material indication.
    Steel material is also indicated via SetSteelGrade() on each element.
    """
    std_name: str | None = sec.get("standard_steel_name")
    shape_dict: dict | None = sec.get("shape")

    if inferred_role == "col":
        csec = APIPyInterface.ColumnSection()
        if shape_dict:
            _sec_kind, sh = _make_section_shape(shape_dict, material_family)
            csec.SetUserSect(_sec_kind, sh)
        elif std_name:
            csec.SetStandSteelSect(std_name)
        else:
            raise ValueError(f"Section '{sec['id']}' has no standard_steel_name or shape.")
        pm_idx = model.AddColumnSection(csec)
    else:
        bsec = APIPyInterface.BeamSection()
        if shape_dict:
            _sec_kind, sh = _make_section_shape(shape_dict, material_family)
            bsec.SetUserSect(_sec_kind, sh)
        elif std_name:
            bsec.SetStandSteelSect(std_name)
        else:
            raise ValueError(f"Section '{sec['id']}' has no standard_steel_name or shape.")
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
) -> None:
    """Set SATWE design parameters via ProjectPara (KIND field codes).

    KIND field codes (from PKPM结构数据字段说明):
      101 = 结构体系: 10101=框架, 10113=钢框架-中心支撑, 10114=钢框架-偏心支撑, ...
      102 = 结构所在地区: 10201=全国, 10202=广东, ...
      103 = 结构材料: 10301=钢筋混凝土, 10302=钢砼混合, 10303=钢结构, 10304=砌体
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
    site_seismic = data.get("site_seismic") or {}
    structure_system = data.get("structure_system") or {}
    analysis_control = data.get("analysis_control") or {}
    damping_ratio = float(site_seismic.get("damping_ratio", 0.0))

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
    # Do NOT call AddStandFloor() — it causes SavePMModel crash with beams.
    # The model already has floor 1 available by default after CreatNewModel.
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
                if material_family == "steel":
                    col_obj.SetSteelGrade(grade)
                else:
                    cg_name = mat_id_to_grade.get(elem.get("material", ""), "C30")
                    col_obj.SetConcreteGrade(_resolve_concrete_grade(cg_name))
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
                beam_obj.SetSteelGrade(grade)
            else:
                cg_name = mat_id_to_grade.get(elem.get("material", ""), "C30")
                beam_obj.SetConcreteGrade(_resolve_concrete_grade(cg_name))
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
    m_to_mm = 1000.0
    for st in stories:
        rf = APIPyInterface.RealFloor()
        rf.SetFloorHeight(float(st["height"]) * m_to_mm)
        rf.SetBottomElevation(float(st.get("elevation", 0)))
        rf.SetStandFloorIndex(1)
        model.AddNaturalFloor(rf)

    # ---- Configure SATWE design parameters ----
    _configure_satwe_params(model, material_family)
    if os.environ.get("PKPM_DEBUG_PARAMS"):
        _log_design_params(model)

    model.SavePMModel()
    return jws_path, {
        "v2_to_pm": v2_to_pm,
        "v2_node_z": {n["id"]: float(n.get("z", 0)) for n in nodes},
        "elem_map": elem_map,
    }
