from __future__ import annotations

from typing import Any, Dict, List

from fastapi import HTTPException
from pydantic import ValidationError

from structure_protocol.migrations import (
    is_supported_target_schema_version,
    migrate_structure_model_v1,
)
from structure_protocol.structure_model_v1 import StructureModelV1


def get_structure_model_schema() -> Dict[str, Any]:
    return StructureModelV1.model_json_schema()


def validate_structure_model_payload(model_payload: Dict[str, Any]) -> Dict[str, Any]:
    model = StructureModelV1.model_validate(model_payload)
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
        normalized_source = source_converter.to_v1(model_payload)
        model = StructureModelV1.model_validate(normalized_source)
    except ValidationError as error:
        raise HTTPException(
            status_code=422,
            detail={
                "errorCode": "INVALID_STRUCTURE_MODEL",
                "message": "Input model failed StructureModel v1 validation",
                "errors": error.errors(),
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

    migrated = migrate_structure_model_v1(model.model_dump(mode="json"), target_schema_version)
    if target_format == "structuremodel-v1":
        normalized = migrated
    else:
        normalized = target_converter.from_v1(StructureModelV1.model_validate(migrated))

    return {
        "sourceFormat": source_format,
        "targetFormat": target_format,
        "sourceSchemaVersion": model.schema_version,
        "targetSchemaVersion": target_schema_version,
        "model": normalized,
    }
