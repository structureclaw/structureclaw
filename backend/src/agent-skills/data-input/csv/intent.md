# Intent — CSV/Excel Structural Parameter Input

This skill activates when the user uploads or references a CSV or Excel file containing structural parameters.

## When to Use

- User uploads a `.csv`, `.xls`, or `.xlsx` file
- User says "我上传了一个结构参数表" / "I uploaded a structural parameter spreadsheet"
- User references column names like 楼层/story, 截面/section, 荷载/load, 层高/height, 跨度/span

## Parsing Workflow

1. Call `analyze_file` with the uploaded file path to extract headers and row data
2. Identify column mapping using fuzzy matching:
   - 楼层/story/floor/level → `storyCount`
   - 层高/story height/floor height → `storyHeight`
   - 跨度/span/bay width → `spanLengthM`
   - 截面/section → `sectionId`
   - 恒荷载/dead load/DL → `deadLoad`
   - 活荷载/live load/LL → `liveLoad`
   - 风荷载/wind load/WL → `windLoad`
   - 地震/seismic/EQ → enables seismic analysis
3. Call `extract_draft_params` with the mapped values to populate DraftState
4. Report any unmapped columns to the user for confirmation

## Error Handling

- If headers cannot be mapped: ask the user to confirm column meaning
- If a required column is missing: use `ask_user_clarification`
- If the file has multiple sheets (Excel): ask the user which sheet to use, or process all

## Output

All extracted values are normalized and passed to `extract_draft_params`.
Output conforms to `DraftState` for consumption by structure-type skills.
