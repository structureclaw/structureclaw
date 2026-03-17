# Core-First Skill Domain Plan (v1)

## Objective
- Rebuild the agent architecture with a strict core-first principle.
- Core must complete end-to-end structural modeling and OpenSees analysis with no skills loaded.
- Skills are optional capability enhancers for better UX, richer extraction, checks, visualization, reporting, and domain guidance.

## Non-Negotiable Rules
- No-skill mode is a first-class production path.
- If a request does not match any enabled skill, runtime falls back to generic LLM modeling directly.
- Skill failure or repository outage must never block baseline analysis execution.

## Target Skill Categories
1. Structure Modeling Skills
2. Material and Constitutive Skills
3. Geometry Input Skills
4. Load and Boundary Skills
5. Analysis Strategy Skills
6. Code-Check Skills
7. Result Postprocess Skills
8. Visualization Skills
9. Report and Export Skills
10. Generic Fallback Skills

## Deliverables in this folder
- 01-current-path-audit.md
- 02-target-domain-layout.md
- 03-migration-roadmap.md
- 04-extraction-map.md
