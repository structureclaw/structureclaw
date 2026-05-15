# Skill Creation Wizard

- `zh`: 当用户要求创建、定义或编写新的 StructureClaw 技能时激活此技能。
- `en`: Activate when the user asks to create, define, or author a new StructureClaw skill.

## When to activate

- User says: "create a new skill", "帮我创建技能", "I want to make a custom skill"
- User provides a skill.yaml or handler.ts snippet and asks for help
- User asks about skill structure or how skills work

## Information to collect

1. **Skill ID** — unique identifier (lowercase, hyphens allowed)
2. **Domain** — one of: structure-type, analysis, code-check, data-input, design, drawing, general, load-boundary, material, report-export, result-postprocess, section, validation, visualization
3. **Name** — bilingual `{ zh, en }`
4. **Description** — bilingual `{ zh, en }`
5. **Triggers** — keywords for intent detection
6. **Stages** — which pipeline stages the skill participates in (intent, draft, analysis, design)
7. **Structure type** — if applicable (beam, truss, frame, portal-frame, etc.)
8. **Handler complexity** — does the skill need a `handler.ts` with custom logic, or are stage markdown files sufficient?
