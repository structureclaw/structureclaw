from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict, List

from structure_protocol.structure_model_v2 import StructureModelV2
import logging

# 添加 shared 模块路径
shared_path = Path(__file__).parent.parent / "shared"
if str(shared_path) not in sys.path:
    sys.path.insert(0, str(shared_path))

from constants import (
    LoadType,
    ElementType,
    validate_element_type,
    validate_numeric_value,
    validate_string_id,
)

logger = logging.getLogger(__name__)


class SnowLoadGenerator:
    SNOW_LOAD_BASE_VALUES = {
        "region_1": 0.3,
        "region_2": 0.5,
        "region_3": 0.7,
    }

    ROOF_TYPE_FACTORS = {
        "flat": 1.0,
        "sloped_25": 0.8,
        "sloped_25_50": 0.6,
        "sloped_50": 0.0,
    }

    def __init__(self, model: StructureModelV2):
        self.model = model
        self.load_cases = {}
        self.load_actions = []

    def generate_snow_loads(
        self,
        case_id: str = "LC_SNOW",
        case_name: str = "雪荷载工况",
        description: str = "屋面积雪荷载",
        region: str = "region_2",
        roof_type: str = "flat"
    ) -> Dict[str, Any]:
        validate_string_id(case_id, "工况ID")
        
        valid_regions = list(self.SNOW_LOAD_BASE_VALUES.keys())
        if region not in valid_regions:
            raise ValueError(f"Invalid region: {region}, valid: {valid_regions}")
        
        valid_roof_types = list(self.ROOF_TYPE_FACTORS.keys())
        if roof_type not in valid_roof_types:
            raise ValueError(f"Invalid roof type: {roof_type}, valid: {valid_roof_types}")
        
        logger.info(f"Snow loads: {case_id}, region={region}, roof={roof_type}")

        # 计算设计雪载
        base_snow_load = self.SNOW_LOAD_BASE_VALUES.get(region, 0.0)
        roof_factor = self.ROOF_TYPE_FACTORS.get(roof_type, 1.0)
        design_snow_load = base_snow_load * roof_factor

        load_case = {
            "id": case_id,
            "type": "snow",
            "description": f"基本雪载: {base_snow_load} kN/m², 修正系数: {roof_factor}",
            "loads": []
        }

        for elem in self.model.elements:
            try:
                if elem.type == "slab":
                    load_action = self._calculate_snow_load(
                        element=elem,
                        snow_load=design_snow_load,
                        case_id=case_id
                    )

                    if load_action:
                        load_case["loads"].append(load_action)
                        self.load_actions.append(load_action)

            except (ValueError, ArithmeticError) as error:
                logger.debug(f"Element {elem.id}: {error}")
                continue
            except RuntimeError as error:
                logger.debug(f"Element {elem.id}: {error}")
                continue

        self.load_cases[case_id] = load_case
        logger.info(f"Generated {len(load_case['loads'])} actions, snow_load={design_snow_load}")

        return {
            "load_case": load_case,
            "load_actions": self.load_actions
        }

    def _calculate_snow_load(
        self,
        element: Any,
        snow_load: float,
        case_id: str = "LC_SNOW"
    ) -> Dict[str, Any]:
        return {
            "id": f"SNOW_{element.id}",
            "caseId": case_id,
            "elementType": element.type,
            "elementId": element.id,
            "loadType": "distributed_load",
            "loadValue": snow_load,
            "loadDirection": {"x": 0.0, "y": 0.0, "z": -1.0},
            "extra": {
                "snow_load": snow_load,
                "distribution_type": "uniform",
                "load_unit": "kN/m²"
            }
        }
