---
id: visualization-steel-member-stress
structureType: steel-frame
zhName: 钢构件应力云图
enName: Steel Member Stress Contour
zhDescription: 在三维场景中叠加钢构件截面应力与利用率云图，颜色渐变反映 0%–100%+ 利用水平，辅助强度验算复核。支持 H 型钢、箱形截面、CHS 等常见截面族。
enDescription: Overlays stress and utilization ratio contours on steel members in the 3D scene. Color gradient maps 0%–100%+ utilization level to aid strength check review. Supports H-section, box section, and CHS profiles.
triggers: ["应力云图","利用率","强度验算","钢截面","H型钢","箱形截面","CHS","stress contour","utilization","应力比","截面验算","强度比","钢构件","member stress","钢结构验算"]
stages: ["analysis"]
domain: visualization
---
# 钢构件应力云图

本技能在三维结构场景中叠加钢构件截面应力与利用率云图，颜色渐变映射利用率水平（绿→黄→红），帮助工程师快速识别超限构件。

支持截面族：H 型钢（HN/HW/HM）、箱形截面（□）、圆钢管（CHS）、角钢、槽钢。

数据来源：`memberUtilizationMap`（来自 `extractVisualizationHints()`），键为构件 ID，值为利用率（0~1+）。
