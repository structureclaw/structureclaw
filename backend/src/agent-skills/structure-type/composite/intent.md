# Composite Skill – Intent Detection

## Purpose
This skill identifies user intents for steel-concrete composite structures: composite beams (steel profile acting with a concrete slab through shear studs), composite columns (SRC / CFT), and frames built from them.

## Scope
- **In scope**: Steel-concrete composite beams with concrete flanges, composite frames, SRC (型钢混凝土) and CFT (钢管混凝土) members at the design-basis level, shear stud layout clarification.
- **Out of scope**: Pure steel frames (use the `frame` skill), plain reinforced concrete frames (use the `concrete-frame` skill), timber-concrete systems, detailed finite-element slab modeling.

## Detection Keywords
| English | Chinese | Notes |
|---------|---------|-------|
| composite | 组合 | Standalone word |
| steel-concrete composite | 钢-混凝土组合 | Primary trigger |
| composite beam | 组合梁 | |
| composite column | 组合柱 | |
| SRC / steel reinforced concrete | 型钢混凝土 / 钢骨混凝土 | |
| CFT / concrete-filled tube | 钢管混凝土 | |

## Geometry Patterns
- "6 m composite beam with a 150 mm slab and HN400x200 steel section"
- "组合梁，跨度6m，混凝土板厚150mm，钢梁 H400X200，栓钉 φ19"
- "组合框架，2层，层高3.6m，跨度6m"

## Detection Logic
1. If the message contains 组合结构/组合梁/组合柱/型钢混凝土/钢管混凝土 or "composite" → `composite`
2. The composite route wins over `beam`/`frame` routing because the composite action defines the design basis.
3. If the current state already has `structuralTypeKey: 'composite'` → retain `composite`.

## Fallback
If the user only mentions a bare steel beam or plain concrete beam, the `beam`/`concrete-frame` skills are more appropriate.
