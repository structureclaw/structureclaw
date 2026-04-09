"""
节点约束管理模块
提供节点约束的 CRUD 操作
对齐 V2 Schema NodeV2.restraints
"""

from typing import Any, Dict, List, Optional


class NodalConstraint:
    """节点约束类 - 对齐 V2 Schema"""

    def __init__(
        self,
        node_id: str,
        constraint_type: str,
        restrained_dofs: Optional[Dict[str, bool]] = None,
        restraints: Optional[List[bool]] = None,
        stiffness: Optional[Dict[str, Any]] = None,
        extra: Optional[Dict[str, Any]] = None
    ):
        """
        初始化节点约束

        Args:
            node_id: 节点ID
            constraint_type: 约束类型 (fixed, pinned, sliding, elastic)
            restrained_dofs: 约束的自由度字典 {ux: bool, uy: bool, ...}
            restraints: V2 Schema 格式的约束列表 [ux, uy, uz, rx, ry, rz]
            stiffness: 弹簧刚度矩阵 (仅 elastic 类型)
            extra: 扩展字段 (对齐 V2 Schema)
        """
        self.node_id = node_id
        self.constraint_type = constraint_type
        self.restrained_dofs = restrained_dofs or {}
        self.restraints = restraints  # V2 Schema 格式
        self.stiffness = stiffness
        self.extra: Dict[str, Any] = extra or {}

    def create_nodal_constraint(self) -> Dict[str, Any]:
        """创建节点约束"""
        return self.to_dict()

    def modify_nodal_constraint(self, **kwargs) -> Dict[str, Any]:
        """修改节点约束"""
        if 'restraints' in kwargs:
            self.restraints = kwargs['restraints']
        if 'stiffness' in kwargs:
            self.stiffness = kwargs['stiffness']
        if 'constraint_type' in kwargs:
            self.constraint_type = kwargs['constraint_type']
        if 'restrained_dofs' in kwargs:
            self.restrained_dofs = kwargs['restrained_dofs']
        if 'extra' in kwargs:
            self.extra = kwargs['extra']
        return self.to_dict()

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典 - 使用驼峰命名，对齐 V2 Schema"""
        result = {
            "nodeId": self.node_id,
            "extra": self.extra
        }
        
        # V2 Schema 字段：restraints (优先使用)
        if self.restraints is not None:
            result["restraints"] = self.restraints
        
        # 扩展字段：constraintType, restrainedDOFs, stiffness
        # 放入 extra 字段中，保持 V2 Schema 格式统一
        if self.constraint_type:
            result.setdefault("extra", {})["constraintType"] = self.constraint_type
        if self.restrained_dofs:
            result.setdefault("extra", {})["restrainedDOFs"] = self.restrained_dofs
        if self.stiffness is not None:
            result["stiffness"] = self.stiffness
        
        return result
