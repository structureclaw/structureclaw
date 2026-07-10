from __future__ import annotations

from typing import Any, Dict, List, Optional, Set

from seismic_contracts import as_record, first_number


DEFAULT_FACTORS = {
    "gravity": 1.2,
    "horizontal": 1.3,
    "vertical": 1.3,
    "orthogonalVertical": 0.5,
    "orthogonalHorizontal": 0.5,
}


def _factors(workflow: Dict[str, Any]) -> Dict[str, float]:
    control = as_record(workflow.get("analysisControl"))
    combinations = as_record(workflow.get("designCombinations"))
    return {
        "gravity": first_number(combinations.get("gravityFactor"), control.get("gravityFactor")) or DEFAULT_FACTORS["gravity"],
        "horizontal": first_number(combinations.get("horizontalSeismicFactor"), control.get("horizontalSeismicFactor")) or DEFAULT_FACTORS["horizontal"],
        "vertical": first_number(combinations.get("verticalSeismicFactor"), control.get("verticalSeismicFactor")) or DEFAULT_FACTORS["vertical"],
        "orthogonalVertical": first_number(combinations.get("orthogonalVerticalFactor"), control.get("orthogonalVerticalFactor")) or DEFAULT_FACTORS["orthogonalVertical"],
        "orthogonalHorizontal": first_number(combinations.get("orthogonalHorizontalFactor"), control.get("orthogonalHorizontalFactor")) or DEFAULT_FACTORS["orthogonalHorizontal"],
    }


def _member_forces(action: Optional[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    if not isinstance(action, dict):
        return {}
    forces = action.get("memberForces")
    return forces if isinstance(forces, dict) else {}


def _horizontal_action_entries(
    horizontal_actions: Optional[Dict[str, Any]],
    horizontal_direction_actions: Optional[List[Dict[str, Any]]],
) -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []
    for action in horizontal_direction_actions or []:
        forces = _member_forces(action)
        if not forces:
            continue
        direction = str(action.get("direction") or f"h{len(entries) + 1}").strip().lower()
        entries.append({
            "direction": direction,
            "forces": forces,
            "method": action.get("method"),
        })
    if entries:
        return entries

    forces = _member_forces(horizontal_actions)
    if not forces:
        return []
    direction = str(horizontal_actions.get("direction") or "horizontal").strip().lower() if isinstance(horizontal_actions, dict) else "horizontal"
    return [{
        "direction": direction,
        "forces": forces,
        "method": horizontal_actions.get("method") if isinstance(horizontal_actions, dict) else None,
    }]


def _number(record: Dict[str, Any], key: str) -> float:
    value = record.get(key)
    return float(value) if isinstance(value, (int, float)) else 0.0


def _combine_member(
    member_id: str,
    *,
    gravity: Dict[str, Dict[str, Any]],
    horizontal_by_direction: Dict[str, Dict[str, Dict[str, Any]]],
    vertical: Dict[str, Dict[str, Any]],
    factors: Dict[str, float],
    case: Dict[str, float],
    horizontal_factors: Dict[str, float],
) -> Dict[str, Any]:
    g = gravity.get(member_id, {})
    v = vertical.get(member_id, {})

    def combine(component: str) -> float:
        horizontal = sum(
            factor * _number(forces.get(member_id, {}), component)
            for direction, forces in horizontal_by_direction.items()
            for factor in [horizontal_factors.get(direction, 0.0)]
            if factor != 0.0
        )
        return horizontal + (
            case.get("gravity", 0.0) * _number(g, component)
            + case.get("vertical", 0.0) * _number(v, component)
        )

    axial = combine("maxAbsAxialKN")
    shear = combine("maxAbsShearKN")
    moment = combine("maxAbsMomentKNm")
    return {
        "elementId": member_id,
        "maxAbsAxialKN": round(axial, 6),
        "maxAbsShearKN": round(shear, 6),
        "maxAbsMomentKNm": round(moment, 6),
        "factors": {
            key: round(value, 6)
            for key, value in case.items()
            if value != 0.0
        },
        "horizontalFactors": {
            key: round(value, 6)
            for key, value in horizontal_factors.items()
            if value != 0.0
        },
        "sourceFactors": factors,
    }


def _case_definitions(horizontal_directions: List[str], has_vertical: bool, factors: Dict[str, float]) -> List[Dict[str, Any]]:
    if not horizontal_directions:
        cases: List[Dict[str, Any]] = []
    elif len(horizontal_directions) == 1:
        direction = horizontal_directions[0]
        cases = [{
            "name": "gravity_plus_horizontal_seismic",
            "description": "1.2G + 1.3Eh",
            "factors": {
                "gravity": factors["gravity"],
                "vertical": 0.0,
            },
            "horizontalFactors": {direction: factors["horizontal"]},
        }]
    else:
        cases = []
        for direction in horizontal_directions:
            label = direction.upper()
            cases.append({
                "name": f"gravity_plus_{direction}_horizontal_seismic",
                "description": f"1.2G + 1.3E{label}",
                "factors": {
                    "gravity": factors["gravity"],
                    "vertical": 0.0,
                },
                "horizontalFactors": {direction: factors["horizontal"]},
            })
        if len(horizontal_directions) > 1:
            for direction in horizontal_directions:
                for companion in horizontal_directions:
                    if companion == direction:
                        continue
                    cases.append({
                        "name": f"gravity_plus_{direction}_horizontal_with_{companion}",
                        "description": f"1.2G + 1.3E{direction.upper()} + {factors['orthogonalHorizontal']}E{companion.upper()}",
                        "factors": {
                            "gravity": factors["gravity"],
                            "vertical": 0.0,
                        },
                        "horizontalFactors": {
                            direction: factors["horizontal"],
                            companion: factors["orthogonalHorizontal"],
                        },
                    })
    if has_vertical:
        cases.extend([
            {
                "name": "gravity_plus_vertical_seismic",
                "description": "1.2G + 1.3Ev",
                "factors": {
                    "gravity": factors["gravity"],
                    "vertical": factors["vertical"],
                },
                "horizontalFactors": {},
            },
        ])
        if len(horizontal_directions) != 1:
            for direction in horizontal_directions:
                cases.extend([
                    {
                        "name": f"gravity_plus_{direction}_horizontal_seismic_with_vertical",
                        "description": f"1.2G + 1.3E{direction.upper()} + 0.5Ev",
                        "factors": {
                            "gravity": factors["gravity"],
                            "vertical": factors["orthogonalVertical"],
                        },
                        "horizontalFactors": {direction: factors["horizontal"]},
                    },
                    {
                        "name": f"gravity_plus_vertical_seismic_with_{direction}_horizontal",
                        "description": f"1.2G + {factors['orthogonalHorizontal']}E{direction.upper()} + 1.3Ev",
                        "factors": {
                            "gravity": factors["gravity"],
                            "vertical": factors["vertical"],
                        },
                        "horizontalFactors": {direction: factors["orthogonalHorizontal"]},
                    },
                ])
    elif len(horizontal_directions) == 1:
        return cases
    return cases


def _legacy_vertical_case_definitions(direction: str, factors: Dict[str, float]) -> List[Dict[str, Any]]:
    return [
        {
            "name": "gravity_plus_horizontal_seismic_with_vertical",
            "description": "1.2G + 1.3Eh + 0.5Ev",
            "factors": {
                "gravity": factors["gravity"],
                "vertical": factors["orthogonalVertical"],
            },
            "horizontalFactors": {direction: factors["horizontal"]},
        },
        {
            "name": "gravity_plus_vertical_seismic_with_horizontal",
            "description": "1.2G + 0.5Eh + 1.3Ev",
            "factors": {
                "gravity": factors["gravity"],
                "vertical": factors["vertical"],
            },
            "horizontalFactors": {direction: factors["orthogonalHorizontal"]},
        },
    ]


def _all_case_definitions(horizontal_directions: List[str], has_vertical: bool, factors: Dict[str, float]) -> List[Dict[str, Any]]:
    cases = _case_definitions(horizontal_directions, has_vertical, factors)
    if has_vertical and len(horizontal_directions) == 1:
        cases.extend(_legacy_vertical_case_definitions(horizontal_directions[0], factors))
    return cases


def build_member_design_action_combinations(
    *,
    workflow: Dict[str, Any],
    gravity_actions: Optional[Dict[str, Any]],
    horizontal_actions: Optional[Dict[str, Any]],
    horizontal_direction_actions: Optional[List[Dict[str, Any]]] = None,
    vertical_seismic: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    gravity = _member_forces(gravity_actions)
    horizontal_entries = _horizontal_action_entries(horizontal_actions, horizontal_direction_actions)
    horizontal_by_direction = {
        str(entry["direction"]): entry["forces"]
        for entry in horizontal_entries
        if isinstance(entry.get("forces"), dict)
    }
    vertical_static = as_record(vertical_seismic.get("openSeesStatic")) if isinstance(vertical_seismic, dict) else {}
    vertical = _member_forces(vertical_static)
    warnings: List[str] = []
    if not gravity:
        warnings.append("Gravity representative member forces are unavailable; seismic basic action combinations are incomplete.")
    if not horizontal_by_direction:
        warnings.append("Horizontal seismic member forces are unavailable; seismic basic action combinations are incomplete.")

    member_ids: Set[str] = set(gravity) | set(vertical)
    for forces in horizontal_by_direction.values():
        member_ids.update(forces.keys())
    if not member_ids:
        return {
            "status": "unavailable",
            "method": "gb50011_seismic_basic_action_combination",
            "clause": "GB/T 50011-2010(2024) 5.4.1",
            "warnings": warnings or ["No member force effects were available for seismic design action combinations."],
        }

    factors = _factors(workflow)
    has_vertical = bool(vertical)
    horizontal_directions = list(horizontal_by_direction.keys())
    cases = []
    controlling: Dict[str, Dict[str, Any]] = {
        "axial": {"value": 0.0},
        "shear": {"value": 0.0},
        "moment": {"value": 0.0},
    }
    for case in _all_case_definitions(horizontal_directions, has_vertical, factors):
        member_results = [
            _combine_member(
                member_id,
                gravity=gravity,
                horizontal_by_direction=horizontal_by_direction,
                vertical=vertical,
                factors=factors,
                case=case["factors"],
                horizontal_factors=case.get("horizontalFactors", {}),
            )
            for member_id in sorted(member_ids)
        ]
        for item in member_results:
            if item["maxAbsAxialKN"] >= controlling["axial"].get("value", 0.0):
                controlling["axial"] = {"value": item["maxAbsAxialKN"], "elementId": item["elementId"], "case": case["name"]}
            if item["maxAbsShearKN"] >= controlling["shear"].get("value", 0.0):
                controlling["shear"] = {"value": item["maxAbsShearKN"], "elementId": item["elementId"], "case": case["name"]}
            if item["maxAbsMomentKNm"] >= controlling["moment"].get("value", 0.0):
                controlling["moment"] = {"value": item["maxAbsMomentKNm"], "elementId": item["elementId"], "case": case["name"]}
        cases.append({
            "name": case["name"],
            "description": case["description"],
            "factors": case["factors"],
            "horizontalFactors": case.get("horizontalFactors", {}),
            "memberActions": member_results,
        })

    status = "computed" if gravity and horizontal_by_direction else "partial"
    return {
        "status": status,
        "method": "gb50011_seismic_basic_action_combination",
        "clause": "GB/T 50011-2010(2024) 5.4.1",
        "memberCount": len(member_ids),
        "caseCount": len(cases),
        "cases": cases,
        "controlling": controlling,
        "factors": factors,
        "horizontalDirections": horizontal_directions,
        "warnings": warnings,
    }
