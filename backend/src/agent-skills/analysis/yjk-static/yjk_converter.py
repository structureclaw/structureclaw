# -*- coding: utf-8 -*-
"""V2 StructureModelV2 JSON -> YJK .ydb via YJKAPI DataFunc.

Runs under YJK's bundled Python 3.10.  Imported by yjk_driver.py.

Supported section kinds (YJK 8.0 API):
  Basic geometry:
    kind=1  矩形        ShapeVal "B,H"
    kind=2  工字形/H形   ShapeVal "tw,H,B,tf1,B2,tf2" (6 params)
    kind=3  圆形        ShapeVal "D"
    kind=4  正多边形     ShapeVal (per YJK docs)
    kind=5  槽形        ShapeVal (per YJK docs)
    kind=6  十字形       ShapeVal (per YJK docs)
    kind=7  箱型        ShapeVal "B,H,U,T,D,F" (6 params; equal-thickness: B,H,t,t,t,t)
    kind=8  圆管        ShapeVal "D,d" (outer, inner) or "D,t" (outer, wall)
    kind=9  双槽形       ShapeVal (per YJK docs)
    kind=10 十字工       ShapeVal (per YJK docs)
    kind=11 梯形        ShapeVal (per YJK docs)
    kind=28 L形         ShapeVal (per YJK docs)
    kind=29 T形         ShapeVal (per YJK docs)
  Composite / SRC:
    kind=12 钢管混凝土   kind=13 工字劲   kind=14 箱形劲
    kind=-14 方管混凝土  kind=15 十字劲
    kind=24 带盖板钢组合  kind=25 组合截面
  Tapered:
    kind=21 矩形变截面   kind=22 H形变截面  kind=23 箱形变截面
    kind=33 正多边形变截面 kind=52 工字劲变截面
  Library:
    kind=26 型钢 (热轧库截面, ShapeVal="", name=规格名)
    kind=303 薄壁型钢    kind=304 薄壁型钢组合  kind=306 铝合金梁

Unit conventions:
  V2 JSON coordinates: meters   -> YJK: mm  (multiply by 1000)
  V2 section dims:     mm       -> YJK: mm  (pass through)
  V2 floor heights:    meters   -> YJK: mm  (multiply by 1000)
  V2 floor loads:      kN/m2    -> YJK: kN/m2 (pass through)
"""
from __future__ import annotations

import os
import json
from typing import Any

from YJKAPI import DataFunc, Hi_AddToAndReadYjk

M_TO_MM = 1000.0

# material category -> YJK mat type
_CATEGORY_TO_MAT: dict[str, int] = {
    "steel": 5,
    "concrete": 6,
    "rebar": 6,
    "other": 6,
}

# V2 section type string -> YJK section kind integer
# Reference: YJK 8.0 建模接口说明 + 案例/二次开发
_TYPE_TO_KIND: dict[str, int] = {
    # --- 基本型钢 / 几何截面 ---
    "rectangular": 1,   # 矩形          ShapeVal "B,H"
    "I": 2,             # 工字形         ShapeVal "tw,H,B,tf1,B2,tf2"
    "H": 2,             # H形 (同工字形)
    "circular": 3,      # 圆形          ShapeVal "D"
    "polygon": 4,       # 正多边形
    "channel": 5,       # 槽形
    "cross": 6,         # 十字形
    "box": 7,           # 箱型          ShapeVal "B,H,U,T,D,F" (等厚: B,H,t,t,t,t)
    "tube": 8,          # 圆管          ShapeVal "D,d"
    "pipe": 8,          # V2 alias for circular hollow section
    "hollow-circular": 8,  # V2 alias for circular hollow section
    "double-channel": 9,  # 双槽形
    "cross-I": 10,      # 十字工
    "trapezoid": 11,    # 梯形
    "L": 28,            # L形 (角钢)
    "T": 29,            # T形
    # --- 组合 / 劲性 / 钢管混凝土 ---
    "CFT": 12,          # 钢管混凝土
    "SRC-I": 13,        # 工字劲
    "SRC-box": 14,      # 箱形劲
    "CFT-square": -14,  # 方管混凝土
    "SRC-cross": 15,    # 十字劲
    "steel-cap": 24,    # 带盖板钢组合截面
    "composite": 25,    # 组合截面
    # --- 变截面 ---
    "tapered-rect": 21,     # 矩形变截面
    "tapered-H": 22,        # H形变截面
    "tapered-box": 23,      # 箱形变截面
    "tapered-polygon": 33,  # 正多边形变截面
    "tapered-SRC-I": 52,    # 工字劲变截面
    # --- 型钢库 / 薄壁 / 铝合金 ---
    "standard": 26,     # 型钢 (热轧库截面, ShapeVal="", name=规格名)
    "cold-formed": 303, # 薄壁型钢
    "cold-formed-composite": 304,  # 薄壁型钢组合
    "aluminum": 306,    # 铝合金梁截面
}


def _get_floor_loads(story: dict) -> tuple[float, float]:
    """Extract dead and live load values from a V2 story dict."""
    dead = 5.0
    live = 2.0
    for fl in story.get("floor_loads", []):
        if fl.get("type") == "dead":
            dead = float(fl["value"])
        elif fl.get("type") == "live":
            live = float(fl["value"])
    return dead, live


def _infer_section_roles(data: dict) -> dict[str, str]:
    """Build {section_id: "column"|"beam"} by scanning element types."""
    roles: dict[str, str] = {}
    for elem in data.get("elements", []):
        sec_id = elem.get("section", "")
        etype = elem.get("type", "beam")
        if etype == "column" and roles.get(sec_id) != "column":
            roles[sec_id] = "column"
        elif sec_id not in roles:
            roles[sec_id] = "beam"
    return roles


def _resolve_mat_type(sec: dict, data: dict) -> int:
    """Determine YJK material type integer for a section."""
    props = sec.get("properties", {})
    if "mat" in props:
        return int(props["mat"])

    mat_map: dict[str, dict] = {m["id"]: m for m in data.get("materials", [])}
    for elem in data.get("elements", []):
        if elem.get("section") == sec["id"]:
            mat = mat_map.get(elem.get("material", ""))
            if mat:
                cat = mat.get("category", "steel")
                return _CATEGORY_TO_MAT.get(cat, 6)
            break
    return 5


# --- Precise H-section lookup table (GB/T 11263 hot-rolled H-beams) ---
# (H, B, tw, tf) in mm.
_H_SECTION_DIMS: dict[str, tuple[int, int, int, int]] = {
    # HW 宽翼缘 (H≈B)
    "HW100X100": (100, 100, 6, 8),
    "HW125X125": (125, 125, 6, 9),
    "HW150X150": (150, 150, 7, 10),
    "HW175X175": (175, 175, 7, 11),
    "HW200X200": (200, 200, 8, 12),
    "HW250X250": (250, 250, 9, 14),
    "HW300X300": (300, 300, 10, 15),
    "HW350X350": (350, 350, 12, 19),
    "HW400X400": (400, 400, 13, 21),
    # HN 窄翼缘
    "HN150X75":  (150, 75, 5, 7),
    "HN200X100": (200, 100, 5, 8),
    "HN250X125": (250, 125, 6, 9),
    "HN300X150": (300, 150, 6, 9),
    "HN350X175": (350, 175, 7, 11),
    "HN400X200": (400, 200, 8, 13),
    "HN450X200": (450, 200, 9, 14),
    "HN500X200": (500, 200, 10, 16),
    "HN600X200": (600, 200, 11, 17),
    "HN700X300": (700, 300, 13, 24),
    "HN800X300": (800, 300, 14, 26),
    "HN900X300": (900, 300, 16, 28),
    # HM 中翼缘
    "HM200X150": (200, 150, 6, 9),
    "HM250X175": (250, 175, 7, 11),
    "HM300X200": (300, 200, 8, 12),
    "HM350X250": (350, 250, 9, 14),
    "HM400X300": (400, 300, 10, 16),
    "HM450X300": (450, 300, 11, 18),
    "HM500X300": (500, 300, 11, 15),
    "HM600X300": (600, 300, 12, 17),
}


def _build_shape_val(sec: dict, kind: int) -> tuple[int, str, str]:
    """Return (kind, ShapeVal, name) for a V2 section dict.

    Priority:
      1. standard_steel_name -> lookup in _H_SECTION_DIMS for exact geometry,
         fallback to kind=26 library name
      2. properties with detailed geometry -> build ShapeVal per kind
      3. top-level width/height -> rectangular fallback (kind=1)

    ShapeVal formats (YJK 8.0, verified from SDK examples):
      kind=1  矩形:     "B,H"
      kind=2  工字形:    "tw,H,B,tf1,B2,tf2"
      kind=3  圆形:     "D"
      kind=7  箱型:     "B,H,U,T,D,F" (等厚时 "B,H,t,t,t,t")
      kind=8  圆管:     "D,d" (外径,内径)
      kind=26 型钢库:   ShapeVal="", name=规格名
    """
    import re

    props = sec.get("properties", {})
    extra = sec.get("extra", {})

    std_name = (
        sec.get("standard_steel_name")       # V2 canonical top-level field
        or props.get("standard_steel_name")  # legacy: written into properties
        or extra.get("standard_steel_name")  # extra dict fallback
        or ""
    )

    if std_name:
        normalized_name = std_name.upper().replace("\u00d7", "X").replace("x", "X")
        # Try exact lookup first
        dims = _H_SECTION_DIMS.get(normalized_name)
        if dims:
            H, B, tw, tf = dims
            return 2, f"{tw},{H},{B},{tf},{B},{tf}", ""

        # Try regex parse for names not in the table
        hw_match = re.match(r"^(HW|HN|HM|HP|HT)(\d+)[Xx\u00d7](\d+)", std_name, re.IGNORECASE)
        if hw_match:
            prefix = hw_match.group(1).upper()
            H = int(hw_match.group(2))
            B = int(hw_match.group(3))
            if prefix == "HW":
                tw = max(8, H // 30)
                tf = max(12, H // 20)
            elif prefix == "HN":
                tw = max(6, H // 40)
                tf = max(9, H // 30)
            else:
                tw = max(7, H // 35)
                tf = max(11, H // 25)
            return 2, f"{tw},{H},{B},{tf},{B},{tf}", ""

        # Unrecognized standard name -> try kind=26 library lookup
        return 26, "", str(std_name)

    # PKPM-style shape dict
    shape = props.get("shape") or sec.get("shape")
    if isinstance(shape, dict):
        sk = shape.get("kind", "")
        if sk in ("H", "I") or kind == 2:
            tw = shape.get("tw", 10)
            H = shape.get("H", sec.get("height", 400))
            B1 = shape.get("B1", shape.get("B", sec.get("width", 200)))
            tf1 = shape.get("tf1", shape.get("tf", 14))
            B2 = shape.get("B2", B1)
            tf2 = shape.get("tf2", tf1)
            return 2, f"{int(tw)},{int(H)},{int(B1)},{int(tf1)},{int(B2)},{int(tf2)}", ""
        if sk == "Box" or kind == 7:
            # kind=7 箱型: ShapeVal "B,H,U,T,D,F" (等厚时后四项相同)
            H = shape.get("H", sec.get("height", 400))
            B = shape.get("B", sec.get("width", 400))
            t = shape.get("T", shape.get("t", 20))
            U = shape.get("U", t)
            T_val = shape.get("T_bottom", t)
            D = shape.get("D", t)
            F = shape.get("F", t)
            return 7, f"{int(B)},{int(H)},{int(U)},{int(T_val)},{int(D)},{int(F)}", ""
        if sk == "Tube" or kind == 8:
            D = shape.get("D", 200)
            d = shape.get("d", D - 20)
            return 8, f"{int(D)},{int(d)}", ""

    # --- Build ShapeVal from properties by kind ---
    if kind == 2:
        tw = props.get("tw", 10)
        H = props.get("H", sec.get("height", 400))
        B1 = props.get("B1", props.get("B", sec.get("width", 200)))
        tf1 = props.get("tf1", props.get("tf", 14))
        B2 = props.get("B2", B1)
        tf2 = props.get("tf2", tf1)
        return 2, f"{int(tw)},{int(H)},{int(B1)},{int(tf1)},{int(B2)},{int(tf2)}", ""

    if kind == 7:
        # 箱型: "B,H,U,T,D,F"
        H = props.get("H", sec.get("height", 400))
        B = props.get("B", sec.get("width", 400))
        t = props.get("t", props.get("T", 20))
        return 7, f"{int(B)},{int(H)},{int(t)},{int(t)},{int(t)},{int(t)}", ""

    if kind == 8:
        D = props.get("D", sec.get("diameter", 200))
        d = props.get("d", D - 20 if D else 180)
        return 8, f"{int(D)},{int(d)}", ""

    if kind == 3:
        D = sec.get("diameter") or props.get("D", 400)
        return 3, f"{int(D)}", ""

    # Fallback: rectangular (kind=1) "B,H"
    w = sec.get("width") or props.get("B", 400)
    h = sec.get("height") or props.get("H", 600)
    return 1, f"{int(w)},{int(h)}", sec.get("name", "")


def _extract_grid_spans(nodes: list[dict]) -> tuple[list[int], list[int]]:
    """Derive axis-grid span arrays from V2 node coordinates (meters -> mm)."""
    sorted_x, sorted_y = _extract_grid_axes(nodes)

    xspans = [int(sorted_x[0])]
    for i in range(1, len(sorted_x)):
        xspans.append(int(round(sorted_x[i] - sorted_x[i - 1])))

    yspans = [int(sorted_y[0])]
    for i in range(1, len(sorted_y)):
        yspans.append(int(round(sorted_y[i] - sorted_y[i - 1])))

    return xspans, yspans


def _extract_grid_axes(nodes: list[dict]) -> tuple[list[int], list[int]]:
    """Derive sorted YJK grid axes in mm from V2 node coordinates."""
    xs: set[float] = set()
    ys: set[float] = set()
    for n in nodes:
        xs.add(round(float(n["x"]) * M_TO_MM, 1))
        ys.add(round(float(n["y"]) * M_TO_MM, 1))

    sorted_x = sorted(xs)
    sorted_y = sorted(ys)

    if len(sorted_x) < 2 or len(sorted_y) < 2:
        # 2D frame models may have only 1 unique coordinate on one axis
        # after V1→V2 remap (XZ plane → Y=0, YZ plane → X=0).
        # Synthesize a nominal span so YJK can proceed.
        if len(sorted_x) >= 2 and len(sorted_y) < 2:
            nominal_y = sorted_y[0] if sorted_y else 0
            sorted_y = [nominal_y, nominal_y + 1000]
        elif len(sorted_y) >= 2 and len(sorted_x) < 2:
            nominal_x = sorted_x[0] if sorted_x else 0
            sorted_x = [nominal_x, nominal_x + 1000]
        else:
            raise ValueError(
                f"Need at least 2 unique coordinates in at least one plan direction (X or Y) "
                f"to form a grid. Got {len(sorted_x)} X and {len(sorted_y)} Y."
            )

    return [int(round(x)) for x in sorted_x], [int(round(y)) for y in sorted_y]


def _json_safe(value: Any) -> Any:
    """Convert YJKAPI return values to JSON-safe diagnostics."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    return repr(value)


def _extract_yjk_id(value: Any) -> Any | None:
    """Best-effort extraction of an object id from a YJKAPI return value."""
    if value is None:
        return None
    if isinstance(value, (str, int)):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, dict):
        for key in ("id", "Id", "ID", "node_id", "NodeID", "model_id", "ModelID"):
            if key in value:
                return _extract_yjk_id(value[key])
        return None

    for attr in ("id", "Id", "ID", "node_id", "NodeID", "model_id", "ModelID", "m_id", "m_ID"):
        try:
            attr_value = getattr(value, attr)
        except Exception:
            continue
        extracted = _extract_yjk_id(attr_value)
        if extracted is not None:
            return extracted

    for method in ("GetID", "GetId", "get_id"):
        try:
            method_value = getattr(value, method)
        except Exception:
            continue
        if not callable(method_value):
            continue
        try:
            extracted = _extract_yjk_id(method_value())
        except Exception:
            continue
        if extracted is not None:
            return extracted

    return None


def _flatten_yjk_ids(value: Any) -> list[Any]:
    """Flatten a YJKAPI scalar or nested sequence into extracted ids."""
    if isinstance(value, dict):
        ids: list[Any] = []
        for key, item in value.items():
            if key in ("id", "Id", "ID", "node_id", "NodeID", "model_id", "ModelID"):
                continue
            if isinstance(item, (dict, list, tuple)):
                ids.extend(_flatten_yjk_ids(item))
        if ids:
            return ids
        extracted = _extract_yjk_id(value)
        if extracted is not None:
            return [extracted]
        return ids
    extracted = _extract_yjk_id(value)
    if extracted is not None:
        return [extracted]
    if isinstance(value, (list, tuple)):
        ids = []
        for item in value:
            ids.extend(_flatten_yjk_ids(item))
        return ids
    return []


def _plan_key(x_mm: int, y_mm: int) -> str:
    return f"{x_mm},{y_mm}"


def _segment_key(direction: str, a_mm: int, b_mm: int, fixed_mm: int) -> str:
    lo = min(a_mm, b_mm)
    hi = max(a_mm, b_mm)
    return f"{direction}:{lo}-{hi}@{fixed_mm}"


def _map_ids_to_grid_points(value: Any, x_axis: list[int], y_axis: list[int]) -> tuple[dict[str, Any], str | None]:
    """Map a nested/flat YJK id result to plan grid points when dimensions match."""
    nx = len(x_axis)
    ny = len(y_axis)
    if isinstance(value, (list, tuple)):
        rows = [row for row in value if isinstance(row, (list, tuple))]
        if len(rows) == ny and all(len(_flatten_yjk_ids(row)) == nx for row in rows):
            mapping: dict[str, Any] = {}
            for y_idx, row in enumerate(rows):
                for x_idx, yjk_id in enumerate(_flatten_yjk_ids(row)):
                    mapping[_plan_key(x_axis[x_idx], y_axis[y_idx])] = yjk_id
            return mapping, "nested_yx"
        if len(rows) == nx and all(len(_flatten_yjk_ids(row)) == ny for row in rows):
            mapping = {}
            for x_idx, row in enumerate(rows):
                for y_idx, yjk_id in enumerate(_flatten_yjk_ids(row)):
                    mapping[_plan_key(x_axis[x_idx], y_axis[y_idx])] = yjk_id
            return mapping, "nested_xy"

    flat_ids = _flatten_yjk_ids(value)
    if len(flat_ids) == nx * ny:
        mapping = {}
        i = 0
        for y_mm in y_axis:
            for x_mm in x_axis:
                mapping[_plan_key(x_mm, y_mm)] = flat_ids[i]
                i += 1
        return mapping, "flat_yx"

    return {}, None


def _map_ids_to_x_segments(value: Any, x_axis: list[int], y_axis: list[int]) -> tuple[dict[str, Any], str | None]:
    """Map YJK beam ids to X-direction grid segments when dimensions match."""
    expected = max(len(x_axis) - 1, 0) * len(y_axis)
    if expected <= 0:
        return {}, None

    if isinstance(value, (list, tuple)):
        rows = [row for row in value if isinstance(row, (list, tuple))]
        if len(rows) == len(y_axis) and all(len(_flatten_yjk_ids(row)) == len(x_axis) - 1 for row in rows):
            mapping: dict[str, Any] = {}
            for y_idx, row in enumerate(rows):
                ids = _flatten_yjk_ids(row)
                for x_idx, yjk_id in enumerate(ids):
                    key = _segment_key("x", x_axis[x_idx], x_axis[x_idx + 1], y_axis[y_idx])
                    mapping[key] = yjk_id
            return mapping, "nested_yx_segments"

    flat_ids = _flatten_yjk_ids(value)
    if len(flat_ids) == expected:
        mapping = {}
        i = 0
        for y_mm in y_axis:
            for x_idx in range(len(x_axis) - 1):
                key = _segment_key("x", x_axis[x_idx], x_axis[x_idx + 1], y_mm)
                mapping[key] = flat_ids[i]
                i += 1
        return mapping, "flat_yx_segments"

    return {}, None


def _map_ids_to_y_segments(value: Any, x_axis: list[int], y_axis: list[int]) -> tuple[dict[str, Any], str | None]:
    """Map YJK beam ids to Y-direction grid segments when dimensions match."""
    expected = len(x_axis) * max(len(y_axis) - 1, 0)
    if expected <= 0:
        return {}, None

    if isinstance(value, (list, tuple)):
        rows = [row for row in value if isinstance(row, (list, tuple))]
        if len(rows) == len(x_axis) and all(len(_flatten_yjk_ids(row)) == len(y_axis) - 1 for row in rows):
            mapping: dict[str, Any] = {}
            for x_idx, row in enumerate(rows):
                ids = _flatten_yjk_ids(row)
                for y_idx, yjk_id in enumerate(ids):
                    key = _segment_key("y", y_axis[y_idx], y_axis[y_idx + 1], x_axis[x_idx])
                    mapping[key] = yjk_id
            return mapping, "nested_xy_segments"

    flat_ids = _flatten_yjk_ids(value)
    if len(flat_ids) == expected:
        mapping = {}
        i = 0
        for x_mm in x_axis:
            for y_idx in range(len(y_axis) - 1):
                key = _segment_key("y", y_axis[y_idx], y_axis[y_idx + 1], x_mm)
                mapping[key] = flat_ids[i]
                i += 1
        return mapping, "flat_xy_segments"

    return {}, None


def _build_story_infos(stories: list[dict]) -> list[dict[str, Any]]:
    """Normalize story ids/elevations for mapping output."""
    infos: list[dict[str, Any]] = []
    cumulative_elevation = 0.0
    for index, story in enumerate(stories, start=1):
        raw_elevation = story.get("elevation")
        elevation = float(raw_elevation) if raw_elevation is not None else cumulative_elevation
        height = float(story.get("height", 0))
        top_elevation = elevation + height
        story_id = str(story.get("id") or f"F{index}")
        infos.append({
            "id": story_id,
            "index": index,
            "height_m": height,
            "elevation_m": elevation,
            "top_elevation_m": top_elevation,
            "height_mm": int(round(height * M_TO_MM)),
            "elevation_mm": int(round(elevation * M_TO_MM)),
            "top_elevation_mm": int(round(top_elevation * M_TO_MM)),
        })
        cumulative_elevation = top_elevation
    return infos


def _story_info_by_id(story_infos: list[dict[str, Any]], story_id: Any) -> dict[str, Any] | None:
    if story_id is None:
        return None
    story_id_str = str(story_id)
    for info in story_infos:
        if info["id"] == story_id_str:
            return info
    return None


def _story_info_for_level(story_infos: list[dict[str, Any]], z_m: float) -> tuple[dict[str, Any], str]:
    """Infer the floor for a node level, preferring exact story elevations."""
    eps = 1e-6
    for info in story_infos:
        if abs(float(info["elevation_m"]) - z_m) <= eps:
            return info, "z_matches_story_elevation"

    for info in story_infos:
        if float(info["elevation_m"]) <= z_m < float(info["top_elevation_m"]):
            return info, "z_within_story"

    for info in reversed(story_infos):
        if abs(float(info["top_elevation_m"]) - z_m) <= eps:
            return info, "z_matches_story_top"

    nearest = min(story_infos, key=lambda info: abs(float(info["elevation_m"]) - z_m))
    return nearest, "nearest_story_elevation"


def _story_info_for_interval_base(story_infos: list[dict[str, Any]], z_m: float) -> tuple[dict[str, Any], str]:
    """Infer the floor for vertical/diagonal members from their lower endpoint."""
    eps = 1e-6
    for info in story_infos:
        if float(info["elevation_m"]) - eps <= z_m < float(info["top_elevation_m"]) - eps:
            return info, "lower_node_within_story"

    return _story_info_for_level(story_infos, z_m)


def _infer_node_floor(node: dict, story_infos: list[dict[str, Any]]) -> dict[str, Any]:
    explicit_story = node.get("story")
    explicit_info = _story_info_by_id(story_infos, explicit_story)
    z_m = float(node.get("z", 0))
    if explicit_info:
        info = explicit_info
        source = "node.story"
    else:
        info, source = _story_info_for_level(story_infos, z_m)
        if explicit_story:
            source = f"{source}; node.story_unmatched={explicit_story}"

    return {
        "floor": info["id"],
        "floor_index": info["index"],
        "floor_elevation_m": info["elevation_m"],
        "floor_source": source,
    }


def _classify_element_geometry(elem: dict, nodes_by_id: dict[str, dict]) -> str:
    node_ids = elem.get("nodes", [])
    if len(node_ids) < 2:
        return "unknown"
    n1 = nodes_by_id.get(str(node_ids[0]))
    n2 = nodes_by_id.get(str(node_ids[1]))
    if not n1 or not n2:
        return "unknown"

    x1 = int(round(float(n1.get("x", 0)) * M_TO_MM))
    y1 = int(round(float(n1.get("y", 0)) * M_TO_MM))
    z1 = int(round(float(n1.get("z", 0)) * M_TO_MM))
    x2 = int(round(float(n2.get("x", 0)) * M_TO_MM))
    y2 = int(round(float(n2.get("y", 0)) * M_TO_MM))
    z2 = int(round(float(n2.get("z", 0)) * M_TO_MM))

    if x1 == x2 and y1 == y2 and z1 != z2:
        return "vertical"
    if z1 == z2 and y1 == y2 and x1 != x2:
        return "horizontal_x"
    if z1 == z2 and x1 == x2 and y1 != y2:
        return "horizontal_y"
    if z1 != z2:
        return "diagonal_3d"
    return "plan_diagonal"


def _infer_element_floor(
    elem: dict,
    nodes_by_id: dict[str, dict],
    node_mappings: dict[str, dict[str, Any]],
    story_infos: list[dict[str, Any]],
    geometry_role: str,
) -> dict[str, Any]:
    explicit_story = elem.get("story")
    explicit_info = _story_info_by_id(story_infos, explicit_story)
    if explicit_info:
        return {
            "floor": explicit_info["id"],
            "floor_index": explicit_info["index"],
            "floor_source": "element.story",
        }

    node_ids = [str(node_id) for node_id in elem.get("nodes", [])]
    node_entries = [node_mappings[node_id] for node_id in node_ids if node_id in node_mappings]
    same_node_floor = node_entries and len({entry.get("floor") for entry in node_entries}) == 1
    if geometry_role in ("horizontal_x", "horizontal_y", "plan_diagonal") and same_node_floor:
        entry = node_entries[0]
        source = "member_nodes_same_floor"
        if explicit_story:
            source = f"{source}; element.story_unmatched={explicit_story}"
        return {
            "floor": entry.get("floor"),
            "floor_index": entry.get("floor_index"),
            "floor_source": source,
        }

    z_values = [
        float(nodes_by_id[node_id].get("z", 0))
        for node_id in node_ids
        if node_id in nodes_by_id
    ]
    if z_values:
        info, source = _story_info_for_interval_base(story_infos, min(z_values))
        if explicit_story:
            source = f"{source}; element.story_unmatched={explicit_story}"
        return {
            "floor": info["id"],
            "floor_index": info["index"],
            "floor_source": source,
        }

    first_story = story_infos[0]
    return {
        "floor": first_story["id"],
        "floor_index": first_story["index"],
        "floor_source": "default_first_story",
    }


def _section_summary(section: dict | None) -> dict[str, Any] | None:
    if not section:
        return None
    return {
        "id": section.get("id"),
        "name": section.get("name"),
        "type": section.get("type"),
        "purpose": section.get("purpose"),
        "standard_steel_name": section.get("standard_steel_name"),
        "shape": _json_safe(section.get("shape")),
        "properties": _json_safe(section.get("properties", {})),
    }


def _material_summary(material: dict | None) -> dict[str, Any] | None:
    if not material:
        return None
    return {
        "id": material.get("id"),
        "name": material.get("name"),
        "category": material.get("category"),
        "grade": material.get("grade"),
        "fy": material.get("fy"),
    }


def _build_mapping(
    data: dict[str, Any],
    stories: list[dict],
    story_infos: list[dict[str, Any]],
    x_axis_mm: list[int],
    y_axis_mm: list[int],
    xspans: list[int],
    yspans: list[int],
    std_flr: Any,
    nodelist: Any,
    col_result: Any,
    beam_x_result: Any,
    beam_y_result: Any,
    section_defs: dict[str, dict[str, Any]],
    ydb_path: str,
    warnings: list[str],
) -> dict[str, Any]:
    """Build StructureClaw V2 -> YJK best-effort mapping metadata."""
    nodes = data.get("nodes", [])
    elements = data.get("elements", [])
    nodes_by_id = {str(node.get("id")): node for node in nodes}
    sections_by_id = {str(section.get("id")): section for section in data.get("sections", [])}
    materials_by_id = {str(material.get("id")): material for material in data.get("materials", [])}

    std_node_ids, std_node_id_source = _map_ids_to_grid_points(nodelist, x_axis_mm, y_axis_mm)
    column_ids, column_id_source = _map_ids_to_grid_points(col_result, x_axis_mm, y_axis_mm)
    beam_x_ids, beam_x_id_source = _map_ids_to_x_segments(beam_x_result, x_axis_mm, y_axis_mm)
    beam_y_ids, beam_y_id_source = _map_ids_to_y_segments(beam_y_result, x_axis_mm, y_axis_mm)

    x_axis_index = {coord_mm: index for index, coord_mm in enumerate(x_axis_mm)}
    y_axis_index = {coord_mm: index for index, coord_mm in enumerate(y_axis_mm)}

    node_mappings: dict[str, dict[str, Any]] = {}
    for node in nodes:
        node_id = str(node.get("id"))
        x_mm = int(round(float(node.get("x", 0)) * M_TO_MM))
        y_mm = int(round(float(node.get("y", 0)) * M_TO_MM))
        z_mm = int(round(float(node.get("z", 0)) * M_TO_MM))
        floor_info = _infer_node_floor(node, story_infos)
        plan_key = _plan_key(x_mm, y_mm)
        node_mappings[node_id] = {
            "v2_id": node_id,
            "x_m": float(node.get("x", 0)),
            "y_m": float(node.get("y", 0)),
            "z_m": float(node.get("z", 0)),
            "x_mm": x_mm,
            "y_mm": y_mm,
            "z_mm": z_mm,
            "plan_key": plan_key,
            "grid_index": {
                "x": x_axis_index.get(x_mm),
                "y": y_axis_index.get(y_mm),
            },
            "floor": floor_info["floor"],
            "floor_index": floor_info["floor_index"],
            "floor_elevation_m": floor_info["floor_elevation_m"],
            "floor_source": floor_info["floor_source"],
            "yjk_std_floor_node_id": std_node_ids.get(plan_key),
            "yjk_std_floor_node_id_source": std_node_id_source,
        }

    element_mappings: dict[str, dict[str, Any]] = {}
    sequence_by_floor_type: dict[tuple[str, str], int] = {}
    for elem in elements:
        elem_id = str(elem.get("id"))
        elem_type = str(elem.get("type", "beam"))
        geometry_role = _classify_element_geometry(elem, nodes_by_id)
        floor_info = _infer_element_floor(elem, nodes_by_id, node_mappings, story_infos, geometry_role)
        floor = str(floor_info["floor"])
        sequence_key = (floor, elem_type)
        sequence_by_floor_type[sequence_key] = sequence_by_floor_type.get(sequence_key, 0) + 1
        sequence = sequence_by_floor_type[sequence_key]

        node_ids = [str(node_id) for node_id in elem.get("nodes", [])]
        section_id = str(elem.get("section", ""))
        material_id = str(elem.get("material", ""))
        section_def = section_defs.get(section_id, {})

        yjk_model_id = None
        yjk_model_id_source = None
        segment_match_key = None

        if len(node_ids) >= 2 and node_ids[0] in node_mappings and node_ids[1] in node_mappings:
            n1 = node_mappings[node_ids[0]]
            n2 = node_mappings[node_ids[1]]
            if elem_type == "column" or geometry_role == "vertical":
                yjk_model_id = column_ids.get(n1["plan_key"])
                yjk_model_id_source = column_id_source
            elif elem_type == "beam" and geometry_role == "horizontal_x":
                segment_match_key = _segment_key("x", n1["x_mm"], n2["x_mm"], n1["y_mm"])
                yjk_model_id = beam_x_ids.get(segment_match_key)
                yjk_model_id_source = beam_x_id_source
            elif elem_type == "beam" and geometry_role == "horizontal_y":
                segment_match_key = _segment_key("y", n1["y_mm"], n2["y_mm"], n1["x_mm"])
                yjk_model_id = beam_y_ids.get(segment_match_key)
                yjk_model_id_source = beam_y_id_source

        element_mappings[elem_id] = {
            "v2_id": elem_id,
            "type": elem_type,
            "geometry_role": geometry_role,
            "floor": floor,
            "floor_index": floor_info["floor_index"],
            "floor_source": floor_info["floor_source"],
            "nodes": node_ids,
            "section": _section_summary(sections_by_id.get(section_id)),
            "material": _material_summary(materials_by_id.get(material_id)),
            "section_id": section_id,
            "material_id": material_id,
            "yjk_section_id": section_def.get("yjk_section_id"),
            "yjk_section_ref": section_def.get("yjk_section_ref"),
            "yjk_model_id": yjk_model_id,
            "yjk_model_id_source": yjk_model_id_source if yjk_model_id is not None else None,
            "fallback_match": {
                "floor": floor,
                "floor_index": floor_info["floor_index"],
                "type": elem_type,
                "geometry_role": geometry_role,
                "sequence_in_floor_type": sequence,
                "node_plan_keys": [
                    node_mappings[node_id]["plan_key"]
                    for node_id in node_ids
                    if node_id in node_mappings
                ],
                "node_pair": node_ids[:2],
                "segment_key": segment_match_key,
                "section_id": section_id,
                "material_id": material_id,
            },
        }

    return {
        "schema_version": "1.0.0",
        "engine": "yjk-static",
        "ydb_path": ydb_path,
        "source": {
            "schema_version": data.get("schema_version"),
            "node_count": len(nodes),
            "element_count": len(elements),
            "story_count": len(stories),
        },
        "grid": {
            "x_axis_mm": x_axis_mm,
            "y_axis_mm": y_axis_mm,
            "xspans_mm": xspans,
            "yspans_mm": yspans,
        },
        "stories": story_infos,
        "standard_floor": {
            "yjk_std_floor_ref": _json_safe(std_flr),
            "node_id_source": std_node_id_source,
        },
        "nodes": node_mappings,
        "elements": element_mappings,
        "sections": section_defs,
        "arrange_results": {
            "column_arrange": {
                "raw": _json_safe(col_result),
                "id_source": column_id_source,
                "mapped_ids": column_ids,
            },
            "beam_arrange_x": {
                "raw": _json_safe(beam_x_result),
                "id_source": beam_x_id_source,
                "mapped_ids": beam_x_ids,
            },
            "beam_arrange_y": {
                "raw": _json_safe(beam_y_result),
                "id_source": beam_y_id_source,
                "mapped_ids": beam_y_ids,
            },
        },
        "warnings": warnings,
    }


def convert_v2_to_ydb(
    data: dict[str, Any],
    work_dir: str,
    ydb_filename: str = "model.ydb",
) -> str:
    """Convert a V2 StructureModelV2 JSON dict to a YJK .ydb file.

    Returns the absolute path to the generated .ydb.
    """
    import sys
    def _log(msg: str) -> None:
        print(f"[yjk_converter] {msg}", file=sys.stderr, flush=True)

    os.makedirs(work_dir, exist_ok=True)
    warnings: list[str] = []

    stories = sorted(
        data.get("stories", []),
        key=lambda s: float(s.get("elevation") if s.get("elevation") is not None else 0),
    )
    if not stories:
        raise ValueError("V2 model has no stories defined")
    story_infos = _build_story_infos(stories)

    first_story = stories[0]
    height_mm = int(round(float(first_story["height"]) * M_TO_MM))
    dead, live = _get_floor_loads(first_story)
    _log(f"Story height: {height_mm}mm, dead={dead}, live={live}")

    data_func = DataFunc()
    std_flr = data_func.StdFlr_Generate(height_mm, dead, live)
    _log(f"StdFlr_Generate returned: {std_flr}")

    section_roles = _infer_section_roles(data)
    _log(f"Section roles: {section_roles}")

    col_defs: dict[str, Any] = {}
    beam_defs: dict[str, Any] = {}
    section_defs: dict[str, dict[str, Any]] = {}

    for sec in data.get("sections", []):
        sec_id = sec["id"]
        role = section_roles.get(sec_id, "beam")

        sec_type_str = sec.get("type", "rectangular")
        kind = _TYPE_TO_KIND.get(sec_type_str, 1)
        mat = _resolve_mat_type(sec, data)

        kind, shape_val, name = _build_shape_val(sec, kind)
        _log(f"Section '{sec_id}' ({role}): mat={mat}, kind={kind}, shape_val='{shape_val}', name='{name}'")
        section_defs[sec_id] = {
            "id": sec_id,
            "role": role,
            "type": sec_type_str,
            "yjk_mat_type": mat,
            "yjk_kind": kind,
            "shape_val": shape_val,
            "name": name,
            "yjk_section_id": None,
            "yjk_section_ref": None,
        }

        try:
            if role == "column":
                result = data_func.ColSect_Def(mat, kind, shape_val, name)
                col_defs[sec_id] = result
                _log(f"  ColSect_Def returned: {result}")
            else:
                result = data_func.BeamSect_Def(mat, kind, shape_val, name)
                beam_defs[sec_id] = result
                _log(f"  BeamSect_Def returned: {result}")
            section_defs[sec_id]["yjk_section_id"] = _extract_yjk_id(result)
            section_defs[sec_id]["yjk_section_ref"] = _json_safe(result)
        except Exception as exc:
            _log(f"  ERROR: Section '{sec_id}' definition failed: {exc}")
            warnings.append(f"Section '{sec_id}' definition failed: {exc}")
            section_defs[sec_id]["error"] = str(exc)

    if not col_defs:
        _log("WARNING: No column sections defined; using fallback")
        # mat=5 (steel), kind=2 (H-section), ShapeVal: tw=20,H=650,B=400,tf1=28,B2=400,tf2=28
        col_defs["_fallback_col"] = data_func.ColSect_Def(5, 2, "20,650,400,28,400,28", "Fallback Column")
        section_defs["_fallback_col"] = {
            "id": "_fallback_col",
            "role": "column",
            "type": "H",
            "yjk_mat_type": 5,
            "yjk_kind": 2,
            "shape_val": "20,650,400,28,400,28",
            "name": "Fallback Column",
            "yjk_section_id": _extract_yjk_id(col_defs["_fallback_col"]),
            "yjk_section_ref": _json_safe(col_defs["_fallback_col"]),
        }
        warnings.append("No column sections defined; using default steel I-section")
    if not beam_defs:
        _log("WARNING: No beam sections defined; using fallback")
        # mat=5 (steel), kind=2 (H-section), ShapeVal: tw=18,H=900,B=300,tf1=26,B2=300,tf2=26
        beam_defs["_fallback_beam"] = data_func.BeamSect_Def(5, 2, "18,900,300,26,300,26", "Fallback Beam")
        section_defs["_fallback_beam"] = {
            "id": "_fallback_beam",
            "role": "beam",
            "type": "H",
            "yjk_mat_type": 5,
            "yjk_kind": 2,
            "shape_val": "18,900,300,26,300,26",
            "name": "Fallback Beam",
            "yjk_section_id": _extract_yjk_id(beam_defs["_fallback_beam"]),
            "yjk_section_ref": _json_safe(beam_defs["_fallback_beam"]),
        }
        warnings.append("No beam sections defined; using default steel I-section")

    nodes = data.get("nodes", [])
    if not nodes:
        raise ValueError("V2 model has no nodes")

    x_axis_mm, y_axis_mm = _extract_grid_axes(nodes)
    xspans, yspans = _extract_grid_spans(nodes)
    _log(f"Grid spans: xspans={xspans}, yspans={yspans}")

    nodelist = data_func.node_generate(xspans, yspans, std_flr)
    _log(f"node_generate returned: {nodelist} (type: {type(nodelist)})")

    first_col = next(iter(col_defs.values()))
    _log(f"Arranging columns with section: {first_col}")
    # NOTE: YJK DataFunc.column_arrange / beam_arrange applies one section to all
    # members in the grid at once.  Per-element section assignment is not supported
    # by this API level; the first defined section is used as the representative
    # section for the whole building.  Models with multiple distinct sections will
    # have their primary section applied uniformly here.
    try:
        col_result = data_func.column_arrange(nodelist, first_col)
        _log(f"column_arrange returned: {col_result}")
    except Exception as exc:
        _log(f"ERROR: column_arrange failed: {exc}")
        raise

    first_beam = next(iter(beam_defs.values()))
    _log(f"Arranging beams with section: {first_beam}")
    # Same API constraint as columns above — one section per grid arrangement call.
    try:
        grid_x = data_func.grid_generate(nodelist, 0, 1)
        _log(f"grid_generate(0,1) returned: {grid_x}")
        grid_y = data_func.grid_generate(nodelist, 1, 0)
        _log(f"grid_generate(1,0) returned: {grid_y}")
        beam_x_result = data_func.beam_arrange(grid_x, first_beam)
        _log(f"beam_arrange(grid_x) returned: {beam_x_result}")
        beam_y_result = data_func.beam_arrange(grid_y, first_beam)
        _log(f"beam_arrange(grid_y) returned: {beam_y_result}")
    except Exception as exc:
        _log(f"ERROR: beam arrangement failed: {exc}")
        raise

    # Assemble floors story by story.
    #
    # Floors_Assemb signature: (H_start_mm, std_flr, num_floors, floor_height_mm)
    #   H_start_mm  — cumulative elevation (mm) where this batch of floors begins
    #   std_flr     — standard floor definition from StdFlr_Generate
    #   num_floors  — how many consecutive floors to create with this definition
    #   floor_height_mm — storey height for these floors (mm)
    #
    # Group consecutive stories that share the same height and loads so we can
    # batch them into a single Floors_Assemb call (matching the SDK pattern).
    # For varying heights we issue multiple calls with the correct H_start.
    cumulative_h = 0
    group_start = 0
    while group_start < len(stories):
        ref = stories[group_start]
        ref_h = int(round(float(ref.get("height", first_story["height"])) * M_TO_MM))
        if ref_h <= 0:
            ref_h = height_mm
        ref_dead, ref_live = _get_floor_loads(ref)

        # Count how many consecutive stories share the same height & loads
        group_count = 1
        for j in range(group_start + 1, len(stories)):
            s = stories[j]
            s_h = int(round(float(s.get("height", first_story["height"])) * M_TO_MM))
            if s_h <= 0:
                s_h = height_mm
            s_dead, s_live = _get_floor_loads(s)
            if s_h == ref_h and s_dead == ref_dead and s_live == ref_live:
                group_count += 1
            else:
                break

        s_flr = data_func.StdFlr_Generate(ref_h, ref_dead, ref_live) if (
            ref_h != height_mm or ref_dead != dead or ref_live != live
        ) else std_flr

        _log(f"Floors_Assemb(H_start={cumulative_h}, flr, count={group_count}, h={ref_h}) "
             f"[stories {group_start + 1}-{group_start + group_count}]")
        try:
            data_func.Floors_Assemb(cumulative_h, s_flr, group_count, ref_h)
        except Exception as exc:
            _log(f"ERROR: Floors_Assemb failed for stories {group_start + 1}-{group_start + group_count}: {exc}")
            raise

        cumulative_h += ref_h * group_count
        group_start += group_count

    _log("Floors_Assemb completed")

    _log("Assigning model to database...")
    try:
        data_func.DbModel_Assign()
        _log("DbModel_Assign completed")
    except Exception as exc:
        _log(f"ERROR: DbModel_Assign failed: {exc}")
        raise

    _log("Getting model data...")
    model = data_func.GetDbModelData()
    _log(f"GetDbModelData returned: {model}")

    _log(f"Creating YDB file: {ydb_filename}")
    reader = Hi_AddToAndReadYjk(model)
    reader.CreateYDB(work_dir, ydb_filename)

    ydb_path = os.path.join(work_dir, ydb_filename)
    _log(f"YDB file created: {ydb_path}")

    mapping = _build_mapping(
        data=data,
        stories=stories,
        story_infos=story_infos,
        x_axis_mm=x_axis_mm,
        y_axis_mm=y_axis_mm,
        xspans=xspans,
        yspans=yspans,
        std_flr=std_flr,
        nodelist=nodelist,
        col_result=col_result,
        beam_x_result=beam_x_result,
        beam_y_result=beam_y_result,
        section_defs=section_defs,
        ydb_path=ydb_path,
        warnings=warnings,
    )
    mapping_path = os.path.join(work_dir, "mapping.json")
    with open(mapping_path, "w", encoding="utf-8") as f:
        json.dump(mapping, f, ensure_ascii=False, indent=2, sort_keys=True)
    _log(f"Mapping file created: {mapping_path}")

    return ydb_path
