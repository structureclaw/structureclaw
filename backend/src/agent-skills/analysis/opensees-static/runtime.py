from __future__ import annotations

from typing import Any, Dict

from opensees_static_analysis import OpenSeesStaticExecutor
from opensees_static_simplified_static_analysis import StaticAnalyzer
from structure_protocol.structure_model_v2 import StructureModelV2


class OpenSeesStaticAnalyzer(StaticAnalyzer):
    """Bridges StructureModelV2 node/element IDs to OpenSees integer tags.

    Inherits StaticAnalyzer (from the opensees-static library) which owns the
    bulk of the static analysis logic; this subclass only overrides the tag
    look-up methods required by OpenSeesPy.
    """

    def __init__(self, model: StructureModelV2) -> None:
        super().__init__(model)
        self._ops_node_tags = {
            str(node.id): index + 1 for index, node in enumerate(model.nodes)
        }
        self._ops_element_tags = {
            str(elem.id): index + 1 for index, elem in enumerate(model.elements)
        }
        self._ops_material_tags = {
            str(mat.id): index + 1 for index, mat in enumerate(model.materials)
        }

    def _ops_node_tag(self, node_id: Any) -> int:
        key = str(node_id)
        if key not in self._ops_node_tags:
            raise ValueError(f"Unknown node id '{node_id}' in OpenSees mapping")
        return self._ops_node_tags[key]

    def _ops_element_tag(self, element_id: Any) -> int:
        key = str(element_id)
        if key not in self._ops_element_tags:
            raise ValueError(f"Unknown element id '{element_id}' in OpenSees mapping")
        return self._ops_element_tags[key]

    def _ops_material_tag(self, material_id: Any) -> int:
        key = str(material_id)
        if key not in self._ops_material_tags:
            raise ValueError(f"Unknown material id '{material_id}' in OpenSees mapping")
        return self._ops_material_tags[key]

    def _select_opensees_planar_frame_mode(self, parameters: Dict[str, Any]) -> Any:
        return self._select_planar_frame_mode(parameters)


def run_analysis(model: StructureModelV2, parameters: Dict[str, Any]) -> Dict[str, Any]:
    analyzer = OpenSeesStaticAnalyzer(model)
    executor = OpenSeesStaticExecutor(analyzer)
    try:
        import openseespy.opensees as ops  # noqa: F401
    except Exception as error:
        raise RuntimeError("OpenSeesPy is not available for the requested engine") from error
    try:
        return executor.run(parameters)
    except Exception as error:
        raise RuntimeError(f"OpenSees static analysis failed: {error}") from error
