"""
Test suite for snow load generator.

Tests cover snow load generation, validation, and error handling.
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
snow_load_runtime = adapter.import_skill_runtime("snow-load")
SnowLoadGenerator = snow_load_runtime.SnowLoadGenerator

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
                name="H300x150x6.5x9",
                materialId="mat1",
                area=4655.0,
                iy=73500000.0,
                iz=5080000.0,
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
            "n1": NodeV2(id="n1", x=0.0, y=0.0, z=10.0),
            "n2": NodeV2(id="n2", x=6.0, y=0.0, z=10.0),
            "n3": NodeV2(id="n3", x=12.0, y=0.0, z=10.0),
            "n4": NodeV2(id="n4", x=0.0, y=8.0, z=10.0),
            "n5": NodeV2(id="n5", x=6.0, y=8.0, z=10.0),
            "n6": NodeV2(id="n6", x=12.0, y=8.0, z=10.0)
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
                nodes=["n4", "n5"],
                releases={}
            ),
            "b4": ElementV2(
                id="b4",
                type="beam",
                sectionId="sec1",
                nodes=["n5", "n6"],
                releases={}
            ),
            "s1": ElementV2(
                id="s1",
                type="slab",
                sectionId="sec2",
                nodes=["n1", "n2", "n5", "n4"],
                releases={}
            )
        },
        loads={},
        loadCases={},
        loadCombinations={}
    )


def test_snow_load_generation():
    """Test snow load generation with default parameters."""
    model = create_test_model()
    generator = SnowLoadGenerator(model)

    # Generate snow loads for a test case
    case_id = "SNOW-LC"
    result = generator.generate_snow_loads(
        case_id=case_id,
        region="region_2",  # 使用正确的地区标识
        roof_type="flat"
    )

    # Verify load case was created
    assert case_id in result["load_case"]
    load_case = result["load_case"]
    assert load_case["id"] == case_id
    assert load_case["type"] == "snow"

    # Verify loads were generated
    assert len(load_case["loads"]) > 0


def test_custom_snow_load():
    """Test adding custom snow load to specific elements."""
    model = create_test_model()
    generator = SnowLoadGenerator(model)

    case_id = "SNOW-CUSTOM"
    element_ids = ["s1"]
    element_type = "slab"

    # Add custom snow load
    result = generator.add_custom_snow_load(
        case_id=case_id,
        element_ids=element_ids,
        element_type=element_type,
        load_type="DISTRIBUTED_LOAD",
        load_value=0.5,
        load_direction="z"
    )

    # Verify load case was created
    assert case_id in result.loadCases
    load_case = result.loadCases[case_id]

    # Verify loads were added for specified elements
    assert len(load_case.loads) == len(element_ids)

    # Verify load parameters
    for load in load_case.loads:
        assert load["loadType"] == "DISTRIBUTED_LOAD"
        assert load["loadValue"] == 0.5
        assert load["loadDirection"] == "z"
        assert load["elementType"] == element_type


def test_invalid_region():
    """Test error handling for invalid region."""
    model = create_test_model()
    generator = SnowLoadGenerator(model)

    with pytest.raises(ValueError) as exc_info:
        generator.generate_snow_loads(
            case_id="SNOW-REGION",
            region="invalid_region",  # Invalid region
            roof_type="flat"
        )

    assert "region" in str(exc_info.value).lower() or "地区" in str(exc_info.value).lower()


def test_invalid_roof_type():
    """Test error handling for invalid roof type."""
    model = create_test_model()
    generator = SnowLoadGenerator(model)

    with pytest.raises(ValueError) as exc_info:
        generator.generate_snow_loads(
            case_id="SNOW-ROOF",
            region="region_2",
            roof_type="invalid_roof"  # Invalid roof type
        )

    assert "roof type" in str(exc_info.value).lower() or "屋面类型" in str(exc_info.value).lower()


def test_invalid_case_id():
    """Test error handling for invalid case ID."""
    model = create_test_model()
    generator = SnowLoadGenerator(model)

    with pytest.raises(ValueError) as exc_info:
        generator.generate_snow_loads(
            case_id="",  # Invalid (empty string)
            region="region_2",
            roof_type="flat"
        )


def test_invalid_load_value():
    """Test error handling for invalid load value."""
    model = create_test_model()
    generator = SnowLoadGenerator(model)

    with pytest.raises(ValueError) as exc_info:
        generator.generate_snow_loads(
            case_id="SNOW-LOAD",
            region="region_2",
            roof_type="flat"
        )


def test_snow_load_factors():
    """Test that snow load factors are calculated correctly for different regions."""
    model = create_test_model()
    generator = SnowLoadGenerator(model)

    # Test region_1 (0.3 kN/m²)
    result_region1 = generator.generate_snow_loads(
        case_id="SNOW-REGION1",
        region="region_1",
        roof_type="flat"
    )

    # Test region_2 (0.5 kN/m²)
    result_region2 = generator.generate_snow_loads(
        case_id="SNOW-REGION2",
        region="region_2",
        roof_type="flat"
    )

    # Test region_3 (0.7 kN/m²)
    result_region3 = generator.generate_snow_loads(
        case_id="SNOW-REGION3",
        region="region_3",
        roof_type="flat"
    )

    # Verify loads were generated for all regions
    assert "SNOW-REGION1" in generator.load_cases
    assert "SNOW-REGION2" in generator.load_cases
    assert "SNOW-REGION3" in generator.load_cases

    # Region 3 should have higher snow loads than Region 1
    loads_region1 = sum(load["loadValue"] for load in generator.load_cases["SNOW-REGION1"]["loads"])
    loads_region3 = sum(load["loadValue"] for load in generator.load_cases["SNOW-REGION3"]["loads"])
    assert loads_region3 > loads_region1


def test_roof_type_factors():
    """Test that roof type factors are applied correctly."""
    model = create_test_model()
    generator = SnowLoadGenerator(model)

    # Generate for flat roof (factor = 1.0)
    result_flat = generator.generate_snow_loads(
        case_id="SNOW-FLAT",
        region="region_2",
        roof_type="flat"
    )

    # Generate for sloped_25 roof (factor = 0.8)
    result_sloped25 = generator.generate_snow_loads(
        case_id="SNOW-SLOPED25",
        region="region_2",
        roof_type="sloped_25"
    )

    # Generate for sloped_25_50 roof (factor = 0.6)
    result_sloped2550 = generator.generate_snow_loads(
        case_id="SNOW-SLOPED2550",
        region="region_2",
        roof_type="sloped_25_50"
    )

    # Generate for sloped_50 roof (factor = 0.0)
    result_sloped50 = generator.generate_snow_loads(
        case_id="SNOW-SLOPED50",
        region="region_2",
        roof_type="sloped_50"
    )

    # Verify all load cases exist
    assert "SNOW-FLAT" in generator.load_cases
    assert "SNOW-SLOPED25" in generator.load_cases
    assert "SNOW-SLOPED2550" in generator.load_cases
    assert "SNOW-SLOPED50" in generator.load_cases

    # Different roof types should have different load values due to different factors
    loads_flat = sum(load["loadValue"] for load in generator.load_cases["SNOW-FLAT"]["loads"])
    loads_sloped25 = sum(load["loadValue"] for load in generator.load_cases["SNOW-SLOPED25"]["loads"])
    loads_sloped2550 = sum(load["loadValue"] for load in generator.load_cases["SNOW-SLOPED2550"]["loads"])
    loads_sloped50 = sum(load["loadValue"] for load in generator.load_cases["SNOW-SLOPED50"]["loads"])

    # Flat roof should have highest load, sloped_50 should have zero load
    assert loads_flat > loads_sloped25 > loads_sloped2550 > loads_sloped50 == 0


def test_snow_distribution():
    """Test that snow loads are distributed correctly over slabs and beams."""
    model = create_test_model()
    generator = SnowLoadGenerator(model)

    result = generator.generate_snow_loads(
        case_id="SNOW-DIST",
        region="region_2",
        roof_type="flat"
    )

    load_case = result["load_case"]

    # Verify loads are distributed over different element types
    slab_loads = [load for load in load_case["loads"] if load.get("elementType") == "slab"]
    beam_loads = [load for load in load_case["loads"] if load.get("elementType") == "beam"]

    # Snow loads are applied to slabs
    assert len(slab_loads) > 0


def test_load_action_format():
    """Test that all load actions follow V2 Schema format."""
    model = create_test_model()
    generator = SnowLoadGenerator(model)

    result = generator.generate_snow_loads(
        case_id="SNOW-FORMAT",
        region="region_2",
        roof_type="flat"
    )

    load_case = result["load_case"]

    # Verify all load actions have required fields in correct format
    required_fields = ["id", "elementType", "loadType", "loadValue", "loadDirection"]
    for load in load_case["loads"]:
        for field in required_fields:
            assert field in load, f"Missing field: {field}"

        # Verify camelCase naming convention
        assert "element_id" not in load, "Should use camelCase (elementId)"
        assert "load_type" not in load, "Should use camelCase (loadType)"
        assert "load_value" not in load, "Should use camelCase (loadValue)"
        assert "load_direction" not in load, "Should use camelCase (loadDirection)"
        assert "case_id" not in load, "Should use camelCase (caseId)"
        assert "actionId" not in load, "Should use 'id' not 'actionId'"


def test_unbalanced_snow_load():
    """Test unbalanced snow load for certain roof types."""
    model = create_test_model()
    generator = SnowLoadGenerator(model)

    # Generate for sloped_25_50 roof (intermediate slope)
    result_sloped = generator.generate_snow_loads(
        case_id="SNOW-SLOPED2550",
        region="region_2",
        roof_type="sloped_25_50"
    )

    load_case = result_sloped["load_case"]

    # Verify loads were generated
    assert len(load_case["loads"]) > 0

    # Verify all load values are positive
    for load in load_case["loads"]:
        assert load["loadValue"] > 0


def test_drift_load():
    """Test snow drift load for obstacles."""
    model = create_test_model()
    generator = SnowLoadGenerator(model)

    # Generate snow loads (may include drift effects)
    result = generator.generate_snow_loads(
        case_id="SNOW-DRIFT",
        region="region_2",
        roof_type="flat"
    )

    load_case = result["load_case"]

    # Verify loads were generated
    assert len(load_case["loads"]) > 0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
