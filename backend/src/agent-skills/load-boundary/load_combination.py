"""
Load Combination Module Bridge / 荷载组合模块桥接

此模块为 load-combination 目录提供包桥接，允许 Python 导入带连字符的目录。
Python 不允许在导入语句中使用连字符（如 'load-combination'），
因此创建此桥接文件以 'load_combination' 的名义导入 'load-combination' 模块。

使用方式：
    from load_combination.runtime import execute
"""

import importlib.util
import sys
from pathlib import Path

# 获取当前文件所在目录（load-boundary）
current_dir = Path(__file__).parent
skill_dir = current_dir / "load-combination"

# 动态导入 load-combination.runtime 模块
runtime_path = skill_dir / "runtime.py"
spec = importlib.util.spec_from_file_location("load_combination.runtime", str(runtime_path))
runtime_module = importlib.util.module_from_spec(spec)
sys.modules["load_combination.runtime"] = runtime_module
spec.loader.exec_module(runtime_module)

# 导出 runtime 模块的公共接口
execute = runtime_module.execute

__all__ = [
    "execute",
]
