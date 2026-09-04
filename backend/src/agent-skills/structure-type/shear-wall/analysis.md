# Shear Wall Skill – Analysis

## Purpose
Define how the shear wall draft is turned into a computable model and which analysis path should run.

## Model Idealization
The skill builds an **equivalent-frame wall elevation model** (2D, global X-Z plane, Z up):
- **Wall piers** are line elements with `type: "wall"` (two nodes, vertical), one per wall segment per story.
- **Coupling beams** over openings are line elements with `type: "beam"` and `wallRole: "coupling-beam"`, placed at each floor level.
- Wall sections use `purpose: "wall"` with rectangular shape carrying thickness `T` (mm) and in-plane length `H` (mm); section properties `A/Iy/Iz/J` are derived from thickness and length.
- Base restraints follow `frameBaseSupportType` (default fixed).

## Element Data for Code Checks
Each wall element carries structured data consumed by the GB 50011 checker:
- `shearWall.thicknessMm`, `shearWall.storyHeightMm`, `shearWall.isBottomStrengthenedZone`, `shearWall.hasEndColumn`
- `seismicGrade` (element level, 一级…四级)
- concrete/rebar grades on every element

## Analysis Path
- Preferred: the seismic workflow (`opensees-seismic`), which supports `wall` line elements, modal analysis, response-spectrum/time-history envelopes, and GB/T 50011 drift limits (shear-wall family 1/1000, frame-shear-wall 1/800).
- The simplified `opensees-static` runtime does not model `wall` elements yet; if static-only analysis is requested, users should switch to the seismic path or export to PKPM/YJK.

## Loads
- `floorLoads` are distributed to the wall line as story nodal gravity loads and story lateral loads, matching the concrete-frame convention (`D`, `L`, `LAT` cases; wind/seismic cases are added when `wind`/`siteSeismic` parameters exist).
