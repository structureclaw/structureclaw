# Overview

StructureClaw is an AI-assisted structural engineering workspace for AEC workflows.

## Architecture

- `frontend/`: Next.js 14 application with 3D visualization (Three.js)
- `backend/`: Fastify API, static frontend serving in installed mode, agent orchestration, LLM integration, Prisma ORM, and hosted analysis runtime
- `scripts/`: `sclaw` CLI entrypoint and command implementations
- `docs/`: handbook, protocol reference, and wiki source pages

## Skill System

Skills are discovered and loaded from `backend/src/agent-skills/` using a manifest-first architecture:

- **Static metadata layer**: `skill.yaml` is the canonical source for skill identity, domain, and capabilities
- **Content layer**: stage Markdown files such as `intent.md`, `draft.md`, `analysis.md`, and `design.md` provide prompts and guidance content
- **Runtime layer**: executable plugins such as `handler.ts` or `runtime.py` implement skill behavior without redefining the static identity

Built-in skill domains:

| Domain | Description |
|---|---|
| `structure-type` | Structural type recognition (beam, frame, truss, portal-frame, and generic fallback paths) |
| `analysis` | OpenSees, PKPM, and YJK analysis execution |
| `code-check` | Design code compliance checking |
| `data-input` | Structured data input parsing |
| `design` | Structural design assistance |
| `drawing` | Drawing and visualization generation |
| `general` | General-purpose engineering skills and shared workflow helpers |
| `load-boundary` | Load and boundary condition handling |
| `material` | Material property management |
| `report-export` | Report generation and export |
| `result-postprocess` | Post-processing of analysis results |
| `section` | Cross-section property calculation |
| `validation` | Model validation checks |
| `visualization` | 3D model visualization |

The table above is the stable platform taxonomy. Current runtime maturity is documented separately in [../skill-runtime-status.md](../skill-runtime-status.md).

## SkillHub

SkillHub is the extensible skill management system. Skills can be installed, enabled, disabled, and uninstalled at runtime.

CLI commands:

```bash
./sclaw skill list                          # list installed skills
./sclaw skill search <keyword> [domain]     # search the skill registry
./sclaw skill install <skill-id>            # install a skill
./sclaw skill enable <skill-id>             # enable an installed skill
./sclaw skill disable <skill-id>            # disable a skill
./sclaw skill uninstall <skill-id>          # uninstall a skill
```

API endpoints:

- `GET /api/v1/agent/skillhub/search`
- `GET /api/v1/agent/skillhub/installed`
- `POST /api/v1/agent/skillhub/install`
- `POST /api/v1/agent/skillhub/enable`
- `POST /api/v1/agent/skillhub/disable`
- `POST /api/v1/agent/skillhub/uninstall`

## Main Workflow

`natural language -> draft model -> validate -> analyze -> code-check -> report`

## Recommended Startup

- Installed package flow: `npm install -g @structureclaw/structureclaw`, `sclaw doctor`, `sclaw start`
- Local source flow: `./sclaw doctor`, `./sclaw start`, `./sclaw status`
- Windows PowerShell: `node .\sclaw doctor`, `node .\sclaw start`, `node .\sclaw status`

## Reference Sources

- README: https://github.com/structureclaw/structureclaw/blob/master/README.md
- Handbook: https://github.com/structureclaw/structureclaw/blob/master/docs/handbook.md
- Reference: https://github.com/structureclaw/structureclaw/blob/master/docs/reference.md
