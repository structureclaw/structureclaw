---
id: portal-frame
structureType: portal-frame
zhName: 门式刚架
enName: Portal Frame
zhDescription: 门式刚架草模生成 skill。
enDescription: Portal-frame draft generation skill.
triggers: ["portal frame","门式刚架","portal","门架","刚架"]
stages: ["draft"]
autoLoadByDefault: true
---
# Draft

- 必填参数：`spanLengthM`, `heightM`, `loadKN`
- 建议参数：`loadType`, `loadPosition`
- 柱顶节点点荷载可映射为 `top-nodes`
- 檐梁均布荷载可映射为 `full-span`
