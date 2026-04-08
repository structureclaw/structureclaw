# 异形与变截面设计

- `zh`: 当用户描述变截面、异形、偏心、开孔或自定义轮廓截面时使用。
- `en`: Use when the user describes tapered, asymmetric, perforated, or custom-outline sections.
- `zh`: 如果请求里已经有轮廓点、草图 JSON 或多段几何信息，优先把它们保留下来作为后续计算入口。
- `en`: If the request already includes outline points, a sketch JSON, or piecewise geometry, preserve them as the entry point for later calculation.
- `zh`: 这个 skill 的目标是先把不规则几何接住，再逐步补齐可计算的平均几何与材料信息。
- `en`: This skill first catches the irregular geometry, then incrementally fills in computable average geometry and material data.
