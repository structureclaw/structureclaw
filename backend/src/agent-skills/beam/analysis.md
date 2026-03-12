---
id: beam
structureType: beam
zhName: 梁
enName: Beam
zhDescription: 梁分析阶段 skill。
enDescription: Beam analysis-stage skill.
triggers: ["beam","梁","悬臂"]
stages: ["analysis"]
autoLoadByDefault: true
---
# Analysis

- 默认分析类型可采用 `static`
- 若用户要求规范校核，可在后续流程补 `designCode`
- 梁荷载形式问题：点荷载或均布荷载
