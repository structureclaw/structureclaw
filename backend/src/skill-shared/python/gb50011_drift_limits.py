from __future__ import annotations

from typing import Any, Dict, Optional


def _normalize_family(value: object) -> str:
    return str(value or "").strip().lower().replace("_", "-")


def gb50011_elastic_drift_limit_metadata(structural_family: object) -> Optional[Dict[str, Any]]:
    """Return GB/T 50011-2010(2024) 5.5.1 elastic story-drift limit metadata."""
    family = _normalize_family(structural_family)
    if not family:
        return None

    if "steel" in family:
        return {
            "limit": 1.0 / 250.0,
            "denominator": 250,
            "familyLabel": "steel structure",
        }

    if family in {"frame", "concrete-frame", "rc-frame", "reinforced-concrete-frame"}:
        return {
            "limit": 1.0 / 550.0,
            "denominator": 550,
            "familyLabel": "reinforced concrete frame",
        }

    if (
        "frame-shear-wall" in family
        or "frame-wall" in family
        or "frame-core" in family
        or "frame-tube" in family
        or "slab-column-shear-wall" in family
        or "plate-column-shear-wall" in family
    ):
        return {
            "limit": 1.0 / 800.0,
            "denominator": 800,
            "familyLabel": "frame-shear-wall / frame-core-tube family",
        }

    if (
        "shear-wall" in family
        or "seismic-wall" in family
        or "structural-wall" in family
        or "concrete-wall" in family
        or "tube-in-tube" in family
        or family in {"tube", "concrete-tube"}
        or "frame-supported" in family
        or "transfer" in family
    ):
        return {
            "limit": 1.0 / 1000.0,
            "denominator": 1000,
            "familyLabel": "shear-wall / tube-in-tube / transfer-level family",
        }

    if "concrete" in family and "frame" in family:
        return {
            "limit": 1.0 / 550.0,
            "denominator": 550,
            "familyLabel": "reinforced concrete frame",
        }

    return None


def gb50011_elastic_drift_limit(structural_family: object) -> Optional[float]:
    metadata = gb50011_elastic_drift_limit_metadata(structural_family)
    return None if metadata is None else float(metadata["limit"])


def gb50011_elastic_drift_limit_family_supported(structural_family: object) -> bool:
    return gb50011_elastic_drift_limit(structural_family) is not None


def gb50011_advisory_yield_drift_metadata(structural_family: object) -> Dict[str, Any]:
    metadata = gb50011_elastic_drift_limit_metadata(structural_family)
    if metadata is not None:
        return {
            **metadata,
            "source": "gb50011_elastic_story_drift_limit",
            "isFallback": False,
        }
    return {
        "limit": 1.0 / 550.0,
        "denominator": 550,
        "familyLabel": "reinforced concrete frame fallback",
        "source": "fallback_concrete_frame_elastic_story_drift_limit",
        "isFallback": True,
    }
