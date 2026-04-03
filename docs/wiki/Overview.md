# Overview

StructureClaw is an AI-assisted structural engineering workspace for AEC workflows.

## Architecture

- `frontend/`: Next.js 14 application with 3D visualization (Three.js)
- `backend/`: Fastify API, agent orchestration, LLM integration, Prisma ORM, and hosted analysis runtime
- `scripts/`: `sclaw` CLI entrypoint and command implementations
- `docs/`: handbook, protocol reference, and wiki source pages

## Skill System

Skills are discovered and loaded from `backend/src/agent-skills/` using a two-layer architecture:

- **Markdown intent layer**: `.md` files with YAML frontmatter defining triggers, stages, and metadata
- **TypeScript handler layer**: `manifest.ts` + `handler.ts` pairs implementing structural-type detection, draft extraction, and model building

Built-in skill domains:

| Domain | Description |
|---|---|
| `structure-type` | Structural type recognition (beam, frame, truss, portal-frame, frame-shear-wall, residential-shear-wall, transmission-tower, etc.) |
| `analysis` | OpenSees and Simplified analysis execution |
| `code-check` | Design code compliance checking |
| `data-input` | Structured data input parsing |
| `design` | Structural design assistance |
| `drawing` | Drawing and visualization generation |
| `load-boundary` | Load and boundary condition handling |
| `material` | Material property management |
| `report-export` | Report generation and export |
| `result-postprocess` | Post-processing of analysis results |
| `section` | Cross-section property calculation |
| `validation` | Model validation checks |
| `visualization` | 3D model visualization |

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

- Local source flow: `./sclaw doctor`, `./sclaw start`, `./sclaw status`
- Windows PowerShell: `node .\sclaw doctor`, `node .\sclaw start`, `node .\sclaw status`
- Docker flow: `./sclaw docker-install` then `./sclaw docker-start`

## Reference Sources

- README: https://github.com/structureclaw/structureclaw/blob/master/README.md
- Handbook: https://github.com/structureclaw/structureclaw/blob/master/docs/handbook.md
- Reference: https://github.com/structureclaw/structureclaw/blob/master/docs/reference.md
