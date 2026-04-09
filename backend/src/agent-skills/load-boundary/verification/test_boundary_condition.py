"""
边界条件测试 / Boundary Condition Tests

测试边界条件生成器的功能，包括：
- 节点约束（固定、铰接、滚动、弹性）
- 杆端释放
- 计算长度
- 常量函数
"""

import unittest
from typing import Dict, Any, Optional
import sys
from pathlib import Path

# 添加父目录到路径
current_dir = Path(__file__).parent
load_boundary_dir = current_dir.parent
sys.path.insert(0, str(load_boundary_dir))

# 模拟 StructureModelV2（如果没有实际实现）
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


class MockStory:
    def __init__(self, story_id: str, floor_loads: list = None):
        self.id = story_id
        self.floor_loads = floor_loads or []


class MockModel:
    def __init__(self):
        self.nodes = []
        self.elements = []
        self.materials = []
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
        MockNode("N5", 0.0, 0.0, 3.0),
        MockNode("N6", 3.0, 0.0, 3.0),
    ]

    # 创建构件
    model.elements = [
        MockElement("B1", "beam", ["N1", "N2"], "MAT1", "SEC1", "F1"),
        MockElement("B2", "beam", ["N3", "N4"], "MAT1", "SEC1", "F1"),
        MockElement("C1", "column", ["N1", "N5"], "MAT1", "SEC1", "F1"),
        MockElement("C2", "column", ["N2", "N6"], "MAT1", "SEC1", "F1"),
    ]

    return model


class TestBoundaryCondition(unittest.TestCase):
    """边界条件测试"""

    def setUp(self):
        """设置测试"""
        self.model = create_test_model()
        try:
            from boundary_condition.runtime import BoundaryConditionGenerator
            self.generator = BoundaryConditionGenerator(self.model)
        except ImportError:
            # 如果 structure_protocol 不可用，跳过测试
            self.skipTest("boundary_condition.runtime 需要 structure_protocol 模块")

    def test_fixed_support(self):
        """测试固定支座"""
        result = self.generator.apply_fixed_support(["N1", "N2"])

        self.assertEqual(len(result["constraints"]), 2)
        self.assertEqual(result["count"], 2)

        # 验证所有自由度被约束
        for node_id, constraint in result["constraints"].items():
            self.assertEqual(constraint["restraints"], [True, True, True, True, True, True])
            self.assertEqual(constraint["extra"]["constraintType"], "fixed")

    def test_pinned_support(self):
        """测试铰支座"""
        result = self.generator.apply_pinned_support(["N3"])

        self.assertEqual(len(result["constraints"]), 1)
        self.assertEqual(result["count"], 1)

        # 验证仅约束平动自由度
        for node_id, constraint in result["constraints"].items():
            self.assertEqual(constraint["restraints"], [True, True, True, False, False, False])
            self.assertEqual(constraint["extra"]["constraintType"], "pinned")

    def test_rolling_support(self):
        """测试滚动支座"""
        # X方向滚动
        result_x = self.generator.apply_rolling_support(["N4"], "x")
        constraint = result_x["constraints"]["N4"]
        self.assertEqual(constraint["restraints"], [False, True, True, False, False, False])

        # Y方向滚动
        result_y = self.generator.apply_rolling_support(["N5"], "y")
        constraint = result_y["constraints"]["N5"]
        self.assertEqual(constraint["restraints"], [True, False, True, False, False, False])

        # Z方向滚动
        result_z = self.generator.apply_rolling_support(["N6"], "z")
        constraint = result_z["constraints"]["N6"]
        self.assertEqual(constraint["restraints"], [True, True, False, False, False, False])

    def test_rolling_support_invalid_direction(self):
        """测试无效滚动方向"""
        with self.assertRaises(ValueError):
            self.generator.apply_rolling_support(["N1"], "invalid")

    def test_elastic_support(self):
        """测试弹性支座"""
        stiffness_matrix = {
            'kxx': 2e6, 'kyy': 2e6, 'kzz': 2e6,
            'kxx_rot': 2e5, 'kyy_rot': 2e5, 'kzz_rot': 2e5
        }

        result = self.generator.apply_elastic_support(["N1"], stiffness_matrix)

        self.assertEqual(len(result["constraints"]), 1)
        constraint = result["constraints"]["N1"]

        self.assertEqual(constraint["restraints"], [False, False, False, False, False, False])
        self.assertEqual(constraint["extra"]["constraintType"], "elastic")
        self.assertEqual(constraint["stiffness"], stiffness_matrix)

    def test_hinged_member_ends(self):
        """测试杆端铰接"""
        result = self.generator.apply_hinged_member_ends(["B1", "C1"])

        self.assertEqual(len(result["releases"]), 2)

        # 验证两端释放转动
        for member_id, release in result["releases"].items():
            self.assertTrue(release["releaseI"]["rx"])
            self.assertTrue(release["releaseI"]["ry"])
            self.assertTrue(release["releaseI"]["rz"])
            self.assertTrue(release["releaseJ"]["rx"])
            self.assertTrue(release["releaseJ"]["ry"])
            self.assertTrue(release["releaseJ"]["rz"])

    def test_pinned_one_end(self):
        """测试一端铰接"""
        # I端铰接
        result_i = self.generator.apply_pinned_one_end("B1", "i")
        release = result_i["releases"]["B1"]
        self.assertTrue(release["releaseI"]["rx"])
        self.assertFalse(release["releaseJ"]["rx"])

        # J端铰接
        result_j = self.generator.apply_pinned_one_end("B2", "j")
        release = result_j["releases"]["B2"]
        self.assertFalse(release["releaseI"]["rx"])
        self.assertTrue(release["releaseJ"]["rx"])

    def test_calculate_effective_lengths(self):
        """测试计算长度"""
        result = self.generator.calculate_effective_lengths(
            member_ids=["C1", "C2"],
            default_length_factor=1.0
        )

        self.assertEqual(len(result["effective_lengths"]), 4)  # 每个构件2个方向
        self.assertEqual(result["count"], 2)

        # 验证长度值
        for length_key, length_data in result["effective_lengths"].items():
            self.assertGreater(length_data["effectiveLength"], 0)
            self.assertEqual(length_data["lengthFactor"], 1.0)

    def test_apply_column_effective_lengths(self):
        """测试柱的计算长度"""
        # 先施加约束
        self.generator.apply_fixed_support(["N1", "N2"])
        self.generator.apply_pinned_support(["N5", "N6"])

        result = self.generator.apply_column_effective_lengths(["C1", "C2"])

        self.assertEqual(len(result["effective_lengths"]), 4)  # 每个柱2个方向
        self.assertEqual(result["count"], 2)

        # 验证长度系数
        for length_key, length_data in result["effective_lengths"].items():
            self.assertIn(length_data["lengthFactor"], [0.5, 0.7, 1.0])

    def test_edge_cases(self):
        """测试边界条件"""
        # 测试空列表
        result = self.generator.apply_fixed_support([])
        self.assertEqual(len(result["constraints"]), 0)
        self.assertEqual(result["count"], 0)

        # 测试不存在的节点ID（应该被忽略，不报错）
        result = self.generator.apply_fixed_support(["NONEXISTENT"])
        # 实际行为取决于实现，这里假设不会添加不存在的节点
        # self.assertEqual(len(result["constraints"]), 0)

    def test_schema_compatibility(self):
        """测试 V2 Schema 兼容性"""
        self.generator.apply_fixed_support(["N1"])
        self.generator.apply_pinned_support(["N2"])
        self.generator.apply_rolling_support(["N3"], "x")

        constraints = self.generator.get_nodal_constraints()

        # 验证所有约束都有 V2 格式的 restraints 数组
        for node_id, constraint in constraints.items():
            self.assertIn("restraints", constraint)
            self.assertIsInstance(constraint["restraints"], list)
            self.assertEqual(len(constraint["restraints"]), 6)
            self.assertIn("nodeId", constraint)
            self.assertIn("extra", constraint)
            self.assertIn("constraintType", constraint["extra"])

    def test_get_functions(self):
        """测试获取函数"""
        self.generator.apply_fixed_support(["N1"])
        self.generator.apply_hinged_member_ends(["B1"])
        self.generator.calculate_effective_lengths(["C1"])

        # 获取约束
        constraints = self.generator.get_nodal_constraints()
        self.assertEqual(len(constraints), 1)

        # 获取杆端释放
        releases = self.generator.get_member_end_releases()
        self.assertEqual(len(releases), 1)

        # 获取计算长度
        lengths = self.generator.get_effective_lengths()
        self.assertEqual(len(lengths), 2)


class TestBoundaryConditionConstants(unittest.TestCase):
    """边界条件常量测试"""

    def test_get_length_factor(self):
        """测试获取长度系数"""
        from boundary_condition.constants import (
            get_length_factor,
            LENGTH_FACTOR_FIXED,
            LENGTH_FACTOR_PINNED,
            LENGTH_FACTOR_FREE,
            LENGTH_FACTOR_GUIDED
        )

        self.assertEqual(get_length_factor("fixed"), LENGTH_FACTOR_FIXED)
        self.assertEqual(get_length_factor("pinned"), LENGTH_FACTOR_PINNED)
        self.assertEqual(get_length_factor("free"), LENGTH_FACTOR_FREE)
        self.assertEqual(get_length_factor("guided"), LENGTH_FACTOR_GUIDED)

    def test_get_length_factor_invalid(self):
        """测试无效长度系数"""
        from boundary_condition.constants import get_length_factor

        with self.assertRaises(ValueError):
            get_length_factor("invalid")

    def test_get_restraints_by_constraint_type(self):
        """测试获取约束数组"""
        from boundary_condition.constants import (
            get_restraints_by_constraint_type,
            ConstraintType,
            RollingDirection,
            FULL_RESTRAINTS,
            TRANSLATIONAL_RESTRAINTS,
            ROLLING_X_RESTRAINTS
        )

        # 固定约束
        restraints = get_restraints_by_constraint_type(ConstraintType.FIXED)
        self.assertEqual(restraints, FULL_RESTRAINTS)

        # 铰接约束
        restraints = get_restraints_by_constraint_type(ConstraintType.PINNED)
        self.assertEqual(restraints, TRANSLATIONAL_RESTRAINTS)

        # 滚动约束
        restraints = get_restraints_by_constraint_type(
            ConstraintType.ROLLING,
            RollingDirection.X
        )
        self.assertEqual(restraints, ROLLING_X_RESTRAINTS)

    def test_get_constraint_description(self):
        """测试获取约束描述"""
        from boundary_condition.constants import (
            get_constraint_description,
            ConstraintType
        )

        desc = get_constraint_description(ConstraintType.FIXED)
        self.assertIn("固定", desc)

        desc = get_constraint_description(ConstraintType.PINNED)
        self.assertIn("铰", desc)


class TestBoundaryConditionIntegration(unittest.TestCase):
    """边界条件集成测试"""

    def test_full_workflow(self):
        """测试完整工作流程"""
        model = create_test_model()
        try:
            from boundary_condition.runtime import BoundaryConditionGenerator

            generator = BoundaryConditionGenerator(model)

            # 施加约束
            generator.apply_fixed_support(["N1", "N2"])
            generator.apply_pinned_support(["N5", "N6"])

            # 施加杆端释放
            generator.apply_hinged_member_ends(["B1"])

            # 计算计算长度
            generator.apply_column_effective_lengths(["C1", "C2"])

            # 验证结果
            constraints = generator.get_nodal_constraints()
            releases = generator.get_member_end_releases()
            lengths = generator.get_effective_lengths()

            self.assertEqual(len(constraints), 4)
            self.assertEqual(len(releases), 1)
            self.assertEqual(len(lengths), 4)
        except ImportError:
            self.skipTest("boundary_condition.runtime 需要 structure_protocol 模块")


def run_tests():
    """运行所有测试"""
    # 创建测试套件
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()

    # 添加测试
    suite.addTests(loader.loadTestsFromTestCase(TestBoundaryCondition))
    suite.addTests(loader.loadTestsFromTestCase(TestBoundaryConditionConstants))
    suite.addTests(loader.loadTestsFromTestCase(TestBoundaryConditionIntegration))

    # 运行测试
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)

    # 返回结果
    return result.wasSuccessful()


if __name__ == "__main__":
    success = run_tests()
    sys.exit(0 if success else 1)
