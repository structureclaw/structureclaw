# StructureClaw 使用手册 (Wiki)

> 本页镜像自 `docs/handbook_CN.md`。更新时请同步修改。
> English: [Handbook](Handbook)

## 快速开始

### Node.js 安装

需要 Node.js 18+。可通过任意方式安装（nvm、系统包管理器或 nodejs.org）。

### 推荐路径

```bash
./sclaw doctor   # 预检（Node、Python、SQLite、依赖）
./sclaw start    # 启动完整本地服务栈
./sclaw status   # 检查服务健康状态
./sclaw logs     # 查看日志
./sclaw stop     # 停止所有服务
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
./sclaw docker-install   # 交互式 Docker 安装
./sclaw docker-start     # 启动 Docker Compose 服务栈
./sclaw docker-stop      # 停止 Docker Compose 服务栈
./sclaw docker-status    # 检查 Docker 服务健康状态
```

### SkillHub CLI

```bash
./sclaw skill list                          # 列出已安装的技能
./sclaw skill search <keyword> [domain]     # 搜索技能仓库
./sclaw skill install <skill-id>            # 安装技能
./sclaw skill enable <skill-id>             # 启用已安装的技能
./sclaw skill disable <skill-id>            # 禁用技能
./sclaw skill uninstall <skill-id>          # 卸载技能
```

## 规范来源

- 完整手册：https://github.com/structureclaw/structureclaw/blob/master/docs/handbook_CN.md
- 协议参考：https://github.com/structureclaw/structureclaw/blob/master/docs/reference_CN.md
