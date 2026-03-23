from __future__ import annotations

from typing import Any, Dict, List

from converters.base import FormatConverter
from structure_protocol.structure_model_v1 import StructureModelV1


class SimpleV1Converter(FormatConverter):
    """Simple external format used for import/export demos and round-trip tests."""

    format_name = "simple-1"

    def to_v1(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        points = payload.get("points", [])
        members = payload.get("members", [])
        materials = payload.get("materials", [])
        sections = payload.get("sections", [])
        load_cases = payload.get("load_cases", [])
        load_combinations = payload.get("load_combinations", [])

        return {
            "schema_version": "1.0.0",
            "unit_system": payload.get("units", "SI"),
            "nodes": [
                {
                    "id": p["name"],
                    "x": p["x"],
                    "y": p["y"],
                    "z": p["z"],
                    "restraints": p.get("restraints"),
                }
                for p in points
            ],
            "elements": [
                {
                    "id": m["name"],
                    "type": m.get("kind", "beam"),
                    "nodes": [m["i"], m["j"]],
                    "material": m["material"],
                    "section": m["section"],
                }
                for m in members
            ],
            "materials": [
                {
                    "id": m["name"],
                    "name": m.get("label", m["name"]),
                    "E": m["E"],
                    "nu": m["nu"],
                    "rho": m["rho"],
                    "fy": m.get("fy"),
                }
                for m in materials
            ],
            "sections": [
                {
                    "id": s["name"],
                    "name": s.get("label", s["name"]),
                    "type": s.get("type", "beam"),
                    "properties": s.get("props", {}),
                }
                for s in sections
            ],
            "load_cases": [
                {
                    "id": c["name"],
                    "type": c.get("type", "other"),
                    "loads": c.get("loads", []),
                }
                for c in load_cases
            ],
            "load_combinations": [
                {
                    "id": c["name"],
                    "factors": c.get("factors", {}),
                }
                for c in load_combinations
            ],
            "metadata": payload.get("meta", {}),
        }

    def from_v1(self, model: StructureModelV1) -> Dict[str, Any]:
        return {
            "format_version": "simple-1",
            "units": model.unit_system,
            "points": [self._dump_node(node) for node in model.nodes],
            "members": [self._dump_element(element) for element in model.elements],
            "materials": [self._dump_material(material) for material in model.materials],
            "sections": [self._dump_section(section) for section in model.sections],
            "load_cases": [self._dump_load_case(case) for case in model.load_cases],
            "load_combinations": [self._dump_load_combo(combo) for combo in model.load_combinations],
            "meta": model.metadata,
        }

    @staticmethod
    def _dump_node(node: Any) -> Dict[str, Any]:
        data: Dict[str, Any] = {
            "name": node.id,
            "x": node.x,
            "y": node.y,
            "z": node.z,
        }
        if node.restraints is not None:
            data["restraints"] = node.restraints
        return data

    @staticmethod
    def _dump_element(element: Any) -> Dict[str, Any]:
        element_nodes: List[str] = list(element.nodes)
        return {
            "name": element.id,
            "kind": element.type,
            "i": element_nodes[0],
            "j": element_nodes[1],
            "material": element.material,
            "section": element.section,
        }

    @staticmethod
    def _dump_material(material: Any) -> Dict[str, Any]:
        data = {
            "name": material.id,
            "label": material.name,
            "E": material.E,
            "nu": material.nu,
            "rho": material.rho,
        }
        if material.fy is not None:
            data["fy"] = material.fy
        return data

    @staticmethod
    def _dump_section(section: Any) -> Dict[str, Any]:
        return {
            "name": section.id,
            "label": section.name,
            "type": section.type,
            "props": section.properties,
        }

    @staticmethod
    def _dump_load_case(case: Any) -> Dict[str, Any]:
        return {
            "name": case.id,
            "type": case.type,
            "loads": case.loads,
        }

    @staticmethod
    def _dump_load_combo(combo: Any) -> Dict[str, Any]:
        return {
            "name": combo.id,
            "factors": combo.factors,
        }
