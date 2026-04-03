from __future__ import annotations

from typing import Any

from structure_protocol.structure_model_v1 import StructureModelV1


class OpenSeesTagMapper:
    """Maps V1 string IDs to OpenSees integer tags.

    Replaces the duplicated OpenSeesModelAdapter classes that were defined
    separately in opensees-dynamic/runtime.py and opensees-seismic/runtime.py.
    Exposes the same interface (_ops_node_tag / _ops_element_tag / _ops_material_tag)
    so existing executor classes (OpenSeesDynamicExecutor, OpenSeesSeismicExecutor)
    continue to work without modification.
    """

    def __init__(self, model: StructureModelV1) -> None:
        self.model = model
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
