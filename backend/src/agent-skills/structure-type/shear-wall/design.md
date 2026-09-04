# Shear Wall Skill – Design

## Purpose
Provide the design-stage rules applied when the skill estimates wall thickness, coupling beams, seismic grade, and ductility detailing.

## Wall Thickness (GB/T 50011-2010 (2024) 6.4.1)
The same limits encoded by the `code-check-gb50011` runner are used for estimation:
- Seismic grade 1/2: thickness >= 160 mm and >= story height / 20.
- Seismic grade 3/4: thickness >= 140 mm and >= story height / 25.
- Bottom strengthened zone, grade 1/2: thickness >= 200 mm and >= story height / 16 (>= story height / 12 when the wall end has no end column or wing wall).
- Estimated thicknesses are rounded up to 50 mm.

## Bottom Strengthened Zone (GB/T 50011-2010 (2024) 6.1.10)
Bottom strengthened stories = stories covered by max(bottom two stories, total wall height / 10), measured from the base.

## Seismic Grade (GB/T 50011-2010 (2024) Table 6.1.2, shear wall structures 25–80 m)
- Intensity 6 → grade 4 (四级)
- Intensity 7 → grade 3 (三级)
- Intensity 8 → grade 2 (二级)
- Intensity 9 → grade 1 (一级)
Explicit user-provided `seismicGrade` always wins over the derived suggestion.

## Coupling Beams (连梁)
- Coupling beams span the openings at each floor level.
- Beam depth is estimated so the span-to-depth ratio stays within 2–5 (deep coupling beam range per JGJ 3-2010 7.2.22–7.2.24 practice), rounded up to 50 mm with a 400 mm minimum.
- Coupling beams inherit the wall seismic grade; grades 1/2 require strong-shear weak-bending capacity design ( amplified shear demand), which is delegated to the GB 50011 checker when member forces exist.

## Ductility Detailing (GB/T 50011-2010 (2024) 6.4.3–6.4.5)
- Distributed vertical/horizontal reinforcement minimum ratio: grades 1/2/3 → 0.25%, grade 4 → 0.20%; bar diameter >= 8 mm, spacing <= 300 mm.
- Boundary elements: grades 1/2 require constrained boundary elements (约束边缘构件) in the bottom strengthened zone and the story above; other positions use constructive boundary elements (构造边缘构件).
- These requirements are emitted as structured `wallDesign` extension data so downstream checks can trace them; pass/fail verification stays with the code-check runners.
