---
id: frame
structureType: frame
zhName: 规则框架
enName: Regular Frame
zhDescription: 规则框架草模生成 skill。
enDescription: Draft-generation skill for regular frame models.
triggers: ["frame","框架","steel frame","钢框架","moment frame","刚接框架"]
stages: ["draft","analysis","design"]
autoLoadByDefault: true
---
# Draft

- 2D 框架固定收集：维度、层数、跨数、各层层高、各跨跨度、各层节点荷载。
- 3D 框架固定收集：维度、层数、X/Y 向跨数、各层层高、X/Y 向各跨跨度、各层节点荷载。
- 第一版只生成默认钢材、默认柱截面和默认梁截面，便于后续在 JSON 里继续手改。
- 对 `floorLoads`，优先把自然语言映射为统一楼层荷载数组：
  - `每层节点荷载都是1000kN` -> `floorLoads[].verticalKN = 1000`
  - `每层竖向荷载1000kN` -> `floorLoads[].verticalKN = 1000`
  - `水平荷载500kN` -> 2D 框架优先映射为 `floorLoads[].lateralXKN = 500`
  - `x、y向水平荷载都是500kN` 或 `x/y向水平荷载各为500kN` -> `floorLoads[].lateralXKN = 500` 且 `floorLoads[].lateralYKN = 500`
- 若消息中明确出现 `y向水平荷载`、`x、y向`、`x/y向` 等双向水平荷载语义，应优先输出 `frameDimension = "3d"`。
