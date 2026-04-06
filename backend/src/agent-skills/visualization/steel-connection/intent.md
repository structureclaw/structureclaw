---
id: visualization-steel-connection
structureType: steel-frame
zhName: 钢节点连接详图
enName: Steel Connection Detail View
zhDescription: 在三维场景中拾取节点后，弹出连接详图面板，展示螺栓排布、焊缝位置与节点板几何，数据来源于连接验算结果。
enDescription: After picking a node in the 3D scene, pops up a connection detail panel showing bolt pattern, weld bead positions, and gusset plate geometry sourced from connection check results.
triggers: ["钢节点","连接详图","螺栓","焊缝","节点板","steel connection","bolt","weld","gusset","节点构造","连接构造","螺栓排布","焊接详图","钢接头","joint detail"]
stages: ["analysis"]
autoLoadByDefault: false
domain: visualization
---
# 钢节点连接详图

本技能为 SkillHub 可拆卸技能（`skillhub.steel-connection-viz`），需从技能面板手动安装启用。

安装后，在三维结构场景中点击任意节点，将弹出该节点的连接详图面板，包含：
- 螺栓排布（行数 × 列数，间距，边距）
- 焊缝位置与类型（对接焊 / 角焊缝）
- 节点板几何（宽 × 高 × 厚）
- 连接力需求（Fx / Fy / Fz / Mx / My / Mz）

数据来源：`connectionForceMap`（来自 `extractVisualizationHints()`）与 `skillhub.steel-connection-check` 的验算结果。

> 依赖：需先安装 `skillhub.steel-connection-check`。
