from __future__ import annotations

import math
from typing import Any, Dict, List, Tuple

import numpy as np

from coordinate_semantics import (
    build_element_local_axes,
    coordinate_contract_metadata,
    get_model_metadata,
    get_reference_vector,
    resolve_model_dimension,
    validate_coordinate_contract,
)


FRAME_ELEMENT_TYPES = {"beam", "column"}
TRUSS_ELEMENT_TYPES = {"truss", "brace"}


class OpenSeesDynamicExecutor:
    """OpenSees modal and linear time-history execution in canonical axes."""

    def __init__(self, analyzer):
        self.analyzer = analyzer
        self.model = analyzer.model
        validate_coordinate_contract(self.model)
        self.dimension = resolve_model_dimension(self.model)
        self.nodes = {str(node.id): node for node in self.model.nodes}
        self.materials = {str(material.id): material for material in self.model.materials}
        self.sections = {str(section.id): section for section in self.model.sections}
        self.has_frame_elements = any(
            str(element.type).lower() in FRAME_ELEMENT_TYPES for element in self.model.elements
        )
        self.frame_node_ids = {
            str(node_id)
            for element in self.model.elements
            if str(element.type).lower() in FRAME_ELEMENT_TYPES
            for node_id in element.nodes
        }
        self.node_masses: Dict[str, float] = {}

    @staticmethod
    def _field(record: Any, key: str, default: Any = None) -> Any:
        if isinstance(record, dict):
            return record.get(key, default)
        return getattr(record, key, default)

    def _section_property(self, section: Any, key: str) -> float:
        properties = self._field(section, "properties", {}) or {}
        value = properties.get(key) if isinstance(properties, dict) else None
        try:
            number = float(value)
        except (TypeError, ValueError):
            number = 0.0
        if not math.isfinite(number) or number <= 0.0:
            raise ValueError(f"Section '{self._field(section, 'id', '?')}' requires {key} > 0")
        return number

    def _material_properties(self, material: Any) -> Tuple[float, float, float]:
        elastic_modulus = float(self._field(material, "E", 0.0)) * 1000.0
        poisson_ratio = float(self._field(material, "nu", 0.0))
        density = float(self._field(material, "rho", 0.0))
        if (
            not math.isfinite(elastic_modulus)
            or not math.isfinite(poisson_ratio)
            or not math.isfinite(density)
            or elastic_modulus <= 0.0
            or density <= 0.0
            or poisson_ratio < 0.0
            or poisson_ratio > 0.5
        ):
            raise ValueError(
                f"Material '{self._field(material, 'id', '?')}' requires finite E/rho > 0 and 0 <= nu <= 0.5"
            )
        shear_modulus = elastic_modulus / (2.0 * (1.0 + poisson_ratio))
        return elastic_modulus, shear_modulus, density

    def _element_axes(self, element: Any) -> np.ndarray:
        start = self.nodes[str(element.nodes[0])]
        end = self.nodes[str(element.nodes[1])]
        reference = get_reference_vector(get_model_metadata(self.model), str(element.id))
        return build_element_local_axes(
            [start.x, start.y, start.z],
            [end.x, end.y, end.z],
            reference,
            self._field(element, "rotation_angle"),
        )

    def _element_length(self, element: Any) -> float:
        start = self.nodes[str(element.nodes[0])]
        end = self.nodes[str(element.nodes[1])]
        length = math.sqrt(
            (float(end.x) - float(start.x)) ** 2
            + (float(end.y) - float(start.y)) ** 2
            + (float(end.z) - float(start.z)) ** 2
        )
        if length <= 0.0:
            raise ValueError(f"Element '{element.id}' has zero length")
        return length

    def _direction_dof(self, direction: str) -> Tuple[str, int, int]:
        normalized = str(direction or "x").strip().lower()
        if self.dimension == "2d":
            mapping = {"x": (1, 0), "z": (2, 2)}
        else:
            mapping = {"x": (1, 0), "y": (2, 1), "z": (3, 2)}
        if normalized not in mapping:
            allowed = ", ".join(mapping)
            raise ValueError(f"Direction '{direction}' is inactive for a {self.dimension} model; expected {allowed}")
        opensees_dof, global_index = mapping[normalized]
        return normalized, opensees_dof, global_index

    def _build_model(self, ops) -> float:
        ops.wipe()
        if self.dimension == "2d":
            ops.model("basic", "-ndm", 2, "-ndf", 3 if self.has_frame_elements else 2)
        else:
            ops.model("basic", "-ndm", 3, "-ndf", 6 if self.has_frame_elements else 3)

        for node in self.model.nodes:
            tag = self.analyzer._ops_node_tag(node.id)
            if self.dimension == "2d":
                ops.node(tag, float(node.x), float(node.z))
                restraints = list(node.restraints or [False] * 6)
                projected = [int(restraints[0]), int(restraints[2])]
                if self.has_frame_elements:
                    projected.append(int(restraints[4]) if str(node.id) in self.frame_node_ids else 1)
                ops.fix(tag, *projected)
            else:
                ops.node(tag, float(node.x), float(node.y), float(node.z))
                restraints = list(node.restraints or [False] * 6)
                projected = list(restraints) if self.has_frame_elements else list(restraints[:3])
                if self.has_frame_elements and str(node.id) not in self.frame_node_ids:
                    projected[3:6] = [True, True, True]
                ops.fix(tag, *[int(value) for value in projected])

        for material in self.model.materials:
            elastic_modulus, _, _ = self._material_properties(material)
            ops.uniaxialMaterial("Elastic", self.analyzer._ops_material_tag(material.id), elastic_modulus)

        node_masses = {str(node.id): 0.0 for node in self.model.nodes}
        for element in self.model.elements:
            element_type = str(element.type).lower()
            if element_type not in FRAME_ELEMENT_TYPES | TRUSS_ELEMENT_TYPES:
                raise ValueError(f"Dynamic analysis does not support element type '{element.type}'")
            material = self.materials[str(element.material)]
            section = self.sections[str(element.section)]
            area = self._section_property(section, "A")
            elastic_modulus, shear_modulus, density = self._material_properties(material)
            length = self._element_length(element)
            # kN-s²/m uses tonne as its mass unit; rho is stored in kg/m³.
            half_mass = density * area * length / 2000.0
            node_masses[str(element.nodes[0])] += half_mass
            node_masses[str(element.nodes[1])] += half_mass

            element_tag = self.analyzer._ops_element_tag(element.id)
            start_tag = self.analyzer._ops_node_tag(element.nodes[0])
            end_tag = self.analyzer._ops_node_tag(element.nodes[1])
            if element_type in TRUSS_ELEMENT_TYPES:
                ops.element(
                    "truss",
                    element_tag,
                    start_tag,
                    end_tag,
                    area,
                    self.analyzer._ops_material_tag(material.id),
                )
                continue

            if self.dimension == "2d":
                inertia_y = self._section_property(section, "Iy")
                ops.geomTransf("Linear", element_tag)
                ops.element(
                    "elasticBeamColumn",
                    element_tag,
                    start_tag,
                    end_tag,
                    area,
                    elastic_modulus,
                    inertia_y,
                    element_tag,
                )
            else:
                inertia_y = self._section_property(section, "Iy")
                inertia_z = self._section_property(section, "Iz")
                torsion = self._section_property(section, "J")
                local_z = self._element_axes(element)[2]
                ops.geomTransf("Linear", element_tag, *local_z.tolist())
                ops.element(
                    "elasticBeamColumn",
                    element_tag,
                    start_tag,
                    end_tag,
                    area,
                    elastic_modulus,
                    shear_modulus,
                    torsion,
                    inertia_y,
                    inertia_z,
                    element_tag,
                )

        total_mass = sum(node_masses.values())
        if total_mass <= 0.0:
            raise ValueError("Dynamic analysis requires positive structural mass")
        self.node_masses = dict(node_masses)
        for node in self.model.nodes:
            mass = node_masses[str(node.id)]
            tag = self.analyzer._ops_node_tag(node.id)
            if self.dimension == "2d":
                if self.has_frame_elements:
                    ops.mass(tag, mass, mass, 0.0)
                else:
                    ops.mass(tag, mass, mass)
            else:
                if self.has_frame_elements:
                    ops.mass(tag, mass, mass, mass, 0.0, 0.0, 0.0)
                else:
                    ops.mass(tag, mass, mass, mass)
        return total_mass

    def _global_mode_vector(self, vector: Any) -> List[float]:
        values = [float(value) for value in list(vector)]
        required = 2 if self.dimension == "2d" else 3
        if len(values) < required or not all(math.isfinite(value) for value in values[:required]):
            raise ValueError(f"OpenSees returned an incomplete {self.dimension} mode-shape vector")
        if self.dimension == "2d":
            return [values[0], 0.0, values[1]]
        return values[:3]

    def _available_mass_dofs(self) -> int:
        active_indices = (0, 2) if self.dimension == "2d" else (0, 1, 2)
        count = 0
        for node in self.model.nodes:
            if self.node_masses.get(str(node.id), 0.0) <= 0.0:
                continue
            restraints = list(node.restraints or [False] * 6)
            count += sum(1 for index in active_indices if not bool(restraints[index]))
        return count

    def _eigen_values(self, ops: Any, requested_modes: int) -> List[float]:
        available_modes = self._available_mass_dofs()
        if available_modes <= 0:
            raise ValueError("Dynamic analysis requires at least one free translational mass DOF")
        count = min(max(1, int(requested_modes)), available_modes)
        last_error: Exception | None = None
        for arguments in ((count,), ("-fullGenLapack", count)):
            try:
                raw = ops.eigen(*arguments)
                values = [raw] if isinstance(raw, (int, float)) else list(raw or [])
                normalized = [float(value) for value in values]
                if not normalized:
                    raise ValueError("OpenSees returned no eigenvalues")
                if not all(math.isfinite(value) and value > 0.0 for value in normalized):
                    raise ValueError(
                        "Dynamic model has non-positive or non-finite eigenvalues; check stability and restraints"
                    )
                return normalized
            except Exception as error:
                last_error = error
        raise ValueError(f"OpenSees eigen extraction failed for {count} requested modes: {last_error}")

    def modal_analysis(self, num_modes: int, ops, direction: str = "x") -> Dict[str, Any]:
        selected_direction, _, _ = self._direction_dof(direction)
        total_mass = self._build_model(ops)
        ops.system("BandSPD")
        ops.numberer("RCM")
        ops.constraints("Transformation")

        eigen_values = self._eigen_values(ops, num_modes)
        modes = []
        for index, eigen_value in enumerate(eigen_values):
            omega = math.sqrt(float(eigen_value))
            mode_shape = {}
            for node in self.model.nodes:
                vector = ops.nodeEigenvector(self.analyzer._ops_node_tag(node.id), index + 1)
                mode_shape[str(node.id)] = self._global_mode_vector(vector)
            modes.append({
                "modeNumber": index + 1,
                "period": 2.0 * math.pi / omega,
                "frequency": omega / (2.0 * math.pi),
                "omega": omega,
                "modeShape": mode_shape,
                "modeShapeFrame": "global",
            })
        if not modes:
            raise ValueError("OpenSees returned no positive dynamic modes")

        result = {
            "status": "success",
            "totalMass": total_mass,
            "modes": modes,
            "direction": selected_direction,
            "meta": coordinate_contract_metadata(self.model),
        }
        ops.wipe()
        return result

    def time_history_analysis(
        self,
        time_step: float,
        duration: float,
        damping_ratio: float,
        ground_motion: List[float],
        ops,
        direction: str = "x",
    ) -> Dict[str, Any]:
        selected_direction, excitation_dof, global_index = self._direction_dof(direction)
        if not math.isfinite(time_step) or not math.isfinite(duration) or time_step <= 0.0 or duration <= 0.0:
            raise ValueError("timeStep and duration must be positive")
        if not math.isfinite(damping_ratio) or damping_ratio < 0.0 or damping_ratio >= 1.0:
            raise ValueError("dampingRatio must be in [0, 1)")
        self._build_model(ops)

        eigen_values = [value for value in self._eigen_values(ops, 2) if value > 0.0]
        if not eigen_values:
            raise ValueError("Cannot derive Rayleigh damping without a positive eigenvalue")
        omega_1 = math.sqrt(eigen_values[0])
        if len(eigen_values) > 1:
            omega_2 = math.sqrt(eigen_values[1])
            alpha_mass = 2.0 * damping_ratio * omega_1 * omega_2 / (omega_1 + omega_2)
            beta_stiffness = 2.0 * damping_ratio / (omega_1 + omega_2)
        else:
            alpha_mass = 2.0 * damping_ratio * omega_1
            beta_stiffness = 0.0
        ops.rayleigh(alpha_mass, beta_stiffness, 0.0, 0.0)

        if ground_motion:
            acceleration = [float(value) for value in ground_motion]
        else:
            times = np.arange(0.0, duration, time_step)
            acceleration = (0.1 * np.sin(2.0 * np.pi * times)).tolist()
        if not acceleration or not all(math.isfinite(value) for value in acceleration):
            raise ValueError("groundMotion must contain finite acceleration values")
        ops.timeSeries("Path", 1, "-dt", time_step, "-values", *acceleration)
        ops.pattern("UniformExcitation", 1, excitation_dof, "-accel", 1)
        ops.system("BandSPD")
        ops.numberer("RCM")
        ops.constraints("Transformation")
        ops.integrator("Newmark", 0.5, 0.25)
        ops.algorithm("Newton")
        ops.analysis("Transient")

        free_nodes = [
            node for node in self.model.nodes
            if not bool((list(node.restraints or [False] * 6))[global_index])
        ]
        monitor_node = max(
            free_nodes,
            key=lambda node: (float(node.z), float(node.y), float(node.x), str(node.id)),
            default=None,
        )
        if monitor_node is None:
            raise ValueError(f"No node is free in the selected global {selected_direction.upper()} direction")

        results = []
        current_time = 0.0
        num_steps = int(math.floor(duration / time_step))
        if num_steps < 1:
            raise ValueError("duration must include at least one complete time step")
        for _step in range(num_steps):
            analysis_code = int(ops.analyze(1, time_step))
            if analysis_code != 0:
                raise RuntimeError(
                    f"OpenSees transient analysis failed at t={current_time:.8g}s with code {analysis_code}"
                )
            current_time += time_step
            displacement = [float(value) for value in ops.nodeDisp(self.analyzer._ops_node_tag(monitor_node.id))]
            if self.dimension == "2d":
                if len(displacement) < 2:
                    raise ValueError("OpenSees returned an incomplete 2-D displacement vector")
                global_vector = [displacement[0], 0.0, displacement[1]]
            else:
                if len(displacement) < 3:
                    raise ValueError("OpenSees returned an incomplete 3-D displacement vector")
                global_vector = (displacement + [0.0, 0.0, 0.0])[:3]
            results.append({
                "time": current_time,
                "displacement": global_vector[global_index],
                "displacementVector": global_vector,
                "referenceFrame": "global",
            })

        peak = max(results, key=lambda record: abs(record["displacement"])) if results else None
        result = {
            "status": "success",
            "monitorNode": str(monitor_node.id),
            "responseScope": "selected-topmost-free-node",
            "direction": selected_direction,
            "maxDisplacement": abs(peak["displacement"]) if peak else 0.0,
            "signedDisplacementAtPeak": peak["displacement"] if peak else 0.0,
            "timeOfMaxDisp": peak["time"] if peak else 0.0,
            "timeHistory": results,
            "meta": coordinate_contract_metadata(self.model),
        }
        ops.wipe()
        return result
