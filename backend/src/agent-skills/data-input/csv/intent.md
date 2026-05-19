# Intent — CSV/Excel Structural Parameter Input

This skill activates when the user uploads or references a CSV/TSV or Excel file containing structural parameters.

## When to Use

- User uploads a `.csv`, `.tsv`, `.xls`, or `.xlsx` file
- User says "我上传了一个结构参数表" / "I uploaded a structural parameter spreadsheet"
- User mentions column names like 楼层/story, 层高/height, 恒载/dead load, 活载/live load

## Parsing Workflow

1. Call `analyze_file` with the uploaded file path.
   - CSV/TSV returns `{ headers: string[], rows: string[][] }`
   - Excel returns `{ sheets: Record<sheetName, { headers, rows }> }`
2. Use `mapCsvToDraftHints` (exported from `data-input/csv/entry.ts`) to translate
   the analyze_file payload into:
   - `fields`: a `Partial<DraftState>` patch
   - `unmappedHeaders`: column names that did not match any known DraftState field
   - `warnings`: unit / shape problems worth surfacing to the user
   - `selectedSheet` (Excel only): which sheet the mapper picked
3. Render `fields` as a short natural-language summary (Chinese or English)
   and pass that summary as the `message` argument of `extract_draft_params`.
   `extract_draft_params` only accepts `{ message, locale? }`; it does not
   accept already-mapped parameter objects.
4. If `unmappedHeaders` is non-empty, call `ask_user_clarification` so the
   user can confirm the meaning of those columns.

## Column Recognition

| Spreadsheet column (中/英)            | DraftState field                |
|----------------------------------------|---------------------------------|
| 楼层 / 层号 / story / storey / level   | `storyIndex` (row grouping key) |
| 层数 / 总层数 / story count            | `storyCount`                    |
| 层高 / story height / floor height     | `storyHeightsM[]` (mm→m auto)   |
| 跨度 / span / bay width                | `spanLengthM` or `bayWidthsM[]` |
| 总高 / 高度 / height                   | `heightM`                       |
| 恒载 / 恒荷载 / dead load / DL         | `floorLoads[].verticalKN`       |
| 活载 / 活荷载 / live load / LL         | `floorLoads[].liveLoadKN`       |
| 风载X / wind X / lateral X             | `floorLoads[].lateralXKN`       |
| 风载Y / wind Y / lateral Y             | `floorLoads[].lateralYKN`       |

Unknown headers are returned in `unmappedHeaders` for clarification.

## Unit Handling

- `层高` values in the range 1000–9000 are treated as millimetres and divided
  by 1000 before being stored as `storyHeightsM` (metres).
- Values in the range 1–9 are treated as metres.
- Cells with explicit units (`3500mm`, `3.5 m`, `5 kN/m²`) are parsed and
  normalised; unknown units appear in `warnings`.
- Empty cells, `N/A`, `—`, `-` are treated as missing, not as zero.

## Error Handling

- If headers cannot be mapped: report `unmappedHeaders` via
  `ask_user_clarification`.
- If a required column is missing: ask the user to provide it directly.
- Excel multi-sheet: the mapper picks the sheet whose header row matches the
  most known fields. If the choice is ambiguous, surface this via a warning
  and ask the user which sheet to use.

## Output

`fields` is a `Partial<DraftState>` patch (using real DraftState field names:
`storyCount`, `storyHeightsM`, `floorLoads`, `spanLengthM`, `heightM`, etc.).
The skill never calls `extract_draft_params` with a structured payload — it
renders `fields` into a natural-language `message` first, so the regular
draft extraction path stays the single source of truth.
