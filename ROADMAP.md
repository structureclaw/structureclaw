# StructureClaw Roadmap

This roadmap is the narrative summary for StructureClaw's release direction. Live planning status is tracked in GitHub Projects, which should be treated as the source of truth for item-level priority, ownership, and progress.

- [v1.0.0 GitHub Project](https://github.com/orgs/structureclaw/projects/1): first stable npm release
- [v1.1.0 GitHub Project](https://github.com/orgs/structureclaw/projects/3): next release line after 1.0 stabilization

The sections below explain the intent of each release line. They are not release promises; priorities can change as the runtime, engine integrations, and user feedback evolve.

## 1.0.0 Release

Project focus: first stable npm release with a complete local chat-to-artifact workflow.

Project themes and representative issues:

- Skill architecture and runtime backbone: builtin skill taxonomy, SkillHub boundary, manifest-first loading, and code-owned tool registry tracked through [#38](https://github.com/structureclaw/structureclaw/issues/38), [#57](https://github.com/structureclaw/structureclaw/issues/57), and [#162](https://github.com/structureclaw/structureclaw/issues/162).
- Agent execution model: replace the deterministic planner pipeline with the LangGraph ReAct runtime tracked through [#154](https://github.com/structureclaw/structureclaw/issues/154).
- Analysis engines and schema: migrate OpenSees execution into backend skills, define StructureModel V2, and stabilize OpenSees / PKPM / YJK paths tracked through [#37](https://github.com/structureclaw/structureclaw/issues/37), [#39](https://github.com/structureclaw/structureclaw/issues/39), [#50](https://github.com/structureclaw/structureclaw/issues/50), and related engine PRs.
- CLI, packaging, and runtime setup: unify `sclaw` / `sclaw_cn`, support first-run setup, and package the stable npm release through [#40](https://github.com/structureclaw/structureclaw/issues/40) and [#165](https://github.com/structureclaw/structureclaw/issues/165).
- Test and release confidence: expand regression, smoke, LLM, and multi-environment install validation through [#42](https://github.com/structureclaw/structureclaw/issues/42) and [#118](https://github.com/structureclaw/structureclaw/issues/118).
- Product polish and observability: console UX, frontend accessibility, structured logging, memory, and conversation-scoped runtime cleanup through [#148](https://github.com/structureclaw/structureclaw/issues/148), [#163](https://github.com/structureclaw/structureclaw/issues/163), and [#164](https://github.com/structureclaw/structureclaw/issues/164).
- Documentation closure: refresh bilingual repository docs and wiki content through [#43](https://github.com/structureclaw/structureclaw/issues/43) and the active documentation refresh PR on the v1.0.0 board.

## 1.0.x Stabilization

Focus: keep the 1.0 line reliable after the stable npm release.

- Patch regressions found by `smoke-native`, backend build/lint/Jest, frontend type-check/build, and agent contract validation.
- Keep npm package metadata, CLI behavior, and `sclaw doctor` diagnostics aligned with the actual 1.0 install experience.
- Maintain engine-specific setup notes for OpenSees, PKPM, and YJK as commercial-engine edge cases are found.
- Keep docs and wiki synchronized when API routes, skill metadata, or engine behavior changes.

## 1.1.0 Release Line

Project focus: benchmark enrichment and multimodal file input.

- LLM benchmark framework: replace component-style `llm-integration` checks with end-to-end `llm-benchmark`, LLM-as-Judge evaluation, natural-language assertions, skill hit tracking, and agent retry loops through [#170](https://github.com/structureclaw/structureclaw/issues/170) and [#185](https://github.com/structureclaw/structureclaw/issues/185).
- File upload and data-input: add browser/workspace file upload, file-aware agent tools, and data-input skills for CSV/Excel, PDF, DXF, images, and later BIM-oriented sources through [#169](https://github.com/structureclaw/structureclaw/issues/169) and [#184](https://github.com/structureclaw/structureclaw/issues/184).
- Visualization skills: continue the visualization skill skeleton and resolve the registry boundary with existing visualization extensions through the v1.1.0 visualization PR on the board.
- Documentation parity: close remaining bilingual translation and wiki synchronization gaps through the v1.1.0 documentation PR.
