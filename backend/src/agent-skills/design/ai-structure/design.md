# Design

该技能面向 Agent 设计迭代循环（analyze → code-check → design → re-analyze），在 `run_design` 工具中执行：

- 输入是当前模型与规范校核结果中的超限信号（利用率 > 1 的构件清单），不是自然语言描述。
- 服务在设置 `design.aiStructure.enabled=true` 且配置了 API Key 时调用 ai-structure.com；任何网络、超时或响应格式错误都回退到本地规则设计引擎（按利用率几何缩放截面），保证设计迭代始终可执行。
- 每次迭代输出 before → after 的截面调整、受影响构件、控制利用率与目标利用率，供前端设计卡片与报告引用。
- 会话策略要求审批（`requireApprovalBeforeExecution`）时，调整以 `blocked_approval` 提案返回，用户确认后带 `approved=true` 重新调用。
- 迭代次数由 `design.maxIterations`（默认 10）限制；校核全部通过（converged）或达到上限（max_iterations_reached）后停止，不得伪造收敛结论。
