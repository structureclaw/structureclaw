from __future__ import annotations

from copy import deepcopy
from typing import Any, Dict


SUPPORTED_SCHEMA_VERSIONS = {
    "1.0.0",
    "1.0.1",
}


def is_supported_target_schema_version(version: str) -> bool:
    return version in SUPPORTED_SCHEMA_VERSIONS


def migrate_structure_model_v1(model: Dict[str, Any], target_schema_version: str) -> Dict[str, Any]:
    if not is_supported_target_schema_version(target_schema_version):
        raise ValueError(f"Unsupported target schema version: {target_schema_version}")

    migrated = deepcopy(model)
    source_schema_version = str(migrated.get("schema_version", "1.0.0"))

    metadata = migrated.get("metadata")
    if not isinstance(metadata, dict):
        metadata = {}
    migrated["metadata"] = metadata

    # v1.x migration policy:
    # - Keep data shape stable
    # - Fill deterministic defaults for newly standardized fields
    if "unit_system" not in migrated or not migrated.get("unit_system"):
        migrated["unit_system"] = "SI"

    if source_schema_version != target_schema_version:
        metadata["schema_migration"] = {
            "from": source_schema_version,
            "to": target_schema_version,
        }
    migrated["schema_version"] = target_schema_version
    return migrated
