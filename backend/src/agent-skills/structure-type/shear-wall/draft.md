# Shear Wall Skill – Draft Extraction

## Purpose
Extract a shear wall (or frame–shear wall) draft from a natural language description and normalize it into canonical draft fields.

## Input Format
- "10层剪力墙结构，层高3m，墙总长6m，墙厚200mm，C40混凝土，HRB400钢筋，8度设防，开洞1.5x2.1m 洞口2个"
- "A 10-story shear wall, story height 3 m, wall length 6 m, thickness 200 mm, two openings 1.5 m wide x 2.1 m high"

## Output Format
A `DraftExtraction` JSON object with the following keys:

### Geometry (shared frame keys)
| Key | Type | Example | Notes |
|-----|------|---------|-------|
| `storyCount` | `number` | `10` | Number of stories. |
| `storyHeightsM` | `number[]` | `[3, 3, ...]` | Length must equal `storyCount`. Scalar `storyHeightM` is expanded. |
| `floorLoads` | `Array<{ story, verticalKN?, liveLoadKN?, lateralXKN? }>` | `[{ story: 1, verticalKN: -500, lateralXKN: 120 }]` | Per-story total loads. Scalar `verticalLoadKN`/`lateralXKN` are expanded per story. |

### Wall-specific keys
| Key | Type | Example | Notes |
|-----|------|---------|-------|
| `wallLengthM` | `number` | `6` | Total length of the wall line (m). |
| `wallThicknessMm` | `number` | `200` | Wall thickness (mm). Omit to let the skill estimate per GB/T 50011 6.4.1. |
| `wallConcreteGrade` | `string` | `"C40"` | Concrete grade (C20–C80). Default `"C30"`. |
| `wallRebarGrade` | `string` | `"HRB400"` | Rebar grade. Default `"HRB400"`. |
| `wallOpenings` | `Array<{ xM?, widthM, heightM, sillM? }>` | `[{ xM: 2.25, widthM: 1.5, heightM: 2.1, sillM: 0 }]` | Openings along the wall line; `xM` is the offset from the wall start (m). |
| `seismicGrade` | `string` | `"二级"` | Antiseismic grade 一级/二级/三级/四级 (or 1–4). |
| `siteSeismic` | `object` | `{ intensity: 8, designGroup: '第二组', siteCategory: 'II' }` | Optional site seismic parameters. |

## Extraction Rules
1. Convert scalar story/bay-like scalars into per-story arrays.
2. Openings without explicit `xM` are laid out evenly between wall ends.
3. `seismicGrade` accepts 一级/二级/三级/四级, 1–4, or English first/second/third/fourth; normalize to Chinese 一级…四级.
4. Wall thickness, seismic grade, concrete/rebar grade are auto-proposable; geometry and loads must come from the user.

## Missing-Field Policy
- Critical: `storyCount`, `storyHeightsM`, `floorLoads`, `wallLengthM`.
- Critical in interactive phase only: `wallThicknessMm`, `wallConcreteGrade`, `wallRebarGrade` (defaults are proposed).
- Optional: `wallOpenings`, `seismicGrade` (derived from intensity when available).
