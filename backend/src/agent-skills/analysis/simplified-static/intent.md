---
id: simplified-static
zhName: 简化静力分析
enName: Simplified Static Analysis
zhDescription: 使用简化内置求解器执行快速静力分析的 skill。
enDescription: Skill for fast static analysis using the simplified builtin solver.
triggers: ["简化静力分析", "快速静力分析", "simplified static", "fast static analysis"]
stages: ["analysis"]
autoLoadByDefault: true
---
# Simplified Static Analysis

- `zh`: 适用于快速估算、回退求解、对高保真 OpenSees 无强依赖的静力分析场景。
- `en`: Use for quick estimation or fallback static solving when OpenSees-level fidelity is not required.
- Runtime: `analysis/runtime/adapters/simplified/provider.py`
