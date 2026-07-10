from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from seismic_contracts import as_record, first_number, first_string, optional_int, optional_number
from zonation import resolve_zonation_record


LATEST_CODE_BASIS = [
    {
        "code": "GB 55002-2021",
        "displayCode": "GB 55002-2021",
        "nameZh": "建筑与市政工程抗震通用规范",
        "nameEn": "General code for seismic precaution of buildings and municipal engineering",
        "role": "mandatory",
        "effectiveDate": "2022-01-01",
    },
    {
        "code": "GB/T 50011-2010",
        "displayCode": "GB/T 50011-2010（2024年版）",
        "revision": "2024 partial revision",
        "nameZh": "建筑抗震设计标准",
        "nameEn": "Standard for seismic design of buildings",
        "role": "design-standard",
        "effectiveDate": "2024-08-01",
    },
    {
        "code": "GB 18306-2015",
        "displayCode": "GB 18306-2015",
        "nameZh": "中国地震动参数区划图",
        "nameEn": "Seismic ground motion parameters zonation map of China",
        "role": "ground-motion-parameter-map",
        "standardStatus": "current",
        "publishDate": "2015-05-15",
        "effectiveDate": "2016-06-01",
        "lastReviewDate": "2021-12-31",
        "lastReviewConclusion": "continue_valid",
        "revisionPlan": {
            "planNo": "20260055-Q-419",
            "status": "drafting",
            "issuedDate": "2026-01-27",
        },
    },
    {
        "code": "GB 50223-2008",
        "displayCode": "GB 50223-2008",
        "nameZh": "建筑工程抗震设防分类标准",
        "nameEn": "Standard for classification of seismic protection of building constructions",
        "role": "fortification-classification",
    },
]

ALPHA_MAX_BY_ACCELERATION_G = {
    0.05: 0.04,
    0.10: 0.08,
    0.15: 0.12,
    0.20: 0.16,
    0.30: 0.24,
    0.40: 0.32,
}

ALPHA_MAX_BY_ACCELERATION_G_AND_LEVEL = {
    "frequent": ALPHA_MAX_BY_ACCELERATION_G,
    "fortification": {
        0.05: 0.12,
        0.10: 0.23,
        0.15: 0.34,
        0.20: 0.45,
        0.30: 0.68,
        0.40: 0.90,
    },
    "rare": {
        0.05: 0.28,
        0.10: 0.50,
        0.15: 0.72,
        0.20: 0.90,
        0.30: 1.20,
        0.40: 1.40,
    },
}

ALPHA_MAX_BY_INTENSITY = {
    6: 0.04,
    7: 0.08,
    8: 0.16,
    9: 0.32,
}

ALPHA_MAX_BY_INTENSITY_AND_LEVEL = {
    "frequent": ALPHA_MAX_BY_INTENSITY,
    "fortification": {
        6: 0.12,
        7: 0.23,
        8: 0.45,
        9: 0.90,
    },
    "rare": {
        6: 0.28,
        7: 0.50,
        8: 0.90,
        9: 1.40,
    },
}

CONSERVATIVE_ALPHA_MAX_BY_INTENSITY_AND_LEVEL = {
    "frequent": {
        6: 0.04,
        7: 0.12,
        8: 0.24,
        9: 0.32,
    },
    "fortification": {
        6: 0.12,
        7: 0.34,
        8: 0.68,
        9: 0.90,
    },
    "rare": {
        6: 0.28,
        7: 0.72,
        8: 1.20,
        9: 1.40,
    },
}

INTENSITY_BY_ACCELERATION_G = {
    0.05: 6,
    0.10: 7,
    0.15: 7,
    0.20: 8,
    0.30: 8,
    0.40: 9,
}

TG_BY_GROUP_AND_SITE = {
    "1": {"I0": 0.20, "I1": 0.25, "I": 0.25, "II": 0.35, "III": 0.45, "IV": 0.65},
    "2": {"I0": 0.25, "I1": 0.30, "I": 0.30, "II": 0.40, "III": 0.55, "IV": 0.75},
    "3": {"I0": 0.30, "I1": 0.35, "I": 0.35, "II": 0.45, "III": 0.65, "IV": 0.90},
}


@dataclass
class SeismicDesignBasis:
    code_basis: List[Dict[str, Any]]
    region: Optional[str]
    intensity: int
    acceleration_g: Optional[float]
    design_group: str
    site_category: str
    earthquake_level: str
    characteristic_period: float
    alpha_max: float
    damping_ratio: float
    fortification_category: str
    fortification_category_label: Dict[str, str]
    fortification_category_code_class: str
    seismic_action_standard: str
    seismic_measure_standard: str
    seismic_measure_intensity: Optional[int]
    seismic_safety_evaluation_required: bool
    seismic_safety_evaluation_provided: bool
    seismic_grade: Optional[int]
    seismic_grade_source: Optional[str]
    height_m: float
    story_count: int
    structural_family: str
    zonation_record: Optional[Dict[str, Any]] = None
    missing_inputs: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    assumptions: List[str] = field(default_factory=list)
    source_trace: List[Dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "codeBasis": self.code_basis,
            "region": self.region,
            "intensity": self.intensity,
            "accelerationG": self.acceleration_g,
            "designGroup": self.design_group,
            "siteCategory": self.site_category,
            "earthquakeLevel": self.earthquake_level,
            "characteristicPeriod": self.characteristic_period,
            "alphaMax": self.alpha_max,
            "dampingRatio": self.damping_ratio,
            "fortificationCategory": self.fortification_category,
            "fortificationCategoryLabel": self.fortification_category_label,
            "fortificationCategoryCodeClass": self.fortification_category_code_class,
            "seismicActionStandard": self.seismic_action_standard,
            "seismicMeasureStandard": self.seismic_measure_standard,
            "seismicMeasureIntensity": self.seismic_measure_intensity,
            "seismicSafetyEvaluationRequired": self.seismic_safety_evaluation_required,
            "seismicSafetyEvaluationProvided": self.seismic_safety_evaluation_provided,
            "seismicGrade": self.seismic_grade,
            "seismicGradeSource": self.seismic_grade_source,
            "heightM": self.height_m,
            "storyCount": self.story_count,
            "structuralFamily": self.structural_family,
            "groundMotionZonation": self.zonation_record,
            "missingInputs": self.missing_inputs,
            "isPreliminary": bool(self.missing_inputs or self.assumptions),
            "warnings": self.warnings,
            "assumptions": self.assumptions,
            "sourceTrace": self.source_trace,
        }


def model_payload(model: Any) -> Dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump(mode="python")
    return model if isinstance(model, dict) else {}


def _node_records(payload: Dict[str, Any], model: Any) -> List[Any]:
    nodes = payload.get("nodes")
    if isinstance(nodes, list) and nodes:
        return nodes
    return list(getattr(model, "nodes", []) or [])


def _get_field(record: Any, key: str, default: Any = None) -> Any:
    if isinstance(record, dict):
        return record.get(key, default)
    return getattr(record, key, default)


def _height_m(payload: Dict[str, Any], model: Any, workflow: Dict[str, Any]) -> float:
    metadata = as_record(payload.get("metadata"))
    structure = as_record(workflow.get("structure"))
    structure_profile = as_record(workflow.get("structureProfile"))
    design_basis = as_record(workflow.get("designBasis"))
    explicit = first_number(
        structure.get("heightM"),
        structure.get("totalHeightM"),
        structure_profile.get("heightM"),
        structure_profile.get("totalHeightM"),
        design_basis.get("heightM"),
        workflow.get("heightM"),
        metadata.get("heightM"),
        metadata.get("totalHeightM"),
    )
    if explicit is not None and explicit > 0:
        return explicit
    z_values = [optional_number(_get_field(node, "z")) for node in _node_records(payload, model)]
    z_numbers = [z for z in z_values if z is not None]
    if not z_numbers:
        return 0.0
    return max(z_numbers) - min(z_numbers)


def _story_count(payload: Dict[str, Any], workflow: Dict[str, Any]) -> int:
    metadata = as_record(payload.get("metadata"))
    structure = as_record(workflow.get("structure"))
    structure_profile = as_record(workflow.get("structureProfile"))
    design_basis = as_record(workflow.get("designBasis"))
    explicit = optional_int(first_number(
        structure.get("storyCount"),
        structure.get("floors"),
        structure_profile.get("storyCount"),
        structure_profile.get("floors"),
        design_basis.get("storyCount"),
        workflow.get("storyCount"),
        metadata.get("storyCount"),
    ))
    if explicit is not None and explicit > 0:
        return explicit
    stories = payload.get("stories")
    if isinstance(stories, list) and stories:
        return len(stories)
    levels = sorted({
        round(float(node.get("z", 0.0)), 6)
        for node in payload.get("nodes", [])
        if isinstance(node, dict)
    })
    return max(0, len([level for level in levels if level > min(levels or [0.0])]))


def _normalize_group(value: Optional[str]) -> str:
    if not value:
        return "1"
    text = value.strip().lower()
    if text in {"1", "一", "第一组", "group1", "group 1"}:
        return "1"
    if text in {"2", "二", "第二组", "group2", "group 2"}:
        return "2"
    if text in {"3", "三", "第三组", "group3", "group 3"}:
        return "3"
    return "1"


def _normalize_site_category(value: Optional[str]) -> str:
    if not value:
        return "II"
    text = value.strip().upper().replace("类", "")
    mapping = {
        "0": "I0",
        "I0": "I0",
        "1": "I",
        "I": "I",
        "I1": "I1",
        "2": "II",
        "II": "II",
        "3": "III",
        "III": "III",
        "4": "IV",
        "IV": "IV",
    }
    return mapping.get(text, "II")


def _normalize_earthquake_level(value: Optional[str]) -> str:
    if not value:
        return "frequent"
    text = value.strip().lower()
    if text in {"frequent", "minor", "small", "frequent_earthquake", "service", "多遇", "小震", "多遇地震"}:
        return "frequent"
    if text in {"fortification", "design", "moderate", "basic", "design_earthquake", "设防", "中震", "设防地震"}:
        return "fortification"
    if text in {"rare", "major", "large", "maximum", "rare_earthquake", "no_collapse", "罕遇", "大震", "罕遇地震"}:
        return "rare"
    return "frequent"


def _normalize_seismic_grade(value: Any) -> Optional[int]:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        grade = int(value)
        return grade if grade in {1, 2, 3, 4} else None
    text = str(value).strip().lower()
    mapping = {
        "1": 1,
        "i": 1,
        "grade1": 1,
        "grade 1": 1,
        "first": 1,
        "一级": 1,
        "一": 1,
        "2": 2,
        "ii": 2,
        "grade2": 2,
        "grade 2": 2,
        "second": 2,
        "二级": 2,
        "二": 2,
        "3": 3,
        "iii": 3,
        "grade3": 3,
        "grade 3": 3,
        "third": 3,
        "三级": 3,
        "三": 3,
        "4": 4,
        "iv": 4,
        "grade4": 4,
        "grade 4": 4,
        "fourth": 4,
        "四级": 4,
        "四": 4,
    }
    return mapping.get(text)


def _structured_seismic_grade_with_source(candidates: List[Tuple[str, Any]]) -> Tuple[Optional[int], Optional[str]]:
    for source, value in candidates:
        grade = _normalize_seismic_grade(value)
        if grade is not None:
            return grade, source
    return None, None


FORTIFICATION_CATEGORY_METADATA = {
    "special": {
        "labelZh": "特殊设防类",
        "labelEn": "special fortification category",
        "codeClass": "A",
        "actionStandard": "approved_seismic_safety_evaluation_higher_than_local_intensity",
        "measureStandard": "increase_one_intensity_or_higher_than_9",
        "requiresSeismicSafetyEvaluation": True,
    },
    "key": {
        "labelZh": "重点设防类",
        "labelEn": "key fortification category",
        "codeClass": "B",
        "actionStandard": "local_fortification_intensity",
        "measureStandard": "increase_one_intensity_or_higher_than_9",
        "requiresSeismicSafetyEvaluation": False,
    },
    "standard": {
        "labelZh": "标准设防类",
        "labelEn": "standard fortification category",
        "codeClass": "C",
        "actionStandard": "local_fortification_intensity",
        "measureStandard": "local_fortification_intensity",
        "requiresSeismicSafetyEvaluation": False,
    },
    "moderate": {
        "labelZh": "适度设防类",
        "labelEn": "moderate fortification category",
        "codeClass": "D",
        "actionStandard": "local_fortification_intensity",
        "measureStandard": "may_reduce_with_conditions",
        "requiresSeismicSafetyEvaluation": False,
    },
}


FORTIFICATION_CATEGORY_ALIASES = {
    "special": "special",
    "special_fortification": "special",
    "category_a": "special",
    "a": "special",
    "jia": "special",
    "甲": "special",
    "甲类": "special",
    "特殊": "special",
    "特殊设防": "special",
    "特殊设防类": "special",
    "key": "key",
    "important": "key",
    "major": "key",
    "category_b": "key",
    "b": "key",
    "yi": "key",
    "乙": "key",
    "乙类": "key",
    "重点": "key",
    "重点设防": "key",
    "重点设防类": "key",
    "standard": "standard",
    "normal": "standard",
    "regular": "standard",
    "ordinary": "standard",
    "category_c": "standard",
    "c": "standard",
    "bing": "standard",
    "丙": "standard",
    "丙类": "standard",
    "标准": "standard",
    "标准设防": "standard",
    "标准设防类": "standard",
    "moderate": "moderate",
    "appropriate": "moderate",
    "minor": "moderate",
    "category_d": "moderate",
    "d": "moderate",
    "ding": "moderate",
    "丁": "moderate",
    "丁类": "moderate",
    "适度": "moderate",
    "适度设防": "moderate",
    "适度设防类": "moderate",
}


def _normalize_fortification_category(value: Optional[str]) -> str:
    text = str(value or "standard").strip()
    key = text.lower().replace("-", "_").replace(" ", "_")
    return FORTIFICATION_CATEGORY_ALIASES.get(key, FORTIFICATION_CATEGORY_ALIASES.get(text, "standard"))


def _seismic_measure_intensity(category: str, intensity: int) -> Optional[int]:
    if category in {"special", "key"}:
        return min(intensity + 1, 10) if intensity < 9 else 10
    if category == "standard":
        return intensity
    if category == "moderate":
        return max(intensity - 1, 6) if intensity > 6 else 6
    return intensity


def _seismic_safety_evaluation_record(workflow: Dict[str, Any]) -> Dict[str, Any]:
    design_basis = as_record(workflow.get("designBasis"))
    requirements = as_record(workflow.get("designRequirements"))
    return as_record(
        design_basis.get("seismicSafetyEvaluation")
        or design_basis.get("safetyEvaluation")
        or requirements.get("seismicSafetyEvaluation")
        or workflow.get("seismicSafetyEvaluation")
    )


def _seismic_safety_evaluation_provided(record: Dict[str, Any]) -> bool:
    if not record:
        return False
    approved = record.get("approved")
    if approved is True:
        return True
    if isinstance(approved, str) and approved.strip().lower() in {"true", "yes", "1"}:
        return True
    return False


def _alpha_from_acceleration(acceleration_g: Optional[float], earthquake_level: str) -> Optional[float]:
    if acceleration_g is None:
        return None
    table = ALPHA_MAX_BY_ACCELERATION_G_AND_LEVEL.get(earthquake_level, ALPHA_MAX_BY_ACCELERATION_G)
    closest = min(table, key=lambda key: abs(key - acceleration_g))
    if abs(closest - acceleration_g) <= 0.011:
        return table[closest]
    return None


def _intensity_from_acceleration(acceleration_g: Optional[float]) -> Optional[int]:
    if acceleration_g is None:
        return None
    closest = min(INTENSITY_BY_ACCELERATION_G, key=lambda key: abs(key - acceleration_g))
    if abs(closest - acceleration_g) <= 0.011:
        return INTENSITY_BY_ACCELERATION_G[closest]
    return None


def _read_site_seismic(payload: Dict[str, Any], workflow: Dict[str, Any]) -> Dict[str, Any]:
    metadata = as_record(payload.get("metadata"))
    design_basis = as_record(workflow.get("designBasis"))
    return {
        **as_record(payload.get("site_seismic")),
        **as_record(metadata.get("siteSeismic")),
        **as_record(design_basis.get("siteSeismic")),
        **as_record(workflow.get("siteSeismic")),
    }


def _read_analysis_control(payload: Dict[str, Any], workflow: Dict[str, Any]) -> Dict[str, Any]:
    return {
        **as_record(payload.get("analysis_control")),
        **as_record(workflow.get("analysisControl")),
    }


def _source_type(source: Optional[str]) -> str:
    text = str(source or "").strip()
    if not text:
        return "derived"
    if text.startswith("assumption.") or text == "missing":
        return "assumption"
    if text.startswith("GB ") or text.startswith("GB/T ") or text.startswith("codeTable."):
        return "code"
    if text.startswith("GB18306") or text.startswith("zonationRecord."):
        return "gb18306"
    if text.startswith("model.") or text.startswith("metadata."):
        return "model"
    if text.startswith("parameters."):
        return "parameters"
    if text.startswith("derived."):
        return "derived"
    return "user"


def _string_source(candidates: List[Tuple[str, Any]]) -> Optional[str]:
    for source, value in candidates:
        if first_string(value) is not None:
            return source
    return None


def _number_source(candidates: List[Tuple[str, Any]], target: Optional[float] = None) -> Optional[str]:
    for source, value in candidates:
        number = optional_number(value)
        if number is None:
            continue
        if target is None or abs(number - target) <= 1e-9:
            return source
    return None


def _trace_entry(
    field_name: str,
    value: Any,
    source: Optional[str],
    *,
    note: str = "",
    assumed: bool = False,
) -> Dict[str, Any]:
    resolved_source = source or "derived"
    return {
        "field": field_name,
        "value": value,
        "source": resolved_source,
        "sourceType": _source_type(resolved_source),
        "assumed": bool(assumed or resolved_source.startswith("assumption.")),
        **({"note": note} if note else {}),
    }


def build_design_basis(model: Any, parameters: Dict[str, Any], workflow: Dict[str, Any]) -> SeismicDesignBasis:
    payload = model_payload(model)
    site = _read_site_seismic(payload, workflow)
    control = _read_analysis_control(payload, workflow)
    design_basis = as_record(workflow.get("designBasis"))
    requirements = as_record(workflow.get("designRequirements"))
    ground_motion_requirement = as_record(workflow.get("groundMotionRequirement"))
    metadata = as_record(payload.get("metadata"))
    payload_site = as_record(payload.get("site_seismic"))
    metadata_site = as_record(metadata.get("siteSeismic"))
    design_basis_site = as_record(design_basis.get("siteSeismic"))
    workflow_site = as_record(workflow.get("siteSeismic"))
    seismic_safety_evaluation = _seismic_safety_evaluation_record(workflow)
    seismic_safety_evaluation_provided = _seismic_safety_evaluation_provided(seismic_safety_evaluation)
    region_candidates = [
        ("seismicWorkflow.siteSeismic.region", workflow_site.get("region")),
        ("seismicWorkflow.siteSeismic.city", workflow_site.get("city")),
        ("designBasis.siteSeismic.region", design_basis_site.get("region")),
        ("designBasis.siteSeismic.city", design_basis_site.get("city")),
        ("metadata.siteSeismic.region", metadata_site.get("region")),
        ("metadata.siteSeismic.city", metadata_site.get("city")),
        ("model.site_seismic.region", payload_site.get("region")),
        ("model.site_seismic.city", payload_site.get("city")),
        ("designBasis.region", design_basis.get("region")),
        ("designBasis.city", design_basis.get("city")),
        ("seismicWorkflow.region", workflow.get("region")),
        ("metadata.region", metadata.get("region")),
        ("metadata.location", metadata.get("location")),
    ]
    region = first_string(
        site.get("region"),
        site.get("city"),
        design_basis.get("region"),
        design_basis.get("city"),
        workflow.get("region"),
        metadata.get("region"),
        metadata.get("location"),
    )
    zonation_record = resolve_zonation_record(payload, workflow, region)
    region = region or first_string(as_record(zonation_record).get("region"))

    warnings: List[str] = []
    assumptions: List[str] = []
    missing_inputs: List[str] = []

    fortification_category_candidates = [
        ("designRequirements.fortificationCategory", requirements.get("fortificationCategory")),
        ("designBasis.fortificationCategory", design_basis.get("fortificationCategory")),
        ("metadata.fortificationCategory", metadata.get("fortificationCategory")),
        ("seismicWorkflow.fortificationCategory", workflow.get("fortificationCategory")),
    ]
    fortification_category_value = first_string(
        requirements.get("fortificationCategory"),
        design_basis.get("fortificationCategory"),
        metadata.get("fortificationCategory"),
        workflow.get("fortificationCategory"),
    )
    if fortification_category_value is None:
        missing_inputs.append("designRequirements.fortificationCategory")
        assumptions.append("No fortification category was provided; assumed standard fortification category for preliminary analysis.")
    fortification_category = _normalize_fortification_category(fortification_category_value)
    fortification_metadata = FORTIFICATION_CATEGORY_METADATA[fortification_category]
    if fortification_category == "special" and not seismic_safety_evaluation_provided:
        missing_inputs.append("designBasis.seismicSafetyEvaluation")
        assumptions.append(
            "Special fortification category requires an approved seismic safety evaluation; "
            "local design parameters were retained for preliminary analysis."
        )
    safety_evaluation_active = fortification_category == "special" and seismic_safety_evaluation_provided
    safety_evaluation_acceleration_g = first_number(
        seismic_safety_evaluation.get("accelerationG"),
        seismic_safety_evaluation.get("acceleration_g"),
        seismic_safety_evaluation.get("basicAccelerationG"),
        seismic_safety_evaluation.get("designBasicAccelerationG"),
    ) if safety_evaluation_active else None
    safety_evaluation_alpha_max = first_number(
        seismic_safety_evaluation.get("maxInfluenceCoefficient"),
        seismic_safety_evaluation.get("alphaMax"),
    ) if safety_evaluation_active else None
    safety_evaluation_characteristic_period = first_number(
        seismic_safety_evaluation.get("characteristicPeriod"),
        seismic_safety_evaluation.get("characteristic_period"),
        seismic_safety_evaluation.get("Tg"),
    ) if safety_evaluation_active else None
    safety_evaluation_rare_characteristic_period = first_number(
        seismic_safety_evaluation.get("rareCharacteristicPeriod"),
        seismic_safety_evaluation.get("rare_characteristic_period"),
        seismic_safety_evaluation.get("rareTg"),
    ) if safety_evaluation_active else None

    acceleration_candidates = [
        ("designBasis.seismicSafetyEvaluation.accelerationG", safety_evaluation_acceleration_g),
        ("seismicWorkflow.siteSeismic.accelerationG", workflow_site.get("accelerationG")),
        ("seismicWorkflow.siteSeismic.acceleration_g", workflow_site.get("acceleration_g")),
        ("seismicWorkflow.siteSeismic.basicAccelerationG", workflow_site.get("basicAccelerationG")),
        ("seismicWorkflow.siteSeismic.designBasicAccelerationG", workflow_site.get("designBasicAccelerationG")),
        ("designBasis.siteSeismic.accelerationG", design_basis_site.get("accelerationG")),
        ("designBasis.siteSeismic.acceleration_g", design_basis_site.get("acceleration_g")),
        ("designBasis.siteSeismic.basicAccelerationG", design_basis_site.get("basicAccelerationG")),
        ("designBasis.siteSeismic.designBasicAccelerationG", design_basis_site.get("designBasicAccelerationG")),
        ("metadata.siteSeismic.accelerationG", metadata_site.get("accelerationG")),
        ("metadata.siteSeismic.acceleration_g", metadata_site.get("acceleration_g")),
        ("model.site_seismic.accelerationG", payload_site.get("accelerationG")),
        ("model.site_seismic.acceleration_g", payload_site.get("acceleration_g")),
        ("model.site_seismic.extra.acceleration_g", as_record(payload_site.get("extra")).get("acceleration_g")),
        ("model.site_seismic.basicAccelerationG", payload_site.get("basicAccelerationG")),
        ("model.site_seismic.designBasicAccelerationG", payload_site.get("designBasicAccelerationG")),
        ("designBasis.accelerationG", design_basis.get("accelerationG")),
        ("designBasis.acceleration_g", design_basis.get("acceleration_g")),
        ("designBasis.designBasicAccelerationG", design_basis.get("designBasicAccelerationG")),
        ("designRequirements.accelerationG", requirements.get("accelerationG")),
        ("designRequirements.designBasicAccelerationG", requirements.get("designBasicAccelerationG")),
        ("GB18306.zonationRecord.accelerationG", as_record(zonation_record).get("accelerationG")),
        ("GB18306.zonationRecord.designBasicAccelerationG", as_record(zonation_record).get("designBasicAccelerationG")),
        ("parameters.accelerationG", parameters.get("accelerationG")),
        ("parameters.designBasicAccelerationG", parameters.get("designBasicAccelerationG")),
    ]
    acceleration_g = first_number(
        safety_evaluation_acceleration_g,
        site.get("accelerationG"),
        site.get("acceleration_g"),
        as_record(site.get("extra")).get("acceleration_g"),
        site.get("basicAccelerationG"),
        site.get("designBasicAccelerationG"),
        design_basis.get("accelerationG"),
        design_basis.get("acceleration_g"),
        design_basis.get("designBasicAccelerationG"),
        requirements.get("accelerationG"),
        requirements.get("designBasicAccelerationG"),
        as_record(zonation_record).get("accelerationG"),
        as_record(zonation_record).get("designBasicAccelerationG"),
        parameters.get("accelerationG"),
        parameters.get("designBasicAccelerationG"),
    )

    intensity_candidates = [
        ("designBasis.seismicSafetyEvaluation.intensity", seismic_safety_evaluation.get("intensity") if safety_evaluation_active else None),
        ("seismicWorkflow.siteSeismic.intensity", workflow_site.get("intensity")),
        ("designBasis.siteSeismic.intensity", design_basis_site.get("intensity")),
        ("metadata.siteSeismic.intensity", metadata_site.get("intensity")),
        ("model.site_seismic.intensity", payload_site.get("intensity")),
        ("designBasis.intensity", design_basis.get("intensity")),
        ("designRequirements.intensity", requirements.get("intensity")),
        ("GB18306.zonationRecord.intensity", as_record(zonation_record).get("intensity")),
        ("parameters.seismicZone", parameters.get("seismicZone")),
    ]
    intensity = optional_int(first_number(
        seismic_safety_evaluation.get("intensity") if safety_evaluation_active else None,
        site.get("intensity"),
        design_basis.get("intensity"),
        requirements.get("intensity"),
        as_record(zonation_record).get("intensity"),
        parameters.get("seismicZone"),
    ))
    if intensity is None:
        intensity = _intensity_from_acceleration(acceleration_g)
    if intensity is None:
        missing_inputs.append("designBasis.siteSeismic.intensityOrAccelerationG")
        intensity = 7
        if region:
            assumptions.append(
                f"Region {region} was provided, but no GB 18306 design basic acceleration or intensity was provided; "
                "assumed intensity 7 for preliminary analysis."
            )
        else:
            assumptions.append("No seismic intensity or design basic acceleration was provided; assumed intensity 7 for preliminary analysis.")

    design_group_candidates = [
        ("designBasis.seismicSafetyEvaluation.designGroup", first_string(seismic_safety_evaluation.get("designGroup"), seismic_safety_evaluation.get("design_group")) if safety_evaluation_active else None),
        ("seismicWorkflow.siteSeismic.designGroup", workflow_site.get("designGroup")),
        ("seismicWorkflow.siteSeismic.design_group", workflow_site.get("design_group")),
        ("designBasis.siteSeismic.designGroup", design_basis_site.get("designGroup")),
        ("designBasis.siteSeismic.design_group", design_basis_site.get("design_group")),
        ("metadata.siteSeismic.designGroup", metadata_site.get("designGroup")),
        ("metadata.siteSeismic.design_group", metadata_site.get("design_group")),
        ("model.site_seismic.designGroup", payload_site.get("designGroup")),
        ("model.site_seismic.design_group", payload_site.get("design_group")),
        ("designBasis.designGroup", design_basis.get("designGroup")),
        ("designBasis.design_group", design_basis.get("design_group")),
        ("GB18306.zonationRecord.designGroup", as_record(zonation_record).get("designGroup")),
        ("parameters.designGroup", parameters.get("designGroup")),
    ]
    design_group_source = first_string(
        first_string(seismic_safety_evaluation.get("designGroup"), seismic_safety_evaluation.get("design_group")) if safety_evaluation_active else None,
        site.get("designGroup"),
        site.get("design_group"),
        design_basis.get("designGroup"),
        design_basis.get("design_group"),
        as_record(zonation_record).get("designGroup"),
        parameters.get("designGroup"),
    )
    design_group = _normalize_group(design_group_source)
    if not design_group_source:
        missing_inputs.append("designBasis.siteSeismic.designGroup")
        assumptions.append("No design earthquake group was provided; assumed Group 1.")

    site_category_candidates = [
        ("seismicWorkflow.siteSeismic.siteCategory", workflow_site.get("siteCategory")),
        ("seismicWorkflow.siteSeismic.site_category", workflow_site.get("site_category")),
        ("seismicWorkflow.siteSeismic.siteClass", workflow_site.get("siteClass")),
        ("designBasis.siteSeismic.siteCategory", design_basis_site.get("siteCategory")),
        ("designBasis.siteSeismic.site_category", design_basis_site.get("site_category")),
        ("designBasis.siteSeismic.siteClass", design_basis_site.get("siteClass")),
        ("metadata.siteSeismic.siteCategory", metadata_site.get("siteCategory")),
        ("metadata.siteSeismic.site_category", metadata_site.get("site_category")),
        ("metadata.siteSeismic.siteClass", metadata_site.get("siteClass")),
        ("model.site_seismic.siteCategory", payload_site.get("siteCategory")),
        ("model.site_seismic.site_category", payload_site.get("site_category")),
        ("model.site_seismic.siteClass", payload_site.get("siteClass")),
        ("designBasis.siteCategory", design_basis.get("siteCategory")),
        ("designBasis.site_category", design_basis.get("site_category")),
        ("parameters.siteClass", parameters.get("siteClass")),
    ]
    site_category_input = first_string(
        site.get("siteCategory"),
        site.get("site_category"),
        site.get("siteClass"),
        design_basis.get("siteCategory"),
        design_basis.get("site_category"),
        parameters.get("siteClass"),
    )
    site_category = _normalize_site_category(site_category_input)
    if not site_category_input:
        missing_inputs.append("designBasis.siteSeismic.siteCategory")
        assumptions.append("No site category was provided; assumed Site Class II.")

    damping_ratio_candidates = [
        ("seismicWorkflow.analysisControl.dampingRatio", as_record(workflow.get("analysisControl")).get("dampingRatio")),
        ("seismicWorkflow.analysisControl.damping_ratio", as_record(workflow.get("analysisControl")).get("damping_ratio")),
        ("model.analysis_control.dampingRatio", as_record(payload.get("analysis_control")).get("dampingRatio")),
        ("model.analysis_control.damping_ratio", as_record(payload.get("analysis_control")).get("damping_ratio")),
        ("seismicWorkflow.siteSeismic.dampingRatio", workflow_site.get("dampingRatio")),
        ("seismicWorkflow.siteSeismic.damping_ratio", workflow_site.get("damping_ratio")),
        ("designBasis.siteSeismic.dampingRatio", design_basis_site.get("dampingRatio")),
        ("designBasis.siteSeismic.damping_ratio", design_basis_site.get("damping_ratio")),
        ("metadata.siteSeismic.dampingRatio", metadata_site.get("dampingRatio")),
        ("metadata.siteSeismic.damping_ratio", metadata_site.get("damping_ratio")),
        ("model.site_seismic.dampingRatio", payload_site.get("dampingRatio")),
        ("model.site_seismic.damping_ratio", payload_site.get("damping_ratio")),
        ("designBasis.dampingRatio", design_basis.get("dampingRatio")),
        ("designBasis.damping_ratio", design_basis.get("damping_ratio")),
        ("seismicWorkflow.dampingRatio", workflow.get("dampingRatio")),
        ("parameters.dampingRatio", parameters.get("dampingRatio")),
    ]
    damping_ratio = first_number(
        control.get("dampingRatio"),
        control.get("damping_ratio"),
        site.get("dampingRatio"),
        site.get("damping_ratio"),
        design_basis.get("dampingRatio"),
        design_basis.get("damping_ratio"),
        workflow.get("dampingRatio"),
        parameters.get("dampingRatio"),
    )
    if damping_ratio is None:
        missing_inputs.append("designBasis.dampingRatio")
        damping_ratio = 0.05
        assumptions.append("No damping ratio was provided; assumed 0.05.")

    earthquake_level_candidates = [
        ("seismicWorkflow.siteSeismic.earthquakeLevel", workflow_site.get("earthquakeLevel")),
        ("seismicWorkflow.siteSeismic.earthquake_level", workflow_site.get("earthquake_level")),
        ("designBasis.siteSeismic.earthquakeLevel", design_basis_site.get("earthquakeLevel")),
        ("designBasis.siteSeismic.earthquake_level", design_basis_site.get("earthquake_level")),
        ("metadata.siteSeismic.earthquakeLevel", metadata_site.get("earthquakeLevel")),
        ("metadata.siteSeismic.earthquake_level", metadata_site.get("earthquake_level")),
        ("model.site_seismic.earthquakeLevel", payload_site.get("earthquakeLevel")),
        ("model.site_seismic.earthquake_level", payload_site.get("earthquake_level")),
        ("designBasis.earthquakeLevel", design_basis.get("earthquakeLevel")),
        ("designBasis.earthquake_level", design_basis.get("earthquake_level")),
        ("designRequirements.earthquakeLevel", requirements.get("earthquakeLevel")),
        ("designRequirements.targetEarthquakeLevel", requirements.get("targetEarthquakeLevel")),
        ("seismicWorkflow.groundMotionRequirement.targetEarthquakeLevel", ground_motion_requirement.get("targetEarthquakeLevel")),
        ("seismicWorkflow.earthquakeLevel", workflow.get("earthquakeLevel")),
        ("seismicWorkflow.earthquake_level", workflow.get("earthquake_level")),
        ("parameters.earthquakeLevel", parameters.get("earthquakeLevel")),
    ]
    earthquake_level = _normalize_earthquake_level(first_string(
        site.get("earthquakeLevel"),
        site.get("earthquake_level"),
        design_basis.get("earthquakeLevel"),
        design_basis.get("earthquake_level"),
        requirements.get("earthquakeLevel"),
        requirements.get("targetEarthquakeLevel"),
        ground_motion_requirement.get("targetEarthquakeLevel"),
        workflow.get("earthquakeLevel"),
        workflow.get("earthquake_level"),
        parameters.get("earthquakeLevel"),
    ))

    alpha_max_candidates = [
        ("designBasis.seismicSafetyEvaluation.alphaMax", safety_evaluation_alpha_max),
        ("seismicWorkflow.siteSeismic.maxInfluenceCoefficient", workflow_site.get("maxInfluenceCoefficient")),
        ("seismicWorkflow.siteSeismic.max_influence_coefficient", workflow_site.get("max_influence_coefficient")),
        ("designBasis.siteSeismic.maxInfluenceCoefficient", design_basis_site.get("maxInfluenceCoefficient")),
        ("designBasis.siteSeismic.max_influence_coefficient", design_basis_site.get("max_influence_coefficient")),
        ("metadata.siteSeismic.maxInfluenceCoefficient", metadata_site.get("maxInfluenceCoefficient")),
        ("metadata.siteSeismic.max_influence_coefficient", metadata_site.get("max_influence_coefficient")),
        ("model.site_seismic.maxInfluenceCoefficient", payload_site.get("maxInfluenceCoefficient")),
        ("model.site_seismic.max_influence_coefficient", payload_site.get("max_influence_coefficient")),
        ("designBasis.maxInfluenceCoefficient", design_basis.get("maxInfluenceCoefficient")),
        ("designBasis.max_influence_coefficient", design_basis.get("max_influence_coefficient")),
        ("GB18306.zonationRecord.maxInfluenceCoefficient", as_record(zonation_record).get("maxInfluenceCoefficient")),
    ]
    explicit_alpha_max = first_number(
        safety_evaluation_alpha_max,
        site.get("maxInfluenceCoefficient"),
        site.get("max_influence_coefficient"),
        design_basis.get("maxInfluenceCoefficient"),
        design_basis.get("max_influence_coefficient"),
        as_record(zonation_record).get("maxInfluenceCoefficient"),
    )
    alpha_max = explicit_alpha_max
    if alpha_max is None:
        alpha_max = _alpha_from_acceleration(acceleration_g, earthquake_level)
    if alpha_max is None:
        if acceleration_g is None and intensity in {7, 8}:
            missing_inputs.append("designBasis.siteSeismic.accelerationG")
            alpha_max = CONSERVATIVE_ALPHA_MAX_BY_INTENSITY_AND_LEVEL[earthquake_level][intensity]
            assumptions.append(
                f"No design basic acceleration was provided for intensity {intensity}; "
                f"used conservative {earthquake_level} earthquake alphaMax={alpha_max} for preliminary analysis."
            )
        else:
            alpha_max = ALPHA_MAX_BY_INTENSITY_AND_LEVEL.get(earthquake_level, ALPHA_MAX_BY_INTENSITY).get(intensity, 0.08)
        if acceleration_g is not None:
            warnings.append(
                f"Acceleration {acceleration_g}g is not one of the standard GB/T 50011 table values; "
                f"used intensity {intensity} {earthquake_level} earthquake alphaMax={alpha_max}."
            )

    rare_characteristic_period_candidates = [
        ("designBasis.seismicSafetyEvaluation.rareCharacteristicPeriod", safety_evaluation_rare_characteristic_period),
        ("seismicWorkflow.siteSeismic.rareCharacteristicPeriod", workflow_site.get("rareCharacteristicPeriod")),
        ("seismicWorkflow.siteSeismic.rare_characteristic_period", workflow_site.get("rare_characteristic_period")),
        ("designBasis.siteSeismic.rareCharacteristicPeriod", design_basis_site.get("rareCharacteristicPeriod")),
        ("designBasis.siteSeismic.rare_characteristic_period", design_basis_site.get("rare_characteristic_period")),
        ("metadata.siteSeismic.rareCharacteristicPeriod", metadata_site.get("rareCharacteristicPeriod")),
        ("metadata.siteSeismic.rare_characteristic_period", metadata_site.get("rare_characteristic_period")),
        ("model.site_seismic.rareCharacteristicPeriod", payload_site.get("rareCharacteristicPeriod")),
        ("model.site_seismic.rare_characteristic_period", payload_site.get("rare_characteristic_period")),
        ("designBasis.rareCharacteristicPeriod", design_basis.get("rareCharacteristicPeriod")),
        ("designBasis.rare_characteristic_period", design_basis.get("rare_characteristic_period")),
        ("parameters.rareTg", parameters.get("rareTg")),
    ]
    explicit_rare_characteristic_period = first_number(
        safety_evaluation_rare_characteristic_period,
        site.get("rareCharacteristicPeriod"),
        site.get("rare_characteristic_period"),
        design_basis.get("rareCharacteristicPeriod"),
        design_basis.get("rare_characteristic_period"),
        parameters.get("rareTg"),
    )
    characteristic_period = explicit_rare_characteristic_period if earthquake_level == "rare" else None
    characteristic_period_candidates = [
        ("designBasis.seismicSafetyEvaluation.characteristicPeriod", safety_evaluation_characteristic_period),
        ("seismicWorkflow.siteSeismic.characteristicPeriod", workflow_site.get("characteristicPeriod")),
        ("seismicWorkflow.siteSeismic.characteristic_period", workflow_site.get("characteristic_period")),
        ("seismicWorkflow.siteSeismic.Tg", workflow_site.get("Tg")),
        ("designBasis.siteSeismic.characteristicPeriod", design_basis_site.get("characteristicPeriod")),
        ("designBasis.siteSeismic.characteristic_period", design_basis_site.get("characteristic_period")),
        ("designBasis.siteSeismic.Tg", design_basis_site.get("Tg")),
        ("metadata.siteSeismic.characteristicPeriod", metadata_site.get("characteristicPeriod")),
        ("metadata.siteSeismic.characteristic_period", metadata_site.get("characteristic_period")),
        ("metadata.siteSeismic.Tg", metadata_site.get("Tg")),
        ("model.site_seismic.characteristicPeriod", payload_site.get("characteristicPeriod")),
        ("model.site_seismic.characteristic_period", payload_site.get("characteristic_period")),
        ("model.site_seismic.Tg", payload_site.get("Tg")),
        ("designBasis.characteristicPeriod", design_basis.get("characteristicPeriod")),
        ("designBasis.characteristic_period", design_basis.get("characteristic_period")),
        ("GB18306.zonationRecord.characteristicPeriod", as_record(zonation_record).get("characteristicPeriod")),
        ("parameters.Tg", parameters.get("Tg")),
    ]
    if characteristic_period is None:
        characteristic_period = first_number(
            safety_evaluation_characteristic_period,
            site.get("characteristicPeriod"),
            site.get("characteristic_period"),
            site.get("Tg"),
            design_basis.get("characteristicPeriod"),
            design_basis.get("characteristic_period"),
            as_record(zonation_record).get("characteristicPeriod"),
            parameters.get("Tg"),
        )
    if characteristic_period is None:
        characteristic_period = TG_BY_GROUP_AND_SITE.get(design_group, TG_BY_GROUP_AND_SITE["1"]).get(site_category, 0.35)
    if earthquake_level == "rare" and explicit_rare_characteristic_period is None:
        characteristic_period = float(characteristic_period) + 0.05

    structure = as_record(workflow.get("structure"))
    structure_profile = as_record(workflow.get("structureProfile"))
    seismic_grade, seismic_grade_source = _structured_seismic_grade_with_source([
        ("designRequirements.seismicGrade", requirements.get("seismicGrade")),
        ("designRequirements.antiSeismicGrade", requirements.get("antiSeismicGrade")),
        ("designBasis.seismicGrade", design_basis.get("seismicGrade")),
        ("designBasis.antiSeismicGrade", design_basis.get("antiSeismicGrade")),
        ("structure.seismicGrade", structure.get("seismicGrade")),
        ("structureProfile.seismicGrade", structure_profile.get("seismicGrade")),
        ("seismicWorkflow.seismicGrade", workflow.get("seismicGrade")),
        ("metadata.seismicGrade", metadata.get("seismicGrade")),
    ])

    structural_family = str(first_string(
        metadata.get("structuralTypeKey"),
        metadata.get("inferredType"),
        as_record(payload.get("structure_system")).get("type"),
    ) or "generic")

    rounded_characteristic_period = round(float(characteristic_period), 4)
    rounded_alpha_max = round(float(alpha_max), 4)
    rounded_damping_ratio = round(float(damping_ratio), 4)
    region_source = _string_source(region_candidates) or (
        "GB18306.zonationRecord.region" if region and as_record(zonation_record).get("region") == region else None
    )
    intensity_source = _number_source(intensity_candidates, float(intensity))
    if intensity_source is None and acceleration_g is not None and _intensity_from_acceleration(acceleration_g) == intensity:
        intensity_source = "derived.intensityFromAccelerationG"
    if intensity_source is None and "designBasis.siteSeismic.intensityOrAccelerationG" in missing_inputs:
        intensity_source = "assumption.defaultIntensity7"
    acceleration_source = _number_source(acceleration_candidates, acceleration_g)
    design_group_trace_source = _string_source(design_group_candidates) or "assumption.defaultDesignGroup1"
    site_category_trace_source = _string_source(site_category_candidates) or "assumption.defaultSiteCategoryII"
    damping_ratio_trace_source = _number_source(damping_ratio_candidates, damping_ratio) or "assumption.defaultDampingRatio005"
    earthquake_level_source = _string_source(earthquake_level_candidates) or "assumption.defaultFrequentEarthquake"
    fortification_category_source = _string_source(fortification_category_candidates) or "assumption.defaultStandardFortificationCategory"
    explicit_alpha_source = _number_source(alpha_max_candidates, alpha_max)
    if explicit_alpha_source:
        alpha_max_source = explicit_alpha_source
        alpha_max_note = "explicit alphaMax/maxInfluenceCoefficient"
    elif acceleration_g is not None and _alpha_from_acceleration(acceleration_g, earthquake_level) is not None:
        alpha_max_source = "GB/T 50011-2010(2024).alphaMaxByAcceleration"
        alpha_max_note = f"derived from accelerationG={acceleration_g} and earthquakeLevel={earthquake_level}"
    elif "designBasis.siteSeismic.accelerationG" in missing_inputs:
        alpha_max_source = "assumption.conservativeAlphaMaxByIntensity"
        alpha_max_note = f"conservative table value from intensity={intensity} and earthquakeLevel={earthquake_level}"
    else:
        alpha_max_source = "GB/T 50011-2010(2024).alphaMaxByIntensity"
        alpha_max_note = f"table value from intensity={intensity} and earthquakeLevel={earthquake_level}"
    explicit_tg_source = (
        _number_source(rare_characteristic_period_candidates, explicit_rare_characteristic_period)
        if earthquake_level == "rare" and explicit_rare_characteristic_period is not None
        else _number_source(characteristic_period_candidates, characteristic_period)
    )
    if explicit_tg_source:
        characteristic_period_source = explicit_tg_source
        characteristic_period_note = "explicit characteristic period"
    else:
        characteristic_period_source = "GB/T 50011-2010(2024).TgByGroupAndSite"
        characteristic_period_note = f"table value from designGroup={design_group} and siteCategory={site_category}"
        if earthquake_level == "rare":
            characteristic_period_note += "; rare-earthquake characteristic period adjusted by +0.05s"
    height_value = round(_height_m(payload, model, workflow), 4)
    story_count_value = _story_count(payload, workflow)
    source_trace = [
        _trace_entry("region", region or "N/A", region_source or "missing"),
        _trace_entry(
            "fortificationCategory",
            fortification_category,
            fortification_category_source,
            note=str(fortification_metadata["labelZh"]),
            assumed=fortification_category_value is None,
        ),
        _trace_entry("intensity", intensity, intensity_source),
        _trace_entry(
            "accelerationG",
            acceleration_g if acceleration_g is not None else "N/A",
            acceleration_source or "missing",
            assumed=acceleration_g is None,
        ),
        _trace_entry("earthquakeLevel", earthquake_level, earthquake_level_source),
        _trace_entry("designGroup", design_group, design_group_trace_source, assumed=not design_group_source),
        _trace_entry("siteCategory", site_category, site_category_trace_source, assumed=site_category_input is None),
        _trace_entry("characteristicPeriod", rounded_characteristic_period, characteristic_period_source, note=characteristic_period_note),
        _trace_entry("alphaMax", rounded_alpha_max, alpha_max_source, note=alpha_max_note),
        _trace_entry("dampingRatio", rounded_damping_ratio, damping_ratio_trace_source, assumed="designBasis.dampingRatio" in missing_inputs),
        _trace_entry(
            "seismicMeasureIntensity",
            _seismic_measure_intensity(fortification_category, intensity),
            "GB 55002-2021 + GB 50223-2008.fortificationCategory",
            note=f"derived from fortificationCategory={fortification_category} and intensity={intensity}",
        ),
        _trace_entry(
            "seismicSafetyEvaluation",
            "provided" if seismic_safety_evaluation_provided else "not_provided",
            "designBasis.seismicSafetyEvaluation" if seismic_safety_evaluation else "missing",
            note="required for special fortification category" if fortification_category == "special" else "not required for this fortification category",
            assumed=fortification_category == "special" and not seismic_safety_evaluation_provided,
        ),
        _trace_entry(
            "seismicGrade",
            seismic_grade if seismic_grade is not None else "N/A",
            seismic_grade_source or "missing",
            assumed=seismic_grade is None,
        ),
        _trace_entry("heightM", height_value, "seismicWorkflow.structure.heightM or model.geometry"),
        _trace_entry("storyCount", story_count_value, "seismicWorkflow.structure.storyCount or model.stories/nodes"),
        _trace_entry("structuralFamily", structural_family, "metadata.structuralTypeKey/inferredType or model.structure_system.type"),
    ]

    return SeismicDesignBasis(
        code_basis=LATEST_CODE_BASIS,
        region=region,
        intensity=intensity,
        acceleration_g=acceleration_g,
        design_group=design_group,
        site_category=site_category,
        earthquake_level=earthquake_level,
        characteristic_period=rounded_characteristic_period,
        alpha_max=rounded_alpha_max,
        damping_ratio=rounded_damping_ratio,
        fortification_category=fortification_category,
        fortification_category_label={
            "zh": str(fortification_metadata["labelZh"]),
            "en": str(fortification_metadata["labelEn"]),
        },
        fortification_category_code_class=str(fortification_metadata["codeClass"]),
        seismic_action_standard=str(fortification_metadata["actionStandard"]),
        seismic_measure_standard=str(fortification_metadata["measureStandard"]),
        seismic_measure_intensity=_seismic_measure_intensity(fortification_category, intensity),
        seismic_safety_evaluation_required=bool(fortification_metadata["requiresSeismicSafetyEvaluation"]),
        seismic_safety_evaluation_provided=seismic_safety_evaluation_provided,
        seismic_grade=seismic_grade,
        seismic_grade_source=seismic_grade_source,
        height_m=height_value,
        story_count=story_count_value,
        structural_family=structural_family,
        zonation_record=zonation_record,
        missing_inputs=list(dict.fromkeys(missing_inputs)),
        warnings=warnings,
        assumptions=assumptions,
        source_trace=source_trace,
    )
