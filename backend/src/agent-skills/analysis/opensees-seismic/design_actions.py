from __future__ import annotations

from typing import Any, Dict, List

from design_basis import SeismicDesignBasis, model_payload
from modal import _build_opensees_model, _is_opensees_line_element_type, _is_wall_line_element_type


def _field(record: Any, key: str, default: Any = None) -> Any:
    if isinstance(record, dict):
        return record.get(key, default)
    return getattr(record, key, default)


def _node_key(node: Any) -> str:
    return str(_field(node, "id"))


def _nodes(payload: Dict[str, Any], model: Any) -> List[Any]:
    value = payload.get("nodes")
    if isinstance(value, list):
        return value
    return list(getattr(model, "nodes", []) or [])


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
        return {
            "rawComponents": raw,
            "endI": {
                "axialKN": raw[0],
                "shearYKN": raw[1],
                "shearZKN": raw[2],
                "torsionKNm": raw[3],
                "momentYKNm": raw[4],
                "momentZKNm": raw[5],
            },
            "endJ": {
                "axialKN": raw[6],
                "shearYKN": raw[7],
                "shearZKN": raw[8],
                "torsionKNm": raw[9],
                "momentYKNm": raw[10],
                "momentZKNm": raw[11],
            },
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
            "source": "opensees_equivalent_lateral_static",
            **_member_force_summary(raw, dimension),
        }
    return member_forces


def _floor_response_rows(response_spectrum: Dict[str, Any]) -> List[Dict[str, Any]]:
    rows = response_spectrum.get("floorResponses")
    if not isinstance(rows, list):
        return []
    return [row for row in rows if isinstance(row, dict)]


def run_equivalent_lateral_design_actions(
    *,
    model: Any,
    basis: SeismicDesignBasis,
    response_spectrum: Dict[str, Any],
    direction: str,
) -> Dict[str, Any]:
    rows = _floor_response_rows(response_spectrum)
    if not rows:
        return {
            "status": "unavailable",
            "method": "equivalent_lateral_static_from_response_spectrum_floor_forces",
            "direction": direction,
            "warnings": ["Response-spectrum floor forces are unavailable; horizontal seismic member actions were not calculated."],
        }

    try:
        import openseespy.opensees as ops
    except Exception as error:
        return {
            "status": "unavailable",
            "method": "equivalent_lateral_static_from_response_spectrum_floor_forces",
            "direction": direction,
            "warnings": [f"OpenSeesPy is not available for horizontal seismic design-action extraction: {error}"],
        }

    payload = model_payload(model)
    nodes = _nodes(payload, model)
    try:
        dimension, node_tags, _floor_masses = _build_opensees_model(ops, payload, model, basis, direction)
        dof = 2 if dimension == "3d" and direction == "y" else 1
        ndf = 6 if dimension == "3d" else 3
        if dimension == "2d" and direction == "y":
            return {
                "status": "unavailable",
                "method": "equivalent_lateral_static_from_response_spectrum_floor_forces",
                "direction": direction,
                "warnings": ["Y-direction horizontal seismic design actions require a 3D model."],
            }
        element_tags = _element_tag_map(payload)
        ops.timeSeries("Linear", 80_001)
        ops.pattern("Plain", 80_001, 80_001)
        applied_force = 0.0
        for row in rows:
            elevation = float(row.get("elevation", 0.0) or 0.0)
            lateral_force = float(row.get("lateralForce", 0.0) or 0.0)
            if abs(lateral_force) <= 0.0:
                continue
            level_nodes = [
                node for node in nodes
                if abs(float(_field(node, "z", 0.0) or 0.0) - elevation) <= 1e-6
                and _node_key(node) in node_tags
            ]
            if not level_nodes:
                continue
            nodal_force = lateral_force / len(level_nodes)
            applied_force += lateral_force
            for node in level_nodes:
                load = [0.0] * ndf
                load[dof - 1] = nodal_force
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
        base_reaction = abs(sum(float(ops.nodeReaction(tag, dof)) for tag in base_tags))
        max_lateral_displacement = 0.0
        for tag in node_tags.values():
            try:
                max_lateral_displacement = max(max_lateral_displacement, abs(float(ops.nodeDisp(tag, dof))))
            except Exception:
                pass
        member_forces = _extract_member_forces(ops, element_tags, dimension)
        minimum_shear_adjustment = (
            response_spectrum.get("minimumStoryShearAdjustment")
            if isinstance(response_spectrum.get("minimumStoryShearAdjustment"), dict)
            else None
        )
        return {
            "status": "computed",
            "method": "equivalent_lateral_static_from_response_spectrum_floor_forces",
            "direction": direction,
            "source": (
                "responseSpectrum.floorResponses.minimumStoryShearAdjusted"
                if minimum_shear_adjustment and minimum_shear_adjustment.get("status") == "adjusted"
                else "responseSpectrum.floorResponses"
            ),
            "dimension": dimension,
            "appliedLateralForceKN": round(applied_force, 6),
            "baseReactionKN": round(base_reaction, 6),
            "maxLateralDisplacementM": round(max_lateral_displacement, 8),
            "memberForceCount": len(member_forces),
            "memberForces": member_forces,
            **({
                "minimumStoryShearAdjustment": {
                    "status": minimum_shear_adjustment.get("status"),
                    "clause": minimum_shear_adjustment.get("clause"),
                    "maxAdjustmentFactor": minimum_shear_adjustment.get("maxAdjustmentFactor"),
                    "adjustedBaseShearKN": minimum_shear_adjustment.get("adjustedBaseShearKN"),
                    "rawBaseShearKN": minimum_shear_adjustment.get("rawBaseShearKN"),
                },
            } if minimum_shear_adjustment else {}),
        }
    except Exception as error:
        return {
            "status": "failed",
            "method": "equivalent_lateral_static_from_response_spectrum_floor_forces",
            "direction": direction,
            "warnings": [f"OpenSees equivalent lateral static design-action extraction failed: {error}"],
        }
    finally:
        try:
            ops.wipe()
        except Exception:
            pass


def run_gravity_design_actions(
    *,
    model: Any,
    basis: SeismicDesignBasis,
    floor_masses: List[Dict[str, Any]],
) -> Dict[str, Any]:
    if not floor_masses:
        return {
            "status": "unavailable",
            "method": "equivalent_gravity_static_from_floor_seismic_weight",
            "warnings": ["Floor seismic weights are unavailable; gravity representative member actions were not calculated."],
        }

    try:
        import openseespy.opensees as ops
    except Exception as error:
        return {
            "status": "unavailable",
            "method": "equivalent_gravity_static_from_floor_seismic_weight",
            "warnings": [f"OpenSeesPy is not available for gravity design-action extraction: {error}"],
        }

    payload = model_payload(model)
    nodes = _nodes(payload, model)
    try:
        dimension, node_tags, _computed_floor_masses = _build_opensees_model(ops, payload, model, basis, "x")
        vertical_dof = 2 if dimension == "2d" else 3
        ndf = 3 if dimension == "2d" else 6
        element_tags = _element_tag_map(payload)
        ops.timeSeries("Linear", 70_001)
        ops.pattern("Plain", 70_001, 70_001)
        applied_weight = 0.0
        for floor in floor_masses:
            elevation = float(floor.get("elevation", 0.0) or 0.0)
            weight = float(floor.get("weightKN", 0.0) or 0.0)
            if weight <= 0.0:
                continue
            level_nodes = [
                node for node in nodes
                if abs(float(_field(node, "z", 0.0) or 0.0) - elevation) <= 1e-6
                and _node_key(node) in node_tags
            ]
            if not level_nodes:
                continue
            nodal_load = -weight / len(level_nodes)
            applied_weight += weight
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
        member_forces = _extract_member_forces(ops, element_tags, dimension)
        return {
            "status": "computed",
            "method": "equivalent_gravity_static_from_floor_seismic_weight",
            "source": "modal.floorMasses.weightKN",
            "dimension": dimension,
            "appliedWeightKN": round(applied_weight, 6),
            "baseReactionKN": round(base_reaction, 6),
            "memberForceCount": len(member_forces),
            "memberForces": member_forces,
        }
    except Exception as error:
        return {
            "status": "failed",
            "method": "equivalent_gravity_static_from_floor_seismic_weight",
            "warnings": [f"OpenSees gravity design-action extraction failed: {error}"],
        }
    finally:
        try:
            ops.wipe()
        except Exception:
            pass
