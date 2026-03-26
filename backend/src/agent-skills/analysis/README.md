# Analysis Skills

Purpose:
- One software x one analysis category = one skill
- Every selectable analysis skill must have its own `manifest.ts` and `intent.md`
- Every selectable analysis skill keeps its own `runtime.py` and any Python helpers it needs
- `runtime/` only keeps execution plumbing such as worker/api/registry; it is not a skill

Layout:
- `opensees-static`, `opensees-dynamic`, `opensees-seismic`, `opensees-nonlinear`
- `simplified-static`, `simplified-dynamic`, `simplified-seismic`
- `runtime/` contains Python worker, API, and runtime registry only

Rules:
- Do not put user-selectable analysis semantics or solver code directly under `runtime/`
- New analysis support should add a new skill folder with `intent.md`, `manifest.ts`, `runtime.py`, and any helper modules it needs
- If a software does not support an analysis type, do not create a fake skill for it
