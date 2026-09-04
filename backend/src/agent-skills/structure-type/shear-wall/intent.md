# Shear Wall Skill – Intent Detection

## Purpose
This skill identifies user intents for reinforced concrete shear wall structures and frame–shear wall dual systems (including core walls / core tubes modeled as wall assemblies). It extracts wall layout, openings, thickness, and seismic design intent from natural language descriptions.

## Scope
- **In scope**: Reinforced concrete shear wall structures, frame–shear wall (框剪) dual systems, coupled wall lines with openings, core wall assemblies approximated by wall piers and coupling beams.
- **Out of scope**: Masonry walls, non-seismic retaining walls, slabs on grade, prestressed walls, detailed finite-strip or shell refinement of wall panels.

## Detection Keywords
| English | Chinese | Notes |
|---------|---------|-------|
| shear wall | 剪力墙 | Primary trigger |
| shear-wall / shearwall | 剪力墙 | Hyphen variants |
| wall frame / wall-frame | 墙式框架 / 框剪 | Dual system |
| coupled wall | 连肢墙 | |
| core wall / core tube | 核心筒 | |
| 抗震墙 | 抗震墙 | GB 50011 wording |

## Geometry Patterns
- "12-story shear wall, wall length 6 m, thickness 200 mm"
- "剪力墙结构，12层，墙长6m，墙厚200mm，两排洞口"
- "框架剪力墙结构，开洞 1.5m x 2.1m"

## Material Keywords
- Concrete grades: C20–C80 (walls commonly C30–C50)
- Rebar grades: HPB300, HRB400, HRB500

## Seismic Keywords
- 抗震等级 一级/二级/三级/四级 (seismic grade 1–4)
- 设防烈度 6/7/8/9 度 (intensity), 场地类别, 设计地震分组
- 底部加强部位 (bottom strengthened zone), 约束边缘构件 / 构造边缘构件 (boundary elements)

## Detection Logic
1. If the message contains any shear wall keyword → `shear-wall`
2. The shear-wall route wins over generic `frame` / `concrete-frame` routing because 剪力墙 explicitly defines the lateral system.
3. If the current state already has `structuralTypeKey: 'shear-wall'` → retain `shear-wall`.

## Confidence Levels
- **High**: explicit 剪力墙 / shear wall with story count or wall geometry.
- **Medium**: 框剪 / wall-frame wording without geometry.
- **Low**: only "墙" without structural context (no routing — generic flow).

## Fallback
If the user needs shell/plate refinement of wall panels, direct them to JSON model input; this skill works with the equivalent-frame wall idealization (wall piers + coupling beams).
