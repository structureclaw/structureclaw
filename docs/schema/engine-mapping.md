# Engine Mapping: V2 Schema → Analysis Engines

This document defines how `StructureModelV2` fields map to engine-specific input formats.

---

## Mapping Overview

| V2 Schema Field | OpenSeesPy | PKPM API (`APIPyInterface`) | YJK API / YDB |
|---|---|---|---|
| `project.code_standard` | N/A | `ProjectPara.GetPara_String(...)` | Project/control defaults; currently mostly informational |
| `project.importance_class` | N/A | `ProjectPara.GetPara_Int(...)` (requires string→int conversion mapping: 甲=1, 乙=2, 丙=3, 丁=4) | Project/control defaults; currently mostly informational |
| `structure_system.type` | Model topology | `SysInfoDetail` 参数 | Geometry/model family routing; YDB model topology |
| `structure_system.seismic_grade` | N/A | `Beam.GetSeisGrade()` / `Column.GetSeisGrade()` / `Wall.GetSeisGrade()` (构件级) | Reserved for YJK member/control parameters |
| `site_seismic.intensity` | N/A | `ProjectPara.GetPara_Int(...)` | Reserved for YJK calculation-control parameters |
| `site_seismic.design_group` | N/A | `ProjectPara.GetPara_Int(...)` | Reserved for YJK calculation-control parameters |
| `site_seismic.site_category` | N/A | `ProjectPara.GetPara_Int(...)` | Reserved for YJK calculation-control parameters |
| `site_seismic.characteristic_period` | N/A | `ProjectPara.GetPara_Double(...)` | Reserved for YJK calculation-control parameters |
| `site_seismic.max_influence_coefficient` | N/A | `ProjectPara.GetPara_Double(...)` | Reserved for YJK calculation-control parameters |
| `site_seismic.damping_ratio` | `ops.rayleigh(...)` | `SysInfoDetail.GetDamp_whole()` | Reserved for YJK calculation-control parameters |
| `wind.basic_pressure` | N/A | `ProjectPara.GetPara_Double(...)` | Reserved for YJK wind/control parameters |
| `wind.terrain_roughness` | N/A | `ProjectPara.GetPara_Int(...)` | Reserved for YJK wind/control parameters |
| `stories[].height` | Node coordinates Δz | `RealFloor.GetFloorHeight()` | `Floors_Assemb(..., floor_height_mm)` after m→mm conversion |
| `stories[].elevation` | N/A | `RealFloor.GetBottomElevation()` | Floor inference and mapping metadata |
| `stories[].rigid_diaphragm` | `ops.rigidDiaphragm(...)` | `SysInfoDetail` 参数 | Slab/diaphragm preparation through YJK preprocessing commands |
| `stories[].floor_loads` | N/A | `StandFloor.GetDeadLive()` | `StdFlr_Generate` dead/live floor loads (kN/m²) |
| `nodes` | `ops.node(id, x, y, z)` | `StandFloor.GetNodes()` → `Node.Get()` (x, y) | Standard-floor 2D nodes plus floor/elevation mapping; coordinates converted m→mm |
| `elements` (beam) | `ops.element('elasticBeamColumn', ...)` | `StandFloor.GetBeams()` → `Beam` | YJK beam objects in generated YDB; mapped back through `mapping.json` |
| `elements` (column) | `ops.element('elasticBeamColumn', ...)` | `StandFloor.GetColumns()` → `Column` | YJK column objects in generated YDB; mapped back through `mapping.json` |
| `elements` (wall) | `ops.element('ShellMITC4', ...)` | `StandFloor.GetWalls()` → `Wall` | Not a primary 1.0 YJK extraction focus; reserved/partial |
| `materials[].E` | `ops.uniaxialMaterial('Elastic', ...)` | `MaterialData.getEc()` | Material role/grade mapped to YJK material values when available |
| `materials[].grade` | N/A | `ConcreteGrade` / `ReinforcingbarGrade` / `SteelGrade` 枚举 | YJK material/section definitions for generated members |
| `sections` | `ops.section('Elastic', ...)` / `Fiber` | `BeamSection` / `ColumnSection` / `WallSection` + `SectionKind` + `SectionShape` | YJK beam/column section definitions, including rectangular and steel-shape encodings |
| `load_cases` | `ops.pattern('Plain', ...)` / `UniformExcitation` | `Model.GetUserLoadCase()` → `LoadCaseData` | YJK design load cases extracted after calculation via `YJKSDsnDataPy` |
| `load_combinations` | Manual post-process | `Model.GetAllDesignPara()` / `SysInfoDetail` | Extracted case metadata and envelopes; explicit V2 combinations have partial coverage |
| `analysis_control.p_delta` | `ops.geomTransf('PDelta', ...)` | `SysInfoDetail` 参数 | Reserved for YJK calculation-control parameters |
| `analysis_control.period_reduction_factor` | N/A | `SysInfoDetail` 参数 | Reserved for YJK calculation-control parameters |
| `analysis_control.modal_count` | `ops.eigen(n)` | `SysInfoDetail` 参数 | Reserved for YJK modal/control parameters |
| `extensions.pkpm` | N/A | `SysInfoDetail` / `ProjectPara` 专有参数 | N/A |
| `extensions.yjk` | N/A | N/A | Reserved for YJK-specific model/control parameters |

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

## YJK Mapping Details

YJK support in StructureClaw 1.0 is implemented as the `yjk-static` analysis skill. It is a Windows/local-software path that uses the YJK 8.0 installation, the bundled YJK Python 3.10 runtime, and the YJK SDK remote-control APIs.

### Execution Pipeline

The runtime does not import YJK APIs from the backend Python environment. Instead:

1. `runtime.py` normalizes the incoming model, writes `model.json`, and creates a per-run work directory.
2. YJK's bundled Python runs `yjk_driver.py`.
3. `yjk_converter.py` converts the V2/compatible model into YDB files and writes `mapping.json`.
4. `yjk_driver.py` starts or attaches to YJK, imports the YDB model, runs repair/preprocessing/calculation commands, and loads `extract_results.py` inside the YJK process.
5. `extract_results.py` writes `results.json` in the current work directory.
6. `yjk_driver.py` normalizes raw YJK ids back to StructureClaw ids and returns the final JSON result.

Default run artifacts are written under the configured YJK work directory. In StructureClaw 1.0 that comes from `settings.json` (`yjk.workDir`) or the runtime default `<runtimeBaseDir>/analysis/yjk`; lower-level `YJK_WORK_DIR` remains an adapter override for direct runtime/debug usage.

### Model Mapping

| V2 concept | YJK path | Notes |
|---|---|---|
| Coordinate system | global z-up to YJK floor/plan coordinates | V1-compatible frame models are migrated from y-vertical to z-up before conversion |
| Story heights | YJK floor assembly height in mm | V2 stores meters; converter multiplies by 1000 |
| Floor loads | standard-floor dead/live loads | kN/m² passes through |
| Nodes | standard-floor plan nodes plus story metadata | `mapping.json` records V2 id, YJK node id, coordinates, floor, and fallback matching data |
| Beams/columns/braces | generated YJK members | Member metadata includes YJK ids, floor, endpoints, original floor/no, and sequence fallback |
| Sections | YJK section definitions | Beam/column sections are mapped by role and shape data |
| Materials | YJK material values where available | Grade/category mapping is handled by the converter where supported |

### Result Mapping

The extracted and normalized result contract includes:

| Output field | Content |
|---|---|
| `displacements` | controlling per-node displacement map, keyed by StructureClaw node id where mapping succeeds |
| `reactions` | controlling per-node reaction map |
| `forces` | controlling per-element force map |
| `caseResults` | per-load-case displacements, reactions, forces, and case metadata |
| `envelope` | global maxima such as max displacement, axial force, shear force, moment, and reaction |
| `envelopeTables.nodeDisplacement` | per-node displacement envelopes with controlling cases |
| `envelopeTables.elementForce` | per-element force envelopes with controlling cases |
| `envelopeTables.nodeReaction` | per-node reaction envelopes with controlling cases |
| `yjk_detailed.floor_stats` | floor-level stiffness and shear-capacity statistics when YJK APIs return them |
| `warnings` | result-mapping and extraction caveats, including raw-id fallbacks or empty result blocks |

### Current 1.0 Limits

- Primary analysis type: `static`.
- Primary model families: `frame` and `generic`.
- Commercial engine availability depends on local YJK installation, bundled Python, authorization state, and Windows desktop/runtime behavior.
- Result richness depends on YJK API availability in the installed version. The extractor records API failures in `extraction-debug.json` and returns warnings when key blocks are empty.
- Explicit V2 load-combination mapping and full wall/shear-wall result extraction are outside the primary 1.0 path.

---

## Versioning & Compatibility Strategy

- **Schema version**: Semantic versioning (`MAJOR.MINOR.PATCH`)
- **V1 → V2 migration**: V1 payloads can be migrated to V2 via helpers in `structure_protocol.migrations` (`migrate_structure_model_v1`); see that module for the current migration entrypoints and supported source versions — new fields typically default to `None`/empty
- **Forward compatibility**: Unknown fields in `extensions` and `extra` dicts are preserved without validation
- **Breaking changes**: Only in `MAJOR` version bumps

