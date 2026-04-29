# Draft

- 2D 框架核心收集：维度、层数、跨数、各层层高、各跨跨度、各层总荷载。
- 3D 框架核心收集：维度、层数、X/Y 向跨数、各层层高、X/Y 向各跨跨度、各层总荷载。
- 材料牌号、柱截面、梁截面属于优先提取项，但**不是阻塞项**。若用户未给出，可继续完成 draft，并由交互层推荐默认值。

## 材料牌号（frameMaterial）
- 识别关键词：材料、钢材、混凝土、牌号、采用、选用，后接 Q355/Q345/Q235/Q390/Q420/S355/A36 或 C30/C35/C40 等。
- 示例：`材料Q355` → `"frameMaterial": "Q355"`；`采用Q345钢` → `"frameMaterial": "Q345"`；`C30混凝土` → `"frameMaterial": "C30"`。
- 若缺失：允许留空，由后续默认建议补为 Q355（GB 50017 钢框架常用）。

## 截面规格（frameColumnSection / frameBeamSection）
- 柱截面：识别"柱截面 HW350x350"、"HW350x350 柱"、"柱截面 400x400"、"column section 400x400" 等写法。
- 梁截面：识别"梁截面 HN400x200"、"HN400x200 梁"、"梁截面 250x600"、"beam section 250x600" 等写法。
- 常见柱截面：HW300X300（≤5层）、HW350X350（6-10层）、HW400X400（>10层）。
- 常见梁截面：HN300X150（≤5层）、HN400X200（6-10层）、HN500X200（>10层）。
- 矩形截面可用 `400X400`、`250X600`、`RECT400X400`、`B400H400` 等写法，输出时统一为 `400X400` 这类大写 X 分隔格式。
- 截面名称统一用大写 X 分隔（如 HW350X350、400X400），输出时保持该格式。
- 若缺失：允许留空，由后续默认建议按层数推荐截面。

## 不等跨跨度数组
- 若用户明确给出各跨不同尺寸，应输出完整数组而非标量。
- 示例：`x向3跨跨度分别6m、9m、6m` → `"bayCountX": 3, "bayWidthsXM": [6, 9, 6]`。
- 示例：`y向2跨，5m和7m` → `"bayCountY": 2, "bayWidthsYM": [5, 7]`。
- 若各跨相同：`每跨6m` → `"bayWidthsXM": [6, 6, 6]`（repeat scalar）。

## 坐标语义
- 坐标约定：X、Y 为水平方向，Z 为竖向（global-z-up）。
- 2D 框架：使用 X-Z 平面，X 为跨度方向，Z 为层高/竖向荷载方向。
- 3D 框架：X 和 Y 为柱网两个水平方向，Z 为层高和竖向荷载方向。

## 荷载提取
- 对 `floorLoads`，优先把自然语言映射为统一的各层总荷载数组（单位 kN）：
  - `每层节点荷载都是1000kN` → `floorLoads[].verticalKN = 1000`
  - `每层竖向荷载1000kN` 或 `每层竖向1000kN` → `floorLoads[].verticalKN = 1000`
  - `水平荷载500kN` → 2D 框架优先映射为 `floorLoads[].lateralXKN = 500`
  - `x、y向水平荷载都是500kN` → `lateralXKN = 500` 且 `lateralYKN = 500`
- 若用户只给出面荷载/线荷载（如 `12kN/m²`、`8kN/m`）且没有足够换算信息，不要臆造 `floorLoads`；先保留几何与已识别语义，并继续追问各层总荷载（kN）。
- 若消息中明确出现 `y向水平荷载`、`x、y向`、`x/y向` 等双向水平荷载语义，应优先输出 `frameDimension = "3d"`。
- 若没有任何 Y 向证据，默认按 `2d` 收敛，而不是把 `frameDimension` 留空。

## 柱脚边界（frameBaseSupportType）
- 识别：`柱脚固定`、`柱脚固结`、`fixed base` → `"frameBaseSupportType": "fixed"`
- 识别：`柱脚铰接`、`base pinned` → `"frameBaseSupportType": "pinned"`
- 默认推荐：fixed。

## 几何规则框架识别
- `三层` / `3层` → `storyCount = 3`
- `每层3m` / `层高3m` → `storyHeightsM = [3, 3, 3]`
- `x方向4跨，间隔3m` → `bayCountX = 4`, `bayWidthsXM = [3, 3, 3, 3]`
- `y方向3跨间隔也是3m` → `bayCountY = 3`, `bayWidthsYM = [3, 3, 3]`
- 如果只能稳定识别统一标量，也应输出最终数组字段，而不是让用户继续手动逐层逐跨补全。
