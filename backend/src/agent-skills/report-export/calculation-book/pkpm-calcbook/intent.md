# PKPM SATWE Calculation Report Export

## When to Use

Activate this skill when the user asks to export or generate a calculation report (计算书) from a completed PKPM SATWE structural analysis. The skill reads analysis results via `APIPyInterface.ResultData` when available, falls back to parsing SATWE `.OUT` result files when it is not, and produces structured JSON, Markdown, Word (.docx), and PDF outputs.

## Prerequisites

- A PKPM SATWE analysis has been completed successfully (JWS project exists with result data).
- The JWS path is provided via `parameters.jws_path` or `model._pkpm_jws_path`.
- Result data is accessible either through the optional `APIPyInterface` Python extension (typically installed via `pkpm-api`) or through SATWE-generated `.OUT` files (WMASS, WZQ, WDISP, WPJ, WGCPJ) for fallback parsing.

## Triggers

- "导出计算书" / "生成计算报告"
- "PKPM report" / "SATWE calculation book"
- "计算书" / "calculation report"

## Output Sections

1. **Modal Analysis (模态分析)**: Periods, rotation angles, torsion ratios
2. **Story Stiffness (层刚度)**: Per-floor stiffness and stiffness ratios
3. **Story Drift (层间位移角)**: Earthquake and wind drift angles
4. **Base Shear (基底剪力)**: Shear-weight ratio
5. **Story Mass (楼层质量)**: Unit mass and mass ratios
6. **Stiffness-Weight Ratio (刚度质量比)**: Frame data
7. **Beam Design Summary (梁设计结果)**: Per-floor counts, max ratios
8. **Column Design Summary (柱设计结果)**: Per-floor counts, max axial compression ratio
9. **Code Exceedance Warnings (超限信息)**: Aggregated from all member types
