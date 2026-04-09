"""
工具函数模块 / Utility Functions Module

提供地震荷载计算相关的辅助函数
Provides utility functions for seismic load calculation
"""

from __future__ import annotations

from typing import Any, Dict, List, Tuple, Optional
import logging

logger = logging.getLogger(__name__)


def validate_seismic_parameters(
    intensity: float,
    site_category: str,
    design_group: str,
    damping_ratio: float,
    live_load_factor: float
) -> Tuple[bool, List[str]]:
    """
    验证地震参数有效性

    Args:
        intensity: 设防烈度
        site_category: 场地类别
        design_group: 设计地震分组
        damping_ratio: 阻尼比
        live_load_factor: 活载组合值系数

    Returns:
        (是否有效, 错误信息列表)
    """
    errors = []

    # 验证设防烈度
    valid_intensities = [6.0, 6.5, 7.0, 7.5, 8.0, 8.5, 9.0]
    if intensity not in valid_intensities:
        errors.append(f"设防烈度 {intensity} 无效，有效值为 {valid_intensities}")

    # 验证场地类别
    valid_site_categories = ['I', 'II', 'III', 'IV']
    if site_category not in valid_site_categories:
        errors.append(f"场地类别 {site_category} 无效，有效值为 {valid_site_categories}")

    # 验证设计地震分组
    valid_design_groups = ['第一组', '第二组', '第三组']
    if design_group not in valid_design_groups:
        errors.append(f"设计地震分组 {design_group} 无效，有效值为 {valid_design_groups}")

    # 验证阻尼比
    if damping_ratio < 0.01 or damping_ratio > 0.2:
        errors.append(f"阻尼比 {damping_ratio} 无效，应在 0.01-0.2 之间")

    # 验证活载组合值系数
    if live_load_factor < 0.0 or live_load_factor > 1.0:
        errors.append(f"活载组合值系数 {live_load_factor} 无效，应在 0.0-1.0 之间")

    return (len(errors) == 0, errors)


def format_seismic_result(
    result: Dict[str, Any],
    language: str = 'zh'
) -> str:
    """
    格式化地震荷载计算结果

    Args:
        result: 计算结果字典
        language: 语言 ('zh' 或 'en')

    Returns:
        格式化结果字符串
    """
    if language == 'en':
        return format_seismic_result_en(result)
    else:
        return format_seismic_result_zh(result)


def format_seismic_result_zh(result: Dict[str, Any]) -> str:
    """格式化为中文结果"""
    summary = result.get("summary", {})
    details = result.get("calculation_details", {})

    lines = [
        "地震荷载生成完成",
        "=" * 50,
        "",
        "基本信息:",
        f"  工况ID: {summary.get('case_id', 'N/A')}",
        f"  设防烈度: {summary.get('intensity', 'N/A')} 度",
        f"  场地类别: {summary.get('site_category', 'N/A')}",
        f"  设计地震分组: {summary.get('design_group', 'N/A')}",
        f"  地震方向: {summary.get('seismic_direction', 'N/A')}",
        "",
        "计算参数:",
        f"  重量计算方法: {summary.get('weight_calculation_method', 'N/A')}",
        f"  力分配方法: {summary.get('force_distribute_method', 'N/A')}",
        f"  活载组合值系数: {summary.get('live_load_factor', 0.5)}",
        "",
        "计算结果:",
        f"  底部剪力: {details.get('base_shear', 0):.2f} kN",
        f"  结构总重量: {details.get('total_weight', 0):.2f} kN",
        f"  地震影响系数: {details.get('alpha_max', 0):.4f}",
        f"  荷载工况数: {summary.get('case_count', 0)}",
        f"  荷载动作数: {summary.get('action_count', 0)}",
        "",
    ]

    story_forces = details.get("story_forces", [])
    if story_forces:
        lines.append("楼层地震力:")
        for i, force in enumerate(story_forces, 1):
            lines.append(f"  楼层 {i}: {force:.2f} kN")

    return "\n".join(lines)


def format_seismic_result_en(result: Dict[str, Any]) -> str:
    """Format result in English"""
    summary = result.get("summary", {})
    details = result.get("calculation_details", {})

    lines = [
        "Seismic Load Generation Completed",
        "=" * 50,
        "",
        "Basic Information:",
        f"  Case ID: {summary.get('case_id', 'N/A')}",
        f"  Seismic Intensity: {summary.get('intensity', 'N/A')} degrees",
        f"  Site Category: {summary.get('site_category', 'N/A')}",
        f"  Design Group: {summary.get('design_group', 'N/A')}",
        f"  Seismic Direction: {summary.get('seismic_direction', 'N/A')}",
        "",
        "Calculation Parameters:",
        f"  Weight Calculation Method: {summary.get('weight_calculation_method', 'N/A')}",
        f"  Force Distribution Method: {summary.get('force_distribute_method', 'N/A')}",
        f"  Live Load Combination Factor: {summary.get('live_load_factor', 0.5)}",
        "",
        "Calculation Results:",
        f"  Base Shear: {details.get('base_shear', 0):.2f} kN",
        f"  Total Weight: {details.get('total_weight', 0):.2f} kN",
        f"  Seismic Influence Coefficient: {details.get('alpha_max', 0):.4f}",
        f"  Load Case Count: {summary.get('case_count', 0)}",
        f"  Load Action Count: {summary.get('action_count', 0)}",
        "",
    ]

    story_forces = details.get("story_forces", [])
    if story_forces:
        lines.append("Story Seismic Forces:")
        for i, force in enumerate(story_forces, 1):
            lines.append(f"  Story {i}: {force:.2f} kN")

    return "\n".join(lines)


def get_direction_name(direction: str, language: str = 'zh') -> str:
    """
    获取方向名称

    Args:
        direction: 方向代码
        language: 语言 ('zh' 或 'en')

    Returns:
        方向名称
    """
    direction_map = {
        'zh': {
            'x': 'X方向',
            '-x': 'X负方向',
            'y': 'Y方向',
            '-y': 'Y负方向',
            'z': 'Z方向',
            '-z': 'Z负方向'
        },
        'en': {
            'x': 'X-direction',
            '-x': 'Negative X',
            'y': 'Y-direction',
            '-y': 'Negative Y',
            'z': 'Z-direction',
            '-z': 'Negative Z'
        }
    }

    return direction_map.get(language, direction_map['zh']).get(direction, direction)


def get_method_description(method: str, language: str = 'zh') -> str:
    """
    获取方法描述

    Args:
        method: 方法代码
        language: 语言 ('zh' 或 'en')

    Returns:
        方法描述
    """
    weight_method_map = {
        'zh': {
            'auto': '自动选择',
            'from_model_direct': '从模型直接获取',
            'from_elements': '从构件计算',
            'from_floors': '从楼层计算'
        },
        'en': {
            'auto': 'Auto Select',
            'from_model_direct': 'From Model Direct',
            'from_elements': 'From Elements',
            'from_floors': 'From Floors'
        }
    }

    distribute_method_map = {
        'zh': {
            'auto': '自动选择',
            'by_stiffness': '按刚度比例分配',
            'by_distance': '按距离刚度中心分配',
            'evenly': '平均分配'
        },
        'en': {
            'auto': 'Auto Select',
            'by_stiffness': 'By Stiffness Ratio',
            'by_distance': 'By Distance to Stiffness Center',
            'evenly': 'Even Distribution'
        }
    }

    if method in weight_method_map['zh']:
        return weight_method_map[language].get(method, method)
    elif method in distribute_method_map['zh']:
        return distribute_method_map[language].get(method, method)
    else:
        return method


def calculate_seismic_coefficient(
    intensity: float,
    site_category: str,
    design_group: str,
    characteristic_period: Optional[float] = None
) -> float:
    """
    计算地震影响系数

    Args:
        intensity: 设防烈度
        site_category: 场地类别
        design_group: 设计地震分组
        characteristic_period: 特征周期 (可选)

    Returns:
        地震影响系数
    """
    # 地震影响系数最大值
    alpha_max_map = {
        6.0: 0.04,
        6.5: 0.05,
        7.0: 0.08,
        7.5: 0.12,
        8.0: 0.16,
        8.5: 0.24,
        9.0: 0.32
    }

    alpha_max = alpha_max_map.get(intensity, 0.08)

    # 如果没有提供特征周期，使用默认值
    if characteristic_period is None:
        return alpha_max

    # 根据反应谱曲线计算 (简化版)
    # 实际应根据 GB 50011-2010 图 5.1.5 计算
    return alpha_max


def recommend_parameters(model: Any) -> Dict[str, Any]:
    """
    根据模型推荐地震参数

    Args:
        model: 结构模型

    Returns:
        推荐参数字典
    """
    recommendations = {}

    # 检查模型中的场地地震参数
    if hasattr(model, 'site_seismic') and model.site_seismic:
        site_params = model.site_seismic
        if hasattr(site_params, 'intensity'):
            recommendations['intensity'] = site_params.intensity
        if hasattr(site_params, 'site_category'):
            recommendations['site_category'] = site_params.site_category
        if hasattr(site_params, 'design_group'):
            recommendations['design_group'] = site_params.design_group
        if hasattr(site_params, 'damping_ratio'):
            recommendations['damping_ratio'] = site_params.damping_ratio

    # 根据结构类型推荐参数
    if hasattr(model, 'structure_system') and model.structure_system:
        structure_type = model.structure_system.type

        if structure_type == 'frame':
            recommendations['force_distribute_method'] = 'by_stiffness'
            recommendations['live_load_factor'] = 0.5
        elif structure_type == 'shear-wall':
            recommendations['force_distribute_method'] = 'by_distance'
            recommendations['live_load_factor'] = 0.5
        elif structure_type == 'frame-shear-wall':
            recommendations['force_distribute_method'] = 'by_stiffness'
            recommendations['live_load_factor'] = 0.5

    # 根据模型数据推荐重量计算方法
    if hasattr(model, 'metadata') and 'total_weight' in model.metadata:
        recommendations['weight_calculation_method'] = 'from_model_direct'
    elif hasattr(model, 'stories') and model.stories:
        recommendations['weight_calculation_method'] = 'from_floors'
    else:
        recommendations['weight_calculation_method'] = 'from_elements'

    return recommendations
