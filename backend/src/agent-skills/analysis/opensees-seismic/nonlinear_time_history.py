from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Sequence, Tuple

from design_basis import model_payload
from gb50011_drift_limits import gb50011_advisory_yield_drift_metadata
from modal import (
    _effective_section_properties,
    _element_nodes,
    _element_type,
    _field,
    _is_opensees_line_element_type,
    _material_e,
    _material_map,
    _model_dimension,
    _node_key,
    _records,
    _restraints_for_node,
    _section_map,
)
from pushover import _convergence_settings, _member_plastic_hinge_definitions
from seismic_contracts import as_record, as_records, first_number, optional_number, performance_objective_from_workflow


ELASTIC_PLASTIC_TIME_HISTORY_CAPABILITY = "gb50011.elasticPlasticTimeHistoryAnalysis"
ELASTIC_PLASTIC_TIME_HISTORY_ESTIMATE_CAPABILITY = "elasticPlasticTimeHistoryEstimate"
ELASTIC_PLASTIC_STORY_SHEAR_BUILDING_ESTIMATE_CAPABILITY = "elasticPlasticStoryShearBuildingEstimate"
ELASTIC_PLASTIC_MEMBER_HINGE_2D_CAPABILITY = "elasticPlasticMemberPlasticHinge2dTimeHistory"
ELASTIC_PLASTIC_TIME_HISTORY_FULL_MEMBER_CAPABILITY = "gb50011.elasticPlasticTimeHistoryFullMemberAnalysis"
NONLINEAR_MODEL_AUDIT_CAPABILITY = "nonlinearModelStructuredInputAudit"


def _workflow_section(workflow: Dict[str, Any]) -> Dict[str, Any]:
    elastic_plastic = as_record(workflow.get("elasticPlasticTimeHistory"))
    nonlinear_time_history = as_record(workflow.get("nonlinearTimeHistory"))
    nonlinear_model = as_record(workflow.get("nonlinearModel"))
    return {
        **nonlinear_model,
        **nonlinear_time_history,
        **elastic_plastic,
    }


def _structured_entries(section: Dict[str, Any], *keys: str) -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []
    for key in keys:
        value = section.get(key)
        if isinstance(value, list):
            entries.extend(as_records(value))
            continue
        if isinstance(value, dict):
            nested = [item for item in value.values() if isinstance(item, dict)]
            if nested:
                entries.extend(nested)
            elif value:
                entries.append(value)
    return entries


def _has_hinge_backbone(entry: Dict[str, Any]) -> bool:
    for key in ("backbone", "momentRotation", "momentRotationBackbone", "rotationBackbone"):
        if as_record(entry.get(key)):
            return True
    has_yield_moment = first_number(
        entry.get("yieldMoment"),
        entry.get("yieldMomentKNm"),
        entry.get("momentYield"),
        entry.get("My"),
        entry.get("positiveYieldMoment"),
    ) is not None
    has_yield_rotation = first_number(
        entry.get("yieldRotation"),
        entry.get("rotationYield"),
        entry.get("thetaY"),
        entry.get("positiveYieldRotation"),
    ) is not None
    return has_yield_moment and has_yield_rotation


def _build_nonlinear_model_audit(workflow: Dict[str, Any]) -> Dict[str, Any]:
    nonlinear_model = as_record(workflow.get("nonlinearModel"))
    nonlinear_time_history = as_record(workflow.get("nonlinearTimeHistory"))
    elastic_plastic = as_record(workflow.get("elasticPlasticTimeHistory"))
    material_models = _structured_entries(
        nonlinear_model,
        "materialConstitutiveModels",
        "constitutiveModels",
        "materialModels",
        "materials",
    )
    hinges = _structured_entries(
        nonlinear_model,
        "memberPlasticHinges",
        "plasticHinges",
        "memberHinges",
        "hinges",
    )
    convergence = (
        as_record(nonlinear_time_history.get("convergenceCriteria"))
        or as_record(elastic_plastic.get("convergenceCriteria"))
        or as_record(nonlinear_model.get("convergenceCriteria"))
    )
    calibrated_hinges = [hinge for hinge in hinges if _has_hinge_backbone(hinge)]
    missing_inputs: List[str] = []
    if not material_models:
        missing_inputs.extend([
            "nonlinearModel.materialConstitutiveModels",
            "nonlinearModel.fullMemberConstitutiveModels",
        ])
    if not hinges:
        missing_inputs.extend([
            "nonlinearModel.memberPlasticHinges",
            "nonlinearModel.memberPlasticHingeBackboneCalibration",
        ])
    elif len(calibrated_hinges) < len(hinges):
        missing_inputs.append("nonlinearModel.memberPlasticHingeBackboneCalibration")
    if not convergence:
        missing_inputs.append("nonlinearTimeHistory.convergenceCriteria")
    provided_count = len(material_models) + len(hinges) + (1 if convergence else 0)
    status = "complete" if not missing_inputs else "partial" if provided_count > 0 else "missing"
    return {
        "status": status,
        "materialModelCount": len(material_models),
        "memberPlasticHingeCount": len(hinges),
        "calibratedPlasticHingeCount": len(calibrated_hinges),
        "hasConvergenceCriteria": bool(convergence),
        "missingInputs": list(dict.fromkeys(missing_inputs)),
        "solverScope": "structured nonlinear inputs are audited; current solver remains a bilinear reduced-model estimate",
    }


def _first_mode(modal: Any) -> Dict[str, Any]:
    modes = getattr(modal, "modes", None)
    if isinstance(modes, list) and modes:
        mode = modes[0]
        return mode if isinstance(mode, dict) else {}
    return {}


def _analysis_parameters(workflow: Dict[str, Any], basis: Any, modal: Any) -> Dict[str, Any]:
    section = _workflow_section(workflow)
    performance_objective = performance_objective_from_workflow(
        workflow,
        "elasticPlasticTimeHistory",
        "nonlinearTimeHistory",
    )
    mode = _first_mode(modal)
    period = first_number(section.get("period"), mode.get("period")) or 0.8
    mass = first_number(section.get("equivalentMass"), section.get("mass"), mode.get("effectiveMass"), getattr(modal, "total_mass", None)) or 1.0
    omega = 2.0 * math.pi / max(period, 1e-6)
    stiffness = max(mass * omega * omega, 1e-9)
    total_weight = first_number(section.get("totalWeightKN"), getattr(modal, "total_mass", None) * 9.80665 if getattr(modal, "total_mass", None) else None)
    assumptions: List[str] = []

    yield_displacement = first_number(
        section.get("yieldDisplacementM"),
        section.get("yieldDisplacement"),
        section.get("yieldRoofDisplacementM"),
    )
    yield_base_shear_coefficient = first_number(
        section.get("yieldBaseShearCoefficient"),
        section.get("yieldShearCoefficient"),
    )
    if yield_displacement is None and yield_base_shear_coefficient is not None and total_weight is not None:
        yield_displacement = yield_base_shear_coefficient * total_weight / stiffness
    yield_drift = first_number(section.get("yieldDriftRatio"), section.get("yieldStoryDriftRatio"))
    yield_drift_metadata: Optional[Dict[str, Any]] = None
    if yield_displacement is None:
        if yield_drift is None:
            yield_drift_metadata = gb50011_advisory_yield_drift_metadata(getattr(basis, "structural_family", ""))
            yield_drift = float(yield_drift_metadata["limit"])
        height = max(float(getattr(basis, "height_m", 0.0) or 0.0), float(getattr(basis, "story_count", 0) or 0) * 3.0, 1.0)
        yield_displacement = yield_drift * height
        if yield_drift_metadata is not None:
            assumptions.append(
                "No nonlinear yield drift was provided; used "
                f"{yield_drift_metadata['familyLabel']} elastic drift limit "
                f"1/{yield_drift_metadata['denominator']} as an advisory yield-displacement estimate."
            )

    post_yield_ratio = first_number(
        section.get("postYieldStiffnessRatio"),
        section.get("hardeningRatio"),
        section.get("b"),
    )
    if post_yield_ratio is None:
        post_yield_ratio = 0.03
        assumptions.append("No post-yield stiffness ratio was provided; used 0.03 for the bilinear SDOF estimate.")

    acceptance_drift = first_number(
        section.get("acceptanceDriftRatio"),
        section.get("limitDriftRatio"),
        performance_objective.get("acceptanceDriftRatio"),
    ) or 0.02
    if (
        "acceptanceDriftRatio" not in section
        and "limitDriftRatio" not in section
        and "acceptanceDriftRatio" not in performance_objective
    ):
        assumptions.append("No elastic-plastic drift acceptance ratio was provided; used advisory drift ratio 0.02.")

    return {
        "period": period,
        "mass": mass,
        "stiffness": stiffness,
        "yieldDisplacementM": max(float(yield_displacement or 0.0), 1e-9),
        "yieldBaseShearKN": stiffness * max(float(yield_displacement or 0.0), 1e-9),
        **({"yieldDriftRatio": float(yield_drift)} if yield_drift is not None else {}),
        **({
            "yieldDriftSource": yield_drift_metadata["source"],
            "yieldDriftLimitFamily": yield_drift_metadata["familyLabel"],
            "yieldDriftLimitRatioText": f"1/{yield_drift_metadata['denominator']}",
            "yieldDriftIsFallback": bool(yield_drift_metadata.get("isFallback")),
        } if yield_drift_metadata is not None else {}),
        "postYieldStiffnessRatio": max(float(post_yield_ratio or 0.0), 0.0),
        "acceptanceDriftRatio": acceptance_drift,
        "performanceObjective": performance_objective,
        "assumptions": assumptions,
    }


def _scale_factor(time_history: Optional[Dict[str, Any]], index: int) -> float:
    records = time_history.get("records") if isinstance(time_history, dict) and isinstance(time_history.get("records"), list) else []
    if index < len(records) and isinstance(records[index], dict):
        return optional_number(records[index].get("scaleFactor")) or 1.0
    return 1.0


def _combined_base_shear(records: List[Dict[str, Any]], combination_rule: str) -> float:
    values = [abs(float(record.get("maxBaseShearKN", 0.0) or 0.0)) for record in records]
    if not values:
        return 0.0
    if combination_rule == "mean_vs_response_spectrum" and len(values) >= 7:
        return sum(values) / len(values)
    return max(values)


def _final_compliance(
    *,
    max_drift: float,
    acceptance_drift: float,
    scope: str,
    performance_objective: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    utilization = max_drift / max(acceptance_drift, 1e-12)
    return {
        "status": "pass" if utilization <= 1.0 else "fail",
        "method": "elastic_plastic_time_history_drift_acceptance",
        "source": "elasticPlasticTimeHistory.acceptanceCheck",
        "scope": scope,
        "driftRatio": round(max_drift, 8),
        "limitDriftRatio": round(acceptance_drift, 8),
        "utilization": round(utilization, 6),
        **({"performanceObjective": performance_objective} if performance_objective else {}),
        "clauseBasis": "GB 55002-2021 + GB/T 50011-2010(2024) rare-earthquake elastic-plastic deformation acceptance concept",
    }


def _run_single_bilinear_sdof(ops: Any, motion: Any, scale_factor: float, params: Dict[str, Any]) -> Dict[str, Any]:
    mass = float(params["mass"])
    stiffness = float(params["stiffness"])
    yield_base_shear = float(params["yieldBaseShearKN"])
    post_yield_ratio = float(params["postYieldStiffnessRatio"])
    period = float(params["period"])
    damping_ratio = float(params.get("dampingRatio") or 0.05)
    dt = float(getattr(motion, "dt", 0.02) or 0.02)
    scaled_accelerations = [float(value) * scale_factor for value in getattr(motion, "accelerations_mps2", [])]

    ops.wipe()
    ops.model("basic", "-ndm", 1, "-ndf", 1)
    ops.node(1, 0.0)
    ops.node(2, 0.0)
    ops.fix(1, 1)
    ops.mass(2, mass)
    ops.uniaxialMaterial("Steel01", 1, yield_base_shear, stiffness, post_yield_ratio)
    ops.element("zeroLength", 1, 1, 2, "-mat", 1, "-dir", 1)
    ops.timeSeries("Path", 1, "-dt", dt, "-values", *scaled_accelerations)
    ops.pattern("UniformExcitation", 1, 1, "-accel", 1)
    beta_k = 2.0 * damping_ratio / max(2.0 * math.pi / max(period, 1e-6), 1e-9)
    ops.rayleigh(0.0, beta_k, 0.0, 0.0)
    ops.constraints("Plain")
    ops.numberer("Plain")
    ops.system("BandGeneral")
    ops.test("NormDispIncr", 1.0e-8, 20)
    ops.algorithm("Newton")
    ops.integrator("Newmark", 0.5, 0.25)
    ops.analysis("Transient")

    max_displacement = 0.0
    max_base_shear = 0.0
    completed_steps = 0
    converged = True
    for _ in scaled_accelerations:
        if ops.analyze(1, dt) != 0:
            converged = False
            break
        completed_steps += 1
        displacement = abs(float(ops.nodeDisp(2, 1)))
        max_displacement = max(max_displacement, displacement)
        try:
            forces = ops.eleForce(1)
            max_base_shear = max(max_base_shear, max(abs(float(value)) for value in forces))
        except Exception:
            max_base_shear = max(max_base_shear, min(displacement * stiffness, yield_base_shear + max(displacement - params["yieldDisplacementM"], 0.0) * stiffness * post_yield_ratio))

    return {
        "maxDisplacementM": max_displacement,
        "maxBaseShearKN": max_base_shear,
        "completedSteps": completed_steps,
        "requestedSteps": len(scaled_accelerations),
        "converged": converged,
    }


def _story_shear_building_definition(modal: Any, basis: Any, params: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    floors = [
        floor for floor in sorted(
            getattr(modal, "floor_masses", []) or [],
            key=lambda item: float(item.get("elevation", 0.0) or 0.0),
        )
        if isinstance(floor, dict)
        and float(floor.get("mass", 0.0) or 0.0) > 0.0
        and float(floor.get("elevation", 0.0) or 0.0) > 0.0
    ]
    if len(floors) < 2:
        return None

    total_height = max(float(getattr(basis, "height_m", 0.0) or 0.0), float(floors[-1].get("elevation", 0.0) or 0.0))
    if total_height <= 0.0:
        return None

    story_heights: List[float] = []
    lower_elevation = 0.0
    for index, floor in enumerate(floors):
        elevation = float(floor.get("elevation", 0.0) or 0.0)
        height = elevation - lower_elevation
        if height <= 1e-9:
            height = total_height / len(floors)
        story_heights.append(height)
        lower_elevation = elevation

    story_count = len(floors)
    equivalent_stiffness = float(params["stiffness"])
    story_stiffness = equivalent_stiffness * story_count
    yield_roof_displacement = float(params["yieldDisplacementM"])
    yield_drift = yield_roof_displacement / max(sum(story_heights), 1e-9)
    yield_deformations = [max(yield_drift * height, 1e-9) for height in story_heights]
    return {
        "floors": floors,
        "storyHeights": story_heights,
        "storyStiffnesses": [story_stiffness] * story_count,
        "yieldDeformations": yield_deformations,
        "postYieldStiffnessRatio": float(params["postYieldStiffnessRatio"]),
        "period": float(params["period"]),
        "dampingRatio": float(params.get("dampingRatio") or 0.05),
        "totalHeightM": sum(story_heights),
    }


def _run_story_shear_building(ops: Any, motion: Any, scale_factor: float, definition: Dict[str, Any]) -> Dict[str, Any]:
    floors = definition["floors"]
    story_heights = definition["storyHeights"]
    stiffnesses = definition["storyStiffnesses"]
    yield_deformations = definition["yieldDeformations"]
    post_yield_ratio = float(definition["postYieldStiffnessRatio"])
    period = float(definition["period"])
    damping_ratio = float(definition["dampingRatio"])
    dt = float(getattr(motion, "dt", 0.02) or 0.02)
    scaled_accelerations = [float(value) * scale_factor for value in getattr(motion, "accelerations_mps2", [])]

    ops.wipe()
    ops.model("basic", "-ndm", 1, "-ndf", 1)
    node_tags = [index + 1 for index in range(len(floors) + 1)]
    for tag in node_tags:
        ops.node(tag, 0.0)
    ops.fix(node_tags[0], 1)
    for index, floor in enumerate(floors):
        ops.mass(node_tags[index + 1], float(floor.get("mass", 0.0) or 0.0))
    for index, stiffness in enumerate(stiffnesses):
        mat_tag = index + 1
        element_tag = index + 1
        yield_force = max(float(stiffness) * float(yield_deformations[index]), 1e-9)
        ops.uniaxialMaterial("Steel01", mat_tag, yield_force, float(stiffness), post_yield_ratio)
        ops.element("zeroLength", element_tag, node_tags[index], node_tags[index + 1], "-mat", mat_tag, "-dir", 1)
    ops.timeSeries("Path", 1, "-dt", dt, "-values", *scaled_accelerations)
    ops.pattern("UniformExcitation", 1, 1, "-accel", 1)
    beta_k = 2.0 * damping_ratio / max(2.0 * math.pi / max(period, 1e-6), 1e-9)
    ops.rayleigh(0.0, beta_k, 0.0, 0.0)
    ops.constraints("Plain")
    ops.numberer("Plain")
    ops.system("BandGeneral")
    ops.test("NormDispIncr", 1.0e-8, 25)
    ops.algorithm("Newton")
    ops.integrator("Newmark", 0.5, 0.25)
    ops.analysis("Transient")

    max_roof_displacement = 0.0
    max_base_shear = 0.0
    max_story_drifts = [0.0] * len(floors)
    max_story_displacements = [0.0] * len(floors)
    max_story_ductilities = [0.0] * len(floors)
    completed_steps = 0
    converged = True
    for _ in scaled_accelerations:
        if ops.analyze(1, dt) != 0:
            converged = False
            break
        completed_steps += 1
        floor_displacements = [float(ops.nodeDisp(tag, 1)) for tag in node_tags[1:]]
        max_roof_displacement = max(max_roof_displacement, abs(floor_displacements[-1]))
        lower_displacement = 0.0
        for index, displacement in enumerate(floor_displacements):
            interstory = displacement - lower_displacement
            max_story_displacements[index] = max(max_story_displacements[index], abs(interstory))
            max_story_drifts[index] = max(max_story_drifts[index], abs(interstory) / max(float(story_heights[index]), 1e-9))
            max_story_ductilities[index] = max(max_story_ductilities[index], abs(interstory) / max(float(yield_deformations[index]), 1e-12))
            lower_displacement = displacement
        try:
            forces = ops.eleForce(1)
            max_base_shear = max(max_base_shear, max(abs(float(value)) for value in forces))
        except Exception:
            max_base_shear = max(max_base_shear, abs(floor_displacements[0]) * float(stiffnesses[0]))

    story_responses = []
    for index, floor in enumerate(floors):
        story_responses.append({
            "story": floor.get("story") or f"F{index + 1}",
            "elevation": round(float(floor.get("elevation", 0.0) or 0.0), 6),
            "storyHeightM": round(float(story_heights[index]), 6),
            "maxInterstoryDisplacementM": round(max_story_displacements[index], 8),
            "maxDriftRatio": round(max_story_drifts[index], 8),
            "ductility": round(max_story_ductilities[index], 6),
        })

    return {
        "maxDisplacementM": max_roof_displacement,
        "maxBaseShearKN": max_base_shear,
        "maxStoryDriftRatio": max(max_story_drifts, default=0.0),
        "storyResponses": story_responses,
        "completedSteps": completed_steps,
        "requestedSteps": len(scaled_accelerations),
        "converged": converged,
    }


def _base_and_floor_tags(nodes: Sequence[Any], node_tags: Dict[str, int], floor_masses: Sequence[Dict[str, Any]]) -> Tuple[List[int], List[Dict[str, Any]]]:
    elevations = [float(_field(node, "z", 0.0) or 0.0) for node in nodes]
    if not elevations:
        return [], []
    base_elevation = min(elevations)
    base_tags = [
        node_tags[_node_key(node)]
        for node in nodes
        if _node_key(node) in node_tags
        and abs(float(_field(node, "z", 0.0) or 0.0) - base_elevation) <= 1.0e-6
    ]
    floors: List[Dict[str, Any]] = []
    for floor in sorted(floor_masses, key=lambda item: float(item.get("elevation", 0.0) or 0.0)):
        elevation = float(floor.get("elevation", 0.0) or 0.0)
        if elevation <= base_elevation + 1.0e-9:
            continue
        tags = [
            node_tags[_node_key(node)]
            for node in nodes
            if _node_key(node) in node_tags
            and abs(float(_field(node, "z", 0.0) or 0.0) - elevation) <= 1.0e-6
        ]
        if tags:
            floors.append({**floor, "nodeTags": tags})
    return base_tags, floors


def _assign_floor_masses(ops: Any, nodes: Sequence[Any], node_tags: Dict[str, int], floor_masses: Sequence[Dict[str, Any]]) -> None:
    for floor in floor_masses:
        elevation = float(floor.get("elevation", 0.0) or 0.0)
        level_nodes = [
            node for node in nodes
            if abs(float(_field(node, "z", 0.0) or 0.0) - elevation) <= 1.0e-6
        ]
        if not level_nodes:
            continue
        node_mass = float(floor.get("mass", 0.0) or 0.0) / max(len(level_nodes), 1)
        for node in level_nodes:
            ops.mass(node_tags[_node_key(node)], node_mass, 0.0, 0.0)


def _member_hinge_floor_responses(ops: Any, floors: Sequence[Dict[str, Any]], total_height: float) -> Tuple[float, List[Dict[str, Any]]]:
    story_responses: List[Dict[str, Any]] = []
    lower_displacement = 0.0
    lower_elevation = 0.0
    max_drift = 0.0
    for index, floor in enumerate(floors):
        tags = [int(tag) for tag in floor.get("nodeTags", [])]
        displacement = sum(float(ops.nodeDisp(tag, 1)) for tag in tags) / max(len(tags), 1)
        elevation = float(floor.get("elevation", 0.0) or 0.0)
        story_height = elevation - lower_elevation
        if story_height <= 1.0e-9:
            story_height = total_height / max(len(floors), 1)
        interstory = displacement - lower_displacement
        drift = abs(interstory) / max(story_height, 1.0e-9)
        max_drift = max(max_drift, drift)
        story_responses.append({
            "story": floor.get("story") or f"F{index + 1}",
            "elevation": round(elevation, 6),
            "storyHeightM": round(story_height, 6),
            "interstoryDisplacementM": round(interstory, 8),
            "driftRatio": round(drift, 8),
        })
        lower_displacement = displacement
        lower_elevation = elevation
    return max_drift, story_responses


def _run_member_hinge_2d_time_history(
    ops: Any,
    *,
    model: Any,
    modal: Any,
    motion: Any,
    scale_factor: float,
    workflow: Dict[str, Any],
    params: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    payload = model_payload(model)
    nodes = _records(payload, model, "nodes")
    elements = _records(payload, model, "elements")
    if _model_dimension(nodes) != "2d":
        return None

    section = _workflow_section(workflow)
    hinges, missing_inputs = _member_plastic_hinge_definitions({"nonlinearModel": as_record(workflow.get("nonlinearModel")), **section}, elements)
    if not hinges:
        return None

    sections = _section_map(_records(payload, model, "sections"))
    materials = _material_map(_records(payload, model, "materials"))
    node_lookup = {_node_key(node): node for node in nodes}
    node_tags = {_node_key(node): index + 1 for index, node in enumerate(nodes)}
    floor_masses = getattr(modal, "floor_masses", []) or []
    base_tags, floors = _base_and_floor_tags(nodes, node_tags, floor_masses)
    if not base_tags or not floors:
        return None

    hinge_by_element_end = {
        (str(hinge["elementId"]), str(hinge["end"])): hinge
        for hinge in hinges
    }
    convergence = _convergence_settings({"nonlinearModel": as_record(workflow.get("nonlinearModel")), **section})
    dt = float(getattr(motion, "dt", 0.02) or 0.02)
    scaled_accelerations = [float(value) * scale_factor for value in getattr(motion, "accelerations_mps2", [])]
    if not scaled_accelerations:
        return None

    hinge_runtime: List[Dict[str, Any]] = []
    hinge_peaks: Dict[str, Dict[str, Any]] = {}
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

        _assign_floor_masses(ops, nodes, node_tags, floor_masses)
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
            section_record = sections.get(str(_field(element, "section", "")))
            if section_record is None:
                continue
            material = materials.get(str(_field(element, "material", "")))
            area, iy, iz, _torsion = _effective_section_properties(element_type, section_record)
            inertia = max(iy, iz, 1.0e-8)
            e_modulus = _material_e(material, section_record)
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
                material_tag = next_material_tag
                next_material_tag += 1
                hinge_element_tag = 200_000 + len(hinge_runtime) + 1
                ops.uniaxialMaterial(
                    "Steel01",
                    material_tag,
                    yield_moment,
                    yield_moment / yield_rotation,
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
                    "yieldMomentKNm": yield_moment,
                    "yieldRotationRad": yield_rotation,
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
            return None

        ops.timeSeries("Path", 40_001, "-dt", dt, "-values", *scaled_accelerations)
        ops.pattern("UniformExcitation", 40_001, 1, "-accel", 40_001)
        period = float(params["period"])
        damping_ratio = float(params.get("dampingRatio") or 0.05)
        beta_k = 2.0 * damping_ratio / max(2.0 * math.pi / max(period, 1.0e-6), 1.0e-9)
        ops.rayleigh(0.0, beta_k, 0.0, 0.0)
        ops.wipeAnalysis()
        ops.constraints("Transformation")
        ops.numberer("RCM")
        ops.system("BandGeneral")
        ops.test(convergence["test"], convergence["tolerance"], convergence["maxIterations"])
        ops.algorithm("Newton")
        ops.integrator("Newmark", 0.5, 0.25)
        ops.analysis("Transient")

        max_roof_displacement = 0.0
        max_base_shear = 0.0
        max_story_drift = 0.0
        controlling_story_responses: List[Dict[str, Any]] = []
        total_height = max(float(floor.get("elevation", 0.0) or 0.0) for floor in floors)
        roof_tags = [int(tag) for tag in floors[-1].get("nodeTags", [])]
        completed_steps = 0
        converged = True
        for step, _value in enumerate(scaled_accelerations, start=1):
            if ops.analyze(1, dt) != 0:
                converged = False
                break
            completed_steps += 1
            roof_displacement = max((abs(float(ops.nodeDisp(tag, 1))) for tag in roof_tags), default=0.0)
            max_roof_displacement = max(max_roof_displacement, roof_displacement)
            try:
                ops.reactions()
                max_base_shear = max(max_base_shear, abs(sum(float(ops.nodeReaction(tag, 1)) for tag in base_tags)))
            except Exception:
                pass
            story_drift, story_responses = _member_hinge_floor_responses(ops, floors, total_height)
            if story_drift > max_story_drift:
                max_story_drift = story_drift
                controlling_story_responses = story_responses
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
                    "step": step,
                }
                previous = hinge_peaks.get(str(hinge["id"]))
                if previous is None or ductility > float(previous.get("ductility", 0.0) or 0.0):
                    hinge_peaks[str(hinge["id"])] = response
    finally:
        try:
            ops.wipe()
        except Exception:
            pass

    if not hinge_peaks:
        return None
    controlling_hinge = max(
        hinge_peaks.values(),
        key=lambda item: float(item.get("ductility", 0.0) or 0.0),
        default={},
    )
    return {
        "maxDisplacementM": max_roof_displacement,
        "maxBaseShearKN": max_base_shear,
        "maxStoryDriftRatio": max_story_drift,
        "storyResponses": controlling_story_responses,
        "hingeResponses": list(hinge_peaks.values()),
        "controllingHinge": controlling_hinge,
        "maxHingeDuctility": float(controlling_hinge.get("ductility", 0.0) or 0.0),
        "completedSteps": completed_steps,
        "requestedSteps": len(scaled_accelerations),
        "converged": converged,
        "modelScope": "member_end_rotational_plastic_hinges_2d",
        "missingInputs": list(dict.fromkeys(missing_inputs)),
        "convergenceCriteria": convergence,
    }


def run_elastic_plastic_time_history_estimate(
    *,
    model: Any = None,
    workflow: Dict[str, Any],
    basis: Any,
    modal: Any,
    motions: List[Any],
    time_history: Optional[Dict[str, Any]],
    combination_rule: str,
) -> Dict[str, Any]:
    if not motions:
        return build_elastic_plastic_time_history_requirement(
            decision=type("Decision", (), {"requires_elastic_plastic_time_history": True})(),
            time_history=time_history,
            workflow=workflow,
        ) or {}

    params = _analysis_parameters(workflow, basis, modal)
    params["dampingRatio"] = float(getattr(basis, "damping_ratio", 0.05) or 0.05)
    nonlinear_model_audit = _build_nonlinear_model_audit(workflow)
    story_definition = _story_shear_building_definition(modal, basis, params)
    records: List[Dict[str, Any]] = []
    warnings: List[str] = []
    story_model_used = False
    member_hinge_model_used = False
    member_hinge_missing_inputs: List[str] = []
    try:
        import openseespy.opensees as ops
        for index, motion in enumerate(motions):
            scale_factor = _scale_factor(time_history, index)
            response = None
            if model is not None:
                try:
                    response = _run_member_hinge_2d_time_history(
                        ops,
                        model=model,
                        modal=modal,
                        motion=motion,
                        scale_factor=scale_factor,
                        workflow=workflow,
                        params=params,
                    )
                    if response is not None:
                        member_hinge_model_used = True
                        member_hinge_missing_inputs.extend(response.get("missingInputs", []) if isinstance(response.get("missingInputs"), list) else [])
                except Exception as member_hinge_error:
                    if not warnings:
                        warnings.append(f"OpenSees 2D member-end plastic-hinge time-history model failed; fell back to reduced nonlinear estimate: {member_hinge_error}")
            if story_definition is not None:
                if response is None:
                    try:
                        response = _run_story_shear_building(ops, motion, scale_factor, story_definition)
                        story_model_used = True
                    except Exception as story_error:
                        if not warnings:
                            warnings.append(f"OpenSees bilinear story-shear model failed; fell back to SDOF estimate: {story_error}")
            if response is None:
                response = _run_single_bilinear_sdof(ops, motion, scale_factor, params)
            drift_ratio = response.get("maxStoryDriftRatio")
            if not isinstance(drift_ratio, (int, float)):
                drift_ratio = response["maxDisplacementM"] / max(float(getattr(basis, "height_m", 0.0) or 0.0), 1.0)
            record = {
                "name": str(getattr(motion, "name", f"GM{index + 1}")),
                "scaleFactor": round(scale_factor, 6),
                "maxDisplacementM": round(response["maxDisplacementM"], 8),
                "maxBaseShearKN": round(response["maxBaseShearKN"], 6),
                "ductility": round(response["maxDisplacementM"] / max(float(params["yieldDisplacementM"]), 1e-12), 6),
                "driftRatio": round(float(drift_ratio), 8),
                "completedSteps": response["completedSteps"],
                "requestedSteps": response["requestedSteps"],
                "converged": response["converged"],
            }
            if isinstance(response.get("modelScope"), str):
                record["modelScope"] = response["modelScope"]
            if isinstance(response.get("storyResponses"), list):
                record["storyResponses"] = response["storyResponses"]
                record["maxStoryDriftRatio"] = round(float(response.get("maxStoryDriftRatio") or 0.0), 8)
            if isinstance(response.get("hingeResponses"), list):
                record["hingeResponses"] = response["hingeResponses"]
                record["controllingHinge"] = response.get("controllingHinge")
                record["maxHingeDuctility"] = round(float(response.get("maxHingeDuctility", 0.0) or 0.0), 6)
            records.append(record)
    except Exception as error:
        requirement = build_elastic_plastic_time_history_requirement(
            decision=type("Decision", (), {"requires_elastic_plastic_time_history": True})(),
            time_history=time_history,
            workflow=workflow,
        ) or {}
        return {
            **requirement,
            "status": "estimate_failed",
            "engineMode": "opensees_bilinear_story_shear_building_estimate" if story_definition is not None else "opensees_bilinear_sdof_estimate",
            "warnings": [f"OpenSees bilinear elastic-plastic estimate failed: {error}"],
        }

    combined_base_shear = _combined_base_shear(records, combination_rule)
    max_drift = max((float(record["driftRatio"]) for record in records), default=0.0)
    acceptance_drift = float(params["acceptanceDriftRatio"])
    if member_hinge_model_used:
        scope = "OpenSees 2D member-end rotational plastic-hinge nonlinear time-history estimate"
        engine_mode = "opensees_member_end_plastic_hinge_2d_time_history_estimate"
        model_scope = "member_end_rotational_plastic_hinges_2d"
    elif story_model_used:
        scope = "OpenSees bilinear story-shear building nonlinear time-history estimate"
        engine_mode = "opensees_bilinear_story_shear_building_estimate"
        model_scope = "bilinear_story_shear_building"
    else:
        scope = "OpenSees bilinear SDOF nonlinear time-history estimate"
        engine_mode = "opensees_bilinear_sdof_estimate"
        model_scope = "bilinear_sdof"
    final_compliance = _final_compliance(
        max_drift=max_drift,
        acceptance_drift=acceptance_drift,
        scope=scope,
        performance_objective=params.get("performanceObjective") if isinstance(params.get("performanceObjective"), dict) and params["performanceObjective"] else None,
    )
    controlling_hinge = max(
        [
            hinge
            for record in records
            for hinge in (record.get("hingeResponses", []) if isinstance(record.get("hingeResponses"), list) else [])
            if isinstance(hinge, dict)
        ],
        key=lambda item: float(item.get("ductility", 0.0) or 0.0),
        default={},
    )
    controlling_story = max(
        [
            story
            for record in records
            for story in (record.get("storyResponses", []) if isinstance(record.get("storyResponses"), list) else [])
            if isinstance(story, dict)
        ],
        key=lambda item: float(item.get("maxDriftRatio", item.get("driftRatio", 0.0)) or 0.0),
        default={},
    )
    return {
        "required": True,
        "status": "estimated",
        "engineMode": engine_mode,
        "records": records,
        "combinedBaseShearKN": round(combined_base_shear, 6),
        "maxDriftRatio": round(max_drift, 8),
        "acceptanceDriftRatio": round(acceptance_drift, 8),
        "acceptanceCheck": {
            "status": "pass" if max_drift <= acceptance_drift else "fail",
            "utilization": round(max_drift / max(acceptance_drift, 1e-12), 6),
            **({"performanceObjective": params["performanceObjective"]} if isinstance(params.get("performanceObjective"), dict) and params["performanceObjective"] else {}),
        },
        "finalCompliance": final_compliance,
        "parameters": {
            "period": round(float(params["period"]), 6),
            "mass": round(float(params["mass"]), 6),
            "stiffnessKNPerM": round(float(params["stiffness"]), 6),
            "yieldDisplacementM": round(float(params["yieldDisplacementM"]), 8),
            "yieldBaseShearKN": round(float(params["yieldBaseShearKN"]), 6),
            **({"yieldDriftRatio": round(float(params["yieldDriftRatio"]), 8)} if params.get("yieldDriftRatio") is not None else {}),
            **({"yieldDriftSource": params["yieldDriftSource"]} if params.get("yieldDriftSource") else {}),
            **({"yieldDriftLimitFamily": params["yieldDriftLimitFamily"]} if params.get("yieldDriftLimitFamily") else {}),
            **({"yieldDriftLimitRatioText": params["yieldDriftLimitRatioText"]} if params.get("yieldDriftLimitRatioText") else {}),
            **({"yieldDriftIsFallback": bool(params["yieldDriftIsFallback"])} if params.get("yieldDriftIsFallback") is not None else {}),
            "postYieldStiffnessRatio": round(float(params["postYieldStiffnessRatio"]), 6),
            **({"performanceObjective": params["performanceObjective"]} if isinstance(params.get("performanceObjective"), dict) and params["performanceObjective"] else {}),
            **({
                "storyCount": len(story_definition["floors"]),
                "storyStiffnessKNPerM": round(float(story_definition["storyStiffnesses"][0]), 6),
            } if story_model_used and story_definition is not None else {}),
            **({"hingeCount": len(records[0].get("hingeResponses", []))} if member_hinge_model_used and records else {}),
        },
        "fallbackElasticTimeHistoryExecuted": isinstance(time_history, dict),
        "modelScope": model_scope,
        **({"controllingHinge": controlling_hinge} if controlling_hinge else {}),
        **({"controllingStory": controlling_story} if controlling_story else {}),
        "nonlinearModelAudit": nonlinear_model_audit,
        "missingInputs": list(dict.fromkeys([
            *nonlinear_model_audit["missingInputs"],
            *(member_hinge_missing_inputs if member_hinge_model_used else []),
        ])),
        "missingCapabilities": [
            ELASTIC_PLASTIC_TIME_HISTORY_FULL_MEMBER_CAPABILITY,
        ],
        "implementedCapabilities": [
            ELASTIC_PLASTIC_TIME_HISTORY_ESTIMATE_CAPABILITY,
            *([ELASTIC_PLASTIC_MEMBER_HINGE_2D_CAPABILITY] if member_hinge_model_used else []),
            *([ELASTIC_PLASTIC_STORY_SHEAR_BUILDING_ESTIMATE_CAPABILITY] if story_model_used else []),
            ELASTIC_PLASTIC_TIME_HISTORY_CAPABILITY,
            NONLINEAR_MODEL_AUDIT_CAPABILITY,
        ],
        "assumptions": params["assumptions"],
        "warnings": warnings,
    }


def build_elastic_plastic_time_history_requirement(
    *,
    decision: Any,
    time_history: Optional[Dict[str, Any]],
    workflow: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    if not bool(getattr(decision, "requires_elastic_plastic_time_history", False)):
        return None

    nonlinear_model_audit = _build_nonlinear_model_audit(workflow or {})
    missing_inputs: List[str] = []
    if not isinstance(time_history, dict):
        missing_inputs.append("groundMotions")

    missing_inputs.extend(nonlinear_model_audit["missingInputs"])

    return {
        "required": True,
        "status": "not_implemented",
        "engineMode": "capability_boundary",
        "fallbackElasticTimeHistoryExecuted": isinstance(time_history, dict),
        "missingInputs": list(dict.fromkeys(missing_inputs)),
        "nonlinearModelAudit": nonlinear_model_audit,
        "missingCapabilities": [
            ELASTIC_PLASTIC_TIME_HISTORY_CAPABILITY,
            ELASTIC_PLASTIC_TIME_HISTORY_FULL_MEMBER_CAPABILITY,
        ],
        "implementedCapabilities": [
            NONLINEAR_MODEL_AUDIT_CAPABILITY,
        ],
        "nextAction": (
            "Provide nonlinear material constitutive models, member plastic hinge definitions, "
            "and convergence controls; then run a nonlinear OpenSees time-history solver."
        ),
    }
