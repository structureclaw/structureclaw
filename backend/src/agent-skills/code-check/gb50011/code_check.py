from __future__ import annotations

import math
from typing import Any, Dict, List, Optional

from gb50011_drift_limits import gb50011_elastic_drift_limit_metadata


GLOBAL_SEISMIC_ELEMENT_ID = '__global_seismic__'
GB50011_2024_CODE_VERSION = 'GB/T 50011-2010(2024)'
FRAME_COLUMN_AXIAL_RATIO_LIMITS = {
    1: 0.65,
    2: 0.75,
    3: 0.85,
    4: 0.90,
}
C30_DESIGN_STRENGTH_MPA = 14.3
C35_DESIGN_STRENGTH_MPA = 16.7
FRAME_COLUMN_STIRRUP_CHARACTERISTIC_VALUE_BINS = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.05]
FRAME_COLUMN_STIRRUP_CHARACTERISTIC_VALUES = {
    (1, 'ordinary'): [0.10, 0.11, 0.13, 0.15, 0.17, 0.20, 0.23],
    (1, 'spiral'): [0.08, 0.09, 0.11, 0.13, 0.15, 0.18, 0.21],
    (2, 'ordinary'): [0.08, 0.09, 0.11, 0.13, 0.15, 0.17, 0.19, 0.22, 0.24],
    (2, 'spiral'): [0.06, 0.07, 0.09, 0.11, 0.13, 0.15, 0.17, 0.20, 0.22],
    (3, 'ordinary'): [0.06, 0.07, 0.09, 0.11, 0.13, 0.15, 0.17, 0.20, 0.22],
    (3, 'spiral'): [0.05, 0.06, 0.07, 0.09, 0.11, 0.13, 0.15, 0.18, 0.20],
    (4, 'ordinary'): [0.06, 0.07, 0.09, 0.11, 0.13, 0.15, 0.17, 0.20, 0.22],
    (4, 'spiral'): [0.05, 0.06, 0.07, 0.09, 0.11, 0.13, 0.15, 0.18, 0.20],
}
FRAME_JOINT_CORE_CHARACTERISTIC_MINIMUMS = {
    1: 0.12,
    2: 0.10,
    3: 0.08,
}
FRAME_JOINT_CORE_VOLUME_RATIO_MINIMUMS = {
    1: 0.6,
    2: 0.5,
    3: 0.4,
}
STORY_MINIMUM_SHEAR_COEFFICIENT_SHORT_PERIOD = {
    6: 0.008,
    7: 0.016,
    8: 0.032,
    9: 0.064,
}
STORY_MINIMUM_SHEAR_COEFFICIENT_LONG_PERIOD = {
    6: 0.006,
    7: 0.012,
    8: 0.024,
    9: 0.048,
}
STORY_MINIMUM_SHEAR_COEFFICIENT_HIGH_ACCELERATION = {
    7: (0.024, 0.018),
    8: (0.048, 0.036),
}


def get_rules() -> Dict[str, Any]:
    return {
        'code': 'GB50011',
        'codeBasis': ['GB 55002-2021', 'GB/T 50011-2010 (2024 partial revision)'],
        'version': 'v2-global-seismic-gb55002-gbt50011-2024',
        'rules': [
            {
                'id': 'gb50011_elastic_story_drift',
                'clause': 'GB/T 50011-2010(2024) 5.5.1',
                'description': 'Frequent-earthquake elastic story drift ratio check for supported structure families.',
            },
            {
                'id': 'gb50011_design_basis_completeness',
                'clause': 'GB 55002-2021 + GB/T 50011-2010(2024)',
                'description': 'Required China seismic design-basis inputs must be confirmed before final compliance is reported.',
            },
            {
                'id': 'gb50011_fortification_category_standard',
                'clause': 'GB 55002-2021 2.3.2 + GB 50223-2008',
                'description': 'Structured fortification category should determine seismic action and measure standards, including special-category safety-evaluation requirements.',
            },
            {
                'id': 'gb50011_seismic_grade_design_basis',
                'clause': 'GB/T 50011-2010(2024) 6.1 + 6.3/6.4',
                'description': 'Structured seismic grade should be a traceable Grade 1 to Grade 4 input before member seismic detailing and capacity checks consume it.',
            },
            {
                'id': 'gb50011_structured_seismic_workflow_input',
                'clause': 'GB 55002-2021 + GB/T 50011-2010(2024)',
                'description': 'Final China seismic compliance requires analysis results produced from a structured seismicWorkflow, not legacy compatibility parameters.',
            },
            {
                'id': 'gb50011_capability_boundary',
                'clause': 'GB 55002-2021 + GB/T 50011-2010(2024)',
                'description': 'Final code compliance must fail when required GB50011 seismic checks are outside implemented capabilities.',
            },
            {
                'id': 'gb50011_special_system_structured_review',
                'clause': 'GB 55002-2021 + GB/T 50011-2010(2024)',
                'description': 'Isolation and energy-dissipation systems must carry structured device/input audit data and remain failed until the specialized system analysis capability is available.',
            },
            {
                'id': 'gb50011_over_limit_special_review_trace',
                'clause': 'GB 55002-2021 + GB/T 50011-2010(2024)',
                'description': 'Structured over-limit or special seismic review requirements must carry traceable review evidence before final China seismic compliance is reported.',
            },
            {
                'id': 'gb50011_time_history_base_shear',
                'clause': 'GB/T 50011-2010(2024) 5.1.2',
                'description': 'Supplementary time-history base-shear comparison with response-spectrum results.',
            },
            {
                'id': 'gb50011_time_history_combination_rule',
                'clause': 'GB/T 50011-2010(2024) 5.1.2',
                'description': 'Time-history result combination should use the larger of the selected time-history statistic and response-spectrum result.',
            },
            {
                'id': 'gb50011_time_history_direction_trace',
                'clause': 'GB/T 50011-2010(2024) 5.1.2',
                'description': 'Bidirectional time-history checks should retain per-direction ground-motion and base-shear traceability when direction results are available.',
            },
            {
                'id': 'gb50011_elastic_plastic_time_history_final_compliance',
                'clause': 'GB 55002-2021 + GB/T 50011-2010(2024)',
                'description': 'Elastic-plastic time-history final compliance should be reported when an acceptance result is available.',
            },
            {
                'id': 'gb50011_required_time_history_completeness',
                'clause': 'GB/T 50011-2010(2024) 5.1.2',
                'description': 'Required supplementary time-history analysis must have ground-motion records and results.',
            },
            {
                'id': 'gb50011_regularity_time_history_trigger',
                'clause': 'GB/T 50011-2010(2024) 5.1.2',
                'description': 'Particularly irregular structures should trigger supplementary frequent-earthquake time-history analysis.',
            },
            {
                'id': 'gb50011_ground_motion_actual_ratio',
                'clause': 'GB/T 50011-2010(2024) 5.1.2',
                'description': 'Ground-motion set should include enough actual recorded motions when time-history checks are used.',
            },
            {
                'id': 'gb50011_ground_motion_record_count',
                'clause': 'GB/T 50011-2010(2024) 5.1.2',
                'description': 'Time-history ground-motion sets should use 3 records or at least 7 records.',
            },
            {
                'id': 'gb50011_ground_motion_scale_factor',
                'clause': 'GB/T 50011-2010(2024) 5.1.2',
                'description': 'Ground-motion amplitude scaling should be traceable and within the project advisory limit.',
            },
            {
                'id': 'gb50011_modal_mass_participation',
                'clause': 'GB/T 50011-2010(2024) 5.2.2',
                'description': 'Modal participating mass ratio should be sufficient for response-spectrum analysis.',
            },
            {
                'id': 'gb50011_response_spectrum_long_period_special_study',
                'clause': 'GB/T 50011-2010(2024) 5.1.5',
                'description': 'Response-spectrum modes beyond the normal code spectrum period range require a project-specific long-period special study.',
            },
            {
                'id': 'gb50011_story_minimum_seismic_shear_coefficient',
                'clause': 'GB/T 50011-2010(2024) 5.2.5',
                'description': 'Each story horizontal seismic shear coefficient should not be lower than the GB50011 minimum coefficient, with weak stories increased by 15%.',
            },
            {
                'id': 'gb50011_vertical_seismic_action',
                'clause': 'GB/T 50011-2010(2024) 5.3',
                'description': 'Required vertical seismic action should be calculated when triggered by structured code conditions.',
            },
            {
                'id': 'gb50011_vertical_seismic_member_forces',
                'clause': 'GB/T 50011-2010(2024) 5.3',
                'description': 'Calculated vertical seismic action should be propagated to member force effects.',
            },
            {
                'id': 'gb50011_pushover_nonlinear_estimate_drift',
                'clause': 'GB 55002-2021 + GB/T 50011-2010(2024)',
                'description': 'Estimated nonlinear pushover drift should be reported against the structured or advisory acceptance drift.',
            },
            {
                'id': 'gb50011_pushover_final_compliance',
                'clause': 'GB 55002-2021 + GB/T 50011-2010(2024)',
                'description': 'Pushover final compliance should be reported when an acceptance result is available.',
            },
            {
                'id': 'gb50011_horizontal_seismic_member_forces',
                'clause': 'GB/T 50011-2010(2024) 5.2',
                'description': 'Horizontal seismic floor actions should be propagated to member force effects when design-action extraction is available.',
            },
            {
                'id': 'gb50011_seismic_basic_action_combination',
                'clause': 'GB/T 50011-2010(2024) 5.4.1',
                'description': 'Gravity representative effects and seismic member effects should be combined for member design action envelopes.',
            },
            {
                'id': 'gb50011_seismic_basic_action_combination_member_capacity',
                'clause': 'GB 55002-2021 + GB/T 50011-2010(2024) 5.4.1',
                'description': 'Available seismic combination member actions should be screened against section and material capacity data.',
            },
            {
                'id': 'gb50011_seismic_combination_member_structured_capacity',
                'clause': 'GB 55002-2021 + GB/T 50011-2010(2024) 5.4.1 + 5.4.2 + 6.2',
                'description': 'Per-member structured seismic combination demand/capacity or utilization checks should pass when capacity verification data is available, applying an explicit gammaRE capacity adjustment factor when supplied.',
            },
            {
                'id': 'gb50011_frame_joint_core_shear_capacity',
                'clause': 'GB/T 50011-2010(2024) 6.2.15 + Appendix D',
                'description': 'Grade 1 and Grade 2 concrete frame beam-column joint cores should provide structured seismic shear-capacity verification; provided joint-core shear demand/capacity should pass.',
            },
            {
                'id': 'gb50011_frame_joint_strong_column_weak_beam',
                'clause': 'GB/T 50011-2010(2024) 6.2.2',
                'description': 'Concrete frame beam-column joints should provide structured strong-column weak-beam moment relationship checks when joint moment-capacity data is available.',
            },
            {
                'id': 'gb50011_frame_member_strong_shear_weak_bending',
                'clause': 'GB/T 50011-2010(2024) 6.2.4 + 6.2.5',
                'description': 'Concrete frame beams and columns should provide structured strong-shear weak-bending shear-capacity checks when capacity-design shear data is available.',
            },
            {
                'id': 'gb50011_concrete_member_shear_compression_limit',
                'clause': 'GB/T 50011-2010(2024) 6.2.9',
                'description': 'Concrete beams, columns, seismic walls, and coupling beams should satisfy the shear-compression section limit when structured shear, material, and effective-section data is available.',
            },
            {
                'id': 'gb50011_frame_column_axial_compression_ratio',
                'clause': 'GB/T 50011-2010(2024) 6.3.6',
                'description': 'Concrete frame-column axial compression ratio should satisfy the limit for the structured seismic grade.',
            },
            {
                'id': 'gb50011_frame_column_shear_span_ratio',
                'clause': 'GB/T 50011-2010(2024) 6.3.6',
                'description': 'Concrete frame-column shear-span ratio should be traced for short-column requirements and axial-ratio limit adjustment.',
            },
            {
                'id': 'gb50011_frame_column_longitudinal_reinforcement',
                'clause': 'GB/T 50011-2010(2024) 6.3.7',
                'description': 'Concrete frame-column longitudinal reinforcement ratio should satisfy seismic detailing minimums.',
            },
            {
                'id': 'gb50011_frame_column_longitudinal_detailing',
                'clause': 'GB/T 50011-2010(2024) 6.3.8',
                'description': 'Concrete frame-column longitudinal bars should satisfy symmetry, spacing, maximum total ratio, and short-column side-ratio detailing limits when structured data is available.',
            },
            {
                'id': 'gb50011_frame_column_stirrup_detailing',
                'clause': 'GB/T 50011-2010(2024) 6.3.7',
                'description': 'Concrete frame-column confined-zone stirrup spacing and diameter should satisfy seismic detailing limits.',
            },
            {
                'id': 'gb50011_frame_column_stirrup_confined_zone_range',
                'clause': 'GB/T 50011-2010(2024) 6.3.9',
                'description': 'Concrete frame-column stirrup confined-zone length should satisfy column-end and full-height confinement requirements when structured data is available.',
            },
            {
                'id': 'gb50011_frame_column_stirrup_volume_ratio',
                'clause': 'GB/T 50011-2010(2024) 6.3.9',
                'description': 'Concrete frame-column stirrup volumetric ratio should satisfy confined-zone characteristic-value, absolute minimum, and non-confined-zone requirements when structured data is available.',
            },
            {
                'id': 'gb50011_frame_joint_core_stirrup_detailing',
                'clause': 'GB/T 50011-2010(2024) 6.3.10',
                'description': 'Concrete frame beam-column joint core stirrup spacing, diameter, characteristic value, and volumetric ratio should satisfy seismic detailing limits when structured data is available.',
            },
            {
                'id': 'gb55002_concrete_frame_member_strength_grade',
                'clause': 'GB 55002-2021 5.1.2',
                'description': 'Concrete frame beams/columns with seismic grade not lower than Grade 2 should use concrete strength grade not lower than C30.',
            },
            {
                'id': 'gb50011_frame_beam_section_geometry',
                'clause': 'GB/T 50011-2010(2024) 6.3.1',
                'description': 'Concrete frame beam section width, depth-to-width ratio, and clear span-to-depth ratio should satisfy seismic detailing geometry limits.',
            },
            {
                'id': 'gb50011_frame_beam_flat_beam_detailing',
                'clause': 'GB/T 50011-2010(2024) 6.3.2',
                'description': 'Concrete frame flat beam width, depth, column-bar relationship, floor arrangement, and Grade 1 restriction should satisfy seismic detailing limits when structured flat-beam data is available.',
            },
            {
                'id': 'gb50011_frame_beam_longitudinal_reinforcement',
                'clause': 'GB/T 50011-2010(2024) 6.3.4',
                'description': 'Concrete frame beam top and bottom continuous longitudinal reinforcement should satisfy seismic detailing limits.',
            },
            {
                'id': 'gb50011_frame_beam_end_longitudinal_ductility',
                'clause': 'GB/T 50011-2010(2024) 6.3.3 + 6.3.4',
                'description': 'Concrete frame beam-end longitudinal reinforcement should satisfy compression-zone, bottom/top area-ratio, and end tension-ratio seismic ductility limits.',
            },
            {
                'id': 'gb50011_frame_beam_through_joint_bar_diameter',
                'clause': 'GB/T 50011-2010(2024) 6.3.4',
                'description': 'Concrete frame beam longitudinal bars passing through an interior column should not exceed one-twentieth of the column dimension in that direction.',
            },
            {
                'id': 'gb50011_frame_beam_stirrup_detailing',
                'clause': 'GB/T 50011-2010(2024) 6.3.3 + 6.3.4',
                'description': 'Concrete frame beam-end confined-zone stirrup length, spacing, diameter, leg spacing, and hook detailing should satisfy seismic limits.',
            },
            {
                'id': 'gb50011_frame_column_section_geometry',
                'clause': 'GB/T 50011-2010(2024) 6.3.5',
                'description': 'Concrete frame column section side dimensions and long-to-short side ratio should satisfy seismic detailing geometry limits.',
            },
            {
                'id': 'gb50011_shear_wall_section_thickness',
                'clause': 'GB/T 50011-2010(2024) 6.4.1',
                'description': 'Concrete seismic-wall thickness should satisfy seismic grade, story-height, and bottom-strengthened-zone limits when structured wall data is available.',
            },
            {
                'id': 'gb50011_shear_wall_axial_compression_ratio',
                'clause': 'GB/T 50011-2010(2024) 6.4',
                'description': 'Concrete seismic-wall axial compression ratio should satisfy a structured project/code-derived limit when axial demand and limit data are available.',
            },
            {
                'id': 'gb50011_shear_wall_distributed_reinforcement',
                'clause': 'GB/T 50011-2010(2024) 6.4.2 + 6.4.3',
                'description': 'Concrete seismic-wall vertical and horizontal distributed reinforcement should satisfy layer, tie, ratio, spacing, and diameter detailing limits when structured wall data is available.',
            },
            {
                'id': 'gb50011_shear_wall_boundary_element_detailing',
                'clause': 'GB/T 50011-2010(2024) 6.4',
                'description': 'Concrete seismic-wall boundary or edge-member longitudinal and transverse detailing should satisfy structured code-derived limits when boundary-element data is available.',
            },
            {
                'id': 'gb50011_steel_member_seismic_detailing',
                'clause': 'GB/T 50011-2010(2024) 8.3 + 8.4',
                'description': 'Steel seismic members should satisfy structured code-derived slenderness and width-thickness detailing limits when comparable data is available.',
            },
        ],
    }


def _record(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _number(value: Any) -> Optional[float]:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return float(value)
    if isinstance(value, str) and value.strip():
        try:
            number = float(value)
        except ValueError:
            return None
        return number if math.isfinite(number) else None
    return None


def _check_item(
    item_name: str,
    *,
    demand: Optional[float],
    capacity: Optional[float],
    clause: str,
    formula: str,
    limit: Optional[float] = None,
    unavailable_message: Optional[str] = None,
) -> Dict[str, Any]:
    if demand is None or capacity is None or capacity <= 0.0:
        return {
            'item': item_name,
            'status': 'not_applicable',
            'utilization': 0.0,
            'displayUtilization': 'N/A',
            'category': 'input_required',
            'failureType': 'input_unavailable',
            'governingEligible': False,
            'clause': clause,
            'formula': formula,
            'inputs': {
                'demand': demand,
                'capacity': capacity,
                'limit': limit,
            },
            'message': unavailable_message or 'Required seismic analysis value is unavailable.',
        }
    utilization = demand / capacity
    return {
        'item': item_name,
        'status': 'pass' if utilization <= 1.0 else 'fail',
        'utilization': round(utilization, 4),
        'clause': clause,
        'formula': formula,
        'inputs': {
            'demand': round(demand, 8),
            'capacity': round(capacity, 8),
            'limit': limit if limit is None else round(limit, 8),
        },
    }


def _minimum_required_ratio_check_item(
    item_name: str,
    *,
    actual_ratio: Optional[float],
    required_ratio: float,
    clause: str,
    formula: str,
) -> Dict[str, Any]:
    if actual_ratio is None:
        return _check_item(
            item_name,
            demand=None,
            capacity=None,
            clause=clause,
            formula=formula,
            limit=required_ratio,
            unavailable_message='Required time-history base-shear ratio is unavailable.',
        )
    if actual_ratio <= 0.0:
        return {
            'item': item_name,
            'status': 'fail',
            'utilization': 0.0,
            'displayUtilization': 'N/A',
            'category': 'input_required',
            'failureType': 'missing_time_history_base_shear_ratio',
            'governingEligible': False,
            'clause': clause,
            'formula': formula,
            'inputs': {
                'demand': round(actual_ratio, 8),
                'capacity': required_ratio,
                'limit': required_ratio,
            },
            'message': 'Time-history base-shear ratio is zero; provide valid ground-motion response results before final compliance.',
        }
    capacity = max(actual_ratio, 1e-12)
    utilization = required_ratio / capacity
    return {
        'item': item_name,
        'status': 'pass' if utilization <= 1.0 else 'fail',
        'utilization': round(utilization, 4),
        'clause': clause,
        'formula': formula,
        'inputs': {
            'demand': round(actual_ratio, 8),
            'capacity': round(required_ratio, 8),
            'limit': required_ratio,
        },
    }


def _elastic_drift_limit_metadata(design_basis: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    return gb50011_elastic_drift_limit_metadata(design_basis.get('structuralFamily'))


def _actual_ground_motion_item(checks: Dict[str, Any]) -> Dict[str, Any]:
    actual_count = _number(checks.get('actualRecordCount'))
    required_count = _number(checks.get('requiredActualRecordCount'))
    if actual_count is None or required_count is None or required_count <= 0.0:
        return _check_item(
            '实际强震记录比例',
            demand=None,
            capacity=None,
            clause='GB/T 50011-2010(2024) 5.1.2',
            formula='n_actual >= ceil(2n/3)',
            unavailable_message='Ground-motion actual-record counts are unavailable.',
        )
    if actual_count <= 0.0:
        return {
            'item': '实际强震记录比例',
            'status': 'fail',
            'utilization': 0.0,
            'displayUtilization': 'N/A',
            'category': 'input_required',
            'failureType': 'missing_actual_ground_motion_records',
            'governingEligible': False,
            'clause': 'GB/T 50011-2010(2024) 5.1.2',
            'formula': 'n_actual >= ceil(2n/3)',
            'inputs': {
                'demand': actual_count,
                'capacity': required_count,
                'limit': required_count,
            },
            'message': 'No actual strong-motion records are available; provide the required actual records before final time-history compliance.',
        }
    utilization = required_count / max(actual_count, 1e-12)
    return {
        'item': '实际强震记录比例',
        'status': 'pass' if utilization <= 1.0 else 'fail',
        'utilization': round(utilization, 4),
        'clause': 'GB/T 50011-2010(2024) 5.1.2',
        'formula': 'n_actual >= ceil(2n/3)',
        'inputs': {
            'demand': actual_count,
            'capacity': required_count,
            'limit': required_count,
        },
    }


def _ground_motion_record_count_item(time_history: Dict[str, Any], checks: Dict[str, Any]) -> Dict[str, Any]:
    records = time_history.get('records') if isinstance(time_history.get('records'), list) else []
    record_count = _number(checks.get('recordCount'))
    if record_count is None and records:
        record_count = float(len(records))
    if record_count is None:
        return _check_item(
            '地震波组数规则',
            demand=None,
            capacity=None,
            clause='GB/T 50011-2010(2024) 5.1.2',
            formula='n_records == 3 or n_records >= 7',
            unavailable_message='Ground-motion record count is unavailable.',
        )
    count = int(record_count)
    valid = count == 3 or count >= 7
    return {
        'item': '地震波组数规则',
        'status': 'pass' if valid else 'fail',
        'utilization': 0.0,
        **({} if valid else {
            'displayUtilization': 'N/A',
            'category': 'input_required',
            'failureType': 'invalid_ground_motion_record_count',
            'governingEligible': False,
            'message': 'Ground-motion record count must be exactly 3 or at least 7 for the implemented time-history combination rules.',
        }),
        'clause': 'GB/T 50011-2010(2024) 5.1.2',
        'formula': 'n_records == 3 or n_records >= 7',
        'inputs': {
            'recordCount': count,
            'allowedCounts': '3 or >=7',
        },
    }


def _time_history_combination_rule_item(time_history: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    summary = _record(time_history.get('combinationSummary'))
    if not summary:
        return None
    record_count = _number(summary.get('recordCount'))
    records = time_history.get('records') if isinstance(time_history.get('records'), list) else []
    if record_count is None and records:
        record_count = float(len(records))
    response_base = _number(summary.get('responseSpectrumBaseShear'))
    if response_base is None:
        response_base = _number(_record(time_history.get('baseShearCheck')).get('responseSpectrumBaseShear'))
    envelope_base = _number(summary.get('timeHistoryEnvelopeBaseShear'))
    if envelope_base is None:
        envelope_base = _number(time_history.get('envelopeBaseShear'))
    average_base = _number(summary.get('timeHistoryAverageBaseShear'))
    if average_base is None:
        average_base = _number(time_history.get('averageBaseShear'))
    combined_base = _number(summary.get('combinedBaseShear'))
    if combined_base is None:
        combined_base = _number(time_history.get('combinedBaseShear'))
    if record_count is None or response_base is None or combined_base is None:
        return _check_item(
            '时程组合规则',
            demand=None,
            capacity=None,
            clause='GB/T 50011-2010(2024) 5.1.2',
            formula='V_combined = max(V_response_spectrum, V_time_history_statistic)',
            unavailable_message='Time-history combination summary is present but missing record count or base-shear values.',
        )
    rule = str(summary.get('rule') or time_history.get('combinationRule') or '').strip()
    use_average = rule == 'mean_vs_response_spectrum' and record_count >= 7.0
    expected_statistic_name = 'average' if use_average else 'envelope'
    time_history_statistic = average_base if use_average else envelope_base
    if time_history_statistic is None:
        return _check_item(
            '时程组合规则',
            demand=None,
            capacity=None,
            clause='GB/T 50011-2010(2024) 5.1.2',
            formula='V_combined = max(V_response_spectrum, V_time_history_statistic)',
            unavailable_message='Time-history combination summary is present but missing the required statistic base shear.',
        )
    expected_combined = max(response_base, time_history_statistic)
    expected_source = (
        'response_spectrum'
        if response_base >= time_history_statistic
        else f'time_history_{expected_statistic_name}'
    )
    statistic_name = str(summary.get('timeHistoryStatistic') or '').strip()
    governing_source = str(summary.get('governingSource') or '').strip()
    tolerance = max(abs(expected_combined) * 1e-6, 1e-6)
    numeric_ok = abs(combined_base - expected_combined) <= tolerance
    statistic_ok = statistic_name == expected_statistic_name
    source_ok = governing_source == expected_source
    passed = numeric_ok and statistic_ok and source_ok
    utilization = 0.0 if passed else max(abs(combined_base - expected_combined) / tolerance, 1.0001)
    return {
        'item': '时程组合规则',
        'status': 'pass' if passed else 'fail',
        'utilization': round(utilization, 4),
        'clause': 'GB/T 50011-2010(2024) 5.1.2',
        'formula': 'V_combined = max(V_response_spectrum, V_time_history_statistic)',
        'inputs': {
            'rule': rule,
            'recordCount': int(record_count),
            'timeHistoryStatistic': statistic_name,
            'expectedTimeHistoryStatistic': expected_statistic_name,
            'timeHistoryStatisticBaseShear': round(time_history_statistic, 8),
            'responseSpectrumBaseShear': round(response_base, 8),
            'combinedBaseShear': round(combined_base, 8),
            'expectedCombinedBaseShear': round(expected_combined, 8),
            'governingSource': governing_source,
            'expectedGoverningSource': expected_source,
        },
    }


def _ground_motion_scale_factor_item(spectrum_match: Dict[str, Any]) -> Dict[str, Any]:
    max_scale_factor = _number(spectrum_match.get('maxScaleFactor'))
    scale_factor_limit = _number(spectrum_match.get('scaleFactorLimit'))
    if max_scale_factor is None or scale_factor_limit is None or scale_factor_limit <= 0.0:
        return _check_item(
            '地震波调幅系数',
            demand=None,
            capacity=None,
            clause='GB/T 50011-2010(2024) 5.1.2',
            formula='max(scaleFactor) <= projectScaleFactorLimit',
            unavailable_message='Ground-motion spectrum-matching scale factors are unavailable.',
        )
    return _check_item(
        '地震波调幅系数',
        demand=max_scale_factor,
        capacity=scale_factor_limit,
        limit=scale_factor_limit,
        clause='GB/T 50011-2010(2024) 5.1.2',
        formula='max(scaleFactor) <= projectScaleFactorLimit',
    )


def _ground_motion_spectrum_compatibility_item(spectrum_match: Dict[str, Any]) -> Dict[str, Any]:
    min_average_ratio = _number(spectrum_match.get('averageModalSpectrumMinRatioToTarget'))
    required_ratio = _number(spectrum_match.get('modalSpectrumAverageMinRatio'))
    if min_average_ratio is None or required_ratio is None or required_ratio <= 0.0:
        return _check_item(
            '地震波反应谱适配',
            demand=None,
            capacity=None,
            clause='GB/T 50011-2010(2024) 5.1.2',
            formula='min(mean(Sa_TH(T_i) / Sa_code(T_i))) >= modalSpectrumAverageMinRatio',
            unavailable_message='Ground-motion modal-period spectrum compatibility ratios are unavailable.',
        )
    if min_average_ratio <= 0.0:
        return {
            'item': '地震波反应谱适配',
            'status': 'fail',
            'utilization': 0.0,
            'displayUtilization': 'N/A',
            'category': 'input_required',
            'failureType': 'missing_ground_motion_spectrum_compatibility',
            'governingEligible': False,
            'clause': 'GB/T 50011-2010(2024) 5.1.2',
            'formula': 'min(mean(Sa_TH(T_i) / Sa_code(T_i))) >= modalSpectrumAverageMinRatio',
            'inputs': {
                'demand': round(min_average_ratio, 8),
                'capacity': required_ratio,
                'limit': required_ratio,
                'periodCheckScope': spectrum_match.get('periodCheckScope'),
                'periodCheckCount': len(spectrum_match.get('periodChecks', [])) if isinstance(spectrum_match.get('periodChecks'), list) else 0,
            },
            'message': 'Ground-motion spectrum compatibility ratio is zero; provide valid scaled record spectra before final compliance.',
        }
    utilization = required_ratio / max(min_average_ratio, 1e-12)
    return {
        'item': '地震波反应谱适配',
        'status': 'pass' if utilization <= 1.0 else 'fail',
        'utilization': round(utilization, 4),
        'clause': 'GB/T 50011-2010(2024) 5.1.2',
        'formula': 'min(mean(Sa_TH(T_i) / Sa_code(T_i))) >= modalSpectrumAverageMinRatio',
        'inputs': {
            'demand': round(min_average_ratio, 8),
            'capacity': round(required_ratio, 8),
            'limit': required_ratio,
            'periodCheckScope': spectrum_match.get('periodCheckScope'),
            'periodCheckCount': len(spectrum_match.get('periodChecks', [])) if isinstance(spectrum_match.get('periodChecks'), list) else 0,
        },
    }


def _time_history_direction_trace_item(analysis_summary: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    direction_results = analysis_summary.get('directionResults')
    if not isinstance(direction_results, list):
        return None

    direction_checks: List[Dict[str, Any]] = []
    missing_directions: List[str] = []
    for index, raw_result in enumerate(direction_results, start=1):
        result = _record(raw_result)
        if not result:
            continue
        direction = str(result.get('direction') or f'D{index}')
        time_history = _record(result.get('timeHistory'))
        if not time_history:
            missing_directions.append(direction)
            continue

        records = time_history.get('records') if isinstance(time_history.get('records'), list) else []
        ratios = [
            _number(_record(record).get('baseShearRatioToResponseSpectrum'))
            for record in records
            if isinstance(record, dict)
        ]
        finite_ratios = [ratio for ratio in ratios if ratio is not None]
        base_shear_check = _record(time_history.get('baseShearCheck'))
        response_base = _number(base_shear_check.get('responseSpectrumBaseShear'))
        average_base = _number(time_history.get('averageBaseShear'))
        average_ratio = average_base / response_base if average_base is not None and response_base and response_base > 0 else None
        if average_ratio is None and finite_ratios:
            average_ratio = sum(finite_ratios) / len(finite_ratios)

        combination_rule_item = _time_history_combination_rule_item(time_history)
        subchecks = [
            _minimum_required_ratio_check_item(
                'direction_each_record_base_shear_ratio',
                actual_ratio=min(finite_ratios) if finite_ratios else None,
                required_ratio=0.65,
                clause='GB/T 50011-2010(2024) 5.1.2',
                formula='V_time_history_each / V_response_spectrum >= 0.65',
            ),
            _minimum_required_ratio_check_item(
                'direction_average_base_shear_ratio',
                actual_ratio=average_ratio,
                required_ratio=0.80,
                clause='GB/T 50011-2010(2024) 5.1.2',
                formula='mean(V_time_history) / V_response_spectrum >= 0.80',
            ),
            _actual_ground_motion_item(_record(time_history.get('groundMotionSetChecks'))),
            _ground_motion_record_count_item(time_history, _record(time_history.get('groundMotionSetChecks'))),
            *([combination_rule_item] if combination_rule_item else []),
            _ground_motion_scale_factor_item(_record(time_history.get('spectrumMatch'))),
            _ground_motion_spectrum_compatibility_item(_record(time_history.get('spectrumMatch'))),
        ]
        statuses = [str(item.get('status') or 'not_applicable') for item in subchecks]
        if any(status == 'fail' for status in statuses):
            direction_status = 'fail'
        elif any(status == 'pass' for status in statuses):
            direction_status = 'pass'
        else:
            direction_status = 'not_applicable'
        direction_checks.append({
            'direction': direction,
            'status': direction_status,
            'utilization': round(max(float(item.get('utilization', 0.0) or 0.0) for item in subchecks), 4),
            'recordCount': len(records),
            'minBaseShearRatio': round(min(finite_ratios), 8) if finite_ratios else None,
            'averageBaseShearRatio': round(average_ratio, 8) if average_ratio is not None else None,
            'responseSpectrumBaseShear': round(response_base, 8) if response_base is not None else None,
            'source': f'directionResults[{index}].timeHistory',
            'subchecks': subchecks,
        })

    if not direction_checks and not missing_directions:
        return None

    if any(item.get('status') == 'fail' for item in direction_checks):
        status = 'fail'
    elif any(item.get('status') == 'pass' for item in direction_checks):
        status = 'pass'
    else:
        status = 'not_applicable'
    utilization = max((float(item.get('utilization', 0.0) or 0.0) for item in direction_checks), default=0.0)
    return {
        'item': '时程方向级校核追踪',
        'status': status,
        'utilization': round(utilization, 4),
        'displayUtilization': 'N/A' if status != 'pass' else round(utilization, 4),
        'category': 'diagnostic',
        'governingEligible': False,
        **({} if status == 'pass' else {'failureType': 'time_history_direction_trace'}),
        'clause': 'GB/T 50011-2010(2024) 5.1.2',
        'formula': 'each direction checks ground-motion count, actual-record ratio, base-shear ratios, combination rule, scale factor, and spectrum compatibility',
        'inputs': {
            'checkedDirectionCount': len(direction_checks),
            'missingDirectionCount': len(missing_directions),
            'missingDirections': missing_directions,
            'directionChecks': direction_checks,
        },
    }


def _is_true(value: Any) -> bool:
    return value is True or (isinstance(value, str) and value.strip().lower() in {'true', 'yes', '1'})


def _is_false(value: Any) -> bool:
    return value is False or (isinstance(value, str) and value.strip().lower() in {'false', 'no', '0'})


def _optional_bool_from_sources(sources: tuple[Dict[str, Any], ...], keys: tuple[str, ...]) -> Optional[bool]:
    for source in sources:
        for key in keys:
            value = source.get(key)
            if _is_true(value):
                return True
            if _is_false(value):
                return False
    return None


def _ratio_percent_from_keys(
    source: Dict[str, Any],
    percent_keys: tuple[str, ...],
    ratio_keys: tuple[str, ...],
) -> Optional[float]:
    for key in percent_keys:
        ratio = _number(source.get(key))
        if ratio is not None and ratio >= 0.0:
            return ratio
    for key in ratio_keys:
        ratio = _number(source.get(key))
        if ratio is not None and ratio >= 0.0:
            return ratio * 100.0 if ratio <= 1.0 else ratio
    return None


def _section_modulus_mm3(section: Dict[str, Any]) -> Optional[float]:
    for key in ('Wnx', 'Wx', 'W'):
        value = _number(section.get(key))
        if value is not None and value > 0.0:
            return value
    area = _number(section.get('A'))
    inertia = _number(section.get('I'))
    if inertia is None:
        inertia = _number(section.get('Iy')) or _number(section.get('Iz'))
    if area is None or inertia is None or area <= 0.0 or inertia <= 0.0:
        return None
    equivalent_depth = math.sqrt(max(12.0 * inertia / area, 1e-12))
    return 2.0 * inertia / max(equivalent_depth, 1e-12)


def _material_strength_mpa(material: Dict[str, Any]) -> Optional[float]:
    for key in ('fc', 'f', 'fy'):
        value = _number(material.get(key))
        if value is not None and value > 0.0:
            return value
    if material:
        return 14.3
    return None


def _concrete_grade_value(value: Any) -> Optional[float]:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        number = float(value)
        return number if math.isfinite(number) and number > 0.0 else None
    text = str(value).strip().upper()
    if not text:
        return None
    if text.startswith('C'):
        text = text[1:]
    digits = []
    decimal_seen = False
    for char in text:
        if char.isdigit():
            digits.append(char)
        elif char == '.' and not decimal_seen:
            digits.append(char)
            decimal_seen = True
        elif digits:
            break
    if not digits:
        return None
    try:
        number = float(''.join(digits))
    except ValueError:
        return None
    return number if math.isfinite(number) and number > 0.0 else None


def _concrete_grade_from_material(material: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    extra = _record(material.get('extra'))
    for key in ('concreteGrade', 'grade', 'strengthGrade', 'name'):
        grade = _concrete_grade_value(material.get(key))
        if grade is not None:
            return {'grade': grade, 'source': f'material.{key}'}
    for key in ('concreteGrade', 'grade', 'strengthGrade'):
        grade = _concrete_grade_value(extra.get(key))
        if grade is not None:
            return {'grade': grade, 'source': f'material.extra.{key}'}
    for key in ('fc', 'f'):
        strength = _number(material.get(key))
        if strength is not None and strength > 0.0:
            return {'fcMPa': strength, 'source': f'material.{key}'}
    for key in ('fc', 'f'):
        strength = _number(extra.get(key))
        if strength is not None and strength > 0.0:
            return {'fcMPa': strength, 'source': f'material.extra.{key}'}
    return None


def _normalize_seismic_grade(value: Any) -> Optional[int]:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        grade = int(value)
        return grade if grade in FRAME_COLUMN_AXIAL_RATIO_LIMITS else None
    text = str(value).strip().lower()
    mapping = {
        '1': 1,
        'i': 1,
        'grade1': 1,
        'grade 1': 1,
        'first': 1,
        '一级': 1,
        '一': 1,
        '2': 2,
        'ii': 2,
        'grade2': 2,
        'grade 2': 2,
        'second': 2,
        '二级': 2,
        '二': 2,
        '3': 3,
        'iii': 3,
        'grade3': 3,
        'grade 3': 3,
        'third': 3,
        '三级': 3,
        '三': 3,
        '4': 4,
        'iv': 4,
        'grade4': 4,
        'grade 4': 4,
        'fourth': 4,
        '四级': 4,
        '四': 4,
    }
    return mapping.get(text)


def _element_context(context: Dict[str, Any], elem_id: str) -> Dict[str, Any]:
    return _record(_record(context.get('elementContextById')).get(elem_id))


def _element_metadata(context: Dict[str, Any], elem_id: str, element: Dict[str, Any]) -> Dict[str, Any]:
    metadata = _record(element.get('metadata'))
    if metadata:
        return metadata
    return _record(_element_context(context, elem_id).get('metadata'))


def _element_type(context: Dict[str, Any], elem_id: str, element: Dict[str, Any]) -> str:
    value = element.get('type')
    if value is None:
        value = _element_context(context, elem_id).get('type')
    return str(value or '').strip().lower()


def _is_concrete_frame_column(context: Dict[str, Any], elem_id: str, element: Dict[str, Any]) -> bool:
    element_type = _element_type(context, elem_id, element)
    if element_type not in {'column', 'frame-column', 'concrete-column', 'rc-column'}:
        return False
    material = _record(element.get('material'))
    category = str(material.get('category') or material.get('family') or '').strip().lower()
    name = str(material.get('name') or material.get('grade') or '').strip().lower()
    if category and category not in {'concrete', 'reinforced-concrete', 'rc'}:
        return False
    if not category and name and not (name.startswith('c') or 'concrete' in name):
        return False
    return True


def _is_concrete_frame_beam_or_column(context: Dict[str, Any], elem_id: str, element: Dict[str, Any]) -> bool:
    element_type = _element_type(context, elem_id, element)
    if element_type not in {'beam', 'frame-beam', 'concrete-beam', 'rc-beam', 'transfer-beam', 'column', 'frame-column', 'concrete-column', 'rc-column', 'transfer-column'}:
        return False
    material = _record(element.get('material'))
    category = str(material.get('category') or material.get('family') or '').strip().lower()
    name = str(material.get('name') or material.get('grade') or '').strip().lower()
    if category and category not in {'concrete', 'reinforced-concrete', 'rc'}:
        return False
    if not category and name and not (name.startswith('c') or 'concrete' in name):
        return False
    if category or name:
        return True
    structural_family = str(_record(_record(context.get('analysisSummary')).get('designBasis')).get('structuralFamily') or '').strip().lower()
    return 'concrete' in structural_family and 'frame' in structural_family


def _is_concrete_frame_beam(context: Dict[str, Any], elem_id: str, element: Dict[str, Any]) -> bool:
    element_type = _element_type(context, elem_id, element)
    return element_type in {'beam', 'frame-beam', 'concrete-beam', 'rc-beam', 'transfer-beam'} and _is_concrete_frame_beam_or_column(context, elem_id, element)


def _is_concrete_frame_joint(context: Dict[str, Any], elem_id: str, element: Dict[str, Any]) -> bool:
    element_type = _element_type(context, elem_id, element)
    if element_type not in {'joint', 'frame-joint', 'beam-column-joint', 'rc-joint', 'core-joint'}:
        return _is_concrete_frame_beam_or_column(context, elem_id, element)

    material = _record(element.get('material'))
    category = str(material.get('category') or material.get('family') or '').strip().lower()
    name = str(material.get('name') or material.get('grade') or '').strip().lower()
    if category and category not in {'concrete', 'reinforced-concrete', 'rc'}:
        return False
    if not category and name and not (name.startswith('c') or 'concrete' in name):
        return False
    if category or name:
        return True
    structural_family = str(_record(_record(context.get('analysisSummary')).get('designBasis')).get('structuralFamily') or '').strip().lower()
    return 'concrete' in structural_family and 'frame' in structural_family


def _is_concrete_shear_wall(context: Dict[str, Any], elem_id: str, element: Dict[str, Any]) -> bool:
    element_type = _element_type(context, elem_id, element)
    if element_type not in {'wall', 'shear-wall', 'shear_wall', 'seismic-wall', 'seismic_wall', 'structural-wall', 'structural_wall', 'rc-wall', 'concrete-wall'}:
        return False
    material = _record(element.get('material'))
    category = str(material.get('category') or material.get('family') or '').strip().lower()
    name = str(material.get('name') or material.get('grade') or '').strip().lower()
    if category and category not in {'concrete', 'reinforced-concrete', 'rc'}:
        return False
    if not category and name and not (name.startswith('c') or 'concrete' in name):
        return False
    if category or name:
        return True
    structural_family = str(_record(_record(context.get('analysisSummary')).get('designBasis')).get('structuralFamily') or '').strip().lower()
    return 'concrete' in structural_family and ('wall' in structural_family or 'shear' in structural_family)


def _is_steel_member(context: Dict[str, Any], elem_id: str, element: Dict[str, Any]) -> bool:
    element_type = _element_type(context, elem_id, element)
    if element_type not in {
        'beam',
        'frame-beam',
        'steel-beam',
        'column',
        'frame-column',
        'steel-column',
        'brace',
        'bracing',
        'steel-brace',
        'link',
        'steel-link',
    }:
        return False
    material = _record(element.get('material'))
    category = str(material.get('category') or material.get('family') or '').strip().lower()
    name = str(material.get('name') or material.get('grade') or '').strip().lower()
    if category:
        return category in {'steel', 'structural-steel', 'structural_steel'}
    if name:
        return 'steel' in name or name.startswith(('q235', 'q345', 'q355', 'q390', 'q420', 'q460'))
    structural_family = str(_record(_record(context.get('analysisSummary')).get('designBasis')).get('structuralFamily') or '').strip().lower()
    return 'steel' in structural_family


def _is_transfer_frame_member(context: Dict[str, Any], elem_id: str, element: Dict[str, Any]) -> bool:
    element_type = _element_type(context, elem_id, element)
    metadata = _element_metadata(context, elem_id, element)
    return element_type in {'transfer-beam', 'transfer-column', 'frame-supported-beam', 'frame-supported-column'} or _is_true(metadata.get('isTransferMember'))


def _dimension_mm(value: Any) -> Optional[float]:
    number = _number(value)
    if number is None or number <= 0.0:
        return None
    return number * 1000.0 if number <= 10.0 else number


def _section_dimension_mm(section: Dict[str, Any], *keys: str) -> Optional[float]:
    shape = _record(section.get('shape'))
    properties = _record(section.get('properties'))
    for source in (section, properties, shape):
        for key in keys:
            value = _dimension_mm(source.get(key))
            if value is not None:
                return value
    return None


def _reinforcement_data(element: Dict[str, Any]) -> Dict[str, Any]:
    section = _record(element.get('section'))
    return _record(element.get('reinforcement')) or _record(section.get('reinforcement'))


def _reinforcement_group(reinforcement: Dict[str, Any], *keys: str) -> Dict[str, Any]:
    for key in keys:
        group = _record(reinforcement.get(key))
        if group:
            return group
    return {}


def _reinforcement_count(group: Dict[str, Any]) -> Optional[float]:
    for key in ('count', 'barCount', 'number', 'bars'):
        count = _number(group.get(key))
        if count is not None and count >= 0.0:
            return count
    return None


def _reinforcement_diameter_mm(group: Dict[str, Any]) -> Optional[float]:
    for key in ('diameterMm', 'barDiameterMm', 'dMm'):
        diameter = _number(group.get(key))
        if diameter is not None and diameter > 0.0:
            return diameter
    for key in ('diameterM', 'barDiameterM', 'dM'):
        diameter_m = _number(group.get(key))
        if diameter_m is not None and diameter_m > 0.0:
            return diameter_m * 1000.0
    for key in ('diameter', 'd'):
        diameter = _number(group.get(key))
        if diameter is not None and diameter > 0.0:
            return diameter * 1000.0 if diameter <= 0.1 else diameter
    return None


def _reinforcement_area_mm2(group: Dict[str, Any]) -> Optional[float]:
    for key in ('areaMm2', 'asMm2', 'AsMm2', 'totalAreaMm2'):
        area = _number(group.get(key))
        if area is not None and area > 0.0:
            return area
    count = _reinforcement_count(group)
    diameter = _reinforcement_diameter_mm(group)
    if count is not None and count > 0.0 and diameter is not None and diameter > 0.0:
        return count * math.pi * diameter * diameter / 4.0
    return None


def _reinforcement_end_area_mm2(reinforcement: Dict[str, Any], side: str) -> Optional[float]:
    explicit_keys = (
        f'{side}EndMaxAreaMm2',
        f'end{side.capitalize()}MaxAreaMm2',
        f'maxEnd{side.capitalize()}AreaMm2',
    )
    for key in explicit_keys:
        area = _number(reinforcement.get(key))
        if area is not None and area > 0.0:
            return area

    side_group = _record(reinforcement.get(side))
    if side_group:
        area = _number(side_group.get('endMaxAreaMm2')) or _number(side_group.get('maxEndAreaMm2'))
        if area is not None and area > 0.0:
            return area

    candidate_areas: List[float] = []
    for key in (f'left{side.capitalize()}End', f'right{side.capitalize()}End', f'{side}LeftEnd', f'{side}RightEnd'):
        area = _reinforcement_area_mm2(_record(reinforcement.get(key)))
        if area is not None and area > 0.0:
            candidate_areas.append(area)
    return max(candidate_areas) if candidate_areas else None


def _section_area_mm2(section: Dict[str, Any]) -> Optional[float]:
    area = _number(section.get('A'))
    if area is not None and area > 0.0:
        return area
    width = _section_dimension_mm(section, 'width', 'b', 'B')
    height = _section_dimension_mm(section, 'height', 'h', 'H')
    if width is not None and height is not None:
        return width * height
    return None


def _rebar_strength_from_grade(value: Any) -> Optional[float]:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        number = float(value)
        return number if math.isfinite(number) and number > 0.0 else None
    text = str(value).strip().upper()
    if not text:
        return None
    digits = []
    decimal_seen = False
    for char in text:
        if char.isdigit():
            digits.append(char)
        elif char == '.' and not decimal_seen and digits:
            digits.append(char)
            decimal_seen = True
        elif digits:
            break
    if not digits:
        return None
    try:
        number = float(''.join(digits))
    except ValueError:
        return None
    return number if math.isfinite(number) and number > 0.0 else None


def _structured_rebar_strength_mpa(
    context: Dict[str, Any],
    elem_id: str,
    element: Dict[str, Any],
    reinforcement_group: Dict[str, Any],
) -> Optional[float]:
    metadata = _element_metadata(context, elem_id, element)
    element_context = _element_context(context, elem_id)
    material = _record(element.get('material'))
    source_key_groups = (
        (reinforcement_group, ('rebarGrade', 'grade', 'strengthGrade')),
        (metadata, ('rebarGrade', 'frameRebarGrade')),
        (element_context, ('rebarGrade', 'frameRebarGrade')),
        (material, ('rebarGrade', 'frameRebarGrade')),
        (_record(_record(context.get('analysisSummary')).get('designBasis')), ('rebarGrade', 'frameRebarGrade')),
    )
    for source, grade_keys in source_key_groups:
        for key in ('fykMPa', 'standardStrengthMPa', 'rebarStrengthMPa', 'rebarFykMPa'):
            value = _number(source.get(key))
            if value is not None and value > 0.0:
                return value
        for key in grade_keys:
            strength = _rebar_strength_from_grade(source.get(key))
            if strength is not None:
                return strength
    return None


def _column_longitudinal_reinforcement_group(reinforcement: Dict[str, Any]) -> Dict[str, Any]:
    return _reinforcement_group(
        reinforcement,
        'longitudinal',
        'longitudinalBars',
        'columnLongitudinal',
        'vertical',
        'main',
    )


def _column_stirrup_group(reinforcement: Dict[str, Any]) -> Dict[str, Any]:
    return _reinforcement_group(
        reinforcement,
        'stirrup',
        'stirrups',
        'hoop',
        'hoops',
        'tie',
        'ties',
        'transverse',
    )


def _frame_joint_core_group(
    context: Dict[str, Any],
    elem_id: str,
    element: Dict[str, Any],
    reinforcement: Dict[str, Any],
) -> Dict[str, Any]:
    metadata = _element_metadata(context, elem_id, element)
    element_context = _element_context(context, elem_id)
    sources = (
        _record(reinforcement.get('jointCore')),
        _record(reinforcement.get('jointCoreStirrup')),
        _record(reinforcement.get('jointCoreStirrups')),
        _record(reinforcement.get('coreJoint')),
        _record(reinforcement.get('beamColumnJoint')),
        _record(element.get('jointCore')),
        _record(element.get('jointCoreStirrup')),
        _record(element.get('joint')),
        _record(element.get('jointData')),
        _record(metadata.get('jointCore')),
        _record(metadata.get('jointData')),
        _record(element_context.get('jointCore')),
        _record(element_context.get('jointData')),
        _record(_record(context.get('jointData')).get(elem_id)),
        _record(_record(context.get('frameJointData')).get(elem_id)),
    )
    for source in sources:
        if source:
            stirrup = _reinforcement_group(
                source,
                'stirrup',
                'stirrups',
                'hoop',
                'hoops',
                'coreStirrup',
                'coreStirrups',
                'jointCoreStirrup',
                'jointCoreStirrups',
            )
            return stirrup or source
    return {}


def _ratio_percent_from_sources(
    sources: tuple[Dict[str, Any], ...],
    percent_keys: tuple[str, ...],
    ratio_keys: tuple[str, ...],
) -> Optional[float]:
    for source in sources:
        ratio = _ratio_percent_from_keys(source, percent_keys, ratio_keys)
        if ratio is not None:
            return ratio
    return None


def _joint_core_volume_ratio_percent(joint_core: Dict[str, Any], reinforcement: Dict[str, Any]) -> Optional[float]:
    return _ratio_percent_from_sources(
        (joint_core, reinforcement),
        (
            'volumeRatioPercent',
            'volumetricRatioPercent',
            'rhoVPercent',
            'coreVolumeRatioPercent',
            'jointCoreVolumeRatioPercent',
        ),
        (
            'volumeRatio',
            'volumetricRatio',
            'rhoV',
            'coreVolumeRatio',
            'jointCoreVolumeRatio',
        ),
    )


def _joint_core_characteristic_value(joint_core: Dict[str, Any], reinforcement: Dict[str, Any]) -> Optional[float]:
    for source in (joint_core, reinforcement):
        for key in (
            'characteristicValue',
            'stirrupCharacteristicValue',
            'coreCharacteristicValue',
            'jointCoreCharacteristicValue',
            'lambdaV',
            'lambdaNv',
        ):
            value = _number(source.get(key))
            if value is not None and value > 0.0:
                return value
    return None


def _joint_core_adjacent_column_volume_ratio_percent(joint_core: Dict[str, Any], reinforcement: Dict[str, Any]) -> Optional[float]:
    for source in (joint_core, reinforcement):
        explicit = _ratio_percent_from_sources(
            (source,),
            (
                'adjacentColumnEndMaxVolumeRatioPercent',
                'columnEndMaxVolumeRatioPercent',
                'upperLowerColumnEndMaxVolumeRatioPercent',
            ),
            (
                'adjacentColumnEndMaxVolumeRatio',
                'columnEndMaxVolumeRatio',
                'upperLowerColumnEndMaxVolumeRatio',
            ),
        )
        if explicit is not None:
            return explicit

        upper = _ratio_percent_from_sources(
            (source,),
            ('upperColumnEndVolumeRatioPercent',),
            ('upperColumnEndVolumeRatio',),
        )
        lower = _ratio_percent_from_sources(
            (source,),
            ('lowerColumnEndVolumeRatioPercent',),
            ('lowerColumnEndVolumeRatio',),
        )
        values = [value for value in (upper, lower) if value is not None]
        if values:
            return max(values)
    return None


def _joint_core_shear_demand_capacity(
    joint_core: Dict[str, Any],
    reinforcement: Dict[str, Any],
    element: Dict[str, Any],
) -> Dict[str, Optional[float]]:
    sources = (joint_core, reinforcement, element)
    demand = None
    capacity = None
    utilization = None
    for source in sources:
        if demand is None:
            for key in ('shearDemandKN', 'jointCoreShearDemandKN', 'coreShearDemandKN', 'VjKN', 'demandKN'):
                value = _number(source.get(key))
                if value is not None and value >= 0.0:
                    demand = value
                    break
        if capacity is None:
            for key in ('shearCapacityKN', 'jointCoreShearCapacityKN', 'coreShearCapacityKN', 'VjCapacityKN', 'capacityKN'):
                value = _number(source.get(key))
                if value is not None and value > 0.0:
                    capacity = value
                    break
        if utilization is None:
            for key in ('shearUtilization', 'jointCoreShearUtilization', 'utilization', 'demandCapacityRatio'):
                value = _number(source.get(key))
                if value is not None and value >= 0.0:
                    utilization = value
                    break
    return {
        'demandKN': demand,
        'capacityKN': capacity,
        'utilization': utilization,
    }


def _column_stirrup_volume_ratio_percent(reinforcement: Dict[str, Any], stirrup: Dict[str, Any]) -> Optional[float]:
    return _ratio_percent_from_sources(
        (stirrup, reinforcement),
        (
            'volumeRatioPercent',
            'volumetricRatioPercent',
            'rhoVPercent',
            'stirrupVolumeRatioPercent',
            'confinedVolumeRatioPercent',
        ),
        (
            'volumeRatio',
            'volumetricRatio',
            'rhoV',
            'stirrupVolumeRatio',
            'confinedVolumeRatio',
        ),
    )


def _column_non_confined_stirrup_volume_ratio_percent(
    reinforcement: Dict[str, Any],
    stirrup: Dict[str, Any],
) -> Optional[float]:
    return _ratio_percent_from_sources(
        (stirrup, reinforcement),
        (
            'nonConfinedVolumeRatioPercent',
            'unconfinedVolumeRatioPercent',
            'nonConfinedRhoVPercent',
        ),
        (
            'nonConfinedVolumeRatio',
            'unconfinedVolumeRatio',
            'nonConfinedRhoV',
        ),
    )


def _column_stirrup_type_key(stirrup: Dict[str, Any]) -> str:
    raw = str(
        stirrup.get('stirrupType')
        or stirrup.get('hoopType')
        or stirrup.get('configuration')
        or ''
    ).strip().lower().replace('-', '_').replace(' ', '_')
    if raw in {
        'spiral',
        'spiral_hoop',
        'compound_spiral',
        'composite_spiral',
        'compound_rectangular_spiral',
        'continuous_compound_rectangular_spiral',
        '螺旋箍',
        '复合螺旋箍',
        '连续复合矩形螺旋箍',
    }:
        return 'spiral'
    return 'ordinary'


def _column_stirrup_yield_strength_mpa(
    context: Dict[str, Any],
    elem_id: str,
    element: Dict[str, Any],
    reinforcement: Dict[str, Any],
    stirrup: Dict[str, Any],
) -> Optional[float]:
    material = _record(element.get('material'))
    for source in (stirrup, reinforcement, material):
        for key in ('fyvMPa', 'stirrupFyvMPa', 'stirrupYieldStrengthMPa', 'yieldStrengthMPa', 'fyMPa'):
            strength = _number(source.get(key))
            if strength is not None and strength > 0.0:
                return strength
    return _structured_rebar_strength_mpa(context, elem_id, element, stirrup)


def _column_axial_compression_ratio_value(
    context: Dict[str, Any],
    elem_id: str,
    element: Dict[str, Any],
    reinforcement: Dict[str, Any],
    stirrup: Dict[str, Any],
) -> Optional[float]:
    for source in (stirrup, reinforcement, element, _element_metadata(context, elem_id, element), _element_context(context, elem_id)):
        for key in ('axialCompressionRatio', 'axialRatio', 'nOverFcA'):
            ratio = _number(source.get(key))
            if ratio is not None and ratio > 0.0:
                return ratio

    section = _record(element.get('section'))
    material = _record(element.get('material'))
    area = _number(section.get('A'))
    strength = _material_strength_mpa(material)
    axial_demand_kn = _element_axial_demand_kn(context, elem_id, element)
    if area is None or area <= 0.0 or strength is None or strength <= 0.0 or axial_demand_kn is None:
        return None
    return axial_demand_kn / max(strength * area / 1000.0, 1e-12)


def _column_stirrup_characteristic_value(
    grade: int,
    stirrup_type: str,
    axial_ratio: float,
    is_transfer: bool,
) -> Optional[Dict[str, Any]]:
    values = FRAME_COLUMN_STIRRUP_CHARACTERISTIC_VALUES.get((grade, stirrup_type))
    if not values:
        return None
    selected_bin = None
    selected_value = None
    for index, axial_limit in enumerate(FRAME_COLUMN_STIRRUP_CHARACTERISTIC_VALUE_BINS[:len(values)]):
        if axial_ratio <= axial_limit + 1e-12:
            selected_bin = axial_limit
            selected_value = values[index]
            break
    if selected_value is None:
        return None
    transfer_adjustment = 0.02 if is_transfer else 0.0
    return {
        'value': selected_value + transfer_adjustment,
        'baseValue': selected_value,
        'axialRatioBin': selected_bin,
        'transferAdjustment': transfer_adjustment,
    }


def _beam_end_stirrup_group(reinforcement: Dict[str, Any]) -> Dict[str, Any]:
    return _reinforcement_group(
        reinforcement,
        'endStirrup',
        'endStirrups',
        'confinedStirrup',
        'confinedStirrups',
        'stirrup',
        'stirrups',
        'hoop',
        'hoops',
        'transverse',
    )


def _beam_end_longitudinal_group(reinforcement: Dict[str, Any]) -> Dict[str, Any]:
    return _reinforcement_group(
        reinforcement,
        'endLongitudinal',
        'endLongitudinalBars',
        'beamEndLongitudinal',
        'beamEndLongitudinalBars',
        'endReinforcement',
        'endBars',
    )


def _beam_through_joint_longitudinal_group(reinforcement: Dict[str, Any]) -> Dict[str, Any]:
    return _reinforcement_group(
        reinforcement,
        'throughJoint',
        'throughJointBars',
        'throughColumn',
        'throughColumnBars',
        'middleJointLongitudinal',
        'throughInteriorColumnLongitudinal',
    )


def _dimension_from_keys_mm(source: Dict[str, Any], *keys: str) -> Optional[float]:
    for key in keys:
        value = _dimension_mm(source.get(key))
        if value is not None:
            return value
    return None


def _max_reinforcement_diameter_mm(group: Dict[str, Any]) -> Optional[float]:
    for key in ('maxDiameterMm', 'maxBarDiameterMm', 'maxDMm'):
        diameter = _number(group.get(key))
        if diameter is not None and diameter > 0.0:
            return diameter
    for key in ('maxDiameterM', 'maxBarDiameterM', 'maxDM'):
        diameter_m = _number(group.get(key))
        if diameter_m is not None and diameter_m > 0.0:
            return diameter_m * 1000.0
    return _reinforcement_diameter_mm(group)


def _beam_longitudinal_diameter_mm(reinforcement: Dict[str, Any]) -> Optional[float]:
    diameters: List[float] = []
    for group in (
        _reinforcement_group(reinforcement, 'topContinuous', 'continuousTop', 'longitudinalTopContinuous', 'topLongitudinalContinuous'),
        _reinforcement_group(reinforcement, 'bottomContinuous', 'continuousBottom', 'longitudinalBottomContinuous', 'bottomLongitudinalContinuous'),
        _record(reinforcement.get('leftTopEnd')),
        _record(reinforcement.get('rightTopEnd')),
        _record(reinforcement.get('leftBottomEnd')),
        _record(reinforcement.get('rightBottomEnd')),
        _record(reinforcement.get('topLeftEnd')),
        _record(reinforcement.get('topRightEnd')),
        _record(reinforcement.get('bottomLeftEnd')),
        _record(reinforcement.get('bottomRightEnd')),
        _reinforcement_group(reinforcement, 'longitudinal', 'longitudinalBars'),
    ):
        diameter = _reinforcement_diameter_mm(group)
        if diameter is not None:
            diameters.append(diameter)
    return min(diameters) if diameters else None


def _beam_through_joint_bar_diameter_mm(reinforcement: Dict[str, Any]) -> Optional[float]:
    through_joint = _beam_through_joint_longitudinal_group(reinforcement)
    for source in (through_joint, reinforcement):
        for key in (
            'throughJointBarDiameterMm',
            'maxThroughJointBarDiameterMm',
            'throughColumnBarDiameterMm',
            'maxThroughColumnBarDiameterMm',
            'throughInteriorColumnBarDiameterMm',
        ):
            diameter = _number(source.get(key))
            if diameter is not None and diameter > 0.0:
                return diameter
        for key in (
            'throughJointBarDiameter',
            'maxThroughJointBarDiameter',
            'throughColumnBarDiameter',
            'maxThroughColumnBarDiameter',
        ):
            diameter = _dimension_mm(source.get(key))
            if diameter is not None:
                return diameter
    return _max_reinforcement_diameter_mm(through_joint)


def _beam_through_joint_column_dimension_mm(
    context: Dict[str, Any],
    elem_id: str,
    element: Dict[str, Any],
    reinforcement: Dict[str, Any],
) -> Optional[float]:
    through_joint = _beam_through_joint_longitudinal_group(reinforcement)
    sources = (
        through_joint,
        reinforcement,
        _record(element.get('joint')),
        _record(element.get('jointData')),
        _record(element.get('connection')),
        _element_metadata(context, elem_id, element),
        _element_context(context, elem_id),
        _record(_record(context.get('jointData')).get(elem_id)),
        _record(_record(context.get('beamJointData')).get(elem_id)),
    )
    for source in sources:
        dimension = _dimension_from_keys_mm(
            source,
            'columnDimensionMm',
            'jointColumnDimensionMm',
            'directionColumnDimensionMm',
            'columnSideMm',
            'columnWidthMm',
            'rectangularColumnSideMm',
            'columnChordMm',
            'circularColumnChordMm',
            'barLocationChordMm',
            'columnDimension',
            'jointColumnDimension',
            'directionColumnDimension',
            'columnSide',
            'columnWidth',
            'columnChord',
            'circularColumnChord',
            'barLocationChord',
        )
        if dimension is not None:
            return dimension
    return None


def _flat_beam_detailing_group(
    context: Dict[str, Any],
    elem_id: str,
    element: Dict[str, Any],
    reinforcement: Dict[str, Any],
) -> Dict[str, Any]:
    metadata = _element_metadata(context, elem_id, element)
    element_context = _element_context(context, elem_id)
    sources = (
        _record(reinforcement.get('flatBeam')),
        _record(reinforcement.get('wideBeam')),
        _record(element.get('flatBeam')),
        _record(element.get('wideBeam')),
        _record(element.get('joint')),
        _record(element.get('jointData')),
        _record(metadata.get('flatBeam')),
        _record(metadata.get('wideBeam')),
        _record(element_context.get('flatBeam')),
        _record(element_context.get('wideBeam')),
        _record(_record(context.get('beamFlatData')).get(elem_id)),
        _record(_record(context.get('flatBeamData')).get(elem_id)),
    )
    for source in sources:
        if source:
            return source
    return {}


def _flat_beam_column_longitudinal_diameter_mm(flat_beam: Dict[str, Any], reinforcement: Dict[str, Any]) -> Optional[float]:
    for source in (flat_beam, reinforcement):
        diameter = _dimension_from_keys_mm(
            source,
            'columnLongitudinalDiameterMm',
            'columnLongitudinalMinDiameterMm',
            'columnBarDiameterMm',
            'columnMainBarDiameterMm',
            'jointColumnLongitudinalDiameterMm',
            'columnLongitudinalDiameter',
            'columnLongitudinalMinDiameter',
            'columnBarDiameter',
            'columnMainBarDiameter',
            'jointColumnLongitudinalDiameter',
        )
        if diameter is not None:
            return diameter
    return None


def _beam_end_tension_reinforcement_ratio_percent(reinforcement: Dict[str, Any]) -> Optional[float]:
    for source in (reinforcement, _beam_end_longitudinal_group(reinforcement), _beam_end_stirrup_group(reinforcement)):
        for key in (
            'endTensionReinforcementRatioPercent',
            'beamEndTensionReinforcementRatioPercent',
            'maxEndTensionReinforcementRatioPercent',
            'tensionReinforcementRatioPercent',
            'maxTensionReinforcementRatioPercent',
        ):
            ratio = _number(source.get(key))
            if ratio is not None and ratio > 0.0:
                return ratio
        for key in (
            'endTensionReinforcementRatio',
            'beamEndTensionReinforcementRatio',
            'maxEndTensionReinforcementRatio',
            'tensionReinforcementRatio',
            'maxTensionReinforcementRatio',
        ):
            ratio = _number(source.get(key))
            if ratio is not None and ratio > 0.0:
                return ratio * 100.0 if ratio <= 1.0 else ratio
    return None


def _beam_end_compression_zone_ratio(reinforcement: Dict[str, Any]) -> Optional[float]:
    for source in (_beam_end_longitudinal_group(reinforcement), reinforcement):
        for key in (
            'compressionZoneRatio',
            'relativeCompressionZoneHeight',
            'xOverH0',
            'compressionZoneHeightRatio',
            'maxCompressionZoneRatio',
            'maxRelativeCompressionZoneHeight',
        ):
            ratio = _number(source.get(key))
            if ratio is not None and ratio > 0.0:
                return ratio
    return None


def _reinforcement_area_from_group_keys(source: Dict[str, Any], *keys: str) -> Optional[float]:
    for key in keys:
        area = _reinforcement_area_mm2(_record(source.get(key)))
        if area is not None and area > 0.0:
            return area
    return None


def _beam_end_bottom_top_area_ratio(reinforcement: Dict[str, Any]) -> Optional[float]:
    end_group = _beam_end_longitudinal_group(reinforcement)
    for source in (end_group, reinforcement):
        for key in (
            'bottomTopAreaRatio',
            'bottomToTopAreaRatio',
            'endBottomTopAreaRatio',
            'endBottomToTopAreaRatio',
            'minEndBottomTopAreaRatio',
            'minBottomTopAreaRatio',
        ):
            ratio = _number(source.get(key))
            if ratio is not None and ratio > 0.0:
                return ratio

    side_ratios: List[float] = []
    for source in (reinforcement, end_group):
        for side in ('left', 'right'):
            side_label = side.capitalize()
            top_area = _reinforcement_area_from_group_keys(
                source,
                f'{side}TopEnd',
                f'top{side_label}End',
                f'{side}EndTop',
                f'end{side_label}Top',
            )
            bottom_area = _reinforcement_area_from_group_keys(
                source,
                f'{side}BottomEnd',
                f'bottom{side_label}End',
                f'{side}EndBottom',
                f'end{side_label}Bottom',
            )
            if top_area is not None and top_area > 0.0 and bottom_area is not None and bottom_area > 0.0:
                side_ratios.append(bottom_area / top_area)
    if side_ratios:
        return min(side_ratios)

    top_area = _reinforcement_end_area_mm2(reinforcement, 'top')
    bottom_area = _reinforcement_end_area_mm2(reinforcement, 'bottom')
    if top_area is not None and top_area > 0.0 and bottom_area is not None and bottom_area > 0.0:
        return bottom_area / top_area
    return None


def _column_position_text(context: Dict[str, Any], elem_id: str, element: Dict[str, Any]) -> str:
    metadata = _element_metadata(context, elem_id, element)
    element_context = _element_context(context, elem_id)
    values = [
        element.get('columnPosition'),
        element.get('columnCategory'),
        metadata.get('columnPosition'),
        metadata.get('columnCategory'),
        element_context.get('columnPosition'),
        element_context.get('columnCategory'),
    ]
    return ' '.join(str(value).strip().lower() for value in values if value is not None)


def _is_corner_or_frame_supported_column(context: Dict[str, Any], elem_id: str, element: Dict[str, Any]) -> bool:
    metadata = _element_metadata(context, elem_id, element)
    position = _column_position_text(context, elem_id, element)
    return (
        _is_transfer_frame_member(context, elem_id, element)
        or _is_true(element.get('isCornerColumn'))
        or _is_true(metadata.get('isCornerColumn'))
        or 'corner' in position
        or 'angle' in position
        or '角' in position
        or 'frame-supported' in position
        or '框支' in position
    )


def _site_category_text(context: Dict[str, Any]) -> str:
    design_basis = _record(_record(context.get('analysisSummary')).get('designBasis'))
    site = _record(design_basis.get('siteSeismic'))
    value = site.get('siteCategory') or design_basis.get('siteCategory')
    return str(value or '').strip().upper().replace('类', '')


def _structured_high_rise(context: Dict[str, Any]) -> bool:
    design_basis = _record(_record(context.get('analysisSummary')).get('designBasis'))
    for key in ('isHighRise', 'highRise'):
        if _is_true(design_basis.get(key)):
            return True
    return False


def _story_count(context: Dict[str, Any]) -> Optional[int]:
    analysis_summary = _record(context.get('analysisSummary'))
    design_basis = _record(analysis_summary.get('designBasis'))
    model_summary = _record(analysis_summary.get('modelSummary'))
    summary = _record(analysis_summary.get('summary'))
    for value in (
        design_basis.get('storyCount'),
        model_summary.get('storyCount'),
        summary.get('storyCount'),
    ):
        number = _number(value)
        if number is not None and number > 0.0:
            return int(number)
    return None


def _frame_column_min_side_mm(context: Dict[str, Any], elem_id: str, element: Dict[str, Any]) -> Optional[float]:
    metadata = _element_metadata(context, elem_id, element)
    for value in (
        element.get('minColumnSideMm'),
        metadata.get('minColumnSideMm'),
        _record(_record(context.get('analysisSummary')).get('designBasis')).get('minFrameColumnSideMm'),
    ):
        limit = _number(value)
        if limit is not None and limit > 0.0:
            return limit

    grade = _seismic_grade(context, elem_id, element)
    stories = _story_count(context)
    if stories is not None and stories <= 2:
        return 300.0
    if grade == 4:
        return 300.0
    if grade in {1, 2, 3} and (stories is None or stories > 2):
        return 400.0
    return None


def _beam_span_mm(context: Dict[str, Any], elem_id: str, element: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    metadata = _element_metadata(context, elem_id, element)
    element_context = _element_context(context, elem_id)
    for source, label in (
        (element, 'element'),
        (metadata, 'metadata'),
        (element_context, 'elementContext'),
    ):
        for key in ('clearSpanMm', 'netSpanMm', 'spanMm', 'lengthMm'):
            value = _dimension_mm(source.get(key))
            if value is not None:
                return {'spanMm': value, 'source': f'{label}.{key}'}
        for key in ('clearSpanM', 'netSpanM', 'spanM', 'lengthM'):
            value = _number(source.get(key))
            if value is not None and value > 0.0:
                return {'spanMm': value * 1000.0, 'source': f'{label}.{key}'}
    length = _dimension_mm(element.get('length'))
    if length is not None:
        return {'spanMm': length, 'source': 'element.length'}
    length = _dimension_mm(element_context.get('length'))
    if length is not None:
        return {'spanMm': length, 'source': 'elementContext.length'}
    return None


def _seismic_grade(context: Dict[str, Any], elem_id: str, element: Dict[str, Any]) -> Optional[int]:
    metadata = _element_metadata(context, elem_id, element)
    element_context = _element_context(context, elem_id)
    design_basis = _record(_record(context.get('analysisSummary')).get('designBasis'))
    for value in (
        element.get('seismicGrade'),
        element.get('antiSeismicGrade'),
        metadata.get('seismicGrade'),
        metadata.get('antiSeismicGrade'),
        element_context.get('seismicGrade'),
        design_basis.get('seismicGrade'),
        design_basis.get('antiSeismicGrade'),
    ):
        grade = _normalize_seismic_grade(value)
        if grade is not None:
            return grade
    return None


def _column_shear_span_ratio_info(context: Dict[str, Any], elem_id: str, element: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    metadata = _element_metadata(context, elem_id, element)
    element_context = _element_context(context, elem_id)
    for source, label in (
        (element, 'element'),
        (metadata, 'metadata'),
        (element_context, 'elementContext'),
    ):
        for key in (
            'shearSpanRatio',
            'columnShearSpanRatio',
            'columnLambda',
            'lambda',
        ):
            ratio = _number(source.get(key))
            if ratio is not None and ratio > 0.0:
                return {
                    'ratio': ratio,
                    'source': f'{label}.{key}',
                }
    return None


def _frame_column_axial_limit_info(
    context: Dict[str, Any],
    elem_id: str,
    element: Dict[str, Any],
    grade: int,
) -> Dict[str, Any]:
    metadata = _element_metadata(context, elem_id, element)
    design_basis = _record(_record(context.get('analysisSummary')).get('designBasis'))
    for value, source in (
        (element.get('axialCompressionRatioLimit'), 'element.axialCompressionRatioLimit'),
        (metadata.get('axialCompressionRatioLimit'), 'metadata.axialCompressionRatioLimit'),
        (design_basis.get('frameColumnAxialCompressionRatioLimit'), 'designBasis.frameColumnAxialCompressionRatioLimit'),
    ):
        limit = _number(value)
        if limit is not None and limit > 0.0:
            return {
                'limit': limit,
                'baseLimit': FRAME_COLUMN_AXIAL_RATIO_LIMITS[grade],
                'manualAdjustment': 0.0,
                'shearSpanRatio': None,
                'shearSpanRatioSource': None,
                'shearSpanLimitAdjustment': 0.0,
                'limitSource': source,
            }

    adjustment = 0.0
    adjustment_source = None
    for value, source in (
        (element.get('axialCompressionRatioLimitAdjustment'), 'element.axialCompressionRatioLimitAdjustment'),
        (metadata.get('axialCompressionRatioLimitAdjustment'), 'metadata.axialCompressionRatioLimitAdjustment'),
        (design_basis.get('frameColumnAxialCompressionRatioLimitAdjustment'), 'designBasis.frameColumnAxialCompressionRatioLimitAdjustment'),
    ):
        number = _number(value)
        if number is not None:
            adjustment = number
            adjustment_source = source
            break

    shear_info = _column_shear_span_ratio_info(context, elem_id, element)
    shear_ratio = _number(shear_info.get('ratio')) if shear_info else None
    shear_adjustment = -0.05 if shear_ratio is not None and shear_ratio <= 2.0 else 0.0
    base_limit = FRAME_COLUMN_AXIAL_RATIO_LIMITS[grade]
    return {
        'limit': max(0.10, base_limit + adjustment + shear_adjustment),
        'baseLimit': base_limit,
        'manualAdjustment': adjustment,
        'manualAdjustmentSource': adjustment_source,
        'shearSpanRatio': shear_ratio,
        'shearSpanRatioSource': shear_info.get('source') if shear_info else None,
        'shearSpanLimitAdjustment': shear_adjustment,
        'limitSource': 'GB/T 50011 table by seismic grade',
    }


def _axial_compression_ratio_limit(
    context: Dict[str, Any],
    elem_id: str,
    element: Dict[str, Any],
    grade: int,
) -> float:
    return float(_frame_column_axial_limit_info(context, elem_id, element, grade)['limit'])


def _member_combination_axial_demand_kn(analysis_summary: Dict[str, Any], elem_id: str) -> Optional[float]:
    combinations = _record(analysis_summary.get('memberDesignActionCombinations'))
    cases = combinations.get('cases')
    if not isinstance(cases, list):
        return None
    max_axial = 0.0
    found = False
    for raw_case in cases:
        case = _record(raw_case)
        actions = case.get('memberActions')
        if not isinstance(actions, list):
            continue
        for raw_action in actions:
            action = _record(raw_action)
            if str(action.get('elementId') or '') != elem_id:
                continue
            axial = _number(action.get('maxAbsAxialKN'))
            if axial is None:
                continue
            max_axial = max(max_axial, abs(axial))
            found = True
    return max_axial if found else None


def _member_combination_action_entries(analysis_summary: Dict[str, Any], elem_id: str) -> List[Dict[str, Any]]:
    combinations = _record(analysis_summary.get('memberDesignActionCombinations'))
    cases = combinations.get('cases')
    if not isinstance(cases, list):
        return []
    entries: List[Dict[str, Any]] = []
    for raw_case in cases:
        case = _record(raw_case)
        case_name = str(case.get('name') or '')
        actions = case.get('memberActions')
        if not isinstance(actions, list):
            continue
        for raw_action in actions:
            action = _record(raw_action)
            if str(action.get('elementId') or '') != elem_id:
                continue
            entries.append({
                **action,
                'case': case_name,
            })
    return entries


def _element_axial_demand_kn(context: Dict[str, Any], elem_id: str, element: Dict[str, Any]) -> Optional[float]:
    from_combinations = _member_combination_axial_demand_kn(_record(context.get('analysisSummary')), elem_id)
    if from_combinations is not None:
        return from_combinations

    forces = _record(element.get('forces'))
    direct_kn = _number(forces.get('maxAbsAxialKN')) or _number(element.get('maxAbsAxialKN'))
    if direct_kn is not None:
        return abs(direct_kn)
    axial_n = _number(forces.get('N')) or _number(forces.get('axial')) or _number(element.get('N'))
    if axial_n is not None:
        return abs(axial_n) / 1000.0
    return None


def _frame_column_axial_compression_ratio_item(
    elem_id: str,
    context: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    element = _record(_record(context.get('elementData')).get(elem_id))
    if not element or not _is_concrete_frame_column(context, elem_id, element):
        return None

    grade = _seismic_grade(context, elem_id, element)
    section = _record(element.get('section'))
    material = _record(element.get('material'))
    area = _number(section.get('A'))
    strength = _material_strength_mpa(material)
    axial_demand_kn = _element_axial_demand_kn(context, elem_id, element)
    if grade is None or area is None or area <= 0.0 or strength is None or strength <= 0.0 or axial_demand_kn is None:
        return None

    capacity_kn = strength * area / 1000.0
    axial_ratio = axial_demand_kn / max(capacity_kn, 1e-12)
    limit_info = _frame_column_axial_limit_info(context, elem_id, element, grade)
    limit = float(limit_info['limit'])
    utilization = axial_ratio / max(limit, 1e-12)
    return {
        'item': '框架柱轴压比限值',
        'status': 'pass' if utilization <= 1.0 else 'fail',
        'utilization': round(utilization, 4),
        'clause': 'GB/T 50011-2010(2024) 6.3.6',
        'formula': 'N/(fc*A) <= axial compression ratio limit by seismic grade; reduce by 0.05 when shear-span ratio <= 2',
        'inputs': {
            'elementId': elem_id,
            'seismicGrade': grade,
            'axialDemandKN': round(axial_demand_kn, 6),
            'areaMm2': round(area, 6),
            'fcMPa': round(strength, 6),
            'axialCompressionRatio': round(axial_ratio, 6),
            'limit': round(limit, 6),
            'baseLimit': round(float(limit_info['baseLimit']), 6),
            'manualAdjustment': round(float(limit_info.get('manualAdjustment') or 0.0), 6),
            'manualAdjustmentSource': limit_info.get('manualAdjustmentSource'),
            'shearSpanRatio': round(float(limit_info['shearSpanRatio']), 6) if limit_info.get('shearSpanRatio') is not None else None,
            'shearSpanRatioSource': limit_info.get('shearSpanRatioSource'),
            'shearSpanLimitAdjustment': round(float(limit_info.get('shearSpanLimitAdjustment') or 0.0), 6),
            'limitSource': limit_info.get('limitSource'),
        },
    }


def _frame_column_shear_span_ratio_item(
    elem_id: str,
    context: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    element = _record(_record(context.get('elementData')).get(elem_id))
    if not element or not _is_concrete_frame_column(context, elem_id, element):
        return None

    shear_info = _column_shear_span_ratio_info(context, elem_id, element)
    if not shear_info:
        return None

    ratio = _number(shear_info.get('ratio'))
    if ratio is None or ratio <= 0.0:
        return None

    minimum_without_special_measures = 1.5
    utilization = minimum_without_special_measures / max(ratio, 1e-12)
    return {
        'item': '框架柱剪跨比专项要求',
        'status': 'pass' if ratio >= minimum_without_special_measures else 'fail',
        'utilization': round(utilization, 4),
        'clause': 'GB/T 50011-2010(2024) 6.3.6',
        'formula': 'shear-span ratio >= 1.5; ratio <= 2 triggers axial-ratio limit reduction',
        'inputs': {
            'elementId': elem_id,
            'shearSpanRatio': round(ratio, 6),
            'source': shear_info.get('source'),
            'minimumWithoutSpecialMeasures': minimum_without_special_measures,
            'requiresSpecialStudy': ratio < minimum_without_special_measures,
            'requiresAxialRatioLimitReduction': ratio <= 2.0,
            'axialRatioLimitAdjustment': -0.05 if ratio <= 2.0 else 0.0,
        },
    }


def _frame_column_longitudinal_reinforcement_item(
    elem_id: str,
    context: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    element = _record(_record(context.get('elementData')).get(elem_id))
    if not element or not _is_concrete_frame_column(context, elem_id, element):
        return None

    reinforcement = _reinforcement_data(element)
    if not reinforcement:
        return None

    grade = _seismic_grade(context, elem_id, element)
    section = _record(element.get('section'))
    section_area = _section_area_mm2(section)
    longitudinal = _column_longitudinal_reinforcement_group(reinforcement)
    if grade is None:
        return None

    total_area = _reinforcement_area_mm2(longitudinal)
    if total_area is None:
        total_area = _number(reinforcement.get('longitudinalAreaMm2')) or _number(reinforcement.get('totalLongitudinalAreaMm2'))
    total_ratio = _number(longitudinal.get('ratioPercent')) or _number(longitudinal.get('reinforcementRatioPercent'))
    if total_ratio is None:
        ratio_fraction = _number(longitudinal.get('ratio')) or _number(longitudinal.get('reinforcementRatio'))
        if ratio_fraction is not None and ratio_fraction <= 1.0:
            total_ratio = ratio_fraction * 100.0
    if total_ratio is None and total_area is not None and section_area is not None and section_area > 0.0:
        total_ratio = total_area / section_area * 100.0

    side_area = (
        _number(longitudinal.get('sideMinAreaMm2'))
        or _number(longitudinal.get('minSideAreaMm2'))
        or _number(longitudinal.get('sideAreaMm2'))
        or _number(reinforcement.get('sideMinLongitudinalAreaMm2'))
    )
    side_ratio = (
        _number(longitudinal.get('sideMinRatioPercent'))
        or _number(longitudinal.get('sideReinforcementRatioPercent'))
        or _number(reinforcement.get('sideMinLongitudinalRatioPercent'))
    )
    if side_ratio is None:
        side_ratio_fraction = (
            _number(longitudinal.get('sideMinRatio'))
            or _number(longitudinal.get('sideReinforcementRatio'))
            or _number(reinforcement.get('sideMinLongitudinalRatio'))
        )
        if side_ratio_fraction is not None and side_ratio_fraction <= 1.0:
            side_ratio = side_ratio_fraction * 100.0
    if side_ratio is None and side_area is not None and section_area is not None and section_area > 0.0:
        side_ratio = side_area / section_area * 100.0

    if total_ratio is None and side_ratio is None:
        return None

    base_limits = (
        {1: 1.1, 2: 0.9, 3: 0.8, 4: 0.7}
        if _is_corner_or_frame_supported_column(context, elem_id, element)
        else {1: 1.0, 2: 0.8, 3: 0.7, 4: 0.6}
    )
    base_limit = base_limits[grade]
    strength = _structured_rebar_strength_mpa(context, elem_id, element, longitudinal)
    rebar_strength_adjustment = 0.0
    if strength is not None and strength < 400.0:
        rebar_strength_adjustment = 0.1
    elif strength is not None and abs(strength - 400.0) < 1e-9:
        rebar_strength_adjustment = 0.05
    concrete_grade = _concrete_grade_from_material(_record(element.get('material')))
    concrete_grade_value = _number(_record(concrete_grade).get('grade'))
    concrete_adjustment = 0.1 if concrete_grade_value is not None and concrete_grade_value > 60.0 else 0.0
    site_high_rise_adjustment = 0.1 if _site_category_text(context) == 'IV' and _structured_high_rise(context) else 0.0
    total_limit = base_limit + rebar_strength_adjustment + concrete_adjustment + site_high_rise_adjustment

    subchecks: List[Dict[str, Any]] = []
    if total_ratio is not None:
        total_utilization = total_limit / max(total_ratio, 1e-12)
        subchecks.append({
            'name': 'column_total_longitudinal_ratio',
            'status': 'pass' if total_utilization <= 1.0 else 'fail',
            'utilization': round(total_utilization, 4),
            'demand': round(total_ratio, 6),
            'limit': round(total_limit, 6),
            'formula': 'total longitudinal reinforcement ratio >= seismic minimum',
        })

    if side_ratio is not None:
        side_limit = 0.2
        side_utilization = side_limit / max(side_ratio, 1e-12)
        subchecks.append({
            'name': 'column_each_side_longitudinal_ratio',
            'status': 'pass' if side_utilization <= 1.0 else 'fail',
            'utilization': round(side_utilization, 4),
            'demand': round(side_ratio, 6),
            'limit': side_limit,
            'formula': 'longitudinal reinforcement ratio on each side >= 0.2%',
        })

    controlling = max(subchecks, key=lambda item: float(item.get('utilization', 0.0)))
    utilization = float(controlling.get('utilization', 0.0))
    return {
        'item': '框架柱纵筋构造',
        'status': 'pass' if all(item.get('status') == 'pass' for item in subchecks) else 'fail',
        'utilization': round(utilization, 4),
        'clause': 'GB/T 50011-2010(2024) 6.3.7',
        'formula': 'column longitudinal reinforcement ratio >= table minimum; each side >= 0.2%',
        'inputs': {
            'elementId': elem_id,
            'seismicGrade': grade,
            'sectionAreaMm2': round(section_area, 6) if section_area is not None else None,
            'totalLongitudinalAreaMm2': round(total_area, 6) if total_area is not None else None,
            'totalLongitudinalRatioPercent': round(total_ratio, 6) if total_ratio is not None else None,
            'sideMinLongitudinalAreaMm2': round(side_area, 6) if side_area is not None else None,
            'sideMinLongitudinalRatioPercent': round(side_ratio, 6) if side_ratio is not None else None,
            'columnCategory': 'corner_or_frame_supported' if _is_corner_or_frame_supported_column(context, elem_id, element) else 'frame_middle_or_edge',
            'baseLimitPercent': round(base_limit, 6),
            'rebarStrengthMPa': round(strength, 6) if strength is not None else None,
            'rebarStrengthAdjustmentPercent': round(rebar_strength_adjustment, 6),
            'concreteGrade': concrete_grade_value,
            'concreteGradeAdjustmentPercent': round(concrete_adjustment, 6),
            'siteHighRiseAdjustmentPercent': round(site_high_rise_adjustment, 6),
            'controlling': controlling,
            'subchecks': subchecks,
        },
    }


def _frame_column_longitudinal_detailing_item(
    elem_id: str,
    context: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    element = _record(_record(context.get('elementData')).get(elem_id))
    if not element or not _is_concrete_frame_column(context, elem_id, element):
        return None

    reinforcement = _reinforcement_data(element)
    if not reinforcement:
        return None

    grade = _seismic_grade(context, elem_id, element)
    section = _record(element.get('section'))
    width = _section_dimension_mm(section, 'width', 'b', 'B')
    height = _section_dimension_mm(section, 'height', 'h', 'H')
    section_area = _section_area_mm2(section)
    longitudinal = _column_longitudinal_reinforcement_group(reinforcement)

    total_area = _reinforcement_area_mm2(longitudinal)
    if total_area is None:
        for source in (longitudinal, reinforcement):
            for key in ('totalAreaMm2', 'areaMm2', 'longitudinalAreaMm2', 'totalLongitudinalAreaMm2'):
                value = _number(source.get(key))
                if value is not None and value >= 0.0:
                    total_area = value
                    break
            if total_area is not None:
                break

    total_ratio = _ratio_percent_from_keys(
        longitudinal,
        ('totalRatioPercent', 'ratioPercent', 'reinforcementRatioPercent', 'totalLongitudinalRatioPercent'),
        ('totalRatio', 'ratio', 'reinforcementRatio', 'totalLongitudinalRatio'),
    )
    if total_ratio is None:
        total_ratio = _ratio_percent_from_keys(
            reinforcement,
            ('totalLongitudinalRatioPercent', 'longitudinalRatioPercent'),
            ('totalLongitudinalRatio', 'longitudinalRatio'),
        )
    if total_ratio is None and total_area is not None and section_area is not None and section_area > 0.0:
        total_ratio = total_area / section_area * 100.0

    side_area = None
    for source in (longitudinal, reinforcement):
        for key in ('sideMinAreaMm2', 'minSideAreaMm2', 'sideAreaMm2', 'sideMinLongitudinalAreaMm2'):
            value = _number(source.get(key))
            if value is not None and value >= 0.0:
                side_area = value
                break
        if side_area is not None:
            break
    side_ratio = _ratio_percent_from_keys(
        longitudinal,
        ('sideMinRatioPercent', 'sideReinforcementRatioPercent', 'sideMinLongitudinalRatioPercent'),
        ('sideMinRatio', 'sideReinforcementRatio', 'sideMinLongitudinalRatio'),
    )
    if side_ratio is None:
        side_ratio = _ratio_percent_from_keys(
            reinforcement,
            ('sideMinLongitudinalRatioPercent',),
            ('sideMinLongitudinalRatio',),
        )
    if side_ratio is None and side_area is not None and section_area is not None and section_area > 0.0:
        side_ratio = side_area / section_area * 100.0

    spacing = (
        _dimension_from_keys_mm(longitudinal, 'maxSpacingMm', 'spacingMm', 'longitudinalSpacingMm', 'spacing')
        or _dimension_from_keys_mm(reinforcement, 'longitudinalMaxSpacingMm', 'longitudinalSpacingMm')
    )

    symmetric: Optional[bool] = None
    for source in (longitudinal, reinforcement, element):
        for key in ('isSymmetric', 'symmetric', 'longitudinalSymmetric'):
            if _is_true(source.get(key)):
                symmetric = True
                break
            if _is_false(source.get(key)):
                symmetric = False
                break
        if symmetric is not None:
            break

    small_eccentric_tension = False
    for source in (longitudinal, reinforcement, element):
        for key in ('smallEccentricTension', 'requiresSmallEccentricTensionIncrease'):
            if _is_true(source.get(key)):
                small_eccentric_tension = True
                break
        if small_eccentric_tension:
            break
    calculated_area = None
    for source in (longitudinal, reinforcement):
        for key in ('calculatedAreaMm2', 'requiredCalculatedAreaMm2', 'designAreaMm2'):
            value = _number(source.get(key))
            if value is not None and value > 0.0:
                calculated_area = value
                break
        if calculated_area is not None:
            break

    subchecks: List[Dict[str, Any]] = []
    if symmetric is not None:
        subchecks.append({
            'name': 'column_longitudinal_symmetric_configuration',
            'status': 'pass' if symmetric else 'fail',
            'utilization': 0.0 if symmetric else 2.0,
            'demand': symmetric,
            'limit': True,
            'formula': 'column longitudinal bars should be symmetrically arranged',
        })

    if width is not None and height is not None and max(width, height) > 400.0 and spacing is not None:
        spacing_utilization = spacing / 200.0
        subchecks.append({
            'name': 'column_longitudinal_spacing',
            'status': 'pass' if spacing_utilization <= 1.0 else 'fail',
            'utilization': round(spacing_utilization, 4),
            'demand': round(spacing, 6),
            'limit': 200.0,
            'formula': 'when column side dimension > 400mm, longitudinal bar spacing <= 200mm',
        })

    if total_ratio is not None:
        total_max_ratio = 5.0
        total_max_utilization = total_ratio / total_max_ratio
        subchecks.append({
            'name': 'column_total_longitudinal_ratio_max',
            'status': 'pass' if total_max_utilization <= 1.0 else 'fail',
            'utilization': round(total_max_utilization, 4),
            'demand': round(total_ratio, 6),
            'limit': total_max_ratio,
            'formula': 'total longitudinal reinforcement ratio <= 5%',
        })

    shear_info = _column_shear_span_ratio_info(context, elem_id, element)
    shear_ratio = _number(shear_info.get('ratio')) if shear_info else None
    if grade == 1 and shear_ratio is not None and shear_ratio <= 2.0 and side_ratio is not None:
        side_max_ratio = 1.2
        side_max_utilization = side_ratio / side_max_ratio
        subchecks.append({
            'name': 'column_grade_one_short_column_side_ratio_max',
            'status': 'pass' if side_max_utilization <= 1.0 else 'fail',
            'utilization': round(side_max_utilization, 4),
            'demand': round(side_ratio, 6),
            'limit': side_max_ratio,
            'formula': 'Grade 1 frame column with shear-span ratio <= 2: each-side longitudinal ratio <= 1.2%',
        })

    if small_eccentric_tension and calculated_area is not None and total_area is not None:
        required_area = 1.25 * calculated_area
        area_utilization = required_area / max(total_area, 1e-12)
        subchecks.append({
            'name': 'column_small_eccentric_tension_area_increase',
            'status': 'pass' if area_utilization <= 1.0 else 'fail',
            'utilization': round(area_utilization, 4),
            'demand': round(total_area, 6),
            'limit': round(required_area, 6),
            'formula': 'small-eccentric tension edge/corner/wall-end column longitudinal area >= 1.25 * calculated area',
        })

    if not subchecks:
        return None

    controlling = max(subchecks, key=lambda item: float(item.get('utilization', 0.0)))
    utilization = float(controlling.get('utilization', 0.0))
    return {
        'item': '框架柱纵筋补充构造',
        'status': 'pass' if all(item.get('status') == 'pass' for item in subchecks) else 'fail',
        'utilization': round(utilization, 4),
        'clause': 'GB/T 50011-2010(2024) 6.3.8',
        'formula': 'column longitudinal symmetry, spacing, maximum reinforcement ratio, short-column side-ratio, and small-eccentric-tension increase detailing',
        'inputs': {
            'elementId': elem_id,
            'seismicGrade': grade,
            'widthMm': round(width, 6) if width is not None else None,
            'heightMm': round(height, 6) if height is not None else None,
            'longitudinalSpacingMm': round(spacing, 6) if spacing is not None else None,
            'totalLongitudinalAreaMm2': round(total_area, 6) if total_area is not None else None,
            'totalLongitudinalRatioPercent': round(total_ratio, 6) if total_ratio is not None else None,
            'sideMinLongitudinalRatioPercent': round(side_ratio, 6) if side_ratio is not None else None,
            'shearSpanRatio': round(shear_ratio, 6) if shear_ratio is not None else None,
            'smallEccentricTension': small_eccentric_tension,
            'calculatedAreaMm2': round(calculated_area, 6) if calculated_area is not None else None,
            'controlling': controlling,
            'subchecks': subchecks,
        },
    }


def _frame_column_stirrup_detailing_item(
    elem_id: str,
    context: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    element = _record(_record(context.get('elementData')).get(elem_id))
    if not element or not _is_concrete_frame_column(context, elem_id, element):
        return None

    reinforcement = _reinforcement_data(element)
    if not reinforcement:
        return None

    grade = _seismic_grade(context, elem_id, element)
    if grade is None:
        return None

    longitudinal = _column_longitudinal_reinforcement_group(reinforcement)
    stirrup = _column_stirrup_group(reinforcement)
    if not stirrup:
        return None

    spacing = _dimension_mm(stirrup.get('spacingMm') or stirrup.get('spacing') or stirrup.get('s'))
    diameter = _reinforcement_diameter_mm(stirrup)
    longitudinal_min_diameter = (
        _dimension_mm(longitudinal.get('minDiameterMm'))
        or _dimension_mm(longitudinal.get('minimumDiameterMm'))
        or _reinforcement_diameter_mm(longitudinal)
    )
    if spacing is None and diameter is None:
        return None

    spacing_limit = None
    spacing_basis: List[str] = []
    if longitudinal_min_diameter is not None:
        multiplier = 6.0 if grade == 1 else 8.0
        spacing_limit = multiplier * longitudinal_min_diameter
        spacing_basis.append(f'{int(multiplier)}d')
    code_limit = 100.0 if grade in {1, 2} else 150.0
    if grade in {3, 4} and _is_true(stirrup.get('isColumnRoot')):
        code_limit = 100.0
        spacing_basis.append('column root 100mm')
    spacing_limit = min(spacing_limit, code_limit) if spacing_limit is not None else code_limit
    spacing_basis.append(f'{int(code_limit)}mm')

    shear_info = _column_shear_span_ratio_info(context, elem_id, element)
    shear_ratio = _number(shear_info.get('ratio')) if shear_info else None
    if shear_ratio is not None and shear_ratio <= 2.0:
        spacing_limit = min(spacing_limit, 100.0)
        spacing_basis.append('shear-span ratio <= 2: 100mm')
    if _is_transfer_frame_member(context, elem_id, element):
        spacing_limit = min(spacing_limit, 100.0)
        spacing_basis.append('frame-supported column: 100mm')

    leg_count = _number(stirrup.get('legCount') or stirrup.get('legs'))
    leg_spacing = _dimension_mm(stirrup.get('legSpacingMm') or stirrup.get('legSpacing'))
    if grade == 1 and diameter is not None and diameter > 12.0 and leg_count is not None and leg_count >= 4.0 and leg_spacing is not None and leg_spacing <= 150.0:
        spacing_limit = max(spacing_limit, 150.0)
        spacing_basis.append('Grade 1 large-diameter multi-leg relaxation capped at 150mm')
    if grade == 2 and diameter is not None and diameter >= 10.0 and leg_spacing is not None and leg_spacing <= 200.0:
        spacing_limit = max(spacing_limit, 150.0)
        spacing_basis.append('Grade 2 large-diameter multi-leg relaxation capped at 150mm')
    if shear_ratio is not None and shear_ratio <= 2.0:
        spacing_limit = min(spacing_limit, 100.0)

    diameter_limit = {1: 10.0, 2: 8.0, 3: 8.0, 4: 6.0}[grade]
    if grade == 4 and shear_ratio is not None and shear_ratio <= 2.0:
        diameter_limit = max(diameter_limit, 8.0)

    subchecks: List[Dict[str, Any]] = []
    if spacing is not None:
        spacing_utilization = spacing / max(spacing_limit, 1e-12)
        subchecks.append({
            'name': 'column_confined_stirrup_spacing',
            'status': 'pass' if spacing_utilization <= 1.0 else 'fail',
            'utilization': round(spacing_utilization, 4),
            'demand': round(spacing, 6),
            'limit': round(spacing_limit, 6),
            'formula': 'confined-zone stirrup spacing <= code spacing limit',
        })
    if diameter is not None:
        diameter_utilization = diameter_limit / max(diameter, 1e-12)
        subchecks.append({
            'name': 'column_confined_stirrup_diameter',
            'status': 'pass' if diameter_utilization <= 1.0 else 'fail',
            'utilization': round(diameter_utilization, 4),
            'demand': round(diameter, 6),
            'limit': round(diameter_limit, 6),
            'formula': 'confined-zone stirrup diameter >= code diameter limit',
        })

    if not subchecks:
        return None

    controlling = max(subchecks, key=lambda item: float(item.get('utilization', 0.0)))
    utilization = float(controlling.get('utilization', 0.0))
    return {
        'item': '框架柱箍筋加密区构造',
        'status': 'pass' if all(item.get('status') == 'pass' for item in subchecks) else 'fail',
        'utilization': round(utilization, 4),
        'clause': 'GB/T 50011-2010(2024) 6.3.7',
        'formula': 'confined-zone stirrup spacing <= min(6d/8d, 100/150mm); diameter >= grade limit',
        'inputs': {
            'elementId': elem_id,
            'seismicGrade': grade,
            'stirrupSpacingMm': round(spacing, 6) if spacing is not None else None,
            'stirrupDiameterMm': round(diameter, 6) if diameter is not None else None,
            'longitudinalMinDiameterMm': round(longitudinal_min_diameter, 6) if longitudinal_min_diameter is not None else None,
            'spacingLimitMm': round(spacing_limit, 6),
            'spacingBasis': spacing_basis,
            'diameterLimitMm': round(diameter_limit, 6),
            'shearSpanRatio': round(shear_ratio, 6) if shear_ratio is not None else None,
            'controlling': controlling,
            'subchecks': subchecks,
        },
    }


def _frame_column_stirrup_confined_zone_range_item(
    elem_id: str,
    context: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    element = _record(_record(context.get('elementData')).get(elem_id))
    if not element or not _is_concrete_frame_column(context, elem_id, element):
        return None

    reinforcement = _reinforcement_data(element)
    if not reinforcement:
        return None

    grade = _seismic_grade(context, elem_id, element)
    stirrup = _column_stirrup_group(reinforcement)
    if not stirrup:
        return None

    section = _record(element.get('section'))
    width = _section_dimension_mm(section, 'width', 'b', 'B')
    height = _section_dimension_mm(section, 'height', 'h', 'H', 'diameter', 'D')
    column_depth = max(value for value in (width, height) if value is not None) if (width is not None or height is not None) else None
    clear_height = (
        _dimension_from_keys_mm(element, 'clearHeightMm', 'netHeightMm', 'columnClearHeightMm', 'storyClearHeightMm', 'clearHeight', 'netHeight')
        or _dimension_from_keys_mm(_element_metadata(context, elem_id, element), 'clearHeightMm', 'netHeightMm', 'columnClearHeightMm', 'clearHeight', 'netHeight')
        or _dimension_from_keys_mm(_element_context(context, elem_id), 'clearHeightMm', 'netHeightMm', 'columnClearHeightMm', 'clearHeight', 'netHeight')
    )
    confined_length = (
        _dimension_from_keys_mm(stirrup, 'confinedLengthMm', 'endConfinedLengthMm', 'columnEndConfinedLengthMm', 'lengthMm', 'confinedLength', 'endConfinedLength')
        or _dimension_from_keys_mm(reinforcement, 'columnConfinedLengthMm', 'columnEndConfinedLengthMm', 'confinedLengthMm')
        or _dimension_from_keys_mm(element, 'columnConfinedLengthMm', 'columnEndConfinedLengthMm', 'confinedLengthMm')
    )
    bottom_confined_length = _dimension_from_keys_mm(
        stirrup,
        'bottomConfinedLengthMm',
        'lowerEndConfinedLengthMm',
        'columnRootConfinedLengthMm',
        'bottomConfinedLength',
        'lowerEndConfinedLength',
        'columnRootConfinedLength',
    )

    full_height_flag: Optional[bool] = None
    for source in (stirrup, reinforcement, element):
        for key in ('isFullHeightConfined', 'fullHeightConfined', 'confinedFullHeight'):
            if _is_true(source.get(key)):
                full_height_flag = True
                break
            if _is_false(source.get(key)):
                full_height_flag = False
                break
        if full_height_flag is not None:
            break

    shear_info = _column_shear_span_ratio_info(context, elem_id, element)
    shear_ratio = _number(shear_info.get('ratio')) if shear_info else None
    full_height_reasons: List[str] = []
    if shear_ratio is not None and shear_ratio <= 2.0:
        full_height_reasons.append('shear-span ratio <= 2')
    if clear_height is not None and column_depth is not None and clear_height / max(column_depth, 1e-12) <= 4.0:
        full_height_reasons.append('clear-height/depth ratio <= 4')
    if _is_transfer_frame_member(context, elem_id, element):
        full_height_reasons.append('frame-supported column')
    if grade in {1, 2} and _is_corner_or_frame_supported_column(context, elem_id, element):
        full_height_reasons.append('Grade 1/2 corner or frame-supported column')
    for source in (stirrup, reinforcement, element):
        for key in ('requiresFullHeightConfined', 'hasInfillShortColumn', 'isShortColumn'):
            if _is_true(source.get(key)):
                full_height_reasons.append(key)
                break

    subchecks: List[Dict[str, Any]] = []
    if full_height_reasons:
        if full_height_flag is not None:
            subchecks.append({
                'name': 'column_confined_zone_full_height',
                'status': 'pass' if full_height_flag else 'fail',
                'utilization': 0.0 if full_height_flag else 2.0,
                'demand': full_height_flag,
                'limit': True,
                'formula': 'required full-height column stirrup confinement should be provided',
                'reasons': full_height_reasons,
            })
        elif confined_length is not None and clear_height is not None:
            full_height_utilization = clear_height / max(confined_length, 1e-12)
            subchecks.append({
                'name': 'column_confined_zone_full_height',
                'status': 'pass' if full_height_utilization <= 1.0 else 'fail',
                'utilization': round(full_height_utilization, 4),
                'demand': round(confined_length, 6),
                'limit': round(clear_height, 6),
                'formula': 'required full-height column stirrup confinement length >= clear height',
                'reasons': full_height_reasons,
            })
    elif confined_length is not None and (column_depth is not None or clear_height is not None):
        candidates = [500.0]
        basis = ['500mm']
        if column_depth is not None:
            candidates.append(column_depth)
            basis.append('column section depth')
        if clear_height is not None:
            candidates.append(clear_height / 6.0)
            basis.append('clear height / 6')
        required_length = max(candidates)
        length_utilization = required_length / max(confined_length, 1e-12)
        subchecks.append({
            'name': 'column_end_confined_zone_length',
            'status': 'pass' if length_utilization <= 1.0 else 'fail',
            'utilization': round(length_utilization, 4),
            'demand': round(confined_length, 6),
            'limit': round(required_length, 6),
            'formula': 'column-end stirrup confined-zone length >= max(hc, Hn/6, 500mm)',
            'basis': basis,
        })

    bottom_root = any(_is_true(source.get(key)) for source in (stirrup, reinforcement, element) for key in ('isBottomStoryColumnRoot', 'bottomStoryRoot', 'isFirstStoryLowerEnd'))
    if bottom_root and bottom_confined_length is not None and clear_height is not None:
        bottom_required = clear_height / 3.0
        bottom_utilization = bottom_required / max(bottom_confined_length, 1e-12)
        subchecks.append({
            'name': 'column_bottom_story_lower_end_confined_length',
            'status': 'pass' if bottom_utilization <= 1.0 else 'fail',
            'utilization': round(bottom_utilization, 4),
            'demand': round(bottom_confined_length, 6),
            'limit': round(bottom_required, 6),
            'formula': 'bottom-story column lower-end confined-zone length >= Hn/3',
        })

    if not subchecks:
        return None

    controlling = max(subchecks, key=lambda item: float(item.get('utilization', 0.0)))
    utilization = float(controlling.get('utilization', 0.0))
    return {
        'item': '框架柱箍筋加密区范围',
        'status': 'pass' if all(item.get('status') == 'pass' for item in subchecks) else 'fail',
        'utilization': round(utilization, 4),
        'clause': 'GB/T 50011-2010(2024) 6.3.9',
        'formula': 'column-end confined-zone length >= max(hc, Hn/6, 500mm); special columns require full-height confinement; bottom-story lower end >= Hn/3',
        'inputs': {
            'elementId': elem_id,
            'seismicGrade': grade,
            'columnDepthMm': round(column_depth, 6) if column_depth is not None else None,
            'clearHeightMm': round(clear_height, 6) if clear_height is not None else None,
            'confinedLengthMm': round(confined_length, 6) if confined_length is not None else None,
            'bottomConfinedLengthMm': round(bottom_confined_length, 6) if bottom_confined_length is not None else None,
            'fullHeightConfined': full_height_flag,
            'fullHeightReasons': full_height_reasons,
            'shearSpanRatio': round(shear_ratio, 6) if shear_ratio is not None else None,
            'controlling': controlling,
            'subchecks': subchecks,
        },
    }


def _frame_column_stirrup_volume_ratio_item(
    elem_id: str,
    context: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    element = _record(_record(context.get('elementData')).get(elem_id))
    if not element or not _is_concrete_frame_column(context, elem_id, element):
        return None

    reinforcement = _reinforcement_data(element)
    if not reinforcement:
        return None

    grade = _seismic_grade(context, elem_id, element)
    if grade is None:
        return None

    longitudinal = _column_longitudinal_reinforcement_group(reinforcement)
    stirrup = _column_stirrup_group(reinforcement)
    if not stirrup:
        return None

    volume_ratio = _column_stirrup_volume_ratio_percent(reinforcement, stirrup)
    non_confined_ratio = _column_non_confined_stirrup_volume_ratio_percent(reinforcement, stirrup)
    non_confined_spacing = _dimension_from_keys_mm(
        stirrup,
        'nonConfinedSpacingMm',
        'unconfinedSpacingMm',
        'nonConfinedSpacing',
        'unconfinedSpacing',
    )
    longitudinal_min_diameter = (
        _dimension_mm(longitudinal.get('minDiameterMm'))
        or _dimension_mm(longitudinal.get('minimumDiameterMm'))
        or _reinforcement_diameter_mm(longitudinal)
    )
    if volume_ratio is None and non_confined_ratio is None and non_confined_spacing is None:
        return None

    shear_info = _column_shear_span_ratio_info(context, elem_id, element)
    shear_ratio = _number(shear_info.get('ratio')) if shear_info else None
    design_basis = _record(_record(context.get('analysisSummary')).get('designBasis'))
    site = _record(design_basis.get('siteSeismic'))
    intensity = _number(site.get('intensity')) or _number(design_basis.get('intensity'))
    is_transfer = _is_transfer_frame_member(context, elem_id, element)
    axial_ratio = _column_axial_compression_ratio_value(context, elem_id, element, reinforcement, stirrup)
    stirrup_type = _column_stirrup_type_key(stirrup)
    fyv = _column_stirrup_yield_strength_mpa(context, elem_id, element, reinforcement, stirrup)
    fc = _material_strength_mpa(_record(element.get('material')))
    formula_fc = max(float(fc), C35_DESIGN_STRENGTH_MPA) if fc is not None else None
    characteristic = (
        _column_stirrup_characteristic_value(grade, stirrup_type, axial_ratio, is_transfer)
        if axial_ratio is not None
        else None
    )

    subchecks: List[Dict[str, Any]] = []
    if volume_ratio is not None:
        absolute_minimum = {1: 0.8, 2: 0.6, 3: 0.4, 4: 0.4}[grade]
        absolute_utilization = absolute_minimum / max(volume_ratio, 1e-12)
        subchecks.append({
            'name': 'column_confined_stirrup_volume_ratio_minimum',
            'status': 'pass' if absolute_utilization <= 1.0 else 'fail',
            'utilization': round(absolute_utilization, 4),
            'demand': round(volume_ratio, 6),
            'limit': absolute_minimum,
            'formula': 'confined-zone volumetric stirrup ratio >= grade minimum',
        })

        special_minimum = None
        special_reasons: List[str] = []
        if is_transfer:
            special_minimum = 1.5
            special_reasons.append('frame-supported column')
        if shear_ratio is not None and shear_ratio <= 2.0:
            short_column_minimum = 1.5 if grade == 1 and intensity == 9 else 1.2
            special_minimum = max(special_minimum or 0.0, short_column_minimum)
            special_reasons.append('shear-span ratio <= 2')
        if special_minimum is not None:
            special_utilization = special_minimum / max(volume_ratio, 1e-12)
            subchecks.append({
                'name': 'column_special_stirrup_volume_ratio_minimum',
                'status': 'pass' if special_utilization <= 1.0 else 'fail',
                'utilization': round(special_utilization, 4),
                'demand': round(volume_ratio, 6),
                'limit': round(special_minimum, 6),
                'formula': 'short or frame-supported column confined-zone volumetric ratio minimum',
                'reasons': special_reasons,
            })

    if volume_ratio is not None and characteristic is not None and fyv is not None and formula_fc is not None:
        lambda_v = float(characteristic['value'])
        required_ratio = lambda_v * formula_fc / max(fyv, 1e-12) * 100.0
        formula_utilization = required_ratio / max(volume_ratio, 1e-12)
        subchecks.append({
            'name': 'column_confined_stirrup_volume_ratio_formula',
            'status': 'pass' if formula_utilization <= 1.0 else 'fail',
            'utilization': round(formula_utilization, 4),
            'demand': round(volume_ratio, 6),
            'limit': round(required_ratio, 6),
            'formula': 'rho_v >= lambda_v * fc / fyv',
        })

    if volume_ratio is not None and non_confined_ratio is not None:
        non_confined_limit = 0.5 * volume_ratio
        non_confined_utilization = non_confined_limit / max(non_confined_ratio, 1e-12)
        subchecks.append({
            'name': 'column_non_confined_stirrup_volume_ratio',
            'status': 'pass' if non_confined_utilization <= 1.0 else 'fail',
            'utilization': round(non_confined_utilization, 4),
            'demand': round(non_confined_ratio, 6),
            'limit': round(non_confined_limit, 6),
            'formula': 'non-confined-zone volumetric stirrup ratio >= 50% of confined-zone ratio',
        })

    if non_confined_spacing is not None and longitudinal_min_diameter is not None:
        multiplier = 10.0 if grade in {1, 2} else 15.0
        spacing_limit = multiplier * longitudinal_min_diameter
        spacing_utilization = non_confined_spacing / max(spacing_limit, 1e-12)
        subchecks.append({
            'name': 'column_non_confined_stirrup_spacing',
            'status': 'pass' if spacing_utilization <= 1.0 else 'fail',
            'utilization': round(spacing_utilization, 4),
            'demand': round(non_confined_spacing, 6),
            'limit': round(spacing_limit, 6),
            'formula': 'non-confined-zone stirrup spacing <= 10d for Grade 1/2 and 15d for Grade 3/4',
        })

    if not subchecks:
        return None

    controlling = max(subchecks, key=lambda item: float(item.get('utilization', 0.0)))
    utilization = float(controlling.get('utilization', 0.0))
    return {
        'item': '框架柱箍筋体积配箍率',
        'status': 'pass' if all(item.get('status') == 'pass' for item in subchecks) else 'fail',
        'utilization': round(utilization, 4),
        'clause': 'GB/T 50011-2010(2024) 6.3.9',
        'formula': 'rho_v >= lambda_v * fc / fyv and grade absolute minimums; special short/frame-supported column and non-confined-zone requirements',
        'inputs': {
            'elementId': elem_id,
            'seismicGrade': grade,
            'stirrupType': stirrup_type,
            'volumeRatioPercent': round(volume_ratio, 6) if volume_ratio is not None else None,
            'nonConfinedVolumeRatioPercent': round(non_confined_ratio, 6) if non_confined_ratio is not None else None,
            'nonConfinedSpacingMm': round(non_confined_spacing, 6) if non_confined_spacing is not None else None,
            'longitudinalMinDiameterMm': round(longitudinal_min_diameter, 6) if longitudinal_min_diameter is not None else None,
            'axialCompressionRatio': round(axial_ratio, 6) if axial_ratio is not None else None,
            'lambdaV': round(float(characteristic['value']), 6) if characteristic is not None else None,
            'lambdaVBase': round(float(characteristic['baseValue']), 6) if characteristic is not None else None,
            'lambdaVAxialRatioBin': characteristic.get('axialRatioBin') if characteristic is not None else None,
            'lambdaVTransferAdjustment': round(float(characteristic.get('transferAdjustment') or 0.0), 6) if characteristic is not None else None,
            'fcForFormulaMPa': round(formula_fc, 6) if formula_fc is not None else None,
            'fyvMPa': round(fyv, 6) if fyv is not None else None,
            'shearSpanRatio': round(shear_ratio, 6) if shear_ratio is not None else None,
            'intensity': round(intensity, 6) if intensity is not None else None,
            'isTransferMember': is_transfer,
            'controlling': controlling,
            'subchecks': subchecks,
        },
    }


def _frame_joint_core_stirrup_detailing_item(
    elem_id: str,
    context: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    element = _record(_record(context.get('elementData')).get(elem_id))
    if not element or not _is_concrete_frame_joint(context, elem_id, element):
        return None

    reinforcement = _reinforcement_data(element)
    joint_core = _frame_joint_core_group(context, elem_id, element, reinforcement)
    if not joint_core:
        return None

    grade = _seismic_grade(context, elem_id, element)
    if grade is None:
        return None

    longitudinal = _column_longitudinal_reinforcement_group(reinforcement)
    spacing = _dimension_from_keys_mm(
        joint_core,
        'spacingMm',
        'maxSpacingMm',
        'coreSpacingMm',
        'jointCoreSpacingMm',
        'spacing',
        'maxSpacing',
        'coreSpacing',
        'jointCoreSpacing',
        's',
    )
    diameter = _reinforcement_diameter_mm(joint_core)
    longitudinal_min_diameter = (
        _dimension_from_keys_mm(joint_core, 'longitudinalMinDiameterMm', 'columnLongitudinalMinDiameterMm')
        or _dimension_mm(longitudinal.get('minDiameterMm'))
        or _dimension_mm(longitudinal.get('minimumDiameterMm'))
        or _reinforcement_diameter_mm(longitudinal)
    )
    characteristic = _joint_core_characteristic_value(joint_core, reinforcement)
    volume_ratio = _joint_core_volume_ratio_percent(joint_core, reinforcement)
    adjacent_column_volume_ratio = _joint_core_adjacent_column_volume_ratio_percent(joint_core, reinforcement)
    shear_info = _column_shear_span_ratio_info(context, elem_id, element)
    shear_ratio = _number(shear_info.get('ratio')) if shear_info else None
    if shear_ratio is None:
        for key in ('shearSpanRatio', 'columnShearSpanRatio', 'adjacentColumnShearSpanRatio'):
            shear_ratio = _number(joint_core.get(key))
            if shear_ratio is not None and shear_ratio > 0.0:
                break

    if spacing is None and diameter is None and characteristic is None and volume_ratio is None:
        return None

    subchecks: List[Dict[str, Any]] = []
    spacing_limit = None
    spacing_basis: List[str] = []
    if spacing is not None:
        if longitudinal_min_diameter is not None:
            multiplier = 6.0 if grade == 1 else 8.0
            spacing_limit = multiplier * longitudinal_min_diameter
            spacing_basis.append(f'{int(multiplier)}d')
        code_spacing_limit = 100.0 if grade in {1, 2} else 150.0
        spacing_limit = min(spacing_limit, code_spacing_limit) if spacing_limit is not None else code_spacing_limit
        spacing_basis.append(f'{int(code_spacing_limit)}mm')
        if shear_ratio is not None and shear_ratio <= 2.0:
            spacing_limit = min(spacing_limit, 100.0)
            spacing_basis.append('shear-span ratio <= 2: 100mm')
        spacing_utilization = spacing / max(spacing_limit, 1e-12)
        subchecks.append({
            'name': 'joint_core_stirrup_spacing',
            'status': 'pass' if spacing_utilization <= 1.0 else 'fail',
            'utilization': round(spacing_utilization, 4),
            'demand': round(spacing, 6),
            'limit': round(spacing_limit, 6),
            'formula': 'joint-core stirrup spacing follows GB/T 50011 6.3.7 column confined-zone limit',
            'basis': spacing_basis,
        })

    if diameter is not None:
        diameter_limit = {1: 10.0, 2: 8.0, 3: 8.0, 4: 6.0}[grade]
        if grade == 4 and shear_ratio is not None and shear_ratio <= 2.0:
            diameter_limit = 8.0
        diameter_utilization = diameter_limit / max(diameter, 1e-12)
        subchecks.append({
            'name': 'joint_core_stirrup_diameter',
            'status': 'pass' if diameter_utilization <= 1.0 else 'fail',
            'utilization': round(diameter_utilization, 4),
            'demand': round(diameter, 6),
            'limit': round(diameter_limit, 6),
            'formula': 'joint-core stirrup diameter follows GB/T 50011 6.3.7 column confined-zone limit',
        })

    characteristic_minimum = FRAME_JOINT_CORE_CHARACTERISTIC_MINIMUMS.get(grade)
    if characteristic is not None and characteristic_minimum is not None:
        characteristic_utilization = characteristic_minimum / max(characteristic, 1e-12)
        subchecks.append({
            'name': 'joint_core_stirrup_characteristic_value',
            'status': 'pass' if characteristic_utilization <= 1.0 else 'fail',
            'utilization': round(characteristic_utilization, 4),
            'demand': round(characteristic, 6),
            'limit': characteristic_minimum,
            'formula': 'joint-core stirrup characteristic value >= grade minimum',
        })

    volume_ratio_minimum = FRAME_JOINT_CORE_VOLUME_RATIO_MINIMUMS.get(grade)
    if volume_ratio is not None and volume_ratio_minimum is not None:
        volume_utilization = volume_ratio_minimum / max(volume_ratio, 1e-12)
        subchecks.append({
            'name': 'joint_core_stirrup_volume_ratio',
            'status': 'pass' if volume_utilization <= 1.0 else 'fail',
            'utilization': round(volume_utilization, 4),
            'demand': round(volume_ratio, 6),
            'limit': volume_ratio_minimum,
            'formula': 'joint-core volumetric stirrup ratio >= grade minimum',
        })

    if shear_ratio is not None and shear_ratio <= 2.0 and volume_ratio is not None and adjacent_column_volume_ratio is not None:
        adjacent_utilization = adjacent_column_volume_ratio / max(volume_ratio, 1e-12)
        subchecks.append({
            'name': 'joint_core_short_column_volume_ratio',
            'status': 'pass' if adjacent_utilization <= 1.0 else 'fail',
            'utilization': round(adjacent_utilization, 4),
            'demand': round(volume_ratio, 6),
            'limit': round(adjacent_column_volume_ratio, 6),
            'formula': 'short-column joint-core volumetric ratio >= max upper/lower column-end volumetric ratio',
        })

    if not subchecks:
        return None

    controlling = max(subchecks, key=lambda item: float(item.get('utilization', 0.0)))
    utilization = float(controlling.get('utilization', 0.0))
    return {
        'item': '框架节点核芯区箍筋构造',
        'status': 'pass' if all(item.get('status') == 'pass' for item in subchecks) else 'fail',
        'utilization': round(utilization, 4),
        'clause': 'GB/T 50011-2010(2024) 6.3.10',
        'formula': 'joint-core stirrup spacing/diameter follow 6.3.7; lambda_v and rho_v satisfy grade minimums; short-column joint core rho_v >= adjacent column-end rho_v',
        'inputs': {
            'elementId': elem_id,
            'seismicGrade': grade,
            'stirrupSpacingMm': round(spacing, 6) if spacing is not None else None,
            'stirrupDiameterMm': round(diameter, 6) if diameter is not None else None,
            'longitudinalMinDiameterMm': round(longitudinal_min_diameter, 6) if longitudinal_min_diameter is not None else None,
            'characteristicValue': round(characteristic, 6) if characteristic is not None else None,
            'volumeRatioPercent': round(volume_ratio, 6) if volume_ratio is not None else None,
            'adjacentColumnEndMaxVolumeRatioPercent': round(adjacent_column_volume_ratio, 6) if adjacent_column_volume_ratio is not None else None,
            'shearSpanRatio': round(shear_ratio, 6) if shear_ratio is not None else None,
            'controlling': controlling,
            'subchecks': subchecks,
        },
    }


def _frame_joint_core_shear_capacity_item(
    elem_id: str,
    context: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    element = _record(_record(context.get('elementData')).get(elem_id))
    if not element or not _is_concrete_frame_joint(context, elem_id, element):
        return None

    reinforcement = _reinforcement_data(element)
    joint_core = _frame_joint_core_group(context, elem_id, element, reinforcement)
    element_type = _element_type(context, elem_id, element)
    if not joint_core and element_type in {'joint', 'frame-joint', 'beam-column-joint', 'rc-joint', 'core-joint'}:
        joint_core = element
    if not joint_core:
        return None

    grade = _seismic_grade(context, elem_id, element)
    if grade is None:
        return None

    shear = _joint_core_shear_demand_capacity(joint_core, reinforcement, element)
    demand = shear.get('demandKN')
    capacity = shear.get('capacityKN')
    utilization = shear.get('utilization')
    has_capacity_check = (
        utilization is not None
        or (demand is not None and capacity is not None and capacity > 0.0)
    )
    required = grade in {1, 2}
    if not has_capacity_check and not required:
        return None

    if not has_capacity_check:
        return {
            'item': '框架节点核芯区截面抗震验算',
            'status': 'not_applicable',
            'utilization': 2.0,
            'clause': 'GB/T 50011-2010(2024) 6.2.15 + Appendix D',
            'formula': 'Grade 1/2 frame joint cores require seismic shear-capacity verification by Appendix D',
            'inputs': {
                'elementId': elem_id,
                'seismicGrade': grade,
                'required': required,
                'shearDemandKN': None,
                'shearCapacityKN': None,
                'utilization': None,
            },
            'message': 'Structured joint-core shear demand/capacity or utilization is unavailable.',
        }

    if utilization is None:
        utilization = float(demand or 0.0) / max(float(capacity or 0.0), 1e-12)
    return {
        'item': '框架节点核芯区截面抗震验算',
        'status': 'pass' if utilization <= 1.0 else 'fail',
        'utilization': round(float(utilization), 4),
        'clause': 'GB/T 50011-2010(2024) 6.2.15 + Appendix D',
        'formula': 'joint-core seismic shear demand/capacity <= 1.0 by Appendix D verification result',
        'inputs': {
            'elementId': elem_id,
            'seismicGrade': grade,
            'required': required,
            'shearDemandKN': round(float(demand), 6) if demand is not None else None,
            'shearCapacityKN': round(float(capacity), 6) if capacity is not None else None,
            'utilization': round(float(utilization), 6),
            'verificationSource': joint_core.get('verificationSource') or joint_core.get('source') or 'structured jointCore data',
        },
    }


def _number_from_keys(source: Dict[str, Any], keys: tuple[str, ...]) -> Optional[float]:
    for key in keys:
        value = _number(source.get(key))
        if value is not None:
            return value
    return None


def _strong_column_weak_beam_marker(source: Dict[str, Any]) -> bool:
    marker_keys = {
        'strongColumnWeakBeam',
        'strongColumnWeakBeamCheck',
        'columnBeamMomentCheck',
        'columnBeamMomentRatio',
        'requiredColumnBeamMomentRatio',
        'strongColumnWeakBeamRatio',
        'requiredStrongColumnWeakBeamRatio',
        'sumColumnMomentCapacityToBeamMomentCapacity',
        'sumColumnMomentCapacityKNm',
        'sumBeamMomentCapacityKNm',
        'etaC',
        'momentAmplificationFactor',
        'columnMomentAmplificationFactor',
        'capacityDesign',
        'momentCapacityDesign',
        'jointMomentCapacityDesign',
    }
    if any(key in source for key in marker_keys):
        return True
    for key in ('directions', 'checks', 'cases', 'loadCases', 'clockwise', 'counterClockwise', 'positive', 'negative'):
        raw = source.get(key)
        if isinstance(raw, list) and any(_strong_column_weak_beam_marker(_record(item)) for item in raw if isinstance(item, dict)):
            return True
        nested = _record(raw)
        if nested and _strong_column_weak_beam_marker(nested):
            return True
    return False


def _strong_column_weak_beam_records(source: Dict[str, Any], source_name: str) -> List[Dict[str, Any]]:
    if not source:
        return []
    records: List[Dict[str, Any]] = []
    if _strong_column_weak_beam_marker(source):
        records.append({**source, '_source': source_name})
    for key in ('directions', 'checks', 'cases', 'loadCases'):
        raw = source.get(key)
        if isinstance(raw, list):
            for index, item in enumerate(raw, start=1):
                record = _record(item)
                if _strong_column_weak_beam_marker(record):
                    records.append({**record, '_source': f'{source_name}.{key}[{index}]'})
    for key in (
        'strongColumnWeakBeam',
        'strongColumnWeakBeamCheck',
        'columnBeamMomentCheck',
        'momentCapacityDesign',
        'jointMomentCapacityDesign',
    ):
        record = _record(source.get(key))
        if _strong_column_weak_beam_marker(record):
            records.extend(_strong_column_weak_beam_records(record, f'{source_name}.{key}'))
    for key in ('clockwise', 'counterClockwise', 'positive', 'negative', 'x', 'y'):
        record = _record(source.get(key))
        if _strong_column_weak_beam_marker(record):
            records.append({**record, '_source': f'{source_name}.{key}'})
    return records


def _strong_column_weak_beam_sources(
    context: Dict[str, Any],
    elem_id: str,
    element: Dict[str, Any],
) -> List[Dict[str, Any]]:
    metadata = _element_metadata(context, elem_id, element)
    element_context = _element_context(context, elem_id)
    sources: List[Dict[str, Any]] = []
    for owner_name, owner in (
        ('element', element),
        ('metadata', metadata),
        ('elementContext', element_context),
        ('jointData', _record(_record(context.get('jointData')).get(elem_id))),
        ('strongColumnWeakBeam', _record(_record(context.get('strongColumnWeakBeam')).get(elem_id))),
        ('capacityDesign', _record(_record(context.get('capacityDesign')).get(elem_id))),
        ('jointCapacityDesign', _record(_record(context.get('jointCapacityDesign')).get(elem_id))),
    ):
        owner_record = _record(owner)
        sources.extend(_strong_column_weak_beam_records(owner_record, owner_name))
        for key in (
            'strongColumnWeakBeam',
            'strongColumnWeakBeamCheck',
            'columnBeamMomentCheck',
            'capacityDesign',
            'momentCapacityDesign',
            'jointMomentCapacityDesign',
        ):
            nested = _record(owner_record.get(key))
            sources.extend(_strong_column_weak_beam_records(nested, f'{owner_name}.{key}'))
    deduped: List[Dict[str, Any]] = []
    seen = set()
    for record in sources:
        signature = (
            str(record.get('_source') or ''),
            str(record.get('direction') or record.get('case') or record.get('name') or ''),
            str(record.get('columnBeamMomentRatio') or record.get('strongColumnWeakBeamRatio') or ''),
            str(record.get('sumColumnMomentCapacityKNm') or ''),
            str(record.get('sumBeamMomentCapacityKNm') or ''),
        )
        if signature in seen:
            continue
        seen.add(signature)
        deduped.append(record)
    return deduped


def _strong_column_weak_beam_subcheck(record: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    source = str(record.get('_source') or 'structured')
    label = str(record.get('direction') or record.get('case') or record.get('name') or source)
    if _is_true(record.get('exempt')) or _is_true(record.get('notRequired')) or _is_true(record.get('strongColumnWeakBeamExempt')):
        return {
            'name': label,
            'status': 'pass',
            'utilization': 0.0,
            'source': source,
            'message': str(record.get('exemptionReason') or record.get('reason') or 'Structured input marks this joint as exempt from strong-column weak-beam check.'),
        }

    utilization = _number_from_keys(record, (
        'strongColumnWeakBeamUtilization',
        'columnBeamMomentUtilization',
        'momentCapacityUtilization',
    ))
    if utilization is None and any(token in source.lower() for token in ('strongcolumnweakbeam', 'strong_column_weak_beam', 'columnbeammoment', 'capacitydesign', 'momentcapacitydesign')):
        utilization = _number_from_keys(record, ('demandCapacityRatio', 'dcr', 'utilization'))
    if utilization is not None and utilization >= 0.0:
        return {
            'name': label,
            'status': 'pass' if utilization <= 1.0 else 'fail',
            'utilization': round(utilization, 4),
            'source': source,
            'providedUtilization': round(utilization, 6),
        }

    ratio = _number_from_keys(record, (
        'columnBeamMomentRatio',
        'strongColumnWeakBeamRatio',
        'sumColumnMomentCapacityToBeamMomentCapacity',
        'columnToBeamMomentCapacityRatio',
        'columnBeamCapacityRatio',
    ))
    required_ratio = _number_from_keys(record, (
        'requiredColumnBeamMomentRatio',
        'requiredStrongColumnWeakBeamRatio',
        'requiredRatio',
        'minimumRatio',
        'etaC',
        'momentAmplificationFactor',
        'columnMomentAmplificationFactor',
    ))
    column_moment = _number_from_keys(record, (
        'sumColumnMomentCapacityKNm',
        'columnMomentCapacityKNm',
        'sumColumnFlexuralCapacityKNm',
        'columnFlexuralCapacityKNm',
        'McKNm',
        'McuKNm',
    ))
    beam_moment = _number_from_keys(record, (
        'sumBeamMomentCapacityKNm',
        'beamMomentCapacityKNm',
        'sumBeamFlexuralCapacityKNm',
        'beamFlexuralCapacityKNm',
        'MbKNm',
        'MbuKNm',
    ))
    if ratio is None and column_moment is not None and beam_moment is not None and beam_moment > 0.0:
        ratio = column_moment / beam_moment
    if ratio is None or required_ratio is None or required_ratio <= 0.0:
        return None
    utilization = required_ratio / max(ratio, 1e-12)
    return {
        'name': label,
        'status': 'pass' if utilization <= 1.0 else 'fail',
        'utilization': round(utilization, 4),
        'source': source,
        'columnBeamMomentRatio': round(ratio, 6),
        'requiredColumnBeamMomentRatio': round(required_ratio, 6),
        'sumColumnMomentCapacityKNm': round(column_moment, 6) if column_moment is not None else None,
        'sumBeamMomentCapacityKNm': round(beam_moment, 6) if beam_moment is not None else None,
    }


def _frame_joint_strong_column_weak_beam_item(
    elem_id: str,
    context: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    element = _record(_record(context.get('elementData')).get(elem_id))
    if not element or not _is_concrete_frame_joint(context, elem_id, element):
        return None
    sources = _strong_column_weak_beam_sources(context, elem_id, element)
    if not sources:
        return None
    subchecks = [
        item for item in (_strong_column_weak_beam_subcheck(source) for source in sources)
        if item is not None
    ]
    grade = _seismic_grade(context, elem_id, element)
    if not subchecks:
        return {
            'item': '框架节点强柱弱梁弯矩关系',
            'status': 'not_applicable',
            'utilization': 2.0,
            'clause': 'GB/T 50011-2010(2024) 6.2.2',
            'formula': 'ΣMc >= ηc * ΣMb using structured joint moment-capacity data',
            'inputs': {
                'elementId': elem_id,
                'seismicGrade': grade,
                'sourceCount': len(sources),
            },
            'message': 'Structured strong-column weak-beam data is present but does not include a comparable utilization, required ratio, or column/beam moment-capacity pair.',
        }
    controlling = max(subchecks, key=lambda item: float(item.get('utilization', 0.0)))
    utilization = float(controlling.get('utilization', 0.0))
    return {
        'item': '框架节点强柱弱梁弯矩关系',
        'status': 'pass' if all(item.get('status') == 'pass' for item in subchecks) else 'fail',
        'utilization': round(utilization, 4),
        'clause': 'GB/T 50011-2010(2024) 6.2.2',
        'formula': 'ΣMc >= ηc * ΣMb using structured joint moment-capacity data',
        'inputs': {
            'elementId': elem_id,
            'seismicGrade': grade,
            'controlling': controlling,
            'subchecks': subchecks,
        },
    }


def _concrete_frame_member_strength_grade_item(
    elem_id: str,
    context: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    element = _record(_record(context.get('elementData')).get(elem_id))
    if not element or not _is_concrete_frame_beam_or_column(context, elem_id, element):
        return None

    grade = _seismic_grade(context, elem_id, element)
    is_transfer = _is_transfer_frame_member(context, elem_id, element)
    if not is_transfer and (grade is None or grade > 2):
        return None

    material = _record(element.get('material'))
    material_grade = _concrete_grade_from_material(material)
    requirement = 'transfer member' if is_transfer else f'seismic grade {grade}'
    if material_grade is None:
        return {
            'item': '框架梁柱混凝土强度等级',
            'status': 'not_applicable',
            'utilization': 0.0,
            'clause': 'GB 55002-2021 5.1.2',
            'formula': 'transfer beam/column and seismic grade <= 2 frame beam/column: concrete strength grade >= C30',
            'inputs': {
                'elementId': elem_id,
                'elementType': _element_type(context, elem_id, element),
                'seismicGrade': grade,
                'isTransferMember': is_transfer,
                'requiredGrade': 'C30',
                'requirement': requirement,
            },
            'message': 'Concrete material grade or explicit concrete design strength is unavailable.',
        }

    actual_grade = _number(material_grade.get('grade'))
    actual_fc = _number(material_grade.get('fcMPa'))
    if actual_grade is not None:
        utilization = 30.0 / max(actual_grade, 1e-12)
        actual_label = f"C{actual_grade:g}"
        actual_value = actual_grade
        source_kind = 'grade'
    else:
        utilization = C30_DESIGN_STRENGTH_MPA / max(float(actual_fc or 0.0), 1e-12)
        actual_label = f"fc={float(actual_fc or 0.0):g}MPa"
        actual_value = actual_fc
        source_kind = 'fcMPa'
    return {
        'item': '框架梁柱混凝土强度等级',
        'status': 'pass' if utilization <= 1.0 else 'fail',
        'utilization': round(utilization, 4),
        'clause': 'GB 55002-2021 5.1.2',
        'formula': 'transfer beam/column and seismic grade <= 2 frame beam/column: concrete strength grade >= C30',
        'inputs': {
            'elementId': elem_id,
            'elementType': _element_type(context, elem_id, element),
            'seismicGrade': grade,
            'isTransferMember': is_transfer,
            'requiredGrade': 'C30',
            'requiredFcMPa': C30_DESIGN_STRENGTH_MPA,
            'actual': actual_label,
            'actualValue': round(float(actual_value or 0.0), 6),
            'actualValueType': source_kind,
            'source': material_grade.get('source'),
            'requirement': requirement,
        },
    }


def _frame_beam_section_geometry_item(
    elem_id: str,
    context: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    element = _record(_record(context.get('elementData')).get(elem_id))
    if not element or not _is_concrete_frame_beam(context, elem_id, element):
        return None

    section = _record(element.get('section'))
    width = _section_dimension_mm(section, 'width', 'b', 'B')
    height = _section_dimension_mm(section, 'height', 'h', 'H')
    if width is None or height is None:
        return None

    subchecks: List[Dict[str, Any]] = []
    width_utilization = 200.0 / max(width, 1e-12)
    subchecks.append({
        'name': 'beam_width',
        'status': 'pass' if width_utilization <= 1.0 else 'fail',
        'utilization': round(width_utilization, 4),
        'demand': round(width, 6),
        'limit': 200.0,
        'formula': 'b >= 200mm',
    })

    depth_width_ratio = height / max(width, 1e-12)
    depth_width_utilization = depth_width_ratio / 4.0
    subchecks.append({
        'name': 'beam_depth_width_ratio',
        'status': 'pass' if depth_width_utilization <= 1.0 else 'fail',
        'utilization': round(depth_width_utilization, 4),
        'demand': round(depth_width_ratio, 6),
        'limit': 4.0,
        'formula': 'h/b <= 4',
    })

    span_info = _beam_span_mm(context, elem_id, element)
    if span_info:
        span = float(span_info['spanMm'])
        span_depth_ratio = span / max(height, 1e-12)
        span_depth_utilization = 4.0 / max(span_depth_ratio, 1e-12)
        subchecks.append({
            'name': 'beam_clear_span_depth_ratio',
            'status': 'pass' if span_depth_utilization <= 1.0 else 'fail',
            'utilization': round(span_depth_utilization, 4),
            'demand': round(span_depth_ratio, 6),
            'limit': 4.0,
            'formula': 'ln/h >= 4',
            'spanMm': round(span, 6),
            'spanSource': span_info.get('source'),
        })

    controlling = max(subchecks, key=lambda item: float(item.get('utilization', 0.0)))
    utilization = float(controlling.get('utilization', 0.0))
    return {
        'item': '框架梁截面尺寸',
        'status': 'pass' if all(item.get('status') == 'pass' for item in subchecks) else 'fail',
        'utilization': round(utilization, 4),
        'clause': 'GB/T 50011-2010(2024) 6.3.1',
        'formula': 'b >= 200mm; h/b <= 4; ln/h >= 4 when span is available',
        'inputs': {
            'elementId': elem_id,
            'widthMm': round(width, 6),
            'heightMm': round(height, 6),
            'spanMm': round(float(span_info['spanMm']), 6) if span_info else None,
            'spanSource': span_info.get('source') if span_info else None,
            'controlling': controlling,
            'subchecks': subchecks,
        },
    }


def _frame_beam_flat_beam_detailing_item(
    elem_id: str,
    context: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    element = _record(_record(context.get('elementData')).get(elem_id))
    if not element or not _is_concrete_frame_beam(context, elem_id, element):
        return None

    section = _record(element.get('section'))
    width = _section_dimension_mm(section, 'width', 'b', 'B')
    height = _section_dimension_mm(section, 'height', 'h', 'H')
    if width is None or height is None:
        return None

    reinforcement = _reinforcement_data(element)
    flat_beam = _flat_beam_detailing_group(context, elem_id, element, reinforcement)
    sources = (
        flat_beam,
        reinforcement,
        element,
        _element_metadata(context, elem_id, element),
        _element_context(context, elem_id),
    )
    is_flat_beam = _optional_bool_from_sources(
        sources,
        ('isFlatBeam', 'flatBeam', 'isWideBeam', 'wideBeam', 'beamWidthGreaterThanColumnWidth'),
    )
    column_width = (
        _dimension_from_keys_mm(
            flat_beam,
            'columnWidthMm',
            'columnDimensionMm',
            'jointColumnWidthMm',
            'jointColumnDimensionMm',
            'columnWidth',
            'columnDimension',
            'jointColumnWidth',
            'jointColumnDimension',
        )
        or _beam_through_joint_column_dimension_mm(context, elem_id, element, reinforcement)
    )
    if is_flat_beam is False:
        return None
    if is_flat_beam is not True and (column_width is None or width <= column_width):
        return None

    column_longitudinal_diameter = _flat_beam_column_longitudinal_diameter_mm(flat_beam, reinforcement)
    grade = _seismic_grade(context, elem_id, element)
    cast_in_place = _optional_bool_from_sources(
        sources,
        ('castInPlaceFloor', 'castInPlaceSlab', 'floorCastInPlace', 'roofFloorCastInPlace', 'isCastInPlaceFloor'),
    )
    centerline_aligned = _optional_bool_from_sources(
        sources,
        ('centerlineAligned', 'beamColumnCenterlineAligned', 'beamColumnCenterlineCoincident', 'centerlineCoincident'),
    )
    bidirectional = _optional_bool_from_sources(
        sources,
        ('bidirectional', 'bidirectionalArrangement', 'twoWayArrangement', 'isBidirectionalBeamArrangement'),
    )

    subchecks: List[Dict[str, Any]] = []
    if column_width is not None:
        width_limit_2bc = 2.0 * column_width
        width_utilization_2bc = width / max(width_limit_2bc, 1e-12)
        subchecks.append({
            'name': 'flat_beam_width_2bc',
            'status': 'pass' if width_utilization_2bc <= 1.0 else 'fail',
            'utilization': round(width_utilization_2bc, 4),
            'demand': round(width, 6),
            'limit': round(width_limit_2bc, 6),
            'formula': 'bb <= 2bc',
        })

        width_limit_bc_hb = column_width + height
        width_utilization_bc_hb = width / max(width_limit_bc_hb, 1e-12)
        subchecks.append({
            'name': 'flat_beam_width_bc_plus_hb',
            'status': 'pass' if width_utilization_bc_hb <= 1.0 else 'fail',
            'utilization': round(width_utilization_bc_hb, 4),
            'demand': round(width, 6),
            'limit': round(width_limit_bc_hb, 6),
            'formula': 'bb <= bc + hb',
        })

    if column_longitudinal_diameter is not None:
        height_limit = 16.0 * column_longitudinal_diameter
        height_utilization = height_limit / max(height, 1e-12)
        subchecks.append({
            'name': 'flat_beam_depth_column_bar',
            'status': 'pass' if height_utilization <= 1.0 else 'fail',
            'utilization': round(height_utilization, 4),
            'demand': round(height, 6),
            'limit': round(height_limit, 6),
            'formula': 'hb >= 16d',
        })

    if grade is not None:
        grade_utilization = 2.0 if grade == 1 else 0.0
        subchecks.append({
            'name': 'flat_beam_grade_one_restriction',
            'status': 'fail' if grade == 1 else 'pass',
            'utilization': grade_utilization,
            'demand': grade,
            'limit': 'not Grade 1',
            'formula': 'flat beams should not be used for Grade 1 frame structures',
        })

    for name, value, formula in (
        ('flat_beam_cast_in_place_floor', cast_in_place, 'flat-beam floor/roof should be cast-in-place'),
        ('flat_beam_centerline_alignment', centerline_aligned, 'flat-beam centerline should coincide with column centerline'),
        ('flat_beam_bidirectional_arrangement', bidirectional, 'flat beams should be arranged in two directions'),
    ):
        if value is None:
            continue
        subchecks.append({
            'name': name,
            'status': 'pass' if value else 'fail',
            'utilization': 0.0 if value else 2.0,
            'demand': value,
            'limit': True,
            'formula': formula,
        })

    if not subchecks:
        return None

    controlling = max(subchecks, key=lambda item: float(item.get('utilization', 0.0)))
    utilization = float(controlling.get('utilization', 0.0))
    return {
        'item': '框架扁梁构造',
        'status': 'pass' if all(item.get('status') == 'pass' for item in subchecks) else 'fail',
        'utilization': round(utilization, 4),
        'clause': 'GB/T 50011-2010(2024) 6.3.2',
        'formula': 'bb <= 2bc; bb <= bc + hb; hb >= 16d; flat beams should not be used in Grade 1 frames',
        'inputs': {
            'elementId': elem_id,
            'seismicGrade': grade,
            'beamWidthMm': round(width, 6),
            'beamHeightMm': round(height, 6),
            'columnWidthMm': round(column_width, 6) if column_width is not None else None,
            'columnLongitudinalDiameterMm': round(column_longitudinal_diameter, 6) if column_longitudinal_diameter is not None else None,
            'castInPlaceFloor': cast_in_place,
            'centerlineAligned': centerline_aligned,
            'bidirectional': bidirectional,
            'controlling': controlling,
            'subchecks': subchecks,
        },
    }


def _frame_beam_longitudinal_reinforcement_item(
    elem_id: str,
    context: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    element = _record(_record(context.get('elementData')).get(elem_id))
    if not element or not _is_concrete_frame_beam(context, elem_id, element):
        return None

    reinforcement = _reinforcement_data(element)
    if not reinforcement:
        return None

    grade = _seismic_grade(context, elem_id, element)
    required_diameter = 14.0 if grade in {1, 2} else 12.0 if grade in {3, 4} else None
    top = _reinforcement_group(
        reinforcement,
        'topContinuous',
        'continuousTop',
        'longitudinalTopContinuous',
        'topLongitudinalContinuous',
    )
    bottom = _reinforcement_group(
        reinforcement,
        'bottomContinuous',
        'continuousBottom',
        'longitudinalBottomContinuous',
        'bottomLongitudinalContinuous',
    )
    groups = (('top', top), ('bottom', bottom))
    subchecks: List[Dict[str, Any]] = []

    for side, group in groups:
        count = _reinforcement_count(group)
        if count is not None:
            count_utilization = 2.0 / max(count, 1e-12)
            subchecks.append({
                'name': f'{side}_continuous_bar_count',
                'status': 'pass' if count_utilization <= 1.0 else 'fail',
                'utilization': round(count_utilization, 4),
                'demand': round(count, 6),
                'limit': 2.0,
                'formula': f'{side} continuous longitudinal bars >= 2',
            })

        diameter = _reinforcement_diameter_mm(group)
        if required_diameter is not None and diameter is not None:
            diameter_utilization = required_diameter / max(diameter, 1e-12)
            subchecks.append({
                'name': f'{side}_continuous_bar_diameter',
                'status': 'pass' if diameter_utilization <= 1.0 else 'fail',
                'utilization': round(diameter_utilization, 4),
                'demand': round(diameter, 6),
                'limit': required_diameter,
                'formula': f'{side} continuous longitudinal bar diameter >= required grade limit',
            })

        area = _reinforcement_area_mm2(group)
        end_area = _reinforcement_end_area_mm2(reinforcement, side)
        if grade in {1, 2} and area is not None and end_area is not None:
            required_area = 0.25 * end_area
            area_utilization = required_area / max(area, 1e-12)
            subchecks.append({
                'name': f'{side}_continuous_area_ratio',
                'status': 'pass' if area_utilization <= 1.0 else 'fail',
                'utilization': round(area_utilization, 4),
                'demand': round(area, 6),
                'limit': round(required_area, 6),
                'formula': f'{side} continuous area >= 1/4 max end longitudinal area',
            })

    if not subchecks:
        return None

    controlling = max(subchecks, key=lambda item: float(item.get('utilization', 0.0)))
    utilization = float(controlling.get('utilization', 0.0))
    return {
        'item': '框架梁贯通纵筋构造',
        'status': 'pass' if all(item.get('status') == 'pass' for item in subchecks) else 'fail',
        'utilization': round(utilization, 4),
        'clause': 'GB/T 50011-2010(2024) 6.3.4',
        'formula': 'top and bottom continuous longitudinal bars: Grade 1/2 >= 2φ14 and >= 1/4 max end area; Grade 3/4 >= 2φ12',
        'inputs': {
            'elementId': elem_id,
            'seismicGrade': grade,
            'requiredDiameterMm': required_diameter,
            'topContinuous': {
                'count': _reinforcement_count(top),
                'diameterMm': _reinforcement_diameter_mm(top),
                'areaMm2': _reinforcement_area_mm2(top),
                'endMaxAreaMm2': _reinforcement_end_area_mm2(reinforcement, 'top'),
            },
            'bottomContinuous': {
                'count': _reinforcement_count(bottom),
                'diameterMm': _reinforcement_diameter_mm(bottom),
                'areaMm2': _reinforcement_area_mm2(bottom),
                'endMaxAreaMm2': _reinforcement_end_area_mm2(reinforcement, 'bottom'),
            },
            'controlling': controlling,
            'subchecks': subchecks,
        },
    }


def _frame_beam_end_longitudinal_ductility_item(
    elem_id: str,
    context: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    element = _record(_record(context.get('elementData')).get(elem_id))
    if not element or not _is_concrete_frame_beam(context, elem_id, element):
        return None

    reinforcement = _reinforcement_data(element)
    if not reinforcement:
        return None

    grade = _seismic_grade(context, elem_id, element)
    compression_zone_ratio = _beam_end_compression_zone_ratio(reinforcement)
    bottom_top_area_ratio = _beam_end_bottom_top_area_ratio(reinforcement)
    end_tension_ratio = _beam_end_tension_reinforcement_ratio_percent(reinforcement)
    subchecks: List[Dict[str, Any]] = []

    compression_limit = None
    if grade in {1, 2, 3} and compression_zone_ratio is not None:
        compression_limit = 0.25 if grade == 1 else 0.35
        compression_utilization = compression_zone_ratio / compression_limit
        subchecks.append({
            'name': 'beam_end_compression_zone_ratio',
            'status': 'pass' if compression_utilization <= 1.0 else 'fail',
            'utilization': round(compression_utilization, 4),
            'demand': round(compression_zone_ratio, 6),
            'limit': compression_limit,
            'formula': 'beam-end compression-zone height ratio <= grade limit',
        })

    bottom_top_limit = None
    if grade in {1, 2, 3} and bottom_top_area_ratio is not None:
        bottom_top_limit = 0.5 if grade == 1 else 0.3
        bottom_top_utilization = bottom_top_limit / max(bottom_top_area_ratio, 1e-12)
        subchecks.append({
            'name': 'beam_end_bottom_top_area_ratio',
            'status': 'pass' if bottom_top_utilization <= 1.0 else 'fail',
            'utilization': round(bottom_top_utilization, 4),
            'demand': round(bottom_top_area_ratio, 6),
            'limit': bottom_top_limit,
            'formula': 'beam-end bottom/top longitudinal reinforcement area ratio >= grade limit',
        })

    tension_ratio_limit = 2.5
    if end_tension_ratio is not None:
        tension_utilization = end_tension_ratio / tension_ratio_limit
        subchecks.append({
            'name': 'beam_end_tension_reinforcement_ratio',
            'status': 'pass' if tension_utilization <= 1.0 else 'fail',
            'utilization': round(tension_utilization, 4),
            'demand': round(end_tension_ratio, 6),
            'limit': tension_ratio_limit,
            'formula': 'beam-end longitudinal tension reinforcement ratio <= 2.5%',
        })

    if not subchecks:
        return None

    controlling = max(subchecks, key=lambda item: float(item.get('utilization', 0.0)))
    utilization = float(controlling.get('utilization', 0.0))
    return {
        'item': '框架梁端纵筋延性构造',
        'status': 'pass' if all(item.get('status') == 'pass' for item in subchecks) else 'fail',
        'utilization': round(utilization, 4),
        'clause': 'GB/T 50011-2010(2024) 6.3.3 + 6.3.4',
        'formula': 'beam-end compression-zone ratio, bottom/top area ratio, and end tension reinforcement ratio limits',
        'inputs': {
            'elementId': elem_id,
            'seismicGrade': grade,
            'compressionZoneRatio': round(compression_zone_ratio, 6) if compression_zone_ratio is not None else None,
            'compressionZoneRatioLimit': compression_limit,
            'bottomTopAreaRatio': round(bottom_top_area_ratio, 6) if bottom_top_area_ratio is not None else None,
            'bottomTopAreaRatioLimit': bottom_top_limit,
            'endTensionReinforcementRatioPercent': round(end_tension_ratio, 6) if end_tension_ratio is not None else None,
            'endTensionReinforcementRatioPercentLimit': tension_ratio_limit,
            'controlling': controlling,
            'subchecks': subchecks,
        },
    }


def _frame_beam_through_joint_bar_diameter_item(
    elem_id: str,
    context: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    element = _record(_record(context.get('elementData')).get(elem_id))
    if not element or not _is_concrete_frame_beam(context, elem_id, element):
        return None

    grade = _seismic_grade(context, elem_id, element)
    if grade not in {1, 2, 3}:
        return None

    reinforcement = _reinforcement_data(element)
    if not reinforcement:
        return None

    diameter = _beam_through_joint_bar_diameter_mm(reinforcement)
    column_dimension = _beam_through_joint_column_dimension_mm(context, elem_id, element, reinforcement)
    if diameter is None or column_dimension is None:
        return None

    limit = column_dimension / 20.0
    utilization = diameter / max(limit, 1e-12)
    return {
        'item': '框架梁贯通中柱纵筋直径',
        'status': 'pass' if utilization <= 1.0 else 'fail',
        'utilization': round(utilization, 4),
        'clause': 'GB/T 50011-2010(2024) 6.3.4',
        'formula': 'longitudinal bar diameter through an interior column <= column dimension / 20',
        'inputs': {
            'elementId': elem_id,
            'seismicGrade': grade,
            'barDiameterMm': round(diameter, 6),
            'columnDimensionMm': round(column_dimension, 6),
            'diameterLimitMm': round(limit, 6),
        },
    }


def _frame_beam_stirrup_detailing_item(
    elem_id: str,
    context: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    element = _record(_record(context.get('elementData')).get(elem_id))
    if not element or not _is_concrete_frame_beam(context, elem_id, element):
        return None

    reinforcement = _reinforcement_data(element)
    if not reinforcement:
        return None

    grade = _seismic_grade(context, elem_id, element)
    if grade is None:
        return None

    stirrup = _beam_end_stirrup_group(reinforcement)
    if not stirrup:
        return None

    section = _record(element.get('section'))
    height = _section_dimension_mm(section, 'height', 'h', 'H')
    longitudinal_diameter = _beam_longitudinal_diameter_mm(reinforcement)
    diameter = _reinforcement_diameter_mm(stirrup)
    spacing = _dimension_from_keys_mm(stirrup, 'spacingMm', 'spacing', 's')
    confined_length = _dimension_from_keys_mm(stirrup, 'confinedLengthMm', 'endZoneLengthMm', 'lengthMm', 'confinedLength', 'endZoneLength')
    leg_spacing = _dimension_from_keys_mm(stirrup, 'legSpacingMm', 'legSpacing')
    first_spacing = _dimension_from_keys_mm(stirrup, 'firstSpacingMm', 'firstStirrupDistanceMm', 'firstDistanceMm', 'firstSpacing')
    hook_straight_length = _dimension_from_keys_mm(stirrup, 'hookStraightLengthMm', 'hookLengthMm', 'hookStraightLength', 'hookLength')
    hook_angle = _number(stirrup.get('hookAngleDeg')) or _number(stirrup.get('hookAngle'))

    subchecks: List[Dict[str, Any]] = []
    if height is not None and confined_length is not None:
        length_limit = max((2.0 if grade == 1 else 1.5) * height, 500.0)
        length_utilization = length_limit / max(confined_length, 1e-12)
        subchecks.append({
            'name': 'beam_end_stirrup_confined_length',
            'status': 'pass' if length_utilization <= 1.0 else 'fail',
            'utilization': round(length_utilization, 4),
            'demand': round(confined_length, 6),
            'limit': round(length_limit, 6),
            'formula': 'beam-end confined-zone length >= max(2hb/1.5hb, 500mm)',
        })

    spacing_candidates: List[float] = []
    spacing_basis: List[str] = []
    if height is not None:
        spacing_candidates.append(height / 4.0)
        spacing_basis.append('hb/4')
    if longitudinal_diameter is not None:
        multiplier = 6.0 if grade == 1 else 8.0
        spacing_candidates.append(multiplier * longitudinal_diameter)
        spacing_basis.append(f'{int(multiplier)}d')
    code_spacing_limit = 100.0 if grade in {1, 2} else 150.0
    spacing_candidates.append(code_spacing_limit)
    spacing_basis.append(f'{int(code_spacing_limit)}mm')
    spacing_limit = min(spacing_candidates)
    if spacing is not None:
        spacing_utilization = spacing / max(spacing_limit, 1e-12)
        subchecks.append({
            'name': 'beam_end_stirrup_spacing',
            'status': 'pass' if spacing_utilization <= 1.0 else 'fail',
            'utilization': round(spacing_utilization, 4),
            'demand': round(spacing, 6),
            'limit': round(spacing_limit, 6),
            'formula': 'beam-end stirrup spacing <= min(hb/4, 6d/8d, 100/150mm)',
        })

    if diameter is not None:
        diameter_limit = {1: 10.0, 2: 8.0, 3: 8.0, 4: 6.0}[grade]
        end_tension_ratio = _beam_end_tension_reinforcement_ratio_percent(reinforcement)
        if end_tension_ratio is not None and end_tension_ratio > 2.0:
            diameter_limit += 2.0
        diameter_utilization = diameter_limit / max(diameter, 1e-12)
        subchecks.append({
            'name': 'beam_end_stirrup_diameter',
            'status': 'pass' if diameter_utilization <= 1.0 else 'fail',
            'utilization': round(diameter_utilization, 4),
            'demand': round(diameter, 6),
            'limit': round(diameter_limit, 6),
            'formula': 'beam-end stirrup diameter >= table minimum, plus 2mm when end tension ratio > 2%',
        })

    if leg_spacing is not None:
        leg_spacing_limit = 300.0 if grade == 4 else 250.0 if grade in {2, 3} else 200.0
        if grade in {1, 2, 3} and diameter is not None:
            leg_spacing_limit = max(leg_spacing_limit, 20.0 * diameter)
        leg_spacing_utilization = leg_spacing / max(leg_spacing_limit, 1e-12)
        subchecks.append({
            'name': 'beam_end_stirrup_leg_spacing',
            'status': 'pass' if leg_spacing_utilization <= 1.0 else 'fail',
            'utilization': round(leg_spacing_utilization, 4),
            'demand': round(leg_spacing, 6),
            'limit': round(leg_spacing_limit, 6),
            'formula': 'beam-end stirrup leg spacing <= grade limit',
        })

    if first_spacing is not None:
        first_utilization = first_spacing / 50.0
        subchecks.append({
            'name': 'beam_first_stirrup_distance',
            'status': 'pass' if first_utilization <= 1.0 else 'fail',
            'utilization': round(first_utilization, 4),
            'demand': round(first_spacing, 6),
            'limit': 50.0,
            'formula': 'first stirrup distance from support edge <= 50mm',
        })

    if hook_angle is not None:
        hook_angle_utilization = 135.0 / max(hook_angle, 1e-12)
        subchecks.append({
            'name': 'beam_stirrup_hook_angle',
            'status': 'pass' if hook_angle_utilization <= 1.0 else 'fail',
            'utilization': round(hook_angle_utilization, 4),
            'demand': round(hook_angle, 6),
            'limit': 135.0,
            'formula': 'stirrup hook angle >= 135 degrees',
        })

    if hook_straight_length is not None and diameter is not None:
        hook_length_limit = max(10.0 * diameter, 75.0)
        hook_length_utilization = hook_length_limit / max(hook_straight_length, 1e-12)
        subchecks.append({
            'name': 'beam_stirrup_hook_straight_length',
            'status': 'pass' if hook_length_utilization <= 1.0 else 'fail',
            'utilization': round(hook_length_utilization, 4),
            'demand': round(hook_straight_length, 6),
            'limit': round(hook_length_limit, 6),
            'formula': 'stirrup hook straight length >= max(10d, 75mm)',
        })

    if not subchecks:
        return None

    controlling = max(subchecks, key=lambda item: float(item.get('utilization', 0.0)))
    utilization = float(controlling.get('utilization', 0.0))
    return {
        'item': '框架梁箍筋加密区构造',
        'status': 'pass' if all(item.get('status') == 'pass' for item in subchecks) else 'fail',
        'utilization': round(utilization, 4),
        'clause': 'GB/T 50011-2010(2024) 6.3.3 + 6.3.4',
        'formula': 'beam-end stirrup confined-zone length, spacing, diameter, leg spacing, first stirrup, and hook detailing',
        'inputs': {
            'elementId': elem_id,
            'seismicGrade': grade,
            'heightMm': round(height, 6) if height is not None else None,
            'longitudinalDiameterMm': round(longitudinal_diameter, 6) if longitudinal_diameter is not None else None,
            'stirrupDiameterMm': round(diameter, 6) if diameter is not None else None,
            'stirrupSpacingMm': round(spacing, 6) if spacing is not None else None,
            'spacingLimitMm': round(spacing_limit, 6),
            'spacingBasis': spacing_basis,
            'endTensionReinforcementRatioPercent': _beam_end_tension_reinforcement_ratio_percent(reinforcement),
            'controlling': controlling,
            'subchecks': subchecks,
        },
    }


def _frame_column_section_geometry_item(
    elem_id: str,
    context: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    element = _record(_record(context.get('elementData')).get(elem_id))
    if not element or not _is_concrete_frame_column(context, elem_id, element):
        return None

    section = _record(element.get('section'))
    width = _section_dimension_mm(section, 'width', 'b', 'B')
    height = _section_dimension_mm(section, 'height', 'h', 'H')
    if width is None or height is None:
        return None

    short_side = min(width, height)
    long_side = max(width, height)
    subchecks: List[Dict[str, Any]] = []
    min_side_limit = _frame_column_min_side_mm(context, elem_id, element)
    if min_side_limit is not None:
        min_side_utilization = min_side_limit / max(short_side, 1e-12)
        subchecks.append({
            'name': 'column_min_side',
            'status': 'pass' if min_side_utilization <= 1.0 else 'fail',
            'utilization': round(min_side_utilization, 4),
            'demand': round(short_side, 6),
            'limit': round(min_side_limit, 6),
            'formula': 'min(b,h) >= required side length',
        })

    side_ratio = long_side / max(short_side, 1e-12)
    side_ratio_utilization = side_ratio / 3.0
    subchecks.append({
        'name': 'column_long_short_side_ratio',
        'status': 'pass' if side_ratio_utilization <= 1.0 else 'fail',
        'utilization': round(side_ratio_utilization, 4),
        'demand': round(side_ratio, 6),
        'limit': 3.0,
        'formula': 'long side / short side <= 3',
    })

    controlling = max(subchecks, key=lambda item: float(item.get('utilization', 0.0)))
    utilization = float(controlling.get('utilization', 0.0))
    return {
        'item': '框架柱截面尺寸',
        'status': 'pass' if all(item.get('status') == 'pass' for item in subchecks) else 'fail',
        'utilization': round(utilization, 4),
        'clause': 'GB/T 50011-2010(2024) 6.3.5',
        'formula': 'min(b,h) >= 300/400mm by seismic grade and story count; long side / short side <= 3',
        'inputs': {
            'elementId': elem_id,
            'widthMm': round(width, 6),
            'heightMm': round(height, 6),
            'shortSideMm': round(short_side, 6),
            'longSideMm': round(long_side, 6),
            'seismicGrade': _seismic_grade(context, elem_id, element),
            'storyCount': _story_count(context),
            'controlling': controlling,
            'subchecks': subchecks,
        },
    }


def _shear_wall_detailing_group(
    context: Dict[str, Any],
    elem_id: str,
    element: Dict[str, Any],
    reinforcement: Dict[str, Any],
) -> Dict[str, Any]:
    metadata = _element_metadata(context, elem_id, element)
    element_context = _element_context(context, elem_id)
    sources = (
        _record(reinforcement.get('shearWall')),
        _record(reinforcement.get('seismicWall')),
        _record(reinforcement.get('wall')),
        _record(element.get('shearWall')),
        _record(element.get('seismicWall')),
        _record(element.get('wallData')),
        _record(metadata.get('shearWall')),
        _record(metadata.get('seismicWall')),
        _record(metadata.get('wallData')),
        _record(element_context.get('shearWall')),
        _record(element_context.get('seismicWall')),
        _record(element_context.get('wallData')),
        _record(_record(context.get('wallData')).get(elem_id)),
        _record(_record(context.get('shearWallData')).get(elem_id)),
    )
    for source in sources:
        if source:
            return source
    return {}


def _wall_orientation_group(reinforcement: Dict[str, Any], wall: Dict[str, Any], orientation: str) -> Dict[str, Any]:
    if orientation == 'vertical':
        keys = (
            'verticalDistributed',
            'verticalDistribution',
            'distributedVertical',
            'verticalReinforcement',
            'verticalBars',
        )
    else:
        keys = (
            'horizontalDistributed',
            'horizontalDistribution',
            'distributedHorizontal',
            'horizontalReinforcement',
            'horizontalBars',
            'transverseDistributed',
        )
    for source in (reinforcement, wall):
        group = _reinforcement_group(source, *keys)
        if group:
            return group
    distributed = _reinforcement_group(reinforcement, 'distributed', 'distribution', 'webDistributed', 'webReinforcement')
    wall_distributed = _reinforcement_group(wall, 'distributed', 'distribution', 'webDistributed', 'webReinforcement')
    return distributed or wall_distributed


def _wall_bool(wall: Dict[str, Any], element: Dict[str, Any], metadata: Dict[str, Any], context_record: Dict[str, Any], *keys: str) -> Optional[bool]:
    return _optional_bool_from_sources((wall, element, metadata, context_record), keys)


def _wall_dimension_from_sources(
    wall: Dict[str, Any],
    element: Dict[str, Any],
    metadata: Dict[str, Any],
    context_record: Dict[str, Any],
    section: Dict[str, Any],
    *keys: str,
) -> Optional[float]:
    for source in (wall, element, metadata, context_record, section):
        value = _dimension_from_keys_mm(source, *keys)
        if value is not None:
            return value
    return None


def _shear_wall_thickness_item(
    elem_id: str,
    context: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    element = _record(_record(context.get('elementData')).get(elem_id))
    if not element or not _is_concrete_shear_wall(context, elem_id, element):
        return None

    section = _record(element.get('section'))
    reinforcement = _reinforcement_data(element)
    metadata = _element_metadata(context, elem_id, element)
    element_context = _element_context(context, elem_id)
    wall = _shear_wall_detailing_group(context, elem_id, element, reinforcement)
    thickness = _wall_dimension_from_sources(
        wall,
        element,
        metadata,
        element_context,
        section,
        'thicknessMm',
        'wallThicknessMm',
        'tMm',
        'thickness',
        'wallThickness',
        't',
    )
    if thickness is None:
        return None

    grade = _seismic_grade(context, elem_id, element)
    story_height = _wall_dimension_from_sources(
        wall,
        element,
        metadata,
        element_context,
        section,
        'storyHeightMm',
        'floorHeightMm',
        'heightBetweenFloorsMm',
        'storyHeight',
        'floorHeight',
        'heightBetweenFloors',
    )
    is_bottom_strengthened = _wall_bool(
        wall,
        element,
        metadata,
        element_context,
        'isBottomStrengthenedZone',
        'bottomStrengthenedZone',
        'isBottomStrengtheningZone',
        'bottomStrengtheningZone',
        'bottomEnhancedZone',
    )
    has_end_column_or_wing = _wall_bool(
        wall,
        element,
        metadata,
        element_context,
        'hasEndColumn',
        'hasBoundaryColumn',
        'hasWingWall',
        'hasFlangeWall',
        'hasEndPier',
    )

    subchecks: List[Dict[str, Any]] = []
    absolute_limit = 160.0 if grade in {1, 2} else 140.0 if grade in {3, 4} else None
    if absolute_limit is not None:
        utilization = absolute_limit / max(thickness, 1e-12)
        subchecks.append({
            'name': 'wall_thickness_absolute_minimum',
            'status': 'pass' if utilization <= 1.0 else 'fail',
            'utilization': round(utilization, 4),
            'demand': round(thickness, 6),
            'limit': absolute_limit,
            'formula': 'Grade 1/2 wall thickness >= 160mm; Grade 3/4 wall thickness >= 140mm',
        })

    if grade in {1, 2, 3, 4} and story_height is not None:
        divisor = 20.0 if grade in {1, 2} else 25.0
        story_limit = story_height / divisor
        utilization = story_limit / max(thickness, 1e-12)
        subchecks.append({
            'name': 'wall_thickness_story_height_ratio',
            'status': 'pass' if utilization <= 1.0 else 'fail',
            'utilization': round(utilization, 4),
            'demand': round(thickness, 6),
            'limit': round(story_limit, 6),
            'storyHeightMm': round(story_height, 6),
            'formula': 'Grade 1/2 wall thickness >= story height / 20; Grade 3/4 >= story height / 25',
        })

    if is_bottom_strengthened and grade in {1, 2}:
        bottom_limits = [200.0]
        if story_height is not None:
            bottom_limits.append(story_height / 16.0)
            if has_end_column_or_wing is False:
                bottom_limits.append(story_height / 12.0)
        bottom_limit = max(bottom_limits)
        utilization = bottom_limit / max(thickness, 1e-12)
        subchecks.append({
            'name': 'wall_bottom_strengthened_thickness',
            'status': 'pass' if utilization <= 1.0 else 'fail',
            'utilization': round(utilization, 4),
            'demand': round(thickness, 6),
            'limit': round(bottom_limit, 6),
            'storyHeightMm': round(story_height, 6) if story_height is not None else None,
            'hasEndColumnOrWingWall': has_end_column_or_wing,
            'formula': 'Grade 1/2 bottom-strengthened wall thickness >= 200mm and story height / 16; without end column or wing wall >= story height / 12',
        })

    if not subchecks:
        return None
    controlling = max(subchecks, key=lambda item: float(item.get('utilization', 0.0)))
    utilization = float(controlling.get('utilization', 0.0))
    return {
        'item': '抗震墙墙厚',
        'status': 'pass' if all(item.get('status') == 'pass' for item in subchecks) else 'fail',
        'utilization': round(utilization, 4),
        'clause': 'GB/T 50011-2010(2024) 6.4.1',
        'formula': 'wall thickness satisfies seismic-grade absolute and story-height limits',
        'inputs': {
            'elementId': elem_id,
            'seismicGrade': grade,
            'thicknessMm': round(thickness, 6),
            'storyHeightMm': round(story_height, 6) if story_height is not None else None,
            'isBottomStrengthenedZone': is_bottom_strengthened,
            'hasEndColumnOrWingWall': has_end_column_or_wing,
            'controlling': controlling,
            'subchecks': subchecks,
        },
    }


def _shear_wall_section_area_mm2(
    section: Dict[str, Any],
    wall: Dict[str, Any],
    element: Dict[str, Any],
    metadata: Dict[str, Any],
    element_context: Dict[str, Any],
) -> Optional[float]:
    for source in (section, wall, element, metadata, element_context):
        area = _number(source.get('A')) or _number(source.get('areaMm2')) or _number(source.get('area'))
        if area is not None and area > 0.0:
            return area
    thickness = _wall_dimension_from_sources(
        wall,
        element,
        metadata,
        element_context,
        section,
        'thicknessMm',
        'wallThicknessMm',
        'tMm',
        'thickness',
        'wallThickness',
        't',
    )
    length = _wall_dimension_from_sources(
        wall,
        element,
        metadata,
        element_context,
        section,
        'lengthMm',
        'wallLengthMm',
        'lMm',
        'length',
        'wallLength',
        'l',
    )
    if thickness is None or length is None:
        return None
    return thickness * length


def _shear_wall_axial_ratio_from_sources(sources: tuple[Dict[str, Any], ...]) -> Optional[float]:
    ratio = _first_number_from_records(sources, (
        'axialCompressionRatio',
        'axialRatio',
        'axialLoadRatio',
        'axialStressRatio',
        'nOverFcA',
    ))
    if ratio is None or ratio < 0.0:
        return None
    return ratio


def _shear_wall_axial_ratio_limit_from_sources(sources: tuple[Dict[str, Any], ...]) -> Optional[Dict[str, Any]]:
    for source in sources:
        for key in (
            'axialCompressionRatioLimit',
            'axialRatioLimit',
            'maxAxialCompressionRatio',
            'maxAxialRatio',
            'nOverFcALimit',
        ):
            value = _number(source.get(key))
            if value is not None and value > 0.0:
                return {
                    'limit': value,
                    'source': key,
                }
    return None


def _shear_wall_axial_compression_ratio_item(
    elem_id: str,
    context: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    element = _record(_record(context.get('elementData')).get(elem_id))
    if not element or not _is_concrete_shear_wall(context, elem_id, element):
        return None

    section = _record(element.get('section'))
    reinforcement = _reinforcement_data(element)
    metadata = _element_metadata(context, elem_id, element)
    element_context = _element_context(context, elem_id)
    wall = _shear_wall_detailing_group(context, elem_id, element, reinforcement)
    sources = (wall, element, metadata, element_context, section)
    limit_info = _shear_wall_axial_ratio_limit_from_sources(sources)
    axial_ratio = _shear_wall_axial_ratio_from_sources(sources)
    axial_demand_kn = _element_axial_demand_kn(context, elem_id, element)
    area = _shear_wall_section_area_mm2(section, wall, element, metadata, element_context)
    material = _record(element.get('material'))
    strength = _material_strength_mpa(material)
    ratio_source = 'structuredAxialRatio'
    if axial_ratio is None and axial_demand_kn is not None and area is not None and area > 0.0 and strength is not None and strength > 0.0:
        axial_ratio = axial_demand_kn / max(strength * area / 1000.0, 1e-12)
        ratio_source = 'memberDesignActionCombinations/section/material'

    if axial_ratio is None and axial_demand_kn is None:
        return None

    if axial_ratio is None or limit_info is None:
        return {
            'item': '抗震墙轴压比限值',
            'status': 'not_applicable',
            'utilization': 2.0,
            'clause': 'GB/T 50011-2010(2024) 6.4',
            'formula': 'wall axial compression ratio should be checked against a structured project/code-derived limit',
            'inputs': {
                'elementId': elem_id,
                'axialDemandKN': round(axial_demand_kn, 6) if axial_demand_kn is not None else None,
                'areaMm2': round(area, 6) if area is not None else None,
                'fcMPa': round(strength, 6) if strength is not None else None,
                'axialCompressionRatio': round(axial_ratio, 6) if axial_ratio is not None else None,
                'limit': None if limit_info is None else round(float(limit_info['limit']), 6),
            },
            'message': 'Structured seismic-wall axial ratio data or its project/code-derived limit is unavailable.',
        }

    limit = float(limit_info['limit'])
    utilization = axial_ratio / max(limit, 1e-12)
    return {
        'item': '抗震墙轴压比限值',
        'status': 'pass' if utilization <= 1.0 else 'fail',
        'utilization': round(utilization, 4),
        'clause': 'GB/T 50011-2010(2024) 6.4',
        'formula': 'N/(fc*A) or structured axial compression ratio <= structured project/code-derived limit',
        'inputs': {
            'elementId': elem_id,
            'seismicGrade': _seismic_grade(context, elem_id, element),
            'axialDemandKN': round(axial_demand_kn, 6) if axial_demand_kn is not None else None,
            'areaMm2': round(area, 6) if area is not None else None,
            'fcMPa': round(strength, 6) if strength is not None else None,
            'axialCompressionRatio': round(axial_ratio, 6),
            'limit': round(limit, 6),
            'limitSource': limit_info.get('source'),
            'ratioSource': ratio_source,
        },
    }


def _wall_reinforcement_ratio_percent(
    group: Dict[str, Any],
    wall: Dict[str, Any],
    orientation: str,
    *,
    thickness_mm: Optional[float],
) -> Optional[float]:
    orientation_prefix = 'vertical' if orientation == 'vertical' else 'horizontal'
    explicit = _ratio_percent_from_sources(
        (group, wall),
        (
            f'{orientation_prefix}RatioPercent',
            f'{orientation_prefix}ReinforcementRatioPercent',
            f'{orientation_prefix}DistributedRatioPercent',
            f'{orientation_prefix}DistributionRatioPercent',
            'ratioPercent',
            'reinforcementRatioPercent',
            'distributedReinforcementRatioPercent',
        ),
        (
            f'{orientation_prefix}Ratio',
            f'{orientation_prefix}ReinforcementRatio',
            f'{orientation_prefix}DistributedRatio',
            f'{orientation_prefix}DistributionRatio',
            'ratio',
            'reinforcementRatio',
            'distributedReinforcementRatio',
        ),
    )
    if explicit is not None:
        return explicit
    diameter = _reinforcement_diameter_mm(group)
    spacing = _dimension_from_keys_mm(
        group,
        f'{orientation_prefix}SpacingMm',
        'spacingMm',
        'spacing',
        's',
    )
    if diameter is None or spacing is None or thickness_mm is None:
        return None
    layer_count = _number(group.get('layerCount') or wall.get(f'{orientation_prefix}LayerCount') or wall.get('layerCount'))
    if layer_count is None:
        double_layer = _optional_bool_from_sources((group, wall), ('doubleLayer', 'doubleRows', 'twoLayers', 'twoRows'))
        layer_count = 2.0 if double_layer else 1.0
    area_per_bar = math.pi * diameter * diameter / 4.0
    ratio = float(layer_count) * area_per_bar / max(spacing * thickness_mm, 1e-12) * 100.0
    return ratio


def _wall_reinforcement_diameter_mm(group: Dict[str, Any], orientation: str) -> Optional[float]:
    prefix = 'vertical' if orientation == 'vertical' else 'horizontal'
    diameter = _dimension_from_keys_mm(
        group,
        f'{prefix}DiameterMm',
        f'{prefix}BarDiameterMm',
        f'{prefix}DMm',
    )
    return diameter if diameter is not None else _reinforcement_diameter_mm(group)


def _shear_wall_distributed_reinforcement_item(
    elem_id: str,
    context: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    element = _record(_record(context.get('elementData')).get(elem_id))
    if not element or not _is_concrete_shear_wall(context, elem_id, element):
        return None

    section = _record(element.get('section'))
    reinforcement = _reinforcement_data(element)
    metadata = _element_metadata(context, elem_id, element)
    element_context = _element_context(context, elem_id)
    wall = _shear_wall_detailing_group(context, elem_id, element, reinforcement)
    if not reinforcement and not wall:
        return None
    thickness = _wall_dimension_from_sources(
        wall,
        element,
        metadata,
        element_context,
        section,
        'thicknessMm',
        'wallThicknessMm',
        'tMm',
        'thickness',
        'wallThickness',
        't',
    )
    grade = _seismic_grade(context, elem_id, element)
    is_partial_frame_supported_bottom = _wall_bool(
        wall,
        element,
        metadata,
        element_context,
        'isPartialFrameSupportedBottomStrengthenedZone',
        'partialFrameSupportedBottomStrengthenedZone',
        'isFrameSupportedWallBottomStrengthenedZone',
        'frameSupportedWallBottomStrengthenedZone',
    )
    ratio_limit = 0.30 if is_partial_frame_supported_bottom else 0.20 if grade == 4 else 0.25 if grade in {1, 2, 3} else None
    spacing_limit = 200.0 if is_partial_frame_supported_bottom else 300.0
    diameter_limit = 8.0
    vertical = _wall_orientation_group(reinforcement, wall, 'vertical')
    horizontal = _wall_orientation_group(reinforcement, wall, 'horizontal')

    subchecks: List[Dict[str, Any]] = []
    if thickness is not None and thickness > 140.0:
        double_layer = _optional_bool_from_sources(
            (wall, reinforcement, vertical, horizontal),
            ('doubleLayer', 'doubleRows', 'twoLayers', 'twoRows', 'distributedReinforcementDoubleLayer'),
        )
        if double_layer is not None:
            subchecks.append({
                'name': 'wall_distributed_reinforcement_double_layer',
                'status': 'pass' if double_layer else 'fail',
                'utilization': 0.0 if double_layer else 2.0,
                'demand': double_layer,
                'limit': True,
                'formula': 'when wall thickness > 140mm, vertical and horizontal distributed reinforcement should be double-layer',
            })
        tie = _reinforcement_group(wall, 'tie', 'ties', 'tieBars', '拉筋') or _reinforcement_group(reinforcement, 'tie', 'ties', 'tieBars', '拉筋')
        tie_spacing = _dimension_from_keys_mm(tie, 'spacingMm', 'tieSpacingMm', 'spacing', 's')
        tie_diameter = _reinforcement_diameter_mm(tie)
        if tie_spacing is not None:
            tie_spacing_utilization = tie_spacing / 600.0
            subchecks.append({
                'name': 'wall_tie_spacing',
                'status': 'pass' if tie_spacing_utilization <= 1.0 else 'fail',
                'utilization': round(tie_spacing_utilization, 4),
                'demand': round(tie_spacing, 6),
                'limit': 600.0,
                'formula': 'tie spacing between double-layer distributed reinforcement <= 600mm',
            })
        if tie_diameter is not None:
            tie_diameter_utilization = 6.0 / max(tie_diameter, 1e-12)
            subchecks.append({
                'name': 'wall_tie_diameter',
                'status': 'pass' if tie_diameter_utilization <= 1.0 else 'fail',
                'utilization': round(tie_diameter_utilization, 4),
                'demand': round(tie_diameter, 6),
                'limit': 6.0,
                'formula': 'tie diameter between double-layer distributed reinforcement >= 6mm',
            })

    for orientation, group in (('vertical', vertical), ('horizontal', horizontal)):
        if not group:
            continue
        label = 'vertical' if orientation == 'vertical' else 'horizontal'
        ratio = _wall_reinforcement_ratio_percent(group, wall, orientation, thickness_mm=thickness)
        if ratio is not None and ratio_limit is not None:
            ratio_utilization = ratio_limit / max(ratio, 1e-12)
            subchecks.append({
                'name': f'wall_{label}_distributed_reinforcement_ratio',
                'status': 'pass' if ratio_utilization <= 1.0 else 'fail',
                'utilization': round(ratio_utilization, 4),
                'demand': round(ratio, 6),
                'limit': ratio_limit,
                'formula': 'vertical and horizontal distributed reinforcement ratio >= grade limit',
            })
        spacing = _dimension_from_keys_mm(group, f'{label}SpacingMm', 'spacingMm', 'spacing', 's')
        if spacing is not None:
            spacing_utilization = spacing / spacing_limit
            subchecks.append({
                'name': f'wall_{label}_distributed_reinforcement_spacing',
                'status': 'pass' if spacing_utilization <= 1.0 else 'fail',
                'utilization': round(spacing_utilization, 4),
                'demand': round(spacing, 6),
                'limit': spacing_limit,
                'formula': 'distributed reinforcement spacing <= 300mm; frame-supported bottom-strengthened wall <= 200mm',
            })
        diameter = _wall_reinforcement_diameter_mm(group, orientation)
        if diameter is not None:
            diameter_utilization = diameter_limit / max(diameter, 1e-12)
            subchecks.append({
                'name': f'wall_{label}_distributed_reinforcement_diameter',
                'status': 'pass' if diameter_utilization <= 1.0 else 'fail',
                'utilization': round(diameter_utilization, 4),
                'demand': round(diameter, 6),
                'limit': diameter_limit,
                'formula': 'distributed reinforcement bar diameter >= 8mm',
            })

    if not subchecks:
        return None
    controlling = max(subchecks, key=lambda item: float(item.get('utilization', 0.0)))
    utilization = float(controlling.get('utilization', 0.0))
    return {
        'item': '抗震墙分布钢筋构造',
        'status': 'pass' if all(item.get('status') == 'pass' for item in subchecks) else 'fail',
        'utilization': round(utilization, 4),
        'clause': 'GB/T 50011-2010(2024) 6.4.2 + 6.4.3',
        'formula': 'wall distributed reinforcement layer, tie, ratio, spacing, and diameter satisfy seismic detailing limits',
        'inputs': {
            'elementId': elem_id,
            'seismicGrade': grade,
            'thicknessMm': round(thickness, 6) if thickness is not None else None,
            'ratioLimitPercent': ratio_limit,
            'spacingLimitMm': spacing_limit,
            'isPartialFrameSupportedBottomStrengthenedZone': is_partial_frame_supported_bottom,
            'controlling': controlling,
            'subchecks': subchecks,
        },
    }


def _wall_boundary_records(
    context: Dict[str, Any],
    elem_id: str,
    element: Dict[str, Any],
    reinforcement: Dict[str, Any],
    wall: Dict[str, Any],
) -> List[Dict[str, Any]]:
    metadata = _element_metadata(context, elem_id, element)
    element_context = _element_context(context, elem_id)
    sources = (wall, reinforcement, element, metadata, element_context)
    list_keys = (
        'boundaryElements',
        'edgeMembers',
        'boundaryMembers',
        'boundaryElementList',
        'edgeMemberList',
    )
    record_keys = (
        'boundaryElement',
        'edgeMember',
        'boundaryMember',
        'constrainedBoundaryElement',
        'edgeReinforcement',
        'boundaryReinforcement',
        'leftBoundaryElement',
        'rightBoundaryElement',
        'leftEdgeMember',
        'rightEdgeMember',
    )

    records: List[Dict[str, Any]] = []
    for source in sources:
        for key in list_keys:
            value = source.get(key)
            if isinstance(value, list):
                for index, raw_record in enumerate(value):
                    record = _record(raw_record)
                    if record:
                        records.append({
                            **record,
                            '_source': record.get('source') or f'{key}[{index}]',
                        })
        for key in record_keys:
            record = _record(source.get(key))
            if record:
                records.append({
                    **record,
                    '_source': record.get('source') or key,
                })
    return records


def _wall_boundary_required(
    wall: Dict[str, Any],
    element: Dict[str, Any],
    metadata: Dict[str, Any],
    element_context: Dict[str, Any],
) -> bool:
    return bool(_optional_bool_from_sources(
        (wall, element, metadata, element_context),
        (
            'requiresBoundaryElement',
            'boundaryElementRequired',
            'requiresEdgeMember',
            'edgeMemberRequired',
            'hasBoundaryElement',
            'hasEdgeMember',
            'constrainedBoundaryElementRequired',
        ),
    ))


def _wall_boundary_ratio_percent(
    boundary: Dict[str, Any],
    wall: Dict[str, Any],
    thickness_mm: Optional[float],
) -> Optional[float]:
    longitudinal = _reinforcement_group(
        boundary,
        'longitudinal',
        'longitudinalReinforcement',
        'vertical',
        'verticalReinforcement',
        'bars',
    )
    ratio = _ratio_percent_from_sources(
        (longitudinal, boundary),
        (
            'longitudinalRatioPercent',
            'longitudinalReinforcementRatioPercent',
            'verticalRatioPercent',
            'verticalReinforcementRatioPercent',
            'reinforcementRatioPercent',
            'ratioPercent',
        ),
        (
            'longitudinalRatio',
            'longitudinalReinforcementRatio',
            'verticalRatio',
            'verticalReinforcementRatio',
            'reinforcementRatio',
            'ratio',
        ),
    )
    if ratio is not None:
        return ratio

    area = _reinforcement_area_mm2(longitudinal) or _reinforcement_area_mm2(boundary)
    boundary_length = _dimension_from_keys_mm(
        boundary,
        'lengthMm',
        'boundaryLengthMm',
        'edgeLengthMm',
        'memberLengthMm',
        'length',
        'boundaryLength',
        'edgeLength',
        'memberLength',
    )
    if area is None or boundary_length is None or thickness_mm is None:
        return None
    return area / max(boundary_length * thickness_mm, 1e-12) * 100.0


def _wall_boundary_ratio_limit_percent(boundary: Dict[str, Any], wall: Dict[str, Any]) -> Optional[float]:
    return _ratio_percent_from_sources(
        (boundary, wall),
        (
            'minLongitudinalRatioPercent',
            'requiredLongitudinalRatioPercent',
            'longitudinalRatioLimitPercent',
            'minBoundaryLongitudinalRatioPercent',
            'boundaryLongitudinalRatioLimitPercent',
        ),
        (
            'minLongitudinalRatio',
            'requiredLongitudinalRatio',
            'longitudinalRatioLimit',
            'minBoundaryLongitudinalRatio',
            'boundaryLongitudinalRatioLimit',
        ),
    )


def _wall_boundary_transverse_group(boundary: Dict[str, Any]) -> Dict[str, Any]:
    return _reinforcement_group(
        boundary,
        'hoop',
        'hoops',
        'stirrup',
        'stirrups',
        'tie',
        'ties',
        'transverse',
        'transverseReinforcement',
    )


def _first_wall_boundary_dimension(
    sources: tuple[Dict[str, Any], ...],
    *keys: str,
) -> Optional[float]:
    for source in sources:
        for key in keys:
            if key.lower().endswith('mm'):
                value = _number(source.get(key))
                if value is not None and value > 0.0:
                    return value
                continue
            value = _dimension_mm(source.get(key))
            if value is not None:
                return value
    return None


def _first_wall_boundary_ratio_percent(
    sources: tuple[Dict[str, Any], ...],
    percent_keys: tuple[str, ...],
    ratio_keys: tuple[str, ...],
) -> Optional[float]:
    for source in sources:
        value = _ratio_percent_from_sources((source,), percent_keys, ratio_keys)
        if value is not None:
            return value
    return None


def _shear_wall_boundary_element_item(
    elem_id: str,
    context: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    element = _record(_record(context.get('elementData')).get(elem_id))
    if not element or not _is_concrete_shear_wall(context, elem_id, element):
        return None

    section = _record(element.get('section'))
    reinforcement = _reinforcement_data(element)
    metadata = _element_metadata(context, elem_id, element)
    element_context = _element_context(context, elem_id)
    wall = _shear_wall_detailing_group(context, elem_id, element, reinforcement)
    thickness = _wall_dimension_from_sources(
        wall,
        element,
        metadata,
        element_context,
        section,
        'thicknessMm',
        'wallThicknessMm',
        'tMm',
        'thickness',
        'wallThickness',
        't',
    )
    required = _wall_boundary_required(wall, element, metadata, element_context)
    boundaries = _wall_boundary_records(context, elem_id, element, reinforcement, wall)
    if not boundaries:
        if required:
            return {
                'item': '抗震墙边缘构件构造',
                'status': 'not_applicable',
                'utilization': 2.0,
                'clause': 'GB/T 50011-2010(2024) 6.4',
                'formula': 'required seismic-wall boundary-element detailing should provide structured longitudinal and transverse checks',
                'inputs': {
                    'elementId': elem_id,
                    'required': required,
                    'boundaryElementCount': 0,
                },
                'message': 'Structured seismic-wall boundary-element reinforcement data is unavailable.',
            }
        return None

    subchecks: List[Dict[str, Any]] = []
    for index, boundary in enumerate(boundaries):
        label = str(boundary.get('id') or boundary.get('name') or boundary.get('_source') or f'boundary-{index + 1}')
        longitudinal = _reinforcement_group(
            boundary,
            'longitudinal',
            'longitudinalReinforcement',
            'vertical',
            'verticalReinforcement',
            'bars',
        )
        transverse = _wall_boundary_transverse_group(boundary)
        sources = (boundary, longitudinal, transverse, wall)

        ratio = _wall_boundary_ratio_percent(boundary, wall, thickness)
        ratio_limit = _wall_boundary_ratio_limit_percent(boundary, wall)
        if ratio is not None and ratio_limit is not None:
            utilization = ratio_limit / max(ratio, 1e-12)
            subchecks.append({
                'name': 'wall_boundary_longitudinal_reinforcement_ratio',
                'boundary': label,
                'status': 'pass' if utilization <= 1.0 else 'fail',
                'utilization': round(utilization, 4),
                'demand': round(ratio, 6),
                'limit': round(ratio_limit, 6),
                'formula': 'boundary longitudinal reinforcement ratio >= structured code-derived limit',
            })

        longitudinal_diameter = _reinforcement_diameter_mm(longitudinal) or _reinforcement_diameter_mm(boundary)
        longitudinal_diameter_limit = _first_wall_boundary_dimension(
            (boundary, longitudinal, wall),
            'minLongitudinalDiameterMm',
            'requiredLongitudinalDiameterMm',
            'longitudinalDiameterLimitMm',
            'boundaryLongitudinalDiameterLimitMm',
            'minLongitudinalDiameter',
            'requiredLongitudinalDiameter',
            'longitudinalDiameterLimit',
        )
        if longitudinal_diameter is not None and longitudinal_diameter_limit is not None:
            utilization = longitudinal_diameter_limit / max(longitudinal_diameter, 1e-12)
            subchecks.append({
                'name': 'wall_boundary_longitudinal_bar_diameter',
                'boundary': label,
                'status': 'pass' if utilization <= 1.0 else 'fail',
                'utilization': round(utilization, 4),
                'demand': round(longitudinal_diameter, 6),
                'limit': round(longitudinal_diameter_limit, 6),
                'formula': 'boundary longitudinal bar diameter >= structured code-derived limit',
            })

        transverse_spacing = _first_wall_boundary_dimension(
            (transverse, boundary),
            'spacingMm',
            'hoopSpacingMm',
            'tieSpacingMm',
            'transverseSpacingMm',
            'spacing',
            'hoopSpacing',
            'tieSpacing',
            'transverseSpacing',
            's',
        )
        transverse_spacing_limit = _first_wall_boundary_dimension(
            sources,
            'maxHoopSpacingMm',
            'maxTieSpacingMm',
            'maxTransverseSpacingMm',
            'hoopSpacingLimitMm',
            'tieSpacingLimitMm',
            'transverseSpacingLimitMm',
            'maxHoopSpacing',
            'maxTieSpacing',
            'maxTransverseSpacing',
            'hoopSpacingLimit',
            'tieSpacingLimit',
            'transverseSpacingLimit',
        )
        if transverse_spacing is not None and transverse_spacing_limit is not None:
            utilization = transverse_spacing / max(transverse_spacing_limit, 1e-12)
            subchecks.append({
                'name': 'wall_boundary_transverse_spacing',
                'boundary': label,
                'status': 'pass' if utilization <= 1.0 else 'fail',
                'utilization': round(utilization, 4),
                'demand': round(transverse_spacing, 6),
                'limit': round(transverse_spacing_limit, 6),
                'formula': 'boundary transverse reinforcement spacing <= structured code-derived limit',
            })

        transverse_diameter = _reinforcement_diameter_mm(transverse)
        transverse_diameter_limit = _first_wall_boundary_dimension(
            sources,
            'minHoopDiameterMm',
            'minTieDiameterMm',
            'minTransverseDiameterMm',
            'hoopDiameterLimitMm',
            'tieDiameterLimitMm',
            'transverseDiameterLimitMm',
            'minHoopDiameter',
            'minTieDiameter',
            'minTransverseDiameter',
            'hoopDiameterLimit',
            'tieDiameterLimit',
            'transverseDiameterLimit',
        )
        if transverse_diameter is not None and transverse_diameter_limit is not None:
            utilization = transverse_diameter_limit / max(transverse_diameter, 1e-12)
            subchecks.append({
                'name': 'wall_boundary_transverse_diameter',
                'boundary': label,
                'status': 'pass' if utilization <= 1.0 else 'fail',
                'utilization': round(utilization, 4),
                'demand': round(transverse_diameter, 6),
                'limit': round(transverse_diameter_limit, 6),
                'formula': 'boundary transverse reinforcement diameter >= structured code-derived limit',
            })

        volume_ratio = _first_wall_boundary_ratio_percent(
            (transverse, boundary),
            (
                'volumeRatioPercent',
                'volumetricRatioPercent',
                'hoopVolumeRatioPercent',
                'transverseVolumeRatioPercent',
            ),
            (
                'volumeRatio',
                'volumetricRatio',
                'hoopVolumeRatio',
                'transverseVolumeRatio',
            ),
        )
        volume_ratio_limit = _first_wall_boundary_ratio_percent(
            sources,
            (
                'minVolumeRatioPercent',
                'minVolumetricRatioPercent',
                'minHoopVolumeRatioPercent',
                'transverseVolumeRatioLimitPercent',
            ),
            (
                'minVolumeRatio',
                'minVolumetricRatio',
                'minHoopVolumeRatio',
                'transverseVolumeRatioLimit',
            ),
        )
        if volume_ratio is not None and volume_ratio_limit is not None:
            utilization = volume_ratio_limit / max(volume_ratio, 1e-12)
            subchecks.append({
                'name': 'wall_boundary_transverse_volume_ratio',
                'boundary': label,
                'status': 'pass' if utilization <= 1.0 else 'fail',
                'utilization': round(utilization, 4),
                'demand': round(volume_ratio, 6),
                'limit': round(volume_ratio_limit, 6),
                'formula': 'boundary transverse reinforcement volumetric ratio >= structured code-derived limit',
            })

    if not subchecks:
        if required:
            return {
                'item': '抗震墙边缘构件构造',
                'status': 'not_applicable',
                'utilization': 2.0,
                'clause': 'GB/T 50011-2010(2024) 6.4',
                'formula': 'required seismic-wall boundary-element detailing should provide comparable structured limits',
                'inputs': {
                    'elementId': elem_id,
                    'required': required,
                    'boundaryElementCount': len(boundaries),
                },
                'message': 'Structured boundary-element data does not include comparable actual values and code-derived limits.',
            }
        return None

    controlling = max(subchecks, key=lambda item: float(item.get('utilization', 0.0)))
    utilization = float(controlling.get('utilization', 0.0))
    return {
        'item': '抗震墙边缘构件构造',
        'status': 'pass' if all(item.get('status') == 'pass' for item in subchecks) else 'fail',
        'utilization': round(utilization, 4),
        'clause': 'GB/T 50011-2010(2024) 6.4',
        'formula': 'boundary-element longitudinal and transverse reinforcement satisfy structured code-derived limits',
        'inputs': {
            'elementId': elem_id,
            'required': required,
            'boundaryElementCount': len(boundaries),
            'thicknessMm': round(thickness, 6) if thickness is not None else None,
            'controlling': controlling,
            'subchecks': subchecks,
        },
    }


def _structured_capacity_sources(
    context: Dict[str, Any],
    elem_id: str,
    element: Dict[str, Any],
) -> List[Dict[str, Any]]:
    metadata = _element_metadata(context, elem_id, element)
    element_context = _element_context(context, elem_id)
    sources: List[Dict[str, Any]] = []
    direct_capacity_keys = {
        'axialCapacityKN',
        'maxAbsAxialCapacityKN',
        'compressionCapacityKN',
        'tensionCapacityKN',
        'nCapacityKN',
        'NuKN',
        'NCapacityKN',
        'shearCapacityKN',
        'maxAbsShearCapacityKN',
        'vCapacityKN',
        'VuKN',
        'VCapacityKN',
        'momentCapacityKNm',
        'maxAbsMomentCapacityKNm',
        'bendingCapacityKNm',
        'flexuralCapacityKNm',
        'mCapacityKNm',
        'MuKNm',
        'MCapacityKNm',
        'seismicCombinationUtilization',
        'seismicUtilization',
        'capacityUtilization',
        'demandCapacityRatio',
        'dcr',
        'dcRatio',
        'interaction',
    }
    nested_capacity_keys = {'axial', 'compression', 'tension', 'n', 'shear', 'v', 'moment', 'bending', 'flexural', 'm'}

    def has_capacity_marker(record: Dict[str, Any]) -> bool:
        if any(key in record for key in direct_capacity_keys):
            return True
        return any(_record(record.get(key)) for key in nested_capacity_keys)

    for owner_name, owner in (
        ('element', element),
        ('metadata', metadata),
        ('elementContext', element_context),
        ('capacityData', _record(_record(context.get('capacityData')).get(elem_id))),
        ('memberCapacityData', _record(_record(context.get('memberCapacityData')).get(elem_id))),
    ):
        direct = _record(owner)
        if direct and (owner_name in {'capacityData', 'memberCapacityData'} or has_capacity_marker(direct)):
            sources.append({**direct, '_source': owner_name})
        for key in (
            'seismicCapacity',
            'capacity',
            'capacities',
            'designCapacity',
            'designCapacities',
            'memberCapacity',
            'memberCapacities',
            'capacityCheck',
            'capacityChecks',
            'strengthCheck',
            'strengthChecks',
            'seismicCapacityCheck',
            'seismicCapacityChecks',
        ):
            raw = direct.get(key)
            record = _record(raw)
            if record:
                sources.append({**record, '_source': f'{owner_name}.{key}'})
                continue
            if isinstance(raw, list):
                for index, item in enumerate(raw, start=1):
                    item_record = _record(item)
                    if item_record:
                        sources.append({**item_record, '_source': f'{owner_name}.{key}[{index}]'})
    return sources


def _component_capacity_from_sources(
    sources: List[Dict[str, Any]],
    direct_keys: tuple[str, ...],
    nested_keys: tuple[str, ...],
    nested_capacity_keys: tuple[str, ...],
) -> Optional[Dict[str, Any]]:
    for source in sources:
        source_name = str(source.get('_source') or 'capacity')
        for key in direct_keys:
            value = _number(source.get(key))
            if value is not None and value > 0.0:
                return {'value': value, 'source': f'{source_name}.{key}'}
        for nested_key in nested_keys:
            nested = _record(source.get(nested_key))
            if not nested:
                continue
            for capacity_key in nested_capacity_keys:
                value = _number(nested.get(capacity_key))
                if value is not None and value > 0.0:
                    return {'value': value, 'source': f'{source_name}.{nested_key}.{capacity_key}'}
    return None


def _structured_capacity_utilization_from_sources(sources: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    for source in sources:
        source_name = str(source.get('_source') or 'capacity')
        for key in (
            'seismicCombinationUtilization',
            'seismicUtilization',
            'capacityUtilization',
            'demandCapacityRatio',
            'dcr',
            'dcRatio',
            'interaction',
            'utilization',
        ):
            value = _number(source.get(key))
            if value is not None and value >= 0.0:
                return {'value': value, 'source': f'{source_name}.{key}'}
    return None


def _component_capacity_adjustment_from_sources(
    sources: List[Dict[str, Any]],
    nested_keys: tuple[str, ...],
) -> Optional[Dict[str, Any]]:
    adjustment_keys = (
        'gammaRE',
        'gammaRe',
        'seismicCapacityAdjustmentFactor',
        'capacityAdjustmentFactor',
    )
    for source in sources:
        source_name = str(source.get('_source') or 'capacity')
        for key in adjustment_keys:
            value = _number(source.get(key))
            if value is not None and value > 0.0:
                return {'value': value, 'source': f'{source_name}.{key}'}
        for nested_key in nested_keys:
            nested = _record(source.get(nested_key))
            if not nested:
                continue
            for key in adjustment_keys:
                value = _number(nested.get(key))
                if value is not None and value > 0.0:
                    return {'value': value, 'source': f'{source_name}.{nested_key}.{key}'}
    return None


def _structured_seismic_combination_member_capacity_item(
    elem_id: str,
    context: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    element = _record(_record(context.get('elementData')).get(elem_id))
    if not element:
        return None
    actions = _member_combination_action_entries(_record(context.get('analysisSummary')), elem_id)
    if not actions:
        return None
    capacity_sources = _structured_capacity_sources(context, elem_id, element)
    if not capacity_sources:
        return None

    axial_capacity = _component_capacity_from_sources(
        capacity_sources,
        ('axialCapacityKN', 'maxAbsAxialCapacityKN', 'compressionCapacityKN', 'tensionCapacityKN', 'nCapacityKN', 'NuKN', 'NCapacityKN'),
        ('axial', 'compression', 'tension', 'n'),
        ('capacityKN', 'designCapacityKN', 'capacity', 'designCapacity', 'NuKN'),
    )
    shear_capacity = _component_capacity_from_sources(
        capacity_sources,
        ('shearCapacityKN', 'maxAbsShearCapacityKN', 'vCapacityKN', 'VuKN', 'VCapacityKN'),
        ('shear', 'v'),
        ('capacityKN', 'designCapacityKN', 'capacity', 'designCapacity', 'VuKN'),
    )
    moment_capacity = _component_capacity_from_sources(
        capacity_sources,
        ('momentCapacityKNm', 'maxAbsMomentCapacityKNm', 'bendingCapacityKNm', 'flexuralCapacityKNm', 'mCapacityKNm', 'MuKNm', 'MCapacityKNm'),
        ('moment', 'bending', 'flexural', 'm'),
        ('capacityKNm', 'designCapacityKNm', 'capacity', 'designCapacity', 'MuKNm'),
    )
    axial_gamma = _component_capacity_adjustment_from_sources(capacity_sources, ('axial', 'compression', 'tension', 'n'))
    shear_gamma = _component_capacity_adjustment_from_sources(capacity_sources, ('shear', 'v'))
    moment_gamma = _component_capacity_adjustment_from_sources(capacity_sources, ('moment', 'bending', 'flexural', 'm'))
    explicit_utilization = _structured_capacity_utilization_from_sources(capacity_sources)

    subchecks: List[Dict[str, Any]] = []
    if explicit_utilization is not None:
        utilization = float(explicit_utilization['value'])
        subchecks.append({
            'name': 'member_structured_capacity_utilization',
            'status': 'pass' if utilization <= 1.0 else 'fail',
            'utilization': round(utilization, 4),
            'demand': round(utilization, 6),
            'limit': 1.0,
            'case': None,
            'source': explicit_utilization.get('source'),
            'formula': 'provided member seismic capacity utilization <= 1.0',
        })

    component_specs = (
        ('axial', 'maxAbsAxialKN', axial_capacity, axial_gamma, 'N/Nu <= 1.0'),
        ('shear', 'maxAbsShearKN', shear_capacity, shear_gamma, 'V/Vu <= 1.0'),
        ('moment', 'maxAbsMomentKNm', moment_capacity, moment_gamma, 'M/Mu <= 1.0'),
    )
    for action in actions:
        case_name = action.get('case')
        for component_name, demand_key, capacity_info, gamma_info, formula in component_specs:
            if capacity_info is None:
                continue
            demand = _number(action.get(demand_key))
            if demand is None:
                continue
            capacity = float(capacity_info['value'])
            gamma_re = float(gamma_info['value']) if gamma_info is not None else 1.0
            utilization = abs(demand) * gamma_re / max(capacity, 1e-12)
            subchecks.append({
                'name': f'member_{component_name}_capacity',
                'status': 'pass' if utilization <= 1.0 else 'fail',
                'utilization': round(utilization, 4),
                'demand': round(abs(demand), 6),
                'capacity': round(capacity, 6),
                **({'gammaRE': round(gamma_re, 6)} if gamma_info is not None else {}),
                **({'adjustedCapacity': round(capacity / gamma_re, 6)} if gamma_info is not None else {}),
                **({'gammaRESource': gamma_info.get('source')} if gamma_info is not None else {}),
                'case': case_name,
                'source': capacity_info.get('source'),
                'formula': f'gammaRE * {formula}' if gamma_info is not None else formula,
            })

    if not subchecks:
        return None
    controlling = max(subchecks, key=lambda item: float(item.get('utilization', 0.0)))
    utilization = float(controlling.get('utilization', 0.0))
    return {
        'item': '抗震组合构件承载力',
        'status': 'pass' if all(item.get('status') == 'pass' for item in subchecks) else 'fail',
        'utilization': round(utilization, 4),
        'clause': 'GB 55002-2021 + GB/T 50011-2010(2024) 5.4.1 + 5.4.2 + 6.2',
        'formula': 'structured seismic combination member force effect satisfies S <= R/gammaRE when gammaRE is provided',
        'inputs': {
            'elementId': elem_id,
            'actionCount': len(actions),
            'capacitySources': [
                str(source.get('_source'))
                for source in capacity_sources
                if str(source.get('_source') or '').strip()
            ],
            'controlling': controlling,
            'subchecks': subchecks,
        },
    }


STEEL_SEISMIC_DETAILING_MARKER_KEYS = {
    'slendernessRatio',
    'memberSlendernessRatio',
    'slendernessLimit',
    'memberSlendernessLimit',
    'braceSlendernessRatio',
    'braceSlendernessLimit',
    'widthThicknessRatio',
    'widthThicknessLimit',
    'flangeWidthThicknessRatio',
    'flangeWidthThicknessLimit',
    'webHeightThicknessRatio',
    'webHeightThicknessLimit',
    'plateWidthThicknessRatio',
    'plateWidthThicknessLimit',
    'seismicDetailingUtilization',
    'widthThicknessUtilization',
}


def _steel_seismic_detailing_sources(
    context: Dict[str, Any],
    elem_id: str,
    element: Dict[str, Any],
) -> List[Dict[str, Any]]:
    section = _record(element.get('section'))
    metadata = _element_metadata(context, elem_id, element)
    element_context = _element_context(context, elem_id)
    sources: List[Dict[str, Any]] = []

    def add_record(raw: Any, source_name: str) -> None:
        record = _record(raw)
        if record:
            sources.append({**record, '_source': source_name})
            return
        if isinstance(raw, list):
            for index, item in enumerate(raw, start=1):
                item_record = _record(item)
                if item_record:
                    sources.append({**item_record, '_source': f'{source_name}[{index}]'})

    def add_direct_if_marked(record: Dict[str, Any], source_name: str) -> None:
        if any(key in record for key in STEEL_SEISMIC_DETAILING_MARKER_KEYS):
            sources.append({**record, '_source': source_name})

    add_direct_if_marked(element, f'elementData.{elem_id}')
    add_direct_if_marked(section, f'elementData.{elem_id}.section')
    add_direct_if_marked(metadata, f'elementData.{elem_id}.metadata')
    add_direct_if_marked(element_context, f'elementContextById.{elem_id}')
    for owner_name, owner in (
        (f'elementData.{elem_id}', element),
        (f'elementData.{elem_id}.section', section),
        (f'elementData.{elem_id}.metadata', metadata),
        (f'elementContextById.{elem_id}', element_context),
    ):
        for key in (
            'steelSeismicDetailing',
            'steelDetailing',
            'steelSeismicChecks',
            'seismicDetailing',
            'seismicDetailingChecks',
            'detailing',
            'detailingChecks',
            'widthThickness',
            'slenderness',
        ):
            add_record(owner.get(key), f'{owner_name}.{key}')
    return sources


def _steel_detailing_number_info(
    sources: List[Dict[str, Any]],
    keys: tuple[str, ...],
) -> Optional[Dict[str, Any]]:
    for source in sources:
        source_name = str(source.get('_source') or 'steelSeismicDetailing')
        for key in keys:
            value = _number(source.get(key))
            if value is not None and value >= 0.0:
                return {'value': value, 'source': f'{source_name}.{key}'}
    return None


def _steel_detailing_subcheck_from_pair(
    name: str,
    actual_info: Optional[Dict[str, Any]],
    limit_info: Optional[Dict[str, Any]],
    formula: str,
) -> Optional[Dict[str, Any]]:
    if actual_info is None and limit_info is None:
        return None
    actual = float(actual_info['value']) if actual_info is not None else None
    limit = float(limit_info['value']) if limit_info is not None else None
    if actual is None or limit is None or limit <= 0.0:
        return {
            'name': name,
            'status': 'not_applicable',
            'utilization': 9999.0,
            'actual': round(actual, 6) if actual is not None else None,
            'limit': round(limit, 6) if limit is not None else None,
            'actualSource': actual_info.get('source') if actual_info is not None else None,
            'limitSource': limit_info.get('source') if limit_info is not None else None,
            'formula': formula,
            'message': 'Structured steel seismic detailing check is present but missing comparable actual value or code-derived limit.',
        }
    utilization = actual / max(limit, 1e-12)
    return {
        'name': name,
        'status': 'pass' if utilization <= 1.0 else 'fail',
        'utilization': round(utilization, 4),
        'actual': round(actual, 6),
        'limit': round(limit, 6),
        'actualSource': actual_info.get('source') if actual_info is not None else None,
        'limitSource': limit_info.get('source') if limit_info is not None else None,
        'formula': formula,
    }


def _explicit_steel_detailing_subcheck(source: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    name = str(source.get('name') or source.get('item') or source.get('check') or '').strip()
    actual = _number_from_keys(source, ('actual', 'value', 'demand', 'ratio', 'actualRatio'))
    limit = _number_from_keys(source, ('limit', 'capacity', 'allowable', 'maximum', 'max', 'limitRatio'))
    utilization = _number_from_keys(source, ('utilization', 'demandCapacityRatio', 'dcr'))
    if not name or (actual is None and limit is None and utilization is None):
        return None
    if utilization is None and actual is not None and limit is not None and limit > 0.0:
        utilization = actual / limit
    status_text = str(source.get('status') or '').strip().lower()
    if utilization is not None:
        status = 'pass' if utilization <= 1.0 else 'fail'
    elif status_text in {'pass', 'passed', 'ok', 'satisfied'}:
        status = 'pass'
        utilization = 0.0
    elif status_text in {'fail', 'failed', 'ng', 'not_satisfied'}:
        status = 'fail'
        utilization = 9999.0
    else:
        status = 'not_applicable'
        utilization = 9999.0
    return {
        'name': name,
        'status': status,
        'utilization': round(float(utilization), 4),
        'actual': round(actual, 6) if actual is not None else None,
        'limit': round(limit, 6) if limit is not None else None,
        'source': source.get('_source'),
        'formula': str(source.get('formula') or 'provided steel seismic detailing utilization <= 1.0'),
    }


def _steel_member_seismic_detailing_item(
    elem_id: str,
    context: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    element = _record(_record(context.get('elementData')).get(elem_id))
    if not element or not _is_steel_member(context, elem_id, element):
        return None
    sources = _steel_seismic_detailing_sources(context, elem_id, element)
    if not sources:
        return None

    specs = (
        (
            'member_slenderness_ratio',
            ('memberSlendernessRatio', 'slendernessRatio', 'lambdaRatio', 'lambda'),
            ('memberSlendernessLimit', 'slendernessLimit', 'lambdaRatioLimit', 'lambdaLimit'),
            'member slenderness ratio <= structured code-derived limit',
        ),
        (
            'brace_slenderness_ratio',
            ('braceSlendernessRatio', 'bracingSlendernessRatio'),
            ('braceSlendernessLimit', 'bracingSlendernessLimit'),
            'brace slenderness ratio <= structured code-derived limit',
        ),
        (
            'flange_width_thickness_ratio',
            ('flangeWidthThicknessRatio', 'flangeWidthToThicknessRatio', 'flangeBToTRatio', 'flangeBtRatio'),
            ('flangeWidthThicknessLimit', 'flangeWidthToThicknessLimit', 'flangeBToTLimit', 'flangeBtLimit'),
            'flange width-thickness ratio <= structured code-derived limit',
        ),
        (
            'web_height_thickness_ratio',
            ('webHeightThicknessRatio', 'webHeightToThicknessRatio', 'webHToTRatio', 'webHtRatio'),
            ('webHeightThicknessLimit', 'webHeightToThicknessLimit', 'webHToTLimit', 'webHtLimit'),
            'web height-thickness ratio <= structured code-derived limit',
        ),
        (
            'plate_width_thickness_ratio',
            ('plateWidthThicknessRatio', 'widthThicknessRatio', 'widthToThicknessRatio', 'bToTRatio'),
            ('plateWidthThicknessLimit', 'widthThicknessLimit', 'widthToThicknessLimit', 'bToTLimit'),
            'plate width-thickness ratio <= structured code-derived limit',
        ),
    )
    subchecks: List[Dict[str, Any]] = []
    for name, actual_keys, limit_keys, formula in specs:
        subcheck = _steel_detailing_subcheck_from_pair(
            name,
            _steel_detailing_number_info(sources, actual_keys),
            _steel_detailing_number_info(sources, limit_keys),
            formula,
        )
        if subcheck is not None:
            subchecks.append(subcheck)
    for source in sources:
        explicit = _explicit_steel_detailing_subcheck(source)
        if explicit is not None:
            subchecks.append(explicit)

    if not subchecks:
        return {
            'item': '钢构件抗震构造限值',
            'status': 'not_applicable',
            'utilization': 0.0,
            'clause': 'GB/T 50011-2010(2024) 8.3 + 8.4',
            'formula': 'structured steel seismic detailing actual values are checked against project/code-derived limits',
            'inputs': {
                'elementId': elem_id,
                'sourcePaths': [
                    str(source.get('_source'))
                    for source in sources
                    if str(source.get('_source') or '').strip()
                ],
            },
            'message': 'Structured steel seismic detailing data is present but does not include comparable actual values and code-derived limits.',
        }

    controlling = max(subchecks, key=lambda item: float(item.get('utilization', 0.0)))
    if any(item.get('status') == 'fail' for item in subchecks):
        status = 'fail'
    elif any(item.get('status') == 'not_applicable' for item in subchecks):
        status = 'not_applicable'
    else:
        status = 'pass'
    return {
        'item': '钢构件抗震构造限值',
        'status': status,
        'utilization': float(controlling.get('utilization', 0.0)),
        'clause': 'GB/T 50011-2010(2024) 8.3 + 8.4',
        'formula': 'structured steel seismic detailing actual values are checked against project/code-derived limits',
        'inputs': {
            'elementId': elem_id,
            'sourcePaths': [
                str(source.get('_source'))
                for source in sources
                if str(source.get('_source') or '').strip()
            ],
            'controlling': controlling,
            'subchecks': subchecks,
        },
    }


def _strong_shear_weak_bending_marker(source: Dict[str, Any]) -> bool:
    marker_keys = {
        'strongShearWeakBending',
        'strongShearWeakFlexure',
        'strongShearWeakMoment',
        'shearBendingCapacityDesign',
        'capacityDesignShear',
        'bendingControlledShearDemandKN',
        'flexuralOverstrengthShearDemandKN',
        'strongShearDemandKN',
        'strongShearCapacityKN',
        'capacityDesignShearDemandKN',
        'strongShearWeakBendingUtilization',
        'shearBendingUtilization',
        'capacityDesignShearUtilization',
    }
    if any(key in source for key in marker_keys):
        return True
    for key in ('checks', 'cases', 'directions', 'positive', 'negative', 'x', 'y'):
        raw = source.get(key)
        if isinstance(raw, list) and any(_strong_shear_weak_bending_marker(_record(item)) for item in raw if isinstance(item, dict)):
            return True
        nested = _record(raw)
        if nested and _strong_shear_weak_bending_marker(nested):
            return True
    return False


def _strong_shear_weak_bending_records(source: Dict[str, Any], source_name: str) -> List[Dict[str, Any]]:
    if not source:
        return []
    records: List[Dict[str, Any]] = []
    if _strong_shear_weak_bending_marker(source):
        records.append({**source, '_source': source_name})
    for key in ('checks', 'cases', 'directions'):
        raw = source.get(key)
        if isinstance(raw, list):
            for index, item in enumerate(raw, start=1):
                record = _record(item)
                if _strong_shear_weak_bending_marker(record):
                    records.append({**record, '_source': f'{source_name}.{key}[{index}]'})
    for key in (
        'strongShearWeakBending',
        'strongShearWeakFlexure',
        'strongShearWeakMoment',
        'shearBendingCapacityDesign',
        'capacityDesignShear',
    ):
        record = _record(source.get(key))
        if _strong_shear_weak_bending_marker(record):
            records.extend(_strong_shear_weak_bending_records(record, f'{source_name}.{key}'))
    for key in ('positive', 'negative', 'x', 'y'):
        record = _record(source.get(key))
        if _strong_shear_weak_bending_marker(record):
            records.append({**record, '_source': f'{source_name}.{key}'})
    return records


def _strong_shear_weak_bending_sources(
    context: Dict[str, Any],
    elem_id: str,
    element: Dict[str, Any],
) -> List[Dict[str, Any]]:
    metadata = _element_metadata(context, elem_id, element)
    element_context = _element_context(context, elem_id)
    sources: List[Dict[str, Any]] = []
    for owner_name, owner in (
        ('element', element),
        ('metadata', metadata),
        ('elementContext', element_context),
        ('capacityData', _record(_record(context.get('capacityData')).get(elem_id))),
        ('memberCapacityData', _record(_record(context.get('memberCapacityData')).get(elem_id))),
        ('strongShearWeakBending', _record(_record(context.get('strongShearWeakBending')).get(elem_id))),
        ('capacityDesign', _record(_record(context.get('capacityDesign')).get(elem_id))),
    ):
        owner_record = _record(owner)
        sources.extend(_strong_shear_weak_bending_records(owner_record, owner_name))
        for key in (
            'strongShearWeakBending',
            'strongShearWeakFlexure',
            'strongShearWeakMoment',
            'shearBendingCapacityDesign',
            'capacityDesignShear',
            'capacityDesign',
            'seismicCapacity',
            'capacityCheck',
        ):
            nested = _record(owner_record.get(key))
            sources.extend(_strong_shear_weak_bending_records(nested, f'{owner_name}.{key}'))
    deduped: List[Dict[str, Any]] = []
    seen = set()
    for record in sources:
        signature = (
            str(record.get('_source') or ''),
            str(record.get('direction') or record.get('case') or record.get('name') or ''),
            str(record.get('bendingControlledShearDemandKN') or record.get('requiredShearCapacityKN') or record.get('shearDemandKN') or ''),
            str(record.get('shearCapacityKN') or record.get('providedShearCapacityKN') or record.get('VuKN') or ''),
        )
        if signature in seen:
            continue
        seen.add(signature)
        deduped.append(record)
    return deduped


def _strong_shear_weak_bending_subcheck(record: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    source = str(record.get('_source') or 'structured')
    label = str(record.get('direction') or record.get('case') or record.get('name') or source)
    if _is_true(record.get('exempt')) or _is_true(record.get('notRequired')) or _is_true(record.get('strongShearWeakBendingExempt')):
        return {
            'name': label,
            'status': 'pass',
            'utilization': 0.0,
            'source': source,
            'message': str(record.get('exemptionReason') or record.get('reason') or 'Structured input marks this member as exempt from strong-shear weak-bending check.'),
        }

    utilization = _number_from_keys(record, (
        'strongShearWeakBendingUtilization',
        'shearBendingUtilization',
        'capacityDesignShearUtilization',
    ))
    if utilization is None and any(token in source.lower() for token in ('strongshearweak', 'shearbending', 'capacitydesignshear')):
        utilization = _number_from_keys(record, ('demandCapacityRatio', 'dcr', 'utilization'))
    if utilization is not None and utilization >= 0.0:
        return {
            'name': label,
            'status': 'pass' if utilization <= 1.0 else 'fail',
            'utilization': round(utilization, 4),
            'source': source,
            'providedUtilization': round(utilization, 6),
        }

    demand = _number_from_keys(record, (
        'bendingControlledShearDemandKN',
        'flexuralOverstrengthShearDemandKN',
        'strongShearDemandKN',
        'capacityDesignShearDemandKN',
        'seismicAdjustedShearDemandKN',
        'requiredShearCapacityKN',
        'requiredShearKN',
        'shearDemandKN',
        'VDemandKN',
        'VbKN',
        'VcKN',
    ))
    capacity = _number_from_keys(record, (
        'providedShearCapacityKN',
        'designShearCapacityKN',
        'shearDesignCapacityKN',
        'shearCapacityKN',
        'strongShearCapacityKN',
        'VuKN',
        'VCapacityKN',
    ))
    if demand is None or capacity is None or capacity <= 0.0:
        return None
    utilization = abs(demand) / max(capacity, 1e-12)
    return {
        'name': label,
        'status': 'pass' if utilization <= 1.0 else 'fail',
        'utilization': round(utilization, 4),
        'source': source,
        'bendingControlledShearDemandKN': round(abs(demand), 6),
        'shearCapacityKN': round(capacity, 6),
    }


def _frame_member_strong_shear_weak_bending_item(
    elem_id: str,
    context: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    element = _record(_record(context.get('elementData')).get(elem_id))
    if not element or not _is_concrete_frame_beam_or_column(context, elem_id, element):
        return None
    sources = _strong_shear_weak_bending_sources(context, elem_id, element)
    if not sources:
        return None
    subchecks = [
        item for item in (_strong_shear_weak_bending_subcheck(source) for source in sources)
        if item is not None
    ]
    grade = _seismic_grade(context, elem_id, element)
    element_type = _element_type(context, elem_id, element)
    if not subchecks:
        return {
            'item': '框架构件强剪弱弯受剪承载力',
            'status': 'not_applicable',
            'utilization': 2.0,
            'clause': 'GB/T 50011-2010(2024) 6.2.4 + 6.2.5',
            'formula': 'Vu >= V_capacity_design from member flexural capacity using structured data',
            'inputs': {
                'elementId': elem_id,
                'elementType': element_type,
                'seismicGrade': grade,
                'sourceCount': len(sources),
            },
            'message': 'Structured strong-shear weak-bending data is present but does not include comparable shear demand/capacity or utilization.',
        }
    controlling = max(subchecks, key=lambda item: float(item.get('utilization', 0.0)))
    utilization = float(controlling.get('utilization', 0.0))
    return {
        'item': '框架构件强剪弱弯受剪承载力',
        'status': 'pass' if all(item.get('status') == 'pass' for item in subchecks) else 'fail',
        'utilization': round(utilization, 4),
        'clause': 'GB/T 50011-2010(2024) 6.2.4 + 6.2.5',
        'formula': 'Vu >= V_capacity_design from member flexural capacity using structured data',
        'inputs': {
            'elementId': elem_id,
            'elementType': element_type,
            'seismicGrade': grade,
            'controlling': controlling,
            'subchecks': subchecks,
        },
    }


def _is_concrete_shear_compression_member(context: Dict[str, Any], elem_id: str, element: Dict[str, Any]) -> bool:
    if _is_concrete_frame_beam_or_column(context, elem_id, element) or _is_concrete_shear_wall(context, elem_id, element):
        return True
    element_type = _element_type(context, elem_id, element)
    if element_type not in {'coupling-beam', 'coupling_beam', 'link-beam', 'link_beam', 'wall-beam', 'wall_beam'}:
        return False
    material = _record(element.get('material'))
    category = str(material.get('category') or material.get('family') or '').strip().lower()
    name = str(material.get('name') or material.get('grade') or '').strip().lower()
    if category and category not in {'concrete', 'reinforced-concrete', 'rc'}:
        return False
    if not category and name and not (name.startswith('c') or 'concrete' in name):
        return False
    if category or name:
        return True
    structural_family = str(_record(_record(context.get('analysisSummary')).get('designBasis')).get('structuralFamily') or '').strip().lower()
    return 'concrete' in structural_family


def _shear_compression_group(element: Dict[str, Any]) -> Dict[str, Any]:
    for key in (
        'shearCompression',
        'shearCompressionLimit',
        'shearCompressionCheck',
        'seismicShearCompression',
        'seismicShearCompressionLimit',
        'seismicShearCompressionCheck',
    ):
        record = _record(element.get(key))
        if record:
            return record
    return {}


def _shear_compression_has_marker(element: Dict[str, Any], group: Dict[str, Any]) -> bool:
    marker_keys = {
        'shearCompression',
        'shearCompressionLimit',
        'shearCompressionCheck',
        'seismicShearCompression',
        'seismicShearCompressionLimit',
        'seismicShearCompressionCheck',
        'shearCompressionUtilization',
        'seismicShearCompressionUtilization',
        'shearCompressionRatio',
        'seismicShearCompressionRatio',
    }
    return bool(group) or any(key in element for key in marker_keys)


def _shear_compression_explicit_utilization(element: Dict[str, Any], group: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    for source_name, source in (('shearCompression', group), ('element', element)):
        for key in (
            'shearCompressionUtilization',
            'seismicShearCompressionUtilization',
            'shearCompressionDcr',
            'seismicShearCompressionDcr',
            'demandCapacityRatio',
            'dcr',
            'utilization',
        ):
            value = _number(source.get(key))
            if value is not None and value >= 0.0:
                return {'value': value, 'source': f'{source_name}.{key}'}
    return None


def _shear_compression_demand_kn(
    context: Dict[str, Any],
    elem_id: str,
    element: Dict[str, Any],
    group: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    for source_name, source in (('shearCompression', group), ('element', element)):
        for key in (
            'shearDesignValueKN',
            'seismicShearDesignValueKN',
            'shearDemandKN',
            'seismicShearDemandKN',
            'maxAbsShearKN',
            'VDemandKN',
            'VcKN',
            'VKN',
        ):
            value = _number(source.get(key))
            if value is not None:
                return {'value': abs(value), 'source': f'{source_name}.{key}'}

    actions = _member_combination_action_entries(_record(context.get('analysisSummary')), elem_id)
    best: Optional[Dict[str, Any]] = None
    for action in actions:
        value = _number(action.get('maxAbsShearKN'))
        if value is None:
            continue
        demand = abs(value)
        if best is None or demand > float(best.get('value', 0.0)):
            best = {
                'value': demand,
                'source': 'memberDesignActionCombinations.maxAbsShearKN',
                'case': action.get('case'),
            }
    return best


def _shear_compression_gamma_re(
    context: Dict[str, Any],
    element: Dict[str, Any],
    group: Dict[str, Any],
) -> float:
    design_basis = _record(_record(context.get('analysisSummary')).get('designBasis'))
    for source in (group, element, design_basis, context):
        value = _number(source.get('gammaRE') or source.get('gammaRe') or source.get('seismicCapacityAdjustmentFactor'))
        if value is not None and value > 0.0:
            return value
    return 0.85


def _shear_compression_span_depth_ratio(element: Dict[str, Any], group: Dict[str, Any], section: Dict[str, Any], h0: Optional[float]) -> Optional[float]:
    for source in (group, element, section):
        ratio = _number_from_keys(source, ('spanDepthRatio', 'clearSpanDepthRatio', 'couplingBeamSpanDepthRatio'))
        if ratio is not None and ratio > 0.0:
            return ratio
    span = _dimension_from_keys_mm(element, 'clearSpanMm', 'spanMm', 'clearSpan', 'span')
    if span is None:
        span = _dimension_from_keys_mm(section, 'clearSpanMm', 'spanMm', 'clearSpan', 'span')
    if span is not None and h0 is not None and h0 > 0.0:
        return span / h0
    return None


def _shear_compression_effective_depth_mm(element: Dict[str, Any], group: Dict[str, Any], section: Dict[str, Any], is_wall: bool) -> Optional[Dict[str, Any]]:
    for source_name, source in (('shearCompression', group), ('element', element), ('section', section)):
        value = _dimension_from_keys_mm(source, 'h0Mm', 'h0', 'effectiveDepthMm', 'effectiveDepth', 'effectiveHeightMm', 'effectiveHeight')
        if value is not None:
            return {'value': value, 'source': source_name}
    if is_wall:
        value = _dimension_from_keys_mm(section, 'wallLengthMm', 'wallLength', 'lengthMm', 'length', 'LwMm', 'Lw')
        if value is not None:
            return {'value': value, 'source': 'section.wallLength'}
        properties = _record(section.get('properties'))
        value = _dimension_from_keys_mm(properties, 'wallLengthMm', 'wallLength', 'lengthMm', 'length', 'LwMm', 'Lw')
        if value is not None:
            return {'value': value, 'source': 'section.properties.wallLength'}
    return None


def _shear_compression_width_mm(element: Dict[str, Any], group: Dict[str, Any], section: Dict[str, Any], is_wall: bool) -> Optional[Dict[str, Any]]:
    keys = (
        ('bwMm', 'bw', 'wallThicknessMm', 'wallThickness', 'thicknessMm', 'thickness', 'bMm', 'b', 'widthMm', 'width')
        if is_wall else
        ('bwMm', 'bw', 'bMm', 'b', 'widthMm', 'width')
    )
    for source_name, source in (('shearCompression', group), ('element', element), ('section', section)):
        value = _dimension_from_keys_mm(source, *keys)
        if value is not None:
            return {'value': value, 'source': source_name}
    return None


def _shear_compression_coefficient(
    context: Dict[str, Any],
    elem_id: str,
    element: Dict[str, Any],
    group: Dict[str, Any],
    section: Dict[str, Any],
    h0: Optional[float],
) -> Dict[str, Any]:
    element_type = _element_type(context, elem_id, element)
    is_wall = _is_concrete_shear_wall(context, elem_id, element)
    shear_info = _column_shear_span_ratio_info(context, elem_id, element)
    shear_span_ratio = _number(shear_info.get('ratio')) if shear_info else _number_from_keys(group, ('shearSpanRatio', 'lambda', 'lambdaV'))
    span_depth_ratio = _shear_compression_span_depth_ratio(element, group, section, h0)
    is_short = False
    basis: List[str] = []
    if element_type in {'beam', 'frame-beam', 'concrete-beam', 'rc-beam', 'transfer-beam', 'coupling-beam', 'coupling_beam', 'link-beam', 'link_beam', 'wall-beam', 'wall_beam'}:
        if span_depth_ratio is not None and span_depth_ratio <= 2.5:
            is_short = True
            basis.append('span-depth ratio <= 2.5')
    if element_type in {'column', 'frame-column', 'concrete-column', 'rc-column', 'transfer-column'} or is_wall:
        if shear_span_ratio is not None and shear_span_ratio <= 2.0:
            is_short = True
            basis.append('shear-span ratio <= 2.0')
    if _is_transfer_frame_member(context, elem_id, element):
        is_short = True
        basis.append('transfer member')
    wall = _shear_wall_detailing_group(context, elem_id, element, _reinforcement_data(element))
    if is_wall and (_is_true(wall.get('isBottomStrengthenedZone')) or _is_true(group.get('isBottomStrengthenedZone'))):
        is_short = True
        basis.append('bottom strengthened wall zone')
    return {
        'coefficient': 0.15 if is_short else 0.20,
        'basis': basis or ['ordinary span/shear-span condition'],
        'spanDepthRatio': span_depth_ratio,
        'shearSpanRatio': shear_span_ratio,
    }


def _concrete_member_shear_compression_limit_item(
    elem_id: str,
    context: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    element = _record(_record(context.get('elementData')).get(elem_id))
    if not element or not _is_concrete_shear_compression_member(context, elem_id, element):
        return None
    group = _shear_compression_group(element)
    marker = _shear_compression_has_marker(element, group)
    explicit_utilization = _shear_compression_explicit_utilization(element, group)
    element_type = _element_type(context, elem_id, element)
    if explicit_utilization is not None:
        utilization = float(explicit_utilization['value'])
        return {
            'item': '混凝土构件剪压比限值',
            'status': 'pass' if utilization <= 1.0 else 'fail',
            'utilization': round(utilization, 4),
            'clause': 'GB/T 50011-2010(2024) 6.2.9',
            'formula': 'provided structured shear-compression utilization <= 1.0',
            'inputs': {
                'elementId': elem_id,
                'elementType': element_type,
                'source': explicit_utilization.get('source'),
                'providedUtilization': round(utilization, 6),
            },
        }

    demand_info = _shear_compression_demand_kn(context, elem_id, element, group)
    section = _record(element.get('section'))
    material = _record(element.get('material'))
    fc = _material_strength_mpa(material)
    is_wall = _is_concrete_shear_wall(context, elem_id, element)
    h0_info = _shear_compression_effective_depth_mm(element, group, section, is_wall)
    width_info = _shear_compression_width_mm(element, group, section, is_wall)
    gamma_re = _shear_compression_gamma_re(context, element, group)
    if demand_info is None or fc is None or h0_info is None or width_info is None:
        if not marker:
            return None
        return {
            'item': '混凝土构件剪压比限值',
            'status': 'not_applicable',
            'utilization': 2.0,
            'clause': 'GB/T 50011-2010(2024) 6.2.9',
            'formula': 'V <= coefficient * fc * b * h0 / gammaRE',
            'inputs': {
                'elementId': elem_id,
                'elementType': element_type,
                'hasDemand': demand_info is not None,
                'hasConcreteStrength': fc is not None,
                'hasWidth': width_info is not None,
                'hasEffectiveDepth': h0_info is not None,
            },
            'message': 'Structured shear-compression data is present but does not include comparable shear demand, concrete strength, width, and effective depth.',
        }
    h0 = float(h0_info['value'])
    width = float(width_info['value'])
    coefficient_info = _shear_compression_coefficient(context, elem_id, element, group, section, h0)
    coefficient = float(coefficient_info['coefficient'])
    capacity = coefficient * float(fc) * width * h0 / max(gamma_re, 1e-12) / 1000.0
    demand = float(demand_info['value'])
    utilization = demand / max(capacity, 1e-12)
    return {
        'item': '混凝土构件剪压比限值',
        'status': 'pass' if utilization <= 1.0 else 'fail',
        'utilization': round(utilization, 4),
        'clause': 'GB/T 50011-2010(2024) 6.2.9',
        'formula': 'V <= coefficient * fc * b * h0 / gammaRE',
        'inputs': {
            'elementId': elem_id,
            'elementType': element_type,
            'shearDemandKN': round(demand, 6),
            'shearDemandSource': demand_info.get('source'),
            'case': demand_info.get('case'),
            'fcMPa': round(float(fc), 6),
            'widthMm': round(width, 6),
            'widthSource': width_info.get('source'),
            'effectiveDepthMm': round(h0, 6),
            'effectiveDepthSource': h0_info.get('source'),
            'gammaRE': round(gamma_re, 6),
            'coefficient': coefficient,
            'coefficientBasis': coefficient_info.get('basis'),
            'spanDepthRatio': (
                round(float(coefficient_info['spanDepthRatio']), 6)
                if coefficient_info.get('spanDepthRatio') is not None else None
            ),
            'shearSpanRatio': (
                round(float(coefficient_info['shearSpanRatio']), 6)
                if coefficient_info.get('shearSpanRatio') is not None else None
            ),
            'capacityKN': round(capacity, 6),
        },
    }


def _member_force_entries_from_map(member_forces: Dict[str, Any]) -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []
    for elem_id, raw_force in member_forces.items():
        force = _record(raw_force)
        if not force:
            continue
        entries.append({
            **force,
            'elementId': str(elem_id),
        })
    return entries


def _vertical_member_capacity_records(elem: Dict[str, Any]) -> List[Dict[str, Any]]:
    records: List[Dict[str, Any]] = []

    def append_records(raw: Any, source_name: str) -> None:
        if isinstance(raw, list):
            for index, item in enumerate(raw, start=1):
                append_records(item, f'{source_name}[{index}]')
            return
        record = _record(raw)
        if not record:
            return
        records.append({**record, '_source': source_name})
        for key in ('cases', 'checks', 'directions'):
            append_records(record.get(key), f'{source_name}.{key}')
        for key in ('capacity', 'capacityCheck', 'memberCapacity', 'memberCapacityCheck'):
            append_records(record.get(key), f'{source_name}.{key}')

    for key in (
        'verticalSeismicCapacity',
        'verticalSeismicCapacityCheck',
        'verticalSeismicMemberCapacity',
        'verticalMemberCapacity',
        'verticalCapacity',
        'verticalSeismic',
    ):
        append_records(elem.get(key), key)

    return records


def _vertical_member_explicit_capacity_result(
    elem: Dict[str, Any],
    force: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    subchecks: List[Dict[str, Any]] = []
    for record in _vertical_member_capacity_records(elem):
        source = str(record.get('_source') or 'verticalSeismicCapacity')
        label = str(record.get('case') or record.get('name') or record.get('direction') or source)
        utilization = _number_from_keys(record, (
            'verticalSeismicCapacityUtilization',
            'verticalCapacityUtilization',
            'capacityUtilization',
            'demandCapacityRatio',
            'dcr',
            'utilization',
        ))
        if utilization is not None and utilization >= 0.0:
            subchecks.append({
                'name': label,
                'source': source,
                'method': 'provided_vertical_capacity_utilization',
                'interaction': utilization,
                'axialRatio': 0.0,
                'momentRatio': 0.0,
                'verticalRatio': utilization,
            })
            continue

        vertical_demand = _number_from_keys(record, (
            'verticalSeismicDemandKN',
            'verticalDemandKN',
            'maxAbsVerticalDemandKN',
            'demandKN',
        ))
        vertical_capacity = _number_from_keys(record, (
            'verticalSeismicCapacityKN',
            'verticalCapacityKN',
            'capacityKN',
        ))
        if vertical_demand is not None and vertical_capacity is not None and vertical_capacity > 0.0:
            gamma_info = _component_capacity_adjustment_from_sources([record], ('vertical', 'verticalSeismic', 'capacity'))
            gamma_re = float(gamma_info['value']) if gamma_info is not None else 1.0
            vertical_ratio = abs(vertical_demand) * gamma_re / max(vertical_capacity, 1e-12)
            subchecks.append({
                'name': label,
                'source': source,
                'method': 'provided_vertical_demand_capacity',
                'interaction': vertical_ratio,
                'axialRatio': 0.0,
                'momentRatio': 0.0,
                'verticalRatio': vertical_ratio,
                'verticalDemandKN': abs(vertical_demand),
                'verticalCapacityKN': vertical_capacity,
                **({'gammaRE': gamma_re} if gamma_info is not None else {}),
                **({'gammaRESource': gamma_info.get('source')} if gamma_info is not None else {}),
                **({'verticalAdjustedCapacityKN': vertical_capacity / gamma_re} if gamma_info is not None else {}),
            })
            continue

        axial_capacity = _number_from_keys(record, (
            'axialCapacityKN',
            'designAxialCapacityKN',
            'compressionCapacityKN',
            'NuKN',
        ))
        moment_capacity = _number_from_keys(record, (
            'momentCapacityKNm',
            'designMomentCapacityKNm',
            'MuKNm',
        ))
        if axial_capacity is None and moment_capacity is None:
            continue
        axial_gamma = _component_capacity_adjustment_from_sources([record], ('axial', 'compression', 'n'))
        moment_gamma = _component_capacity_adjustment_from_sources([record], ('moment', 'bending', 'flexural', 'm'))
        axial_gamma_re = float(axial_gamma['value']) if axial_gamma is not None else 1.0
        moment_gamma_re = float(moment_gamma['value']) if moment_gamma is not None else 1.0
        axial = _number_from_keys(record, ('axialDemandKN', 'verticalAxialDemandKN')) or _number(force.get('maxAbsAxialKN')) or 0.0
        moment = _number_from_keys(record, ('momentDemandKNm', 'verticalMomentDemandKNm')) or _number(force.get('maxAbsMomentKNm')) or 0.0
        axial_ratio = abs(axial) * axial_gamma_re / max(axial_capacity, 1e-12) if axial_capacity is not None and axial_capacity > 0.0 else 0.0
        moment_ratio = abs(moment) * moment_gamma_re / max(moment_capacity, 1e-12) if moment_capacity is not None and moment_capacity > 0.0 else 0.0
        subchecks.append({
            'name': label,
            'source': source,
            'method': 'provided_vertical_member_capacity',
            'interaction': axial_ratio + moment_ratio,
            'axialRatio': axial_ratio,
            'momentRatio': moment_ratio,
            'verticalRatio': 0.0,
            'axialDemandKN': abs(axial),
            'momentDemandKNm': abs(moment),
            'axialCapacityKN': axial_capacity,
            'momentCapacityKNm': moment_capacity,
            **({'axialGammaRE': axial_gamma_re} if axial_gamma is not None and axial_capacity is not None else {}),
            **({'axialGammaRESource': axial_gamma.get('source')} if axial_gamma is not None and axial_capacity is not None else {}),
            **({'axialAdjustedCapacityKN': axial_capacity / axial_gamma_re} if axial_gamma is not None and axial_capacity is not None else {}),
            **({'momentGammaRE': moment_gamma_re} if moment_gamma is not None and moment_capacity is not None else {}),
            **({'momentGammaRESource': moment_gamma.get('source')} if moment_gamma is not None and moment_capacity is not None else {}),
            **({'momentAdjustedCapacityKNm': moment_capacity / moment_gamma_re} if moment_gamma is not None and moment_capacity is not None else {}),
        })

    if not subchecks:
        return None
    controlling = max(subchecks, key=lambda item: float(item.get('interaction', 0.0)))
    return {
        'elementId': str(force.get('elementId') or ''),
        'case': force.get('case') or controlling.get('name'),
        'interaction': float(controlling.get('interaction', 0.0)),
        'axialRatio': float(controlling.get('axialRatio', 0.0)),
        'momentRatio': float(controlling.get('momentRatio', 0.0)),
        'verticalRatio': float(controlling.get('verticalRatio', 0.0)),
        'axialDemandKN': float(controlling.get('axialDemandKN', _number(force.get('maxAbsAxialKN')) or 0.0)),
        'shearDemandKN': float(_number(force.get('maxAbsShearKN')) or 0.0),
        'momentDemandKNm': float(controlling.get('momentDemandKNm', _number(force.get('maxAbsMomentKNm')) or 0.0)),
        'axialCapacityKN': controlling.get('axialCapacityKN'),
        'momentCapacityKNm': controlling.get('momentCapacityKNm'),
        'verticalDemandKN': controlling.get('verticalDemandKN'),
        'verticalCapacityKN': controlling.get('verticalCapacityKN'),
        'gammaRE': controlling.get('gammaRE'),
        'gammaRESource': controlling.get('gammaRESource'),
        'verticalAdjustedCapacityKN': controlling.get('verticalAdjustedCapacityKN'),
        'axialGammaRE': controlling.get('axialGammaRE'),
        'axialGammaRESource': controlling.get('axialGammaRESource'),
        'axialAdjustedCapacityKN': controlling.get('axialAdjustedCapacityKN'),
        'momentGammaRE': controlling.get('momentGammaRE'),
        'momentGammaRESource': controlling.get('momentGammaRESource'),
        'momentAdjustedCapacityKNm': controlling.get('momentAdjustedCapacityKNm'),
        'source': controlling.get('source'),
        'method': controlling.get('method'),
        'subchecks': subchecks,
    }


def _member_capacity_screening_item(
    *,
    item_name: str,
    force_entries: List[Dict[str, Any]],
    element_data: Dict[str, Any],
    clause: str,
    formula: str,
    unavailable_message: str,
) -> Dict[str, Any]:
    results: List[Dict[str, Any]] = []
    max_interaction = -1.0
    controlling: Dict[str, Any] = {}
    unavailable: List[str] = []

    for force in force_entries:
        elem_id = str(force.get('elementId') or '')
        if not elem_id:
            continue
        elem = _record(element_data.get(elem_id)) if isinstance(element_data, dict) else {}
        explicit_capacity_result = (
            _vertical_member_explicit_capacity_result(elem, force)
            if item_name == '竖向地震构件承载力' else None
        )
        if explicit_capacity_result is not None:
            results.append(explicit_capacity_result)
            interaction = float(explicit_capacity_result.get('interaction', 0.0))
            if interaction > max_interaction:
                max_interaction = interaction
                controlling = explicit_capacity_result
            continue
        section = _record(elem.get('section'))
        material = _record(elem.get('material'))
        area = _number(section.get('A'))
        strength = _material_strength_mpa(material)
        section_modulus = _section_modulus_mm3(section)
        axial = _number(force.get('maxAbsAxialKN')) or 0.0
        moment = _number(force.get('maxAbsMomentKNm')) or 0.0
        shear = _number(force.get('maxAbsShearKN')) or 0.0
        if area is None or area <= 0.0 or strength is None or strength <= 0.0:
            unavailable.append(elem_id)
            continue
        axial_capacity = 0.9 * strength * area / 1000.0
        axial_ratio = axial / max(axial_capacity, 1e-12)
        moment_ratio = 0.0
        moment_capacity = None
        if section_modulus is not None and section_modulus > 0.0:
            moment_capacity = 0.35 * strength * section_modulus / 1e6
            moment_ratio = moment / max(moment_capacity, 1e-12)
        interaction = axial_ratio + moment_ratio
        item = {
            'elementId': elem_id,
            'case': force.get('case'),
            'interaction': interaction,
            'axialRatio': axial_ratio,
            'momentRatio': moment_ratio,
            'axialDemandKN': axial,
            'shearDemandKN': shear,
            'momentDemandKNm': moment,
            'axialCapacityKN': axial_capacity,
            'momentCapacityKNm': moment_capacity,
        }
        results.append(item)
        if interaction > max_interaction:
            max_interaction = interaction
            controlling = item

    if not results:
        suffix = f": {', '.join(unavailable[:6])}" if unavailable else '.'
        return _check_item(
            item_name,
            demand=None,
            capacity=None,
            clause=clause,
            formula='member force effects have matching section and material capacity data',
            unavailable_message=f"{unavailable_message}{suffix}",
        )

    utilization = max_interaction
    return {
        'item': item_name,
        'status': 'pass' if utilization <= 1.0 else 'fail',
        'utilization': round(utilization, 4),
        'clause': clause,
        'formula': formula,
        'inputs': {
            'checkedMemberCount': len(results),
            'unavailableMemberCount': len(unavailable),
            'controllingElement': controlling.get('elementId'),
            'controllingCase': controlling.get('case'),
            'axialRatio': round(float(controlling.get('axialRatio', 0.0)), 6),
            'momentRatio': round(float(controlling.get('momentRatio', 0.0)), 6),
            'axialDemandKN': round(float(controlling.get('axialDemandKN', 0.0)), 6),
            'shearDemandKN': round(float(controlling.get('shearDemandKN', 0.0)), 6),
            'momentDemandKNm': round(float(controlling.get('momentDemandKNm', 0.0)), 6),
            'axialCapacityKN': (
                round(float(controlling['axialCapacityKN']), 6)
                if controlling.get('axialCapacityKN') is not None else None
            ),
            'momentCapacityKNm': (
                round(float(controlling['momentCapacityKNm']), 6)
                if controlling.get('momentCapacityKNm') is not None else None
            ),
            'verticalRatio': round(float(controlling.get('verticalRatio', 0.0)), 6),
            'verticalDemandKN': (
                round(float(controlling['verticalDemandKN']), 6)
                if controlling.get('verticalDemandKN') is not None else None
            ),
            'verticalCapacityKN': (
                round(float(controlling['verticalCapacityKN']), 6)
                if controlling.get('verticalCapacityKN') is not None else None
            ),
            'gammaRE': (
                round(float(controlling['gammaRE']), 6)
                if controlling.get('gammaRE') is not None else None
            ),
            'gammaRESource': controlling.get('gammaRESource'),
            'verticalAdjustedCapacityKN': (
                round(float(controlling['verticalAdjustedCapacityKN']), 6)
                if controlling.get('verticalAdjustedCapacityKN') is not None else None
            ),
            'axialGammaRE': (
                round(float(controlling['axialGammaRE']), 6)
                if controlling.get('axialGammaRE') is not None else None
            ),
            'axialGammaRESource': controlling.get('axialGammaRESource'),
            'axialAdjustedCapacityKN': (
                round(float(controlling['axialAdjustedCapacityKN']), 6)
                if controlling.get('axialAdjustedCapacityKN') is not None else None
            ),
            'momentGammaRE': (
                round(float(controlling['momentGammaRE']), 6)
                if controlling.get('momentGammaRE') is not None else None
            ),
            'momentGammaRESource': controlling.get('momentGammaRESource'),
            'momentAdjustedCapacityKNm': (
                round(float(controlling['momentAdjustedCapacityKNm']), 6)
                if controlling.get('momentAdjustedCapacityKNm') is not None else None
            ),
            'capacitySource': controlling.get('source'),
            'capacityMethod': controlling.get('method') or 'section_material_screening',
            'subchecks': controlling.get('subchecks', []),
        },
    }


def _vertical_member_capacity_items(vertical_seismic: Dict[str, Any], element_data: Dict[str, Any]) -> List[Dict[str, Any]]:
    static_check = _record(vertical_seismic.get('openSeesStatic'))
    member_forces = static_check.get('memberForces')
    if not isinstance(member_forces, dict) or not member_forces:
        return []
    return [_member_capacity_screening_item(
        item_name='竖向地震构件承载力',
        force_entries=_member_force_entries_from_map(member_forces),
        element_data=element_data,
        clause='GB 55002-2021 + GB/T 50011-2010(2024) 5.4.2',
        formula='N/Nu + M/Mu <= 1.0 using vertical seismic member end-force envelope; explicit S/R checks apply S <= R/gammaRE when gammaRE is provided',
        unavailable_message='Vertical member capacity data is unavailable for all checked members',
    )]


def _design_basis_completeness_item(design_basis: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    missing = design_basis.get('missingInputs')
    missing_inputs = [str(item) for item in missing if str(item).strip()] if isinstance(missing, list) else []
    has_preliminary_flag = 'isPreliminary' in design_basis
    is_preliminary = _is_true(design_basis.get('isPreliminary')) or bool(missing_inputs)
    if not has_preliminary_flag and not missing_inputs:
        return None
    return {
        'item': '抗震设计依据完整性',
        'status': 'fail' if is_preliminary else 'pass',
        'utilization': 0.0,
        **({} if not is_preliminary else {
            'displayUtilization': 'N/A',
            'category': 'input_required',
            'failureType': 'design_basis_incomplete',
            'governingEligible': False,
            'message': 'Required seismic design-basis inputs are missing or still preliminary; confirm them before final compliance.',
        }),
        'clause': 'GB 55002-2021 + GB/T 50011-2010(2024)',
        'formula': 'required seismic design-basis inputs are confirmed before final compliance',
        'inputs': {
            'missingInputs': missing_inputs,
            'isPreliminary': is_preliminary,
        },
    }


def _seismic_grade_design_basis_item(design_basis: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if 'seismicGrade' not in design_basis and 'seismicGradeSource' not in design_basis:
        return None
    raw_grade = design_basis.get('seismicGrade')
    grade = _normalize_seismic_grade(raw_grade)
    source = str(design_basis.get('seismicGradeSource') or '').strip()
    failed = grade is None
    return {
        'item': '抗震等级结构化依据',
        'status': 'fail' if failed else 'pass',
        'utilization': 9999.0 if failed else 0.0,
        'clause': 'GB/T 50011-2010(2024) 6.1 + 6.3/6.4',
        'formula': 'structured seismicGrade in {1, 2, 3, 4} is used by member seismic detailing and capacity checks',
        'inputs': {
            'seismicGrade': grade,
            'rawSeismicGrade': raw_grade,
            'seismicGradeSource': source or ('designBasis.seismicGrade' if grade is not None else None),
            'validGrades': [1, 2, 3, 4],
            'structuralFamily': design_basis.get('structuralFamily'),
            'heightM': design_basis.get('heightM'),
            'storyCount': design_basis.get('storyCount'),
            'intensity': design_basis.get('intensity'),
            'fortificationCategory': design_basis.get('fortificationCategory'),
            'seismicMeasureIntensity': design_basis.get('seismicMeasureIntensity'),
        },
        **({} if not failed else {
            'message': 'Structured seismic grade is missing or outside Grade 1 to Grade 4 while a seismicGrade field was supplied.',
        }),
    }


def _gb18306_standard_status_item(design_basis: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    code_basis = design_basis.get('codeBasis')
    if not isinstance(code_basis, list):
        return None
    records = [_record(item) for item in code_basis if isinstance(item, dict)]
    gb18306 = next((item for item in records if str(item.get('code') or '').strip() == 'GB 18306-2015'), {})
    if not gb18306:
        failed = True
        revision_plan = {}
        effective_amendment = {}
        status = ''
        review_conclusion = ''
        used_as_current_basis = False
    else:
        revision_plan = _record(gb18306.get('revisionPlan'))
        amendments = [item for item in gb18306.get('amendments', []) if isinstance(item, dict)]
        effective_amendment = next((item for item in amendments if str(item.get('status') or '').strip() == 'effective'), {})
        status = str(gb18306.get('standardStatus') or '').strip()
        review_conclusion = str(gb18306.get('lastReviewConclusion') or '').strip()
        used_as_current_basis = _is_true(revision_plan.get('usedAsCurrentBasis'))
        failed = (
            status != 'current'
            or review_conclusion != 'continue_valid'
            or used_as_current_basis
            or effective_amendment.get('no') != 'No.1'
            or effective_amendment.get('effectiveDate') != '2026-02-27'
        )
    return {
        'item': 'GB 18306标准状态',
        'status': 'fail' if failed else 'pass',
        'utilization': 9999.0 if failed else 0.0,
        'clause': 'GB 18306-2015',
        'formula': 'current GB 18306-2015 with No.1 effective amendment remains the formal zonation basis; drafting revision plans are trace-only until effective',
        'inputs': {
            'code': gb18306.get('code') if gb18306 else None,
            'standardStatus': status or None,
            'lastReviewConclusion': review_conclusion or None,
            'lastReviewDate': gb18306.get('lastReviewDate') if gb18306 else None,
            'effectiveAmendment': effective_amendment or None,
            'revisionPlan': revision_plan or None,
            'revisionPlanUsedAsCurrentBasis': used_as_current_basis,
        },
        **({} if not failed else {
            'message': 'GB 18306 standard-status trace is missing, not current, not marked continue-valid, missing the effective No.1 amendment, or a drafting revision plan was used as the current formal design basis.',
        }),
    }


def _fortification_category_key(category: str, code_class: str) -> str:
    key = category.strip().lower().replace('-', '_').replace(' ', '_')
    aliases = {
        'special': 'special',
        'special_fortification': 'special',
        'category_a': 'special',
        'a': 'special',
        'key': 'key',
        'important': 'key',
        'category_b': 'key',
        'b': 'key',
        'standard': 'standard',
        'normal': 'standard',
        'ordinary': 'standard',
        'category_c': 'standard',
        'c': 'standard',
        'moderate': 'moderate',
        'appropriate': 'moderate',
        'category_d': 'moderate',
        'd': 'moderate',
    }
    if key in aliases:
        return aliases[key]
    class_key = code_class.strip().upper()
    return {
        'A': 'special',
        'B': 'key',
        'C': 'standard',
        'D': 'moderate',
    }.get(class_key, '')


def _expected_fortification_trace(category_key: str, intensity: Optional[float]) -> Dict[str, Any]:
    trace = {
        'special': {
            'codeClass': 'A',
            'actionStandard': 'approved_seismic_safety_evaluation_higher_than_local_intensity',
            'measureStandard': 'increase_one_intensity_or_higher_than_9',
        },
        'key': {
            'codeClass': 'B',
            'actionStandard': 'local_fortification_intensity',
            'measureStandard': 'increase_one_intensity_or_higher_than_9',
        },
        'standard': {
            'codeClass': 'C',
            'actionStandard': 'local_fortification_intensity',
            'measureStandard': 'local_fortification_intensity',
        },
        'moderate': {
            'codeClass': 'D',
            'actionStandard': 'local_fortification_intensity',
            'measureStandard': 'may_reduce_with_conditions',
        },
    }.get(category_key, {})
    if intensity is None:
        return trace
    local_intensity = int(intensity)
    if category_key in {'special', 'key'}:
        trace['measureIntensity'] = min(local_intensity + 1, 10) if local_intensity < 9 else 10
    elif category_key == 'standard':
        trace['measureIntensity'] = local_intensity
    elif category_key == 'moderate':
        trace['measureIntensityRange'] = {
            'min': 6,
            'max': local_intensity,
        }
    return trace


def _fortification_category_item(design_basis: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    category = str(design_basis.get('fortificationCategory') or '').strip()
    if not category:
        return None
    code_class = str(design_basis.get('fortificationCategoryCodeClass') or '').strip()
    action_standard = str(design_basis.get('seismicActionStandard') or '').strip()
    measure_standard = str(design_basis.get('seismicMeasureStandard') or '').strip()
    measure_intensity = _number(design_basis.get('seismicMeasureIntensity'))
    intensity = _number(design_basis.get('intensity'))
    safety_required = _is_true(design_basis.get('seismicSafetyEvaluationRequired'))
    safety_provided = _is_true(design_basis.get('seismicSafetyEvaluationProvided'))
    category_key = _fortification_category_key(category, code_class)
    expected = _expected_fortification_trace(category_key, intensity)
    trace_missing = not code_class or not action_standard or not measure_standard or measure_intensity is None
    standard_mismatches = []
    expected_code_class = expected.get('codeClass')
    if expected_code_class and code_class.upper() != expected_code_class:
        standard_mismatches.append('fortificationCategoryCodeClass')
    expected_action = expected.get('actionStandard')
    if expected_action and action_standard != expected_action:
        standard_mismatches.append('seismicActionStandard')
    expected_measure = expected.get('measureStandard')
    if expected_measure and measure_standard != expected_measure:
        standard_mismatches.append('seismicMeasureStandard')
    expected_measure_intensity = expected.get('measureIntensity')
    if expected_measure_intensity is not None and measure_intensity is not None and int(measure_intensity) != int(expected_measure_intensity):
        standard_mismatches.append('seismicMeasureIntensity')
    expected_measure_range = expected.get('measureIntensityRange')
    if isinstance(expected_measure_range, dict) and measure_intensity is not None:
        minimum = _number(expected_measure_range.get('min'))
        maximum = _number(expected_measure_range.get('max'))
        if minimum is not None and maximum is not None and not (minimum <= measure_intensity <= maximum):
            standard_mismatches.append('seismicMeasureIntensity')
    failed = trace_missing or bool(standard_mismatches) or (safety_required and not safety_provided)
    return {
        'item': '抗震设防类别标准',
        'status': 'fail' if failed else 'pass',
        'utilization': 9999.0 if failed else 0.0,
        'clause': 'GB 55002-2021 2.3.2 + GB 50223-2008',
        'formula': 'fortification category determines seismic action standard, seismic measure standard, and safety-evaluation requirement',
        'inputs': {
            'fortificationCategory': category,
            'fortificationCategoryCodeClass': code_class or None,
            'expectedFortificationCategoryCodeClass': expected.get('codeClass'),
            'seismicActionStandard': action_standard or None,
            'expectedSeismicActionStandard': expected.get('actionStandard'),
            'seismicMeasureStandard': measure_standard or None,
            'expectedSeismicMeasureStandard': expected.get('measureStandard'),
            'seismicMeasureIntensity': int(measure_intensity) if measure_intensity is not None else None,
            'expectedSeismicMeasureIntensity': expected.get('measureIntensity'),
            'expectedSeismicMeasureIntensityRange': expected.get('measureIntensityRange'),
            'seismicSafetyEvaluationRequired': safety_required,
            'seismicSafetyEvaluationProvided': safety_provided,
            'traceMissing': trace_missing,
            'standardMismatches': standard_mismatches,
        },
        **({} if not failed else {
            'message': (
                'Structured fortification category trace is incomplete, inconsistent with GB 50223-derived '
                'standards, or a special fortification category lacks an approved seismic safety evaluation.'
            ),
        }),
    }


def _workflow_input_mode_item(analysis_summary: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    raw_mode = analysis_summary.get('workflowInputMode')
    if not isinstance(raw_mode, str) or not raw_mode.strip():
        return None
    mode = raw_mode.strip()
    passed = mode == 'structured_seismic_workflow'
    return {
        'item': '结构化抗震流程输入',
        'status': 'pass' if passed else 'fail',
        'utilization': 0.0 if passed else 9999.0,
        'clause': 'GB 55002-2021 + GB/T 50011-2010(2024)',
        'formula': 'China seismic final compliance uses structured seismicWorkflow input',
        'inputs': {
            'workflowInputMode': mode,
            'requiredWorkflowInputMode': 'structured_seismic_workflow',
        },
        **({} if passed else {
            'message': 'Analysis result was produced through the legacy compatibility parameter path; rerun with structured seismicWorkflow before claiming final China seismic compliance.',
        }),
    }


def _capability_boundary_item(analysis_summary: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    raw_missing = analysis_summary.get('missingCapabilities')
    missing_capabilities = [
        str(item) for item in raw_missing if str(item).strip()
    ] if isinstance(raw_missing, list) else []
    capability_assessment = _record(analysis_summary.get('capabilityAssessment'))
    final_compliance_supported = capability_assessment.get('finalComplianceSupported')
    if not missing_capabilities and final_compliance_supported is not False:
        return None
    return {
        'item': '抗震能力边界',
        'status': 'fail',
        'utilization': 0.0,
        'displayUtilization': 'N/A',
        'governingEligible': False,
        'clause': 'GB 55002-2021 + GB/T 50011-2010(2024)',
        'formula': 'implemented seismic workflow capabilities cover required final compliance checks',
        'inputs': {
            'missingCapabilities': missing_capabilities,
            'finalComplianceSupported': final_compliance_supported,
            'structuralFamily': capability_assessment.get('structuralFamily'),
        },
    }


def _special_system_check_traces(checks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    traces: List[Dict[str, Any]] = []
    for raw_check in checks:
        check = _record(raw_check)
        inputs = _record(check.get('inputs'))
        trace_inputs = {
            key: value
            for key, value in inputs.items()
            if value is None or isinstance(value, (str, int, float, bool))
        }
        traces.append({
            'item': check.get('item'),
            'status': check.get('status'),
            'utilization': _number(check.get('utilization')),
            'clause': check.get('clause'),
            'formula': check.get('formula'),
            'inputs': trace_inputs,
        })
    return traces


def _special_system_review_item(analysis_summary: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    review = _record(analysis_summary.get('specialSystemReview'))
    if not review:
        review = _record(_record(analysis_summary.get('methodDecision')).get('specialSystemAudit'))
    if review.get('reviewRequired') is not True:
        return None
    systems = [
        str(item) for item in review.get('systems', [])
        if str(item).strip()
    ] if isinstance(review.get('systems'), list) else []
    missing_inputs = [
        str(item) for item in review.get('missingInputs', [])
        if str(item).strip()
    ] if isinstance(review.get('missingInputs'), list) else []
    capability_boundaries = [
        str(item) for item in review.get('capabilityBoundaries', [])
        if str(item).strip()
    ] if isinstance(review.get('capabilityBoundaries'), list) else []
    checks = [
        item for item in review.get('checks', [])
        if isinstance(item, dict)
    ] if isinstance(review.get('checks'), list) else []
    isolation_estimate = _record(review.get('isolationEquivalentLinearEstimate'))
    isolation_time_history_estimate = _record(review.get('isolationLayerTimeHistoryEstimate'))
    energy_dissipation_estimate = _record(review.get('energyDissipationEquivalentEstimate'))
    energy_dissipation_time_history_estimate = _record(review.get('energyDissipationTimeHistoryEstimate'))
    failed_checks = [
        _record(item).get('item') for item in checks
        if _record(item).get('status') == 'fail'
    ]
    failed = bool(capability_boundaries or missing_inputs or failed_checks)
    return {
        'item': '隔震与消能减震专门体系审计',
        'status': 'fail' if failed else 'pass',
        'utilization': 9999.0 if failed else 0.0,
        'clause': 'GB 55002-2021 + GB/T 50011-2010(2024)',
        'formula': 'specialized isolation/energy-dissipation systems require structured device audit and specialized analysis before final compliance',
        'inputs': {
            'systems': systems,
            'missingInputs': missing_inputs,
            'capabilityBoundaries': capability_boundaries,
            'deviceCounts': review.get('deviceCounts'),
            'failedChecks': failed_checks,
            'checkCount': len(checks),
            'checks': _special_system_check_traces(checks),
            'isolationEquivalentLinearEstimate': {
                key: isolation_estimate.get(key)
                for key in (
                    'status',
                    'periodSec',
                    'alpha',
                    'baseShearKN',
                    'displacementDemandM',
                    'displacementCapacityM',
                    'displacementUtilization',
                )
                if isolation_estimate.get(key) is not None
            } if isolation_estimate else None,
            'isolationLayerTimeHistoryEstimate': {
                key: isolation_time_history_estimate.get(key)
                for key in (
                    'status',
                    'engineMode',
                    'periodSec',
                    'recordCount',
                    'controllingRecord',
                    'maxDisplacementM',
                    'maxBaseShearKN',
                    'displacementCapacityM',
                    'displacementUtilization',
                )
                if isolation_time_history_estimate.get(key) is not None
            } if isolation_time_history_estimate else None,
            'energyDissipationEquivalentEstimate': {
                key: energy_dissipation_estimate.get(key)
                for key in (
                    'status',
                    'periodSec',
                    'baseDampingRatio',
                    'additionalDampingRatio',
                    'equivalentDampingRatio',
                    'demandReductionRatio',
                    'adjustedDisplacementDemandM',
                    'deformationCapacityM',
                    'deformationUtilization',
                )
                if energy_dissipation_estimate.get(key) is not None
            } if energy_dissipation_estimate else None,
            'energyDissipationTimeHistoryEstimate': {
                key: energy_dissipation_time_history_estimate.get(key)
                for key in (
                    'status',
                    'engineMode',
                    'periodSec',
                    'recordCount',
                    'controllingRecord',
                    'maxDeviceDeformationM',
                    'maxDeviceForceKN',
                    'deformationCapacityM',
                    'deformationUtilization',
                    'forceCapacityKN',
                    'forceUtilization',
                )
                if energy_dissipation_time_history_estimate.get(key) is not None
            } if energy_dissipation_time_history_estimate else None,
        },
        **({} if not failed else {
            'message': 'Structured workflow includes isolation or energy-dissipation systems; final China seismic compliance requires specialized system analysis and complete device acceptance data.',
        }),
    }


def _review_requirement_trace(
    sources: List[tuple[str, Dict[str, Any]]],
) -> tuple[Optional[bool], List[Dict[str, Any]]]:
    keys = (
        'reviewRequired',
        'required',
        'requiresReview',
        'overLimitReviewRequired',
        'requiresOverLimitReview',
        'specialReviewRequired',
        'requiresSpecialReview',
        'specialSeismicReviewRequired',
    )
    traces: List[Dict[str, Any]] = []
    for source_name, source in sources:
        for key in keys:
            if key not in source:
                continue
            value = source.get(key)
            if _is_true(value):
                traces.append({'source': f'{source_name}.{key}', 'value': True})
            elif _is_false(value):
                traces.append({'source': f'{source_name}.{key}', 'value': False})
    if any(trace.get('value') is True for trace in traces):
        return True, traces
    if any(trace.get('value') is False for trace in traces):
        return False, traces
    return None, traces


def _review_status_trace(record: Dict[str, Any]) -> tuple[str, Optional[str], Optional[str]]:
    status_keys = (
        'status',
        'reviewStatus',
        'approvalStatus',
        'conclusion',
        'reviewConclusion',
        'approvalConclusion',
    )
    approved_statuses = {'approved', 'accepted', 'passed', 'pass', 'complete', 'completed', 'provided'}
    failed_statuses = {'rejected', 'denied', 'failed', 'fail', 'not_approved', 'unapproved'}
    for key in status_keys:
        raw = record.get(key)
        if raw is None:
            continue
        value = str(raw).strip().lower()
        if not value:
            continue
        if value in approved_statuses:
            return 'approved', key, str(raw)
        if value in failed_statuses:
            return 'failed', key, str(raw)
        return 'pending', key, str(raw)

    provided_keys = (
        'approved',
        'reviewApproved',
        'approvalProvided',
        'reviewCompleted',
        'completed',
        'provided',
        'expertReviewProvided',
        'expertReviewCompleted',
    )
    for key in provided_keys:
        if _is_true(record.get(key)):
            return 'approved', key, record.get(key)
    return 'missing', None, None


def _review_reasons(record: Dict[str, Any]) -> List[str]:
    reasons: List[str] = []
    for key in ('reasons', 'reviewReasons', 'overLimitReasons', 'specialReviewReasons'):
        value = record.get(key)
        if isinstance(value, list):
            reasons.extend(str(item) for item in value if str(item).strip())
        elif isinstance(value, str) and value.strip():
            reasons.append(value.strip())
    return list(dict.fromkeys(reasons))


def _over_limit_special_review_item(
    analysis_summary: Dict[str, Any],
    design_basis: Dict[str, Any],
    method_decision: Dict[str, Any],
    regularity_assessment: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    review_sources = [
        ('analysisSummary.overLimitReview', _record(analysis_summary.get('overLimitReview'))),
        ('analysisSummary.specialReview', _record(analysis_summary.get('specialReview'))),
        ('analysisSummary.specialSeismicReview', _record(analysis_summary.get('specialSeismicReview'))),
        ('analysisSummary.overLimitSpecialReview', _record(analysis_summary.get('overLimitSpecialReview'))),
        ('analysisSummary.designBasis.overLimitReview', _record(design_basis.get('overLimitReview'))),
        ('analysisSummary.designBasis.specialReview', _record(design_basis.get('specialReview'))),
        ('analysisSummary.methodDecision.overLimitReview', _record(method_decision.get('overLimitReview'))),
        ('analysisSummary.methodDecision.specialReview', _record(method_decision.get('specialReview'))),
        ('analysisSummary.regularityAssessment', regularity_assessment),
    ]
    nonempty_review_sources = [
        (source_name, source)
        for source_name, source in review_sources
        if source
    ]
    review_required, requirement_traces = _review_requirement_trace(nonempty_review_sources)

    evidence_traces: List[Dict[str, Any]] = []
    failed_sources: List[str] = []
    pending_sources: List[str] = []
    provided = False
    reasons: List[str] = []
    for source_name, source in nonempty_review_sources:
        state, status_key, raw_status = _review_status_trace(source)
        reasons.extend(_review_reasons(source))
        trace = {
            'source': source_name,
            'state': state,
            'statusField': status_key,
            'status': raw_status,
            'reviewType': source.get('reviewType') or source.get('type'),
            'approvalId': source.get('approvalId') or source.get('reviewId') or source.get('reportId'),
            'authority': source.get('authority') or source.get('reviewAuthority'),
            'date': source.get('date') or source.get('reviewDate') or source.get('approvalDate'),
        }
        if any(value is not None for key, value in trace.items() if key not in {'source', 'state'}):
            evidence_traces.append(trace)
        if state == 'approved':
            provided = True
        elif state == 'failed':
            failed_sources.append(source_name)
        elif state == 'pending':
            pending_sources.append(source_name)

    if review_required is None and not provided and not failed_sources:
        return None

    failed = bool(failed_sources) or (review_required is True and not provided)
    missing_evidence = review_required is True and not provided and not failed_sources
    classification = str(regularity_assessment.get('classification') or '').strip().lower() or None
    return {
        'item': '超限与专项审查结构化追踪',
        'status': 'fail' if failed else 'pass',
        'utilization': 9999.0 if failed else 0.0,
        'clause': 'GB 55002-2021 + GB/T 50011-2010(2024)',
        'formula': 'structured over-limit or special seismic review requirement => traceable approved/completed review evidence',
        'inputs': {
            'reviewRequired': review_required,
            'requirementTraces': requirement_traces,
            'reviewEvidenceProvided': provided,
            'failedReviewSources': failed_sources,
            'pendingReviewSources': pending_sources,
            'reviewEvidence': evidence_traces,
            'regularityClassification': classification,
            'reasons': list(dict.fromkeys(reasons)),
            'missingReviewEvidence': missing_evidence,
        },
        **({} if not failed else {
            'message': 'Structured over-limit or special seismic review is required but approved/completed review evidence is missing or explicitly failed.',
        }),
    }


def _required_time_history_item(
    method_decision: Dict[str, Any],
    time_history: Dict[str, Any],
    ground_motion_requirement: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    if not _is_true(method_decision.get('requiresTimeHistory')):
        return None
    records = time_history.get('records') if isinstance(time_history.get('records'), list) else []
    provided_count = _number(ground_motion_requirement.get('providedCount'))
    actual_count = int(provided_count) if provided_count is not None else len(records)
    required_count = _number(ground_motion_requirement.get('totalRequiredCount'))
    if required_count is None:
        required_count = _number(ground_motion_requirement.get('requiredCount'))
    if required_count is None:
        required_count = _number(method_decision.get('requiredGroundMotionCount'))
    required = max(1.0, required_count or 0.0)
    missing_count = _number(ground_motion_requirement.get('missingCount'))
    if missing_count is None:
        missing_count = max(required - actual_count, 0.0)
    passed = actual_count >= required and (missing_count or 0.0) <= 0.0
    utilization = 0.0 if passed or actual_count <= 0 else required / float(actual_count)
    return {
        'item': '补充时程分析完整性',
        'status': 'pass' if passed else 'fail',
        'utilization': round(utilization, 4),
        **({} if passed else {
            'displayUtilization': 'N/A',
            'category': 'input_required',
            'failureType': 'supplementary_time_history_incomplete',
            'governingEligible': False,
            'message': 'Supplementary time-history analysis is required but the required ground-motion records or results are incomplete.',
        }),
        'clause': 'GB/T 50011-2010(2024) 5.1.2',
        'formula': 'required supplementary time-history records and results are provided',
        'inputs': {
            'demand': actual_count,
            'capacity': int(required),
            'limit': int(required),
            'missingCount': int(missing_count),
        },
    }


def _elastic_plastic_time_history_final_compliance_item(analysis_summary: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    elastic_plastic = _record(analysis_summary.get('elasticPlasticTimeHistory'))
    final_compliance = _record(elastic_plastic.get('finalCompliance'))
    if not final_compliance:
        return None
    utilization = _number(final_compliance.get('utilization'))
    status = str(final_compliance.get('status') or '').strip().lower()
    drift = _number(final_compliance.get('driftRatio'))
    limit = _number(final_compliance.get('limitDriftRatio'))
    if status not in {'pass', 'fail'}:
        return _check_item(
            '弹塑性时程最终符合性',
            demand=None,
            capacity=None,
            clause='GB 55002-2021 + GB/T 50011-2010(2024)',
            formula='elastic-plastic time-history acceptance result is available',
            unavailable_message='Elastic-plastic time-history final compliance result is present but does not contain a pass/fail status.',
        )
    return {
        'item': '弹塑性时程最终符合性',
        'status': 'pass' if status == 'pass' and (utilization is None or utilization <= 1.0) else 'fail',
        'utilization': round(float(utilization or 0.0), 4),
        'clause': 'GB 55002-2021 + GB/T 50011-2010(2024)',
        'formula': 'elastic-plastic time-history drift ratio <= limit drift ratio',
        'inputs': {
            'demand': round(float(drift), 8) if drift is not None else None,
            'capacity': round(float(limit), 8) if limit is not None else None,
            'method': final_compliance.get('method'),
            'source': final_compliance.get('source'),
            'scope': final_compliance.get('scope'),
        },
    }


def _modal_mass_participation_item(summary: Dict[str, Any], envelope: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    ratio = _number(summary.get('modalMassParticipationRatio'))
    if ratio is None:
        ratio = _number(envelope.get('modalMassParticipationRatio'))
    if ratio is None:
        return None
    utilization = 0.90 / max(ratio, 1e-12)
    return {
        'item': '振型参与质量系数',
        'status': 'pass' if utilization <= 1.0 else 'fail',
        'utilization': round(utilization, 4),
        'clause': 'GB/T 50011-2010(2024) 5.2.2',
        'formula': 'ΣMeff / M >= 0.90',
        'inputs': {
            'demand': round(ratio, 8),
            'capacity': 0.90,
            'limit': 0.90,
        },
    }


def _response_spectrum_long_period_special_study_item(analysis_summary: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    response_spectrum = _record(analysis_summary.get('responseSpectrum'))
    assessment = _record(analysis_summary.get('periodRangeAssessment'))
    if not assessment:
        assessment = _record(response_spectrum.get('periodRangeAssessment'))
    if not assessment:
        return None
    requires_special_study = assessment.get('requiresSpecialStudy') is True
    max_period = _number(assessment.get('maxModePeriodSec'))
    period_limit = _number(assessment.get('maxCodeSpectrumPeriodSec'))
    if period_limit is None or period_limit <= 0.0:
        period_limit = 6.0
    advisory = _record(response_spectrum.get('longPeriodSpecialStudyAdvisory'))
    governing_mode = _record(advisory.get('governingMode'))
    utilization = (max_period / period_limit) if max_period is not None and period_limit > 0.0 else (9999.0 if requires_special_study else 0.0)
    passed = not requires_special_study
    return {
        'item': '反应谱长周期专项研究',
        'status': 'pass' if passed else 'fail',
        'utilization': round(utilization, 4),
        'clause': 'GB/T 50011-2010(2024) 5.1.5',
        'formula': 'max(T_mode) <= normal code response-spectrum period range before final response-spectrum compliance',
        'inputs': {
            'requiresSpecialStudy': requires_special_study,
            'maxModePeriodSec': round(max_period, 8) if max_period is not None else None,
            'maxCodeSpectrumPeriodSec': round(period_limit, 8),
            'advisoryStatus': advisory.get('status'),
            'governingMode': governing_mode or None,
        },
        **({} if passed else {
            'message': 'A project-specific long-period special study is required; the advisory spectrum trace is not a substitute for final compliance.',
        }),
    }


def _first_number_from_records(records: tuple[Dict[str, Any], ...], keys: tuple[str, ...]) -> Optional[float]:
    for record in records:
        for key in keys:
            value = _number(record.get(key))
            if value is not None:
                return value
    return None


def _site_seismic_record(design_basis: Dict[str, Any]) -> Dict[str, Any]:
    return _record(design_basis.get('siteSeismic'))


def _design_basic_acceleration_g(design_basis: Dict[str, Any]) -> Optional[float]:
    site = _site_seismic_record(design_basis)
    site_extra = _record(site.get('extra'))
    zonation = _record(design_basis.get('groundMotionZonation'))
    return _first_number_from_records((
        site,
        site_extra,
        design_basis,
        zonation,
    ), (
        'designBasicAccelerationG',
        'basicAccelerationG',
        'accelerationG',
        'acceleration_g',
    ))


def _design_intensity(design_basis: Dict[str, Any]) -> Optional[int]:
    site = _site_seismic_record(design_basis)
    zonation = _record(design_basis.get('groundMotionZonation'))
    raw = _first_number_from_records((
        site,
        design_basis,
        zonation,
    ), (
        'intensity',
        'seismicIntensity',
        'fortificationIntensity',
    ))
    if raw is None:
        return None
    rounded = int(round(raw))
    return rounded if rounded in STORY_MINIMUM_SHEAR_COEFFICIENT_SHORT_PERIOD else None


def _story_minimum_shear_coefficient_rows(
    intensity: int,
    acceleration_g: Optional[float],
) -> Optional[tuple[float, float, str]]:
    if intensity not in STORY_MINIMUM_SHEAR_COEFFICIENT_SHORT_PERIOD:
        return None
    if intensity in STORY_MINIMUM_SHEAR_COEFFICIENT_HIGH_ACCELERATION:
        threshold = 0.15 if intensity == 7 else 0.30
        if acceleration_g is None or acceleration_g >= threshold - 1e-9:
            short, long = STORY_MINIMUM_SHEAR_COEFFICIENT_HIGH_ACCELERATION[intensity]
            return short, long, f'{intensity}度高设计基本地震加速度档'
    return (
        STORY_MINIMUM_SHEAR_COEFFICIENT_SHORT_PERIOD[intensity],
        STORY_MINIMUM_SHEAR_COEFFICIENT_LONG_PERIOD[intensity],
        f'{intensity}度标准设计基本地震加速度档',
    )


def _fundamental_period(
    analysis_summary: Dict[str, Any],
    summary: Dict[str, Any],
    envelope: Dict[str, Any],
) -> tuple[Optional[float], Optional[str]]:
    response_spectrum = _record(analysis_summary.get('responseSpectrum'))
    response_envelope = _record(response_spectrum.get('envelope'))
    direct = _first_number_from_records((
        summary,
        envelope,
        analysis_summary,
        response_spectrum,
        response_envelope,
    ), (
        'fundamentalPeriod',
        'fundamentalPeriodS',
        'fundamentalPeriodSec',
        'firstModePeriod',
        'firstModePeriodS',
    ))
    if direct is not None and direct > 0.0:
        return direct, 'summary'

    modal = _record(analysis_summary.get('modal'))
    modes = modal.get('modes')
    if isinstance(modes, list):
        sorted_modes = sorted(
            [_record(mode) for mode in modes if isinstance(mode, dict)],
            key=lambda item: _number(item.get('modeNumber')) or 9999.0,
        )
        for mode in sorted_modes:
            period = _first_number_from_records((mode,), (
                'period',
                'periodS',
                'periodSec',
            ))
            if period is not None and period > 0.0:
                return period, 'modal.modes[0]'
    return None, None


def _has_significant_torsion(
    design_basis: Dict[str, Any],
    regularity_assessment: Dict[str, Any],
    summary: Dict[str, Any],
    envelope: Dict[str, Any],
) -> Optional[bool]:
    regularity_summary = _record(regularity_assessment.get('summary'))
    return _optional_bool_from_sources((
        design_basis,
        _record(design_basis.get('regularity')),
        regularity_assessment,
        regularity_summary,
        summary,
        envelope,
    ), (
        'hasSignificantTorsion',
        'significantTorsion',
        'torsionEffectSignificant',
        'obviousTorsionalEffect',
        'torsionEffectObvious',
    ))


def _story_minimum_shear_base_limit(
    analysis_summary: Dict[str, Any],
    design_basis: Dict[str, Any],
    summary: Dict[str, Any],
    envelope: Dict[str, Any],
    regularity_assessment: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    intensity = _design_intensity(design_basis)
    if intensity is None:
        return None
    acceleration_g = _design_basic_acceleration_g(design_basis)
    rows = _story_minimum_shear_coefficient_rows(intensity, acceleration_g)
    if rows is None:
        return None
    short_limit, long_limit, acceleration_band = rows
    period, period_source = _fundamental_period(analysis_summary, summary, envelope)
    has_torsion = _has_significant_torsion(design_basis, regularity_assessment, summary, envelope)
    if has_torsion is True:
        limit = short_limit
        basis = 'significant_torsion'
    elif period is None:
        limit = short_limit
        basis = 'missing_period_conservative_short_period'
        period_source = None
    elif period <= 3.5:
        limit = short_limit
        basis = 'period_le_3_5s'
    elif period >= 5.0:
        limit = long_limit
        basis = 'period_ge_5_0s'
    else:
        ratio = (period - 3.5) / 1.5
        limit = short_limit + (long_limit - short_limit) * ratio
        basis = 'period_linear_interpolation_3_5s_to_5_0s'
    return {
        'limit': limit,
        'shortPeriodLimit': short_limit,
        'longPeriodLimit': long_limit,
        'intensity': intensity,
        'designBasicAccelerationG': acceleration_g,
        'accelerationBand': acceleration_band,
        'fundamentalPeriod': period,
        'periodSource': period_source,
        'hasSignificantTorsion': has_torsion,
        'basis': basis,
    }


def _story_label(row: Dict[str, Any], index: int) -> str:
    for key in ('story', 'storyId', 'storyName', 'floor', 'floorId', 'level'):
        value = row.get(key)
        if value is not None and str(value).strip():
            return str(value)
    return f'S{index}'


def _story_shear_weight_ratio_from_row(row: Dict[str, Any]) -> Optional[float]:
    ratio = _first_number_from_records((row,), (
        'shearWeightRatio',
        'storyShearWeightRatio',
        'storyShearCoefficient',
        'seismicShearCoefficient',
        'minimumShearCoefficient',
        'ratio',
    ))
    if ratio is not None:
        return ratio if ratio >= 0.0 else None
    story_shear = _first_number_from_records((row,), (
        'storyShearKN',
        'cumulativeStoryShearKN',
        'cumulativeShearKN',
        'floorShearKN',
        'seismicShearKN',
    ))
    cumulative_weight = _first_number_from_records((row,), (
        'cumulativeWeightKN',
        'weightAboveKN',
        'gravityLoadAboveKN',
        'representativeGravityLoadKN',
    ))
    if story_shear is None or cumulative_weight is None or cumulative_weight <= 0.0:
        return None
    return abs(story_shear) / cumulative_weight


def _story_shear_weight_entries_from_rows(
    rows: Any,
    *,
    direction: Optional[str],
    source: str,
) -> List[Dict[str, Any]]:
    if not isinstance(rows, list):
        return []
    entries: List[Dict[str, Any]] = []
    for index, raw_row in enumerate(rows, start=1):
        row = _record(raw_row)
        if not row and _number(raw_row) is None:
            continue
        ratio = _story_shear_weight_ratio_from_row(row) if row else _number(raw_row)
        if ratio is None or ratio < 0.0:
            continue
        weak_story = _optional_bool_from_sources((row,), (
            'isWeakStory',
            'weakStory',
            'isWeakLayer',
            'weakLayer',
        ))
        entries.append({
            'story': _story_label(row, index) if row else f'S{index}',
            'direction': direction or row.get('direction') or row.get('axis'),
            'ratio': ratio,
            'source': source,
            'isWeakStory': weak_story,
            'minimumShearAdjusted': bool(row.get('minimumShearAdjusted')) if row else False,
            'minimumShearAdjustmentFactor': _first_number_from_records((row,), (
                'minimumShearAdjustmentFactor',
                'minimumStoryShearAdjustmentFactor',
                'adjustmentFactor',
            )) if row else None,
            'rawShearWeightRatio': _first_number_from_records((row,), (
                'rawShearWeightRatio',
                'unadjustedShearWeightRatio',
            )) if row else None,
            'storyShearKN': _first_number_from_records((row,), (
                'storyShearKN',
                'cumulativeStoryShearKN',
                'cumulativeShearKN',
                'floorShearKN',
                'seismicShearKN',
            )) if row else None,
            'cumulativeWeightKN': _first_number_from_records((row,), (
                'cumulativeWeightKN',
                'weightAboveKN',
                'gravityLoadAboveKN',
                'representativeGravityLoadKN',
            )) if row else None,
        })
    return entries


def _story_shear_weight_entries(analysis_summary: Dict[str, Any]) -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []

    def extend_from_container(container: Dict[str, Any], source: str, direction: Optional[str] = None) -> None:
        container_direction = direction or container.get('direction')
        entries.extend(_story_shear_weight_entries_from_rows(
            container.get('storyShearWeightRatios'),
            direction=container_direction,
            source=f'{source}.storyShearWeightRatios',
        ))
        entries.extend(_story_shear_weight_entries_from_rows(
            container.get('floorResponses'),
            direction=container_direction,
            source=f'{source}.floorResponses',
        ))

    extend_from_container(analysis_summary, 'analysisSummary')
    extend_from_container(_record(analysis_summary.get('summary')), 'analysisSummary.summary')
    extend_from_container(_record(analysis_summary.get('responseSpectrum')), 'analysisSummary.responseSpectrum')
    direction_results = analysis_summary.get('directionResults')
    if isinstance(direction_results, list):
        for index, raw_result in enumerate(direction_results, start=1):
            result = _record(raw_result)
            if not result:
                continue
            direction = result.get('direction')
            extend_from_container(
                _record(result.get('responseSpectrum')),
                f'analysisSummary.directionResults[{index}].responseSpectrum',
                direction=str(direction) if direction is not None else None,
            )

    seen: set[tuple[str, str, str, float]] = set()
    unique_entries: List[Dict[str, Any]] = []
    for entry in entries:
        ratio = _number(entry.get('ratio'))
        if ratio is None:
            continue
        key = (
            str(entry.get('direction') or ''),
            str(entry.get('story') or ''),
            str(entry.get('source') or ''),
            round(ratio, 10),
        )
        if key in seen:
            continue
        seen.add(key)
        unique_entries.append(entry)
    return unique_entries


def _story_minimum_seismic_shear_coefficient_item(
    analysis_summary: Dict[str, Any],
    design_basis: Dict[str, Any],
    summary: Dict[str, Any],
    envelope: Dict[str, Any],
    regularity_assessment: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    entries = _story_shear_weight_entries(analysis_summary)
    if not entries:
        return None
    limit_data = _story_minimum_shear_base_limit(
        analysis_summary,
        design_basis,
        summary,
        envelope,
        regularity_assessment,
    )
    if limit_data is None:
        return _check_item(
            '楼层最小地震剪力系数',
            demand=None,
            capacity=None,
            clause='GB/T 50011-2010(2024) 5.2.5',
            formula='story shear-weight ratio >= minimum coefficient from Table 5.2.5',
            unavailable_message='Story shear-weight ratios are available, but seismic intensity or design basic acceleration for Table 5.2.5 is unavailable.',
        )

    base_limit = float(limit_data['limit'])
    story_results: List[Dict[str, Any]] = []
    for entry in entries:
        ratio = float(entry['ratio'])
        weak_story = entry.get('isWeakStory') is True
        story_limit = base_limit * (1.15 if weak_story else 1.0)
        utilization = story_limit / max(ratio, 1e-12)
        story_results.append({
            'story': entry.get('story'),
            'direction': entry.get('direction'),
            'status': 'pass' if utilization <= 1.0 else 'fail',
            'utilization': round(utilization, 4),
            'shearWeightRatio': round(ratio, 8),
            'limit': round(story_limit, 8),
            'baseLimit': round(base_limit, 8),
            'isWeakStory': weak_story,
            'minimumShearAdjusted': bool(entry.get('minimumShearAdjusted')),
            'minimumShearAdjustmentFactor': (
                round(float(entry['minimumShearAdjustmentFactor']), 6)
                if entry.get('minimumShearAdjustmentFactor') is not None else None
            ),
            'rawShearWeightRatio': (
                round(float(entry['rawShearWeightRatio']), 8)
                if entry.get('rawShearWeightRatio') is not None else None
            ),
            'source': entry.get('source'),
            'storyShearKN': round(float(entry['storyShearKN']), 6) if entry.get('storyShearKN') is not None else None,
            'cumulativeWeightKN': round(float(entry['cumulativeWeightKN']), 6) if entry.get('cumulativeWeightKN') is not None else None,
        })
    controlling = max(story_results, key=lambda item: float(item.get('utilization', 0.0)))
    utilization = float(controlling.get('utilization', 0.0))
    return {
        'item': '楼层最小地震剪力系数',
        'status': 'pass' if all(item.get('status') == 'pass' for item in story_results) else 'fail',
        'utilization': round(utilization, 4),
        'clause': 'GB/T 50011-2010(2024) 5.2.5',
        'formula': 'V_Eki / G_i >= λ; weak story λ is multiplied by 1.15; 3.5s<T1<5.0s uses linear interpolation',
        'inputs': {
            'demand': controlling.get('shearWeightRatio'),
            'capacity': controlling.get('limit'),
            'limit': controlling.get('limit'),
            'baseLimit': round(base_limit, 8),
            'intensity': limit_data.get('intensity'),
            'designBasicAccelerationG': limit_data.get('designBasicAccelerationG'),
            'accelerationBand': limit_data.get('accelerationBand'),
            'fundamentalPeriod': (
                round(float(limit_data['fundamentalPeriod']), 6)
                if limit_data.get('fundamentalPeriod') is not None else None
            ),
            'periodSource': limit_data.get('periodSource'),
            'limitBasis': limit_data.get('basis'),
            'hasSignificantTorsion': limit_data.get('hasSignificantTorsion'),
            'minimumShearAdjustmentApplied': any(item.get('minimumShearAdjusted') for item in story_results),
            'storyCount': len(story_results),
            'controlling': controlling,
            'storyResults': story_results,
        },
    }


def _regularity_time_history_trigger_item(
    regularity_assessment: Dict[str, Any],
    method_decision: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    if not regularity_assessment:
        return None
    classification = str(regularity_assessment.get('classification') or '').strip().lower()
    if not classification:
        return None
    requires_time_history = _is_true(method_decision.get('requiresTimeHistory'))
    selected_methods = method_decision.get('selectedMethods')
    selected_method_values = [
        str(item).strip().lower()
        for item in selected_methods
        if isinstance(item, str)
    ] if isinstance(selected_methods, list) else []
    has_time_history_method = any('time_history' in item for item in selected_method_values)
    trigger_satisfied = requires_time_history or has_time_history_method
    if classification == 'particularly_irregular':
        passed = trigger_satisfied
        utilization = 0.0
        message = None if passed else 'Particularly irregular regularity classification did not trigger supplementary time-history demand.'
    elif classification in {'regular', 'irregular'}:
        passed = True
        utilization = 0.0
        message = None
    else:
        return {
            'item': '规则性评估与补充时程触发',
            'status': 'not_applicable',
            'utilization': 0.0,
            'clause': 'GB/T 50011-2010(2024) 5.1.2',
            'formula': 'particularly_irregular => supplementary frequent-earthquake time-history analysis',
            'inputs': {
                'classification': classification,
                'regularitySource': regularity_assessment.get('source'),
                'requiresTimeHistory': requires_time_history,
                'selectedMethods': selected_method_values,
            },
            'message': 'Regularity classification is unknown; engineer review is required before final GB50011 compliance.',
        }
    return {
        'item': '规则性评估与补充时程触发',
        'status': 'pass' if passed else 'fail',
        'utilization': utilization,
        'clause': 'GB/T 50011-2010(2024) 5.1.2',
        'formula': 'particularly_irregular => supplementary frequent-earthquake time-history analysis',
        'inputs': {
            'classification': classification,
            'regularitySource': regularity_assessment.get('source'),
            'requiresTimeHistory': requires_time_history,
            'selectedMethods': selected_method_values,
            'checkCount': len(regularity_assessment.get('checks', [])) if isinstance(regularity_assessment.get('checks'), list) else None,
        },
        **({} if passed else {
            'displayUtilization': 'N/A',
            'category': 'input_required',
            'failureType': 'required_time_history_not_triggered',
            'governingEligible': False,
            'message': message,
        }),
    }


def _vertical_seismic_action_item(method_decision: Dict[str, Any], vertical_seismic: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not _is_true(method_decision.get('verticalSeismicRequired')):
        return None
    total_vertical_action = _number(vertical_seismic.get('totalVerticalActionKN'))
    coefficient = _number(vertical_seismic.get('coefficient'))
    if total_vertical_action is None or coefficient is None or total_vertical_action <= 0.0 or coefficient <= 0.0:
        return _check_item(
            '竖向地震作用标准值',
            demand=None,
            capacity=None,
            clause='GB/T 50011-2010(2024) 5.3',
            formula='Evk is calculated when vertical seismic action is required',
            unavailable_message='Vertical seismic action is required but no calculated vertical seismic standard value is available.',
        )
    return {
        'item': '竖向地震作用标准值',
        'status': 'pass',
        'utilization': 0.0,
        'clause': 'GB/T 50011-2010(2024) 5.3',
        'formula': 'Evk = vertical seismic coefficient * representative gravity load',
        'inputs': {
            'coefficient': round(coefficient, 8),
            'totalVerticalActionKN': round(total_vertical_action, 6),
            'method': vertical_seismic.get('method'),
        },
    }


def _vertical_seismic_member_force_item(method_decision: Dict[str, Any], vertical_seismic: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not _is_true(method_decision.get('verticalSeismicRequired')):
        return None
    static_check = _record(vertical_seismic.get('openSeesStatic'))
    member_force_count = _number(static_check.get('memberForceCount'))
    member_forces = static_check.get('memberForces')
    if member_force_count is None and isinstance(member_forces, dict):
        member_force_count = float(len(member_forces))
    if member_force_count is None or member_force_count <= 0.0:
        return _check_item(
            '竖向地震构件内力',
            demand=None,
            capacity=None,
            clause='GB/T 50011-2010(2024) 5.3',
            formula='vertical seismic action is propagated to member end forces',
            unavailable_message='Vertical seismic action was calculated but member end forces are unavailable.',
        )
    return {
        'item': '竖向地震构件内力',
        'status': 'pass',
        'utilization': 0.0,
        'clause': 'GB/T 50011-2010(2024) 5.3',
        'formula': 'OpenSees equivalent vertical static action produces member end forces',
        'inputs': {
            'memberForceCount': int(member_force_count),
            'staticStatus': static_check.get('status'),
        },
    }


def _pushover_nonlinear_estimate_item(analysis_summary: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    pushover = _record(analysis_summary.get('pushover'))
    nonlinear = _record(pushover.get('nonlinearEstimate'))
    if not nonlinear:
        return None
    performance = _record(nonlinear.get('performancePoint'))
    acceptance = _record(nonlinear.get('acceptanceCheck'))
    drift = _number(performance.get('driftRatio'))
    if drift is None:
        drift = _number(nonlinear.get('maxDriftRatio'))
    limit = _number(acceptance.get('limitDriftRatio'))
    if limit is None:
        limit = _number(nonlinear.get('acceptanceDriftRatio'))
    return _check_item(
        'Pushover弹塑性估算位移角',
        demand=drift,
        capacity=limit,
        limit=limit,
        clause='GB 55002-2021 + GB/T 50011-2010(2024)',
        formula='estimated nonlinear pushover drift ratio <= structured or advisory drift limit',
        unavailable_message='Pushover nonlinear estimate is present but its drift ratio or limit is unavailable.',
    )


def _pushover_final_compliance_item(analysis_summary: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    pushover = _record(analysis_summary.get('pushover'))
    final_compliance = _record(pushover.get('finalCompliance'))
    if not final_compliance:
        return None
    utilization = _number(final_compliance.get('utilization'))
    status = str(final_compliance.get('status') or '').strip().lower()
    drift = _number(final_compliance.get('driftRatio'))
    limit = _number(final_compliance.get('limitDriftRatio'))
    if status not in {'pass', 'fail'}:
        return _check_item(
            'Pushover最终符合性',
            demand=None,
            capacity=None,
            clause='GB 55002-2021 + GB/T 50011-2010(2024)',
            formula='pushover final compliance acceptance result is available',
            unavailable_message='Pushover final compliance result is present but does not contain a pass/fail status.',
        )
    return {
        'item': 'Pushover最终符合性',
        'status': 'pass' if status == 'pass' and (utilization is None or utilization <= 1.0) else 'fail',
        'utilization': round(float(utilization or 0.0), 4),
        'clause': 'GB 55002-2021 + GB/T 50011-2010(2024)',
        'formula': 'pushover acceptance drift ratio <= limit drift ratio',
        'inputs': {
            'demand': round(float(drift), 8) if drift is not None else None,
            'capacity': round(float(limit), 8) if limit is not None else None,
            'method': final_compliance.get('method'),
            'source': final_compliance.get('source'),
            'scope': final_compliance.get('scope'),
        },
    }


def _horizontal_seismic_member_force_item(analysis_summary: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    design_actions = _record(analysis_summary.get('seismicDesignActions'))
    if not design_actions:
        return None
    member_force_count = _number(design_actions.get('memberForceCount'))
    member_forces = design_actions.get('memberForces')
    if member_force_count is None and isinstance(member_forces, dict):
        member_force_count = float(len(member_forces))
    if member_force_count is None or member_force_count <= 0.0:
        return _check_item(
            '水平地震构件内力',
            demand=None,
            capacity=None,
            clause='GB/T 50011-2010(2024) 5.2',
            formula='response-spectrum horizontal floor actions are propagated to member end forces',
            unavailable_message='Horizontal seismic design actions are present but member end forces are unavailable.',
        )
    return {
        'item': '水平地震构件内力',
        'status': 'pass',
        'utilization': 0.0,
        'clause': 'GB/T 50011-2010(2024) 5.2',
        'formula': 'OpenSees equivalent lateral static action from response-spectrum floor forces produces member end forces',
        'inputs': {
            'memberForceCount': int(member_force_count),
            'direction': design_actions.get('direction'),
            'method': design_actions.get('method'),
        },
    }


def _member_design_action_combination_item(analysis_summary: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    combinations = _record(analysis_summary.get('memberDesignActionCombinations'))
    if not combinations:
        return None
    member_count = _number(combinations.get('memberCount'))
    case_count = _number(combinations.get('caseCount'))
    if member_count is None or case_count is None or member_count <= 0.0 or case_count <= 0.0:
        return _check_item(
            '抗震基本作用组合',
            demand=None,
            capacity=None,
            clause='GB/T 50011-2010(2024) 5.4.1',
            formula='1.2G + seismic effect factors produce member design action cases',
            unavailable_message='Seismic member design action combinations are present but have no member or case envelope.',
        )
    status = str(combinations.get('status') or '').strip().lower()
    utilization = 0.0 if status == 'computed' else 9999.0
    return {
        'item': '抗震基本作用组合',
        'status': 'pass' if status == 'computed' else 'fail',
        'utilization': utilization,
        'clause': 'GB/T 50011-2010(2024) 5.4.1',
        'formula': '1.2G + 1.3Eh and optional 1.2G + 1.3Eh + 0.5Ev / 1.2G + 0.5Eh + 1.3Ev',
        'inputs': {
            'memberCount': int(member_count),
            'caseCount': int(case_count),
            'status': combinations.get('status'),
            'controlling': combinations.get('controlling'),
        },
    }


def _member_design_action_combination_capacity_items(
    analysis_summary: Dict[str, Any],
    element_data: Dict[str, Any],
) -> List[Dict[str, Any]]:
    combinations = _record(analysis_summary.get('memberDesignActionCombinations'))
    cases = combinations.get('cases')
    if not isinstance(cases, list) or not cases:
        return []

    entries: List[Dict[str, Any]] = []
    for raw_case in cases:
        case = _record(raw_case)
        case_name = str(case.get('name') or '')
        member_actions = case.get('memberActions')
        if not isinstance(member_actions, list):
            continue
        for raw_action in member_actions:
            action = _record(raw_action)
            if not action:
                continue
            entries.append({
                **action,
                'case': case_name,
            })

    if not entries:
        return []
    return [_member_capacity_screening_item(
        item_name='抗震组合构件承载力抽查',
        force_entries=entries,
        element_data=element_data,
        clause='GB 55002-2021 + GB/T 50011-2010(2024) 5.4.1',
        formula='N/Nu + M/Mu <= 1.0 using seismic basic action combination member envelope',
        unavailable_message='Seismic combination member capacity data is unavailable for all checked members',
    )]


def _global_seismic_checks(context: Dict[str, Any]) -> List[Dict[str, Any]]:
    analysis_summary = _record(context.get('analysisSummary'))
    summary = _record(analysis_summary.get('summary'))
    envelope = _record(analysis_summary.get('envelope'))
    design_basis = _record(analysis_summary.get('designBasis'))
    method_decision = _record(analysis_summary.get('methodDecision'))
    regularity_assessment = _record(analysis_summary.get('regularityAssessment'))
    time_history = _record(analysis_summary.get('timeHistory'))
    vertical_seismic = _record(analysis_summary.get('verticalSeismic'))
    ground_motion_requirement = _record(analysis_summary.get('groundMotionRequirement'))
    element_data = _record(context.get('elementData'))

    drift = _number(summary.get('maxStoryDriftRatio'))
    if drift is None:
        drift = _number(envelope.get('maxStoryDriftRatio'))
    drift_limit_metadata = _elastic_drift_limit_metadata(design_basis)
    drift_limit = None if drift_limit_metadata is None else float(drift_limit_metadata['limit'])
    drift_formula = 'θe <= [θe]'
    if drift_limit_metadata is not None:
        drift_formula = (
            f"θe <= [θe]; {drift_limit_metadata['familyLabel']} "
            f"[θe]=1/{drift_limit_metadata['denominator']}"
        )

    drift_item = _check_item(
        '多遇地震弹性层间位移角',
        demand=drift,
        capacity=drift_limit,
        limit=drift_limit,
        clause='GB/T 50011-2010(2024) 5.5.1',
        formula=drift_formula,
        unavailable_message='Elastic story-drift ratio is unavailable or the structure family has no implemented drift limit.',
    )
    if drift_limit_metadata is not None:
        drift_item['inputs']['limitFamily'] = drift_limit_metadata['familyLabel']
        drift_item['inputs']['limitRatioText'] = f"1/{drift_limit_metadata['denominator']}"
    time_history_controlling_story = _record(time_history.get('controllingStory'))
    if time_history_controlling_story:
        drift_item['inputs']['timeHistoryControllingStory'] = time_history_controlling_story
    design_basis_item = _design_basis_completeness_item(design_basis)
    fortification_category_item = _fortification_category_item(design_basis)
    seismic_grade_item = _seismic_grade_design_basis_item(design_basis)
    gb18306_status_item = _gb18306_standard_status_item(design_basis)
    design_basis_items = [
        item for item in [design_basis_item, fortification_category_item, seismic_grade_item, gb18306_status_item]
        if item is not None
    ]
    design_basis_group = [{
        'name': '抗震设计依据完整性校核',
        'items': design_basis_items,
    }] if design_basis_items else []
    workflow_input_item = _workflow_input_mode_item(analysis_summary)
    workflow_input_group = [{
        'name': '抗震流程输入校核',
        'items': [workflow_input_item],
    }] if workflow_input_item else []
    capability_item = _capability_boundary_item(analysis_summary)
    capability_group = [{
        'name': '抗震能力边界校核',
        'items': [capability_item],
    }] if capability_item else []
    special_system_item = _special_system_review_item(analysis_summary)
    special_system_group = [{
        'name': '隔震与消能减震专门体系校核',
        'items': [special_system_item],
    }] if special_system_item else []
    over_limit_review_item = _over_limit_special_review_item(
        analysis_summary,
        design_basis,
        method_decision,
        regularity_assessment,
    )
    over_limit_review_group = [{
        'name': '超限与专项审查校核',
        'items': [over_limit_review_item],
    }] if over_limit_review_item else []
    modal_item = _modal_mass_participation_item(summary, envelope)
    modal_group = [{
        'name': '振型组合完整性校核',
        'items': [modal_item],
    }] if modal_item else []
    long_period_item = _response_spectrum_long_period_special_study_item(analysis_summary)
    long_period_group = [{
        'name': '反应谱周期范围校核',
        'items': [long_period_item],
    }] if long_period_item else []
    story_shear_item = _story_minimum_seismic_shear_coefficient_item(
        analysis_summary,
        design_basis,
        summary,
        envelope,
        regularity_assessment,
    )
    story_shear_group = [{
        'name': '楼层地震剪力系数校核',
        'items': [story_shear_item],
    }] if story_shear_item else []
    regularity_item = _regularity_time_history_trigger_item(regularity_assessment, method_decision)
    regularity_group = [{
        'name': '规则性与方法选择校核',
        'items': [regularity_item],
    }] if regularity_item else []
    vertical_item = _vertical_seismic_action_item(method_decision, vertical_seismic)
    vertical_member_item = _vertical_seismic_member_force_item(method_decision, vertical_seismic)
    vertical_group = [{
        'name': '竖向地震作用校核',
        'items': [
            item for item in [vertical_item, vertical_member_item]
            if item is not None
        ] + _vertical_member_capacity_items(vertical_seismic, element_data),
    }] if vertical_item or vertical_member_item else []
    pushover_item = _pushover_nonlinear_estimate_item(analysis_summary)
    pushover_final_item = _pushover_final_compliance_item(analysis_summary)
    pushover_group = [{
        'name': 'Pushover弹塑性估算校核',
        'items': [
            item for item in [pushover_item, pushover_final_item]
            if item is not None
        ],
    }] if pushover_item or pushover_final_item else []
    horizontal_member_item = _horizontal_seismic_member_force_item(analysis_summary)
    horizontal_member_group = [{
        'name': '水平地震作用校核',
        'items': [horizontal_member_item],
    }] if horizontal_member_item else []
    combination_item = _member_design_action_combination_item(analysis_summary)
    combination_group = [{
        'name': '抗震基本作用组合校核',
        'items': [combination_item] + _member_design_action_combination_capacity_items(analysis_summary, element_data),
    }] if combination_item else []

    records = time_history.get('records') if isinstance(time_history.get('records'), list) else []
    ratios = [
        _number(_record(record).get('baseShearRatioToResponseSpectrum'))
        for record in records
        if isinstance(record, dict)
    ]
    finite_ratios = [ratio for ratio in ratios if ratio is not None]
    base_shear_check = _record(time_history.get('baseShearCheck'))
    response_base = _number(base_shear_check.get('responseSpectrumBaseShear'))
    average_base = _number(time_history.get('averageBaseShear'))
    average_ratio = average_base / response_base if average_base is not None and response_base and response_base > 0 else None

    time_history_items: List[Dict[str, Any]] = []
    required_time_history_item = _required_time_history_item(method_decision, time_history, ground_motion_requirement)
    if required_time_history_item:
        time_history_items.append(required_time_history_item)
    elastic_plastic_final_item = _elastic_plastic_time_history_final_compliance_item(analysis_summary)
    if elastic_plastic_final_item:
        time_history_items.append(elastic_plastic_final_item)
    if time_history:
        combination_rule_item = _time_history_combination_rule_item(time_history)
        direction_trace_item = _time_history_direction_trace_item(analysis_summary)
        time_history_items.extend([
            _minimum_required_ratio_check_item(
                '单条时程基底剪力比例',
                actual_ratio=min(finite_ratios) if finite_ratios else None,
                required_ratio=0.65,
                clause='GB/T 50011-2010(2024) 5.1.2',
                formula='V_time_history_each / V_response_spectrum >= 0.65',
            ),
            _minimum_required_ratio_check_item(
                '平均时程基底剪力比例',
                actual_ratio=average_ratio,
                required_ratio=0.80,
                clause='GB/T 50011-2010(2024) 5.1.2',
                formula='mean(V_time_history) / V_response_spectrum >= 0.80',
            ),
            _actual_ground_motion_item(_record(time_history.get('groundMotionSetChecks'))),
            _ground_motion_record_count_item(time_history, _record(time_history.get('groundMotionSetChecks'))),
            *([combination_rule_item] if combination_rule_item else []),
            *([direction_trace_item] if direction_trace_item else []),
            _ground_motion_scale_factor_item(_record(time_history.get('spectrumMatch'))),
            _ground_motion_spectrum_compatibility_item(_record(time_history.get('spectrumMatch'))),
        ])

    return [
        *design_basis_group,
        *workflow_input_group,
        *capability_group,
        *special_system_group,
        *over_limit_review_group,
        *regularity_group,
        {
            'name': '整体抗震变形验算',
            'items': [drift_item],
        },
        *modal_group,
        *long_period_group,
        *story_shear_group,
        *horizontal_member_group,
        *combination_group,
        *vertical_group,
        *pushover_group,
        {
            'name': '时程分析输入与结果校核',
            'items': time_history_items,
        },
    ] if time_history_items else [
        *design_basis_group,
        *workflow_input_group,
        *capability_group,
        *special_system_group,
        *over_limit_review_group,
        *regularity_group,
        {
            'name': '整体抗震变形验算',
            'items': [drift_item],
        },
        *modal_group,
        *long_period_group,
        *story_shear_group,
        *horizontal_member_group,
        *combination_group,
        *vertical_group,
        *pushover_group,
    ]


def check_element(checker: Any, elem_id: str, context: Dict[str, Any]) -> Dict[str, Any]:
    if elem_id == GLOBAL_SEISMIC_ELEMENT_ID:
        return checker._build_element_result(
            elem_id,
            'global-seismic',
            _global_seismic_checks(context),
            GB50011_2024_CODE_VERSION,
        )

    axial_ratio_item = _frame_column_axial_compression_ratio_item(elem_id, context)
    shear_span_item = _frame_column_shear_span_ratio_item(elem_id, context)
    column_longitudinal_reinforcement_item = _frame_column_longitudinal_reinforcement_item(elem_id, context)
    column_longitudinal_detailing_item = _frame_column_longitudinal_detailing_item(elem_id, context)
    column_stirrup_detailing_item = _frame_column_stirrup_detailing_item(elem_id, context)
    column_stirrup_confined_zone_range_item = _frame_column_stirrup_confined_zone_range_item(elem_id, context)
    column_stirrup_volume_ratio_item = _frame_column_stirrup_volume_ratio_item(elem_id, context)
    joint_core_shear_capacity_item = _frame_joint_core_shear_capacity_item(elem_id, context)
    joint_strong_column_weak_beam_item = _frame_joint_strong_column_weak_beam_item(elem_id, context)
    joint_core_stirrup_detailing_item = _frame_joint_core_stirrup_detailing_item(elem_id, context)
    concrete_strength_item = _concrete_frame_member_strength_grade_item(elem_id, context)
    beam_geometry_item = _frame_beam_section_geometry_item(elem_id, context)
    beam_flat_beam_detailing_item = _frame_beam_flat_beam_detailing_item(elem_id, context)
    beam_longitudinal_reinforcement_item = _frame_beam_longitudinal_reinforcement_item(elem_id, context)
    beam_end_longitudinal_ductility_item = _frame_beam_end_longitudinal_ductility_item(elem_id, context)
    beam_through_joint_bar_diameter_item = _frame_beam_through_joint_bar_diameter_item(elem_id, context)
    beam_stirrup_detailing_item = _frame_beam_stirrup_detailing_item(elem_id, context)
    column_geometry_item = _frame_column_section_geometry_item(elem_id, context)
    shear_wall_thickness_item = _shear_wall_thickness_item(elem_id, context)
    shear_wall_axial_ratio_item = _shear_wall_axial_compression_ratio_item(elem_id, context)
    shear_wall_distributed_reinforcement_item = _shear_wall_distributed_reinforcement_item(elem_id, context)
    shear_wall_boundary_element_item = _shear_wall_boundary_element_item(elem_id, context)
    structured_member_capacity_item = _structured_seismic_combination_member_capacity_item(elem_id, context)
    steel_member_seismic_detailing_item = _steel_member_seismic_detailing_item(elem_id, context)
    strong_shear_weak_bending_item = _frame_member_strong_shear_weak_bending_item(elem_id, context)
    shear_compression_limit_item = _concrete_member_shear_compression_limit_item(elem_id, context)
    section_items = [
        checker._calc_item(elem_id, '轴压比', context, 'GB/T 50011-2010(2024) 6.3.6', 'N/(fc*A) <= ξ_lim', 1.0),
        checker._calc_item(elem_id, '剪跨比', context, 'GB/T 50011-2010(2024) 6.3.7', 'a/h0 >= 2.0', 1.0),
    ]
    if axial_ratio_item is not None:
        section_items.append(axial_ratio_item)
    if shear_span_item is not None:
        section_items.append(shear_span_item)
    if column_longitudinal_reinforcement_item is not None:
        section_items.append(column_longitudinal_reinforcement_item)
    if column_longitudinal_detailing_item is not None:
        section_items.append(column_longitudinal_detailing_item)
    if column_stirrup_detailing_item is not None:
        section_items.append(column_stirrup_detailing_item)
    if column_stirrup_confined_zone_range_item is not None:
        section_items.append(column_stirrup_confined_zone_range_item)
    if column_stirrup_volume_ratio_item is not None:
        section_items.append(column_stirrup_volume_ratio_item)
    if joint_core_shear_capacity_item is not None:
        section_items.append(joint_core_shear_capacity_item)
    if joint_strong_column_weak_beam_item is not None:
        section_items.append(joint_strong_column_weak_beam_item)
    if joint_core_stirrup_detailing_item is not None:
        section_items.append(joint_core_stirrup_detailing_item)
    if concrete_strength_item is not None:
        section_items.append(concrete_strength_item)
    if beam_geometry_item is not None:
        section_items.append(beam_geometry_item)
    if beam_flat_beam_detailing_item is not None:
        section_items.append(beam_flat_beam_detailing_item)
    if beam_longitudinal_reinforcement_item is not None:
        section_items.append(beam_longitudinal_reinforcement_item)
    if beam_end_longitudinal_ductility_item is not None:
        section_items.append(beam_end_longitudinal_ductility_item)
    if beam_through_joint_bar_diameter_item is not None:
        section_items.append(beam_through_joint_bar_diameter_item)
    if beam_stirrup_detailing_item is not None:
        section_items.append(beam_stirrup_detailing_item)
    if column_geometry_item is not None:
        section_items.append(column_geometry_item)
    if shear_wall_thickness_item is not None:
        section_items.append(shear_wall_thickness_item)
    if shear_wall_axial_ratio_item is not None:
        section_items.append(shear_wall_axial_ratio_item)
    if shear_wall_distributed_reinforcement_item is not None:
        section_items.append(shear_wall_distributed_reinforcement_item)
    if shear_wall_boundary_element_item is not None:
        section_items.append(shear_wall_boundary_element_item)
    if structured_member_capacity_item is not None:
        section_items.append(structured_member_capacity_item)
    if steel_member_seismic_detailing_item is not None:
        section_items.append(steel_member_seismic_detailing_item)
    if strong_shear_weak_bending_item is not None:
        section_items.append(strong_shear_weak_bending_item)
    if shear_compression_limit_item is not None:
        section_items.append(shear_compression_limit_item)

    checks = [
        {
            'name': '截面抗震验算',
            'items': section_items,
        },
        {
            'name': '位移验算',
            'items': [
                checker._calc_item(elem_id, '弹性层间位移角', context, 'GB/T 50011-2010(2024) 5.5.1', 'θ_e <= θ_lim', 1.0),
            ],
        },
    ]
    return checker._build_element_result(elem_id, 'column', checks, GB50011_2024_CODE_VERSION)
