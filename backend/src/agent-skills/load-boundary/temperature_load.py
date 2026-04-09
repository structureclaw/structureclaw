"""
Temperature Load Module Bridge / 温度荷载模块桥接

此模块为 temperature-load 目录提供包桥接，允许 Python 导入带连字符的目录。
Python 不允许在导入语句中使用连字符（如 'temperature-load'），
因此创建此桥接文件以 'temperature_load' 的名义导入 'temperature-load' 模块。

使用方式：
    from temperature_load.runtime import TemperatureLoadGenerator
"""

import importlib.util
import sys
from pathlib import Path

# 获取当前文件所在目录（load-boundary）
current_dir = Path(__file__).parent
skill_dir = current_dir / "temperature-load"

# 动态导入 temperature-load.runtime 模块
runtime_path = skill_dir / "runtime.py"
spec = importlib.util.spec_from_file_location("temperature_load.runtime", str(runtime_path))
runtime_module = importlib.util.module_from_spec(spec)
sys.modules["temperature_load.runtime"] = runtime_module
spec.loader.exec_module(runtime_module)

# 导出 runtime 模块的公共接口
TemperatureLoadGenerator = runtime_module.TemperatureLoadGenerator
generate_temperature_loads = runtime_module.generate_temperature_loads

__all__ = [
    "TemperatureLoadGenerator",
    "generate_temperature_loads",
]
