# StructureClaw Agent Architecture

## 1. Purpose

This document defines the target architecture for StructureClaw's agent runtime. It fixes the meaning of `base model`, `skill`, `tool`, `structure-type`, and the staged refactor plan.

Use this file as the canonical design reference when changing agent orchestration, skill loading, or tool registration.

## 2. Core Principle

StructureClaw starts as a normal conversational model.

- If no skills and no tools are loaded, the system behaves like a normal chat model.
- If skills are loaded but tools are not enabled, the system behaves like a structural engineering advisor.
- If both skills and tools are available, the system behaves like an executable engineering agent.

This means the architecture is capability-driven, not mode-driven.

## 3. Runtime Layers

### 3.1 Base Model

The base model is always present.

Responsibilities:

- general dialogue
- plain-language reasoning
- normal follow-up questions
- fallback conversation when no engineering capability is enabled

The base model is the minimum viable system.

### 3.2 Skill Layer

Skills are optional, loadable engineering capability domains.

Responsibilities:

- understand engineering intent
- classify structural requests
- extract and merge draft parameters
- compute missing inputs
- generate clarification questions
- propose defaults
- explain results in engineering language
- guide downstream skill and tool selection

StructureClaw keeps the existing 14 top-level skill domains:

- `structure-type`
- `analysis`
- `code-check`
- `data-input`
- `design`
- `drawing`
- `general`
- `load-boundary`
- `material`
- `report-export`
- `result-postprocess`
- `section`
- `validation`
- `visualization`

These skill domains remain the stable taxonomy of the platform.

### 3.3 Tool Layer

Tools are optional, invokable action interfaces.

Responsibilities:

- perform concrete actions
- validate or transform models
- run analysis or code checks
- generate reports or visualizations
- persist outputs and snapshots

Tools are not capability domains. They are action endpoints that the agent may invoke.

Tools may come from two sources:

- built-in platform tools
- tools provided by an enabled skill

### 3.4 Agent Orchestration Layer

The agent is the coordinator.

Responsibilities:

- read the current conversation and enabled capability set
- select which skills participate in the current turn
- decide whether the next step is reply, ask, or tool invocation
- choose eligible tools from the currently enabled set
- enforce execution guards and sequencing
- produce the final response and artifacts

The agent should be driven by capability availability and user context, not by public `conversation/tool/auto` concepts.

## 4. Skill Definition

A skill is the platform's unit of engineering capability.

In StructureClaw, a skill can be:

- a top-level capability domain, such as `analysis`
- a domain-specific implementation inside that domain, such as `structure-type/beam`

Skills are responsible for understanding and guidance, not raw execution.

The current runtime interfaces in [backend/src/agent-runtime/types.ts](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/backend/src/agent-runtime/types.ts) already reflect this design through `SkillManifest` and `SkillHandler`.

## 5. `structure-type` as the Entry Skill Domain

`structure-type` is the entry skill domain of the engineering workflow.

It is special because it runs before downstream engineering skills.

Responsibilities:

- identify the concrete structure-type skill for the current request
- initialize the draft state
- decide which structural parameters are missing first
- generate the first round of clarification questions
- provide the structural skeleton for downstream skills
- constrain which downstream tools and skills are sensible

Examples of concrete skills inside `structure-type` include:

- `beam`
- `truss`
- `frame`
- `portal-frame`
- `double-span-beam`
- `steel-frame`

These are treated as concrete skills inside the `structure-type` domain, not as a separate platform layer.

## 6. Built-in Generic Structure-Type Skill

StructureClaw should always ship with a built-in generic structure-type skill:

- `structure-type/generic`

Role:

- default fallback inside the `structure-type` domain
- enabled by default
- not necessarily the strongest specialist
- able to accept any structural request

Responsibilities:

- catch requests that do not match a stronger specialized structure-type skill
- build a minimum draft state
- ask generic but valid follow-up questions
- provide a minimum engineering path for downstream analysis/report flows

This skill is the minimum engineering capability package, not the base chat model itself.

## 7. Tool Definition

A tool is an invokable action interface available to the agent.

Suggested stable built-in tool concepts:

- `load_context`
- `draft_model`
- `update_model`
- `validate_model`
- `run_analysis`
- `run_code_check`
- `run_design`
- `generate_report`
- `generate_visualization`
- `persist_artifact`

The current runtime still uses older tool ids such as:

- `text-to-model-draft`
- `validate`
- `analyze`
- `code-check`
- `report`

These map naturally to the target built-in tool concepts above and can be renamed gradually during refactor.

## 8. Skill and Tool Relationship

Skills and tools are both optional.

### 8.1 Skills

Each skill may declare:

- whether it is enabled by default
- which other skills it requires or conflicts with
- which tools it provides
- which tools it allows the agent to use in its context

### 8.2 Tools

Each tool should declare:

- whether it is enabled by default
- whether it is built-in or skill-provided
- its input and output contract
- any required guards or prerequisites

### 8.3 Agent Rule

The agent must make decisions only within the currently enabled skill set and currently enabled tool set.

It must not assume the full platform capability set is always available.

## 9. Full Structural Engineering Workflow

The intended end-to-end workflow is:

1. User sends a message.
2. Agent loads the current conversation, session state, and enabled capability set.
3. `structure-type` runs first and selects the concrete structure-type skill.
4. Draft state is created or updated.
5. Downstream skills participate as needed:
   - `data-input`
   - `load-boundary`
   - `material`
   - `section`
   - `analysis`
   - `design`
   - `code-check`
   - `validation`
   - `result-postprocess`
   - `report-export`
   - `visualization`
   - `drawing`
   - `general`
6. The agent decides the next step:
   - reply
   - ask
   - tool invocation
7. If a tool is invoked, the agent chooses from the currently enabled tool set.
8. Guards validate that the tool call is legal and well-ordered.
9. The tool executes and produces artifacts.
10. Postprocessing, reporting, visualization, and persistence happen as needed.

## 10. Current Code Mapping

Primary files and responsibilities:

- [backend/src/agent-runtime/types.ts](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/backend/src/agent-runtime/types.ts)
  skill domains, manifests, handlers, draft state, runtime types
- [backend/src/agent-runtime/index.ts](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/backend/src/agent-runtime/index.ts)
  skill runtime coordination and structure-type-led draft handling
- [backend/src/services/conversation.ts](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/backend/src/services/conversation.ts)
  conversation CRUD and snapshot persistence
- [backend/src/services/agent.ts](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/backend/src/services/agent.ts)
  agent orchestration and current tool execution chain
- [backend/src/api/chat.ts](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/backend/src/api/chat.ts)
  single public chat entrypoints

## 11. Refactor Direction

The target refactor is:

- public API becomes a single chat-first agent interface
- `structure-type` becomes the stable first engineering step
- `structure-type/generic` becomes the default built-in fallback skill
- skills and tools become explicitly enableable or disableable
- new skills may introduce new tools
- public `mode` concepts are removed from product-facing interaction
- orchestration becomes capability-driven instead of mode-driven

## 12. Staged Refactor Plan

### Stage 1: Freeze Vocabulary and Contracts

- keep the 14 top-level skill domains unchanged
- define `structure-type` as the entry skill domain
- define `structure-type/generic` as the built-in fallback skill
- add documentation-backed rules for optional skills and optional tools

### Stage 2: Add Skill and Tool Registration Metadata

- extend skill manifests with enablement and tool-binding metadata
- introduce a tool manifest model for built-in and skill-provided tools
- make the runtime compute the active capability set per request or session

### Stage 3: Make `structure-type` the Stable First Step

- route every engineering request through `structure-type`
- prefer specialized structure-type skills when matched
- fallback to `structure-type/generic` when no stronger match exists

### Stage 4: Convert Orchestration to Capability-Driven Planning

- stop treating public run mode as the primary routing abstraction
- plan the next step from current context and active capability set
- keep the result space simple: `reply`, `ask`, or tool invocation

### Stage 5: Move Toward Dynamic Tool Discovery

- keep core built-in tools available
- allow skills to register their own tools
- allow sessions or projects to enable or disable both skills and tools

### Stage 6: Simplify Public Product Surface

- public chat endpoints stop exposing explicit run mode
- frontend sends a single chat request shape
- internal services still keep enough state for debugging and regression tests

### Stage 7: Rewrite Tests Around Capability Sets

- validate base chat behavior with zero skills and zero tools
- validate skilled-chat behavior with skills but no tools
- validate full agent behavior with both skills and tools
- validate `structure-type/generic` fallback behavior

## 13. Target Outcomes

After the refactor:

- the system can operate as plain chat
- the system can operate as an engineering advisor without execution
- the system can operate as a full engineering agent
- the 14-skill taxonomy remains stable
- `structure-type` reliably guides downstream engineering behavior
- skills and tools become modular and configurable
