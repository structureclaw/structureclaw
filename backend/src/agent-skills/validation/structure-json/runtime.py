"""
Structure JSON Validation Runtime
结构 JSON 验证运行时

Provides multi-layer validation for structural JSON:
1. Syntax validation (JSON parsing)
2. Schema validation (StructureModelV2)
3. Semantic validation (cross-references, logic checks)
"""

from __future__ import annotations

import json
import math
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Set, Tuple, Union

# Add parent directories to path for imports
SCRIPT_DIR = Path(__file__).parent.resolve()
SHARED_DIR = SCRIPT_DIR.parent.parent.parent / "skill-shared" / "python"
if str(SHARED_DIR) not in sys.path:
    sys.path.insert(0, str(SHARED_DIR))

try:
    from structure_protocol.structure_model_v2 import StructureModelV2
    from pydantic import ValidationError as PydanticValidationError
except ImportError:
    # Fallback for type checking
    StructureModelV2 = None  # type: ignore
    PydanticValidationError = Exception  # type: ignore


# -----------------------------------------------------------------------------
# Data Classes
# -----------------------------------------------------------------------------

@dataclass
class ValidationIssue:
    """Single validation issue."""
    severity: Literal["error", "warning", "info"]
    code: str
    message: str
    path: Optional[str] = None
    suggestion: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        result: Dict[str, Any] = {
            "severity": self.severity,
            "code": self.code,
            "message": self.message,
        }
        if self.path:
            result["path"] = self.path
        if self.suggestion:
            result["suggestion"] = self.suggestion
        return result


@dataclass
class ValidationSummary:
    """Validation result summary."""
    error_count: int = 0
    warning_count: int = 0
    info_count: int = 0

    def to_dict(self) -> Dict[str, int]:
        return {
            "error_count": self.error_count,
            "warning_count": self.warning_count,
            "info_count": self.info_count,
        }


@dataclass
class ValidationResult:
    """Complete validation result."""
    valid: bool
    summary: ValidationSummary
    issues: List[ValidationIssue]
    validated_model: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        result: Dict[str, Any] = {
            "valid": self.valid,
            "summary": self.summary.to_dict(),
            "issues": [issue.to_dict() for issue in self.issues],
        }
        if self.validated_model is not None:
            result["validated_model"] = self.validated_model
        return result


# -----------------------------------------------------------------------------
# Error Codes
# -----------------------------------------------------------------------------

class ErrorCode:
    """Validation error codes."""
    # Syntax errors
    JSON_SYNTAX_ERROR = "JSON_SYNTAX_ERROR"
    JSON_ENCODING_ERROR = "JSON_ENCODING_ERROR"

    # Schema errors
    SCHEMA_VALIDATION_ERROR = "SCHEMA_VALIDATION_ERROR"
    SCHEMA_MISSING_FIELD = "SCHEMA_MISSING_FIELD"
    SCHEMA_TYPE_ERROR = "SCHEMA_TYPE_ERROR"
    SCHEMA_VALUE_ERROR = "SCHEMA_VALUE_ERROR"
    SCHEMA_VERSION_NOT_SUPPORTED = "SCHEMA_VERSION_NOT_SUPPORTED"

    # Semantic errors
    SEMANTIC_INVALID_REFERENCE = "SEMANTIC_INVALID_REFERENCE"
    SEMANTIC_INVALID_VALUE = "SEMANTIC_INVALID_VALUE"
    SEMANTIC_MISSING_NODE = "SEMANTIC_MISSING_NODE"
    SEMANTIC_DUPLICATE_ID = "SEMANTIC_DUPLICATE_ID"
    SEMANTIC_GEOMETRY_ERROR = "SEMANTIC_GEOMETRY_ERROR"
    SEMANTIC_LOAD_ERROR = "SEMANTIC_LOAD_ERROR"

    # Warnings
    MISSING_RECOMMENDED_FIELD = "MISSING_RECOMMENDED_FIELD"
    DEFAULT_VALUE_USED = "DEFAULT_VALUE_USED"
    DEPRECATED_FIELD = "DEPRECATED_FIELD"

    # Info
    FIELD_AUTO_FILLED = "FIELD_AUTO_FILLED"
    SCHEMA_VERSION_INFO = "SCHEMA_VERSION_INFO"
    ORPHANED_NODE_DETECTED = "ORPHANED_NODE_DETECTED"


# -----------------------------------------------------------------------------
# Syntax Validation
# -----------------------------------------------------------------------------

def validate_syntax(json_data: str) -> Tuple[bool, Optional[Dict[str, Any]], List[ValidationIssue]]:
    """
    Validate JSON syntax.

    Returns:
        Tuple of (is_valid, parsed_data, issues)
    """
    issues: List[ValidationIssue] = []

    try:
        parsed = json.loads(json_data)
        return True, parsed, issues
    except json.JSONDecodeError as e:
        # Format the error message
        line = e.lineno
        col = e.colno
        msg = str(e)

        # Extract more user-friendly message
        if "Expecting property name" in msg:
            suggestion = "Check for missing quotes around property names or trailing commas"
        elif "Expecting ',' delimiter" in msg:
            suggestion = "Check for missing commas between properties or array items"
        elif "Expecting ':' delimiter" in msg:
            suggestion = "Check for missing colon between property name and value"
        elif "Unterminated string" in msg:
            suggestion = "Check for unclosed quotes in string values"
        else:
            suggestion = "Review JSON syntax near the reported position"

        issues.append(ValidationIssue(
            severity="error",
            code=ErrorCode.JSON_SYNTAX_ERROR,
            message=f"JSON syntax error at line {line}, column {col}: {msg}",
            path=f"line:{line},col:{col}",
            suggestion=suggestion,
        ))
        return False, None, issues
    except UnicodeDecodeError as e:
        issues.append(ValidationIssue(
            severity="error",
            code=ErrorCode.JSON_ENCODING_ERROR,
            message=f"JSON encoding error: {str(e)}",
            suggestion="Ensure the input is valid UTF-8 encoded text",
        ))
        return False, None, issues


# -----------------------------------------------------------------------------
# Schema Validation
# -----------------------------------------------------------------------------

def pydantic_error_to_path(error: Dict[str, Any]) -> str:
    """Convert Pydantic error location to JSON path."""
    loc = error.get("loc", [])
    if not loc:
        return ""

    path_parts = []
    for part in loc:
        if isinstance(part, int):
            path_parts.append(f"[{part}]")
        else:
            if path_parts:
                path_parts.append(f".{part}")
            else:
                path_parts.append(str(part))

    return "".join(path_parts)


def validate_schema(
    data: Dict[str, Any],
    stop_on_first_error: bool = False,
    schema_version: str = "2.0.0",
) -> Tuple[bool, Optional[StructureModelV2], List[ValidationIssue]]:
    """
    Validate data against StructureModelV2 schema.

    Args:
        data: Parsed JSON data
        stop_on_first_error: Stop after first error
        schema_version: Target schema version (currently only "2.0.0" is supported)

    Returns:
        Tuple of (is_valid, model_instance, issues)
    """
    issues: List[ValidationIssue] = []

    # Check schema version support
    if schema_version != "2.0.0":
        issues.append(ValidationIssue(
            severity="error",
            code=ErrorCode.SCHEMA_VERSION_NOT_SUPPORTED,
            message=f"Schema version '{schema_version}' is not supported. Only '2.0.0' is currently supported.",
            suggestion="Use schema_version '2.0.0' or migrate your model to the latest schema",
        ))
        return False, None, issues

    if StructureModelV2 is None:
        issues.append(ValidationIssue(
            severity="error",
            code=ErrorCode.SCHEMA_VALIDATION_ERROR,
            message="StructureModelV2 not available - cannot perform schema validation",
            suggestion="Ensure pydantic and structure_protocol are properly installed",
        ))
        return False, None, issues

    try:
        model = StructureModelV2.model_validate(data)
        return True, model, issues
    except Exception as e:
        # Handle Pydantic validation errors
        errors = []

        if hasattr(e, 'errors'):
            # Pydantic v2
            errors = e.errors()
        elif hasattr(e, 'json'):
            # Try to parse error details
            try:
                error_data = json.loads(e.json())
                if isinstance(error_data, list):
                    errors = error_data
                elif isinstance(error_data, dict) and 'detail' in error_data:
                    errors = error_data['detail']
            except Exception:
                pass

        if not errors:
            # Generic error handling
            issues.append(ValidationIssue(
                severity="error",
                code=ErrorCode.SCHEMA_VALIDATION_ERROR,
                message=str(e),
                suggestion="Review the data structure against the schema requirements",
            ))
            return False, None, issues

        for error in errors:
            path = pydantic_error_to_path(error)
            msg = error.get("msg", "Validation failed")
            error_type = error.get("type", "")

            # Categorize the error
            if "missing" in error_type or "required" in msg.lower():
                code = ErrorCode.SCHEMA_MISSING_FIELD
                suggestion = "Add the required field to the JSON"
            elif "type" in error_type:
                code = ErrorCode.SCHEMA_TYPE_ERROR
                suggestion = f"Ensure the value at '{path}' has the correct type"
            else:
                code = ErrorCode.SCHEMA_VALUE_ERROR
                suggestion = f"Check the value at '{path}' meets the schema constraints"

            issues.append(ValidationIssue(
                severity="error",
                code=code,
                message=msg,
                path=path,
                suggestion=suggestion,
            ))

            if stop_on_first_error:
                break

        return False, None, issues


# -----------------------------------------------------------------------------
# Semantic Validation
# -----------------------------------------------------------------------------

def validate_semantic(
    data: Dict[str, Any],
    include_warnings: bool = True,
    include_info: bool = True,
) -> List[ValidationIssue]:
    """
    Perform semantic validation on the data.

    Checks:
    - Node coordinate validity
    - Material property validity
    - Section property validity
    - Cross-reference integrity
    - Load case validity
    - Geometric integrity
    """
    issues: List[ValidationIssue] = []

    # Ensure data is a dictionary before proceeding
    if not isinstance(data, dict):
        return issues

    # Collect IDs for reference checking with robustness against missing or malformed collections
    node_ids = {n.get("id") for n in (data.get("nodes") or []) if isinstance(n, dict) and n.get("id")}
    material_ids = {m.get("id") for m in (data.get("materials") or []) if isinstance(m, dict) and m.get("id")}
    section_ids = {s.get("id") for s in (data.get("sections") or []) if isinstance(s, dict) and s.get("id")}
    story_ids = {s.get("id") for s in (data.get("stories") or []) if isinstance(s, dict) and s.get("id")}
    load_case_ids = {lc.get("id") for lc in (data.get("load_cases") or []) if isinstance(lc, dict) and lc.get("id")}

    # Check for duplicate IDs with robustness against null/malformed collections
    for collection_name in ["nodes", "materials", "sections", "elements"]:
        collection_items = data.get(collection_name)
        if not isinstance(collection_items, list):
            continue
        seen: Set[str] = set()
        for idx, item in enumerate(collection_items):
            item_id = item.get("id") if isinstance(item, dict) else None
            if item_id:
                if item_id in seen:
                    issues.append(ValidationIssue(
                        severity="error",
                        code=ErrorCode.SEMANTIC_DUPLICATE_ID,
                        message=f"Duplicate {collection_name} ID: '{item_id}'",
                        path=f"{collection_name}[{idx}].id",
                        suggestion=f"Use a unique ID for each {collection_name}",
                    ))
                seen.add(item_id)

    # Validate nodes
    for idx, node in enumerate(data.get("nodes", [])):
        if not isinstance(node, dict):
            continue

        node_id = node.get("id", f"[{idx}]")
        base_path = f"nodes[{idx}]"

        # Check coordinates
        for coord in ["x", "y", "z"]:
            value = node.get(coord)
            if value is not None:
                if isinstance(value, (int, float)):
                    if math.isnan(value):
                        issues.append(ValidationIssue(
                            severity="error",
                            code=ErrorCode.SEMANTIC_INVALID_VALUE,
                            message=f"Node '{node_id}' has NaN {coord} coordinate",
                            path=f"{base_path}.{coord}",
                            suggestion=f"Provide a valid numeric value for {coord}",
                        ))
                    elif math.isinf(value):
                        issues.append(ValidationIssue(
                            severity="error",
                            code=ErrorCode.SEMANTIC_INVALID_VALUE,
                            message=f"Node '{node_id}' has infinite {coord} coordinate",
                            path=f"{base_path}.{coord}",
                            suggestion=f"Provide a finite numeric value for {coord}",
                        ))

        # Check restraints if present
        restraints = node.get("restraints")
        if restraints is not None:
            if not isinstance(restraints, list) or len(restraints) != 6:
                issues.append(ValidationIssue(
                    severity="error",
                    code=ErrorCode.SEMANTIC_INVALID_VALUE,
                    message=f"Node '{node_id}' restraints must be a list of 6 boolean values",
                    path=f"{base_path}.restraints",
                    suggestion="Use format [true, true, true, false, false, false] for [ux, uy, uz, rx, ry, rz]",
                ))

        # Check story reference
        story = node.get("story")
        if story is not None and story not in story_ids:
            issues.append(ValidationIssue(
                severity="error",
                code=ErrorCode.SEMANTIC_INVALID_REFERENCE,
                message=f"Node '{node_id}' references unknown story: '{story}'",
                path=f"{base_path}.story",
                suggestion=f"Use one of the defined story IDs: {list(story_ids) or 'add story definition'}",
            ))

    # Validate materials
    for idx, material in enumerate(data.get("materials", [])):
        if not isinstance(material, dict):
            continue

        mat_id = material.get("id", f"[{idx}]")
        base_path = f"materials[{idx}]"

        # Check material properties
        for prop, min_val in [("E", 0), ("nu", 0), ("rho", 0)]:
            value = material.get(prop)
            if value is not None:
                if isinstance(value, (int, float)) and value <= min_val:
                    issues.append(ValidationIssue(
                        severity="error",
                        code=ErrorCode.SEMANTIC_INVALID_VALUE,
                        message=f"Material '{mat_id}' has invalid {prop} value: {value} (must be > {min_val})",
                        path=f"{base_path}.{prop}",
                        suggestion=f"Provide a positive value for {prop}",
                    ))

        # Check Poisson's ratio range
        nu = material.get("nu")
        if nu is not None and isinstance(nu, (int, float)):
            if nu > 0.5:
                issues.append(ValidationIssue(
                    severity="warning",
                    code=ErrorCode.SEMANTIC_INVALID_VALUE,
                    message=f"Material '{mat_id}' has unusual nu value: {nu} (typically <= 0.5)",
                    path=f"{base_path}.nu",
                    suggestion="Poisson's ratio should typically be between 0 and 0.5",
                ))

    # Validate elements
    for idx, element in enumerate(data.get("elements", [])):
        if not isinstance(element, dict):
            continue

        elem_id = element.get("id", f"[{idx}]")
        base_path = f"elements[{idx}]"

        # Check node references
        elem_nodes = element.get("nodes", [])
        if isinstance(elem_nodes, list):
            for node_idx, node_ref in enumerate(elem_nodes):
                if node_ref not in node_ids:
                    issues.append(ValidationIssue(
                        severity="error",
                        code=ErrorCode.SEMANTIC_INVALID_REFERENCE,
                        message=f"Element '{elem_id}' references unknown node: '{node_ref}'",
                        path=f"{base_path}.nodes[{node_idx}]",
                        suggestion=f"Ensure the node ID exists in the nodes array",
                    ))

        # Check material reference
        mat_ref = element.get("material")
        if mat_ref is not None and mat_ref not in material_ids:
            issues.append(ValidationIssue(
                severity="error",
                code=ErrorCode.SEMANTIC_INVALID_REFERENCE,
                message=f"Element '{elem_id}' references unknown material: '{mat_ref}'",
                path=f"{base_path}.material",
                suggestion=f"Ensure the material ID exists in the materials array",
            ))

        # Check section reference
        sec_ref = element.get("section")
        if sec_ref is not None and sec_ref not in section_ids:
            issues.append(ValidationIssue(
                severity="error",
                code=ErrorCode.SEMANTIC_INVALID_REFERENCE,
                message=f"Element '{elem_id}' references unknown section: '{sec_ref}'",
                path=f"{base_path}.section",
                suggestion=f"Ensure the section ID exists in the sections array",
            ))

        # Check story reference
        story = element.get("story")
        if story is not None and story not in story_ids:
            issues.append(ValidationIssue(
                severity="error",
                code=ErrorCode.SEMANTIC_INVALID_REFERENCE,
                message=f"Element '{elem_id}' references unknown story: '{story}'",
                path=f"{base_path}.story",
                suggestion=f"Use one of the defined story IDs",
            ))

    # Validate load cases
    for idx, load_case in enumerate(data.get("load_cases", [])):
        if not isinstance(load_case, dict):
            continue

        lc_id = load_case.get("id", f"[{idx}]")
        base_path = f"load_cases[{idx}]"

        # Validate loads
        loads = load_case.get("loads", [])
        if isinstance(loads, list):
            for load_idx, load in enumerate(loads):
                if not isinstance(load, dict):
                    continue

                # Check node reference for nodal loads
                node_ref = load.get("node")
                if node_ref is not None and node_ref not in node_ids:
                    issues.append(ValidationIssue(
                        severity="error",
                        code=ErrorCode.SEMANTIC_INVALID_REFERENCE,
                        message=f"Load case '{lc_id}' references unknown node: '{node_ref}'",
                        path=f"{base_path}.loads[{load_idx}].node",
                        suggestion="Ensure the node ID exists in the nodes array",
                    ))

    # Validate load combinations
    for idx, combo in enumerate(data.get("load_combinations", [])):
        if not isinstance(combo, dict):
            continue

        combo_id = combo.get("id", f"[{idx}]")
        base_path = f"load_combinations[{idx}]"

        factors = combo.get("factors", {})
        if isinstance(factors, dict):
            for case_id in factors.keys():
                if case_id not in load_case_ids:
                    issues.append(ValidationIssue(
                        severity="error",
                        code=ErrorCode.SEMANTIC_INVALID_REFERENCE,
                        message=f"Load combination '{combo_id}' references unknown load case: '{case_id}'",
                        path=f"{base_path}.factors.{case_id}",
                        suggestion="Ensure the load case ID exists in the load_cases array",
                    ))

    # Geometric integrity check
    if len(data.get("nodes", [])) < 2:
        issues.append(ValidationIssue(
            severity="error",
            code=ErrorCode.SEMANTIC_GEOMETRY_ERROR,
            message="At least 2 nodes are required for a valid structural model",
            path="nodes",
            suggestion="Add at least 2 nodes to define the structure geometry",
        ))

    if len(data.get("elements", [])) == 0:
        issues.append(ValidationIssue(
            severity="warning",
            code=ErrorCode.SEMANTIC_GEOMETRY_ERROR,
            message="No structural elements defined",
            path="elements",
            suggestion="Add elements (beams, columns, etc.) to define the structure",
        ))

    # Check for orphaned nodes (nodes not referenced by any element)
    referenced_nodes: Set[str] = set()
    for element in data.get("elements", []):
        if isinstance(element, dict):
            for node_ref in element.get("nodes", []):
                referenced_nodes.add(node_ref)

    all_node_ids = {n.get("id") for n in data.get("nodes", []) if n.get("id")}
    orphaned_nodes = all_node_ids - referenced_nodes
    if orphaned_nodes and len(data.get("elements", [])) > 0:
        # Take first 5 without materializing entire set for large models
        sample = []
        for i, node_id in enumerate(orphaned_nodes):
            if i >= 5:
                break
            sample.append(node_id)
        issues.append(ValidationIssue(
            severity="info",
            code=ErrorCode.ORPHANED_NODE_DETECTED,
            message=f"Found {len(orphaned_nodes)} orphaned node(s) not connected to any element: {sample}",
            path="nodes",
            suggestion="These nodes are not part of any structural element",
        ))

    return issues


# -----------------------------------------------------------------------------
# Missing Field Detection
# -----------------------------------------------------------------------------

def check_missing_fields(data: Dict[str, Any]) -> List[ValidationIssue]:
    """
    Check for missing recommended and optional fields.

    Returns issues with warning/info severity.
    """
    issues: List[ValidationIssue] = []

    # Check for project info
    project = data.get("project")
    if not project:
        issues.append(ValidationIssue(
            severity="info",
            code=ErrorCode.MISSING_RECOMMENDED_FIELD,
            message="Project information not provided",
            path="project",
            suggestion="Add project metadata (name, code_standard, design_life, etc.)",
        ))
    elif isinstance(project, dict):
        if not project.get("name"):
            issues.append(ValidationIssue(
                severity="info",
                code=ErrorCode.MISSING_RECOMMENDED_FIELD,
                message="Project name not specified",
                path="project.name",
                suggestion="Add a project name for better documentation",
            ))

    # Check for structure system
    if not data.get("structure_system"):
        issues.append(ValidationIssue(
            severity="info",
            code=ErrorCode.MISSING_RECOMMENDED_FIELD,
            message="Structure system information not provided",
            path="structure_system",
            suggestion="Add structure system details (type, seismic_grade, etc.)",
        ))

    # Check for unit system
    unit_system = data.get("unit_system")
    if not unit_system:
        issues.append(ValidationIssue(
            severity="warning",
            code=ErrorCode.MISSING_RECOMMENDED_FIELD,
            message="Unit system not specified, assuming 'SI'",
            path="unit_system",
            suggestion="Explicitly specify the unit system ('SI', 'Imperial', etc.)",
        ))

    # Check for materials and sections
    if not data.get("materials"):
        issues.append(ValidationIssue(
            severity="warning",
            code=ErrorCode.MISSING_RECOMMENDED_FIELD,
            message="No materials defined",
            path="materials",
            suggestion="Define at least one material for the structure",
        ))

    if not data.get("sections"):
        issues.append(ValidationIssue(
            severity="warning",
            code=ErrorCode.MISSING_RECOMMENDED_FIELD,
            message="No sections defined",
            path="sections",
            suggestion="Define at least one section for the structure",
        ))

    return issues


# -----------------------------------------------------------------------------
# Main Validation Function
# -----------------------------------------------------------------------------

def validate_structure_json(
    json_data: str,
    schema_version: str = "2.0.0",
    stop_on_first_error: bool = False,
    include_warnings: bool = True,
    include_info: bool = True,
    semantic_validation: bool = True,
) -> ValidationResult:
    """
    Main entry point for structure JSON validation.

    Args:
        json_data: JSON string to validate
        schema_version: Schema version to validate against
        stop_on_first_error: Stop validation after first error
        include_warnings: Include warning-level issues
        include_info: Include info-level issues
        semantic_validation: Perform semantic validation

    Returns:
        ValidationResult with all issues found
    """
    all_issues: List[ValidationIssue] = []
    validated_model: Optional[Dict[str, Any]] = None

    # Step 1: Syntax validation
    is_valid, parsed_data, syntax_issues = validate_syntax(json_data)
    all_issues.extend(syntax_issues)

    if not is_valid:
        summary = ValidationSummary(
            error_count=len([i for i in all_issues if i.severity == "error"]),
            warning_count=0,
            info_count=0,
        )
        return ValidationResult(
            valid=False,
            summary=summary,
            issues=all_issues,
            validated_model=None,
        )

    # Step 2: Schema validation
    schema_valid, model_instance, schema_issues = validate_schema(
        parsed_data,
        stop_on_first_error=stop_on_first_error,
        schema_version=schema_version,
    )
    all_issues.extend(schema_issues)

    if model_instance is not None:
        # Convert model back to dict for output
        try:
            if hasattr(model_instance, 'model_dump'):
                validated_model = model_instance.model_dump()
            elif hasattr(model_instance, 'dict'):
                validated_model = model_instance.dict()
            else:
                validated_model = parsed_data
        except Exception:
            validated_model = parsed_data

    if stop_on_first_error and any(i.severity == "error" for i in all_issues):
        summary = ValidationSummary(
            error_count=len([i for i in all_issues if i.severity == "error"]),
            warning_count=0,
            info_count=0,
        )
        return ValidationResult(
            valid=False,
            summary=summary,
            issues=all_issues,
            validated_model=None,
        )

    # Step 3: Semantic validation
    if semantic_validation and parsed_data is not None:
        semantic_issues = validate_semantic(
            parsed_data,
            include_warnings=include_warnings,
            include_info=include_info,
        )
        all_issues.extend(semantic_issues)

    # Step 4: Missing field detection
    if parsed_data is not None:
        missing_issues = check_missing_fields(parsed_data)
        all_issues.extend(missing_issues)

    # Filter issues by severity if needed (before calculating summary)
    if not include_warnings:
        all_issues = [i for i in all_issues if i.severity != "warning"]
    if not include_info:
        all_issues = [i for i in all_issues if i.severity != "info"]

    # Calculate summary after filtering for consistent results
    error_count = len([i for i in all_issues if i.severity == "error"])
    warning_count = len([i for i in all_issues if i.severity == "warning"])
    info_count = len([i for i in all_issues if i.severity == "info"])

    summary = ValidationSummary(
        error_count=error_count,
        warning_count=warning_count,
        info_count=info_count,
    )

    # Valid if no errors
    is_valid_result = error_count == 0

    return ValidationResult(
        valid=is_valid_result,
        summary=summary,
        issues=all_issues,
        validated_model=validated_model if is_valid_result else None,
    )


# -----------------------------------------------------------------------------
# Runtime Interface for TypeScript Integration
# -----------------------------------------------------------------------------

def main():
    """Main entry point for command-line usage."""
    import argparse

    parser = argparse.ArgumentParser(description="Validate structural JSON")
    parser.add_argument("input", help="JSON file to validate or '-' for stdin")
    parser.add_argument("--schema-version", default="2.0.0", help="Schema version")
    parser.add_argument("--stop-on-first-error", action="store_true", help="Stop on first error")
    parser.add_argument("--no-warnings", action="store_true", help="Exclude warnings")
    parser.add_argument("--no-info", action="store_true", help="Exclude info messages")
    parser.add_argument("--no-semantic", action="store_true", help="Skip semantic validation")
    parser.add_argument("--output", "-o", help="Output file (default: stdout)")

    args = parser.parse_args()

    # Read input
    if args.input == "-":
        json_data = sys.stdin.read()
    else:
        with open(args.input, "r", encoding="utf-8") as f:
            json_data = f.read()

    # Run validation
    result = validate_structure_json(
        json_data=json_data,
        schema_version=args.schema_version,
        stop_on_first_error=args.stop_on_first_error,
        include_warnings=not args.no_warnings,
        include_info=not args.no_info,
        semantic_validation=not args.no_semantic,
    )

    # Output result
    output = json.dumps(result.to_dict(), indent=2, ensure_ascii=False)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(output)
    else:
        print(output)

    # Exit with error code if validation failed
    sys.exit(0 if result.valid else 1)


if __name__ == "__main__":
    main()
