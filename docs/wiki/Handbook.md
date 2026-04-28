# StructureClaw Handbook (Wiki)

> This page mirrors `docs/handbook.md`. When updating, keep both in sync.
> 中文版：[使用手册](Handbook-CN)

## Quick Start

### Installed package path

```bash
npm install -g @structureclaw/structureclaw
sclaw doctor
sclaw start
sclaw status
sclaw logs
sclaw stop
```

Installed mode runs as a single process and stores runtime data under the user data directory, such as `~/.structureclaw/`.

### Source checkout path

```bash
./sclaw doctor
./sclaw start
./sclaw status
./sclaw logs
./sclaw stop
```

Source mode starts backend/frontend as development processes and uses the user runtime directory by default, such as `~/.structureclaw/`.

### Node.js setup

Node.js 20+ is required. Install it via your preferred method (nvm, system package manager, or nodejs.org).

Windows PowerShell:

```powershell
node .\sclaw doctor
node .\sclaw start
node .\sclaw status
node .\sclaw logs
node .\sclaw stop
```

Docker:

```bash
./sclaw docker-install   # interactive Docker install
./sclaw docker-start     # start Docker Compose stack
./sclaw docker-stop      # stop Docker Compose stack
./sclaw docker-status    # check Docker service health
```

China mirror entrypoint (same subcommands):

```bash
./sclaw_cn doctor
./sclaw_cn setup-analysis-python
./sclaw_cn docker-start
```

### SkillHub CLI

```bash
./sclaw skill list                          # list installed skills
./sclaw skill search <keyword> [domain]     # search the skill registry
./sclaw skill install <skill-id>            # install a skill
./sclaw skill enable <skill-id>             # enable an installed skill
./sclaw skill disable <skill-id>            # disable a skill
./sclaw skill uninstall <skill-id>          # uninstall a skill
```

## Reference Sources

- Full handbook: https://github.com/structureclaw/structureclaw/blob/master/docs/handbook.md
- Protocol reference: https://github.com/structureclaw/structureclaw/blob/master/docs/reference.md
