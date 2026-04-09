import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

current_path = Path(__file__).parent
if str(current_path) not in sys.path:
    sys.path.insert(0, str(current_path))

from load_combination_enhanced import (
    LoadCombinationGenerator,
    CombinationFactor,
    CombinationMethod
)


def generate_load_combinations(params: Dict[str, Any]) -> Dict[str, Any]:
    try:
        # 提取输入参数
        load_cases = params.get("load_cases", {})
        combination_type = params.get("combination_type", "uls")
        combination_factors = params.get("combination_factors", {})
        expand_cases = params.get("expand_cases", False)
        include_favorable = params.get("include_favorable", True)
        
        # 验证输入
        if not load_cases:
            return {
                "status": "error",
                "error": "无有效的荷载工况",
                "message": "至少需要提供一个荷载工况才能生成组合"
            }
        
        # 初始化组合系数
        if combination_factors:
            factors = CombinationFactor(**combination_factors)
        else:
            factors = None
        
        # 创建组合生成器
        generator = LoadCombinationGenerator(factors=factors)
        
        # 展开工况（如果需要）
        expanded_cases = {}
        if expand_cases:
            # 将 load_cases 转换为内部格式
            internal_load_cases = {}
            for case_type, case_ids in load_cases.items():
                if case_ids:
                    for case_id in case_ids:
                        internal_load_cases[case_id] = {
                            "id": case_id,
                            "type": case_type.replace("_load", ""),
                            "description": f"{case_type} {case_id}",
                            "extra": {}
                        }
            
            expanded_cases = generator.expand_load_cases_for_combination(
                internal_load_cases
            )
            
            # 更新 load_cases 使用展开后的工况
            load_cases = {}
            for exp_id, exp_data in expanded_cases.items():
                base_type = exp_data["type"]
                if base_type not in load_cases:
                    load_cases[base_type] = []
                load_cases[base_type].append(exp_id)
        
        # 提取各类荷载工况ID
        dead_load_ids = load_cases.get("dead_load", load_cases.get("dead", []))
        live_load_ids = load_cases.get("live_load", load_cases.get("live", []))
        wind_load_ids = load_cases.get("wind_load", load_cases.get("wind", []))
        seismic_load_ids = load_cases.get("seismic_load", load_cases.get("seismic", []))
        crane_load_ids = load_cases.get("crane_load", load_cases.get("crane", []))
        temp_load_ids = load_cases.get("temperature_load", load_cases.get("temperature", []))
        
        # 根据类型生成组合
        all_combinations = []
        
        if combination_type in ["uls", "all"]:
            result = generator.generate_uls_combinations(
                dead_load_ids=dead_load_ids,
                live_load_ids=live_load_ids,
                wind_load_ids=wind_load_ids,
                seismic_load_ids=seismic_load_ids,
                crane_load_ids=crane_load_ids,
                temp_load_ids=temp_load_ids,
                include_favorable=include_favorable
            )
            all_combinations.extend(result["combinations"])
        
        if combination_type in ["sls", "all"]:
            result = generator.generate_sls_combinations(
                dead_load_ids=dead_load_ids,
                live_load_ids=live_load_ids,
                wind_load_ids=wind_load_ids,
                seismic_load_ids=seismic_load_ids
            )
            all_combinations.extend(result["combinations"])
        
        if combination_type in ["seismic", "all"]:
            result = generator.generate_seismic_combinations(
                dead_load_ids=dead_load_ids,
                live_load_ids=live_load_ids,
                seismic_load_ids=seismic_load_ids,
                crane_load_ids=crane_load_ids
            )
            all_combinations.extend(result["combinations"])
        
        # 统计组合类型
        summary = {
            "total": len(all_combinations),
            "uls": sum(1 for c in all_combinations if c["type"] == "uls"),
            "sls": sum(1 for c in all_combinations if c["type"] == "sls"),
            "seismic": sum(1 for c in all_combinations if c["type"] == "seismic")
        }
        
        return {
            "status": "success",
            "combinations": all_combinations,
            "expanded_cases": expanded_cases if expand_cases else None,
            "summary": summary,
            "factors": generator.factors.to_dict() if generator.factors else None
        }
    
    except (ValueError, TypeError) as e:
        return {
            "status": "error",
            "error": "参数类型错误或值无效",
            "message": f"参数验证错误: {str(e)}"
        }
    except KeyError as e:
        return {
            "status": "error",
            "error": "缺少必要的参数或键",
            "message": f"必填参数缺失: {str(e)}"
        }
    except RuntimeError as e:
        return {
            "status": "error",  
            "error": "运行时错误",
            "message": f"生成过程中发生错误: {str(e)}"
        }


def expand_load_cases(load_cases: Dict[str, Any]) -> Dict[str, Any]:
    try:
        generator = LoadCombinationGenerator()
        return generator.expand_load_cases_for_combination(load_cases)
    
    except ValueError as e:
        return {
            "status": "error",
            "error": "输入参数格式错误",
            "message": f"工况数据格式错误: {str(e)}"
        }
    except RuntimeError as e:
        return {
            "status": "error",
            "error": "展开工况失败",
            "message": f"工况展开失败: {str(e)}"
        }


def process_custom_combinations(
    custom_load_ids: List[str],
    combination_method: str,
    base_combinations: List[Dict[str, Any]]
) -> Dict[str, Any]:
    try:
        method = CombinationMethod(combination_method.lower())
        generator = LoadCombinationGenerator()
        
        result = generator.process_custom_load_case_combination(
            custom_load_ids=custom_load_ids,
            combination_method=method,
            base_combinations=base_combinations
        )
        
        return {
            "status": "success",
            "combinations": result,
            "count": len(result)
        }
    
    except ValueError as e:
        return {
            "status": "error",
            "error": f"无效的组合方式: {combination_method}",
            "message": str(e)
        }
    except NotImplementedError as e:
        return {
            "status": "error",
            "error": "不支持的操作",
            "message": f"组合方式未实现: {str(e)}"
        }
    except RuntimeError as e:
        return {
            "status": "error",
            "error": "处理自定义组合失败",
            "message": f"自定义组合处理失败: {str(e)}"
        }


def generate_special_member_combinations(
    load_cases: Dict[str, Any],
    member_type: str = "wind_column"
) -> Dict[str, Any]:
    try:
        generator = LoadCombinationGenerator()
        
        dead_load_ids = load_cases.get("dead_load", [])
        live_load_ids = load_cases.get("live_load", [])
        wind_load_ids = load_cases.get("wind_load", [])
        
        result = generator.generate_special_member_combinations(
            dead_load_ids=dead_load_ids,
            live_load_ids=live_load_ids,
            wind_load_ids=wind_load_ids,
            member_type=member_type
        )
        
        return {
            "status": "success",
            "combinations": result["combinations"],
            "count": result["count"]
        }
    
    except ValueError as e:
        return {
            "status": "error",
            "error": "构件类型或工况数据无效",
            "message": f"特殊构件组合参数错误: {str(e)}"
        }
    except RuntimeError as e:
        return {
            "status": "error",
            "error": "特殊构件组合生成失败", 
            "message": f"特殊构件组合生成错误: {str(e)}"
        }


def create_custom_combination(
    factors: Dict[str, float],
    description: str = "",
    combination_type: str = "uls",
    code_reference: str = "custom"
) -> Dict[str, Any]:
    try:
        generator = LoadCombinationGenerator()
        combo = generator.create_custom_combination(
            factors=factors,
            description=description,
            combination_type=combination_type,
            code_reference=code_reference
        )
        
        return {
            "status": "success",
            "combination": combo
        }
    
    except Exception as e:
        return {
            "status": "error",
            "error": str(e),
            "message": f"创建自定义组合时发生错误: {str(e)}"
        }
