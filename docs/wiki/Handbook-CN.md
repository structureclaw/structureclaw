# StructureClaw 使用手册 (Wiki)

> 本页镜像自 `docs/handbook_CN.md`。更新时请同步修改。
> English: [Handbook](Handbook)

## 快速开始

### npm 安装版

```bash
npm install -g @structureclaw/structureclaw
sclaw doctor
sclaw start
sclaw status
sclaw logs
sclaw stop
```

安装版以单进程运行，并把运行数据放在用户数据目录，例如 `~/.structureclaw/`。

### 源码开发版

```bash
./sclaw doctor
./sclaw start
./sclaw status
./sclaw logs
./sclaw stop
```

源码模式以开发进程启动 backend/frontend，并默认使用用户运行目录，例如 `~/.structureclaw/`。

### Node.js 安装

需要 Node.js 20+。可通过任意方式安装（nvm、系统包管理器或 nodejs.org）。

Windows PowerShell:

```powershell
node .\sclaw doctor
node .\sclaw start
node .\sclaw status
node .\sclaw logs
node .\sclaw stop
```

国内镜像入口（子命令相同）：

```bash
./sclaw_cn doctor
./sclaw_cn setup-analysis-python
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
