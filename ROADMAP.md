# StructureClaw Roadmap

This roadmap describes the 1.0.0 release line and the work planned after the first stable npm release. It is not a release promise; priorities can change as the runtime, engine integrations, and user feedback evolve.

## 1.0.0 Release

Focus: an installable local engineering workspace with a complete chat-to-artifact loop.

- npm installation through `@structureclaw/structureclaw`
- `sclaw doctor` first-run setup
- SQLite local runtime and settings management
- `~/.structureclaw/` runtime data directory
- OpenSees static/dynamic/seismic/nonlinear analysis paths
- PKPM and YJK commercial-engine adapters behind explicit selection
- SkillHub discovery and manual enable/disable flow
- regression, smoke, and LLM integration test entrypoints
- bilingual README, handbook, reference, contribution, security, and roadmap docs

## 1.0.x Stabilization

Focus: make daily use more predictable without changing the core architecture.

- richer copy-paste demo prompts in README and handbook
- more example request/response payloads for chat, analysis, and settings APIs
- engine-specific setup guides for OpenSees, PKPM, and YJK
- clearer report export artifacts and examples
- stronger diagnostics for missing Python, uv, commercial engine paths, and authorization
- improved docs/wiki synchronization process
- compatibility notes for Node.js, Python, Windows, Docker, PKPM, and YJK

## 1.1 And Later

Focus: expand model coverage and plugin-style extensibility.

- broader StructureModel V2 coverage for walls, braces, load combinations, and engine-specific extensions
- more first-class skill domains moving from `discoverable` to `active`
- richer visualization and report post-processing
- plugin-style user skills and tools with stronger packaging and validation
- clearer API versioning and schema migration policy

