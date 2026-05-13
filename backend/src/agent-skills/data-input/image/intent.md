# Intent — Image Structural Information Recognition

This skill activates when the user uploads or references an image file (photo, screenshot, scanned drawing) containing structural information.

## When to Use

- User uploads `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, or `.bmp`
- User says "我上传了一张图片" / "I have a photo/screenshot of the drawing"
- User provides a hand-drawn sketch or photo of a structure on-site
- User uploads a scanned structural drawing (where PDF text extraction is unavailable)

## Vision Workflow

1. Call `analyze_file` with the image path — this returns a `base64DataUri`
2. Pass the `base64DataUri` directly to the multimodal LLM context
3. The LLM will analyze the image for:
   - **Structural members**: columns, beams, slabs, walls, braces
   - **Dimension annotations**: span lengths (L=...), heights (H=...), widths
   - **Material labels**: C30, Q345, HRB400, steel grade markings
   - **Section callouts**: 300×600, HW400×200, circular pipe diameters
   - **Axis/grid**: structural bays and spacings
4. Extract identified values and call `extract_draft_params`

## Image Quality Notes

- Higher resolution images yield better annotation recognition
- Handwritten sketches: focus on overall geometry; dimensions may be approximate
- Photos of real structures: ask user for approximate dimensions since field photos rarely show annotations
- Dark or low-contrast images: report limitation, ask user to supplement with text input

## What to Ask If Unclear

If the image shows:
- A structure but no dimensions: ask user to provide key dimensions (span, height)
- An isolated detail (column-beam joint, etc.): ask about overall structural system
- An architectural drawing (no structural info): ask user to upload the structural drawing

## Output

Identified structural parameters are passed to `extract_draft_params`.
The base64 image URI remains available in the LLM context for follow-up questions about image contents.
