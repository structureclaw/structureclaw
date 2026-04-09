"""
Crane Load Module Bridge / 吊车荷载模块桥接

此模块为 crane-load 目录提供包桥接，允许 Python 导入带连字符的目录。
Python 不允许在导入语句中使用连字符（如 'crane-load'），
因此创建此桥接文件以 'crane_load' 的名义导入 'crane-load' 模块。

使用方式：
    from crane_load.runtime import CraneLoadGenerator
    from crane_load.constants import LoadType, ElementType
"""

import importlib.util
import sys
from pathlib import Path

# 获取当前文件所在目录（load-boundary）
current_dir = Path(__file__).parent
skill_dir = current_dir / "crane-load"

# 动态导入 crane-load.runtime 模块
runtime_path = skill_dir / "runtime.py"
spec = importlib.util.spec_from_file_location("crane_load.runtime", str(runtime_path))
runtime_module = importlib.util.module_from_spec(spec)
sys.modules["crane_load.runtime"] = runtime_module
spec.loader.exec_module(runtime_module)

# 导出 runtime 模块的公共接口
CraneLoadGenerator = runtime_module.CraneLoadGenerator
generate_crane_loads = runtime_module.generate_crane_loads if hasattr(runtime_module, 'generate_crane_loads') else None

__all__ = [
    "CraneLoadGenerator",
    "generate_crane_loads",
]
