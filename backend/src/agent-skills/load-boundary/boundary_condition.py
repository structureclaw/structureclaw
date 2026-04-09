"""
Boundary Condition Module Bridge / 边界条件模块桥接

此模块为 boundary-condition 目录提供包桥接，允许 Python 导入带连字符的目录。
Python 不允许在导入语句中使用连字符（如 'boundary-condition'），
因此创建此桥接文件以 'boundary_condition' 的名义导入 'boundary-condition' 模块。

使用方式：
    from boundary_condition.runtime import BoundaryConditionGenerator, execute
    from boundary_condition.constants import ConstraintType, RollingDirection
"""

import importlib.util
import sys
from pathlib import Path

# 获取当前文件所在目录（load-boundary）
current_dir = Path(__file__).parent
skill_dir = current_dir / "boundary-condition"

# 动态导入 boundary-condition.runtime 模块
runtime_path = skill_dir / "runtime.py"
spec = importlib.util.spec_from_file_location("boundary_condition.runtime", str(runtime_path))
runtime_module = importlib.util.module_from_spec(spec)
sys.modules["boundary_condition.runtime"] = runtime_module
spec.loader.exec_module(runtime_module)

# 导出 runtime 模块的公共接口
BoundaryConditionGenerator = runtime_module.BoundaryConditionGenerator
execute = runtime_module.execute if hasattr(runtime_module, 'execute') else None

# 动态导入 boundary-condition.constants 模块
constants_path = skill_dir / "constants.py"
spec = importlib.util.spec_from_file_location("boundary_condition.constants", str(constants_path))
constants_module = importlib.util.module_from_spec(spec)
sys.modules["boundary_condition.constants"] = constants_module
spec.loader.exec_module(constants_module)

# 导出 constants 模块的公共接口
ConstraintType = constants_module.ConstraintType
RollingDirection = constants_module.RollingDirection
get_length_factor = constants_module.get_length_factor
get_restraints_by_constraint_type = constants_module.get_restraints_by_constraint_type
get_constraint_description = constants_module.get_constraint_description
DEFAULT_STIFFNESS_MATRIX = constants_module.DEFAULT_STIFFNESS_MATRIX
FULL_RESTRAINTS = constants_module.FULL_RESTRAINTS
TRANSLATIONAL_RESTRAINTS = constants_module.TRANSLATIONAL_RESTRAINTS
FREE_RESTRAINTS = constants_module.FREE_RESTRAINTS

__all__ = [
    "BoundaryConditionGenerator",
    "execute",
    "ConstraintType",
    "RollingDirection",
    "get_length_factor",
    "get_restraints_by_constraint_type",
    "get_constraint_description",
    "DEFAULT_STIFFNESS_MATRIX",
    "FULL_RESTRAINTS",
    "TRANSLATIONAL_RESTRAINTS",
    "FREE_RESTRAINTS",
]
