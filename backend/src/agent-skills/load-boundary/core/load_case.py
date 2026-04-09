"""
荷载工况管理模块
提供荷载工况的 CRUD 操作
对齐 V2 Schema LoadCaseV2
"""

from typing import Any, Dict, List, Optional


class LoadCase:
    """荷载工况类 - 对齐 V2 Schema"""

    def __init__(
        self,
        case_id: str,
        case_type: str,
        description: str = "",
        extra: Optional[Dict[str, Any]] = None
    ):
        """
        初始化荷载工况

        Args:
            case_id: 荷载工况ID (对齐 V2 Schema 'id')
            case_type: 荷载类型 (对齐 V2 Schema 'type')
            description: 描述 (对齐 V2 Schema)
            extra: 扩展字段 (对齐 V2 Schema)
        """
        self.case_id = case_id
        self.case_type = case_type
        self.description = description
        self.extra: Dict[str, Any] = extra or {}
        self.loads: List[Dict[str, Any]] = []

    def create_load_case(self) -> Dict[str, Any]:
        """创建荷载工况 - 对齐 V2 Schema 格式"""
        return {
            "id": self.case_id,
            "type": self.case_type,
            "loads": self.loads,
            "description": self.description,
            "extra": self.extra
        }

    def add_load(self, load_action: Dict[str, Any]) -> None:
        """添加荷载动作"""
        self.loads.append(load_action)

    def modify_load_case(self, **kwargs) -> Dict[str, Any]:
        """修改荷载工况"""
        if 'id' in kwargs:
            self.case_id = kwargs['id']
        if 'type' in kwargs:
            self.case_type = kwargs['type']
        if 'description' in kwargs:
            self.description = kwargs['description']
        if 'extra' in kwargs:
            self.extra = kwargs['extra']
        return self.to_dict()

    def query_load_case(self) -> Dict[str, Any]:
        """查询荷载工况"""
        return self.to_dict()

    def delete_load_case(self) -> Dict[str, Any]:
        """删除荷载工况"""
        return {"id": self.case_id, "deleted": True}

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典 - 对齐 V2 Schema 格式"""
        return {
            "id": self.case_id,
            "type": self.case_type,
            "loads": self.loads,
            "description": self.description,
            "extra": self.extra
        }
