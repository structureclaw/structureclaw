from __future__ import annotations

from typing import Any, Dict, List

from fastapi import HTTPException
from pydantic import ValidationError

from structure_protocol.migrations import (
    is_supported_target_schema_version,
    migrate_structure_model_v1,
    migrate_v1_to_v2,
)
from structure_protocol.structure_model_v2 import StructureModelV2


def get_structure_model_schema() -> Dict[str, Any]:
    return StructureModelV2.model_json_schema()


def validate_structure_model_payload(model_payload: Dict[str, Any]) -> Dict[str, Any]:
    migrated = _ensure_v2_if_needed(model_payload)
    model = StructureModelV2.model_validate(migrated)
    return {
        "valid": True,
        "schemaVersion": model.schema_version,
        "stats": {
            "nodes": len(model.nodes),
            "elements": len(model.elements),
            "materials": len(model.materials),
            "sections": len(model.sections),
            "loadCases": len(model.load_cases),
            "loadCombinations": len(model.load_combinations),
        },
    }


def convert_structure_model_payload(
    model_payload: Dict[str, Any],
    target_schema_version: str,
    source_format: str,
    target_format: str,
    supported_formats: List[str],
    get_converter,
) -> Dict[str, Any]:
    if not is_supported_target_schema_version(target_schema_version):
        raise HTTPException(
            status_code=400,
            detail={
                "errorCode": "UNSUPPORTED_TARGET_SCHEMA",
                "message": f"target_schema_version '{target_schema_version}' is not supported",
            },
        )

    source_converter = get_converter(source_format)
    if source_converter is None:
        raise HTTPException(
            status_code=400,
            detail={
                "errorCode": "UNSUPPORTED_SOURCE_FORMAT",
                "message": f"source_format '{source_format}' is not supported",
                "supportedFormats": supported_formats,
            },
        )

    target_converter = get_converter(target_format)
    if target_converter is None:
        raise HTTPException(
            status_code=400,
            detail={
                "errorCode": "UNSUPPORTED_TARGET_FORMAT",
                "message": f"target_format '{target_format}' is not supported",
                "supportedFormats": supported_formats,
            },
        )

    try:
        normalized_source = source_converter.to_v2(model_payload)
        original_schema_version = str(normalized_source.get("schema_version", "1.0.0"))
        migrated = _ensure_v2_if_needed(normalized_source)
        model = StructureModelV2.model_validate(migrated)
        final_schema = migrate_structure_model_v1(
            model.model_dump(mode="json"), target_schema_version, original_schema_version
        )
        if target_format in ("structuremodel-v1", "structuremodel-v2"):
            normalized = final_schema
        else:
            normalized = target_converter.from_v2(model)
    except ValidationError as error:
        raise HTTPException(
            status_code=422,
            detail={
                "errorCode": "INVALID_STRUCTURE_MODEL",
                "message": "Input model failed StructureModel v2 validation",
                "errors": error.errors(include_context=False),
            },
        ) from error
    except ValueError as error:
        raise HTTPException(
            status_code=422,
            detail={
                "errorCode": "INVALID_STRUCTURE_MODEL",
                "message": str(error),
            },
        ) from error

    return {
        "sourceFormat": source_format,
        "targetFormat": target_format,
        "sourceSchemaVersion": model.schema_version,
        "targetSchemaVersion": target_schema_version,
        "model": normalized,
    }


def _ensure_v2_if_needed(payload: Dict[str, Any]) -> Dict[str, Any]:
    return migrate_v1_to_v2(payload)
