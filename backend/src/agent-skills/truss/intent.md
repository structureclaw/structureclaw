---
id: truss
structureType: truss
zhName: 桁架
enName: Truss
zhDescription: 平面桁架需求识别与补参 skill。
enDescription: Skill for planar truss intent detection and clarification.
triggers: ["truss","桁架","杆系"]
stages: ["intent","draft","analysis","design"]
autoLoadByDefault: true
---
# Intent

- 适用于平面桁架或杆系近似问题。
- 优先确认长度、荷载大小、受力节点。
- 当前推荐节点点荷载。
