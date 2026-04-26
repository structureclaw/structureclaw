# Persistent Memory

- `zh`: 用于在当前工程对话中保存跨轮次可复用的偏好、长期约束和已确认工程决策。
- `en`: Use for persistent memory that stores reusable preferences, durable constraints, and confirmed engineering decisions within the current engineering conversation.
- Do not store temporary draft parameters, transient calculations, secrets, or values that only apply to the current turn.
- Scope is the active conversation thread.
