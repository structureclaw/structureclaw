# StructureClaw Roadmap

This roadmap explains where the 1.0 line is going. It is not a release promise; priorities can change as the runtime, engine integrations, and user feedback evolve.

## 1.0 Alpha

Focus: installable local runtime and reliable engineering loop.

- npm installation through `@structureclaw/structureclaw@alpha`
- `sclaw doctor` first-run setup
- SQLite local runtime and settings management
- OpenSees static/dynamic/seismic/nonlinear analysis paths
- PKPM and YJK commercial-engine adapters behind explicit selection
- SkillHub discovery and manual enable/disable flow
- regression, smoke, and LLM integration test entrypoints

## 1.0 Beta

Focus: smoother first-run experience and clearer artifacts.

- copy-paste demo prompts in README and handbook
- richer example request/response payloads for chat, analysis, and settings APIs
- engine-specific setup guides for OpenSees, PKPM, and YJK
- clearer report export artifacts and examples
- stronger diagnostics for missing Python, uv, commercial engine paths, and authorization
- improved docs/wiki synchronization process

## 1.0 Stable

Focus: predictable daily use.

- stable npm `latest` install without `@alpha`
- documented compatibility matrix for Node.js, Python, Windows, Docker, PKPM, and YJK
- complete community profile files and release checklist
- hardened runtime data migration behavior
- clearer API versioning and schema migration policy

## Beyond 1.0

- broader StructureModel V2 coverage for walls, braces, load combinations, and engine-specific extensions
- more first-class skill domains moving from `discoverable` to `active`
- richer visualization and report post-processing
- plugin-style user skills and tools with stronger packaging and validation

