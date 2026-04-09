"""
模型数据读取模块 / Model Data Reader Module

提供统一的模型数据读取接口，支持多种数据格式和数据源
Provides unified model data reading interface supporting multiple formats and sources
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional
import logging
import json

logger = logging.getLogger(__name__)


class ModelDataReader:
    """模型数据读取器 / Model Data Reader"""

    def __init__(self, model: Any):
        """
        初始化模型数据读取器

        Args:
            model: 结构模型对象
        """
        self.model = model
        self._cache = {}

    def clear_cache(self):
        """清除缓存"""
        self._cache = {}

    def get_total_weight(self) -> float:
        """
        获取结构总重量

        Returns:
            总重量 (kN)
        """
        cache_key = "total_weight"
        if cache_key in self._cache:
            return self._cache[cache_key]

        # 尝试从模型直接获取
        total_weight = self._try_get_weight_from_metadata()

        if total_weight is not None:
            self._cache[cache_key] = total_weight
            return total_weight

        return 0.0

    def get_floors(self) -> List[Dict[str, Any]]:
        """
        获取楼层信息

        Returns:
            楼层列表
        """
        cache_key = "floors"
        if cache_key in self._cache:
            return self._cache[cache_key]

        floors = []

        if hasattr(self.model, 'stories') and self.model.stories:
            for story in self.model.stories:
                floor_data = {
                    "id": story.id,
                    "height": story.height,
                    "elevation": getattr(story, 'elevation', None),
                    "is_basement": getattr(story, 'is_basement', False),
                    "floor_loads": getattr(story, 'floor_loads', [])
                }
                floors.append(floor_data)

        self._cache[cache_key] = floors
        return floors

    def get_floor_by_id(self, floor_id: str) -> Optional[Dict[str, Any]]:
        """
        根据ID获取楼层

        Args:
            floor_id: 楼层ID

        Returns:
            楼层数据
        """
        floors = self.get_floors()
        for floor in floors:
            if floor["id"] == floor_id:
                return floor
        return None

    def get_vertical_elements(self, floor_id: Optional[str] = None) -> List[Any]:
        """
        获取竖向构件

        Args:
            floor_id: 楼层ID，如果为None则返回所有竖向构件

        Returns:
            构件列表
        """
        cache_key = f"vertical_elements_{floor_id or 'all'}"
        if cache_key in self._cache:
            return self._cache[cache_key]

        vertical_elements = []

        if not hasattr(self.model, 'elements'):
            self._cache[cache_key] = vertical_elements
            return vertical_elements

        vertical_types = ["column", "wall", "vertical"]

        for element in self.model.elements:
            element_type = element.type.lower()
            is_vertical = element_type in vertical_types

            # 检查楼层
            element_floor = getattr(element, 'story', None)
            if floor_id is not None and element_floor != floor_id:
                continue

            if is_vertical:
                vertical_elements.append(element)

        self._cache[cache_key] = vertical_elements
        return vertical_elements

    def get_elements_by_floor(self, floor_id: str) -> List[Any]:
        """
        获取指定楼层所有构件

        Args:
            floor_id: 楼层ID

        Returns:
            构件列表
        """
        cache_key = f"floor_elements_{floor_id}"
        if cache_key in self._cache:
            return self._cache[cache_key]

        elements = []

        if not hasattr(self.model, 'elements'):
            self._cache[cache_key] = elements
            return elements

        for element in self.model.elements:
            element_floor = getattr(element, 'story', None)
            if element_floor == floor_id:
                elements.append(element)

        self._cache[cache_key] = elements
        return elements

    def get_material(self, material_id: str) -> Optional[Any]:
        """
        获取材料

        Args:
            material_id: 材料ID

        Returns:
            材料对象
        """
        if not hasattr(self.model, 'materials'):
            return None

        for material in self.model.materials:
            if material.id == material_id:
                return material
        return None

    def get_section(self, section_id: str) -> Optional[Any]:
        """
        获取截面

        Args:
            section_id: 截面ID

        Returns:
            截面对象
        """
        if not hasattr(self.model, 'sections'):
            return None

        for section in self.model.sections:
            if section.id == section_id:
                return section
        return None

    def get_node(self, node_id: str) -> Optional[Any]:
        """
        获取节点

        Args:
            node_id: 节点ID

        Returns:
            节点对象
        """
        if not hasattr(self.model, 'nodes'):
            return None

        for node in self.model.nodes:
            if node.id == node_id:
                return node
        return None

    def get_element_center(self, element: Any) -> tuple[float, float, float]:
        """
        获取构件中心坐标

        Args:
            element: 构件

        Returns:
            中心坐标 (x, y, z)
        """
        if len(element.nodes) >= 2:
            start_node = self.get_node(element.nodes[0])
            end_node = self.get_node(element.nodes[1])

            if start_node and end_node:
                x = (start_node.x + end_node.x) / 2.0
                y = (start_node.y + end_node.y) / 2.0
                z = (start_node.z + end_node.z) / 2.0
                return (x, y, z)

        return (0.0, 0.0, 0.0)

    def get_element_length(self, element: Any) -> float:
        """
        获取构件长度

        Args:
            element: 构件

        Returns:
            长度 (m)
        """
        if len(element.nodes) >= 2:
            start_node = self.get_node(element.nodes[0])
            end_node = self.get_node(element.nodes[1])

            if start_node and end_node:
                dx = end_node.x - start_node.x
                dy = end_node.y - start_node.y
                dz = end_node.z - start_node.z
                return (dx**2 + dy**2 + dz**2) ** 0.5

        return 0.0

    def get_floor_bounding_box(self, floor_id: str) -> Dict[str, float]:
        """
        获取楼层边界框

        Args:
            floor_id: 楼层ID

        Returns:
            边界框字典
        """
        elements = self.get_elements_by_floor(floor_id)

        x_coords = []
        y_coords = []
        z_coords = []

        for element in elements:
            center = self.get_element_center(element)
            x_coords.append(center[0])
            y_coords.append(center[1])
            z_coords.append(center[2])

        if not x_coords:
            return {"min_x": 0, "max_x": 0, "min_y": 0, "max_y": 0, "min_z": 0, "max_z": 0}

        return {
            "min_x": min(x_coords),
            "max_x": max(x_coords),
            "min_y": min(y_coords),
            "max_y": max(y_coords),
            "min_z": min(z_coords),
            "max_z": max(z_coords)
        }

    def estimate_floor_area(self, floor_id: str) -> float:
        """
        估算楼层面积

        Args:
            floor_id: 楼层ID

        Returns:
            面积 (m²)
        """
        bbox = self.get_floor_bounding_box(floor_id)

        width = bbox["max_x"] - bbox["min_x"]
        depth = bbox["max_y"] - bbox["min_y"]

        return max(width * depth, 1.0)

    def _try_get_weight_from_metadata(self) -> Optional[float]:
        """
        尝试从模型元数据获取总重量

        Returns:
            总重量 (kN)
        """
        # 检查 metadata 字段
        if hasattr(self.model, 'metadata') and isinstance(self.model.metadata, dict):
            if 'total_weight' in self.model.metadata:
                try:
                    return float(self.model.metadata['total_weight'])
                except (ValueError, TypeError):
                    pass

        # 检查自定义字段
        if hasattr(self.model, 'total_weight'):
            try:
                return float(self.model.total_weight)
            except (ValueError, TypeError):
                pass

        # 检查 extra 字段
        if hasattr(self.model, 'extra') and isinstance(self.model.extra, dict):
            if 'total_weight' in self.model.extra:
                try:
                    return float(self.model.extra['total_weight'])
                except (ValueError, TypeError):
                    pass

        return None

    def export_to_dict(self) -> Dict[str, Any]:
        """
        将模型导出为字典

        Returns:
            模型字典
        """
        model_dict = {
            "schema_version": getattr(self.model, 'schema_version', '2.0.0'),
            "nodes": [],
            "elements": [],
            "materials": [],
            "sections": [],
            "load_cases": []
        }

        # 导出节点
        if hasattr(self.model, 'nodes'):
            for node in self.model.nodes:
                node_dict = {
                    "id": node.id,
                    "x": node.x,
                    "y": node.y,
                    "z": node.z
                }
                if hasattr(node, 'restraints') and node.restraints:
                    node_dict["restraints"] = node.restraints
                if hasattr(node, 'story') and node.story:
                    node_dict["story"] = node.story
                model_dict["nodes"].append(node_dict)

        # 导出构件
        if hasattr(self.model, 'elements'):
            for element in self.model.elements:
                elem_dict = {
                    "id": element.id,
                    "type": element.type,
                    "nodes": element.nodes,
                    "material": element.material,
                    "section": element.section
                }
                if hasattr(element, 'story') and element.story:
                    elem_dict["story"] = element.story
                if hasattr(element, 'releases') and element.releases:
                    elem_dict["releases"] = element.releases
                model_dict["elements"].append(elem_dict)

        # 导出材料
        if hasattr(self.model, 'materials'):
            for material in self.model.materials:
                mat_dict = {
                    "id": material.id,
                    "name": material.name,
                    "E": material.E,
                    "nu": material.nu,
                    "rho": material.rho
                }
                if hasattr(material, 'fy') and material.fy:
                    mat_dict["fy"] = material.fy
                if hasattr(material, 'grade') and material.grade:
                    mat_dict["grade"] = material.grade
                model_dict["materials"].append(mat_dict)

        # 导出截面
        if hasattr(self.model, 'sections'):
            for section in self.model.sections:
                sec_dict = {
                    "id": section.id,
                    "name": section.name,
                    "type": section.type
                }
                if hasattr(section, 'properties') and section.properties:
                    sec_dict["properties"] = section.properties
                if hasattr(section, 'width') and section.width:
                    sec_dict["width"] = section.width
                if hasattr(section, 'height') and section.height:
                    sec_dict["height"] = section.height
                if hasattr(section, 'diameter') and section.diameter:
                    sec_dict["diameter"] = section.diameter
                if hasattr(section, 'thickness') and section.thickness:
                    sec_dict["thickness"] = section.thickness
                model_dict["sections"].append(sec_dict)

        # 导出荷载工况
        if hasattr(self.model, 'load_cases'):
            for load_case in self.model.load_cases:
                lc_dict = {
                    "id": load_case.id,
                    "type": load_case.type,
                    "loads": load_case.loads
                }
                if hasattr(load_case, 'description') and load_case.description:
                    lc_dict["description"] = load_case.description
                model_dict["load_cases"].append(lc_dict)

        # 导出楼层
        if hasattr(self.model, 'stories'):
            model_dict["stories"] = []
            for story in self.model.stories:
                story_dict = {
                    "id": story.id,
                    "height": story.height
                }
                if hasattr(story, 'elevation') and story.elevation:
                    story_dict["elevation"] = story.elevation
                if hasattr(story, 'is_basement'):
                    story_dict["is_basement"] = story.is_basement
                if hasattr(story, 'floor_loads') and story.floor_loads:
                    story_dict["floor_loads"] = [
                        {"type": fl.type, "value": fl.value}
                        for fl in story.floor_loads
                    ]
                model_dict["stories"].append(story_dict)

        return model_dict

    def save_to_json(self, filepath: str):
        """
        保存模型到JSON文件

        Args:
            filepath: 文件路径
        """
        model_dict = self.export_to_dict()

        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(model_dict, f, indent=2, ensure_ascii=False)

        logger.info(f"模型已保存到: {filepath}")
