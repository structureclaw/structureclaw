from __future__ import annotations

import math
from typing import Any, Dict, List

from design_basis import SeismicDesignBasis
from modal import G_ACCEL, ModalAnalysis
from spectrum import (
    GB50011_MAX_DESIGN_SPECTRUM_PERIOD_SEC,
    generate_design_spectrum,
    long_period_special_study_advisory,
    period_range_assessment,
    seismic_influence_coefficient,
    spectrum_values_for_modes,
)


STORY_MINIMUM_SHEAR_COEFFICIENT_SHORT_PERIOD = {
    6: 0.008,
    7: 0.016,
    8: 0.032,
    9: 0.064,
}
STORY_MINIMUM_SHEAR_COEFFICIENT_LONG_PERIOD = {
    6: 0.006,
    7: 0.012,
    8: 0.024,
    9: 0.048,
}
STORY_MINIMUM_SHEAR_COEFFICIENT_HIGH_ACCELERATION = {
    7: (0.024, 0.018),
    8: (0.048, 0.036),
}


def _normalize_modal_combination(value: str | None) -> str:
    text = str(value or "").strip().lower()
    return "srss" if text == "srss" else "cqc"


def _cqc_coefficient(period_i: float, period_j: float, damping_ratio: float) -> float:
    if period_i <= 0.0 or period_j <= 0.0:
        return 0.0
    if abs(period_i - period_j) <= 1e-12:
        return 1.0
    ratio = min(period_i, period_j) / max(period_i, period_j)
    damping = max(float(damping_ratio), 1e-6)
    numerator = 8.0 * damping * damping * (1.0 + ratio) * (ratio ** 1.5)
    denominator = (1.0 - ratio * ratio) ** 2 + 4.0 * damping * damping * ratio * (1.0 + ratio) ** 2
    return max(0.0, min(1.0, numerator / denominator if denominator > 0.0 else 0.0))


def _combine_modal_values(values: List[float], periods: List[float], damping_ratio: float, rule: str) -> float:
    if not values:
        return 0.0
    if rule == "srss":
        return math.sqrt(sum(value * value for value in values))
    total = 0.0
    for index_i, value_i in enumerate(values):
        for index_j, value_j in enumerate(values):
            total += (
                _cqc_coefficient(periods[index_i], periods[index_j], damping_ratio)
                * abs(value_i)
                * abs(value_j)
            )
    return math.sqrt(max(total, 0.0))


def _number(value: Any) -> float | None:
    return float(value) if isinstance(value, (int, float)) and math.isfinite(float(value)) else None


def _positive_number(value: Any) -> float | None:
    number = _number(value)
    return number if number is not None and number > 0.0 else None


def _story_minimum_shear_coefficient_rows(
    intensity: int,
    acceleration_g: float | None,
) -> tuple[float, float, str] | None:
    if intensity not in STORY_MINIMUM_SHEAR_COEFFICIENT_SHORT_PERIOD:
        return None
    if intensity in STORY_MINIMUM_SHEAR_COEFFICIENT_HIGH_ACCELERATION:
        threshold = 0.15 if intensity == 7 else 0.30
        if acceleration_g is None or acceleration_g >= threshold - 1e-9:
            short, long = STORY_MINIMUM_SHEAR_COEFFICIENT_HIGH_ACCELERATION[intensity]
            return short, long, f"intensity_{intensity}_high_design_basic_acceleration"
    return (
        STORY_MINIMUM_SHEAR_COEFFICIENT_SHORT_PERIOD[intensity],
        STORY_MINIMUM_SHEAR_COEFFICIENT_LONG_PERIOD[intensity],
        f"intensity_{intensity}_standard_design_basic_acceleration",
    )


def _regularity_data(regularity: Any) -> Dict[str, Any]:
    if isinstance(regularity, dict):
        return regularity
    if hasattr(regularity, "to_dict"):
        value = regularity.to_dict()
        return value if isinstance(value, dict) else {}
    return {}


def _check_severity(check: Dict[str, Any]) -> str:
    return str(check.get("severity") or "").strip().lower()


def _has_significant_torsion(regularity: Any) -> bool:
    data = _regularity_data(regularity)
    checks = data.get("checks")
    if not isinstance(checks, list):
        return False
    torsion_check_names = {
        "structured_torsional_displacement_ratio",
        "torsional_eccentricity",
    }
    for raw_check in checks:
        if not isinstance(raw_check, dict):
            continue
        if raw_check.get("hasSignificantTorsion") is True:
            return True
        name = str(raw_check.get("name") or "").strip()
        if name in torsion_check_names and _check_severity(raw_check) in {"irregular", "particularly_irregular"}:
            return True
    return False


def _weak_story_scope(regularity: Any) -> tuple[set[str], bool]:
    data = _regularity_data(regularity)
    checks = data.get("checks")
    if not isinstance(checks, list):
        return set(), False
    weak_stories: set[str] = set()
    global_weak_story = False
    for raw_check in checks:
        if not isinstance(raw_check, dict) or raw_check.get("name") != "explicit_weak_soft_story":
            continue
        story_triggers = raw_check.get("storyTriggers")
        if isinstance(story_triggers, list):
            for raw_trigger in story_triggers:
                if not isinstance(raw_trigger, dict):
                    continue
                story = str(raw_trigger.get("story") or "").strip().lower()
                if story:
                    weak_stories.add(story)
        triggers = raw_check.get("triggers")
        if isinstance(triggers, list) and triggers:
            global_weak_story = True
    return weak_stories, global_weak_story


def _minimum_shear_base_limit(
    basis: SeismicDesignBasis,
    response: Dict[str, Any],
    regularity: Any,
) -> Dict[str, Any] | None:
    intensity = int(round(float(getattr(basis, "intensity", 0) or 0)))
    coefficient_rows = _story_minimum_shear_coefficient_rows(intensity, getattr(basis, "acceleration_g", None))
    if coefficient_rows is None:
        return None
    short_limit, long_limit, acceleration_band = coefficient_rows
    envelope = response.get("envelope") if isinstance(response.get("envelope"), dict) else {}
    period = (
        _positive_number(response.get("fundamentalPeriod"))
        or _positive_number(envelope.get("fundamentalPeriod"))
    )
    significant_torsion = _has_significant_torsion(regularity)
    if significant_torsion:
        limit = short_limit
        basis_name = "significant_torsion"
    elif period is None:
        limit = short_limit
        basis_name = "missing_period_conservative_short_period"
    elif period <= 3.5:
        limit = short_limit
        basis_name = "period_le_3_5s"
    elif period >= 5.0:
        limit = long_limit
        basis_name = "period_ge_5_0s"
    else:
        ratio = (period - 3.5) / 1.5
        limit = short_limit + (long_limit - short_limit) * ratio
        basis_name = "period_linear_interpolation_3_5s_to_5_0s"
    return {
        "limit": limit,
        "shortPeriodLimit": short_limit,
        "longPeriodLimit": long_limit,
        "intensity": intensity,
        "designBasicAccelerationG": getattr(basis, "acceleration_g", None),
        "accelerationBand": acceleration_band,
        "fundamentalPeriod": period,
        "hasSignificantTorsion": significant_torsion,
        "basis": basis_name,
    }


def _round_or_none(value: float | None, digits: int = 6) -> float | None:
    return round(value, digits) if value is not None and math.isfinite(value) else None


def _story_displacements_for_mode(mode: Dict[str, Any], basis: SeismicDesignBasis) -> List[Dict[str, float]]:
    period = float(mode.get("period", 0.0) or 0.0)
    if period <= 0.0:
        return []
    omega = 2.0 * math.pi / period
    alpha = seismic_influence_coefficient(period, basis)
    spectral_displacement = alpha * G_ACCEL / (omega * omega)
    participation = float(mode.get("participationFactor", 1.0) or 1.0)
    rows: List[Dict[str, float]] = []
    for item in mode.get("storyShape", []) or []:
        if not isinstance(item, dict):
            continue
        rows.append({
            "elevation": float(item.get("elevation", 0.0) or 0.0),
            "displacement": float(item.get("phi", 0.0) or 0.0) * participation * spectral_displacement,
        })
    return rows


def run_response_spectrum(
    basis: SeismicDesignBasis,
    modal: ModalAnalysis,
    modal_combination: str = "cqc",
) -> Dict[str, Any]:
    combination_rule = _normalize_modal_combination(modal_combination)
    modal_responses: List[Dict[str, Any]] = []
    periods: List[float] = []
    base_shears: List[float] = []
    story_displacements_by_mode: Dict[float, List[float]] = {}

    for mode in modal.modes:
        period = float(mode.get("period", 0.0) or 0.0)
        alpha = seismic_influence_coefficient(period, basis)
        effective_mass = float(mode.get("effectiveMass", 0.0) or 0.0)
        base_shear = alpha * G_ACCEL * effective_mass
        periods.append(period)
        base_shears.append(base_shear)
        for row in _story_displacements_for_mode(mode, basis):
            elevation = row["elevation"]
            disp = row["displacement"]
            story_displacements_by_mode.setdefault(elevation, []).append(disp)
        modal_responses.append({
            "modeNumber": mode.get("modeNumber"),
            "period": period,
            "alpha": alpha,
            "requiresSpecialStudy": period > GB50011_MAX_DESIGN_SPECTRUM_PERIOD_SEC,
            "effectiveMass": round(effective_mass, 6),
            "massParticipationRatio": mode.get("massParticipationRatio"),
            "cumulativeMassParticipationRatio": mode.get("cumulativeMassParticipationRatio"),
            "baseShear": round(base_shear, 6),
        })

    for values in story_displacements_by_mode.values():
        if len(values) < len(periods):
            values.extend([0.0] * (len(periods) - len(values)))

    total_base_shear = _combine_modal_values(base_shears, periods, basis.damping_ratio, combination_rule)
    floor_responses: List[Dict[str, Any]] = []
    previous_elevation = 0.0
    previous_disp = 0.0
    max_drift_ratio = 0.0
    max_abs_displacement = 0.0
    cumulative_weight_height = sum(floor["weightKN"] * floor["elevation"] for floor in modal.floor_masses)
    for index, floor in enumerate(modal.floor_masses, start=1):
        elevation = floor["elevation"]
        displacement = _combine_modal_values(
            story_displacements_by_mode.get(elevation, []),
            periods,
            basis.damping_ratio,
            combination_rule,
        )
        story_height = max(elevation - previous_elevation, 1e-9)
        drift_ratio = abs(displacement - previous_disp) / story_height
        lateral_force = (
            total_base_shear * floor["weightKN"] * elevation / cumulative_weight_height
            if cumulative_weight_height > 0.0 else 0.0
        )
        max_drift_ratio = max(max_drift_ratio, drift_ratio)
        max_abs_displacement = max(max_abs_displacement, abs(displacement))
        floor_responses.append({
            "story": floor.get("story", f"F{index}"),
            "elevation": elevation,
            "mass": floor["mass"],
            "weightKN": floor["weightKN"],
            "lateralForce": round(lateral_force, 6),
            "displacement": round(displacement, 8),
            "driftRatio": round(drift_ratio, 8),
        })
        previous_elevation = elevation
        previous_disp = displacement

    cumulative_story_shear = 0.0
    cumulative_weight = 0.0
    story_shear_weight_ratios: List[float] = []
    for row in reversed(floor_responses):
        cumulative_story_shear += abs(float(row.get("lateralForce", 0.0) or 0.0))
        cumulative_weight += float(row.get("weightKN", 0.0) or 0.0)
        ratio = cumulative_story_shear / cumulative_weight if cumulative_weight > 0.0 else 0.0
        row["storyShearKN"] = round(cumulative_story_shear, 6)
        row["cumulativeWeightKN"] = round(cumulative_weight, 6)
        row["shearWeightRatio"] = round(ratio, 8)
        story_shear_weight_ratios.append(ratio)

    cumulative_participation = modal.modes[-1].get("cumulativeMassParticipationRatio", 0.0) if modal.modes else 0.0
    fundamental_period = periods[0] if periods else None
    envelope = {
        "maxBaseShear": round(total_base_shear, 6),
        "maxAbsShearForce": round(total_base_shear, 6),
        "maxAbsReaction": round(total_base_shear, 6),
        "maxStoryDriftRatio": round(max_drift_ratio, 8),
        "maxAbsDisplacement": round(max_abs_displacement, 8),
        "modalMassParticipationRatio": cumulative_participation,
        "fundamentalPeriod": fundamental_period,
        "minStoryShearWeightRatio": round(min(story_shear_weight_ratios), 8) if story_shear_weight_ratios else None,
        "modalCombination": combination_rule,
        "controlNodeDisplacement": floor_responses[-1]["story"] if floor_responses else "",
        "controlNodeReaction": "base",
    }

    long_period_advisory = long_period_special_study_advisory(modal.modes, basis)
    return {
        "analysisMode": "opensees_seismic_response_spectrum",
        "direction": modal.direction,
        "earthquakeLevel": basis.earthquake_level,
        "modalCombination": combination_rule,
        "dampingRatio": basis.damping_ratio,
        "fundamentalPeriod": fundamental_period,
        "modalResponses": modal_responses,
        "floorResponses": floor_responses,
        "minStoryShearWeightRatio": envelope["minStoryShearWeightRatio"],
        "baseShear": round(total_base_shear, 6),
        "designSpectrum": generate_design_spectrum(basis),
        "spectrumAtModes": spectrum_values_for_modes(modal.modes, basis),
        "periodRangeAssessment": period_range_assessment(modal.modes),
        **({"longPeriodSpecialStudyAdvisory": long_period_advisory} if long_period_advisory else {}),
        "envelope": envelope,
    }


def apply_minimum_story_shear_adjustment(
    response: Dict[str, Any],
    basis: SeismicDesignBasis,
    regularity: Any = None,
) -> Dict[str, Any]:
    floor_rows = response.get("floorResponses")
    if not isinstance(floor_rows, list) or not floor_rows:
        return response
    rows = [dict(row) for row in floor_rows if isinstance(row, dict)]
    if not rows:
        return response

    limit_data = _minimum_shear_base_limit(basis, response, regularity)
    if limit_data is None:
        result = {**response, "floorResponses": rows}
        result["minimumStoryShearAdjustment"] = {
            "status": "not_applicable",
            "clause": "GB/T 50011-2010(2024) 5.2.5",
            "reason": "Unsupported or unavailable seismic intensity for Table 5.2.5.",
        }
        return result

    weak_stories, global_weak_story = _weak_story_scope(regularity)
    floor_weights = [_number(row.get("weightKN")) or 0.0 for row in rows]
    floor_forces = [_number(row.get("lateralForce")) or 0.0 for row in rows]
    fallback_story_shears = [0.0 for _ in rows]
    fallback_cumulative_weights = [0.0 for _ in rows]
    cumulative_shear = 0.0
    cumulative_weight = 0.0
    for index in range(len(rows) - 1, -1, -1):
        cumulative_shear += abs(floor_forces[index])
        cumulative_weight += floor_weights[index]
        fallback_story_shears[index] = cumulative_shear
        fallback_cumulative_weights[index] = cumulative_weight

    base_limit = float(limit_data["limit"])
    adjusted_story_shears = [0.0 for _ in rows]
    story_results: List[Dict[str, Any]] = [None for _ in rows]  # type: ignore[list-item]
    shear_above = 0.0
    max_adjustment_factor = 1.0
    adjustment_applied = False

    for index in range(len(rows) - 1, -1, -1):
        row = rows[index]
        story_label = str(row.get("story") or row.get("storyId") or row.get("floor") or f"S{index + 1}")
        is_weak_story = global_weak_story or story_label.strip().lower() in weak_stories or row.get("isWeakStory") is True
        story_limit = base_limit * (1.15 if is_weak_story else 1.0)
        original_story_shear = abs(_number(row.get("storyShearKN")) or fallback_story_shears[index])
        cumulative_weight = _number(row.get("cumulativeWeightKN")) or fallback_cumulative_weights[index]
        original_ratio = (
            _number(row.get("shearWeightRatio"))
            if _number(row.get("shearWeightRatio")) is not None
            else original_story_shear / cumulative_weight if cumulative_weight > 0.0 else 0.0
        )
        minimum_story_shear = cumulative_weight * story_limit if cumulative_weight > 0.0 else 0.0
        adjusted_story_shear = max(original_story_shear, minimum_story_shear, shear_above)
        adjusted_story_shears[index] = adjusted_story_shear
        factor = adjusted_story_shear / max(original_story_shear, 1e-12)
        if factor > 1.0 + 1e-9:
            adjustment_applied = True
            max_adjustment_factor = max(max_adjustment_factor, factor)
        adjusted_ratio = adjusted_story_shear / cumulative_weight if cumulative_weight > 0.0 else 0.0
        story_results[index] = {
            "story": story_label,
            "requiredCoefficient": round(story_limit, 8),
            "baseCoefficient": round(base_limit, 8),
            "isWeakStory": bool(is_weak_story),
            "minimumStoryShearKN": round(minimum_story_shear, 6),
            "rawStoryShearKN": round(original_story_shear, 6),
            "adjustedStoryShearKN": round(adjusted_story_shear, 6),
            "rawShearWeightRatio": round(original_ratio or 0.0, 8),
            "adjustedShearWeightRatio": round(adjusted_ratio, 8),
            "adjustmentFactor": round(factor, 6),
        }
        shear_above = adjusted_story_shear

    for index, row in enumerate(rows):
        above_shear = adjusted_story_shears[index + 1] if index + 1 < len(rows) else 0.0
        adjusted_lateral_force = max(0.0, adjusted_story_shears[index] - above_shear)
        cumulative_weight = _number(row.get("cumulativeWeightKN")) or fallback_cumulative_weights[index]
        raw_lateral_force = _number(row.get("lateralForce")) or 0.0
        raw_story_shear = _number(row.get("storyShearKN")) or fallback_story_shears[index]
        raw_ratio = (
            _number(row.get("shearWeightRatio"))
            if _number(row.get("shearWeightRatio")) is not None
            else abs(raw_story_shear) / cumulative_weight if cumulative_weight > 0.0 else 0.0
        )
        row["rawLateralForce"] = round(raw_lateral_force, 6)
        row["rawStoryShearKN"] = round(abs(raw_story_shear), 6)
        row["rawShearWeightRatio"] = round(raw_ratio or 0.0, 8)
        row["lateralForce"] = round(adjusted_lateral_force, 6)
        row["storyShearKN"] = round(adjusted_story_shears[index], 6)
        row["shearWeightRatio"] = round(
            adjusted_story_shears[index] / cumulative_weight if cumulative_weight > 0.0 else 0.0,
            8,
        )
        row["minimumShearCoefficient"] = story_results[index]["requiredCoefficient"]
        row["minimumStoryShearKN"] = story_results[index]["minimumStoryShearKN"]
        row["minimumShearAdjustmentFactor"] = story_results[index]["adjustmentFactor"]
        row["minimumShearAdjusted"] = story_results[index]["adjustmentFactor"] > 1.0 + 1e-9
        row["isWeakStory"] = story_results[index]["isWeakStory"]

    adjusted_base_shear = adjusted_story_shears[0] if adjusted_story_shears else 0.0
    adjusted_min_ratio = min(
        (_number(row.get("shearWeightRatio")) or 0.0 for row in rows),
        default=0.0,
    )
    raw_base_shear = _number(response.get("baseShear"))
    raw_min_ratio = _number(response.get("minStoryShearWeightRatio"))
    envelope = dict(response.get("envelope")) if isinstance(response.get("envelope"), dict) else {}
    envelope["rawMaxBaseShear"] = _round_or_none(_number(envelope.get("maxBaseShear")) or raw_base_shear)
    envelope["rawMinStoryShearWeightRatio"] = _round_or_none(
        _number(envelope.get("minStoryShearWeightRatio")) or raw_min_ratio,
        8,
    )
    envelope["maxBaseShear"] = round(adjusted_base_shear, 6)
    envelope["maxAbsShearForce"] = round(adjusted_base_shear, 6)
    envelope["maxAbsReaction"] = round(adjusted_base_shear, 6)
    envelope["minStoryShearWeightRatio"] = round(adjusted_min_ratio, 8)
    envelope["minimumStoryShearAdjusted"] = adjustment_applied
    if limit_data.get("hasSignificantTorsion"):
        envelope["hasSignificantTorsion"] = True

    adjustment = {
        "status": "adjusted" if adjustment_applied else "not_required",
        "clause": "GB/T 50011-2010(2024) 5.2.5",
        "formula": "V_Eki / G_i >= lambda; weak story lambda is multiplied by 1.15",
        "baseLimit": round(base_limit, 8),
        "shortPeriodLimit": round(float(limit_data["shortPeriodLimit"]), 8),
        "longPeriodLimit": round(float(limit_data["longPeriodLimit"]), 8),
        "intensity": limit_data.get("intensity"),
        "designBasicAccelerationG": limit_data.get("designBasicAccelerationG"),
        "accelerationBand": limit_data.get("accelerationBand"),
        "fundamentalPeriod": _round_or_none(limit_data.get("fundamentalPeriod")),
        "limitBasis": limit_data.get("basis"),
        "hasSignificantTorsion": bool(limit_data.get("hasSignificantTorsion")),
        "weakStoryScope": "global" if global_weak_story else sorted(weak_stories),
        "maxAdjustmentFactor": round(max_adjustment_factor, 6),
        "rawBaseShearKN": _round_or_none(raw_base_shear),
        "adjustedBaseShearKN": round(adjusted_base_shear, 6),
        "rawMinStoryShearWeightRatio": _round_or_none(raw_min_ratio, 8),
        "adjustedMinStoryShearWeightRatio": round(adjusted_min_ratio, 8),
        "storyResults": story_results,
    }
    return {
        **response,
        "floorResponses": rows,
        "rawBaseShear": _round_or_none(raw_base_shear),
        "baseShear": round(adjusted_base_shear, 6),
        "rawMinStoryShearWeightRatio": _round_or_none(raw_min_ratio, 8),
        "minStoryShearWeightRatio": round(adjusted_min_ratio, 8),
        "minimumStoryShearAdjustment": adjustment,
        "envelope": envelope,
    }
