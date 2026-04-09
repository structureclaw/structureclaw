from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Optional, List
import sys

from structure_protocol.structure_model_v2 import StructureModelV2
import logging

current_path = Path(__file__).parent
shared_path = current_path.parent / "shared"
if str(shared_path) not in sys.path:
    sys.path.insert(0, str(shared_path))

from base_generator import LoadGeneratorBase
from constants import (
    OutputMode,
    DEFAULT_OUTPUT_MODE,
    LoadDirection,
    LoadType,
    ElementType,
    TributaryWidthSource,
    get_standard_live_load,
    validate_floor_load_type,
    get_default_tributary_width
)
from model_data_helper import ModelDataHelper
from geometry_helper import GeometryHelper

logger = logging.getLogger(__name__)


class LiveLoadGenerator(LoadGeneratorBase):
    def __init__(self, model: StructureModelV2, output_mode: str = DEFAULT_OUTPUT_MODE):
        if output_mode not in [OutputMode.LINEAR, OutputMode.AREA]:
            raise ValueError(f"Invalid output mode: {output_mode}")

        super().__init__(model)
        self.output_mode = output_mode
        self._model_helper = ModelDataHelper(model)
        self._model_helper.preload_data()
        self._story_map = self._group_elements_by_story()
        self._section_cache: Dict[str, Optional[Any]] = {}

    def generate_loads(self, parameters: Dict[str, Any]) -> Dict[str, Any]:
        case_id = parameters.get("case_id", "LC_LL")
        case_name = parameters.get("case_name", "活载工况")
        description = parameters.get("description", "楼面活载")
        floor_load_type = parameters.get("floor_load_type", "office")

        self.generate_floor_live_loads(
            floor_load_type=floor_load_type,
            case_id=case_id,
            case_name=case_name,
            description=description
        )

        custom_loads = parameters.get("custom_loads", [])
        for load_def in custom_loads:
            self.add_custom_live_load(
                element_id=load_def["element_id"],
                element_type=load_def.get("element_type", "beam"),
                load_value=load_def["load_value"],
                load_direction=load_def.get("load_direction"),
                case_id=case_id
            )

        return {
            "status": "success",
            "load_cases": self.load_cases,
            "load_actions": self.load_actions,
            "summary": {
                "case_count": len(self.load_cases),
                "action_count": len(self.load_actions),
                "case_id": case_id,
                "output_mode": self.output_mode,
                "floor_type": floor_load_type
            }
        }

    def generate_floor_live_loads(
        self,
        floor_load_type: str = "office",
        case_id: str = "LC_LL",
        case_name: str = "活载工况",
        description: str = "楼面活载"
    ) -> Dict[str, Any]:
        validate_floor_load_type(floor_load_type)
        logger.info(f"Generating live loads: {floor_load_type}")

        load_case = {
            "id": case_id,
            "type": "live",
            "description": description,
            "loads": []
        }

        elements_by_story = self._story_map

        for story_id, elements in elements_by_story.items():
            for elem in elements:
                if elem.type not in ["beam", "slab"]:
                    continue

                load_value = self._get_floor_load_from_model(elem, "live")

                if load_value is None:
                    load_value = get_standard_live_load(floor_load_type)
                    logger.debug(f"Element {elem.id} (story {story_id}): standard load {load_value:.2f}")

                load_action = self._create_floor_load_action(
                    element=elem,
                    load_value=load_value,
                    case_id=case_id,
                    floor_type=floor_load_type
                )
                if load_action:
                    load_case["loads"].append(load_action)
                    self._add_load_action(load_action)

        self.load_cases[case_id] = load_case
        logger.info(f"Generated {len(load_case['loads'])} live load actions")

        return {
            "load_case": load_case,
            "load_actions": self.load_actions
        }

    def add_custom_live_load(
        self,
        element_id: str,
        element_type: str,
        load_value: float,
        load_direction: Optional[Dict[str, float]] = None,
        case_id: str = "LC_LL"
    ) -> Dict[str, Any]:
        self._validate_parameters(
            element_id=element_id,
            element_type=element_type,
            load_value=load_value,
            load_direction=load_direction
        )

        if load_direction is None:
            load_direction = LoadDirection.GRAVITY

        self._ensure_load_case_exists(case_id, "live", "活载工况")

        load_action = self._create_load_action(
            element_id=element_id,
            element_type=element_type,
            load_type=LoadType.DISTRIBUTED_LOAD,
            load_value=load_value,
            load_direction=load_direction,
            case_id=case_id,
            description=f"活载: {load_value:.3f}"
        )

        self._add_load_action(load_action)
        logger.debug(f"Live load {load_value} on {element_id}")
        return load_action

    def _create_floor_load_action(
        self,
        element: Any,
        load_value: float,
        case_id: str,
        floor_type: str
    ) -> Optional[Dict[str, Any]]:
        element_type = element.type

        if self.output_mode == OutputMode.AREA:
            load_action = {
                "id": f"LA_{element.id}_LL",
                "caseId": case_id,
                "elementType": element_type,
                "elementId": element.id,
                "loadType": "distributed_load",
                "loadValue": load_value,
                "loadDirection": {"x": 0.0, "y": 0.0, "z": -1.0},
                "description": f"{floor_type} 活载: {load_value:.3f} kN/m²",
                "extra": {
                    "load_unit": "kN/m²",
                    "load_mode": "area",
                    "floor_type": floor_type
                }
            }
            logger.debug(f"Element {element.id} ({element_type}): area load {load_value:.3f}")
            return load_action

        section = self._get_section(element.section)
        tributary_width, width_source = self._calculate_tributary_width(element)

        linear_load = load_value * tributary_width

        logger.debug(f"Element {element.id}: {load_value:.3f} × {tributary_width:.3f} = {linear_load:.3f}")

        load_action = {
            "id": f"LA_{element.id}_LL",
            "caseId": case_id,
            "elementType": element_type,
            "elementId": element.id,
            "loadType": "distributed_load",
            "loadValue": linear_load,  # kN/m - 线荷载
            "loadDirection": {"x": 0.0, "y": 0.0, "z": -1.0},
            "description": f"{floor_type} 活载: {load_value:.3f} kN/m² × {tributary_width:.2f}m = {linear_load:.3f} kN/m",
            "extra": {
                "area_load": load_value,  # 保留原始面荷载值 (kN/m²)
                "tributary_width": tributary_width,  # 保留受荷宽度 (m)
                "tributary_width_source": width_source,  # 'geometry' 或 'default'
                "calculation": f"{load_value:.3f} × {tributary_width:.3f} = {linear_load:.3f}",
                "load_unit": "kN/m",
                "load_mode": "linear",
                "floor_type": floor_type
            }
        }

        return load_action

    def _get_section(self, section_id: str) -> Any:
        if section_id in self._section_cache:
            return self._section_cache[section_id]

        for sec in self.model.sections:
            if sec.id == section_id:
                self._section_cache[section_id] = sec
                return sec

        self._section_cache[section_id] = None
        return None

    def _get_floor_load_from_model(
        self,
        element: Any,
        load_type: str
    ) -> Optional[float]:
        story_id = element.story
        if not story_id:
            return None

        story = None
        for s in self.model.stories:
            if s.id == story_id:
                story = s
                break

        if not story:
            return None

        for floor_load in story.floor_loads:
            if floor_load.type == load_type:
                logger.debug(f"Found floor_load: story={story_id}, type={load_type}, value={floor_load.value}")
                return float(floor_load.value)

        return None

    def _calculate_tributary_width_from_geometry(
        self,
        element: Any
    ) -> Optional[float]:
        return GeometryHelper.calculate_tributary_width_from_geometry(
            element,
            self.model,
            self._model_helper
        )

    def _calculate_tributary_width(
        self,
        element: Any
    ) -> tuple[float, str]:
        element_type = element.type

        tributary_width = self._calculate_tributary_width_from_geometry(element)
        if tributary_width is not None:
            return tributary_width, 'geometry'

        if element_type == ElementType.BEAM:
            tributary_width_m = DEFAULT_WIDTH_BEAM / 1000.0
            logger.warning(f"Element {element.id}: using default width {tributary_width_m:.2f}m")
        elif element_type == "slab":
            tributary_width_m = 1.0
        else:
            tributary_width_m = 1.0
            logger.debug(f"Element {element.id} ({element_type}): using 1.0m")

        return tributary_width_m, 'default'

    def _validate_parameters(
        self,
        element_id: str,
        element_type: str,
        load_value: float,
        load_direction: Optional[Dict[str, float]] = None
    ) -> None:
        from constants import validate_element_type, validate_numeric_value, validate_string_id, validate_dict_value

        validate_string_id(element_id, "单元ID")
        validate_element_type(element_type)
        validate_numeric_value(load_value, "荷载值", min_value=0.0)

        if load_direction is not None:
            validate_dict_value(load_direction, "荷载方向", ['x', 'y', 'z'])


def generate_live_loads(model: StructureModelV2, parameters: Dict[str, Any]) -> Dict[str, Any]:
    """
    生成活载工况

    Args:
        model: 结构模型
        parameters: 荷载参数字典

    Returns:
        荷载生成结果
    """
    # 输入验证
    if not isinstance(parameters, dict):
        return {
            "status": "error",
            "error": "Invalid parameters: expected dict",
            "load_cases": {},
            "load_actions": {},
            "summary": {}
        }

    # 提取输出模式
    output_mode = parameters.get("output_mode", "linear")

    # 创建生成器并生成荷载
    generator = LiveLoadGenerator(model, output_mode=output_mode)
    return generator.generate_loads(parameters)
