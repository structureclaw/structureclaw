"""
测试导入适配器
Test Import Adapter
统一处理带连字符目录的动态导入
"""

import sys
import importlib.util
from pathlib import Path


class TestImportAdapter:
    """测试导入适配器 - 统一处理带连字符目录的模块导入"""

    def __init__(self, load_boundary_path: Path):
        """
        初始化适配器

        Args:
            load_boundary_path: load-boundary 模块的根路径
        """
        self.load_boundary_path = load_boundary_path
        self._loaded_modules = {}

        # 添加 shared 模块路径到 sys.path
        shared_path = load_boundary_path / "shared"
        if str(shared_path) not in sys.path:
            sys.path.insert(0, str(shared_path))

        # 添加 skill-shared/python 路径到 sys.path
        skill_shared_path = load_boundary_path.parent.parent / "skill-shared" / "python"
        if str(skill_shared_path) not in sys.path:
            sys.path.insert(0, str(skill_shared_path))

    def import_skill_runtime(self, skill_name: str, module_name: str = "runtime") -> any:
        """
        导入技能运行时模块

        Args:
            skill_name: 技能目录名（带连字符，如 "snow-load"）
            module_name: 模块名（默认为 "runtime"）

        Returns:
            导入的模块对象

        Example:
            adapter = TestImportAdapter(load_boundary_path)
            snow_runtime = adapter.import_skill_runtime("snow-load")
            SnowLoadGenerator = snow_runtime.SnowLoadGenerator
        """
        module_key = f"{skill_name}_{module_name}"

        # 如果已加载，直接返回
        if module_key in self._loaded_modules:
            return self._loaded_modules[module_key]

        # 动态导入模块
        module_path = self.load_boundary_path / skill_name / f"{module_name}.py"
        spec = importlib.util.spec_from_file_location(module_key, str(module_path))
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_key] = module
        spec.loader.exec_module(module)

        self._loaded_modules[module_key] = module
        return module

    def import_core_module(self, module_name: str) -> any:
        """
        导入核心模块

        Args:
            module_name: 模块名（如 "load_action"）

        Returns:
            导入的模块对象

        Example:
            adapter = TestImportAdapter(load_boundary_path)
            load_action_module = adapter.import_core_module("load_action")
            create_load_action = load_action_module.create_load_action
        """
        module_key = f"core_{module_name}"

        # 如果已加载，直接返回
        if module_key in self._loaded_modules:
            return self._loaded_modules[module_key]

        # 动态导入模块
        module_path = self.load_boundary_path / "core" / f"{module_name}.py"
        spec = importlib.util.spec_from_file_location(module_key, str(module_path))
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_key] = module
        spec.loader.exec_module(module)

        self._loaded_modules[module_key] = module
        return module

    def import_structure_protocol(self, *class_names):
        """
        导入结构协议模块

        Args:
            *class_names: 要导入的类名（如 "StructureModelV2", "NodeV2"）

        Returns:
            导入的类对象列表

        Example:
            adapter = TestImportAdapter(load_boundary_path)
            StructureModelV2, NodeV2 = adapter.import_structure_protocol("StructureModelV2", "NodeV2")
        """
        from structure_protocol.structure_model_v2 import (
            StructureModelV2,
            NodeV2,
            ElementV2,
            MaterialV2,
            SectionV2,
            LoadCaseV2,
            LoadCombinationV2
        )

        classes = {
            "StructureModelV2": StructureModelV2,
            "NodeV2": NodeV2,
            "ElementV2": ElementV2,
            "MaterialV2": MaterialV2,
            "SectionV2": SectionV2,
            "LoadCaseV2": LoadCaseV2,
            "LoadCombinationV2": LoadCombinationV2
        }

        return [classes[name] for name in class_names]
