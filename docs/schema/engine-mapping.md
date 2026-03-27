# Engine Mapping: V2 Schema → Analysis Engines

This document defines how `StructureModelV2` fields map to engine-specific input formats.

---

## Mapping Overview

| V2 Schema Field | OpenSeesPy | PKPM API (`APIPyInterface`) |
|---|---|---|
| `project.code_standard` | N/A | `ProjectPara.GetPara_String(...)` |
| `project.importance_class` | N/A | `ProjectPara.GetPara_Int(...)` (requires string→int conversion mapping: 甲=1, 乙=2, 丙=3, 丁=4) |
| `structure_system.type` | Model topology | `SysInfoDetail` 参数 |
| `structure_system.seismic_grade` | N/A | `Beam.GetSeisGrade()` / `Column.GetSeisGrade()` / `Wall.GetSeisGrade()` (构件级) |
| `site_seismic.intensity` | N/A | `ProjectPara.GetPara_Int(...)` |
| `site_seismic.design_group` | N/A | `ProjectPara.GetPara_Int(...)` |
| `site_seismic.site_category` | N/A | `ProjectPara.GetPara_Int(...)` |
| `site_seismic.characteristic_period` | N/A | `ProjectPara.GetPara_Double(...)` |
| `site_seismic.max_influence_coefficient` | N/A | `ProjectPara.GetPara_Double(...)` |
| `site_seismic.damping_ratio` | `ops.rayleigh(...)` | `SysInfoDetail.GetDamp_whole()` |
| `wind.basic_pressure` | N/A | `ProjectPara.GetPara_Double(...)` |
| `wind.terrain_roughness` | N/A | `ProjectPara.GetPara_Int(...)` |
| `stories[].height` | Node coordinates Δz | `RealFloor.GetFloorHeight()` |
| `stories[].elevation` | N/A | `RealFloor.GetBottomElevation()` |
| `stories[].rigid_diaphragm` | `ops.rigidDiaphragm(...)` | `SysInfoDetail` 参数 |
| `stories[].floor_loads` | N/A | `StandFloor.GetDeadLive()` |
| `nodes` | `ops.node(id, x, y, z)` | `StandFloor.GetNodes()` → `Node.Get()` (x, y) |
| `elements` (beam) | `ops.element('elasticBeamColumn', ...)` | `StandFloor.GetBeams()` → `Beam` |
| `elements` (column) | `ops.element('elasticBeamColumn', ...)` | `StandFloor.GetColumns()` → `Column` |
| `elements` (wall) | `ops.element('ShellMITC4', ...)` | `StandFloor.GetWalls()` → `Wall` |
| `materials[].E` | `ops.uniaxialMaterial('Elastic', ...)` | `MaterialData.getEc()` |
| `materials[].grade` | N/A | `ConcreteGrade` / `ReinforcingbarGrade` / `SteelGrade` 枚举 |
| `sections` | `ops.section('Elastic', ...)` / `Fiber` | `BeamSection` / `ColumnSection` / `WallSection` + `SectionKind` + `SectionShape` |
| `load_cases` | `ops.pattern('Plain', ...)` / `UniformExcitation` | `Model.GetUserLoadCase()` → `LoadCaseData` |
| `load_combinations` | Manual post-process | `Model.GetAllDesignPara()` / `SysInfoDetail` |
| `analysis_control.p_delta` | `ops.geomTransf('PDelta', ...)` | `SysInfoDetail` 参数 |
| `analysis_control.period_reduction_factor` | N/A | `SysInfoDetail` 参数 |
| `analysis_control.modal_count` | `ops.eigen(n)` | `SysInfoDetail` 参数 |
| `extensions.pkpm` | N/A | `SysInfoDetail` / `ProjectPara` 专有参数 |

---

## OpenSeesPy Mapping Details

OpenSeesPy operates at the FEM level via the `openseespy.opensees` Python API (`import openseespy.opensees as ops`). The V2 → OpenSeesPy converter uses:

- `nodes` → `ops.node(id, x, y, z)`
- `elements` → `ops.element(type, ...)` (type depends on `element.type`)
- `materials` → `ops.uniaxialMaterial(...)` / `ops.nDMaterial(...)`
- `sections` → `ops.section(...)`
- `load_cases` → `ops.pattern(...)` / `ops.timeSeries(...)`
- `analysis_control.p_delta` → `ops.geomTransf('PDelta', ...)` vs `ops.geomTransf('Linear', ...)`
- `site_seismic.damping_ratio` → `ops.rayleigh(...)` Rayleigh damping setup
- `analysis_control.modal_count` → `ops.eigen(n)`

Higher-level fields like `project`, `structure_system`, `stories` are **informational only** for OpenSeesPy and do not directly translate to API calls.

---

## PKPM API Mapping Details

> **API Reference**: [PKPM 官方 API 发布](https://gitee.com/pkpmgh/pkpm-official---api-release) (`APIPyInterface`, Python 3.8-3.13)

PKPM 通过 `APIPyInterface` 模块提供 Python API，数据模型基于**标准层 (StandFloor) + 自然层 (RealFloor)** 的楼层体系。V2 Schema 到 PKPM API 的映射如下：

### 项目 & 工程参数

| V2 字段 | PKPM API | 说明 |
|---|---|---|
| `project.*` | `Model.GetProjectPara()` → `ProjectPara` | 通过索引号读写 (`GetPara_Int`, `GetPara_Double`, `GetPara_String`) |
| `structure_system.*` | `ProjectPara` + `SysInfoDetail` | 结构类型、抗震等级等通过工程参数索引设置 |
| `site_seismic.*` | `ProjectPara` (索引参数) | 设防烈度、分组、场地类别、特征周期、αmax |
| `wind.*` | `ProjectPara` (索引参数) | 基本风压、粗糙度 |
| `analysis_control.*` | `SysInfoDetail` | 数百个计算控制参数 (阻尼比、P-Δ、周期折减等) |

### 楼层体系

| V2 字段 | PKPM API | 说明 |
|---|---|---|
| `stories[].height` | `RealFloor.GetFloorHeight()` | 自然层层高 |
| `stories[].elevation` | `RealFloor.GetBottomElevation()` | 自然层底标高 |
| `stories[].floor_loads` | `StandFloor.GetDeadLive()` / `SetDeadLive(dead, live)` | 恒/活荷载统一设置 |
| (楼层与标准层映射) | `RealFloor.GetStandFloorIndex()` | 自然层→标准层映射 |

### 构件

| V2 字段 | PKPM API | 说明 |
|---|---|---|
| `nodes` | `StandFloor.AddNode(x, y)` / `GetNodes()` | 2D 坐标 + 标高 (`Node.GetElevation()`) |
| `elements` (beam) | `StandFloor.AddBeam(isect, netID)` / `GetBeams()` | `Beam.GetSect()`, `GetConcreteGrade()`, `GetSteelGrade()`, `GetSeisGrade()` |
| `elements` (column) | `StandFloor.AddColumn(isect, nodeID)` / `GetColumns()` | `Column.GetSect()`, `GetConcreteGrade()`, `GetSteelGrade()`, `GetSeisGrade()` |
| `elements` (wall) | `StandFloor.AddWall(isect, netID)` / `GetWalls()` | `Wall.GetSect()`, `GetConcreteGrade()`, `GetSteelGrade()`, `GetSeisGrade()` |
| `elements` (brace) | `StandFloor.AddBrace(isect, ...)` / `GetBraces()` | `Brace.GetSect()`, `GetConcreteGrade()`, `GetSteelGrade()` |

### 材料

| V2 字段 | PKPM API | 说明 |
|---|---|---|
| `materials[].grade` (concrete) | `ConcreteGrade` 枚举 | C15–C100, 每个构件独立设置 (`Beam.SetConcreteGrade(val)`) |
| `materials[].grade` (rebar) | `ReinforcingbarGrade` 枚举 | HPB235, HPB300, HPB335, HPB400, HRB500, CRB550, CRB600H, HTRB600, HTRB630 |
| `materials[].grade` (steel) | `SteelGrade` 枚举 | Q235–Q690 + GJ 系列, 每个构件独立设置 (`Beam.SetSteelGrade(val)`) |

### 截面

| V2 字段 | PKPM API | 说明 |
|---|---|---|
| `sections[].type` | `SectionKind` 枚举 | 22 种: Rectangle, I, Circle, Box, Tube, Channel, T, L, Trapezoid, 钢管混凝土, 型钢混凝土, 变截面等 |
| `sections[].width/height/...` | `SectionShape` | 几何参数: B/H/D/T/B1/B2/H1/H2/T1/T2/Tw 等 |
| (截面库管理) | `Model.AddBeamSection(s)` / `Model.AddColumnSection(s)` / `Model.AddWallSection(s)` | 分构件类型管理截面 |

### 荷载

| V2 字段 | PKPM API | 说明 |
|---|---|---|
| `load_cases` | `Model.AddUserLoadCase(LoadCaseData)` | `LoadCaseData.Set(name, kind, type)` |
| `load_cases[].loads` (板荷载) | `Slab.AddLoad(PlateLoadData)` | 面荷载: `PlateLoadData.SetPlateLoadData(...)` |
| `load_cases[].loads` (线荷载) | `StandFloor.AddLineLoad(...)` | 线荷载分布 |
| `load_cases[].loads` (点荷载) | `StandFloor.AddPointLoad(...)` | 集中荷载 |

### 特殊构件属性 (V2 → `extensions.pkpm`)

| PKPM API | 对应 V2 位置 | 说明 |
|---|---|---|
| `SpecialBeam` | `extensions.pkpm` / `elements[].extra` | 连梁刚度折减、扭矩折减、约束支撑等 |
| `SpecialColumn` | `extensions.pkpm` / `elements[].extra` | 角柱、转换柱、门式钢柱、剪力系数等 |
| `SpecialWall` | `extensions.pkpm` / `elements[].extra` | 连梁折减系数、最小配筋率等 |

> [!NOTE]
> PKPM 的 `ProjectPara` 和 `SysInfoDetail` 使用**基于索引的参数存取** (`GetPara_Int(index)`, `GetPara_Double(index)`)。
> 具体索引号含义请参阅 PKPM API 说明文档中的《PKPM结构数据SQLite化数据表及字段说明.pdf》。
> 这些参数在 V2 Schema 中通过 `extensions.pkpm` 字典传递，后续由 PKPM 适配器负责映射到具体索引。

---

## Versioning & Compatibility Strategy

- **Schema version**: Semantic versioning (`MAJOR.MINOR.PATCH`)
- **V1 → V2 migration**: V1 payloads can be migrated to V2 via helpers in `structure_protocol.migrations` (`migrate_structure_model_v1`); see that module for the current migration entrypoints and supported source versions — new fields typically default to `None`/empty
- **Forward compatibility**: Unknown fields in `extensions` and `extra` dicts are preserved without validation
- **Breaking changes**: Only in `MAJOR` version bumps

