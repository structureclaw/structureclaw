# Intent

- 将规范校核目标固定为 GB 55002-2021 + GB/T 50011-2010（2024 年版）。
- 适用于中国抗震验算、地震工况相关校核、构件抗震承载力和构造细则复核。
- 不要从用户原文关键词或正则推断工程结论；只把整句语义理解后的内容写入结构化字段，并让 code-check runtime 基于结构化字段给出结论。

## Structured Evidence

当用户、模型、上传表格或分析结果提供构件抗震校核证据时，必须保留为结构化字段，不要只写成自然语言备注：

- `seismicCapacity` / `capacityChecks`: 构件抗震组合承载力、显式利用率、`gammaRE` 或调整后承载力。
- `capacityDesign` / `strongShearWeakBending`: 强剪弱弯、强柱弱梁、节点弯矩关系等能力设计输入。
- `shearCompression`: 混凝土构件剪压比或剪压限值输入。
- `jointCore` / `jointData`: 框架节点核芯区抗震验算、节点箍筋、贯通钢筋约束。
- `flatBeam`, `columnPosition`, `columnCategory`: 梁柱构造、扁梁、柱位置或柱类别相关输入。
- `steelSeismicDetailing` / `steelDetailing` / `seismicDetailing`: 钢梁、钢柱、支撑或耗能梁的长细比、翼缘/腹板/板件宽厚比实际值与项目/规范推导限值。
- `wallData` / `shearWallData` / `boundaryElement` / `boundaryElements`: 抗震墙轴压比、墙厚、分布钢筋和边缘构件构造输入。

EN: Fix the code-check target to GB 55002-2021 plus GB/T 50011-2010 (2024 partial revision). Preserve any member
seismic capacity, detailing, capacity-design, joint-core, wall, or steel detailing evidence as structured fields.
Do not infer engineering compliance from keywords or regex matches in the user text; the runtime decides compliance
from structured inputs only.
