# Analysis Skills

Purpose:
- One software x one analysis category = one skill
- Every selectable analysis skill must define its static identity in `skill.yaml`
- Every selectable analysis skill keeps its own `runtime.py` and any Python helpers it needs
- `runtime/` only keeps execution plumbing such as worker/api/registry; it is not a skill

Layout:
- `opensees-static`, `opensees-dynamic`, `opensees-seismic`, `opensees-nonlinear`
- `pkpm-static`
- `yjk-static`
- `runtime/` contains Python worker, API, and runtime registry only

Built-in engine matrix:

| Engine | Skill ids | Runtime dependency | Current output focus |
|---|---|---|---|
| `builtin-opensees` | `opensees-*` | OpenSeesPy in the backend Python environment | FEM analysis results for static, dynamic, seismic, and nonlinear workflows |
| `builtin-pkpm` | `pkpm-static` | Local PKPM/SATWE installation with `JWSCYCLE.exe` and `APIPyInterface` | SATWE static analysis results and project artifacts |
| `builtin-yjk` | `yjk-static` | Local YJK 8.0 installation with `yjks.exe` and bundled Python 3.10 | Static-analysis displacements, reactions, member forces, envelopes, load cases, and floor statistics |

Rules:
- Do not put user-selectable analysis semantics or solver code directly under `runtime/`
- New analysis support should add a new skill folder with `skill.yaml`, `runtime.py`, stage Markdown, and any helper modules it needs
- If a software does not support an analysis type, do not create a fake skill for it
