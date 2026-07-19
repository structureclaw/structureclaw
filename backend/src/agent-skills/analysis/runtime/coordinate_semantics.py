"""Canonical coordinate contract shared by structural-analysis engines.

StructureClaw uses one right-handed global system: X/Y are horizontal and Z
is vertical.  Every 2-D model lies in the global X-Z plane and therefore uses
the active DOFs ``ux, uz, ry``.  Loads are global unless they explicitly say
``reference_frame=element-local``.  Solver adapters must transform loads at
their boundary; they must never infer a different plane or silently exchange
Y and Z components.
"""

from __future__ import annotations

import math
from typing import Any, Iterable, Mapping, Sequence

import numpy as np


CANONICAL_COORDINATE_SEMANTICS = "global-z-up"
COORDINATE_CONTRACT_VERSION = 1
GLOBAL_DOF_ORDER = ("ux", "uy", "uz", "rx", "ry", "rz")
PLANAR_XZ_ACTIVE_DOFS = ("ux", "uz", "ry")
PLANAR_XZ_RESTRAINT_INDICES = (0, 2, 4)
COORDINATE_TOLERANCE = 1e-9


def _resolve_entity_alias(
    record: Mapping[str, Any], keys: Sequence[str], label: str
) -> str | None:
    values = [str(record[key]) for key in keys if record.get(key) is not None]
    if any(not value for value in values):
        raise ValueError(f"{label} must have a non-empty id")
    unique = set(values)
    if len(unique) > 1:
        raise ValueError(f"{label} contains conflicting aliases")
    return values[0] if values else None


def _model_dict(model: Any) -> dict[str, Any]:
    if isinstance(model, dict):
        return model
    if hasattr(model, "model_dump"):
        value = model.model_dump(mode="python")
        return value if isinstance(value, dict) else {}
    return {}


def get_model_metadata(model: Any) -> dict[str, Any]:
    """Return the model's metadata dictionary, or an empty dictionary."""
    metadata = _model_dict(model).get("metadata")
    return metadata if isinstance(metadata, dict) else {}


def get_coordinate_system(model: Any) -> dict[str, Any]:
    """Return the typed coordinate-system record when present."""
    value = _model_dict(model).get("coordinate_system")
    return value if isinstance(value, dict) else {}


def get_frame_dimension(metadata: Mapping[str, Any]):
    """Backward-compatible metadata lookup used by older adapters."""
    value = metadata.get("frameDimension")
    return value if value in {"2d", "3d"} else None


def resolve_model_dimension(model: Any) -> str:
    """Return dimensionality from the mandatory typed coordinate contract."""
    model_data = _model_dict(model)
    coordinate_system = get_coordinate_system(model_data)
    declared = coordinate_system.get("dimension")
    if declared in {"2d", "3d"}:
        return str(declared)
    raise ValueError(
        "A V2 structural model must declare coordinate_system.dimension as '2d' or '3d'"
    )


def coordinate_contract_metadata(model: Any) -> dict[str, Any]:
    """Metadata attached to every analysis result."""
    dimension = resolve_model_dimension(model)
    return {
        "coordinateSemantics": CANONICAL_COORDINATE_SEMANTICS,
        "coordinateContractVersion": COORDINATE_CONTRACT_VERSION,
        "dimension": dimension,
        "plane": "xz" if dimension == "2d" else None,
        "dofOrder": list(GLOBAL_DOF_ORDER),
        "activeDofs": list(PLANAR_XZ_ACTIVE_DOFS if dimension == "2d" else GLOBAL_DOF_ORDER),
        "nodalResultFrame": "global",
        "elementForceFrame": "element-local",
    }


def validate_coordinate_contract(model: Any) -> None:
    """Reject coordinate/load ambiguity before it reaches a solver."""
    model_data = _model_dict(model)
    coordinate_system = get_coordinate_system(model_data)
    metadata = get_model_metadata(model_data)

    if not coordinate_system:
        raise ValueError(
            "A V2 structural model must include the typed coordinate_system contract"
        )

    semantics = coordinate_system.get("semantics")
    if semantics != CANONICAL_COORDINATE_SEMANTICS:
        raise ValueError(
            f"Unsupported coordinate semantics '{semantics}'; expected "
            f"'{CANONICAL_COORDINATE_SEMANTICS}'"
        )

    version = coordinate_system.get("version")
    if version != COORDINATE_CONTRACT_VERSION:
        raise ValueError(
            f"Unsupported coordinate contract version '{version}'; expected "
            f"{COORDINATE_CONTRACT_VERSION}"
        )
    declared_dimension = coordinate_system.get("dimension")
    if declared_dimension not in {"2d", "3d"}:
        raise ValueError("coordinate_system.dimension must be '2d' or '3d'")
    dof_order = coordinate_system.get("dof_order")
    normalized_dof_order = list(dof_order) if isinstance(dof_order, (list, tuple)) else None
    if normalized_dof_order != list(GLOBAL_DOF_ORDER):
        raise ValueError(f"coordinate_system.dof_order must be {list(GLOBAL_DOF_ORDER)}")

    metadata_semantics = metadata.get("coordinateSemantics")
    if metadata_semantics not in {None, CANONICAL_COORDINATE_SEMANTICS}:
        raise ValueError(
            f"Metadata coordinateSemantics '{metadata_semantics}' conflicts with the canonical contract"
        )
    metadata_version = metadata.get("coordinateContractVersion")
    if metadata_version not in {None, COORDINATE_CONTRACT_VERSION}:
        raise ValueError(
            f"Metadata coordinateContractVersion '{metadata_version}' conflicts with the canonical contract"
        )

    dimension = resolve_model_dimension(model_data)
    metadata_dimension = get_frame_dimension(metadata)
    if metadata.get("frameDimension") is not None and metadata_dimension is None:
        raise ValueError("metadata.frameDimension must be '2d' or '3d'")
    if metadata_dimension is not None and metadata_dimension != dimension:
        raise ValueError(
            f"metadata.frameDimension '{metadata_dimension}' conflicts with coordinate_system.dimension '{dimension}'"
        )
    plane = coordinate_system.get("plane")
    if dimension == "2d" and plane != "xz":
        raise ValueError("Canonical 2-D structures must declare the global X-Z plane")
    if dimension == "3d" and plane is not None:
        raise ValueError("A 3-D structure cannot declare a 2-D analysis plane")

    nodes = model_data.get("nodes")
    node_ids: set[str] = set()
    node_coordinates: dict[str, tuple[float, float, float]] = {}
    if isinstance(nodes, list):
        for node in nodes:
            if not isinstance(node, dict):
                raise ValueError("Every node must be an object with finite global X/Y/Z coordinates")
            node_id = str(node.get("id", ""))
            if not node_id:
                raise ValueError("Every node must have a non-empty id")
            if node_id in node_ids:
                raise ValueError(f"Duplicate node id '{node_id}'")
            node_ids.add(node_id)
            try:
                coordinates = [float(node[axis]) for axis in ("x", "y", "z")]
            except (KeyError, TypeError, ValueError) as error:
                raise ValueError(
                    f"Node '{node_id}' must provide finite global X/Y/Z coordinates"
                ) from error
            if not all(math.isfinite(value) for value in coordinates):
                raise ValueError(f"Node '{node_id}' must provide finite global X/Y/Z coordinates")
            node_coordinates[node_id] = (coordinates[0], coordinates[1], coordinates[2])
            if dimension == "2d" and abs(coordinates[1]) > COORDINATE_TOLERANCE:
                raise ValueError(
                    f"Node '{node_id}' has non-zero global Y in a canonical X-Z 2-D model"
                )
            restraints = node.get("restraints")
            if restraints is not None and (
                not isinstance(restraints, list)
                or len(restraints) != len(GLOBAL_DOF_ORDER)
                or any(type(value) is not bool for value in restraints)
            ):
                raise ValueError(
                    f"Node '{node_id}' restraints must contain six booleans in ux/uy/uz/rx/ry/rz order"
                )

    element_ids: set[str] = set()
    element_directions: dict[str, tuple[float, float, float]] = {}
    elements = model_data.get("elements", [])
    if isinstance(elements, list):
        for element in elements:
            if not isinstance(element, dict):
                raise ValueError("Every element must be an object")
            element_id = str(element.get("id", ""))
            if not element_id:
                raise ValueError("Every element must have a non-empty id")
            if element_id in element_ids:
                raise ValueError(f"Duplicate element id '{element_id}'")
            element_ids.add(element_id)
            element_nodes = element.get("nodes")
            if not isinstance(element_nodes, list) or len(element_nodes) < 2:
                raise ValueError(f"Element '{element_id}' must reference at least two nodes")
            if any(str(node_id) not in node_ids for node_id in element_nodes):
                raise ValueError(f"Element '{element_id}' references an unknown node")
            start = node_coordinates[str(element_nodes[0])]
            end = node_coordinates[str(element_nodes[1])]
            direction = (
                end[0] - start[0],
                end[1] - start[1],
                end[2] - start[2],
            )
            if math.sqrt(sum(value * value for value in direction)) <= COORDINATE_TOLERANCE:
                raise ValueError(f"Element '{element_id}' has zero length")
            element_directions[element_id] = direction
            try:
                rotation = float(element.get("rotation_angle", 0.0) or 0.0)
            except (TypeError, ValueError) as error:
                raise ValueError(f"Element '{element_id}' rotation_angle must be finite") from error
            if not math.isfinite(rotation):
                raise ValueError(f"Element '{element_id}' rotation_angle must be finite")
            if dimension == "2d" and abs(rotation) > COORDINATE_TOLERANCE:
                raise ValueError(
                    f"Element '{element_id}' cannot rotate its section axes in a canonical 2-D model"
                )

    reference_vectors = metadata.get("elementReferenceVectors")
    if reference_vectors is not None:
        if dimension == "2d":
            raise ValueError(
                "Canonical 2-D local axes are fixed; elementReferenceVectors are not allowed"
            )
        if not isinstance(reference_vectors, dict):
            raise ValueError("metadata.elementReferenceVectors must be an object")
        for element_id, raw_vector in reference_vectors.items():
            normalized_id = str(element_id)
            direction = element_directions.get(normalized_id)
            if direction is None:
                raise ValueError(f"Reference vector targets unknown element '{normalized_id}'")
            try:
                vector = _vector3(raw_vector, f"Element '{normalized_id}' reference vector")
            except (TypeError, ValueError) as error:
                raise ValueError(
                    f"Element '{normalized_id}' reference vector must contain three finite numbers"
                ) from error
            direction_vector = np.asarray(direction, dtype=float)
            vector_length = float(np.linalg.norm(vector))
            direction_length = float(np.linalg.norm(direction_vector))
            if (
                vector_length <= COORDINATE_TOLERANCE
                or float(np.linalg.norm(np.cross(vector, direction_vector)))
                / (vector_length * direction_length) <= COORDINATE_TOLERANCE
            ):
                raise ValueError(
                    f"Element '{normalized_id}' reference vector cannot be zero or parallel to its axis"
                )

    for load_case in model_data.get("load_cases", []):
        if not isinstance(load_case, dict):
            continue
        for load in load_case.get("loads", []):
            if not isinstance(load, dict):
                continue
            reference_frame = load.get("reference_frame", "global")
            if reference_frame not in {"global", "element-local"}:
                raise ValueError(
                    f"Load reference_frame must be 'global' or 'element-local', got '{reference_frame}'"
                )
            node_id = _resolve_entity_alias(
                load, ("node", "nodeId", "node_id"), "Nodal load target"
            )
            element_id = _resolve_entity_alias(
                load, ("element", "elementId", "element_id"), "Member load target"
            )
            if (node_id is None) == (element_id is None):
                raise ValueError("Every structural load must target exactly one node or element")
            if node_id is not None and node_id not in node_ids:
                raise ValueError(f"Load references unknown node '{node_id}'")
            if element_id is not None and element_id not in element_ids:
                raise ValueError(f"Load references unknown element '{element_id}'")
            legacy_component_names = [
                key for key in (
                    "Fx", "Fy", "Fz", "Mx", "My", "Mz",
                    "momentX", "momentY", "momentZ",
                )
                if key in load
            ]
            if legacy_component_names:
                raise ValueError(
                    "V2 load components must use lowercase fx/fy/fz/mx/my/mz: "
                    + ", ".join(legacy_component_names)
                )
            if node_id is not None and any(key in load for key in ("wx", "wy", "wz")):
                raise ValueError(
                    "Nodal loads must use fx/fy/fz and mx/my/mz, not member-load w components"
                )
            if element_id is not None and any(
                key in load for key in ("fx", "fy", "fz", "mx", "my", "mz", "forces")
            ):
                raise ValueError(
                    "Member loads must use wx/wy/wz, not nodal force or moment components"
                )
            if reference_frame == "element-local" and element_id is None:
                raise ValueError("Only member loads may use reference_frame='element-local'")

            numeric_keys = (
                "fx", "fy", "fz", "mx", "my", "mz",
                "wx", "wy", "wz",
            )
            for key in numeric_keys:
                if key not in load or load.get(key) is None:
                    continue
                try:
                    value = float(load[key])
                except (TypeError, ValueError) as error:
                    raise ValueError(f"Load component '{key}' must be finite") from error
                if not math.isfinite(value):
                    raise ValueError(f"Load component '{key}' must be finite")
            forces = load.get("forces")
            if forces is not None:
                if any(
                    key in load
                    for key in (
                        "fx", "fy", "fz", "mx", "my", "mz",
                        "value", "magnitude", "direction", "axis",
                    )
                ):
                    raise ValueError(
                        "Nodal load forces cannot be combined with component or directional aliases"
                    )
                if not isinstance(forces, list) or len(forces) != len(GLOBAL_DOF_ORDER):
                    raise ValueError("Load forces must contain [fx, fy, fz, mx, my, mz]")
                try:
                    finite_forces = [float(value) for value in forces]
                except (TypeError, ValueError) as error:
                    raise ValueError("Load forces must contain six finite values") from error
                if not all(math.isfinite(value) for value in finite_forces):
                    raise ValueError("Load forces must contain six finite values")

            if dimension == "2d" and reference_frame == "element-local":
                if abs(float(load.get("wy", 0.0) or 0.0)) > COORDINATE_TOLERANCE:
                    raise ValueError("Local wy is out of plane for a canonical X-Z 2-D member load")
                continue
            if dimension == "2d":
                inactive = {
                    "fy": load.get("fy", 0.0),
                    "mx": load.get("mx", 0.0),
                    "mz": load.get("mz", 0.0),
                    "wy": load.get("wy", 0.0),
                }
                if isinstance(forces, list) and len(forces) == len(GLOBAL_DOF_ORDER):
                    inactive.update({
                        "forces[1]": forces[1],
                        "forces[3]": forces[3],
                        "forces[5]": forces[5],
                    })
                nonzero = [
                    key for key, value in inactive.items()
                    if abs(float(value or 0.0)) > COORDINATE_TOLERANCE
                ]
                if nonzero:
                    raise ValueError(
                        "Out-of-plane load components are not allowed in a canonical X-Z 2-D model: "
                        + ", ".join(nonzero)
                    )


def get_reference_vector(metadata: Mapping[str, Any], element_id: str):
    """Look up a legacy OpenSees ``vecxz`` reference for an element."""
    vectors = metadata.get("elementReferenceVectors")
    if not isinstance(vectors, dict):
        return None
    value = vectors.get(element_id)
    if isinstance(value, list) and len(value) == 3:
        return [float(value[0]), float(value[1]), float(value[2])]
    return None


def _vector3(value: Sequence[float], label: str) -> np.ndarray:
    if len(value) != 3:
        raise ValueError(f"{label} must contain exactly three components")
    vector = np.asarray([float(component) for component in value], dtype=float)
    if not np.all(np.isfinite(vector)):
        raise ValueError(f"{label} must contain finite components")
    return vector


def build_element_local_axes(
    start: Sequence[float],
    end: Sequence[float],
    reference_vector: Sequence[float] | None = None,
    rotation_degrees: float | None = None,
) -> np.ndarray:
    """Build a right-handed global-to-local direction-cosine matrix.

    Rows are the element-local X/Y/Z unit axes expressed in global
    coordinates.  The reference vector follows OpenSees ``vecxz`` semantics.
    """
    start_vector = _vector3(start, "Element start")
    end_vector = _vector3(end, "Element end")
    axis = end_vector - start_vector
    length = float(np.linalg.norm(axis))
    if length <= COORDINATE_TOLERANCE:
        raise ValueError("Cannot construct local axes for a zero-length element")
    local_x = axis / length

    if reference_vector is None:
        reference = np.array([0.0, 0.0, 1.0], dtype=float)
        if abs(float(np.dot(local_x, reference))) > 0.9:
            reference = np.array([1.0, 0.0, 0.0], dtype=float)
    else:
        reference = _vector3(reference_vector, "Element reference vector")

    reference_norm = float(np.linalg.norm(reference))
    if reference_norm <= COORDINATE_TOLERANCE:
        raise ValueError("Element reference vector cannot be zero")
    reference /= reference_norm

    local_y = np.cross(reference, local_x)
    local_y_norm = float(np.linalg.norm(local_y))
    if local_y_norm <= COORDINATE_TOLERANCE:
        raise ValueError("Element reference vector cannot be parallel to the element axis")
    local_y /= local_y_norm
    local_z = np.cross(local_x, local_y)
    local_z /= float(np.linalg.norm(local_z))

    angle = float(rotation_degrees or 0.0)
    if abs(angle) > COORDINATE_TOLERANCE:
        radians = math.radians(angle)
        cosine = math.cos(radians)
        sine = math.sin(radians)
        rotated_y = cosine * local_y + sine * local_z
        rotated_z = -sine * local_y + cosine * local_z
        local_y, local_z = rotated_y, rotated_z

    axes = np.vstack([local_x, local_y, local_z])
    if not np.allclose(axes @ axes.T, np.eye(3), atol=1e-10):
        raise ValueError("Element local axes are not orthonormal")
    if float(np.linalg.det(axes)) < 1.0 - 1e-10:
        raise ValueError("Element local axes are not right-handed")
    return axes


def transform_global_vector_to_local(
    vector: Sequence[float],
    local_axes: np.ndarray,
) -> tuple[float, float, float]:
    """Transform a global vector into the supplied element-local axes."""
    global_vector = _vector3(vector, "Global vector")
    axes = np.asarray(local_axes, dtype=float)
    if axes.shape != (3, 3):
        raise ValueError("local_axes must be a 3x3 direction-cosine matrix")
    local = axes @ global_vector
    return float(local[0]), float(local[1]), float(local[2])


def transform_local_vector_to_global(
    vector: Sequence[float],
    local_axes: np.ndarray,
) -> tuple[float, float, float]:
    """Transform an element-local vector into global coordinates."""
    local_vector = _vector3(vector, "Local vector")
    axes = np.asarray(local_axes, dtype=float)
    if axes.shape != (3, 3):
        raise ValueError("local_axes must be a 3x3 direction-cosine matrix")
    global_vector = axes.T @ local_vector
    return float(global_vector[0]), float(global_vector[1]), float(global_vector[2])


def planar_xz_local_components(
    global_vector: Sequence[float],
    start: Sequence[float],
    end: Sequence[float],
) -> tuple[float, float]:
    """Return local axial/transverse components for an X-Z plane member."""
    vector = _vector3(global_vector, "Global vector")
    start_vector = _vector3(start, "Element start")
    end_vector = _vector3(end, "Element end")
    axis = end_vector - start_vector
    if abs(float(axis[1])) > COORDINATE_TOLERANCE:
        raise ValueError("A canonical X-Z plane element cannot vary in global Y")
    length = math.hypot(float(axis[0]), float(axis[2]))
    if length <= COORDINATE_TOLERANCE:
        raise ValueError("Cannot project a load onto a zero-length element")
    local_x = np.array([axis[0] / length, 0.0, axis[2] / length])
    local_y = np.array([-axis[2] / length, 0.0, axis[0] / length])
    return float(np.dot(vector, local_x)), float(np.dot(vector, local_y))


def nonzero_components(values: Iterable[float], tolerance: float = COORDINATE_TOLERANCE) -> bool:
    return any(abs(float(value)) > tolerance for value in values)
