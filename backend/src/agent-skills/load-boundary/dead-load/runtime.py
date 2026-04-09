from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Optional

from structure_protocol.structure_model_v2 import StructureModelV2
import logging

current_path = Path(__file__).parent
shared_path = current_path.parent / "shared"
import sys
if str(shared_path) not in sys.path:
    sys.path.insert(0, str(shared_path))

from base_generator import LoadGeneratorBase
from constants import (
    LoadDirection,
    LoadType,
    validate_load_value,
    validate_element_type,
    get_material_density,
    LINEAR_LOAD_CONVERSION
)
from model_data_helper import ModelDataHelper
from geometry_helper import GeometryHelper

logger = logging.getLogger(__name__)


class DeadLoadGenerator(LoadGeneratorBase):
    def __init__(self, model: StructureModelV2):
        super().__init__(model)
        self._model_helper = ModelDataHelper(model)
        self._model_helper.preload_data()

    def generate_loads(self, parameters: Dict[str, Any]) -> Dict[str, Any]:
        case_id = parameters.get("case_id", "LC_DE")
        case_name = parameters.get("case_name", "恒载工况")
        description = parameters.get("description", "结构自重及永久荷载")
        include_self_weight = parameters.get("include_self_weight", True)

        if include_self_weight:
            result = self.generate_self_weight_loads(
                case_id=case_id,
                case_name=case_name,
                description=description
            )
        else:
            self._ensure_load_case_exists(case_id, "dead", description)
            result = {
                "load_case": self.load_cases[case_id],
                "load_actions": []
            }

        uniform_loads = parameters.get("uniform_loads", [])
        for load_def in uniform_loads:
            self.add_uniform_dead_load(
                element_id=load_def["element_id"],
                element_type=load_def.get("element_type", "beam"),
                load_value=load_def["load_value"],
                load_direction=load_def.get("load_direction"),
                case_id=case_id,
                case_name=case_name
            )

        return {
            "status": "success",
            "load_cases": self.load_cases,
            "load_actions": self.load_actions,
            "summary": {
                "case_count": len(self.load_cases),
                "action_count": len(self.load_actions),
                "case_id": case_id
            }
        }

    def generate_self_weight_loads(
        self,
        case_id: str = "LC_DE",
        case_name: str = "恒载工况",
        description: str = "结构自重及永久荷载"
    ) -> Dict[str, Any]:
        logger.info(f"Generating self-weight loads: {case_id}")

        load_case = {
            "id": case_id,
            "type": "dead",
            "description": description,
            "loads": []
        }

        for elem in self.model.elements:
            try:
                material = self._model_helper.get_material(elem.material)
                if not material:
                    continue

                section = self._model_helper.get_section(elem.section)
                if not section:
                    continue

                load_action = self._calculate_self_weight(
                    element=elem,
                    material=material,
                    section=section,
                    case_id=case_id
                )

                if load_action:
                    load_case["loads"].append(load_action)
                    self._add_load_action(load_action)

            except (ValueError, ArithmeticError, RuntimeError) as error:
                logger.debug(f"Element {elem.id}: {error}")
                continue

        self.load_cases[case_id] = load_case
        logger.info(f"Generated {len(load_case['loads'])} self-weight load actions")

        return {
            "load_case": load_case,
            "load_actions": self.load_actions
        }

    def add_uniform_dead_load(
        self,
        element_id: str,
        element_type: str,
        load_value: float,
        load_direction: Optional[Dict[str, float]] = None,
        case_id: str = "LC_DE",
        case_name: str = "恒载工况"
    ) -> Dict[str, Any]:
        self._validate_parameters(
            element_id=element_id,
            element_type=element_type,
            load_value=load_value,
            load_direction=load_direction
        )

        if load_direction is None:
            load_direction = LoadDirection.GRAVITY

        self._ensure_load_case_exists(case_id, "dead", case_name)

        load_action = self._create_load_action(
            element_id=element_id,
            element_type=element_type,
            load_type=LoadType.DISTRIBUTED_LOAD,
            load_value=load_value,
            load_direction=load_direction,
            case_id=case_id,
            description=f"恒载: {load_value:.3f} kN/m"
        )

        self._add_load_action(load_action)
        logger.debug(f"Dead load {load_value} on {element_id}")
        return load_action

    def add_point_dead_load(
        self,
        element_id: str,
        element_type: str,
        load_value: float,
        position: Dict[str, float],
        load_direction: Optional[Dict[str, float]] = None,
        case_id: str = "LC_DE"
    ) -> Dict[str, Any]:
        self._validate_parameters(
            element_id=element_id,
            element_type=element_type,
            load_value=load_value,
            load_direction=load_direction,
            load_type=LoadType.POINT_FORCE
        )

        if load_direction is None:
            load_direction = LoadDirection.GRAVITY

        self._ensure_load_case_exists(case_id, "dead", f"恒载工况 {case_id}")

        load_action = self._create_load_action(
            element_id=element_id,
            element_type=element_type,
            load_type=LoadType.POINT_FORCE,
            load_value=load_value,
            load_direction=load_direction,
            case_id=case_id,
            extra_fields={"position": position},
            description=f"集中恒载: {load_value:.3f} kN"
        )

        self._add_load_action(load_action)
        logger.debug(f"Point dead load {load_value} on {element_id}")
        return load_action

    def _calculate_self_weight(
        self,
        element: Any,
        material: Any,
        section: Any,
        case_id: str = "LC_DE"
    ) -> Optional[Dict[str, Any]]:
        density = get_material_density(material.category)
        if hasattr(material, 'rho') and material.rho:
            density = material.rho

        area = GeometryHelper.calculate_section_area(section)
        if area is None or area <= 0:
            return None

        linear_load = density * LINEAR_LOAD_CONVERSION * area

        return self._create_load_action(
            element_id=element.id,
            element_type=element.type,
            load_type=LoadType.DISTRIBUTED_LOAD,
            load_value=linear_load,
            load_direction=LoadDirection.GRAVITY,
            case_id=case_id,
            description=f"自重: {linear_load:.4f} kN/m"
        )

    def _validate_parameters(
        self,
        element_id: str,
        element_type: str,
        load_value: float,
        load_direction: Optional[Dict[str, float]] = None,
        load_type: str = LoadType.DISTRIBUTED_LOAD
    ) -> None:
        from constants import validate_element_type, validate_string_id, validate_dict_value

        validate_string_id(element_id, "单元ID")
        validate_element_type(element_type)
        validate_load_value(load_value, load_type)

        if load_direction is not None:
            validate_dict_value(load_direction, "荷载方向", ['x', 'y', 'z'])


def generate_dead_loads(model: StructureModelV2, parameters: Dict[str, Any]) -> Dict[str, Any]:
    generator = DeadLoadGenerator(model)
    return generator.generate_loads(parameters)
