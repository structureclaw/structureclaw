from __future__ import annotations

from typing import Any, Dict, List, Optional


def as_record(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def as_records(value: Any) -> List[Dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def seismic_workflow_from_parameters(parameters: Dict[str, Any]) -> Dict[str, Any]:
    workflow = parameters.get("seismicWorkflow")
    return workflow if isinstance(workflow, dict) else {}


def workflow_section(workflow: Dict[str, Any], key: str) -> Dict[str, Any]:
    return as_record(workflow.get(key))


def workflow_method_preference(workflow: Dict[str, Any], parameters: Dict[str, Any]) -> str:
    """Return a normalized method preference from structured workflow fields.

    This function intentionally accepts only explicit enum-like values emitted by
    the LLM contract or legacy tool parameters. It does not inspect natural
    language text.
    """

    raw = (
        workflow.get("method")
        or workflow.get("methodPreference")
        or workflow.get("analysisMethod")
        or as_record(workflow.get("requestedMethod")).get("preference")
        or as_record(workflow.get("requestedMethod")).get("method")
        or parameters.get("method")
        or "auto"
    )
    value = str(raw).strip().lower()
    if value in {"response_spectrum", "modal_response_spectrum", "spectrum"}:
        return "response_spectrum"
    if value in {"time_history", "elastic_time_history", "linear_time_history"}:
        return "time_history"
    if value in {"pushover", "nonlinear_static"}:
        return "pushover"
    if value in {
        "elastic_plastic_time_history",
        "elastoplastic_time_history",
        "nonlinear_time_history",
        "nonlinear_dynamic",
    }:
        return "elastic_plastic_time_history"
    return "auto"


def workflow_ground_motion_records(
    workflow: Dict[str, Any],
    parameters: Dict[str, Any],
) -> List[Dict[str, Any]]:
    for source in (
        workflow.get("groundMotions"),
        workflow.get("groundMotionRecords"),
        workflow.get("timeHistoryRecords"),
        as_record(workflow.get("groundMotionSet")).get("records"),
        parameters.get("groundMotions"),
        parameters.get("groundMotionRecords"),
    ):
        records = as_records(source)
        if records:
            return records
    legacy = parameters.get("groundMotion")
    if isinstance(legacy, list):
        return [{"name": "legacy-ground-motion", "dt": parameters.get("timeStep", 0.02), "values": legacy}]
    return []


def optional_number(value: Any) -> Optional[float]:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            return float(text)
        except ValueError:
            return None
    return None


def optional_int(value: Any) -> Optional[int]:
    number = optional_number(value)
    if number is None:
        return None
    return int(number)


def first_number(*values: Any) -> Optional[float]:
    for value in values:
        number = optional_number(value)
        if number is not None:
            return number
    return None


def first_string(*values: Any) -> Optional[str]:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return str(value)
    return None


def performance_objective_from_workflow(
    workflow: Dict[str, Any],
    *section_names: str,
) -> Dict[str, Any]:
    """Read a structured performance objective without inspecting user prose."""

    design_requirements = as_record(workflow.get("designRequirements"))
    candidates: List[tuple[str, Any]] = []
    for section_name in section_names:
        section = as_record(workflow.get(section_name))
        candidates.append((f"{section_name}.performanceObjective", section.get("performanceObjective")))
    candidates.extend([
        ("workflow.performanceObjective", workflow.get("performanceObjective")),
        ("designRequirements.performanceObjective", design_requirements.get("performanceObjective")),
    ])

    for source, raw in candidates:
        if isinstance(raw, str) and raw.strip():
            return {"name": raw.strip(), "source": source}
        record = as_record(raw)
        if not record:
            continue
        limit = first_number(
            record.get("acceptanceDriftRatio"),
            record.get("limitDriftRatio"),
            record.get("driftRatioLimit"),
            record.get("maxDriftRatio"),
            record.get("storyDriftLimit"),
        )
        target_displacement = first_number(
            record.get("targetDisplacement"),
            record.get("targetRoofDisplacement"),
            record.get("performanceTargetDisplacement"),
        )
        name = first_string(
            record.get("name"),
            record.get("objective"),
            record.get("level"),
            record.get("performanceLevel"),
        )
        result: Dict[str, Any] = {
            "source": source,
            **({"name": name} if name else {}),
            **({"acceptanceDriftRatio": float(limit)} if limit is not None else {}),
            **({"targetDisplacement": float(target_displacement)} if target_displacement is not None else {}),
        }
        if len(result) > 1:
            return result
    return {}
