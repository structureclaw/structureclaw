# Intent — DXF/CAD Structural Drawing Parsing

This skill activates when the user uploads a DXF file from CAD software (AutoCAD, PKPM, ETABS export, etc.).

## When to Use

- User uploads a `.dxf` file
- User says "我上传了一个CAD图" / "I uploaded a CAD drawing"
- User mentions wanting to read structural geometry from a floor plan or elevation

## Parsing Workflow

1. Call `analyze_file` with the DXF file path
2. The tool extracts:
   - **LINE entities**: source-DXF `(x1,y1,z1) → (x2,y2,z2)` coordinates and layer names representing structural members or grid lines
   - **TEXT/MTEXT entities**: annotations with values (dimensions, labels)
3. Interpret the geometry:
   - Parallel line pairs: potential beam or column layout
   - Grid spacing derived from TEXT annotations: span lengths, story heights
   - Layer names (if present): identify structural vs. architectural elements
4. Resolve the drawing view and source-to-global axis mapping before extracting dimensions:
   - confirmed elevation/section: source drawing X → global X, source drawing Y → global Z, global Y = 0;
   - confirmed plan: source drawing X/Y → global X/Y, with global Z supplied by an explicit story elevation;
   - confirmed 3D DXF: use source X/Y/Z only after its WCS and vertical axis are documented;
   - ambiguous plan/elevation/perspective: ask the user; never infer 2D/3D from nonzero source Y or silently swap Y/Z.
5. Apply declared DXF insertion units when present, then call `extract_draft_params` with values in meters.

## Unit Handling

Use the parsed `$INSUNITS` value when it is declared. If the file is unitless, the header is absent, or the drawing annotations conflict with it, ask the user to confirm units. Coordinate magnitude may be reported as a clue, but must not silently choose mm, m, or inch.

## Limitations

- This parser handles ASCII DXF; binary DXF may not be fully supported
- Complex entities (HATCH, SPLINE, BLOCK references) are ignored
- 3D structural models (from ETABS/PKPM 3D export) may need to specify which view/layer

## Output

Extracted geometry parameters are passed to `extract_draft_params`.
Complex geometries are summarized and presented to the user for confirmation before proceeding.
