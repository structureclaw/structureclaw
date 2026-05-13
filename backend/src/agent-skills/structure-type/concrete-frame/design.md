# Concrete Frame Skill – Design

## Purpose
Perform code‑check and design of reinforced concrete frame members according to GB/T 50010‑2010 (2024 edition).

## Design Scope
- **Columns**: axial‑flexural capacity, shear capacity, slenderness limits.
- **Beams**: flexural capacity, shear capacity, deflection control, crack‑width control.
- **Connections**: default rigid connection (moment‑resisting) details.
- **Foundation**: simplified bearing‑capacity check (spread footing).

## Design Workflow
1. **Extract design forces** from analysis results for each ULS combination.
2. **Select critical combinations** (max axial + moment, max shear, etc.).
3. **Check capacity** per GB/T 50010 clauses.
4. **Design reinforcement** – calculate required longitudinal and transverse steel.
5. **Detail reinforcement** – bar arrangement, spacing, development lengths.
6. **Serviceability checks** – deflection, crack width, vibration.

## Column Design (GB/T 50010‑2010, Ch. 6)
### Axial‑Flexural Capacity
- Rectangular stress‑block for concrete (`α1`, `β1` from `model.ts`).
- Rebar modeled as elastic‑perfectly plastic.
- Capacity interaction diagram generated for each column.
- Check: `NEd ≤ NRd` and `MEd ≤ MRd`.

### Shear Capacity
- Concrete contribution: `Vc = 0.7·ft·b·h₀`.
- Rebar contribution: `Vs = (Asv/s)·fyv·h₀`.
- Total: `VRd = Vc + Vs`.
- Check: `VEd ≤ VRd`.

### Slenderness
- Effective length factors: 1.0 for braced frames, >1.0 for unbraced.
- Limit: `λ = l₀/i ≤ 120` for columns in braced frames, `≤ 80` for unbraced.

## Beam Design (GB/T 50010‑2010, Ch. 5)
### Flexural Capacity
- Singly or doubly reinforced rectangular sections.
- Required tension steel: `As = MEd / (0.87·fy·d)`.
- Minimum steel ratio: `ρmin = 0.2%` for beams.
- Maximum steel ratio: `ρmax = 2.5%`.

### Shear Capacity
- Similar to column shear, but with different coefficient: `Vc = 0.7·ft·b·h₀`.
- Stirrup design: `Asv/s = VEd / (0.87·fyv·h₀)`.

### Deflection Control (GB/T 50010‑2010, Ch. 3)
- Immediate deflection under SLS loads.
- Long‑term deflection including creep (multiply by factor 2.0–3.0).
- Limit: `δmax ≤ L/250` for beams supporting non‑brittle partitions.

### Crack‑Width Control
- Characteristic crack width: `wk = αcr·ψ·σs/Es·(c + 0.1d/ρeff)`.
- Limit: `wk ≤ 0.3 mm` for indoor normal environment, `≤ 0.2 mm` for aggressive environment.

## Material Partial Factors (GB/T 50010‑2010, Table 4.2.4)
- Concrete: `γc = 1.4` (compression), `γc = 1.5` (tension).
- Rebar: `γs = 1.1` (hot‑rolled), `γs = 1.15` (cold‑worked).

## Design Output
- **Summary table**: member ID, cross‑section, required reinforcement, provided reinforcement, capacity ratio.
- **Reinforcement drawings**: schematic bar layouts.
- **Material take‑off**: concrete volume, rebar weight per grade.
- **Code‑check report**: pass/fail status, governing clauses.

## Integration Notes
The design module uses the same analysis results schema as the steel frame skill, but applies concrete‑specific design clauses. Reinforcement design follows the **simplified method** of GB/T 50010; for complex cases (biaxial bending, seismic detailing) the user is referred to specialized software.