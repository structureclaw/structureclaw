from __future__ import annotations

from math import pi
from typing import Any, Dict, Iterable, Optional, Sequence, Tuple


def _positive(value: Any) -> Optional[float]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def _polygon_properties(points: Sequence[Tuple[float, float]]) -> Dict[str, float]:
    if len(points) < 3:
        raise ValueError("at least three points are required")

    twice_area = 0.0
    ix_origin = 0.0
    iy_origin = 0.0
    cx_factor = 0.0
    cy_factor = 0.0

    for index, current in enumerate(points):
        next_point = points[(index + 1) % len(points)]
        cross = current[0] * next_point[1] - next_point[0] * current[1]
        twice_area += cross
        ix_origin += (current[1] ** 2 + current[1] * next_point[1] + next_point[1] ** 2) * cross
        iy_origin += (current[0] ** 2 + current[0] * next_point[0] + next_point[0] ** 2) * cross
        cx_factor += (current[0] + next_point[0]) * cross
        cy_factor += (current[1] + next_point[1]) * cross

    area = twice_area / 2.0
    if abs(area) < 1e-9:
        raise ValueError("polygon outline is degenerate")

    centroid_x = cx_factor / (3.0 * twice_area)
    centroid_y = cy_factor / (3.0 * twice_area)
    return {
        "area_mm2": abs(area),
        "ix_mm4": abs(ix_origin / 12.0 - area * (centroid_y ** 2)),
        "iy_mm4": abs(iy_origin / 12.0 - area * (centroid_x ** 2)),
        "centroid_x_mm": centroid_x,
        "centroid_y_mm": centroid_y,
    }


def estimate_section_properties(section_type: str, geometry: Dict[str, Any], outline_points: Optional[Sequence[Tuple[float, float]]] = None) -> Dict[str, Any]:
    """Return a light-weight section summary for future runtime integration."""
    normalized = section_type.lower().strip()
    warnings = []

    if outline_points:
        try:
            properties = _polygon_properties(outline_points)
            properties["warnings"] = warnings
            return properties
        except ValueError as exc:
            warnings.append(str(exc))

    h = _positive(geometry.get("h"))
    b = _positive(geometry.get("b"))
    tw = _positive(geometry.get("tw") or geometry.get("t"))
    tf = _positive(geometry.get("tf") or geometry.get("t"))
    d = _positive(geometry.get("d"))

    if normalized in {"rectangle"} and h and b:
        return {
            "area_mm2": h * b,
            "ix_mm4": b * h ** 3 / 12.0,
            "iy_mm4": h * b ** 3 / 12.0,
            "warnings": warnings,
        }

    if normalized in {"box", "box-girder", "tapered-box"} and h and b and tw:
        inner_h = max(h - 2 * tw, 0.0)
        inner_b = max(b - 2 * tw, 0.0)
        return {
            "area_mm2": max(h * b - inner_h * inner_b, 0.0),
            "ix_mm4": max((b * h ** 3) - (inner_b * inner_h ** 3), 0.0) / 12.0,
            "iy_mm4": max((h * b ** 3) - (inner_h * inner_b ** 3), 0.0) / 12.0,
            "warnings": warnings,
        }

    if normalized in {"pipe"} and d and tw:
        inner_d = max(d - 2 * tw, 0.0)
        return {
            "area_mm2": (pi / 4.0) * (d ** 2 - inner_d ** 2),
            "ix_mm4": (pi / 64.0) * (d ** 4 - inner_d ** 4),
            "iy_mm4": (pi / 64.0) * (d ** 4 - inner_d ** 4),
            "warnings": warnings,
        }

    if h and b and tw and tf:
        web_height = max(h - 2 * tf, 0.0)
        area_mm2 = 2 * b * tf + web_height * tw
        ix_mm4 = 2 * ((b * tf ** 3) / 12.0 + b * tf * (max(h / 2.0 - tf / 2.0, 0.0) ** 2)) + (tw * web_height ** 3) / 12.0
        iy_mm4 = 2 * ((tf * b ** 3) / 12.0) + (web_height * tw ** 3) / 12.0
        warnings.append("Approximate I-section properties were used.")
        return {"area_mm2": area_mm2, "ix_mm4": ix_mm4, "iy_mm4": iy_mm4, "warnings": warnings}

    warnings.append("Insufficient geometry to estimate section properties.")
    return {"warnings": warnings}


def run_section_generation(section_type: str, geometry: Dict[str, Any], material: Dict[str, Any], outline_points: Optional[Iterable[Tuple[float, float]]] = None) -> Dict[str, Any]:
    """Compatibility entry point for the common section skill."""
    properties = estimate_section_properties(section_type, geometry, tuple(outline_points) if outline_points else None)
    return {
        "status": "success",
        "section_type": section_type,
        "geometry": geometry,
        "material": material,
        "properties": properties,
    }


if __name__ == "__main__":
    print(run_section_generation("h-beam", {"h": 450, "b": 200, "tw": 9, "tf": 16}, {"name": "Q355"}))