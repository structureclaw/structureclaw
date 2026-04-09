"""
Load-Boundary 共享模块 / Load-Boundary Shared Module

本模块包含 load-boundary 技能中使用的共享代码，
用于消除代码重复，提高代码复用性和可维护性。
"""

from .model_data_helper import ModelDataHelper, ValidationHelper
from .model_fetcher import ModelDataFetcher, V2SchemaFetcher, FilteredDataFetcher
from .model_cache import ModelDataCache, MaterialCache, SectionCache, NodeCache, StoryCache, SimpleDictCache
from .geometry_helper import GeometryHelper
from .constants import (
    LoadType,
    ElementType,
    LoadDirection,
    validate_load_value,
    validate_element_type,
    validate_string_id,
    validate_dict_value,
    validate_numeric_value,
    MIN_LOAD_VALUE,
    MAX_DISTRIBUTED_LOAD,
    MAX_POINT_LOAD,
    MAX_AREA_LOAD,
)

__all__ = [
    "ModelDataHelper",
    "ModelDataFetcher",
    "V2SchemaFetcher",
    "FilteredDataFetcher",
    "ModelDataCache",
    "MaterialCache",
    "SectionCache",
    "NodeCache",
    "StoryCache",
    "SimpleDictCache",
    "GeometryHelper",
    "ValidationHelper",
    "LoadType",
    "ElementType",
    "LoadDirection",
    "validate_load_value",
    "validate_element_type",
    "validate_string_id",
    "validate_dict_value",
    "validate_numeric_value",
    "MIN_LOAD_VALUE",
    "MAX_DISTRIBUTED_LOAD",
    "MAX_POINT_LOAD",
    "MAX_AREA_LOAD",
]
