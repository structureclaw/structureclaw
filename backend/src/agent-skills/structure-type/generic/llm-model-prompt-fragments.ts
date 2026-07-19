import type { AppLocale } from '../../../services/locale.js';

const STRUCTURE_MODEL_V2_TEMPLATE = JSON.stringify({
  schema_version: '2.0.0',
  unit_system: 'SI',
  coordinate_system: {
    semantics: 'global-z-up',
    version: 1,
    dimension: '2d',
    plane: 'xz',
    dof_order: ['ux', 'uy', 'uz', 'rx', 'ry', 'rz'],
  },
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
      { type: 'nodal', node: 'N2', fx: 0, fy: 0, fz: -10, mx: 0, my: 0, mz: 0 },
      { type: 'distributed', element: 'E1', wx: 0, wy: 0, wz: -10 },
    ] },
  ],
  load_combinations: [
    { id: 'COMB1', factors: { LC1: 1.0 } },
  ],
});

const COMMON_CONSTRAINTS_EN = [
  'Output StructureModel V2 with schema_version exactly "2.0.0" and unit_system exactly "SI".',
  'Always output the complete coordinate_system object. Use dimension="2d" and plane="xz" for a 2D model; use dimension="3d" and plane=null for a 3D model. Never infer or omit this declaration.',
  'Use global-z-up coordinates: x is the main horizontal span, z is vertical height, and y is the out-of-plane direction. Put 2D structures in the x-z plane with y=0.',
  'Node restraints must contain exactly six booleans in [ux,uy,uz,rx,ry,rz] order, where true means restrained and false means free. A simply-supported X-Z beam uses a pinned left support [true,true,true,false,false,false] and an X-direction roller at the right support [false,true,true,false,false,false].',
  'All lengths are meters, point forces are kN, and distributed member loads are kN/m. Never output N or N/m values and never multiply kN values by 1000.',
  'Output only the fields shown in the template. load_case.type must be dead, live, wind, seismic, or other.',
  'Prohibited alternate field names: material_id->material, section_id->section, coordinates->x/y/z, boundary_conditions->restraints, elastic_modulus->E, poisson_ratio->nu, density->rho, yield_strength->fy.',
  'Create explicit nodes at supports, concentrated loads, span boundaries, member intersections, and geometry break points so analysis result locations are computable.',
  'Before output, check the total applied load against the user request. Do not apply the same physical load twice as both nodal and distributed loads.',
  'For partial-span distributed loads, split the member into separate elements. Only use nodal and distributed as load types; do not use nodal_force, line_load, element_uniform_load, or uniform_load.',
  'If confirmed parameters contain seismicMemberEvidence or seismicWorkflow.memberEvidence, attach the provided structured member evidence to the matching element as element fields, metadata, or extra using keys such as seismicCapacity, capacityDesign, strongShearWeakBending, shearCompression, jointCore, wallData, boundaryElement, or steelSeismicDetailing; do not summarize it as prose and do not decide code-check pass/fail.',
];

const COMMON_CONSTRAINTS_ZH = [
  '输出 StructureModel V2，schema_version 必须是 "2.0.0"，unit_system 必须是 "SI"。',
  '必须完整输出 coordinate_system。二维模型使用 dimension="2d"、plane="xz"；三维模型使用 dimension="3d"、plane=null。不得省略该声明或留给下游推断。',
  '使用 global-z-up 坐标：x 为主要水平跨度，z 为竖向高度，y 为平面外方向。二维结构应位于 x-z 平面，y=0。',
  '节点 restraints 必须严格包含 6 个布尔值，顺序为 [ux,uy,uz,rx,ry,rz]；true 表示约束，false 表示自由。X-Z 平面简支梁左端使用铰支座 [true,true,true,false,false,false]，右端使用沿 X 方向滚动的支座 [false,true,true,false,false,false]。',
  '所有长度使用 m，集中力使用 kN，构件均布荷载使用 kN/m。不要输出 N 或 N/m，也不要把 kN 数值乘以 1000。',
  '严格输出模板中的字段和层级。load_case.type 只能是 dead/live/wind/seismic/other。',
  '禁止替代字段名：material_id->material, section_id->section, coordinates->x/y/z, boundary_conditions->restraints, elastic_modulus->E, poisson_ratio->nu, density->rho, yield_strength->fy。',
  '在支座、集中荷载、跨界、构件交点和几何转折处建立显式节点，保证分析结果位置可计算。',
  '输出前核对总施加荷载与用户描述是否一致。不要把同一个物理荷载同时作为节点荷载和构件均布荷载重复施加。',
  '局部均布荷载不要在单元内设起止位置，应拆分单元后对目标单元施加 distributed 荷载。只使用 nodal 和 distributed，不要使用 nodal_force/line_load/element_uniform_load/uniform_load 等类型名。',
  '如果已确认参数包含 seismicMemberEvidence 或 seismicWorkflow.memberEvidence，必须把已提供的构件抗震证据挂到匹配 element 的字段、metadata 或 extra 中，并保留 seismicCapacity、capacityDesign、strongShearWeakBending、shearCompression、jointCore、wallData、boundaryElement、steelSeismicDetailing 等结构化键；不要写成自然语言备注，也不要由 LLM 判断条文通过或失败。',
];

export function getStructureModelTemplate(): string {
  return STRUCTURE_MODEL_V2_TEMPLATE;
}

export function getCommonConstraints(locale: AppLocale): string[] {
  return locale === 'zh' ? COMMON_CONSTRAINTS_ZH : COMMON_CONSTRAINTS_EN;
}
