# Structure Type Skills

> Manifest-first note
>
> Builtin structure-type skills now define their canonical metadata in `skill.yaml`. Stage Markdown files
> remain content assets, and `handler.ts` remains the execution-layer entrypoint.

Purpose:
- Structure-type intent detection
- Structure-specific parameter extraction
- Structure model assembly helpers

Initial migration targets:
- beam
- double-span-beam
- frame
- portal-frame
- truss
