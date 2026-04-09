"""
荷载生成器基类 / Load Generator Base Class

提供所有荷载生成器的通用功能，消除代码重复。
"""

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional
import logging
from collections import defaultdict

from structure_protocol.structure_model_v2 import StructureModelV2

logger = logging.getLogger(__name__)


class LoadGeneratorBase(ABC):
    """
    荷载生成器基类 / Load Generator Base

    为所有荷载生成器提供通用功能：
    - 按楼层分组构件
    - 荷载工况管理
    - 荷载动作管理
    - 参数验证
    - 方向向量映射
    """

    def __init__(self, model: StructureModelV2):
        """
        初始化荷载生成器基类

        Args:
            model: V2 结构模型
        """
        self.model = model
        self.load_cases: Dict[str, Any] = {}
        self.load_actions: List[Dict[str, Any]] = []

    @abstractmethod
    def generate_loads(self, **kwargs) -> Dict[str, Any]:
        """
        生成荷载（抽象方法，由子类实现）

        Args:
            **kwargs: 生成参数

        Returns:
            生成结果
        """
        pass

    def get_load_cases(self) -> Dict[str, Any]:
        """获取所有荷载工况"""
        return self.load_cases

    def get_load_actions(self) -> List[Dict[str, Any]]:
        """获取所有荷载动作"""
        return self.load_actions

    def _group_elements_by_story(self) -> Dict[str, List[Any]]:
        """
        按楼层分组构件

        Returns:
            楼层到构件列表的映射
        """
        elements_by_story = defaultdict(list)
        undefined_elements = []

        for elem in self.model.elements:
            story_id = getattr(elem, 'story', None)
            if story_id:
                elements_by_story[story_id].append(elem)
            else:
                undefined_elements.append(elem.id)

        if undefined_elements:
            logger.warning(
                f"Found {len(undefined_elements)} element(s) without story assignment: "
                f"{undefined_elements[:10]}{'...' if len(undefined_elements) > 10 else ''}"
            )

        return dict(elements_by_story)

    def _ensure_load_case_exists(
        self,
        case_id: str,
        case_type: str,
        description: str = ""
    ) -> None:
        """
        确保荷载工况存在

        Args:
            case_id: 荷载工况ID
            case_type: 荷载工况类型
            description: 荷载工况描述
        """
        if case_id not in self.load_cases:
            self.load_cases[case_id] = {
                "id": case_id,
                "type": case_type,
                "description": description,
                "loads": []
            }

    def _get_story_height(self, story_id: str) -> float:
        """
        获取楼层标高

        Args:
            story_id: 楼层ID

        Returns:
            楼层标高 (m)，确保总是返回可比较的float值
        """
        # 首先尝试从stories获取
        if hasattr(self.model, 'stories') and self.model.stories:
            for story in self.model.stories:
                if story.id == story_id:
                    # 显式检查elevation是否为None，避免与0.0混淆
                    if story.elevation is not None:
                        return float(story.elevation)
                    # elevation为None时，继续尝试其他方法

        # 从节点计算标高（作为备选方案）
        node_z_values = []
        if hasattr(self.model, 'nodes') and self.model.nodes:
            for node in self.model.nodes:
                if hasattr(node, 'story') and node.story == story_id:
                    node_z_values.append(float(node.z))

        if node_z_values:
            return sum(node_z_values) / len(node_z_values)

        # 如果都无法获取，返回一个基于story_id的默认值，确保可排序
        # 对于格式如 "F1", "F2", "B1" 等，尝试解析数字
        try:
            if story_id.startswith(('F', 'f')):
                # F1, F2, F3...  提取数字
                num = int(story_id[1:])
                return float(num * 3.6)  # 假设标准层高3.6m
            elif story_id.startswith(('B', 'b')):
                # B1, B2, B3...  地下层
                num = int(story_id[1:])
                return float(-num * 3.6)
        except (ValueError, IndexError):
            pass

        # 最后的备选：返回0.0
        logger.warning(f"无法确定楼层 {story_id} 的标高，使用默认值 0.0")
        return 0.0

    @staticmethod
    def _map_direction_to_vector(direction: str) -> Dict[str, float]:
        """
        将方向字符串映射为方向向量

        Args:
            direction: 方向字符串 (x, -x, y, -y, z, -z)

        Returns:
            方向向量字典

        Raises:
            ValueError: 当方向无效时
        """
        direction_map = {
            'x': {"x": 1.0, "y": 0.0, "z": 0.0},
            '-x': {"x": -1.0, "y": 0.0, "z": 0.0},
            'y': {"x": 0.0, "y": 1.0, "z": 0.0},
            '-y': {"x": 0.0, "y": -1.0, "z": 0.0},
            'z': {"x": 0.0, "y": 0.0, "z": 1.0},
            '-z': {"x": 0.0, "y": 0.0, "z": -1.0},
            'gravity': {"x": 0.0, "y": 0.0, "z": -1.0}
        }

        if direction not in direction_map:
            raise ValueError(
                f"无效的方向: {direction}. "
                f"有效值为: {list(direction_map.keys())}"
            )

        return direction_map[direction]

    @staticmethod
    def _create_load_action(
        element_id: str,
        element_type: str,
        load_type: str,
        load_value: float,
        load_direction: Dict[str, float],
        case_id: str,
        extra_fields: Optional[Dict[str, Any]] = None,
        description: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        创建标准化的荷载动作

        Args:
            element_id: 单元ID
            element_type: 单元类型
            load_type: 荷载类型
            load_value: 荷载值
            load_direction: 荷载方向
            case_id: 荷载工况ID
            extra_fields: 额外字段
            description: 描述

        Returns:
            荷载动作字典
        """
        load_action = {
            "id": f"LA_{element_id}_{case_id}",
            "caseId": case_id,
            "elementType": element_type,
            "elementId": element_id,
            "loadType": load_type,
            "loadValue": load_value,
            "loadDirection": load_direction
        }

        if extra_fields:
            load_action.update(extra_fields)

        if description:
            load_action["description"] = description

        return load_action

    def _add_load_action(self, load_action: Dict[str, Any]) -> None:
        """
        添加荷载动作到列表和对应的荷载工况

        Args:
            load_action: 荷载动作字典
        """
        self.load_actions.append(load_action)

        case_id = load_action.get("caseId")
        if case_id and case_id in self.load_cases:
            self.load_cases[case_id]["loads"].append(load_action)
