# General Skills

Cross-domain utility skills that provide infrastructure capabilities for the
agent runtime. These skills are not specific to any structural engineering
domain but are essential for orchestration and automation.

通用工具技能，为 agent 运行时提供基础设施能力。这些技能不特定于某个结构工程领域，
但对编排和自动化至关重要。

## Skills

| Skill | Stages | Default |
|-------|--------|---------|
| `memory` | intent, draft, analysis, design | enabled |
| `planning` | intent, draft | enabled |
| `read-file` | intent, draft, analysis | enabled |
| `write-file` | analysis | enabled |
| `replace` | draft, analysis | enabled |
| `shell` | analysis | disabled |

Utility skills now declare skill metadata only. Executable tools are registered
in code by the LangGraph agent runtime.

## Safety Boundaries

- File operations are sandboxed to `.runtime/workspace`
- Allowed extensions: `.txt`, `.json`, `.csv`, `.md`, `.py`, `.tcl`, `.log`, `.yaml`, `.yml`
- Max file size: 10 MB
- Shell: allowlisted commands only (`python`, `python3`, `opensees`, `OpenSees`)
- Shell: deny list includes `rm`, `del`, `mv`, `cp`, `ln`, `format`, `mkfs`, `sudo`, `chmod`
- Shell: max timeout 300s, max output 1 MB
