# Draft Workflow — CSV/Excel Input

This document tells the agent **how to use** the helpers exported from
`entry.ts` once a CSV or Excel file has been uploaded. The skill itself
does not call the LLM; it produces a structured patch and leaves the
narration to the agent.

## End-to-end flow

```
[user uploads file] ──▶ analyze_file ──▶ mapCsvToDraftHints
                                              │
                              ┌───────────────┴───────────────┐
                              ▼                               ▼
                  fields (Partial<DraftState>)    unmappedHeaders, warnings
                              │                               │
                              ▼                               ▼
              render as natural-language msg          ask_user_clarification
                              │
                              ▼
                  extract_draft_params({ message })
```

## Step-by-step

1. **Call `analyze_file`** with the uploaded file path. The tool returns
   one of two shapes:
   - CSV/TSV:   `{ type: 'csv',   headers: string[], rows: string[][] }`
   - Excel:     `{ type: 'excel', sheets: { [name]: { headers, rows } } }`

2. **Pass the payload to `mapCsvToDraftHints`** (re-exported from
   `data-input/csv/entry.ts`). The result has four fields:
   - `fields`: a `Partial<DraftState>` patch. Only the keys
     `storyCount`, `storyHeightsM`, `spanLengthM`, `bayWidthsM`,
     `heightM`, `floorLoads` are ever set.
   - `unmappedHeaders`: spreadsheet headers that did not match any
     known field. Empty array means every column was understood.
   - `warnings`: human-readable strings about unit conversion edge
     cases or multi-sheet selection. Surface these to the user when
     non-empty.
   - `selectedSheet` (Excel only): which sheet the mapper chose.

3. **Render `fields` into a short natural-language sentence** (Chinese
   when the conversation is in Chinese, English otherwise). The
   message is what `extract_draft_params` consumes — it does *not*
   accept the patch directly. Examples:

   - `fields = { storyCount: 5, storyHeightsM: [3.5,3.5,3.5,3.5,3.5] }`
     →  `"5 层框架，每层层高 3.5 m"`
   - `fields = { spanLengthM: 9, floorLoads: [{story:1, verticalKN:5, liveLoadKN:2}] }`
     →  `"single-span beam with 9 m span, dead load 5 kN/m, live load 2 kN/m"`

4. **Call `extract_draft_params({ message })`** with the rendered
   message. The normal draft pipeline then merges the values into
   `DraftState` so this skill never bypasses the validation logic the
   rest of the agent already relies on.

5. **If `unmappedHeaders` is non-empty**, call `ask_user_clarification`
   listing those columns and asking which DraftState field they map
   to (or whether they can be ignored). Do not invent a mapping.

6. **If `warnings` is non-empty**, include the warning text in the
   reply or in a clarification turn so the user sees decisions that
   were made on their behalf (e.g. mm→m conversion, sheet selection).

## When to defer to the user

- `unmappedHeaders` contains structurally significant columns
  (material grade, section size, axis labels) — these are *expected*
  to be unmapped because this skill only owns geometry and loads.
  Hand them off to `material`, `section`, or `structure-type` skills
  through the normal clarification turn.
- Excel workbook has two or more sheets whose header counts are tied
  in `selectedSheet`. The warning flags this; ask the user which
  sheet to use.
- A `层高` value lands outside the 1 m–9 m / 1000 mm–9000 mm envelope
  and the warning is present. Confirm with the user before drafting.

## What this skill does **not** do

- Does not call the LLM.
- Does not parse files itself (`analyze_file` does that).
- Does not populate `inferredType`, `structuralTypeKey`, `skillId`,
  material, section, or boundary conditions — those belong to other
  skills.
- Does not write to `DraftState` directly; everything goes through
  `extract_draft_params`.
- Does not produce `floorLoads[].verticalKN = 0` when a column is
  missing — absent columns stay `undefined` so downstream code can
  distinguish "no data" from "explicit zero".
