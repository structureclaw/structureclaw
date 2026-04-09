"""
荷载组合模块
Load Combination Module
实现荷载组合生成功能，对齐 V2 Schema LoadCombinationV2
基于 GB50009-2012 和 GB50011-2010 规范
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional
from enum import Enum


class CombinationMethod(Enum):
    """自定义工况组合方式 / Custom Load Case Combination Method"""
    SUPERPOSE = "superpose"  # 叠加
    ROTATE = "rotate"        # 轮换
    COMBINE = "combine"      # 组合(仅活载)


class CombinationFactor:
    """荷载组合系数 / Load Combination Factors
    
    基于 GB50009-2012 和 GB50011-2010
    """
    
    def __init__(
        self,
        gamma_g: float = 1.3,      # 恒载分项系数 (不利) - 活载/风载控制组合
        gamma_g_favorable: float = 1.0,  # 恒载分项系数 (有利)
        gamma_q: float = 1.5,      # 活载分项系数
        gamma_w: float = 1.5,      # 风载分项系数
        gamma_eh: float = 1.3,     # 水平地震作用分项系数
        gamma_ev: float = 0.5,     # 竖向地震作用分项系数
        psi_live: float = 0.7,    # 活载组合值系数
        psi_wind: float = 0.6,    # 风载组合值系数
        psi_crane: float = 0.7,   # 吊车组合值系数
        psi_temp: float = 0.6,    # 温度荷载组合值系数
        psi_seismic: float = 0.5  # 地震组合时活载代表值系数
    ):
        self.gamma_g = gamma_g
        self.gamma_g_favorable = gamma_g_favorable
        self.gamma_q = gamma_q
        self.gamma_w = gamma_w
        self.gamma_eh = gamma_eh
        self.gamma_ev = gamma_ev
        self.psi_live = psi_live
        self.psi_wind = psi_wind
        self.psi_crane = psi_crane
        self.psi_temp = psi_temp
        self.psi_seismic = psi_seismic
    
    def to_dict(self) -> Dict[str, float]:
        """转换为字典"""
        return {
            "gamma_g": self.gamma_g,
            "gamma_g_favorable": self.gamma_g_favorable,
            "gamma_q": self.gamma_q,
            "gamma_w": self.gamma_w,
            "gamma_eh": self.gamma_eh,
            "gamma_ev": self.gamma_ev,
            "psi_live": self.psi_live,
            "psi_wind": self.psi_wind,
            "psi_crane": self.psi_crane,
            "psi_temp": self.psi_temp,
            "psi_seismic": self.psi_seismic
        }


class LoadCombinationGenerator:
    """荷载组合生成器 / Load Combination Generator
    
    基于 Reference_48_load_skill_spec.md 第2节实现
    支持 ULS、SLS、地震组合、自定义组合等完整功能
    """

    def __init__(self, model=None, factors: Optional[CombinationFactor] = None):
        """
        初始化荷载组合生成器

        Args:
            model: 结构模型（可选，预留扩展）
            factors: 组合系数配置（可选，默认使用规范值）
        """
        self.model = model
        self.factors = factors or CombinationFactor()
        self.combinations: List[Dict[str, Any]] = []
        self.combination_counter = 1
    
    def _get_next_combination_id(self, prefix: str = "COMB") -> str:
        """获取下一个组合ID"""
        combo_id = f"{prefix}_{self.combination_counter}"
        self.combination_counter += 1
        return combo_id
    
    def _create_combination(
        self,
        combination_type: str,
        description: str,
        factors: Dict[str, float],
        code_reference: str
    ) -> Dict[str, Any]:
        """创建单个荷载组合"""
        combo = {
            "id": self._get_next_combination_id(),
            "type": combination_type,
            "description": description,
            "factors": factors,
            "code_reference": code_reference,
            "extra": {}
        }
        self.combinations.append(combo)
        return combo
    
    def generate_uls_combinations(
        self,
        dead_load_ids: List[str] = None,
        live_load_ids: List[str] = None,
        wind_load_ids: List[str] = None,
        seismic_load_ids: List[str] = None,
        crane_load_ids: List[str] = None,
        temp_load_ids: List[str] = None,
        include_favorable: bool = True
    ) -> Dict[str, Any]:
        """
        生成承载能力极限状态组合（ULS）
        
        基于 GB50009-2012 3.2.4
        
        Args:
            dead_load_ids: 恒载工况ID列表
            live_load_ids: 活载工况ID列表
            wind_load_ids: 风载工况ID列表
            seismic_load_ids: 地震工况ID列表
            crane_load_ids: 吊车荷载工况ID列表
            temp_load_ids: 温度荷载工况ID列表
            include_favorable: 是否包含恒载有利情况的组合

        Returns:
            荷载组合字典
        """
        combinations = []
        f = self.factors
        
        # ========== 2.2.1 无吊车时的基本组合 ==========
        
        # 1) 活载控制组合
        if dead_load_ids and live_load_ids:
            for dead_id in dead_load_ids:
                for live_id in live_load_ids:
                    # 1.3*恒 + 1.5*活
                    combo = self._create_combination(
                        combination_type="uls",
                        description=f"活载控制: {live_id}",
                        factors={dead_id: f.gamma_g, live_id: f.gamma_q},
                        code_reference="GB50009-2012 3.2.4"
                    )
                    combinations.append(combo)
                    
                    # 1.0*恒 + 1.5*活 (当恒载有利时)
                    if include_favorable:
                        combo_fav = self._create_combination(
                            combination_type="uls",
                            description=f"活载控制(恒有利): {live_id}",
                            factors={dead_id: f.gamma_g_favorable, live_id: f.gamma_q},
                            code_reference="GB50009-2012 3.2.4"
                        )
                        combinations.append(combo_fav)
        
        # 2) 风载控制组合
        if dead_load_ids and wind_load_ids:
            for dead_id in dead_load_ids:
                for wind_id in wind_load_ids:
                    # 1.3*恒 + 1.5*风
                    combo = self._create_combination(
                        combination_type="uls",
                        description=f"风载控制: {wind_id}",
                        factors={dead_id: f.gamma_g, wind_id: f.gamma_w},
                        code_reference="GB50009-2012 3.2.4"
                    )
                    combinations.append(combo)
                    
                    # 1.0*恒 + 1.5*风 (当恒载有利时)
                    if include_favorable:
                        combo_fav = self._create_combination(
                            combination_type="uls",
                            description=f"风载控制(恒有利): {wind_id}",
                            factors={dead_id: f.gamma_g_favorable, wind_id: f.gamma_w},
                            code_reference="GB50009-2012 3.2.4"
                        )
                        combinations.append(combo_fav)
        
        # 3) 活+风组合
        if dead_load_ids and live_load_ids and wind_load_ids:
            for dead_id in dead_load_ids:
                for live_id in live_load_ids:
                    for wind_id in wind_load_ids:
                        # 1.3*恒 + 1.5*活 + 0.6*1.5*风
                        combo1 = self._create_combination(
                            combination_type="uls",
                            description=f"活载控制+风: {live_id} + {wind_id}",
                            factors={
                                dead_id: f.gamma_g,
                                live_id: f.gamma_q,
                                wind_id: f.psi_wind * f.gamma_w
                            },
                            code_reference="GB50009-2012 3.2.4"
                        )
                        combinations.append(combo1)
                        
                        # 1.0*恒 + 1.5*活 + 0.6*1.5*风 (当恒载有利时)
                        if include_favorable:
                            combo1_fav = self._create_combination(
                                combination_type="uls",
                                description=f"活载控制+风(恒有利): {live_id} + {wind_id}",
                                factors={
                                    dead_id: f.gamma_g_favorable,
                                    live_id: f.gamma_q,
                                    wind_id: f.psi_wind * f.gamma_w
                                },
                                code_reference="GB50009-2012 3.2.4"
                            )
                            combinations.append(combo1_fav)
                        
                        # 1.3*恒 + 1.5*风 + 0.7*1.5*活
                        combo2 = self._create_combination(
                            combination_type="uls",
                            description=f"风载控制+活: {wind_id} + {live_id}",
                            factors={
                                dead_id: f.gamma_g,
                                wind_id: f.gamma_w,
                                live_id: f.psi_live * f.gamma_q
                            },
                            code_reference="GB50009-2012 3.2.4"
                        )
                        combinations.append(combo2)
                        
                        # 1.0*恒 + 1.5*风 + 0.7*1.5*活 (当恒载有利时)
                        if include_favorable:
                            combo2_fav = self._create_combination(
                                combination_type="uls",
                                description=f"风载控制+活(恒有利): {wind_id} + {live_id}",
                                factors={
                                    dead_id: f.gamma_g_favorable,
                                    wind_id: f.gamma_w,
                                    live_id: f.psi_live * f.gamma_q
                                },
                                code_reference="GB50009-2012 3.2.4"
                            )
                            combinations.append(combo2_fav)
        
        # ========== 2.2.2 有吊车荷载时的补充组合 ==========
        
        # 4) 吊车荷载组合
        if dead_load_ids and crane_load_ids:
            for dead_id in dead_load_ids:
                for crane_id in crane_load_ids:
                    # 1.3*恒 + 1.5*吊 (吊车单独控制)
                    combo = self._create_combination(
                        combination_type="uls",
                        description=f"吊车荷载控制: {crane_id}",
                        factors={dead_id: f.gamma_g, crane_id: f.gamma_q},
                        code_reference="GB50009-2012 3.2.4"
                    )
                    combinations.append(combo)
                    
                    # 1.0*恒 + 1.5*吊 (当恒载有利时)
                    if include_favorable:
                        combo_fav = self._create_combination(
                            combination_type="uls",
                            description=f"吊车荷载控制(恒有利): {crane_id}",
                            factors={dead_id: f.gamma_g_favorable, crane_id: f.gamma_q},
                            code_reference="GB50009-2012 3.2.4"
                        )
                        combinations.append(combo_fav)
        
        # 5) 活+吊组合
        if dead_load_ids and live_load_ids and crane_load_ids:
            for dead_id in dead_load_ids:
                for live_id in live_load_ids:
                    for crane_id in crane_load_ids:
                        # 1.3*恒 + 0.7*1.5*活 + 1.5*吊
                        combo1 = self._create_combination(
                            combination_type="uls",
                            description=f"吊车控制+活: {crane_id} + {live_id}",
                            factors={
                                dead_id: f.gamma_g,
                                crane_id: f.gamma_q,
                                live_id: f.psi_live * f.gamma_q
                            },
                            code_reference="GB50009-2012 3.2.4"
                        )
                        combinations.append(combo1)
                        
                        # 1.3*恒 + 1.5*活 + 0.7*1.5*吊
                        combo2 = self._create_combination(
                            combination_type="uls",
                            description=f"活载控制+吊车: {live_id} + {crane_id}",
                            factors={
                                dead_id: f.gamma_g,
                                live_id: f.gamma_q,
                                crane_id: f.psi_crane * f.gamma_q
                            },
                            code_reference="GB50009-2012 3.2.4"
                        )
                        combinations.append(combo2)
        
        # 6) 活+风+吊组合（示例）
        if dead_load_ids and live_load_ids and wind_load_ids and crane_load_ids:
            for dead_id in dead_load_ids:
                for live_id in live_load_ids:
                    for wind_id in wind_load_ids:
                        for crane_id in crane_load_ids:
                            # 1.3*恒 + 0.7*1.5*活 + 0.6*1.5*风 + 1.5*吊
                            combo = self._create_combination(
                                combination_type="uls",
                                description=f"吊车控制+活+风: {crane_id} + {live_id} + {wind_id}",
                                factors={
                                    dead_id: f.gamma_g,
                                    crane_id: f.gamma_q,
                                    live_id: f.psi_live * f.gamma_q,
                                    wind_id: f.psi_wind * f.gamma_w
                                },
                                code_reference="GB50009-2012 3.2.4"
                            )
                            combinations.append(combo)
        
        # ========== 2.2.3 特殊构件组合 ==========
        
        # 7) 温度荷载组合
        if dead_load_ids and live_load_ids and temp_load_ids:
            for dead_id in dead_load_ids:
                for live_id in live_load_ids:
                    for temp_id in temp_load_ids:
                        # 1.3*恒 + 1.5*活 + 0.6*1.5*温
                        combo1 = self._create_combination(
                            combination_type="uls",
                            description=f"活载控制+温度: {live_id} + {temp_id}",
                            factors={
                                dead_id: f.gamma_g,
                                live_id: f.gamma_q,
                                temp_id: f.psi_temp * f.gamma_q
                            },
                            code_reference="GB50009-2012 3.2.4"
                        )
                        combinations.append(combo1)
                        
                        # 1.0*恒 + 0.6*1.5*活 + 1.5*温
                        combo2 = self._create_combination(
                            combination_type="uls",
                            description=f"温度控制+活: {temp_id} + {live_id}",
                            factors={
                                dead_id: f.gamma_g_favorable,
                                temp_id: f.gamma_q,
                                live_id: f.psi_live * f.gamma_q
                            },
                            code_reference="GB50009-2012 3.2.4"
                        )
                        combinations.append(combo2)
        
        # ========== 2.2.4 地震作用组合 ==========
        
        # 8) 地震组合: 1.2*(恒 + 0.5*活) + 1.3*地
        if dead_load_ids and seismic_load_ids:
            for dead_id in dead_load_ids:
                for seismic_id in seismic_load_ids:
                    factors = {dead_id: 1.2, seismic_id: f.gamma_eh}
                    
                    # 加入活载代表值
                    if live_load_ids:
                        for live_id in live_load_ids:
                            factors[live_id] = f.psi_seismic * 1.2
                    
                    combo = self._create_combination(
                        combination_type="uls",
                        description=f"地震作用: {seismic_id}",
                        factors=factors,
                        code_reference="GB50011-2010 5.4.1"
                    )
                    combinations.append(combo)
                    
                    # 1.0*(恒 + 0.5*活) + 1.3*地 (当恒载有利时)
                    if include_favorable:
                        factors_fav = {dead_id: f.gamma_g_favorable, seismic_id: f.gamma_eh}
                        if live_load_ids:
                            for live_id in live_load_ids:
                                factors_fav[live_id] = f.psi_seismic * f.gamma_g_favorable
                        
                        combo_fav = self._create_combination(
                            combination_type="uls",
                            description=f"地震作用(恒有利): {seismic_id}",
                            factors=factors_fav,
                            code_reference="GB50011-2010 5.4.1"
                        )
                        combinations.append(combo_fav)
        
        self.combinations = combinations
        return {
            "combinations": combinations,
            "count": len(combinations)
        }
    
    def generate_sls_combinations(
        self,
        dead_load_ids: List[str] = None,
        live_load_ids: List[str] = None,
        wind_load_ids: List[str] = None,
        seismic_load_ids: List[str] = None
    ) -> Dict[str, Any]:
        """
        生成正常使用极限状态组合（SLS）
        
        基于 GB50009-2012 3.2.3
        所有分项系数取1.0，组合值系数同基本组合
        
        Args:
            dead_load_ids: 恒载工况ID列表
            live_load_ids: 活载工况ID列表
            wind_load_ids: 风载工况ID列表
            seismic_load_ids: 地震工况ID列表

        Returns:
            荷载组合字典
        """
        combinations = []
        f = self.factors
        
        # 所有系数取1.0，保留组合值系数
        
        # 1) 恒 + 活
        if dead_load_ids and live_load_ids:
            for dead_id in dead_load_ids:
                for live_id in live_load_ids:
                    combo = self._create_combination(
                        combination_type="sls",
                        description=f"恒载+活载: {dead_id} + {live_id}",
                        factors={dead_id: 1.0, live_id: 1.0},
                        code_reference="GB50009-2012 3.2.3"
                    )
                    combinations.append(combo)
        
        # 2) 恒 + 风
        if dead_load_ids and wind_load_ids:
            for dead_id in dead_load_ids:
                for wind_id in wind_load_ids:
                    combo = self._create_combination(
                        combination_type="sls",
                        description=f"恒载+风载: {dead_id} + {wind_id}",
                        factors={dead_id: 1.0, wind_id: 1.0},
                        code_reference="GB50009-2012 3.2.3"
                    )
                    combinations.append(combo)
        
        # 3) 恒 + 活 + 风
        if dead_load_ids and live_load_ids and wind_load_ids:
            for dead_id in dead_load_ids:
                for live_id in live_load_ids:
                    for wind_id in wind_load_ids:
                        # 1.0*恒 + 1.0*活 + 0.6*1.0*风
                        combo1 = self._create_combination(
                            combination_type="sls",
                            description=f"恒载+活载+风载(活主): {dead_id} + {live_id} + {wind_id}",
                            factors={
                                dead_id: 1.0,
                                live_id: 1.0,
                                wind_id: f.psi_wind
                            },
                            code_reference="GB50009-2012 3.2.3"
                        )
                        combinations.append(combo1)
                        
                        # 1.0*恒 + 1.0*风 + 0.7*1.0*活
                        combo2 = self._create_combination(
                            combination_type="sls",
                            description=f"恒载+风载+活载(风主): {dead_id} + {wind_id} + {live_id}",
                            factors={
                                dead_id: 1.0,
                                wind_id: 1.0,
                                live_id: f.psi_live
                            },
                            code_reference="GB50009-2012 3.2.3"
                        )
                        combinations.append(combo2)
        
        # 4) 恒 + 地震
        if dead_load_ids and seismic_load_ids:
            for dead_id in dead_load_ids:
                for seismic_id in seismic_load_ids:
                    factors = {dead_id: 1.0, seismic_id: 1.0}
                    if live_load_ids:
                        for live_id in live_load_ids:
                            factors[live_id] = f.psi_seismic
                    
                    combo = self._create_combination(
                        combination_type="sls",
                        description=f"恒载+地震: {dead_id} + {seismic_id}",
                        factors=factors,
                        code_reference="GB50011-2010 5.4.1"
                    )
                    combinations.append(combo)
        
        self.combinations = combinations
        return {
            "combinations": combinations,
            "count": len(combinations)
        }
    
    def generate_seismic_combinations(
        self,
        dead_load_ids: List[str] = None,
        live_load_ids: List[str] = None,
        seismic_load_ids: List[str] = None,
        crane_load_ids: List[str] = None
    ) -> Dict[str, Any]:
        """
        生成地震作用组合
        
        基于 GB50011-2010 5.4.1
        公式: γG*(恒 + ψ*活 + ψ*吊) + γEh*水平地 + γEv*竖向地
        
        Args:
            dead_load_ids: 恒载工况ID列表
            live_load_ids: 活载工况ID列表
            seismic_load_ids: 地震工况ID列表
            crane_load_ids: 吊车荷载工况ID列表

        Returns:
            地震组合字典
        """
        combinations = []
        f = self.factors
        
        if not (dead_load_ids and seismic_load_ids):
            return {
                "combinations": [],
                "count": 0
            }
        
        for dead_id in dead_load_ids:
            for seismic_id in seismic_load_ids:
                # 基础组合: 1.2*(恒 + 0.5*活) + 1.3*地
                factors = {
                    dead_id: f.gamma_g,
                    seismic_id: f.gamma_eh
                }
                
                # 活载代表值: 0.5*恒载分项系数
                if live_load_ids:
                    for live_id in live_load_ids:
                        factors[live_id] = f.psi_seismic * f.gamma_g
                
                # 吊车荷载代表值: 0.5*恒载分项系数
                if crane_load_ids:
                    for crane_id in crane_load_ids:
                        factors[crane_id] = f.psi_seismic * f.gamma_g
                
                combo = self._create_combination(
                    combination_type="seismic",
                    description=f"地震作用: {seismic_id}",
                    factors=factors,
                    code_reference="GB50011-2010 5.4.1"
                )
                combinations.append(combo)
                
                # 恒载有利情况: 1.0*(恒 + 0.5*活) + 1.3*地
                factors_fav = {
                    dead_id: f.gamma_g_favorable,
                    seismic_id: f.gamma_eh
                }
                
                if live_load_ids:
                    for live_id in live_load_ids:
                        factors_fav[live_id] = f.psi_seismic * f.gamma_g_favorable
                
                if crane_load_ids:
                    for crane_id in crane_load_ids:
                        factors_fav[crane_id] = f.psi_seismic * f.gamma_g_favorable
                
                combo_fav = self._create_combination(
                    combination_type="seismic",
                    description=f"地震作用(恒有利): {seismic_id}",
                    factors=factors_fav,
                    code_reference="GB50011-2010 5.4.1"
                )
                combinations.append(combo_fav)
        
        self.combinations = combinations
        return {
            "combinations": combinations,
            "count": len(combinations)
        }
    
    def expand_load_cases_for_combination(
        self,
        load_cases: Dict[str, Dict[str, Any]]
    ) -> Dict[str, Dict[str, Any]]:
        """
        对可变荷载进行工况展开
        
        基于 2.2.4 工况展开规则:
        - 活荷载: 展开为活1、活2、活3、活4四组子组合
        - 风荷载: 展开为左风、右风
        - 地震作用: 展开为左震、右震
        - 吊车荷载: 展开为吊1~吊8八组子组合
        
        Args:
            load_cases: 荷载工况字典 {case_id: case_data}
        
        Returns:
            展开后的荷载工况字典
        """
        expanded_cases = {}
        
        for case_id, case_data in load_cases.items():
            case_type = case_data.get("type", "").lower()
            
            # 活荷载展开
            if case_type == "live_load":
                for i in range(1, 5):
                    expanded_id = f"{case_id}_{i}"
                    expanded_cases[expanded_id] = {
                        "id": expanded_id,
                        "type": "live_load",
                        "description": f"{case_data.get('description', '')} (活{i})",
                        "parent_case": case_id,
                        "extra": {**case_data.get("extra", {}), "sub_case_index": i}
                    }
            
            # 风荷载展开
            elif case_type == "wind_load":
                for direction in ["left", "right"]:
                    expanded_id = f"{case_id}_{direction}"
                    expanded_cases[expanded_id] = {
                        "id": expanded_id,
                        "type": "wind_load",
                        "description": f"{case_data.get('description', '')} ({direction}_wind)",
                        "parent_case": case_id,
                        "extra": {**case_data.get("extra", {}), "wind_direction": direction}
                    }
            
            # 地震作用展开
            elif case_type == "seismic_load":
                for direction in ["left", "right"]:
                    expanded_id = f"{case_id}_{direction}"
                    expanded_cases[expanded_id] = {
                        "id": expanded_id,
                        "type": "seismic_load",
                        "description": f"{case_data.get('description', '')} ({direction}_seismic)",
                        "parent_case": case_id,
                        "extra": {**case_data.get("extra", {}), "seismic_direction": direction}
                    }
            
            # 吊车荷载展开
            elif case_type == "crane_load":
                for i in range(1, 9):
                    expanded_id = f"{case_id}_{i}"
                    expanded_cases[expanded_id] = {
                        "id": expanded_id,
                        "type": "crane_load",
                        "description": f"{case_data.get('description', '')} (吊{i})",
                        "parent_case": case_id,
                        "extra": {**case_data.get("extra", {}), "crane_case_index": i}
                    }
            else:
                # 其他荷载类型不展开，保留原工况
                expanded_cases[case_id] = case_data
        
        return expanded_cases
    
    def process_custom_load_case_combination(
        self,
        custom_load_ids: List[str],
        combination_method: CombinationMethod,
        base_combinations: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        处理自定义工况组合
        
        基于 2.3 自定义工况组合方式:
        - 叠加: 原组合 S = γ1*S1 变为 S = γ1*S1 + γ1'*S1'
        - 轮换: 原组合扩展为 S = γ1*S1 和 S = γ1'*S1' 两组
        - 组合 (仅活荷载类型有效): 考虑多组活荷载轮流作为主控项
        
        Args:
            custom_load_ids: 自定义荷载工况ID列表
            combination_method: 组合方式 (叠加/轮换/组合)
            base_combinations: 基础组合列表
        
        Returns:
            处理后的组合列表
        """
        result_combinations = []
        
        if combination_method == CombinationMethod.SUPERPOSE:
            # 叠加: 在原组合基础上添加自定义荷载
            for base_combo in base_combinations:
                new_combo = base_combo.copy()
                new_combo["description"] = f"{base_combo['description']} + 叠加自定义"

                # 必须拷贝 factors 字典，否则会修改原始组合对象
                new_combo["factors"] = base_combo["factors"].copy()
                for custom_id in custom_load_ids:
                    new_combo["factors"][custom_id] = 1.0

                result_combinations.append(new_combo)
        
        elif combination_method == CombinationMethod.ROTATE:
            # 轮换: 为每个自定义工况生成独立组合
            for custom_id in custom_load_ids:
                for base_combo in base_combinations:
                    new_combo = base_combo.copy()
                    new_combo["id"] = self._get_next_combination_id()
                    new_combo["description"] = f"{base_combo['description']} + {custom_id}"
                    new_combo["factors"] = {custom_id: 1.0}
                    
                    result_combinations.append(new_combo)
        
        elif combination_method == CombinationMethod.COMBINE:
            # 组合: 考虑多组活荷载轮流作为主控项
            for base_combo in base_combinations:
                # 为每个自定义活载生成主控组合
                for i, custom_id in enumerate(custom_load_ids):
                    factors = {}

                    # 主控自定义荷载
                    factors[custom_id] = self.factors.gamma_q

                    # 其他活载作为组合值
                    for j, other_id in enumerate(custom_load_ids):
                        if j != i:
                            factors[other_id] = self.factors.psi_live

                    # 加入原组合的恒载等
                    factors.update({
                        k: v for k, v in base_combo["factors"].items()
                        if k not in custom_load_ids
                    })

                    new_combo = base_combo.copy()
                    new_combo["id"] = self._get_next_combination_id()
                    new_combo["description"] = f"{custom_id}主控组合"
                    new_combo["factors"] = factors

                    result_combinations.append(new_combo)
        
        else:
            raise ValueError(f"未知的组合方式: {combination_method}")
        
        self.combinations.extend(result_combinations)
        return result_combinations
    
    def generate_special_member_combinations(
        self,
        dead_load_ids: List[str] = None,
        live_load_ids: List[str] = None,
        wind_load_ids: List[str] = None,
        member_type: str = "wind_column"
    ) -> Dict[str, Any]:
        """
        生成特殊构件组合
        
        基于 2.2.3 特殊构件组合:
        - 抗风柱 (平面外受力): 需要特殊的风荷载组合
        - 其他特殊构件可在此扩展
        
        Args:
            dead_load_ids: 恒载工况ID列表
            live_load_ids: 活载工况ID列表
            wind_load_ids: 风载工况ID列表
            member_type: 特殊构件类型 (wind_column 等)
        
        Returns:
            荷载组合字典
        """
        combinations = []
        f = self.factors
        
        if member_type == "wind_column":
            # 抗风柱组合
            if dead_load_ids and live_load_ids and wind_load_ids:
                for dead_id in dead_load_ids:
                    for live_id in live_load_ids:
                        for wind_id in wind_load_ids:
                            # 1.3*恒 + 1.5*风压力 + 0.7*1.5*活
                            combo1 = self._create_combination(
                                combination_type="uls",
                                description=f"抗风柱(风压力控制): {wind_id}",
                                factors={
                                    dead_id: f.gamma_g,
                                    wind_id: f.gamma_w,
                                    live_id: f.psi_live * f.gamma_q
                                },
                                code_reference="GB50009-2012 抗风柱设计"
                            )
                            combinations.append(combo1)
                            
                            # 1.3*恒 + 0.6*1.5*风压力 + 1.5*活
                            combo2 = self._create_combination(
                                combination_type="uls",
                                description=f"抗风柱(活载控制,风压力): {wind_id}",
                                factors={
                                    dead_id: f.gamma_g,
                                    wind_id: f.psi_wind * f.gamma_w,
                                    live_id: f.gamma_q
                                },
                                code_reference="GB50009-2012 抗风柱设计"
                            )
                            combinations.append(combo2)
                            
                            # 1.3*恒 + 1.5*风吸力 + 0.7*1.5*活
                            combo3 = self._create_combination(
                                combination_type="uls",
                                description=f"抗风柱(风吸力控制): {wind_id}",
                                factors={
                                    dead_id: f.gamma_g,
                                    wind_id: f.gamma_w,
                                    live_id: f.psi_live * f.gamma_q
                                },
                                code_reference="GB50009-2012 抗风柱设计"
                            )
                            combinations.append(combo3)
                            
                            # 1.3*恒 + 0.6*1.5*风吸力 + 1.5*活
                            combo4 = self._create_combination(
                                combination_type="uls",
                                description=f"抗风柱(活载控制,风吸力): {wind_id}",
                                factors={
                                    dead_id: f.gamma_g,
                                    wind_id: f.psi_wind * f.gamma_w,
                                    live_id: f.gamma_q
                                },
                                code_reference="GB50009-2012 抗风柱设计"
                            )
                            combinations.append(combo4)
        
        self.combinations = combinations
        return {
            "combinations": combinations,
            "count": len(combinations)
        }
    
    def create_custom_combination(
        self,
        factors: Dict[str, float],
        description: str = "",
        combination_type: str = "uls",
        code_reference: str = "custom"
    ) -> Dict[str, Any]:
        """
        创建自定义荷载组合
        
        Args:
            factors: 荷载系数字典 {load_id: factor}
            description: 组合描述
            combination_type: 组合类型 (uls/sls/seismic/accidental)
            code_reference: 规范条文号或自定义标识
        
        Returns:
            荷载组合字典
        """
        combo = self._create_combination(
            combination_type=combination_type,
            description=description,
            factors=factors,
            code_reference=code_reference
        )
        
        return combo
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "combinations": self.combinations,
            "count": len(self.combinations),
            "factors": self.factors.to_dict() if self.factors else None
        }
    
    def clear(self) -> None:
        """清空所有组合"""
        self.combinations = []
        self.combination_counter = 1
