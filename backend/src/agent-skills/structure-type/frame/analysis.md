---
id: frame
structureType: frame
zhName: 规则框架
enName: Regular Frame
zhDescription: 规则框架分析阶段 skill。
enDescription: Analysis-stage skill for regular frames.
triggers: ["frame","框架","steel frame","钢框架","moment frame","刚接框架"]
stages: ["analysis"]
autoLoadByDefault: true
---
# Analysis

- 规则 2D 框架优先采用线弹性 2D frame 路径。
- 规则 3D 框架采用现有 3D frame 路径，不新增专属分析引擎。
- 如果用户要求超出规则化参数建模范围，应明确要求改用 JSON 或更具体的节点/杆件输入。
