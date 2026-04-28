# General Skills

Cross-domain utility skills that provide infrastructure capabilities for the
agent runtime. These skills are not specific to any structural engineering
domain but are essential for orchestration and automation.

通用工具技能，为 agent 运行时提供基础设施能力。这些技能不特定于某个结构工程领域，
但对编排和自动化至关重要。

## Tool Registration

General skills describe user intent and skill metadata only. Tools are not registered, granted, provided, or authorized through `skill.yaml`.

All agent tools are registered in TypeScript under `backend/src/agent-langgraph/tool-registry.ts`. Runtime availability is resolved by `backend/src/agent-langgraph/tool-policy.ts`.

## Safety Boundaries

- File tools operate under `WORKSPACE_ROOT`.
- File search skips `.git`, `node_modules`, `.venv`, `__pycache__`, and `.agent-workspace`.
- All tools are enabled by default. Individual tools may be toggled off by the user.
- Shell execution requires `AGENT_ALLOW_SHELL=true` even when the tool is toggled on.
