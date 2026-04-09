"""
活载测试 / Live Load Tests

测试活载生成器的功能，包括：
- 楼面荷载生成
- 自定义活载
- 参数验证
- 输出模式
"""

import unittest
from typing import Dict, Any
import sys
from pathlib import Path

# 添加父目录到路径
current_dir = Path(__file__).parent
load_boundary_dir = current_dir.parent
sys.path.insert(0, str(load_boundary_dir))


# 模拟类
class MockNode:
    def __init__(self, node_id: str, x: float = 0.0, y: float = 0.0, z: float = 0.0):
        self.id = node_id
        self.x = x
        self.y = y
        self.z = z


class MockElement:
    def __init__(
        self,
        elem_id: str,
        elem_type: str,
        node_ids: list,
        material: str = None,
        section: str = None,
        story: str = None
    ):
        self.id = elem_id
        self.type = elem_type
        self.nodes = node_ids
        self.material = material
        self.section = section
        self.story = story


class MockSection:
    def __init__(self, section_id: str, section_type: str = "rectangular"):
        self.id = section_id
        self.type = section_type


class MockFloorLoad:
    def __init__(self, load_type: str, value: float):
        self.type = load_type
        self.value = value


class MockStory:
    def __init__(self, story_id: str, floor_loads: list = None):
        self.id = story_id
        self.floor_loads = floor_loads or []


class MockModel:
    def __init__(self):
        self.nodes = []
        self.elements = []
        self.sections = []
        self.stories = []


def create_test_model() -> MockModel:
    """创建测试模型"""
    model = MockModel()

    # 创建节点
    model.nodes = [
        MockNode("N1", 0.0, 0.0, 0.0),
        MockNode("N2", 3.0, 0.0, 0.0),
        MockNode("N3", 0.0, 3.0, 0.0),
        MockNode("N4", 3.0, 3.0, 0.0),
    ]

    # 创建构件
    model.elements = [
        MockElement("B1", "beam", ["N1", "N2"], "MAT1", "SEC1", "F1"),
        MockElement("B2", "beam", ["N3", "N4"], "MAT1", "SEC1", "F1"),
        MockElement("S1", "slab", ["N1", "N2", "N3", "N4"], "MAT1", "SEC1", "F1"),
    ]

    # 创建截面
    model.sections = [
        MockSection("SEC1", "rectangular"),
    ]

    # 创建楼层
    model.stories = [
        MockStory("F1", []),
    ]

    return model


def create_test_model_with_floor_loads() -> MockModel:
    """创建包含楼面荷载的测试模型"""
    model = create_test_model()

    # 添加楼面荷载
    model.stories[0].floor_loads = [
        MockFloorLoad("live", 3.5),  # 自定义活载
    ]

    return model


class TestLiveLoadGenerator(unittest.TestCase):
    """活载生成器测试"""

    def setUp(self):
        """设置测试"""
        self.model = create_test_model()
        from live_load.runtime import LiveLoadGenerator
        self.generator = LiveLoadGenerator(self.model, output_mode="linear")

    def test_generate_floor_live_loads_office(self):
        """测试生成办公活载"""
        result = self.generator.generate_floor_live_loads(
            floor_load_type="office",
            case_id="LC_LL"
        )

        self.assertEqual(result["status"], "success")
        self.assertEqual(result["load_case"]["id"], "LC_LL")
        self.assertEqual(result["load_case"]["type"], "live")
        self.assertGreater(len(result["load_case"]["loads"]), 0)

    def test_generate_floor_live_loads_residential(self):
        """测试生成住宅活载"""
        result = self.generator.generate_floor_live_loads(
            floor_load_type="residential",
            case_id="LC_LL"
        )

        self.assertEqual(result["status"], "success")
        self.assertGreater(len(result["load_case"]["loads"]), 0)

    def test_generate_floor_live_loads_classroom(self):
        """测试生成教室活载"""
        result = self.generator.generate_floor_live_loads(
            floor_load_type="classroom",
            case_id="LC_LL"
        )

        self.assertEqual(result["status"], "success")
        self.assertGreater(len(result["load_case"]["loads"]), 0)

    def test_generate_floor_live_loads_from_model(self):
        """测试从模型读取活载"""
        model = create_test_model_with_floor_loads()
        from live_load.runtime import LiveLoadGenerator

        generator = LiveLoadGenerator(model, output_mode="linear")
        result = generator.generate_floor_live_loads(
            floor_load_type="office",
            case_id="LC_LL"
        )

        self.assertEqual(result["status"], "success")

        # 验证使用模型中的荷载值（3.5 kN/m²）
        load_action = result["load_case"]["loads"][0]
        area_load = load_action["extra"]["area_load"]
        self.assertEqual(area_load, 3.5)

    def test_generate_floor_live_loads_invalid_type(self):
        """测试无效的楼面荷载类型"""
        with self.assertRaises(ValueError):
            self.generator.generate_floor_live_loads(
                floor_load_type="invalid_type",
                case_id="LC_LL"
            )

    def test_add_custom_live_load(self):
        """测试添加自定义活载"""
        result = self.generator.add_custom_live_load(
            element_id="B1",
            element_type="beam",
            load_value=5.5,
            case_id="LC_LL"
        )

        self.assertEqual(result["actionId"], "LA_B1_LL")
        self.assertEqual(result["loadValue"], 5.5)
        self.assertEqual(result["caseId"], "LC_LL")

    def test_add_custom_live_load_with_direction(self):
        """测试添加带方向的活载"""
        result = self.generator.add_custom_live_load(
            element_id="B1",
            element_type="beam",
            load_value=3.5,
            load_direction={"x": 0.0, "y": -1.0, "z": 0.0},
            case_id="LC_LL"
        )

        self.assertEqual(result["loadDirection"], {"x": 0.0, "y": -1.0, "z": 0.0})

    def test_output_mode_linear(self):
        """测试线荷载输出模式"""
        generator = self.generator  # linear 模式
        result = generator.generate_floor_live_loads(
            floor_load_type="office",
            case_id="LC_LL"
        )

        # 验证输出为线荷载
        load_action = result["load_case"]["loads"][0]
        self.assertEqual(load_action["extra"]["load_mode"], "linear")
        self.assertEqual(load_action["extra"]["load_unit"], "kN/m")

    def test_output_mode_area(self):
        """测试面荷载输出模式"""
        from live_load.runtime import LiveLoadGenerator

        generator = LiveLoadGenerator(self.model, output_mode="area")
        result = generator.generate_floor_live_loads(
            floor_load_type="office",
            case_id="LC_LL"
        )

        # 验证输出为面荷载
        load_action = result["load_case"]["loads"][0]
        self.assertEqual(load_action["extra"]["load_mode"], "area")
        self.assertEqual(load_action["extra"]["load_unit"], "kN/m²")

    def test_output_mode_invalid(self):
        """测试无效的输出模式"""
        with self.assertRaises(ValueError):
            from live_load.runtime import LiveLoadGenerator
            LiveLoadGenerator(self.model, output_mode="invalid")

    def test_get_load_cases(self):
        """测试获取荷载工况"""
        self.generator.generate_floor_live_loads(floor_load_type="office")
        load_cases = self.generator.get_load_cases()

        self.assertIn("LC_LL", load_cases)
        self.assertEqual(load_cases["LC_LL"]["type"], "live")

    def test_get_load_actions(self):
        """测试获取荷载动作"""
        self.generator.generate_floor_live_loads(floor_load_type="office")
        load_actions = self.generator.get_load_actions()

        self.assertGreater(len(load_actions), 0)

    def test_edge_case_empty_model(self):
        """测试空模型"""
        empty_model = MockModel()
        from live_load.runtime import LiveLoadGenerator

        generator = LiveLoadGenerator(empty_model)
        result = generator.generate_floor_live_loads(
            floor_load_type="office",
            case_id="LC_LL"
        )

        # 应该成功，但没有荷载动作
        self.assertEqual(result["status"], "success")
        self.assertEqual(len(result["load_case"]["loads"]), 0)


class TestLiveLoadConstants(unittest.TestCase):
    """活载常量测试"""

    def test_get_standard_live_load(self):
        """测试获取标准活载"""
        from live_load.constants import (
            get_standard_live_load,
            STANDARD_LIVE_LOADS
        )

        self.assertEqual(get_standard_live_load("office"), 2.0)
        self.assertEqual(get_standard_live_load("classroom"), 2.5)
        self.assertEqual(get_standard_live_load("equipment"), 5.0)

    def test_get_standard_live_load_invalid(self):
        """测试无效的楼面荷载类型"""
        from live_load.constants import get_standard_live_load

        with self.assertRaises(ValueError):
            get_standard_live_load("invalid")

    def test_validate_floor_load_type(self):
        """测试验证楼面荷载类型"""
        from live_load.constants import (
            validate_floor_load_type,
            STANDARD_LIVE_LOADS
        )

        # 有效类型
        self.assertTrue(validate_floor_load_type("office"))
        self.assertTrue(validate_floor_load_type("classroom"))
        self.assertTrue(validate_floor_load_type("equipment"))

    def test_validate_floor_load_type_invalid(self):
        """测试无效的楼面荷载类型"""
        from live_load.constants import validate_floor_load_type

        with self.assertRaises(ValueError):
            validate_floor_load_type("invalid")

    def test_validate_live_load_value(self):
        """测试验证活载值"""
        from live_load.constants import (
            validate_live_load_value,
            MIN_LIVE_LOAD,
            MAX_LIVE_LOAD
        )

        # 有效值
        self.assertTrue(validate_live_load_value(2.0))
        self.assertTrue(validate_live_load_value(5.0))
        self.assertTrue(validate_live_load_value(10.0))

        # 边界值
        self.assertTrue(validate_live_load_value(MIN_LIVE_LOAD))
        self.assertTrue(validate_live_load_value(MAX_LIVE_LOAD))

    def test_validate_live_load_value_negative(self):
        """测试负数活载值"""
        from live_load.constants import validate_live_load_value

        with self.assertRaises(ValueError):
            validate_live_load_value(-1.0)

    def test_validate_live_load_value_too_large(self):
        """测试过大的活载值"""
        from live_load.constants import (
            validate_live_load_value,
            MAX_LIVE_LOAD
        )

        with self.assertRaises(ValueError):
            validate_live_load_value(MAX_LIVE_LOAD + 1.0)

    def test_validate_live_load_value_wrong_type(self):
        """测试错误类型的活载值"""
        from live_load.constants import validate_live_load_value

        with self.assertRaises(TypeError):
            validate_live_load_value("not_a_number")

    def test_get_default_tributary_width(self):
        """测试获取默认受荷宽度"""
        from live_load.constants import (
            get_default_tributary_width,
            ElementType
        )

        # 梁
        width_beam = get_default_tributary_width(ElementType.BEAM)
        self.assertEqual(width_beam, 3.0)  # 3000mm / 1000

        # 板
        width_slab = get_default_tributary_width(ElementType.SLAB)
        self.assertEqual(width_slab, 1.0)  # 1000mm / 1000


class TestLiveLoadIntegration(unittest.TestCase):
    """活载集成测试"""

    def test_full_workflow(self):
        """测试完整工作流程"""
        model = create_test_model()
        from live_load.runtime import LiveLoadGenerator

        generator = LiveLoadGenerator(model, output_mode="linear")

        # 生成楼面活载
        result = generator.generate_floor_live_loads(
            floor_load_type="office",
            case_id="LC_LL"
        )

        # 验证结果
        self.assertEqual(result["status"], "success")
        self.assertGreater(len(result["load_case"]["loads"]), 0)

        # 添加自定义活载
        generator.add_custom_live_load(
            element_id="B1",
            element_type="beam",
            load_value=5.5,
            case_id="LC_LL"
        )

        # 验证荷载动作数量增加
        load_actions = generator.get_load_actions()
        self.assertGreater(len(load_actions), 1)

    def test_multiple_floor_types(self):
        """测试多种楼面类型"""
        model = create_test_model()
        from live_load.runtime import LiveLoadGenerator

        generator = LiveLoadGenerator(model, output_mode="linear")

        # 测试各种楼面类型
        floor_types = [
            "residential",
            "office",
            "classroom",
            "corridor",
            "stair",
            "equipment",
            "storage"
        ]

        for floor_type in floor_types:
            result = generator.generate_floor_live_loads(
                floor_load_type=floor_type,
                case_id=f"LC_LL_{floor_type}"
            )

            self.assertEqual(result["status"], "success")
            self.assertGreater(len(result["load_case"]["loads"]), 0)


def run_tests():
    """运行所有测试"""
    # 创建测试套件
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()

    # 添加测试
    suite.addTests(loader.loadTestsFromTestCase(TestLiveLoadGenerator))
    suite.addTests(loader.loadTestsFromTestCase(TestLiveLoadConstants))
    suite.addTests(loader.loadTestsFromTestCase(TestLiveLoadIntegration))

    # 运行测试
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)

    # 返回结果
    return result.wasSuccessful()


if __name__ == "__main__":
    success = run_tests()
    sys.exit(0 if success else 1)
