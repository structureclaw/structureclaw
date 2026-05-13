# Intent — DXF/CAD Structural Drawing Parsing

This skill activates when the user uploads a DXF file from CAD software (AutoCAD, PKPM, ETABS export, etc.).

## When to Use

- User uploads a `.dxf` file
- User says "我上传了一个CAD图" / "I uploaded a CAD drawing"
- User mentions wanting to read structural geometry from a floor plan or elevation

## Parsing Workflow

1. Call `analyze_file` with the DXF file path
2. The tool extracts:
   - **LINE entities**: (x1,y1) → (x2,y2) representing structural members or grid lines
   - **TEXT/MTEXT entities**: annotations with values (dimensions, labels)
3. Interpret the geometry:
   - Parallel line pairs: potential beam or column layout
   - Grid spacing derived from TEXT annotations: span lengths, story heights
   - Layer names (if present): identify structural vs. architectural elements
4. Estimate probable spans from line lengths (unit detection: mm, m, or inch)
5. Call `extract_draft_params` with derived geometry values

## Unit Handling

DXF files may use different drawing units:
- If line lengths are in the range 3000–12000: likely millimeters → divide by 1000 for meters
- If line lengths are in the range 3–12: likely meters → use as-is
- If ambiguous: ask user to confirm units

## Limitations

- This parser handles ASCII DXF; binary DXF may not be fully supported
- Complex entities (HATCH, SPLINE, BLOCK references) are ignored
- 3D structural models (from ETABS/PKPM 3D export) may need to specify which view/layer

## Output

Extracted geometry parameters are passed to `extract_draft_params`.
Complex geometries are summarized and presented to the user for confirmation before proceeding.
