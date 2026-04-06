---
id: visualization-buckling-mode
structureType: unknown
zhName: 屈曲模态动画
enName: Buckling Mode Animation
zhDescription: 在三维场景中叠加线性屈曲分析的各阶模态形状，以循环动画方式呈现结构失稳变形，并在视口标注每阶屈曲因子 λ，辅助稳定性评估。
enDescription: Overlays linear buckling mode shapes on the 3D scene as looping animations, annotating each mode with its buckling factor λ to assist stability assessment.
triggers: ["屈曲","失稳","屈曲模态","屈曲因子","buckling","eigenvalue","λ","稳定性","稳定验算","模态形状","临界荷载","critical load","buckling mode","失稳模态","整体稳定","局部屈曲"]
stages: ["analysis"]
autoLoadByDefault: false
domain: visualization
---
# 屈曲模态动画

本技能在三维结构场景中叠加线性屈曲分析（特征值屈曲）的模态形状，以循环动画呈现结构失稳形态。

**功能说明：**
- 支持多阶模态切换（第 1 阶、第 2 阶……）
- 每阶模态在视口左上角标注屈曲因子 λ（临界荷载倍数）
- 动画振幅可调节（防止过大变形遮挡原始结构）
- 模态形状以节点位移向量叠加在未变形模型上

**数据来源：** `bucklingModes[]`（来自 `extractVisualizationHints()`），每条记录包含：
- `lambda`：屈曲因子
- `modeShape`：各节点的归一化位移向量 `[dx, dy, dz]`

**依赖：** 需要分析技能（如 `opensees-nonlinear`）输出包含屈曲特征值的结果数据。当分析结果不含屈曲数据时，本技能自动跳过渲染。

> `autoLoadByDefault: false` — 仅当分析结果包含屈曲数据时，由 agent 按需激活。
