# Concrete Frame Skill – Analysis

## Purpose
Guide the analysis of a regular reinforced concrete frame using the extracted model.

## Analysis Pipeline
1. **Model generation** – convert the `DraftState` into a concrete‑frame‑specific JSON schema.
2. **Material assignment** – assign concrete and rebar properties from `model.ts`.
3. **Section generation** – create rectangular column/beam cross‑sections.
4. **Load application** – apply dead, live, and lateral loads.
5. **Boundary conditions** – apply fixed or pinned base restraints.
6. **Analysis execution** – run linear‑elastic static analysis (or non‑linear if requested).
7. **Result extraction** – collect member forces, displacements, support reactions.

## Material Models
- **Concrete**: Linear elastic in serviceability; rectangular stress‑block for ultimate limit state.
- **Rebar**: Elastic‑perfectly plastic; `fy` from `model.ts`.

## Section Properties
- Rectangular sections: `A = B × H`, `Iy = B·H³/12`, `Iz = H·B³/12`, `J` approximated for solid rectangles.
- Properties are computed in mm² and mm⁴, then converted to m² and m⁴ for the analysis schema.

## Load Cases
1. **Dead load (DL)**: self‑weight of concrete members + additional dead load from floors.
2. **Live load (LL)**: occupancy loads (kN/m²) converted to nodal loads.
3. **Lateral load (WIND)**: wind pressure converted to nodal loads at each floor.
4. **Seismic load (EQ)**: simplified equivalent lateral force per GB 50011.

## Load Combinations (GB 50009‑2012)
Basic combinations for ultimate limit state (ULS):
1. 1.35 DL + 1.5 LL
2. 1.2 DL + 1.4 LL ± 1.4 WIND
3. 1.2 DL + 1.4 LL ± 1.3 EQ
4. 1.0 DL + 1.4 WIND
5. 1.0 DL + 1.3 EQ

Serviceability limit state (SLS):
1. 1.0 DL + 1.0 LL
2. 1.0 DL + 0.7 LL + 1.0 WIND
3. 1.0 DL + 0.7 LL + 0.5 EQ

## Analysis Types
- **Linear static**: default for preliminary design.
- **Non‑linear static (pushover)**: optional for seismic performance evaluation.
- **Modal analysis**: extract natural frequencies and mode shapes.

## Output Schema
The analysis produces a JSON object with:
- `nodes`: node coordinates and restraints.
- `elements`: column/beam connectivity, material, section references.
- `materials`: concrete and rebar property sets.
- `sections`: rectangular cross‑section definitions.
- `load_cases`: DL, LL, WIND, EQ.
- `load_combinations`: ULS and SLS combinations.
- `results`: displacements, forces, stresses per combination.

## Code References
- GB/T 50010‑2010 (2024 edition) – Design of concrete structures.
- GB 50009‑2012 – Load code for building structures.
- GB 50011‑2010 – Seismic design code.

## Integration Notes
The analysis runtime expects the concrete‑frame model to follow the same overall schema as the steel frame, but with concrete‑specific material properties and rectangular sections.