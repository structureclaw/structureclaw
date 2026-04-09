"""
Seismic Load Module Bridge / 地震荷载模块桥接

此模块为 seismic-load 目录提供包桥接，允许 Python 导入带连字符的目录。
Python 不允许在导入语句中使用连字符（如 'seismic-load'），
因此创建此桥接文件以 'seismic_load' 的名义导入 'seismic-load' 模块。

使用方式：
    from seismic_load.runtime import SeismicLoadGenerator
    from seismic_load.constants import SEISMIC_LOAD_DEFAULTS
"""

import importlib.util
import sys
from pathlib import Path

# 获取当前文件所在目录（load-boundary）
current_dir = Path(__file__).parent
skill_dir = current_dir / "seismic-load"

# 动态导入 seismic-load.runtime 模块
runtime_path = skill_dir / "runtime.py"
spec = importlib.util.spec_from_file_location("seismic_load.runtime", str(runtime_path))
runtime_module = importlib.util.module_from_spec(spec)
sys.modules["seismic_load.runtime"] = runtime_module
spec.loader.exec_module(runtime_module)

# 导出 runtime 模块的公共接口
SeismicLoadGenerator = runtime_module.SeismicLoadGenerator
generate_seismic_loads = runtime_module.generate_seismic_loads

# 动态导入 seismic-load.constants 模块
constants_path = skill_dir / "constants.py"
spec = importlib.util.spec_from_file_location("seismic_load.constants", str(constants_path))
constants_module = importlib.util.module_from_spec(spec)
sys.modules["seismic_load.constants"] = constants_module
spec.loader.exec_module(constants_module)

# 导出 constants 模块的公共接口
SEISMIC_LOAD_DEFAULTS = constants_module.SEISMIC_LOAD_DEFAULTS
SeismicDesignCategory = constants_module.SeismicDesignCategory
SeismicDirection = constants_module.SeismicDirection
validate_seismic_load_type = constants_module.validate_seismic_load_type

__all__ = [
    "SeismicLoadGenerator",
    "generate_seismic_loads",
    "SEISMIC_LOAD_DEFAULTS",
    "SeismicDesignCategory",
    "SeismicDirection",
    "validate_seismic_load_type",
]
