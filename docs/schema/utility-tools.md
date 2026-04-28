# Utility Tools Specification

## Overview

StructureClaw provides 6 foundation-tier utility tools for infrastructure
capabilities. These tools are always available via the platform tool catalog and
do not require domain-specific skill authorization.

Each utility skill has a matching skill manifest under `backend/src/agent-skills/general/`
that provides orchestration metadata such as triggers and stage constraints.

## Tool Inventory

| Tool ID | Category | Tier | Default | Safety |
|---------|----------|------|---------|--------|
| `memory` | utility | foundation | enabled | read-write-local |
| `planning` | utility | foundation | enabled | read-only |
| `read_file` | utility | foundation | enabled | read-only |
| `write_file` | utility | foundation | enabled | read-write-local |
| `replace` | utility | foundation | enabled | read-write-local |
| `shell` | utility | foundation | disabled | restricted-exec |

## Skill Metadata

Utility skill manifests describe user-facing capability metadata and routing hints.
They do not attach executable tools; tool availability is controlled by the
code-owned registry and runtime policy.

## Safety Boundaries

### File Sandbox

- Root directory: `~/.structureclaw/workspace`
- Max file size: 10 MB
- Allowed extensions: `.txt`, `.json`, `.csv`, `.md`, `.py`, `.tcl`, `.log`,
  `.yaml`, `.yml`

### Shell Sandbox

- Allowed commands: `python`, `python3`, `opensees`, `OpenSees`
- Denied commands: `rm`, `del`, `mv`, `cp`, `ln`, `format`, `mkfs`, `sudo`,
  `chmod`
- Max timeout: 300 seconds
- Max output: 1 MB

## Architecture Alignment

These utility tools follow the code-owned registry architecture defined in
`docs/agent-architecture.md`:

- Skill manifests live in `backend/src/agent-skills/general/{skill-id}/skill.yaml`
- Tool definitions live in `backend/src/agent-langgraph/tool-registry.ts`
- The runtime policy resolves the final available tool set at runtime
