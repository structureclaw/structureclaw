"""
Snow Load Module Bridge / 雪荷载模块桥接

此模块为 snow-load 目录提供包桥接，允许 Python 导入带连字符的目录。
Python 不允许在导入语句中使用连字符（如 'snow-load'），
因此创建此桥接文件以 'snow_load' 的名义导入 'snow-load' 模块。

使用方式：
    from snow_load.runtime import SnowLoadGenerator
"""

import importlib.util
import sys
from pathlib import Path

# 获取当前文件所在目录（load-boundary）
current_dir = Path(__file__).parent
skill_dir = current_dir / "snow-load"

# 动态导入 snow-load.runtime 模块
runtime_path = skill_dir / "runtime.py"
spec = importlib.util.spec_from_file_location("snow_load.runtime", str(runtime_path))
runtime_module = importlib.util.module_from_spec(spec)
sys.modules["snow_load.runtime"] = runtime_module
spec.loader.exec_module(runtime_module)

# 导出 runtime 模块的公共接口
SnowLoadGenerator = runtime_module.SnowLoadGenerator
generate_snow_loads = runtime_module.generate_snow_loads if hasattr(runtime_module, 'generate_snow_loads') else None

__all__ = [
    "SnowLoadGenerator",
    "generate_snow_loads",
]
