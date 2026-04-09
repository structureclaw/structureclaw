# Draft

- 必填参数：`spanLengthM`, `heightM`, `loadKN`
- 建议参数：`loadType`, `loadPosition`

## 参数提取规则

### spanLengthM（跨度）
- "跨度24m" / "span 18m" / "跨度18米" → `"spanLengthM": 24` / `"spanLengthM": 18`
- "24m跨度" / "24米跨度" → `"spanLengthM": 24`

### heightM（高度/柱高）
- "高度8m" / "高8m" / "height 7.5m" → `"heightM": 8` / `"heightM": 7.5`
- "柱高6m" → `"heightM": 6`

### loadKN（荷载大小）
- "屋面荷载6kN/m" / "荷载10kN/m" → `"loadKN": 6` / `"loadKN": 10`
- "8kN" / "roof load 8kN" → `"loadKN": 8`
- 注意：kN/m 中的数值是线荷载集度，仍写入 loadKN

### loadType（荷载类型）
- "均布荷载" / "distributed" / "屋面荷载" → `"loadType": "distributed"`
- "集中力" / "point load" / "点荷载" → `"loadType": "point"`
- 门式刚架默认 `"loadType": "distributed"`

## 荷载位置映射
- 柱顶节点点荷载可映射为 `top-nodes`
- 檐梁均布荷载可映射为 `full-span`

## 输出规则
- 必须同时输出所有已识别的参数，不能遗漏
- 若 Known draft state 已有部分参数，新输出必须保留原有值并补充新值
- 若用户只补充新参数（如只说"荷载10kN/m"），draftPatch 中仍需包含之前已确认的 spanLengthM 和 heightM
