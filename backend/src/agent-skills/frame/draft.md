---
id: frame
structureType: frame
zhName: 规则框架
enName: Regular Frame
zhDescription: 规则框架草模生成 skill。
enDescription: Draft-generation skill for regular frame models.
triggers: ["frame","框架","steel frame","钢框架","moment frame","刚接框架"]
stages: ["draft","analysis","design"]
autoLoadByDefault: true
---
# Draft

- 2D 框架固定收集：维度、层数、跨数、各层层高、各跨跨度、各层节点荷载。
- 3D 框架固定收集：维度、层数、X/Y 向跨数、各层层高、X/Y 向各跨跨度、各层节点荷载。
- 第一版只生成默认钢材、默认柱截面和默认梁截面，便于后续在 JSON 里继续手改。
