from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Sequence, Tuple

from seismic_contracts import as_record, as_records, first_number, first_string
from spectrum import seismic_influence_coefficient


SPECIAL_SYSTEM_CLAUSE = "GB 55002-2021 + GB/T 50011-2010(2024) specialized-system review"
G_ACCEL = 9.80665


def _is_true(value: Any) -> bool:
    return value is True or (isinstance(value, str) and value.strip().lower() in {"true", "yes", "1"})


def _structured_bool(workflow: Dict[str, Any], key: str) -> bool:
    requirements = as_record(workflow.get("designRequirements"))
    structure = as_record(workflow.get("structure"))
    structure_profile = as_record(workflow.get("structureProfile"))
    for source in (requirements, structure, structure_profile, workflow):
        if _is_true(source.get(key)):
            return True
    return False


def _first_record(*values: Any) -> Dict[str, Any]:
    for value in values:
        record = as_record(value)
        if record:
            return record
    return {}


def _records_from_keys(source: Dict[str, Any], keys: Sequence[str]) -> List[Dict[str, Any]]:
    records: List[Dict[str, Any]] = []
    for key in keys:
        value = source.get(key)
        if isinstance(value, list):
            records.extend(as_records(value))
        else:
            record = as_record(value)
            if record:
                records.append(record)
    return records


def _append_missing(missing: List[str], field: str) -> None:
    if field not in missing:
        missing.append(field)


def _has_any_number(source: Dict[str, Any], keys: Sequence[str]) -> bool:
    return first_number(*(source.get(key) for key in keys)) is not None


def _has_any_string(source: Dict[str, Any], keys: Sequence[str]) -> bool:
    return first_string(*(source.get(key) for key in keys)) is not None


def _sum_device_number(devices: Sequence[Dict[str, Any]], keys: Sequence[str]) -> Optional[float]:
    total = 0.0
    found = False
    for device in devices:
        value = first_number(*(device.get(key) for key in keys))
        if value is not None:
            total += max(float(value), 0.0)
            found = True
    return total if found and total > 0.0 else None


def _average_device_number(devices: Sequence[Dict[str, Any]], keys: Sequence[str]) -> Optional[float]:
    values = [
        float(value)
        for device in devices
        for value in [first_number(*(device.get(key) for key in keys))]
        if value is not None
    ]
    return sum(values) / len(values) if values else None


def _total_mass_and_weight(section: Dict[str, Any], modal: Optional[Any], source_label: str = "system") -> Tuple[Optional[float], Optional[float], str]:
    modal_mass = getattr(modal, "total_mass", None)
    mass = first_number(
        section.get("equivalentMass"),
        section.get("totalMass"),
        section.get("mass"),
        modal_mass,
    )
    weight = first_number(
        section.get("totalWeightKN"),
        section.get("representativeWeightKN"),
        section.get("designWeightKN"),
    )
    source = source_label
    if weight is None and mass is not None:
        weight = float(mass) * G_ACCEL
        source = "modal.totalMass" if modal_mass is not None else f"{source_label}.mass"
    if mass is None and weight is not None:
        mass = float(weight) / G_ACCEL
    if mass is not None and float(mass) <= 0.0:
        mass = None
    if weight is not None and float(weight) <= 0.0:
        weight = None
    return (float(mass), float(weight), source) if mass is not None and weight is not None else (mass, weight, source)


def _isolation_equivalent_linear_estimate(
    *,
    section: Dict[str, Any],
    devices: Sequence[Dict[str, Any]],
    basis: Optional[Any],
    modal: Optional[Any],
) -> Dict[str, Any]:
    missing_inputs: List[str] = []
    total_mass, total_weight, mass_source = _total_mass_and_weight(section, modal, "isolationSystem")
    stiffness = first_number(
        section.get("equivalentHorizontalStiffness"),
        section.get("horizontalStiffness"),
        section.get("effectiveStiffness"),
        _sum_device_number(devices, ("equivalentHorizontalStiffness", "horizontalStiffness", "effectiveStiffness")),
    )
    damping_ratio = first_number(
        section.get("equivalentDampingRatio"),
        section.get("dampingRatio"),
        _average_device_number(devices, ("equivalentDampingRatio", "dampingRatio")),
    )
    capacity = first_number(
        section.get("allowableDisplacement"),
        section.get("displacementCapacity"),
        section.get("limitDisplacement"),
        section.get("ultimateDisplacement"),
        _average_device_number(devices, ("allowableDisplacement", "displacementCapacity", "limitDisplacement", "ultimateDisplacement")),
    )

    if total_mass is None or total_weight is None:
        _append_missing(missing_inputs, "isolationSystem.totalMassOrWeight")
    if stiffness is None or stiffness <= 0.0:
        _append_missing(missing_inputs, "isolationSystem.equivalentHorizontalStiffness")
    if damping_ratio is None or damping_ratio <= 0.0:
        _append_missing(missing_inputs, "isolationSystem.equivalentDampingRatio")
    if basis is None:
        _append_missing(missing_inputs, "designBasis")
    if missing_inputs:
        return {
            "status": "missing_input",
            "engineMode": "equivalent_linear_isolation_spectrum_estimate",
            "missingInputs": missing_inputs,
        }

    period = 2.0 * math.pi * math.sqrt(float(total_mass) / max(float(stiffness), 1e-9))
    original_damping = getattr(basis, "damping_ratio", None)
    try:
        basis.damping_ratio = float(damping_ratio)
        alpha = seismic_influence_coefficient(period, basis)
    finally:
        if original_damping is not None:
            basis.damping_ratio = original_damping
    base_shear = alpha * float(total_weight)
    displacement_demand = base_shear / max(float(stiffness), 1e-9)
    utilization = (
        displacement_demand / max(float(capacity), 1e-12)
        if capacity is not None and capacity > 0.0 else None
    )
    return {
        "status": "estimated",
        "engineMode": "equivalent_linear_isolation_spectrum_estimate",
        "scope": "restricted equivalent-linear isolation-layer estimate from structured stiffness, damping, and design spectrum",
        "periodSec": round(period, 6),
        "alpha": alpha,
        "equivalentHorizontalStiffnessKNPerM": round(float(stiffness), 6),
        "equivalentDampingRatio": round(float(damping_ratio), 6),
        "totalMass": round(float(total_mass), 6),
        "totalWeightKN": round(float(total_weight), 6),
        "massSource": mass_source,
        "baseShearKN": round(base_shear, 6),
        "displacementDemandM": round(displacement_demand, 8),
        **({
            "displacementCapacityM": round(float(capacity), 8),
            "displacementUtilization": round(float(utilization), 6),
            "finalCompliance": {
                "status": "pass" if utilization is not None and utilization <= 1.0 else "fail",
                "source": "isolationEquivalentLinearEstimate.displacementDemandM",
                "method": "equivalent_linear_isolation_displacement",
                "clause": SPECIAL_SYSTEM_CLAUSE,
                "demand": round(displacement_demand, 8),
                "capacity": round(float(capacity), 8),
                "utilization": round(float(utilization), 6),
                "scope": "restricted equivalent-linear isolation displacement check",
            },
        } if capacity is not None and capacity > 0.0 and utilization is not None else {}),
    }


def _motion_name(motion: Any, index: int) -> str:
    value = getattr(motion, "name", None)
    return str(value) if value else f"record-{index + 1}"


def _motion_accelerations(motion: Any) -> List[float]:
    values = getattr(motion, "accelerations_mps2", None)
    if not isinstance(values, list):
        return []
    accelerations: List[float] = []
    for value in values:
        try:
            number = float(value)
        except (TypeError, ValueError):
            continue
        if math.isfinite(number):
            accelerations.append(number)
    return accelerations


def _motion_dt(motion: Any) -> Optional[float]:
    try:
        value = float(getattr(motion, "dt", 0.0))
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) and value > 0.0 else None


def _isolation_sdof_record_response(
    *,
    accelerations: Sequence[float],
    dt: float,
    mass: float,
    stiffness: float,
    damping_ratio: float,
) -> Dict[str, float]:
    omega = math.sqrt(max(stiffness, 1e-12) / max(mass, 1e-12))
    damping = 2.0 * damping_ratio * omega * mass
    period = 2.0 * math.pi / max(omega, 1e-12)
    stable_dt = min(dt, period / 40.0)
    sub_steps = max(1, int(math.ceil(dt / max(stable_dt, 1e-6))))
    h = dt / sub_steps
    displacement = 0.0
    velocity = 0.0
    max_displacement = 0.0
    max_velocity = 0.0
    max_base_shear = 0.0
    max_absolute_acceleration = 0.0
    for ground_acceleration in accelerations:
        for _ in range(sub_steps):
            relative_acceleration = (
                -2.0 * damping_ratio * omega * velocity
                - omega * omega * displacement
                - float(ground_acceleration)
            )
            velocity += relative_acceleration * h
            displacement += velocity * h
            base_shear = stiffness * displacement + damping * velocity
            absolute_acceleration = relative_acceleration + float(ground_acceleration)
            max_displacement = max(max_displacement, abs(displacement))
            max_velocity = max(max_velocity, abs(velocity))
            max_base_shear = max(max_base_shear, abs(base_shear))
            max_absolute_acceleration = max(max_absolute_acceleration, abs(absolute_acceleration))
    return {
        "maxDisplacementM": max_displacement,
        "maxVelocityMps": max_velocity,
        "maxBaseShearKN": max_base_shear,
        "maxAbsoluteAccelerationMps2": max_absolute_acceleration,
    }


def _isolation_layer_time_history_estimate(
    *,
    section: Dict[str, Any],
    devices: Sequence[Dict[str, Any]],
    modal: Optional[Any],
    ground_motions: Optional[Sequence[Any]],
) -> Dict[str, Any]:
    missing_inputs: List[str] = []
    total_mass, total_weight, mass_source = _total_mass_and_weight(section, modal, "isolationSystem")
    stiffness = first_number(
        section.get("equivalentHorizontalStiffness"),
        section.get("horizontalStiffness"),
        section.get("effectiveStiffness"),
        _sum_device_number(devices, ("equivalentHorizontalStiffness", "horizontalStiffness", "effectiveStiffness")),
    )
    damping_ratio = first_number(
        section.get("equivalentDampingRatio"),
        section.get("dampingRatio"),
        _average_device_number(devices, ("equivalentDampingRatio", "dampingRatio")),
    )
    displacement_capacity = first_number(
        section.get("allowableDisplacement"),
        section.get("displacementCapacity"),
        section.get("limitDisplacement"),
        section.get("ultimateDisplacement"),
        _average_device_number(devices, ("allowableDisplacement", "displacementCapacity", "limitDisplacement", "ultimateDisplacement")),
    )
    force_capacity = first_number(
        section.get("forceCapacityKN"),
        section.get("baseShearCapacityKN"),
        section.get("allowableForceKN"),
        section.get("limitForceKN"),
        _sum_device_number(devices, ("forceCapacityKN", "baseShearCapacityKN", "allowableForceKN", "limitForceKN")),
    )
    if total_mass is None or total_weight is None:
        _append_missing(missing_inputs, "isolationSystem.totalMassOrWeight")
    if stiffness is None or stiffness <= 0.0:
        _append_missing(missing_inputs, "isolationSystem.equivalentHorizontalStiffness")
    if damping_ratio is None or damping_ratio <= 0.0:
        _append_missing(missing_inputs, "isolationSystem.equivalentDampingRatio")
    motions = list(ground_motions or [])
    if not motions:
        _append_missing(missing_inputs, "groundMotionSet.records")
    if missing_inputs:
        return {
            "status": "missing_input",
            "engineMode": "isolation_layer_sdof_time_history_estimate",
            "missingInputs": missing_inputs,
        }

    record_responses: List[Dict[str, Any]] = []
    period = 2.0 * math.pi * math.sqrt(float(total_mass) / max(float(stiffness), 1e-9))
    for index, motion in enumerate(motions):
        accelerations = _motion_accelerations(motion)
        dt = _motion_dt(motion)
        if not accelerations or dt is None:
            continue
        response = _isolation_sdof_record_response(
            accelerations=accelerations,
            dt=dt,
            mass=float(total_mass),
            stiffness=float(stiffness),
            damping_ratio=float(damping_ratio),
        )
        record_responses.append({
            "record": _motion_name(motion, index),
            "dt": round(dt, 6),
            "pointCount": len(accelerations),
            **{key: round(value, 8) for key, value in response.items()},
        })
    if not record_responses:
        return {
            "status": "missing_input",
            "engineMode": "isolation_layer_sdof_time_history_estimate",
            "missingInputs": ["groundMotionSet.records"],
        }
    controlling = max(record_responses, key=lambda item: float(item.get("maxDisplacementM", 0.0) or 0.0))
    max_displacement = float(controlling.get("maxDisplacementM", 0.0) or 0.0)
    max_base_shear = max(float(item.get("maxBaseShearKN", 0.0) or 0.0) for item in record_responses)
    displacement_utilization = (
        max_displacement / max(float(displacement_capacity), 1e-12)
        if displacement_capacity is not None and displacement_capacity > 0.0 else None
    )
    force_utilization = (
        max_base_shear / max(float(force_capacity), 1e-12)
        if force_capacity is not None and force_capacity > 0.0 else None
    )
    final_status = None
    if displacement_utilization is not None or force_utilization is not None:
        final_status = "pass" if max(
            displacement_utilization or 0.0,
            force_utilization or 0.0,
        ) <= 1.0 else "fail"
    return {
        "status": "estimated",
        "engineMode": "isolation_layer_sdof_time_history_estimate",
        "scope": "restricted SDOF isolation-layer time-history estimate from structured stiffness, damping, mass, and selected ground motions",
        "periodSec": round(period, 6),
        "equivalentHorizontalStiffnessKNPerM": round(float(stiffness), 6),
        "equivalentDampingRatio": round(float(damping_ratio), 6),
        "totalMass": round(float(total_mass), 6),
        "totalWeightKN": round(float(total_weight), 6),
        "massSource": mass_source,
        "recordCount": len(record_responses),
        "recordResponses": record_responses,
        "controllingRecord": controlling.get("record"),
        "maxDisplacementM": round(max_displacement, 8),
        "maxBaseShearKN": round(max_base_shear, 6),
        **({
            "displacementCapacityM": round(float(displacement_capacity), 8),
            "displacementUtilization": round(float(displacement_utilization), 6),
        } if displacement_utilization is not None else {}),
        **({
            "forceCapacityKN": round(float(force_capacity), 6),
            "forceUtilization": round(float(force_utilization), 6),
        } if force_utilization is not None else {}),
        **({
            "finalCompliance": {
                "status": final_status,
                "source": "isolationLayerTimeHistoryEstimate.maxDisplacementM",
                "method": "isolation_layer_sdof_time_history",
                "clause": SPECIAL_SYSTEM_CLAUSE,
                "demand": round(max_displacement, 8),
                **({"capacity": round(float(displacement_capacity), 8)} if displacement_capacity is not None and displacement_capacity > 0.0 else {}),
                **({"utilization": round(float(displacement_utilization), 6)} if displacement_utilization is not None else {}),
                **({"forceUtilization": round(float(force_utilization), 6)} if force_utilization is not None else {}),
                "scope": "restricted SDOF isolation-layer time-history displacement and base-shear check",
            },
        } if final_status else {}),
    }


def _modal_first_period(modal: Optional[Any]) -> Optional[float]:
    modes = getattr(modal, "modes", None)
    if not isinstance(modes, list) or not modes:
        return None
    periods = [
        first_number(as_record(mode).get("period"))
        for mode in modes
        if isinstance(mode, dict)
    ]
    finite_periods = [float(period) for period in periods if period is not None and period > 0.0]
    return min(finite_periods) if finite_periods else None


def _energy_dissipation_equivalent_estimate(
    *,
    section: Dict[str, Any],
    devices: Sequence[Dict[str, Any]],
    basis: Optional[Any],
    modal: Optional[Any],
    response_envelope: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    missing_inputs: List[str] = []
    period = first_number(
        section.get("period"),
        section.get("effectivePeriod"),
        section.get("fundamentalPeriod"),
        _modal_first_period(modal),
    )
    explicit_additional_damping = first_number(
        section.get("additionalDampingRatio"),
        _average_device_number(devices, ("additionalDampingRatio",)),
    )
    explicit_equivalent_damping = first_number(
        section.get("equivalentDampingRatio"),
        section.get("dampingRatio"),
        _average_device_number(devices, ("equivalentDampingRatio", "dampingRatio")),
    )
    envelope = response_envelope or {}
    displacement_demand = first_number(
        section.get("displacementDemand"),
        section.get("deformationDemand"),
        section.get("damperDeformationDemand"),
        section.get("maxDisplacement"),
        _average_device_number(devices, ("displacementDemand", "deformationDemand", "damperDeformationDemand", "maxDisplacement")),
        envelope.get("maxAbsDisplacement"),
    )
    capacity = first_number(
        section.get("deformationCapacity"),
        section.get("allowableDeformation"),
        section.get("displacementCapacity"),
        section.get("allowableDisplacement"),
        _average_device_number(devices, ("deformationCapacity", "allowableDeformation", "displacementCapacity", "allowableDisplacement")),
    )
    if basis is None:
        _append_missing(missing_inputs, "designBasis")
    if period is None or period <= 0.0:
        _append_missing(missing_inputs, "energyDissipationSystem.effectivePeriod")
    if (
        (explicit_additional_damping is None or explicit_additional_damping <= 0.0)
        and (explicit_equivalent_damping is None or explicit_equivalent_damping <= 0.0)
    ):
        _append_missing(missing_inputs, "energyDissipationSystem.additionalDampingRatio")
    if displacement_demand is None or displacement_demand < 0.0:
        _append_missing(missing_inputs, "energyDissipationSystem.displacementDemand")
    if missing_inputs:
        return {
            "status": "missing_input",
            "engineMode": "equivalent_damping_energy_dissipation_estimate",
            "missingInputs": missing_inputs,
        }

    original_damping = getattr(basis, "damping_ratio", None)
    base_damping = float(original_damping if original_damping is not None else 0.05)
    if explicit_additional_damping is not None and explicit_additional_damping > 0.0:
        additional_damping = float(explicit_additional_damping)
        equivalent_damping = base_damping + additional_damping
    else:
        equivalent_damping = float(explicit_equivalent_damping)
        additional_damping = max(0.0, equivalent_damping - base_damping)
    equivalent_damping = max(base_damping, min(0.20, equivalent_damping))
    try:
        basis.damping_ratio = base_damping
        original_alpha = seismic_influence_coefficient(float(period), basis)
        basis.damping_ratio = equivalent_damping
        adjusted_alpha = seismic_influence_coefficient(float(period), basis)
    finally:
        basis.damping_ratio = original_damping
    reduction_ratio = adjusted_alpha / max(original_alpha, 1e-12)
    adjusted_displacement = float(displacement_demand) * reduction_ratio
    utilization = (
        adjusted_displacement / max(float(capacity), 1e-12)
        if capacity is not None and capacity > 0.0 else None
    )
    return {
        "status": "estimated",
        "engineMode": "equivalent_damping_energy_dissipation_estimate",
        "scope": "restricted equivalent-damping demand reduction estimate from structured damping ratio and response envelope",
        "periodSec": round(float(period), 6),
        "baseDampingRatio": round(base_damping, 6),
        "additionalDampingRatio": round(float(additional_damping), 6),
        "equivalentDampingRatio": round(equivalent_damping, 6),
        "originalAlpha": original_alpha,
        "adjustedAlpha": adjusted_alpha,
        "demandReductionRatio": round(reduction_ratio, 6),
        "inputDisplacementDemandM": round(float(displacement_demand), 8),
        "adjustedDisplacementDemandM": round(adjusted_displacement, 8),
        **({
            "deformationCapacityM": round(float(capacity), 8),
            "deformationUtilization": round(float(utilization), 6),
            "finalCompliance": {
                "status": "pass" if utilization is not None and utilization <= 1.0 else "fail",
                "source": "energyDissipationEquivalentEstimate.adjustedDisplacementDemandM",
                "method": "equivalent_damping_energy_dissipation_deformation",
                "clause": SPECIAL_SYSTEM_CLAUSE,
                "demand": round(adjusted_displacement, 8),
                "capacity": round(float(capacity), 8),
                "utilization": round(float(utilization), 6),
                "scope": "restricted equivalent-damping energy-dissipation deformation check",
            },
        } if capacity is not None and capacity > 0.0 and utilization is not None else {}),
    }


def _energy_dissipation_time_history_estimate(
    *,
    section: Dict[str, Any],
    devices: Sequence[Dict[str, Any]],
    basis: Optional[Any],
    modal: Optional[Any],
    ground_motions: Optional[Sequence[Any]],
) -> Dict[str, Any]:
    missing_inputs: List[str] = []
    total_mass, total_weight, mass_source = _total_mass_and_weight(section, modal, "energyDissipationSystem")
    period = first_number(
        section.get("period"),
        section.get("effectivePeriod"),
        section.get("fundamentalPeriod"),
        _modal_first_period(modal),
    )
    stiffness = first_number(
        section.get("effectiveStiffness"),
        section.get("systemStiffness"),
        section.get("lateralStiffness"),
        section.get("horizontalStiffness"),
        _sum_device_number(devices, ("effectiveStiffness", "systemStiffness", "lateralStiffness", "horizontalStiffness")),
    )
    if stiffness is None and total_mass is not None and period is not None and period > 0.0:
        omega_from_period = 2.0 * math.pi / max(float(period), 1e-12)
        stiffness = float(total_mass) * omega_from_period ** 2
    if period is None and total_mass is not None and stiffness is not None and stiffness > 0.0:
        period = 2.0 * math.pi * math.sqrt(float(total_mass) / max(float(stiffness), 1e-12))

    base_damping = getattr(basis, "damping_ratio", None) if basis is not None else None
    base_damping_ratio = float(base_damping if base_damping is not None else 0.05)
    additional_damping = first_number(
        section.get("additionalDampingRatio"),
        _average_device_number(devices, ("additionalDampingRatio",)),
    )
    equivalent_damping = first_number(
        section.get("equivalentDampingRatio"),
        section.get("dampingRatio"),
        _average_device_number(devices, ("equivalentDampingRatio", "dampingRatio")),
    )
    if equivalent_damping is None and additional_damping is not None:
        equivalent_damping = base_damping_ratio + float(additional_damping)

    damping_coefficient = first_number(
        section.get("dampingCoefficientKNsPerM"),
        section.get("dampingCoefficient"),
        section.get("viscousCoefficientKNsPerM"),
        _sum_device_number(devices, ("dampingCoefficientKNsPerM", "dampingCoefficient", "viscousCoefficientKNsPerM")),
    )
    velocity_exponent = first_number(
        section.get("velocityExponent"),
        section.get("dampingExponent"),
        _average_device_number(devices, ("velocityExponent", "dampingExponent")),
    )
    deformation_factor = first_number(
        section.get("deformationParticipationFactor"),
        section.get("damperDeformationFactor"),
        _average_device_number(devices, ("deformationParticipationFactor", "damperDeformationFactor")),
    )
    deformation_capacity = first_number(
        section.get("deformationCapacity"),
        section.get("allowableDeformation"),
        section.get("displacementCapacity"),
        section.get("allowableDisplacement"),
        _average_device_number(devices, ("deformationCapacity", "allowableDeformation", "displacementCapacity", "allowableDisplacement")),
    )
    force_capacity = first_number(
        section.get("forceCapacityKN"),
        section.get("forceCapacity"),
        section.get("allowableForceKN"),
        section.get("limitForceKN"),
        _sum_device_number(devices, ("forceCapacityKN", "forceCapacity", "allowableForceKN", "limitForceKN")),
    )
    if total_mass is None or total_weight is None:
        _append_missing(missing_inputs, "energyDissipationSystem.totalMassOrWeight")
    if period is None or period <= 0.0:
        _append_missing(missing_inputs, "energyDissipationSystem.effectivePeriod")
    if stiffness is None or stiffness <= 0.0:
        _append_missing(missing_inputs, "energyDissipationSystem.effectiveStiffness")
    if equivalent_damping is None or equivalent_damping <= 0.0:
        _append_missing(missing_inputs, "energyDissipationSystem.equivalentDampingRatio")
    motions = list(ground_motions or [])
    if not motions:
        _append_missing(missing_inputs, "groundMotionSet.records")
    if missing_inputs:
        return {
            "status": "missing_input",
            "engineMode": "energy_dissipation_sdof_time_history_estimate",
            "missingInputs": missing_inputs,
        }

    damping_ratio = max(0.0, min(0.50, float(equivalent_damping)))
    exponent = max(0.01, float(velocity_exponent if velocity_exponent is not None and velocity_exponent > 0.0 else 1.0))
    deformation_scale = float(deformation_factor if deformation_factor is not None and deformation_factor > 0.0 else 1.0)
    record_responses: List[Dict[str, Any]] = []
    for index, motion in enumerate(motions):
        accelerations = _motion_accelerations(motion)
        dt = _motion_dt(motion)
        if not accelerations or dt is None:
            continue
        response = _isolation_sdof_record_response(
            accelerations=accelerations,
            dt=dt,
            mass=float(total_mass),
            stiffness=float(stiffness),
            damping_ratio=damping_ratio,
        )
        max_deformation = response["maxDisplacementM"] * deformation_scale
        max_velocity = response["maxVelocityMps"] * deformation_scale
        force_demand = (
            float(damping_coefficient) * max_velocity ** exponent
            if damping_coefficient is not None and damping_coefficient > 0.0
            else None
        )
        record_responses.append({
            "record": _motion_name(motion, index),
            "dt": round(dt, 6),
            "pointCount": len(accelerations),
            "maxSystemDisplacementM": round(response["maxDisplacementM"], 8),
            "maxDeviceDeformationM": round(max_deformation, 8),
            "maxDeviceVelocityMps": round(max_velocity, 8),
            **({"maxDeviceForceKN": round(float(force_demand), 6)} if force_demand is not None else {}),
        })
    if not record_responses:
        return {
            "status": "missing_input",
            "engineMode": "energy_dissipation_sdof_time_history_estimate",
            "missingInputs": ["groundMotionSet.records"],
        }

    controlling = max(record_responses, key=lambda item: float(item.get("maxDeviceDeformationM", 0.0) or 0.0))
    max_deformation = float(controlling.get("maxDeviceDeformationM", 0.0) or 0.0)
    force_values = [
        float(item.get("maxDeviceForceKN", 0.0) or 0.0)
        for item in record_responses
        if item.get("maxDeviceForceKN") is not None
    ]
    max_force = max(force_values) if force_values else None
    deformation_utilization = (
        max_deformation / max(float(deformation_capacity), 1e-12)
        if deformation_capacity is not None and deformation_capacity > 0.0 else None
    )
    force_utilization = (
        float(max_force) / max(float(force_capacity), 1e-12)
        if max_force is not None and force_capacity is not None and force_capacity > 0.0 else None
    )
    final_status = None
    if deformation_utilization is not None or force_utilization is not None:
        final_status = "pass" if max(deformation_utilization or 0.0, force_utilization or 0.0) <= 1.0 else "fail"

    return {
        "status": "estimated",
        "engineMode": "energy_dissipation_sdof_time_history_estimate",
        "scope": "restricted SDOF energy-dissipation device deformation and force estimate from structured damping parameters and selected ground motions",
        "periodSec": round(float(period), 6),
        "effectiveStiffnessKNPerM": round(float(stiffness), 6),
        "baseDampingRatio": round(base_damping_ratio, 6),
        "equivalentDampingRatio": round(damping_ratio, 6),
        "totalMass": round(float(total_mass), 6),
        "totalWeightKN": round(float(total_weight), 6),
        "massSource": mass_source,
        "deformationParticipationFactor": round(deformation_scale, 6),
        "recordCount": len(record_responses),
        "recordResponses": record_responses,
        "controllingRecord": controlling.get("record"),
        "maxDeviceDeformationM": round(max_deformation, 8),
        **({"dampingCoefficientKNsPerM": round(float(damping_coefficient), 6), "velocityExponent": round(exponent, 6)} if damping_coefficient is not None and damping_coefficient > 0.0 else {}),
        **({"maxDeviceForceKN": round(float(max_force), 6)} if max_force is not None else {}),
        **({"deformationCapacityM": round(float(deformation_capacity), 8), "deformationUtilization": round(float(deformation_utilization), 6)} if deformation_utilization is not None else {}),
        **({"forceCapacityKN": round(float(force_capacity), 6), "forceUtilization": round(float(force_utilization), 6)} if force_utilization is not None else {}),
        **({
            "finalCompliance": {
                "status": final_status,
                "source": "energyDissipationTimeHistoryEstimate.maxDeviceDeformationM",
                "method": "energy_dissipation_sdof_time_history",
                "clause": SPECIAL_SYSTEM_CLAUSE,
                "demand": round(max_deformation, 8),
                **({"capacity": round(float(deformation_capacity), 8)} if deformation_capacity is not None and deformation_capacity > 0.0 else {}),
                **({"utilization": round(float(deformation_utilization), 6)} if deformation_utilization is not None else {}),
                **({"forceDemandKN": round(float(max_force), 6)} if max_force is not None else {}),
                **({"forceCapacityKN": round(float(force_capacity), 6)} if force_capacity is not None and force_capacity > 0.0 else {}),
                **({"forceUtilization": round(float(force_utilization), 6)} if force_utilization is not None else {}),
                "scope": "restricted SDOF damping-device deformation and force check",
            },
        } if final_status else {}),
    }


def _limit_check(
    *,
    item: str,
    demand: Optional[float],
    capacity: Optional[float],
    source: str,
    unit: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    if demand is None or capacity is None:
        return None
    utilization = abs(float(demand)) / float(capacity) if capacity > 0.0 else 9999.0
    return {
        "item": item,
        "status": "pass" if utilization <= 1.0 else "fail",
        "utilization": round(utilization, 6),
        "clause": SPECIAL_SYSTEM_CLAUSE,
        "formula": "demand / capacity <= 1.0",
        "inputs": {
            "demand": round(float(demand), 8),
            "capacity": round(float(capacity), 8),
            "source": source,
            **({"unit": unit} if unit else {}),
        },
    }


def _displacement_check(source: Dict[str, Any], source_name: str, label: str) -> Optional[Dict[str, Any]]:
    demand = first_number(
        source.get("displacementDemand"),
        source.get("designDisplacement"),
        source.get("maxDisplacement"),
        source.get("maximumDisplacement"),
        source.get("isolationLayerDisplacement"),
        source.get("damperDeformationDemand"),
    )
    capacity = first_number(
        source.get("allowableDisplacement"),
        source.get("displacementCapacity"),
        source.get("limitDisplacement"),
        source.get("ultimateDisplacement"),
        source.get("deformationCapacity"),
        source.get("allowableDeformation"),
    )
    return _limit_check(
        item=label,
        demand=demand,
        capacity=capacity,
        source=source_name,
        unit="m",
    )


def _force_check(source: Dict[str, Any], source_name: str, label: str) -> Optional[Dict[str, Any]]:
    demand = first_number(
        source.get("forceDemandKN"),
        source.get("forceDemand"),
        source.get("maxForceKN"),
        source.get("maximumForceKN"),
        source.get("designForceKN"),
    )
    capacity = first_number(
        source.get("forceCapacityKN"),
        source.get("forceCapacity"),
        source.get("allowableForceKN"),
        source.get("limitForceKN"),
        source.get("ultimateForceKN"),
    )
    return _limit_check(
        item=label,
        demand=demand,
        capacity=capacity,
        source=source_name,
        unit="kN",
    )


def _shear_strain_check(source: Dict[str, Any], source_name: str) -> Optional[Dict[str, Any]]:
    demand = first_number(source.get("shearStrainDemand"), source.get("maxShearStrain"))
    capacity = first_number(source.get("allowableShearStrain"), source.get("shearStrainCapacity"))
    return _limit_check(
        item="隔震支座剪应变验收",
        demand=demand,
        capacity=capacity,
        source=source_name,
    )


def _audit_isolation(
    workflow: Dict[str, Any],
    missing_capability: str,
    basis: Optional[Any] = None,
    modal: Optional[Any] = None,
    ground_motions: Optional[Sequence[Any]] = None,
) -> Dict[str, Any]:
    structure = as_record(workflow.get("structure"))
    requirements = as_record(workflow.get("designRequirements"))
    section = _first_record(
        workflow.get("isolationSystem"),
        workflow.get("baseIsolationSystem"),
        structure.get("isolationSystem"),
        requirements.get("isolationSystem"),
    )
    devices = _records_from_keys(
        section,
        ("bearings", "isolationBearings", "isolators", "devices"),
    )
    missing_inputs: List[str] = []
    if not section:
        _append_missing(missing_inputs, "isolationSystem")
    if not devices:
        _append_missing(missing_inputs, "isolationSystem.devices")
    stiffness_available = _has_any_number(section, (
        "equivalentHorizontalStiffness",
        "horizontalStiffness",
        "effectiveStiffness",
        "isolationPeriod",
    )) or any(_has_any_number(device, (
        "equivalentHorizontalStiffness",
        "horizontalStiffness",
        "effectiveStiffness",
    )) for device in devices)
    if not stiffness_available:
        _append_missing(missing_inputs, "isolationSystem.equivalentHorizontalStiffness")
    damping_available = _has_any_number(section, (
        "equivalentDampingRatio",
        "dampingRatio",
    )) or any(_has_any_number(device, (
        "equivalentDampingRatio",
        "dampingRatio",
    )) for device in devices)
    if not damping_available:
        _append_missing(missing_inputs, "isolationSystem.equivalentDampingRatio")
    displacement_capacity_available = _has_any_number(section, (
        "allowableDisplacement",
        "displacementCapacity",
        "limitDisplacement",
        "ultimateDisplacement",
    )) or any(_has_any_number(device, (
        "allowableDisplacement",
        "displacementCapacity",
        "limitDisplacement",
        "ultimateDisplacement",
    )) for device in devices)
    if not displacement_capacity_available:
        _append_missing(missing_inputs, "isolationSystem.displacementCapacity")

    has_explicit_mass_or_weight = first_number(
        section.get("equivalentMass"),
        section.get("totalMass"),
        section.get("mass"),
        section.get("totalWeightKN"),
        section.get("representativeWeightKN"),
        section.get("designWeightKN"),
    ) is not None
    equivalent_estimate = _isolation_equivalent_linear_estimate(
        section=section,
        devices=devices,
        basis=basis,
        modal=modal,
    ) if section and basis is not None and (modal is not None or has_explicit_mass_or_weight) else {}
    for field in equivalent_estimate.get("missingInputs", []) if isinstance(equivalent_estimate.get("missingInputs"), list) else []:
        _append_missing(missing_inputs, str(field))
    estimate_final_compliance = as_record(equivalent_estimate.get("finalCompliance"))
    time_history_estimate = _isolation_layer_time_history_estimate(
        section=section,
        devices=devices,
        modal=modal,
        ground_motions=ground_motions,
    ) if section and modal is not None and ground_motions else {}
    for field in time_history_estimate.get("missingInputs", []) if isinstance(time_history_estimate.get("missingInputs"), list) else []:
        _append_missing(missing_inputs, str(field))
    time_history_final_compliance = as_record(time_history_estimate.get("finalCompliance"))

    checks = [
        item for item in [
            _displacement_check(section, "isolationSystem", "隔震层位移验收") if section else None,
            _shear_strain_check(section, "isolationSystem") if section else None,
            ({
                "item": "隔震等效线性位移估算验收",
                "status": estimate_final_compliance.get("status"),
                "utilization": estimate_final_compliance.get("utilization"),
                "clause": SPECIAL_SYSTEM_CLAUSE,
                "formula": "equivalent-linear spectrum displacement demand / displacement capacity <= 1.0",
                "inputs": {
                    "demand": estimate_final_compliance.get("demand"),
                    "capacity": estimate_final_compliance.get("capacity"),
                    "source": estimate_final_compliance.get("source"),
                    "unit": "m",
                },
            } if estimate_final_compliance else None),
            ({
                "item": "隔震层 SDOF 时程位移估算验收",
                "status": time_history_final_compliance.get("status"),
                "utilization": time_history_final_compliance.get("utilization"),
                "clause": SPECIAL_SYSTEM_CLAUSE,
                "formula": "SDOF time-history isolation-layer displacement demand / displacement capacity <= 1.0",
                "inputs": {
                    "demand": time_history_final_compliance.get("demand"),
                    "capacity": time_history_final_compliance.get("capacity"),
                    "source": time_history_final_compliance.get("source"),
                    "unit": "m",
                    **({"forceUtilization": time_history_final_compliance.get("forceUtilization")} if time_history_final_compliance.get("forceUtilization") is not None else {}),
                },
            } if time_history_final_compliance else None),
            *[
                item
                for index, device in enumerate(devices)
                for item in [
                    _displacement_check(device, f"isolationSystem.devices[{index}]", "隔震支座位移验收"),
                    _shear_strain_check(device, f"isolationSystem.devices[{index}]"),
                ]
            ],
        ]
        if item is not None
    ]

    return {
        "type": "isolation",
        "required": True,
        "provided": bool(section),
        "deviceCount": len(devices),
        "missingInputs": missing_inputs,
        "capabilityBoundary": missing_capability,
        "acceptanceChecks": checks,
        "equivalentLinearEstimate": equivalent_estimate or None,
        "timeHistoryEstimate": time_history_estimate or None,
    }


def _audit_energy_dissipation(
    workflow: Dict[str, Any],
    missing_capability: str,
    basis: Optional[Any] = None,
    modal: Optional[Any] = None,
    response_envelope: Optional[Dict[str, Any]] = None,
    ground_motions: Optional[Sequence[Any]] = None,
) -> Dict[str, Any]:
    structure = as_record(workflow.get("structure"))
    requirements = as_record(workflow.get("designRequirements"))
    section = _first_record(
        workflow.get("energyDissipationSystem"),
        workflow.get("dampingSystem"),
        workflow.get("dampingDevices"),
        structure.get("energyDissipationSystem"),
        structure.get("dampingSystem"),
        requirements.get("energyDissipationSystem"),
    )
    devices = _records_from_keys(
        section,
        ("devices", "dampers", "dampingDevices", "energyDissipationDevices"),
    )
    if not devices and as_record(workflow.get("dampingDevices")) and section == as_record(workflow.get("dampingDevices")):
        devices = [section]

    missing_inputs: List[str] = []
    if not section:
        _append_missing(missing_inputs, "energyDissipationSystem")
    if not devices:
        _append_missing(missing_inputs, "energyDissipationSystem.devices")
    if not (_has_any_string(section, ("type", "deviceType", "damperType")) or any(_has_any_string(device, ("type", "deviceType", "damperType")) for device in devices)):
        _append_missing(missing_inputs, "energyDissipationSystem.deviceType")
    damping_parameter_available = _has_any_number(section, (
        "dampingCoefficient",
        "equivalentDampingRatio",
        "additionalDampingRatio",
        "yieldForceKN",
    )) or any(_has_any_number(device, (
        "dampingCoefficient",
        "equivalentDampingRatio",
        "additionalDampingRatio",
        "yieldForceKN",
    )) for device in devices)
    if not damping_parameter_available:
        _append_missing(missing_inputs, "energyDissipationSystem.dampingParameters")
    deformation_capacity_available = _has_any_number(section, (
        "deformationCapacity",
        "allowableDeformation",
        "displacementCapacity",
    )) or any(_has_any_number(device, (
        "deformationCapacity",
        "allowableDeformation",
        "displacementCapacity",
    )) for device in devices)
    if not deformation_capacity_available:
        _append_missing(missing_inputs, "energyDissipationSystem.deformationCapacity")
    equivalent_estimate = _energy_dissipation_equivalent_estimate(
        section=section,
        devices=devices,
        basis=basis,
        modal=modal,
        response_envelope=response_envelope,
    ) if section and basis is not None else {}
    for field in equivalent_estimate.get("missingInputs", []) if isinstance(equivalent_estimate.get("missingInputs"), list) else []:
        _append_missing(missing_inputs, str(field))
    estimate_final_compliance = as_record(equivalent_estimate.get("finalCompliance"))
    time_history_estimate = _energy_dissipation_time_history_estimate(
        section=section,
        devices=devices,
        basis=basis,
        modal=modal,
        ground_motions=ground_motions,
    ) if section and modal is not None and ground_motions else {}
    for field in time_history_estimate.get("missingInputs", []) if isinstance(time_history_estimate.get("missingInputs"), list) else []:
        _append_missing(missing_inputs, str(field))
    time_history_final_compliance = as_record(time_history_estimate.get("finalCompliance"))

    checks = [
        item for item in [
            _displacement_check(section, "energyDissipationSystem", "消能器变形验收") if section else None,
            _force_check(section, "energyDissipationSystem", "消能器力验收") if section else None,
            ({
                "item": "消能减震等效阻尼变形估算验收",
                "status": estimate_final_compliance.get("status"),
                "utilization": estimate_final_compliance.get("utilization"),
                "clause": SPECIAL_SYSTEM_CLAUSE,
                "formula": "equivalent-damping adjusted displacement demand / deformation capacity <= 1.0",
                "inputs": {
                    "demand": estimate_final_compliance.get("demand"),
                    "capacity": estimate_final_compliance.get("capacity"),
                    "source": estimate_final_compliance.get("source"),
                    "unit": "m",
                },
            } if estimate_final_compliance else None),
            ({
                "item": "消能器 SDOF 时程变形/力估算验收",
                "status": time_history_final_compliance.get("status"),
                "utilization": time_history_final_compliance.get("utilization"),
                "clause": SPECIAL_SYSTEM_CLAUSE,
                "formula": "SDOF time-history damping-device deformation and force demand / capacity <= 1.0",
                "inputs": {
                    "demand": time_history_final_compliance.get("demand"),
                    "capacity": time_history_final_compliance.get("capacity"),
                    "source": time_history_final_compliance.get("source"),
                    "unit": "m",
                    **({"forceDemandKN": time_history_final_compliance.get("forceDemandKN")} if time_history_final_compliance.get("forceDemandKN") is not None else {}),
                    **({"forceCapacityKN": time_history_final_compliance.get("forceCapacityKN")} if time_history_final_compliance.get("forceCapacityKN") is not None else {}),
                    **({"forceUtilization": time_history_final_compliance.get("forceUtilization")} if time_history_final_compliance.get("forceUtilization") is not None else {}),
                },
            } if time_history_final_compliance else None),
            *[
                item
                for index, device in enumerate(devices)
                for item in [
                    _displacement_check(device, f"energyDissipationSystem.devices[{index}]", "消能器变形验收"),
                    _force_check(device, f"energyDissipationSystem.devices[{index}]", "消能器力验收"),
                ]
            ],
        ]
        if item is not None
    ]

    return {
        "type": "energy_dissipation",
        "required": True,
        "provided": bool(section),
        "deviceCount": len(devices),
        "missingInputs": missing_inputs,
        "capabilityBoundary": missing_capability,
        "acceptanceChecks": checks,
        "equivalentDampingEstimate": equivalent_estimate or None,
        "timeHistoryEstimate": time_history_estimate or None,
    }


def audit_special_systems(
    workflow: Dict[str, Any],
    basis: Optional[Any] = None,
    modal: Optional[Any] = None,
    response_envelope: Optional[Dict[str, Any]] = None,
    ground_motions: Optional[Sequence[Any]] = None,
) -> Dict[str, Any]:
    isolation_requested = (
        _structured_bool(workflow, "hasIsolation")
        or bool(as_record(workflow.get("isolationSystem")))
        or bool(as_record(workflow.get("baseIsolationSystem")))
    )
    energy_requested = (
        _structured_bool(workflow, "hasEnergyDissipation")
        or _structured_bool(workflow, "hasEnergyDissipationSystem")
        or _structured_bool(workflow, "hasDampingDevice")
        or bool(as_record(workflow.get("energyDissipationSystem")))
        or bool(as_record(workflow.get("dampingSystem")))
        or bool(as_record(workflow.get("dampingDevices")))
    )
    if not isolation_requested and not energy_requested:
        return {}

    reasons: List[str] = []
    missing_capabilities: List[str] = []
    systems: List[Dict[str, Any]] = []
    if isolation_requested:
        reasons.append("Structured workflow marks an isolation system; specialized isolation seismic analysis is required.")
        missing_capabilities.append("gb50011.isolationSystemSpecialSeismicAnalysis")
        systems.append(_audit_isolation(
            workflow,
            "gb50011.isolationSystemSpecialSeismicAnalysis",
            basis,
            modal,
            ground_motions,
        ))
    if energy_requested:
        reasons.append("Structured workflow marks an energy-dissipation system; specialized damping-device seismic analysis is required.")
        missing_capabilities.append("gb50011.energyDissipationSystemSpecialSeismicAnalysis")
        systems.append(_audit_energy_dissipation(
            workflow,
            "gb50011.energyDissipationSystemSpecialSeismicAnalysis",
            basis,
            modal,
            response_envelope,
            ground_motions,
        ))

    checks = [
        check
        for system in systems
        for check in system.get("acceptanceChecks", [])
        if isinstance(check, dict)
    ]
    missing_inputs = list(dict.fromkeys([
        field
        for system in systems
        for field in system.get("missingInputs", [])
        if isinstance(field, str) and field.strip()
    ]))
    failed_checks = [check for check in checks if check.get("status") == "fail"]
    isolation_estimate = next((
        as_record(system.get("equivalentLinearEstimate"))
        for system in systems
        if system.get("type") == "isolation" and as_record(system.get("equivalentLinearEstimate"))
    ), {})
    isolation_time_history_estimate = next((
        as_record(system.get("timeHistoryEstimate"))
        for system in systems
        if system.get("type") == "isolation" and as_record(system.get("timeHistoryEstimate"))
    ), {})
    energy_estimate = next((
        as_record(system.get("equivalentDampingEstimate"))
        for system in systems
        if system.get("type") == "energy_dissipation" and as_record(system.get("equivalentDampingEstimate"))
    ), {})
    energy_time_history_estimate = next((
        as_record(system.get("timeHistoryEstimate"))
        for system in systems
        if system.get("type") == "energy_dissipation" and as_record(system.get("timeHistoryEstimate"))
    ), {})
    implemented_capabilities = []
    if isolation_estimate.get("status") == "estimated":
        implemented_capabilities.extend([
            "isolationEquivalentLinearSpectrumEstimate",
            "gb50011.isolationDisplacementDemandTrace",
        ])
    if isolation_time_history_estimate.get("status") == "estimated":
        implemented_capabilities.extend([
            "isolationLayerSdofTimeHistoryEstimate",
            "gb50011.isolationLayerDynamicDisplacementTrace",
        ])
    if energy_estimate.get("status") == "estimated":
        implemented_capabilities.extend([
            "energyDissipationEquivalentDampingEstimate",
            "gb50011.energyDissipationDeformationDemandTrace",
        ])
    if energy_time_history_estimate.get("status") == "estimated":
        implemented_capabilities.extend([
            "energyDissipationSdofTimeHistoryEstimate",
            "gb50011.energyDissipationDeviceDynamicDemandTrace",
        ])
    return {
        "reviewRequired": True,
        "status": "partial",
        "systems": [system["type"] for system in systems],
        "reasons": reasons,
        "missingInputs": missing_inputs,
        "capabilityBoundaries": list(dict.fromkeys(missing_capabilities)),
        "deviceCounts": {
            system["type"]: system["deviceCount"]
            for system in systems
        },
        "checks": checks,
        "failedCheckCount": len(failed_checks),
        "implementedCapabilities": implemented_capabilities,
        "isolationEquivalentLinearEstimate": isolation_estimate or None,
        "isolationLayerTimeHistoryEstimate": isolation_time_history_estimate or None,
        "energyDissipationEquivalentEstimate": energy_estimate or None,
        "energyDissipationTimeHistoryEstimate": energy_time_history_estimate or None,
        "systemsDetail": systems,
    }
