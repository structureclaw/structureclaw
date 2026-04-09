"""
计算长度管理模块
提供计算长度的 CRUD 操作
对齐 V2 Schema (通过 ElementV2.extra 扩展)
"""

from typing import Any, Dict, Optional


class EffectiveLength:
    """计算长度类 - 对齐 V2 Schema"""

    def __init__(
        self,
        member_id: str,
        direction: str,
        calc_length: float,
        length_factor: float,
        extra: Optional[Dict[str, Any]] = None
    ):
        """
        初始化计算长度

        Args:
            member_id: 杆件ID
            direction: 方向 (x, y, z)
            calc_length: 几何长度
            length_factor: 长度系数
            extra: 扩展字段 (对齐 V2 Schema)
        """
        self.member_id = member_id
        self.direction = direction
        self.calc_length = calc_length
        self.length_factor = length_factor
        self.effective_length = calc_length * length_factor
        self.extra: Dict[str, Any] = extra or {}

    def create_effective_length(self) -> Dict[str, Any]:
        """创建计算长度"""
        return self.to_dict()

    def modify_effective_length(self, **kwargs) -> Dict[str, Any]:
        """修改计算长度"""
        if 'direction' in kwargs:
            self.direction = kwargs['direction']
        if 'length_factor' in kwargs:
            self.length_factor = kwargs['length_factor']
            self.effective_length = self.calc_length * self.length_factor
        if 'extra' in kwargs:
            self.extra = kwargs['extra']
        return self.to_dict()

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典 - 使用驼峰命名，对齐 V2 Schema"""
        return {
            "memberId": self.member_id,
            "direction": self.direction,
            "calcLength": self.calc_length,
            "lengthFactor": self.length_factor,
            "effectiveLength": self.effective_length,
            "extra": self.extra
        }
