# Draft

- 必填参数：`lengthM`, `supportType`, `loadKN`
- 建议参数：`loadType`, `loadPositionM`, `loadPosition`
- 输出 JSON 中使用 `draftPatch`

## 参数提取规则

### lengthM（跨度/长度）
- "6米" / "6m" / "跨度6m" / "span 6m" → `"lengthM": 6`
- "长3米" / "3m long" → `"lengthM": 3`
- "8米" / "8m" → `"lengthM": 8`

### supportType（支座类型）
- "简支" / "simply supported" / "简支梁" → `"supportType": "simply-supported"`
- "悬臂" / "cantilever" / "悬臂梁" → `"supportType": "cantilever"`
- "两端固" / "fixed-fixed" → `"supportType": "fixed-fixed"`
- 未指定支座类型时默认 / Default to `"supportType": "simply-supported"` when unspecified

### loadKN（荷载大小）
- "20kN/m" / "均布荷载20kN/m" → `"loadKN": 20`
- "10kN" / "集中力10kN" → `"loadKN": 10`
- "point load 15kN" → `"loadKN": 15`

### loadType（荷载类型）
- "均布荷载" / "distributed" → `"loadType": "distributed"`
- "集中力" / "point load" / "点荷载" → `"loadType": "point"`

### loadPositionM（荷载位置，距左端偏移）
- "距左端3米" / "at 3m from left end" → `"loadPositionM": 3`
- 当 loadPositionM 有具体数值时，应同时推断 `loadPosition`（如 `"midspan"`、`"free-joint"` 等）

## 荷载位置映射
- 点荷载优先位置：`end` 或 `midspan`
- 均布荷载优先位置：`full-span`

## 输出规则
- 必须同时输出所有已识别的参数，不能遗漏
- 若 Known draft state 已有部分参数，新输出必须保留原有值并补充新值
- 若用户只补充新参数（如只说"20kN"），draftPatch 中仍需包含之前已确认的全部参数
