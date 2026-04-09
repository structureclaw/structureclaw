"""
Test suite for seismic load generator.

Tests cover seismic load generation, validation, and error handling.
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
seismic_load_runtime = adapter.import_skill_runtime("seismic-load")
SeismicLoadGenerator = seismic_load_runtime.SeismicLoadGenerator

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
                name="H400x200x8x13",
                materialId="mat1",
                area=8412.0,
                iy=237000000.0,
                iz=15700000.0,
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
            "n2": NodeV2(id="n2", x=6.0, y=0.0, z=0.0),
            "n3": NodeV2(id="n3", x=0.0, y=6.0, z=0.0),
            "n4": NodeV2(id="n4", x=6.0, y=6.0, z=0.0),
            "n5": NodeV2(id="n5", x=0.0, y=0.0, z=4.0),
            "n6": NodeV2(id="n6", x=6.0, y=0.0, z=4.0)
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


def test_seismic_load_generation():
    """Test seismic load generation with default parameters."""
    model = create_test_model()
    generator = SeismicLoadGenerator(model)

    # Generate seismic loads for a test case
    case_id = "EARTHQUAKE-X"
    result = generator.generate_seismic_loads(
        case_id=case_id,
        seismic_intensity=7.0,
        site_category="II",
        design_group="A",
        seismic_direction="x"
    )

    # Verify load case was created
    assert case_id in result.loadCases
    load_case = result.loadCases[case_id]
    assert load_case.id == case_id
    assert "earthquake" in load_case.name.lower() or "地震" in load_case.name.lower()

    # Verify loads were generated
    assert len(load_case.loads) > 0

    # Verify load actions have proper format
    for load in load_case.loads:
        assert "id" in load
        assert "elementType" in load
        assert "loadType" in load
        assert "loadValue" in load
        assert "loadDirection" in load


def test_custom_seismic_load():
    """Test adding custom seismic load to specific elements."""
    model = create_test_model()
    generator = SeismicLoadGenerator(model)

    case_id = "EARTHQUAKE-Y"
    element_ids = ["c1", "c2"]

    # Add custom seismic load
    result = generator.add_custom_seismic_load(
        case_id=case_id,
        element_ids=element_ids,
        element_type="column",
        load_type="DISTRIBUTED_LOAD",
        load_value=12.5,
        load_direction="y",
        seismic_intensity=8.0
    )

    # Verify load case was created
    assert case_id in result.loadCases
    load_case = result.loadCases[case_id]

    # Verify loads were added for specified elements
    assert len(load_case.loads) == len(element_ids)

    # Verify load actions match specified elements
    load_element_ids = [load.get("elementId") for load in load_case.loads]
    for element_id in element_ids:
        assert element_id in load_element_ids

    # Verify load parameters
    for load in load_case.loads:
        assert load["loadType"] == "DISTRIBUTED_LOAD"
        assert load["loadValue"] == 12.5
        assert load["loadDirection"] == "y"
        assert load["elementType"] == "column"


def test_invalid_seismic_direction():
    """Test error handling for invalid seismic direction."""
    model = create_test_model()
    generator = SeismicLoadGenerator(model)

    with pytest.raises(ValueError) as exc_info:
        generator.generate_seismic_loads(
            case_id="EARTHQUAKE-Z",
            seismic_intensity=7.0,
            site_category="II",
            design_group="A",
            seismic_direction="z"  # Invalid direction
        )

    assert "seismic direction" in str(exc_info.value).lower() or "地震方向" in str(exc_info.value).lower()


def test_invalid_seismic_intensity():
    """Test error handling for invalid seismic intensity."""
    model = create_test_model()
    generator = SeismicLoadGenerator(model)

    # Test too low intensity
    with pytest.raises(ValueError) as exc_info:
        generator.generate_seismic_loads(
            case_id="EARTHQUAKE-LOW",
            seismic_intensity=5.5,  # Too low (minimum is 6.0)
            site_category="II",
            design_group="A",
            seismic_direction="x"
        )

    # Test too high intensity
    with pytest.raises(ValueError) as exc_info:
        generator.generate_seismic_loads(
            case_id="EARTHQUAKE-HIGH",
            seismic_intensity=10.0,  # Too high (maximum is 9.0)
            site_category="II",
            design_group="A",
            seismic_direction="x"
        )


def test_invalid_site_category():
    """Test error handling for invalid site category."""
    model = create_test_model()
    generator = SeismicLoadGenerator(model)

    with pytest.raises(ValueError) as exc_info:
        generator.generate_seismic_loads(
            case_id="EARTHQUAKE-SITE",
            seismic_intensity=7.0,
            site_category="V",  # Invalid category
            design_group="A",
            seismic_direction="x"
        )

    assert "site category" in str(exc_info.value).lower() or "场地类别" in str(exc_info.value).lower()


def test_invalid_design_group():
    """Test error handling for invalid design group."""
    model = create_test_model()
    generator = SeismicLoadGenerator(model)

    with pytest.raises(ValueError) as exc_info:
        generator.generate_seismic_loads(
            case_id="EARTHQUAKE-GROUP",
            seismic_intensity=7.0,
            site_category="II",
            design_group="D",  # Invalid group
            seismic_direction="x"
        )

    assert "design group" in str(exc_info.value).lower() or "设计分组" in str(exc_info.value).lower()


def test_seismic_load_factors():
    """Test that seismic load factors are calculated correctly."""
    model = create_test_model()
    generator = SeismicLoadGenerator(model)

    # Generate seismic loads and verify factors
    result = generator.generate_seismic_loads(
        case_id="EARTHQUAKE-FACTOR",
        seismic_intensity=7.0,
        site_category="II",
        design_group="A",
        seismic_direction="x"
    )

    load_case = result.loadCases["EARTHQUAKE-FACTOR"]

    # Verify that loads are not zero
    for load in load_case.loads:
        assert load["loadValue"] > 0


def test_multiple_seismic_directions():
    """Test generating seismic loads for multiple directions."""
    model = create_test_model()
    generator = SeismicLoadGenerator(model)

    # Generate seismic loads in X direction
    result_x = generator.generate_seismic_loads(
        case_id="EARTHQUAKE-X",
        seismic_intensity=7.0,
        site_category="II",
        design_group="A",
        seismic_direction="x"
    )

    # Generate seismic loads in Y direction
    result_y = generator.generate_seismic_loads(
        case_id="EARTHQUAKE-Y",
        seismic_intensity=7.0,
        site_category="II",
        design_group="A",
        seismic_direction="y"
    )

    # Verify both load cases exist
    assert "EARTHQUAKE-X" in result_x.loadCases
    assert "EARTHQUAKE-Y" in result_y.loadCases

    # Verify directions are correct
    for load in result_x.loadCases["EARTHQUAKE-X"].loads:
        assert load["loadDirection"] == "x"

    for load in result_y.loadCases["EARTHQUAKE-Y"].loads:
        assert load["loadDirection"] == "y"


def test_load_action_format():
    """Test that all load actions follow V2 Schema format."""
    model = create_test_model()
    generator = SeismicLoadGenerator(model)

    result = generator.generate_seismic_loads(
        case_id="EARTHQUAKE-FORMAT",
        seismic_intensity=7.0,
        site_category="II",
        design_group="A",
        seismic_direction="x"
    )

    load_case = result.loadCases["EARTHQUAKE-FORMAT"]

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
        assert "actionId" not in load, "Should use 'id' not 'actionId'"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
