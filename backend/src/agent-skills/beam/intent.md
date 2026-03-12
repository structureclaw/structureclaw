---
id: beam
structureType: beam
zhName: 梁
enName: Beam
zhDescription: 单跨梁或悬臂梁的需求识别与补参 skill。
enDescription: Skill for beam or cantilever intent detection and clarification.
triggers: ["beam","梁","悬臂","girder","主梁","大梁"]
stages: ["intent","draft","analysis","design"]
autoLoadByDefault: true
---
# Intent

- 适用于单跨梁、悬臂梁、简化梁式近似问题。
- 优先确认跨度、控制荷载、荷载形式、荷载位置。
- 若用户只说主梁或 girder，可先按 beam 近似处理。
