# Concrete Frame Skill – Intent Detection

## Purpose
This skill identifies user intents for regular reinforced concrete frames (2D or 3D). It extracts geometry, loads, and material parameters from natural language descriptions.

## Scope
- **In scope**: Regular multi‑story, multi‑bay reinforced concrete frames with rectangular grids.
- **Out of scope**: Irregular frames (setbacks, missing bays), mixed steel‑concrete systems, prestressed concrete, seismic‑isolation details.

## Detection Keywords
| English | Chinese | Notes |
|---------|---------|-------|
| concrete frame | 混凝土框架 | Primary trigger |
| reinforced concrete frame | 钢筋混凝土框架 | |
| RC frame | RC框架 | |
| RC building | 钢筋砼建筑 | |
| concrete column and beam | 混凝土柱梁 | |
| concrete moment frame | 混凝土刚接框架 | |
| concrete rigid frame | 混凝土刚性框架 | |
| concrete office building | 混凝土办公楼 | |
| concrete residential building | 混凝土住宅楼 | |
| concrete school | 混凝土学校 | |
| concrete hospital | 混凝土医院 | |

## Geometry Patterns
- "N‑story M‑bay concrete frame"
- "混凝土框架，X层Y跨"
- "RC frame, story heights … , bay widths …"
- "柱网尺寸 … , 层高 …"

## Material Keywords
- Concrete grades: C20, C25, C30, C35, C40, C45, C50, C55, C60, C65, C70, C75, C80
- Rebar grades: HPB300, HRB400, HRB500
- "concrete C30", "HRB400 rebars"

## Load Keywords
- Dead load, live load, wind load, seismic load
- 恒载, 活载, 风荷载, 地震作用

## Boundary Conditions
- Fixed base, pinned base
- 固接, 铰接

## Detection Logic
1. If the message contains any of the detection keywords → `concrete-frame`
2. If the message contains "concrete" or "混凝土" together with "frame", "框架", "柱网", "层跨" → `concrete-frame`
3. If the message includes a concrete grade (C20–C80) and describes a multi‑story building → `concrete-frame`
4. If the current state already has `inferredType: 'concrete-frame'` → retain `concrete-frame`

## Confidence Levels
- **High**: explicit "concrete frame" or "钢筋混凝土框架" with geometry details.
- **Medium**: "concrete" + "column"/"beam" + story/bay numbers.
- **Low**: only "concrete" without clear frame context.

## Fallback
If the structure is clearly irregular (setbacks, missing bays, strong asymmetry), return `unsupported` with a guidance message asking for JSON or explicit node/member descriptions.