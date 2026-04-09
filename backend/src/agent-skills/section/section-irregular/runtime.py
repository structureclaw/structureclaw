from __future__ import annotations

from typing import Any, Dict, Iterable, Optional, Sequence, Tuple


def _positive(value: Any) -> Optional[float]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def estimate_section_properties(section_type: str, geometry: Dict[str, Any], outline_points: Optional[Sequence[Tuple[float, float]]] = None) -> Dict[str, Any]:
    """Compatibility entry point for the irregular section skill."""
    warnings = []
    if outline_points and len(outline_points) >= 3:
        return {
            "status": "success",
            "section_type": section_type,
            "geometry": geometry,
            "properties": {
                "warnings": warnings,
                "outline_points": list(outline_points),
            },
        }

    if section_type.startswith("tapered"):
        h_start = _positive(geometry.get("hStart"))
        h_end = _positive(geometry.get("hEnd"))
        b_start = _positive(geometry.get("bStart"))
        b_end = _positive(geometry.get("bEnd"))
        if h_start and h_end and b_start and b_end:
            return {
                "status": "success",
                "section_type": section_type,
                "geometry": geometry,
                "properties": {
                    "average_depth_mm": (h_start + h_end) / 2.0,
                    "average_width_mm": (b_start + b_end) / 2.0,
                    "warnings": warnings,
                },
            }

    h = _positive(geometry.get("h"))
    b = _positive(geometry.get("b"))
    if h and b:
        return {
            "status": "success",
            "section_type": section_type,
            "geometry": geometry,
            "properties": {
                "area_mm2": h * b,
                "warnings": ["Irregular section properties are approximate and should be refined with the exact outline."],
            },
        }

    return {
        "status": "success",
        "section_type": section_type,
        "geometry": geometry,
        "properties": {
            "warnings": ["Insufficient geometry for a reliable irregular-section estimate."],
        },
    }


def run_section_generation(section_type: str, geometry: Dict[str, Any], material: Dict[str, Any], outline_points: Optional[Iterable[Tuple[float, float]]] = None) -> Dict[str, Any]:
    return {
        "status": "success",
        "section_type": section_type,
        "geometry": geometry,
        "material": material,
        "outline_points": list(outline_points) if outline_points else [],
        "properties": estimate_section_properties(section_type, geometry, tuple(outline_points) if outline_points else None).get("properties", {}),
    }


if __name__ == "__main__":
    print(run_section_generation("tapered-i", {"hStart": 1800, "hEnd": 1500, "bStart": 650, "bEnd": 500}, {"name": "Q355"}))
