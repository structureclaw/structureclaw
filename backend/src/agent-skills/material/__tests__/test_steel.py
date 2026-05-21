"""Unit tests for SteelDesigner (GB50017-2017)."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

_SKILL_DIR = str(Path(__file__).resolve().parent.parent)
if _SKILL_DIR not in sys.path:
    sys.path.insert(0, _SKILL_DIR)

import steel  # noqa: E402


@pytest.fixture
def designer():
    return steel.SteelDesigner()


# ---------------------------------------------------------------------------
# Initialization & Constants
# ---------------------------------------------------------------------------

class TestSteelDesignerInit:

    def test_instantiation(self, designer):
        assert designer is not None

    def test_steel_strength_keys(self):
        expected = {'Q235', 'Q345', 'Q390', 'Q420', 'Q460'}
        assert set(steel.SteelDesigner.STEEL_STRENGTH.keys()) == expected

    def test_steel_strength_values(self):
        for grade, vals in steel.SteelDesigner.STEEL_STRENGTH.items():
            assert 'f' in vals
            assert 'fv' in vals
            assert 'fb' in vals
            assert vals['f'] > vals['fv']

    def test_weld_strength_keys(self):
        expected = {'Q235', 'Q345', 'Q390', 'Q420'}
        assert set(steel.SteelDesigner.WELD_STRENGTH.keys()) == expected

    def test_weld_strength_values(self):
        for grade, vals in steel.SteelDesigner.WELD_STRENGTH.items():
            assert 'fwf' in vals
            assert 'fwv' in vals
            assert vals['fwf'] > 0


# ---------------------------------------------------------------------------
# design_beam
# ---------------------------------------------------------------------------

class TestDesignBeam:

    def test_typical_beam(self, designer):
        result = designer.design_beam({
            'M': 200, 'V': 100, 'L': 6000, 'steelGrade': 'Q345',
        })
        assert result['status'] == 'success'
        assert 'selectedSection' in result
        assert result['selectedSection']['name'].startswith('H')

    def test_stress_check_ok(self, designer):
        result = designer.design_beam({
            'M': 100, 'V': 50, 'L': 6000, 'steelGrade': 'Q345',
        })
        sc = result['stressCheck']
        assert sc['status'] == 'OK'
        assert sc['ratio'] <= 1.0

    def test_shear_check_ok(self, designer):
        result = designer.design_beam({
            'M': 100, 'V': 50, 'L': 6000, 'steelGrade': 'Q345',
        })
        assert result['shearCheck']['status'] == 'OK'

    def test_deflection_check(self, designer):
        result = designer.design_beam({
            'M': 100, 'V': 50, 'L': 6000, 'steelGrade': 'Q345',
        })
        dc = result['deflectionCheck']
        assert 'deflection' in dc
        assert 'allowableDeflection' in dc

    def test_input_echoed(self, designer):
        result = designer.design_beam({
            'M': 150, 'V': 80, 'L': 8000, 'steelGrade': 'Q235',
        })
        assert result['input']['M'] == 150
        assert result['input']['steelGrade'] == 'Q235'

    def test_recommendation_present(self, designer):
        result = designer.design_beam({'M': 100, 'V': 50, 'L': 6000})
        assert isinstance(result['recommendation'], str)
        assert len(result['recommendation']) > 0


class TestDesignBeamHighMoment:

    def test_stress_fail(self, designer):
        result = designer.design_beam({
            'M': 5000, 'V': 10, 'L': 6000, 'steelGrade': 'Q235',
        })
        assert result['stressCheck']['status'] == 'NG'
        assert result['stressCheck']['ratio'] > 1.0


# ---------------------------------------------------------------------------
# _select_h_section
# ---------------------------------------------------------------------------

class TestSelectHSection:

    def test_small_w_gets_smallest(self, designer):
        result = designer._select_h_section(100e3)
        assert result['name'] == 'HW200x200'

    def test_large_w_gets_largest(self, designer):
        result = designer._select_h_section(1e9)
        assert result['name'] == 'HM600x300'

    def test_section_meets_requirement(self, designer):
        W_req = 500e3
        result = designer._select_h_section(W_req)
        assert result['Wx'] >= W_req


# ---------------------------------------------------------------------------
# _check_bending_stress / _check_shear_stress / _check_deflection
# ---------------------------------------------------------------------------

class TestCheckBendingStress:

    def test_known_values(self, designer):
        section = {'Wx': 958e3}
        result = designer._check_bending_stress(100, section, 310)
        assert result['stress'] == pytest.approx(100 * 1e6 / 958e3, rel=0.01)
        assert result['ratio'] == pytest.approx(result['stress'] / 310, rel=0.01)


class TestCheckShearStress:

    def test_known_values(self, designer):
        section = {'h': 250, 'tw': 9}
        result = designer._check_shear_stress(50, section, 180)
        expected_tau = 50e3 / (250 * 9)
        assert result['shearStress'] == pytest.approx(expected_tau, rel=0.01)


class TestCheckDeflection:

    def test_ratio_calculation(self, designer):
        section = {'Ix': 10800e4}
        result = designer._check_deflection(100, 6000, section)
        assert result['ratio'] > 0
        assert result['allowableDeflection'] == pytest.approx(6000 / 250)


# ---------------------------------------------------------------------------
# design_column
# ---------------------------------------------------------------------------

class TestDesignColumn:

    def test_typical_column(self, designer):
        result = designer.design_column({
            'N': 1500, 'L0': 4000, 'steelGrade': 'Q345',
        })
        assert result['status'] == 'success'
        assert result['slendernessRatio'] > 0
        assert 0 < result['stabilityFactor'] <= 1.0
        assert result['axialCapacity'] > 0

    def test_low_load_passes(self, designer):
        result = designer.design_column({
            'N': 100, 'L0': 3000, 'steelGrade': 'Q345',
        })
        assert result['check']['status'] == 'OK'
        assert result['check']['ratio'] < 1.0

    def test_input_echoed(self, designer):
        result = designer.design_column({
            'N': 500, 'Mx': 50, 'L0': 5000, 'steelGrade': 'Q235',
        })
        assert result['input']['N'] == 500
        assert result['input']['steelGrade'] == 'Q235'


# ---------------------------------------------------------------------------
# _get_phi — Perry-Robertson formula
# ---------------------------------------------------------------------------

class TestGetPhi:

    def test_low_slenderness_near_one(self, designer):
        phi = designer._get_phi(10, 'Q345')
        assert phi > 0.95

    def test_high_slenderness_low_phi(self, designer):
        phi = designer._get_phi(150, 'Q345')
        assert phi < 0.4

    def test_q235_vs_q345(self, designer):
        phi_235 = designer._get_phi(80, 'Q235')
        phi_345 = designer._get_phi(80, 'Q345')
        assert phi_235 != phi_345

    def test_phi_always_positive(self, designer):
        for lam in [10, 50, 100, 150, 200]:
            phi = designer._get_phi(lam, 'Q345')
            assert phi > 0


# ---------------------------------------------------------------------------
# _select_h_column_section
# ---------------------------------------------------------------------------

class TestSelectHColumnSection:

    def test_small_area(self, designer):
        result = designer._select_h_column_section(1000)
        assert result['name'] == 'HW200x200'

    def test_large_area_gets_largest(self, designer):
        result = designer._select_h_column_section(1e6)
        assert result['name'] == 'HW400x400'

    def test_meets_area_requirement(self, designer):
        A_req = 8000
        result = designer._select_h_column_section(A_req)
        assert result['A'] >= A_req


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
