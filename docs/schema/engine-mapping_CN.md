# 引擎映射：V2 Schema → 分析引擎

本文档定义 `StructureModelV2` 字段到各引擎专用输入格式的映射关系。

---

## 映射总览

| V2 Schema 字段 | OpenSeesPy | PKPM API (`APIPyInterface`) |
|---|---|---|
| `project.code_standard` | 不适用 | `ProjectPara.GetPara_String(...)` |
| `project.importance_class` | 不适用 | `ProjectPara.GetPara_Int(...)`（需字符串→整数映射：甲=1, 乙=2, 丙=3, 丁=4） |
| `structure_system.type` | 模型拓扑 | `SysInfoDetail` 参数 |
| `structure_system.seismic_grade` | 不适用 | `Beam.GetSeisGrade()` / `Column.GetSeisGrade()` / `Wall.GetSeisGrade()`（构件级） |
| `site_seismic.intensity` | 不适用 | `ProjectPara.GetPara_Int(...)` |
| `site_seismic.design_group` | 不适用 | `ProjectPara.GetPara_Int(...)` |
| `site_seismic.site_category` | 不适用 | `ProjectPara.GetPara_Int(...)` |
| `site_seismic.characteristic_period` | 不适用 | `ProjectPara.GetPara_Double(...)` |
| `site_seismic.max_influence_coefficient` | 不适用 | `ProjectPara.GetPara_Double(...)` |
| `site_seismic.damping_ratio` | `ops.rayleigh(...)` | `SysInfoDetail.GetDamp_whole()` |
| `wind.basic_pressure` | 不适用 | `ProjectPara.GetPara_Double(...)` |
| `wind.terrain_roughness` | 不适用 | `ProjectPara.GetPara_Int(...)` |
| `stories[].height` | 节点坐标 Δz | `RealFloor.GetFloorHeight()` |
| `stories[].elevation` | 不适用 | `RealFloor.GetBottomElevation()` |
| `stories[].rigid_diaphragm` | `ops.rigidDiaphragm(...)` | `SysInfoDetail` 参数 |
| `stories[].floor_loads` | 不适用 | `StandFloor.GetDeadLive()` |
| `nodes` | `ops.node(id, x, y, z)` | `StandFloor.GetNodes()` → `Node.Get()` (x, y) |
| `elements` (梁) | `ops.element('elasticBeamColumn', ...)` | `StandFloor.GetBeams()` → `Beam` |
| `elements` (柱) | `ops.element('elasticBeamColumn', ...)` | `StandFloor.GetColumns()` → `Column` |
| `elements` (墙) | `ops.element('ShellMITC4', ...)` | `StandFloor.GetWalls()` → `Wall` |
| `materials[].E` | `ops.uniaxialMaterial('Elastic', ...)` | `MaterialData.getEc()` |
| `materials[].grade` | 不适用 | `ConcreteGrade` / `ReinforcingbarGrade` / `SteelGrade` 枚举 |
| `sections` | `ops.section('Elastic', ...)` / `Fiber` | `BeamSection` / `ColumnSection` / `WallSection` + `SectionKind` + `SectionShape` |
| `load_cases` | `ops.pattern('Plain', ...)` / `UniformExcitation` | `Model.GetUserLoadCase()` → `LoadCaseData` |
| `load_combinations` | 手动后处理 | `Model.GetAllDesignPara()` / `SysInfoDetail` |
| `analysis_control.p_delta` | `ops.geomTransf('PDelta', ...)` | `SysInfoDetail` 参数 |
| `analysis_control.period_reduction_factor` | 不适用 | `SysInfoDetail` 参数 |
| `analysis_control.modal_count` | `ops.eigen(n)` | `SysInfoDetail` 参数 |
| `extensions.pkpm` | 不适用 | `SysInfoDetail` / `ProjectPara` 专有参数 |

---

## OpenSeesPy 映射详情

OpenSeesPy 通过 `openseespy.opensees` Python API（`import openseespy.opensees as ops`）在有限元层面运作。V2 → OpenSeesPy 转换器使用：

- `nodes` → `ops.node(id, x, y, z)`
- `elements` → `ops.element(type, ...)`（类型取决于 `element.type`）
- `materials` → `ops.uniaxialMaterial(...)` / `ops.nDMaterial(...)`
- `sections` → `ops.section(...)`
- `load_cases` → `ops.pattern(...)` / `ops.timeSeries(...)`
- `analysis_control.p_delta` → `ops.geomTransf('PDelta', ...)` 或 `ops.geomTransf('Linear', ...)`
- `site_seismic.damping_ratio` → `ops.rayleigh(...)` 瑞利阻尼设置
- `analysis_control.modal_count` → `ops.eigen(n)`

`project`、`structure_system`、`stories` 等高层级字段对 OpenSeesPy 而言仅作**信息参考**，不会直接转换为 API 调用。

---

## PKPM API 映射详情

> **API 参考**：[PKPM 官方 API 发布](https://gitee.com/pkpmgh/pkpm-official---api-release)（`APIPyInterface`，Python 3.8-3.13）

PKPM 通过 `APIPyInterface` 模块提供 Python API，数据模型基于**标准层 (StandFloor) + 自然层 (RealFloor)** 的楼层体系。V2 Schema 到 PKPM API 的映射如下：

### 项目与工程参数

| V2 字段 | PKPM API | 说明 |
|---|---|---|
| `project.*` | `Model.GetProjectPara()` → `ProjectPara` | 通过索引号读写 (`GetPara_Int`, `GetPara_Double`, `GetPara_String`) |
| `structure_system.*` | `ProjectPara` + `SysInfoDetail` | 结构类型、抗震等级等通过工程参数索引设置 |
| `site_seismic.*` | `ProjectPara`（索引参数） | 设防烈度、分组、场地类别、特征周期、αmax |
| `wind.*` | `ProjectPara`（索引参数） | 基本风压、粗糙度 |
| `analysis_control.*` | `SysInfoDetail` | 数百个计算控制参数（阻尼比、P-Δ、周期折减等） |

### 楼层体系

| V2 字段 | PKPM API | 说明 |
|---|---|---|
| `stories[].height` | `RealFloor.GetFloorHeight()` | 自然层层高 |
| `stories[].elevation` | `RealFloor.GetBottomElevation()` | 自然层底标高 |
| `stories[].floor_loads` | `StandFloor.GetDeadLive()` / `SetDeadLive(dead, live)` | 恒/活荷载统一设置 |
| （楼层与标准层映射） | `RealFloor.GetStandFloorIndex()` | 自然层→标准层映射 |

### 构件

| V2 字段 | PKPM API | 说明 |
|---|---|---|
| `nodes` | `StandFloor.AddNode(x, y)` / `GetNodes()` | 2D 坐标 + 标高 (`Node.GetElevation()`) |
| `elements`（梁） | `StandFloor.AddBeam(isect, netID)` / `GetBeams()` | `Beam.GetSect()`, `GetConcreteGrade()`, `GetSteelGrade()`, `GetSeisGrade()` |
| `elements`（柱） | `StandFloor.AddColumn(isect, nodeID)` / `GetColumns()` | `Column.GetSect()`, `GetConcreteGrade()`, `GetSteelGrade()`, `GetSeisGrade()` |
| `elements`（墙） | `StandFloor.AddWall(isect, netID)` / `GetWalls()` | `Wall.GetSect()`, `GetConcreteGrade()`, `GetSteelGrade()`, `GetSeisGrade()` |
| `elements`（支撑） | `StandFloor.AddBrace(isect, ...)` / `GetBraces()` | `Brace.GetSect()`, `GetConcreteGrade()`, `GetSteelGrade()` |

### 材料

| V2 字段 | PKPM API | 说明 |
|---|---|---|
| `materials[].grade`（混凝土） | `ConcreteGrade` 枚举 | C15–C100，每个构件独立设置 (`Beam.SetConcreteGrade(val)`) |
| `materials[].grade`（钢筋） | `ReinforcingbarGrade` 枚举 | HPB235, HPB300, HPB335, HPB400, HRB500, CRB550, CRB600H, HTRB600, HTRB630 |
| `materials[].grade`（钢材） | `SteelGrade` 枚举 | Q235–Q690 + GJ 系列，每个构件独立设置 (`Beam.SetSteelGrade(val)`) |

### 截面

| V2 字段 | PKPM API | 说明 |
|---|---|---|
| `sections[].type` | `SectionKind` 枚举 | 22 种：矩形、工字、圆形、箱形、管形、槽形、T 形、L 形、梯形、钢管混凝土、型钢混凝土、变截面等 |
| `sections[].width/height/...` | `SectionShape` | 几何参数：B/H/D/T/B1/B2/H1/H2/T1/T2/Tw 等 |
| （截面库管理） | `Model.AddBeamSection(s)` / `Model.AddColumnSection(s)` / `Model.AddWallSection(s)` | 按构件类型分别管理截面 |

### 荷载

| V2 字段 | PKPM API | 说明 |
|---|---|---|
| `load_cases` | `Model.AddUserLoadCase(LoadCaseData)` | `LoadCaseData.Set(name, kind, type)` |
| `load_cases[].loads`（板荷载） | `Slab.AddLoad(PlateLoadData)` | 面荷载：`PlateLoadData.SetPlateLoadData(...)` |
| `load_cases[].loads`（线荷载） | `StandFloor.AddLineLoad(...)` | 线荷载分布 |
| `load_cases[].loads`（点荷载） | `StandFloor.AddPointLoad(...)` | 集中荷载 |

### 特殊构件属性（V2 → `extensions.pkpm`）

| PKPM API | 对应 V2 位置 | 说明 |
|---|---|---|
| `SpecialBeam` | `extensions.pkpm` / `elements[].extra` | 连梁刚度折减、扭矩折减、约束支撑等 |
| `SpecialColumn` | `extensions.pkpm` / `elements[].extra` | 角柱、转换柱、门式钢柱、剪力系数等 |
| `SpecialWall` | `extensions.pkpm` / `elements[].extra` | 连梁折减系数、最小配筋率等 |

> [!NOTE]
> PKPM 的 `ProjectPara` 和 `SysInfoDetail` 使用**基于索引的参数存取**（`GetPara_Int(index)`、`GetPara_Double(index)`）。
> 具体索引号含义请参阅 PKPM API 说明文档中的《PKPM结构数据SQLite化数据表及字段说明.pdf》。
> 这些参数在 V2 Schema 中通过 `extensions.pkpm` 字典传递，后续由 PKPM 适配器负责映射到具体索引。

---

## 版本与兼容性策略

- **Schema 版本**：语义化版本号（`主版本.次版本.修订号`）
- **V1 → V2 迁移**：V1 载荷可通过 `structure_protocol.migrations` 中的辅助函数迁移到 V2（`migrate_structure_model_v1`）；参见该模块获取当前迁移入口和支持的源版本——新字段通常默认为 `None`/空
- **前向兼容**：`extensions` 和 `extra` 字典中的未知字段会被保留，不做校验
- **破坏性变更**：仅在 `主版本` 号变更时引入
