from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple

from seismic_contracts import as_record, optional_number


SEVERITY_ORDER = {
    "regular": 0,
    "unknown": 0,
    "irregular": 1,
    "particularly_irregular": 2,
}
G_ACCEL = 9.80665


@dataclass
class RegularityAssessment:
    classification: str
    source: str
    checks: List[Dict[str, Any]] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    assumptions: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "classification": self.classification,
            "source": self.source,
            "checks": self.checks,
            "warnings": self.warnings,
            "assumptions": self.assumptions,
        }


def _model_payload(model: Any) -> Dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump(mode="python")
    return model if isinstance(model, dict) else {}


def _severity_max(left: str, right: str) -> str:
    return left if SEVERITY_ORDER.get(left, 0) >= SEVERITY_ORDER.get(right, 0) else right


def _classification_from_explicit(value: Any) -> Optional[str]:
    text = str(value or "").strip().lower()
    if not text:
        return None
    if text in {"regular", "规则", "regularity_regular"}:
        return "regular"
    if text in {"irregular", "不规则", "general_irregular", "一般不规则"}:
        return "irregular"
    if text in {"particularly_irregular", "special_irregular", "severe", "serious", "特别不规则", "严重不规则"}:
        return "particularly_irregular"
    return None


def _is_true(value: Any) -> bool:
    return value is True or (isinstance(value, str) and value.strip().lower() in {"true", "yes", "1"})


def _stories(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    raw = payload.get("stories")
    return [item for item in raw if isinstance(item, dict)] if isinstance(raw, list) else []


def _story_height_checks(stories: Sequence[Dict[str, Any]]) -> Tuple[str, List[Dict[str, Any]], List[str]]:
    heights = [optional_number(story.get("height")) for story in stories]
    values = [height for height in heights if height is not None and height > 0.0]
    if len(values) < 2:
        return "unknown", [], ["Story-height regularity was not assessed because fewer than two story heights are available."]

    sorted_values = sorted(values)
    median = sorted_values[len(sorted_values) // 2]
    max_to_median = max(values) / median if median > 0.0 else 1.0
    adjacent_ratios = [
        max(values[index], values[index + 1]) / max(min(values[index], values[index + 1]), 1e-9)
        for index in range(len(values) - 1)
    ]
    max_adjacent = max(adjacent_ratios, default=1.0)
    ratio = max(max_to_median, max_adjacent)
    if ratio > 1.50:
        severity = "particularly_irregular"
    elif ratio > 1.20:
        severity = "irregular"
    else:
        severity = "regular"
    return severity, [{
        "name": "story_height_variation",
        "severity": severity,
        "value": round(ratio, 4),
        "irregularThreshold": 1.20,
        "particularlyIrregularThreshold": 1.50,
        "basis": "model.stories[].height heuristic",
    }], []


def _story_load_value(story: Dict[str, Any]) -> Optional[float]:
    dead = optional_number(story.get("dead_load"))
    live = optional_number(story.get("live_load"))
    if dead is not None or live is not None:
        return float(dead or 0.0) + 0.5 * float(live or 0.0)
    floor_loads = story.get("floor_loads")
    if not isinstance(floor_loads, list):
        return None
    total = 0.0
    found = False
    for load in floor_loads:
        if not isinstance(load, dict):
            continue
        value = optional_number(load.get("value"))
        if value is None:
            continue
        load_type = str(load.get("type") or "other").strip().lower()
        factor = 0.5 if load_type == "live" else 1.0
        total += factor * value
        found = True
    return total if found else None


def _story_load_checks(stories: Sequence[Dict[str, Any]]) -> Tuple[str, List[Dict[str, Any]], List[str]]:
    values = [_story_load_value(story) for story in stories]
    loads = [value for value in values if value is not None and value > 0.0]
    if len(loads) < 2:
        return "unknown", [], ["Story mass/load regularity was not assessed because floor load data is insufficient."]

    adjacent_ratios = [
        max(loads[index], loads[index + 1]) / max(min(loads[index], loads[index + 1]), 1e-9)
        for index in range(len(loads) - 1)
    ]
    ratio = max(adjacent_ratios, default=1.0)
    if ratio > 2.00:
        severity = "particularly_irregular"
    elif ratio > 1.50:
        severity = "irregular"
    else:
        severity = "regular"
    return severity, [{
        "name": "story_load_variation",
        "severity": severity,
        "value": round(ratio, 4),
        "irregularThreshold": 1.50,
        "particularlyIrregularThreshold": 2.00,
        "basis": "model.stories floor loads heuristic using dead + 0.5 live",
    }], []


def _explicit_story_weight(story: Dict[str, Any]) -> Tuple[Optional[float], Optional[str]]:
    extra = as_record(story.get("extra"))
    for key in ("seismicWeightKN", "representativeWeightKN", "gravityWeightKN", "weightKN"):
        value = optional_number(extra.get(key))
        if value is not None and value > 0.0:
            return value, f"stories[].extra.{key}"

    for key in ("massT", "massTon", "massTonne"):
        mass_t = optional_number(extra.get(key))
        if mass_t is not None and mass_t > 0.0:
            return mass_t * G_ACCEL, f"stories[].extra.{key}"

    mass_kg = optional_number(extra.get("massKg"))
    if mass_kg is not None and mass_kg > 0.0:
        return mass_kg / 1000.0 * G_ACCEL, "stories[].extra.massKg"

    return None, None


def _story_nodes(story: Dict[str, Any], by_story: Dict[str, List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    story_id = str(story.get("id") or "").strip()
    if story_id and story_id in by_story:
        return by_story[story_id]

    keys: List[str] = []
    elevation = optional_number(story.get("elevation"))
    height = optional_number(story.get("height"))
    if elevation is not None and height is not None:
        keys.append(f"z={round(elevation + height, 4)}")
    if elevation is not None:
        keys.append(f"z={round(elevation, 4)}")
    for key in keys:
        if key in by_story:
            return by_story[key]
    return []


def _story_plan_area(story: Dict[str, Any], nodes: Sequence[Dict[str, Any]]) -> Tuple[Optional[float], Optional[str]]:
    extra = as_record(story.get("extra"))
    for key in ("planAreaM2", "floorAreaM2", "tributaryAreaM2"):
        area = optional_number(extra.get(key))
        if area is not None and area > 0.0:
            return area, f"stories[].extra.{key}"

    area = _bbox_area(nodes)
    if area is not None and area > 0.0:
        return area, "story node bounding-box area"
    return None, None


def _story_mass_checks(payload: Dict[str, Any]) -> Tuple[str, List[Dict[str, Any]], List[str]]:
    stories = _stories(payload)
    if len(stories) < 2:
        return "unknown", [], ["Story-mass regularity was not assessed because fewer than two stories are available."]

    by_story = _story_nodes_by_key(payload)
    weights: List[Dict[str, Any]] = []
    missing = 0
    for story in stories:
        story_id = str(story.get("id") or f"F{len(weights) + missing + 1}").strip()
        explicit_weight, explicit_source = _explicit_story_weight(story)
        if explicit_weight is not None:
            weights.append({
                "story": story_id,
                "weightKN": explicit_weight,
                "source": explicit_source,
            })
            continue

        load = _story_load_value(story)
        nodes = _story_nodes(story, by_story)
        area, area_source = _story_plan_area(story, nodes)
        if load is None or load <= 0.0 or area is None or area <= 0.0:
            missing += 1
            continue
        weights.append({
            "story": story_id,
            "weightKN": load * area,
            "source": f"floor load * {area_source}",
            "planAreaM2": area,
        })

    assumptions: List[str] = []
    if missing:
        assumptions.append("Story-mass regularity skipped stories without explicit weight/mass or enough floor-load and plan-area data.")
    if len(weights) < 2:
        assumptions.append("Story-mass regularity was not assessed because fewer than two structured story weights could be inferred.")
        return "unknown", [], assumptions

    weight_values = [float(item["weightKN"]) for item in weights]
    adjacent_ratios = [
        max(weight_values[index], weight_values[index + 1]) / max(min(weight_values[index], weight_values[index + 1]), 1e-9)
        for index in range(len(weight_values) - 1)
    ]
    ratio = max(adjacent_ratios, default=1.0)
    if ratio > 2.00:
        severity = "particularly_irregular"
    elif ratio > 1.50:
        severity = "irregular"
    else:
        severity = "regular"
    return severity, [{
        "name": "story_mass_variation",
        "severity": severity,
        "value": round(ratio, 4),
        "irregularThreshold": 1.50,
        "particularlyIrregularThreshold": 2.00,
        "storyWeights": [
            {
                **item,
                "weightKN": round(float(item["weightKN"]), 6),
                **({"planAreaM2": round(float(item["planAreaM2"]), 6)} if "planAreaM2" in item else {}),
            }
            for item in weights
        ],
        "basis": "structured story weight/mass or floor load multiplied by story plan area heuristic",
    }], assumptions


def _slab_opening_area(opening: Dict[str, Any]) -> Optional[float]:
    width = optional_number(opening.get("width"))
    depth = optional_number(opening.get("depth"))
    if width is None or depth is None or width <= 0.0 or depth <= 0.0:
        return None
    shape = str(opening.get("shape") or "rectangular").strip().lower()
    if shape == "circular":
        return math.pi * (width / 2.0) * (depth / 2.0)
    return width * depth


def _story_opening_records(story: Dict[str, Any]) -> List[Dict[str, Any]]:
    extra = as_record(story.get("extra"))
    records: List[Dict[str, Any]] = []
    for source in (story, extra):
        for key in ("slab_openings", "slabOpenings", "floorOpenings", "diaphragmOpenings", "openings"):
            raw = source.get(key)
            if isinstance(raw, list):
                records.extend(item for item in raw if isinstance(item, dict))
    return records


def _story_opening_area(story: Dict[str, Any]) -> Tuple[Optional[float], Optional[str]]:
    extra = as_record(story.get("extra"))
    for source_name, source in (("stories[]", story), ("stories[].extra", extra)):
        for key in ("slabOpeningAreaM2", "openingAreaM2", "floorOpeningAreaM2", "diaphragmOpeningAreaM2"):
            value = optional_number(source.get(key))
            if value is not None and value >= 0.0:
                return value, f"{source_name}.{key}"
    return None, None


def _story_opening_ratio(story: Dict[str, Any]) -> Tuple[Optional[float], Optional[str]]:
    extra = as_record(story.get("extra"))
    for source_name, source in (("stories[]", story), ("stories[].extra", extra)):
        for key in ("slabOpeningRatio", "openingRatio", "floorOpeningRatio", "diaphragmOpeningRatio"):
            value = optional_number(source.get(key))
            if value is not None and value >= 0.0:
                return value, f"{source_name}.{key}"
    return None, None


def _floor_diaphragm_discontinuity_checks(payload: Dict[str, Any]) -> Tuple[str, List[Dict[str, Any]], List[str]]:
    stories = _stories(payload)
    raw_openings = payload.get("slab_openings")
    openings = [item for item in raw_openings if isinstance(item, dict)] if isinstance(raw_openings, list) else []
    if not stories and not openings:
        return "unknown", [], ["Floor-diaphragm discontinuity was not assessed because story and slab-opening data are unavailable."]

    openings_by_story: Dict[str, List[Dict[str, Any]]] = {}
    for opening in openings:
        story_id = str(opening.get("story_id") or opening.get("storyId") or "").strip()
        if story_id:
            openings_by_story.setdefault(story_id, []).append(opening)

    by_story_nodes = _story_nodes_by_key(payload)
    story_results: List[Dict[str, Any]] = []
    missing_area = 0
    for story in stories:
        story_id = str(story.get("id") or "").strip()
        if not story_id:
            continue
        story_openings = openings_by_story.get(story_id, []) + _story_opening_records(story)
        record_opening_area = sum(
            area
            for area in (_slab_opening_area(opening) for opening in story_openings)
            if area is not None and area > 0.0
        )
        direct_opening_area, direct_area_source = _story_opening_area(story)
        opening_area = record_opening_area + float(direct_opening_area or 0.0)
        direct_opening_ratio, direct_ratio_source = _story_opening_ratio(story)
        nodes = _story_nodes(story, by_story_nodes)
        plan_area, area_source = _story_plan_area(story, nodes)
        rigid_diaphragm = story.get("rigid_diaphragm")
        if opening_area <= 0.0 and direct_opening_ratio is None and rigid_diaphragm is not False:
            continue
        if direct_opening_ratio is None and (plan_area is None or plan_area <= 0.0):
            missing_area += 1
            continue
        opening_ratio = (
            float(direct_opening_ratio)
            if direct_opening_ratio is not None
            else opening_area / float(plan_area or 1.0)
        )
        rigid_value = rigid_diaphragm if isinstance(rigid_diaphragm, bool) else None
        story_results.append({
            "story": story_id,
            "openingAreaM2": round(opening_area, 6),
            **({"openingAreaSource": direct_area_source} if direct_area_source else {}),
            **({"openingRatioSource": direct_ratio_source} if direct_ratio_source else {}),
            **({"planAreaM2": round(float(plan_area), 6)} if plan_area is not None and plan_area > 0.0 else {}),
            "openingRatio": round(opening_ratio, 4),
            "openingCount": len(story_openings),
            "rigidDiaphragm": rigid_value,
            "planAreaSource": area_source,
        })

    assumptions: List[str] = []
    if missing_area:
        assumptions.append("Floor-diaphragm discontinuity skipped stories with openings or non-rigid diaphragm flags but no plan area.")
    if not story_results:
        if openings:
            assumptions.append("Floor-diaphragm discontinuity was not assessed because slab openings could not be matched to story plan areas.")
        return "unknown", [], assumptions

    max_opening_ratio = max(float(item["openingRatio"]) for item in story_results)
    has_non_rigid = any(item["rigidDiaphragm"] is False for item in story_results)
    if max_opening_ratio > 0.50:
        severity = "particularly_irregular"
    elif max_opening_ratio > 0.30 or has_non_rigid:
        severity = "irregular"
    else:
        severity = "regular"
    return severity, [{
        "name": "floor_diaphragm_discontinuity",
        "severity": severity,
        "value": round(max_opening_ratio, 4),
        "irregularThreshold": 0.30,
        "particularlyIrregularThreshold": 0.50,
        "storyDiaphragms": story_results,
        "basis": "structured slab opening area/ratio divided by story plan area plus rigid_diaphragm flag heuristic",
    }], assumptions


def _records_by_id(payload: Dict[str, Any], key: str) -> Dict[str, Dict[str, Any]]:
    raw = payload.get(key)
    records = [item for item in raw if isinstance(item, dict)] if isinstance(raw, list) else []
    return {
        str(item.get("id")).strip(): item
        for item in records
        if str(item.get("id") or "").strip()
    }


def _section_inertia(section: Dict[str, Any]) -> Optional[float]:
    properties = as_record(section.get("properties"))
    values: List[float] = []
    for source in (properties, section):
        for key in ("I", "Ix", "Iy", "Iz"):
            value = optional_number(source.get(key))
            if value is not None and value > 0.0:
                values.append(value)
    if values:
        return max(values)

    shape = as_record(section.get("shape"))
    width_mm = optional_number(section.get("width")) or optional_number(shape.get("B"))
    height_mm = optional_number(section.get("height")) or optional_number(shape.get("H"))
    if width_mm is None or height_mm is None or width_mm <= 0.0 or height_mm <= 0.0:
        return None
    width_m = width_mm / 1000.0
    height_m = height_mm / 1000.0
    return max(width_m * height_m ** 3 / 12.0, height_m * width_m ** 3 / 12.0)


def _material_elastic_modulus(material: Dict[str, Any]) -> Optional[float]:
    value = optional_number(material.get("E")) or optional_number(material.get("elasticModulus"))
    if value is not None and value > 0.0:
        return value
    extra = as_record(material.get("extra"))
    value = optional_number(extra.get("E")) or optional_number(extra.get("elasticModulus"))
    return value if value is not None and value > 0.0 else None


def _structured_story_lateral_stiffness_value(story: Dict[str, Any]) -> Tuple[Optional[float], Optional[str]]:
    extra = as_record(story.get("extra"))
    scalar_keys = (
        "lateralStiffnessKNPerM",
        "storyLateralStiffnessKNPerM",
        "storyStiffnessKNPerM",
        "lateralStiffness",
        "storyLateralStiffness",
        "storyStiffness",
        "lateralStiffnessK",
        "storyStiffnessK",
    )
    for source_name, source in (("stories[]", story), ("stories[].extra", extra)):
        for key in scalar_keys:
            value = optional_number(source.get(key))
            if value is not None and value > 0.0:
                return value, f"{source_name}.{key}"

    nested_keys = (
        "lateralStiffness",
        "storyLateralStiffness",
        "storyStiffness",
        "stiffness",
        "directionalLateralStiffness",
    )
    component_keys = (
        "x",
        "y",
        "kx",
        "ky",
        "Kx",
        "Ky",
        "xKNPerM",
        "yKNPerM",
        "KxKNPerM",
        "KyKNPerM",
        "stiffnessXKNPerM",
        "stiffnessYKNPerM",
    )
    for source_name, source in (("stories[]", story), ("stories[].extra", extra)):
        for key in nested_keys:
            nested = as_record(source.get(key))
            values = [
                value
                for value in (optional_number(nested.get(component_key)) for component_key in component_keys)
                if value is not None and value > 0.0
            ]
            if values:
                return min(values), f"{source_name}.{key}"
    return None, None


def _structured_story_lateral_stiffness_checks(stories: Sequence[Dict[str, Any]]) -> Tuple[str, List[Dict[str, Any]], List[str]]:
    stiffnesses: List[Dict[str, Any]] = []
    missing = 0
    for story in stories:
        story_id = str(story.get("id") or f"F{len(stiffnesses) + missing + 1}").strip()
        stiffness, source = _structured_story_lateral_stiffness_value(story)
        if stiffness is None:
            missing += 1
            continue
        stiffnesses.append({
            "story": story_id,
            "stiffnessKNPerM": stiffness,
            "source": source,
        })

    assumptions: List[str] = []
    if missing:
        assumptions.append("Structured story lateral-stiffness regularity skipped stories without structured stiffness data.")
    if len(stiffnesses) < 2:
        assumptions.append("Structured story lateral-stiffness regularity was not assessed because fewer than two structured story stiffnesses are available.")
        return "unknown", [], assumptions

    values = [float(item["stiffnessKNPerM"]) for item in stiffnesses]
    adjacent_ratios = [
        min(values[index], values[index + 1]) / max(values[index], values[index + 1])
        for index in range(len(values) - 1)
    ]
    min_ratio = min(adjacent_ratios, default=1.0)
    if min_ratio < 0.50:
        severity = "particularly_irregular"
    elif min_ratio < 0.70:
        severity = "irregular"
    else:
        severity = "regular"
    max_stiffness = max(values)
    return severity, [{
        "name": "structured_story_lateral_stiffness_variation",
        "severity": severity,
        "value": round(min_ratio, 4),
        "irregularThreshold": 0.70,
        "particularlyIrregularThreshold": 0.50,
        "storyStiffness": [
            {
                **item,
                "stiffnessKNPerM": round(float(item["stiffnessKNPerM"]), 6),
                "relativeStiffness": round(float(item["stiffnessKNPerM"]) / max(max_stiffness, 1e-9), 4),
            }
            for item in stiffnesses
        ],
        "basis": "structured story lateral stiffness adjacent-story ratio heuristic",
    }], assumptions


def _story_lateral_stiffness_checks(payload: Dict[str, Any]) -> Tuple[str, List[Dict[str, Any]], List[str]]:
    nodes = _records_by_id(payload, "nodes")
    sections = _records_by_id(payload, "sections")
    materials = _records_by_id(payload, "materials")
    raw_elements = payload.get("elements")
    elements = [item for item in raw_elements if isinstance(item, dict)] if isinstance(raw_elements, list) else []

    story_stiffness: Dict[str, float] = {}
    story_elevation: Dict[str, float] = {}
    missing_properties = 0
    for element in elements:
        if str(element.get("type") or "").strip().lower() != "column":
            continue
        element_nodes = element.get("nodes")
        if not isinstance(element_nodes, list) or len(element_nodes) < 2:
            continue
        i_node = nodes.get(str(element_nodes[0]))
        j_node = nodes.get(str(element_nodes[1]))
        if not i_node or not j_node:
            continue
        z_i = _node_value(i_node, "z")
        z_j = _node_value(j_node, "z")
        if z_i is None or z_j is None:
            continue
        height = abs(z_j - z_i)
        if height <= 0.0:
            continue

        upper_node = j_node if z_j >= z_i else i_node
        upper_z = max(z_i, z_j)
        story_key = (
            str(element.get("story")).strip()
            if str(element.get("story") or "").strip()
            else _node_story_key(upper_node)
        )
        if not story_key:
            story_key = f"z={round(upper_z, 4)}"

        section = sections.get(str(element.get("section")))
        inertia = _section_inertia(section) if section else None
        material = materials.get(str(element.get("material")))
        elastic_modulus = _material_elastic_modulus(material) if material else None
        if inertia is None:
            missing_properties += 1
            continue
        story_stiffness[story_key] = story_stiffness.get(story_key, 0.0) + 12.0 * float(elastic_modulus or 1.0) * inertia / height ** 3
        story_elevation[story_key] = upper_z

    ordered = [
        (story, stiffness)
        for story, stiffness in sorted(story_stiffness.items(), key=lambda item: story_elevation.get(item[0], 0.0))
        if stiffness > 0.0
    ]
    assumptions: List[str] = []
    if missing_properties:
        assumptions.append("Story lateral stiffness check skipped column elements with missing section inertia.")
    if len(ordered) < 2:
        assumptions.append("Story lateral stiffness regularity was not assessed because fewer than two column-supported stories are available.")
        return "unknown", [], assumptions

    adjacent_ratios = [
        min(ordered[index][1], ordered[index + 1][1]) / max(ordered[index][1], ordered[index + 1][1])
        for index in range(len(ordered) - 1)
    ]
    min_ratio = min(adjacent_ratios, default=1.0)
    if min_ratio < 0.50:
        severity = "particularly_irregular"
    elif min_ratio < 0.70:
        severity = "irregular"
    else:
        severity = "regular"
    max_stiffness = max(stiffness for _, stiffness in ordered)
    return severity, [{
        "name": "story_lateral_stiffness_variation",
        "severity": severity,
        "value": round(min_ratio, 4),
        "irregularThreshold": 0.70,
        "particularlyIrregularThreshold": 0.50,
        "storyStiffness": [
            {"story": story, "relativeStiffness": round(stiffness / max_stiffness, 4)}
            for story, stiffness in ordered
        ],
        "basis": "sum(12*E*I/h^3) over structured column elements",
    }], assumptions


def _story_lateral_strength_value(story: Dict[str, Any]) -> Tuple[Optional[float], Optional[str]]:
    extra = as_record(story.get("extra"))
    scalar_keys = (
        "lateralStrengthKN",
        "storyLateralStrengthKN",
        "storyShearCapacityKN",
        "storyLateralCapacityKN",
        "seismicShearCapacityKN",
        "shearCapacityKN",
        "ultimateStoryShearKN",
    )
    for source_name, source in (("stories[]", story), ("stories[].extra", extra)):
        for key in scalar_keys:
            value = optional_number(source.get(key))
            if value is not None and value > 0.0:
                return value, f"{source_name}.{key}"

    nested_keys = (
        "lateralStrength",
        "storyLateralStrength",
        "storyShearCapacity",
        "storyLateralCapacity",
        "seismicShearCapacity",
    )
    component_keys = (
        "x",
        "y",
        "vx",
        "vy",
        "Vx",
        "Vy",
        "xKN",
        "yKN",
        "VxKN",
        "VyKN",
        "capacityXKN",
        "capacityYKN",
    )
    for source_name, source in (("stories[]", story), ("stories[].extra", extra)):
        for key in nested_keys:
            nested = as_record(source.get(key))
            values = [
                value
                for value in (optional_number(nested.get(component_key)) for component_key in component_keys)
                if value is not None and value > 0.0
            ]
            if values:
                return min(values), f"{source_name}.{key}"
    return None, None


def _story_lateral_strength_checks(stories: Sequence[Dict[str, Any]]) -> Tuple[str, List[Dict[str, Any]], List[str]]:
    strengths: List[Dict[str, Any]] = []
    missing = 0
    for story in stories:
        story_id = str(story.get("id") or f"F{len(strengths) + missing + 1}").strip()
        strength, source = _story_lateral_strength_value(story)
        if strength is None:
            missing += 1
            continue
        strengths.append({
            "story": story_id,
            "strengthKN": strength,
            "source": source,
        })

    assumptions: List[str] = []
    if missing:
        assumptions.append("Story lateral-strength regularity skipped stories without structured story strength/capacity data.")
    if len(strengths) < 2:
        assumptions.append("Story lateral-strength regularity was not assessed because fewer than two structured story strengths are available.")
        return "unknown", [], assumptions

    values = [float(item["strengthKN"]) for item in strengths]
    adjacent_ratios = [
        min(values[index], values[index + 1]) / max(values[index], values[index + 1])
        for index in range(len(values) - 1)
    ]
    min_ratio = min(adjacent_ratios, default=1.0)
    if min_ratio < 0.65:
        severity = "particularly_irregular"
    elif min_ratio < 0.80:
        severity = "irregular"
    else:
        severity = "regular"
    max_strength = max(values)
    return severity, [{
        "name": "story_lateral_strength_variation",
        "severity": severity,
        "value": round(min_ratio, 4),
        "irregularThreshold": 0.80,
        "particularlyIrregularThreshold": 0.65,
        "storyStrengths": [
            {
                **item,
                "strengthKN": round(float(item["strengthKN"]), 6),
                "relativeStrength": round(float(item["strengthKN"]) / max(max_strength, 1e-9), 4),
            }
            for item in strengths
        ],
        "basis": "structured story lateral strength/capacity adjacent-story ratio heuristic",
    }], assumptions


def _node_value(node: Dict[str, Any], key: str) -> Optional[float]:
    return optional_number(node.get(key))


def _node_story_key(node: Dict[str, Any]) -> Optional[str]:
    if isinstance(node.get("story"), str) and str(node.get("story")).strip():
        return str(node.get("story")).strip()
    z = _node_value(node, "z")
    if z is not None and z > 0.0:
        return f"z={round(z, 4)}"
    return None


def _bbox_area(nodes: Sequence[Dict[str, Any]]) -> Optional[float]:
    xs = [_node_value(node, "x") for node in nodes]
    ys = [_node_value(node, "y") for node in nodes]
    x_values = [value for value in xs if value is not None]
    y_values = [value for value in ys if value is not None]
    if len(x_values) < 2 or len(y_values) < 2:
        return None
    width = max(x_values) - min(x_values)
    depth = max(y_values) - min(y_values)
    if width <= 0.0 or depth <= 0.0:
        return None
    return width * depth


def _plan_setback_checks(payload: Dict[str, Any]) -> Tuple[str, List[Dict[str, Any]], List[str]]:
    raw_nodes = payload.get("nodes")
    nodes = [node for node in raw_nodes if isinstance(node, dict)] if isinstance(raw_nodes, list) else []
    by_story: Dict[str, List[Dict[str, Any]]] = {}
    for node in nodes:
        key = _node_story_key(node)
        if key:
            by_story.setdefault(key, []).append(node)

    areas = [area for area in (_bbox_area(items) for items in by_story.values()) if area is not None and area > 0.0]
    if len(areas) < 2:
        return "unknown", [], ["Plan setback regularity was not assessed because story-level plan extents are unavailable."]

    min_ratio = min(min(areas[index], areas[index + 1]) / max(areas[index], areas[index + 1]) for index in range(len(areas) - 1))
    if min_ratio < 0.50:
        severity = "particularly_irregular"
    elif min_ratio < 0.75:
        severity = "irregular"
    else:
        severity = "regular"
    return severity, [{
        "name": "plan_setback_variation",
        "severity": severity,
        "value": round(min_ratio, 4),
        "irregularThreshold": 0.75,
        "particularlyIrregularThreshold": 0.50,
        "basis": "story-level node bounding-box area heuristic",
    }], []


def _plan_aspect_check(payload: Dict[str, Any]) -> Tuple[str, List[Dict[str, Any]], List[str]]:
    raw_nodes = payload.get("nodes")
    nodes = [node for node in raw_nodes if isinstance(node, dict)] if isinstance(raw_nodes, list) else []
    xs = [_node_value(node, "x") for node in nodes]
    ys = [_node_value(node, "y") for node in nodes]
    x_values = [value for value in xs if value is not None]
    y_values = [value for value in ys if value is not None]
    if len(x_values) < 2 or len(y_values) < 2:
        return "unknown", [], ["Plan aspect regularity was not assessed because node coordinates are insufficient."]
    width = max(x_values) - min(x_values)
    depth = max(y_values) - min(y_values)
    if width <= 0.0 or depth <= 0.0:
        return "unknown", [], ["Plan aspect regularity was not assessed because the plan extent is degenerate."]
    aspect = max(width, depth) / max(min(width, depth), 1e-9)
    severity = "irregular" if aspect > 6.0 else "regular"
    return severity, [{
        "name": "plan_aspect_ratio",
        "severity": severity,
        "value": round(aspect, 4),
        "irregularThreshold": 6.0,
        "basis": "overall node bounding-box aspect heuristic",
    }], []


def _structured_plan_irregularity_candidates(source: Dict[str, Any], source_name: str) -> Tuple[List[Dict[str, Any]], bool]:
    irregular_keys = (
        "hasPlanIrregularity",
        "planIrregularity",
        "hasReentrantCorner",
        "reentrantCorner",
        "hasReentrantCornerPlan",
        "hasConcavePlan",
        "concavePlan",
        "hasPlanConcavity",
        "planConcavity",
    )
    severe_keys = (
        "hasSeverePlanIrregularity",
        "severePlanIrregularity",
        "hasParticularlyIrregularPlan",
        "particularlyIrregularPlan",
        "planParticularlyIrregular",
        "planSevereIrregularity",
    )
    ratio_keys = (
        "reentrantCornerRatio",
        "planReentrantCornerRatio",
        "planConcavityRatio",
        "concavityRatio",
        "planIndentationRatio",
        "indentationRatio",
    )
    candidates: List[Dict[str, Any]] = []
    explicit_regular = False
    for key in severe_keys:
        if key not in source:
            continue
        if _is_true(source.get(key)):
            candidates.append({
                "source": f"{source_name}.{key}",
                "severity": "particularly_irregular",
                "value": True,
            })
        elif source.get(key) is False:
            explicit_regular = True

    for key in irregular_keys:
        if key not in source:
            continue
        if _is_true(source.get(key)):
            candidates.append({
                "source": f"{source_name}.{key}",
                "severity": "irregular",
                "value": True,
            })
        elif source.get(key) is False:
            explicit_regular = True

    for key in ratio_keys:
        value = optional_number(source.get(key))
        if value is None or value < 0.0:
            continue
        severity = "particularly_irregular" if value > 0.40 else "irregular" if value > 0.30 else "regular"
        candidates.append({
            "source": f"{source_name}.{key}",
            "severity": severity,
            "value": round(value, 6),
        })
    return candidates, explicit_regular


def _structured_plan_irregularity_checks(payload: Dict[str, Any], workflow: Dict[str, Any]) -> Tuple[str, List[Dict[str, Any]], List[str]]:
    sources = (
        ("seismicWorkflow.designRequirements", as_record(workflow.get("designRequirements"))),
        ("seismicWorkflow.structure", as_record(workflow.get("structure"))),
        ("seismicWorkflow.structureProfile", as_record(workflow.get("structureProfile"))),
        ("seismicWorkflow.regularityAssessment", as_record(workflow.get("regularityAssessment"))),
        ("model.metadata", as_record(payload.get("metadata"))),
        ("model.metadata.regularityAssessment", as_record(as_record(payload.get("metadata")).get("regularityAssessment"))),
    )
    candidates: List[Dict[str, Any]] = []
    explicit_regular = False
    for source_name, source in sources:
        source_candidates, source_regular = _structured_plan_irregularity_candidates(source, source_name)
        candidates.extend(source_candidates)
        explicit_regular = explicit_regular or source_regular

    story_candidates: List[Dict[str, Any]] = []
    for story in _stories(payload):
        story_id = str(story.get("id") or "").strip()
        extra = as_record(story.get("extra"))
        for source_name, source in (("stories[]", story), ("stories[].extra", extra)):
            source_candidates, source_regular = _structured_plan_irregularity_candidates(source, source_name)
            explicit_regular = explicit_regular or source_regular
            for item in source_candidates:
                story_candidates.append({
                    **item,
                    "story": story_id or f"story-{len(story_candidates) + 1}",
                })

    all_candidates = candidates + story_candidates
    if not all_candidates:
        if explicit_regular:
            return "regular", [{
                "name": "structured_plan_irregularity_flags",
                "severity": "regular",
                "value": False,
                "basis": "structured plan-irregularity flags or ratios",
            }], []
        return "unknown", [], ["Structured plan-irregularity flags were not assessed because comparable structured flags or ratios are unavailable."]

    severity = "regular"
    for item in all_candidates:
        severity = _severity_max(severity, str(item.get("severity") or "regular"))
    return severity, [{
        "name": "structured_plan_irregularity_flags",
        "severity": severity,
        "value": severity,
        "irregularThreshold": 0.30,
        "particularlyIrregularThreshold": 0.40,
        "triggers": all_candidates,
        "basis": "structured plan irregularity, reentrant-corner, or plan-concavity flags/ratios heuristic",
    }], []


def _vertical_lateral_system_discontinuity_checks(payload: Dict[str, Any], workflow: Dict[str, Any]) -> Tuple[str, List[Dict[str, Any]], List[str]]:
    requirement_sources = (
        ("seismicWorkflow.designRequirements", as_record(workflow.get("designRequirements"))),
        ("seismicWorkflow.structure", as_record(workflow.get("structure"))),
        ("seismicWorkflow.structureProfile", as_record(workflow.get("structureProfile"))),
        ("model.metadata", as_record(payload.get("metadata"))),
    )
    trigger_keys = (
        "hasTransferStory",
        "hasTransferLevel",
        "hasFrameSupportedWall",
        "hasDiscontinuousVerticalMember",
        "hasVerticalLateralSystemDiscontinuity",
        "verticalLateralSystemDiscontinuity",
    )
    triggers: List[Dict[str, Any]] = []
    explicit_regular = False
    for source_name, source in requirement_sources:
        for key in trigger_keys:
            if key not in source:
                continue
            if _is_true(source.get(key)):
                triggers.append({
                    "source": f"{source_name}.{key}",
                    "value": True,
                })
            elif source.get(key) is False:
                explicit_regular = True

    story_triggers: List[Dict[str, Any]] = []
    for story in _stories(payload):
        extra = as_record(story.get("extra"))
        story_id = str(story.get("id") or "").strip()
        for key in trigger_keys:
            if _is_true(extra.get(key)) or _is_true(story.get(key)):
                story_triggers.append({
                    "story": story_id or f"story-{len(story_triggers) + 1}",
                    "source": f"stories[].{key}",
                })

    element_type_aliases = {
        "transfer-beam",
        "transfer-column",
        "transfer-girder",
        "frame-supported-wall",
        "frame-supported-column",
        "discontinuous-wall",
        "discontinuous-column",
    }
    raw_elements = payload.get("elements")
    elements = [item for item in raw_elements if isinstance(item, dict)] if isinstance(raw_elements, list) else []
    element_triggers: List[Dict[str, Any]] = []
    for element in elements:
        element_type = str(element.get("type") or "").strip().lower()
        metadata = as_record(element.get("metadata"))
        if element_type in element_type_aliases or any(_is_true(metadata.get(key)) for key in trigger_keys):
            element_triggers.append({
                "elementId": str(element.get("id") or ""),
                "type": element_type,
            })

    if not triggers and not story_triggers and not element_triggers:
        if explicit_regular:
            return "regular", [{
                "name": "vertical_lateral_system_discontinuity",
                "severity": "regular",
                "value": False,
                "basis": "structured transfer-story/discontinuous vertical member flags",
            }], []
        return "unknown", [], ["Vertical lateral-system discontinuity regularity was not assessed because structured transfer/discontinuity flags are unavailable."]

    return "particularly_irregular", [{
        "name": "vertical_lateral_system_discontinuity",
        "severity": "particularly_irregular",
        "value": True,
        "triggers": triggers,
        "storyTriggers": story_triggers,
        "elementTriggers": element_triggers,
        "basis": "structured transfer-story or discontinuous vertical lateral-resisting member flags",
    }], []


def _explicit_weak_soft_story_checks(payload: Dict[str, Any], workflow: Dict[str, Any]) -> Tuple[str, List[Dict[str, Any]], List[str]]:
    requirement_sources = (
        ("seismicWorkflow.designRequirements", as_record(workflow.get("designRequirements"))),
        ("seismicWorkflow.structure", as_record(workflow.get("structure"))),
        ("seismicWorkflow.structureProfile", as_record(workflow.get("structureProfile"))),
        ("model.metadata", as_record(payload.get("metadata"))),
    )
    trigger_keys = (
        "hasWeakStory",
        "hasSoftStory",
        "hasWeakOrSoftStory",
        "isWeakStory",
        "isSoftStory",
        "isWeakOrSoftStory",
        "weakStory",
        "softStory",
        "weakOrSoftStory",
        "storyStrengthDiscontinuity",
        "storyStiffnessDiscontinuity",
    )
    triggers: List[Dict[str, Any]] = []
    explicit_regular = False
    for source_name, source in requirement_sources:
        for key in trigger_keys:
            if key not in source:
                continue
            if _is_true(source.get(key)):
                triggers.append({
                    "source": f"{source_name}.{key}",
                    "value": True,
                })
            elif source.get(key) is False:
                explicit_regular = True

    story_triggers: List[Dict[str, Any]] = []
    for story in _stories(payload):
        extra = as_record(story.get("extra"))
        story_id = str(story.get("id") or "").strip()
        for key in trigger_keys:
            if _is_true(extra.get(key)) or _is_true(story.get(key)):
                story_triggers.append({
                    "story": story_id or f"story-{len(story_triggers) + 1}",
                    "source": f"stories[].{key}",
                })

    if not triggers and not story_triggers:
        if explicit_regular:
            return "regular", [{
                "name": "explicit_weak_soft_story",
                "severity": "regular",
                "value": False,
                "basis": "structured weak/soft story flags",
            }], []
        return "unknown", [], ["Weak/soft story regularity was not assessed because structured flags are unavailable."]

    return "particularly_irregular", [{
        "name": "explicit_weak_soft_story",
        "severity": "particularly_irregular",
        "value": True,
        "triggers": triggers,
        "storyTriggers": story_triggers,
        "basis": "structured weak-story, soft-story, or story strength/stiffness discontinuity flags",
    }], []


def _story_nodes_by_key(payload: Dict[str, Any]) -> Dict[str, List[Dict[str, Any]]]:
    raw_nodes = payload.get("nodes")
    nodes = [node for node in raw_nodes if isinstance(node, dict)] if isinstance(raw_nodes, list) else []
    by_story: Dict[str, List[Dict[str, Any]]] = {}
    for node in nodes:
        key = _node_story_key(node)
        if key:
            by_story.setdefault(key, []).append(node)
    return by_story


def _plan_dimension(nodes: Sequence[Dict[str, Any]]) -> Optional[float]:
    xs = [_node_value(node, "x") for node in nodes]
    ys = [_node_value(node, "y") for node in nodes]
    x_values = [value for value in xs if value is not None]
    y_values = [value for value in ys if value is not None]
    if len(x_values) < 2 or len(y_values) < 2:
        return None
    width = max(x_values) - min(x_values)
    depth = max(y_values) - min(y_values)
    if width <= 0.0 or depth <= 0.0:
        return None
    return max(width, depth)


def _torsional_eccentricity_checks(payload: Dict[str, Any]) -> Tuple[str, List[Dict[str, Any]], List[str]]:
    nodes = _records_by_id(payload, "nodes")
    sections = _records_by_id(payload, "sections")
    materials = _records_by_id(payload, "materials")
    raw_elements = payload.get("elements")
    elements = [item for item in raw_elements if isinstance(item, dict)] if isinstance(raw_elements, list) else []
    story_nodes = _story_nodes_by_key(payload)
    story_column_stiffness: Dict[str, List[Dict[str, float]]] = {}
    missing_properties = 0

    for element in elements:
        if str(element.get("type") or "").strip().lower() != "column":
            continue
        element_nodes = element.get("nodes")
        if not isinstance(element_nodes, list) or len(element_nodes) < 2:
            continue
        i_node = nodes.get(str(element_nodes[0]))
        j_node = nodes.get(str(element_nodes[1]))
        if not i_node or not j_node:
            continue
        z_i = _node_value(i_node, "z")
        z_j = _node_value(j_node, "z")
        x_i = _node_value(i_node, "x")
        x_j = _node_value(j_node, "x")
        y_i = _node_value(i_node, "y")
        y_j = _node_value(j_node, "y")
        if None in {z_i, z_j, x_i, x_j, y_i, y_j}:
            continue
        height = abs(float(z_j) - float(z_i))
        if height <= 0.0:
            continue
        upper_node = j_node if float(z_j) >= float(z_i) else i_node
        story_key = (
            str(element.get("story")).strip()
            if str(element.get("story") or "").strip()
            else _node_story_key(upper_node)
        )
        if not story_key:
            continue
        section = sections.get(str(element.get("section")))
        inertia = _section_inertia(section) if section else None
        material = materials.get(str(element.get("material")))
        elastic_modulus = _material_elastic_modulus(material) if material else None
        if inertia is None:
            missing_properties += 1
            continue
        stiffness = 12.0 * float(elastic_modulus or 1.0) * inertia / height ** 3
        story_column_stiffness.setdefault(story_key, []).append({
            "x": float(x_i + x_j) / 2.0,
            "y": float(y_i + y_j) / 2.0,
            "stiffness": stiffness,
        })

    story_results: List[Dict[str, Any]] = []
    assumptions: List[str] = []
    for story, nodes_at_story in story_nodes.items():
        plan_dimension = _plan_dimension(nodes_at_story)
        columns = story_column_stiffness.get(story, [])
        if plan_dimension is None or len(columns) < 2:
            continue
        x_values = [_node_value(node, "x") for node in nodes_at_story]
        y_values = [_node_value(node, "y") for node in nodes_at_story]
        xs = [float(value) for value in x_values if value is not None]
        ys = [float(value) for value in y_values if value is not None]
        mass_x = sum(xs) / len(xs)
        mass_y = sum(ys) / len(ys)
        total_stiffness = sum(item["stiffness"] for item in columns)
        if total_stiffness <= 0.0:
            continue
        stiffness_x = sum(item["x"] * item["stiffness"] for item in columns) / total_stiffness
        stiffness_y = sum(item["y"] * item["stiffness"] for item in columns) / total_stiffness
        eccentricity = math.hypot(mass_x - stiffness_x, mass_y - stiffness_y)
        eccentricity_ratio = eccentricity / max(plan_dimension, 1e-9)
        story_results.append({
            "story": story,
            "eccentricityRatio": round(eccentricity_ratio, 4),
            "eccentricityM": round(eccentricity, 4),
            "massCenter": {"x": round(mass_x, 4), "y": round(mass_y, 4)},
            "stiffnessCenter": {"x": round(stiffness_x, 4), "y": round(stiffness_y, 4)},
        })

    if missing_properties:
        assumptions.append("Plan torsional eccentricity check skipped column elements with missing section inertia.")
    if not story_results:
        assumptions.append("Plan torsional eccentricity regularity was not assessed because story plan coordinates or column stiffness data are insufficient.")
        return "unknown", [], assumptions

    max_ratio = max(float(item["eccentricityRatio"]) for item in story_results)
    if max_ratio > 0.30:
        severity = "particularly_irregular"
    elif max_ratio > 0.15:
        severity = "irregular"
    else:
        severity = "regular"
    return severity, [{
        "name": "plan_torsional_eccentricity",
        "severity": severity,
        "value": round(max_ratio, 4),
        "irregularThreshold": 0.15,
        "particularlyIrregularThreshold": 0.30,
        "storyEccentricities": story_results,
        "basis": "distance between story node centroid as mass-center proxy and column-stiffness center divided by max plan dimension",
    }], assumptions


def _torsional_ratio_candidates(source: Dict[str, Any], source_name: str) -> List[Dict[str, Any]]:
    scalar_keys = (
        "torsionalDisplacementRatio",
        "torsionalIrregularityRatio",
        "maxDisplacementAverageRatio",
        "maxDisplacementToAverageRatio",
        "maxToAverageDisplacementRatio",
        "maxStoryDisplacementToAverageRatio",
        "maxFloorDisplacementToAverageRatio",
    )
    candidates: List[Dict[str, Any]] = []
    for key in scalar_keys:
        value = optional_number(source.get(key))
        if value is not None and value > 0.0:
            candidates.append({
                "source": f"{source_name}.{key}",
                "ratio": value,
            })

    nested_keys = (
        "torsionalDisplacementRatios",
        "torsionalDisplacementRatioByDirection",
        "torsionalIrregularityRatios",
        "maxDisplacementToAverageRatios",
    )
    component_keys = ("x", "y", "X", "Y", "ratioX", "ratioY", "xRatio", "yRatio")
    for key in nested_keys:
        nested = source.get(key)
        if isinstance(nested, dict):
            for component_key in component_keys:
                value = optional_number(nested.get(component_key))
                if value is not None and value > 0.0:
                    candidates.append({
                        "source": f"{source_name}.{key}.{component_key}",
                        "ratio": value,
                        "direction": str(component_key).replace("Ratio", "").replace("ratio", "").lower() or None,
                    })
        elif isinstance(nested, list):
            for index, item in enumerate(nested):
                if not isinstance(item, dict):
                    continue
                value = optional_number(item.get("ratio")) or optional_number(item.get("value"))
                if value is not None and value > 0.0:
                    candidates.append({
                        "source": f"{source_name}.{key}[{index}]",
                        "ratio": value,
                        **({"direction": str(item.get("direction"))} if item.get("direction") else {}),
                    })
    return candidates


def _structured_torsional_displacement_ratio_checks(payload: Dict[str, Any], workflow: Dict[str, Any]) -> Tuple[str, List[Dict[str, Any]], List[str]]:
    sources = (
        ("seismicWorkflow.designRequirements", as_record(workflow.get("designRequirements"))),
        ("seismicWorkflow.structure", as_record(workflow.get("structure"))),
        ("seismicWorkflow.structureProfile", as_record(workflow.get("structureProfile"))),
        ("seismicWorkflow.regularityAssessment", as_record(workflow.get("regularityAssessment"))),
        ("model.metadata", as_record(payload.get("metadata"))),
        ("model.metadata.regularityAssessment", as_record(as_record(payload.get("metadata")).get("regularityAssessment"))),
    )
    candidates: List[Dict[str, Any]] = []
    for source_name, source in sources:
        candidates.extend(_torsional_ratio_candidates(source, source_name))

    story_ratios: List[Dict[str, Any]] = []
    for story in _stories(payload):
        story_id = str(story.get("id") or "").strip()
        extra = as_record(story.get("extra"))
        for source_name, source in (("stories[]", story), ("stories[].extra", extra)):
            for candidate in _torsional_ratio_candidates(source, source_name):
                story_ratios.append({
                    **candidate,
                    "story": story_id or f"story-{len(story_ratios) + 1}",
                })

    all_candidates = candidates + story_ratios
    if not all_candidates:
        return "unknown", [], ["Structured torsional displacement-ratio regularity was not assessed because comparable ratio data is unavailable."]

    max_ratio = max(float(item["ratio"]) for item in all_candidates)
    if max_ratio > 1.40:
        severity = "particularly_irregular"
    elif max_ratio > 1.20:
        severity = "irregular"
    else:
        severity = "regular"
    return severity, [{
        "name": "structured_torsional_displacement_ratio",
        "severity": severity,
        "value": round(max_ratio, 4),
        "irregularThreshold": 1.20,
        "particularlyIrregularThreshold": 1.40,
        "ratios": [
            {
                **item,
                "ratio": round(float(item["ratio"]), 6),
            }
            for item in all_candidates
        ],
        "basis": "structured max story displacement to average displacement ratio heuristic",
    }], []


def assess_regularity(model: Any, workflow: Dict[str, Any]) -> RegularityAssessment:
    payload = _model_payload(model)
    requirements = as_record(workflow.get("designRequirements"))
    structure = as_record(workflow.get("structure"))
    regularity = as_record(workflow.get("regularityAssessment"))
    explicit = _classification_from_explicit(
        requirements.get("irregularity")
        or structure.get("irregularity")
        or regularity.get("classification")
        or regularity.get("regularity")
        or workflow.get("irregularity")
        or as_record(payload.get("metadata")).get("irregularity")
    )

    classification = explicit or "regular"
    source = "structured_requirement" if explicit else "model_heuristic"
    checks: List[Dict[str, Any]] = []
    warnings: List[str] = []
    assumptions: List[str] = []

    if explicit:
        checks.append({
            "name": "explicit_regularity",
            "severity": explicit,
            "value": explicit,
            "basis": "structured seismicWorkflow/model metadata",
        })

    stories = _stories(payload)
    for severity, new_checks, new_assumptions in (
        _story_height_checks(stories),
        _story_load_checks(stories),
        _story_mass_checks(payload),
        _floor_diaphragm_discontinuity_checks(payload),
        _structured_story_lateral_stiffness_checks(stories),
        _story_lateral_stiffness_checks(payload),
        _story_lateral_strength_checks(stories),
        _explicit_weak_soft_story_checks(payload, workflow),
        _plan_setback_checks(payload),
        _plan_aspect_check(payload),
        _structured_plan_irregularity_checks(payload, workflow),
        _vertical_lateral_system_discontinuity_checks(payload, workflow),
        _structured_torsional_displacement_ratio_checks(payload, workflow),
        _torsional_eccentricity_checks(payload),
    ):
        checks.extend(new_checks)
        assumptions.extend(new_assumptions)
        if severity != "unknown":
            classification = _severity_max(classification, severity)

    if not checks:
        classification = "unknown"
        source = "insufficient_model_data"
        warnings.append("No model regularity checks could be evaluated from the available structure model.")

    if classification in {"irregular", "particularly_irregular"}:
        warnings.append(
            "Automatic regularity assessment is heuristic and should be reviewed by the engineer against GB/T 50011 irregularity clauses."
        )

    return RegularityAssessment(
        classification=classification,
        source=source,
        checks=checks,
        warnings=warnings,
        assumptions=list(dict.fromkeys(assumptions)),
    )
