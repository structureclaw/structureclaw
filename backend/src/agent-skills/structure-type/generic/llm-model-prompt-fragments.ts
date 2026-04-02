import type { AppLocale } from '../../../services/locale.js';

const STRUCTURE_MODEL_V1_TEMPLATE = JSON.stringify({
  schema_version: '1.0.0',
  unit_system: 'SI',
  nodes: [
    { id: 'N1', x: 0, y: 0, z: 0, restraints: [true, true, true, false, false, false] },
    { id: 'N2', x: 10, y: 0, z: 0 },
  ],
  elements: [
    { id: 'E1', type: 'beam', nodes: ['N1', 'N2'], material: 'MAT1', section: 'SEC1' },
  ],
  materials: [
    { id: 'MAT1', name: 'Steel_Q235', E: 206000, nu: 0.3, rho: 7850, fy: 235 },
  ],
  sections: [
    { id: 'SEC1', name: 'Rect_200x400', type: 'rectangular', properties: { width: 0.2, height: 0.4, A: 0.08, Iy: 2.67e-4, Iz: 1.07e-3 } },
  ],
  load_cases: [
    { id: 'LC1', type: 'other', loads: [
      { type: 'nodal_force', node: 'N2', fx: 0, fy: -10, fz: 0, mx: 0, my: 0, mz: 0 },
      { type: 'distributed', element: 'E1', wx: 0, wy: -10000, wz: 0 },
    ] },
  ],
  load_combinations: [
    { id: 'COMB1', factors: { LC1: 1.0 } },
  ],
});

const COMMON_CONSTRAINTS_EN = [
  'Output only the fields shown in the template. load_case.type must be dead, live, wind, seismic, or other.',
  'Prohibited alternate field names: material_id->material, section_id->section, coordinates->x/y/z, boundary_conditions->restraints, elastic_modulus->E, poisson_ratio->nu, density->rho, yield_strength->fy.',
  'For partial-span distributed loads, split the member into separate elements. Only use nodal_force and distributed as load types; do not use line_load, element_uniform_load, or uniform_load.',
];

const COMMON_CONSTRAINTS_ZH = [
  '严格输出模板中的字段和层级。load_case.type 只能是 dead/live/wind/seismic/other。',
  '禁止替代字段名：material_id->material, section_id->section, coordinates->x/y/z, boundary_conditions->restraints, elastic_modulus->E, poisson_ratio->nu, density->rho, yield_strength->fy。',
  '局部均布荷载不要在单元内设起止位置，应拆分单元后对目标单元施加 distributed 荷载。不要使用 line_load/element_uniform_load/uniform_load 等类型名。',
];

export function getStructureModelTemplate(): string {
  return STRUCTURE_MODEL_V1_TEMPLATE;
}

export function getCommonConstraints(locale: AppLocale): string[] {
  return locale === 'zh' ? COMMON_CONSTRAINTS_ZH : COMMON_CONSTRAINTS_EN;
}
