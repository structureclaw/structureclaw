from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

from design_basis import SeismicDesignBasis
from modal import G_ACCEL, ModalAnalysis, _build_opensees_model
from seismic_contracts import optional_number
from spectrum import seismic_influence_coefficient


@dataclass
class GroundMotion:
    name: str
    dt: float
    accelerations_mps2: List[float]
    unit: str
    record_type: str
    source_format: str = "values"
    direction: Optional[str] = None

    def to_summary(self) -> Dict[str, Any]:
        peak = max((abs(value) for value in self.accelerations_mps2), default=0.0)
        summary = {
            "name": self.name,
            "dt": self.dt,
            "pointCount": len(self.accelerations_mps2),
            "unit": self.unit,
            "recordType": self.record_type,
            "sourceFormat": self.source_format,
            "pgaMps2": round(peak, 6),
            "pgaG": round(peak / G_ACCEL, 6),
        }
        if self.direction:
            summary["direction"] = self.direction
        return summary


def _ground_motion_preview(motion: GroundMotion, max_points: int = 600) -> Dict[str, Any]:
    values = motion.accelerations_mps2
    if not values:
        return {
            "unit": "g",
            "pointCount": 0,
            "sampledPointCount": 0,
            "points": [],
        }

    limit = max(2, int(max_points))
    step = max(1, math.ceil(len(values) / limit))
    sampled_indices = list(range(0, len(values), step))
    if sampled_indices[-1] != len(values) - 1:
        sampled_indices.append(len(values) - 1)

    return {
        "unit": "g",
        "pointCount": len(values),
        "sampledPointCount": len(sampled_indices),
        "points": [
            {
                "time": round(index * motion.dt, 6),
                "accelG": round(values[index] / G_ACCEL, 8),
            }
            for index in sampled_indices
        ],
    }


@dataclass
class ParsedGroundMotionValues:
    values: List[float]
    inferred_dt: Optional[float] = None
    source_format: str = "values"


def _direct_values(record: Dict[str, Any]) -> ParsedGroundMotionValues:
    raw = record.get("values") or record.get("accelerations") or record.get("accel") or []
    if not isinstance(raw, list):
        return ParsedGroundMotionValues([], source_format="values")
    values: List[float] = []
    for item in raw:
        number = optional_number(item)
        if number is not None:
            values.append(float(number))
    return ParsedGroundMotionValues(values, source_format="values")


def _numeric_cells(row: Any) -> List[float]:
    if isinstance(row, dict):
        cells = list(row.values())
    elif isinstance(row, (list, tuple)):
        cells = list(row)
    else:
        cells = [row]
    values: List[float] = []
    for cell in cells:
        number = optional_number(cell)
        if number is not None:
            values.append(float(number))
    return values


def _column_index(column: Any, headers: Sequence[Any], fallback: int) -> int:
    if isinstance(column, (int, float)) and not isinstance(column, bool):
        index = int(column)
        return index if index >= 0 else fallback
    if isinstance(column, str) and column.strip():
        target = column.strip().lower()
        for index, header in enumerate(headers):
            if str(header).strip().lower() == target:
                return index
    return fallback


def _median_delta(values: Sequence[float]) -> Optional[float]:
    deltas = [
        float(values[index + 1]) - float(values[index])
        for index in range(len(values) - 1)
        if math.isfinite(float(values[index + 1])) and math.isfinite(float(values[index]))
    ]
    positive = sorted(delta for delta in deltas if delta > 0.0)
    if not positive:
        return None
    return positive[len(positive) // 2]


def _looks_like_time_column(values: Sequence[float]) -> bool:
    if len(values) < 3:
        return False
    previous = float(values[0])
    for value in values[1:]:
        current = float(value)
        if not math.isfinite(current) or current <= previous:
            return False
        previous = current
    dt = _median_delta(values)
    if dt is None or dt <= 0.0:
        return False
    return abs(values[0]) < max(dt * 0.5, 1e-9)


def _series_from_numeric_rows(
    numeric_rows: Sequence[Sequence[float]],
    *,
    time_column: int = 0,
    acceleration_column: Optional[int] = None,
) -> ParsedGroundMotionValues:
    rows = [list(row) for row in numeric_rows if row]
    if not rows:
        return ParsedGroundMotionValues([], source_format="rows")

    if acceleration_column is not None:
        values = [row[acceleration_column] for row in rows if len(row) > acceleration_column]
        times = [row[time_column] for row in rows if len(row) > max(time_column, acceleration_column)]
        inferred_dt = _median_delta(times) if _looks_like_time_column(times) else None
        return ParsedGroundMotionValues(values, inferred_dt=inferred_dt, source_format="rows")

    if len(rows) >= 3 and all(len(row) >= 2 for row in rows):
        times = [row[0] for row in rows]
        if _looks_like_time_column(times):
            return ParsedGroundMotionValues(
                [row[1] for row in rows],
                inferred_dt=_median_delta(times),
                source_format="rows",
            )

    return ParsedGroundMotionValues(
        [value for row in rows for value in row],
        source_format="rows",
    )


def _values_from_rows(record: Dict[str, Any]) -> ParsedGroundMotionValues:
    rows = record.get("rows")
    if not isinstance(rows, list):
        return ParsedGroundMotionValues([], source_format="rows")
    headers = record.get("headers") if isinstance(record.get("headers"), list) else []
    time_column = _column_index(
        record.get("timeColumn") or record.get("time_column"),
        headers,
        0,
    )
    explicit_acc_column = (
        record.get("accelerationColumn")
        or record.get("accelColumn")
        or record.get("valueColumn")
        or record.get("acceleration_column")
    )
    acceleration_column = None
    if explicit_acc_column is not None:
        acceleration_column = _column_index(explicit_acc_column, headers, 1)
    numeric_rows = [_numeric_cells(row) for row in rows]
    return _series_from_numeric_rows(
        numeric_rows,
        time_column=time_column,
        acceleration_column=acceleration_column,
    )


def _split_numeric_tokens(line: str) -> List[float]:
    tokens = line.replace(",", " ").replace(";", " ").replace("\t", " ").split()
    values: List[float] = []
    for token in tokens:
        number = optional_number(token)
        if number is not None:
            values.append(float(number))
    return values


def _parse_dt_after_marker(text: str) -> Optional[float]:
    marker_index = text.upper().find("DT=")
    if marker_index < 0:
        return None
    index = marker_index + len("DT=")
    while index < len(text) and text[index].isspace():
        index += 1
    chars: List[str] = []
    while index < len(text):
        char = text[index]
        if char.isdigit() or char in {"+", "-", ".", "e", "E"}:
            chars.append(char)
            index += 1
            continue
        break
    return optional_number("".join(chars))


def _values_from_text(text: str) -> ParsedGroundMotionValues:
    inferred_dt = _parse_dt_after_marker(text)
    numeric_rows: List[List[float]] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if "=" in line:
            continue
        values = _split_numeric_tokens(line)
        if values:
            numeric_rows.append(values)
    parsed = _series_from_numeric_rows(numeric_rows)
    parsed.inferred_dt = parsed.inferred_dt or inferred_dt
    parsed.source_format = "text"
    return parsed


def _nested_record_sources(record: Dict[str, Any]) -> List[Dict[str, Any]]:
    sources = [record]
    for key in ("fileAnalysis", "analysis", "parsedFile", "file"):
        value = record.get(key)
        if isinstance(value, dict):
            merged = {**value}
            for inherited_key in (
                "name",
                "id",
                "dt",
                "timeStep",
                "time_step",
                "unit",
                "recordType",
                "type",
                "timeColumn",
                "accelerationColumn",
                "accelColumn",
                "valueColumn",
                "direction",
                "component",
                "axis",
                "seismicDirection",
            ):
                if inherited_key in record and inherited_key not in merged:
                    merged[inherited_key] = record[inherited_key]
            sources.append(merged)
    return sources


def _values(record: Dict[str, Any]) -> ParsedGroundMotionValues:
    for source in _nested_record_sources(record):
        direct = _direct_values(source)
        if direct.values:
            return direct
        rows = _values_from_rows(source)
        if rows.values:
            return rows
        for key in ("content", "text", "csv", "at2", "data"):
            value = source.get(key)
            if isinstance(value, str) and value.strip():
                parsed = _values_from_text(value)
                if parsed.values:
                    return parsed
    return ParsedGroundMotionValues([])


def _motion_direction(record: Dict[str, Any]) -> Optional[str]:
    for key in ("direction", "component", "axis", "seismicDirection"):
        value = record.get(key)
        if isinstance(value, str) and value.strip():
            text = value.strip().lower()
            if text in {"x", "global_x", "ux", "ew", "e-w"}:
                return "x"
            if text in {"y", "global_y", "uy", "ns", "n-s"}:
                return "y"
    return None


def _unit_scale(unit: str) -> float:
    text = unit.strip().lower()
    if text in {"g", "gravity"}:
        return G_ACCEL
    if text in {"gal", "cm/s2", "cm/s^2"}:
        return 0.01
    return 1.0


def parse_ground_motions(records: List[Dict[str, Any]]) -> List[GroundMotion]:
    motions: List[GroundMotion] = []
    for index, record in enumerate(records, start=1):
        parsed = _values(record)
        if not parsed.values:
            continue
        dt = (
            optional_number(record.get("dt") or record.get("timeStep") or record.get("time_step"))
            or parsed.inferred_dt
            or 0.02
        )
        unit = str(record.get("unit") or "g")
        motions.append(GroundMotion(
            name=str(record.get("name") or record.get("id") or f"GM{index}"),
            dt=float(dt),
            accelerations_mps2=[float(value) * _unit_scale(unit) for value in parsed.values],
            unit=unit,
            record_type=str(record.get("recordType") or record.get("type") or "actual"),
            source_format=parsed.source_format,
            direction=_motion_direction(record),
        ))
    return motions


def select_ground_motions_for_direction(
    motions: Sequence[GroundMotion],
    direction: str,
) -> Tuple[List[GroundMotion], List[str]]:
    target = "y" if direction.strip().lower() == "y" else "x"
    tagged = [motion for motion in motions if motion.direction in {"x", "y"}]
    if not tagged:
        return list(motions), []

    matching = [motion for motion in motions if motion.direction == target]
    untagged = [motion for motion in motions if motion.direction is None]
    selected = [*matching, *untagged]
    if matching:
        return selected, []
    if untagged:
        return selected, [f"No {target.upper()}-direction tagged ground motions were provided; used untagged records for {target.upper()} direction."]
    return [], [f"No {target.upper()}-direction ground-motion records were provided."]


def ground_motion_set_checks(motions: Sequence[GroundMotion], required_count: int) -> Dict[str, Any]:
    actual_count = len([motion for motion in motions if motion.record_type.strip().lower() in {"actual", "real", "recorded"}])
    required_actual = math.ceil(len(motions) * 2.0 / 3.0) if motions else 0
    warnings: List[str] = []
    if required_count and len(motions) < required_count:
        warnings.append(f"{len(motions)} record(s) provided; {required_count} required by the selected workflow.")
    if motions and actual_count < required_actual:
        warnings.append("Actual recorded ground motions are fewer than two thirds of the selected set.")
    return {
        "recordCount": len(motions),
        "actualRecordCount": actual_count,
        "requiredActualRecordCount": required_actual,
        "actualRecordRatioOk": actual_count >= required_actual,
        "warnings": warnings,
    }


def _sdof_response(accelerations: List[float], dt: float, period: float, damping_ratio: float) -> Dict[str, float]:
    if not accelerations or period <= 0.0:
        return {"maxDisplacement": 0.0, "maxPseudoAcceleration": 0.0}
    omega = 2.0 * math.pi / period
    displacement = 0.0
    velocity = 0.0
    max_displacement = 0.0
    max_pseudo_acceleration = 0.0
    stable_dt = min(dt, period / 20.0)
    sub_steps = max(1, int(math.ceil(dt / stable_dt)))
    h = dt / sub_steps
    for ag in accelerations:
        for _ in range(sub_steps):
            relative_accel = -2.0 * damping_ratio * omega * velocity - omega * omega * displacement - ag
            velocity += relative_accel * h
            displacement += velocity * h
            pseudo_accel = abs(displacement) * omega * omega
            max_displacement = max(max_displacement, abs(displacement))
            max_pseudo_acceleration = max(max_pseudo_acceleration, pseudo_accel)
    return {
        "maxDisplacement": max_displacement,
        "maxPseudoAcceleration": max_pseudo_acceleration,
    }


def _time_history_combination_summary(
    record_results: Sequence[Dict[str, Any]],
    rule: str,
    response_spectrum_base_shear: float,
) -> Dict[str, Any]:
    values = [
        abs(float((item.get("baseShear") if item.get("baseShear") is not None else item.get("maxBaseShear")) or 0.0))
        for item in record_results
    ]
    envelope = max(values, default=0.0)
    average = sum(values) / len(values) if values else 0.0
    response_base = max(float(response_spectrum_base_shear or 0.0), 0.0)
    if not values:
        return {
            "rule": rule,
            "recordCount": 0,
            "responseSpectrumBaseShear": round(response_base, 6),
            "timeHistoryEnvelopeBaseShear": 0.0,
            "timeHistoryAverageBaseShear": 0.0,
            "timeHistoryStatistic": "unavailable",
            "timeHistoryStatisticBaseShear": 0.0,
            "combinedBaseShear": 0.0,
            "governingSource": "unavailable",
        }
    if rule == "mean_vs_response_spectrum" and len(values) >= 7:
        time_history_statistic = average
        statistic_name = "average"
        combined = max(average, response_base)
    else:
        time_history_statistic = envelope
        statistic_name = "envelope"
        combined = max(envelope, response_base)
    if response_base >= time_history_statistic:
        governing_source = "response_spectrum"
    else:
        governing_source = f"time_history_{statistic_name}"
    return {
        "rule": rule,
        "recordCount": len(values),
        "responseSpectrumBaseShear": round(response_base, 6),
        "timeHistoryEnvelopeBaseShear": round(envelope, 6),
        "timeHistoryAverageBaseShear": round(average, 6),
        "timeHistoryStatistic": statistic_name,
        "timeHistoryStatisticBaseShear": round(time_history_statistic, 6),
        "combinedBaseShear": round(combined, 6),
        "governingSource": governing_source,
    }


def _normalize_modal_combination(value: str) -> str:
    return "srss" if str(value or "").strip().lower() == "srss" else "cqc"


def _modal_cqc_coefficient(period_i: float, period_j: float, damping_ratio: float) -> float:
    if period_i <= 0.0 or period_j <= 0.0:
        return 0.0
    if abs(period_i - period_j) <= 1e-12:
        return 1.0
    ratio = min(period_i, period_j) / max(period_i, period_j)
    damping = max(float(damping_ratio), 1e-6)
    numerator = 8.0 * damping * damping * (1.0 + ratio) * (ratio ** 1.5)
    denominator = (1.0 - ratio * ratio) ** 2 + 4.0 * damping * damping * ratio * (1.0 + ratio) ** 2
    return max(0.0, min(1.0, numerator / denominator if denominator > 0.0 else 0.0))


def _combine_modal_values(values: Sequence[float], periods: Sequence[float], damping_ratio: float, rule: str) -> float:
    if not values:
        return 0.0
    if rule == "srss":
        return math.sqrt(sum(value * value for value in values))
    total = 0.0
    for index_i, value_i in enumerate(values):
        for index_j, value_j in enumerate(values):
            total += (
                _modal_cqc_coefficient(periods[index_i], periods[index_j], damping_ratio)
                * abs(value_i)
                * abs(value_j)
            )
    return math.sqrt(max(total, 0.0))


def _valid_modal_modes(modal: ModalAnalysis) -> List[Dict[str, Any]]:
    modes: List[Dict[str, Any]] = []
    for mode in modal.modes:
        period = optional_number(mode.get("period"))
        effective_mass = optional_number(mode.get("effectiveMass"))
        if period is not None and period > 0.0 and effective_mass is not None and effective_mass > 0.0:
            modes.append(mode)
    if modes:
        return modes
    return [{
        "modeNumber": 1,
        "period": 0.8,
        "effectiveMass": modal.total_mass,
    }]


def _spectrum_match_summary(
    record_results: Sequence[Dict[str, Any]],
    *,
    target_period: float,
    target_sa: float,
    scale_factor_limit: float = 10.0,
    modal_spectrum_average_min_ratio: float = 0.65,
) -> Dict[str, Any]:
    scale_factors = [
        float(item["scaleFactor"])
        for item in record_results
        if isinstance(item.get("scaleFactor"), (int, float)) and math.isfinite(float(item["scaleFactor"]))
    ]
    pre_scale_ratios = [
        float(item["preScaleSpectralAccelerationRatioToTarget"])
        for item in record_results
        if isinstance(item.get("preScaleSpectralAccelerationRatioToTarget"), (int, float))
        and math.isfinite(float(item["preScaleSpectralAccelerationRatioToTarget"]))
    ]
    post_scale_ratios = [
        float(item["spectralAccelerationRatioToTarget"])
        for item in record_results
        if isinstance(item.get("spectralAccelerationRatioToTarget"), (int, float))
        and math.isfinite(float(item["spectralAccelerationRatioToTarget"]))
    ]
    max_scale_factor = max(scale_factors) if scale_factors else None
    warnings: List[str] = []
    if max_scale_factor is not None and max_scale_factor > scale_factor_limit:
        warnings.append(
            f"Maximum ground-motion scale factor {max_scale_factor:.3f} exceeds the advisory limit {scale_factor_limit:.3f}."
        )
    if pre_scale_ratios and min(pre_scale_ratios) <= 0.05:
        warnings.append("At least one selected record has very low first-mode spectral acceleration before scaling.")

    period_buckets: Dict[float, Dict[str, Any]] = {}
    for record in record_results:
        modal_responses = record.get("modalResponses")
        if not isinstance(modal_responses, list):
            continue
        for response in modal_responses:
            if not isinstance(response, dict):
                continue
            period = optional_number(response.get("period"))
            target = optional_number(response.get("targetSpectralAccelerationMps2"))
            ratio = optional_number(response.get("spectralAccelerationRatioToTarget"))
            if period is None or target is None or ratio is None:
                continue
            bucket = period_buckets.setdefault(round(float(period), 6), {
                "period": round(float(period), 6),
                "targetSpectralAccelerationMps2": round(float(target), 6),
                "ratios": [],
            })
            bucket["ratios"].append(float(ratio))
    period_checks = []
    for period in sorted(period_buckets):
        bucket = period_buckets[period]
        ratios = [
            float(ratio)
            for ratio in bucket.get("ratios", [])
            if math.isfinite(float(ratio))
        ]
        if not ratios:
            continue
        average_ratio = sum(ratios) / len(ratios)
        period_checks.append({
            "period": bucket["period"],
            "targetSpectralAccelerationMps2": bucket["targetSpectralAccelerationMps2"],
            "recordCount": len(ratios),
            "minRatioToTarget": round(min(ratios), 6),
            "averageRatioToTarget": round(average_ratio, 6),
        })
    average_ratios = [
        float(item["averageRatioToTarget"])
        for item in period_checks
        if isinstance(item.get("averageRatioToTarget"), (int, float))
    ]
    min_average_ratio = min(average_ratios) if average_ratios else None
    modal_spectrum_average_ok = (
        min_average_ratio is not None
        and min_average_ratio >= modal_spectrum_average_min_ratio
    )
    if min_average_ratio is not None and not modal_spectrum_average_ok:
        warnings.append(
            "Average scaled ground-motion spectra fall below the modal-period compatibility threshold."
        )

    return {
        "targetPeriod": round(target_period, 6),
        "targetSpectralAccelerationMps2": round(target_sa, 6),
        "recordCount": len(record_results),
        "minPreScaleSpectralAccelerationRatioToTarget": round(min(pre_scale_ratios), 6) if pre_scale_ratios else None,
        "maxPreScaleSpectralAccelerationRatioToTarget": round(max(pre_scale_ratios), 6) if pre_scale_ratios else None,
        "averagePostScaleSpectralAccelerationRatioToTarget": round(sum(post_scale_ratios) / len(post_scale_ratios), 6)
        if post_scale_ratios
        else None,
        "maxScaleFactor": round(max_scale_factor, 6) if max_scale_factor is not None else None,
        "scaleFactorLimit": scale_factor_limit,
        "scaleFactorOk": bool(scale_factors) and all(factor <= scale_factor_limit for factor in scale_factors),
        "periodCheckScope": "modal_period_points",
        "modalSpectrumAverageMinRatio": modal_spectrum_average_min_ratio,
        "averageModalSpectrumMinRatioToTarget": round(min_average_ratio, 6) if min_average_ratio is not None else None,
        "modalSpectrumAverageOk": modal_spectrum_average_ok if min_average_ratio is not None else None,
        "periodChecks": period_checks,
        "warnings": warnings,
    }


def _field(record: Any, key: str, default: Any = None) -> Any:
    if isinstance(record, dict):
        return record.get(key, default)
    return getattr(record, key, default)


def _model_payload(model: Any) -> Dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump(mode="python")
    return model if isinstance(model, dict) else {}


def _nodes(payload: Dict[str, Any], model: Any) -> List[Any]:
    value = payload.get("nodes")
    if isinstance(value, list):
        return value
    return list(getattr(model, "nodes", []) or [])


def _node_key(node: Any) -> str:
    return str(_field(node, "id"))


def _base_and_top_tags(nodes: Sequence[Any], node_tags: Dict[str, int]) -> Tuple[List[int], List[int]]:
    z_values = [float(_field(node, "z", 0.0) or 0.0) for node in nodes]
    if not z_values:
        return [], []
    min_z = min(z_values)
    max_z = max(z_values)
    base_tags = [
        node_tags[_node_key(node)]
        for node in nodes
        if _node_key(node) in node_tags and abs(float(_field(node, "z", 0.0) or 0.0) - min_z) <= 1e-6
    ]
    top_tags = [
        node_tags[_node_key(node)]
        for node in nodes
        if _node_key(node) in node_tags and abs(float(_field(node, "z", 0.0) or 0.0) - max_z) <= 1e-6
    ]
    return base_tags, top_tags


def _level_node_tags(nodes: Sequence[Any], node_tags: Dict[str, int]) -> List[Dict[str, Any]]:
    grouped: Dict[float, Dict[str, Any]] = {}
    for node in nodes:
        key = _node_key(node)
        if key not in node_tags:
            continue
        elevation = round(float(_field(node, "z", 0.0) or 0.0), 6)
        node_tag = node_tags[key]
        level = grouped.setdefault(elevation, {"nodeTags": [], "points": []})
        level["nodeTags"].append(node_tag)
        level["points"].append({
            "nodeTag": node_tag,
            "x": round(float(_field(node, "x", 0.0) or 0.0), 6),
            "y": round(float(_field(node, "y", 0.0) or 0.0), 6),
        })
    return [
        {"elevation": elevation, **level}
        for elevation, level in sorted(grouped.items(), key=lambda item: item[0])
        if level["nodeTags"]
    ]


def _story_drift_snapshot(ops: Any, levels: Sequence[Dict[str, Any]], dof: int) -> Tuple[float, Dict[str, Any]]:
    if len(levels) < 2:
        return 0.0, {}
    level_displacements: List[Dict[str, Any]] = []
    for level in levels:
        tags = level.get("nodeTags")
        if not isinstance(tags, list) or not tags:
            continue
        displacements = [float(ops.nodeDisp(int(tag), dof)) for tag in tags]
        average = sum(displacements) / len(displacements)
        points = level.get("points")
        point_displacements: Dict[Tuple[float, float], Dict[str, Any]] = {}
        if isinstance(points, list):
            for point in points:
                if not isinstance(point, dict):
                    continue
                node_tag = point.get("nodeTag")
                if node_tag not in tags:
                    continue
                coordinate = (
                    round(float(point.get("x", 0.0) or 0.0), 6),
                    round(float(point.get("y", 0.0) or 0.0), 6),
                )
                point_displacements[coordinate] = {
                    "nodeTag": int(node_tag),
                    "displacement": float(ops.nodeDisp(int(node_tag), dof)),
                    "x": coordinate[0],
                    "y": coordinate[1],
                }
        level_displacements.append({
            "elevation": float(level.get("elevation", 0.0) or 0.0),
            "average": average,
            "points": point_displacements,
        })
    if len(level_displacements) < 2:
        return 0.0, {}

    max_ratio = 0.0
    controlling: Dict[str, Any] = {}
    for index in range(1, len(level_displacements)):
        lower = level_displacements[index - 1]
        upper = level_displacements[index]
        lower_elevation = float(lower["elevation"])
        upper_elevation = float(upper["elevation"])
        story_height = max(upper_elevation - lower_elevation, 1.0e-9)
        candidates: List[Dict[str, Any]] = []
        lower_points = lower.get("points") if isinstance(lower.get("points"), dict) else {}
        upper_points = upper.get("points") if isinstance(upper.get("points"), dict) else {}
        for coordinate in sorted(set(lower_points) & set(upper_points)):
            lower_point = lower_points[coordinate]
            upper_point = upper_points[coordinate]
            interstory = float(upper_point["displacement"]) - float(lower_point["displacement"])
            candidates.append({
                "interstory": interstory,
                "source": "node_line",
                "x": coordinate[0],
                "y": coordinate[1],
                "lowerNodeTag": lower_point["nodeTag"],
                "upperNodeTag": upper_point["nodeTag"],
            })
        if not candidates:
            candidates.append({
                "interstory": float(upper["average"]) - float(lower["average"]),
                "source": "level_average",
            })
        for candidate in candidates:
            interstory = float(candidate["interstory"])
            ratio = abs(interstory) / story_height
            if ratio > max_ratio:
                max_ratio = ratio
                controlling = {
                    "story": f"{lower_elevation:g}-{upper_elevation:g}m",
                    "lowerElevation": round(lower_elevation, 6),
                    "elevation": round(upper_elevation, 6),
                    "storyHeightM": round(story_height, 6),
                    "interstoryDisplacementM": round(interstory, 8),
                    "driftRatio": round(ratio, 8),
                    "source": candidate["source"],
                    **({
                        "x": candidate["x"],
                        "y": candidate["y"],
                        "lowerNodeTag": candidate["lowerNodeTag"],
                        "upperNodeTag": candidate["upperNodeTag"],
                    } if candidate["source"] == "node_line" else {}),
                }
    return max_ratio, controlling


def _run_single_opensees_transient(
    model: Any,
    basis: SeismicDesignBasis,
    motion: GroundMotion,
    scale_factor: float,
    modal: ModalAnalysis,
    direction: str,
    pattern_tag: int,
) -> Dict[str, Any]:
    import openseespy.opensees as ops

    payload = _model_payload(model)
    dimension, node_tags, _floor_masses = _build_opensees_model(ops, payload, model, basis, direction)
    if dimension == "2d" and direction == "y":
        raise RuntimeError("Y-direction transient analysis requires a 3D model.")

    nodes = _nodes(payload, model)
    base_tags, top_tags = _base_and_top_tags(nodes, node_tags)
    if not base_tags or not top_tags:
        raise RuntimeError("Could not identify base/top nodes for OpenSees transient result extraction.")
    levels = _level_node_tags(nodes, node_tags)

    first_period = float((modal.modes[0] if modal.modes else {}).get("period", 0.8) or 0.8)
    omega = 2.0 * math.pi / max(first_period, 1e-6)
    ops.rayleigh(2.0 * basis.damping_ratio * omega, 0.0, 0.0, 0.0)

    scaled = [float(value) * scale_factor for value in motion.accelerations_mps2]
    series_tag = 10_000 + pattern_tag
    ops.timeSeries("Path", series_tag, "-dt", motion.dt, "-values", *scaled)
    dof = 2 if dimension == "3d" and direction == "y" else 1
    ops.pattern("UniformExcitation", pattern_tag, dof, "-accel", series_tag)

    ops.wipeAnalysis()
    ops.constraints("Transformation")
    ops.numberer("RCM")
    ops.system("BandGeneral")
    ops.test("NormDispIncr", 1.0e-8, 12)
    ops.algorithm("Linear")
    ops.integrator("Newmark", 0.5, 0.25)
    ops.analysis("Transient")

    max_top_displacement = 0.0
    max_base_shear = 0.0
    max_story_drift_ratio = 0.0
    controlling_story: Dict[str, Any] = {}
    completed_steps = 0
    for _step, _ag in enumerate(scaled):
        ok = ops.analyze(1, motion.dt)
        if ok != 0:
            break
        completed_steps += 1
        top_displacements = [abs(float(ops.nodeDisp(tag, dof))) for tag in top_tags]
        max_top_displacement = max(max_top_displacement, max(top_displacements, default=0.0))
        story_drift_ratio, story = _story_drift_snapshot(ops, levels, dof)
        if story_drift_ratio > max_story_drift_ratio:
            max_story_drift_ratio = story_drift_ratio
            controlling_story = {**story, "step": completed_steps}
        try:
            ops.reactions()
            base_shear = abs(sum(float(ops.nodeReaction(tag, dof)) for tag in base_tags))
            max_base_shear = max(max_base_shear, base_shear)
        except Exception:
            pass

    return {
        "name": motion.name,
        "engineMode": "opensees_transient",
        "completedSteps": completed_steps,
        "requestedSteps": len(scaled),
        "maxTopDisplacementM": round(max_top_displacement, 8),
        "maxStoryDriftRatio": round(max_story_drift_ratio, 8),
        **({"controllingStory": controlling_story} if controlling_story else {}),
        "maxBaseShear": round(max_base_shear, 6),
        "converged": completed_steps == len(scaled),
    }


def attach_opensees_transient_check(
    time_history: Dict[str, Any],
    motions: Sequence[GroundMotion],
    model: Any,
    basis: SeismicDesignBasis,
    modal: ModalAnalysis,
    combination_rule: str,
    direction: str,
) -> Dict[str, Any]:
    records = time_history.get("records")
    if not isinstance(records, list) or not records:
        time_history["engineMode"] = "modal_sdof"
        return time_history
    response_spectrum_base_shear = optional_number(
        (time_history.get("baseShearCheck") if isinstance(time_history.get("baseShearCheck"), dict) else {}).get("responseSpectrumBaseShear")
    ) or 0.0

    transient_records: List[Dict[str, Any]] = []
    warnings: List[str] = []
    try:
        for index, motion in enumerate(motions, start=1):
            matching = records[index - 1] if index - 1 < len(records) and isinstance(records[index - 1], dict) else {}
            scale_factor = optional_number(matching.get("scaleFactor")) or 1.0
            transient_records.append(_run_single_opensees_transient(
                model,
                basis,
                motion,
                float(scale_factor),
                modal,
                direction,
                pattern_tag=index,
            ))
    except Exception as error:
        time_history["engineMode"] = "modal_sdof"
        warnings.append(f"OpenSees transient check was not completed; retained modal SDOF time-history result: {error}")
        time_history["openSeesTransient"] = {
            "engineMode": "unavailable",
            "records": transient_records,
            "warnings": warnings,
        }
        return time_history

    combination_summary = _time_history_combination_summary(
        transient_records,
        combination_rule,
        response_spectrum_base_shear,
    )
    max_story_drift_ratio = max(
        (
            float(record.get("maxStoryDriftRatio", 0.0) or 0.0)
            for record in transient_records
            if isinstance(record, dict)
        ),
        default=0.0,
    )
    controlling_story = max(
        (
            {
                **(record.get("controllingStory") if isinstance(record.get("controllingStory"), dict) else {}),
                "record": record.get("name"),
            }
            for record in transient_records
            if isinstance(record, dict) and isinstance(record.get("controllingStory"), dict)
        ),
        key=lambda item: float(item.get("driftRatio", 0.0) or 0.0),
        default={},
    )
    time_history["engineMode"] = "opensees_transient_check"
    time_history["maxStoryDriftRatio"] = round(max_story_drift_ratio, 8)
    if controlling_story:
        time_history["controllingStory"] = controlling_story
    time_history["openSeesTransient"] = {
        "engineMode": "opensees_transient",
        "records": transient_records,
        "combinedBaseShear": combination_summary["combinedBaseShear"],
        "combinationSummary": combination_summary,
        "maxStoryDriftRatio": round(max_story_drift_ratio, 8),
        **({"controllingStory": controlling_story} if controlling_story else {}),
        "warnings": warnings,
    }
    return time_history


def run_modal_time_history(
    motions: Sequence[GroundMotion],
    basis: SeismicDesignBasis,
    modal: ModalAnalysis,
    response_spectrum_base_shear: float,
    combination_rule: str,
    scale_factor_limit: float = 10.0,
    modal_combination: str = "cqc",
) -> Dict[str, Any]:
    modal_combination_rule = _normalize_modal_combination(modal_combination)
    if not motions:
        combination_summary = _time_history_combination_summary([], combination_rule, response_spectrum_base_shear)
        return {
            "records": [],
            "combinedBaseShear": combination_summary["combinedBaseShear"],
            "combinationRule": combination_rule,
            "combinationSummary": combination_summary,
            "modalCombination": modal_combination_rule,
            "modesUsed": 0,
            "baseShearCheck": {
                "eachRecordMinRatio": 0.65,
                "averageMinRatio": 0.80,
                "eachRecordOk": False,
                "averageOk": False,
            },
        }

    modes = _valid_modal_modes(modal)
    periods = [float(mode.get("period", 0.0) or 0.0) for mode in modes]
    first_period = periods[0] if periods else 0.8
    target_sa = seismic_influence_coefficient(first_period, basis) * G_ACCEL
    records: List[Dict[str, Any]] = []
    for motion in motions:
        unscaled = _sdof_response(motion.accelerations_mps2, motion.dt, first_period, basis.damping_ratio)
        record_sa = max(float(unscaled["maxPseudoAcceleration"]), 1e-9)
        scale_factor = target_sa / record_sa
        scaled_acc = [value * scale_factor for value in motion.accelerations_mps2]
        modal_responses: List[Dict[str, Any]] = []
        mode_base_shears: List[float] = []
        mode_displacements: List[float] = []
        first_mode_sa = 0.0
        for index, mode in enumerate(modes, start=1):
            period = float(mode.get("period", 0.0) or 0.0)
            effective_mass = float(mode.get("effectiveMass", 0.0) or 0.0)
            target_mode_sa = seismic_influence_coefficient(period, basis) * G_ACCEL
            scaled = _sdof_response(scaled_acc, motion.dt, period, basis.damping_ratio)
            scaled_sa = float(scaled["maxPseudoAcceleration"])
            max_displacement = float(scaled["maxDisplacement"])
            base_shear = scaled_sa * effective_mass
            if index == 1:
                first_mode_sa = scaled_sa
            mode_base_shears.append(base_shear)
            mode_displacements.append(max_displacement)
            mode_number = optional_number(mode.get("modeNumber"))
            modal_responses.append({
                "modeNumber": int(mode_number) if mode_number is not None else index,
                "period": round(period, 6),
                "effectiveMass": round(effective_mass, 6),
                "targetSpectralAccelerationMps2": round(target_mode_sa, 6),
                "spectralAccelerationMps2": round(scaled_sa, 6),
                "spectralAccelerationRatioToTarget": round(
                    scaled_sa / target_mode_sa if target_mode_sa > 0.0 else 0.0,
                    6,
                ),
                "maxModalDisplacementM": round(max_displacement, 8),
                "baseShear": round(base_shear, 6),
            })
        base_shear = _combine_modal_values(
            mode_base_shears,
            periods,
            basis.damping_ratio,
            modal_combination_rule,
        )
        max_modal_displacement = _combine_modal_values(
            mode_displacements,
            periods,
            basis.damping_ratio,
            modal_combination_rule,
        )
        records.append({
            **motion.to_summary(),
            "preview": _ground_motion_preview(motion),
            "scaleFactor": round(scale_factor, 6),
            "modalCombination": modal_combination_rule,
            "modesUsed": len(modal_responses),
            "targetSpectralAccelerationMps2": round(target_sa, 6),
            "unscaledSpectralAccelerationMps2": round(record_sa, 6),
            "spectralAccelerationMps2": round(first_mode_sa, 6),
            "preScaleSpectralAccelerationRatioToTarget": round(
                record_sa / target_sa if target_sa > 0.0 else 0.0,
                6,
            ),
            "spectralAccelerationRatioToTarget": round(
                first_mode_sa / target_sa if target_sa > 0.0 else 0.0,
                6,
            ),
            "maxModalDisplacementM": round(max_modal_displacement, 8),
            "baseShear": round(base_shear, 6),
            "baseShearRatioToResponseSpectrum": round(
                base_shear / response_spectrum_base_shear if response_spectrum_base_shear > 0.0 else 0.0,
                6,
            ),
            "modalResponses": modal_responses,
        })

    average_base_shear = sum(float(item["baseShear"]) for item in records) / len(records)
    envelope_base_shear = max(float(item["baseShear"]) for item in records)
    each_record_ok = all(float(item["baseShear"]) >= 0.65 * response_spectrum_base_shear for item in records)
    average_ok = average_base_shear >= 0.80 * response_spectrum_base_shear
    combination_summary = _time_history_combination_summary(records, combination_rule, response_spectrum_base_shear)

    return {
        "records": records,
        "combinedBaseShear": combination_summary["combinedBaseShear"],
        "averageBaseShear": round(average_base_shear, 6),
        "envelopeBaseShear": round(envelope_base_shear, 6),
        "combinationRule": combination_rule,
        "combinationSummary": combination_summary,
        "modalCombination": modal_combination_rule,
        "modesUsed": len(modes),
        "spectrumMatch": _spectrum_match_summary(
            records,
            target_period=first_period,
            target_sa=target_sa,
            scale_factor_limit=scale_factor_limit,
        ),
        "baseShearCheck": {
            "responseSpectrumBaseShear": round(response_spectrum_base_shear, 6),
            "eachRecordMinRatio": 0.65,
            "averageMinRatio": 0.80,
            "eachRecordOk": each_record_ok,
            "averageOk": average_ok,
        },
    }
