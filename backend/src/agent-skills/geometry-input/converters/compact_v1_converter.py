from __future__ import annotations

from typing import Any, Dict

from converters.base import FormatConverter
from schemas.structure_model_v1 import StructureModelV1


class CompactV1Converter(FormatConverter):
    """Compact key/value external format used for lightweight interoperability."""

    format_name = "compact-1"

    def to_v1(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        nodes: Dict[str, Any] = payload.get("nodes", {})
        elements: Dict[str, Any] = payload.get("elements", {})
        materials: Dict[str, Any] = payload.get("materials", {})
        sections: Dict[str, Any] = payload.get("sections", {})
        load_cases: Dict[str, Any] = payload.get("load_cases", {})
        load_combinations: Dict[str, Any] = payload.get("load_combinations", {})

        return {
            "schema_version": "1.0.0",
            "unit_system": payload.get("units", "SI"),
            "nodes": [
                {
                    "id": node_id,
                    "x": node_data.get("x", 0.0),
                    "y": node_data.get("y", 0.0),
                    "z": node_data.get("z", 0.0),
                    "restraints": node_data.get("restraints"),
                }
                for node_id, node_data in nodes.items()
            ],
            "elements": [
                {
                    "id": element_id,
                    "type": element_data.get("type", "beam"),
                    "nodes": element_data.get("nodes", []),
                    "material": element_data.get("material", ""),
                    "section": element_data.get("section", ""),
                }
                for element_id, element_data in elements.items()
            ],
            "materials": [
                {
                    "id": material_id,
                    "name": material_data.get("name", material_id),
                    "E": material_data.get("E"),
                    "nu": material_data.get("nu"),
                    "rho": material_data.get("rho"),
                    "fy": material_data.get("fy"),
                }
                for material_id, material_data in materials.items()
            ],
            "sections": [
                {
                    "id": section_id,
                    "name": section_data.get("name", section_id),
                    "type": section_data.get("type", "beam"),
                    "properties": section_data.get("properties", {}),
                }
                for section_id, section_data in sections.items()
            ],
            "load_cases": [
                {
                    "id": case_id,
                    "type": case_data.get("type", "other"),
                    "loads": case_data.get("loads", []),
                }
                for case_id, case_data in load_cases.items()
            ],
            "load_combinations": [
                {
                    "id": combo_id,
                    "factors": combo_data.get("factors", {}),
                }
                for combo_id, combo_data in load_combinations.items()
            ],
            "metadata": payload.get("meta", {}),
        }

    def from_v1(self, model: StructureModelV1) -> Dict[str, Any]:
        return {
            "format_version": "compact-1",
            "units": model.unit_system,
            "nodes": {
                node.id: {
                    "x": node.x,
                    "y": node.y,
                    "z": node.z,
                    "restraints": node.restraints,
                }
                for node in model.nodes
            },
            "elements": {
                element.id: {
                    "type": element.type,
                    "nodes": list(element.nodes),
                    "material": element.material,
                    "section": element.section,
                }
                for element in model.elements
            },
            "materials": {
                material.id: {
                    "name": material.name,
                    "E": material.E,
                    "nu": material.nu,
                    "rho": material.rho,
                    "fy": material.fy,
                }
                for material in model.materials
            },
            "sections": {
                section.id: {
                    "name": section.name,
                    "type": section.type,
                    "properties": section.properties,
                }
                for section in model.sections
            },
            "load_cases": {
                load_case.id: {
                    "type": load_case.type,
                    "loads": load_case.loads,
                }
                for load_case in model.load_cases
            },
            "load_combinations": {
                combo.id: {
                    "factors": combo.factors,
                }
                for combo in model.load_combinations
            },
            "meta": model.metadata,
        }
