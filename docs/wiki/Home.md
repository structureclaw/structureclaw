# StructureClaw Wiki

This wiki mirrors the current repository documentation and gives a stable landing page for contributors and operators.

## Core Docs

- [Repository README](https://github.com/structureclaw/structureclaw/blob/master/README.md)
- [Chinese README](https://github.com/structureclaw/structureclaw/blob/master/README_CN.md)
- [Handbook](https://github.com/structureclaw/structureclaw/blob/master/docs/handbook.md)
- [Chinese Handbook](https://github.com/structureclaw/structureclaw/blob/master/docs/handbook_CN.md)
- [Reference](https://github.com/structureclaw/structureclaw/blob/master/docs/reference.md)
- [Chinese Reference](https://github.com/structureclaw/structureclaw/blob/master/docs/reference_CN.md)
- [Contributing Guide](https://github.com/structureclaw/structureclaw/blob/master/CONTRIBUTING.md)
- [Chinese Contributing Guide](https://github.com/structureclaw/structureclaw/blob/master/CONTRIBUTING_CN.md)

## Platform Summary

- Monorepo layout: `frontend`, `backend`, `scripts`, `docs`
- Backend hosts both the Fastify API and the Python analysis runtime
- Main engineering flow: `draft -> validate -> analyze -> code-check -> report`
- Primary local workflow: `./sclaw doctor`, `./sclaw start`, `./sclaw status`
- Windows users can use `node .\sclaw doctor`, `node .\sclaw start`, etc.
- Docker workflow: `./sclaw docker-install`, `./sclaw docker-start`, `./sclaw docker-stop`
- SkillHub CLI: `./sclaw skill search/install/enable/disable/uninstall/list`
- Node.js auto-install helpers: `scripts/install-node-linux.sh`, `scripts/install-node-windows.ps1`

## Wiki Pages

- [Overview](Overview)
- [概览](Overview-CN)
- [Handbook](Handbook)
- [使用手册](Handbook-CN)
- [Reference](Reference)
- [参考文档](Reference-CN)

## Sync Note

When repository docs change, update the paired wiki pages in both English and Chinese in the same change.
