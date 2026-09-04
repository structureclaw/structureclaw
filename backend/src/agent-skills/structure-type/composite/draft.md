# Composite Skill – Draft Extraction

## Purpose
Extract a steel-concrete composite structure draft (composite beams acting with concrete slabs through shear studs, with steel columns) and normalize it into canonical draft fields.

## Input Format
- "2层组合框架，层高3.6m，跨度6m，混凝土板厚150mm，钢梁 HN400X200，栓钉 φ19，每层竖向荷载200kN"
- "A 2-story composite frame, story height 3.6 m, span 6 m, 150 mm concrete slab, HN400x200 steel beam, 19 mm shear studs"

## Output Format
A `DraftExtraction` JSON object with the following keys:

### Geometry (shared frame keys)
| Key | Type | Example | Notes |
|-----|------|---------|-------|
| `storyCount` | `number` | `2` | Number of stories. |
| `storyHeightsM` | `number[]` | `[3.6, 3.6]` | Length must equal `storyCount`. Scalar `storyHeightM` is expanded. |
| `bayCount` | `number` | `1` | Number of bays. Scalar spans are expanded per bay. |
| `bayWidthsM` | `number[]` | `[6]` | Bay spans (m). `compositeSpanM`/`spanM` scalars are accepted. |
| `floorLoads` | `Array<{ story, verticalKN?, liveLoadKN?, lateralXKN? }>` | `[{ story: 1, verticalKN: 200 }]` | Per-story total loads. Scalar `verticalLoadKN`/`lateralXKN` are expanded per story. |
| `frameBaseSupportType` | `string` | `"fixed"` | Column base support (`fixed` default or `pinned`). |

### Composite-specific keys
| Key | Type | Example | Notes |
|-----|------|---------|-------|
| `compositeSlabThicknessMm` | `number` | `150` | Concrete flange thickness (mm). Omit to let the skill propose 150 mm. |
| `compositeSlabWidthM` | `number` | `2.4` | Effective flange width (m). Omit to derive from the GB 50017 effective-width rule. |
| `compositeSteelBeamSection` | `string` | `"HN400X200"` | Steel beam profile, standard designation or `H{H}X{B}X{tw}X{tf}`. |
| `compositeSteelColumnSection` | `string` | `"HW300X300"` | Steel column profile. Defaults follow the frame skill column table. |
| `compositeSteelGrade` | `string` | `"Q355"` | Structural steel grade (Q235–Q420). Default `"Q355"`. |
| `compositeConcreteGrade` | `string` | `"C30"` | Flange concrete grade (C20–C60). Default `"C30"`. |
| `compositeStudDiameterMm` | `number` | `19` | Shear stud shank diameter (mm). Default `19`. |
| `siteSeismic` | `object` | `{ intensity: 7, designGroup: '第二组', siteCategory: 'II' }` | Optional site seismic parameters. |

## Extraction Rules
1. Convert scalar story/bay-like scalars into per-story/per-bay arrays; accept `compositeSpanM`, `spanM`, or `bayWidthM` for the bay span.
2. Normalize section designations to uppercase `X`-separated form (`hn400x200` → `HN400X200`).
3. `compositeSteelGrade` accepts Q235/Q345/Q355/Q390/Q420; invalid grades are rejected (not guessed).
4. Slab thickness, steel grade, concrete grade, stud diameter, and sections are auto-proposable; geometry and loads must come from the user.

## Missing-Field Policy
- Critical: `storyCount`, `storyHeightsM`, `bayCount`, `bayWidthsM`, `floorLoads`.
- Critical in interactive phase only: `compositeSlabThicknessMm`, `compositeSteelBeamSection`, `compositeSteelGrade`, `compositeConcreteGrade` (defaults are proposed).
- Optional: `compositeSlabWidthM` (derived), `compositeSteelColumnSection` (defaults by story count), `compositeStudDiameterMm`.
