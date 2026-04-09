from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional
import sys

from structure_protocol.structure_model_v2 import StructureModelV2
import logging

# 添加路径用于导入
current_path = Path(__file__).parent
shared_path = current_path.parent / "shared"
if str(shared_path) not in sys.path:
    sys.path.insert(0, str(shared_path))

from base_generator import LoadGeneratorBase
from constants import LoadType
from .base_shear_calculator import BaseShearCalculator, WeightCalculationMethod
from .force_distributor import ForceDistributor, ForceDistributeMethod
from .utils import validate_seismic_parameters

logger = logging.getLogger(__name__)


class SeismicLoadGenerator(LoadGeneratorBase):
    def __init__(
        self,
        model: StructureModelV2,
        weight_calculation_method: Optional[WeightCalculationMethod] = None,
        force_distribute_method: Optional[ForceDistributeMethod] = None
    ):
        super().__init__(model)

        # 初始化模型数据助手（避免重复创建）
        from model_data_helper import ModelDataHelper
        self.model_helper = ModelDataHelper(model)

        self.base_shear_calculator = BaseShearCalculator(
            model,
            weight_calculation_method or WeightCalculationMethod.AUTO
        )
        self.force_distributor = ForceDistributor(
            model,
            force_distribute_method or ForceDistributeMethod.AUTO
        )

    def generate_seismic_loads(
        self,
        intensity: float = 7.0,
        site_category: str = 'II',
        design_group: str = '第二组',
        damping_ratio: float = 0.05,
        seismic_direction: str = 'x',
        case_id: str = "LC_E",
        case_name: str = "地震工况",
        description: str = "地震荷载",
        weight_calculation_method: Optional[WeightCalculationMethod] = None,
        force_distribute_method: Optional[ForceDistributeMethod] = None,
        live_load_factor: float = 0.5
    ) -> Dict[str, Any]:
        is_valid, errors = validate_seismic_parameters(
            intensity=intensity,
            site_category=site_category,
            design_group=design_group,
            damping_ratio=damping_ratio,
            live_load_factor=live_load_factor
        )

        if not is_valid:
            error_msg = "地震荷载参数验证失败:\n" + "\n".join(errors)
            logger.error(error_msg)
            raise ValueError(error_msg)

        logger.info(
            f"Seismic: intensity={intensity}, site={site_category}, dir={seismic_direction}"
        )

        load_case = {
            "id": case_id,
            "type": "seismic",
            "description": description,
            "loads": []
        }

        base_shear_result = self.base_shear_calculator.calculate_base_shear(
            intensity=intensity,
            site_category=site_category,
            design_group=design_group,
            damping_ratio=damping_ratio,
            live_load_factor=live_load_factor,
            weight_calculation_method=weight_calculation_method
        )

        base_shear = base_shear_result["base_shear"]
        logger.info(f"Base shear: {base_shear:.2f} kN ({base_shear_result['weight_calculation_method']})")

        elements_by_story = self._group_elements_by_story()
        story_forces = self._distribute_seismic_force(
            elements_by_story=elements_by_story,
            base_shear=base_shear
        )

        for story_id, elements in elements_by_story.items():
            # 跳过没有分配地震力的楼层（如地下室）
            if story_id not in story_forces:
                logger.debug(f"Story {story_id}: skipped (no force assigned)")
                continue

            story_force = story_forces[story_id]

            distributed_forces = self.force_distributor.distribute_force_to_floor(
                floor_elements=elements,
                total_force=story_force,
                direction=seismic_direction,
                distribute_method=force_distribute_method
            )

            for elem in elements:
                if elem.id in distributed_forces:
                    force_data = distributed_forces[elem.id]
                    load_action = self._create_seismic_load_action(
                        element=elem,
                        force_data=force_data,
                        case_id=case_id,
                        story_id=story_id
                    )
                    if load_action:
                        load_case["loads"].append(load_action)
                        self._add_load_action(load_action)

        self.load_cases[case_id] = load_case
        logger.info(f"Generated {len(load_case['loads'])} actions")

        return {
            "load_case": load_case,
            "load_actions": self.load_actions,
            "base_shear_result": base_shear_result,
            "story_forces": story_forces
        }

    def add_custom_seismic_load(
        self,
        element_id: str,
        element_type: str,
        load_value: float,
        seismic_direction: str = 'x',
        case_id: str = "LC_E"
    ) -> Dict[str, Any]:
        load_direction = self._map_direction_to_vector(seismic_direction)
        self._ensure_load_case_exists(case_id, "seismic", "地震荷载")

        load_action = self._create_load_action(
            element_id=element_id,
            element_type=element_type,
            load_type=LoadType.POINT_FORCE,
            load_value=load_value,
            load_direction=load_direction,
            case_id=case_id,
            description=f"地震力: {load_value:.2f} kN"
        )

        self._add_load_action(load_action)
        logger.debug(f"Seismic load {load_value} kN on {element_id}, dir={seismic_direction}")
        return load_action

    def _distribute_seismic_force(self, elements_by_story: Dict[str, list], base_shear: float) -> Dict[str, float]:

        if not elements_by_story:
            return {}

        # 使用楼层标高进行排序，支持复杂命名如 'B1', '1F', 'RF'
        story_ids = sorted(elements_by_story.keys(), key=lambda x: self._get_story_height(x))

        # 获取所有楼层的实际标高
        story_elevations = {}
        for story_id in story_ids:
            elevation = self._get_story_height(story_id)
            story_elevations[story_id] = elevation

        # 计算基准标高（最低楼层的标高）
        base_elevation = min(story_elevations.values()) if story_elevations else 0.0

        story_data = []
        total_weighted_height = 0.0

        for story_id in story_ids:
            story_weight = self._calculate_story_weight(elements_by_story[story_id])
            # 使用相对高度（楼层标高 - 基准标高）
            story_height = story_elevations[story_id] - base_elevation

            # 跳过相对高度为负或零的楼层（地下室或基准层）
            if story_height <= 0:
                logger.debug(f"Story {story_id}: skipped (height={story_height:.2f}m <= 0)")
                continue

            weighted_height = story_weight * story_height
            total_weighted_height += weighted_height

            story_data.append({
                'id': story_id,
                'weight': story_weight,
                'height': story_height,
                'weighted_height': weighted_height
            })

            logger.debug(f"Story {story_id}: weight={story_weight:.2f}kN, h={story_height:.2f}m")

        # 返回 story_id -> force 映射，避免索引不匹配
        story_forces_dict = {}
        for data in story_data:
            force = (base_shear * data['weighted_height'] / total_weighted_height) if total_weighted_height > 0 else 0.0
            story_forces_dict[data['id']] = force

        logger.info(f"Story forces: total={base_shear:.2f}kN, {len(story_forces_dict)} stories")
        for story_id, force in story_forces_dict.items():
            logger.debug(f"  {story_id}: {force:.2f}kN")

        return story_forces_dict

    def _calculate_story_weight(self, elements: list) -> float:
        total_weight = 0.0

        for elem in elements:
            if elem.type not in ["beam", "column", "wall", "slab"]:
                continue

            material = self.model_helper.get_material(elem.material)
            section = self.model_helper.get_section(elem.section)

            if not material or not section:
                continue

            element_weight = self._calculate_element_weight(elem, material, section)
            total_weight += element_weight

        return total_weight

    def _calculate_element_weight(
        self,
        element: Any,
        material: Any,
        section: Any
    ) -> float:
        from constants import KG_TO_KN
        from geometry_helper import GeometryHelper

        elem_length = GeometryHelper.calculate_element_length(element, self.model_helper)
        if elem_length is None or elem_length <= 0:
            return 0.0

        area = GeometryHelper.calculate_section_area(section)
        if area is None:
            return 0.0

        volume = area * elem_length
        weight_kg = volume * material.rho
        weight_kn = weight_kg * KG_TO_KN

        return weight_kn

    def _create_seismic_load_action(
        self,
        element: Any,
        force_data: Dict[str, Any],
        case_id: str,
        story_id: str
    ) -> Optional[Dict[str, Any]]:
        element_force = force_data.get("force", 0.0)
        load_direction = force_data.get("direction", {"x": 0.0, "y": 0.0, "z": 0.0})

        extra_fields = {}
        if "stiffness" in force_data:
            extra_fields["stiffness"] = force_data["stiffness"]
        if "stiffness_ratio" in force_data:
            extra_fields["stiffness_ratio"] = force_data["stiffness_ratio"]
        if "distribution_ratio" in force_data:
            extra_fields["distribution_ratio"] = force_data["distribution_ratio"]

        return self._create_load_action(
            element_id=element.id,
            element_type=element.type,
            load_type=LoadType.POINT_FORCE,
            load_value=element_force,
            load_direction=load_direction,
            case_id=case_id,
            extra_fields=extra_fields,
            description=f"地震力: {element_force:.2f} kN"
        )


def generate_seismic_loads(model: StructureModelV2, parameters: Dict[str, Any]) -> Dict[str, Any]:
    case_id = parameters.get("case_id", "LC_E")
    case_name = parameters.get("case_name", "地震工况")
    description = parameters.get("description", "地震荷载")
    intensity = parameters.get("intensity", 7.0)
    site_category = parameters.get("site_category", "II")
    design_group = parameters.get("design_group", "第二组")
    damping_ratio = parameters.get("damping_ratio", 0.05)
    seismic_direction = parameters.get("seismic_direction", "x")

    is_valid, errors = validate_seismic_parameters(
        intensity=intensity,
        site_category=site_category,
        design_group=design_group,
        damping_ratio=damping_ratio,
        live_load_factor=parameters.get("live_load_factor", 0.5)
    )

    if not is_valid:
        error_msg = "地震荷载参数验证失败:\n" + "\n".join(errors)
        logger.error(error_msg)
        return {
            "status": "error",
            "error": error_msg,
            "errors": errors
        }

    weight_calculation_method = _parse_weight_calculation_method(
        parameters.get("weight_calculation_method", "auto")
    )
    force_distribute_method = _parse_force_distribute_method(
        parameters.get("force_distribute_method", "auto")
    )
    live_load_factor = parameters.get("live_load_factor", 0.5)

    generator = SeismicLoadGenerator(
        model,
        weight_calculation_method=weight_calculation_method,
        force_distribute_method=force_distribute_method
    )

    result = generator.generate_seismic_loads(
        intensity=intensity,
        site_category=site_category,
        design_group=design_group,
        damping_ratio=damping_ratio,
        seismic_direction=seismic_direction,
        case_id=case_id,
        case_name=case_name,
        description=description,
        weight_calculation_method=weight_calculation_method,
        force_distribute_method=force_distribute_method,
        live_load_factor=live_load_factor
    )

    custom_loads = parameters.get("custom_loads", [])
    for load_def in custom_loads:
        generator.add_custom_seismic_load(
            element_id=load_def["element_id"],
            element_type=load_def.get("element_type", "beam"),
            load_value=load_def["load_value"],
            seismic_direction=load_def.get("seismic_direction", "x"),
            case_id=case_id
        )

    return {
        "status": "success",
        "load_cases": generator.load_cases,
        "load_actions": generator.load_actions,
        "summary": {
            "case_count": len(generator.load_cases),
            "action_count": len(generator.load_actions),
            "case_id": case_id,
            "intensity": intensity,
            "site_category": site_category,
            "design_group": design_group,
            "seismic_direction": seismic_direction,
            "weight_calculation_method": weight_calculation_method.value,
            "force_distribute_method": force_distribute_method.value,
            "live_load_factor": live_load_factor
        },
        "calculation_details": {
            "base_shear": result.get("base_shear_result", {}).get("base_shear", 0),
            "total_weight": result.get("base_shear_result", {}).get("total_weight", 0),
            "alpha_max": result.get("base_shear_result", {}).get("alpha_max", 0),
            "story_forces": result.get("story_forces", [])
        }
    }


def _parse_weight_calculation_method(method_str: str) -> WeightCalculationMethod:
    method_map = {
        "auto": WeightCalculationMethod.AUTO,
        "from_model_direct": WeightCalculationMethod.FROM_MODEL_DIRECT,
        "from_elements": WeightCalculationMethod.FROM_ELEMENTS,
        "from_floors": WeightCalculationMethod.FROM_FLOORS,
    }
    return method_map.get(method_str.lower(), WeightCalculationMethod.AUTO)


def _parse_force_distribute_method(method_str: str) -> ForceDistributeMethod:
    method_map = {
        "auto": ForceDistributeMethod.AUTO,
        "by_stiffness": ForceDistributeMethod.BY_STIFFNESS,
        "by_distance": ForceDistributeMethod.BY_DISTANCE,
        "evenly": ForceDistributeMethod.EVENLY
    }
    return method_map.get(method_str.lower(), ForceDistributeMethod.AUTO)

