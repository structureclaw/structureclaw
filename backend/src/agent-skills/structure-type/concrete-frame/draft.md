# Concrete Frame Skill – Draft Extraction

## Purpose
Extract a regular reinforced concrete frame model from a natural language description.

## Input Format
A single natural language paragraph describing the frame, e.g.:
- "A 3‑story 2‑bay concrete frame, story heights 3.5 m each, bay widths 6 m, concrete C30, rebar HRB400, fixed base."
- "混凝土框架，4层3跨，层高3.6 m，跨度7.2 m，混凝土C40，钢筋HRB400，固接基础。"

## Output Format
A `DraftExtraction` JSON object with the following optional keys (see `constants.ts` for the complete list):

### Geometry
| Key | Type | Example | Notes |
|-----|------|---------|-------|
| `frameDimension` | `"2d"` or `"3d"` | `"2d"` | Inferred from "planar", "space", "3‑d", "三维", etc. |
| `storyCount` | `number` | `3` | Number of stories (above ground). |
| `bayCount` | `number` | `2` | For 2D frames, total number of bays. |
| `bayCountX` | `number` | `3` | For 3D frames, number of bays in X direction. |
| `bayCountY` | `number` | `2` | For 3D frames, number of bays in Y direction. |
| `storyHeightsM` | `number[]` | `[3.5, 3.5, 3.5]` | Each story's height (m). Length must equal `storyCount`. |
| `bayWidthsM` | `number[]` | `[6.0, 6.0]` | For 2D frames, each bay's width (m). Length must equal `bayCount`. |
| `bayWidthsXM` | `number[]` | `[6.0, 6.0, 6.0]` | For 3D frames, bay widths in X direction. Length = `bayCountX`. |
| `bayWidthsYM` | `number[]` | `[5.0, 5.0]` | For 3D frames, bay widths in Y direction. Length = `bayCountY`. |

### Loads & Boundaries
| Key | Type | Example | Notes |
|-----|------|---------|-------|
| `floorLoads` | `Array<{ story: number; verticalKN?: number; lateralXKN?: number; lateralYKN?: number; liveLoadKN?: number }>` | `[{ story: 1, verticalKN: -200, lateralXKN: 50 }]` | Vertical load negative (downward). Lateral loads positive in global X/Y. |
| `frameBaseSupportType` | `"fixed"` or `"pinned"` | `"fixed"` | Default `"fixed"`. |

### Materials & Sections
| Key | Type | Example | Notes |
|-----|------|---------|-------|
| `frameConcreteGrade` | `string` | `"C30"` | Concrete grade (C20–C80). Default `"C30"`. |
| `frameRebarGrade` | `string` | `"HRB400"` | Rebar grade (HPB300, HRB400, HRB500). Default `"HRB400"`. |
| `frameColumnSection` | `string` | `"400X400"` | Column cross‑section description. See section parsing below. |
| `frameBeamSection` | `"string"` | `"300X600"` | Beam cross‑section description. |

### Site, Seismic & Wind
| Key | Type | Example | Notes |
|-----|------|---------|-------|
| `siteSeismic` | `object` | `{ "intensity": 7, "accelerationG": 0.1, "designGroup": "第三组", "siteCategory": "III" }` | Use for PKPM/YJK-style seismic design parameters. Normalize "3类" to `"III"`. |
| `wind` | `object` | `{ "basicPressureKNM2": 0.4, "terrainRoughness": "B" }` | Basic wind pressure in kN/m² and terrain roughness A/B/C/D. |
| `analysisControl` | `object` | `{ "rigidFloor": true, "modalCount": 15 }` | Optional calculation-control values such as rigid diaphragm, modal count, P-Delta. |

## Section Parsing
Concrete frame sections are described as rectangular cross‑sections:

- **Rectangular**: `"400X400"`, `"B400H600"`, `"RECT400X500"` → width × height (mm).
- The parser expects width (B) and height (H) in millimeters.
- Default column section: `"500X500"` for up to 5 stories, `"600X600"` for 6–10 stories, `"700X700"` for >10 stories.
- Default beam section: `"300X600"` for up to 5 stories, `"350X700"` for 6–10 stories, `"400X800"` for >10 stories.

## Extraction Rules
1. **Story/bay numbers**: Look for patterns like "3‑story 2‑bay", "4层3跨".
2. **Dimensions**: Extract numbers followed by "m", "米", "mm", "毫米". Convert mm to m for story heights and bay widths.
3. **Loads**: "dead load 5 kN/m²", "恒载 5 kN/m²", "live load 3 kN/m²", "活载 3 kN/m²". Prefer `engineeringDraft.loads` with `kind: "area"` and `unit: "kN/m2"` when floor geometry is available; the runtime can convert it to per-story total loads. Use legacy `floorLoads` only when the total kN per story is explicitly given or can be computed reliably.
4. **Materials**: Look for concrete grades (C20–C80) and rebar grades (HPB300, HRB400, HRB500).
5. **Seismic / wind design basis**: Extract phrases like "7度0.1g", "第三组", "场地类别3类", "基本风压0.4kN/m²", "地面粗糙度B类".
6. **Boundary**: "fixed base", "pinned base", "固接", "铰接".

## Examples
1. "A 2‑story 1‑bay concrete frame, story heights 4 m, bay width 8 m, concrete C35, rebar HRB400, fixed base."
   → `{ frameDimension: "2d", storyCount: 2, bayCount: 1, storyHeightsM: [4, 4], bayWidthsM: [8], frameConcreteGrade: "C35", frameRebarGrade: "HRB400", frameBaseSupportType: "fixed" }`
2. "混凝土框架，5层4跨，层高3.6 m，跨度6 m，混凝土C40，钢筋HRB500，固接。"
   → `{ frameDimension: "2d", storyCount: 5, bayCount: 4, storyHeightsM: [3.6,3.6,3.6,3.6,3.6], bayWidthsM: [6,6,6,6], frameConcreteGrade: "C40", frameRebarGrade: "HRB500", frameBaseSupportType: "fixed" }`

## Missing Values
If a required key (see `REQUIRED_KEYS` in `constants.ts`) is missing after extraction, the skill will generate interactive questions to fill the gap.
