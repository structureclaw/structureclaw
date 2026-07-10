from __future__ import annotations

from typing import Any, Dict, List, Tuple

from design_basis import build_design_basis
from design_actions import run_equivalent_lateral_design_actions, run_gravity_design_actions
from ground_motion import attach_opensees_transient_check, ground_motion_set_checks, parse_ground_motions, run_modal_time_history, select_ground_motions_for_direction
from design_combinations import build_member_design_action_combinations
from ground_motion_catalog import catalog_summary_for_records, resolve_catalog_records
from method_decision import decide_seismic_method
from modal import run_modal_analysis
from nonlinear_time_history import run_elastic_plastic_time_history_estimate
from opensees_seismic_analysis import OpenSeesSeismicExecutor
from opensees_shared.tags import OpenSeesTagMapper
from pushover import run_linear_pushover
from regularity import assess_regularity
from response_spectrum import apply_minimum_story_shear_adjustment, run_response_spectrum
from result_adapter import build_pushover_seismic_result, build_seismic_result
from seismic_contracts import (
    optional_number,
    performance_objective_from_workflow,
    seismic_workflow_from_parameters,
    workflow_ground_motion_records,
    workflow_method_preference,
)
from special_systems import audit_special_systems
from structure_protocol.structure_model_v2 import StructureModelV2
from vertical_seismic import run_vertical_seismic


def _modal_count(parameters: Dict[str, Any], workflow: Dict[str, Any]) -> int:
    control = workflow.get("analysisControl") if isinstance(workflow.get("analysisControl"), dict) else {}
    for value in (
        workflow.get("modalCount"),
        control.get("modalCount") if isinstance(control, dict) else None,
        parameters.get("modalCount"),
        parameters.get("numModes"),
    ):
        if isinstance(value, (int, float)) and value > 0:
            return int(value)
    return 6


def _modal_combination_rule(parameters: Dict[str, Any], workflow: Dict[str, Any]) -> str:
    control = workflow.get("analysisControl") if isinstance(workflow.get("analysisControl"), dict) else {}
    spectrum = workflow.get("responseSpectrum") if isinstance(workflow.get("responseSpectrum"), dict) else {}
    for value in (
        spectrum.get("modalCombination") if isinstance(spectrum, dict) else None,
        control.get("modalCombination") if isinstance(control, dict) else None,
        workflow.get("modalCombination"),
        parameters.get("modalCombination"),
    ):
        text = str(value or "").strip().lower()
        if text in {"srss", "square_root_sum_squares"}:
            return "srss"
        if text in {"cqc", "complete_quadratic_combination"}:
            return "cqc"
    return "cqc"


def _scale_factor_limit(parameters: Dict[str, Any], workflow: Dict[str, Any]) -> float:
    ground_motion_set = workflow.get("groundMotionSet") if isinstance(workflow.get("groundMotionSet"), dict) else {}
    control = workflow.get("analysisControl") if isinstance(workflow.get("analysisControl"), dict) else {}
    for value in (
        ground_motion_set.get("scaleFactorLimit") if isinstance(ground_motion_set, dict) else None,
        ground_motion_set.get("maxScaleFactor") if isinstance(ground_motion_set, dict) else None,
        control.get("groundMotionScaleFactorLimit") if isinstance(control, dict) else None,
        workflow.get("scaleFactorLimit"),
        parameters.get("scaleFactorLimit"),
    ):
        number = optional_number(value)
        if number is not None and number > 0.0:
            return number
    return 10.0


def _direction(parameters: Dict[str, Any], workflow: Dict[str, Any]) -> str:
    value = workflow.get("direction") or parameters.get("direction") or "x"
    direction = str(value).strip().lower()
    return "y" if direction == "y" else "x"


def _model_is_3d(model: StructureModelV2) -> bool:
    payload = model.model_dump(mode="python") if hasattr(model, "model_dump") else {}
    nodes = payload.get("nodes")
    if not isinstance(nodes, list):
        return False
    y_values = [
        optional_number(node.get("y"))
        for node in nodes
        if isinstance(node, dict)
    ]
    values = [value for value in y_values if value is not None]
    return bool(values) and (max(values) - min(values)) > 1e-9


def _normalize_direction_values(value: Any) -> List[str]:
    if isinstance(value, list):
        directions: List[str] = []
        for item in value:
            directions.extend(_normalize_direction_values(item))
        return directions
    text = str(value or "").strip().lower()
    if not text:
        return []
    if text in {"both", "xy", "x+y", "x,y", "x y", "horizontal", "bidirectional"}:
        return ["x", "y"]
    if text in {"x", "global_x", "ux"}:
        return ["x"]
    if text in {"y", "global_y", "uy"}:
        return ["y"]
    return []


def _directions(parameters: Dict[str, Any], workflow: Dict[str, Any], model: StructureModelV2) -> Tuple[List[str], List[str]]:
    control = workflow.get("analysisControl") if isinstance(workflow.get("analysisControl"), dict) else {}
    ground_motion_requirement = workflow.get("groundMotionRequirement") if isinstance(workflow.get("groundMotionRequirement"), dict) else {}
    requested: List[str] = []
    for value in (
        workflow.get("directions"),
        control.get("directions") if isinstance(control, dict) else None,
        ground_motion_requirement.get("directions") if isinstance(ground_motion_requirement, dict) else None,
        workflow.get("direction"),
        control.get("direction") if isinstance(control, dict) else None,
        parameters.get("directions"),
        parameters.get("direction"),
    ):
        requested.extend(_normalize_direction_values(value))
        if requested:
            break

    is_3d = _model_is_3d(model)
    directions = requested or (["x", "y"] if is_3d else ["x"])
    warnings: List[str] = []
    if not is_3d and "y" in directions:
        warnings.append("Y-direction seismic analysis was requested, but the model has no Y plan extent; ran X direction only.")
        directions = ["x" if direction == "y" else direction for direction in directions]

    unique: List[str] = []
    for direction in directions:
        if direction in {"x", "y"} and direction not in unique:
            unique.append(direction)
    return unique or ["x"], warnings


def _collect_warnings(*sources: Any) -> List[str]:
    warnings: List[str] = []
    for source in sources:
        if not source:
            continue
        if isinstance(source, list):
            for item in source:
                if isinstance(item, str) and item not in warnings:
                    warnings.append(item)
        elif isinstance(source, dict):
            for item in source.get("warnings", []) if isinstance(source.get("warnings"), list) else []:
                if isinstance(item, str) and item not in warnings:
                    warnings.append(item)
    return warnings


def _direction_base_shear(response: Dict[str, Any], time_history: Any) -> float:
    envelope = response.get("envelope") if isinstance(response.get("envelope"), dict) else {}
    response_base = optional_number(envelope.get("maxBaseShear")) or 0.0
    time_history_base = (
        optional_number(time_history.get("combinedBaseShear")) or 0.0
        if isinstance(time_history, dict) else 0.0
    )
    return max(response_base, time_history_base)


def _pushover_parameters(parameters: Dict[str, Any], workflow: Dict[str, Any]) -> Dict[str, Any]:
    control = workflow.get("analysisControl") if isinstance(workflow.get("analysisControl"), dict) else {}
    pushover = workflow.get("pushover") if isinstance(workflow.get("pushover"), dict) else {}
    nonlinear_model = workflow.get("nonlinearModel") if isinstance(workflow.get("nonlinearModel"), dict) else None
    performance_objective = performance_objective_from_workflow(workflow, "pushover", "analysisControl")
    target = (
        parameters.get("targetDisplacement")
        or control.get("targetDisplacement")
        or pushover.get("targetDisplacement")
        or performance_objective.get("targetDisplacement")
        or 0.5
    )
    control_node = parameters.get("controlNode") or control.get("controlNode") or pushover.get("controlNode")
    performance_target = (
        parameters.get("performanceTargetDisplacement")
        or control.get("performanceTargetDisplacement")
        or pushover.get("performanceTargetDisplacement")
        or pushover.get("performancePointDisplacement")
    )
    acceptance_drift = (
        parameters.get("acceptanceDriftRatio")
        or control.get("acceptanceDriftRatio")
        or pushover.get("acceptanceDriftRatio")
        or performance_objective.get("acceptanceDriftRatio")
    )
    return {
        **parameters,
        "targetDisplacement": target,
        **({"controlNode": control_node} if control_node else {}),
        **({"performanceTargetDisplacement": performance_target} if performance_target is not None else {}),
        **({"acceptanceDriftRatio": acceptance_drift} if acceptance_drift is not None else {}),
        **({"performanceObjective": performance_objective} if performance_objective else {}),
        **({"nonlinearModel": nonlinear_model} if nonlinear_model else {}),
    }


def _run_pushover_compatibility(model: StructureModelV2, parameters: Dict[str, Any]) -> Dict[str, Any]:
    helper = OpenSeesTagMapper(model)
    executor = OpenSeesSeismicExecutor(helper)
    try:
        import openseespy.opensees as ops  # noqa: F401
    except ImportError as error:
        raise RuntimeError("Pushover analysis requires OpenSeesPy") from error
    try:
        return executor.pushover_analysis(
            parameters.get("targetDisplacement", 0.5),
            parameters.get("controlNode"),
            ops,
        )
    except Exception as error:
        raise RuntimeError(f"Pushover analysis failed: {error}") from error


def _run_pushover(model: StructureModelV2, basis: Any, parameters: Dict[str, Any], direction: str) -> Dict[str, Any]:
    try:
        return run_linear_pushover(model, basis, parameters, direction)
    except Exception as error:
        fallback = _run_pushover_compatibility(model, parameters)
        return {
            **fallback,
            "engineMode": "legacy_pushover_fallback",
            "warnings": [
                f"OpenSees linear static pushover wrapper failed; used legacy compatibility executor: {error}"
            ],
        }


def _workflow_input_mode(workflow: Dict[str, Any]) -> str:
    return "structured_seismic_workflow" if workflow else "legacy_compatibility_parameters"


def _mark_workflow_input_mode(result: Dict[str, Any], mode: str) -> Dict[str, Any]:
    result["workflowInputMode"] = mode
    for key in ("data", "detailed"):
        value = result.get(key)
        if isinstance(value, dict):
            value["workflowInputMode"] = mode
    return result


def _legacy_workflow_warning() -> str:
    return (
        "No seismicWorkflow object was provided; ran legacy compatibility mode from model metadata "
        "and explicit legacy parameters. This result is not the full structured China seismic workflow."
    )


def run_analysis(model: StructureModelV2, parameters: Dict[str, Any]) -> Dict[str, Any]:
    workflow = seismic_workflow_from_parameters(parameters)
    workflow_input_mode = _workflow_input_mode(workflow)
    method_preference = workflow_method_preference(workflow, parameters)
    basis = build_design_basis(model, parameters, workflow)
    regularity = assess_regularity(model, workflow)
    directions, direction_warnings = _directions(parameters, workflow, model)
    modal_combination = _modal_combination_rule(parameters, workflow)
    scale_factor_limit = _scale_factor_limit(parameters, workflow)
    if method_preference == "pushover":
        decision = decide_seismic_method(workflow, parameters, basis, 0, regularity)
        decision.special_system_audit = audit_special_systems(workflow, basis=basis)
        pushover_result = _run_pushover(model, basis, _pushover_parameters(parameters, workflow), directions[0])
        warnings = _collect_warnings(
            basis.warnings,
            basis.assumptions,
            direction_warnings,
            regularity.warnings,
            regularity.assumptions,
            pushover_result,
        )
        if not workflow:
            warnings.append(_legacy_workflow_warning())
        return _mark_workflow_input_mode(build_pushover_seismic_result(
            model=model,
            basis=basis,
            decision=decision,
            regularity=regularity,
            pushover=pushover_result,
            warnings=warnings,
            workflow=workflow,
        ), workflow_input_mode)

    record_payloads = [
        *workflow_ground_motion_records(workflow, parameters),
        *resolve_catalog_records(workflow),
    ]
    motions = parse_ground_motions(record_payloads)
    decision = decide_seismic_method(workflow, parameters, basis, len(motions), regularity)
    if not motions and decision.required_ground_motion_count:
        auto_catalog_records = resolve_catalog_records(
            workflow,
            required_count=decision.required_ground_motion_count,
            allow_auto_select=True,
        )
        if auto_catalog_records:
            record_payloads = [*record_payloads, *auto_catalog_records]
            motions = parse_ground_motions(record_payloads)
            decision = decide_seismic_method(workflow, parameters, basis, len(motions), regularity)

    direction_runs: List[Dict[str, Any]] = []
    motion_selection_warnings: List[str] = []
    ground_motion_check_summaries: List[Dict[str, Any]] = []
    for direction in directions:
        direction_motions, selection_warnings = select_ground_motions_for_direction(motions, direction)
        motion_selection_warnings.extend(selection_warnings)
        direction_ground_motion_checks = ground_motion_set_checks(direction_motions, decision.required_ground_motion_count)
        ground_motion_check_summaries.append(direction_ground_motion_checks)
        modal = run_modal_analysis(
            model,
            basis,
            modal_count=_modal_count(parameters, workflow),
            direction=direction,
        )
        response = apply_minimum_story_shear_adjustment(
            run_response_spectrum(basis, modal, modal_combination=modal_combination),
            basis,
            regularity,
        )
        design_actions = run_equivalent_lateral_design_actions(
            model=model,
            basis=basis,
            response_spectrum=response,
            direction=direction,
        )
        time_history = None
        if "time_history" in decision.selected_methods and direction_motions:
            time_history = run_modal_time_history(
                direction_motions,
                basis,
                modal,
                response_spectrum_base_shear=float(response.get("baseShear", 0.0) or 0.0),
                combination_rule=decision.combination_rule,
                scale_factor_limit=scale_factor_limit,
                modal_combination=modal_combination,
            )
            time_history = attach_opensees_transient_check(
                time_history,
                direction_motions,
                model,
                basis,
                modal,
                combination_rule=decision.combination_rule,
                direction=direction,
            )
            time_history["direction"] = direction
            time_history["groundMotionSetChecks"] = direction_ground_motion_checks
            catalog_records = [
                record for record in record_payloads
                if record.get("source") in {"builtin_artificial_catalog", "local_ground_motion_catalog"}
            ]
            if catalog_records:
                time_history["catalogSelection"] = catalog_summary_for_records(catalog_records)
        elif motions:
            response["groundMotionSetChecks"] = direction_ground_motion_checks

        direction_runs.append({
            "direction": direction,
            "modal": modal,
            "responseSpectrum": response,
            "timeHistory": time_history,
            "seismicDesignActions": design_actions,
        })

    controlling_run = max(
        direction_runs,
        key=lambda run: _direction_base_shear(run["responseSpectrum"], run.get("timeHistory")),
    )
    modal = controlling_run["modal"]
    response = controlling_run["responseSpectrum"]
    time_history = controlling_run.get("timeHistory")
    controlling_direction_motions = select_ground_motions_for_direction(motions, str(controlling_run["direction"]))[0]
    response_envelope = response.get("envelope") if isinstance(response.get("envelope"), dict) else {}
    if isinstance(time_history, dict):
        response_envelope = {
            **response_envelope,
            **({
                "maxAbsDisplacement": time_history.get("maxAbsDisplacement"),
            } if time_history.get("maxAbsDisplacement") is not None else {}),
            **({
                "maxStoryDriftRatio": time_history.get("maxStoryDriftRatio"),
            } if time_history.get("maxStoryDriftRatio") is not None else {}),
        }
    decision.special_system_audit = audit_special_systems(
        workflow,
        basis=basis,
        modal=modal,
        response_envelope=response_envelope,
        ground_motions=controlling_direction_motions,
    )
    seismic_design_actions = controlling_run.get("seismicDesignActions")
    gravity_design_actions = run_gravity_design_actions(
        model=model,
        basis=basis,
        floor_masses=modal.floor_masses,
    )
    vertical_seismic = (
        run_vertical_seismic(
            model=model,
            basis=basis,
            modal=modal,
            workflow=workflow,
            reasons=decision.vertical_seismic_reasons,
        )
        if decision.vertical_seismic_required else None
    )
    elastic_plastic_time_history = (
        run_elastic_plastic_time_history_estimate(
            model=model,
            workflow=workflow,
            basis=basis,
            modal=modal,
            motions=controlling_direction_motions,
            time_history=time_history,
            combination_rule=decision.combination_rule,
        )
        if decision.requires_elastic_plastic_time_history else None
    )
    pushover_result = (
        _run_pushover(model, basis, _pushover_parameters(parameters, workflow), str(controlling_run["direction"]))
        if decision.requires_pushover else None
    )
    member_design_action_combinations = build_member_design_action_combinations(
        workflow=workflow,
        gravity_actions=gravity_design_actions,
        horizontal_actions=seismic_design_actions if isinstance(seismic_design_actions, dict) else None,
        horizontal_direction_actions=[
            run.get("seismicDesignActions")
            for run in direction_runs
            if isinstance(run.get("seismicDesignActions"), dict)
        ],
        vertical_seismic=vertical_seismic,
    )
    direction_results = [
        {
            "direction": run["direction"],
            "modal": run["modal"].to_dict(),
            "responseSpectrum": run["responseSpectrum"],
            "timeHistory": run.get("timeHistory"),
            "seismicDesignActions": run.get("seismicDesignActions"),
        }
        for run in direction_runs
    ]
    modal_warnings = [
        warning
        for run in direction_runs
        for warning in run["modal"].warnings
    ]
    time_history_checks = [
        run.get("timeHistory", {}).get("baseShearCheck", {})
        for run in direction_runs
        if isinstance(run.get("timeHistory"), dict)
    ]
    ground_motion_check_warnings = [
        warning
        for checks in ground_motion_check_summaries
        for warning in checks.get("warnings", [])
        if isinstance(warning, str)
    ]
    design_action_warnings = [
        warning
        for run in direction_runs
        for warning in (
            run.get("seismicDesignActions", {}).get("warnings", [])
            if isinstance(run.get("seismicDesignActions"), dict) else []
        )
        if isinstance(warning, str)
    ]

    warnings = _collect_warnings(
        basis.warnings,
        basis.assumptions,
        direction_warnings,
        decision.warnings,
        regularity.warnings,
        regularity.assumptions,
        motion_selection_warnings,
        modal_warnings,
        ground_motion_check_warnings,
        time_history_checks,
        design_action_warnings,
        pushover_result,
        gravity_design_actions,
        member_design_action_combinations,
    )
    if not workflow:
        warnings.append(_legacy_workflow_warning())

    return _mark_workflow_input_mode(build_seismic_result(
        model=model,
        basis=basis,
        decision=decision,
        modal=modal,
        response_spectrum=response,
        time_history=time_history,
        elastic_plastic_time_history=elastic_plastic_time_history,
        pushover=pushover_result,
        seismic_design_actions=seismic_design_actions,
        gravity_design_actions=gravity_design_actions,
        member_design_action_combinations=member_design_action_combinations,
        vertical_seismic=vertical_seismic,
        regularity=regularity,
        warnings=warnings,
        direction_results=direction_results,
        workflow=workflow,
    ), workflow_input_mode)
