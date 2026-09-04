# Composite Skill – Design

## Purpose
Provide the design-stage rules applied when the skill estimates the composite section, shear studs, and GB 50017 design-basis checks.

## Steel Profiles
- Beam and column profiles resolve against a GB/T 11263 H-profile subset (`HN` beams, `HW` columns); custom `H{H}X{B}X{tw}X{tf}` designations are computed directly.
- Unrecognized designations fall back to the story-count defaults (aligned with the `frame` skill) and the substitution is reported.
- Steel grades Q235/Q345/Q355/Q390/Q420 with GB 50017 design strengths; default Q355.

## Effective Flange Width (GB 50017-2017 chapter 14 practice)
- `be = b0 + 2·min(L/6, 6·hc)`, where `b0` is the steel top flange width, `L` the span, and `hc` the slab thickness.
- A user-provided `compositeSlabWidthM` caps the effective width; the derived value is rounded up to 50 mm.

## Transformed Section (elastic, modular-ratio method)
- Modular ratio `n = Es/Ec`.
- Transformed area `A_tr = As + be·hc/n`, transformed centroid and inertia `I_tr` measured from the slab top, and `W_lower = I_tr / y_lower` for the bottom of the steel beam.

## Flexural Capacity (design-basis estimate, full shear connection)
- Compression force `F = min(As·fy, be·hc·fc)`.
- Plastic neutral axis depth in the slab `x = F/(be·fc)`; when `x ≤ hc` the moment estimate is `M = F·(hs/2 + hc − x/2)` (sagging).
- When the PNA falls into the steel (`x > hc`), the estimate is flagged `pnaInSteel: true` and the skill reports that the flange is insufficient — refine the slab thickness/width or run an explicit section check.

## Shear Studs (GB 50017-2017 chapter 14 stud provisions)
- Stud shank areas use the provided `compositeStudDiameterMm` (default 19 mm).
- Single-stud capacity `Nv = min(0.43·As·√(Ec·fc), 0.7·As·fu)` with stud tensile strength `fu = 400 N/mm²`.
- Longitudinal shear force `V = F` per half span; stud count per half span `n = V/Nv` (even rows, default 2), total `2n`, and the longitudinal pitch is the half-span divided by the studs per row, rounded up to 10 mm and kept within `3d`–`600 mm`.
- `fullShearConnection` is satisfied when the layout provides at least `n` studs per half span.

## Verification Delegation
- Member strength/stability/serviceability verification stays with the `code-check-gb50017` runner (chapters 7, 8, 10); the flange and stud data above are emitted as structured `compositeDesign` extension data so downstream checks can trace them.
- Concrete flange detailing (reinforcement, crack control) is delegated to the GB/T 50010 runner.
