// ============================================================================
// 荷载与边界条件类型定义
// 对齐 V2 Schema (structure_model_v2.py)
// 对应 #48 Issue：feat(skills): define load and boundary condition skills
// ============================================================================

// ============================================================================
// 荷载工况接口 - 与 V2 Schema (structure_model_v2.py LoadCaseV2) 对齐
// ============================================================================

export interface LoadCase {
  id: string;                    // 荷载工况ID (对齐 V2 Schema)
  type: LoadCaseTypeEnum;         // 荷载类型 (对齐 V2 Schema)
  loads?: LoadAction[];           // 荷载动作列表 (对齐 V2 Schema)
  description?: string;           // 描述 (对齐 V2 Schema)
  extra?: Record<string, any>;    // 扩展字段 (对齐 V2 Schema)
}

// ============================================================================
// 荷载动作接口 - V2 Schema 使用 Dict[str, Any]，此处定义具体结构
// ============================================================================

export interface LoadAction {
  id?: string;                    // 动作ID (可选，V2 Schema 允许任意字段)
  caseId?: string;                // 所属工况ID (可选，V2 Schema 允许任意字段)
  elementType?: LoadElementTypeEnum; // 单元类型 (可选，V2 Schema 允许任意字段)
  elementId?: string;             // 单元ID (可选，V2 Schema 允许任意字段)
  loadType?: LoadTypeEnum;        // 荷载类型 (可选，V2 Schema 允许任意字段)
  loadValue?: number;             // 荷载值 (可选，V2 Schema 允许任意字段)
  loadDirection?: Vector3D;       // 荷载方向向量 (可选，V2 Schema 允许任意字段)
  position?: Vector3D;            // 作用位置 (可选，V2 Schema 允许任意字段)
  extra?: Record<string, any>;     // 扩展字段 (对齐 V2 Schema)
}

// ============================================================================
// 节点约束接口 - V2 Schema 使用 restraints: List[bool]，此处提供扩展定义
// ============================================================================

export interface NodalConstraint {
  nodeId: string;                // 节点ID
  constraintType?: NodalConstraintTypeEnum; // 约束类型 (可选，V2 Schema 未定义)
  restraints?: [boolean, boolean, boolean, boolean, boolean, boolean]; // 对齐 V2 Schema: [ux, uy, uz, rx, ry, rz]
  restrainedDOFs?: DOFSet;       // 约束的自由度 (可选，与 V2 Schema 格式不同)
  stiffness?: Matrix6x6;         // 弹簧刚度矩阵 (可选，V2 Schema 允许任意字段)
  extra?: Record<string, any>;    // 扩展字段 (对齐 V2 Schema)
}

// ============================================================================
// 杆端释放接口 - V2 Schema 使用 releases: Dict[str, Any]，此处提供扩展定义
// ============================================================================

export interface MemberEndRelease {
  memberId: string;              // 杆件ID
  releaseI?: DOFSet;             // I端释放 (可选，V2 Schema 允许任意字段)
  releaseJ?: DOFSet;             // J端释放 (可选，V2 Schema 允许任意字段)
  springStiffnessI?: Vector6D;   // I端弹簧刚度 (可选，V2 Schema 允许任意字段)
  springStiffnessJ?: Vector6D;   // J端弹簧刚度 (可选，V2 Schema 允许任意字段)
  extra?: Record<string, any>;    // 扩展字段 (对齐 V2 Schema)
}

// ============================================================================
// 计算长度接口 - V2 Schema 未定义，此处提供扩展定义
// ============================================================================

export interface EffectiveLength {
  memberId: string;              // 杆件ID
  direction?: AxisDirectionEnum; // 方向 (可选)
  calcLength?: number;           // 几何长度 (可选)
  lengthFactor?: number;         // 长度系数 (可选)
  effectiveLength?: number;      // 计算长度 (可选)
  extra?: Record<string, any>;    // 扩展字段 (对齐 V2 Schema)
}

// ============================================================================
// 荷载与边界条件相关类型定义
// 对齐 V2 Schema (structure_model_v2.py)
// 对应 #48 Issue：feat(skills): define load and boundary condition skills
// ============================================================================

// 荷载工况类型枚举 - 完全对齐 V2 Schema LoadCaseV2.type
export enum LoadCaseTypeEnum {
  DEAD = 'dead',              // 恒载 (对齐 V2 Schema)
  LIVE = 'live',              // 活载 (对齐 V2 Schema)
  WIND = 'wind',              // 风载 (对齐 V2 Schema)
  SEISMIC = 'seismic',        // 地震 (对齐 V2 Schema)
  TEMPERATURE = 'temperature', // 温度 (对齐 V2 Schema)
  SETTLEMENT = 'settlement',  // 沉降 (对齐 V2 Schema)
  CRANE = 'crane',            // 吊车 (对齐 V2 Schema)
  SNOW = 'snow',              // 雪 (对齐 V2 Schema)
  OTHER = 'other',            // 其他 (对齐 V2 Schema)
}

// 荷载动作类型枚举
export enum LoadTypeEnum {
  POINT_FORCE = 'point_force',         // 集中力
  DISTRIBUTED_LOAD = 'distributed_load', // 均布荷载
  MOMENT = 'moment',                 // 弯矩
  TORQUE = 'torque',               // 扭矩
  AXIAL_FORCE = 'axial_force',     // 轴向力
}

// 作用元素类型枚举
export enum LoadElementTypeEnum {
  NODE = 'node',
  BEAM = 'beam',
  COLUMN = 'column',
  WALL = 'wall',
  SLAB = 'slab'
}

// 节点约束类型枚举
export enum NodalConstraintTypeEnum {
  FIXED = 'fixed',           // 固定支座
  PINNED = 'pinned',       // 铰支座
  SLIDING = 'sliding',      // 滑动支座
  ELASTIC = 'elastic',        // 弹性支座（预留，待 #39 Schema 确认）
}

// 自由度集合类型
export interface DOFSet {
  uX: boolean;  // X 轴平动位移
  uY: boolean;  // Y 轴平动位移
  uZ: boolean;  // Z 轴平动位移
  rotX: boolean;  // X 轴转角位移
  rotY: boolean;  // Y 轴转角位移
  rotZ: boolean;  // Z 轴转角位移
}

// V2 Schema 格式的 DOF 约束 - 对齐 NodeV2.restraints: List[bool]
export type RestraintDOF = [boolean, boolean, boolean, boolean, boolean, boolean];
// 格式: [ux, uy, uz, rx, ry, rz]
// True = 约束, False = 自由

// ============================================================================
// 刚度矩阵类型定义 - 理论完整性与工程实践性的平衡
// ============================================================================

// ============================================================================
// 【理论完整型】完整6x6刚度矩阵接口（显式字段定义）
// 用途：复杂耦合场景、需要类型提示的开发、精确控制所有刚度项
// 建议：对于大多数场景，使用 Matrix6x6 (数组形式) 更简洁高效
// 转换：StiffnessMatrixUtils 可在接口和数组形式之间转换
// ============================================================================
export interface Matrix6x6 {
  // 行1: X方向力对各自由度的刚度
  Fx_ux: number;  // X力对X位移
  Fx_uy: number;  // X力对Y位移
  Fx_uz: number;  // X力对Z位移
  Fx_rx: number;  // X力对绕X转动
  Fx_ry: number;  // X力对绕Y转动
  Fx_rz: number;  // X力对绕Z转动

  // 行2: Y方向力对各自由度的刚度
  Fy_ux: number;  // Y力对X位移
  Fy_uy: number;  // Y力对Y位移
  Fy_uz: number;  // Y力对Z位移
  Fy_rx: number;  // Y力对绕X转动
  Fy_ry: number;  // Y力对绕Y转动
  Fy_rz: number;  // Y力对绕Z转动

  // 行3: Z方向力对各自由度的刚度
  Fz_ux: number;  // Z力对X位移
  Fz_uy: number;  // Z力对Y位移
  Fz_uz: number;  // Z力对Z位移
  Fz_rx: number;  // Z力对绕X转动
  Fz_ry: number;  // Z力对绕Y转动
  Fz_rz: number;  // Z力对绕Z转动

  // 行4: 绕X力矩对各自由度的刚度
  Mx_ux: number;  // X力矩对X位移
  Mx_uy: number;  // X力矩对Y位移
  Mx_uz: number;  // X力矩对Z位移
  Mx_rx: number;  // X力矩对绕X转动
  Mx_ry: number;  // X力矩对绕Y转动
  Mx_rz: number;  // X力矩对绕Z转动

  // 行5: 绕Y力矩对各自由度的刚度
  My_ux: number;  // Y力矩对X位移
  My_uy: number;  // Y力矩对Y位移
  My_uz: number;  // Y力矩对Z位移
  My_rx: number;  // Y力矩对绕X转动
  My_ry: number;  // Y力矩对绕Y转动
  My_rz: number;  // Y力矩对绕Z转动

  // 行6: 绕Z力矩对各自由度的刚度
  Mz_ux: number;  // Z力矩对X位移
  Mz_uy: number;  // Z力矩对Y位移
  Mz_uz: number;  // Z力矩对Z位移
  Mz_rx: number;  // Z力矩对绕X转动
  Mz_ry: number;  // Z力矩对绕Y转动
  Mz_rz: number;  // Z力矩对绕Z转动
}

// 完整6x6矩阵的数组表示（优先使用，更简洁）
// 推荐：使用数组形式进行矩阵运算和传递，性能更好且更易维护
export type Matrix6x6Array = number[][];

// ============================================================================
// 【工程优化型】优先使用的简化刚度矩阵接口
// 用途：95%的工程场景，简化输入，提高效率
// 优势：自动转换、类型安全、易于理解
// ============================================================================

// 工程简化1：对角刚度矩阵（80%常见场景）
// 适用：普通框架节点、基础节点、简单支撑
export interface DiagonalStiffness {
  kx?: number;   // X方向平动刚度
  ky?: number;   // Y方向平动刚度
  kz?: number;   // Z方向平动刚度
  krx?: number;  // X方向转动刚度
  kry?: number;  // Y方向转动刚度
  krz?: number;  // Z方向转动刚度
}

// 工程简化2：分块对角刚度矩阵（15%中等复杂场景）
// 适用：考虑XY平面耦合的节点、隔震支座、特殊支撑
export interface BlockDiagonalStiffness {
  // 平动块（3x3，可能耦合）
  kxx?: number;  kxy?: number;  kxz?: number;
  kyx?: number;  kyy?: number;  kyz?: number;
  kzx?: number;  kzy?: number;  kzz?: number;
  // 转动块（3x3，通常对角）
  krx?: number;  kry?: number;  krz?: number;
}

// ============================================================================
// 统一输入接口 - 支持所有刚度表示形式
// ============================================================================
export type StiffnessInput = Matrix6x6 | Matrix6x6Array | DiagonalStiffness | BlockDiagonalStiffness;

// ============================================================================
// 约束类型枚举
// ============================================================================
export type ConstraintType =
  | 'FIXED'      // 固定约束（所有自由度）
  | 'HINGE'      // 铰接约束（仅平动）
  | 'ROLLER'     // 滚动约束（部分平动）
  | 'ELASTIC'    // 弹性约束（指定刚度）
  | 'ISOLATOR'   // 隔震支座（特殊刚度分布）
  | 'CUSTOM';    // 自定义约束

// ============================================================================
// 刚度矩阵工具类 - 工程优化与理论完整性的桥梁
// ============================================================================
export class StiffnessMatrixUtils {
  /**
   * 将任意输入转换为标准6x6数组矩阵（理论完整型）
   * @param input 刚度输入（支持所有类型）
   * @returns 标准6x6数组矩阵
   */
  static toStandardMatrix(input: StiffnessInput): Matrix6x6Array {
    if (this.isMatrix6x6Array(input)) {
      // 已是数组形式，直接返回
      return input;
    } else if (this.isMatrix6x6(input)) {
      // 接口形式转数组形式
      return this.interfaceToArray(input);
    } else if (this.isDiagonalStiffness(input)) {
      // 对角刚度转完整矩阵
      return this.createDiagonalMatrix(input);
    } else if (this.isBlockDiagonalStiffness(input)) {
      // 分块对角转完整矩阵
      return this.createBlockDiagonalMatrix(input);
    }
    throw new Error('Invalid stiffness input type');
  }

  /**
   * 接口形式转数组形式（理论完整型之间的转换）
   * @param matrix 接口形式的6x6矩阵
   * @returns 数组形式的6x6矩阵
   */
  static interfaceToArray(matrix: Matrix6x6): Matrix6x6Array {
    return [
      [matrix.Fx_ux, matrix.Fx_uy, matrix.Fx_uz, matrix.Fx_rx, matrix.Fx_ry, matrix.Fx_rz],
      [matrix.Fy_ux, matrix.Fy_uy, matrix.Fy_uz, matrix.Fy_rx, matrix.Fy_ry, matrix.Fy_rz],
      [matrix.Fz_ux, matrix.Fz_uy, matrix.Fz_uz, matrix.Fz_rx, matrix.Fz_ry, matrix.Fz_rz],
      [matrix.Mx_ux, matrix.Mx_uy, matrix.Mx_uz, matrix.Mx_rx, matrix.Mx_ry, matrix.Mx_rz],
      [matrix.My_ux, matrix.My_uy, matrix.My_uz, matrix.My_rx, matrix.My_ry, matrix.My_rz],
      [matrix.Mz_ux, matrix.Mz_uy, matrix.Mz_uz, matrix.Mz_rx, matrix.Mz_ry, matrix.Mz_rz]
    ];
  }

  /**
   * 数组形式转接口形式（理论完整型之间的转换）
   * @param array 数组形式的6x6矩阵
   * @returns 接口形式的6x6矩阵
   */
  static arrayToInterface(array: Matrix6x6Array): Matrix6x6 {
    return {
      Fx_ux: array[0][0], Fx_uy: array[0][1], Fx_uz: array[0][2], Fx_rx: array[0][3], Fx_ry: array[0][4], Fx_rz: array[0][5],
      Fy_ux: array[1][0], Fy_uy: array[1][1], Fy_uz: array[1][2], Fy_rx: array[1][3], Fy_ry: array[1][4], Fy_rz: array[1][5],
      Fz_ux: array[2][0], Fz_uy: array[2][1], Fz_uz: array[2][2], Fz_rx: array[2][3], Fz_ry: array[2][4], Fz_rz: array[2][5],
      Mx_ux: array[3][0], Mx_uy: array[3][1], Mx_uz: array[3][2], Mx_rx: array[3][3], Mx_ry: array[3][4], Mx_rz: array[3][5],
      My_ux: array[4][0], My_uy: array[4][1], My_uz: array[4][2], My_rx: array[4][3], My_ry: array[4][4], My_rz: array[4][5],
      Mz_ux: array[5][0], Mz_uy: array[5][1], Mz_uz: array[5][2], Mz_rx: array[5][3], Mz_ry: array[5][4], Mz_rz: array[5][5]
    };
  }

  /**
   * 创建对角刚度矩阵（工程优化型）
   * @param diag 对角刚度值
   * @returns 6x6对角矩阵（数组形式）
   */
  static createDiagonalMatrix(diag: DiagonalStiffness): Matrix6x6Array {
    const matrix: Matrix6x6Array = Array(6).fill(0).map(() => Array(6).fill(0));
    const values = [
      diag.kx ?? 0, diag.ky ?? 0, diag.kz ?? 0,
      diag.krx ?? 0, diag.kry ?? 0, diag.krz ?? 0
    ];

    for (let i = 0; i < 6; i++) {
      matrix[i][i] = values[i];
    }
    return matrix;
  }

  /**
   * 创建分块对角刚度矩阵（工程优化型）
   * @param blockDiag 分块对角刚度值
   * @returns 6x6分块对角矩阵（数组形式）
   */
  static createBlockDiagonalMatrix(blockDiag: BlockDiagonalStiffness): Matrix6x6Array {
    const matrix: Matrix6x6Array = Array(6).fill(0).map(() => Array(6).fill(0));

    // 平动块（3x3）
    matrix[0][0] = blockDiag.kxx ?? 0; matrix[0][1] = blockDiag.kxy ?? 0; matrix[0][2] = blockDiag.kxz ?? 0;
    matrix[1][0] = blockDiag.kyx ?? 0; matrix[1][1] = blockDiag.kyy ?? 0; matrix[1][2] = blockDiag.kyz ?? 0;
    matrix[2][0] = blockDiag.kzx ?? 0; matrix[2][1] = blockDiag.kzy ?? 0; matrix[2][2] = blockDiag.kzz ?? 0;

    // 转动块（3x3对角）
    matrix[3][3] = blockDiag.krx ?? 0;
    matrix[4][4] = blockDiag.kry ?? 0;
    matrix[5][5] = blockDiag.krz ?? 0;

    return matrix;
  }

  /**
   * 判断是否为6x6数组矩阵
   */
  private static isMatrix6x6Array(input: any): input is Matrix6x6Array {
    return Array.isArray(input) && input.length === 6 &&
           input.every(row => Array.isArray(row) && row.length === 6);
  }

  /**
   * 判断是否为接口形式的6x6矩阵
   */
  private static isMatrix6x6(input: any): input is Matrix6x6 {
    if (typeof input !== 'object' || input === null) {
      return false;
    }

    // 检查所有必需字段（每个力/力矩行至少一个字段，加上首尾字段作为边界检查）
    const requiredFields = [
      'Fx_ux', 'Fx_uy', 'Fx_uz', 'Fx_rx', 'Fx_ry', 'Fx_rz',
      'Fy_ux', 'Fy_uy', 'Fy_uz', 'Fy_rx', 'Fy_ry', 'Fy_rz',
      'Fz_ux', 'Fz_uy', 'Fz_uz', 'Fz_rx', 'Fz_ry', 'Fz_rz',
      'Mx_ux', 'Mx_uy', 'Mx_uz', 'Mx_rx', 'Mx_ry', 'Mx_rz',
      'My_ux', 'My_uy', 'My_uz', 'My_rx', 'My_ry', 'My_rz',
      'Mz_ux', 'Mz_uy', 'Mz_uz', 'Mz_rx', 'Mz_ry', 'Mz_rz'
    ];

    return requiredFields.every(field => field in input);
  }

  /**
   * 判断是否为对角刚度
   */
  private static isDiagonalStiffness(input: any): input is DiagonalStiffness {
    return typeof input === 'object' && input !== null &&
           ('kx' in input || 'ky' in input || 'kz' in input ||
            'krx' in input || 'kry' in input || 'krz' in input);
  }

  /**
   * 判断是否为分块对角刚度
   */
  private static isBlockDiagonalStiffness(input: any): input is BlockDiagonalStiffness {
    return typeof input === 'object' && input !== null &&
           ('kxx' in input || 'kyy' in input || 'kzz' in input);
  }

  /**
   * 判断刚度矩阵是否为刚性（固定约束）
   * @param matrix 刚度矩阵
   * @param threshold 刚性阈值（默认1e15）
   * @returns 是否为刚性约束
   */
  static isRigidMatrix(matrix: Matrix6x6Array, threshold: number = 1e15): boolean {
    // 检查所有对角元素是否大于阈值
    for (let i = 0; i < 6; i++) {
      if (matrix[i][i] < threshold) {
        return false;
      }
    }
    return true;
  }

  /**
   * 验证刚度矩阵的有效性
   * @param matrix 刚度矩阵
   * @returns 是否有效
   */
  static validateMatrix(matrix: Matrix6x6Array): boolean {
    if (!Array.isArray(matrix) || matrix.length !== 6) {
      return false;
    }
    for (let i = 0; i < 6; i++) {
      if (!Array.isArray(matrix[i]) || matrix[i].length !== 6) {
        return false;
      }
    }
    return true;
  }
}

// ============================================================================
// 刚度常量
// ============================================================================

/**
 * 刚度常量配置 / Stiffness Constants Configuration
 *
 * 这些常量用于定义不同类型约束的刚度值。
 * 刚度值应根据单位制（如 kN/m）和求解器数值精度进行适当调整。
 *
 * 注意：过大或过小的刚度值都可能导致数值不稳定。
 * 建议值范围：1e12 ~ 1e15（对于 kN/m 单位制）
 */
export const StiffnessConstants = {
  /**
   * 刚性刚度值 - 用于模拟"无穷大"刚度
   * 默认值：1e15 kN/m
   *
   * 注意：
   * - 过大（如 1e20）可能导致数值溢出或求解失败
   * - 过小（如 1e10）可能导致约束不够刚性
   * - 不同求解器可能有不同的数值精度限制
   *
   * @default 1e15
   */
  RIGID: 1e15,

  /**
   * 半刚性刚度值 - 用于模拟半刚性连接
   * 默认值：1e12 kN/m
   *
   * @default 1e12
   */
  SEMI_RIGID: 1e12,

  /**
   * 弹性刚度值 - 用于模拟弹性支座或柔性连接
   * 默认值：1e6 kN/m
   *
   * @default 1e6
   */
  ELASTIC: 1e6,

  /**
   * 柔性刚度值 - 用于模拟非常柔的约束
   * 默认值：1e3 kN/m
   *
   * @default 1e3
   */
  FLEXIBLE: 1e3,
} as const;

// ============================================================================
// 预定义约束模板
// ============================================================================

export const ConstraintPresets = {
  /**
   * 固定约束 - 所有自由度完全固定
   * @param largeNumber 刚性刚度值（默认使用 StiffnessConstants.RIGID）
   *
   * 注意：可自定义刚度值以适应不同的工程场景和求解器精度。
   * 推荐使用 StiffnessConstants.RIGID 或其附近值（1e14 ~ 1e15）。
   */
  FIXED: (largeNumber: number = StiffnessConstants.RIGID): Matrix6x6Array => [
    [largeNumber, 0, 0, 0, 0, 0],
    [0, largeNumber, 0, 0, 0, 0],
    [0, 0, largeNumber, 0, 0, 0],
    [0, 0, 0, largeNumber, 0, 0],
    [0, 0, 0, 0, largeNumber, 0],
    [0, 0, 0, 0, 0, largeNumber]
  ],

  /**
   * 铰接约束 - 仅约束平动，转动自由
   * @param k 平动刚度值（默认1e6）
   */
  HINGE: (k: number = StiffnessConstants.ELASTIC): Matrix6x6Array => [
    [k, 0, 0, 0, 0, 0],
    [0, k, 0, 0, 0, 0],
    [0, 0, k, 0, 0, 0],
    [0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0]
  ],

  /**
   * 滚动约束 - 仅约束部分平动（X方向）
   * @param k 平动刚度值（默认1e6）
   */
  ROLLER: (k: number = StiffnessConstants.ELASTIC): Matrix6x6Array => [
    [k, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0]
  ],

  /**
   * 弹性约束 - 指定各自由度刚度
   */
  ELASTIC: (kx: number, ky: number, kz: number,
            krx: number, kry: number, krz: number): Matrix6x6Array => [
    [kx, 0, 0, 0, 0, 0],
    [0, ky, 0, 0, 0, 0],
    [0, 0, kz, 0, 0, 0],
    [0, 0, 0, krx, 0, 0],
    [0, 0, 0, 0, kry, 0],
    [0, 0, 0, 0, 0, krz]
  ],

  /**
   * 隔震支座 - 特殊刚度分布
   * @param kh 水平刚度
   * @param kv 竖向刚度
   * @param kt 转动刚度
   */
  ISOLATOR: (kh: number, kv: number, kt: number): Matrix6x6Array => [
    [kh, 0, 0, 0, 0, 0],
    [0, kh, 0, 0, 0, 0],
    [0, 0, kv, 0, 0, 0],
    [0, 0, 0, kt, 0, 0],
    [0, 0, 0, 0, kt, 0],
    [0, 0, 0, 0, 0, kt]
  ]
};

// ============================================================================
// 三维向量（位置、方向等）
// ============================================================================

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

// ============================================================================
// 六维弹簧刚度向量 - 杆端释放使用
// ============================================================================

export interface Vector6D {
  ux: number;  // X方向平动弹簧刚度
  uy: number;  // Y方向平动弹簧刚度
  uz: number;  // Z方向平动弹簧刚度
  rx: number;  // X方向转动弹簧刚度
  ry: number;  // Y方向转动弹簧刚度
  rz: number;  // Z方向转动弹簧刚度
}

// 方向枚举（用于计算长度）
export enum AxisDirectionEnum {
  STRONG_AXIS = 'strong_axis',    // 强轴
  WEAK_AXIS = 'weak_axis',      // 弱轴
  INCLINED_AXIS = 'inclined_axis' // 斜轴
}
