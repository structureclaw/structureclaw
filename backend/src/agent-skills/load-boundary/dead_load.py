"""
Dead Load Module Bridge / 死荷载模块桥接

此模块为 dead-load 目录提供包桥接，允许 Python 导入带连字符的目录。
Python 不允许在导入语句中使用连字符（如 'dead-load'），
因此创建此桥接文件以 'dead_load' 的名义导入 'dead-load' 模块。

使用方式：
    from dead_load.runtime import DeadLoadGenerator
    from dead_load.constants import DEAD_LOAD_DEFAULTS
"""

import importlib.util
import sys
from pathlib import Path

# 获取当前文件所在目录（load-boundary）
current_dir = Path(__file__).parent
skill_dir = current_dir / "dead-load"

# 动态导入 dead-load.runtime 模块
runtime_path = skill_dir / "runtime.py"
spec = importlib.util.spec_from_file_location("dead_load.runtime", str(runtime_path))
runtime_module = importlib.util.module_from_spec(spec)
sys.modules["dead_load.runtime"] = runtime_module
spec.loader.exec_module(runtime_module)

# 导出 runtime 模块的公共接口
DeadLoadGenerator = runtime_module.DeadLoadGenerator
generate_dead_loads = runtime_module.generate_dead_loads

# 动态导入 dead-load.constants 模块
constants_path = skill_dir / "constants.py"
spec = importlib.util.spec_from_file_location("dead_load.constants", str(constants_path))
constants_module = importlib.util.module_from_spec(spec)
sys.modules["dead_load.constants"] = constants_module
spec.loader.exec_module(constants_module)

# 导出 constants 模块的公共接口
DEAD_LOAD_DEFAULTS = constants_module.DEAD_LOAD_DEFAULTS
DeadLoadType = constants_module.DeadLoadType
validate_dead_load_type = constants_module.validate_dead_load_type

__all__ = [
    "DeadLoadGenerator",
    "generate_dead_loads",
    "DEAD_LOAD_DEFAULTS",
    "DeadLoadType",
    "validate_dead_load_type",
]
