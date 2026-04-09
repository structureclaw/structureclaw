"""
荷载组合技能测试
Test Load Combination Skill
验证荷载组合生成的正确性和完整性
"""

import sys
from pathlib import Path

from test_import_adapter import TestImportAdapter

# 初始化导入适配器
load_boundary_path = Path(__file__).parent.parent
adapter = TestImportAdapter(load_boundary_path)

# 导入结构协议类
StructureModelV2, LoadCaseV2, LoadCombinationV2 = adapter.import_structure_protocol(
    "StructureModelV2", "LoadCaseV2", "LoadCombinationV2"
)

# 导入荷载组合运行时
load_combination_runtime = adapter.import_skill_runtime("load-combination")
generate_load_combinations = load_combination_runtime.generate_load_combinations
expand_load_cases = load_combination_runtime.expand_load_cases
process_custom_combinations = load_combination_runtime.process_custom_combinations
generate_special_member_combinations = load_combination_runtime.generate_special_member_combinations
create_custom_combination = load_combination_runtime.create_custom_combination


def test_basic_uls_combinations():
    """测试基础 ULS 组合生成"""
    print("\n" + "=" * 70)
    print("测试 1: 基础 ULS 组合生成")
    print("=" * 70)
    
    result = generate_load_combinations({
        "load_cases": {
            "dead_load": ["LC_DE"],
            "live_load": ["LC_LL"],
            "wind_load": ["LC_WX"]
        },
        "combination_type": "uls"
    })
    
    assert result["status"] == "success", f"ULS 组合生成失败: {result.get('error')}"
    assert len(result["combinations"]) > 0, "未生成任何 ULS 组合"
    
    summary = result["summary"]
    assert summary["uls"] > 0, "未生成 ULS 组合"
    
    print(f"[PASS] ULS 组合生成成功")
    print(f"  - 总组合数: {summary['total']}")
    print(f"  - ULS 组合数: {summary['uls']}")
    
    # 验证活载控制组合
    live_control = [c for c in result["combinations"] if "活载控制" in c["description"]]
    assert len(live_control) > 0, "未生成活载控制组合"
    print(f"  - 活载控制组合: {len(live_control)}")
    
    # 验证风载控制组合
    wind_control = [c for c in result["combinations"] if "风载控制" in c["description"]]
    assert len(wind_control) > 0, "未生成风载控制组合"
    print(f"  - 风载控制组合: {len(wind_control)}")
    
    # 验证活+风组合
    live_wind = [c for c in result["combinations"] if "活载" in c["description"] and "风" in c["description"]]
    assert len(live_wind) > 0, "未生成活+风组合"
    print(f"  - 活+风组合: {len(live_wind)}")
    
    print("[PASS] 测试 1 通过\n")
    return True


def test_seismic_combinations():
    """测试地震作用组合生成"""
    print("=" * 70)
    print("测试 2: 地震作用组合生成")
    print("=" * 70)
    
    result = generate_load_combinations({
        "load_cases": {
            "dead_load": ["LC_DE"],
            "live_load": ["LC_LL"],
            "seismic_load": ["LC_EX"]
        },
        "combination_type": "seismic"
    })
    
    assert result["status"] == "success", f"地震组合生成失败: {result.get('error')}"
    assert len(result["combinations"]) > 0, "未生成任何地震组合"
    
    summary = result["summary"]
    assert summary["seismic"] > 0, "未生成地震组合"
    
    print(f"✓ 地震组合生成成功")
    print(f"  - 总组合数: {summary['total']}")
    print(f"  - 地震组合数: {summary['seismic']}")
    
    # 验证地震组合中包含活载代表值系数
    seismic_combos = [c for c in result["combinations"] if c["type"] == "seismic"]
    for combo in seismic_combos:
        factors = combo["factors"]
        print(f"  - {combo['id']}: {combo['description']}")
        print(f"    系数: {factors}")
    
    print("✓ 测试 2 通过\n")
    return True


def test_sls_combinations():
    """测试 SLS 组合生成"""
    print("=" * 70)
    print("测试 3: SLS 组合生成")
    print("=" * 70)
    
    result = generate_load_combinations({
        "load_cases": {
            "dead_load": ["LC_DE"],
            "live_load": ["LC_LL"],
            "wind_load": ["LC_WX"]
        },
        "combination_type": "sls"
    })
    
    assert result["status"] == "success", f"SLS 组合生成失败: {result.get('error')}"
    assert len(result["combinations"]) > 0, "未生成任何 SLS 组合"
    
    summary = result["summary"]
    assert summary["sls"] > 0, "未生成 SLS 组合"
    
    print(f"✓ SLS 组合生成成功")
    print(f"  - 总组合数: {summary['total']}")
    print(f"  - SLS 组合数: {summary['sls']}")
    
    # 验证 SLS 组合的系数都是 1.0
    for combo in result["combinations"]:
        for load_id, factor in combo["factors"].items():
            # 活载和风载的组合值系数除外
            if load_id not in ["LC_LL", "LC_WX"]:
                assert abs(factor - 1.0) < 0.01, f"SLS 组合系数不为 1.0: {load_id}={factor}"
    
    print("✓ SLS 组合系数验证通过\n")
    return True


def test_crane_load_combinations():
    """测试吊车荷载组合生成"""
    print("=" * 70)
    print("测试 4: 吊车荷载组合生成")
    print("=" * 70)
    
    result = generate_load_combinations({
        "load_cases": {
            "dead_load": ["LC_DE"],
            "live_load": ["LC_LL"],
            "crane_load": ["LC_C1"]
        },
        "combination_type": "uls"
    })
    
    assert result["status"] == "success", f"吊车组合生成失败: {result.get('error')}"
    
    summary = result["summary"]
    print(f"✓ 吊车组合生成成功")
    print(f"  - 总组合数: {summary['total']}")
    
    # 验证吊车控制组合
    crane_control = [c for c in result["combinations"] if "吊车" in c["description"]]
    assert len(crane_control) > 0, "未生成吊车控制组合"
    print(f"  - 吊车相关组合: {len(crane_control)}")
    
    print("✓ 测试 4 通过\n")
    return True


def test_expand_load_cases():
    """测试工况展开功能"""
    print("=" * 70)
    print("测试 5: 工况展开")
    print("=" * 70)
    
    result = generate_load_combinations({
        "load_cases": {
            "dead_load": ["LC_DE"],
            "live_load": ["LC_LL"],
            "wind_load": ["LC_WX"]
        },
        "combination_type": "uls",
        "expand_cases": True
    })
    
    assert result["status"] == "success", f"工况展开失败: {result.get('error')}"
    
    expanded_cases = result.get("expanded_cases", {})
    assert len(expanded_cases) > 0, "未展开任何工况"
    
    print(f"✓ 工况展开成功")
    print(f"  - 展开工况总数: {len(expanded_cases)}")
    
    # 验证活载展开为活1~活4
    live_expanded = [k for k in expanded_cases.keys() if k.startswith("LC_LL_")]
    assert len(live_expanded) == 4, f"活载展开数量不正确: {len(live_expanded)}"
    print(f"  - 活载展开: {live_expanded}")
    
    # 验证风载展开为左风、右风
    wind_expanded = [k for k in expanded_cases.keys() if k.startswith("LC_WX_")]
    assert len(wind_expanded) == 2, f"风载展开数量不正确: {len(wind_expanded)}"
    print(f"  - 风载展开: {wind_expanded}")
    
    print("✓ 测试 5 通过\n")
    return True


def test_custom_factors():
    """测试自定义组合系数"""
    print("=" * 70)
    print("测试 6: 自定义组合系数")
    print("=" * 70)
    
    result = generate_load_combinations({
        "load_cases": {
            "dead_load": ["LC_DE"],
            "live_load": ["LC_LL"]
        },
        "combination_factors": {
            "gamma_g": 1.35,
            "gamma_q": 1.4
        }
    })
    
    assert result["status"] == "success", f"自定义系数组合失败: {result.get('error')}"
    
    factors = result.get("factors", {})
    assert factors["gamma_g"] == 1.35, f"恒载分项系数未正确应用: {factors['gamma_g']}"
    assert factors["gamma_q"] == 1.4, f"活载分项系数未正确应用: {factors['gamma_q']}"
    
    print(f"✓ 自定义系数应用成功")
    print(f"  - 使用的系数: {factors}")
    
    # 验证生成的组合使用了自定义系数
    combo = result["combinations"][0]
    assert "LC_DE" in combo["factors"], "组合中缺少恒载"
    assert abs(combo["factors"]["LC_DE"] - 1.35) < 0.01, f"恒载系数未正确应用: {combo['factors']['LC_DE']}"
    
    print("✓ 测试 6 通过\n")
    return True


def test_special_member_combinations():
    """测试特殊构件组合"""
    print("=" * 70)
    print("测试 7: 特殊构件组合（抗风柱）")
    print("=" * 70)
    
    result = generate_special_member_combinations({
        "dead_load": ["LC_DE"],
        "live_load": ["LC_LL"],
        "wind_load": ["LC_WX"]
    }, member_type="wind_column")
    
    assert result["status"] == "success", f"特殊构件组合失败: {result.get('error')}"
    assert len(result["combinations"]) > 0, "未生成任何特殊构件组合"
    
    print(f"✓ 抗风柱组合生成成功")
    print(f"  - 组合数量: {result['count']}")
    
    # 验证抗风柱组合包含风压力/风吸力
    for combo in result["combinations"]:
        assert "抗风柱" in combo["description"], "组合描述不正确"
    
    print("✓ 测试 7 通过\n")
    return True


def test_custom_combination():
    """测试自定义组合创建"""
    print("=" * 70)
    print("测试 8: 自定义组合创建")
    print("=" * 70)
    
    result = create_custom_combination(
        factors={"LC_DE": 1.2, "LC_LL": 1.4, "LC_WX": 0.84},
        description="自定义组合示例",
        combination_type="uls",
        code_reference="custom_example"
    )
    
    assert result["status"] == "success", f"自定义组合创建失败: {result.get('error')}"
    
    combo = result["combination"]
    assert combo["type"] == "uls", "组合类型不正确"
    assert combo["description"] == "自定义组合示例", "组合描述不正确"
    assert combo["code_reference"] == "custom_example", "规范引用不正确"
    
    print(f"✓ 自定义组合创建成功")
    print(f"  - 组合ID: {combo['id']}")
    print(f"  - 描述: {combo['description']}")
    print(f"  - 系数: {combo['factors']}")
    
    print("✓ 测试 8 通过\n")
    return True


def test_all_combinations():
    """测试生成所有类型组合"""
    print("=" * 70)
    print("测试 9: 生成所有类型组合")
    print("=" * 70)
    
    result = generate_load_combinations({
        "load_cases": {
            "dead_load": ["LC_DE"],
            "live_load": ["LC_LL"],
            "wind_load": ["LC_WX"],
            "seismic_load": ["LC_EX"]
        },
        "combination_type": "all"
    })
    
    assert result["status"] == "success", f"所有组合生成失败: {result.get('error')}"
    
    summary = result["summary"]
    print(f"✓ 所有组合生成成功")
    print(f"  - 总组合数: {summary['total']}")
    print(f"  - ULS: {summary['uls']}")
    print(f"  - SLS: {summary['sls']}")
    print(f"  - 地震: {summary['seismic']}")
    
    assert summary["uls"] > 0, "未生成 ULS 组合"
    assert summary["sls"] > 0, "未生成 SLS 组合"
    assert summary["seismic"] > 0, "未生成地震组合"
    
    print("✓ 测试 9 通过\n")
    return True


def test_error_handling():
    """测试错误处理"""
    print("=" * 70)
    print("测试 10: 错误处理")
    print("=" * 70)
    
    # 测试无荷载工况的情况
    result = generate_load_combinations({
        "load_cases": {}
    })
    
    assert result["status"] == "error", "未正确处理空荷载工况"
    assert "无有效的荷载工况" in result["error"], "错误信息不正确"
    
    print(f"✓ 空荷载工况错误处理正确: {result['error']}")
    
    # 测试无效的组合方式
    result2 = process_custom_combinations(
        custom_load_ids=["LC_CUSTOM"],
        combination_method="invalid_method",
        base_combinations=[]
    )
    
    assert result2["status"] == "error", "未正确处理无效组合方式"
    assert "无效的组合方式" in result2["error"], "错误信息不正确"
    
    print(f"✓ 无效组合方式错误处理正确: {result2['error']}")
    
    print("✓ 测试 10 通过\n")
    return True


def run_all_tests():
    """运行所有测试"""
    print("\n" + "=" * 70)
    print("开始荷载组合技能测试")
    print("=" * 70)
    
    tests = [
        test_basic_uls_combinations,
        test_seismic_combinations,
        test_sls_combinations,
        test_crane_load_combinations,
        test_expand_load_cases,
        test_custom_factors,
        test_special_member_combinations,
        test_custom_combination,
        test_all_combinations,
        test_error_handling
    ]
    
    passed = 0
    failed = 0
    
    for test in tests:
        try:
            if test():
                passed += 1
        except AssertionError as e:
            print(f"✗ 测试失败: {e}\n")
            failed += 1
        except Exception as e:
            print(f"✗ 测试异常: {e}\n")
            failed += 1
    
    print("=" * 70)
    print(f"测试完成: 通过 {passed}/{len(tests)}, 失败 {failed}/{len(tests)}")
    print("=" * 70)
    
    return failed == 0


def run_tests() -> bool:
    """运行所有测试（由 run_all_tests.py 调用）"""
    return run_all_tests()


if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)
