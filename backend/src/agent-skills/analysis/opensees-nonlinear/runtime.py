from __future__ import annotations

from typing import Any, Dict, List


def _as_record(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _as_records(value: Any) -> List[Dict[str, Any]]:
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    if isinstance(value, dict):
        nested = [item for item in value.values() if isinstance(item, dict)]
        return nested if nested else ([value] if value else [])
    return []


def _first_number(*values: Any) -> float | None:
    for value in values:
        if isinstance(value, bool):
            continue
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str) and value.strip():
            try:
                return float(value.strip())
            except ValueError:
                continue
    return None


def _structured_entries(section: Dict[str, Any], *keys: str) -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []
    for key in keys:
        entries.extend(_as_records(section.get(key)))
    return entries


def _has_hinge_backbone(entry: Dict[str, Any]) -> bool:
    for key in ("backbone", "momentRotation", "momentRotationBackbone", "rotationBackbone"):
        if _as_record(entry.get(key)):
            return True
    has_yield_moment = _first_number(
        entry.get("yieldMoment"),
        entry.get("yieldMomentKNm"),
        entry.get("momentYield"),
        entry.get("My"),
        entry.get("positiveYieldMoment"),
    ) is not None
    has_yield_rotation = _first_number(
        entry.get("yieldRotation"),
        entry.get("rotationYield"),
        entry.get("thetaY"),
        entry.get("positiveYieldRotation"),
    ) is not None
    return has_yield_moment and has_yield_rotation


def _nonlinear_model_audit(parameters: Dict[str, Any]) -> Dict[str, Any]:
    nonlinear_model = _as_record(parameters.get("nonlinearModel"))
    nonlinear_time_history = _as_record(parameters.get("nonlinearTimeHistory"))
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
        _as_record(nonlinear_time_history.get("convergenceCriteria"))
        or _as_record(nonlinear_model.get("convergenceCriteria"))
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
    return {
        "status": "complete" if not missing_inputs else "partial" if provided_count > 0 else "missing",
        "materialModelCount": len(material_models),
        "memberPlasticHingeCount": len(hinges),
        "calibratedPlasticHingeCount": len(calibrated_hinges),
        "hasConvergenceCriteria": bool(convergence),
        "missingInputs": list(dict.fromkeys(missing_inputs)),
    }


def run_analysis(model: Any, parameters: Dict[str, Any]) -> Dict[str, Any]:
    audit = _nonlinear_model_audit(parameters)
    node_count = len(getattr(model, "nodes", []) or [])
    element_count = len(getattr(model, "elements", []) or [])
    missing_inputs = list(audit["missingInputs"])
    return {
        "status": "partial",
        "summary": {
            "analysisType": "nonlinear",
            "engine": "builtin-opensees",
            "engineMode": "capability_boundary",
            "nodeCount": node_count,
            "elementCount": element_count,
            "nonlinearModelAuditStatus": audit["status"],
            "missingInputCount": len(missing_inputs),
        },
        "detailed": {
            "analysisMode": "opensees_nonlinear_capability_boundary",
            "engineMode": "capability_boundary",
            "nonlinearModelAudit": audit,
            "missingInputs": missing_inputs,
            "missingCapabilities": [
                "opensees.fullMemberNonlinearStatic",
                "opensees.fullMemberNonlinearTimeHistory",
            ],
            "implementedCapabilities": [
                "nonlinearModelStructuredInputAudit",
            ],
            "nextAction": (
                "Provide complete nonlinear material constitutive models, calibrated member plastic hinges, "
                "and convergence controls before running a full OpenSees nonlinear solver."
            ),
        },
        "warnings": [
            "OpenSees full-member nonlinear analysis is not implemented yet; returned a structured capability boundary instead of executing analysis.",
        ],
    }
