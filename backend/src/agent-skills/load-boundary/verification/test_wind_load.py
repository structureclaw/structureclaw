"""
风荷载生成器测试
Wind Load Generator Tests
验证风荷载生成功能的正确性
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
wind_load_runtime = adapter.import_skill_runtime("wind-load")
WindLoadGenerator = wind_load_runtime.WindLoadGenerator


def create_test_model():
    """创建测试用的结构模型"""
    # 创建材料
    materials = [
        MaterialV2(
            id="M1",
            name="Q345钢",
            E=206000,
            nu=0.3,
            rho=7850,
            category="steel",
            grade="Q345"
        ),
        MaterialV2(
            id="M2",
            name="C30混凝土",
            E=30000,
            nu=0.2,
            rho=2500,
            category="concrete",
            grade="C30"
        )
    ]
    
    # 创建截面
    sections = [
        SectionV2(
            id="S1",
            name="H500x200",
            type="i",
            width=200,
            height=500,
            thickness=10,
            properties={"area": 11000, "iy": 12300, "iz": 680}
        ),
        SectionV2(
            id="S2",
            name="H400x200",
            type="i",
            width=200,
            height=400,
            thickness=8,
            properties={"area": 8400, "iy": 8540, "iz": 475}
        )
    ]
    
    # 创建节点
    nodes = [
        NodeV2(id="N1", x=0.0, y=0.0, z=0.0, story="F1"),
        NodeV2(id="N2", x=6.0, y=0.0, z=0.0, story="F1"),
        NodeV2(id="N3", x=0.0, y=0.0, z=3.6, story="F2"),
        NodeV2(id="N4", x=6.0, y=0.0, z=3.6, story="F2"),
        NodeV2(id="N5", x=0.0, y=0.0, z=7.2, story="F3"),
        NodeV2(id="N6", x=6.0, y=0.0, z=7.2, story="F3"),
    ]
    
    # 创建单元
    elements = [
        ElementV2(
            id="C1", type="column", nodes=["N1", "N3"],
            material="M1", section="S1", story="F1"
        ),
        ElementV2(
            id="C2", type="column", nodes=["N3", "N5"],
            material="M1", section="S1", story="F2"
        ),
        ElementV2(
            id="C3", type="column", nodes=["N2", "N4"],
            material="M1", section="S1", story="F1"
        ),
        ElementV2(
            id="C4", type="column", nodes=["N4", "N6"],
            material="M1", section="S1", story="F2"
        ),
        ElementV2(
            id="B1", type="beam", nodes=["N1", "N2"],
            material="M1", section="S2", story="F1"
        ),
        ElementV2(
            id="B2", type="beam", nodes=["N3", "N4"],
            material="M1", section="S2", story="F2"
        ),
        ElementV2(
            id="B3", type="beam", nodes=["N5", "N6"],
            material="M1", section="S2", story="F3"
        ),
    ]
    
    # 创建楼层
    stories = [
        StoryDef(id="F1", height=3.6, elevation=0.0),
        StoryDef(id="F2", height=3.6, elevation=3.6),
        StoryDef(id="F3", height=3.6, elevation=7.2),
    ]
    
    # 创建模型
    model = StructureModelV2(
        nodes=nodes,
        elements=elements,
        materials=materials,
        sections=sections,
        stories=stories
    )
    
    return model


def test_wind_load_generation():
    """测试风荷载生成"""
    print("\n" + "="*60)
    print("测试1: 风荷载生成")
    print("="*60)
    
    model = create_test_model()
    generator = WindLoadGenerator(model)
    
    # 生成风荷载
    result = generator.generate_wind_loads(
        basic_pressure=0.55,
        terrain_roughness='B',
        shape_factor=1.3,
        wind_direction='x',
        case_id="LC_WX"
    )
    
    # 验证结果
    assert result["load_case"]["id"] == "LC_WX"
    assert result["load_case"]["type"] == "wind"
    assert len(result["load_case"]["loads"]) > 0
    assert len(result["load_actions"]) > 0
    
    print(f"✓ 生成风荷载工况: {result['load_case']['id']}")
    print(f"✓ 荷载数量: {len(result['load_case']['loads'])}")
    print(f"✓ 动作数量: {len(result['load_actions'])}")
    
    # 检查荷载动作格式
    first_load = result["load_actions"][0]
    assert "id" in first_load
    assert "caseId" in first_load
    assert "elementType" in first_load
    assert "elementId" in first_load
    assert "loadType" in first_load
    assert "loadValue" in first_load
    assert "loadDirection" in first_load
    
    print(f"✓ 荷载动作格式正确 (驼峰命名)")
    print("[PASS] 测试1完成\n")


def test_custom_wind_load():
    """测试自定义风荷载"""
    print("="*60)
    print("测试2: 自定义风荷载")
    print("="*60)
    
    model = create_test_model()
    generator = WindLoadGenerator(model)
    
    # 添加自定义风荷载
    load_action = generator.add_custom_wind_load(
        element_id="B1",
        element_type="beam",
        load_value=15.5,
        wind_direction="x",
        case_id="LC_WX"
    )
    
    # 验证结果
    assert load_action["id"] == "LA_B1_W"
    assert load_action["caseId"] == "LC_WX"
    assert load_action["elementType"] == "beam"
    assert load_action["elementId"] == "B1"
    assert load_action["loadValue"] == 15.5
    assert load_action["loadDirection"] == {"x": 1.0, "y": 0.0, "z": 0.0}
    
    print(f"✓ 添加自定义风荷载: {load_action['id']}")
    print(f"✓ 荷载值: {load_action['loadValue']} kN/m")
    print(f"✓ 风向: x")
    print("[PASS] 测试2完成\n")


def test_invalid_wind_direction():
    """测试无效风向"""
    print("="*60)
    print("测试3: 无效风向验证")
    print("="*60)
    
    model = create_test_model()
    generator = WindLoadGenerator(model)
    
    # 测试无效风向
    try:
        generator.add_custom_wind_load(
            element_id="B1",
            element_type="beam",
            load_value=10.0,
            wind_direction="invalid",
            case_id="LC_WX"
        )
        print("✗ 应该抛出 ValueError")
        assert False, "应该抛出 ValueError"
    except ValueError as e:
        print(f"✓ 正确抛出异常: {e}")
        print("[PASS] 测试3完成\n")


def test_invalid_load_value():
    """测试无效荷载值"""
    print("="*60)
    print("测试4: 无效荷载值验证")
    print("="*60)
    
    model = create_test_model()
    generator = WindLoadGenerator(model)
    
    # 测试负值
    try:
        generator.add_custom_wind_load(
            element_id="B1",
            element_type="beam",
            load_value=-10.0,
            wind_direction="x",
            case_id="LC_WX"
        )
        print("✗ 应该抛出 ValueError")
        assert False, "应该抛出 ValueError"
    except ValueError as e:
        print(f"✓ 正确抛出异常: {e}")
    
    # 测试过大值
    try:
        generator.add_custom_wind_load(
            element_id="B1",
            element_type="beam",
            load_value=2000.0,
            wind_direction="x",
            case_id="LC_WX"
        )
        print("✗ 应该抛出 ValueError")
        assert False, "应该抛出 ValueError"
    except ValueError as e:
        print(f"✓ 正确抛出异常: {e}")
    
    print("[PASS] 测试4完成\n")


def test_terrain_roughness():
    """测试地面粗糙度"""
    print("="*60)
    print("测试5: 地面粗糙度")
    print("="*60)
    
    model = create_test_model()
    generator = WindLoadGenerator(model)
    
    # 测试不同的地面粗糙度
    for roughness in ['A', 'B', 'C', 'D']:
        result = generator.generate_wind_loads(
            basic_pressure=0.55,
            terrain_roughness=roughness,
            shape_factor=1.3,
            wind_direction='x',
            case_id=f"LC_W_{roughness}"
        )
        
        assert result["load_case"]["type"] == "wind"
        print(f"✓ 地面粗糙度 {roughness}: 生成 {len(result['load_case']['loads'])} 个荷载")
    
    print("[PASS] 测试5完成\n")


def test_height_factor():
    """测试高度变化系数"""
    print("="*60)
    print("测试6: 高度变化系数计算")
    print("="*60)
    
    model = create_test_model()
    generator = WindLoadGenerator(model)
    
    # 测试不同楼层的风压
    result = generator.generate_wind_loads(
        basic_pressure=0.55,
        terrain_roughness='B',
        shape_factor=1.3,
        wind_direction='x',
        case_id="LC_WX"
    )
    
    # 获取不同楼层的风荷载
    for load in result["load_case"]["loads"]:
        if "kN/m" in load.get("description", ""):
            print(f"  {load['description']}")
    
    assert len(result["load_case"]["loads"]) > 0
    print(f"✓ 总共生成 {len(result['load_case']['loads'])} 个风荷载")
    print("[PASS] 测试6完成\n")


def test_wind_directions():
    """测试不同风向"""
    print("="*60)
    print("测试7: 不同风向")
    print("="*60)
    
    model = create_test_model()
    generator = WindLoadGenerator(model)
    
    directions = ['x', '-x', 'y', '-y']
    for direction in directions:
        result = generator.generate_wind_loads(
            basic_pressure=0.55,
            terrain_roughness='B',
            shape_factor=1.3,
            wind_direction=direction,
            case_id=f"LC_W{direction}"
        )
        
        print(f"✓ 风向 {direction}: 生成 {len(result['load_case']['loads'])} 个荷载")
    
    print("[PASS] 测试7完成\n")


def run_all_tests():
    """运行所有测试"""
    print("\n" + "="*60)
    print("Wind Load Tests - 风荷载测试套件")
    print("="*60)
    
    tests = [
        test_wind_load_generation,
        test_custom_wind_load,
        test_invalid_wind_direction,
        test_invalid_load_value,
        test_terrain_roughness,
        test_height_factor,
        test_wind_directions,
    ]
    
    passed = 0
    failed = 0
    
    for test in tests:
        try:
            test()
            passed += 1
        except Exception as e:
            print(f"[FAIL] {test.__name__}: {e}\n")
            failed += 1
    
    print("="*60)
    print(f"测试结果: {passed} 通过, {failed} 失败")
    print("="*60)
    
    return failed == 0


if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)
