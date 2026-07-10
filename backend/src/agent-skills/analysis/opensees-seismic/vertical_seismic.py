from __future__ import annotations

from typing import Any, Dict, List, Optional

from design_basis import SeismicDesignBasis, model_payload
from modal import ModalAnalysis, _build_opensees_model, _is_opensees_line_element_type, _is_wall_line_element_type
from seismic_contracts import as_record, first_number, first_string


def _is_true(value: Any) -> bool:
    return value is True or (isinstance(value, str) and value.strip().lower() in {"true", "yes", "1"})


def _workflow_flag(workflow: Dict[str, Any], key: str) -> bool:
    requirements = as_record(workflow.get("designRequirements"))
    structure = as_record(workflow.get("structure"))
    structure_profile = as_record(workflow.get("structureProfile"))
    vertical = as_record(workflow.get("verticalSeismic"))
    for source in (vertical, requirements, structure, structure_profile, workflow):
        if _is_true(source.get(key)):
            return True
    return False


def _method(workflow: Dict[str, Any]) -> str:
    vertical = as_record(workflow.get("verticalSeismic"))
    value = first_string(
        vertical.get("method"),
        vertical.get("calculationMethod"),
        workflow.get("verticalSeismicMethod"),
    )
    text = str(value or "").strip().lower()
    if text in {"modal_spectrum", "vertical_response_spectrum", "response_spectrum"}:
        return "vertical_response_spectrum_equivalent"
    if text in {"simplified_static", "static", "coefficient"}:
        return "simplified_static"
    if _workflow_flag(workflow, "isLargeSpaceStructure") or _workflow_flag(workflow, "hasLargeSpaceRoof"):
        return "vertical_response_spectrum_equivalent"
    return "simplified_static"


def _simplified_coefficient(basis: SeismicDesignBasis, workflow: Dict[str, Any]) -> Optional[float]:
    vertical = as_record(workflow.get("verticalSeismic"))
    explicit = first_number(
        vertical.get("coefficient"),
        vertical.get("verticalCoefficient"),
        workflow.get("verticalSeismicCoefficient"),
    )
    if explicit is not None and explicit > 0.0:
        return float(explicit)
    if basis.intensity == 8:
        return 0.15 if basis.acceleration_g is not None and abs(basis.acceleration_g - 0.30) <= 0.011 else 0.10
    if basis.intensity >= 9:
        return 0.20
    return None


def _target_weight(total_weight: float, workflow: Dict[str, Any], method: str) -> Dict[str, Any]:
    vertical = as_record(workflow.get("verticalSeismic"))
    explicit_weight = first_number(
        vertical.get("targetWeightKN"),
        vertical.get("affectedWeightKN"),
        vertical.get("representativeWeightKN"),
        workflow.get("verticalSeismicTargetWeightKN"),
    )
    if explicit_weight is not None and explicit_weight > 0.0:
        return {
            "weightKN": float(explicit_weight),
            "source": "verticalSeismic.targetWeightKN",
            "warnings": [],
        }
    if method == "vertical_response_spectrum_equivalent":
        return {
            "weightKN": 0.75 * total_weight,
            "source": "GB/T 50011 equivalent total gravity load",
            "warnings": [],
        }
    return {
        "weightKN": total_weight,
        "source": "model.seismicWeight",
        "warnings": [
            "No verticalSeismic.targetWeightKN was provided; used total model seismic weight for the simplified vertical action estimate."
        ],
    }


def _floor_distribution(total_vertical_action: float, modal: ModalAnalysis, target_weight: float) -> List[Dict[str, Any]]:
    total_floor_weight = sum(float(floor.get("weightKN", 0.0) or 0.0) for floor in modal.floor_masses)
    if total_floor_weight <= 0.0:
        return []
    rows: List[Dict[str, Any]] = []
    for floor in modal.floor_masses:
        weight = float(floor.get("weightKN", 0.0) or 0.0)
        ratio = weight / total_floor_weight
        rows.append({
            "story": floor.get("story"),
            "elevation": floor.get("elevation"),
            "representativeWeightKN": round(target_weight * ratio, 6),
            "verticalActionKN": round(total_vertical_action * ratio, 6),
        })
    return rows


def _field(record: Any, key: str, default: Any = None) -> Any:
    if isinstance(record, dict):
        return record.get(key, default)
    return getattr(record, key, default)


def _nodes(payload: Dict[str, Any], model: Any) -> List[Any]:
    value = payload.get("nodes")
    if isinstance(value, list):
        return value
    return list(getattr(model, "nodes", []) or [])


def _node_key(node: Any) -> str:
    return str(_field(node, "id"))


def _element_tag_map(payload: Dict[str, Any]) -> Dict[int, str]:
    elements = payload.get("elements")
    if not isinstance(elements, list):
        return {}
    tags: Dict[int, str] = {}
    for index, element in enumerate(elements, start=1):
        if not isinstance(element, dict):
            continue
        element_type = str(element.get("type", "") or "").strip().lower()
        if not _is_opensees_line_element_type(element_type):
            continue
        nodes = element.get("nodes")
        if _is_wall_line_element_type(element_type) and (not isinstance(nodes, list) or len(nodes) != 2):
            continue
        element_id = str(element.get("id") or "")
        if element_id:
            tags[index] = element_id
    return tags


def _round_components(values: Any) -> List[float]:
    if not isinstance(values, (list, tuple)):
        return []
    rounded: List[float] = []
    for value in values:
        if isinstance(value, (int, float)):
            rounded.append(round(float(value), 6))
    return rounded


def _member_force_summary(raw: List[float], dimension: str) -> Dict[str, Any]:
    if dimension == "2d" and len(raw) >= 6:
        return {
            "rawComponents": raw,
            "endI": {"axialKN": raw[0], "shearKN": raw[1], "momentKNm": raw[2]},
            "endJ": {"axialKN": raw[3], "shearKN": raw[4], "momentKNm": raw[5]},
            "maxAbsAxialKN": round(max(abs(raw[0]), abs(raw[3])), 6),
            "maxAbsShearKN": round(max(abs(raw[1]), abs(raw[4])), 6),
            "maxAbsMomentKNm": round(max(abs(raw[2]), abs(raw[5])), 6),
        }
    if dimension == "3d" and len(raw) >= 12:
        end_i = {
            "axialKN": raw[0],
            "shearYKN": raw[1],
            "shearZKN": raw[2],
            "torsionKNm": raw[3],
            "momentYKNm": raw[4],
            "momentZKNm": raw[5],
        }
        end_j = {
            "axialKN": raw[6],
            "shearYKN": raw[7],
            "shearZKN": raw[8],
            "torsionKNm": raw[9],
            "momentYKNm": raw[10],
            "momentZKNm": raw[11],
        }
        return {
            "rawComponents": raw,
            "endI": end_i,
            "endJ": end_j,
            "maxAbsAxialKN": round(max(abs(raw[0]), abs(raw[6])), 6),
            "maxAbsShearKN": round(max(abs(raw[1]), abs(raw[2]), abs(raw[7]), abs(raw[8])), 6),
            "maxAbsMomentKNm": round(max(abs(raw[4]), abs(raw[5]), abs(raw[10]), abs(raw[11])), 6),
        }
    return {
        "rawComponents": raw,
        "maxAbsForceComponent": round(max((abs(value) for value in raw), default=0.0), 6),
    }


def _extract_member_forces(ops: Any, element_tags: Dict[int, str], dimension: str) -> Dict[str, Dict[str, Any]]:
    member_forces: Dict[str, Dict[str, Any]] = {}
    for tag, element_id in element_tags.items():
        try:
            raw = _round_components(ops.eleForce(tag))
        except Exception:
            continue
        if not raw:
            continue
        member_forces[element_id] = {
            "elementTag": tag,
            "source": "opensees_vertical_static",
            **_member_force_summary(raw, dimension),
        }
    return member_forces


def _run_opensees_vertical_static(
    *,
    model: Any,
    basis: SeismicDesignBasis,
    floor_distribution: List[Dict[str, Any]],
) -> Dict[str, Any]:
    if not floor_distribution:
        return {
            "status": "unavailable",
            "warnings": ["No vertical floor distribution was available for OpenSees static check."],
        }
    try:
        import openseespy.opensees as ops
    except Exception as error:
        return {
            "status": "unavailable",
            "warnings": [f"OpenSeesPy is not available for vertical static check: {error}"],
        }

    payload = model_payload(model)
    nodes = _nodes(payload, model)
    try:
        dimension, node_tags, _floor_masses = _build_opensees_model(ops, payload, model, basis, "x")
        element_tags = _element_tag_map(payload)
        vertical_dof = 2 if dimension == "2d" else 3
        ndf = 3 if dimension == "2d" else 6
        ops.timeSeries("Linear", 90_001)
        ops.pattern("Plain", 90_001, 90_001)
        for row in floor_distribution:
            elevation = float(row.get("elevation", 0.0) or 0.0)
            vertical_action = float(row.get("verticalActionKN", 0.0) or 0.0)
            level_nodes = [
                node for node in nodes
                if abs(float(_field(node, "z", 0.0) or 0.0) - elevation) <= 1e-6
                and _node_key(node) in node_tags
            ]
            if not level_nodes:
                continue
            nodal_load = -vertical_action / len(level_nodes)
            for node in level_nodes:
                load = [0.0] * ndf
                load[vertical_dof - 1] = nodal_load
                ops.load(node_tags[_node_key(node)], *load)

        ops.wipeAnalysis()
        ops.constraints("Transformation")
        ops.numberer("RCM")
        ops.system("BandGeneral")
        ops.test("NormDispIncr", 1.0e-8, 12)
        ops.algorithm("Linear")
        ops.integrator("LoadControl", 1.0)
        ops.analysis("Static")
        ok = ops.analyze(1)
        if ok != 0:
            raise RuntimeError(f"OpenSees static analyze returned {ok}")

        z_values = [float(_field(node, "z", 0.0) or 0.0) for node in nodes]
        base_z = min(z_values) if z_values else 0.0
        base_tags = [
            node_tags[_node_key(node)]
            for node in nodes
            if _node_key(node) in node_tags and abs(float(_field(node, "z", 0.0) or 0.0) - base_z) <= 1e-6
        ]
        ops.reactions()
        base_reaction = abs(sum(float(ops.nodeReaction(tag, vertical_dof)) for tag in base_tags))
        max_vertical_displacement = 0.0
        for tag in node_tags.values():
            try:
                max_vertical_displacement = max(max_vertical_displacement, abs(float(ops.nodeDisp(tag, vertical_dof))))
            except Exception:
                pass
        member_forces = _extract_member_forces(ops, element_tags, dimension)
        return {
            "status": "completed",
            "dimension": dimension,
            "baseReactionKN": round(base_reaction, 6),
            "maxVerticalDisplacementM": round(max_vertical_displacement, 8),
            "memberForceCount": len(member_forces),
            "memberForces": member_forces,
        }
    except Exception as error:
        return {
            "status": "failed",
            "warnings": [f"OpenSees vertical static check failed; retained equivalent vertical seismic action: {error}"],
        }
    finally:
        try:
            ops.wipe()
        except Exception:
            pass


def run_vertical_seismic(
    *,
    model: Any,
    basis: SeismicDesignBasis,
    modal: ModalAnalysis,
    workflow: Dict[str, Any],
    reasons: List[str],
) -> Dict[str, Any]:
    total_weight = sum(float(floor.get("weightKN", 0.0) or 0.0) for floor in modal.floor_masses)
    method = _method(workflow)
    warnings: List[str] = []
    if total_weight <= 0.0:
        return {
            "status": "unavailable",
            "method": method,
            "clause": "GB/T 50011-2010(2024) 5.3",
            "reasons": reasons,
            "warnings": ["Model seismic weight is unavailable; vertical seismic action could not be calculated."],
        }

    if method == "vertical_response_spectrum_equivalent":
        coefficient = 0.65 * basis.alpha_max
        coefficient_source = "0.65 * horizontal alphaMax"
    else:
        coefficient = _simplified_coefficient(basis, workflow)
        coefficient_source = "GB/T 50011 simplified vertical action coefficient"
        if coefficient is None:
            return {
                "status": "unavailable",
                "method": method,
                "clause": "GB/T 50011-2010(2024) 5.3.3",
                "reasons": reasons,
                "warnings": ["Simplified vertical seismic coefficient is unavailable for the current intensity."],
            }

    target = _target_weight(total_weight, workflow, method)
    warnings.extend(target["warnings"])
    target_weight = float(target["weightKN"])
    total_vertical_action = coefficient * target_weight
    floor_distribution = _floor_distribution(total_vertical_action, modal, target_weight)
    static_check = _run_opensees_vertical_static(
        model=model,
        basis=basis,
        floor_distribution=floor_distribution,
    )
    warnings.extend(static_check.get("warnings", []))
    return {
        "status": "computed",
        "method": method,
        "clause": "GB/T 50011-2010(2024) 5.3",
        "reasons": reasons,
        "coefficient": round(coefficient, 6),
        "coefficientSource": coefficient_source,
        "totalModelSeismicWeightKN": round(total_weight, 6),
        "targetWeightKN": round(target_weight, 6),
        "targetWeightSource": target["source"],
        "totalVerticalActionKN": round(total_vertical_action, 6),
        "floorDistribution": floor_distribution,
        "openSeesStatic": static_check,
        "warnings": warnings,
    }
