# Intent — PDF Structural Document Parsing

This skill activates when the user uploads or references a PDF file containing structural drawings or calculation reports.

## When to Use

- User uploads a `.pdf` file (structural drawing, calc report, design spec)
- User says "我上传了一份计算书" / "I uploaded a structural drawing"
- User mentions keywords: 截面尺寸, 荷载规范, 层高, 跨度, 配筋, 钢材型号

## Parsing Workflow

1. Call `analyze_file` with the uploaded PDF path to extract text content
2. From the extracted text, identify structural parameters using pattern matching:
   - Span / 跨度: look for patterns like `L=6m`, `跨度6000mm`, `span 6.0 m`
   - Story height / 层高: `H=3.5m`, `层高3500`, `story height 3.5m`
   - Material grade / 材料: `C30`, `Q345`, `HRB400`, `混凝土强度等级C30`
   - Loads: `恒载 5kN/m²`, `活载 2.0kN/m²`, `dead load 5`, `live load 2`
   - Section dimensions: `截面 300×600`, `B×H=300×600`
3. Call `extract_draft_params` with identified values
4. For unrecognized content: report to user and use `ask_user_clarification`

## Notes on Drawing PDFs

- Scanned PDFs (image-based) will have no extracted text → suggest using image skill or re-upload as a text PDF
- For searchable PDFs with embedded drawings: text extraction still works for annotations and dimensions
- Future enhancement: multimodal LLM vision for drawing comprehension (Phase 3d)

## Output

Extracted parameters are normalized and passed to `extract_draft_params`.
Multi-modal LLM interface is reserved for future drawing comprehension enhancement.
