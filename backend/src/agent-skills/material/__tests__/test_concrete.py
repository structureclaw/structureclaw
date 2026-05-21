"""Unit tests for ConcreteDesigner (GB50010-2010)."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

_SKILL_DIR = str(Path(__file__).resolve().parent.parent)
if _SKILL_DIR not in sys.path:
    sys.path.insert(0, _SKILL_DIR)

import concrete  # noqa: E402


@pytest.fixture
def designer():
    return concrete.ConcreteDesigner()


# ---------------------------------------------------------------------------
# Initialization & Constants
# ---------------------------------------------------------------------------

class TestConcreteDesignerInit:

    def test_instantiation(self, designer):
        assert designer is not None

    def test_concrete_strength_keys(self):
        expected = {'C15', 'C20', 'C25', 'C30', 'C35', 'C40',
                    'C45', 'C50', 'C55', 'C60', 'C65', 'C70', 'C75', 'C80'}
        assert set(concrete.ConcreteDesigner.CONCRETE_STRENGTH.keys()) == expected

    def test_concrete_strength_values_have_fc_ft(self):
        for grade, vals in concrete.ConcreteDesigner.CONCRETE_STRENGTH.items():
            assert 'fc' in vals, f"{grade} missing fc"
            assert 'ft' in vals, f"{grade} missing ft"
            assert vals['fc'] > 0
            assert vals['ft'] > 0

    def test_steel_strength_keys(self):
        expected = {'HPB300', 'HRB335', 'HRB400', 'HRB500'}
        assert set(concrete.ConcreteDesigner.STEEL_STRENGTH.keys()) == expected

    def test_steel_strength_values_have_fy_fyv(self):
        for grade, vals in concrete.ConcreteDesigner.STEEL_STRENGTH.items():
            assert 'fy' in vals
            assert 'fyv' in vals
            assert vals['fy'] > 0


# ---------------------------------------------------------------------------
# design_beam
# ---------------------------------------------------------------------------

class TestDesignBeam:

    def test_typical_beam(self, designer):
        result = designer.design_beam({
            'M': 150, 'V': 100, 'b': 250, 'h': 500,
            'concreteGrade': 'C30', 'steelGrade': 'HRB400',
        })
        assert result['status'] == 'success'
        assert result['flexureDesign']['status'] == 'ok'
        assert result['shearDesign']['status'] == 'ok'
        assert result['flexureDesign']['steelArea'] > 0
        assert result['flexureDesign']['reinforcementRatio'] > 0

    def test_flexure_steel_area_reasonable(self, designer):
        result = designer.design_beam({
            'M': 100, 'V': 50, 'b': 250, 'h': 500,
            'concreteGrade': 'C30', 'steelGrade': 'HRB400',
        })
        As = result['flexureDesign']['steelArea']
        assert 100 < As < 5000, f"Steel area {As} out of reasonable range"

    def test_shear_calculated_stirrup(self, designer):
        result = designer.design_beam({
            'M': 50, 'V': 200, 'b': 250, 'h': 500,
            'concreteGrade': 'C30', 'steelGrade': 'HRB400',
        })
        sd = result['shearDesign']
        assert sd['status'] == 'ok'
        assert sd['needCalculation'] is True
        assert 'spacing' in sd
        assert sd['spacing'] >= 100

    def test_input_echoed_in_result(self, designer):
        result = designer.design_beam({
            'M': 80, 'V': 60, 'b': 300, 'h': 600,
            'concreteGrade': 'C35', 'steelGrade': 'HRB500',
        })
        assert result['input']['M'] == 80
        assert result['input']['V'] == 60
        assert result['input']['concreteGrade'] == 'C35'
        assert result['input']['steelGrade'] == 'HRB500'

    def test_minimum_steel(self, designer):
        result = designer.design_beam({
            'M': 10, 'V': 5, 'b': 200, 'h': 400,
        })
        assert 'minimumSteel' in result
        assert result['minimumSteel']['minArea'] > 0


class TestDesignBeamDoubleReinforcement:

    def test_high_moment_requires_double_reinforcement(self, designer):
        result = designer.design_beam({
            'M': 800, 'V': 10, 'b': 200, 'h': 400,
            'concreteGrade': 'C30', 'steelGrade': 'HRB400',
        })
        assert result['flexureDesign']['status'] == 'needDoubleReinforcement'
        assert 'message' in result['flexureDesign']


class TestDesignBeamShearSectionTooSmall:

    def test_very_high_shear_section_too_small(self, designer):
        result = designer.design_beam({
            'M': 10, 'V': 2000, 'b': 200, 'h': 300,
            'concreteGrade': 'C30', 'steelGrade': 'HRB400',
        })
        assert result['shearDesign']['status'] == 'sectionTooSmall'

    def test_nominal_shear_constructive_only(self, designer):
        result = designer.design_beam({
            'M': 10, 'V': 1, 'b': 250, 'h': 500,
            'concreteGrade': 'C30', 'steelGrade': 'HRB400',
        })
        sd = result['shearDesign']
        assert sd['status'] == 'ok'
        assert sd['needCalculation'] is False


# ---------------------------------------------------------------------------
# design_column
# ---------------------------------------------------------------------------

class TestDesignColumn:

    def test_typical_column(self, designer):
        result = designer.design_column({
            'N': 2000, 'Mx': 100, 'b': 400, 'h': 400, 'L0': 4000,
        })
        assert result['status'] == 'success'
        assert result['slendernessRatio'] > 0
        assert 0 < result['stabilityFactor'] <= 1.0
        assert result['axialCapacity'] > 0

    def test_short_column_high_stability(self, designer):
        result = designer.design_column({
            'N': 1000, 'b': 800, 'h': 800, 'L0': 2000,
        })
        # l0_i = L0 / (min(b,h)/sqrt(12)) ≈ 2000 / 231 = 8.66 → phi=0.98
        assert result['stabilityFactor'] >= 0.95

    def test_slender_column_low_stability(self, designer):
        result = designer.design_column({
            'N': 500, 'b': 300, 'h': 300, 'L0': 10000,
        })
        assert result['stabilityFactor'] < 1.0

    def test_check_ratio_under_capacity(self, designer):
        result = designer.design_column({
            'N': 100, 'b': 400, 'h': 400, 'L0': 3000,
        })
        assert result['check']['status'] == 'OK'
        assert result['check']['ratio'] < 1.0

    def test_eccentricity_with_moment(self, designer):
        result = designer.design_column({
            'N': 1000, 'Mx': 200, 'b': 400, 'h': 400, 'L0': 4000,
        })
        assert result['eccentricity'] > 0


# ---------------------------------------------------------------------------
# _get_stability_factor
# ---------------------------------------------------------------------------

class TestGetStabilityFactor:

    def test_l0_i_8_or_less(self, designer):
        assert designer._get_stability_factor(8) == 1.0
        assert designer._get_stability_factor(5) == 1.0

    def test_l0_i_10(self, designer):
        assert designer._get_stability_factor(10) == pytest.approx(0.98)

    def test_l0_i_12(self, designer):
        assert designer._get_stability_factor(12) == pytest.approx(0.95)

    def test_l0_i_20(self, designer):
        assert designer._get_stability_factor(20) == pytest.approx(0.75)

    def test_l0_i_28(self, designer):
        assert designer._get_stability_factor(28) == pytest.approx(0.56)

    def test_l0_i_30(self, designer):
        assert designer._get_stability_factor(30) == pytest.approx(0.52)

    def test_l0_i_over_30(self, designer):
        assert designer._get_stability_factor(50) == pytest.approx(0.48)


# ---------------------------------------------------------------------------
# _select_bars
# ---------------------------------------------------------------------------

class TestSelectBars:

    def test_small_area(self, designer):
        result = designer._select_bars(200, 'bottom')
        assert result['diameter'] >= 12
        assert result['number'] >= 1
        assert result['totalArea'] >= 200

    def test_moderate_area(self, designer):
        result = designer._select_bars(1500, 'bottom')
        assert result['totalArea'] >= 1500
        assert result['number'] <= 8

    def test_very_large_area(self, designer):
        result = designer._select_bars(10000, 'bottom')
        assert result['totalArea'] >= 10000


# ---------------------------------------------------------------------------
# Concrete strength lookup
# ---------------------------------------------------------------------------

class TestConcreteStrengthLookup:

    def test_unknown_grade_falls_back_to_c30(self, designer):
        result = designer.design_beam({
            'M': 50, 'V': 30, 'b': 250, 'h': 500,
            'concreteGrade': 'C999', 'steelGrade': 'HRB400',
        })
        assert result['status'] == 'success'
        assert result['input']['concreteGrade'] == 'C999'

    def test_unknown_steel_grade_falls_back(self, designer):
        result = designer.design_beam({
            'M': 50, 'V': 30, 'b': 250, 'h': 500,
            'concreteGrade': 'C30', 'steelGrade': 'UNKNOWN',
        })
        assert result['status'] == 'success'


# ---------------------------------------------------------------------------
# Recommendation text
# ---------------------------------------------------------------------------

class TestBeamRecommendation:

    def test_recommendation_present(self, designer):
        result = designer.design_beam({'M': 80, 'V': 40, 'b': 250, 'h': 500})
        assert isinstance(result['recommendation'], str)
        assert len(result['recommendation']) > 0


class TestColumnRecommendation:

    def test_low_ratio_recommendation(self, designer):
        result = designer.design_column({'N': 100, 'b': 400, 'h': 400, 'L0': 3000})
        assert '富余' in result['recommendation']

    def test_near_limit_recommendation(self, designer):
        result = designer.design_column({'N': 50000, 'b': 300, 'h': 300, 'L0': 3000})
        rec = result['recommendation']
        assert any(kw in rec for kw in ['不足', '加大'])


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
