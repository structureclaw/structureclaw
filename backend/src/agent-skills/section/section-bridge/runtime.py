from __future__ import annotations

from typing import Any, Dict, Iterable, Optional, Sequence, Tuple


def _positive(value: Any) -> Optional[float]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def estimate_section_properties(section_type: str, geometry: Dict[str, Any], outline_points: Optional[Sequence[Tuple[float, float]]] = None) -> Dict[str, Any]:
    """Compatibility entry point for the bridge section skill."""
    if outline_points:
        return {
            "status": "success",
            "section_type": section_type,
            "geometry": geometry,
            "properties": {
                "warnings": ["Bridge outline-based evaluation is expected to be refined downstream."],
            },
        }

    h = _positive(geometry.get("h"))
    b = _positive(geometry.get("b"))
    tw = _positive(geometry.get("tw") or geometry.get("t"))
    tf = _positive(geometry.get("tf") or geometry.get("t"))

    warnings = []
    if not (h and b):
        warnings.append("Bridge section geometry is incomplete.")

    return {
        "status": "success",
        "section_type": section_type,
        "geometry": geometry,
        "properties": {
            "area_mm2": h * b if h and b else None,
            "warnings": warnings,
        },
    }


def run_section_generation(section_type: str, geometry: Dict[str, Any], material: Dict[str, Any], bridge_meta: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    return {
        "status": "success",
        "section_type": section_type,
        "geometry": geometry,
        "material": material,
        "bridge_meta": bridge_meta or {},
        "properties": estimate_section_properties(section_type, geometry).get("properties", {}),
    }


if __name__ == "__main__":
    print(run_section_generation("box-girder", {"h": 2200, "b": 1200, "t": 20}, {"name": "Q355"}, {"spanLengthM": 30}))
