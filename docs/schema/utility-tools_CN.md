# 通用工具规格

## 概览

StructureClaw 提供 6 个基础层通用工具，用于 agent 运行时的基础设施能力。
这些工具始终通过平台工具目录可用，不需要领域 skill 的显式授权。

每个通用能力在 `backend/src/agent-skills/general/` 下有对应的 skill manifest，
提供 trigger、阶段约束等编排元数据。

## 工具清单

| 工具 ID | 类别 | 层级 | 默认启用 | 安全级别 |
|---------|------|------|---------|---------|
| `memory` | utility | foundation | 是 | read-write-local |
| `planning` | utility | foundation | 是 | read-only |
| `read_file` | utility | foundation | 是 | read-only |
| `write_file` | utility | foundation | 是 | read-write-local |
| `replace` | utility | foundation | 是 | read-write-local |
| `shell` | utility | foundation | 否 | restricted-exec |

## Skill 元数据

通用 skill manifest 只描述面向用户的能力元数据和路由提示。它们不挂载可执行 tool；tool 可用性由代码注册表和 runtime policy 控制。

## 安全边界

### 文件沙箱

- 根目录：`~/.structureclaw/workspace`
- 最大文件大小：10 MB
- 允许扩展名：`.txt`、`.json`、`.csv`、`.md`、`.py`、`.tcl`、`.log`、
  `.yaml`、`.yml`

### Shell 沙箱

- 允许命令：`python`、`python3`、`opensees`、`OpenSees`
- 禁止命令：`rm`、`del`、`mv`、`cp`、`ln`、`format`、`mkfs`、`sudo`、
  `chmod`
- 最大超时：300 秒
- 最大输出：1 MB

## 架构对齐

这些通用工具遵循 `docs/agent-architecture_CN.md` 中定义的代码注册表架构：

- 技能 manifest 位于 `backend/src/agent-skills/general/{skill-id}/skill.yaml`
- Tool 定义位于 `backend/src/agent-langgraph/tool-registry.ts`
- runtime policy 在运行时解析最终可用工具集合
