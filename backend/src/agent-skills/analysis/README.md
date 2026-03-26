# Analysis Skills

Purpose:
- One software x one analysis category = one skill
- Every selectable analysis skill must have its own `manifest.ts` and `intent.md`
- Backend runtime implementation lives under `runtime/`; it is execution plumbing, not a skill

Layout:
- `opensees-static`, `opensees-dynamic`, `opensees-seismic`, `opensees-nonlinear`
- `simplified-static`, `simplified-dynamic`, `simplified-seismic`
- `runtime/` contains Python worker, API, and runtime adapters

Rules:
- Do not put user-selectable analysis semantics directly under `runtime/`
- New analysis support should first add a new skill folder, then wire it to a runtime adapter
- If a software does not support an analysis type, do not create a fake skill for it
