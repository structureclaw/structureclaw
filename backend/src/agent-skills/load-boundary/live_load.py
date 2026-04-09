"""
Live Load Module Bridge / 活荷载模块桥接

此模块为 live-load 目录提供包桥接，允许 Python 导入带连字符的目录。
Python 不允许在导入语句中使用连字符（如 'live-load'），
因此创建此桥接文件以 'live_load' 的名义导入 'live-load' 模块。

使用方式：
    from live_load.runtime import LiveLoadGenerator
    from live_load.constants import LIVE_LOAD_DEFAULTS
"""

import importlib.util
import sys
from pathlib import Path

# 获取当前文件所在目录（load-boundary）
current_dir = Path(__file__).parent
skill_dir = current_dir / "live-load"

# 动态导入 live-load.runtime 模块
runtime_path = skill_dir / "runtime.py"
spec = importlib.util.spec_from_file_location("live_load.runtime", str(runtime_path))
runtime_module = importlib.util.module_from_spec(spec)
sys.modules["live_load.runtime"] = runtime_module
spec.loader.exec_module(runtime_module)

# 导出 runtime 模块的公共接口
LiveLoadGenerator = runtime_module.LiveLoadGenerator
generate_floor_live_loads = runtime_module.generate_floor_live_loads
add_custom_live_load = runtime_module.add_custom_live_load

# 动态导入 live-load.constants 模块
constants_path = skill_dir / "constants.py"
spec = importlib.util.spec_from_file_location("live_load.constants", str(constants_path))
constants_module = importlib.util.module_from_spec(spec)
sys.modules["live_load.constants"] = constants_module
spec.loader.exec_module(constants_module)

# 导出 constants 模块的公共接口
LIVE_LOAD_DEFAULTS = constants_module.LIVE_LOAD_DEFAULTS
LiveLoadType = constants_module.LiveLoadType
validate_live_load_type = constants_module.validate_live_load_type
get_default_tributary_width = constants_module.get_default_tributary_width
validate_floor_load_type = constants_module.validate_floor_load_type

__all__ = [
    "LiveLoadGenerator",
    "generate_floor_live_loads",
    "add_custom_live_load",
    "LIVE_LOAD_DEFAULTS",
    "LiveLoadType",
    "validate_live_load_type",
    "get_default_tributary_width",
    "validate_floor_load_type",
]
