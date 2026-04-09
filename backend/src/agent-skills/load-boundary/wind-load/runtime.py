from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional
from datetime import datetime
import sys

from structure_protocol.structure_model_v2 import StructureModelV2, SectionV2
import logging

shared_path = Path(__file__).parent.parent / "shared"
if str(shared_path) not in sys.path:
    sys.path.insert(0, str(shared_path))

from base_generator import LoadGeneratorBase
from constants import (
    LoadType,
    validate_load_value,
    validate_element_type,
    validate_string_id
)

logger = logging.getLogger(__name__)


class WindLoadGenerator(LoadGeneratorBase):
    TERRAIN_ROUGHNESS = {
        'A': {'alpha': 0.12, 'gradient_height': 300},
        'B': {'alpha': 0.16, 'gradient_height': 350},
        'C': {'alpha': 0.22, 'gradient_height': 450},
        'D': {'alpha': 0.30, 'gradient_height': 550},
    }

    # 风压高度变化系数基准值 (GB 50009, 10m处)
    # μ_z = 0.616 × (z/10)^α, where α is terrain roughness exponent
    HEIGHT_FACTOR_BASE = 0.616

    def __init__(self, model: StructureModelV2):
        super().__init__(model)
        self._section_cache: Dict[str, Optional[SectionV2]] = {}
        self.warnings: List[Dict[str, Any]] = []
        self._warnings_by_element: Dict[str, str] = {}

    def generate_wind_loads(
        self,
        basic_pressure: float = 0.55,
        terrain_roughness: str = 'B',
        shape_factor: float = 1.3,
        wind_direction: str = 'x',
        case_id: str = "LC_W",
        case_name: str = "风载工况",
        description: str = "风荷载"
    ) -> Dict[str, Any]:
        logger.info(f"Wind loads: w0={basic_pressure}, dir={wind_direction}")

        load_case = {
            "id": case_id,
            "type": "wind",
            "description": description,
            "loads": []
        }

        elements_by_story = self._group_elements_by_story()

        for story_id, elements in elements_by_story.items():
            story_height = self._get_story_height(story_id)
            height_factor = self._calculate_height_factor(
                story_height=story_height,
                terrain_roughness=terrain_roughness
            )
            design_pressure = basic_pressure * height_factor * shape_factor

            logger.debug(f"Story {story_id}: h={story_height}m, μz={height_factor:.3f}, w0={design_pressure:.3f}")

            for elem in elements:
                load_action = self._create_wind_load_action(
                    element=elem,
                    wind_pressure=design_pressure,
                    wind_direction=wind_direction,
                    case_id=case_id
                )
                if load_action:
                    load_case["loads"].append(load_action)
                    self._add_load_action(load_action)

        for warning in self.warnings:
            element_id = warning.get("element_id")
            if element_id:
                self._warnings_by_element[element_id] = warning["message"]

        self.load_cases[case_id] = load_case
        logger.info(f"Generated {len(load_case['loads'])} actions")

        return {
            "load_case": load_case,
            "load_actions": self.load_actions,
            "warnings": self.warnings
        }

    def add_custom_wind_load(
        self,
        element_id: str,
        element_type: str,
        load_value: float,
        wind_direction: str = 'x',
        case_id: str = "LC_W"
    ) -> Dict[str, Any]:
        validate_string_id(element_id, "单元ID")
        validate_element_type(element_type)
        validate_load_value(load_value, LoadType.DISTRIBUTED_LOAD)

        valid_directions = ['x', '-x', 'y', '-y']
        if wind_direction not in valid_directions:
            raise ValueError(f"Invalid wind direction: {wind_direction}")

        load_direction = self._map_direction_to_vector(wind_direction)
        self._ensure_load_case_exists(case_id, "wind", "风荷载")

        load_action = self._create_load_action(
            element_id=element_id,
            element_type=element_type,
            load_type=LoadType.DISTRIBUTED_LOAD,
            load_value=load_value,
            load_direction=load_direction,
            case_id=case_id,
            description=f"风载: {load_value:.3f} kN/m, 方向: {wind_direction}"
        )

        self._add_load_action(load_action)
        logger.debug(f"Wind load {load_value} on {element_id}, dir={wind_direction}")
        return load_action

    def _create_wind_load_action(
        self,
        element: Any,
        wind_pressure: float,
        wind_direction: str,
        case_id: str
    ) -> Optional[Dict[str, Any]]:
        load_direction = self._map_direction_to_vector(wind_direction)
        wind_width = self._calculate_wind_width(element, wind_direction)
        linear_load = wind_pressure * wind_width

        logger.debug(f"Element {element.id}: wp={wind_pressure:.3f}, width={wind_width:.3f}, load={linear_load:.3f}")

        warning_notes = ""
        if element.id in self._warnings_by_element:
            warning_notes = f" [注意: {self._warnings_by_element[element.id]}]"

        return self._create_load_action(
            element_id=element.id,
            element_type=element.type,
            load_type=LoadType.DISTRIBUTED_LOAD,
            load_value=linear_load,
            load_direction=load_direction,
            case_id=case_id,
            description=f"风载: {wind_pressure:.3f} kN/m² × {wind_width:.2f}m = {linear_load:.3f} kN/m, 方向: {wind_direction}{warning_notes}"
        )

    def _calculate_height_factor(
        self,
        story_height: float,
        terrain_roughness: str = 'B'
    ) -> float:
        if terrain_roughness not in self.TERRAIN_ROUGHNESS:
            logger.warning(f"Unknown terrain roughness '{terrain_roughness}', using 'B'")
            terrain_roughness = 'B'

        alpha = self.TERRAIN_ROUGHNESS[terrain_roughness]['alpha']
        gradient_height = self.TERRAIN_ROUGHNESS[terrain_roughness]['gradient_height']

        if story_height < 10:
            story_height = 10

        # 风压高度变化系数: μ_z = HEIGHT_FACTOR_BASE × (z/10)^α
        mu_z = self.HEIGHT_FACTOR_BASE * (story_height / 10) ** alpha
        return min(mu_z, 2.0)

    def _get_section(self, section_id: str) -> Optional[SectionV2]:
        if section_id in self._section_cache:
            return self._section_cache[section_id]

        for sec in self.model.sections:
            if sec.id == section_id:
                self._section_cache[section_id] = sec
                return sec

        self._section_cache[section_id] = None
        return None

    def _calculate_wind_width(self, element: Any, wind_direction: str) -> float:
        from constants import DEFAULT_WIDTH_BEAM, DEFAULT_WIDTH_COLUMN, DEFAULT_WIDTH_TRUSS

        element_type = element.type
        section = self._get_section(element.section)

        if not section:
            warning_msg = f"Section '{element.section}' not found for element '{element.id}'"
            logger.warning(warning_msg)
            self.warnings.append({
                "type": "section_not_found",
                "element_id": element.id,
                "section_id": element.section,
                "message": warning_msg,
                "default_width": 1.0,
                "timestamp": datetime.now().isoformat(),
                "story_id": element.story
            })
            return 1.0

        if element_type == "column":
            if wind_direction in ['x', '-x']:
                wind_width_mm = section.height if section.height is not None else DEFAULT_WIDTH_COLUMN
            else:
                wind_width_mm = section.width if section.width is not None else DEFAULT_WIDTH_COLUMN
            wind_width_m = wind_width_mm / 1000.0
            logger.debug(f"Element {element.id} (column): width={wind_width_m:.3f}m")
            return wind_width_m

        elif element_type == "beam":
            if section.height is not None:
                wind_width_mm = section.height
            elif section.width is not None:
                wind_width_mm = section.width
            else:
                wind_width_mm = DEFAULT_WIDTH_BEAM
            wind_width_m = wind_width_mm / 1000.0
            logger.debug(f"Element {element.id} (beam): width={wind_width_m:.3f}m")
            return wind_width_m

        elif element_type == "truss":
            if section.type == "box" and section.thickness is not None:
                wind_width_mm = section.thickness * 2
            elif section.diameter is not None:
                wind_width_mm = section.diameter
            elif section.height is not None:
                wind_width_mm = section.height
            else:
                wind_width_mm = DEFAULT_WIDTH_TRUSS
            wind_width_m = wind_width_mm / 1000.0
            logger.debug(f"Element {element.id} (truss): width={wind_width_m:.3f}m")
            return wind_width_m

        elif element_type in ["wall", "shell", "slab"]:
            logger.debug(f"Element {element.id} ({element_type}): area load")
            return 1.0

        else:
            warning_msg = f"Element '{element.id}' type '{element_type}' using default width 1.0m"
            logger.warning(warning_msg)
            self.warnings.append({
                "type": "unsupported_element_type",
                "element_id": element.id,
                "element_type": element_type,
                "message": warning_msg,
                "default_width": 1.0,
                "timestamp": datetime.now().isoformat(),
                "story_id": element.story
            })
            return 1.0


def generate_wind_loads(model: StructureModelV2, parameters: Dict[str, Any]) -> Dict[str, Any]:
    generator = WindLoadGenerator(model)

    case_id = parameters.get("case_id", "LC_W")
    case_name = parameters.get("case_name", "风载工况")
    description = parameters.get("description", "风荷载")
    basic_pressure = parameters.get("basic_pressure", 0.55)
    terrain_roughness = parameters.get("terrain_roughness", "B")
    shape_factor = parameters.get("shape_factor", 1.3)
    wind_direction = parameters.get("wind_direction", "x")

    generator.generate_wind_loads(
        basic_pressure=basic_pressure,
        terrain_roughness=terrain_roughness,
        shape_factor=shape_factor,
        wind_direction=wind_direction,
        case_id=case_id,
        case_name=case_name,
        description=description
    )

    custom_loads = parameters.get("custom_loads", [])
    for load_def in custom_loads:
        generator.add_custom_wind_load(
            element_id=load_def["element_id"],
            element_type=load_def.get("element_type", "beam"),
            load_value=load_def["load_value"],
            wind_direction=load_def.get("wind_direction", "x"),
            case_id=case_id
        )

    return {
        "status": "success",
        "load_cases": generator.load_cases,
        "load_actions": generator.load_actions,
        "warnings": generator.warnings,
        "summary": {
            "case_count": len(generator.load_cases),
            "action_count": len(generator.load_actions),
            "warning_count": len(generator.warnings),
            "case_id": case_id,
            "basic_pressure": basic_pressure,
            "wind_direction": wind_direction
        }
    }
