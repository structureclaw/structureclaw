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

## engineeringDraft（复杂门架优先使用）
- 复杂几何和多个荷载优先输出顶层 `engineeringDraft`，旧字段可同时输出但不要丢失 `engineeringDraft`。
- 跨度数组写入 `engineeringDraft.geometry.spanLengthsM`，檐口/柱高写入 `engineeringDraft.geometry.heightM`。
- 若存在夹层、平台或 intermediate floor，高度写入 `engineeringDraft.geometry.mezzanineHeightM`。
- 屋面/檩条/刚架梁线荷载作为独立 `engineeringDraft.loads` 条目，`kind: "line"`，`unit: "kN/m"`，`target: "roof"`。
- 夹层梁/平台梁线荷载作为独立 `engineeringDraft.loads` 条目，`kind: "line"`，`unit: "kN/m"`，`target: "mezzanine"`。
- 不要把屋面荷载和夹层荷载合并；每个用户明确给出的荷载都必须保留为独立条目。

示例：
```json
{
  "inferredType": "portal-frame",
  "engineeringDraft": {
    "structureType": "portal-frame",
    "geometry": { "spanLengthsM": [18], "heightM": 7, "mezzanineHeightM": 3 },
    "loads": [
      { "kind": "line", "magnitude": 6, "unit": "kN/m", "direction": "gravity", "target": "roof" },
      { "kind": "line", "magnitude": 4, "unit": "kN/m", "direction": "gravity", "target": "mezzanine" }
    ]
  }
}
```

## 荷载位置映射
- 柱顶节点点荷载可映射为 `top-nodes`
- 檐梁均布荷载可映射为 `full-span`

## 输出规则
- 必须同时输出所有已识别的参数，不能遗漏
- 若 Known draft state 已有部分参数，新输出必须保留原有值并补充新值
- 若用户只补充新参数（如只说"荷载10kN/m"），draftPatch 中仍需包含之前已确认的 spanLengthM 和 heightM
