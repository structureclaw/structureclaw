"""
地震荷载技能单元测试 / Seismic Load Skill Unit Tests

测试底部剪力计算、力分配、参数验证等功能
Tests base shear calculation, force distribution, parameter validation
"""

import unittest
from unittest.mock import Mock, MagicMock

from seismic_load import (
    generate_seismic_loads,
    SeismicLoadGenerator,
    WeightCalculationMethod,
    ForceDistributeMethod
)
from seismic_load.base_shear_calculator import BaseShearCalculator
from seismic_load.force_distributor import ForceDistributor
from seismic_load.utils import (
    validate_seismic_parameters,
    format_seismic_result,
    calculate_seismic_coefficient
)


class TestValidateParameters(unittest.TestCase):
    """参数验证测试 / Parameter Validation Tests"""

    def test_valid_parameters(self):
        """测试有效参数"""
        is_valid, errors = validate_seismic_parameters(
            intensity=7.0,
            site_category="II",
            design_group="第二组",
            damping_ratio=0.05,
            live_load_factor=0.5
        )
        self.assertTrue(is_valid)
        self.assertEqual(len(errors), 0)

    def test_invalid_intensity(self):
        """测试无效烈度"""
        is_valid, errors = validate_seismic_parameters(
            intensity=10.0,
            site_category="II",
            design_group="第二组",
            damping_ratio=0.05,
            live_load_factor=0.5
        )
        self.assertFalse(is_valid)
        self.assertGreater(len(errors), 0)

    def test_invalid_site_category(self):
        """测试无效场地类别"""
        is_valid, errors = validate_seismic_parameters(
            intensity=7.0,
            site_category="V",
            design_group="第二组",
            damping_ratio=0.05,
            live_load_factor=0.5
        )
        self.assertFalse(is_valid)

    def test_invalid_damping_ratio(self):
        """测试无效阻尼比"""
        is_valid, errors = validate_seismic_parameters(
            intensity=7.0,
            site_category="II",
            design_group="第二组",
            damping_ratio=0.3,
            live_load_factor=0.5
        )
        self.assertFalse(is_valid)

    def test_invalid_live_load_factor(self):
        """测试无效活载系数"""
        is_valid, errors = validate_seismic_parameters(
            intensity=7.0,
            site_category="II",
            design_group="第二组",
            damping_ratio=0.05,
            live_load_factor=1.5
        )
        self.assertFalse(is_valid)


class TestSeismicCoefficient(unittest.TestCase):
    """地震影响系数测试 / Seismic Influence Coefficient Tests"""

    def test_alpha_max_7_degree(self):
        """测试7度地震影响系数最大值"""
        alpha = calculate_seismic_coefficient(intensity=7.0, site_category="II", design_group="第二组")
        self.assertAlmostEqual(alpha, 0.08, places=4)

    def test_alpha_max_8_degree(self):
        """测试8度地震影响系数最大值"""
        alpha = calculate_seismic_coefficient(intensity=8.0, site_category="II", design_group="第二组")
        self.assertAlmostEqual(alpha, 0.16, places=4)

    def test_alpha_max_6_degree(self):
        """测试6度地震影响系数最大值"""
        alpha = calculate_seismic_coefficient(intensity=6.0, site_category="II", design_group="第二组")
        self.assertAlmostEqual(alpha, 0.04, places=4)


class TestBaseShearCalculator(unittest.TestCase):
    """底部剪力计算器测试 / Base Shear Calculator Tests"""

    def setUp(self):
        """设置测试模型"""
        self.mock_model = Mock()
        self.mock_model.metadata = {}
        self.mock_model.stories = []
        self.mock_model.elements = []

    def test_damping_adjustment(self):
        """测试阻尼调整系数"""
        # 使用 FROM_ELEMENTS 方法需要 mock 模型数据
        mock_model = Mock()
        mock_model.elements = []
        mock_model.stories = []
        mock_model.metadata = {}

        calculator = BaseShearCalculator(
            mock_model,
            weight_calculation_method=WeightCalculationMethod.FROM_ELEMENTS
        )

        # 为测试目的,直接在 calculator 中设置缓存重量
        calculator._weight_cache = 10000.0

        # 阻尼比 0.02
        result1 = calculator.calculate_base_shear(
            intensity=7.0,
            site_category="II",
            design_group="第二组",
            damping_ratio=0.02
        )

        # 阻尼比 0.05
        result2 = calculator.calculate_base_shear(
            intensity=7.0,
            site_category="II",
            design_group="第二组",
            damping_ratio=0.05
        )

        # 阻尼比越小，地震力越大
        self.assertGreater(result1["base_shear"], result2["base_shear"])

    def test_auto_method_selection(self):
        """测试自动方法选择"""
        calculator = BaseShearCalculator(
            self.mock_model,
            weight_calculation_method=WeightCalculationMethod.AUTO
        )

        result = calculator.calculate_base_shear(
            intensity=7.0,
            site_category="II",
            design_group="第二组",
            damping_ratio=0.05
        )

        self.assertIn("weight_calculation_method", result)
        self.assertIn("base_shear", result)


class TestForceDistributor(unittest.TestCase):
    """地震力分配器测试 / Force Distributor Tests"""

    def setUp(self):
        """设置测试模型"""
        self.mock_model = Mock()
        self.mock_model.nodes = []

        # 创建模拟构件
        self.mock_elements = []
        for i in range(3):
            elem = Mock()
            elem.id = f"E{i+1}"
            elem.type = "column"
            elem.nodes = [f"N{i*2+1}", f"N{i*2+2}"]
            elem.section = "S{i+1}"
            elem.material = "M{i+1}"
            elem.extra = {"stiffness_x": 1000.0 * (i+1)}
            elem.metadata = {}
            self.mock_elements.append(elem)

    def test_evenly_distribution(self):
        """测试平均分配"""
        distributor = ForceDistributor(
            self.mock_model,
            distribute_method=ForceDistributeMethod.EVENLY
        )

        result = distributor.distribute_force_to_floor(
            floor_elements=self.mock_elements,
            total_force=30.0,
            direction="x"
        )

        self.assertEqual(len(result), 3)
        for elem_id, force_data in result.items():
            self.assertAlmostEqual(force_data["force"], 10.0, places=2)

    def test_stiffness_distribution(self):
        """测试按刚度分配"""
        distributor = ForceDistributor(
            self.mock_model,
            distribute_method=ForceDistributeMethod.BY_STIFFNESS
        )

        result = distributor.distribute_force_to_floor(
            floor_elements=self.mock_elements,
            total_force=60.0,
            direction="x"
        )

        self.assertEqual(len(result), 3)
        # 刚度比例 1:2:3，总力60 -> 10:20:30
        self.assertAlmostEqual(result["E1"]["force"], 10.0, places=2)
        self.assertAlmostEqual(result["E2"]["force"], 20.0, places=2)
        self.assertAlmostEqual(result["E3"]["force"], 30.0, places=2)

    def test_zero_total_force(self):
        """测试总力为0的情况"""
        distributor = ForceDistributor(
            self.mock_model,
            distribute_method=ForceDistributeMethod.EVENLY
        )

        result = distributor.distribute_force_to_floor(
            floor_elements=self.mock_elements,
            total_force=0.0,
            direction="x"
        )

        for elem_id, force_data in result.items():
            self.assertAlmostEqual(force_data["force"], 0.0, places=2)

    def test_direction_vector(self):
        """测试方向向量"""
        distributor = ForceDistributor(
            self.mock_model,
            distribute_method=ForceDistributeMethod.EVENLY
        )

        result_x = distributor.distribute_force_to_floor(
            floor_elements=self.mock_elements,
            total_force=10.0,
            direction="x"
        )

        self.assertEqual(result_x["E1"]["direction"]["x"], 1.0)
        self.assertEqual(result_x["E1"]["direction"]["y"], 0.0)
        self.assertEqual(result_x["E1"]["direction"]["z"], 0.0)

        result_y = distributor.distribute_force_to_floor(
            floor_elements=self.mock_elements,
            total_force=10.0,
            direction="y"
        )

        self.assertEqual(result_y["E1"]["direction"]["x"], 0.0)
        self.assertEqual(result_y["E1"]["direction"]["y"], 1.0)
        self.assertEqual(result_y["E1"]["direction"]["z"], 0.0)


class TestFormatResult(unittest.TestCase):
    """结果格式化测试 / Result Formatting Tests"""

    def test_format_chinese(self):
        """测试中文格式化"""
        result = {
            "status": "success",
            "summary": {
                "case_id": "LC_E",
                "intensity": 7.0,
                "site_category": "II",
                "design_group": "第二组",
                "seismic_direction": "x",
                "weight_calculation_method": "from_elements",
                "force_distribute_method": "by_stiffness",
                "live_load_factor": 0.5,
                "case_count": 1,
                "action_count": 10
            },
            "calculation_details": {
                "base_shear": 640.0,
                "total_weight": 8000.0,
                "alpha_max": 0.08,
                "story_forces": [100.0, 200.0, 340.0]
            }
        }

        formatted = format_seismic_result(result, language='zh')
        self.assertIn("地震荷载生成完成", formatted)
        self.assertIn("7.0", formatted)
        self.assertIn("640.00 kN", formatted)

    def test_format_english(self):
        """测试英文格式化"""
        result = {
            "status": "success",
            "summary": {
                "case_id": "LC_E",
                "intensity": 7.0,
                "site_category": "II",
                "design_group": "第二组",
                "seismic_direction": "x",
                "weight_calculation_method": "from_elements",
                "force_distribute_method": "by_stiffness",
                "live_load_factor": 0.5,
                "case_count": 1,
                "action_count": 10
            },
            "calculation_details": {
                "base_shear": 640.0,
                "total_weight": 8000.0,
                "alpha_max": 0.08,
                "story_forces": [100.0, 200.0, 340.0]
            }
        }

        formatted = format_seismic_result(result, language='en')
        self.assertIn("Seismic Load Generation Completed", formatted)
        self.assertIn("7.0", formatted)
        self.assertIn("640.00 kN", formatted)


class TestIntegration(unittest.TestCase):
    """集成测试 / Integration Tests"""

    def setUp(self):
        """设置测试模型"""
        self.mock_model = Mock()
        self.mock_model.nodes = []
        self.mock_model.materials = []
        self.mock_model.sections = []
        self.mock_model.elements = []
        self.mock_model.stories = []
        self.mock_model.metadata = {}
        self.mock_model.load_cases = []

    def test_generate_with_auto_methods(self):
        """测试使用自动方法生成地震荷载"""
        parameters = {
            "intensity": 7.0,
            "site_category": "II",
            "design_group": "第二组",
            "seismic_direction": "x"
        }

        result = generate_seismic_loads(self.mock_model, parameters)

        # 由于模型为空，应使用默认值
        self.assertIn("status", result)
        self.assertIn("summary", result)

    def test_generate_with_custom_methods(self):
        """测试使用自定义方法生成地震荷载"""
        parameters = {
            "intensity": 7.5,
            "site_category": "III",
            "design_group": "第三组",
            "damping_ratio": 0.04,
            "seismic_direction": "y",
            "weight_calculation_method": "auto",
            "force_distribute_method": "evenly",
            "live_load_factor": 0.5
        }

        result = generate_seismic_loads(self.mock_model, parameters)

        self.assertIn("status", result)
        self.assertIn("calculation_details", result)


def run_tests():
    """运行所有测试"""
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()

    # 添加所有测试类
    suite.addTests(loader.loadTestsFromTestCase(TestValidateParameters))
    suite.addTests(loader.loadTestsFromTestCase(TestSeismicCoefficient))
    suite.addTests(loader.loadTestsFromTestCase(TestBaseShearCalculator))
    suite.addTests(loader.loadTestsFromTestCase(TestForceDistributor))
    suite.addTests(loader.loadTestsFromTestCase(TestFormatResult))
    suite.addTests(loader.loadTestsFromTestCase(TestIntegration))

    # 运行测试
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)

    return result


if __name__ == "__main__":
    result = run_tests()

    # 退出码
    exit(0 if result.wasSuccessful() else 1)
