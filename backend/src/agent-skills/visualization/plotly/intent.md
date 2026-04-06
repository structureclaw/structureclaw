---
id: visualization-plotly-charts
structureType: unknown
zhName: Plotly 交互图表
enName: Plotly Interactive Charts
zhDescription: 将分析结果以 Plotly 交互图表呈现，支持荷载-位移曲线、模态频率直方图、内力包络折线图与反应谱曲线，可在图表内缩放、平移和导出数据。
enDescription: Renders analysis results as Plotly interactive charts including load-displacement curves, modal frequency histograms, force envelope line charts, and response spectrum curves with in-chart zoom, pan, and data export.
triggers: ["折线图","荷载-位移","荷载位移曲线","模态频率","包络图","反应谱","chart","plotly","交互图","图表","曲线","load-displacement","frequency chart","force envelope","response spectrum","滞回曲线","pushover"]
stages: ["analysis"]
autoLoadByDefault: true
domain: visualization
---
# Plotly 交互图表

本技能将结构分析结果以 Plotly 交互图表的形式呈现，支持以下图表类型：

| 图表类型 | 数据来源 | 说明 |
|----------|----------|------|
| 荷载-位移曲线 | `pushoverCurve` | Pushover 静力非线性分析结果 |
| 模态频率直方图 | `modalFrequencies` | 各阶模态频率与周期 |
| 内力包络折线图 | `forceEnvelope` | 各工况轴力/剪力/弯矩包络 |
| 反应谱曲线 | `responseSpectrum` | 设计谱与计算谱对比 |
| 滞回曲线 | `hysteresisCurve` | 非线性动力分析耗能曲线 |

图表数据由后端 `extractVisualizationHints()` 中的 `plotlyChartSpec` 字段提供，格式为标准 Plotly Figure JSON。

前端依赖：`react-plotly.js` / `plotly.js-dist-min`（按需懒加载）。
