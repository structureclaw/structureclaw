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


class CraneLoadGenerator:
    def __init__(self, model: StructureModelV2):
        self.model = model
        self.load_cases = {}
        self.load_actions = []

    def generate_crane_loads(
        self,
        case_id: str = "LC_CRANE",
        case_name: str = "吊车荷载工况",
        description: str = "桥式起重机荷载",
        crane_capacity: float = 50.0,
        crane_span: float = 30.0,
        load_positions: List[Dict[str, float]] = None
    ) -> Dict[str, Any]:
        validate_string_id(case_id, "工况ID")
        validate_numeric_value(crane_capacity, "吊车起重量", min_value=0.1, max_value=1000.0)
        validate_numeric_value(crane_span, "吊车跨度", min_value=1.0, max_value=200.0)
        
        logger.info(f"Crane loads: {case_id}, capacity={crane_capacity}kN, span={crane_span}m")

        load_case = {
            "id": case_id,
            "type": "crane",
            "description": f"吊车容量: {crane_capacity} kN, 跨度: {crane_span} m",
            "loads": []
        }

        if load_positions is None:
            load_positions = [
                {"x": crane_span / 2, "y": 0.0, "z": 0.0}
            ]

        for elem in self.model.elements:
            try:
                if elem.type == "beam":
                    for pos in load_positions:
                        load_action = self._calculate_crane_load(
                            element=elem,
                            position=pos,
                            crane_capacity=crane_capacity,
                            crane_span=crane_span
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
        logger.info(f"Generated {len(load_case['loads'])} actions")

        return {
            "load_case": load_case,
            "load_actions": self.load_actions
        }

    def _calculate_crane_load(
        self,
        element: Any,
        position: Dict[str, float],
        crane_capacity: float,
        crane_span: float
    ) -> Dict[str, Any]:
        return {
            "id": f"CRANE_{element.id}_{position['x']}",
            "caseId": "LC_CRANE",
            "elementType": element.type,
            "elementId": element.id,
            "loadType": "point_force",
            "loadValue": crane_capacity,
            "loadDirection": {"x": 0.0, "y": 0.0, "z": -1.0},
            "position": position,
            "extra": {
                "crane_capacity": crane_capacity,
                "crane_span": crane_span,
                "dynamic_factor": 1.1
            }
        }
