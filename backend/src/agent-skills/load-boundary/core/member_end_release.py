"""
杆端释放管理模块
提供杆端释放的 CRUD 操作
对齐 V2 Schema ElementV2.releases
"""

from typing import Any, Dict, Optional


class MemberEndRelease:
    """杆端释放类 - 对齐 V2 Schema"""

    def __init__(
        self,
        member_id: str,
        release_i: Optional[Dict[str, bool]] = None,
        release_j: Optional[Dict[str, bool]] = None,
        spring_stiffness_i: Optional[Dict[str, Any]] = None,
        spring_stiffness_j: Optional[Dict[str, Any]] = None,
        extra: Optional[Dict[str, Any]] = None
    ):
        """
        初始化杆端释放

        Args:
            member_id: 杆件ID
            release_i: I端释放自由度 {ux: bool, uy: bool, ...}
            release_j: J端释放自由度 {ux: bool, uy: bool, ...}
            spring_stiffness_i: I端弹簧刚度
            spring_stiffness_j: J端弹簧刚度
            extra: 扩展字段 (对齐 V2 Schema)
        """
        self.member_id = member_id
        self.release_i = release_i or {}
        self.release_j = release_j or {}
        self.spring_stiffness_i = spring_stiffness_i
        self.spring_stiffness_j = spring_stiffness_j
        self.extra: Dict[str, Any] = extra or {}

    def create_member_end_release(self) -> Dict[str, Any]:
        """创建杆端释放"""
        return self.to_dict()

    def modify_member_end_release(self, **kwargs) -> Dict[str, Any]:
        """修改杆端释放"""
        if 'release_i' in kwargs:
            self.release_i = kwargs['release_i']
        if 'release_j' in kwargs:
            self.release_j = kwargs['release_j']
        if 'spring_stiffness_i' in kwargs:
            self.spring_stiffness_i = kwargs['spring_stiffness_i']
        if 'spring_stiffness_j' in kwargs:
            self.spring_stiffness_j = kwargs['spring_stiffness_j']
        if 'extra' in kwargs:
            self.extra = kwargs['extra']
        return self.to_dict()

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典 - 使用驼峰命名，对齐 V2 Schema"""
        result = {
            "memberId": self.member_id,
            "extra": self.extra
        }
        
        # V2 Schema 字段：releases (优先使用)
        if self.release_i or self.release_j:
            releases = {}
            if self.release_i:
                releases["releaseI"] = self.release_i
            if self.release_j:
                releases["releaseJ"] = self.release_j
            result["releases"] = releases
        
        # 扩展字段：springStiffnessI, springStiffnessJ
        if self.spring_stiffness_i is not None:
            result["springStiffnessI"] = self.spring_stiffness_i
        if self.spring_stiffness_j is not None:
            result["springStiffnessJ"] = self.spring_stiffness_j
        
        return result
