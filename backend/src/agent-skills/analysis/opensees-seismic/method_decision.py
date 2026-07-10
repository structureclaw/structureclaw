from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from design_basis import SeismicDesignBasis
from seismic_contracts import as_record, first_number, performance_objective_from_workflow, workflow_method_preference
from special_systems import audit_special_systems


@dataclass
class SeismicMethodDecision:
    primary_method: str
    selected_methods: List[str]
    requires_time_history: bool
    required_ground_motion_count: int
    combination_rule: str
    missing_inputs: List[str] = field(default_factory=list)
    reasons: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    vertical_seismic_required: bool = False
    vertical_seismic_reasons: List[str] = field(default_factory=list)
    requires_elastic_plastic_time_history: bool = False
    requires_pushover: bool = False
    special_system_review_required: bool = False
    special_system_reasons: List[str] = field(default_factory=list)
    special_system_missing_capabilities: List[str] = field(default_factory=list)
    special_system_audit: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "primaryMethod": self.primary_method,
            "selectedMethods": self.selected_methods,
            "requiresTimeHistory": self.requires_time_history,
            "requiredGroundMotionCount": self.required_ground_motion_count,
            "combinationRule": self.combination_rule,
            "missingInputs": self.missing_inputs,
            "reasons": self.reasons,
            "warnings": self.warnings,
            "verticalSeismicRequired": self.vertical_seismic_required,
            "verticalSeismicReasons": self.vertical_seismic_reasons,
            "requiresElasticPlasticTimeHistory": self.requires_elastic_plastic_time_history,
            "requiresPushover": self.requires_pushover,
            "specialSystemReviewRequired": self.special_system_review_required,
            "specialSystemReasons": self.special_system_reasons,
            "specialSystemMissingCapabilities": self.special_system_missing_capabilities,
            "specialSystemAudit": self.special_system_audit,
        }


def _is_true(value: Any) -> bool:
    return value is True or (isinstance(value, str) and value.strip().lower() in {"true", "yes", "1"})


def _height_threshold_requires_time_history(basis: SeismicDesignBasis) -> bool:
    if basis.intensity >= 9:
        return basis.height_m > 60.0
    if basis.intensity == 8 and basis.site_category in {"III", "IV"}:
        return basis.height_m > 80.0
    if basis.intensity in {7, 8}:
        return basis.height_m > 100.0
    return False


def _regularity_classification(regularity_assessment: Optional[Any]) -> str:
    if regularity_assessment is None:
        return ""
    if isinstance(regularity_assessment, dict):
        return str(regularity_assessment.get("classification") or "").strip().lower()
    return str(getattr(regularity_assessment, "classification", "") or "").strip().lower()


def _structured_bool(workflow: Dict[str, Any], key: str) -> bool:
    requirements = as_record(workflow.get("designRequirements"))
    structure = as_record(workflow.get("structure"))
    structure_profile = as_record(workflow.get("structureProfile"))
    for source in (requirements, structure, structure_profile, workflow):
        if _is_true(source.get(key)):
            return True
    return False


def _vertical_seismic_reasons(workflow: Dict[str, Any], basis: SeismicDesignBasis) -> List[str]:
    reasons: List[str] = []
    if _structured_bool(workflow, "requiresVerticalSeismic"):
        reasons.append("Structured workflow explicitly requires vertical seismic action.")
    if basis.intensity >= 8 and _structured_bool(workflow, "hasLargeSpan"):
        reasons.append("Intensity 8 or 9 with structured large-span flag requires vertical seismic action.")
    if basis.intensity >= 8 and _structured_bool(workflow, "hasLongCantilever"):
        reasons.append("Intensity 8 or 9 with structured long-cantilever flag requires vertical seismic action.")
    if basis.intensity >= 8 and _structured_bool(workflow, "hasIsolation"):
        reasons.append("Intensity 8 or 9 with structured isolation flag requires vertical seismic action review.")
    high_rise = _structured_bool(workflow, "isHighRise") or _structured_bool(workflow, "highRise")
    if basis.intensity >= 9 and (high_rise or basis.height_m > 24.0):
        reasons.append("Intensity 9 high-rise building condition requires vertical seismic action.")
    return reasons


def _special_system_review(workflow: Dict[str, Any]) -> Tuple[List[str], List[str]]:
    audit = audit_special_systems(workflow)
    reasons = [
        str(item) for item in audit.get("reasons", [])
        if str(item).strip()
    ] if audit else []
    missing_capabilities = [
        str(item) for item in audit.get("capabilityBoundaries", [])
        if str(item).strip()
    ] if audit else []
    return list(dict.fromkeys(reasons)), list(dict.fromkeys(missing_capabilities))


def _nonlinear_deformation_reasons(workflow: Dict[str, Any], basis: SeismicDesignBasis) -> List[str]:
    requirements = as_record(workflow.get("designRequirements"))
    nonlinear_model = as_record(workflow.get("nonlinearModel"))
    elastic_plastic = as_record(workflow.get("elasticPlasticTimeHistory"))
    nonlinear_time_history = as_record(workflow.get("nonlinearTimeHistory"))
    performance_objective = performance_objective_from_workflow(
        workflow,
        "elasticPlasticTimeHistory",
        "nonlinearTimeHistory",
        "pushover",
        "analysisControl",
    )
    reasons: List[str] = []

    if basis.earthquake_level == "rare":
        reasons.append("Structured design basis requests rare-earthquake deformation checking.")
    if _is_true(requirements.get("requiresElasticPlasticDeformation")) or _is_true(workflow.get("requiresElasticPlasticDeformation")):
        reasons.append("Structured design requirements explicitly request elastic-plastic deformation checking.")
    if _is_true(requirements.get("requiresPerformanceBasedCheck")) or _is_true(workflow.get("requiresPerformanceBasedCheck")):
        reasons.append("Structured design requirements explicitly request performance-based seismic checking.")
    if performance_objective:
        reasons.append("Structured performance objective was provided for nonlinear seismic acceptance.")
    if nonlinear_model or elastic_plastic or nonlinear_time_history:
        reasons.append("Structured nonlinear model or nonlinear time-history controls were provided.")
    return list(dict.fromkeys(reasons))


def _pushover_candidate_reasons(workflow: Dict[str, Any]) -> List[str]:
    pushover = as_record(workflow.get("pushover"))
    analysis_control = as_record(workflow.get("analysisControl"))
    nonlinear_model = as_record(workflow.get("nonlinearModel"))
    performance_objective = performance_objective_from_workflow(workflow, "pushover", "analysisControl")
    reasons: List[str] = []

    target = first_number(
        pushover.get("targetDisplacement"),
        pushover.get("performanceTargetDisplacement"),
        pushover.get("performancePointDisplacement"),
        analysis_control.get("targetDisplacement"),
        analysis_control.get("performanceTargetDisplacement"),
        performance_objective.get("targetDisplacement"),
    )
    if pushover:
        reasons.append("Structured pushover controls were provided for nonlinear static checking.")
    if target is not None:
        reasons.append("Structured pushover target displacement was provided.")
    hinges = nonlinear_model.get("memberPlasticHinges")
    if isinstance(hinges, list) and hinges:
        reasons.append("Structured member plastic-hinge data was provided for nonlinear static checking.")
    return list(dict.fromkeys(reasons))


def _time_history_reasons(
    workflow: Dict[str, Any],
    basis: SeismicDesignBasis,
    regularity_assessment: Optional[Any] = None,
) -> List[str]:
    requirements = as_record(workflow.get("designRequirements"))
    structure = as_record(workflow.get("structure"))
    structure_profile = as_record(workflow.get("structureProfile"))
    regularity_assessment_input = as_record(workflow.get("regularityAssessment"))
    reasons: List[str] = []

    if _is_true(requirements.get("supplementaryTimeHistory")) or _is_true(workflow.get("requiresTimeHistory")):
        reasons.append("Structured design requirements explicitly request supplementary elastic time-history analysis.")

    fortification = basis.fortification_category.strip().lower()
    if fortification in {"a", "甲", "special", "special_fortification", "category_a"}:
        reasons.append("Fortification category indicates a special/Category A structure requiring higher-fidelity seismic checking.")

    irregularity = str(
        requirements.get("irregularity")
        or structure.get("irregularity")
        or structure_profile.get("regularity")
        or structure_profile.get("irregularity")
        or regularity_assessment_input.get("classification")
        or regularity_assessment_input.get("regularity")
        or workflow.get("irregularity")
        or ""
    ).strip().lower()
    if irregularity in {"particularly_irregular", "special_irregular", "severe", "serious"}:
        reasons.append("Structured regularity assessment indicates a particularly irregular structure.")

    auto_regularity = _regularity_classification(regularity_assessment)
    if auto_regularity == "particularly_irregular":
        reasons.append("Automatic model regularity assessment indicates a particularly irregular structure.")

    if _height_threshold_requires_time_history(basis):
        reasons.append(
            f"Height {basis.height_m} m exceeds the frequent-earthquake supplementary time-history threshold "
            f"for intensity {basis.intensity} and site class {basis.site_category}."
        )

    return reasons


def _expected_record_count(workflow: Dict[str, Any], actual_count: int) -> int:
    ground_motion_set = as_record(workflow.get("groundMotionSet"))
    ground_motion_requirement = as_record(workflow.get("groundMotionRequirement"))
    explicit = first_number(
        workflow.get("requiredGroundMotionCount"),
        ground_motion_set.get("requiredCount"),
        ground_motion_set.get("expectedCount"),
        ground_motion_set.get("recordCount"),
        ground_motion_requirement.get("requiredCount"),
        ground_motion_requirement.get("recordCount"),
        ground_motion_requirement.get("expectedCount"),
    )
    if explicit is not None and explicit >= 7:
        return 7
    if actual_count >= 7:
        return 7
    return 3


def decide_seismic_method(
    workflow: Dict[str, Any],
    parameters: Dict[str, Any],
    basis: SeismicDesignBasis,
    ground_motion_count: int,
    regularity_assessment: Optional[Any] = None,
) -> SeismicMethodDecision:
    preference = workflow_method_preference(workflow, parameters)
    warnings: List[str] = []
    reasons = _time_history_reasons(workflow, basis, regularity_assessment)
    nonlinear_reasons = _nonlinear_deformation_reasons(workflow, basis)
    vertical_reasons = _vertical_seismic_reasons(workflow, basis)
    special_system_reasons, special_system_missing_capabilities = _special_system_review(workflow)
    special_system_audit = audit_special_systems(workflow)
    requires_time_history = bool(reasons)
    requires_elastic_plastic_time_history = preference == "elastic_plastic_time_history"
    requires_pushover = False
    auto_regularity = _regularity_classification(regularity_assessment)
    if auto_regularity == "irregular":
        reasons.append(
            "Automatic model regularity assessment indicates irregularity; engineer review is required, but this alone does not force supplementary time-history in the current workflow."
        )

    if preference == "time_history":
        requires_time_history = True
        reasons.append("The structured method preference is elastic time-history analysis.")
    elif preference == "elastic_plastic_time_history":
        requires_time_history = True
        requires_elastic_plastic_time_history = True
        reasons.append("The structured method preference is elastic-plastic time-history analysis.")
    elif preference == "response_spectrum":
        reasons.append("The structured method preference is response spectrum analysis.")
    elif preference == "pushover":
        return SeismicMethodDecision(
            primary_method="pushover",
            selected_methods=["pushover"],
            requires_time_history=False,
            required_ground_motion_count=0,
            combination_rule="pushover",
            reasons=["The structured method preference is pushover analysis."],
            vertical_seismic_required=bool(vertical_reasons),
            vertical_seismic_reasons=vertical_reasons,
            requires_pushover=True,
            special_system_review_required=bool(special_system_missing_capabilities),
            special_system_reasons=special_system_reasons,
            special_system_missing_capabilities=special_system_missing_capabilities,
            special_system_audit=special_system_audit,
        )
    else:
        reasons.append("No explicit seismic method preference was provided; selected by code-based structured requirements.")
        if nonlinear_reasons:
            reasons.extend(nonlinear_reasons)
            pushover_reasons = _pushover_candidate_reasons(workflow)
            if ground_motion_count == 0 and pushover_reasons:
                requires_pushover = True
                reasons.extend(pushover_reasons)
            else:
                requires_time_history = True
                requires_elastic_plastic_time_history = True

    required_count = _expected_record_count(workflow, ground_motion_count)
    missing_inputs: List[str] = []
    selected_methods = ["response_spectrum"]

    if requires_time_history:
        if ground_motion_count > 0:
            selected_methods.append("time_history")
            if ground_motion_count < required_count:
                missing_inputs.append("groundMotions")
                warnings.append(
                    f"{ground_motion_count} ground-motion record(s) were provided; {required_count} required by the selected workflow."
                )
        else:
            missing_inputs.append("groundMotions")
            warnings.append("Supplementary time-history analysis is required, but no ground-motion records were provided.")
    elif preference == "time_history":
        if ground_motion_count > 0:
            selected_methods.append("time_history")
            if ground_motion_count < required_count:
                missing_inputs.append("groundMotions")
                warnings.append(
                    f"{ground_motion_count} ground-motion record(s) were provided; {required_count} required by the selected workflow."
                )
        else:
            missing_inputs.append("groundMotions")
            warnings.append("Time-history analysis was requested, but no ground-motion records were provided.")
    elif preference == "auto" and ground_motion_count > 0:
        selected_methods.append("time_history")
        reasons.append("Ground-motion records were provided, so elastic time-history is run as a supplementary check.")

    if requires_pushover:
        selected_methods.append("pushover")

    if "time_history" in selected_methods:
        if ground_motion_count not in {3, 7} and ground_motion_count < 7:
            warnings.append(
                f"{ground_motion_count} ground-motion record(s) were provided; GB/T 50011 workflow expects 3 or at least 7 records."
            )
        combination_rule = "mean_vs_response_spectrum" if ground_motion_count >= 7 else "envelope_max_vs_response_spectrum"
    else:
        combination_rule = "response_spectrum_only"

    return SeismicMethodDecision(
        primary_method=selected_methods[-1],
        selected_methods=selected_methods,
        requires_time_history=requires_time_history,
        required_ground_motion_count=required_count if requires_time_history or "time_history" in selected_methods else 0,
        combination_rule=combination_rule,
        missing_inputs=missing_inputs,
        reasons=reasons,
        warnings=warnings,
        vertical_seismic_required=bool(vertical_reasons),
        vertical_seismic_reasons=vertical_reasons,
        requires_elastic_plastic_time_history=requires_elastic_plastic_time_history,
        requires_pushover=requires_pushover,
        special_system_review_required=bool(special_system_missing_capabilities),
        special_system_reasons=special_system_reasons,
        special_system_missing_capabilities=special_system_missing_capabilities,
        special_system_audit=special_system_audit,
    )
