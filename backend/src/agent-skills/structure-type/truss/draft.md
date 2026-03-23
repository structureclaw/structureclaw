---
id: truss
structureType: truss
zhName: 桁架
enName: Truss
zhDescription: 桁架草模生成 skill。
enDescription: Truss draft generation skill.
triggers: ["truss","桁架"]
stages: ["draft"]
autoLoadByDefault: true
---
# Draft

- 必填参数：`lengthM`, `loadKN`
- 建议参数：`loadType`, `loadPosition`
- 受力节点可映射为 `free-joint`
