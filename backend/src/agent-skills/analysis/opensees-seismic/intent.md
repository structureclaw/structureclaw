# OpenSees Seismic Analysis

- `zh`: 当需求是反应谱、Pushover 或其他更高保真的抗震求解时使用。
- `en`: Use when the request targets response-spectrum, pushover, or other higher-fidelity seismic solving.
- Runtime: `analysis/opensees-seismic/runtime.py`

## China Seismic Workflow Contract

When the user asks for China-code seismic analysis, reason semantically from the whole request and emit a structured
`skillState.seismicWorkflow` object. Do not choose response spectrum or time history by keyword/regex matching.

Use these normalized fields when they are known:

```json
{
  "methodPreference": "auto",
  "designBasis": {
    "codes": ["GB 55002-2021", "GB/T 50011-2010-2024", "GB 18306-2015"],
    "region": "Beijing",
    "regionCode": "optional-official-or-project-code",
    "siteSeismic": {
      "intensity": 7,
      "accelerationG": 0.1,
      "designGroup": "3",
      "siteCategory": "III"
    }
  },
  "designRequirements": {
    "fortificationCategory": "standard",
    "seismicGrade": 2,
    "irregularity": "regular",
    "supplementaryTimeHistory": false
  },
  "structure": {
    "heightM": 36,
    "storyCount": 10
  },
  "groundMotionSet": {
    "requiredCount": 3,
    "scaleFactorLimit": 10,
    "records": []
  },
  "overLimitReview": {
    "reviewRequired": false,
    "status": "not_required"
  },
  "specialReview": {
    "reviewRequired": false,
    "status": "not_required"
  },
  "responseSpectrum": {
    "modalCombination": "cqc"
  },
  "directions": ["x", "y"]
}
```

If the user provides explicit over-limit or special seismic review requirements, conclusions, approval IDs, review
authorities, dates, or reasons, preserve them as structured `overLimitReview`, `specialReview`,
`specialSeismicReview`, or `overLimitSpecialReview` objects. Use fields such as `reviewRequired`, `status`,
`approvalId`, `reviewAuthority`, `reviewDate`, and `reviewReasons`. Do not infer legal over-limit status or review
completion from isolated keywords in the message.

If the user uploads or provides a licensed/project GB 18306 zonation table, map it into structured records instead of
guessing city parameters:

```json
{
  "designBasis": {
    "region": "示例市",
    "regionCode": "EX-001",
    "groundMotionZonation": {
      "source": "user_uploaded_gb18306_table",
      "records": [
        {
          "region": "示例市",
          "regionCode": "EX-001",
          "accelerationG": 0.2,
          "designGroup": "2",
          "characteristicPeriod": 0.55
        }
      ]
    }
  }
}
```

Use exact structured `regionCode` when available; otherwise use the exact structured `region`. Do not infer official
GB 18306 parameters from a city name unless the value is present in user-provided or project-provided structured data.

Allowed `methodPreference` values are `auto`, `response_spectrum`, `time_history`, `pushover`, and
`elastic_plastic_time_history`.
Use `auto` unless the user explicitly specifies a calculation method. The runtime will choose the code-required method
from structured design fields such as intensity, site category, height, fortification category, irregularity, and
available ground-motion records.

If supplementary elastic time-history analysis is required but records are missing, keep `methodPreference: "auto"` or
`"time_history"`, set `groundMotionSet.requiredCount` to `3` or `7`, and let the runtime return a partial result with
missing ground-motion inputs.

If the user explicitly requests rare-earthquake elastic-plastic deformation checking or nonlinear dynamic analysis,
emit `methodPreference: "elastic_plastic_time_history"` and preserve any nonlinear material, hinge, convergence, and
performance-target data in structured workflow fields. The current runtime will run the available elastic comparison
path and return a capability boundary until a nonlinear OpenSees model is provided.

Use `directions` for horizontal seismic directions. For 3D structures, prefer `["x", "y"]` unless the user explicitly
limits the analysis to one direction. For 2D frames, use `["x"]`. The legacy single `direction` field is still accepted
for compatibility, but new structured workflows should emit `directions`.

Use `responseSpectrum.modalCombination` only as a structured enum. Allowed values are `cqc` and `srss`; default to `cqc`
when the user does not specify a modal-combination rule.

Use `groundMotionSet.scaleFactorLimit` when the project gives an explicit amplitude-scaling control limit. If omitted,
the runtime reports against the default advisory limit and still exposes the actual maximum scale factor in
`timeHistory.spectrumMatch`.

When the user uploads ground-motion files, call `analyze_file` first and put the parsed content into
`groundMotionSet.records`. Do not pass `relPath` as an analysis-runtime file path. Supported record payloads:

```json
{
  "name": "wave-x.csv",
  "direction": "x",
  "unit": "g",
  "headers": ["time", "accel_g"],
  "rows": [["0.00", "0.000"], ["0.02", "0.010"]]
}
```

```json
{
  "name": "wave-y.at2",
  "direction": "y",
  "unit": "g",
  "content": "NPTS= 800, DT= .02 SEC\n0.000 0.010 -0.008 ..."
}
```

If a CSV has more than two numeric columns, set structured `timeColumn` and `accelerationColumn` fields based on the
file schema. This is file-format mapping, not seismic-method selection.
For 3D time-history analysis, emit `direction` or `component` as `x`/`y` on each ground-motion record when directional
components are known. Untagged records are treated as usable for each requested horizontal direction.

If the user asks the system to select example waves and does not provide uploaded records, use the built-in artificial
catalog explicitly:

```json
{
  "methodPreference": "time_history",
  "groundMotionSet": {
    "source": "builtin_artificial",
    "autoSelect": true,
    "requiredCount": 3
  }
}
```

Available executable built-in catalog IDs are `SCGM-A1` through `SCGM-A7`. These are deterministic artificial records
for workflow execution and regression; do not describe them as actual recorded ground motions.
Common recorded-motion reference IDs `SCGM-R1` through `SCGM-R7` may be recommended as metadata-only candidates
(El Centro, Taft, Hachinohe, Northridge, Kobe, Loma Prieta, Chi-Chi), but they are not embedded waveforms and must not
be passed as executable `catalogIds` unless the user uploads/imports the corresponding licensed records. If the user
needs code-grade recorded motions, ask for uploaded records or a licensed local catalog.

If the user provides a licensed/project ground-motion catalog, select only by structured IDs and include the selected
records in `groundMotionSet.localCatalog.records`:

```json
{
  "methodPreference": "time_history",
  "groundMotionSet": {
    "source": "local_catalog",
    "catalogIds": ["LC-01", "LC-02", "LC-03"],
    "localCatalog": {
      "records": [
        {
          "id": "LC-01",
          "recordType": "actual",
          "dt": 0.02,
          "unit": "g",
          "values": [0.0, 0.01, -0.01]
        }
      ]
    }
  }
}
```

If the user asks the system to select from a local or licensed catalog by engineering criteria, emit structured
`groundMotionSet.selectionCriteria` instead of natural-language selection notes. Supported criteria include
`recordType`, `siteClass`, `minMagnitude`, `maxMagnitude`, `minDistanceKm`, `maxDistanceKm`, `targetMagnitude`, and
`targetDistanceKm`:

```json
{
  "methodPreference": "time_history",
  "groundMotionSet": {
    "source": "local_catalog",
    "requiredCount": 3,
    "selectionCriteria": {
      "recordType": "actual",
      "siteClass": "III",
      "minMagnitude": 6.0,
      "maxMagnitude": 7.2,
      "maxDistanceKm": 60,
      "targetMagnitude": 6.6,
      "targetDistanceKm": 30
    },
    "localCatalog": {
      "records": []
    }
  }
}
```

Do not invent catalog IDs or claim a local record is code-grade unless it is present in user-provided structured data.
