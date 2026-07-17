"""
Seismic Load Module Bridge / 地震荷载模块桥接

此模块为 seismic-load 目录提供包桥接，允许 Python 导入带连字符的目录。
Python 不允许在导入语句中使用连字符（如 'seismic-load'），
因此创建此桥接文件以 'seismic_load' 的名义导入 'seismic-load' 模块。

使用方式：
    from seismic_load.runtime import SeismicLoadGenerator
    from seismic_load.base_shear_calculator import BaseShearCalculator
"""

from pathlib import Path

# 获取当前文件所在目录（load-boundary）
current_dir = Path(__file__).parent
skill_dir = current_dir / "seismic-load"

__path__ = [str(skill_dir)]

from seismic_load.base_shear_calculator import BaseShearCalculator, WeightCalculationMethod
from seismic_load.force_distributor import ForceDistributeMethod, ForceDistributor
from seismic_load.model_reader import ModelDataReader
from seismic_load.runtime import SeismicLoadGenerator, generate_seismic_loads

__all__ = [
    "BaseShearCalculator",
    "ForceDistributeMethod",
    "ForceDistributor",
    "ModelDataReader",
    "SeismicLoadGenerator",
    "WeightCalculationMethod",
    "generate_seismic_loads",
]
