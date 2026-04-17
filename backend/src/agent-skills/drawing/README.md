# Drawing Skills / 出图技能

## Purpose / 目的

- Drawing export orchestration via external vendor APIs
- Vendor-specific drawing API adapters (PKPM, YJK, and future integrations)
- Drawing task packaging: consume upstream normalized models and analysis results, produce construction drawings

---

- 通过外部厂商 API 编排出图流程
- 厂商出图 API 适配器（PKPM、YJK 及未来更多集成）
- 出图任务打包：消费上游归一化模型与分析结果，生成施工图纸

## Layout / 目录结构

- `pkpm-api/` — PKPM drawing export skill
- `yjk-api/` — YJK drawing export skill

## Contract / 协议

### Input / 输入

Each drawing skill consumes:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `modelId` | string | yes | Upstream normalized structural model identifier |
| `analysisResultId` | string | no | Analysis result identifier from a completed analysis skill |
| `codeCheckResultId` | string | no | Code-check result identifier |
| `drawingType` | string | yes | One of: `plan`, `elevation`, `section`, `detail`, `reinforcement` |
| `scale` | string | no | Drawing scale, e.g. `1:100` |
| `outputFormat` | string | no | One of: `dwg`, `dxf`, `pdf` |

### Output / 输出

| Field | Type | Description |
|-------|------|-------------|
| `drawings` | array | List of generated drawing file references with type and format metadata |
| `metadata` | object | Drawing number, scale, and generation timestamp |

## Rules / 规则

- One vendor API = one skill. Do not merge multiple vendors into a single skill.
- Every skill must define `skill.yaml` with `inputSchema` and `outputSchema`.
- Every skill must have at least one stage markdown file (e.g. `intent.md`) for auto-discovery.
- Drawing skills are not auto-loaded (`autoLoadByDefault: false`). They activate only when the user explicitly requests drawing generation.
- Drawing skills should not affect the base model's ability to handle normal dialogue when unloaded.

---

- 一个厂商 API = 一个 skill，不要将多个厂商合并为单个 skill。
- 每个 skill 必须定义包含 `inputSchema` 和 `outputSchema` 的 `skill.yaml`。
- 每个 skill 必须至少有一个 stage markdown 文件（如 `intent.md`）以支持自动发现。
- 出图 skill 不自动加载（`autoLoadByDefault: false`），仅在用户明确请求出图时激活。
- 出图 skill 卸载后不应影响大模型正常对话能力。
