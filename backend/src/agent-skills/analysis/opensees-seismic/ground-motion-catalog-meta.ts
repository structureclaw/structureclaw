export type BuiltinGroundMotionCatalogRecord = {
  id: string;
  name: string;
  recordType: 'artificial';
  dt: number;
  duration: number;
  unit: 'g';
  usableForAnalysis: true;
  description: string;
  descriptionZh: string;
};

export type CommonRecordedGroundMotionReference = {
  id: string;
  name: string;
  recordType: 'reference';
  event: string;
  year: number;
  region: string;
  station: string;
  component: string;
  magnitudeMw?: number;
  dt?: number;
  duration?: number;
  pgaG?: number;
  pgaMps2?: number;
  sourceUrl: string;
  dataAvailability: 'metadata_only';
  usableForAnalysis: false;
  description: string;
  descriptionZh: string;
};

export const BUILTIN_GROUND_MOTION_CATALOG: BuiltinGroundMotionCatalogRecord[] = [
  {
    id: 'SCGM-A1',
    name: 'StructureClaw artificial record A1',
    recordType: 'artificial',
    dt: 0.02,
    duration: 20.0,
    unit: 'g',
    usableForAnalysis: true,
    description: 'Deterministic artificial acceleration record for workflow and regression use.',
    descriptionZh: '用于流程验证和回归测试的确定性人工加速度时程。',
  },
  {
    id: 'SCGM-A2',
    name: 'StructureClaw artificial record A2',
    recordType: 'artificial',
    dt: 0.02,
    duration: 20.0,
    unit: 'g',
    usableForAnalysis: true,
    description: 'Deterministic artificial acceleration record for workflow and regression use.',
    descriptionZh: '用于流程验证和回归测试的确定性人工加速度时程。',
  },
  {
    id: 'SCGM-A3',
    name: 'StructureClaw artificial record A3',
    recordType: 'artificial',
    dt: 0.02,
    duration: 20.0,
    unit: 'g',
    usableForAnalysis: true,
    description: 'Deterministic artificial acceleration record for workflow and regression use.',
    descriptionZh: '用于流程验证和回归测试的确定性人工加速度时程。',
  },
  {
    id: 'SCGM-A4',
    name: 'StructureClaw artificial record A4',
    recordType: 'artificial',
    dt: 0.02,
    duration: 20.0,
    unit: 'g',
    usableForAnalysis: true,
    description: 'Deterministic artificial acceleration record for workflow and regression use.',
    descriptionZh: '用于流程验证和回归测试的确定性人工加速度时程。',
  },
  {
    id: 'SCGM-A5',
    name: 'StructureClaw artificial record A5',
    recordType: 'artificial',
    dt: 0.02,
    duration: 20.0,
    unit: 'g',
    usableForAnalysis: true,
    description: 'Deterministic artificial acceleration record for workflow and regression use.',
    descriptionZh: '用于流程验证和回归测试的确定性人工加速度时程。',
  },
  {
    id: 'SCGM-A6',
    name: 'StructureClaw artificial record A6',
    recordType: 'artificial',
    dt: 0.02,
    duration: 20.0,
    unit: 'g',
    usableForAnalysis: true,
    description: 'Deterministic artificial acceleration record for workflow and regression use.',
    descriptionZh: '用于流程验证和回归测试的确定性人工加速度时程。',
  },
  {
    id: 'SCGM-A7',
    name: 'StructureClaw artificial record A7',
    recordType: 'artificial',
    dt: 0.02,
    duration: 20.0,
    unit: 'g',
    usableForAnalysis: true,
    description: 'Deterministic artificial acceleration record for workflow and regression use.',
    descriptionZh: '用于流程验证和回归测试的确定性人工加速度时程。',
  },
];

export const COMMON_RECORDED_GROUND_MOTION_REFERENCES: CommonRecordedGroundMotionReference[] = [
  {
    id: 'SCGM-R1',
    name: 'El Centro 1940 Array #9',
    recordType: 'reference',
    event: 'Imperial Valley / El Centro',
    year: 1940,
    region: 'California, USA',
    station: 'El Centro Array #9 / Imperial Valley Irrigation District',
    component: 'S00E or S90W horizontal components',
    magnitudeMw: 6.9,
    dt: 0.02,
    pgaG: 0.35,
    pgaMps2: 3.417,
    sourceUrl: 'https://www.strongmotioncenter.org/vdc/scripts/event.plx?evt=88',
    dataAvailability: 'metadata_only',
    usableForAnalysis: false,
    description: 'Classic recorded motion widely used in OpenSees examples and structural dynamics benchmarks. Metadata only; upload or import a licensed record before formal analysis.',
    descriptionZh: 'OpenSees 示例和结构动力学基准中常用的经典真实记录。当前仅提供元数据；正式分析前需上传或导入授权波形。',
  },
  {
    id: 'SCGM-R2',
    name: 'Taft 1952 Lincoln School Tunnel',
    recordType: 'reference',
    event: 'Kern County / Taft',
    year: 1952,
    region: 'California, USA',
    station: 'Taft Lincoln School Tunnel',
    component: 'N21E or S69E horizontal components',
    magnitudeMw: 7.5,
    dt: 0.02,
    pgaG: 0.18,
    pgaMps2: 1.759,
    sourceUrl: 'https://www.strongmotioncenter.org/vdc/scripts/event.plx?evt=81',
    dataAvailability: 'metadata_only',
    usableForAnalysis: false,
    description: 'Classic far-field reference record used in earthquake engineering studies. Metadata only; upload or import a licensed record before formal analysis.',
    descriptionZh: '地震工程研究中常用的经典远场参考记录。当前仅提供元数据；正式分析前需上传或导入授权波形。',
  },
  {
    id: 'SCGM-R3',
    name: 'Hachinohe 1968 Tokachi-Oki',
    recordType: 'reference',
    event: 'Tokachi-Oki / Hachinohe',
    year: 1968,
    region: 'Japan',
    station: 'Hachinohe Harbor or Hachinohe City',
    component: 'horizontal component commonly cited in benchmark studies',
    magnitudeMw: 7.9,
    pgaG: 0.2294,
    sourceUrl: 'https://www.jaee.gr.jp/stack/submit-j/v10n02/gai/100202_gaiyo_english.pdf',
    dataAvailability: 'metadata_only',
    usableForAnalysis: false,
    description: 'Long-duration far-field record frequently used in high-rise and vibration-control benchmark studies. Metadata only.',
    descriptionZh: '高层结构和振动控制基准研究中常用的长持续时间远场记录。当前仅提供元数据。',
  },
  {
    id: 'SCGM-R4',
    name: 'Northridge 1994 Sylmar',
    recordType: 'reference',
    event: 'Northridge',
    year: 1994,
    region: 'California, USA',
    station: 'Sylmar County Hospital Parking Lot',
    component: '90 degree or 360 degree horizontal components',
    magnitudeMw: 6.7,
    dt: 0.02,
    pgaG: 0.843,
    pgaMps2: 8.268,
    sourceUrl: 'https://www.strongmotioncenter.org/vdc/scripts/event.plx?evt=21',
    dataAvailability: 'metadata_only',
    usableForAnalysis: false,
    description: 'Strong near-field reference record commonly used for nonlinear and control benchmarks. Metadata only.',
    descriptionZh: '非线性分析和控制基准中常用的强近场参考记录。当前仅提供元数据。',
  },
  {
    id: 'SCGM-R5',
    name: 'Kobe 1995 KJMA',
    recordType: 'reference',
    event: 'Hyogo-ken Nanbu / Kobe',
    year: 1995,
    region: 'Japan',
    station: 'KJMA',
    component: '0 or 90 degree horizontal components',
    magnitudeMw: 6.9,
    sourceUrl: 'https://www.strongmotioncenter.org/vdc/scripts/event.plx?evt=1098',
    dataAvailability: 'metadata_only',
    usableForAnalysis: false,
    description: 'Near-fault recorded motion with pulse-like characteristics often used in benchmark studies. Metadata only.',
    descriptionZh: '基准研究中常用的近断层脉冲型真实记录。当前仅提供元数据。',
  },
  {
    id: 'SCGM-R6',
    name: 'Loma Prieta 1989 Oakland Outer Harbor Wharf',
    recordType: 'reference',
    event: 'Loma Prieta',
    year: 1989,
    region: 'California, USA',
    station: 'Oakland Outer Harbor Wharf',
    component: '270 or 0 degree horizontal components',
    dt: 0.02,
    pgaG: 0.276,
    pgaMps2: 2.704,
    sourceUrl: 'https://www.eng.ucy.ac.cy/petros/Earthquakes/earthquakes.htm',
    dataAvailability: 'metadata_only',
    usableForAnalysis: false,
    description: 'Soft-soil and waterfront reference record for supplementing site-condition variety. Metadata only.',
    descriptionZh: '用于补充场地条件差异的软土/港区参考记录。当前仅提供元数据。',
  },
  {
    id: 'SCGM-R7',
    name: 'Chi-Chi 1999 TCU052 or TCU068',
    recordType: 'reference',
    event: 'Chi-Chi',
    year: 1999,
    region: 'Taiwan, China',
    station: 'TCU052 or TCU068',
    component: 'horizontal components',
    magnitudeMw: 7.6,
    sourceUrl: 'https://www.usgs.gov/publications/data-files-cwb-free-field-strong-motion-data-21-september-chi-chi-taiwan-earthquake',
    dataAvailability: 'metadata_only',
    usableForAnalysis: false,
    description: 'Modern near-fault strong-motion reference with many recorded stations; useful for long-period and pulse-sensitive checks. Metadata only.',
    descriptionZh: '包含大量台站的现代近断层强震参考记录，适合长周期和脉冲敏感问题筛选。当前仅提供元数据。',
  },
];
