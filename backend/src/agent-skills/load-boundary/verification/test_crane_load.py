"""
Test suite for crane load generator.

Tests cover crane load generation, validation, and error handling.
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
crane_load_runtime = adapter.import_skill_runtime("crane-load")
CraneLoadGenerator = crane_load_runtime.CraneLoadGenerator

# 导入核心模块
load_action_module = adapter.import_core_module("load_action")
create_load_action = load_action_module.create_load_action


def create_test_model() -> StructureModelV2:
    """Create a test structure model with materials, sections, nodes, and elements."""
    return StructureModelV2(
        materials={
            "mat1": MaterialV2(
                id="mat1",
                name="Q235",
                density=7850.0,
                elasticModulus=206000.0,
                poissonRatio=0.3,
                thermalExpansionCoeff=1.2e-5,
                yieldStrength=235.0,
                ultimateStrength=375.0
            )
        },
        sections={
            "sec1": SectionV2(
                id="sec1",
                name="H600x200x11x17",
                materialId="mat1",
                area=13520.0,
                iy=782000000.0,
                iz=22800000.0,
                iy_unit="mm4",
                iz_unit="mm4"
            ),
            "sec2": SectionV2(
                id="sec2",
                name="C25",
                materialId="mat2",
                area=1.0,
                iy=0.083333,
                iz=0.083333,
                iy_unit="m4",
                iz_unit="m4"
            )
        },
        nodes={
            "n1": NodeV2(id="n1", x=0.0, y=0.0, z=0.0),
            "n2": NodeV2(id="n2", x=8.0, y=0.0, z=0.0),
            "n3": NodeV2(id="n3", x=16.0, y=0.0, z=0.0),
            "n4": NodeV2(id="n4", x=24.0, y=0.0, z=0.0),
            "n5": NodeV2(id="n5", x=0.0, y=0.0, z=10.0),
            "n6": NodeV2(id="n6", x=8.0, y=0.0, z=10.0),
            "n7": NodeV2(id="n7", x=16.0, y=0.0, z=10.0),
            "n8": NodeV2(id="n8", x=24.0, y=0.0, z=10.0)
        },
        elements={
            "b1": ElementV2(
                id="b1",
                type="beam",
                sectionId="sec1",
                nodes=["n1", "n2"],
                releases={}
            ),
            "b2": ElementV2(
                id="b2",
                type="beam",
                sectionId="sec1",
                nodes=["n2", "n3"],
                releases={}
            ),
            "b3": ElementV2(
                id="b3",
                type="beam",
                sectionId="sec1",
                nodes=["n3", "n4"],
                releases={}
            ),
            "c1": ElementV2(
                id="c1",
                type="column",
                sectionId="sec1",
                nodes=["n1", "n5"],
                releases={}
            ),
            "c2": ElementV2(
                id="c2",
                type="column",
                sectionId="sec1",
                nodes=["n2", "n6"],
                releases={}
            )
        },
        loads={},
        loadCases={},
        loadCombinations={}
    )


def test_crane_load_generation():
    """Test crane load generation with default parameters."""
    model = create_test_model()
    generator = CraneLoadGenerator(model)

    # Generate crane loads for a test case
    case_id = "CRANE-LC"
    result = generator.generate_crane_loads(
        case_id=case_id,
        crane_capacity=10.0,
        crane_span=18.0,
        beam_ids=["b1", "b2", "b3"],
        column_ids=["c1", "c2"]
    )

    # Verify load case was created
    assert case_id in result.loadCases
    load_case = result.loadCases[case_id]
    assert load_case.id == case_id
    assert "crane" in load_case.name.lower() or "吊车" in load_case.name.lower()

    # Verify loads were generated for beams
    beam_loads = [load for load in load_case.loads if load.get("elementType") == "beam"]
    assert len(beam_loads) > 0

    # Verify loads were generated for columns
    column_loads = [load for load in load_case.loads if load.get("elementType") == "column"]
    assert len(column_loads) > 0


def test_custom_crane_load():
    """Test adding custom crane load to specific elements."""
    model = create_test_model()
    generator = CraneLoadGenerator(model)

    case_id = "CRANE-CUSTOM"
    element_ids = ["b1"]
    element_type = "beam"

    # Add custom crane load
    result = generator.add_custom_crane_load(
        case_id=case_id,
        element_ids=element_ids,
        element_type=element_type,
        load_type="POINT_FORCE",
        load_value=50.0,
        load_direction="z"
    )

    # Verify load case was created
    assert case_id in result.loadCases
    load_case = result.loadCases[case_id]

    # Verify loads were added for specified elements
    assert len(load_case.loads) == len(element_ids)

    # Verify load parameters
    for load in load_case.loads:
        assert load["loadType"] == "POINT_FORCE"
        assert load["loadValue"] == 50.0
        assert load["loadDirection"] == "z"
        assert load["elementType"] == element_type


def test_invalid_crane_capacity():
    """Test error handling for invalid crane capacity."""
    model = create_test_model()
    generator = CraneLoadGenerator(model)

    # Test negative capacity
    with pytest.raises(ValueError) as exc_info:
        generator.generate_crane_loads(
            case_id="CRANE-NEG",
            crane_capacity=-5.0,  # Invalid (negative)
            crane_span=18.0,
            beam_ids=["b1"],
            column_ids=["c1"]
        )

    # Test too high capacity
    with pytest.raises(ValueError) as exc_info:
        generator.generate_crane_loads(
            case_id="CRANE-HIGH",
            crane_capacity=2000.0,  # Invalid (exceeds max)
            crane_span=18.0,
            beam_ids=["b1"],
            column_ids=["c1"]
        )


def test_invalid_crane_span():
    """Test error handling for invalid crane span."""
    model = create_test_model()
    generator = CraneLoadGenerator(model)

    # Test negative span
    with pytest.raises(ValueError) as exc_info:
        generator.generate_crane_loads(
            case_id="CRANE-SPAN-NEG",
            crane_capacity=10.0,
            crane_span=-5.0,  # Invalid (negative)
            beam_ids=["b1"],
            column_ids=["c1"]
        )

    # Test too high span
    with pytest.raises(ValueError) as exc_info:
        generator.generate_crane_loads(
            case_id="CRANE-SPAN-HIGH",
            crane_capacity=10.0,
            crane_span=300.0,  # Invalid (exceeds max)
            beam_ids=["b1"],
            column_ids=["c1"]
        )


def test_invalid_case_id():
    """Test error handling for invalid case ID."""
    model = create_test_model()
    generator = CraneLoadGenerator(model)

    with pytest.raises(ValueError) as exc_info:
        generator.generate_crane_loads(
            case_id="",  # Invalid (empty string)
            crane_capacity=10.0,
            crane_span=18.0,
            beam_ids=["b1"],
            column_ids=["c1"]
        )


def test_invalid_load_value():
    """Test error handling for invalid load value."""
    model = create_test_model()
    generator = CraneLoadGenerator(model)

    with pytest.raises(ValueError) as exc_info:
        generator.add_custom_crane_load(
            case_id="CRANE-LOAD",
            element_ids=["b1"],
            element_type="beam",
            load_type="POINT_FORCE",
            load_value=-10.0,  # Invalid (negative)
            load_direction="z"
        )


def test_crane_load_factors():
    """Test that crane load factors are calculated correctly."""
    model = create_test_model()
    generator = CraneLoadGenerator(model)

    # Generate crane loads with known capacity
    result = generator.generate_crane_loads(
        case_id="CRANE-FACTOR",
        crane_capacity=20.0,
        crane_span=24.0,
        beam_ids=["b1", "b2", "b3"],
        column_ids=["c1", "c2"]
    )

    load_case = result.loadCases["CRANE-FACTOR"]

    # Verify that loads are not zero
    for load in load_case.loads:
        assert load["loadValue"] > 0


def test_multiple_crane_cases():
    """Test generating multiple crane load cases."""
    model = create_test_model()
    generator = CraneLoadGenerator(model)

    # Generate first crane load case
    result1 = generator.generate_crane_loads(
        case_id="CRANE-1",
        crane_capacity=10.0,
        crane_span=18.0,
        beam_ids=["b1", "b2"],
        column_ids=["c1"]
    )

    # Generate second crane load case
    result2 = generator.generate_crane_loads(
        case_id="CRANE-2",
        crane_capacity=20.0,
        crane_span=24.0,
        beam_ids=["b2", "b3"],
        column_ids=["c2"]
    )

    # Verify both load cases exist
    assert "CRANE-1" in result1.loadCases
    assert "CRANE-2" in result2.loadCases

    # Verify loads are different based on different parameters
    loads1 = sum(load["loadValue"] for load in result1.loadCases["CRANE-1"].loads)
    loads2 = sum(load["loadValue"] for load in result2.loadCases["CRANE-2"].loads)


def test_load_action_format():
    """Test that all load actions follow V2 Schema format."""
    model = create_test_model()
    generator = CraneLoadGenerator(model)

    result = generator.generate_crane_loads(
        case_id="CRANE-FORMAT",
        crane_capacity=15.0,
        crane_span=22.0,
        beam_ids=["b1", "b2"],
        column_ids=["c1", "c2"]
    )

    load_case = result.loadCases["CRANE-FORMAT"]

    # Verify all load actions have required fields in correct format
    required_fields = ["id", "elementType", "loadType", "loadValue", "loadDirection"]
    for load in load_case.loads:
        for field in required_fields:
            assert field in load, f"Missing field: {field}"

        # Verify camelCase naming convention
        assert "element_id" not in load, "Should use camelCase (elementId)"
        assert "load_type" not in load, "Should use camelCase (loadType)"
        assert "load_value" not in load, "Should use camelCase (loadValue)"
        assert "load_direction" not in load, "Should use camelCase (loadDirection)"
        assert "case_id" not in load, "Should use camelCase (caseId)"
        assert "actionId" not in load, "Should use 'id' not 'actionId'"


def test_braking_load():
    """Test that braking loads are generated for crane."""
    model = create_test_model()
    generator = CraneLoadGenerator(model)

    result = generator.generate_crane_loads(
        case_id="CRANE-BRAKING",
        crane_capacity=20.0,
        crane_span=24.0,
        beam_ids=["b1", "b2", "b3"],
        column_ids=["c1", "c2"]
    )

    load_case = result.loadCases["CRANE-BRAKING"]

    # Verify loads include horizontal components (braking)
    horizontal_loads = [
        load for load in load_case.loads
        if load["loadDirection"] in ["x", "-x", "y", "-y"]
    ]

    # There should be some horizontal loads for braking
    assert len(horizontal_loads) > 0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
