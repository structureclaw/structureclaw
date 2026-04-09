"""
荷载与边界条件子技能综合使用示例
Comprehensive usage example for load and boundary sub-skills

此示例展示如何:
1. 创建 V2 结构模型
2. 施加恒载、活载、风载、地震荷载
3. 施加边界条件
4. 组合成完整的荷载工况

This example demonstrates how to:
1. Create a V2 structure model
2. Apply dead, live, wind, and seismic loads
3. Apply boundary conditions
4. Combine into complete load cases
"""

import sys
from pathlib import Path

from test_import_adapter import TestImportAdapter

# 初始化导入适配器
load_boundary_path = Path(__file__).parent.parent
adapter = TestImportAdapter(load_boundary_path)

# 导入结构协议类
StructureModelV2, NodeV2, ElementV2, MaterialV2, SectionV2 = adapter.import_structure_protocol(
    "StructureModelV2", "NodeV2", "ElementV2", "MaterialV2", "SectionV2"
)

# 导入技能运行时
dead_load_runtime = adapter.import_skill_runtime("dead-load")
generate_dead_loads = dead_load_runtime.generate_dead_loads

live_load_runtime = adapter.import_skill_runtime("live-load")
generate_live_loads = live_load_runtime.generate_live_loads

wind_load_runtime = adapter.import_skill_runtime("wind-load")
generate_wind_loads = wind_load_runtime.generate_wind_loads

seismic_load_runtime = adapter.import_skill_runtime("seismic-load")
generate_seismic_loads = seismic_load_runtime.generate_seismic_loads

boundary_condition_runtime = adapter.import_skill_runtime("boundary-condition")
apply_boundary_conditions = boundary_condition_runtime.apply_boundary_conditions


def create_sample_model():
    """创建示例结构模型 (两跨三层框架)"""
    return StructureModelV2(
        schema_version="2.0.0",
        unit_system="SI",
        project=ProjectInfo(
            name="示例框架",
            code_standard="GB50010-2010",
            design_life=50,
            importance_class="丙"
        ),
        nodes=[
            # 底层节点
            NodeV2(id="N1", x=0, y=0, z=0, story="F1"),
            NodeV2(id="N2", x=6, y=0, z=0, story="F1"),
            NodeV2(id="N3", x=12, y=0, z=0, story="F1"),

            # 二层节点
            NodeV2(id="N4", x=0, y=0, z=4, story="F2"),
            NodeV2(id="N5", x=6, y=0, z=4, story="F2"),
            NodeV2(id="N6", x=12, y=0, z=4, story="F2"),

            # 三层节点
            NodeV2(id="N7", x=0, y=0, z=8, story="F3"),
            NodeV2(id="N8", x=6, y=0, z=8, story="F3"),
            NodeV2(id="N9", x=12, y=0, z=8, story="F3"),
        ],
        materials=[
            MaterialV2(
                id="M1",
                name="C30混凝土",
                E=30000,
                nu=0.2,
                rho=2500,
                grade="C30",
                category="concrete"
            ),
            MaterialV2(
                id="M2",
                name="HRB400钢筋",
                E=200000,
                nu=0.3,
                rho=7850,
                grade="HRB400",
                category="rebar"
            )
        ],
        sections=[
            SectionV2(
                id="S1",
                name="柱 400x400",
                type="rectangular",
                width=400,
                height=400
            ),
            SectionV2(
                id="S2",
                name="梁 300x500",
                type="rectangular",
                width=300,
                height=500
            )
        ],
        stories=[
            StoryDef(id="F1", height=4.0, elevation=0.0),
            StoryDef(id="F2", height=4.0, elevation=4.0),
            StoryDef(id="F3", height=4.0, elevation=8.0),
        ],
        elements=[
            # 柱
            ElementV2(id="C1", type="column", nodes=["N1", "N4"], material="M1", section="S1", story="F1"),
            ElementV2(id="C2", type="column", nodes=["N2", "N5"], material="M1", section="S1", story="F1"),
            ElementV2(id="C3", type="column", nodes=["N3", "N6"], material="M1", section="S1", story="F1"),
            ElementV2(id="C4", type="column", nodes=["N4", "N7"], material="M1", section="S1", story="F2"),
            ElementV2(id="C5", type="column", nodes=["N5", "N8"], material="M1", section="S1", story="F2"),
            ElementV2(id="C6", type="column", nodes=["N6", "N9"], material="M1", section="S1", story="F2"),

            # 梁
            ElementV2(id="B1", type="beam", nodes=["N1", "N2"], material="M1", section="S2", story="F1"),
            ElementV2(id="B2", type="beam", nodes=["N2", "N3"], material="M1", section="S2", story="F1"),
            ElementV2(id="B3", type="beam", nodes=["N4", "N5"], material="M1", section="S2", story="F2"),
            ElementV2(id="B4", type="beam", nodes=["N5", "N6"], material="M1", section="S2", story="F2"),
            ElementV2(id="B5", type="beam", nodes=["N7", "N8"], material="M1", section="S2", story="F3"),
            ElementV2(id="B6", type="beam", nodes=["N8", "N9"], material="M1", section="S2", story="F3"),
        ],
        load_cases=[],
        load_combinations=[]
    )


def main():
    """主函数"""
    print("=" * 70)
    print("Load and Boundary Sub-Skills - Comprehensive Example")
    print("=" * 70)

    # 1. 创建模型
    print("\n[1] Creating sample model...")
    model = create_sample_model()
    print(f"✓ Model created: {len(model.nodes)} nodes, {len(model.elements)} elements")

    # 2. 施加边界条件
    print("\n[2] Applying boundary conditions...")
    boundary_result = apply_boundary_conditions(model, {
        "support_type": "fixed",
        "node_ids": ["N1", "N2", "N3"],  # 底层固定
        "apply_hinged_ends": False,
        "calculate_effective_lengths": True
    })
    print(f"✓ Applied {boundary_result['summary']['constraint_count']} nodal constraints")
    print(f"✓ Calculated {boundary_result['summary']['effective_length_count']} effective lengths")

    # 3. 施加恒载 (自重)
    print("\n[3] Generating dead loads (self-weight)...")
    dead_result = generate_dead_loads(model, {
        "case_id": "LC_DE",
        "case_name": "恒载工况",
        "description": "结构自重及永久荷载",
        "include_self_weight": True
    })
    print(f"✓ Generated dead load case LC_DE")
    print(f"  - Load actions: {dead_result['summary']['action_count']}")
    print(f"  - Sample load: {dead_result['load_actions'][0]['description'][:50]}")

    # 4. 施加活载
    print("\n[4] Generating live loads (office floor)...")
    live_result = generate_live_loads(model, {
        "case_id": "LC_LL",
        "case_name": "活载工况",
        "description": "办公楼面活载",
        "floor_load_type": "office"
    })
    print(f"✓ Generated live load case LC_LL")
    print(f"  - Load actions: {live_result['summary']['action_count']}")
    print(f"  - Floor type: {live_result['summary']['floor_type']}")

    # 5. 施加风荷载
    print("\n[5] Generating wind loads...")
    wind_result = generate_wind_loads(model, {
        "case_id": "LC_WX",
        "case_name": "X向风载工况",
        "description": "X方向风荷载",
        "basic_pressure": 0.55,
        "terrain_roughness": "B",
        "shape_factor": 1.3,
        "wind_direction": "x"
    })
    print(f"✓ Generated wind load case LC_WX")
    print(f"  - Load actions: {wind_result['summary']['action_count']}")
    print(f"  - Basic pressure: {wind_result['summary']['basic_pressure']} kN/m²")
    print(f"  - Direction: {wind_result['summary']['wind_direction']}")

    # 6. 施加地震荷载
    print("\n[6] Generating seismic loads...")
    seismic_result = generate_seismic_loads(model, {
        "case_id": "LC_EX",
        "case_name": "X向地震工况",
        "description": "X方向地震作用",
        "intensity": 7.0,
        "site_category": "II",
        "design_group": "第二组",
        "damping_ratio": 0.05,
        "seismic_direction": "x"
    })
    print(f"✓ Generated seismic load case LC_EX")
    print(f"  - Load actions: {seismic_result['summary']['action_count']}")
    print(f"  - Intensity: {seismic_result['summary']['intensity']}")
    print(f"  - Site category: {seismic_result['summary']['site_category']}")

    # 7. 汇总所有荷载工况
    print("\n[7] Summary of load cases...")
    all_load_cases = {
        **dead_result["load_cases"],
        **live_result["load_cases"],
        **wind_result["load_cases"],
        **seismic_result["load_cases"]
    }

    print(f"\nTotal load cases: {len(all_load_cases)}")
    for case_id, case_data in all_load_cases.items():
        print(f"  - {case_id}: {case_data['type']} ({len(case_data['loads'])} loads)")

    # 8. 汇总边界条件
    print(f"\nTotal nodal constraints: {len(boundary_result['nodal_constraints'])}")
    print(f"Total member end releases: {len(boundary_result['member_end_releases'])}")
    print(f"Total effective lengths: {len(boundary_result['effective_lengths'])}")

    print("\n" + "=" * 70)
    print("Example completed successfully! ✓")
    print("=" * 70)

    # 返回完整的结果，便于进一步处理
    return {
        "model": model,
        "load_cases": all_load_cases,
        "boundary_conditions": {
            "nodal_constraints": boundary_result["nodal_constraints"],
            "member_end_releases": boundary_result["member_end_releases"],
            "effective_lengths": boundary_result["effective_lengths"]
        }
    }


if __name__ == "__main__":
    result = main()

    # 可选: 保存结果到文件
    # import json
    # with open("load_boundary_result.json", "w", encoding="utf-8") as f:
    #     json.dump({
    #         "load_cases": result["load_cases"],
    #         "boundary_conditions": result["boundary_conditions"]
    #     }, f, indent=2, ensure_ascii=False)
    # print("\n✓ Results saved to load_boundary_result.json")
