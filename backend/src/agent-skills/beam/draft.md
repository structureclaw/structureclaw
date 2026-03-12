---
id: beam
structureType: beam
zhName: 梁
enName: Beam
zhDescription: 梁草模生成 skill。
enDescription: Beam draft generation skill.
triggers: ["beam","梁","悬臂"]
stages: ["draft"]
autoLoadByDefault: true
---
# Draft

- 必填参数：`lengthM`, `loadKN`
- 建议参数：`loadType`, `loadPosition`
- 输出 JSON 中使用 `draftPatch`
- 点荷载优先位置：`end` 或 `midspan`
- 均布荷载优先位置：`full-span`
