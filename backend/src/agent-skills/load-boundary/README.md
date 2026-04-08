# Load and Boundary Skills

## 概述 / Overview

> Manifest-first note / 清单优先说明
>
> Builtin load-boundary skills are now defined by `skill.yaml`. Stage Markdown files such as `intent.md`
> are content assets only and no longer provide canonical ids, grants, stages, or routing metadata.
>
> 内置 load-boundary 技能现在以 `skill.yaml` 为唯一静态真源。`intent.md` 等阶段 Markdown
> 仅承载内容，不再定义 canonical id、授权工具、阶段或路由元数据。

该技能负责结构分析中的荷载和边界条件管理,包括:

- **荷载工况 (Load Cases)**: 定义各种荷载类型(恒载、活载、风载、地震等)
- **荷载动作 (Load Actions)**: 在具体构件上施加的具体荷载
- **节点约束 (Nodal Constraints)**: 定义节点的边界条件和支撑
- **杆端释放 (Member End Releases)**: 定义杆件端部的释放条件
- **计算长度 (Effective Lengths)**: 定义杆件的计算长度系数

This skill manages loads and boundary conditions for structural analysis, including:

- **Load Cases**: Define various load types (dead, live, wind, seismic, etc.)
- **Load Actions**: Apply specific loads to individual elements
- **Nodal Constraints**: Define node boundary conditions and supports
- **Member End Releases**: Define release conditions at member ends
- **Effective Lengths**: Define effective length factors for members

---

## 目录结构 / Directory Structure

```
load-boundary/
├── README.md                              # 本文档
├── core/                                  # 核心数据模型
│   ├── load_case.py                      # 荷载工况模型
│   ├── load_action.py                    # 荷载动作模型
│   ├── nodal_constraint.py               # 节点约束模型
│   ├── member_end_release.py             # 杆端释放模型
│   ├── effective_length.py               # 计算长度模型
│   ├── load_combination.py               # 基础荷载组合
│   └── load_combination_enhanced.py      # 增强荷载组合引擎 🆕
├── boundary-condition/                   # 边界条件子技能 ✅
│   ├── skill.yaml                        # 技能清单（静态真源）
│   ├── intent.md                         # 意图内容
│   └── runtime.py                        # 运行时实现
├── dead-load/                            # 恒载子技能 ✅
│   ├── skill.yaml                        # 技能清单（静态真源）
│   ├── intent.md                         # 意图内容
│   └── runtime.py                        # 运行时实现
├── live-load/                            # 活载子技能 ✅
│   ├── skill.yaml                        # 技能清单（静态真源）
│   ├── intent.md                         # 意图内容
│   └── runtime.py                        # 运行时实现
├── wind-load/                            # 风载子技能 ✅
│   ├── skill.yaml                        # 技能清单（静态真源）
│   ├── intent.md                         # 意图内容
│   └── runtime.py                        # 运行时实现
├── seismic-load/                         # 地震荷载子技能 ✅
│   ├── skill.yaml                        # 技能清单（静态真源）
│   ├── intent.md                         # 意图内容
│   └── runtime.py                        # 运行时实现
├── load-combination/                     # 荷载组合子技能 🆕
│   ├── skill.yaml                        # 技能清单（静态真源）
│   ├── intent.md                         # 意图内容
│   └── runtime.py                        # 运行时实现
├── nodal-constraint/                     # 节点约束子技能 🚧
│   └── skill.yaml                        # 技能清单（静态真源）
├── crane-load/                           # 吊车荷载子技能 ✅
│   ├── skill.yaml                        # 技能清单（静态真源）
│   ├── intent.md                         # 意图内容
│   └── runtime.py                        # 运行时实现
├── snow-load/                            # 雪荷载子技能 ✅
│   ├── skill.yaml                        # 技能清单（静态真源）
│   ├── intent.md                         # 意图内容
│   └── runtime.py                        # 运行时实现
├── temperature-load/                     # 温度荷载子技能 🚧
│   ├── skill.yaml                        # 技能清单（静态真源）
│   ├── intent.md                         # 意图内容
│   └── runtime.py                        # 运行时实现
└── verification/                         # 验证测试
    ├── test_dead_load.py                 # 恒载测试
    ├── example_usage.py                  # 综合示例
    └── test_load_combination_simple.py   # 荷载组合测试 🆕
```

---

## V2 Schema 兼容性 / V2 Schema Compatibility

本技能基于 `structure_model_v2.py` 中定义的统一结构分析 JSON Schema:

This skill is based on the unified structural analysis JSON Schema defined in `structure_model_v2.py`:

### LoadCaseV2 (结构_model_v2.py:251-262)

```python
class LoadCaseV2(BaseModel):
    """荷载工况 / Load case — extended types."""
    id: str                                    # 工况ID
    type: Literal[                              # 工况类型
        "dead", "live", "wind", "seismic",
        "temperature", "settlement", "crane",
        "snow", "other",
    ] = "other"
    loads: List[Dict[str, Any]]               # 荷载动作列表
    description: Optional[str]                 # 工况描述
    extra: Dict[str, Any]                     # 扩展字段
```

### NodeV2 (structure_model_v2.py:186-200)

```python
class NodeV2(BaseModel):
    """节点 / Node — same as V1."""
    id: str                                    # 节点ID
    x: float                                  # X坐标
    y: float                                  # Y坐标
    z: float                                  # Z坐标
    restraints: Optional[List[bool]] = Field(  # 约束条件 [ux, uy, uz, rx, ry, rz]
        default=None,
        min_length=6,
        max_length=6,
    )
    story: Optional[str]                      # 所属楼层ID
```

### ElementV2 (structure_model_v2.py:203-215)

```python
class ElementV2(BaseModel):
    """单元 / Element — extended from V1."""
    id: str                                    # 单元ID
    type: Literal[...]                         # 单元类型
    nodes: List[str]                          # 节点列表
    material: str                             # 材料ID
    section: str                              # 截面ID
    story: Optional[str]                      # 所属楼层ID
    releases: Optional[Dict[str, Any]] = Field(  # 端部释放条件
        default=None,
        description="端部释放条件 / end releases",
    )
    extra: Dict[str, Any]
```

---

## TypeScript 类型定义 / TypeScript Type Definitions

后端运行时类型定义位于 `backend/src/agent-runtime/types.ts`:

Backend runtime type definitions are located in `backend/src/agent-runtime/types.ts`:

### 荷载工况类型 / Load Case Types

```typescript
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

// 荷载动作类型枚举 (5种)
export enum LoadTypeEnum {
  POINT_FORCE = 'point_force',           // 集中力
  DISTRIBUTED_LOAD = 'distributed_load', // 分布荷载
  MOMENT = 'moment',                     // 力矩
  TORQUE = 'torque',                     // 扭矩
  AXIAL_FORCE = 'axial_force',          // 轴向力
}

// 荷载工况接口 - 对齐 V2 Schema LoadCaseV2
export interface LoadCase {
  id: string;                       // 工况ID (对齐 V2 Schema)
  type: LoadCaseTypeEnum;            // 工况类型 (对齐 V2 Schema)
  loads?: LoadAction[];             // 荷载动作列表 (对齐 V2 Schema)
  description?: string;             // 工况描述 (对齐 V2 Schema)
  extra?: Record<string, any>;      // 扩展字段 (对齐 V2 Schema)
}
```

### 荷载动作接口 / Load Action Interface

```typescript
// 荷载动作接口 - V2 Schema 使用 Dict[str, Any]，此处提供具体结构
export interface LoadAction {
  id?: string;                    // 动作ID (可选，V2 Schema 允许任意字段)
  caseId?: string;                // 所属工况ID (可选，V2 Schema 允许任意字段)
  elementType?: LoadElementTypeEnum; // 单元类型 (可选，V2 Schema 允许任意字段)
  elementId?: string;             // 单元ID (可选，V2 Schema 允许任意字段)
  loadType?: LoadTypeEnum;        // 荷载类型 (可选，V2 Schema 允许任意字段)
  loadValue?: number;             // 荷载值 (可选，V2 Schema 允许任意字段)
  loadDirection?: Vector3D;       // 荷载方向向量 (可选)
  position?: Vector3D;            // 作用位置 (可选)
  extra?: Record<string, any>;     // 扩展字段 (对齐 V2 Schema)
}
```

### 节点约束接口 / Nodal Constraint Interface

```typescript
// 节点约束类型枚举
export enum NodalConstraintTypeEnum {
  FIXED = 'fixed',           // 固定支座
  PINNED = 'pinned',       // 铰支座
  SLIDING = 'sliding',      // 滑动支座
  ELASTIC = 'elastic',        // 弹性支座（预留，待 #39 Schema 确认）
}

// 自由度集合接口 (6个自由度)
export interface DOFSet {
  uX: boolean;  // X 轴平动位移
  uY: boolean;  // Y 轴平动位移
  uZ: boolean;  // Z 轴平动位移
  rotX: boolean;  // X 轴转角位移
  rotY: boolean;  // Y 轴转角位移
  rotZ: boolean;  // Z 轴转角位移
}

// 节点约束接口 - V2 Schema 使用 restraints: List[bool]，此处提供扩展定义
export interface NodalConstraint {
  nodeId: string;                // 节点ID
  constraintType?: NodalConstraintTypeEnum; // 约束类型 (可选，V2 Schema 未定义)
  restraints?: [boolean, boolean, boolean, boolean, boolean, boolean]; // 对齐 V2 Schema: [ux, uy, uz, rx, ry, rz]
  restrainedDOFs?: DOFSet;       // 约束的自由度 (可选，与 V2 Schema 格式不同)
  stiffness?: Matrix6x6;         // 弹簧刚度矩阵 (可选，V2 Schema 允许任意字段)
  extra?: Record<string, any>;    // 扩展字段 (对齐 V2 Schema)
}
```

### 杆端释放接口 / Member End Release Interface

```typescript
// 杆端释放接口 - V2 Schema 使用 releases: Dict[str, Any]，此处提供扩展定义
export interface MemberEndRelease {
  memberId: string;              // 杆件ID
  releaseI?: DOFSet;             // I端释放 (可选，V2 Schema 允许任意字段)
  releaseJ?: DOFSet;             // J端释放 (可选，V2 Schema 允许任意字段)
  springStiffnessI?: Vector6D;   // I端弹簧刚度 (可选，V2 Schema 允许任意字段)
  springStiffnessJ?: Vector6D;   // J端弹簧刚度 (可选，V2 Schema 允许任意字段)
  extra?: Record<string, any>;    // 扩展字段 (对齐 V2 Schema)
}
```

### 计算长度接口 / Effective Length Interface

```typescript
// 轴向方向枚举
export enum AxisDirectionEnum {
  STRONG_AXIS = 'strong_axis',    // 强轴
  WEAK_AXIS = 'weak_axis',      // 弱轴
  INCLINED_AXIS = 'inclined_axis' // 斜轴
}

// 计算长度接口 - V2 Schema 未定义，此处提供扩展定义
export interface EffectiveLength {
  memberId: string;              // 杆件ID
  direction?: AxisDirectionEnum; // 方向 (可选)
  calcLength?: number;           // 几何长度 (可选)
  lengthFactor?: number;         // 长度系数 (可选)
  effectiveLength?: number;      // 计算长度 (可选)
  extra?: Record<string, any>;    // 扩展字段 (对齐 V2 Schema)
}
```

---

## Python 核心模块 / Python Core Modules

### 1. LoadCase (荷载工况 / Load Case)

**文件位置**: `core/load_case.py`

**功能**: 提供荷载工况的 CRUD 操作

**使用示例**:

```python
from core.load_case import LoadCase

# 创建荷载工况
load_case = LoadCase(
    case_id="LC01",
    case_type="dead",
    description="结构自重及永久荷载"
)

# 获取荷载工况数据
case_dict = load_case.create_load_case()
# {
#     "id": "LC01",
#     "type": "dead",
#     "description": "结构自重及永久荷载",
#     "loads": [],
#     "extra": {}
# }

# 修改荷载工况
load_case.modify_load_case(
    description="更新描述"
)

# 查询荷载工况
case_info = load_case.query_load_case()

# 删除荷载工况
delete_result = load_case.delete_load_case()
# {"id": "LC01", "deleted": True}
```

---

### 2. LoadAction (荷载动作 / Load Action)

**文件位置**: `core/load_action.py`

**功能**: 提供荷载动作的 CRUD 操作，对齐 V2 Schema (LoadCaseV2.loads 中的动作项)

**荷载动作格式示例**:

```python
# 直接在 LoadCase 中添加荷载动作
from core.load_case import LoadCase

load_case = LoadCase(
    case_id="LC01",
    case_type="dead",
    description="恒载工况"
)

# 添加集中力荷载
load_action_point = {
    "id": "LA01",
    "elementId": "B1",
    "elementType": "beam",
    "loadType": "point_force",
    "loadValue": 50.0,
    "loadDirection": {"x": 0.0, "y": -1.0, "z": 0.0},
    "position": {"x": 2.5, "y": 3.0, "z": 0.0}
}
load_case.add_load(load_action_point)

# 添加均布荷载
load_action_dist = {
    "id": "LA02",
    "elementId": "B2",
    "elementType": "beam",
    "loadType": "distributed_load",
    "loadValue": 10.0,  # kN/m
    "loadDirection": {"x": 0.0, "y": -1.0, "z": 0.0}
}
load_case.add_load(load_action_dist)
```

**荷载类型** / Load Types:
- `point_force`: 集中力
- `distributed_load`: 分布荷载
- `moment`: 力矩
- `torque`: 扭矩
- `axial_force`: 轴向力

---

### 3. NodalConstraint (节点约束 / Nodal Constraint)

**文件位置**: `core/nodal_constraint.py`

**功能**: 提供节点约束的 CRUD 操作

**使用示例**:

```python
from core.nodal_constraint import NodalConstraint

# 创建固定支座 (所有自由度约束)
fixed_constraint = NodalConstraint(
    node_id="N1",
    constraint_type="fixed",
    restrained_dofs={
        "uX": True,  # 约束X平动
        "uY": True,  # 约束Y平动
        "uZ": True,  # 约束Z平动
        "rotX": True,  # 约束X转动
        "rotY": True,  # 约束Y转动
        "rotZ": True   # 约束Z转动
    }
)

constraint_dict = fixed_constraint.create_nodal_constraint()
# {
#     "node_id": "N1",
#     "constraint_type": "fixed",
#     "restrained_dofs": {...},
#     "extra": {}
# }

# 创建铰支座 (仅约束平动)
pinned_constraint = NodalConstraint(
    node_id="N2",
    constraint_type="pinned",
    restrained_dofs={
        "uX": True,
        "uY": True,
        "uZ": True,
        "rotX": False,  # 自由转动
        "rotY": False,
        "rotZ": False
    }
)

# 创建滑动支座 (带 V2 Schema 格式的 restraints)
sliding_constraint = NodalConstraint(
    node_id="N3",
    constraint_type="sliding",
    restraints=[True, True, True, False, False, False],  # [ux, uy, uz, rx, ry, rz]
    restrained_dofs={
        "uX": True,
        "uY": True,
        "uZ": True,
        "rotX": False,
        "rotY": False,
        "rotZ": False
    }
)

# 创建弹性支座 (带刚度矩阵)
elastic_constraint = NodalConstraint(
    node_id="N4",
    constraint_type="elastic",
    stiffness={
        "Fx_ux": 1e8, "Fx_uy": 0, "Fx_uz": 0, "Fx_rx": 0, "Fx_ry": 0, "Fx_rz": 0,
        "Fy_ux": 0, "Fy_uy": 1e8, "Fy_uz": 0, "Fy_rx": 0, "Fy_ry": 0, "Fy_rz": 0,
        "Fz_ux": 0, "Fz_uy": 0, "Fz_uz": 1e8, "Fz_rx": 0, "Fz_ry": 0, "Fz_rz": 0,
        "Mx_ux": 0, "Mx_uy": 0, "Mx_uz": 0, "Mx_rx": 1e6, "Mx_ry": 0, "Mx_rz": 0,
        "My_ux": 0, "My_uy": 0, "My_uz": 0, "My_rx": 0, "My_ry": 1e6, "My_rz": 0,
        "Mz_ux": 0, "Mz_uy": 0, "Mz_uz": 0, "Mz_rx": 0, "Mz_ry": 0, "Mz_rz": 1e6
    }
)
```

**约束类型** / Constraint Types:
- `fixed`: 固定支座 (约束所有6个自由度)
- `pinned`: 铰支座 (仅约束3个平动自由度)
- `sliding`: 滑动支座 (约束平动，允许转动)
- `elastic`: 弹性支座 (需指定刚度矩阵)

---

### 4. MemberEndRelease (杆端释放 / Member End Release)

**文件位置**: `core/member_end_release.py`

**功能**: 提供杆端释放的 CRUD 操作

**使用示例**:

```python
from core.member_end_release import MemberEndRelease

# 创建两端铰接杆件
hinged_member = MemberEndRelease(
    member_id="B1",
    release_i={
        "uX": False, "uY": False, "uZ": False,
        "rotX": True,  "rotY": True,  "rotZ": True   # I端释放转动
    },
    release_j={
        "uX": False, "uY": False, "uZ": False,
        "rotX": True,  "rotY": True,  "rotZ": True   # J端释放转动
    }
)

release_dict = hinged_member.create_member_end_release()
# {
#     "member_id": "B1",
#     "release_i": {...},
#     "release_j": {...},
#     "extra": {}
# }

# 创建带弹簧刚度的释放
spring_release = MemberEndRelease(
    member_id="B2",
    release_i={
        "uX": False, "uY": False, "uZ": False,
        "rotX": True,  "rotY": False, "rotZ": True
    },
    release_j={
        "uX": False, "uY": False, "uZ": False,
        "rotX": True,  "rotY": False, "rotZ": True
    },
    spring_stiffness_i={
        "uX": 0, "uY": 0, "uZ": 0,
        "rotX": 1e5, "rotY": 0, "rotZ": 0
    },
    spring_stiffness_j={
        "uX": 0, "uY": 0, "uZ": 0,
        "rotX": 1e5, "rotY": 0, "rotZ": 0
    }
)

release_dict = spring_release.create_member_end_release()
```

---

### 5. EffectiveLength (计算长度 / Effective Length)

**文件位置**: `core/effective_length.py`

**功能**: 提供计算长度的 CRUD 操作

**使用示例**:

```python
from core.effective_length import EffectiveLength

# 创建计算长度 (柱的弱轴方向)
effective_length = EffectiveLength(
    member_id="C1",
    direction="weak_axis",  # 弱轴方向
    calc_length=3.6,       # 几何长度 3.6m
    length_factor=1.0      # 长度系数
)

# 自动计算 effective_length = calc_length * length_factor
length_dict = effective_length.create_effective_length()
# {
#     "member_id": "C1",
#     "direction": "weak_axis",
#     "calc_length": 3.6,
#     "length_factor": 1.0,
#     "effective_length": 3.6,  # 3.6 * 1.0
#     "extra": {}
# }

# 不同边界条件的长度系数示例:
# 两端固定: 0.5
# 一端固定、一端铰接: 0.7
# 两端铰接: 1.0
# 一端固定、一端自由: 2.0
effective_length = EffectiveLength(
    member_id="C1",
    direction="weak_axis",
    calc_length=3.6,
    length_factor=0.7  # 一端固定、一端铰接
)
# effective_length = 2.52
```

---

## 子技能详解 / Sub-Skills Details

### 1. Dead Load (恒载 / 自重)

**目录**: `dead-load/`

**功能**:
- 自动计算构件自重 (基于材料密度和截面面积)
- 支持添加自定义恒载
- 支持均布荷载和集中荷载

**使用示例**:

```python
from dead_load.runtime import generate_dead_loads
from structure_protocol.structure_model_v2 import StructureModelV2

# 加载或创建 V2 模型
model = StructureModelV2(...)

# 生成自重荷载
result = generate_dead_loads(model, {
    "case_id": "LC_DE",
    "case_name": "恒载工况",
    "description": "结构自重及永久荷载",
    "include_self_weight": True  # 自动计算自重
})

# 结果包含:
# - load_cases: 荷载工况
# - load_actions: 荷载动作列表
# - summary: 摘要信息
```

**支持的荷载类型**:
- `distributed_load`: 均布恒载 (kN/m)
- `point_force`: 集中恒载 (kN)

---

### 2. Live Load (活载)

**目录**: `live-load/`

**功能**:
- 根据规范标准自动生成楼面活载
- 支持多种荷载类型 (住宅、办公、教室、走廊等)
- 支持自定义活载

**使用示例**:

```python
from live_load.runtime import generate_live_loads

# 生成办公用楼面活载
result = generate_live_loads(model, {
    "case_id": "LC_LL",
    "case_name": "活载工况",
    "description": "楼面活载",
    "floor_load_type": "office"  # 标准: 2.0 kN/m²
})

# 其他荷载类型:
# - residential: 住宅 (2.0 kN/m²)
# - classroom: 教室 (2.5 kN/m²)
# - corridor: 走廊 (2.5 kN/m²)
# - stair: 楼梯 (3.5 kN/m²)
# - equipment: 设备房 (5.0 kN/m²)
```

---

### 3. Wind Load (风荷载)

**目录**: `wind-load/`

**功能**:
- 根据基本风压、地面粗糙度、风荷载体型系数计算风压
- 支持高度变化系数自动计算
- 支持多个风向 (X, Y, -X, -Y)

**使用示例**:

```python
from wind_load.runtime import generate_wind_loads

# 生成风荷载
result = generate_wind_loads(model, {
    "basic_pressure": 0.55,        # 基本风压 (kN/m²)
    "terrain_roughness": "B",      # 地面粗糙度类别
    "shape_factor": 1.3,           # 风荷载体型系数
    "wind_direction": "x",         # 风向
    "case_id": "LC_W"
})

# 地面粗糙度类别:
# - A: 海岸、湖岸、沙漠地区
# - B: 田野、乡村、丛林、丘陵 (默认)
# - C: 密集建筑群、市区
# - D: 密集高层建筑群
```

---

### 4. Seismic Load (地震荷载)

**目录**: `seismic-load/`

**功能**:
- 根据设防烈度、场地类别计算地震作用
- 支持底部剪力法 (简化版)
- 支持多方向地震作用

**使用示例**:

```python
from seismic_load.runtime import generate_seismic_loads

# 生成地震荷载
result = generate_seismic_loads(model, {
    "intensity": 7.0,               # 设防烈度
    "site_category": "II",          # 场地类别
    "design_group": "第二组",       # 设计地震分组
    "damping_ratio": 0.05,         # 阻尼比
    "seismic_direction": "x",      # 地震作用方向
    "case_id": "LC_E"
})

# 设防烈度: 6.0, 6.5, 7.0, 7.5, 8.0, 8.5, 9.0
# 场地类别: I, II, III, IV
# 设计地震分组: 第一组, 第二组, 第三组
```

---

### 5. Boundary Condition (边界条件)

**目录**: `boundary-condition/`

**功能**:
- 节点约束: 固定支座、铰支座、滚动支座
- 杆端释放: 杆端铰接、一端铰接
- 计算长度: 自动计算几何长度、长度系数

**使用示例**:

```python
from boundary_condition.runtime import apply_boundary_conditions

# 施加固定支座
result = apply_boundary_conditions(model, {
    "support_type": "fixed",          # 支座类型
    "node_ids": ["N1", "N2"],         # 节点ID (可选，默认基础节点)
    "apply_hinged_ends": False,       # 是否施加杆端铰接
    "calculate_effective_lengths": True  # 是否计算计算长度
})

# 支座类型:
# - fixed: 固定支座 (约束6个自由度)
# - pinned: 铰支座 (约束3个平动自由度)
# - roller: 滚动支座 (约束部分平动自由度)
```

---

## 快速开始 / Quick Start

### 创建完整的荷载工况 / Create Complete Load Case

```python
from core.load_case import LoadCase

# 1. 创建荷载工况
load_case = LoadCase(
    case_id="LC01",
    case_type="dead",
    description="结构自重"
)
case_data = load_case.create_load_case()

# 2. 添加荷载动作
action1 = {
    "id": "LA01",
    "elementId": "B1",
    "elementType": "beam",
    "loadType": "distributed_load",
    "loadValue": 10.0,  # kN/m
    "loadDirection": {"x": 0.0, "y": -1.0, "z": 0.0}
}
load_case.add_load(action1)

action2 = {
    "id": "LA02",
    "elementId": "C1",
    "elementType": "column",
    "loadType": "axial_force",
    "loadValue": 100.0  # kN
}
load_case.add_load(action2)

# 3. 转换为 V2 Schema 格式
load_case_v2 = load_case.create_load_case()
# {
#     "id": "LC01",
#     "type": "dead",
#     "description": "结构自重",
#     "loads": [action1, action2],
#     "extra": {}
# }
```

### 创建边界条件 / Create Boundary Conditions

```python
from core.nodal_constraint import NodalConstraint
from core.member_end_release import MemberEndRelease
from core.effective_length import EffectiveLength

# 1. 定义节点约束
node1_constraint = NodalConstraint(
    node_id="N1",
    constraint_type="fixed",
    restrained_dofs={
        "uX": True, "uY": True, "uZ": True,
        "rotX": True, "rotY": True, "rotZ": True
    }
)

node2_constraint = NodalConstraint(
    node_id="N2",
    constraint_type="pinned",
    restrained_dofs={
        "uX": True, "uY": True, "uZ": True,
        "rotX": False, "rotY": False, "rotZ": False
    }
)

# 2. 定义杆端释放 (Y轴铰接)
member_release = MemberEndRelease(
    member_id="B1",
    release_i={
        "uX": False, "uY": False, "uZ": False,
        "rotX": False, "rotY": True, "rotZ": False
    },
    release_j={
        "uX": False, "uY": False, "uZ": False,
        "rotX": False, "rotY": True, "rotZ": False
    }
)

# 3. 定义计算长度 (柱的弱轴)
effective_length = EffectiveLength(
    member_id="C1",
    direction="weak_axis",
    calc_length=3.6,
    length_factor=0.7
)
```

---

## 与引擎的映射 / Engine Mapping

V2 Schema 与 OpenSeesPy 和 PKPM API 的映射关系详见:

Mapping between V2 Schema and OpenSeesPy/PKPM API is documented in:

**文件**: `docs/schema/engine-mapping.md`

### 主要映射规则 / Main Mapping Rules:

| V2 字段 / V2 Field | OpenSeesPy | PKPM API |
|-------------------|------------|----------|
| LoadCaseV2.type | loadPattern -type | LCASE 表 |
| NodeV2.restraints | fix 命令 | NODE 表 RESTR 字段 |
| ElementV2.releases | releases 命令 | ELEM 表 REL_I/REL_J 字段 |
| LoadAction | load, eleLoad 命令 | LOAD 表 |

---

## 开发计划 / Development Plan

### 已完成 / Completed ✅
- [x] TypeScript 类型定义 (9种荷载工况, 5种荷载类型)
- [x] Python 核心模块 (5个CRUD类)
- [x] V2 Schema 兼容性验证
- [x] README 文档
- [x] 恒载子技能 (dead-load)
  - [x] 技能清单 (skill.yaml)
  - [x] 意图内容 (intent.md)
  - [x] 运行时实现 (runtime.py)
  - [x] 自重自动计算
  - [x] 自定义恒载支持
- [x] 活载子技能 (live-load)
  - [x] 技能清单 (skill.yaml)
  - [x] 意图内容 (intent.md)
  - [x] 运行时实现 (runtime.py)
  - [x] 规范标准活载库
  - [x] 多种荷载类型支持
- [x] 风荷载子技能 (wind-load)
  - [x] 技能清单 (skill.yaml)
  - [x] 意图内容 (intent.md)
  - [x] 运行时实现 (runtime.py)
  - [x] 风压计算 (高度变化系数)
  - [x] 多风向支持
- [x] 地震荷载子技能 (seismic-load)
  - [x] 技能清单 (skill.yaml)
  - [x] 意图内容 (intent.md)
  - [x] 运行时实现 (runtime.py)
  - [x] 底部剪力法
  - [x] 规范参数支持
- [x] 边界条件子技能 (boundary-condition)
  - [x] 技能清单 (skill.yaml)
  - [x] 意图内容 (intent.md)
  - [x] 运行时实现 (runtime.py)
  - [x] 节点约束 (固定、铰接、滚动)
  - [x] 杆端释放
  - [x] 计算长度
- [x] 荷载组合子技能 (load-combination) 🆕
  - [x] 技能清单 (skill.yaml)
  - [x] 意图内容 (intent.md)
  - [x] 运行时实现 (runtime.py)
  - [x] ULS 组合 (承载能力极限状态)
  - [x] SLS 组合 (正常使用极限状态)
  - [x] 地震组合
  - [x] 工况展开 (活1~活4, 吊1~吊8等)
  - [x] 自定义组合系数
  - [x] 特殊构件组合 (抗风柱)
- [x] 吊车荷载子技能 (crane-load) 🆕
  - [x] 技能清单 (skill.yaml)
  - [x] 意图内容 (intent.md)
  - [x] 运行时实现 (runtime.py)
- [x] 雪荷载子技能 (snow-load) 🆕
  - [x] 技能清单 (skill.yaml)
  - [x] 意图内容 (intent.md)
  - [x] 运行时实现 (runtime.py)

### 待开发 / Pending 📋
- [x] 更多验证测试用例 (live-load, wind-load, seismic-load, boundary-condition) ✅
- [x] 地震、吊车、雪载测试用例 ✅
- [ ] 与分析引擎的集成测试
- [ ] 多语言支持 (i18n)
- [ ] 用户交互问题生成
- [ ] 温度荷载子技能 (temperature-load) - 已有框架文件
- [ ] 施工荷载子技能 (construction-load)

---

### 7. Load Combination (荷载组合) 🆕

**目录**: `load-combination/`

**功能**:
- 根据规范自动生成荷载组合 (ULS, SLS, 地震组合)
- 支持工况展开 (活1~活4, 吊1~吊8, 左风右风, 左震右震)
- 支持自定义组合系数
- 支持特殊构件组合 (抗风柱等)
- 基于 GB50009-2012 和 GB50011-2010 规范

**使用示例**:

```python
from load_combination.runtime import generate_load_combinations

# 生成承载能力极限状态组合 (ULS)
result = generate_load_combinations({
    "load_cases": {
        "dead_load": ["LC_DE"],
        "live_load": ["LC_LL"],
        "wind_load": ["LC_WX"]
    },
    "combination_type": "uls"
})

# 生成包含地震的所有组合
result = generate_load_combinations({
    "load_cases": {
        "dead_load": ["LC_DE"],
        "live_load": ["LC_LL"],
        "seismic_load": ["LC_EX"]
    },
    "combination_type": "all"
})

# 展开工况并生成组合
result = generate_load_combinations({
    "load_cases": {
        "dead_load": ["LC_DE"],
        "live_load": ["LC_LL"],
        "wind_load": ["LC_WX"]
    },
    "combination_type": "uls",
    "expand_cases": True  # 展开: 活1~活4, 左风右风等
})

# 自定义组合系数
result = generate_load_combinations({
    "load_cases": {
        "dead_load": ["LC_DE"],
        "live_load": ["LC_LL"]
    },
    "combination_factors": {
        "gamma_g": 1.35,  # 恒载分项系数
        "gamma_q": 1.4    # 活载分项系数
    }
})
```

**支持的组合类型**:

| 组合类型 | 说明 | 规范依据 |
|---------|------|---------|
| ULS | 承载能力极限状态 | GB50009-2012 3.2.4 |
| SLS | 正常使用极限状态 | GB50009-2012 3.2.3 |
| Seismic | 地震作用组合 | GB50011-2010 5.4.1 |

**默认组合系数** (可自定义):

| 系数 | 说明 | 默认值 |
|------|------|--------|
| γ_G | 恒载分项系数 (不利) | 1.3 |
| γ_G | 恒载分项系数 (有利) | 1.0 |
| γ_Q | 活载分项系数 | 1.5 |
| γ_W | 风载分项系数 | 1.5 |
| γ_EH | 水平地震作用分项系数 | 1.3 |
| γ_EV | 竖向地震作用分项系数 | 0.5 |
| ψ_Live | 活载组合值系数 | 0.7 |
| ψ_Wind | 风载组合值系数 | 0.6 |
| ψ_Crane | 吊车组合值系数 | 0.7 |
| ψ_Temp | 温度荷载组合值系数 | 0.6 |
| ψ_Seismic | 地震组合时活载代表值系数 | 0.5 |

**工况展开规则**:

| 荷载类型 | 展开规则 | 说明 |
|---------|---------|------|
| 活荷载 | 活1~活4 | 用于梁的不同活载分布 |
| 风荷载 | 左风、右风 | 考虑风的不同作用方向 |
| 地震作用 | 左震、右震 | 考虑地震的不同作用方向 |
| 吊车荷载 | 吊1~吊8 | 考虑吊车的不同最不利位置 |

**典型组合公式**:

- **活载控制**: 1.3*恒 + 1.5*活
- **风载控制**: 1.3*恒 + 1.5*风
- **活+风**: 1.3*恒 + 1.5*活 + 0.6*1.5*风
- **有吊车**: 1.3*恒 + 0.7*1.5*活 + 1.5*吊
- **地震**: 1.2*(恒 + 0.5*活) + 1.3*地
- **SLS**: 1.0*恒 + 1.0*活 + 0.6*1.0*风

---

## 测试与验证 / Testing & Verification

### 运行恒载测试 / Run Dead Load Tests

```bash
cd backend/src/agent-skills/load-boundary/verification
python test_dead_load.py
```

### 运行综合示例 / Run Comprehensive Example

```bash
cd backend/src/agent-skills/load-boundary/verification
python example_usage.py
```

### 运行荷载组合测试 / Run Load Combination Tests 🆕

```bash
cd backend/src/agent-skills/load-boundary/verification
python test_load_combination_simple.py
```

**测试覆盖**:
- [x] ULS 组合生成 (活载控制、风载控制、活+风组合)
- [x] SLS 组合生成
- [x] 地震组合生成
- [x] 工况展开 (活1~活4, 左风右风等)
- [x] 自定义组合系数
- [x] 特殊构件组合 (抗风柱)
- [x] 所有类型组合 (ULS+SLS+Seismic)

**测试结果示例**:
```
[Test 1] Basic ULS Combinations
Status: success
Total combinations: 8
ULS combinations: 8

Sample combinations:
  1. COMB_1: 活载控制: LC_LL
     Factors: {'LC_DE': 1.2, 'LC_LL': 1.5}
  2. COMB_2: 活载控制(恒有利): LC_LL
     Factors: {'LC_DE': 1.0, 'LC_LL': 1.5}
  3. COMB_3: 风载控制: LC_WX
     Factors: {'LC_DE': 1.2, 'LC_WX': 1.4}
[PASS] Test 1 completed

[Test 4] All Combination Types
Status: success
Total: 17, ULS: 10, SLS: 5, Seismic: 2
[PASS] Test 4 completed
```

**示例输出**:
```
======================================================================
Load and Boundary Sub-Skills - Comprehensive Example
======================================================================

[1] Creating sample model...
✓ Model created: 9 nodes, 12 elements

[2] Applying boundary conditions...
✓ Applied 3 nodal constraints
✓ Calculated 12 effective lengths

[3] Generating dead loads (self-weight)...
✓ Generated dead load case LC_DE
  - Load actions: 12
  - Sample load: 自重: 3.6780 kN/m

[4] Generating live loads (office floor)...
✓ Generated live load case LC_LL
  - Load actions: 6
  - Floor type: office

[5] Generating wind loads...
✓ Generated wind load case LC_WX
  - Load actions: 12
  - Basic pressure: 0.55 kN/m²
  - Direction: x

[6] Generating seismic loads...
✓ Generated seismic load case LC_EX
  - Load actions: 12
  - Intensity: 7.0
  - Site category: II

[7] Summary of load cases...

Total load cases: 4
  - LC_DE: dead (12 loads)
  - LC_LL: live (6 loads)
  - LC_WX: wind (12 loads)
  - LC_EX: seismic (12 loads)

Total nodal constraints: 3
Total member end releases: 0
Total effective lengths: 12

======================================================================
Example completed successfully! ✓
======================================================================
```

---

## 相关文档 / Related Documentation

- **V2 Schema**: `backend/src/skill-shared/python/structure_protocol/structure_model_v2.py`
- **引擎映射**: `docs/schema/engine-mapping.md`
- **类型定义**: `backend/src/agent-runtime/types.ts`
- **Project Guide**: `AGENTS.md`
- **Issue #48**: https://github.com/structureclaw/structureclaw/issues/48

---

## 贡献指南 / Contributing

遵循项目的提交规范:

Follow the project commit convention:

```
feat(load-boundary): add load case CRUD operations
fix(load-boundary): correct DOF constraint validation
docs(load-boundary): update usage examples
test(load-boundary): add load action verification tests
```
