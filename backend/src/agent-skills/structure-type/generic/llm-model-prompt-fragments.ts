import type { AppLocale } from '../../../services/locale.js';

const STRUCTURE_MODEL_V1_TEMPLATE = JSON.stringify({
  schema_version: '1.0.0',
  unit_system: 'SI',
  nodes: [
    {
      id: 'N1',
      x: 0,
      y: 0,
      z: 0,
      restraints: [true, true, true, false, false, false],
    },
    {
      id: 'N2',
      x: 10,
      y: 0,
      z: 0,
    },
  ],
  elements: [
    {
      id: 'E1',
      type: 'beam',
      nodes: ['N1', 'N2'],
      material: 'MAT1',
      section: 'SEC1',
    },
  ],
  materials: [
    {
      id: 'MAT1',
      name: 'Steel_Q235',
      E: 206000,
      nu: 0.3,
      rho: 7850,
      fy: 235,
    },
  ],
  sections: [
    {
      id: 'SEC1',
      name: 'Rect_200x400',
      type: 'rectangular',
      properties: {
        width: 0.2,
        height: 0.4,
        A: 0.08,
        Iy: 0.000266667,
        Iz: 0.001066667,
      },
    },
  ],
  load_cases: [
    {
      id: 'LC1',
      type: 'other',
      loads: [
        {
          type: 'nodal_force',
          node: 'N2',
          fx: 0,
          fy: -10,
          fz: 0,
          mx: 0,
          my: 0,
          mz: 0,
        },
        {
          type: 'distributed',
          element: 'E1',
          wx: 0,
          wy: -10000,
          wz: 0,
        },
      ],
    },
  ],
  load_combinations: [
    {
      id: 'COMB1',
      factors: {
        LC1: 1.0,
      },
    },
  ],
}, null, 2);

const COMMON_CONSTRAINTS_EN = [
  'Use strict StructureModel v1 fields. At minimum include: schema_version, unit_system, nodes, elements, materials, sections, load_cases, load_combinations.',
  'Node fields must be id, x, y, z, restraints(optional). Do not use coordinates or boundary_conditions.',
  'Element fields must be id, type, nodes, material, section. Do not use material_id or section_id.',
  'Material fields must be id, name, E, nu, rho, fy(optional). Do not use elastic_modulus, poisson_ratio, density, or yield_strength.',
  'Section fields must include id, name, type, and properties.',
  'Load case fields must include id, type, and loads.',
  'Load case type must be one of dead, live, wind, seismic, other.',
  'Nodal load example: {"type":"nodal_force","node":"N2","fx":0,"fy":-10,"fz":0,"mx":0,"my":0,"mz":0}.',
  'Element distributed load example: {"type":"distributed","element":"E1","wy":-10000,"wz":0}.',
  'For partial-span distributed loads, do not place start/end fields inside a single element. Split the member into multiple elements and assign distributed load only to the target element(s).',
  'Do not use line_load, element_uniform_load, element_distributed_load, or uniform_load as element distributed load type names.',
  'Load combination entries must be { id, factors } where factors maps load_case_id to factor. Do not use a combinations array.',
  'schema_version must be "1.0.0".',
];

const COMMON_CONSTRAINTS_ZH = [
  '必须使用 StructureModel v1 字段，至少包含: schema_version, unit_system, nodes, elements, materials, sections, load_cases, load_combinations。',
  '节点字段必须是 id, x, y, z, restraints(可选)。不要使用 coordinates 或 boundary_conditions。',
  '单元字段必须是 id, type, nodes, material, section。不要使用 material_id 或 section_id。',
  '材料字段必须是 id, name, E, nu, rho, fy(可选)。不要使用 elastic_modulus、poisson_ratio、density、yield_strength。',
  '截面字段必须有 id, name, type, properties。',
  '工况字段必须包含 id, type, loads。',
  '工况 type 只能是 dead、live、wind、seismic、other 之一。',
  '节点荷载推荐示例：{"type":"nodal_force","node":"N2","fx":0,"fy":-10,"fz":0,"mx":0,"my":0,"mz":0}。',
  '单元均布荷载推荐示例：{"type":"distributed","element":"E1","wy":-10000,"wz":0}。',
  '局部范围均布荷载不要在单个单元内部写起止位置，应通过拆分单元后，仅对目标单元施加 distributed 荷载来表达。',
  '不要使用 line_load、element_uniform_load、element_distributed_load、uniform_load 等其他单元均布荷载类型名。',
  '荷载组合字段必须是 { id, factors }，其中 factors 是 load_case_id 到系数的映射。不要使用 combinations 数组。',
  'schema_version 固定写为 "1.0.0"。',
];

export function getStructureModelTemplate(): string {
  return STRUCTURE_MODEL_V1_TEMPLATE;
}

export function getCommonConstraints(locale: AppLocale): string[] {
  return locale === 'zh' ? COMMON_CONSTRAINTS_ZH : COMMON_CONSTRAINTS_EN;
}
