# Section Skills

This folder keeps the section-design skills as modular, detachable units.

> Manifest-first note
>
> Builtin section skills now define their static identity in `skill.yaml`. Stage Markdown files such as
> `intent.md` are content assets only, while `handler.ts` and `runtime.py` remain execution-layer assets
> during the transition.

Current runtime status: `section` is catalog-visible and discoverable, but it is not auto-activated by the main runtime binder today.

## Skill Map

- `section-common`: standard beams, frames, columns, and common steel profiles.
- `section-bridge`: bridge-girder and bridge-section workflows, including deck width, girder spacing, and bridge-specific defaults.
- `section-irregular`: tapered, asymmetric, built-up, and custom outline-based sections.

## Routing Intent

- Start with `section-common` when the request is about regular standard sections.
- Prefer `section-bridge` when bridge, girder, box-girder, or deck-related terms appear.
- Prefer `section-irregular` when the request mentions irregular, tapered, custom, or asymmetric sections.

## Design Goal

- Each skill should be usable on its own.
- Each skill should explain its intent in `intent.md`.
- Each skill should keep canonical metadata in `skill.yaml`.
- Shared parsing and property estimation should stay inside this folder so later extraction is straightforward.
