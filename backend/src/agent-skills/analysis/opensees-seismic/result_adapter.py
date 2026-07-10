from __future__ import annotations

import math
from typing import Any, Dict, List, Optional

from design_basis import SeismicDesignBasis
from method_decision import SeismicMethodDecision
from modal import ModalAnalysis
from nonlinear_time_history import ELASTIC_PLASTIC_TIME_HISTORY_CAPABILITY, build_elastic_plastic_time_history_requirement
from regularity import RegularityAssessment
from gb50011_drift_limits import (
    gb50011_elastic_drift_limit_family_supported,
    gb50011_elastic_drift_limit_metadata,
)


SPECTRUM_PERIOD_SPECIAL_STUDY_CAPABILITY = "gb50011.responseSpectrumLongPeriodSpecialStudy"
STRUCTURED_REVIEW_KEYS = (
    "overLimitReview",
    "specialReview",
    "specialSeismicReview",
    "overLimitSpecialReview",
)


def _model_payload(model: Any) -> Dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump(mode="python")
    return model if isinstance(model, dict) else {}


def _list_count(payload: Dict[str, Any], key: str) -> int:
    value = payload.get(key)
    return len(value) if isinstance(value, list) else 0


def _model_summary(model: Any, basis: SeismicDesignBasis) -> Dict[str, Any]:
    payload = _model_payload(model)
    metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
    return {
        "nodeCount": _list_count(payload, "nodes"),
        "elementCount": _list_count(payload, "elements"),
        "storyCount": basis.story_count,
        "structuralFamily": basis.structural_family,
        "structuralTypeKey": metadata.get("structuralTypeKey"),
        "unitSystem": payload.get("unit_system"),
    }


def _number(value: Any) -> Optional[float]:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return float(value)
    return None


def _structured_review_traces(workflow: Optional[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    if not isinstance(workflow, dict):
        return {}
    traces: Dict[str, Dict[str, Any]] = {}
    for key in STRUCTURED_REVIEW_KEYS:
        value = workflow.get(key)
        if isinstance(value, dict) and value:
            traces[key] = dict(value)
    return traces


def _elastic_drift_final_compliance(
    *,
    basis: SeismicDesignBasis,
    envelope: Dict[str, Any],
    source: str,
) -> Optional[Dict[str, Any]]:
    drift = _number(envelope.get("maxStoryDriftRatio"))
    metadata = gb50011_elastic_drift_limit_metadata(getattr(basis, "structural_family", ""))
    limit = None if metadata is None else float(metadata["limit"])
    if drift is None or limit is None:
        return None
    utilization = drift / max(limit, 1e-12)
    return {
        "status": "pass" if utilization <= 1.0 else "fail",
        "source": source,
        "method": "frequent_earthquake_elastic_story_drift",
        "clause": "GB/T 50011-2010(2024) 5.5.1",
        "driftRatio": round(drift, 8),
        "limitDriftRatio": round(limit, 8),
        "limitFamily": metadata["familyLabel"],
        "limitRatioText": f"1/{metadata['denominator']}",
        "utilization": round(utilization, 6),
        "scope": "frequent-earthquake elastic response-spectrum drift check",
    }


def _attach_response_spectrum_final_compliance(
    *,
    basis: SeismicDesignBasis,
    response_spectrum: Optional[Dict[str, Any]],
    direction_results: List[Dict[str, Any]],
    combined_envelope: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    direction_compliances: List[Dict[str, Any]] = []
    for result in direction_results:
        spectrum = result.get("responseSpectrum")
        if not isinstance(spectrum, dict):
            continue
        spectrum_envelope = spectrum.get("envelope") if isinstance(spectrum.get("envelope"), dict) else {}
        compliance = _elastic_drift_final_compliance(
            basis=basis,
            envelope=spectrum_envelope,
            source=f"responseSpectrum.direction.{result.get('direction')}",
        )
        if compliance:
            compliance["direction"] = result.get("direction")
            spectrum["finalCompliance"] = compliance
            direction_compliances.append(compliance)

    if isinstance(response_spectrum, dict):
        spectrum_envelope = response_spectrum.get("envelope") if isinstance(response_spectrum.get("envelope"), dict) else {}
        compliance = _elastic_drift_final_compliance(
            basis=basis,
            envelope=spectrum_envelope,
            source="responseSpectrum.envelope",
        )
        if compliance:
            response_spectrum["finalCompliance"] = compliance
            return compliance

    if direction_compliances:
        controlling = max(direction_compliances, key=lambda item: _number(item.get("utilization")) or 0.0)
        return {
            **controlling,
            "source": "responseSpectrum.directionEnvelope",
            "directionResults": direction_compliances,
        }

    return _elastic_drift_final_compliance(
        basis=basis,
        envelope=combined_envelope,
        source="envelope.maxStoryDriftRatio",
    )


def _direction_base_shear(response_envelope: Dict[str, Any], time_history: Optional[Dict[str, Any]]) -> float:
    response_base = _number(response_envelope.get("maxBaseShear")) or 0.0
    time_history_base = (
        _number(time_history.get("combinedBaseShear")) or 0.0
        if isinstance(time_history, dict) else 0.0
    )
    return max(response_base, time_history_base)


def _direction_envelope(direction_result: Dict[str, Any]) -> Dict[str, Any]:
    response = direction_result.get("responseSpectrum")
    response_envelope = (
        response.get("envelope", {})
        if isinstance(response, dict) and isinstance(response.get("envelope"), dict)
        else {}
    )
    time_history = direction_result.get("timeHistory")
    time_history = time_history if isinstance(time_history, dict) else None
    base_shear = _direction_base_shear(response_envelope, time_history)
    time_history_drift = (
        _number(time_history.get("maxStoryDriftRatio")) or 0.0
        if time_history else 0.0
    )
    drift_ratio = max(
        _number(response_envelope.get("maxStoryDriftRatio")) or 0.0,
        time_history_drift,
    )
    return {
        **response_envelope,
        "direction": direction_result.get("direction"),
        "maxBaseShear": round(base_shear, 6),
        "maxAbsShearForce": round(max(_number(response_envelope.get("maxAbsShearForce")) or 0.0, base_shear), 6),
        "maxAbsReaction": round(max(_number(response_envelope.get("maxAbsReaction")) or 0.0, base_shear), 6),
        "maxStoryDriftRatio": round(drift_ratio, 8),
        "controlCase": {
            "baseShear": (
                "time_history"
                if time_history and (_number(time_history.get("combinedBaseShear")) or 0.0) > (_number(response_envelope.get("maxBaseShear")) or 0.0)
                else "response_spectrum"
            ),
            "direction": direction_result.get("direction"),
        },
    }


def _period_range_assessments(
    response_spectrum: Optional[Dict[str, Any]],
    direction_results: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    assessments: List[Dict[str, Any]] = []
    if isinstance(response_spectrum, dict) and isinstance(response_spectrum.get("periodRangeAssessment"), dict):
        assessments.append(response_spectrum["periodRangeAssessment"])
    for result in direction_results:
        spectrum = result.get("responseSpectrum")
        if isinstance(spectrum, dict) and isinstance(spectrum.get("periodRangeAssessment"), dict):
            assessment = dict(spectrum["periodRangeAssessment"])
            if result.get("direction") is not None and assessment.get("direction") is None:
                assessment["direction"] = result.get("direction")
            assessments.append(assessment)
    return assessments


def _requires_period_special_study(assessments: List[Dict[str, Any]]) -> bool:
    return any(assessment.get("requiresSpecialStudy") is True for assessment in assessments)


def _combined_envelope(
    response_spectrum: Optional[Dict[str, Any]],
    time_history: Optional[Dict[str, Any]],
    direction_results: List[Dict[str, Any]],
) -> Dict[str, Any]:
    if direction_results:
        envelopes = [_direction_envelope(result) for result in direction_results]
    else:
        response_envelope = response_spectrum.get("envelope", {}) if isinstance(response_spectrum, dict) else {}
        time_history_drift = (
            _number(time_history.get("maxStoryDriftRatio")) or 0.0
            if isinstance(time_history, dict) else 0.0
        )
        envelopes = [{
            **response_envelope,
            "maxBaseShear": _direction_base_shear(response_envelope, time_history),
            "maxStoryDriftRatio": round(max(
                _number(response_envelope.get("maxStoryDriftRatio")) or 0.0,
                time_history_drift,
            ), 8),
            "controlCase": {
                "baseShear": "time_history"
                if isinstance(time_history, dict) and (_number(time_history.get("combinedBaseShear")) or 0.0) > (_number(response_envelope.get("maxBaseShear")) or 0.0)
                else "response_spectrum",
            },
        }]

    def max_value(key: str) -> float:
        return max((_number(envelope.get(key)) or 0.0 for envelope in envelopes), default=0.0)

    modal_ratios = [
        _number(envelope.get("modalMassParticipationRatio"))
        for envelope in envelopes
        if _number(envelope.get("modalMassParticipationRatio")) is not None
    ]
    story_shear_weight_ratios = [
        _number(envelope.get("minStoryShearWeightRatio"))
        for envelope in envelopes
        if _number(envelope.get("minStoryShearWeightRatio")) is not None
    ]
    controlling = max(envelopes, key=lambda envelope: _number(envelope.get("maxBaseShear")) or 0.0, default={})
    return {
        "maxBaseShear": round(max_value("maxBaseShear"), 6),
        "maxAbsShearForce": round(max_value("maxAbsShearForce"), 6),
        "maxAbsReaction": round(max_value("maxAbsReaction"), 6),
        "maxStoryDriftRatio": round(max_value("maxStoryDriftRatio"), 8),
        "maxAbsDisplacement": round(max_value("maxAbsDisplacement"), 8),
        "modalMassParticipationRatio": round(min(modal_ratios), 6) if modal_ratios else None,
        "minStoryShearWeightRatio": round(min(story_shear_weight_ratios), 8) if story_shear_weight_ratios else None,
        "modalCombination": controlling.get("modalCombination"),
        "controlNodeDisplacement": controlling.get("controlNodeDisplacement", ""),
        "controlNodeReaction": controlling.get("controlNodeReaction", "base"),
        "controlCase": {
            **(controlling.get("controlCase") if isinstance(controlling.get("controlCase"), dict) else {}),
            "direction": controlling.get("direction"),
        },
    }


def _direction_ground_motion_requirement(
    decision: SeismicMethodDecision,
    direction_result: Dict[str, Any],
) -> Dict[str, Any]:
    required_count = int(decision.required_ground_motion_count or 0)
    time_history = direction_result.get("timeHistory")
    response_spectrum = direction_result.get("responseSpectrum")
    checks = {}
    if isinstance(time_history, dict) and isinstance(time_history.get("groundMotionSetChecks"), dict):
        checks = time_history["groundMotionSetChecks"]
    elif isinstance(response_spectrum, dict) and isinstance(response_spectrum.get("groundMotionSetChecks"), dict):
        checks = response_spectrum["groundMotionSetChecks"]
    records = time_history.get("records") if isinstance(time_history, dict) and isinstance(time_history.get("records"), list) else []
    provided_number = _number(checks.get("recordCount")) if isinstance(checks, dict) else None
    provided_count = int(provided_number) if provided_number is not None else len(records)
    missing_count = max(required_count - provided_count, 0)
    return {
        "direction": direction_result.get("direction"),
        "requiredCount": required_count,
        "providedCount": provided_count,
        "missingCount": missing_count,
        "status": "missing" if missing_count > 0 else "satisfied",
    }


def _ground_motion_requirement(
    decision: SeismicMethodDecision,
    time_history: Optional[Dict[str, Any]],
    direction_results: List[Dict[str, Any]],
) -> Dict[str, Any]:
    required_count = int(decision.required_ground_motion_count or 0)
    required = bool(decision.requires_time_history or required_count > 0)
    if not required:
        return {
            "required": False,
            "requiredCount": required_count,
            "providedCount": 0,
            "missingCount": 0,
            "status": "not_required",
        }

    if direction_results:
        direction_requirements = [
            _direction_ground_motion_requirement(decision, result)
            for result in direction_results
        ]
        total_required_count = required_count * len(direction_requirements)
        provided_count = sum(int(item["providedCount"]) for item in direction_requirements)
        missing_count = sum(int(item["missingCount"]) for item in direction_requirements)
        return {
            "required": True,
            "requiredCount": required_count,
            "totalRequiredCount": total_required_count,
            "providedCount": provided_count,
            "missingCount": missing_count,
            "status": "missing" if missing_count > 0 else "satisfied",
            "directionRequirements": direction_requirements,
        }

    records = time_history.get("records") if isinstance(time_history, dict) and isinstance(time_history.get("records"), list) else []
    provided_count = len(records)
    missing_count = max(required_count - provided_count, 0)
    return {
        "required": required,
        "requiredCount": required_count,
        "totalRequiredCount": required_count,
        "providedCount": provided_count,
        "missingCount": missing_count,
        "status": "missing" if missing_count > 0 else "satisfied",
    }


def _source_trace_entry(
    field_name: str,
    value: Any,
    source: str,
    source_type: str,
    note: str = "",
    assumed: bool = False,
) -> Dict[str, Any]:
    return {
        "field": field_name,
        "value": value,
        "source": source,
        "sourceType": source_type,
        "assumed": assumed,
        **({"note": note} if note else {}),
    }


def _seismic_source_trace(
    *,
    basis: SeismicDesignBasis,
    decision: SeismicMethodDecision,
    regularity: Optional[RegularityAssessment],
    ground_motion_requirement: Dict[str, Any],
) -> List[Dict[str, Any]]:
    basis_trace = [
        item for item in basis.to_dict().get("sourceTrace", [])
        if isinstance(item, dict)
    ]
    method_note = "; ".join(str(item) for item in decision.reasons[:4] if str(item).strip())
    provided_count = ground_motion_requirement.get("providedCount", 0)
    missing_count = ground_motion_requirement.get("missingCount", 0)
    total_required = ground_motion_requirement.get("totalRequiredCount", ground_motion_requirement.get("requiredCount", 0))
    ground_motion_source = "timeHistory.records / seismicWorkflow.groundMotionSet"
    ground_motion_type = "user"
    if int(provided_count or 0) <= 0 and int(missing_count or 0) > 0:
        ground_motion_source = "missing"
        ground_motion_type = "assumption"
    return [
        *basis_trace,
        *([
            _source_trace_entry(
                "regularityAssessment.classification",
                regularity.classification,
                regularity.source,
                "derived" if regularity.source != "structured_requirement" else "user",
                "; ".join(str(item) for item in regularity.assumptions[:3] if str(item).strip()),
            )
        ] if regularity else []),
        _source_trace_entry(
            "methodDecision.selectedMethods",
            ", ".join(decision.selected_methods),
            "methodDecision",
            "derived",
            method_note,
        ),
        _source_trace_entry(
            "groundMotions",
            f"provided {provided_count} / required {total_required} / missing {missing_count}",
            ground_motion_source,
            ground_motion_type,
            "required for supplementary time-history" if ground_motion_requirement.get("required") else "not required",
            assumed=int(missing_count or 0) > 0,
        ),
    ]


def _capability_assessment(
    basis: SeismicDesignBasis,
    extra_missing_capabilities: Optional[List[str]] = None,
    extra_implemented_capabilities: Optional[List[str]] = None,
) -> Dict[str, Any]:
    structural_family = str(getattr(basis, "structural_family", "") or "generic").strip().lower()
    drift_supported = gb50011_elastic_drift_limit_family_supported(structural_family)
    missing_capabilities: List[str] = []
    if not drift_supported:
        missing_capabilities.append("gb50011.elasticDriftLimitForStructuralFamily")
    for capability in extra_missing_capabilities or []:
        if capability not in missing_capabilities:
            missing_capabilities.append(capability)
    implemented_capabilities = list(dict.fromkeys([
        "designBasis",
        "responseSpectrum",
        "modalMassParticipation",
        "timeHistoryBaseShearCheck",
        "groundMotionRequirement",
        *(extra_implemented_capabilities or []),
        *(["gb50011.elasticDriftLimit"] if drift_supported else []),
    ]))
    return {
        "structuralFamily": structural_family,
        "analysisSupported": True,
        "finalComplianceSupported": len(missing_capabilities) == 0,
        "implementedCapabilities": implemented_capabilities,
        "missingCapabilities": missing_capabilities,
    }


def build_seismic_result(
    *,
    model: Any,
    basis: SeismicDesignBasis,
    decision: SeismicMethodDecision,
    modal: Optional[ModalAnalysis],
    response_spectrum: Optional[Dict[str, Any]],
    time_history: Optional[Dict[str, Any]],
    elastic_plastic_time_history: Optional[Dict[str, Any]],
    pushover: Optional[Dict[str, Any]],
    seismic_design_actions: Optional[Dict[str, Any]],
    gravity_design_actions: Optional[Dict[str, Any]],
    member_design_action_combinations: Optional[Dict[str, Any]],
    vertical_seismic: Optional[Dict[str, Any]],
    regularity: Optional[RegularityAssessment],
    warnings: List[str],
    direction_results: Optional[List[Dict[str, Any]]] = None,
    workflow: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    basis_missing_inputs = list(getattr(basis, "missing_inputs", []) or [])
    missing_inputs = list(dict.fromkeys([*basis_missing_inputs, *decision.missing_inputs]))
    model_summary = _model_summary(model, basis)
    normalized_direction_results = direction_results or []
    envelope = _combined_envelope(response_spectrum, time_history, normalized_direction_results)
    response_spectrum_final_compliance = _attach_response_spectrum_final_compliance(
        basis=basis,
        response_spectrum=response_spectrum,
        direction_results=normalized_direction_results,
        combined_envelope=envelope,
    )
    elastic_story_drift_final_compliance = _elastic_drift_final_compliance(
        basis=basis,
        envelope=envelope,
        source="envelope.maxStoryDriftRatio",
    )
    if elastic_story_drift_final_compliance:
        elastic_story_drift_final_compliance["scope"] = "frequent-earthquake elastic response-spectrum/time-history envelope drift check"
    ground_motion_requirement = _ground_motion_requirement(decision, time_history, normalized_direction_results)
    if ground_motion_requirement.get("missingCount", 0) and "groundMotions" not in missing_inputs:
        missing_inputs.append("groundMotions")
    extra_missing_capabilities: List[str] = []
    extra_implemented_capabilities: List[str] = []
    period_range_assessments = _period_range_assessments(response_spectrum, normalized_direction_results)
    if _requires_period_special_study(period_range_assessments):
        extra_missing_capabilities.append(SPECTRUM_PERIOD_SPECIAL_STUDY_CAPABILITY)
        if not any("6.0 s" in warning and "special study" in warning for warning in warnings):
            warnings.append("One or more modal periods exceed the 6.0 s GB/T 50011 design-spectrum range; response-spectrum results require special study before final compliance can be claimed.")
    else:
        extra_implemented_capabilities.append("gb50011.responseSpectrumPeriodRangeCheck")
    if elastic_story_drift_final_compliance and elastic_story_drift_final_compliance.get("status") in {"pass", "fail"}:
        extra_implemented_capabilities.append("gb50011.frequentEarthquakeElasticDriftFinalCompliance")
    normalized_pushover: Optional[Dict[str, Any]] = None
    pushover_capacity: Optional[Dict[str, Any]] = None
    pushover_nonlinear_estimate: Optional[Dict[str, Any]] = None
    pushover_final_compliance: Dict[str, Any] = {}
    pushover_curve: List[Dict[str, Any]] = []
    pushover_max_base_shear = 0.0
    pushover_max_roof_displacement = 0.0
    if isinstance(pushover, dict):
        pushover_curve = _curve_points(pushover)
        pushover_capacity = pushover.get("capacityAssessment") if isinstance(pushover.get("capacityAssessment"), dict) else None
        pushover_nonlinear_estimate = pushover.get("nonlinearEstimate") if isinstance(pushover.get("nonlinearEstimate"), dict) else None
        pushover_final = pushover.get("finalCompliance") if isinstance(pushover.get("finalCompliance"), dict) else None
        pushover_final_compliance = pushover_final or {}
        pushover_max_base_shear = max((abs(float(point.get("baseShear", 0.0) or 0.0)) for point in pushover_curve), default=0.0)
        pushover_max_roof_displacement = max((abs(float(point.get("roofDisplacement", 0.0) or 0.0)) for point in pushover_curve), default=0.0)
        normalized_pushover = {
            "engineMode": pushover.get("engineMode") or "opensees_static_pushover",
            "targetDisplacement": pushover.get("targetDisplacement"),
            "controlNode": pushover.get("controlNode"),
            "stepCount": len(pushover_curve),
            "curve": pushover_curve,
            "maxBaseShear": round(pushover_max_base_shear, 6),
            "maxRoofDisplacement": round(pushover_max_roof_displacement, 8),
            "capacityAssessment": pushover_capacity,
            "nonlinearEstimate": pushover_nonlinear_estimate,
            "finalCompliance": pushover_final_compliance or None,
            "converged": pushover.get("converged"),
            "completedSteps": pushover.get("completedSteps"),
            "requestedSteps": pushover.get("requestedSteps"),
            "rawStatus": pushover.get("status"),
        }
        if pushover_capacity:
            extra_implemented_capabilities.append("pushoverPerformancePointEstimate")
            capacity_iteration = pushover_capacity.get("capacitySpectrumIteration")
            if isinstance(capacity_iteration, dict) and capacity_iteration.get("status") == "estimated":
                extra_implemented_capabilities.append("pushoverCapacitySpectrumIteration")
        if pushover_nonlinear_estimate:
            implemented = pushover_nonlinear_estimate.get("implementedCapabilities")
            if isinstance(implemented, list):
                extra_implemented_capabilities.extend([
                    str(item) for item in implemented
                    if str(item).strip()
                ])
        pushover_final_status = str(pushover_final_compliance.get("status") or "").strip().lower()
        if pushover_final_status in {"pass", "fail"}:
            extra_implemented_capabilities.append("gb50011.nonlinearPushoverFinalCompliance")
        else:
            extra_missing_capabilities.append("gb50011.nonlinearPushoverFinalCompliance")
    elastic_plastic_time_history = elastic_plastic_time_history or build_elastic_plastic_time_history_requirement(
        decision=decision,
        time_history=time_history,
    )
    if elastic_plastic_time_history:
        implemented = elastic_plastic_time_history.get("implementedCapabilities")
        if isinstance(implemented, list):
            extra_implemented_capabilities.extend([
                str(item) for item in implemented
                if str(item).strip()
            ])
        missing = elastic_plastic_time_history.get("missingCapabilities")
        if isinstance(missing, list):
            extra_missing_capabilities.extend([
                str(item) for item in missing
                if str(item).strip()
            ])
        elastic_plastic_final = (
            elastic_plastic_time_history.get("finalCompliance")
            if isinstance(elastic_plastic_time_history.get("finalCompliance"), dict)
            else {}
        )
        final_status = str(elastic_plastic_final.get("status") or "").strip().lower()
        if final_status in {"pass", "fail"}:
            extra_implemented_capabilities.append(ELASTIC_PLASTIC_TIME_HISTORY_CAPABILITY)
        else:
            extra_missing_capabilities.append(ELASTIC_PLASTIC_TIME_HISTORY_CAPABILITY)
    elastic_plastic_final_compliance = (
        elastic_plastic_time_history.get("finalCompliance")
        if isinstance(elastic_plastic_time_history, dict)
        and isinstance(elastic_plastic_time_history.get("finalCompliance"), dict)
        else {}
    )
    elastic_plastic_final_status = str(elastic_plastic_final_compliance.get("status") or "").strip().lower()
    pushover_final_status = str(pushover_final_compliance.get("status") or "").strip().lower()
    if basis.earthquake_level == "rare":
        if elastic_plastic_final_status in {"pass", "fail"} or pushover_final_status in {"pass", "fail"}:
            extra_implemented_capabilities.append("gb50011.rareEarthquakeElasticPlasticDeformation")
        else:
            extra_missing_capabilities.append("gb50011.rareEarthquakeElasticPlasticDeformation")
    if isinstance(seismic_design_actions, dict) and seismic_design_actions.get("status") == "computed":
        extra_implemented_capabilities.append("seismicEquivalentLateralMemberForces")
    else:
        extra_missing_capabilities.append("gb50011.horizontalSeismicMemberForceExtraction")
    if isinstance(gravity_design_actions, dict) and gravity_design_actions.get("status") == "computed":
        extra_implemented_capabilities.append("gravityRepresentativeMemberForces")
    else:
        extra_missing_capabilities.append("gb50011.gravityRepresentativeMemberForceExtraction")
    if isinstance(member_design_action_combinations, dict) and member_design_action_combinations.get("status") == "computed":
        extra_implemented_capabilities.append("gb50011.seismicBasicActionCombination")
    else:
        extra_missing_capabilities.append("gb50011.seismicBasicActionCombination")
    if decision.vertical_seismic_required:
        if isinstance(vertical_seismic, dict) and vertical_seismic.get("status") == "computed":
            extra_implemented_capabilities.append("verticalSeismicAction")
            static_check = vertical_seismic.get("openSeesStatic")
            member_force_count = (
                int(static_check.get("memberForceCount", 0) or 0)
                if isinstance(static_check, dict) else 0
            )
            if member_force_count > 0:
                extra_implemented_capabilities.append("verticalSeismicMemberForces")
                extra_implemented_capabilities.append("gb50011.verticalSeismicMemberCapacityCheck")
            else:
                extra_missing_capabilities.append("gb50011.verticalSeismicMemberForceCombination")
        else:
            extra_missing_capabilities.append("gb50011.verticalSeismicAction")
    special_system_review = (
        getattr(decision, "special_system_audit", {})
        if isinstance(getattr(decision, "special_system_audit", {}), dict)
        else {}
    )
    special_system_implemented = special_system_review.get("implementedCapabilities") if special_system_review else []
    if isinstance(special_system_implemented, list):
        extra_implemented_capabilities.extend([
            str(item) for item in special_system_implemented
            if str(item).strip()
        ])
    extra_missing_capabilities.extend([
        str(item) for item in getattr(decision, "special_system_missing_capabilities", [])
        if str(item).strip()
    ])
    capability_assessment = _capability_assessment(
        basis,
        extra_missing_capabilities,
        extra_implemented_capabilities,
    )
    missing_capabilities = list(capability_assessment.get("missingCapabilities", []))
    special_systems = [
        str(item) for item in special_system_review.get("systems", [])
        if str(item).strip()
    ] if special_system_review else []
    structured_review_traces = _structured_review_traces(workflow)
    basis_dict = basis.to_dict()
    directions = [
        str(result.get("direction"))
        for result in normalized_direction_results
        if str(result.get("direction") or "").strip()
    ]
    source_trace = _seismic_source_trace(
        basis=basis,
        decision=decision,
        regularity=regularity,
        ground_motion_requirement=ground_motion_requirement,
    )
    data = {
        "analysisMode": "opensees_china_seismic_workflow",
        "designBasis": basis_dict,
        "methodDecision": decision.to_dict(),
        "regularityAssessment": regularity.to_dict() if regularity else None,
        "specialSystemReview": special_system_review or None,
        **structured_review_traces,
        "modal": modal.to_dict() if modal else None,
        "responseSpectrum": response_spectrum,
        "responseSpectrumFinalCompliance": response_spectrum_final_compliance,
        "elasticStoryDriftFinalCompliance": elastic_story_drift_final_compliance,
        "timeHistory": time_history,
        "elasticPlasticTimeHistory": elastic_plastic_time_history,
        "pushover": normalized_pushover,
        "seismicDesignActions": seismic_design_actions,
        "gravityDesignActions": gravity_design_actions,
        "memberDesignActionCombinations": member_design_action_combinations,
        "verticalSeismic": vertical_seismic,
        "groundMotionRequirement": ground_motion_requirement,
        "periodRangeAssessment": period_range_assessments[0] if len(period_range_assessments) == 1 else {
            "requiresSpecialStudy": _requires_period_special_study(period_range_assessments),
            "directionAssessments": period_range_assessments,
        },
        "directionResults": normalized_direction_results,
        "envelope": envelope,
        "modelSummary": model_summary,
        "warnings": warnings,
        "missingInputs": missing_inputs,
        "missingCapabilities": missing_capabilities,
        "capabilityAssessment": capability_assessment,
        "isPreliminary": bool(missing_inputs or getattr(basis, "assumptions", [])),
        "sourceTrace": source_trace,
        "summary": {
            "nodeCount": model_summary["nodeCount"],
            "elementCount": model_summary["elementCount"],
            "storyCount": model_summary["storyCount"],
            "directionCount": len(directions) if directions else 1,
            "directions": directions or ([modal.direction] if modal else []),
            "earthquakeLevel": basis.earthquake_level,
            "verticalSeismicRequired": decision.vertical_seismic_required,
            "pushoverRequired": bool(getattr(decision, "requires_pushover", False)),
            "pushoverStepCount": len(pushover_curve) if normalized_pushover else None,
            "targetDisplacement": normalized_pushover.get("targetDisplacement") if normalized_pushover else None,
            "maxPushoverBaseShear": round(pushover_max_base_shear, 6) if normalized_pushover else None,
            "maxPushoverRoofDisplacement": round(pushover_max_roof_displacement, 8) if normalized_pushover else None,
            "pushoverPerformanceDriftRatio": (
                pushover_capacity.get("performancePoint", {}).get("driftRatio")
                if isinstance(pushover_capacity, dict) and isinstance(pushover_capacity.get("performancePoint"), dict)
                else None
            ),
            "pushoverNonlinearEstimateDriftRatio": (
                pushover_nonlinear_estimate.get("performancePoint", {}).get("driftRatio")
                if isinstance(pushover_nonlinear_estimate, dict) and isinstance(pushover_nonlinear_estimate.get("performancePoint"), dict)
                else None
            ),
            "pushoverFinalComplianceStatus": (
                pushover_final_compliance.get("status")
                if isinstance(pushover_final_compliance, dict)
                else None
            ),
            "pushoverFinalComplianceUtilization": (
                pushover_final_compliance.get("utilization")
                if isinstance(pushover_final_compliance, dict)
                else None
            ),
            "elasticPlasticTimeHistoryRequired": bool(elastic_plastic_time_history),
            "elasticPlasticTimeHistoryFinalComplianceStatus": (
                elastic_plastic_final_compliance.get("status")
                if isinstance(elastic_plastic_final_compliance, dict)
                else None
            ),
            "elasticPlasticTimeHistoryFinalComplianceUtilization": (
                elastic_plastic_final_compliance.get("utilization")
                if isinstance(elastic_plastic_final_compliance, dict)
                else None
            ),
            "horizontalSeismicMemberForceCount": (
                seismic_design_actions.get("memberForceCount")
                if isinstance(seismic_design_actions, dict)
                else None
            ),
            "gravityMemberForceCount": (
                gravity_design_actions.get("memberForceCount")
                if isinstance(gravity_design_actions, dict)
                else None
            ),
            "memberDesignCombinationCaseCount": (
                member_design_action_combinations.get("caseCount")
                if isinstance(member_design_action_combinations, dict)
                else None
            ),
            "totalVerticalActionKN": vertical_seismic.get("totalVerticalActionKN") if isinstance(vertical_seismic, dict) else None,
            "verticalSeismicMemberForceCount": (
                vertical_seismic.get("openSeesStatic", {}).get("memberForceCount")
                if isinstance(vertical_seismic, dict) and isinstance(vertical_seismic.get("openSeesStatic"), dict)
                else None
            ),
            "modalCount": len(modal.modes) if modal else 0,
            "groundMotionRecordCount": ground_motion_requirement["providedCount"],
            "missingGroundMotionCount": ground_motion_requirement["missingCount"],
            "regularityClassification": regularity.classification if regularity else None,
            "specialSystemReviewRequired": bool(special_system_review.get("reviewRequired")) if special_system_review else False,
            "specialSystems": special_systems,
            "specialSystemMissingInputCount": len(special_system_review.get("missingInputs", [])) if special_system_review else 0,
            "specialSystemFailedCheckCount": int(special_system_review.get("failedCheckCount", 0) or 0) if special_system_review else 0,
            "finalComplianceSupported": capability_assessment["finalComplianceSupported"],
            "responseSpectrumFinalComplianceStatus": (
                response_spectrum_final_compliance.get("status")
                if isinstance(response_spectrum_final_compliance, dict)
                else None
            ),
            "responseSpectrumFinalComplianceUtilization": (
                response_spectrum_final_compliance.get("utilization")
                if isinstance(response_spectrum_final_compliance, dict)
                else None
            ),
            "elasticStoryDriftFinalComplianceStatus": (
                elastic_story_drift_final_compliance.get("status")
                if isinstance(elastic_story_drift_final_compliance, dict)
                else None
            ),
            "elasticStoryDriftFinalComplianceUtilization": (
                elastic_story_drift_final_compliance.get("utilization")
                if isinstance(elastic_story_drift_final_compliance, dict)
                else None
            ),
            "periodSpecialStudyRequired": _requires_period_special_study(period_range_assessments),
            "maxBaseShear": envelope.get("maxBaseShear"),
            "maxStoryDriftRatio": envelope.get("maxStoryDriftRatio"),
            "modalMassParticipationRatio": envelope.get("modalMassParticipationRatio"),
            "minStoryShearWeightRatio": envelope.get("minStoryShearWeightRatio"),
            "isPreliminary": bool(missing_inputs or getattr(basis, "assumptions", [])),
        },
    }
    status = "partial" if missing_inputs or missing_capabilities or warnings else "success"
    return {
        "status": status,
        "summary": data["summary"],
        "detailed": data,
        "warnings": warnings,
        "missingInputs": missing_inputs,
        "missingCapabilities": missing_capabilities,
        "capabilityAssessment": capability_assessment,
        # Compatibility fields consumed by existing tool summaries and result-postprocess.
        "analysisMode": data["analysisMode"],
        "designBasis": data["designBasis"],
        "methodDecision": data["methodDecision"],
        "regularityAssessment": data["regularityAssessment"],
        "specialSystemReview": data["specialSystemReview"],
        **structured_review_traces,
        "modal": data["modal"],
        "responseSpectrum": response_spectrum,
        "responseSpectrumFinalCompliance": response_spectrum_final_compliance,
        "elasticStoryDriftFinalCompliance": elastic_story_drift_final_compliance,
        "timeHistory": time_history,
        "elasticPlasticTimeHistory": elastic_plastic_time_history,
        "pushover": normalized_pushover,
        "seismicDesignActions": seismic_design_actions,
        "gravityDesignActions": gravity_design_actions,
        "memberDesignActionCombinations": member_design_action_combinations,
        "verticalSeismic": vertical_seismic,
        "groundMotionRequirement": ground_motion_requirement,
        "directionResults": normalized_direction_results,
        "modelSummary": model_summary,
        "envelope": envelope,
        "sourceTrace": source_trace,
        "data": data,
    }


def _curve_points(raw: Dict[str, Any]) -> List[Dict[str, Any]]:
    points = raw.get("pushoverCurve")
    return [point for point in points if isinstance(point, dict)] if isinstance(points, list) else []


def build_pushover_seismic_result(
    *,
    model: Any,
    basis: SeismicDesignBasis,
    decision: SeismicMethodDecision,
    regularity: Optional[RegularityAssessment],
    pushover: Dict[str, Any],
    warnings: List[str],
    workflow: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    basis_missing_inputs = list(getattr(basis, "missing_inputs", []) or [])
    missing_inputs = list(dict.fromkeys([*basis_missing_inputs, *decision.missing_inputs]))
    curve = _curve_points(pushover)
    model_summary = _model_summary(model, basis)
    pushover_capacity = pushover.get("capacityAssessment") if isinstance(pushover.get("capacityAssessment"), dict) else None
    pushover_nonlinear_estimate = pushover.get("nonlinearEstimate") if isinstance(pushover.get("nonlinearEstimate"), dict) else None
    pushover_final_compliance = pushover.get("finalCompliance") if isinstance(pushover.get("finalCompliance"), dict) else None
    pushover_implemented_capabilities = ["pushoverPerformancePointEstimate"] if pushover_capacity else []
    if pushover_capacity:
        capacity_iteration = pushover_capacity.get("capacitySpectrumIteration")
        if isinstance(capacity_iteration, dict) and capacity_iteration.get("status") == "estimated":
            pushover_implemented_capabilities.append("pushoverCapacitySpectrumIteration")
    if pushover_nonlinear_estimate:
        implemented = pushover_nonlinear_estimate.get("implementedCapabilities")
        if isinstance(implemented, list):
            pushover_implemented_capabilities.extend([
                str(item) for item in implemented
                if str(item).strip()
            ])
    final_status = str(pushover_final_compliance.get("status") or "").strip().lower() if pushover_final_compliance else ""
    pushover_missing_capabilities: List[str] = []
    if final_status in {"pass", "fail"}:
        pushover_implemented_capabilities.append("gb50011.nonlinearPushoverFinalCompliance")
    else:
        pushover_missing_capabilities.append("gb50011.nonlinearPushoverFinalCompliance")
    if basis.earthquake_level == "rare":
        if final_status in {"pass", "fail"}:
            pushover_implemented_capabilities.append("gb50011.rareEarthquakeElasticPlasticDeformation")
        else:
            pushover_missing_capabilities.append("gb50011.rareEarthquakeElasticPlasticDeformation")
    special_system_review = (
        getattr(decision, "special_system_audit", {})
        if isinstance(getattr(decision, "special_system_audit", {}), dict)
        else {}
    )
    special_system_implemented = special_system_review.get("implementedCapabilities") if special_system_review else []
    if isinstance(special_system_implemented, list):
        pushover_implemented_capabilities.extend([
            str(item) for item in special_system_implemented
            if str(item).strip()
        ])
    capability_assessment = _capability_assessment(
        basis,
        [
            *pushover_missing_capabilities,
            *(["gb50011.verticalSeismicAction"] if decision.vertical_seismic_required else []),
            *[
                str(item) for item in getattr(decision, "special_system_missing_capabilities", [])
                if str(item).strip()
            ],
        ],
        list(dict.fromkeys(pushover_implemented_capabilities)),
    )
    missing_capabilities = list(capability_assessment.get("missingCapabilities", []))
    special_systems = [
        str(item) for item in special_system_review.get("systems", [])
        if str(item).strip()
    ] if special_system_review else []
    structured_review_traces = _structured_review_traces(workflow)
    max_base_shear = max((abs(float(point.get("baseShear", 0.0) or 0.0)) for point in curve), default=0.0)
    max_roof_displacement = max((abs(float(point.get("roofDisplacement", 0.0) or 0.0)) for point in curve), default=0.0)
    normalized_pushover = {
        "engineMode": pushover.get("engineMode") or "opensees_static_pushover",
        "targetDisplacement": pushover.get("targetDisplacement"),
        "controlNode": pushover.get("controlNode"),
        "stepCount": len(curve),
        "curve": curve,
        "maxBaseShear": round(max_base_shear, 6),
        "maxRoofDisplacement": round(max_roof_displacement, 8),
        "capacityAssessment": pushover_capacity,
        "nonlinearEstimate": pushover_nonlinear_estimate,
        "finalCompliance": pushover_final_compliance,
        "converged": pushover.get("converged"),
        "completedSteps": pushover.get("completedSteps"),
        "requestedSteps": pushover.get("requestedSteps"),
        "rawStatus": pushover.get("status"),
    }
    envelope = {
        "maxBaseShear": round(max_base_shear, 6),
        "maxAbsShearForce": round(max_base_shear, 6),
        "maxAbsReaction": round(max_base_shear, 6),
        "maxAbsDisplacement": round(max_roof_displacement, 8),
        "controlCase": {
            "baseShear": "pushover",
            "displacement": "pushover",
        },
    }
    basis_dict = basis.to_dict()
    ground_motion_requirement = {
        "required": False,
        "requiredCount": 0,
        "totalRequiredCount": 0,
        "providedCount": 0,
        "missingCount": 0,
        "status": "not_required",
    }
    source_trace = _seismic_source_trace(
        basis=basis,
        decision=decision,
        regularity=regularity,
        ground_motion_requirement=ground_motion_requirement,
    )
    data = {
        "analysisMode": "opensees_china_seismic_workflow",
        "designBasis": basis_dict,
        "methodDecision": decision.to_dict(),
        "regularityAssessment": regularity.to_dict() if regularity else None,
        "specialSystemReview": special_system_review or None,
        **structured_review_traces,
        "modal": None,
        "responseSpectrum": None,
        "timeHistory": None,
        "pushover": normalized_pushover,
        "groundMotionRequirement": ground_motion_requirement,
        "envelope": envelope,
        "modelSummary": model_summary,
        "warnings": warnings,
        "missingInputs": missing_inputs,
        "missingCapabilities": missing_capabilities,
        "capabilityAssessment": capability_assessment,
        "isPreliminary": bool(missing_inputs or getattr(basis, "assumptions", [])),
        "sourceTrace": source_trace,
        "summary": {
            "nodeCount": model_summary["nodeCount"],
            "elementCount": model_summary["elementCount"],
            "storyCount": model_summary["storyCount"],
            "earthquakeLevel": basis.earthquake_level,
            "modalCount": 0,
            "groundMotionRecordCount": 0,
            "regularityClassification": regularity.classification if regularity else None,
            "specialSystemReviewRequired": bool(special_system_review.get("reviewRequired")) if special_system_review else False,
            "specialSystems": special_systems,
            "specialSystemMissingInputCount": len(special_system_review.get("missingInputs", [])) if special_system_review else 0,
            "specialSystemFailedCheckCount": int(special_system_review.get("failedCheckCount", 0) or 0) if special_system_review else 0,
            "finalComplianceSupported": capability_assessment["finalComplianceSupported"],
            "pushoverStepCount": len(curve),
            "targetDisplacement": pushover.get("targetDisplacement"),
            "maxBaseShear": envelope.get("maxBaseShear"),
            "maxRoofDisplacement": envelope.get("maxAbsDisplacement"),
            "pushoverPerformanceDriftRatio": (
                pushover_capacity.get("performancePoint", {}).get("driftRatio")
                if isinstance(pushover_capacity, dict) and isinstance(pushover_capacity.get("performancePoint"), dict)
                else None
            ),
            "pushoverNonlinearEstimateDriftRatio": (
                pushover_nonlinear_estimate.get("performancePoint", {}).get("driftRatio")
                if isinstance(pushover_nonlinear_estimate, dict) and isinstance(pushover_nonlinear_estimate.get("performancePoint"), dict)
                else None
            ),
            "pushoverFinalComplianceStatus": (
                pushover_final_compliance.get("status")
                if isinstance(pushover_final_compliance, dict)
                else None
            ),
            "pushoverFinalComplianceUtilization": (
                pushover_final_compliance.get("utilization")
                if isinstance(pushover_final_compliance, dict)
                else None
            ),
            "isPreliminary": bool(missing_inputs or getattr(basis, "assumptions", [])),
        },
    }
    status = "success" if curve and not missing_inputs and not missing_capabilities and not warnings else "partial"
    return {
        "status": status,
        "summary": data["summary"],
        "detailed": data,
        "warnings": warnings,
        "missingInputs": missing_inputs,
        "missingCapabilities": missing_capabilities,
        "capabilityAssessment": capability_assessment,
        "analysisMode": data["analysisMode"],
        "designBasis": data["designBasis"],
        "methodDecision": data["methodDecision"],
        "regularityAssessment": data["regularityAssessment"],
        "specialSystemReview": data["specialSystemReview"],
        **structured_review_traces,
        "pushover": normalized_pushover,
        "groundMotionRequirement": ground_motion_requirement,
        "modelSummary": model_summary,
        "envelope": envelope,
        "sourceTrace": source_trace,
        "data": data,
    }
