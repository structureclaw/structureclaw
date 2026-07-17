"""Unit tests for GB50011 (抗震设计规范) code-check module."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any, Dict

_SHARED_PYTHON_PATH = str(Path(__file__).resolve().parents[4] / "skill-shared" / "python")
if _SHARED_PYTHON_PATH not in sys.path:
    sys.path.insert(0, _SHARED_PYTHON_PATH)

_MODULE_PATH = str(Path(__file__).resolve().parent.parent / "code_check.py")
_spec = importlib.util.spec_from_file_location("gb50011_code_check", _MODULE_PATH)
gb50011 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gb50011)

_GENERIC_MODULE_PATH = str(Path(__file__).resolve().parent.parent.parent / "code_check.py")
_generic_spec = importlib.util.spec_from_file_location("generic_code_check", _GENERIC_MODULE_PATH)
generic_code_check = importlib.util.module_from_spec(_generic_spec)
_generic_spec.loader.exec_module(generic_code_check)


class MockCodeChecker:

    def __init__(self, overrides: Dict[str, Dict[str, float]] | None = None):
        self._overrides = overrides or {}

    def _resolve_utilization(self, elem_id, item_name, context):
        per_elem = self._overrides.get(elem_id, {})
        raw = per_elem.get(item_name)
        if isinstance(raw, (int, float)):
            return max(0.0, float(raw))
        return 0.55

    def _calc_item(self, elem_id, item_name, context, clause, formula, limit):
        utilization = self._resolve_utilization(elem_id, item_name, context)
        return {
            'item': item_name,
            'status': 'pass' if utilization <= 1.0 else 'fail',
            'utilization': round(utilization, 4),
            'clause': clause,
            'formula': formula,
            'inputs': {
                'demand': round(utilization * limit, 4),
                'capacity': round(limit, 4),
                'limit': limit,
            },
        }

    def _build_element_result(self, elem_id, element_type, checks, code_version):
        all_items = [item for check in checks for item in check.get('items', [])]
        controlling = max(all_items, key=lambda i: float(i.get('utilization', 0.0)), default={})
        all_passed = all(i.get('status') == 'pass' for i in all_items)
        return {
            'elementId': elem_id,
            'elementType': element_type,
            'status': 'pass' if all_passed else 'fail',
            'checks': checks,
            'controlling': {
                'item': controlling.get('item'),
                'utilization': controlling.get('utilization', 0.0),
                'clause': controlling.get('clause'),
            },
            'code': code_version,
        }


class TestGetRules:

    def test_code_field(self):
        assert gb50011.get_rules()['code'] == 'GB50011'

    def test_version_field(self):
        assert gb50011.get_rules()['version'] == 'v2-global-seismic-gb55002-gbt50011-2024'

    def test_rules_include_global_seismic_checks(self):
        rule_ids = [rule['id'] for rule in gb50011.get_rules()['rules']]
        assert 'gb50011_elastic_story_drift' in rule_ids
        assert 'gb50011_design_basis_completeness' in rule_ids
        assert 'gb50011_fortification_category_standard' in rule_ids
        assert 'gb50011_seismic_grade_design_basis' in rule_ids
        assert 'gb50011_structured_seismic_workflow_input' in rule_ids
        assert 'gb50011_capability_boundary' in rule_ids
        assert 'gb50011_special_system_structured_review' in rule_ids
        assert 'gb50011_over_limit_special_review_trace' in rule_ids
        assert 'gb50011_time_history_base_shear' in rule_ids
        assert 'gb50011_time_history_combination_rule' in rule_ids
        assert 'gb50011_elastic_plastic_time_history_final_compliance' in rule_ids
        assert 'gb50011_required_time_history_completeness' in rule_ids
        assert 'gb50011_regularity_time_history_trigger' in rule_ids
        assert 'gb50011_modal_mass_participation' in rule_ids
        assert 'gb50011_response_spectrum_long_period_special_study' in rule_ids
        assert 'gb50011_story_minimum_seismic_shear_coefficient' in rule_ids
        assert 'gb50011_vertical_seismic_action' in rule_ids
        assert 'gb50011_vertical_seismic_member_forces' in rule_ids
        assert 'gb50011_pushover_final_compliance' in rule_ids
        assert 'gb50011_seismic_basic_action_combination_member_capacity' in rule_ids
        assert 'gb50011_seismic_combination_member_structured_capacity' in rule_ids
        assert 'gb50011_frame_joint_core_shear_capacity' in rule_ids
        assert 'gb50011_frame_joint_strong_column_weak_beam' in rule_ids
        assert 'gb50011_frame_member_strong_shear_weak_bending' in rule_ids
        assert 'gb50011_concrete_member_shear_compression_limit' in rule_ids
        assert 'gb50011_frame_column_axial_compression_ratio' in rule_ids
        assert 'gb50011_frame_column_shear_span_ratio' in rule_ids
        assert 'gb50011_frame_column_longitudinal_reinforcement' in rule_ids
        assert 'gb50011_frame_column_longitudinal_detailing' in rule_ids
        assert 'gb50011_frame_column_stirrup_detailing' in rule_ids
        assert 'gb50011_frame_column_stirrup_confined_zone_range' in rule_ids
        assert 'gb50011_frame_column_stirrup_volume_ratio' in rule_ids
        assert 'gb50011_frame_joint_core_stirrup_detailing' in rule_ids
        assert 'gb55002_concrete_frame_member_strength_grade' in rule_ids
        assert 'gb50011_frame_beam_section_geometry' in rule_ids
        assert 'gb50011_frame_beam_flat_beam_detailing' in rule_ids
        assert 'gb50011_frame_beam_longitudinal_reinforcement' in rule_ids
        assert 'gb50011_frame_beam_end_longitudinal_ductility' in rule_ids
        assert 'gb50011_frame_beam_through_joint_bar_diameter' in rule_ids
        assert 'gb50011_frame_beam_stirrup_detailing' in rule_ids
        assert 'gb50011_frame_column_section_geometry' in rule_ids
        assert 'gb50011_shear_wall_section_thickness' in rule_ids
        assert 'gb50011_shear_wall_axial_compression_ratio' in rule_ids
        assert 'gb50011_shear_wall_distributed_reinforcement' in rule_ids
        assert 'gb50011_shear_wall_boundary_element_detailing' in rule_ids
        assert 'gb50011_steel_member_seismic_detailing' in rule_ids


class TestCheckElementStructure:

    def test_two_check_groups(self):
        checker = MockCodeChecker()
        result = gb50011.check_element(checker, 'C1', {})
        assert len(result['checks']) == 2

    def test_seismic_group(self):
        checker = MockCodeChecker()
        result = gb50011.check_element(checker, 'C1', {})
        group1 = result['checks'][0]
        assert group1['name'] == '截面抗震验算'
        assert len(group1['items']) == 2

    def test_displacement_group(self):
        checker = MockCodeChecker()
        result = gb50011.check_element(checker, 'C1', {})
        group2 = result['checks'][1]
        assert group2['name'] == '位移验算'
        assert len(group2['items']) == 1


class TestClauseReferences:

    def test_axial_compression_clause(self):
        checker = MockCodeChecker()
        result = gb50011.check_element(checker, 'C1', {})
        items = result['checks'][0]['items']
        assert items[0]['clause'] == 'GB/T 50011-2010(2024) 6.3.6'

    def test_shear_span_clause(self):
        checker = MockCodeChecker()
        result = gb50011.check_element(checker, 'C1', {})
        items = result['checks'][0]['items']
        assert items[1]['clause'] == 'GB/T 50011-2010(2024) 6.3.7'

    def test_drift_clause(self):
        checker = MockCodeChecker()
        result = gb50011.check_element(checker, 'C1', {})
        items = result['checks'][1]['items']
        assert items[0]['clause'] == 'GB/T 50011-2010(2024) 5.5.1'


class TestCheckElementResult:

    def test_element_type_column(self):
        checker = MockCodeChecker()
        result = gb50011.check_element(checker, 'C1', {})
        assert result['elementType'] == 'column'

    def test_code_version(self):
        checker = MockCodeChecker()
        result = gb50011.check_element(checker, 'C1', {})
        assert result['code'] == 'GB/T 50011-2010(2024)'

    def test_all_pass_default(self):
        checker = MockCodeChecker()
        result = gb50011.check_element(checker, 'C1', {})
        assert result['status'] == 'pass'

    def test_fail_with_high_utilization(self):
        checker = MockCodeChecker(overrides={'C1': {'轴压比': 1.5}})
        result = gb50011.check_element(checker, 'C1', {})
        assert result['status'] == 'fail'

    def test_structured_seismic_combination_member_capacity_passes(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'memberDesignActionCombinations': {
                    'status': 'computed',
                    'cases': [
                        {
                            'name': 'gravity_plus_horizontal_seismic',
                            'memberActions': [
                                {
                                    'elementId': 'C1',
                                    'maxAbsAxialKN': 100.0,
                                    'maxAbsShearKN': 40.0,
                                    'maxAbsMomentKNm': 80.0,
                                },
                            ],
                        },
                    ],
                },
            },
            'elementData': {
                'C1': {
                    'type': 'beam',
                    'material': {'category': 'steel'},
                    'seismicCapacity': {
                        'axialCapacityKN': 500.0,
                        'shearCapacityKN': 100.0,
                        'momentCapacityKNm': 200.0,
                    },
                },
            },
        }

        result = gb50011.check_element(checker, 'C1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '抗震组合构件承载力')
        subcheck_statuses = {subcheck['name']: subcheck['status'] for subcheck in item['inputs']['subchecks']}
        assert result['status'] == 'pass'
        assert item['status'] == 'pass'
        assert subcheck_statuses['member_axial_capacity'] == 'pass'
        assert subcheck_statuses['member_shear_capacity'] == 'pass'
        assert subcheck_statuses['member_moment_capacity'] == 'pass'
        assert item['inputs']['controlling']['case'] == 'gravity_plus_horizontal_seismic'

    def test_structured_seismic_combination_member_capacity_fails_for_nested_shear_capacity(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'memberDesignActionCombinations': {
                    'status': 'computed',
                    'cases': [
                        {
                            'name': 'gravity_plus_horizontal_seismic',
                            'memberActions': [
                                {
                                    'elementId': 'C1',
                                    'maxAbsShearKN': 40.0,
                                },
                            ],
                        },
                    ],
                },
            },
            'elementData': {
                'C1': {
                    'type': 'beam',
                    'capacityChecks': [
                        {'shear': {'capacityKN': 25.0}},
                    ],
                },
            },
        }

        result = gb50011.check_element(checker, 'C1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '抗震组合构件承载力')
        controlling = item['inputs']['controlling']
        assert result['status'] == 'fail'
        assert item['status'] == 'fail'
        assert controlling['name'] == 'member_shear_capacity'
        assert controlling['demand'] == 40.0
        assert controlling['capacity'] == 25.0
        assert controlling['utilization'] == 1.6

    def test_structured_seismic_combination_member_capacity_applies_explicit_gamma_re(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'memberDesignActionCombinations': {
                    'status': 'computed',
                    'cases': [
                        {
                            'name': 'gravity_plus_horizontal_seismic',
                            'memberActions': [
                                {
                                    'elementId': 'C1',
                                    'maxAbsShearKN': 100.0,
                                },
                            ],
                        },
                    ],
                },
            },
            'elementData': {
                'C1': {
                    'type': 'beam',
                    'seismicCapacity': {
                        'shearCapacityKN': 100.0,
                        'gammaRE': 0.85,
                    },
                },
            },
        }

        result = gb50011.check_element(checker, 'C1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '抗震组合构件承载力')
        controlling = item['inputs']['controlling']
        assert result['status'] == 'pass'
        assert item['status'] == 'pass'
        assert controlling['name'] == 'member_shear_capacity'
        assert controlling['utilization'] == 0.85
        assert controlling['gammaRE'] == 0.85
        assert controlling['adjustedCapacity'] == 117.647059
        assert controlling['gammaRESource'] == 'element.seismicCapacity.gammaRE'

    def test_steel_member_seismic_detailing_passes_with_structured_limits(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'structuralFamily': 'steel-frame',
                    'seismicGrade': 2,
                },
            },
            'elementData': {
                'S1': {
                    'type': 'steel-beam',
                    'material': {'category': 'steel', 'grade': 'Q355'},
                    'steelSeismicDetailing': {
                        'memberSlendernessRatio': 70.0,
                        'memberSlendernessLimit': 120.0,
                        'flangeWidthThicknessRatio': 9.0,
                        'flangeWidthThicknessLimit': 10.0,
                        'webHeightThicknessRatio': 60.0,
                        'webHeightThicknessLimit': 72.0,
                    },
                },
            },
        }

        result = gb50011.check_element(checker, 'S1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '钢构件抗震构造限值')
        subcheck_statuses = {subcheck['name']: subcheck['status'] for subcheck in item['inputs']['subchecks']}
        assert result['status'] == 'pass'
        assert item['status'] == 'pass'
        assert subcheck_statuses['member_slenderness_ratio'] == 'pass'
        assert subcheck_statuses['flange_width_thickness_ratio'] == 'pass'
        assert subcheck_statuses['web_height_thickness_ratio'] == 'pass'
        assert item['inputs']['controlling']['name'] == 'flange_width_thickness_ratio'

    def test_steel_member_seismic_detailing_fails_when_structured_limit_exceeded(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'structuralFamily': 'steel-frame',
                    'seismicGrade': 1,
                },
            },
            'elementData': {
                'BR1': {
                    'type': 'steel-brace',
                    'material': {'category': 'steel', 'grade': 'Q355'},
                    'steelSeismicDetailing': {
                        'braceSlendernessRatio': 130.0,
                        'braceSlendernessLimit': 120.0,
                        'plateWidthThicknessRatio': 15.0,
                        'plateWidthThicknessLimit': 12.0,
                    },
                },
            },
        }

        result = gb50011.check_element(checker, 'BR1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '钢构件抗震构造限值')
        assert result['status'] == 'fail'
        assert item['status'] == 'fail'
        assert item['inputs']['controlling']['name'] == 'plate_width_thickness_ratio'
        assert item['inputs']['controlling']['utilization'] == 1.25

    def test_steel_member_seismic_detailing_requires_comparable_structured_limits(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'structuralFamily': 'steel-frame',
                },
            },
            'elementData': {
                'S1': {
                    'type': 'steel-column',
                    'material': {'category': 'steel', 'grade': 'Q355'},
                    'steelSeismicDetailing': {
                        'memberSlendernessRatio': 95.0,
                        'verificationSource': 'designer steel detailing table',
                    },
                },
            },
        }

        result = gb50011.check_element(checker, 'S1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '钢构件抗震构造限值')
        assert result['status'] == 'fail'
        assert item['status'] == 'not_applicable'
        assert item['inputs']['controlling']['name'] == 'member_slenderness_ratio'
        assert item['inputs']['controlling']['limit'] is None

    def test_frame_member_strong_shear_weak_bending_passes_with_structured_capacity_design(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'seismicGrade': 2,
                },
            },
            'elementData': {
                'B1': {
                    'type': 'beam',
                    'material': {'category': 'concrete', 'grade': 'C30'},
                    'strongShearWeakBending': {
                        'cases': [
                            {
                                'name': 'left-end',
                                'bendingControlledShearDemandKN': 520.0,
                                'shearCapacityKN': 650.0,
                            },
                            {
                                'name': 'right-end',
                                'bendingControlledShearDemandKN': 500.0,
                                'shearCapacityKN': 640.0,
                            },
                        ],
                    },
                },
            },
        }

        result = gb50011.check_element(checker, 'B1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '框架构件强剪弱弯受剪承载力')
        assert result['status'] == 'pass'
        assert item['status'] == 'pass'
        assert item['inputs']['elementType'] == 'beam'
        assert item['inputs']['controlling']['name'] == 'left-end'
        assert item['inputs']['controlling']['bendingControlledShearDemandKN'] == 520.0

    def test_frame_member_strong_shear_weak_bending_fails_with_structured_capacity_design(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'seismicGrade': 1,
                },
            },
            'elementData': {
                'C1': {
                    'type': 'column',
                    'material': {'category': 'concrete', 'grade': 'C30'},
                    'capacityDesign': {
                        'strongShearWeakBending': {
                            'capacityDesignShearDemandKN': 900.0,
                            'designShearCapacityKN': 720.0,
                        },
                    },
                },
            },
        }

        result = gb50011.check_element(checker, 'C1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '框架构件强剪弱弯受剪承载力')
        assert result['status'] == 'fail'
        assert item['status'] == 'fail'
        assert item['inputs']['controlling']['bendingControlledShearDemandKN'] == 900.0
        assert item['inputs']['controlling']['shearCapacityKN'] == 720.0

    def test_frame_member_strong_shear_weak_bending_requires_comparable_structured_data(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'seismicGrade': 2,
                },
            },
            'elementData': {
                'B1': {
                    'type': 'beam',
                    'material': {'category': 'concrete', 'grade': 'C30'},
                    'strongShearWeakBending': {
                        'verificationSource': 'designer capacity-design table',
                    },
                },
            },
        }

        result = gb50011.check_element(checker, 'B1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '框架构件强剪弱弯受剪承载力')
        assert result['status'] == 'fail'
        assert item['status'] == 'not_applicable'
        assert item['message'] == 'Structured strong-shear weak-bending data is present but does not include comparable shear demand/capacity or utilization.'

    def test_frame_member_strong_shear_weak_bending_ignores_generic_shear_data(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'seismicGrade': 2,
                },
            },
            'elementData': {
                'B1': {
                    'type': 'beam',
                    'material': {'category': 'concrete', 'grade': 'C30'},
                    'requiredShearKN': 520.0,
                    'shearCapacityKN': 650.0,
                },
            },
        }

        result = gb50011.check_element(checker, 'B1', context)

        item_names = [item['item'] for item in result['checks'][0]['items']]
        assert '框架构件强剪弱弯受剪承载力' not in item_names

    def test_concrete_member_shear_compression_limit_passes_for_structured_beam(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'seismicGrade': 2,
                },
                'memberDesignActionCombinations': {
                    'cases': [{
                        'name': 'gravity_plus_horizontal_seismic',
                        'memberActions': [{
                            'elementId': 'B1',
                            'maxAbsShearKN': 400.0,
                        }],
                    }],
                },
            },
            'elementData': {
                'B1': {
                    'type': 'beam',
                    'material': {'category': 'concrete', 'fc': 14.3},
                    'section': {
                        'width': 250.0,
                        'effectiveDepth': 550.0,
                    },
                },
            },
        }

        result = gb50011.check_element(checker, 'B1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '混凝土构件剪压比限值')
        assert result['status'] == 'pass'
        assert item['status'] == 'pass'
        assert item['inputs']['coefficient'] == 0.20
        assert item['inputs']['capacityKN'] == 462.647059
        assert item['inputs']['shearDemandSource'] == 'memberDesignActionCombinations.maxAbsShearKN'

    def test_concrete_member_shear_compression_limit_fails_for_short_column(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'seismicGrade': 1,
                },
                'memberDesignActionCombinations': {
                    'cases': [{
                        'name': 'gravity_plus_horizontal_seismic',
                        'memberActions': [{
                            'elementId': 'C1',
                            'maxAbsShearKN': 650.0,
                        }],
                    }],
                },
            },
            'elementData': {
                'C1': {
                    'type': 'column',
                    'material': {'category': 'concrete', 'fc': 14.3},
                    'section': {
                        'width': 500.0,
                        'effectiveDepth': 450.0,
                    },
                    'shearSpanRatio': 1.8,
                },
            },
        }

        result = gb50011.check_element(checker, 'C1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '混凝土构件剪压比限值')
        assert result['status'] == 'fail'
        assert item['status'] == 'fail'
        assert item['inputs']['coefficient'] == 0.15
        assert item['inputs']['shearSpanRatio'] == 1.8
        assert item['inputs']['capacityKN'] == 567.794118

    def test_concrete_member_shear_compression_limit_requires_comparable_structured_data(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'seismicGrade': 2,
                },
            },
            'elementData': {
                'B1': {
                    'type': 'beam',
                    'material': {'category': 'concrete', 'fc': 14.3},
                    'shearCompression': {
                        'verificationSource': 'designer section table',
                    },
                },
            },
        }

        result = gb50011.check_element(checker, 'B1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '混凝土构件剪压比限值')
        assert result['status'] == 'fail'
        assert item['status'] == 'not_applicable'
        assert item['inputs']['hasConcreteStrength'] is True
        assert item['inputs']['hasWidth'] is False
        assert item['inputs']['hasEffectiveDepth'] is False

    def test_frame_column_axial_compression_ratio_uses_combination_actions(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'seismicGrade': 2,
                },
                'memberDesignActionCombinations': {
                    'status': 'computed',
                    'cases': [
                        {
                            'name': 'gravity_plus_horizontal_seismic',
                            'memberActions': [
                                {
                                    'elementId': 'C1',
                                    'maxAbsAxialKN': 2000.0,
                                    'maxAbsMomentKNm': 12.0,
                                },
                            ],
                        },
                    ],
                },
            },
            'elementData': {
                'C1': {
                    'type': 'column',
                    'section': {'A': 250000.0},
                    'material': {'category': 'concrete', 'fc': 14.3},
                },
            },
        }

        result = gb50011.check_element(checker, 'C1', context)

        section_group = result['checks'][0]
        item = next(item for item in section_group['items'] if item['item'] == '框架柱轴压比限值')
        assert result['status'] == 'pass'
        assert item['status'] == 'pass'
        assert item['inputs']['seismicGrade'] == 2
        assert item['inputs']['limit'] == 0.75
        assert item['inputs']['axialCompressionRatio'] > 0.55

    def test_frame_column_axial_compression_ratio_can_fail(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'seismicGrade': 2,
                },
                'memberDesignActionCombinations': {
                    'status': 'computed',
                    'cases': [
                        {
                            'name': 'gravity_plus_horizontal_seismic',
                            'memberActions': [
                                {
                                    'elementId': 'C1',
                                    'maxAbsAxialKN': 3000.0,
                                },
                            ],
                        },
                    ],
                },
            },
            'elementData': {
                'C1': {
                    'type': 'column',
                    'section': {'A': 250000.0},
                    'material': {'category': 'concrete', 'fc': 14.3},
                },
            },
        }

        result = gb50011.check_element(checker, 'C1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '框架柱轴压比限值')
        assert result['status'] == 'fail'
        assert item['status'] == 'fail'
        assert item['utilization'] > 1.0

    def test_frame_column_axial_compression_ratio_reduces_limit_for_short_column(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'seismicGrade': 2,
                },
                'memberDesignActionCombinations': {
                    'status': 'computed',
                    'cases': [
                        {
                            'name': 'gravity_plus_horizontal_seismic',
                            'memberActions': [
                                {
                                    'elementId': 'C1',
                                    'maxAbsAxialKN': 2550.0,
                                },
                            ],
                        },
                    ],
                },
            },
            'elementData': {
                'C1': {
                    'type': 'column',
                    'shearSpanRatio': 2.0,
                    'section': {'A': 250000.0},
                    'material': {'category': 'concrete', 'fc': 14.3},
                },
            },
        }

        result = gb50011.check_element(checker, 'C1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '框架柱轴压比限值')
        assert result['status'] == 'fail'
        assert item['status'] == 'fail'
        assert item['inputs']['baseLimit'] == 0.75
        assert item['inputs']['limit'] == 0.7
        assert item['inputs']['shearSpanRatio'] == 2.0
        assert item['inputs']['shearSpanLimitAdjustment'] == -0.05

    def test_frame_column_shear_span_ratio_fails_when_special_study_required(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'seismicGrade': 2,
                },
                'memberDesignActionCombinations': {
                    'status': 'computed',
                    'cases': [
                        {
                            'name': 'gravity_plus_horizontal_seismic',
                            'memberActions': [
                                {
                                    'elementId': 'C1',
                                    'maxAbsAxialKN': 1000.0,
                                },
                            ],
                        },
                    ],
                },
            },
            'elementData': {
                'C1': {
                    'type': 'column',
                    'shearSpanRatio': 1.4,
                    'section': {'A': 250000.0},
                    'material': {'category': 'concrete', 'fc': 14.3},
                },
            },
        }

        result = gb50011.check_element(checker, 'C1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '框架柱剪跨比专项要求')
        assert result['status'] == 'fail'
        assert item['status'] == 'fail'
        assert item['inputs']['shearSpanRatio'] == 1.4
        assert item['inputs']['requiresSpecialStudy'] is True
        assert item['inputs']['requiresAxialRatioLimitReduction'] is True

    def test_frame_column_longitudinal_reinforcement_passes_for_grade_two(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'seismicGrade': 2,
                },
            },
            'elementData': {
                'C1': {
                    'type': 'column',
                    'section': {'A': 250000.0},
                    'material': {'category': 'concrete', 'grade': 'C30'},
                    'reinforcement': {
                        'longitudinal': {
                            'areaMm2': 2500.0,
                            'sideMinAreaMm2': 600.0,
                            'grade': 'HRB400',
                        },
                    },
                },
            },
        }

        result = gb50011.check_element(checker, 'C1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '框架柱纵筋构造')
        assert result['status'] == 'pass'
        assert item['status'] == 'pass'
        assert item['inputs']['baseLimitPercent'] == 0.8
        assert item['inputs']['rebarStrengthAdjustmentPercent'] == 0.05
        assert item['inputs']['totalLongitudinalRatioPercent'] == 1.0
        assert item['inputs']['sideMinLongitudinalRatioPercent'] == 0.24

    def test_frame_column_longitudinal_reinforcement_fails_for_low_total_and_side_ratios(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'seismicGrade': 2,
                },
            },
            'elementData': {
                'C1': {
                    'type': 'column',
                    'section': {'A': 250000.0},
                    'material': {'category': 'concrete', 'grade': 'C30'},
                    'reinforcement': {
                        'longitudinal': {
                            'areaMm2': 1600.0,
                            'sideMinAreaMm2': 400.0,
                            'grade': 'HRB400',
                        },
                    },
                },
            },
        }

        result = gb50011.check_element(checker, 'C1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '框架柱纵筋构造')
        subcheck_statuses = {subcheck['name']: subcheck['status'] for subcheck in item['inputs']['subchecks']}
        assert result['status'] == 'fail'
        assert item['status'] == 'fail'
        assert subcheck_statuses['column_total_longitudinal_ratio'] == 'fail'
        assert subcheck_statuses['column_each_side_longitudinal_ratio'] == 'fail'

    def test_frame_column_longitudinal_detailing_passes_for_grade_one_short_column(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'seismicGrade': 1,
                },
            },
            'elementData': {
                'C1': {
                    'type': 'column',
                    'shearSpanRatio': 2.0,
                    'section': {'width': 500.0, 'height': 500.0},
                    'material': {'category': 'concrete', 'grade': 'C30'},
                    'reinforcement': {
                        'longitudinal': {
                            'ratioPercent': 4.0,
                            'sideMinRatioPercent': 1.0,
                            'spacingMm': 180.0,
                            'isSymmetric': True,
                            'areaMm2': 1300.0,
                            'smallEccentricTension': True,
                            'calculatedAreaMm2': 1000.0,
                        },
                    },
                },
            },
        }

        result = gb50011.check_element(checker, 'C1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '框架柱纵筋补充构造')
        assert result['status'] == 'pass'
        assert item['status'] == 'pass'
        assert item['inputs']['totalLongitudinalRatioPercent'] == 4.0
        assert item['inputs']['sideMinLongitudinalRatioPercent'] == 1.0
        assert len(item['inputs']['subchecks']) == 5

    def test_frame_column_longitudinal_detailing_fails_for_grade_one_short_column(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'seismicGrade': 1,
                },
            },
            'elementData': {
                'C1': {
                    'type': 'column',
                    'shearSpanRatio': 2.0,
                    'section': {'width': 500.0, 'height': 500.0},
                    'material': {'category': 'concrete', 'grade': 'C30'},
                    'reinforcement': {
                        'longitudinal': {
                            'ratioPercent': 6.0,
                            'sideMinRatioPercent': 1.5,
                            'spacingMm': 250.0,
                            'isSymmetric': False,
                            'areaMm2': 2200.0,
                            'smallEccentricTension': True,
                            'calculatedAreaMm2': 2000.0,
                        },
                    },
                },
            },
        }

        result = gb50011.check_element(checker, 'C1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '框架柱纵筋补充构造')
        subcheck_statuses = {subcheck['name']: subcheck['status'] for subcheck in item['inputs']['subchecks']}
        assert result['status'] == 'fail'
        assert item['status'] == 'fail'
        assert subcheck_statuses['column_longitudinal_symmetric_configuration'] == 'fail'
        assert subcheck_statuses['column_longitudinal_spacing'] == 'fail'
        assert subcheck_statuses['column_total_longitudinal_ratio_max'] == 'fail'
        assert subcheck_statuses['column_grade_one_short_column_side_ratio_max'] == 'fail'
        assert subcheck_statuses['column_small_eccentric_tension_area_increase'] == 'fail'

    def test_frame_column_stirrup_detailing_passes_for_grade_two(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'seismicGrade': 2,
                },
            },
            'elementData': {
                'C1': {
                    'type': 'column',
                    'section': {'A': 250000.0},
                    'material': {'category': 'concrete', 'grade': 'C30'},
                    'reinforcement': {
                        'longitudinal': {'minDiameterMm': 16.0},
                        'stirrup': {'diameterMm': 8.0, 'spacingMm': 100.0},
                    },
                },
            },
        }

        result = gb50011.check_element(checker, 'C1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '框架柱箍筋加密区构造')
        assert result['status'] == 'pass'
        assert item['status'] == 'pass'
        assert item['inputs']['spacingLimitMm'] == 100.0
        assert item['inputs']['diameterLimitMm'] == 8.0

    def test_frame_column_stirrup_detailing_fails_for_spacing_and_diameter(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'seismicGrade': 2,
                },
            },
            'elementData': {
                'C1': {
                    'type': 'column',
                    'section': {'A': 250000.0},
                    'material': {'category': 'concrete', 'grade': 'C30'},
                    'reinforcement': {
                        'longitudinal': {'minDiameterMm': 16.0},
                        'stirrup': {'diameterMm': 6.0, 'spacingMm': 150.0},
                    },
                },
            },
        }

        result = gb50011.check_element(checker, 'C1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '框架柱箍筋加密区构造')
        subcheck_statuses = {subcheck['name']: subcheck['status'] for subcheck in item['inputs']['subchecks']}
        assert result['status'] == 'fail'
        assert item['status'] == 'fail'
        assert subcheck_statuses['column_confined_stirrup_spacing'] == 'fail'
        assert subcheck_statuses['column_confined_stirrup_diameter'] == 'fail'

    def test_frame_column_stirrup_confined_zone_range_passes_for_column_end(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'seismicGrade': 2,
                },
            },
            'elementData': {
                'C1': {
                    'type': 'column',
                    'clearHeightMm': 3000.0,
                    'section': {'width': 500.0, 'height': 500.0},
                    'material': {'category': 'concrete', 'grade': 'C30'},
                    'reinforcement': {
                        'stirrup': {'confinedLengthMm': 600.0},
                    },
                },
            },
        }

        result = gb50011.check_element(checker, 'C1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '框架柱箍筋加密区范围')
        assert result['status'] == 'pass'
        assert item['status'] == 'pass'
        assert item['inputs']['confinedLengthMm'] == 600.0
        assert item['inputs']['clearHeightMm'] == 3000.0

    def test_frame_column_stirrup_confined_zone_range_fails_for_short_column_full_height(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'seismicGrade': 2,
                },
            },
            'elementData': {
                'C1': {
                    'type': 'column',
                    'shearSpanRatio': 2.0,
                    'clearHeightMm': 3000.0,
                    'section': {'width': 500.0, 'height': 500.0},
                    'material': {'category': 'concrete', 'grade': 'C30'},
                    'reinforcement': {
                        'stirrup': {'confinedLengthMm': 1200.0},
                    },
                },
            },
        }

        result = gb50011.check_element(checker, 'C1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '框架柱箍筋加密区范围')
        subcheck_statuses = {subcheck['name']: subcheck['status'] for subcheck in item['inputs']['subchecks']}
        assert result['status'] == 'fail'
        assert item['status'] == 'fail'
        assert subcheck_statuses['column_confined_zone_full_height'] == 'fail'
        assert item['inputs']['shearSpanRatio'] == 2.0

    def test_frame_column_stirrup_volume_ratio_passes_for_grade_two(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'seismicGrade': 2,
                },
            },
            'elementData': {
                'C1': {
                    'type': 'column',
                    'section': {'width': 500.0, 'height': 500.0},
                    'material': {'category': 'concrete', 'grade': 'C30'},
                    'reinforcement': {
                        'longitudinal': {'minDiameterMm': 16.0},
                        'stirrup': {
                            'volumeRatioPercent': 0.75,
                            'nonConfinedVolumeRatioPercent': 0.40,
                            'nonConfinedSpacingMm': 150.0,
                            'axialCompressionRatio': 0.6,
                            'fyvMPa': 360.0,
                        },
                    },
                },
            },
        }

        result = gb50011.check_element(checker, 'C1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '框架柱箍筋体积配箍率')
        assert result['status'] == 'pass'
        assert item['status'] == 'pass'
        assert item['inputs']['lambdaV'] == 0.13
        assert item['inputs']['fcForFormulaMPa'] == 16.7
        assert len(item['inputs']['subchecks']) == 4

    def test_frame_column_stirrup_volume_ratio_fails_for_grade_two_shortage(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'seismicGrade': 2,
                },
            },
            'elementData': {
                'C1': {
                    'type': 'column',
                    'section': {'width': 500.0, 'height': 500.0},
                    'material': {'category': 'concrete', 'grade': 'C30'},
                    'reinforcement': {
                        'longitudinal': {'minDiameterMm': 16.0},
                        'stirrup': {
                            'volumeRatioPercent': 0.45,
                            'nonConfinedVolumeRatioPercent': 0.10,
                            'nonConfinedSpacingMm': 220.0,
                            'axialCompressionRatio': 0.8,
                            'fyvMPa': 360.0,
                        },
                    },
                },
            },
        }

        result = gb50011.check_element(checker, 'C1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '框架柱箍筋体积配箍率')
        subcheck_statuses = {subcheck['name']: subcheck['status'] for subcheck in item['inputs']['subchecks']}
        assert result['status'] == 'fail'
        assert item['status'] == 'fail'
        assert subcheck_statuses['column_confined_stirrup_volume_ratio_minimum'] == 'fail'
        assert subcheck_statuses['column_confined_stirrup_volume_ratio_formula'] == 'fail'
        assert subcheck_statuses['column_non_confined_stirrup_volume_ratio'] == 'fail'
        assert subcheck_statuses['column_non_confined_stirrup_spacing'] == 'fail'

    def test_frame_joint_core_stirrup_detailing_passes_for_grade_two(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'seismicGrade': 2,
                },
            },
            'elementData': {
                'J1': {
                    'type': 'joint',
                    'material': {'category': 'concrete', 'grade': 'C30'},
                    'reinforcement': {
                        'jointCore': {
                            'spacingMm': 100.0,
                            'diameterMm': 8.0,
                            'longitudinalMinDiameterMm': 16.0,
                            'characteristicValue': 0.11,
                            'volumeRatioPercent': 0.55,
                            'shearDemandKN': 500.0,
                            'shearCapacityKN': 700.0,
                        },
                    },
                },
            },
        }

        result = gb50011.check_element(checker, 'J1', context)

        capacity_item = next(item for item in result['checks'][0]['items'] if item['item'] == '框架节点核芯区截面抗震验算')
        item = next(item for item in result['checks'][0]['items'] if item['item'] == '框架节点核芯区箍筋构造')
        assert result['status'] == 'pass'
        assert capacity_item['status'] == 'pass'
        assert capacity_item['inputs']['shearDemandKN'] == 500.0
        assert capacity_item['inputs']['shearCapacityKN'] == 700.0
        assert item['status'] == 'pass'
        assert item['inputs']['seismicGrade'] == 2
        assert item['inputs']['characteristicValue'] == 0.11
        assert item['inputs']['volumeRatioPercent'] == 0.55
        assert len(item['inputs']['subchecks']) == 4

    def test_frame_joint_core_shear_capacity_requires_structured_verification_for_grade_two(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'seismicGrade': 2,
                },
            },
            'elementData': {
                'J1': {
                    'type': 'joint',
                    'material': {'category': 'concrete', 'grade': 'C30'},
                    'jointCore': {'verificationSource': 'designer schedule'},
                },
            },
        }

        result = gb50011.check_element(checker, 'J1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '框架节点核芯区截面抗震验算')
        assert result['status'] == 'fail'
        assert item['status'] == 'not_applicable'
        assert item['inputs']['required'] is True
        assert item['message'] == 'Structured joint-core shear demand/capacity or utilization is unavailable.'

    def test_frame_joint_core_shear_capacity_fails_when_utilization_exceeds_one(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'seismicGrade': 2,
                },
            },
            'elementData': {
                'J1': {
                    'type': 'joint',
                    'material': {'category': 'concrete', 'grade': 'C30'},
                    'jointCore': {
                        'shearDemandKN': 900.0,
                        'shearCapacityKN': 600.0,
                    },
                },
            },
        }

        result = gb50011.check_element(checker, 'J1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '框架节点核芯区截面抗震验算')
        assert result['status'] == 'fail'
        assert item['status'] == 'fail'
        assert item['utilization'] == 1.5
        assert item['inputs']['required'] is True

    def test_frame_joint_strong_column_weak_beam_passes_with_structured_ratio(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'seismicGrade': 2,
                },
            },
            'elementData': {
                'J1': {
                    'type': 'joint',
                    'material': {'category': 'concrete', 'grade': 'C30'},
                    'jointCore': {
                        'shearDemandKN': 300.0,
                        'shearCapacityKN': 600.0,
                    },
                    'strongColumnWeakBeam': {
                        'directions': [
                            {
                                'direction': 'clockwise',
                                'columnBeamMomentRatio': 1.62,
                                'requiredColumnBeamMomentRatio': 1.5,
                            },
                            {
                                'direction': 'counterClockwise',
                                'columnBeamMomentRatio': 1.58,
                                'requiredColumnBeamMomentRatio': 1.5,
                            },
                        ],
                    },
                },
            },
        }

        result = gb50011.check_element(checker, 'J1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '框架节点强柱弱梁弯矩关系')
        assert result['status'] == 'pass'
        assert item['status'] == 'pass'
        assert item['inputs']['seismicGrade'] == 2
        assert item['inputs']['controlling']['name'] == 'counterClockwise'
        assert item['inputs']['controlling']['requiredColumnBeamMomentRatio'] == 1.5

    def test_frame_joint_strong_column_weak_beam_fails_with_structured_moments(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'seismicGrade': 1,
                },
            },
            'elementData': {
                'J1': {
                    'type': 'joint',
                    'material': {'category': 'concrete', 'grade': 'C30'},
                    'jointCore': {
                        'shearDemandKN': 300.0,
                        'shearCapacityKN': 600.0,
                    },
                    'capacityDesign': {
                        'strongColumnWeakBeam': {
                            'sumColumnMomentCapacityKNm': 1200.0,
                            'sumBeamMomentCapacityKNm': 850.0,
                            'etaC': 1.7,
                        },
                    },
                },
            },
        }

        result = gb50011.check_element(checker, 'J1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '框架节点强柱弱梁弯矩关系')
        assert result['status'] == 'fail'
        assert item['status'] == 'fail'
        assert item['inputs']['controlling']['sumColumnMomentCapacityKNm'] == 1200.0
        assert item['inputs']['controlling']['sumBeamMomentCapacityKNm'] == 850.0
        assert item['inputs']['controlling']['requiredColumnBeamMomentRatio'] == 1.7

    def test_frame_joint_strong_column_weak_beam_requires_comparable_structured_data(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'seismicGrade': 2,
                },
            },
            'elementData': {
                'J1': {
                    'type': 'joint',
                    'material': {'category': 'concrete', 'grade': 'C30'},
                    'jointCore': {
                        'shearDemandKN': 300.0,
                        'shearCapacityKN': 600.0,
                    },
                    'strongColumnWeakBeam': {
                        'verificationSource': 'designer schedule',
                    },
                },
            },
        }

        result = gb50011.check_element(checker, 'J1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '框架节点强柱弱梁弯矩关系')
        assert result['status'] == 'fail'
        assert item['status'] == 'not_applicable'
        assert item['message'] == 'Structured strong-column weak-beam data is present but does not include a comparable utilization, required ratio, or column/beam moment-capacity pair.'

    def test_frame_joint_core_stirrup_detailing_fails_for_grade_two_short_column(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'seismicGrade': 2,
                },
            },
            'elementData': {
                'J1': {
                    'type': 'joint',
                    'material': {'category': 'concrete', 'grade': 'C30'},
                    'reinforcement': {
                        'jointCore': {
                            'spacingMm': 140.0,
                            'diameterMm': 6.0,
                            'longitudinalMinDiameterMm': 16.0,
                            'characteristicValue': 0.08,
                            'volumeRatioPercent': 0.45,
                            'shearSpanRatio': 2.0,
                            'adjacentColumnEndMaxVolumeRatioPercent': 0.8,
                        },
                    },
                },
            },
        }

        result = gb50011.check_element(checker, 'J1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '框架节点核芯区箍筋构造')
        subcheck_statuses = {subcheck['name']: subcheck['status'] for subcheck in item['inputs']['subchecks']}
        assert result['status'] == 'fail'
        assert item['status'] == 'fail'
        assert subcheck_statuses['joint_core_stirrup_spacing'] == 'fail'
        assert subcheck_statuses['joint_core_stirrup_diameter'] == 'fail'
        assert subcheck_statuses['joint_core_stirrup_characteristic_value'] == 'fail'
        assert subcheck_statuses['joint_core_stirrup_volume_ratio'] == 'fail'
        assert subcheck_statuses['joint_core_short_column_volume_ratio'] == 'fail'

    def test_concrete_frame_member_strength_grade_passes_for_grade_two_c30(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'seismicGrade': 2,
                },
            },
            'elementData': {
                'C1': {
                    'type': 'column',
                    'section': {'A': 250000.0},
                    'material': {'category': 'concrete', 'grade': 'C30'},
                },
            },
        }

        result = gb50011.check_element(checker, 'C1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '框架梁柱混凝土强度等级')
        assert result['status'] == 'pass'
        assert item['status'] == 'pass'
        assert item['inputs']['requiredGrade'] == 'C30'
        assert item['inputs']['actual'] == 'C30'
        assert item['inputs']['seismicGrade'] == 2

    def test_concrete_frame_member_strength_grade_fails_for_grade_two_c25(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'seismicGrade': 2,
                },
            },
            'elementData': {
                'C1': {
                    'type': 'column',
                    'section': {'A': 250000.0},
                    'material': {'category': 'concrete', 'grade': 'C25'},
                },
            },
        }

        result = gb50011.check_element(checker, 'C1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '框架梁柱混凝土强度等级')
        assert result['status'] == 'fail'
        assert item['status'] == 'fail'
        assert item['utilization'] > 1.0
        assert item['inputs']['actual'] == 'C25'

    def test_concrete_frame_member_strength_grade_skips_grade_three_member(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'seismicGrade': 3,
                },
            },
            'elementData': {
                'C1': {
                    'type': 'column',
                    'section': {'A': 250000.0},
                    'material': {'category': 'concrete', 'grade': 'C25'},
                },
            },
        }

        result = gb50011.check_element(checker, 'C1', context)

        item_names = [item['item'] for group in result['checks'] for item in group['items']]
        assert '框架梁柱混凝土强度等级' not in item_names
        assert result['status'] == 'pass'

    def test_frame_beam_section_geometry_passes_for_valid_dimensions(self):
        checker = MockCodeChecker()
        context = {
            'elementData': {
                'B1': {
                    'type': 'beam',
                    'length': 6000.0,
                    'section': {'width': 250.0, 'height': 600.0},
                    'material': {'category': 'concrete', 'grade': 'C30'},
                },
            },
        }

        result = gb50011.check_element(checker, 'B1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '框架梁截面尺寸')
        assert result['status'] == 'pass'
        assert item['status'] == 'pass'
        assert item['inputs']['widthMm'] == 250.0
        assert item['inputs']['heightMm'] == 600.0
        assert item['inputs']['spanMm'] == 6000.0
        assert len(item['inputs']['subchecks']) == 3

    def test_frame_beam_section_geometry_fails_for_invalid_dimensions(self):
        checker = MockCodeChecker()
        context = {
            'elementData': {
                'B1': {
                    'type': 'beam',
                    'length': 3200.0,
                    'section': {'width': 180.0, 'height': 900.0},
                    'material': {'category': 'concrete', 'grade': 'C30'},
                },
            },
        }

        result = gb50011.check_element(checker, 'B1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '框架梁截面尺寸')
        subcheck_statuses = {subcheck['name']: subcheck['status'] for subcheck in item['inputs']['subchecks']}
        assert result['status'] == 'fail'
        assert item['status'] == 'fail'
        assert subcheck_statuses['beam_width'] == 'fail'
        assert subcheck_statuses['beam_depth_width_ratio'] == 'fail'
        assert subcheck_statuses['beam_clear_span_depth_ratio'] == 'fail'

    def test_frame_beam_flat_beam_detailing_passes_for_grade_two(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'seismicGrade': 2,
                },
            },
            'elementData': {
                'B1': {
                    'type': 'beam',
                    'section': {'width': 700.0, 'height': 400.0},
                    'material': {'category': 'concrete', 'grade': 'C30'},
                    'reinforcement': {
                        'flatBeam': {
                            'isFlatBeam': True,
                            'columnWidthMm': 400.0,
                            'columnLongitudinalDiameterMm': 20.0,
                            'castInPlaceFloor': True,
                            'centerlineAligned': True,
                            'bidirectional': True,
                        },
                    },
                },
            },
        }

        result = gb50011.check_element(checker, 'B1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '框架扁梁构造')
        assert result['status'] == 'pass'
        assert item['status'] == 'pass'
        assert item['inputs']['columnWidthMm'] == 400.0
        assert item['inputs']['columnLongitudinalDiameterMm'] == 20.0
        assert len(item['inputs']['subchecks']) == 7

    def test_frame_beam_flat_beam_detailing_fails_for_grade_one_invalid_dimensions(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'seismicGrade': 1,
                },
            },
            'elementData': {
                'B1': {
                    'type': 'beam',
                    'section': {'width': 950.0, 'height': 300.0},
                    'material': {'category': 'concrete', 'grade': 'C30'},
                    'reinforcement': {
                        'flatBeam': {
                            'isFlatBeam': True,
                            'columnWidthMm': 400.0,
                            'columnLongitudinalDiameterMm': 25.0,
                            'castInPlaceFloor': False,
                            'centerlineAligned': False,
                            'bidirectional': False,
                        },
                    },
                },
            },
        }

        result = gb50011.check_element(checker, 'B1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '框架扁梁构造')
        subcheck_statuses = {subcheck['name']: subcheck['status'] for subcheck in item['inputs']['subchecks']}
        assert result['status'] == 'fail'
        assert item['status'] == 'fail'
        assert subcheck_statuses['flat_beam_width_2bc'] == 'fail'
        assert subcheck_statuses['flat_beam_width_bc_plus_hb'] == 'fail'
        assert subcheck_statuses['flat_beam_depth_column_bar'] == 'fail'
        assert subcheck_statuses['flat_beam_grade_one_restriction'] == 'fail'
        assert subcheck_statuses['flat_beam_cast_in_place_floor'] == 'fail'
        assert subcheck_statuses['flat_beam_centerline_alignment'] == 'fail'
        assert subcheck_statuses['flat_beam_bidirectional_arrangement'] == 'fail'

    def test_frame_beam_longitudinal_reinforcement_passes_for_grade_two(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'seismicGrade': 2,
                },
            },
            'elementData': {
                'B1': {
                    'type': 'beam',
                    'section': {'width': 250.0, 'height': 600.0},
                    'material': {'category': 'concrete', 'grade': 'C30'},
                    'reinforcement': {
                        'topContinuous': {'count': 2, 'diameterMm': 14.0},
                        'bottomContinuous': {'count': 2, 'diameterMm': 14.0},
                        'topEndMaxAreaMm2': 1200.0,
                        'bottomEndMaxAreaMm2': 1200.0,
                    },
                },
            },
        }

        result = gb50011.check_element(checker, 'B1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '框架梁贯通纵筋构造')
        assert result['status'] == 'pass'
        assert item['status'] == 'pass'
        assert item['inputs']['seismicGrade'] == 2
        assert item['inputs']['requiredDiameterMm'] == 14.0

    def test_frame_beam_longitudinal_reinforcement_fails_for_grade_two_shortage(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'seismicGrade': 2,
                },
            },
            'elementData': {
                'B1': {
                    'type': 'beam',
                    'section': {'width': 250.0, 'height': 600.0},
                    'material': {'category': 'concrete', 'grade': 'C30'},
                    'reinforcement': {
                        'topContinuous': {'count': 1, 'diameterMm': 12.0, 'areaMm2': 150.0},
                        'bottomContinuous': {'count': 2, 'diameterMm': 14.0, 'areaMm2': 500.0},
                        'topEndMaxAreaMm2': 800.0,
                        'bottomEndMaxAreaMm2': 1200.0,
                    },
                },
            },
        }

        result = gb50011.check_element(checker, 'B1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '框架梁贯通纵筋构造')
        subcheck_statuses = {subcheck['name']: subcheck['status'] for subcheck in item['inputs']['subchecks']}
        assert result['status'] == 'fail'
        assert item['status'] == 'fail'
        assert subcheck_statuses['top_continuous_bar_count'] == 'fail'
        assert subcheck_statuses['top_continuous_bar_diameter'] == 'fail'
        assert subcheck_statuses['top_continuous_area_ratio'] == 'fail'
        assert subcheck_statuses['bottom_continuous_area_ratio'] == 'pass'

    def test_frame_beam_end_longitudinal_ductility_passes_for_grade_two(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'seismicGrade': 2,
                },
            },
            'elementData': {
                'B1': {
                    'type': 'beam',
                    'section': {'width': 250.0, 'height': 600.0},
                    'material': {'category': 'concrete', 'grade': 'C30'},
                    'reinforcement': {
                        'endLongitudinal': {
                            'compressionZoneRatio': 0.30,
                            'bottomTopAreaRatio': 0.35,
                        },
                        'endTensionReinforcementRatioPercent': 2.0,
                    },
                },
            },
        }

        result = gb50011.check_element(checker, 'B1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '框架梁端纵筋延性构造')
        assert result['status'] == 'pass'
        assert item['status'] == 'pass'
        assert item['inputs']['seismicGrade'] == 2
        assert item['inputs']['compressionZoneRatioLimit'] == 0.35
        assert item['inputs']['bottomTopAreaRatioLimit'] == 0.3
        assert item['inputs']['endTensionReinforcementRatioPercentLimit'] == 2.5

    def test_frame_beam_end_longitudinal_ductility_fails_for_grade_two_shortage(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'seismicGrade': 2,
                },
            },
            'elementData': {
                'B1': {
                    'type': 'beam',
                    'section': {'width': 250.0, 'height': 600.0},
                    'material': {'category': 'concrete', 'grade': 'C30'},
                    'reinforcement': {
                        'endLongitudinal': {
                            'compressionZoneRatio': 0.40,
                            'bottomTopAreaRatio': 0.20,
                        },
                        'endTensionReinforcementRatioPercent': 2.8,
                    },
                },
            },
        }

        result = gb50011.check_element(checker, 'B1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '框架梁端纵筋延性构造')
        subcheck_statuses = {subcheck['name']: subcheck['status'] for subcheck in item['inputs']['subchecks']}
        assert result['status'] == 'fail'
        assert item['status'] == 'fail'
        assert subcheck_statuses['beam_end_compression_zone_ratio'] == 'fail'
        assert subcheck_statuses['beam_end_bottom_top_area_ratio'] == 'fail'
        assert subcheck_statuses['beam_end_tension_reinforcement_ratio'] == 'fail'

    def test_frame_beam_through_joint_bar_diameter_passes_for_grade_two(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'seismicGrade': 2,
                },
            },
            'elementData': {
                'B1': {
                    'type': 'beam',
                    'section': {'width': 250.0, 'height': 600.0},
                    'material': {'category': 'concrete', 'grade': 'C30'},
                    'reinforcement': {
                        'throughJoint': {
                            'diameterMm': 18.0,
                            'columnDimensionMm': 400.0,
                        },
                    },
                },
            },
        }

        result = gb50011.check_element(checker, 'B1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '框架梁贯通中柱纵筋直径')
        assert result['status'] == 'pass'
        assert item['status'] == 'pass'
        assert item['inputs']['diameterLimitMm'] == 20.0

    def test_frame_beam_through_joint_bar_diameter_fails_for_grade_two(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'seismicGrade': 2,
                },
            },
            'elementData': {
                'B1': {
                    'type': 'beam',
                    'section': {'width': 250.0, 'height': 600.0},
                    'material': {'category': 'concrete', 'grade': 'C30'},
                    'reinforcement': {
                        'throughJoint': {
                            'diameterMm': 25.0,
                            'columnDimensionMm': 400.0,
                        },
                    },
                },
            },
        }

        result = gb50011.check_element(checker, 'B1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '框架梁贯通中柱纵筋直径')
        assert result['status'] == 'fail'
        assert item['status'] == 'fail'
        assert item['inputs']['barDiameterMm'] == 25.0
        assert item['inputs']['diameterLimitMm'] == 20.0

    def test_frame_beam_stirrup_detailing_passes_for_grade_two(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'seismicGrade': 2,
                },
            },
            'elementData': {
                'B1': {
                    'type': 'beam',
                    'section': {'width': 250.0, 'height': 600.0},
                    'material': {'category': 'concrete', 'grade': 'C30'},
                    'reinforcement': {
                        'topContinuous': {'count': 2, 'diameterMm': 16.0},
                        'bottomContinuous': {'count': 2, 'diameterMm': 16.0},
                        'endStirrup': {
                            'diameterMm': 8.0,
                            'spacingMm': 100.0,
                            'confinedLengthMm': 900.0,
                            'legSpacingMm': 200.0,
                            'firstStirrupDistanceMm': 50.0,
                            'hookAngleDeg': 135.0,
                            'hookStraightLengthMm': 80.0,
                        },
                    },
                },
            },
        }

        result = gb50011.check_element(checker, 'B1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '框架梁箍筋加密区构造')
        assert result['status'] == 'pass'
        assert item['status'] == 'pass'
        assert item['inputs']['spacingLimitMm'] == 100.0
        assert item['inputs']['longitudinalDiameterMm'] == 16.0
        assert len(item['inputs']['subchecks']) == 7

    def test_frame_beam_stirrup_detailing_fails_for_grade_two_shortage(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'seismicGrade': 2,
                },
            },
            'elementData': {
                'B1': {
                    'type': 'beam',
                    'section': {'width': 250.0, 'height': 600.0},
                    'material': {'category': 'concrete', 'grade': 'C30'},
                    'reinforcement': {
                        'topContinuous': {'count': 2, 'diameterMm': 16.0},
                        'bottomContinuous': {'count': 2, 'diameterMm': 16.0},
                        'endTensionReinforcementRatioPercent': 2.5,
                        'endStirrup': {
                            'diameterMm': 8.0,
                            'spacingMm': 160.0,
                            'confinedLengthMm': 700.0,
                            'legSpacingMm': 300.0,
                            'firstStirrupDistanceMm': 80.0,
                            'hookAngleDeg': 90.0,
                            'hookStraightLengthMm': 60.0,
                        },
                    },
                },
            },
        }

        result = gb50011.check_element(checker, 'B1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '框架梁箍筋加密区构造')
        subcheck_statuses = {subcheck['name']: subcheck['status'] for subcheck in item['inputs']['subchecks']}
        assert result['status'] == 'fail'
        assert item['status'] == 'fail'
        assert subcheck_statuses['beam_end_stirrup_confined_length'] == 'fail'
        assert subcheck_statuses['beam_end_stirrup_spacing'] == 'fail'
        assert subcheck_statuses['beam_end_stirrup_diameter'] == 'fail'
        assert subcheck_statuses['beam_end_stirrup_leg_spacing'] == 'fail'
        assert subcheck_statuses['beam_first_stirrup_distance'] == 'fail'
        assert subcheck_statuses['beam_stirrup_hook_angle'] == 'fail'
        assert subcheck_statuses['beam_stirrup_hook_straight_length'] == 'fail'

    def test_frame_column_section_geometry_passes_for_grade_two_tall_building(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'seismicGrade': 2,
                    'storyCount': 3,
                },
            },
            'elementData': {
                'C1': {
                    'type': 'column',
                    'section': {'width': 450.0, 'height': 500.0},
                    'material': {'category': 'concrete', 'grade': 'C30'},
                },
            },
        }

        result = gb50011.check_element(checker, 'C1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '框架柱截面尺寸')
        assert result['status'] == 'pass'
        assert item['status'] == 'pass'
        assert item['inputs']['shortSideMm'] == 450.0
        assert item['inputs']['seismicGrade'] == 2
        assert item['inputs']['storyCount'] == 3

    def test_frame_column_section_geometry_fails_for_small_grade_two_tall_building_column(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'seismicGrade': 2,
                    'storyCount': 3,
                },
            },
            'elementData': {
                'C1': {
                    'type': 'column',
                    'section': {'width': 350.0, 'height': 500.0},
                    'material': {'category': 'concrete', 'grade': 'C30'},
                },
            },
        }

        result = gb50011.check_element(checker, 'C1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '框架柱截面尺寸')
        subcheck_statuses = {subcheck['name']: subcheck['status'] for subcheck in item['inputs']['subchecks']}
        assert result['status'] == 'fail'
        assert item['status'] == 'fail'
        assert subcheck_statuses['column_min_side'] == 'fail'
        assert subcheck_statuses['column_long_short_side_ratio'] == 'pass'

    def test_frame_column_section_geometry_uses_300mm_for_grade_four_or_low_story(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'seismicGrade': 4,
                    'storyCount': 5,
                },
            },
            'elementData': {
                'C1': {
                    'type': 'column',
                    'section': {'width': 320.0, 'height': 600.0},
                    'material': {'category': 'concrete', 'grade': 'C30'},
                },
            },
        }

        result = gb50011.check_element(checker, 'C1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '框架柱截面尺寸')
        min_side = next(subcheck for subcheck in item['inputs']['subchecks'] if subcheck['name'] == 'column_min_side')
        assert result['status'] == 'pass'
        assert min_side['limit'] == 300.0

    def test_frame_column_section_geometry_fails_for_long_short_side_ratio(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'seismicGrade': 3,
                    'storyCount': 2,
                },
            },
            'elementData': {
                'C1': {
                    'type': 'column',
                    'section': {'width': 300.0, 'height': 1000.0},
                    'material': {'category': 'concrete', 'grade': 'C30'},
                },
            },
        }

        result = gb50011.check_element(checker, 'C1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '框架柱截面尺寸')
        subcheck_statuses = {subcheck['name']: subcheck['status'] for subcheck in item['inputs']['subchecks']}
        assert result['status'] == 'fail'
        assert subcheck_statuses['column_min_side'] == 'pass'
        assert subcheck_statuses['column_long_short_side_ratio'] == 'fail'


class TestShearWallDetailing:

    def test_shear_wall_detailing_passes_for_grade_two_wall(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'structuralFamily': 'concrete-shear-wall',
                    'seismicGrade': 2,
                },
            },
            'elementData': {
                'W1': {
                    'type': 'shear-wall',
                    'storyHeightMm': 3600.0,
                    'section': {'thickness': 200.0},
                    'material': {'category': 'concrete', 'grade': 'C30'},
                    'reinforcement': {
                        'wall': {
                            'doubleLayer': True,
                            'tie': {'diameterMm': 6.0, 'spacingMm': 500.0},
                            'verticalDistributed': {'ratioPercent': 0.28, 'spacingMm': 200.0, 'diameterMm': 10.0},
                            'horizontalDistributed': {'ratioPercent': 0.26, 'spacingMm': 220.0, 'diameterMm': 10.0},
                            'boundaryElement': {
                                'id': 'left-edge',
                                'longitudinal': {
                                    'ratioPercent': 1.1,
                                    'diameterMm': 16.0,
                                },
                                'minLongitudinalRatioPercent': 1.0,
                                'minLongitudinalDiameterMm': 14.0,
                                'hoop': {
                                    'diameterMm': 8.0,
                                    'spacingMm': 100.0,
                                    'volumetricRatioPercent': 1.2,
                                },
                                'maxHoopSpacingMm': 120.0,
                                'minHoopDiameterMm': 8.0,
                                'minVolumetricRatioPercent': 1.0,
                            },
                        },
                    },
                },
            },
        }

        result = gb50011.check_element(checker, 'W1', context)

        section_items = result['checks'][0]['items']
        thickness_item = next(item for item in section_items if item['item'] == '抗震墙墙厚')
        reinforcement_item = next(item for item in section_items if item['item'] == '抗震墙分布钢筋构造')
        boundary_item = next(item for item in section_items if item['item'] == '抗震墙边缘构件构造')
        assert result['status'] == 'pass'
        assert thickness_item['status'] == 'pass'
        assert reinforcement_item['status'] == 'pass'
        assert boundary_item['status'] == 'pass'
        assert boundary_item['inputs']['boundaryElementCount'] == 1
        assert boundary_item['inputs']['controlling']['boundary'] == 'left-edge'
        assert reinforcement_item['inputs']['ratioLimitPercent'] == 0.25

    def test_shear_wall_axial_compression_ratio_uses_structured_limit(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'structuralFamily': 'concrete-shear-wall',
                    'seismicGrade': 2,
                },
                'memberDesignActionCombinations': {
                    'cases': [{
                        'name': '1.2G+1.3Eh',
                        'memberActions': [{
                            'elementId': 'W1',
                            'maxAbsAxialKN': 3000.0,
                        }],
                    }],
                },
            },
            'elementData': {
                'W1': {
                    'type': 'shear-wall',
                    'section': {
                        'thickness': 200.0,
                    },
                    'material': {'category': 'concrete', 'fc': 14.3},
                    'reinforcement': {
                        'wall': {
                            'wallLengthMm': 3000.0,
                            'axialCompressionRatioLimit': 0.45,
                        },
                    },
                },
            },
        }

        result = gb50011.check_element(checker, 'W1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '抗震墙轴压比限值')
        assert result['status'] == 'pass'
        assert item['status'] == 'pass'
        assert item['inputs']['ratioSource'] == 'memberDesignActionCombinations/section/material'
        assert abs(item['inputs']['axialCompressionRatio'] - (3000.0 / (14.3 * 200.0 * 3000.0 / 1000.0))) < 1.0e-6
        assert item['inputs']['limit'] == 0.45

    def test_shear_wall_axial_compression_ratio_without_limit_is_not_applicable(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'structuralFamily': 'concrete-shear-wall',
                    'seismicGrade': 2,
                },
            },
            'elementData': {
                'W1': {
                    'type': 'shear-wall',
                    'section': {'thickness': 200.0},
                    'material': {'category': 'concrete', 'grade': 'C30'},
                    'axialCompressionRatio': 0.40,
                },
            },
        }

        result = gb50011.check_element(checker, 'W1', context)

        item = next(item for item in result['checks'][0]['items'] if item['item'] == '抗震墙轴压比限值')
        assert result['status'] == 'fail'
        assert item['status'] == 'not_applicable'
        assert item['inputs']['axialCompressionRatio'] == 0.40
        assert item['inputs']['limit'] is None

    def test_shear_wall_detailing_fails_for_bottom_strengthened_shortage(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'structuralFamily': 'concrete-shear-wall',
                    'seismicGrade': 2,
                },
            },
            'elementData': {
                'W1': {
                    'type': 'shear-wall',
                    'storyHeightMm': 3600.0,
                    'section': {'thickness': 150.0},
                    'material': {'category': 'concrete', 'grade': 'C30'},
                    'reinforcement': {
                        'wall': {
                            'isBottomStrengthenedZone': True,
                            'hasEndColumn': False,
                            'isPartialFrameSupportedBottomStrengthenedZone': True,
                            'doubleLayer': False,
                            'tie': {'diameterMm': 5.0, 'spacingMm': 700.0},
                            'verticalDistributed': {'ratioPercent': 0.20, 'spacingMm': 250.0, 'diameterMm': 6.0},
                            'horizontalDistributed': {'ratioPercent': 0.25, 'spacingMm': 220.0, 'diameterMm': 8.0},
                            'boundaryElement': {
                                'id': 'right-edge',
                                'longitudinal': {
                                    'ratioPercent': 0.8,
                                    'diameterMm': 12.0,
                                },
                                'minLongitudinalRatioPercent': 1.0,
                                'minLongitudinalDiameterMm': 14.0,
                                'hoop': {
                                    'diameterMm': 6.0,
                                    'spacingMm': 180.0,
                                    'volumetricRatioPercent': 0.7,
                                },
                                'maxHoopSpacingMm': 120.0,
                                'minHoopDiameterMm': 8.0,
                                'minVolumetricRatioPercent': 1.0,
                            },
                        },
                    },
                },
            },
        }

        result = gb50011.check_element(checker, 'W1', context)

        section_items = result['checks'][0]['items']
        thickness_item = next(item for item in section_items if item['item'] == '抗震墙墙厚')
        reinforcement_item = next(item for item in section_items if item['item'] == '抗震墙分布钢筋构造')
        boundary_item = next(item for item in section_items if item['item'] == '抗震墙边缘构件构造')
        thickness_subchecks = {subcheck['name']: subcheck['status'] for subcheck in thickness_item['inputs']['subchecks']}
        reinforcement_subchecks = {subcheck['name']: subcheck['status'] for subcheck in reinforcement_item['inputs']['subchecks']}
        boundary_subchecks = {subcheck['name']: subcheck['status'] for subcheck in boundary_item['inputs']['subchecks']}
        assert result['status'] == 'fail'
        assert thickness_item['status'] == 'fail'
        assert thickness_subchecks['wall_bottom_strengthened_thickness'] == 'fail'
        assert reinforcement_item['status'] == 'fail'
        assert boundary_item['status'] == 'fail'
        assert reinforcement_item['inputs']['ratioLimitPercent'] == 0.30
        assert reinforcement_subchecks['wall_distributed_reinforcement_double_layer'] == 'fail'
        assert reinforcement_subchecks['wall_tie_spacing'] == 'fail'
        assert reinforcement_subchecks['wall_tie_diameter'] == 'fail'
        assert reinforcement_subchecks['wall_vertical_distributed_reinforcement_ratio'] == 'fail'
        assert reinforcement_subchecks['wall_vertical_distributed_reinforcement_spacing'] == 'fail'
        assert reinforcement_subchecks['wall_vertical_distributed_reinforcement_diameter'] == 'fail'
        assert reinforcement_subchecks['wall_horizontal_distributed_reinforcement_ratio'] == 'fail'
        assert reinforcement_subchecks['wall_horizontal_distributed_reinforcement_spacing'] == 'fail'
        assert boundary_subchecks['wall_boundary_longitudinal_reinforcement_ratio'] == 'fail'
        assert boundary_subchecks['wall_boundary_longitudinal_bar_diameter'] == 'fail'
        assert boundary_subchecks['wall_boundary_transverse_spacing'] == 'fail'
        assert boundary_subchecks['wall_boundary_transverse_diameter'] == 'fail'
        assert boundary_subchecks['wall_boundary_transverse_volume_ratio'] == 'fail'

    def test_shear_wall_boundary_element_required_without_structured_data_is_not_applicable(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'designBasis': {
                    'structuralFamily': 'concrete-shear-wall',
                    'seismicGrade': 2,
                },
            },
            'elementData': {
                'W1': {
                    'type': 'shear-wall',
                    'storyHeightMm': 3600.0,
                    'section': {'thickness': 200.0},
                    'material': {'category': 'concrete', 'grade': 'C30'},
                    'reinforcement': {
                        'wall': {
                            'requiresBoundaryElement': True,
                        },
                    },
                },
            },
        }

        result = gb50011.check_element(checker, 'W1', context)

        boundary_item = next(item for item in result['checks'][0]['items'] if item['item'] == '抗震墙边缘构件构造')
        assert result['status'] == 'fail'
        assert boundary_item['status'] == 'not_applicable'
        assert boundary_item['inputs']['required'] is True
        assert boundary_item['inputs']['boundaryElementCount'] == 0


class TestGlobalSeismicChecks:

    def test_global_seismic_checks_pass_for_compliant_response(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'summary': {
                    'maxStoryDriftRatio': 0.0012,
                    'modalMassParticipationRatio': 0.92,
                },
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'intensity': 8,
                    'isPreliminary': False,
                    'missingInputs': [],
                    'fortificationCategory': 'key',
                    'fortificationCategoryCodeClass': 'B',
                    'seismicActionStandard': 'local_fortification_intensity',
                    'seismicMeasureStandard': 'increase_one_intensity_or_higher_than_9',
                    'seismicMeasureIntensity': 9,
                    'seismicSafetyEvaluationRequired': False,
                    'seismicSafetyEvaluationProvided': False,
                    'seismicGrade': 2,
                    'seismicGradeSource': 'designRequirements.seismicGrade',
                    'codeBasis': [
                        {'code': 'GB 55002-2021'},
                        {'code': 'GB/T 50011-2010'},
                        {
                            'code': 'GB 18306-2015',
                            'standardStatus': 'current',
                            'lastReviewDate': '2021-12-31',
                            'lastReviewConclusion': 'continue_valid',
                            'amendments': [{
                                'no': 'No.1',
                                'status': 'effective',
                                'effectiveDate': '2026-02-27',
                            }],
                            'revisionPlan': {
                                'planNo': '20260055-Q-419',
                                'status': 'drafting',
                            },
                        },
                    ],
                },
                'methodDecision': {
                    'requiresTimeHistory': True,
                    'requiredGroundMotionCount': 3,
                },
                'groundMotionRequirement': {
                    'required': True,
                    'requiredCount': 3,
                    'providedCount': 3,
                    'missingCount': 0,
                    'status': 'satisfied',
                },
                'timeHistory': {
                    'controllingStory': {
                        'story': '0-3.6m',
                        'driftRatio': 0.0015,
                        'record': 'GM2',
                    },
                    'records': [
                        {'baseShearRatioToResponseSpectrum': 0.70},
                        {'baseShearRatioToResponseSpectrum': 0.82},
                        {'baseShearRatioToResponseSpectrum': 0.90},
                    ],
                    'averageBaseShear': 810.0,
                    'envelopeBaseShear': 900.0,
                    'combinedBaseShear': 1000.0,
                    'combinationRule': 'envelope_max_vs_response_spectrum',
                    'combinationSummary': {
                        'rule': 'envelope_max_vs_response_spectrum',
                        'recordCount': 3,
                        'responseSpectrumBaseShear': 1000.0,
                        'timeHistoryEnvelopeBaseShear': 900.0,
                        'timeHistoryAverageBaseShear': 810.0,
                        'timeHistoryStatistic': 'envelope',
                        'timeHistoryStatisticBaseShear': 900.0,
                        'combinedBaseShear': 1000.0,
                        'governingSource': 'response_spectrum',
                    },
                    'baseShearCheck': {'responseSpectrumBaseShear': 1000.0},
                    'spectrumMatch': {
                        'maxScaleFactor': 1.4,
                        'scaleFactorLimit': 10.0,
                        'modalSpectrumAverageMinRatio': 0.65,
                        'averageModalSpectrumMinRatioToTarget': 0.92,
                        'modalSpectrumAverageOk': True,
                        'periodCheckScope': 'modal_period_points',
                        'periodChecks': [{
                            'period': 0.8,
                            'averageRatioToTarget': 1.0,
                        }],
                    },
                    'groundMotionSetChecks': {
                        'actualRecordCount': 2,
                        'requiredActualRecordCount': 2,
                    },
                },
            },
        }

        result = gb50011.check_element(checker, gb50011.GLOBAL_SEISMIC_ELEMENT_ID, context)

        assert result['elementType'] == 'global-seismic'
        assert result['status'] == 'pass'
        basis_group = next(group for group in result['checks'] if group['name'] == '抗震设计依据完整性校核')
        assert basis_group['items'][0]['status'] == 'pass'
        fortification_item = next(item for item in basis_group['items'] if item['item'] == '抗震设防类别标准')
        assert fortification_item['status'] == 'pass'
        assert fortification_item['inputs']['fortificationCategoryCodeClass'] == 'B'
        assert fortification_item['inputs']['expectedSeismicMeasureIntensity'] == 9
        seismic_grade_item = next(item for item in basis_group['items'] if item['item'] == '抗震等级结构化依据')
        assert seismic_grade_item['status'] == 'pass'
        assert seismic_grade_item['inputs']['seismicGrade'] == 2
        assert seismic_grade_item['inputs']['seismicGradeSource'] == 'designRequirements.seismicGrade'
        gb18306_item = next(item for item in basis_group['items'] if item['item'] == 'GB 18306标准状态')
        assert gb18306_item['status'] == 'pass'
        assert gb18306_item['inputs']['standardStatus'] == 'current'
        assert gb18306_item['inputs']['effectiveAmendment']['effectiveDate'] == '2026-02-27'
        assert gb18306_item['inputs']['revisionPlan']['planNo'] == '20260055-Q-419'
        assert gb18306_item['inputs']['revisionPlanUsedAsCurrentBasis'] is False
        drift_group = next(group for group in result['checks'] if group['name'] == '整体抗震变形验算')
        drift_item = drift_group['items'][0]
        assert drift_item['item'] == '多遇地震弹性层间位移角'
        assert drift_item['utilization'] < 1.0
        assert drift_item['inputs']['timeHistoryControllingStory']['story'] == '0-3.6m'
        assert drift_item['inputs']['timeHistoryControllingStory']['record'] == 'GM2'
        modal_group = next(group for group in result['checks'] if group['name'] == '振型组合完整性校核')
        modal_item = modal_group['items'][0]
        assert modal_item['item'] == '振型参与质量系数'
        assert modal_item['status'] == 'pass'
        time_history_group = next(group for group in result['checks'] if group['name'] == '时程分析输入与结果校核')
        time_history_items = time_history_group['items']
        assert [item['status'] for item in time_history_items] == ['pass', 'pass', 'pass', 'pass', 'pass', 'pass', 'pass', 'pass']
        assert time_history_items[0]['item'] == '补充时程分析完整性'
        assert time_history_items[0]['inputs']['missingCount'] == 0
        assert any(item['item'] == '地震波组数规则' and item['status'] == 'pass' for item in time_history_items)
        combination_item = next(item for item in time_history_items if item['item'] == '时程组合规则')
        assert combination_item['status'] == 'pass'
        assert combination_item['inputs']['expectedTimeHistoryStatistic'] == 'envelope'
        assert combination_item['inputs']['expectedCombinedBaseShear'] == 1000.0
        assert any(item['item'] == '地震波反应谱适配' and item['status'] == 'pass' for item in time_history_items)

    def test_global_seismic_checks_fail_directional_time_history_trace_when_one_direction_fails(self):
        checker = MockCodeChecker()
        base_time_history = {
            'records': [
                {'baseShearRatioToResponseSpectrum': 0.70},
                {'baseShearRatioToResponseSpectrum': 0.82},
                {'baseShearRatioToResponseSpectrum': 0.90},
            ],
            'averageBaseShear': 810.0,
            'envelopeBaseShear': 900.0,
            'combinedBaseShear': 1000.0,
            'combinationRule': 'envelope_max_vs_response_spectrum',
            'combinationSummary': {
                'rule': 'envelope_max_vs_response_spectrum',
                'recordCount': 3,
                'responseSpectrumBaseShear': 1000.0,
                'timeHistoryEnvelopeBaseShear': 900.0,
                'timeHistoryAverageBaseShear': 810.0,
                'timeHistoryStatistic': 'envelope',
                'timeHistoryStatisticBaseShear': 900.0,
                'combinedBaseShear': 1000.0,
                'governingSource': 'response_spectrum',
            },
            'baseShearCheck': {'responseSpectrumBaseShear': 1000.0},
            'spectrumMatch': {
                'maxScaleFactor': 1.4,
                'scaleFactorLimit': 10.0,
                'modalSpectrumAverageMinRatio': 0.65,
                'averageModalSpectrumMinRatioToTarget': 0.92,
            },
            'groundMotionSetChecks': {
                'recordCount': 3,
                'actualRecordCount': 2,
                'requiredActualRecordCount': 2,
            },
        }
        failing_y_time_history = {
            **base_time_history,
            'records': [
                {'baseShearRatioToResponseSpectrum': 0.60},
                {'baseShearRatioToResponseSpectrum': 0.82},
                {'baseShearRatioToResponseSpectrum': 0.91},
            ],
            'averageBaseShear': 850.0,
            'envelopeBaseShear': 910.0,
            'combinationSummary': {
                **base_time_history['combinationSummary'],
                'timeHistoryEnvelopeBaseShear': 910.0,
                'timeHistoryAverageBaseShear': 850.0,
                'timeHistoryStatisticBaseShear': 910.0,
            },
        }
        context = {
            'analysisSummary': {
                'summary': {
                    'maxStoryDriftRatio': 0.0012,
                    'modalMassParticipationRatio': 0.92,
                },
                'envelope': {
                    'maxStoryDriftRatio': 0.0012,
                },
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'isPreliminary': False,
                    'missingInputs': [],
                },
                'methodDecision': {
                    'requiresTimeHistory': True,
                    'requiredGroundMotionCount': 3,
                },
                'groundMotionRequirement': {
                    'required': True,
                    'requiredCount': 3,
                    'providedCount': 6,
                    'missingCount': 0,
                    'status': 'satisfied',
                },
                'timeHistory': base_time_history,
                'directionResults': [
                    {
                        'direction': 'x',
                        'timeHistory': base_time_history,
                    },
                    {
                        'direction': 'y',
                        'timeHistory': failing_y_time_history,
                    },
                ],
            },
        }

        result = gb50011.check_element(checker, gb50011.GLOBAL_SEISMIC_ELEMENT_ID, context)

        assert result['status'] == 'fail'
        time_history_group = next(group for group in result['checks'] if group['name'] == '时程分析输入与结果校核')
        direction_item = next(item for item in time_history_group['items'] if item['item'] == '时程方向级校核追踪')
        assert direction_item['status'] == 'fail'
        checks_by_direction = {
            item['direction']: item
            for item in direction_item['inputs']['directionChecks']
        }
        assert checks_by_direction['x']['status'] == 'pass'
        assert checks_by_direction['y']['status'] == 'fail'
        assert checks_by_direction['y']['minBaseShearRatio'] == 0.60
        assert direction_item['inputs']['checkedDirectionCount'] == 2

    def test_global_seismic_checks_fail_when_time_history_combination_summary_is_inconsistent(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'summary': {
                    'maxStoryDriftRatio': 0.0012,
                    'modalMassParticipationRatio': 0.92,
                },
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'isPreliminary': False,
                    'missingInputs': [],
                },
                'methodDecision': {
                    'requiresTimeHistory': True,
                    'requiredGroundMotionCount': 3,
                },
                'groundMotionRequirement': {
                    'required': True,
                    'requiredCount': 3,
                    'providedCount': 3,
                    'missingCount': 0,
                    'status': 'satisfied',
                },
                'timeHistory': {
                    'records': [
                        {'baseShearRatioToResponseSpectrum': 0.70},
                        {'baseShearRatioToResponseSpectrum': 0.82},
                        {'baseShearRatioToResponseSpectrum': 0.90},
                    ],
                    'averageBaseShear': 810.0,
                    'envelopeBaseShear': 900.0,
                    'combinedBaseShear': 810.0,
                    'combinationRule': 'envelope_max_vs_response_spectrum',
                    'combinationSummary': {
                        'rule': 'envelope_max_vs_response_spectrum',
                        'recordCount': 3,
                        'responseSpectrumBaseShear': 1000.0,
                        'timeHistoryEnvelopeBaseShear': 900.0,
                        'timeHistoryAverageBaseShear': 810.0,
                        'timeHistoryStatistic': 'average',
                        'timeHistoryStatisticBaseShear': 810.0,
                        'combinedBaseShear': 810.0,
                        'governingSource': 'time_history_average',
                    },
                    'baseShearCheck': {'responseSpectrumBaseShear': 1000.0},
                    'spectrumMatch': {
                        'maxScaleFactor': 1.4,
                        'scaleFactorLimit': 10.0,
                        'modalSpectrumAverageMinRatio': 0.65,
                        'averageModalSpectrumMinRatioToTarget': 0.92,
                    },
                    'groundMotionSetChecks': {
                        'recordCount': 3,
                        'actualRecordCount': 2,
                        'requiredActualRecordCount': 2,
                    },
                },
            },
        }

        result = gb50011.check_element(checker, gb50011.GLOBAL_SEISMIC_ELEMENT_ID, context)

        time_history_group = next(group for group in result['checks'] if group['name'] == '时程分析输入与结果校核')
        combination_item = next(item for item in time_history_group['items'] if item['item'] == '时程组合规则')
        assert result['status'] == 'fail'
        assert combination_item['status'] == 'fail'
        assert combination_item['inputs']['expectedTimeHistoryStatistic'] == 'envelope'
        assert combination_item['inputs']['expectedCombinedBaseShear'] == 1000.0
        assert combination_item['inputs']['expectedGoverningSource'] == 'response_spectrum'

    def test_global_seismic_checks_flag_long_period_response_spectrum_special_study(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'summary': {
                    'maxStoryDriftRatio': 0.0012,
                    'modalMassParticipationRatio': 0.92,
                },
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'isPreliminary': False,
                    'missingInputs': [],
                },
                'responseSpectrum': {
                    'periodRangeAssessment': {
                        'requiresSpecialStudy': True,
                        'maxModePeriodSec': 6.5,
                        'maxCodeSpectrumPeriodSec': 6.0,
                    },
                    'longPeriodSpecialStudyAdvisory': {
                        'status': 'advisory_only',
                        'governingMode': {
                            'modeNumber': 1,
                            'period': 6.5,
                            'advisoryAlpha': 0.012,
                        },
                    },
                },
                'missingCapabilities': ['gb50011.responseSpectrumLongPeriodSpecialStudy'],
            },
        }

        result = gb50011.check_element(checker, gb50011.GLOBAL_SEISMIC_ELEMENT_ID, context)

        period_group = next(group for group in result['checks'] if group['name'] == '反应谱周期范围校核')
        item = period_group['items'][0]
        assert result['status'] == 'fail'
        assert item['item'] == '反应谱长周期专项研究'
        assert item['status'] == 'fail'
        assert item['inputs']['requiresSpecialStudy'] is True
        assert item['inputs']['maxModePeriodSec'] == 6.5
        assert item['inputs']['governingMode']['modeNumber'] == 1

    def test_global_seismic_checks_fail_when_gb18306_revision_plan_is_used_as_current_basis(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'summary': {
                    'maxStoryDriftRatio': 0.0012,
                    'modalMassParticipationRatio': 0.92,
                },
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'isPreliminary': False,
                    'missingInputs': [],
                    'codeBasis': [
                        {
                            'code': 'GB 18306-2015',
                            'standardStatus': 'current',
                            'lastReviewConclusion': 'continue_valid',
                            'amendments': [{
                                'no': 'No.1',
                                'status': 'effective',
                                'effectiveDate': '2026-02-27',
                            }],
                            'revisionPlan': {
                                'planNo': '20260055-Q-419',
                                'status': 'drafting',
                                'usedAsCurrentBasis': True,
                            },
                        },
                    ],
                },
            },
        }

        result = gb50011.check_element(checker, gb50011.GLOBAL_SEISMIC_ELEMENT_ID, context)

        assert result['status'] == 'fail'
        basis_group = next(group for group in result['checks'] if group['name'] == '抗震设计依据完整性校核')
        gb18306_item = next(item for item in basis_group['items'] if item['item'] == 'GB 18306标准状态')
        assert gb18306_item['status'] == 'fail'
        assert gb18306_item['inputs']['revisionPlanUsedAsCurrentBasis'] is True
        assert 'drafting revision plan' in gb18306_item['message']

    def test_global_seismic_checks_fail_invalid_structured_seismic_grade(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'summary': {
                    'maxStoryDriftRatio': 0.0012,
                    'modalMassParticipationRatio': 0.92,
                },
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'isPreliminary': False,
                    'missingInputs': [],
                    'seismicGrade': 5,
                    'seismicGradeSource': 'designRequirements.seismicGrade',
                },
            },
        }

        result = gb50011.check_element(checker, gb50011.GLOBAL_SEISMIC_ELEMENT_ID, context)

        basis_group = next(group for group in result['checks'] if group['name'] == '抗震设计依据完整性校核')
        seismic_grade_item = next(item for item in basis_group['items'] if item['item'] == '抗震等级结构化依据')
        assert result['status'] == 'fail'
        assert seismic_grade_item['status'] == 'fail'
        assert seismic_grade_item['inputs']['rawSeismicGrade'] == 5
        assert seismic_grade_item['inputs']['seismicGrade'] is None
        assert seismic_grade_item['inputs']['validGrades'] == [1, 2, 3, 4]

    def test_global_seismic_checks_fail_special_fortification_without_safety_evaluation(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'summary': {
                    'maxStoryDriftRatio': 0.0012,
                    'modalMassParticipationRatio': 0.92,
                },
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'isPreliminary': False,
                    'missingInputs': [],
                    'fortificationCategory': 'special',
                    'fortificationCategoryCodeClass': 'A',
                    'seismicActionStandard': 'approved_seismic_safety_evaluation_higher_than_local_intensity',
                    'seismicMeasureStandard': 'increase_one_intensity_or_higher_than_9',
                    'seismicMeasureIntensity': 10,
                    'seismicSafetyEvaluationRequired': True,
                    'seismicSafetyEvaluationProvided': False,
                },
            },
        }

        result = gb50011.check_element(checker, gb50011.GLOBAL_SEISMIC_ELEMENT_ID, context)

        basis_group = next(group for group in result['checks'] if group['name'] == '抗震设计依据完整性校核')
        fortification_item = next(item for item in basis_group['items'] if item['item'] == '抗震设防类别标准')
        assert result['status'] == 'fail'
        assert fortification_item['status'] == 'fail'
        assert fortification_item['inputs']['seismicSafetyEvaluationRequired'] is True
        assert fortification_item['inputs']['seismicSafetyEvaluationProvided'] is False

    def test_global_seismic_checks_fail_inconsistent_fortification_measure_intensity(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'summary': {
                    'maxStoryDriftRatio': 0.0012,
                    'modalMassParticipationRatio': 0.92,
                },
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'intensity': 8,
                    'isPreliminary': False,
                    'missingInputs': [],
                    'fortificationCategory': 'key',
                    'fortificationCategoryCodeClass': 'B',
                    'seismicActionStandard': 'local_fortification_intensity',
                    'seismicMeasureStandard': 'increase_one_intensity_or_higher_than_9',
                    'seismicMeasureIntensity': 8,
                    'seismicSafetyEvaluationRequired': False,
                    'seismicSafetyEvaluationProvided': False,
                },
            },
        }

        result = gb50011.check_element(checker, gb50011.GLOBAL_SEISMIC_ELEMENT_ID, context)

        basis_group = next(group for group in result['checks'] if group['name'] == '抗震设计依据完整性校核')
        fortification_item = next(item for item in basis_group['items'] if item['item'] == '抗震设防类别标准')
        assert result['status'] == 'fail'
        assert fortification_item['status'] == 'fail'
        assert fortification_item['inputs']['expectedSeismicMeasureIntensity'] == 9
        assert 'seismicMeasureIntensity' in fortification_item['inputs']['standardMismatches']

    def test_global_seismic_checks_use_structural_family_drift_limits(self):
        checker = MockCodeChecker()
        cases = [
            ('concrete-frame-shear-wall', 0.0012, 1.0 / 800.0, '1/800', 'pass'),
            ('concrete-shear-wall', 0.0012, 1.0 / 1000.0, '1/1000', 'fail'),
            ('steel-frame', 0.0038, 1.0 / 250.0, '1/250', 'pass'),
        ]

        for structural_family, drift, expected_limit, expected_limit_text, expected_status in cases:
            context = {
                'analysisSummary': {
                    'summary': {
                        'maxStoryDriftRatio': drift,
                        'modalMassParticipationRatio': 0.92,
                    },
                    'designBasis': {
                        'structuralFamily': structural_family,
                        'isPreliminary': False,
                        'missingInputs': [],
                    },
                },
            }

            result = gb50011.check_element(checker, gb50011.GLOBAL_SEISMIC_ELEMENT_ID, context)
            drift_group = next(group for group in result['checks'] if group['name'] == '整体抗震变形验算')
            drift_item = drift_group['items'][0]

            assert drift_item['status'] == expected_status
            assert drift_item['inputs']['limit'] == expected_limit
            assert drift_item['inputs']['limitRatioText'] == expected_limit_text
            assert expected_limit_text in drift_item['formula']

    def test_global_seismic_checks_pass_story_minimum_shear_coefficient(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'summary': {
                    'maxStoryDriftRatio': 0.0012,
                    'modalMassParticipationRatio': 0.92,
                    'fundamentalPeriod': 4.0,
                },
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'intensity': 8,
                    'accelerationG': 0.30,
                    'isPreliminary': False,
                    'missingInputs': [],
                },
                'responseSpectrum': {
                    'floorResponses': [
                        {
                            'story': 'F1',
                            'direction': 'x',
                            'shearWeightRatio': 0.052,
                            'isWeakStory': True,
                        },
                        {
                            'story': 'F2',
                            'direction': 'x',
                            'shearWeightRatio': 0.060,
                        },
                    ],
                },
            },
        }

        result = gb50011.check_element(checker, gb50011.GLOBAL_SEISMIC_ELEMENT_ID, context)

        assert result['status'] == 'pass'
        story_group = next(group for group in result['checks'] if group['name'] == '楼层地震剪力系数校核')
        item = story_group['items'][0]
        assert item['item'] == '楼层最小地震剪力系数'
        assert item['status'] == 'pass'
        assert item['inputs']['baseLimit'] == 0.044
        assert item['inputs']['controlling']['story'] == 'F1'
        assert item['inputs']['controlling']['limit'] == 0.0506
        assert item['inputs']['limitBasis'] == 'period_linear_interpolation_3_5s_to_5_0s'

    def test_global_seismic_checks_trace_minimum_shear_adjusted_floor_responses(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'summary': {
                    'maxStoryDriftRatio': 0.0012,
                    'modalMassParticipationRatio': 0.92,
                    'fundamentalPeriod': 4.0,
                },
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'intensity': 8,
                    'accelerationG': 0.30,
                    'isPreliminary': False,
                    'missingInputs': [],
                },
                'responseSpectrum': {
                    'floorResponses': [
                        {
                            'story': 'F1',
                            'direction': 'x',
                            'rawShearWeightRatio': 0.040,
                            'shearWeightRatio': 0.0506,
                            'isWeakStory': True,
                            'minimumShearAdjusted': True,
                            'minimumShearAdjustmentFactor': 1.265,
                        },
                    ],
                },
            },
        }

        result = gb50011.check_element(checker, gb50011.GLOBAL_SEISMIC_ELEMENT_ID, context)

        assert result['status'] == 'pass'
        story_group = next(group for group in result['checks'] if group['name'] == '楼层地震剪力系数校核')
        item = story_group['items'][0]
        controlling = item['inputs']['controlling']
        assert item['status'] == 'pass'
        assert item['inputs']['minimumShearAdjustmentApplied'] is True
        assert controlling['rawShearWeightRatio'] == 0.04
        assert controlling['minimumShearAdjusted'] is True
        assert controlling['minimumShearAdjustmentFactor'] == 1.265

    def test_global_seismic_checks_fail_story_minimum_shear_coefficient_for_weak_story(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'summary': {
                    'maxStoryDriftRatio': 0.0012,
                    'modalMassParticipationRatio': 0.92,
                    'fundamentalPeriod': 4.0,
                },
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'intensity': 8,
                    'accelerationG': 0.30,
                    'isPreliminary': False,
                    'missingInputs': [],
                },
                'responseSpectrum': {
                    'floorResponses': [
                        {
                            'story': 'F1',
                            'direction': 'x',
                            'shearWeightRatio': 0.040,
                            'isWeakStory': True,
                        },
                    ],
                },
            },
        }

        result = gb50011.check_element(checker, gb50011.GLOBAL_SEISMIC_ELEMENT_ID, context)

        assert result['status'] == 'fail'
        story_group = next(group for group in result['checks'] if group['name'] == '楼层地震剪力系数校核')
        item = story_group['items'][0]
        assert item['status'] == 'fail'
        assert item['utilization'] > 1.0
        assert item['inputs']['controlling']['isWeakStory'] is True
        assert item['inputs']['controlling']['shearWeightRatio'] == 0.04
        assert item['inputs']['controlling']['limit'] == 0.0506

    def test_global_seismic_checks_fail_for_excessive_drift_and_weak_records(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'summary': {
                    'maxStoryDriftRatio': 0.0025,
                    'modalMassParticipationRatio': 0.82,
                },
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'isPreliminary': False,
                    'missingInputs': [],
                },
                'methodDecision': {
                    'requiresTimeHistory': True,
                    'requiredGroundMotionCount': 3,
                },
                'timeHistory': {
                    'records': [
                        {'baseShearRatioToResponseSpectrum': 0.50},
                        {'baseShearRatioToResponseSpectrum': 0.60},
                        {'baseShearRatioToResponseSpectrum': 0.70},
                    ],
                    'averageBaseShear': 700.0,
                    'baseShearCheck': {'responseSpectrumBaseShear': 1000.0},
                    'groundMotionSetChecks': {
                        'actualRecordCount': 1,
                        'requiredActualRecordCount': 2,
                    },
                },
            },
        }

        result = gb50011.check_element(checker, gb50011.GLOBAL_SEISMIC_ELEMENT_ID, context)

        assert result['status'] == 'fail'
        statuses = [item['status'] for group in result['checks'] for item in group['items']]
        assert statuses.count('fail') >= 4

    def test_global_seismic_checks_trace_particularly_irregular_time_history_trigger(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'summary': {
                    'maxStoryDriftRatio': 0.0012,
                    'modalMassParticipationRatio': 0.92,
                },
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'isPreliminary': False,
                    'missingInputs': [],
                },
                'regularityAssessment': {
                    'classification': 'particularly_irregular',
                    'source': 'model_heuristic',
                    'checks': [
                        {'name': 'story_mass_variation', 'severity': 'particularly_irregular'},
                    ],
                },
                'methodDecision': {
                    'requiresTimeHistory': True,
                    'selectedMethods': ['response_spectrum', 'time_history'],
                    'requiredGroundMotionCount': 3,
                },
                'groundMotionRequirement': {
                    'required': True,
                    'requiredCount': 3,
                    'providedCount': 3,
                    'missingCount': 0,
                    'status': 'satisfied',
                },
                'timeHistory': {
                    'records': [
                        {'baseShearRatioToResponseSpectrum': 0.70},
                        {'baseShearRatioToResponseSpectrum': 0.82},
                        {'baseShearRatioToResponseSpectrum': 0.90},
                    ],
                    'averageBaseShear': 810.0,
                    'baseShearCheck': {'responseSpectrumBaseShear': 1000.0},
                    'spectrumMatch': {
                        'maxScaleFactor': 1.4,
                        'scaleFactorLimit': 10.0,
                        'modalSpectrumAverageMinRatio': 0.65,
                        'averageModalSpectrumMinRatioToTarget': 0.92,
                        'modalSpectrumAverageOk': True,
                        'periodCheckScope': 'modal_period_points',
                        'periodChecks': [{
                            'period': 0.8,
                            'averageRatioToTarget': 1.0,
                        }],
                    },
                    'groundMotionSetChecks': {
                        'recordCount': 3,
                        'actualRecordCount': 2,
                        'requiredActualRecordCount': 2,
                    },
                },
            },
        }

        result = gb50011.check_element(checker, gb50011.GLOBAL_SEISMIC_ELEMENT_ID, context)

        regularity_group = next(group for group in result['checks'] if group['name'] == '规则性与方法选择校核')
        item = regularity_group['items'][0]
        assert result['status'] == 'pass'
        assert item['item'] == '规则性评估与补充时程触发'
        assert item['status'] == 'pass'
        assert item['inputs']['classification'] == 'particularly_irregular'
        assert item['inputs']['requiresTimeHistory'] is True
        assert item['inputs']['checkCount'] == 1

    def test_global_seismic_checks_fail_when_particularly_irregular_does_not_trigger_time_history(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'summary': {
                    'maxStoryDriftRatio': 0.0012,
                    'modalMassParticipationRatio': 0.92,
                },
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'isPreliminary': False,
                    'missingInputs': [],
                },
                'regularityAssessment': {
                    'classification': 'particularly_irregular',
                    'source': 'model_heuristic',
                    'checks': [
                        {'name': 'story_mass_variation', 'severity': 'particularly_irregular'},
                    ],
                },
                'methodDecision': {
                    'requiresTimeHistory': False,
                    'selectedMethods': ['response_spectrum'],
                },
            },
        }

        result = gb50011.check_element(checker, gb50011.GLOBAL_SEISMIC_ELEMENT_ID, context)

        assert result['status'] == 'fail'
        regularity_group = next(group for group in result['checks'] if group['name'] == '规则性与方法选择校核')
        item = regularity_group['items'][0]
        assert item['status'] == 'fail'
        assert item['utilization'] == 0.0
        assert item['category'] == 'input_required'
        assert item['governingEligible'] is False
        assert item['inputs']['selectedMethods'] == ['response_spectrum']

    def test_global_seismic_checks_fail_missing_required_over_limit_review_evidence(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'summary': {
                    'maxStoryDriftRatio': 0.0012,
                    'modalMassParticipationRatio': 0.92,
                },
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'isPreliminary': False,
                    'missingInputs': [],
                },
                'overLimitReview': {
                    'reviewRequired': True,
                    'reviewType': 'over_limit_high_rise',
                    'status': 'pending',
                    'reasons': ['structured_irregularity_review_required'],
                },
            },
        }

        result = gb50011.check_element(checker, gb50011.GLOBAL_SEISMIC_ELEMENT_ID, context)

        assert result['status'] == 'fail'
        review_group = next(group for group in result['checks'] if group['name'] == '超限与专项审查校核')
        item = review_group['items'][0]
        assert item['item'] == '超限与专项审查结构化追踪'
        assert item['status'] == 'fail'
        assert item['inputs']['reviewRequired'] is True
        assert item['inputs']['reviewEvidenceProvided'] is False
        assert item['inputs']['pendingReviewSources'] == ['analysisSummary.overLimitReview']
        assert item['inputs']['missingReviewEvidence'] is True
        assert item['inputs']['reasons'] == ['structured_irregularity_review_required']

    def test_global_seismic_checks_pass_approved_special_review_trace(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'summary': {
                    'maxStoryDriftRatio': 0.0012,
                    'modalMassParticipationRatio': 0.92,
                },
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'isPreliminary': False,
                    'missingInputs': [],
                },
                'specialReview': {
                    'reviewRequired': True,
                    'reviewType': 'project_special_seismic_review',
                    'status': 'approved',
                    'approvalId': 'SZ-REVIEW-2026-001',
                    'authority': 'expert_panel',
                    'reviewDate': '2026-06-30',
                },
            },
        }

        result = gb50011.check_element(checker, gb50011.GLOBAL_SEISMIC_ELEMENT_ID, context)

        assert result['status'] == 'pass'
        review_group = next(group for group in result['checks'] if group['name'] == '超限与专项审查校核')
        item = review_group['items'][0]
        assert item['status'] == 'pass'
        assert item['inputs']['reviewRequired'] is True
        assert item['inputs']['reviewEvidenceProvided'] is True
        assert item['inputs']['reviewEvidence'][0]['approvalId'] == 'SZ-REVIEW-2026-001'
        assert item['inputs']['reviewEvidence'][0]['date'] == '2026-06-30'

    def test_global_seismic_checks_fail_for_invalid_ground_motion_record_count(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'summary': {
                    'maxStoryDriftRatio': 0.0012,
                    'modalMassParticipationRatio': 0.92,
                },
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'isPreliminary': False,
                    'missingInputs': [],
                },
                'methodDecision': {
                    'requiresTimeHistory': True,
                    'requiredGroundMotionCount': 3,
                },
                'groundMotionRequirement': {
                    'required': True,
                    'requiredCount': 3,
                    'providedCount': 5,
                    'missingCount': 0,
                    'status': 'satisfied',
                },
                'timeHistory': {
                    'records': [
                        {'baseShearRatioToResponseSpectrum': 0.82},
                        {'baseShearRatioToResponseSpectrum': 0.84},
                        {'baseShearRatioToResponseSpectrum': 0.86},
                        {'baseShearRatioToResponseSpectrum': 0.88},
                        {'baseShearRatioToResponseSpectrum': 0.90},
                    ],
                    'averageBaseShear': 860.0,
                    'baseShearCheck': {'responseSpectrumBaseShear': 1000.0},
                    'spectrumMatch': {
                        'maxScaleFactor': 1.2,
                        'scaleFactorLimit': 10.0,
                    },
                    'groundMotionSetChecks': {
                        'recordCount': 5,
                        'actualRecordCount': 4,
                        'requiredActualRecordCount': 4,
                    },
                },
            },
        }

        result = gb50011.check_element(checker, gb50011.GLOBAL_SEISMIC_ELEMENT_ID, context)

        assert result['status'] == 'fail'
        time_history_group = next(group for group in result['checks'] if group['name'] == '时程分析输入与结果校核')
        count_item = next(item for item in time_history_group['items'] if item['item'] == '地震波组数规则')
        assert count_item['status'] == 'fail'
        assert count_item['inputs']['recordCount'] == 5

    def test_global_seismic_checks_missing_actual_records_do_not_emit_sentinel_utilization(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'summary': {
                    'maxStoryDriftRatio': 0.0012,
                    'modalMassParticipationRatio': 0.92,
                },
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'isPreliminary': False,
                    'missingInputs': [],
                },
                'methodDecision': {
                    'requiresTimeHistory': True,
                    'requiredGroundMotionCount': 3,
                },
                'groundMotionRequirement': {
                    'required': True,
                    'providedCount': 3,
                    'requiredCount': 3,
                    'missingCount': 0,
                },
                'timeHistory': {
                    'records': [
                        {'baseShearRatioToResponseSpectrum': 0.70},
                        {'baseShearRatioToResponseSpectrum': 0.82},
                        {'baseShearRatioToResponseSpectrum': 0.90},
                    ],
                    'averageBaseShear': 810.0,
                    'baseShearCheck': {'responseSpectrumBaseShear': 1000.0},
                    'spectrumMatch': {
                        'maxScaleFactor': 1.2,
                        'scaleFactorLimit': 10.0,
                        'modalSpectrumAverageMinRatio': 0.65,
                        'averageModalSpectrumMinRatioToTarget': 0.92,
                    },
                    'groundMotionSetChecks': {
                        'recordCount': 3,
                        'actualRecordCount': 0,
                        'requiredActualRecordCount': 2,
                    },
                },
            },
        }

        result = gb50011.check_element(checker, gb50011.GLOBAL_SEISMIC_ELEMENT_ID, context)

        assert result['status'] == 'fail'
        time_history_group = next(group for group in result['checks'] if group['name'] == '时程分析输入与结果校核')
        actual_item = next(item for item in time_history_group['items'] if item['item'] == '实际强震记录比例')
        assert actual_item['status'] == 'fail'
        assert actual_item['utilization'] == 0.0
        assert actual_item['displayUtilization'] == 'N/A'
        assert actual_item['category'] == 'input_required'
        assert actual_item['governingEligible'] is False

    def test_global_seismic_checks_include_elastic_plastic_time_history_final_compliance(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'summary': {
                    'maxStoryDriftRatio': 0.0012,
                    'modalMassParticipationRatio': 0.92,
                },
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'isPreliminary': False,
                    'missingInputs': [],
                },
                'methodDecision': {
                    'requiresTimeHistory': True,
                    'requiredGroundMotionCount': 3,
                },
                'groundMotionRequirement': {
                    'required': True,
                    'requiredCount': 3,
                    'providedCount': 3,
                    'missingCount': 0,
                    'status': 'satisfied',
                },
                'elasticPlasticTimeHistory': {
                    'status': 'estimated',
                    'finalCompliance': {
                        'status': 'pass',
                        'method': 'elastic_plastic_time_history_drift_acceptance',
                        'source': 'elasticPlasticTimeHistory.acceptanceCheck',
                        'scope': 'OpenSees bilinear SDOF nonlinear time-history estimate',
                        'driftRatio': 0.004,
                        'limitDriftRatio': 0.02,
                        'utilization': 0.2,
                    },
                },
            },
        }

        result = gb50011.check_element(checker, gb50011.GLOBAL_SEISMIC_ELEMENT_ID, context)

        time_history_group = next(group for group in result['checks'] if group['name'] == '时程分析输入与结果校核')
        item = next(item for item in time_history_group['items'] if item['item'] == '弹塑性时程最终符合性')
        assert item['status'] == 'pass'
        assert item['utilization'] == 0.2
        assert item['inputs']['method'] == 'elastic_plastic_time_history_drift_acceptance'

    def test_global_seismic_checks_fail_when_directional_time_history_records_are_missing(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'summary': {
                    'maxStoryDriftRatio': 0.0012,
                    'modalMassParticipationRatio': 0.92,
                },
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'isPreliminary': False,
                    'missingInputs': [],
                },
                'methodDecision': {
                    'requiresTimeHistory': True,
                    'requiredGroundMotionCount': 3,
                },
                'groundMotionRequirement': {
                    'required': True,
                    'requiredCount': 3,
                    'totalRequiredCount': 6,
                    'providedCount': 3,
                    'missingCount': 3,
                    'status': 'missing',
                    'directionRequirements': [
                        {'direction': 'x', 'requiredCount': 3, 'providedCount': 3, 'missingCount': 0},
                        {'direction': 'y', 'requiredCount': 3, 'providedCount': 0, 'missingCount': 3},
                    ],
                },
                'timeHistory': {
                    'records': [
                        {'baseShearRatioToResponseSpectrum': 0.82},
                        {'baseShearRatioToResponseSpectrum': 0.84},
                        {'baseShearRatioToResponseSpectrum': 0.86},
                    ],
                    'averageBaseShear': 840.0,
                    'baseShearCheck': {'responseSpectrumBaseShear': 1000.0},
                    'spectrumMatch': {
                        'maxScaleFactor': 1.2,
                        'scaleFactorLimit': 10.0,
                    },
                    'groundMotionSetChecks': {
                        'recordCount': 3,
                        'actualRecordCount': 2,
                        'requiredActualRecordCount': 2,
                    },
                },
            },
        }

        result = gb50011.check_element(checker, gb50011.GLOBAL_SEISMIC_ELEMENT_ID, context)

        assert result['status'] == 'fail'
        time_history_group = next(group for group in result['checks'] if group['name'] == '时程分析输入与结果校核')
        required_item = next(item for item in time_history_group['items'] if item['item'] == '补充时程分析完整性')
        assert required_item['status'] == 'fail'
        assert required_item['inputs']['capacity'] == 6
        assert required_item['inputs']['missingCount'] == 3

    def test_global_seismic_checks_fail_when_required_time_history_is_missing(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'summary': {
                    'maxStoryDriftRatio': 0.0012,
                    'modalMassParticipationRatio': 0.92,
                },
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'isPreliminary': False,
                    'missingInputs': [],
                },
                'methodDecision': {
                    'requiresTimeHistory': True,
                    'requiredGroundMotionCount': 3,
                    'missingInputs': ['groundMotions'],
                },
            },
        }

        result = gb50011.check_element(checker, gb50011.GLOBAL_SEISMIC_ELEMENT_ID, context)

        assert result['status'] == 'fail'
        time_history_group = next(group for group in result['checks'] if group['name'] == '时程分析输入与结果校核')
        item = time_history_group['items'][0]
        assert item['item'] == '补充时程分析完整性'
        assert item['status'] == 'fail'

    def test_global_seismic_checks_pass_vertical_seismic_action_when_calculated(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'summary': {
                    'maxStoryDriftRatio': 0.0012,
                    'modalMassParticipationRatio': 0.92,
                },
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'isPreliminary': False,
                    'missingInputs': [],
                },
                'methodDecision': {
                    'verticalSeismicRequired': True,
                },
                'verticalSeismic': {
                    'status': 'computed',
                    'method': 'simplified_static',
                    'coefficient': 0.10,
                    'totalVerticalActionKN': 18.0,
                    'openSeesStatic': {
                        'status': 'completed',
                        'memberForceCount': 6,
                    },
                },
            },
        }

        result = gb50011.check_element(checker, gb50011.GLOBAL_SEISMIC_ELEMENT_ID, context)

        vertical_group = next(group for group in result['checks'] if group['name'] == '竖向地震作用校核')
        item = vertical_group['items'][0]
        assert item['item'] == '竖向地震作用标准值'
        assert item['status'] == 'pass'
        assert item['inputs']['totalVerticalActionKN'] == 18.0
        member_item = vertical_group['items'][1]
        assert member_item['item'] == '竖向地震构件内力'
        assert member_item['status'] == 'pass'
        assert member_item['inputs']['memberForceCount'] == 6

    def test_global_seismic_checks_pass_vertical_member_capacity_with_element_data(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'summary': {
                    'maxStoryDriftRatio': 0.0012,
                    'modalMassParticipationRatio': 0.92,
                },
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'isPreliminary': False,
                    'missingInputs': [],
                },
                'methodDecision': {
                    'verticalSeismicRequired': True,
                },
                'verticalSeismic': {
                    'status': 'computed',
                    'method': 'simplified_static',
                    'coefficient': 0.10,
                    'totalVerticalActionKN': 18.0,
                    'openSeesStatic': {
                        'status': 'completed',
                        'memberForceCount': 1,
                        'memberForces': {
                            'C1': {
                                'maxAbsAxialKN': 12.0,
                                'maxAbsShearKN': 2.0,
                                'maxAbsMomentKNm': 4.0,
                            },
                        },
                    },
                },
            },
            'elementData': {
                'C1': {
                    'type': 'column',
                    'section': {'A': 250000.0, 'I': 5.0e9},
                    'material': {'fc': 14.3},
                },
            },
        }

        result = gb50011.check_element(checker, gb50011.GLOBAL_SEISMIC_ELEMENT_ID, context)

        vertical_group = next(group for group in result['checks'] if group['name'] == '竖向地震作用校核')
        capacity_item = next(item for item in vertical_group['items'] if item['item'] == '竖向地震构件承载力')
        assert capacity_item['status'] == 'pass'
        assert capacity_item['inputs']['checkedMemberCount'] == 1
        assert capacity_item['inputs']['controllingElement'] == 'C1'

    def test_global_seismic_checks_use_structured_vertical_member_capacity_utilization(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'summary': {
                    'maxStoryDriftRatio': 0.0012,
                    'modalMassParticipationRatio': 0.92,
                },
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'isPreliminary': False,
                    'missingInputs': [],
                },
                'methodDecision': {
                    'verticalSeismicRequired': True,
                },
                'verticalSeismic': {
                    'status': 'computed',
                    'method': 'simplified_static',
                    'coefficient': 0.10,
                    'totalVerticalActionKN': 18.0,
                    'openSeesStatic': {
                        'status': 'completed',
                        'memberForceCount': 1,
                        'memberForces': {
                            'C1': {
                                'maxAbsAxialKN': 12.0,
                                'maxAbsMomentKNm': 4.0,
                            },
                        },
                    },
                },
            },
            'elementData': {
                'C1': {
                    'type': 'column',
                    'verticalSeismicCapacity': {
                        'verticalSeismicCapacityUtilization': 0.82,
                    },
                },
            },
        }

        result = gb50011.check_element(checker, gb50011.GLOBAL_SEISMIC_ELEMENT_ID, context)

        vertical_group = next(group for group in result['checks'] if group['name'] == '竖向地震作用校核')
        capacity_item = next(item for item in vertical_group['items'] if item['item'] == '竖向地震构件承载力')
        assert result['status'] == 'pass'
        assert capacity_item['status'] == 'pass'
        assert capacity_item['utilization'] == 0.82
        assert capacity_item['inputs']['capacityMethod'] == 'provided_vertical_capacity_utilization'
        assert capacity_item['inputs']['capacitySource'] == 'verticalSeismicCapacity'
        assert capacity_item['inputs']['verticalRatio'] == 0.82

    def test_global_seismic_checks_fail_structured_vertical_member_demand_capacity(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'summary': {
                    'maxStoryDriftRatio': 0.0012,
                    'modalMassParticipationRatio': 0.92,
                },
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'isPreliminary': False,
                    'missingInputs': [],
                },
                'methodDecision': {
                    'verticalSeismicRequired': True,
                },
                'verticalSeismic': {
                    'status': 'computed',
                    'method': 'simplified_static',
                    'coefficient': 0.10,
                    'totalVerticalActionKN': 18.0,
                    'openSeesStatic': {
                        'status': 'completed',
                        'memberForceCount': 1,
                        'memberForces': {
                            'C1': {
                                'maxAbsAxialKN': 12.0,
                                'maxAbsMomentKNm': 4.0,
                            },
                        },
                    },
                },
            },
            'elementData': {
                'C1': {
                    'type': 'column',
                    'verticalSeismicCapacity': {
                        'verticalSeismicDemandKN': 90.0,
                        'verticalSeismicCapacityKN': 60.0,
                    },
                },
            },
        }

        result = gb50011.check_element(checker, gb50011.GLOBAL_SEISMIC_ELEMENT_ID, context)

        vertical_group = next(group for group in result['checks'] if group['name'] == '竖向地震作用校核')
        capacity_item = next(item for item in vertical_group['items'] if item['item'] == '竖向地震构件承载力')
        assert result['status'] == 'fail'
        assert capacity_item['status'] == 'fail'
        assert capacity_item['utilization'] == 1.5
        assert capacity_item['inputs']['capacityMethod'] == 'provided_vertical_demand_capacity'
        assert capacity_item['inputs']['verticalDemandKN'] == 90.0
        assert capacity_item['inputs']['verticalCapacityKN'] == 60.0

    def test_global_seismic_checks_apply_gamma_re_to_vertical_member_demand_capacity(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'summary': {
                    'maxStoryDriftRatio': 0.0012,
                    'modalMassParticipationRatio': 0.92,
                },
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'isPreliminary': False,
                    'missingInputs': [],
                },
                'methodDecision': {
                    'verticalSeismicRequired': True,
                },
                'verticalSeismic': {
                    'status': 'computed',
                    'method': 'simplified_static',
                    'coefficient': 0.10,
                    'totalVerticalActionKN': 18.0,
                    'openSeesStatic': {
                        'status': 'completed',
                        'memberForceCount': 1,
                        'memberForces': {
                            'C1': {
                                'maxAbsAxialKN': 12.0,
                                'maxAbsMomentKNm': 4.0,
                            },
                        },
                    },
                },
            },
            'elementData': {
                'C1': {
                    'type': 'column',
                    'verticalSeismicCapacity': {
                        'verticalSeismicDemandKN': 100.0,
                        'verticalSeismicCapacityKN': 100.0,
                        'gammaRE': 0.85,
                    },
                },
            },
        }

        result = gb50011.check_element(checker, gb50011.GLOBAL_SEISMIC_ELEMENT_ID, context)

        vertical_group = next(group for group in result['checks'] if group['name'] == '竖向地震作用校核')
        capacity_item = next(item for item in vertical_group['items'] if item['item'] == '竖向地震构件承载力')
        assert result['status'] == 'pass'
        assert capacity_item['status'] == 'pass'
        assert capacity_item['utilization'] == 0.85
        assert capacity_item['inputs']['capacityMethod'] == 'provided_vertical_demand_capacity'
        assert capacity_item['inputs']['gammaRE'] == 0.85
        assert capacity_item['inputs']['gammaRESource'] == 'verticalSeismicCapacity.gammaRE'
        assert capacity_item['inputs']['verticalAdjustedCapacityKN'] == 117.647059

    def test_global_seismic_checks_include_pushover_nonlinear_estimate(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'summary': {
                    'maxStoryDriftRatio': 0.0012,
                    'modalMassParticipationRatio': 0.92,
                },
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'isPreliminary': False,
                    'missingInputs': [],
                },
                'pushover': {
                    'nonlinearEstimate': {
                        'status': 'estimated',
                        'performancePoint': {
                            'driftRatio': 0.012,
                        },
                        'acceptanceCheck': {
                            'limitDriftRatio': 0.02,
                        },
                    },
                    'finalCompliance': {
                        'status': 'pass',
                        'method': 'nonlinear_pushover_drift_acceptance',
                        'source': 'pushover.nonlinearEstimate.acceptanceCheck',
                        'scope': 'OpenSees bilinear SDOF nonlinear estimate calibrated from the elastic pushover curve',
                        'driftRatio': 0.012,
                        'limitDriftRatio': 0.02,
                        'utilization': 0.6,
                    },
                },
            },
        }

        result = gb50011.check_element(checker, gb50011.GLOBAL_SEISMIC_ELEMENT_ID, context)

        pushover_group = next(group for group in result['checks'] if group['name'] == 'Pushover弹塑性估算校核')
        item = pushover_group['items'][0]
        assert item['item'] == 'Pushover弹塑性估算位移角'
        assert item['status'] == 'pass'
        assert item['inputs']['demand'] == 0.012
        assert item['inputs']['capacity'] == 0.02
        final_item = next(item for item in pushover_group['items'] if item['item'] == 'Pushover最终符合性')
        assert final_item['status'] == 'pass'
        assert final_item['utilization'] == 0.6
        assert final_item['inputs']['method'] == 'nonlinear_pushover_drift_acceptance'

    def test_global_seismic_checks_include_horizontal_member_forces_when_available(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'summary': {
                    'maxStoryDriftRatio': 0.0012,
                    'modalMassParticipationRatio': 0.92,
                },
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'isPreliminary': False,
                    'missingInputs': [],
                },
                'seismicDesignActions': {
                    'status': 'computed',
                    'direction': 'x',
                    'method': 'equivalent_lateral_static_from_response_spectrum_floor_forces',
                    'memberForceCount': 6,
                    'memberForces': {'C1': {'maxAbsMomentKNm': 12.0}},
                },
            },
        }

        result = gb50011.check_element(checker, gb50011.GLOBAL_SEISMIC_ELEMENT_ID, context)

        horizontal_group = next(group for group in result['checks'] if group['name'] == '水平地震作用校核')
        item = horizontal_group['items'][0]
        assert item['item'] == '水平地震构件内力'
        assert item['status'] == 'pass'
        assert item['inputs']['memberForceCount'] == 6
        assert item['inputs']['direction'] == 'x'

    def test_global_seismic_checks_include_member_design_action_combinations(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'summary': {
                    'maxStoryDriftRatio': 0.0012,
                    'modalMassParticipationRatio': 0.92,
                },
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'isPreliminary': False,
                    'missingInputs': [],
                },
                'memberDesignActionCombinations': {
                    'status': 'computed',
                    'memberCount': 6,
                    'caseCount': 2,
                    'controlling': {
                        'moment': {'value': 22.0, 'elementId': 'C1', 'case': 'gravity_plus_horizontal_seismic'},
                    },
                },
            },
        }

        result = gb50011.check_element(checker, gb50011.GLOBAL_SEISMIC_ELEMENT_ID, context)

        combination_group = next(group for group in result['checks'] if group['name'] == '抗震基本作用组合校核')
        item = combination_group['items'][0]
        assert item['item'] == '抗震基本作用组合'
        assert item['status'] == 'pass'
        assert item['inputs']['memberCount'] == 6
        assert item['inputs']['caseCount'] == 2

    def test_global_seismic_checks_include_combination_member_capacity_with_element_data(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'summary': {
                    'maxStoryDriftRatio': 0.0012,
                    'modalMassParticipationRatio': 0.92,
                },
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'isPreliminary': False,
                    'missingInputs': [],
                },
                'memberDesignActionCombinations': {
                    'status': 'computed',
                    'memberCount': 1,
                    'caseCount': 1,
                    'cases': [
                        {
                            'name': 'gravity_plus_horizontal_seismic',
                            'memberActions': [
                                {
                                    'elementId': 'C1',
                                    'maxAbsAxialKN': 20.0,
                                    'maxAbsShearKN': 6.0,
                                    'maxAbsMomentKNm': 12.0,
                                },
                            ],
                        },
                    ],
                },
            },
            'elementData': {
                'C1': {
                    'type': 'column',
                    'section': {'A': 250000.0, 'I': 5.0e9},
                    'material': {'fc': 14.3},
                },
            },
        }

        result = gb50011.check_element(checker, gb50011.GLOBAL_SEISMIC_ELEMENT_ID, context)

        assert result['status'] == 'pass'
        combination_group = next(group for group in result['checks'] if group['name'] == '抗震基本作用组合校核')
        capacity_item = next(item for item in combination_group['items'] if item['item'] == '抗震组合构件承载力抽查')
        assert capacity_item['status'] == 'pass'
        assert capacity_item['inputs']['checkedMemberCount'] == 1
        assert capacity_item['inputs']['controllingElement'] == 'C1'
        assert capacity_item['inputs']['controllingCase'] == 'gravity_plus_horizontal_seismic'

    def test_global_seismic_checks_fail_when_design_basis_is_preliminary(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'summary': {
                    'maxStoryDriftRatio': 0.0012,
                    'modalMassParticipationRatio': 0.92,
                },
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'isPreliminary': True,
                    'missingInputs': ['designBasis.siteSeismic.designGroup'],
                },
            },
        }

        result = gb50011.check_element(checker, gb50011.GLOBAL_SEISMIC_ELEMENT_ID, context)

        assert result['status'] == 'fail'
        basis_group = next(group for group in result['checks'] if group['name'] == '抗震设计依据完整性校核')
        item = basis_group['items'][0]
        assert item['item'] == '抗震设计依据完整性'
        assert item['status'] == 'fail'
        assert item['utilization'] == 0.0
        assert item['category'] == 'input_required'
        assert item['governingEligible'] is False

    def test_global_seismic_checks_pass_structured_workflow_input_mode(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'workflowInputMode': 'structured_seismic_workflow',
                'summary': {
                    'maxStoryDriftRatio': 0.0012,
                    'modalMassParticipationRatio': 0.92,
                },
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'isPreliminary': False,
                    'missingInputs': [],
                },
            },
        }

        result = gb50011.check_element(checker, gb50011.GLOBAL_SEISMIC_ELEMENT_ID, context)

        assert result['status'] == 'pass'
        workflow_group = next(group for group in result['checks'] if group['name'] == '抗震流程输入校核')
        item = workflow_group['items'][0]
        assert item['item'] == '结构化抗震流程输入'
        assert item['status'] == 'pass'
        assert item['inputs']['workflowInputMode'] == 'structured_seismic_workflow'

    def test_global_seismic_checks_fail_legacy_workflow_input_mode(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'workflowInputMode': 'legacy_compatibility_parameters',
                'summary': {
                    'maxStoryDriftRatio': 0.0012,
                    'modalMassParticipationRatio': 0.92,
                },
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'isPreliminary': False,
                    'missingInputs': [],
                },
            },
        }

        result = gb50011.check_element(checker, gb50011.GLOBAL_SEISMIC_ELEMENT_ID, context)

        assert result['status'] == 'fail'
        workflow_group = next(group for group in result['checks'] if group['name'] == '抗震流程输入校核')
        item = workflow_group['items'][0]
        assert item['item'] == '结构化抗震流程输入'
        assert item['status'] == 'fail'
        assert item['inputs']['workflowInputMode'] == 'legacy_compatibility_parameters'
        assert item['inputs']['requiredWorkflowInputMode'] == 'structured_seismic_workflow'

    def test_global_seismic_checks_fail_when_capability_boundary_is_missing(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'summary': {
                    'maxStoryDriftRatio': 0.0012,
                    'modalMassParticipationRatio': 0.92,
                },
                'designBasis': {
                    'structuralFamily': 'bridge',
                    'isPreliminary': False,
                    'missingInputs': [],
                },
                'missingCapabilities': [
                    'gb50011.elasticDriftLimitForStructuralFamily',
                ],
                'capabilityAssessment': {
                    'structuralFamily': 'bridge',
                    'finalComplianceSupported': False,
                },
            },
        }

        result = gb50011.check_element(checker, gb50011.GLOBAL_SEISMIC_ELEMENT_ID, context)

        assert result['status'] == 'fail'
        capability_group = next(group for group in result['checks'] if group['name'] == '抗震能力边界校核')
        item = capability_group['items'][0]
        assert item['item'] == '抗震能力边界'
        assert item['status'] == 'fail'
        assert item['displayUtilization'] == 'N/A'
        assert item['governingEligible'] is False
        assert item['inputs']['finalComplianceSupported'] is False
        assert 'gb50011.elasticDriftLimitForStructuralFamily' in item['inputs']['missingCapabilities']

    def test_capability_boundary_does_not_control_summary_utilization(self):
        checker = generic_code_check.CodeChecker('GB50011')
        result = checker.check('model-capability-boundary', [gb50011.GLOBAL_SEISMIC_ELEMENT_ID], {
            'analysisSummary': {
                'workflowInputMode': 'structured_seismic_workflow',
                'summary': {
                    'maxStoryDriftRatio': 0.0012,
                    'modalMassParticipationRatio': 0.92,
                },
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'isPreliminary': False,
                    'missingInputs': [],
                    'fortificationCategory': 'standard',
                    'fortificationCategoryCodeClass': 'C',
                    'seismicActionStandard': 'local_fortification_intensity',
                    'seismicMeasureStandard': 'local_fortification_intensity',
                    'seismicMeasureIntensity': 8,
                    'seismicGrade': 4,
                    'seismicGradeSource': 'designRequirements.seismicGrade',
                    'codeBasis': [{
                        'code': 'GB 18306-2015',
                        'standardStatus': 'current',
                        'lastReviewConclusion': 'continue_valid',
                        'amendments': [{
                            'no': 'No.1',
                            'status': 'effective',
                            'effectiveDate': '2026-02-27',
                        }],
                    }],
                },
                'missingCapabilities': [
                    'gb50011.elasticPlasticTimeHistoryFullMemberAnalysis',
                ],
                'capabilityAssessment': {
                    'structuralFamily': 'concrete-frame',
                    'finalComplianceSupported': False,
                },
            },
        })

        assert result['summary']['failed'] == 1
        assert result['summary']['maxUtilization'] < 9999.0
        assert result['summary']['controllingCheck'] != '抗震能力边界'

    def test_global_seismic_checks_fail_special_system_review(self):
        checker = MockCodeChecker()
        context = {
            'analysisSummary': {
                'summary': {
                    'maxStoryDriftRatio': 0.0012,
                    'modalMassParticipationRatio': 0.92,
                },
                'designBasis': {
                    'structuralFamily': 'concrete-frame',
                    'isPreliminary': False,
                    'missingInputs': [],
                },
                'specialSystemReview': {
                    'reviewRequired': True,
                    'systems': ['isolation', 'energy_dissipation'],
                    'missingInputs': ['isolationSystem.equivalentDampingRatio'],
                    'capabilityBoundaries': [
                        'gb50011.isolationSystemSpecialSeismicAnalysis',
                        'gb50011.energyDissipationSystemSpecialSeismicAnalysis',
                    ],
                    'deviceCounts': {
                        'isolation': 2,
                        'energy_dissipation': 4,
                    },
                    'checks': [{
                        'item': '隔震层位移验收',
                        'status': 'pass',
                        'utilization': 0.8,
                        'clause': 'GB 55002-2021 + GB/T 50011-2010(2024)',
                        'formula': 'demand / capacity <= 1.0',
                        'inputs': {
                            'demand': 0.08,
                            'capacity': 0.10,
                            'source': 'isolationSystem',
                            'unit': 'm',
                        },
                    }],
                    'isolationEquivalentLinearEstimate': {
                        'status': 'estimated',
                        'periodSec': 2.4,
                        'alpha': 0.04,
                        'baseShearKN': 120.0,
                        'displacementDemandM': 0.08,
                        'displacementCapacityM': 0.12,
                        'displacementUtilization': 0.666667,
                    },
                    'isolationLayerTimeHistoryEstimate': {
                        'status': 'estimated',
                        'engineMode': 'isolation_layer_sdof_time_history_estimate',
                        'periodSec': 2.4,
                        'recordCount': 3,
                        'controllingRecord': 'ISO-TH-1',
                        'maxDisplacementM': 0.09,
                        'maxBaseShearKN': 135.0,
                        'displacementCapacityM': 0.12,
                        'displacementUtilization': 0.75,
                    },
                    'energyDissipationEquivalentEstimate': {
                        'status': 'estimated',
                        'periodSec': 1.2,
                        'baseDampingRatio': 0.05,
                        'additionalDampingRatio': 0.08,
                        'equivalentDampingRatio': 0.13,
                        'demandReductionRatio': 0.7,
                        'adjustedDisplacementDemandM': 0.028,
                        'deformationCapacityM': 0.06,
                        'deformationUtilization': 0.466667,
                    },
                    'energyDissipationTimeHistoryEstimate': {
                        'status': 'estimated',
                        'engineMode': 'energy_dissipation_sdof_time_history_estimate',
                        'periodSec': 1.18,
                        'recordCount': 3,
                        'controllingRecord': 'ED-TH-1',
                        'maxDeviceDeformationM': 0.031,
                        'maxDeviceForceKN': 820.0,
                        'deformationCapacityM': 0.06,
                        'deformationUtilization': 0.516667,
                        'forceCapacityKN': 1000.0,
                        'forceUtilization': 0.82,
                    },
                },
            },
        }

        result = gb50011.check_element(checker, gb50011.GLOBAL_SEISMIC_ELEMENT_ID, context)

        assert result['status'] == 'fail'
        special_group = next(group for group in result['checks'] if group['name'] == '隔震与消能减震专门体系校核')
        item = special_group['items'][0]
        assert item['item'] == '隔震与消能减震专门体系审计'
        assert item['status'] == 'fail'
        assert item['inputs']['systems'] == ['isolation', 'energy_dissipation']
        assert item['inputs']['deviceCounts']['isolation'] == 2
        assert item['inputs']['checks'][0]['item'] == '隔震层位移验收'
        assert item['inputs']['checks'][0]['status'] == 'pass'
        assert item['inputs']['checks'][0]['inputs']['demand'] == 0.08
        assert item['inputs']['checks'][0]['inputs']['capacity'] == 0.10
        assert item['inputs']['checks'][0]['inputs']['source'] == 'isolationSystem'
        assert item['inputs']['isolationEquivalentLinearEstimate']['status'] == 'estimated'
        assert item['inputs']['isolationEquivalentLinearEstimate']['displacementDemandM'] == 0.08
        assert item['inputs']['isolationLayerTimeHistoryEstimate']['status'] == 'estimated'
        assert item['inputs']['isolationLayerTimeHistoryEstimate']['controllingRecord'] == 'ISO-TH-1'
        assert item['inputs']['isolationLayerTimeHistoryEstimate']['maxDisplacementM'] == 0.09
        assert item['inputs']['energyDissipationEquivalentEstimate']['status'] == 'estimated'
        assert item['inputs']['energyDissipationEquivalentEstimate']['adjustedDisplacementDemandM'] == 0.028
        assert item['inputs']['energyDissipationTimeHistoryEstimate']['status'] == 'estimated'
        assert item['inputs']['energyDissipationTimeHistoryEstimate']['controllingRecord'] == 'ED-TH-1'
        assert item['inputs']['energyDissipationTimeHistoryEstimate']['maxDeviceForceKN'] == 820.0
        assert 'isolationSystem.equivalentDampingRatio' in item['inputs']['missingInputs']
        assert 'gb50011.isolationSystemSpecialSeismicAnalysis' in item['inputs']['capabilityBoundaries']


class TestCodeCheckSummary:

    def test_summary_counts_not_applicable_items_without_marking_compliance_passed(self):
        checker = generic_code_check.CodeChecker('GB50011')
        result = checker.check(
            'model-wall-boundary-missing',
            ['W1'],
            {
                'analysisSummary': {
                    'designBasis': {'structuralFamily': 'concrete-shear-wall'},
                },
                'elementData': {
                    'W1': {
                        'type': 'shear-wall',
                        'material': {'category': 'concrete', 'grade': 'C35'},
                        'requiresBoundaryElement': True,
                    },
                },
            },
        )

        assert result['summary']['total'] == 4
        assert result['summary']['failed'] == 0
        assert result['summary']['notApplicable'] == 1
        assert result['details'][0]['status'] == 'fail'
        assert result['summary']['controllingCheck'] != '抗震墙边缘构件构造'

    def test_summary_treats_missing_time_history_inputs_as_unavailable_not_failed(self):
        checker = generic_code_check.CodeChecker('GB50011')
        result = checker.check(
            'model-seismic-missing-ground-motion',
            [gb50011.GLOBAL_SEISMIC_ELEMENT_ID],
            {
                'analysisSummary': {
                    'analysisMode': 'opensees_china_seismic_workflow',
                    'workflowInputMode': 'structured_seismic_workflow',
                    'summary': {
                        'maxStoryDriftRatio': 0.0008,
                        'modalMassParticipationRatio': 0.92,
                    },
                    'designBasis': {
                        'structuralFamily': 'steel-frame',
                        'isPreliminary': False,
                        'missingInputs': [],
                        'codeBasis': [
                            {'code': 'GB 55002-2021'},
                            {'code': 'GB/T 50011-2010'},
                            {
                                'code': 'GB 18306-2015',
                                'standardStatus': 'current',
                                'lastReviewConclusion': 'continue_valid',
                                'amendments': [{
                                    'no': 'No.1',
                                    'status': 'effective',
                                    'effectiveDate': '2026-02-27',
                                }],
                                'revisionPlan': {'planNo': '20260055-Q-419', 'status': 'drafting'},
                            },
                        ],
                    },
                    'methodDecision': {
                        'requiresTimeHistory': True,
                        'requiredGroundMotionCount': 3,
                        'selectedMethods': ['response_spectrum'],
                    },
                    'groundMotionRequirement': {
                        'required': True,
                        'requiredCount': 3,
                        'providedCount': 0,
                        'missingCount': 3,
                    },
                    'responseSpectrum': {
                        'minimumStoryShearAdjustment': {'status': 'not_required'},
                    },
                },
            },
        )

        assert result['details'][0]['status'] == 'fail'
        assert result['summary']['failed'] == 0
        assert result['summary']['notApplicable'] == 1
        assert result['summary']['controllingCheck'] != '补充时程分析完整性'


if __name__ == '__main__':
    classes = [
        TestGetRules,
        TestCheckElementStructure,
        TestClauseReferences,
        TestCheckElementResult,
        TestShearWallDetailing,
        TestGlobalSeismicChecks,
        TestCodeCheckSummary,
    ]
    failures = []
    for test_class in classes:
        instance = test_class()
        for name in dir(instance):
            if not name.startswith('test_'):
                continue
            try:
                getattr(instance, name)()
                print(f'[ok] {test_class.__name__}.{name}')
            except Exception as exc:
                failures.append((test_class.__name__, name, exc))
                print(f'[fail] {test_class.__name__}.{name}: {exc}')
    if failures:
        raise SystemExit(1)
