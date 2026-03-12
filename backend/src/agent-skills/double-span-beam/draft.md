---
id: double-span-beam
structureType: double-span-beam
zhName: 双跨梁
enName: Double-Span Beam
zhDescription: 双跨梁草模生成 skill。
enDescription: Double-span beam draft generation skill.
triggers: ["double-span","双跨梁","连续梁"]
stages: ["draft"]
autoLoadByDefault: true
---
# Draft

- 必填参数：`spanLengthM`, `loadKN`
- 建议参数：`loadType`, `loadPosition`
- 中间节点点荷载映射为 `middle-joint`
- 两跨均布荷载映射为 `full-span`
