"""PKPM APIPyInterface extractors — supplementary data from the PKPM Python SDK."""
from __future__ import annotations

import logging
from typing import Any, Dict, List

_logger = logging.getLogger(__name__)


# ── Helpers ──────────────────────────────────────────────────────────────


def _safe_call(obj: Any, method: str, default: Any = None, *args: Any) -> Any:
    try:
        return getattr(obj, method)(*args)
    except (AttributeError, TypeError, ValueError) as exc:
        _logger.debug("APIPyInterface.%s failed: %s", method, exc)
        return default


# ── APIPyInterface extractors (supplementary) ───────────────────────────


def _extract_modal(result: Any) -> List[Dict[str, Any]]:
    periods = _safe_call(result, "GetModePeriods", [])
    out: List[Dict[str, Any]] = []
    for p in periods:
        out.append({
            "index": _safe_call(p, "GetIndex", 0),
            "period_s": round(_safe_call(p, "GetCycle", 0.0), 4),
            "angle": round(_safe_call(p, "GetAngle", 0.0), 2),
            "damping_ratio": round(_safe_call(p, "GetDampingRatio", 0.0), 4),
            "torsion_ratio": round(_safe_call(p, "GetTorsi", 0.0), 4),
            "x_side": round(_safe_call(p, "GetxSide", 0.0), 4),
            "y_side": round(_safe_call(p, "GetySide", 0.0), 4),
        })
    return out


def _extract_story_stiffness(result: Any) -> List[Dict[str, Any]]:
    data = _safe_call(result, "GetStoreyStifs", [])
    out: List[Dict[str, Any]] = []
    for s in data:
        out.append({
            "floor_index": _safe_call(s, "Getfloorindex", 0),
            "tower_index": _safe_call(s, "GetTowerIndex", 0),
            "RJX": round(_safe_call(s, "GetRJX", 0.0), 2),
            "RJY": round(_safe_call(s, "GetRJY", 0.0), 2),
            "ratio_x": round(_safe_call(s, "GetRatx", 0.0), 4),
            "ratio_y": round(_safe_call(s, "GetRaty", 0.0), 4),
        })
    return out


def _extract_story_drift(result: Any) -> Dict[str, Any]:
    eq_drift = _safe_call(result, "GetStoryDrift_Earthquake", {})
    wind_drift = _safe_call(result, "GetStoryDrift_Wind", {})
    drift_limit = _safe_call(result, "GetAngStoryDriftConsVal", 0.0)

    def _drift_entries(data: Any) -> Dict[str, List[Dict[str, Any]]]:
        if not isinstance(data, dict):
            return {}
        out: Dict[str, List[Dict[str, Any]]] = {}
        for key, entries in data.items():
            items: List[Dict[str, Any]] = []
            for e in entries:
                items.append({
                    "floor": _safe_call(e, "Getifloor", 0),
                    "tower": _safe_call(e, "Getitower", 0),
                    "loadcase": _safe_call(e, "Getiloadcase", 0),
                    "max_drift": round(_safe_call(e, "GetmaxD", 0.0), 4),
                    "min_drift": round(_safe_call(e, "GetminD", 0.0), 4),
                    "drift_angle": round(_safe_call(e, "GetratioA", 0.0), 6),
                    "inter_max_angle": round(_safe_call(e, "GetinterMaxA", 0.0), 6),
                })
            out[key] = items
        return out

    return {
        "earthquake": _drift_entries(eq_drift),
        "wind": _drift_entries(wind_drift),
        "limit_value": round(drift_limit, 4) if drift_limit else None,
    }


def _extract_base_shear(result: Any) -> Dict[str, Any]:
    data = _safe_call(result, "GetBearingShear", [])
    limit_val = _safe_call(result, "GetRatShearWeightConsVal", 0.0)
    out: List[Dict[str, Any]] = []
    for s in data:
        out.append({
            "floor": _safe_call(s, "GetFloorNum", 0),
            "tower": _safe_call(s, "GetTowerNum", 0),
            "ratio_x": round(_safe_call(s, "GetRatx", 0.0), 4),
            "ratio_y": round(_safe_call(s, "GetRaty", 0.0), 4),
            "limit_value": round(_safe_call(s, "GetLimitVal", 0.0), 4),
        })
    return {"entries": out, "shear_weight_limit": round(limit_val, 4) if limit_val else None}


def _extract_story_mass(result: Any) -> List[Dict[str, Any]]:
    data = _safe_call(result, "GetStoreyUnitMass", [])
    out: List[Dict[str, Any]] = []
    for s in data:
        out.append({
            "floor_index": _safe_call(s, "Getfloorindex", 0),
            "tower_index": _safe_call(s, "GetTowerIndex", 0),
            "unit_mass": round(_safe_call(s, "GetUnitMass", 0.0), 2),
            "area": round(_safe_call(s, "GetArea", 0.0), 2),
            "mass_ratio": round(_safe_call(s, "GetMassRatio", 0.0), 4),
            "poid_x": round(_safe_call(s, "GetpoidX", 0.0), 2),
            "poid_y": round(_safe_call(s, "GetpoidY", 0.0), 2),
        })
    return out


def _extract_stiff_weight_ratio(result: Any) -> Dict[str, Any]:
    data = _safe_call(result, "GetStiffWeightRatioFrame", [])
    limit_val = _safe_call(result, "GetRigidWeightRatioConsVal", 0.0)
    out: List[Dict[str, Any]] = []
    for s in data:
        out.append({
            "floor": _safe_call(s, "Getifloor", 0),
            "tower": _safe_call(s, "Getitower", 0),
            "height": round(_safe_call(s, "GetHeight", 0.0), 2),
            "stiff_x": round(_safe_call(s, "GetStiffX", 0.0), 2),
            "stiff_y": round(_safe_call(s, "GetStiffY", 0.0), 2),
            "ratio_x": round(_safe_call(s, "GetStiffWeightRatioX", 0.0), 4),
            "ratio_y": round(_safe_call(s, "GetStiffWeightRatioY", 0.0), 4),
        })
    return {"entries": out, "limit_value": round(limit_val, 4) if limit_val else None}


def _extract_beam_design(result: Any) -> Dict[str, Any]:
    beams_by_floor: Dict[int, List[Dict[str, Any]]] = {}
    max_shear_comp = 0.0
    total_reinforce = 0.0
    max_floors = 500
    floor_idx = 1
    while floor_idx <= max_floors:
        beams = _safe_call(result, "GetDesignBeams", [], floor_idx)
        if not beams:
            break
        floor_beams: List[Dict[str, Any]] = []
        for b in beams:
            shear_ratio = _safe_call(b, "GetShearCompressionRatio", 0.0)
            max_shear_comp = max(max_shear_comp, shear_ratio)
            reinforce = _safe_call(b, "GetReinForceQuantity", 0.0)
            total_reinforce += reinforce
            floor_beams.append({
                "pmid": _safe_call(b, "GetPmid", 0),
                "shear_compression_ratio": round(shear_ratio, 4),
                "reinforce_quantity": round(reinforce, 2),
                "concrete_quantity": round(_safe_call(b, "GetConcreteQuantity", 0.0), 2),
                "steel_quantity": round(_safe_call(b, "GetSteelQuantity", 0.0), 2),
            })
        beams_by_floor[floor_idx] = floor_beams
        floor_idx += 1
    return {
        "floors": beams_by_floor,
        "total_beams": sum(len(v) for v in beams_by_floor.values()),
        "max_shear_compression_ratio": round(max_shear_comp, 4),
        "total_reinforce_quantity": round(total_reinforce, 2),
        "floors_analyzed": floor_idx - 1,
    }


def _extract_column_design(result: Any) -> Dict[str, Any]:
    columns_by_floor: Dict[int, List[Dict[str, Any]]] = {}
    max_axial = 0.0
    total_reinforce = 0.0
    max_floors = 500
    floor_idx = 1
    while floor_idx <= max_floors:
        columns = _safe_call(result, "GetDesignColumns", [], floor_idx)
        if not columns:
            break
        floor_columns: List[Dict[str, Any]] = []
        for c in columns:
            axial_ratios = _safe_call(c, "GetAxialCompresRatio", [0.0])
            axial_max = max(axial_ratios) if axial_ratios else 0.0
            max_axial = max(max_axial, axial_max)
            reinforce = _safe_call(c, "GetReinForceQuantity", 0.0)
            total_reinforce += reinforce
            floor_columns.append({
                "pmid": _safe_call(c, "GetPmid", 0),
                "element_id": _safe_call(c, "GetElementid", 0),
                "axial_compression_ratio": [round(v, 4) for v in axial_ratios],
                "max_axial_compression": round(axial_max, 4),
                "reinforce_quantity": round(reinforce, 2),
                "concrete_quantity": round(_safe_call(c, "GetConcreteQuantity", 0.0), 2),
                "steel_quantity": round(_safe_call(c, "GetSteelQuantity", 0.0), 2),
                "slender_ratio": [round(v, 4) for v in _safe_call(c, "GetSlenderRatio", [0.0])],
            })
        columns_by_floor[floor_idx] = floor_columns
        floor_idx += 1
    return {
        "floors": columns_by_floor,
        "total_columns": sum(len(v) for v in columns_by_floor.values()),
        "max_axial_compression_ratio": round(max_axial, 4),
        "total_reinforce_quantity": round(total_reinforce, 2),
        "floors_analyzed": floor_idx - 1,
    }
