---
id: portal-frame
structureType: portal-frame
zhName: 门式刚架
enName: Portal Frame
zhDescription: 门式刚架需求识别与补参 skill。
enDescription: Skill for portal-frame intent detection and clarification.
triggers: ["portal frame","门式刚架","frame","框架","steel frame","钢框架","portal","门架","刚架"]
stages: ["intent","draft","analysis","design"]
autoLoadByDefault: true
---
# Intent

- 适用于单榀门式刚架或刚架近似问题。
- 优先确认每跨跨度、柱高、控制荷载。
- 普通 frame 可先收敛到 portal-frame 近似。
