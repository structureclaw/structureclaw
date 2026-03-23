---
id: frame
structureType: frame
zhName: 规则框架
enName: Regular Frame
zhDescription: 规则平面/空间框架需求识别与补参 skill。
enDescription: Skill for regular 2D/3D frame intent detection and parameter clarification.
triggers: ["frame","框架","steel frame","钢框架","moment frame","刚接框架"]
stages: ["intent","draft","analysis","design"]
autoLoadByDefault: true
---
# Intent

- 适用于规则楼层、规则跨布置的 2D 平面框架与 3D 规则轴网框架。
- 优先确认维度、层数、跨数、层高、跨长，以及各层节点荷载。
- 若结构存在退台、缺跨或明显不规则，应改用 JSON 或更具体的节点/杆件描述。
