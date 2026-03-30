# StructureClaw Handbook (Wiki)

> This page mirrors `docs/handbook.md`. When updating, keep both in sync.
> 中文版：[使用手册](Handbook-CN)

## Quick Start

### Node.js setup (optional)

If Node.js is not installed yet, use the helper installer script first:

```bash
bash ./scripts/install-node-linux.sh
```

Windows PowerShell (run as Administrator for first-time package install):

```powershell
powershell -ExecutionPolicy Bypass -File ./scripts/install-node-windows.ps1
```

### Recommended path

```bash
./sclaw doctor   # pre-check (Node, Python, SQLite, deps)
./sclaw start    # start full local service stack
./sclaw status   # check service health
./sclaw logs     # view logs
./sclaw stop     # stop all services
```

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
