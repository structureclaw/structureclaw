from __future__ import annotations

from copy import deepcopy
import math
from typing import Any, Dict


SUPPORTED_SCHEMA_VERSIONS = {
    "1.0.0",
    "1.0.1",
    "2.0.0",
}


def _number(value: Any) -> float:
    try:
        number = float(value or 0.0)
    except (TypeError, ValueError):
        return 0.0
    return number if math.isfinite(number) else 0.0


def _finite_number(value: Any, label: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{label} must be a finite number") from error
    if not math.isfinite(number):
        raise ValueError(f"{label} must be a finite number")
    return number


def _legacy_v1_uses_y_up(model: Dict[str, Any]) -> bool:
    metadata = model.get("metadata") if isinstance(model.get("metadata"), dict) else {}
    semantics = metadata.get("coordinateSemantics")
    if semantics == "global-z-up":
        return False
    if semantics in {"legacy-global-y-up", "global-y-up"}:
        return True
    nodes = model.get("nodes") if isinstance(model.get("nodes"), list) else []
    has_y_geometry = any(isinstance(node, dict) and abs(_number(node.get("y"))) > 1e-9 for node in nodes)
    has_z_geometry = any(isinstance(node, dict) and abs(_number(node.get("z"))) > 1e-9 for node in nodes)
    if has_y_geometry and not has_z_geometry:
        return True
    if has_z_geometry:
        return False

    # A collinear legacy beam has no geometric vertical-axis evidence.  V1
    # vertical loads used FY, while canonical V2 uses FZ.
    for load_case in model.get("load_cases", []):
        if not isinstance(load_case, dict):
            continue
        for load in load_case.get("loads", []):
            if not isinstance(load, dict):
                continue
            y_evidence = any(abs(_number(load.get(key))) > 1e-9 for key in ("fy", "wy", "mz"))
            z_evidence = any(abs(_number(load.get(key))) > 1e-9 for key in ("fz", "wz", "my"))
            if y_evidence and not z_evidence:
                return True
    return False


def _move_legacy_planar_component(record: Dict[str, Any], source: str, target: str) -> None:
    if source not in record:
        return
    source_value = _finite_number(record.get(source), f"Legacy load component '{source}'")
    target_value = (
        _finite_number(record.get(target), f"Legacy load component '{target}'")
        if target in record
        else 0.0
    )
    if abs(source_value) > 1e-9 and abs(target_value) > 1e-9:
        raise ValueError(
            f"Legacy planar load contains both '{source}' and '{target}'; coordinate intent is ambiguous"
        )
    if target not in record or abs(target_value) <= 1e-9:
        record[target] = source_value
    record[source] = 0.0


def _canonicalize_legacy_planar_load_aliases(model: Dict[str, Any]) -> None:
    """Map the historical 2-D FY/WY/MZ aliases onto canonical FZ/WZ/MY.

    Early V1 payloads frequently stored X-Z geometry while the solver accepted
    XY component names as aliases.  This migration is limited to untagged
    planar payloads; explicitly Z-up or genuine 3-D payloads are untouched.
    """
    metadata = model.get("metadata") if isinstance(model.get("metadata"), dict) else {}
    if metadata.get("coordinateSemantics") is not None:
        return
    nodes = model.get("nodes") if isinstance(model.get("nodes"), list) else []
    if any(isinstance(node, dict) and abs(_number(node.get("y"))) > 1e-9 for node in nodes):
        return

    migrated_any = False
    for load_case in model.get("load_cases", []):
        if not isinstance(load_case, dict):
            continue
        for load in load_case.get("loads", []):
            if not isinstance(load, dict):
                continue
            before = dict(load)
            _move_legacy_planar_component(load, "fy", "fz")
            _move_legacy_planar_component(load, "wy", "wz")
            _move_legacy_planar_component(load, "mz", "my")
            forces = load.get("forces")
            if isinstance(forces, list) and len(forces) >= 6:
                values = [
                    _finite_number(value, f"Legacy load forces[{index}]")
                    for index, value in enumerate(forces[:6])
                ]
                if abs(values[1]) > 1e-9 and abs(values[2]) > 1e-9:
                    raise ValueError("Legacy planar load forces contain both FY and FZ")
                if abs(values[5]) > 1e-9 and abs(values[4]) > 1e-9:
                    raise ValueError("Legacy planar load forces contain both MY and MZ")
                load["forces"] = [
                    values[0],
                    0.0,
                    values[2] if abs(values[2]) > 1e-9 else values[1],
                    0.0,
                    values[4] if abs(values[4]) > 1e-9 else values[5],
                    0.0,
                ]
            migrated_any = migrated_any or load != before

    if migrated_any:
        metadata["coordinate_load_alias_migration"] = {
            "from": "legacy-planar-fy-wy-mz-aliases",
            "to": "canonical-fz-wz-my",
        }
        model["metadata"] = metadata


def _rotate_y_up_vector(record: Dict[str, Any], keys: tuple[str, str, str]) -> None:
    """Rotate +90 degrees about global X: (x,y,z) -> (x,-z,y)."""
    x_key, y_key, z_key = keys
    if any(key in record for key in keys):
        x_value = _finite_number(record.get(x_key, 0.0), f"Legacy vector component '{x_key}'")
        y_value = _finite_number(record.get(y_key, 0.0), f"Legacy vector component '{y_key}'")
        z_value = _finite_number(record.get(z_key, 0.0), f"Legacy vector component '{z_key}'")
        record[x_key] = x_value
        record[y_key] = -z_value
        record[z_key] = y_value


def _canonicalize_v1_coordinates(model: Dict[str, Any]) -> None:
    if not _legacy_v1_uses_y_up(model):
        _canonicalize_legacy_planar_load_aliases(model)
        return

    for node in model.get("nodes", []):
        if not isinstance(node, dict):
            continue
        _rotate_y_up_vector(node, ("x", "y", "z"))
        restraints = node.get("restraints")
        if isinstance(restraints, list) and len(restraints) == 6:
            # Translational/rotational component positions follow the same
            # axis rotation; boolean constraints do not carry signs.
            restraints[1], restraints[2] = restraints[2], restraints[1]
            restraints[4], restraints[5] = restraints[5], restraints[4]

    for load_case in model.get("load_cases", []):
        if not isinstance(load_case, dict):
            continue
        for load in load_case.get("loads", []):
            if not isinstance(load, dict):
                continue
            _rotate_y_up_vector(load, ("fx", "fy", "fz"))
            _rotate_y_up_vector(load, ("wx", "wy", "wz"))
            _rotate_y_up_vector(load, ("mx", "my", "mz"))
            forces = load.get("forces")
            if isinstance(forces, list) and len(forces) >= 6:
                values = [
                    _finite_number(value, f"Legacy load forces[{index}]")
                    for index, value in enumerate(forces[:6])
                ]
                load["forces"] = [
                    values[0], -values[2], values[1],
                    values[3], -values[5], values[4],
                ]

    metadata = model.get("metadata") if isinstance(model.get("metadata"), dict) else {}
    reference_vectors = metadata.get("elementReferenceVectors")
    if isinstance(reference_vectors, dict):
        for element_id, value in list(reference_vectors.items()):
            if isinstance(value, list) and len(value) == 3:
                vector = [
                    _finite_number(component, f"Element '{element_id}' reference vector[{index}]")
                    for index, component in enumerate(value)
                ]
                reference_vectors[element_id] = [
                    vector[0], -vector[2], vector[1],
                ]
    metadata["coordinate_migration"] = {
        "from": "legacy-global-y-up",
        "to": "global-z-up",
        "transform": [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
    }
    metadata["coordinateSemantics"] = "global-z-up"
    model["metadata"] = metadata


def _move_legacy_load_family_component(
    record: Dict[str, Any],
    source: str,
    target: str,
) -> bool:
    if source not in record:
        return False
    source_value = _finite_number(record[source], f"Legacy load component '{source}'")
    target_value = (
        _finite_number(record[target], f"Legacy load component '{target}'")
        if target in record
        else 0.0
    )
    if abs(source_value) > 1e-9 and abs(target_value) > 1e-9:
        raise ValueError(
            f"Legacy load contains both '{source}' and '{target}'; component family is ambiguous"
        )
    if target not in record or abs(target_value) <= 1e-9:
        record[target] = source_value
    record.pop(source, None)
    return True


def _normalize_v1_load_component_families(model: Dict[str, Any]) -> None:
    """Move historical target-dependent aliases into the canonical V2 family."""
    migrated_any = False
    for load_case in model.get("load_cases", []):
        if not isinstance(load_case, dict):
            continue
        for load in load_case.get("loads", []):
            if not isinstance(load, dict):
                continue
            has_node = any(load.get(key) is not None for key in ("node", "nodeId", "node_id"))
            has_element = any(load.get(key) is not None for key in ("element", "elementId", "element_id"))
            if has_node and has_element:
                raise ValueError("A legacy load cannot target both a node and an element")
            if has_node:
                for source, target in (("wx", "fx"), ("wy", "fy"), ("wz", "fz")):
                    migrated_any = _move_legacy_load_family_component(load, source, target) or migrated_any
            elif has_element:
                if "forces" in load or any(key in load for key in ("mx", "my", "mz")):
                    raise ValueError(
                        "Legacy member loads cannot use nodal force arrays or moment components"
                    )
                for source, target in (("fx", "wx"), ("fy", "wy"), ("fz", "wz")):
                    migrated_any = _move_legacy_load_family_component(load, source, target) or migrated_any

    if migrated_any:
        metadata = model.get("metadata") if isinstance(model.get("metadata"), dict) else {}
        metadata["coordinate_load_family_migration"] = {
            "node": "w-components-to-f-components",
            "member": "f-components-to-w-components",
        }
        model["metadata"] = metadata


def _normalize_v1_load_component_names(model: Dict[str, Any]) -> None:
    migrated_any = False
    aliases = (
        ("Fx", "fx"), ("Fy", "fy"), ("Fz", "fz"),
        ("Mx", "mx"), ("My", "my"), ("Mz", "mz"),
        ("momentX", "mx"), ("momentY", "my"), ("momentZ", "mz"),
    )
    for load_case in model.get("load_cases", []):
        if not isinstance(load_case, dict):
            continue
        for load in load_case.get("loads", []):
            if not isinstance(load, dict):
                continue
            for source, target in aliases:
                migrated_any = _move_legacy_load_family_component(load, source, target) or migrated_any
    if migrated_any:
        metadata = model.get("metadata") if isinstance(model.get("metadata"), dict) else {}
        metadata["coordinate_load_name_migration"] = {
            "from": "legacy-component-aliases",
            "to": "lowercase-fx-fy-fz-mx-my-mz",
        }
        model["metadata"] = metadata


def _normalize_v1_nodal_force_representations(model: Dict[str, Any]) -> None:
    component_names = ("fx", "fy", "fz", "mx", "my", "mz")
    for load_case in model.get("load_cases", []):
        if not isinstance(load_case, dict):
            continue
        for load in load_case.get("loads", []):
            if not isinstance(load, dict) or "forces" not in load:
                continue
            has_node = any(load.get(key) is not None for key in ("node", "nodeId", "node_id"))
            if not has_node:
                continue
            forces = load.get("forces")
            if not isinstance(forces, list) or len(forces) != 6:
                raise ValueError("Legacy nodal load forces must contain six finite components")
            values = [
                _finite_number(value, f"Legacy load forces[{index}]")
                for index, value in enumerate(forces)
            ]
            for index, key in enumerate(component_names):
                if key not in load:
                    continue
                component = _finite_number(load[key], f"Legacy load component '{key}'")
                if abs(component - values[index]) > 1e-9:
                    raise ValueError(
                        f"Legacy nodal load '{key}' conflicts with forces[{index}]"
                    )
                load.pop(key, None)


def _stamp_coordinate_contract(model: Dict[str, Any]) -> None:
    metadata = model.get("metadata") if isinstance(model.get("metadata"), dict) else {}
    semantics = metadata.get("coordinateSemantics")
    if semantics not in {None, "global-z-up", "legacy-global-y-up", "global-y-up"}:
        raise ValueError(f"Unsupported coordinateSemantics '{semantics}'")
    if str(model.get("schema_version", "")).startswith("2") and semantics in {
        "legacy-global-y-up",
        "global-y-up",
    }:
        raise ValueError("A V2 payload cannot be stamped as canonical while declaring legacy Y-up coordinates")
    dimension = metadata.get("frameDimension")
    if dimension not in {"2d", "3d"}:
        nodes = model.get("nodes") if isinstance(model.get("nodes"), list) else []
        dimension = "3d" if any(
            isinstance(node, dict) and abs(_number(node.get("y"))) > 1e-9
            for node in nodes
        ) else "2d"
    metadata.update({
        "coordinateSemantics": "global-z-up",
        "coordinateContractVersion": 1,
        "frameDimension": dimension,
    })
    if dimension == "2d" and "elementReferenceVectors" in metadata:
        metadata.pop("elementReferenceVectors", None)
        metadata["coordinate_local_axis_migration"] = {
            "from": "legacy-element-reference-vectors",
            "to": "fixed-canonical-xz-local-axes",
        }
    model["metadata"] = metadata
    model["coordinate_system"] = {
        "semantics": "global-z-up",
        "version": 1,
        "dimension": dimension,
        "plane": "xz" if dimension == "2d" else None,
        "dof_order": ["ux", "uy", "uz", "rx", "ry", "rz"],
    }
    for load_case in model.get("load_cases", []):
        if not isinstance(load_case, dict):
            continue
        for load in load_case.get("loads", []):
            if isinstance(load, dict):
                load.setdefault("reference_frame", "global")


def is_supported_target_schema_version(version: str) -> bool:
    return version in SUPPORTED_SCHEMA_VERSIONS


def migrate_structure_model_v1(model: Dict[str, Any], target_schema_version: str, original_schema_version: str | None = None) -> Dict[str, Any]:
    if not is_supported_target_schema_version(target_schema_version):
        raise ValueError(f"Unsupported target schema version: {target_schema_version}")

    migrated = deepcopy(model)
    source_schema_version = original_schema_version or str(migrated.get("schema_version", "1.0.0"))

    metadata = migrated.get("metadata")
    if not isinstance(metadata, dict):
        metadata = {}
    migrated["metadata"] = metadata

    if "unit_system" not in migrated or not migrated.get("unit_system"):
        migrated["unit_system"] = "SI"

    if source_schema_version != target_schema_version:
        metadata["schema_migration"] = {
            "from": source_schema_version,
            "to": target_schema_version,
        }
    migrated["schema_version"] = target_schema_version
    if target_schema_version.startswith("2"):
        if source_schema_version.startswith("1"):
            _normalize_v1_load_component_names(migrated)
            _canonicalize_v1_coordinates(migrated)
            _normalize_v1_load_component_families(migrated)
            _normalize_v1_nodal_force_representations(migrated)
            _stamp_coordinate_contract(migrated)
        elif not isinstance(migrated.get("coordinate_system"), dict):
            raise ValueError(
                "A V2 structural model must include the typed coordinate_system contract"
            )
    return migrated


def ensure_v2_dict(model: Dict[str, Any]) -> Dict[str, Any]:
    """Ensure a model dict reports schema_version 2.0.0.

    If the model already reports schema_version "2.x.x", it is returned as-is
    (deep-copied). Otherwise, schema_version is stamped to "2.0.0", metadata
    and unit_system are normalized, and a migration trace is recorded.
    V2-specific top-level keys (project, stories, etc.) are left absent so
    that StructureModelV2 will apply its own defaults during validation.
    """
    migrated = deepcopy(model)
    version = str(migrated.get("schema_version", "1.0.0"))
    if version.startswith("2"):
        if not isinstance(migrated.get("coordinate_system"), dict):
            raise ValueError(
                "A V2 structural model must include the typed coordinate_system contract"
            )
        return migrated

    migrated["schema_version"] = "2.0.0"
    if not isinstance(migrated.get("metadata"), dict):
        migrated["metadata"] = {}
    if not migrated.get("unit_system"):
        migrated["unit_system"] = "SI"
    migrated["metadata"]["schema_migration"] = {"from": version, "to": "2.0.0"}
    _normalize_v1_load_component_names(migrated)
    _canonicalize_v1_coordinates(migrated)
    _normalize_v1_load_component_families(migrated)
    _normalize_v1_nodal_force_representations(migrated)
    _stamp_coordinate_contract(migrated)
    return migrated


def migrate_v1_to_v2(model: Dict[str, Any]) -> Dict[str, Any]:
    """Migrate a V1 (1.0.x) structural model dict to schema version 2.0.0.

    All V2-specific fields (project, structure_system, stories, etc.) are left
    absent so that StructureModelV2 will default them to None / empty.
    The original V1 core fields (nodes, elements, materials, sections,
    load_cases, load_combinations) are preserved as-is.
    """
    return ensure_v2_dict(model)
