from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

from design_basis import SeismicDesignBasis, model_payload
from seismic_contracts import optional_number

G_ACCEL = 9.80665
FRAME_LINE_ELEMENT_TYPES = {"beam", "column"}
WALL_LINE_ELEMENT_TYPES = {
    "wall",
    "shear-wall",
    "shear_wall",
    "seismic-wall",
    "seismic_wall",
    "structural-wall",
    "structural_wall",
    "rc-wall",
    "concrete-wall",
}
OPENSEES_LINE_ELEMENT_TYPES = FRAME_LINE_ELEMENT_TYPES | WALL_LINE_ELEMENT_TYPES


@dataclass
class ModalAnalysis:
    modes: List[Dict[str, Any]]
    total_mass: float
    floor_masses: List[Dict[str, float]]
    model_dimension: str
    direction: str
    engine_mode: str
    warnings: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "modes": self.modes,
            "totalMass": self.total_mass,
            "floorMasses": self.floor_masses,
            "modelDimension": self.model_dimension,
            "direction": self.direction,
            "engineMode": self.engine_mode,
            "warnings": self.warnings,
        }


def _field(record: Any, key: str, default: Any = None) -> Any:
    if isinstance(record, dict):
        return record.get(key, default)
    return getattr(record, key, default)


def _element_type(element: Any) -> str:
    return str(_field(element, "type", "") or "").strip().lower()


def _is_opensees_line_element_type(element_type: str) -> bool:
    return element_type in OPENSEES_LINE_ELEMENT_TYPES


def _is_wall_line_element_type(element_type: str) -> bool:
    return element_type in WALL_LINE_ELEMENT_TYPES


def _records(payload: Dict[str, Any], model: Any, key: str) -> List[Any]:
    value = payload.get(key)
    if isinstance(value, list):
        return value
    return list(getattr(model, key, []) or [])


def _node_key(node: Any) -> str:
    return str(_field(node, "id"))


def _element_nodes(element: Any) -> List[str]:
    nodes = _field(element, "nodes", [])
    return [str(item) for item in nodes] if isinstance(nodes, list) else []


def _model_dimension(nodes: List[Any]) -> str:
    y_values = [float(_field(node, "y", 0.0) or 0.0) for node in nodes]
    return "2d" if not y_values or (max(y_values) - min(y_values)) <= 1e-9 else "3d"


def _section_map(sections: List[Any]) -> Dict[str, Any]:
    return {str(_field(section, "id")): section for section in sections}


def _material_map(materials: List[Any]) -> Dict[str, Any]:
    return {str(_field(material, "id")): material for material in materials}


def _section_property(section: Any, name: str, default: float) -> float:
    properties = _field(section, "properties", {}) or {}
    if isinstance(properties, dict):
        value = optional_number(properties.get(name))
        if value is not None:
            return float(value)
    value = optional_number(_field(section, name))
    return float(value) if value is not None else default


def _section_property_optional(section: Any, *names: str) -> Optional[float]:
    properties = _field(section, "properties", {}) or {}
    extra = _field(section, "extra", {}) or {}
    shape = _field(section, "shape", {}) or {}
    for source in (properties, section, extra, shape):
        for name in names:
            value = optional_number(_field(source, name))
            if value is not None:
                return float(value)
    return None


def _dimension_to_m(value: Optional[float]) -> Optional[float]:
    if value is None or value <= 0.0:
        return None
    # Schema legacy dimensions and section shapes are usually millimetres;
    # OpenSees section properties are SI. Values above 10 are treated as mm.
    return value / 1000.0 if value > 10.0 else value


def _wall_dimensions_m(section: Any) -> Tuple[Optional[float], Optional[float]]:
    thickness = _dimension_to_m(_section_property_optional(
        section,
        "thickness",
        "wallThickness",
        "t",
        "T",
    ))
    wall_length = _dimension_to_m(_section_property_optional(
        section,
        "wallLength",
        "wallLengthM",
        "wall_length",
        "length",
        "L",
    ))
    area = _section_property_optional(section, "A", "area")
    if wall_length is None and thickness is not None and area is not None and area > 0.0:
        wall_length = area / thickness
    return thickness, wall_length


def _effective_section_properties(element_type: str, section: Any) -> Tuple[float, float, float, float]:
    area = _section_property(section, "A", 0.1)
    iy = _section_property(section, "Iy", 0.01)
    iz = _section_property(section, "Iz", iy)
    j = _section_property(section, "J", 0.01)
    if not _is_wall_line_element_type(element_type):
        return area, iy, iz, j

    thickness, wall_length = _wall_dimensions_m(section)
    if thickness is None or wall_length is None:
        return area, iy, iz, j

    derived_area = thickness * wall_length
    derived_iy = thickness * (wall_length ** 3) / 12.0
    derived_iz = wall_length * (thickness ** 3) / 12.0
    derived_j = max(derived_area * min(thickness, wall_length) ** 2 / 12.0, 1e-8)
    return (
        _section_property_optional(section, "A", "area") or derived_area,
        _section_property_optional(section, "Iy") or derived_iy,
        _section_property_optional(section, "Iz") or derived_iz,
        _section_property_optional(section, "J") or derived_j,
    )


def _material_e(material: Any, section: Any) -> float:
    value = optional_number(_field(material, "E"))
    if value is None:
        value = optional_number(_section_property(section, "E", 30000000.0))
    if value is None:
        return 30000000.0
    # StructureClaw material records store MPa for concrete/steel. Convert MPa to kN/m2.
    return float(value) * 1000.0 if value < 1_000_000.0 else float(value)


def _material_g(material: Any, section: Any) -> float:
    value = optional_number(_field(material, "G"))
    if value is None:
        value = optional_number(_section_property(section, "G", 12000000.0))
    return float(value) * 1000.0 if value is not None and value < 1_000_000.0 else float(value or 12000000.0)


def _floor_levels(nodes: List[Any]) -> List[float]:
    levels = sorted({round(float(_field(node, "z", 0.0) or 0.0), 6) for node in nodes})
    if not levels:
        return []
    base = min(levels)
    return [level for level in levels if level > base + 1e-9]


def _plan_area(nodes: List[Any], dimension: str) -> float:
    x_values = [float(_field(node, "x", 0.0) or 0.0) for node in nodes]
    y_values = [float(_field(node, "y", 0.0) or 0.0) for node in nodes]
    x_span = max(x_values) - min(x_values) if x_values else 0.0
    y_span = max(y_values) - min(y_values) if y_values else 0.0
    if dimension == "2d":
        return max(x_span, 1.0) * 1.0
    return max(x_span, 1.0) * max(y_span, 1.0)


def _story_floor_loads(payload: Dict[str, Any], default_load: float, level_count: int) -> List[float]:
    stories = payload.get("stories")
    loads: List[float] = []
    if isinstance(stories, list):
        for story in stories:
            story_load = 0.0
            floor_loads = story.get("floor_loads") if isinstance(story, dict) else None
            if isinstance(floor_loads, list):
                for item in floor_loads:
                    if not isinstance(item, dict):
                        continue
                    value = optional_number(item.get("value"))
                    if value is None:
                        continue
                    load_type = str(item.get("type", "")).lower()
                    factor = 0.5 if load_type == "live" else 1.0
                    story_load += factor * value
            if story_load > 0:
                loads.append(story_load)
    if not loads:
        loads = [default_load] * max(level_count, 1)
    if len(loads) < level_count:
        loads.extend([loads[-1]] * (level_count - len(loads)))
    return loads[:level_count]


def compute_floor_masses(payload: Dict[str, Any], model: Any, dimension: str) -> Tuple[List[Dict[str, float]], List[str]]:
    nodes = _records(payload, model, "nodes")
    levels = _floor_levels(nodes)
    area = _plan_area(nodes, dimension)
    warnings: List[str] = []
    if area <= 1.0:
        warnings.append("Plan area could not be fully inferred; used a 1 m tributary width for preliminary seismic mass.")
    loads = _story_floor_loads(payload, 8.0, len(levels))
    if not payload.get("stories"):
        warnings.append("No story floor-load records were found; assumed 8.0 kN/m2 seismic weight for preliminary modal mass.")
    masses: List[Dict[str, float]] = []
    for index, level in enumerate(levels):
        weight = loads[index] * area
        masses.append({
            "story": f"F{index + 1}",
            "elevation": float(level),
            "weightKN": round(weight, 6),
            "mass": round(weight / G_ACCEL, 6),
        })
    return masses, warnings


def _assign_masses(ops: Any, nodes: List[Any], floor_masses: List[Dict[str, float]], dimension: str, node_tags: Dict[str, int]) -> None:
    for floor in floor_masses:
        elevation = floor["elevation"]
        level_nodes = [node for node in nodes if abs(float(_field(node, "z", 0.0) or 0.0) - elevation) <= 1e-6]
        if not level_nodes:
            continue
        node_mass = float(floor["mass"]) / len(level_nodes)
        for node in level_nodes:
            tag = node_tags[_node_key(node)]
            if dimension == "2d":
                ops.mass(tag, node_mass, 0.0, 0.0)
            else:
                ops.mass(tag, node_mass, node_mass, 0.0, 0.0, 0.0, 0.0)


def _restraints_for_node(node: Any, dimension: str) -> List[int]:
    restraints = _field(node, "restraints", None)
    if isinstance(restraints, list) and restraints:
        values = [int(bool(item)) for item in restraints]
    else:
        values = [0, 0, 0, 0, 0, 0]
    if dimension == "2d":
        return [values[0], values[2], values[4]]
    return (values + [0, 0, 0, 0, 0, 0])[:6]


def _reference_vector(start: Any, end: Any) -> List[float]:
    axis = np.array([
        float(_field(end, "x", 0.0) or 0.0) - float(_field(start, "x", 0.0) or 0.0),
        float(_field(end, "y", 0.0) or 0.0) - float(_field(start, "y", 0.0) or 0.0),
        float(_field(end, "z", 0.0) or 0.0) - float(_field(start, "z", 0.0) or 0.0),
    ])
    norm = float(np.linalg.norm(axis))
    if norm <= 0.0:
        return [0.0, 0.0, 1.0]
    axis /= norm
    ref = np.array([0.0, 0.0, 1.0])
    if abs(float(np.dot(axis, ref))) > 0.95:
        ref = np.array([0.0, 1.0, 0.0])
    return ref.tolist()


def _build_opensees_model(ops: Any, payload: Dict[str, Any], model: Any, basis: SeismicDesignBasis, direction: str) -> Tuple[str, Dict[str, int], List[Dict[str, float]]]:
    nodes = _records(payload, model, "nodes")
    elements = _records(payload, model, "elements")
    sections = _section_map(_records(payload, model, "sections"))
    materials = _material_map(_records(payload, model, "materials"))
    node_lookup = {_node_key(node): node for node in nodes}
    dimension = _model_dimension(nodes)
    floor_masses, _ = compute_floor_masses(payload, model, dimension)
    node_tags = {_node_key(node): index + 1 for index, node in enumerate(nodes)}

    ops.wipe()
    if dimension == "2d":
        ops.model("basic", "-ndm", 2, "-ndf", 3)
        for node in nodes:
            tag = node_tags[_node_key(node)]
            ops.node(tag, float(_field(node, "x", 0.0) or 0.0), float(_field(node, "z", 0.0) or 0.0))
            restraints = _restraints_for_node(node, dimension)
            if any(restraints):
                ops.fix(tag, *restraints)
    else:
        ops.model("basic", "-ndm", 3, "-ndf", 6)
        for node in nodes:
            tag = node_tags[_node_key(node)]
            ops.node(
                tag,
                float(_field(node, "x", 0.0) or 0.0),
                float(_field(node, "y", 0.0) or 0.0),
                float(_field(node, "z", 0.0) or 0.0),
            )
            restraints = _restraints_for_node(node, dimension)
            if any(restraints):
                ops.fix(tag, *restraints)

    _assign_masses(ops, nodes, floor_masses, dimension, node_tags)

    for index, element in enumerate(elements, start=1):
        element_type = _element_type(element)
        if not _is_opensees_line_element_type(element_type):
            continue
        element_nodes = _element_nodes(element)
        if len(element_nodes) < 2 or element_nodes[0] not in node_lookup or element_nodes[1] not in node_lookup:
            continue
        if _is_wall_line_element_type(element_type) and len(element_nodes) != 2:
            continue
        section = sections.get(str(_field(element, "section", "")))
        if section is None:
            continue
        material = materials.get(str(_field(element, "material", "")))
        area, iy, iz, torsion = _effective_section_properties(element_type, section)
        inertia = max(iy, iz, 1e-8)
        e_modulus = _material_e(material, section)
        tag = index
        if dimension == "2d":
            ops.geomTransf("Linear", tag)
            ops.element("elasticBeamColumn", tag, node_tags[element_nodes[0]], node_tags[element_nodes[1]], area, e_modulus, inertia, tag)
        else:
            start = node_lookup[element_nodes[0]]
            end = node_lookup[element_nodes[1]]
            ops.geomTransf("Linear", tag, *_reference_vector(start, end))
            ops.element(
                "elasticBeamColumn",
                tag,
                node_tags[element_nodes[0]],
                node_tags[element_nodes[1]],
                area,
                e_modulus,
                _material_g(material, section),
                torsion,
                max(iy, 1e-8),
                max(iz, 1e-8),
                tag,
            )

    return dimension, node_tags, floor_masses


def _fallback_modes(payload: Dict[str, Any], model: Any, basis: SeismicDesignBasis, direction: str, modal_count: int) -> ModalAnalysis:
    nodes = _records(payload, model, "nodes")
    dimension = _model_dimension(nodes)
    floor_masses, warnings = compute_floor_masses(payload, model, dimension)
    total_mass = sum(floor["mass"] for floor in floor_masses)
    height = max(basis.height_m, 3.0)
    t1 = max(0.08, 0.075 * (height ** 0.75))
    modes: List[Dict[str, Any]] = []
    participating_mass = 0.0
    target_ratios = [0.72, 0.15, 0.07, 0.03, 0.015, 0.01]
    elevations = [floor["elevation"] for floor in floor_masses]
    max_elevation = max(elevations) if elevations else 1.0
    for index in range(max(1, modal_count)):
        ratio = target_ratios[index] if index < len(target_ratios) else 0.0
        participating_mass += ratio * total_mass
        mode_number = index + 1
        period = t1 / (2 * index + 1)
        shape = [
            {
                "story": floor["story"],
                "elevation": floor["elevation"],
                "phi": round((floor["elevation"] / max_elevation) ** mode_number, 6),
            }
            for floor in floor_masses
        ]
        modes.append({
            "modeNumber": mode_number,
            "period": round(period, 6),
            "frequency": round(1.0 / period, 6),
            "omega": round(2.0 * math.pi / period, 6),
            "participationFactor": 1.0,
            "effectiveMass": round(ratio * total_mass, 6),
            "massParticipationRatio": round(ratio, 6),
            "cumulativeMassParticipationRatio": round(participating_mass / total_mass if total_mass > 0 else 0.0, 6),
            "storyShape": shape,
        })
    warnings.append("OpenSees eigen extraction failed; used a code-style equivalent shear-building modal approximation.")
    return ModalAnalysis(
        modes=modes,
        total_mass=round(total_mass, 6),
        floor_masses=floor_masses,
        model_dimension=dimension,
        direction=direction,
        engine_mode="equivalent_shear_building_fallback",
        warnings=warnings,
    )


def run_modal_analysis(model: Any, basis: SeismicDesignBasis, modal_count: int, direction: str = "x") -> ModalAnalysis:
    payload = model_payload(model)
    nodes = _records(payload, model, "nodes")
    if not nodes:
        raise RuntimeError("Cannot run seismic analysis without model nodes.")

    try:
        import openseespy.opensees as ops
    except Exception as error:
        from contracts import EngineNotAvailableError
        raise EngineNotAvailableError("builtin-opensees", f"OpenSeesPy is not available: {error}") from error

    dimension = "unknown"
    try:
        dimension, node_tags, floor_masses = _build_opensees_model(ops, payload, model, basis, direction)
        ops.system("FullGeneral")
        ops.numberer("RCM")
        ops.constraints("Transformation")
        dof_per_node = 3 if dimension == "2d" else 6
        free_dof = sum(
            dof_per_node - sum(_restraints_for_node(node, dimension))
            for node in nodes
        )
        lateral_dof = max(1, len(floor_masses) * (2 if dimension == "3d" else 1))
        requested_modes = min(max(1, int(modal_count)), lateral_dof, max(1, free_dof - 1))
        try:
            eigen_values = ops.eigen(requested_modes)
        except Exception:
            eigen_values = ops.eigen("-fullGenLapack", requested_modes)
        if not eigen_values:
            raise RuntimeError("OpenSees returned no eigenvalues.")

        total_mass = sum(floor["mass"] for floor in floor_masses)
        modes: List[Dict[str, Any]] = []
        cumulative = 0.0
        direction_index = 0 if direction.lower() == "x" else 1
        if dimension == "2d":
            direction_index = 0

        for mode_index, eigen_value in enumerate(eigen_values, start=1):
            if not math.isfinite(float(eigen_value)) or eigen_value <= 0:
                continue
            omega = math.sqrt(float(eigen_value))
            if not math.isfinite(omega) or omega <= 0.0:
                continue
            period = 2.0 * math.pi / omega
            numerator = 0.0
            denominator = 0.0
            story_shape: List[Dict[str, Any]] = []
            for floor in floor_masses:
                elevation = floor["elevation"]
                level_nodes = [
                    node for node in nodes
                    if abs(float(_field(node, "z", 0.0) or 0.0) - elevation) <= 1e-6
                ]
                phis: List[float] = []
                for node in level_nodes:
                    try:
                        vector = ops.nodeEigenvector(node_tags[_node_key(node)], mode_index)
                    except Exception:
                        vector = []
                    phi = float(vector[direction_index]) if len(vector) > direction_index else 0.0
                    if not math.isfinite(phi):
                        phi = 0.0
                    phis.append(phi)
                phi_avg = sum(phis) / len(phis) if phis else 0.0
                mass = float(floor["mass"])
                numerator += mass * phi_avg
                denominator += mass * phi_avg * phi_avg
                story_shape.append({
                    "story": floor["story"],
                    "elevation": elevation,
                    "phi": round(phi_avg, 8),
                })
            participation = numerator / denominator if denominator > 0.0 else 0.0
            effective_mass = participation * participation * denominator
            ratio = effective_mass / total_mass if total_mass > 0.0 else 0.0
            if not all(math.isfinite(value) for value in (participation, effective_mass, ratio)):
                continue
            cumulative += ratio
            modes.append({
                "modeNumber": mode_index,
                "period": round(period, 6),
                "frequency": round(1.0 / period, 6),
                "omega": round(omega, 6),
                "participationFactor": round(participation, 6),
                "effectiveMass": round(effective_mass, 6),
                "massParticipationRatio": round(ratio, 6),
                "cumulativeMassParticipationRatio": round(cumulative, 6),
                "storyShape": story_shape,
            })
        ops.wipe()
        if not modes:
            raise RuntimeError("No valid positive OpenSees eigen modes were extracted.")
        return ModalAnalysis(
            modes=modes,
            total_mass=round(total_mass, 6),
            floor_masses=floor_masses,
            model_dimension=dimension,
            direction=direction,
            engine_mode="opensees_eigen",
            warnings=[],
        )
    except Exception:
        try:
            ops.wipe()
        except Exception:
            pass
        return _fallback_modes(payload, model, basis, direction, modal_count)
