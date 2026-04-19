from __future__ import annotations

from copy import deepcopy
from typing import Any, Dict


SUPPORTED_SCHEMA_VERSIONS = {
    "1.0.0",
    "1.0.1",
    "2.0.0",
}


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
        return migrated

    migrated["schema_version"] = "2.0.0"
    if not isinstance(migrated.get("metadata"), dict):
        migrated["metadata"] = {}
    if not migrated.get("unit_system"):
        migrated["unit_system"] = "SI"
    migrated["metadata"]["schema_migration"] = {"from": version, "to": "2.0.0"}
    return migrated


def migrate_v1_to_v2(model: Dict[str, Any]) -> Dict[str, Any]:
    """Migrate a V1 (1.0.x) structural model dict to schema version 2.0.0.

    All V2-specific fields (project, structure_system, stories, etc.) are left
    absent so that StructureModelV2 will default them to None / empty.
    The original V1 core fields (nodes, elements, materials, sections,
    load_cases, load_combinations) are preserved as-is.
    """
    return ensure_v2_dict(model)
