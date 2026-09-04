# Composite Skill – Analysis

## Purpose
Define how the composite draft is turned into a computable model and which analysis path should run.

## Model Idealization
The skill builds a **2D composite frame elevation** (global X-Z plane, Z up):
- **Columns** are steel H-section line elements with `type: "column"`, one per bay grid line per story.
- **Beams** are steel H-section line elements with `type: "beam"` and `compositeRole: "composite-beam"`; the concrete flange and shear studs ride on the element as `compositeBeam` design data (not as finite elements).
- Beam/column sections use the GB/T 11263 H-profile library (`type: "H"`, `standard_steel_name`) with properties `A/Iy/Iz/J` in consistent SI units.
- Base restraints follow `frameBaseSupportType` (default fixed).

## Element Data for Code Checks
Each composite beam element carries structured data consumed by the GB 50017 checker and the report:
- `compositeBeam.slabThicknessMm`, `compositeBeam.effectiveSlabWidthMm`, `compositeBeam.studDiameterMm`
- `compositeBeam.studLayout` (stud count, rows, longitudinal pitch, full-shear-connection flag)
- `compositeBeam.flexuralCapacityKNM` and `pnaInSteel` (plastic neutral axis location flag)
- steel/concrete grades on every element

## Analysis Path
- Preferred: the static frame workflow (`opensees-static`); the emitted model is an analyzable steel frame, so member forces come back for the composite checks.
- The seismic workflow (`opensees-seismic`) can be used when `siteSeismic` parameters are provided; composite frame drift checks follow the frame-family limits.
- Detailed slab modeling (effective-width shell models, partial-shear-connection slip analysis) is out of scope; export to PKPM/YJK for that level.

## Loads
- `floorLoads` are distributed to the floor nodes as story gravity loads and story lateral loads (`D`, `L`, `LAT` cases), matching the frame convention.
