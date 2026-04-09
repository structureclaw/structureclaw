"""
共享数据辅助类 / Shared Data Helper Classes

本模块定义了 load-boundary 技能中使用的共享数据辅助类，
用于消除代码重复，提高代码复用性和可维护性。

主要功能：
- 材料和截面的缓存查找
- 几何计算辅助函数
- 模型数据预加载
"""

from typing import Optional, Dict, Any, List
import logging
from functools import lru_cache

logger = logging.getLogger(__name__)


class ModelDataHelper:
    """
    模型数据辅助类 / Model Data Helper

    提供高效的模型数据访问，支持缓存和预加载。
    用于消除 dead-load、live-load 等模块中的代码重复。
    """

    def __init__(self, model: Any, cache_size: int = 1000):
        """
        初始化模型数据辅助类

        Args:
            model: V2 结构模型
            cache_size: 缓存大小
        """
        self.model = model

        # 材料缓存
        self._material_cache: Dict[str, Optional[Any]] = {}

        # 截面缓存
        self._section_cache: Dict[str, Optional[Any]] = {}

        # 节点缓存
        self._node_cache: Dict[str, Optional[Any]] = {}

        # 楼层缓存
        self._story_cache: Dict[str, Optional[Any]] = {}

        # 设置 LRU 缓存大小
        self._cache_size = cache_size

        # 预加载标志
        self._is_preloaded = False

    def preload_data(self):
        """
        预加载常用数据

        在初始化时预加载所有材料、截面、节点、楼层，
        提高后续访问性能。
        """
        if self._is_preloaded:
            logger.debug("数据已预加载，跳过")
            return

        logger.info("预加载模型数据...")

        # 预加载材料
        if hasattr(self.model, 'materials'):
            for mat in self.model.materials:
                if mat.id not in self._material_cache:
                    self._material_cache[mat.id] = mat

        # 预加载截面
        if hasattr(self.model, 'sections'):
            for sec in self.model.sections:
                if sec.id not in self._section_cache:
                    self._section_cache[sec.id] = sec

        # 预加载节点
        if hasattr(self.model, 'nodes'):
            for node in self.model.nodes:
                if node.id not in self._node_cache:
                    self._node_cache[node.id] = node

        # 预加载楼层
        if hasattr(self.model, 'stories'):
            for story in self.model.stories:
                if story.id not in self._story_cache:
                    self._story_cache[story.id] = story

        self._is_preloaded = True
        logger.info(f"数据预加载完成: "
                    f"{len(self._material_cache)} 材料, "
                    f"{len(self._section_cache)} 截面, "
                    f"{len(self._node_cache)} 节点, "
                    f"{len(self._story_cache)} 楼层")

    def get_material(self, material_id: str) -> Optional[Any]:
        """
        获取材料（带缓存）

        Args:
            material_id: 材料ID

        Returns:
            材料对象，如果未找到则返回 None

        Examples:
            >>> material = helper.get_material("MAT1")
            >>> if material:
            ...     print(f"Found material: {material.id}")
        """
        # 检查缓存
        if material_id in self._material_cache:
            return self._material_cache[material_id]

        # 从模型查找
        if hasattr(self.model, 'materials'):
            for mat in self.model.materials:
                if mat.id == material_id:
                    self._material_cache[material_id] = mat
                    return mat

        # 缓存未找到的结果
        self._material_cache[material_id] = None
        logger.warning(f"Material '{material_id}' not found in model")
        return None

    def get_section(self, section_id: str) -> Optional[Any]:
        """
        获取截面（带缓存）

        Args:
            section_id: 截面ID

        Returns:
            截面对象，如果未找到则返回 None

        Examples:
            >>> section = helper.get_section("SEC1")
            >>> if section:
            ...     print(f"Found section: {section.id}")
        """
        # 检查缓存
        if section_id in self._section_cache:
            return self._section_cache[section_id]

        # 从模型查找
        if hasattr(self.model, 'sections'):
            for sec in self.model.sections:
                if sec.id == section_id:
                    self._section_cache[section_id] = sec
                    return sec

        # 缓存未找到的结果
        self._section_cache[section_id] = None
        logger.warning(f"Section '{section_id}' not found in model")
        return None

    def get_node(self, node_id: str) -> Optional[Any]:
        """
        获取节点（带缓存）

        Args:
            node_id: 节点ID

        Returns:
            节点对象，如果未找到则返回 None

        Examples:
            >>> node = helper.get_node("N1")
            >>> if node:
            ...     print(f"Found node: {node.id}")
        """
        # 检查缓存
        if node_id in self._node_cache:
            return self._node_cache[node_id]

        # 从模型查找
        if hasattr(self.model, 'nodes'):
            for node in self.model.nodes:
                if node.id == node_id:
                    self._node_cache[node_id] = node
                    return node

        # 缓存未找到的结果
        self._node_cache[node_id] = None
        logger.warning(f"Node '{node_id}' not found in model")
        return None

    def get_story(self, story_id: str) -> Optional[Any]:
        """
        获取楼层（带缓存）

        Args:
            story_id: 楼层ID

        Returns:
            楼层对象，如果未找到则返回 None

        Examples:
            >>> story = helper.get_story("F1")
            >>> if story:
            ...     print(f"Found story: {story.id}")
        """
        # 检查缓存
        if story_id in self._story_cache:
            return self._story_cache[story_id]

        # 从模型查找
        if hasattr(self.model, 'stories'):
            for story in self.model.stories:
                if story.id == story_id:
                    self._story_cache[story_id] = story
                    return story

        # 缓存未找到的结果
        self._story_cache[story_id] = None
        logger.warning(f"Story '{story_id}' not found in model")
        return None

    def clear_cache(self):
        """清除所有缓存"""
        self._material_cache.clear()
        self._section_cache.clear()
        self._node_cache.clear()
        self._story_cache.clear()
        self._is_preloaded = False
        logger.debug("所有缓存已清除")


class ValidationHelper:
    """
    验证辅助类 / Validation Helper

    提供常用的验证函数，用于消除代码重复。
    """

    @staticmethod
    def validate_string_id(value: Any, field_name: str = "ID") -> bool:
        """
        验证字符串ID是否有效

        Args:
            value: 要验证的值
            field_name: 字段名称（用于错误消息）

        Returns:
            是否有效

        Raises:
            TypeError: 当值不是字符串时
            ValueError: 当值为空时

        Examples:
            >>> ValidationHelper.validate_string_id("B1")
            True
            >>> ValidationHelper.validate_string_id("")
            ValueError: ID 不能为空
        """
        if not isinstance(value, str):
            raise TypeError(f"{field_name} 必须是字符串类型，得到: {type(value)}")

        if not value or not value.strip():
            raise ValueError(f"{field_name} 不能为空")

        return True

    @staticmethod
    def validate_numeric_value(
        value: Any,
        field_name: str = "值",
        min_value: float = 0.0,
        max_value: float = None,
        allow_negative: bool = False
    ) -> bool:
        """
        验证数值是否有效

        Args:
            value: 要验证的值
            field_name: 字段名称（用于错误消息）
            min_value: 最小值
            max_value: 最大值（可选）
            allow_negative: 是否允许负数

        Returns:
            是否有效

        Raises:
            TypeError: 当值不是数字时
            ValueError: 当值超出范围时

        Examples:
            >>> ValidationHelper.validate_numeric_value(10.5)
            True
            >>> ValidationHelper.validate_numeric_value(-1.0, allow_negative=False)
            ValueError: 值不能为负数
        """
        if not isinstance(value, (int, float)):
            raise TypeError(f"{field_name} 必须是数字类型，得到: {type(value)}")

        # 检查负数
        if not allow_negative and value < 0:
            raise ValueError(f"{field_name} 不能为负数，得到: {value}")

        # 检查最小值
        if value < min_value:
            raise ValueError(
                f"{field_name} 不能小于 {min_value}，得到: {value}"
            )

        # 检查最大值
        if max_value is not None and value > max_value:
            raise ValueError(
                f"{field_name} 不能大于 {max_value}，得到: {value}"
            )

        return True

    @staticmethod
    def validate_dict_value(
        value: Any,
        field_name: str = "字典",
        required_keys: List[str] = None
    ) -> bool:
        """
        验证字典值是否有效

        Args:
            value: 要验证的值
            field_name: 字段名称（用于错误消息）
            required_keys: 必需的键列表

        Returns:
            是否有效

        Raises:
            TypeError: 当值不是字典时
            ValueError: 当缺少必需的键时

        Examples:
            >>> ValidationHelper.validate_dict_value(
            ...     {"x": 0.0, "y": -1.0, "z": 0.0},
            ...     "荷载方向",
            ...     ["x", "y", "z"]
            ... )
            True
        """
        if not isinstance(value, dict):
            raise TypeError(f"{field_name} 必须是字典类型，得到: {type(value)}")

        if required_keys:
            missing_keys = [k for k in required_keys if k not in value]
            if missing_keys:
                raise ValueError(
                    f"{field_name} 缺少必需的键: {missing_keys}"
                )

        return True
