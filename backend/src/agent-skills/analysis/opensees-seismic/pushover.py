from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Sequence, Tuple

from design_basis import SeismicDesignBasis, model_payload
from gb50011_drift_limits import gb50011_advisory_yield_drift_metadata
from modal import (
    G_ACCEL,
    _build_opensees_model,
    _effective_section_properties,
    _element_nodes,
    _element_type,
    _is_opensees_line_element_type,
    _material_e,
    _material_map,
    _model_dimension,
    _restraints_for_node,
    _section_map,
)
from seismic_contracts import optional_number
from spectrum import seismic_influence_coefficient


PUSHOVER_MEMBER_HINGE_2D_CAPABILITY = "pushoverMemberPlasticHinge2dEstimate"
PUSHOVER_BILINEAR_SDOF_CAPABILITY = "pushoverBilinearSdofEstimate"
PUSHOVER_BILINEAR_STORY_SHEAR_CAPABILITY = "pushoverBilinearStoryShearBuildingEstimate"


def _field(record: Any, key: str, default: Any = None) -> Any:
    if isinstance(record, dict):
        return record.get(key, default)
    return getattr(record, key, default)


def _records(payload: Dict[str, Any], model: Any, key: str) -> List[Any]:
    value = payload.get(key)
    if isinstance(value, list):
        return value
    return list(getattr(model, key, []) or [])


def _performance_objective(parameters: Dict[str, Any]) -> Dict[str, Any]:
    value = parameters.get("performanceObjective")
    return value if isinstance(value, dict) else {}


def _as_record(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _first_string(*values: Any) -> Optional[str]:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return str(value)
    return None


def _first_number(*values: Any) -> Optional[float]:
    for value in values:
        number = optional_number(value)
        if number is not None:
            return number
    return None


def _looks_like_hinge_record(value: Dict[str, Any]) -> bool:
    return any(key in value for key in (
        "elementId",
        "memberId",
        "element",
        "member",
        "end",
        "nodeEnd",
        "position",
        "yieldMoment",
        "yieldMomentKNm",
        "momentYield",
        "My",
        "positiveYieldMoment",
        "yieldRotation",
        "rotationYield",
        "thetaY",
        "positiveYieldRotation",
        "backbone",
        "momentRotation",
        "momentRotationBackbone",
        "rotationBackbone",
    ))


def _structured_entries(section: Dict[str, Any], *keys: str) -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []
    for key in keys:
        value = section.get(key)
        if isinstance(value, list):
            entries.extend([item for item in value if isinstance(item, dict)])
            continue
        if not isinstance(value, dict):
            continue
        if _looks_like_hinge_record(value):
            entries.append(value)
            continue
        for outer_key, item in value.items():
            if not isinstance(item, dict):
                continue
            if _looks_like_hinge_record(item):
                entry = {**item}
                if _first_string(entry.get("elementId"), entry.get("memberId"), entry.get("element"), entry.get("member")) is None:
                    entry["elementId"] = str(outer_key)
                entries.append(entry)
                continue
            for nested_key, nested_item in item.items():
                if not isinstance(nested_item, dict):
                    continue
                entry = {**nested_item}
                if _first_string(entry.get("elementId"), entry.get("memberId"), entry.get("element"), entry.get("member")) is None:
                    entry["elementId"] = str(outer_key)
                if _first_string(entry.get("end"), entry.get("nodeEnd"), entry.get("position")) is None:
                    entry["end"] = str(nested_key)
                entries.append(entry)
    return entries


def _hinge_ends(entry: Dict[str, Any]) -> List[str]:
    raw = entry.get("end")
    if raw is None:
        raw = entry.get("nodeEnd")
    if raw is None:
        raw = entry.get("position")
    if isinstance(raw, list):
        ends: List[str] = []
        for item in raw:
            ends.extend(_hinge_ends({"end": item}))
        return list(dict.fromkeys(ends))
    if isinstance(raw, (int, float)) and not isinstance(raw, bool):
        return ["i"] if int(raw) == 0 else ["j"] if int(raw) == 1 else []
    value = str(raw or "").strip().lower()
    if value in {"i", "i-end", "i_end", "start", "start-node", "start_node", "near"}:
        return ["i"]
    if value in {"j", "j-end", "j_end", "end", "end-node", "end_node", "far"}:
        return ["j"]
    if value in {"both", "ij", "i+j", "i-j"}:
        return ["i", "j"]
    return []


def _backbone_yield_point(entry: Dict[str, Any]) -> Tuple[Optional[float], Optional[float]]:
    candidates: List[Any] = []
    for key in ("backbone", "momentRotation", "momentRotationBackbone", "rotationBackbone"):
        value = entry.get(key)
        if isinstance(value, dict):
            for nested_key in ("positive", "points", "values", "envelope"):
                nested = value.get(nested_key)
                if nested is not None:
                    candidates.append(nested)
        if value is not None:
            candidates.append(value)
    for candidate in candidates:
        points = candidate if isinstance(candidate, list) else []
        for point in points:
            if isinstance(point, (list, tuple)) and len(point) >= 2:
                rotation = optional_number(point[0])
                moment = optional_number(point[1])
            elif isinstance(point, dict):
                rotation = _first_number(
                    point.get("rotation"),
                    point.get("theta"),
                    point.get("yieldRotation"),
                    point.get("deformation"),
                )
                moment = _first_number(
                    point.get("moment"),
                    point.get("momentKNm"),
                    point.get("yieldMoment"),
                    point.get("force"),
                )
            else:
                continue
            if rotation is not None and moment is not None:
                return float(moment), abs(float(rotation))
    return None, None


def _member_plastic_hinge_definitions(
    parameters: Dict[str, Any],
    elements: Sequence[Any],
) -> Tuple[List[Dict[str, Any]], List[str]]:
    nonlinear_model = _as_record(parameters.get("nonlinearModel"))
    entries = _structured_entries(
        nonlinear_model,
        "memberPlasticHinges",
        "plasticHinges",
        "memberHinges",
        "hinges",
    )
    if not entries:
        return [], ["nonlinearModel.memberPlasticHinges"]

    line_element_ids = {
        str(_field(element, "id"))
        for element in elements
        if _is_opensees_line_element_type(_element_type(element))
    }
    missing: List[str] = []
    hinges: List[Dict[str, Any]] = []
    seen: set[Tuple[str, str]] = set()
    default_post_yield_ratio = _first_number(
        nonlinear_model.get("postYieldStiffnessRatio"),
        nonlinear_model.get("hardeningRatio"),
        parameters.get("postYieldStiffnessRatio"),
        parameters.get("hardeningRatio"),
    )
    for entry in entries:
        element_id = _first_string(
            entry.get("elementId"),
            entry.get("memberId"),
            entry.get("element"),
            entry.get("member"),
        )
        if not element_id or element_id not in line_element_ids:
            missing.append("nonlinearModel.memberPlasticHinges.elementId")
            continue
        ends = _hinge_ends(entry)
        if not ends:
            missing.append("nonlinearModel.memberPlasticHinges.end")
            continue
        backbone_moment, backbone_rotation = _backbone_yield_point(entry)
        yield_moment = _first_number(
            entry.get("yieldMoment"),
            entry.get("yieldMomentKNm"),
            entry.get("momentYield"),
            entry.get("My"),
            entry.get("positiveYieldMoment"),
            backbone_moment,
        )
        yield_rotation = _first_number(
            entry.get("yieldRotation"),
            entry.get("rotationYield"),
            entry.get("thetaY"),
            entry.get("positiveYieldRotation"),
            backbone_rotation,
        )
        if yield_moment is None or yield_rotation is None or abs(float(yield_moment)) <= 0.0 or abs(float(yield_rotation)) <= 0.0:
            missing.append("nonlinearModel.memberPlasticHingeBackboneCalibration")
            continue
        post_yield_ratio = _first_number(
            entry.get("postYieldStiffnessRatio"),
            entry.get("hardeningRatio"),
            entry.get("b"),
            default_post_yield_ratio,
            0.03,
        )
        for end in ends:
            identity = (element_id, end)
            if identity in seen:
                continue
            seen.add(identity)
            hinges.append({
                "elementId": element_id,
                "end": end,
                "yieldMomentKNm": abs(float(yield_moment)),
                "yieldRotationRad": abs(float(yield_rotation)),
                "postYieldStiffnessRatio": max(float(post_yield_ratio or 0.0), 0.0),
            })
    return hinges, list(dict.fromkeys(missing))


def _convergence_settings(parameters: Dict[str, Any]) -> Dict[str, Any]:
    nonlinear_model = _as_record(parameters.get("nonlinearModel"))
    convergence = _as_record(parameters.get("convergenceCriteria")) or _as_record(nonlinear_model.get("convergenceCriteria"))
    test_name = _first_string(convergence.get("test"), convergence.get("testType")) or "NormDispIncr"
    if test_name not in {"NormDispIncr", "NormUnbalance", "EnergyIncr", "RelativeNormDispIncr"}:
        test_name = "NormDispIncr"
    tolerance = _first_number(convergence.get("tolerance"), convergence.get("tol")) or 1.0e-8
    max_iterations = int(_first_number(convergence.get("maxIterations"), convergence.get("iterations")) or 25)
    return {
        "test": test_name,
        "tolerance": max(float(tolerance), 1.0e-12),
        "maxIterations": max(1, min(max_iterations, 200)),
    }


def _node_key(node: Any) -> str:
    return str(_field(node, "id"))


def _base_and_top(nodes: Sequence[Any], node_tags: Dict[str, int]) -> Tuple[List[int], List[int]]:
    elevations = [float(_field(node, "z", 0.0) or 0.0) for node in nodes]
    if not elevations:
        return [], []
    min_z = min(elevations)
    max_z = max(elevations)
    base = [
        node_tags[_node_key(node)]
        for node in nodes
        if _node_key(node) in node_tags and abs(float(_field(node, "z", 0.0) or 0.0) - min_z) <= 1e-6
    ]
    top = [
        node_tags[_node_key(node)]
        for node in nodes
        if _node_key(node) in node_tags and abs(float(_field(node, "z", 0.0) or 0.0) - max_z) <= 1e-6
    ]
    return base, top


def _control_node_tag(
    nodes: Sequence[Any],
    node_tags: Dict[str, int],
    requested_control_node: Any,
) -> int:
    if requested_control_node is not None:
        key = str(requested_control_node)
        if key in node_tags:
            return node_tags[key]
    _base, top = _base_and_top(nodes, node_tags)
    if top:
        return top[0]
    raise RuntimeError("Unable to select a pushover control node.")


def _lateral_load_for_node(node: Any, max_height: float) -> float:
    z = float(_field(node, "z", 0.0) or 0.0)
    if max_height <= 0.0 or z <= 0.0:
        return 0.0
    return z / max_height


def _interpolate_curve_value(curve: Sequence[Dict[str, Any]], displacement: float) -> Dict[str, float]:
    if not curve:
        return {"roofDisplacement": displacement, "baseShear": 0.0}
    ordered = sorted(curve, key=lambda item: float(item.get("roofDisplacement", 0.0) or 0.0))
    first = ordered[0]
    if displacement <= float(first.get("roofDisplacement", 0.0) or 0.0):
        return {
            "roofDisplacement": round(displacement, 8),
            "baseShear": round(float(first.get("baseShear", 0.0) or 0.0), 6),
        }
    for previous, current in zip(ordered, ordered[1:]):
        d0 = float(previous.get("roofDisplacement", 0.0) or 0.0)
        d1 = float(current.get("roofDisplacement", 0.0) or 0.0)
        if d0 <= displacement <= d1 and d1 > d0:
            v0 = float(previous.get("baseShear", 0.0) or 0.0)
            v1 = float(current.get("baseShear", 0.0) or 0.0)
            ratio = (displacement - d0) / (d1 - d0)
            return {
                "roofDisplacement": round(displacement, 8),
                "baseShear": round(v0 + ratio * (v1 - v0), 6),
            }
    last = ordered[-1]
    return {
        "roofDisplacement": round(displacement, 8),
        "baseShear": round(float(last.get("baseShear", 0.0) or 0.0), 6),
    }


def _interpolate_curve_displacement_for_base_shear(
    curve: Sequence[Dict[str, Any]],
    base_shear: float,
) -> Dict[str, float]:
    if not curve:
        return {"roofDisplacement": 0.0, "baseShear": round(base_shear, 6)}
    points = [
        {"roofDisplacement": 0.0, "baseShear": 0.0},
        *[
            {
                "roofDisplacement": abs(float(point.get("roofDisplacement", 0.0) or 0.0)),
                "baseShear": abs(float(point.get("baseShear", 0.0) or 0.0)),
            }
            for point in curve
            if abs(float(point.get("roofDisplacement", 0.0) or 0.0)) > 1e-12
        ],
    ]
    ordered = sorted(points, key=lambda item: float(item.get("baseShear", 0.0) or 0.0))
    demand = max(float(base_shear), 0.0)
    first = ordered[0]
    if demand <= float(first.get("baseShear", 0.0) or 0.0):
        return {
            "roofDisplacement": round(float(first.get("roofDisplacement", 0.0) or 0.0), 8),
            "baseShear": round(demand, 6),
        }
    for previous, current in zip(ordered, ordered[1:]):
        v0 = float(previous.get("baseShear", 0.0) or 0.0)
        v1 = float(current.get("baseShear", 0.0) or 0.0)
        if v0 <= demand <= v1 and v1 > v0:
            d0 = float(previous.get("roofDisplacement", 0.0) or 0.0)
            d1 = float(current.get("roofDisplacement", 0.0) or 0.0)
            ratio = (demand - v0) / (v1 - v0)
            return {
                "roofDisplacement": round(d0 + ratio * (d1 - d0), 8),
                "baseShear": round(demand, 6),
            }
    last = ordered[-1]
    return {
        "roofDisplacement": round(float(last.get("roofDisplacement", 0.0) or 0.0), 8),
        "baseShear": round(float(last.get("baseShear", 0.0) or 0.0), 6),
    }


def _total_mass_and_weight(floor_masses: Optional[Sequence[Dict[str, Any]]]) -> Tuple[float, float]:
    if not floor_masses:
        return 0.0, 0.0
    total_mass = 0.0
    total_weight = 0.0
    for floor in floor_masses:
        if not isinstance(floor, dict):
            continue
        mass = optional_number(floor.get("mass"))
        weight = optional_number(floor.get("weightKN"))
        if mass is not None:
            total_mass += max(float(mass), 0.0)
        if weight is not None:
            total_weight += max(float(weight), 0.0)
    if total_weight <= 0.0 and total_mass > 0.0:
        total_weight = total_mass * G_ACCEL
    if total_mass <= 0.0 and total_weight > 0.0:
        total_mass = total_weight / G_ACCEL
    return total_mass, total_weight


def _capacity_spectrum_iteration(
    curve: Sequence[Dict[str, Any]],
    *,
    basis: Optional[SeismicDesignBasis],
    floor_masses: Optional[Sequence[Dict[str, Any]]],
    initial_displacement: float,
) -> Optional[Dict[str, Any]]:
    if basis is None:
        return None
    total_mass, total_weight = _total_mass_and_weight(floor_masses)
    if total_mass <= 0.0 or total_weight <= 0.0:
        return None
    positive_points = [
        point for point in curve
        if abs(float(point.get("roofDisplacement", 0.0) or 0.0)) > 1e-12
        and abs(float(point.get("baseShear", 0.0) or 0.0)) > 1e-12
    ]
    if not positive_points:
        return None
    max_displacement = max(abs(float(point.get("roofDisplacement", 0.0) or 0.0)) for point in positive_points)
    if max_displacement <= 0.0:
        return None

    displacement = min(max(abs(float(initial_displacement or 0.0)), max_displacement * 0.10), max_displacement)
    tolerance = 1.0e-4
    history: List[Dict[str, Any]] = []
    converged = False
    current_alpha = 0.0
    current_period = 0.0
    demand_base_shear = 0.0
    for iteration in range(1, 21):
        capacity = _interpolate_curve_value(positive_points, displacement)
        capacity_base_shear = abs(float(capacity.get("baseShear", 0.0) or 0.0))
        secant_stiffness = capacity_base_shear / max(displacement, 1.0e-9)
        if secant_stiffness <= 0.0:
            break
        current_period = 2.0 * math.pi * math.sqrt(total_mass / secant_stiffness)
        current_alpha = seismic_influence_coefficient(current_period, basis)
        demand_base_shear = current_alpha * total_weight
        demand_point = _interpolate_curve_displacement_for_base_shear(positive_points, demand_base_shear)
        next_displacement = min(
            max(abs(float(demand_point.get("roofDisplacement", 0.0) or 0.0)), 1.0e-9),
            max_displacement,
        )
        residual = next_displacement - displacement
        history.append({
            "iteration": iteration,
            "roofDisplacementM": round(displacement, 8),
            "capacityBaseShearKN": round(capacity_base_shear, 6),
            "demandBaseShearKN": round(demand_base_shear, 6),
            "secantPeriodSec": round(current_period, 6),
            "alpha": round(current_alpha, 6),
            "nextRoofDisplacementM": round(next_displacement, 8),
            "residualM": round(residual, 8),
        })
        if abs(residual) <= max(tolerance * max_displacement, 1.0e-6):
            displacement = next_displacement
            converged = True
            break
        displacement = 0.5 * displacement + 0.5 * next_displacement

    performance = _interpolate_curve_value(positive_points, displacement)
    return {
        "status": "estimated",
        "method": "secant_capacity_spectrum_iteration",
        "converged": converged,
        "iterationCount": len(history),
        "roofDisplacementM": round(abs(float(performance.get("roofDisplacement", 0.0) or 0.0)), 8),
        "baseShearKN": round(abs(float(performance.get("baseShear", 0.0) or 0.0)), 6),
        "demandBaseShearKN": round(demand_base_shear, 6),
        "secantPeriodSec": round(current_period, 6),
        "alpha": round(current_alpha, 6),
        "totalWeightKN": round(total_weight, 6),
        "totalMass": round(total_mass, 6),
        "history": history,
        "limitations": [
            "Secant capacity-spectrum iteration on the computed pushover curve; not a full nonlinear performance-based design procedure.",
        ],
    }


def _capacity_assessment(
    curve: Sequence[Dict[str, Any]],
    *,
    target_displacement: float,
    max_height: float,
    parameters: Dict[str, Any],
    basis: Optional[SeismicDesignBasis] = None,
    floor_masses: Optional[Sequence[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    positive_points = [
        point for point in curve
        if abs(float(point.get("roofDisplacement", 0.0) or 0.0)) > 1e-12
    ]
    if not positive_points:
        return {
            "status": "unavailable",
            "warnings": ["Pushover curve has no positive displacement points for capacity assessment."],
        }
    first = positive_points[0]
    initial_stiffness = float(first.get("baseShear", 0.0) or 0.0) / max(abs(float(first.get("roofDisplacement", 0.0) or 0.0)), 1e-12)
    yield_point = None
    previous = positive_points[0]
    for point in positive_points[1:]:
        d0 = float(previous.get("roofDisplacement", 0.0) or 0.0)
        d1 = float(point.get("roofDisplacement", 0.0) or 0.0)
        if abs(d1 - d0) <= 1e-12:
            previous = point
            continue
        tangent = (float(point.get("baseShear", 0.0) or 0.0) - float(previous.get("baseShear", 0.0) or 0.0)) / (d1 - d0)
        if tangent < 0.80 * initial_stiffness:
            yield_point = {
                "roofDisplacement": round(abs(d1), 8),
                "baseShear": round(float(point.get("baseShear", 0.0) or 0.0), 6),
                "tangentStiffness": round(tangent, 6),
            }
            break
        previous = point
    max_displacement = max(abs(float(point.get("roofDisplacement", 0.0) or 0.0)) for point in curve)
    max_base_shear = max(abs(float(point.get("baseShear", 0.0) or 0.0)) for point in curve)
    capacity_spectrum_iteration = _capacity_spectrum_iteration(
        curve,
        basis=basis,
        floor_masses=floor_masses,
        initial_displacement=target_displacement,
    )
    explicit_performance_displacement = optional_number(
        parameters.get("performanceTargetDisplacement")
        or parameters.get("performancePointDisplacement")
    )
    performance_displacement = (
        explicit_performance_displacement
        or (
            optional_number(capacity_spectrum_iteration.get("roofDisplacementM"))
            if isinstance(capacity_spectrum_iteration, dict)
            else None
        )
        or target_displacement
    )
    performance = _interpolate_curve_value(curve, float(performance_displacement))
    drift_ratio = abs(performance["roofDisplacement"]) / max(max_height, 1e-9)
    performance_objective = _performance_objective(parameters)
    acceptance_drift = (
        optional_number(parameters.get("acceptanceDriftRatio"))
        or optional_number(performance_objective.get("acceptanceDriftRatio"))
        or 0.02
    )
    warnings: List[str] = []
    if yield_point is None:
        warnings.append("No post-yield stiffness degradation was detected; performance point is based on elastic pushover curve only.")
    return {
        "status": "estimated",
        "method": "capacity_spectrum_from_pushover_curve",
        "initialStiffnessKNPerM": round(initial_stiffness, 6),
        "yieldDetected": yield_point is not None,
        "yieldPoint": yield_point,
        "maxBaseShearKN": round(max_base_shear, 6),
        "maxRoofDisplacementM": round(max_displacement, 8),
        "capacitySpectrumIteration": capacity_spectrum_iteration,
        "performancePoint": {
            "roofDisplacementM": performance["roofDisplacement"],
            "baseShearKN": performance["baseShear"],
            "driftRatio": round(drift_ratio, 8),
            "source": (
                "structuredPerformanceTarget"
                if explicit_performance_displacement is not None
                else "secantCapacitySpectrumIteration"
                if capacity_spectrum_iteration
                else "targetDisplacement"
            ),
        },
        "acceptanceCheck": {
            "limitDriftRatio": round(float(acceptance_drift), 8),
            "status": "pass" if drift_ratio <= float(acceptance_drift) else "fail",
            "utilization": round(drift_ratio / max(float(acceptance_drift), 1e-12), 6),
            "basis": "structured performance objective or pushover.acceptanceDriftRatio; performance point from structured target or secant capacity-spectrum iteration",
            **({"performanceObjective": performance_objective} if performance_objective else {}),
        },
        "warnings": warnings,
    }


def _pushover_bilinear_parameters(
    *,
    capacity_assessment: Dict[str, Any],
    target_displacement: float,
    max_height: float,
    parameters: Dict[str, Any],
    basis: SeismicDesignBasis,
) -> Dict[str, Any]:
    initial_stiffness = optional_number(capacity_assessment.get("initialStiffnessKNPerM")) or 1.0
    yield_displacement = optional_number(
        parameters.get("yieldDisplacementM")
        or parameters.get("yieldDisplacement")
        or parameters.get("yieldRoofDisplacementM")
    )
    assumptions: List[str] = []
    yield_drift = optional_number(parameters.get("yieldDriftRatio") or parameters.get("yieldStoryDriftRatio"))
    yield_drift_metadata: Optional[Dict[str, Any]] = None
    if yield_displacement is None:
        if yield_drift is None:
            yield_drift_metadata = gb50011_advisory_yield_drift_metadata(getattr(basis, "structural_family", ""))
            yield_drift = float(yield_drift_metadata["limit"])
        yield_displacement = yield_drift * max(max_height, 1.0)
        if yield_drift_metadata is not None:
            assumptions.append(
                "No pushover yield drift was provided; used "
                f"{yield_drift_metadata['familyLabel']} elastic drift limit "
                f"1/{yield_drift_metadata['denominator']} as an advisory yield displacement."
            )
    post_yield_ratio = optional_number(
        parameters.get("postYieldStiffnessRatio")
        or parameters.get("hardeningRatio")
        or parameters.get("b")
    )
    if post_yield_ratio is None:
        post_yield_ratio = 0.03
        assumptions.append("No pushover post-yield stiffness ratio was provided; used 0.03 for the bilinear estimate.")
    performance_objective = _performance_objective(parameters)
    acceptance_drift = (
        optional_number(parameters.get("acceptanceDriftRatio"))
        or optional_number(performance_objective.get("acceptanceDriftRatio"))
        or 0.02
    )
    return {
        "initialStiffnessKNPerM": max(float(initial_stiffness), 1e-9),
        "yieldDisplacementM": max(float(yield_displacement or 0.0), 1e-9),
        "yieldBaseShearKN": max(float(initial_stiffness), 1e-9) * max(float(yield_displacement or 0.0), 1e-9),
        **({"yieldDriftRatio": float(yield_drift)} if yield_drift is not None else {}),
        **({
            "yieldDriftSource": yield_drift_metadata["source"],
            "yieldDriftLimitFamily": yield_drift_metadata["familyLabel"],
            "yieldDriftLimitRatioText": f"1/{yield_drift_metadata['denominator']}",
            "yieldDriftIsFallback": bool(yield_drift_metadata.get("isFallback")),
        } if yield_drift_metadata is not None else {}),
        "postYieldStiffnessRatio": max(float(post_yield_ratio or 0.0), 0.0),
        "targetDisplacementM": target_displacement,
        "acceptanceDriftRatio": float(acceptance_drift),
        "performanceObjective": performance_objective,
        "assumptions": assumptions,
    }


def _run_bilinear_sdof_pushover_estimate(
    ops: Any,
    *,
    capacity_assessment: Dict[str, Any],
    target_displacement: float,
    max_height: float,
    steps: int,
    parameters: Dict[str, Any],
    basis: SeismicDesignBasis,
) -> Dict[str, Any]:
    params = _pushover_bilinear_parameters(
        capacity_assessment=capacity_assessment,
        target_displacement=target_displacement,
        max_height=max_height,
        parameters=parameters,
        basis=basis,
    )
    increment = target_displacement / max(steps, 1)
    curve: List[Dict[str, Any]] = []
    converged = True
    try:
        ops.wipe()
        ops.model("basic", "-ndm", 1, "-ndf", 1)
        ops.node(1, 0.0)
        ops.node(2, 0.0)
        ops.fix(1, 1)
        ops.uniaxialMaterial(
            "Steel01",
            1,
            params["yieldBaseShearKN"],
            params["initialStiffnessKNPerM"],
            params["postYieldStiffnessRatio"],
        )
        ops.element("zeroLength", 1, 1, 2, "-mat", 1, "-dir", 1)
        ops.timeSeries("Linear", 1)
        ops.pattern("Plain", 1, 1)
        ops.load(2, 1.0)
        ops.constraints("Plain")
        ops.numberer("Plain")
        ops.system("BandGeneral")
        ops.test("NormDispIncr", 1.0e-8, 20)
        ops.algorithm("Newton")
        ops.integrator("DisplacementControl", 2, 1, increment)
        ops.analysis("Static")
        for step in range(steps):
            if ops.analyze(1) != 0:
                converged = False
                break
            displacement = float(ops.nodeDisp(2, 1))
            try:
                forces = ops.eleForce(1)
                base_shear = max(abs(float(value)) for value in forces)
            except Exception:
                elastic = params["initialStiffnessKNPerM"] * min(abs(displacement), params["yieldDisplacementM"])
                plastic = params["initialStiffnessKNPerM"] * params["postYieldStiffnessRatio"] * max(abs(displacement) - params["yieldDisplacementM"], 0.0)
                base_shear = elastic + plastic
            curve.append({
                "step": step + 1,
                "roofDisplacement": round(displacement, 8),
                "baseShear": round(base_shear, 6),
                "ductility": round(abs(displacement) / max(params["yieldDisplacementM"], 1e-12), 6),
            })
    except Exception as error:
        return {
            "status": "estimate_failed",
            "engineMode": "opensees_bilinear_sdof_pushover_estimate",
            "warnings": [f"OpenSees bilinear SDOF pushover estimate failed: {error}"],
            "implementedCapabilities": [],
        }
    finally:
        try:
            ops.wipe()
        except Exception:
            pass

    performance = _interpolate_curve_value(curve, target_displacement)
    drift_ratio = abs(performance["roofDisplacement"]) / max(max_height, 1e-9)
    acceptance_drift = float(params["acceptanceDriftRatio"])
    return {
        "status": "estimated",
        "engineMode": "opensees_bilinear_sdof_pushover_estimate",
        "curve": curve,
        "parameters": {
            "initialStiffnessKNPerM": round(params["initialStiffnessKNPerM"], 6),
            "yieldDisplacementM": round(params["yieldDisplacementM"], 8),
            "yieldBaseShearKN": round(params["yieldBaseShearKN"], 6),
            **({"yieldDriftRatio": round(float(params["yieldDriftRatio"]), 8)} if params.get("yieldDriftRatio") is not None else {}),
            **({"yieldDriftSource": params["yieldDriftSource"]} if params.get("yieldDriftSource") else {}),
            **({"yieldDriftLimitFamily": params["yieldDriftLimitFamily"]} if params.get("yieldDriftLimitFamily") else {}),
            **({"yieldDriftLimitRatioText": params["yieldDriftLimitRatioText"]} if params.get("yieldDriftLimitRatioText") else {}),
            **({"yieldDriftIsFallback": bool(params["yieldDriftIsFallback"])} if params.get("yieldDriftIsFallback") is not None else {}),
            "postYieldStiffnessRatio": round(params["postYieldStiffnessRatio"], 6),
            **({"performanceObjective": params["performanceObjective"]} if isinstance(params.get("performanceObjective"), dict) and params["performanceObjective"] else {}),
        },
        "performancePoint": {
            "roofDisplacementM": performance["roofDisplacement"],
            "baseShearKN": performance["baseShear"],
            "driftRatio": round(drift_ratio, 8),
        },
        "acceptanceCheck": {
            "limitDriftRatio": round(acceptance_drift, 8),
            "status": "pass" if drift_ratio <= acceptance_drift else "fail",
            "utilization": round(drift_ratio / max(acceptance_drift, 1e-12), 6),
            **({"performanceObjective": params["performanceObjective"]} if isinstance(params.get("performanceObjective"), dict) and params["performanceObjective"] else {}),
        },
        "converged": converged,
        "completedSteps": len(curve),
        "requestedSteps": steps,
        "implementedCapabilities": [PUSHOVER_BILINEAR_SDOF_CAPABILITY],
        "missingInputs": [
            "nonlinearModel.fullMemberConstitutiveModels",
            "nonlinearModel.memberPlasticHingeBackboneCalibration",
        ],
        "assumptions": params["assumptions"],
    }


def _story_shear_definition(
    floor_masses: Sequence[Dict[str, Any]],
    *,
    capacity_assessment: Dict[str, Any],
    target_displacement: float,
    max_height: float,
    parameters: Dict[str, Any],
    basis: SeismicDesignBasis,
) -> Optional[Dict[str, Any]]:
    floors = [
        floor for floor in sorted(
            floor_masses,
            key=lambda item: float(item.get("elevation", 0.0) or 0.0),
        )
        if isinstance(floor, dict)
        and float(floor.get("elevation", 0.0) or 0.0) > 0.0
    ]
    if len(floors) < 2:
        return None

    params = _pushover_bilinear_parameters(
        capacity_assessment=capacity_assessment,
        target_displacement=target_displacement,
        max_height=max_height,
        parameters=parameters,
        basis=basis,
    )
    story_heights: List[float] = []
    lower_elevation = 0.0
    for floor in floors:
        elevation = float(floor.get("elevation", 0.0) or 0.0)
        height = elevation - lower_elevation
        if height <= 1e-9:
            height = max_height / len(floors)
        story_heights.append(height)
        lower_elevation = elevation

    story_count = len(floors)
    story_stiffness = float(params["initialStiffnessKNPerM"]) * story_count
    yield_drift = float(params["yieldDisplacementM"]) / max(sum(story_heights), 1e-9)
    return {
        "floors": floors,
        "storyHeights": story_heights,
        "storyStiffnesses": [story_stiffness] * story_count,
        "yieldDeformations": [max(yield_drift * height, 1e-9) for height in story_heights],
        "postYieldStiffnessRatio": float(params["postYieldStiffnessRatio"]),
        "targetDisplacementM": target_displacement,
        "acceptanceDriftRatio": float(params["acceptanceDriftRatio"]),
        "parameters": params,
    }


def _run_bilinear_story_shear_pushover_estimate(
    ops: Any,
    *,
    floor_masses: Sequence[Dict[str, Any]],
    capacity_assessment: Dict[str, Any],
    target_displacement: float,
    max_height: float,
    steps: int,
    parameters: Dict[str, Any],
    basis: SeismicDesignBasis,
) -> Optional[Dict[str, Any]]:
    definition = _story_shear_definition(
        floor_masses,
        capacity_assessment=capacity_assessment,
        target_displacement=target_displacement,
        max_height=max_height,
        parameters=parameters,
        basis=basis,
    )
    if definition is None:
        return None

    floors = definition["floors"]
    story_heights = definition["storyHeights"]
    stiffnesses = definition["storyStiffnesses"]
    yield_deformations = definition["yieldDeformations"]
    post_yield_ratio = float(definition["postYieldStiffnessRatio"])
    increment = target_displacement / max(steps, 1)
    curve: List[Dict[str, Any]] = []
    converged = True
    try:
        ops.wipe()
        ops.model("basic", "-ndm", 1, "-ndf", 1)
        node_tags = [index + 1 for index in range(len(floors) + 1)]
        for tag in node_tags:
            ops.node(tag, 0.0)
        ops.fix(node_tags[0], 1)
        for index, stiffness in enumerate(stiffnesses):
            mat_tag = index + 1
            element_tag = index + 1
            yield_force = max(float(stiffness) * float(yield_deformations[index]), 1e-9)
            ops.uniaxialMaterial("Steel01", mat_tag, yield_force, float(stiffness), post_yield_ratio)
            ops.element("zeroLength", element_tag, node_tags[index], node_tags[index + 1], "-mat", mat_tag, "-dir", 1)
        ops.timeSeries("Linear", 1)
        ops.pattern("Plain", 1, 1)
        for index, floor in enumerate(floors):
            load = float(floor.get("elevation", 0.0) or 0.0) / max(max_height, 1e-9)
            ops.load(node_tags[index + 1], load)
        ops.constraints("Plain")
        ops.numberer("Plain")
        ops.system("BandGeneral")
        ops.test("NormDispIncr", 1.0e-8, 25)
        ops.algorithm("Newton")
        ops.integrator("DisplacementControl", node_tags[-1], 1, increment)
        ops.analysis("Static")
        for step in range(steps):
            if ops.analyze(1) != 0:
                converged = False
                break
            floor_displacements = [float(ops.nodeDisp(tag, 1)) for tag in node_tags[1:]]
            lower_displacement = 0.0
            story_responses: List[Dict[str, Any]] = []
            for index, displacement in enumerate(floor_displacements):
                interstory = displacement - lower_displacement
                story_responses.append({
                    "story": floors[index].get("story") or f"F{index + 1}",
                    "elevation": round(float(floors[index].get("elevation", 0.0) or 0.0), 6),
                    "storyHeightM": round(float(story_heights[index]), 6),
                    "interstoryDisplacementM": round(interstory, 8),
                    "driftRatio": round(abs(interstory) / max(float(story_heights[index]), 1e-9), 8),
                    "ductility": round(abs(interstory) / max(float(yield_deformations[index]), 1e-12), 6),
                })
                lower_displacement = displacement
            try:
                forces = ops.eleForce(1)
                base_shear = max(abs(float(value)) for value in forces)
            except Exception:
                base_shear = abs(floor_displacements[0]) * float(stiffnesses[0])
            curve.append({
                "step": step + 1,
                "roofDisplacement": round(floor_displacements[-1], 8),
                "baseShear": round(base_shear, 6),
                "maxStoryDriftRatio": round(max((float(item["driftRatio"]) for item in story_responses), default=0.0), 8),
                "storyResponses": story_responses,
            })
    except Exception as error:
        return {
            "status": "estimate_failed",
            "engineMode": "opensees_bilinear_story_shear_pushover_estimate",
            "warnings": [f"OpenSees bilinear story-shear pushover estimate failed: {error}"],
            "implementedCapabilities": [],
        }
    finally:
        try:
            ops.wipe()
        except Exception:
            pass

    performance = _interpolate_curve_value(curve, target_displacement)
    controlling_story: Dict[str, Any] = {}
    for point in curve:
        for story in point.get("storyResponses", []):
            if not isinstance(story, dict):
                continue
            current = float(story.get("driftRatio", 0.0) or 0.0)
            previous = float(controlling_story.get("driftRatio", -1.0) or -1.0) if controlling_story else -1.0
            if current > previous:
                controlling_story = {**story, "step": point.get("step")}
    max_drift = float(controlling_story.get("driftRatio", 0.0) or 0.0)
    acceptance_drift = float(definition["acceptanceDriftRatio"])
    params = definition["parameters"]
    return {
        "status": "estimated",
        "engineMode": "opensees_bilinear_story_shear_pushover_estimate",
        "modelScope": "bilinear_story_shear_building",
        "curve": curve,
        "parameters": {
            "initialStiffnessKNPerM": round(float(params["initialStiffnessKNPerM"]), 6),
            "yieldDisplacementM": round(float(params["yieldDisplacementM"]), 8),
            "yieldBaseShearKN": round(float(params["yieldBaseShearKN"]), 6),
            **({"yieldDriftRatio": round(float(params["yieldDriftRatio"]), 8)} if params.get("yieldDriftRatio") is not None else {}),
            **({"yieldDriftSource": params["yieldDriftSource"]} if params.get("yieldDriftSource") else {}),
            **({"yieldDriftLimitFamily": params["yieldDriftLimitFamily"]} if params.get("yieldDriftLimitFamily") else {}),
            **({"yieldDriftLimitRatioText": params["yieldDriftLimitRatioText"]} if params.get("yieldDriftLimitRatioText") else {}),
            **({"yieldDriftIsFallback": bool(params["yieldDriftIsFallback"])} if params.get("yieldDriftIsFallback") is not None else {}),
            "postYieldStiffnessRatio": round(float(params["postYieldStiffnessRatio"]), 6),
            "storyCount": len(floors),
            "storyStiffnessKNPerM": round(float(stiffnesses[0]), 6),
            **({"performanceObjective": params["performanceObjective"]} if isinstance(params.get("performanceObjective"), dict) and params["performanceObjective"] else {}),
        },
        "performancePoint": {
            "roofDisplacementM": performance["roofDisplacement"],
            "baseShearKN": performance["baseShear"],
            "driftRatio": round(max_drift, 8),
        },
        "controllingStory": controlling_story,
        "acceptanceCheck": {
            "limitDriftRatio": round(acceptance_drift, 8),
            "status": "pass" if max_drift <= acceptance_drift else "fail",
            "utilization": round(max_drift / max(acceptance_drift, 1e-12), 6),
            **({"performanceObjective": params["performanceObjective"]} if isinstance(params.get("performanceObjective"), dict) and params["performanceObjective"] else {}),
        },
        "converged": converged,
        "completedSteps": len(curve),
        "requestedSteps": steps,
        "implementedCapabilities": [
            PUSHOVER_BILINEAR_SDOF_CAPABILITY,
            PUSHOVER_BILINEAR_STORY_SHEAR_CAPABILITY,
        ],
        "missingInputs": [
            "nonlinearModel.fullMemberConstitutiveModels",
            "nonlinearModel.memberPlasticHingeBackboneCalibration",
        ],
        "assumptions": params["assumptions"],
    }


def _run_member_hinge_2d_pushover_estimate(
    ops: Any,
    *,
    model: Any,
    basis: SeismicDesignBasis,
    parameters: Dict[str, Any],
    direction: str,
    target_displacement: float,
    max_height: float,
    steps: int,
) -> Optional[Dict[str, Any]]:
    payload = model_payload(model)
    nodes = _records(payload, model, "nodes")
    elements = _records(payload, model, "elements")
    if _model_dimension(list(nodes)) != "2d" or direction.lower() != "x":
        return None

    nonlinear_model = _as_record(parameters.get("nonlinearModel"))
    hinges, missing_inputs = _member_plastic_hinge_definitions(parameters, elements)
    if not hinges:
        if not nonlinear_model:
            return None
        return {
            "status": "estimate_failed",
            "engineMode": "opensees_member_end_plastic_hinge_2d_pushover_estimate",
            "modelScope": "member_end_rotational_plastic_hinges_2d",
            "warnings": ["Structured nonlinearModel was provided, but no complete 2D member plastic hinge definitions were available."],
            "implementedCapabilities": [],
            "missingInputs": missing_inputs,
        }

    sections = _section_map(_records(payload, model, "sections"))
    materials = _material_map(_records(payload, model, "materials"))
    node_lookup = {_node_key(node): node for node in nodes}
    node_tags = {_node_key(node): index + 1 for index, node in enumerate(nodes)}
    hinge_by_element_end = {
        (str(hinge["elementId"]), str(hinge["end"])): hinge
        for hinge in hinges
    }
    convergence = _convergence_settings(parameters)
    performance_objective = _performance_objective(parameters)
    acceptance_drift = (
        optional_number(parameters.get("acceptanceDriftRatio"))
        or optional_number(performance_objective.get("acceptanceDriftRatio"))
        or 0.02
    )
    increment = target_displacement / max(steps, 1)
    control_tag = _control_node_tag(nodes, node_tags, parameters.get("controlNode"))
    base_tags, _top_tags = _base_and_top(nodes, node_tags)
    if not base_tags:
        return {
            "status": "estimate_failed",
            "engineMode": "opensees_member_end_plastic_hinge_2d_pushover_estimate",
            "modelScope": "member_end_rotational_plastic_hinges_2d",
            "warnings": ["Unable to identify base nodes for member-end plastic-hinge pushover estimate."],
            "implementedCapabilities": [],
            "missingInputs": missing_inputs,
        }

    curve: List[Dict[str, Any]] = []
    hinge_runtime: List[Dict[str, Any]] = []
    hinge_peaks: Dict[str, Dict[str, Any]] = {}
    converged = True
    try:
        ops.wipe()
        ops.model("basic", "-ndm", 2, "-ndf", 3)
        for node in nodes:
            key = _node_key(node)
            tag = node_tags[key]
            ops.node(tag, float(_field(node, "x", 0.0) or 0.0), float(_field(node, "z", 0.0) or 0.0))
            restraints = _restraints_for_node(node, "2d")
            if any(restraints):
                ops.fix(tag, *restraints)

        next_node_tag = len(node_tags) + 1
        next_element_tag = 1
        next_material_tag = 100_001
        for element in elements:
            element_type = _element_type(element)
            if not _is_opensees_line_element_type(element_type):
                continue
            element_nodes = _element_nodes(element)
            if len(element_nodes) < 2 or element_nodes[0] not in node_lookup or element_nodes[1] not in node_lookup:
                continue
            section = sections.get(str(_field(element, "section", "")))
            if section is None:
                continue
            material = materials.get(str(_field(element, "material", "")))
            area, iy, iz, _torsion = _effective_section_properties(element_type, section)
            inertia = max(iy, iz, 1.0e-8)
            e_modulus = _material_e(material, section)
            element_id = str(_field(element, "id"))
            member_node_tags: List[int] = []
            for end, node_id in (("i", element_nodes[0]), ("j", element_nodes[1])):
                hinge = hinge_by_element_end.get((element_id, end))
                if not hinge:
                    member_node_tags.append(node_tags[node_id])
                    continue
                source_node = node_lookup[node_id]
                physical_tag = node_tags[node_id]
                duplicate_tag = next_node_tag
                next_node_tag += 1
                ops.node(
                    duplicate_tag,
                    float(_field(source_node, "x", 0.0) or 0.0),
                    float(_field(source_node, "z", 0.0) or 0.0),
                )
                ops.equalDOF(physical_tag, duplicate_tag, 1, 2)
                yield_moment = max(float(hinge["yieldMomentKNm"]), 1.0e-9)
                yield_rotation = max(float(hinge["yieldRotationRad"]), 1.0e-9)
                elastic_rotational_stiffness = yield_moment / yield_rotation
                material_tag = next_material_tag
                next_material_tag += 1
                hinge_element_tag = 200_000 + len(hinge_runtime) + 1
                ops.uniaxialMaterial(
                    "Steel01",
                    material_tag,
                    yield_moment,
                    elastic_rotational_stiffness,
                    float(hinge["postYieldStiffnessRatio"]),
                )
                ops.element("zeroLength", hinge_element_tag, physical_tag, duplicate_tag, "-mat", material_tag, "-dir", 3)
                member_node_tags.append(duplicate_tag)
                hinge_runtime.append({
                    "id": f"{element_id}:{end}",
                    "elementId": element_id,
                    "end": end,
                    "physicalTag": physical_tag,
                    "duplicateTag": duplicate_tag,
                    "zeroLengthElementTag": hinge_element_tag,
                    "yieldMomentKNm": yield_moment,
                    "yieldRotationRad": yield_rotation,
                    "postYieldStiffnessRatio": float(hinge["postYieldStiffnessRatio"]),
                })
            if len(member_node_tags) < 2 or member_node_tags[0] == member_node_tags[1]:
                continue
            element_tag = next_element_tag
            next_element_tag += 1
            ops.geomTransf("Linear", element_tag)
            ops.element(
                "elasticBeamColumn",
                element_tag,
                member_node_tags[0],
                member_node_tags[1],
                area,
                e_modulus,
                inertia,
                element_tag,
            )

        if not hinge_runtime:
            return {
                "status": "estimate_failed",
                "engineMode": "opensees_member_end_plastic_hinge_2d_pushover_estimate",
                "modelScope": "member_end_rotational_plastic_hinges_2d",
                "warnings": ["Structured plastic hinges did not map to any OpenSees 2D line element ends."],
                "implementedCapabilities": [],
                "missingInputs": list(dict.fromkeys([*missing_inputs, "nonlinearModel.memberPlasticHinges.elementId"])),
            }

        ops.timeSeries("Linear", 30_001)
        ops.pattern("Plain", 30_001, 30_001)
        for node in nodes:
            key = _node_key(node)
            load = _lateral_load_for_node(node, max_height)
            if load > 0.0:
                ops.load(node_tags[key], load, 0.0, 0.0)

        ops.wipeAnalysis()
        ops.constraints("Transformation")
        ops.numberer("RCM")
        ops.system("BandGeneral")
        ops.test(convergence["test"], convergence["tolerance"], convergence["maxIterations"])
        ops.algorithm("Newton")
        ops.integrator("DisplacementControl", control_tag, 1, increment)
        ops.analysis("Static")
        for step in range(steps):
            if ops.analyze(1) != 0:
                converged = False
                break
            roof_displacement = float(ops.nodeDisp(control_tag, 1))
            try:
                ops.reactions()
                base_shear = abs(sum(float(ops.nodeReaction(tag, 1)) for tag in base_tags))
            except Exception:
                base_shear = 0.0
            step_hinge_responses: List[Dict[str, Any]] = []
            for hinge in hinge_runtime:
                rotation = abs(
                    float(ops.nodeDisp(int(hinge["duplicateTag"]), 3))
                    - float(ops.nodeDisp(int(hinge["physicalTag"]), 3))
                )
                ductility = rotation / max(float(hinge["yieldRotationRad"]), 1.0e-12)
                response = {
                    "id": hinge["id"],
                    "elementId": hinge["elementId"],
                    "end": hinge["end"],
                    "rotationRad": round(rotation, 8),
                    "yieldRotationRad": round(float(hinge["yieldRotationRad"]), 8),
                    "ductility": round(ductility, 6),
                    "yieldMomentKNm": round(float(hinge["yieldMomentKNm"]), 6),
                    "step": step + 1,
                }
                step_hinge_responses.append(response)
                previous = hinge_peaks.get(str(hinge["id"]))
                if previous is None or ductility > float(previous.get("ductility", 0.0) or 0.0):
                    hinge_peaks[str(hinge["id"])] = response
            curve.append({
                "step": step + 1,
                "roofDisplacement": round(roof_displacement, 8),
                "baseShear": round(base_shear, 6),
                "driftRatio": round(abs(roof_displacement) / max(max_height, 1.0e-9), 8),
                "maxHingeDuctility": round(max((float(item["ductility"]) for item in step_hinge_responses), default=0.0), 6),
            })
    except Exception as error:
        return {
            "status": "estimate_failed",
            "engineMode": "opensees_member_end_plastic_hinge_2d_pushover_estimate",
            "modelScope": "member_end_rotational_plastic_hinges_2d",
            "warnings": [f"OpenSees member-end plastic-hinge pushover estimate failed: {error}"],
            "implementedCapabilities": [],
            "missingInputs": missing_inputs,
        }
    finally:
        try:
            ops.wipe()
        except Exception:
            pass

    if not curve:
        return {
            "status": "estimate_failed",
            "engineMode": "opensees_member_end_plastic_hinge_2d_pushover_estimate",
            "modelScope": "member_end_rotational_plastic_hinges_2d",
            "warnings": ["Member-end plastic-hinge pushover estimate did not complete any displacement step."],
            "implementedCapabilities": [],
            "missingInputs": missing_inputs,
        }

    performance = _interpolate_curve_value(curve, target_displacement)
    drift_ratio = abs(float(performance["roofDisplacement"])) / max(max_height, 1.0e-9)
    controlling_hinge = max(
        hinge_peaks.values(),
        key=lambda item: float(item.get("ductility", 0.0) or 0.0),
        default={},
    )
    return {
        "status": "estimated",
        "engineMode": "opensees_member_end_plastic_hinge_2d_pushover_estimate",
        "modelScope": "member_end_rotational_plastic_hinges_2d",
        "curve": curve,
        "parameters": {
            "hingeCount": len(hinge_runtime),
            "targetDisplacementM": round(float(target_displacement), 8),
            "acceptanceDriftRatio": round(float(acceptance_drift), 8),
            "convergenceCriteria": convergence,
            **({"performanceObjective": performance_objective} if performance_objective else {}),
        },
        "performancePoint": {
            "roofDisplacementM": performance["roofDisplacement"],
            "baseShearKN": performance["baseShear"],
            "driftRatio": round(drift_ratio, 8),
            "maxHingeDuctility": controlling_hinge.get("ductility") if controlling_hinge else None,
        },
        "hingeResponses": list(hinge_peaks.values()),
        "controllingHinge": controlling_hinge,
        "acceptanceCheck": {
            "limitDriftRatio": round(float(acceptance_drift), 8),
            "status": "pass" if drift_ratio <= float(acceptance_drift) else "fail",
            "utilization": round(drift_ratio / max(float(acceptance_drift), 1.0e-12), 6),
            **({"performanceObjective": performance_objective} if performance_objective else {}),
        },
        "converged": converged,
        "completedSteps": len(curve),
        "requestedSteps": steps,
        "implementedCapabilities": [PUSHOVER_MEMBER_HINGE_2D_CAPABILITY],
        "missingInputs": list(dict.fromkeys([*missing_inputs, "nonlinearModel.fullMemberConstitutiveModels"])),
        "warnings": [
            "Restricted OpenSees 2D member-end rotational plastic-hinge pushover estimate; full distributed inelastic member modeling is still outside this solver path.",
        ],
    }


def _final_compliance_assessment(
    *,
    capacity_assessment: Dict[str, Any],
    nonlinear_estimate: Dict[str, Any],
) -> Dict[str, Any]:
    nonlinear_acceptance = (
        nonlinear_estimate.get("acceptanceCheck")
        if isinstance(nonlinear_estimate.get("acceptanceCheck"), dict)
        else {}
    )
    nonlinear_performance = (
        nonlinear_estimate.get("performancePoint")
        if isinstance(nonlinear_estimate.get("performancePoint"), dict)
        else {}
    )
    if nonlinear_acceptance:
        utilization = optional_number(nonlinear_acceptance.get("utilization"))
        drift = optional_number(nonlinear_performance.get("driftRatio"))
        limit = optional_number(nonlinear_acceptance.get("limitDriftRatio"))
        status = str(nonlinear_acceptance.get("status") or "").strip().lower()
        model_scope = str(nonlinear_estimate.get("modelScope") or nonlinear_estimate.get("engineMode") or "").strip()
        performance_objective = _performance_objective(nonlinear_acceptance)
        if model_scope == "member_end_rotational_plastic_hinges_2d":
            scope = "OpenSees 2D member-end rotational plastic-hinge nonlinear pushover estimate"
        elif model_scope == "bilinear_story_shear_building":
            scope = "OpenSees bilinear story-shear building nonlinear pushover estimate"
        else:
            scope = "OpenSees bilinear SDOF nonlinear estimate calibrated from the elastic pushover curve"
        return {
            "status": "pass" if status == "pass" and (utilization is None or utilization <= 1.0) else "fail",
            "method": "nonlinear_pushover_drift_acceptance",
            "source": "pushover.nonlinearEstimate.acceptanceCheck",
            "scope": scope,
            "driftRatio": round(float(drift), 8) if drift is not None else None,
            "limitDriftRatio": round(float(limit), 8) if limit is not None else None,
            "utilization": round(float(utilization), 6) if utilization is not None else None,
            **({"performanceObjective": performance_objective} if performance_objective else {}),
            "clauseBasis": "GB 55002-2021 + GB/T 50011-2010(2024) rare-earthquake elastic-plastic deformation acceptance concept",
        }

    capacity_acceptance = (
        capacity_assessment.get("acceptanceCheck")
        if isinstance(capacity_assessment.get("acceptanceCheck"), dict)
        else {}
    )
    performance = (
        capacity_assessment.get("performancePoint")
        if isinstance(capacity_assessment.get("performancePoint"), dict)
        else {}
    )
    if capacity_acceptance:
        utilization = optional_number(capacity_acceptance.get("utilization"))
        drift = optional_number(performance.get("driftRatio"))
        limit = optional_number(capacity_acceptance.get("limitDriftRatio"))
        status = str(capacity_acceptance.get("status") or "").strip().lower()
        performance_objective = _performance_objective(capacity_acceptance)
        return {
            "status": "pass" if status == "pass" and (utilization is None or utilization <= 1.0) else "fail",
            "method": "pushover_capacity_curve_drift_acceptance",
            "source": "pushover.capacityAssessment.acceptanceCheck",
            "scope": "capacity-curve performance point from OpenSees static pushover",
            "driftRatio": round(float(drift), 8) if drift is not None else None,
            "limitDriftRatio": round(float(limit), 8) if limit is not None else None,
            "utilization": round(float(utilization), 6) if utilization is not None else None,
            **({"performanceObjective": performance_objective} if performance_objective else {}),
            "clauseBasis": "GB 55002-2021 + GB/T 50011-2010(2024) rare-earthquake elastic-plastic deformation acceptance concept",
        }

    return {
        "status": "not_applicable",
        "method": "pushover_final_compliance",
        "source": "pushover",
        "scope": "No pushover drift acceptance result was available.",
    }


def run_linear_pushover(
    model: Any,
    basis: SeismicDesignBasis,
    parameters: Dict[str, Any],
    direction: str = "x",
) -> Dict[str, Any]:
    import openseespy.opensees as ops

    payload = model_payload(model)
    dimension, node_tags, floor_masses = _build_opensees_model(ops, payload, model, basis, direction)
    if dimension == "2d" and direction == "y":
        raise RuntimeError("Y-direction pushover requires a 3D model.")

    nodes = _records(payload, model, "nodes")
    base_tags, _top_tags = _base_and_top(nodes, node_tags)
    if not base_tags:
        raise RuntimeError("Unable to identify base nodes for pushover reactions.")

    target = optional_number(parameters.get("targetDisplacement")) or 0.05
    steps = int(optional_number(parameters.get("steps")) or 50)
    steps = max(1, min(steps, 500))
    increment = float(target) / steps
    dof = 2 if dimension == "3d" and direction == "y" else 1
    control_tag = _control_node_tag(nodes, node_tags, parameters.get("controlNode"))
    max_height = max((float(_field(node, "z", 0.0) or 0.0) for node in nodes), default=1.0)

    ops.timeSeries("Linear", 20_001)
    ops.pattern("Plain", 20_001, 20_001)
    for node in nodes:
        key = _node_key(node)
        if key not in node_tags:
            continue
        load = _lateral_load_for_node(node, max_height)
        if load <= 0.0:
            continue
        if dimension == "2d":
            ops.load(node_tags[key], load, 0.0, 0.0)
        else:
            if dof == 1:
                ops.load(node_tags[key], load, 0.0, 0.0, 0.0, 0.0, 0.0)
            else:
                ops.load(node_tags[key], 0.0, load, 0.0, 0.0, 0.0, 0.0)

    ops.wipeAnalysis()
    ops.constraints("Transformation")
    ops.numberer("RCM")
    ops.system("BandGeneral")
    ops.test("NormDispIncr", 1.0e-8, 16)
    ops.algorithm("Newton")
    ops.integrator("DisplacementControl", control_tag, dof, increment)
    ops.analysis("Static")

    curve: List[Dict[str, Any]] = []
    converged = True
    for step in range(steps):
        ok = ops.analyze(1)
        if ok != 0:
            converged = False
            break
        roof_disp = float(ops.nodeDisp(control_tag, dof))
        try:
            ops.reactions()
            base_shear = abs(sum(float(ops.nodeReaction(tag, dof)) for tag in base_tags))
        except Exception:
            base_shear = 0.0
        curve.append({
            "step": step + 1,
            "baseShear": round(base_shear, 6),
            "roofDisplacement": round(roof_disp, 8),
        })

    ops.wipe()
    capacity_assessment = _capacity_assessment(
        curve,
        target_displacement=float(target),
        max_height=max_height,
        parameters=parameters,
        basis=basis,
        floor_masses=floor_masses,
    )
    nonlinear_estimate = _run_member_hinge_2d_pushover_estimate(
        ops,
        model=model,
        basis=basis,
        parameters=parameters,
        direction=direction,
        target_displacement=float(target),
        max_height=max_height,
        steps=steps,
    )
    member_hinge_warnings = (
        nonlinear_estimate.get("warnings")
        if isinstance(nonlinear_estimate, dict) and isinstance(nonlinear_estimate.get("warnings"), list)
        else []
    )
    if nonlinear_estimate is None or nonlinear_estimate.get("status") == "estimate_failed":
        nonlinear_estimate = _run_bilinear_story_shear_pushover_estimate(
            ops,
            floor_masses=floor_masses,
            capacity_assessment=capacity_assessment,
            target_displacement=float(target),
            max_height=max_height,
            steps=steps,
            parameters=parameters,
            basis=basis,
        )
        if member_hinge_warnings and nonlinear_estimate is not None:
            nonlinear_estimate["warnings"] = [
                *member_hinge_warnings,
                "Member-end plastic-hinge pushover estimate was unavailable; used bilinear story-shear fallback.",
                *(nonlinear_estimate.get("warnings") if isinstance(nonlinear_estimate.get("warnings"), list) else []),
            ]
    if nonlinear_estimate is None or nonlinear_estimate.get("status") == "estimate_failed":
        fallback = _run_bilinear_sdof_pushover_estimate(
            ops,
            capacity_assessment=capacity_assessment,
            target_displacement=float(target),
            max_height=max_height,
            steps=steps,
            parameters=parameters,
            basis=basis,
        )
        if nonlinear_estimate is not None:
            fallback["warnings"] = [
                *(member_hinge_warnings if member_hinge_warnings else []),
                *(nonlinear_estimate.get("warnings") if isinstance(nonlinear_estimate.get("warnings"), list) else []),
                "Bilinear story-shear pushover estimate was unavailable; used SDOF fallback.",
            ]
        nonlinear_estimate = fallback
    final_compliance = _final_compliance_assessment(
        capacity_assessment=capacity_assessment,
        nonlinear_estimate=nonlinear_estimate,
    )
    return {
        "status": "success" if curve else "partial",
        "engineMode": "opensees_linear_static_pushover",
        "pushoverCurve": curve,
        "capacityAssessment": capacity_assessment,
        "nonlinearEstimate": nonlinear_estimate,
        "finalCompliance": final_compliance,
        "targetDisplacement": target,
        "controlNode": str(parameters.get("controlNode") or control_tag),
        "converged": converged,
        "completedSteps": len(curve),
        "requestedSteps": steps,
    }
