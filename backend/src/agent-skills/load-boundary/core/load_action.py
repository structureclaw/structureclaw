"""
荷载动作管理模块
提供荷载动作的 CRUD 操作
对齐 V2 Schema (LoadCaseV2.loads 中的动作项)
"""

from typing import Any, Dict, Optional


def create_load_action(
    action_id: str,
    case_id: str,
    element_type: str,
    element_id: str,
    load_type: str,
    load_value: float,
    extra: Optional[Dict[str, Any]] = None,
    load_direction: Optional[Dict[str, Any]] = None,
    position: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    模块级工厂函数 - 创建荷载动作 (对齐 V2 Schema)

    Args:
        action_id: 动作ID
        case_id: 所属工况ID
        element_type: 单元类型
        element_id: 单元ID
        load_type: 荷载类型
        load_value: 荷载值
        extra: 扩展字段
        load_direction: 荷载方向向量
        position: 荷载位置

    Returns:
        荷载动作字典 (使用驼峰命名)
    """
    action = LoadAction(
        action_id=action_id,
        case_id=case_id,
        element_type=element_type,
        element_id=element_id,
        load_type=load_type,
        load_value=load_value,
        extra=extra
    )
    result = action.to_dict()
    if load_direction:
        result["loadDirection"] = load_direction
    if position:
        result["position"] = position
    return result


class LoadAction:
    """荷载动作类 - 对齐 V2 Schema"""

    def __init__(
        self,
        action_id: str,
        case_id: str,
        element_type: str,
        element_id: str,
        load_type: str,
        load_value: float,
        extra: Optional[Dict[str, Any]] = None
    ):
        """
        初始化荷载动作

        Args:
            action_id: 动作ID
            case_id: 所属工况ID
            element_type: 单元类型
            element_id: 单元ID
            load_type: 荷载类型
            load_value: 荷载值
            extra: 扩展字段 (对齐 V2 Schema)
        """
        self.action_id = action_id
        self.case_id = case_id
        self.element_type = element_type
        self.element_id = element_id
        self.load_type = load_type
        self.load_value = load_value
        self.extra: Dict[str, Any] = extra or {}

    def create_load_action(
        self,
        load_direction: Optional[Dict[str, Any]] = None,
        position: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """创建荷载动作 - 对齐 V2 Schema 格式"""
        result = self.to_dict()
        if load_direction:
            result["loadDirection"] = load_direction
        if position:
            result["position"] = position
        return result

    def modify_load_action(self, **kwargs) -> Dict[str, Any]:
        """修改荷载动作"""
        if 'load_value' in kwargs:
            self.load_value = kwargs['load_value']
        if 'extra' in kwargs:
            self.extra = kwargs['extra']
        return self.to_dict()

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典 - 使用驼峰命名对齐 V2 Schema"""
        return {
            "id": self.action_id,
            "caseId": self.case_id,
            "elementType": self.element_type,
            "elementId": self.element_id,
            "loadType": self.load_type,
            "loadValue": self.load_value,
            "extra": self.extra
        }
