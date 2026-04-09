"""
恒载子技能测试用例
Test cases for dead-load sub-skill
"""

import sys
from pathlib import Path

from test_import_adapter import TestImportAdapter

# 初始化导入适配器
load_boundary_path = Path(__file__).parent.parent
adapter = TestImportAdapter(load_boundary_path)

# 导入结构协议类
StructureModelV2, NodeV2, ElementV2, MaterialV2, SectionV2, LoadCaseV2 = adapter.import_structure_protocol(
    "StructureModelV2", "NodeV2", "ElementV2", "MaterialV2", "SectionV2", "LoadCaseV2"
)

# 导入技能运行时
dead_load_runtime = adapter.import_skill_runtime("dead-load")
generate_dead_loads = dead_load_runtime.generate_dead_loads


def test_self_weight_calculation():
    """测试自重计算"""
    print("Testing self-weight calculation...")

    # 创建测试模型
    model = StructureModelV2(
        nodes=[
            NodeV2(id="N1", x=0, y=0, z=0),
            NodeV2(id="N2", x=6, y=0, z=0),
            NodeV2(id="N3", x=6, y=0, z=4),
            NodeV2(id="N4", x=0, y=0, z=4),
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
            )
        ],
        sections=[
            SectionV2(
                id="S1",
                name="300x500",
                type="rectangular",
                width=300,
                height=500
            )
        ],
        elements=[
            ElementV2(
                id="B1",
                type="beam",
                nodes=["N1", "N2"],
                material="M1",
                section="S1"
            )
        ],
        load_cases=[]
    )

    # 生成自重荷载
    result = generate_dead_loads(model, {
        "case_id": "LC_DE",
        "case_name": "恒载工况",
        "description": "结构自重",
        "include_self_weight": True
    })

    # 验证结果
    assert result["status"] == "success"
    assert "LC_DE" in result["load_cases"]
    assert len(result["load_actions"]) > 0

    # 计算理论自重
    # 线荷载 = 密度 * g * 截面积 = 2500 * 9.81 * (300*500) / 1e6 = 3.68 kN/m
    expected_load = 2500 * 9.81 * (300 * 500) / 1e6

    load_action = result["load_actions"][0]
    actual_load = load_action["loadValue"]

    print(f"Expected self-weight: {expected_load:.4f} kN/m")
    print(f"Calculated self-weight: {actual_load:.4f} kN/m")

    # 允许小误差
    assert abs(actual_load - expected_load) < 0.1

    print("✓ Self-weight calculation test passed!")
    return result


def test_custom_dead_load():
    """测试自定义恒载"""
    print("\nTesting custom dead load...")

    # 创建简单模型
    model = StructureModelV2()

    # 添加自定义恒载
    result = generate_dead_loads(model, {
        "case_id": "LC_DE",
        "include_self_weight": False,
        "uniform_loads": [
            {
                "element_id": "B1",
                "element_type": "beam",
                "load_value": 10.0  # kN/m
            }
        ]
    })

    assert result["status"] == "success"
    assert len(result["load_actions"]) == 1

    load_action = result["load_actions"][0]
    assert load_action["loadValue"] == 10.0
    assert load_action["loadType"] == "distributed_load"

    print("✓ Custom dead load test passed!")
    return result


def test_point_dead_load():
    """测试集中恒载"""
    print("\nTesting point dead load...")

    from dead_load.runtime import DeadLoadGenerator

    model = StructureModelV2()
    generator = DeadLoadGenerator(model)

    # 添加集中荷载
    load_action = generator.add_point_dead_load(
        element_id="B1",
        element_type="beam",
        load_value=50.0,  # kN
        position={"x": 3.0, "y": 0.0, "z": 0.0},
        case_id="LC_DE"
    )

    assert load_action["loadType"] == "point_force"
    assert load_action["loadValue"] == 50.0

    print("✓ Point dead load test passed!")
    return load_action


def run_tests() -> bool:
    """运行所有测试"""
    print("=" * 60)
    print("Dead Load Sub-Skill Test Suite")
    print("=" * 60)

    try:
        test_self_weight_calculation()
        test_custom_dead_load()
        test_point_dead_load()

        print("\n" + "=" * 60)
        print("All tests passed! [PASS]")
        print("=" * 60)
        return True
    except AssertionError as e:
        print(f"\n[FAIL] Test failed: {e}")
        import traceback
        traceback.print_exc()
        return False
    except Exception as e:
        print(f"\n[FAIL] Error: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    import sys
    success = run_tests()
    sys.exit(0 if success else 1)
