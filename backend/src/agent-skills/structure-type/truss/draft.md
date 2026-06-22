# Draft

- Required legacy fields for executable analysis: `lengthM`, `loadKN`.
- Recommended legacy fields: `heightM`, `bayCount`, `loadType`, `loadPosition`.
- Preferred structured field: `engineeringDraft`.

## Geometry

- Span / length maps to `engineeringDraft.geometry.lengthM` and legacy `lengthM`.
- Truss height maps to `engineeringDraft.geometry.heightM` and legacy `heightM`.
- Panel count / number of bays maps to legacy `bayCount`.
- If the user asks you to recommend the truss form, keep the stated geometry and do not invent load values.

## Loads

- Nodal load, joint load, node force, upper-chord/top-chord node load, lower-chord/bottom-chord node load, `kN/节点`, or `kN per node` maps to `engineeringDraft.loads`.
- For a stated nodal load such as "10 kN at each top chord node", output one load entry:
  `{ "kind": "nodal", "magnitude": 10, "unit": "kN", "direction": "gravity", "target": "top chord nodes", "location": { "nodeRole": "top" } }`
- Also output legacy compatibility fields when the value is explicit:
  - `loadKN`: numeric magnitude in kN.
  - `loadType`: `point` for nodal/joint loads.
  - `loadPosition`: `top-nodes` for upper-chord/top-chord nodes, `middle-joint` for a mid-height joint, `free-joint` for a named or otherwise specified joint.
- Do not leave `engineeringDraft.loads` empty when the user explicitly gives a nodal load.
- If the user gives a line/distributed load on the truss, output `kind: "line"` or `kind: "distributed"`, `unit: "kN/m"`, and legacy `loadType: "distributed"`.
- If the magnitude or unit is ambiguous, omit `loadKN`, add a `draftIssues` entry for `loadKN`, and include `loadKN` in `skillState.invalidDraftFields`.

## Topology

- Warren / 华伦桁架 maps to `skillState.trussTopology: "warren"`.
- Pratt / 普拉特桁架 maps to `skillState.trussTopology: "pratt"`.
- Howe / 豪式桁架 maps to `skillState.trussTopology: "howe"`.
- K truss / K形桁架 maps to `skillState.trussTopology: "k"`.

## Examples

Input: `跨度15m，高度3m，采用华伦桁架，每个上弦节点荷载10kN`

Output:

```json
{
  "engineeringDraft": {
    "structureType": "truss",
    "geometry": { "lengthM": 15, "heightM": 3 },
    "loads": [
      {
        "kind": "nodal",
        "magnitude": 10,
        "unit": "kN",
        "direction": "gravity",
        "target": "top chord nodes",
        "location": { "nodeRole": "top" }
      }
    ]
  },
  "draftPatch": {
    "inferredType": "truss",
    "lengthM": 15,
    "heightM": 3,
    "loadKN": 10,
    "loadType": "point",
    "loadPosition": "top-nodes"
  },
  "skillState": {
    "trussTopology": "warren"
  }
}
```

Input: `每个上弦节点荷载 10 kN`

Output:

```json
{
  "engineeringDraft": {
    "structureType": "truss",
    "loads": [
      {
        "kind": "nodal",
        "magnitude": 10,
        "unit": "kN",
        "direction": "gravity",
        "target": "top chord nodes",
        "location": { "nodeRole": "top" }
      }
    ]
  },
  "draftPatch": {
    "inferredType": "truss",
    "loadKN": 10,
    "loadType": "point",
    "loadPosition": "top-nodes"
  }
}
```
