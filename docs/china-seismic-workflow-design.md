# China Seismic Workflow Design

This document describes the target design, skill architecture, current implementation boundary, and roadmap for a China seismic workflow in StructureClaw. It is not an MVP-only document: the first sections define the full target workflow, while the later sections record the first executable path implemented on this branch and the remaining capability gaps.

## 1. Goal

StructureClaw should support an OpenSees-backed seismic workflow for Chinese building design:

- Understand region, seismic design level, structure type, regularity, performance objective, and analysis preference from natural language.
- Establish a design basis under `GB 55002-2021` and `GB/T 50011-2010 (2024 edition)`.
- Automatically choose response spectrum analysis, time-history analysis, or a combined workflow.
- Support ground-motion input, selection, scaling, spectrum-compatibility checks, and time-history statistics.
- Run modal, response spectrum, elastic time-history, and later nonlinear analyses in OpenSees.
- Produce auditable code references, method-selection reasons, analysis results, code checks, and bilingual reports.

The success criterion is not keyword recognition. The target is a reproducible, explainable, and testable seismic design workflow.

## 2. Code Baseline

As of 2026-07-07, the baseline is:

| Use | Document | Status |
|---|---|---|
| Mandatory baseline | `GB 55002-2021 General Code for Seismic Precaution of Buildings and Municipal Engineering` | Effective since 2022-01-01. When existing engineering standards conflict with it, this general code governs. |
| Building seismic design method | `GB/T 50011-2010 Standard for Seismic Design of Buildings` | The 2024 partial revision renamed the previous code and took effect on 2024-08-01. |
| Ground-motion parameters | `GB 18306-2015 Seismic Ground Motion Parameter Zonation Map of China` + No.1 amendment effective 2026-02-27 | Current official standard basis; SAMR also lists full revision plan `20260055-Q-419` as drafting, so draft/revision-plan content must not be used as formal design basis until it replaces the current standard. |
| Fortification classification | `GB 50223-2008 Standard for Classification of Seismic Protection of Building Constructions` | Used for special, key, standard, and moderate fortification categories. |

All analysis results and reports must include the exact code versions. Legacy `GB50011` triggers can remain for compatibility, but user-facing labels should present `GB 55002-2021 + GB/T 50011-2010 (2024 edition)`.

References:

- MOHURD `GB 55002-2021` notice: https://www.mohurd.gov.cn/gongkai/zc/wjk/art/2021/art_17339_761174.html
- MOHURD `GB/T 50011-2010` 2024 partial revision notice: https://www.mohurd.gov.cn/gongkai/zhengce/zhengcefilelib/202405/20240523_778179.html
- SAMR `GB 18306-2015` standard status: https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=EC0585F90CA21ABE02826394F266B623

## 3. Non-Goals

The first delivery phase does not:

- Replace final review by a licensed structural engineer.
- Bundle ground-motion records with unclear licensing.
- Cover all complex systems, isolation, energy dissipation, over-limit review, and full performance-based design at once.
- Let the LLM produce final engineering pass/fail conclusions.
- Use regular expressions or keyword scanning for engineering intent routing.

## 4. Architecture Principles

### 4.1 LLM Understands, Deterministic Code Executes

The LLM converts natural language into structured design intent. Deterministic code owns:

- Design-basis normalization.
- Code-trigger checks.
- Design spectrum generation.
- Ground-motion scaling and spectrum compatibility.
- OpenSees execution.
- Numerical postprocessing.
- Code checks.

The LLM must not execute formulas or decide final numeric compliance.

### 4.2 No Keyword Or Regex Routing

The implementation must not do this:

```ts
if (message.includes('时程')) method = 'time_history';
if (/反应谱|response spectrum/i.test(message)) method = 'response_spectrum';
if (message.includes('8度')) intensity = 8;
```

Regex or structured parsing is allowed only for:

- File parsing, such as CSV, AT2, JSON, or text ground-motion files.
- Unit normalization, such as `cm/s2` to `m/s2`.
- Validation of already structured fields.

Engineering intent, method preference, fortification category, missing-field prompts, and next actions must come from LLM structured output or from already structured project state.

### 4.3 Automatic Choices Must Be Explainable

Every automatic method choice must include `selectionReasons` sourced from:

- User intent.
- `GB 55002-2021`.
- `GB/T 50011-2010 (2024 edition)`.
- StructureClaw engineering policy.

Reports should display these reasons, not only the selected method.

## 5. Existing Code Boundaries

| Location | Current role | Design impact |
|---|---|---|
| `backend/src/agent-runtime/` | Skill loading, draft handling, model building, execution orchestration | New semantic contracts and draft fields enter here. |
| `backend/src/agent-langgraph/tools.ts` | Tools such as `run_analysis`, `run_code_check`, `generate_report` | `run_analysis` needs an optional seismic workflow parameter. |
| `backend/src/agent-skills/analysis/opensees-seismic/` | Current OpenSees seismic skill | Should become the main China seismic workflow provider. |
| `backend/src/agent-skills/analysis/opensees-dynamic/` | Modal and time-history dynamics | Should remain a low-level executor, not a code-policy selector. |
| `backend/src/agent-skills/load-boundary/seismic-load/` | Seismic load generation | Should evolve into deterministic design-basis, spectrum, seismic-weight, and equivalent-force support. |
| `backend/src/agent-skills/code-check/gb50011/` | Minimal seismic checks | Should upgrade to the current code baseline while keeping the legacy ID. |
| `backend/src/agent-skills/result-postprocess/` | Result postprocessing entry | Should standardize OpenSees seismic results. |
| `backend/src/agent-skills/report-export/` | Report export | Should add a seismic calculation-book template. |

## 6. Target Flow

```text
User natural language
  -> LLM semantic understanding: SeismicDesignIntent
  -> Deterministic completeness check: SeismicDesignBasisCompleteness
  -> LLM prompt for missing fields or assumption confirmation
  -> Design-basis normalization: SeismicDesignBasis
  -> Method selector: SeismicMethodDecision
  -> Response spectrum generation / ground-motion selection and scaling
  -> OpenSees modal, response spectrum, time-history, or nonlinear analysis
  -> Postprocessing: floor response, envelope, mean, controlling result
  -> Code checks: GB 55002 + GB/T 50011
  -> Reports: Chinese and English
```

## 7. Semantic Intent Contract

Add `SeismicDesignIntent`. The LLM produces this object; keyword scanning must not assemble it.

```ts
export interface SeismicDesignIntent {
  task: 'design' | 'analysis' | 'code_check' | 'report' | 'comparison' | 'question';
  designCodeFamily: 'china_seismic';
  designBasis?: {
    region?: string;
    intensity?: 6 | 7 | 8 | 9;
    designBasicAccelerationG?: number;
    designGroup?: 'first' | 'second' | 'third';
    siteCategory?: 'I0' | 'I1' | 'II' | 'III' | 'IV';
    fortificationCategory?: 'special' | 'key' | 'standard' | 'moderate';
    seismicGrade?: 1 | 2 | 3 | 4;
    importanceFactor?: number;
    dampingRatio?: number;
    earthquakeLevel?: 'frequent' | 'fortification' | 'rare';
    performanceObjective?: 'basic' | 'performance_based' | 'normal_use_after_fortification';
    seismicSafetyEvaluation?: {
      approved: boolean;
      reportId?: string;
      intensity?: 6 | 7 | 8 | 9;
      designBasicAccelerationG?: number;
      designGroup?: 'first' | 'second' | 'third';
      characteristicPeriod?: number;
      rareCharacteristicPeriod?: number;
      alphaMax?: number;
    };
  };
  structureProfile?: {
    structureType?: string;
    materialFamily?: 'steel' | 'concrete' | 'composite' | 'masonry' | 'timber' | 'generic';
    heightM?: number;
    storyCount?: number;
    regularity?: 'regular' | 'irregular' | 'particularly_irregular' | 'unknown';
    hasLargeSpan?: boolean;
    hasLongCantilever?: boolean;
    hasIsolation?: boolean;
    hasEnergyDissipation?: boolean;
  };
  requestedMethod?: {
    preference?: 'auto' | 'response_spectrum' | 'time_history' | 'pushover' | 'elastic_plastic_time_history';
    userExplicit?: boolean;
    reasonZh?: string;
    reasonEn?: string;
  };
  groundMotionRequirement?: {
    source?: 'user_uploaded' | 'local_catalog' | 'generated_artificial' | 'auto';
    recordCount?: number;
    targetEarthquakeLevel?: 'frequent' | 'fortification' | 'rare';
    directions?: Array<'X' | 'Y' | 'Z'>;
  };
  missingFields: string[];
  assumptions: Array<{ zh: string; en: string }>;
  confidence: number;
}
```

After LLM output, deterministic code only validates schema, enum values, numeric ranges, and missing fields. Low confidence or missing critical fields should trigger a question, not silent guessing.

## 8. Design Basis Normalization

`SeismicDesignBasis` is the computational input. It must come from structured intent, user confirmation, settings, or model metadata.

```ts
export interface SeismicDesignBasis {
  codeBasis: {
    mandatoryCode: 'GB55002-2021';
    designStandard: 'GBT50011-2010-2024';
    groundMotionZonation: 'GB18306-2015';
  };
  region?: string;
  intensity: 6 | 7 | 8 | 9;
  designBasicAccelerationG: number;
  designGroup: 'first' | 'second' | 'third';
  siteCategory: 'I0' | 'I1' | 'II' | 'III' | 'IV';
  characteristicPeriodS: number;
  dampingRatio: number;
  fortificationCategory: 'special' | 'key' | 'standard' | 'moderate';
  seismicGrade?: 1 | 2 | 3 | 4;
  importanceFactor: number;
  earthquakeLevels: Array<'frequent' | 'fortification' | 'rare'>;
  performanceObjective: 'basic' | 'performance_based' | 'normal_use_after_fortification';
  sourceTrace: Array<{
    field: string;
    source: 'user' | 'settings' | 'gb18306' | 'model' | 'assumption';
    noteZh: string;
    noteEn: string;
  }>;
}
```

The completeness check requires at least:

- Intensity or design basic acceleration.
- Design earthquake group.
- Site category.
- Fortification category.
- Damping ratio, with an explicit assumption if defaulted.
- Height and regularity when automatic time-history decisions are needed.

## 9. Method Selector

The method selector is deterministic. It reads structured intent, design basis, and model summary.

```ts
export interface SeismicMethodDecision {
  primaryMethod: 'response_spectrum' | 'time_history' | 'elastic_plastic_time_history';
  requiredMethods: Array<'modal' | 'response_spectrum' | 'time_history' | 'pushover' | 'elastic_plastic_time_history'>;
  earthquakeLevels: Array<'frequent' | 'fortification' | 'rare'>;
  groundMotionCount?: number;
  resultCombinationRule:
    | 'spectrum_only'
    | 'max_of_spectrum_and_time_history_envelope'
    | 'max_of_spectrum_and_time_history_mean';
  requiresUserConfirmation: boolean;
  blockingMissingFields: string[];
  selectionReasons: Array<{
    source: 'user_intent' | 'GB55002-2021' | 'GBT50011-2010-2024' | 'structureclaw_policy';
    clauseHint?: string;
    zh: string;
    en: string;
  }>;
}
```

Initial rules:

| Condition | Method |
|---|---|
| Ordinary building without time-history trigger | Modal response spectrum analysis. |
| User explicitly asks for time history | Response spectrum baseline plus time-history analysis. |
| Particularly irregular building | Add frequent-earthquake time-history supplementary analysis. |
| Special fortification category | Add frequent-earthquake time-history supplementary analysis; performance objectives may require fortification or rare-earthquake analysis. |
| 7-degree or 8-degree I/II site, height greater than 100 m | Add frequent-earthquake time-history supplementary analysis. |
| 8-degree III/IV site, height greater than 80 m | Add frequent-earthquake time-history supplementary analysis. |
| 9-degree, height greater than 60 m | Add frequent-earthquake time-history supplementary analysis. |
| Rare-earthquake elastoplastic deformation, performance-based objective, or collapse-prevention check | Static pushover or nonlinear time-history path; block if nonlinear modeling data is insufficient. |
| Isolation or energy dissipation | Enter a specialized path; current implementation returns a structured capability boundary until specialized isolation/device analysis is implemented. |

Time-history combination rules:

- 3 acceleration records: use the larger of the time-history envelope and response spectrum result.
- 7 or more acceleration records: use the larger of the time-history mean and response spectrum result.
- Each elastic time-history base shear should not be less than 65 percent of the response spectrum base shear.
- The average base shear across records should not be less than 80 percent of the response spectrum base shear.

## 10. Response Spectrum Module

The response spectrum module should be deterministic Python code under `analysis/opensees-seismic/`:

```text
opensees-seismic/
  design_basis.py
  method_decision.py
  response_spectrum.py
  modal_combination.py
  floor_response.py
  ground_motion.py
  time_history.py
  code_checks.py
```

`response_spectrum.py` owns:

- Horizontal seismic influence coefficient curves from intensity, acceleration, design group, site category, and damping ratio.
- Frequent, fortification, and rare earthquake levels.
- A `requiresSpecialStudy` warning when periods exceed the normal code range.
- Spectrum points, governing parameters, source traces, and warnings.

```ts
export interface ResponseSpectrumAnalysisResult {
  status: 'success' | 'failed';
  designBasis: SeismicDesignBasis;
  spectrum: Array<{ periodS: number; alpha: number; acceleration?: number }>;
  modal: {
    modes: Array<{
      modeNumber: number;
      periodS: number;
      frequencyHz: number;
      participationX?: number;
      participationY?: number;
      effectiveMassRatioX?: number;
      effectiveMassRatioY?: number;
    }>;
    massParticipationSummary: Record<string, number>;
  };
  floorResponses: Array<{
    story: string;
    elevationM: number;
    shearXKN?: number;
    shearYKN?: number;
    storyShearKN?: number;
    cumulativeWeightKN?: number;
    shearWeightRatio?: number;
    driftRatioX?: number;
    driftRatioY?: number;
  }>;
  baseShear: { xKN?: number; yKN?: number };
  warnings: string[];
}
```

## 11. Ground Motions And Time History

First phase supports:

- User-uploaded records.
- User-configured local catalog paths.
- Artificially generated records.

Records with unclear licensing must not be committed to the repository.

```ts
export interface GroundMotionRecord {
  id: string;
  source: 'uploaded' | 'local_catalog' | 'artificial';
  dtS: number;
  acceleration: number[];
  unit: 'm/s2' | 'cm/s2' | 'g';
  direction: 'X' | 'Y' | 'Z';
  scaleFactor?: number;
  metadata?: {
    eventName?: string;
    station?: string;
    magnitude?: number;
    distanceKm?: number;
    siteClass?: string;
  };
}
```

```ts
export interface GroundMotionSelectionResult {
  targetSpectrum: Array<{ periodS: number; alpha: number }>;
  records: GroundMotionRecord[];
  scaledSpectra: Array<Array<{ periodS: number; alpha: number }>>;
  averageSpectrum: Array<{ periodS: number; alpha: number }>;
  checks: {
    realRecordRatioOk: boolean;
    spectrumCompatibilityOk: boolean;
    maxScaleFactor?: number;
    scaleFactorLimit?: number;
    singleBaseShear65Ok?: boolean;
    averageBaseShear80Ok?: boolean;
  };
  warnings: string[];
}
```

```ts
export interface TimeHistoryAnalysisResult {
  status: 'success' | 'failed';
  recordResults: Array<{
    recordId: string;
    scaleFactor: number;
    maxBaseShearXKN?: number;
    maxBaseShearYKN?: number;
    maxRoofDisplacementM?: number;
    maxDriftRatio?: number;
    floorEnvelope: Array<{
      story: string;
      shearXKN?: number;
      shearYKN?: number;
      driftRatioX?: number;
      driftRatioY?: number;
    }>;
  }>;
  statistics: {
    envelope?: Record<string, unknown>;
    mean?: Record<string, unknown>;
    controllingCombination: 'envelope' | 'mean';
  };
  compatibilityChecks: GroundMotionSelectionResult['checks'];
  warnings: string[];
}
```

## 12. Skill Architecture

### 12.1 New Or Upgraded Skills

| Skill | Type | Responsibility |
|---|---|---|
| `general/china-seismic-design-intent` | New | LLM semantic understanding for China seismic design; outputs `SeismicDesignIntent`. |
| `load-boundary/seismic-load` | Upgrade | Design basis, spectrum, seismic weight, and equivalent seismic action support. |
| `analysis/opensees-seismic` | Upgrade | Main China seismic workflow entry for `auto`, response spectrum, time history, pushover, and nonlinear time history in phases. |
| `analysis/opensees-dynamic` | Keep, narrower role | Low-level modal and time-history executor only. |
| `code-check/gb50011` | Upgrade | Keep the ID for compatibility; report against `GB 55002-2021 + GB/T 50011-2010 (2024 edition)`. |
| `result-postprocess/opensees-seismic` | New or upgrade | Normalize floor response, envelopes, means, controlling results, and visualization data. |
| `report-export/seismic-cn` | New or upgrade | Generate bilingual seismic calculation reports. |

### 12.2 Selection Principle

- Structure-type skills continue to build models.
- The seismic intent skill understands whether the user wants China seismic design and what level or method is requested.
- Analysis skills execute.
- Code-check skills verify.
- Report skills present.

Analysis skills must not inspect raw user text to change methods. They read only `SeismicWorkflowRequest`.

## 13. Tool And Runtime Contract Changes

Current `run_analysis` cannot carry the seismic workflow. Add an optional field:

```ts
export interface RunAnalysisInput {
  analysisType: 'static' | 'dynamic' | 'seismic' | 'nonlinear';
  floorLoadTransferMode?: 'auto_code_cn' | 'node_tributary' | 'one_way_slab' | 'two_way_slab';
  seismicWorkflow?: SeismicWorkflowRequest;
}
```

```ts
export interface SeismicWorkflowRequest {
  intent: SeismicDesignIntent;
  designBasis: SeismicDesignBasis;
  methodDecision: SeismicMethodDecision;
  responseSpectrumOptions?: {
    modalCombination?: 'CQC' | 'SRSS';
    directions?: Array<'X' | 'Y'>;
  };
  groundMotions?: GroundMotionRecord[];
  timeHistoryOptions?: {
    integration?: 'Newmark';
    timeStepS?: number;
    durationS?: number;
    dampingModel?: 'rayleigh' | 'modal';
  };
  outputOptions?: {
    includeRawTimeSeries?: boolean;
    includeFloorEnvelope?: boolean;
    includeMemberForceEnvelope?: boolean;
  };
}
```

If `analysisType='seismic'` and `seismicWorkflow` is missing in the chat tool path, `run_analysis` must return `SEISMIC_WORKFLOW_REQUIRED` and ask the model to produce the structured workflow first. The lower-level runtime may keep legacy parameter compatibility for direct regression and historical callers, but the full China-code workflow must start from `seismicWorkflow`. Direct lower-level calls that omit `seismicWorkflow` must mark the result with `workflowInputMode="legacy_compatibility_parameters"` and a warning, so they cannot be mistaken for the structured China-code workflow.

## 14. Agent Interaction

### 14.1 Missing Fields

The system should ask for missing critical fields:

- Region or intensity/acceleration.
- Design earthquake group.
- Site category.
- Fortification category.
- Height and regularity.
- Ground-motion source when time history is requested or required.

The LLM writes the user-facing question, but deterministic completeness checks own the missing-field list.

### 14.2 Assumptions

The system may propose assumptions, but must record them:

- Damping ratio of 0.05.
- Standard fortification category.
- Regular structure.
- Two principal horizontal directions.

Assumptions that can change method selection or compliance must be confirmed by the user.

## 15. Report Design

A seismic report should include:

- Project input and design basis.
- Code versions.
- LLM understanding summary.
- Missing fields and assumptions.
- Method-selection reasons.
- Response spectrum parameters and curve.
- Modal results and mass participation.
- Ground-motion records, scale factors, and spectrum compatibility.
- 65 percent / 80 percent base-shear checks.
- Floor shear, drift ratios, and controlling results.
- Member seismic check summary.
- Risks and limitations.

All user-visible report text must support `zh` and `en`.

## 16. Test Plan

| Layer | Coverage |
|---|---|
| LLM contract tests | Natural-language inputs produce valid `SeismicDesignIntent`; no keyword-hit assertions. |
| Rule unit tests | Method selection, height thresholds, time-history combination, 65/80 checks. |
| Spectrum unit tests | Spectrum parameters, damping adjustment, characteristic period, abnormal-period warnings. |
| Ground-motion tests | File parsing, unit conversion, scaling, average spectrum, real-record ratio. |
| OpenSees integration tests | Simple-frame modal, response spectrum, and elastic time-history runs. |
| End-to-end tests | `build_model -> validate_model -> run_analysis(seismic) -> run_code_check -> generate_report`. |
| Bilingual tests | Chinese and English reports include code versions, method reasons, and check results. |

Suggested commands:

```bash
npm test --prefix backend -- --runInBand
node tests/runner.mjs validate validate-agent-orchestration
node tests/runner.mjs validate validate-analyze-contract
node tests/runner.mjs validate validate-chat-stream-contract
```

When frontend settings or report UI changes are included:

```bash
npm run type-check --prefix frontend
npm run test:run --prefix frontend
```

## 17. Delivery Phases

### Phase 0: Design And Contracts

- Add this document.
- Add schema drafts for `SeismicDesignIntent`, `SeismicDesignBasis`, and `SeismicMethodDecision`.
- Add tests that make keyword/regex intent routing unacceptable.

### Phase 1: LLM Semantic Understanding

- First update existing structure-type skills and `opensees-seismic` stage prompts so the LLM emits seismic intent.
- Add `general/china-seismic-design-intent` only when multiple structure families need the same reusable seismic semantic layer.
- Add missing-field prompts and assumption confirmation.

### Phase 2: Response Spectrum MVP

- Rework `opensees-seismic` response spectrum modules.
- Support modal analysis, CQC/SRSS, floor response, and base shear.
- Report code versions and method-selection reasons.

### Phase 3: Ground Motions And Elastic Time History

- Support uploads and local catalog references.
- Support artificial records.
- Implement scaling, average spectrum, and 65/80 checks.
- Implement 3-record and 7-record combination rules.

### Phase 4: Code Checks And Reports

- Upgrade `code-check/gb50011`.
- Add seismic report templates.
- Add bilingual frontend presentation.

### Phase 5: Nonlinear And Performance-Based Design

- Integrate `opensees-nonlinear`.
- Support pushover and nonlinear time history.
- Extend performance objectives and rare-earthquake deformation checks.

## 18. Risks And Open Questions

- Code tables and parameters need auditable data sources, not hidden constants only.
- City-to-`GB 18306-2015` parameter mapping needs a legal data source.
- Regularity classification should be incremental; first phase may require explicit user or model input.
- OpenSees response spectrum behavior must define model dimensionality, mass source, rigid-floor assumptions, and diaphragm constraints.
- Ground-motion licensing and uploaded-data retention need product and security decisions.
- Nonlinear analysis requires material models, hinges, convergence strategy, and careful interpretation; it must not be presented as fully supported in the MVP.

## 19. Acceptance Criteria

The first usable release should satisfy:

- Natural-language China seismic requests produce structured LLM intent.
- The system does not choose methods through keyword or regex checks.
- A regular frame can run response spectrum analysis and report code versions, method reasons, modes, and floor responses.
- For time-history-triggered structures, the system explains ground-motion requirements and blocks or asks questions when records are missing.
- With 3 or 7 provided records, the system runs elastic time history, performs 65/80 checks, and reports controlling combinations.
- Chinese and English reports display design basis, assumptions, method selection, results, and limitations.

## 20. Code-Aligned Minimal Adjustment Plan

Based on the current implementation, the first implementation pass should stay inside existing module boundaries and avoid a new top-level workflow engine.

### 20.1 Stable Boundaries

- Do not add a new top-level agent mode, and do not change existing static, dynamic, PKPM, YJK, or OpenSees static flows.
- Keep `backend/src/agent-skills/analysis/opensees-seismic` as the China seismic analysis entry point with `analysisType: seismic`.
- Do not use the existing provider-request regexes in `backend/src/agent-langgraph/tools.ts` for `analysisType="seismic"`; the seismic analysis provider comes from the structured selected skill scope. China seismic method selection must come from LLM structured understanding plus deterministic rules over structured fields.
- Do not split response spectrum and time history into separate analysis skills, because that would make the current `analysisType + engineId` registry resolution ambiguous.

### 20.2 Data Contract

- Reuse `DraftState.siteSeismic`, `DraftState.analysisControl.designParams`, and `DraftState.skillState` first.
- Add the logical contract `skillState.seismicWorkflow` for the LLM-understood seismic design intent, code basis, method preference, missing fields, ground-motion needs, and user confirmations.
- Add only one minimal optional field to `run_analysis`: `seismicWorkflowJson?: string`. The tool layer parses and validates JSON, then passes it to `parameters.seismicWorkflow`; it does not infer methods from natural-language text.
- Keep the lower-level `opensees-seismic` runtime backward-compatible with old parameters such as `{ method: "response_spectrum" }`, but the LangGraph chat tool path must return `SEISMIC_WORKFLOW_REQUIRED` for `analysisType="seismic"` when no non-empty structured `seismicWorkflow` is present.

### 20.3 LLM Semantic Understanding

- First update `structure-type/concrete-frame/draft.md` and the `analysis/opensees-seismic` stage documents so the LLM emits `skillState.seismicWorkflow`.
- TypeScript validates schema, computes missing fields, and merges state; it must not extract engineering intent through keyword matching.
- If steel frames, shear walls, bridges, or other families later need the same seismic intent layer, extract it into `general/china-seismic-design-intent`.

### 20.4 OpenSees Module Layout

Keep `opensees-seismic/runtime.py` as a thin dispatcher and add focused modules in the same directory:

- `seismic_contracts.py`: parse and validate `parameters.seismicWorkflow`.
- `design_basis.py`: normalize parameters for `GB 55002-2021`, `GB/T 50011-2010 (2024 revision)`, and `GB 18306-2015`.
- `method_decision.py`: choose response spectrum, supplementary elastic time history, or blocking questions from structured fields only.
- `spectrum.py`: generate design response spectra and damping adjustments.
- `modal.py` or `opensees_model.py`: extract periods, mode shapes, and mass participation from the real OpenSees model.
- `ground_motion.py`: handle records, units, scaling, average spectra, and 65/80 checks.
- `result_adapter.py`: return the existing `AnalysisResult` shape and keep `data.envelope` compatible with postprocessing and reports.

The current simplified module's fixed periods, fixed mass, and fixed modes may remain as compatibility scaffolding, but they cannot be the formal China-code MVP result.

### 20.5 First Deliverable Workflow Scope

- First support the concrete-frame path, because `concrete-frame/model.ts` already serializes `site_seismic` and `analysis_control` into model metadata.
- Deliver response spectrum first: real modal results, floor response, base shear, drift ratios, and method-selection reasons.
- Deliver time history second: initially support user-provided 3-record or 7-record sets with scaling, spectrum compatibility, and combination rules.
- For unsupported structure families, return clear `partial` results with missing capabilities and next required inputs; execution failures should still raise through the existing analysis runtime convention.

### 20.6 Test Boundaries

- Add a tool-contract test that `seismicWorkflowJson` is passed through to `parameters.seismicWorkflow`.
- Add method-decision unit tests that use structured objects and never assert keyword hits.
- Add an `opensees-seismic` compatibility test for the old `method` parameter path.
- Add regression protection showing static analysis, existing dynamic analysis, and PKPM/YJK skills are unaffected.

## 21. Current Implementation Status

This branch now implements the first executable path:

- The `param-extractor` and runtime skill executor output contracts now explicitly include `skillState.seismicWorkflow`, and require China seismic methods and ground-motion requirements to come from whole-message semantic understanding as structured fields. The extractor preserves existing `skillState.seismicWorkflow` and does not carry old invalid-field diagnostics into the next clarification turn.
- The param-extractor, runtime skill executor, generic StructureModel builder prompt, and GB50011 code-check skill prompt now also require member seismic evidence to stay structured when it appears in user text, model JSON, or uploaded tables: `seismicCapacity`, `capacityDesign`, `strongShearWeakBending`, `shearCompression`, `jointCore`, `wallData`, `boundaryElement`, and `steelSeismicDetailing` are explicit contract fields. This keeps member-capacity/detailing evidence available to deterministic code-checks instead of leaving it as prose; prompt tests assert that these fields remain in the LLM contracts and that the LLM must not decide clause pass/fail status.
- Deterministic StructureModel generation now preserves structured `seismicMemberEvidence` / `seismicWorkflow.memberEvidence` after model creation: evidence with an explicit matching element ID is attached to that element using the same GB50011 code-check keys, while unmatched evidence is retained in model metadata for audit instead of being guessed onto a member.
- Analysis provider selection also avoids natural-language keyword or regex routing. If the user semantically requests a provider such as PKPM/SATWE, YJK, or OpenSees, the LLM must pass the structured `analysisSkillId` to `run_analysis`; the tool only checks that the requested skill is selected in the current session and otherwise returns `ANALYSIS_PROVIDER_NOT_SELECTED`.
- The calculation layer now accepts both semantic contract fields and normalized runtime fields: `requestedMethod.preference`/`methodPreference`, `structureProfile`/`structure`, and `groundMotionRequirement.recordCount/directions`/`groundMotionSet.requiredCount` all feed deterministic method selection and design-basis normalization, so an LLM output that follows the design contract is not silently ignored.
- `set_session_config` now auto-completes the China seismic workflow-safe skill baseline when the session is set to `analysisType="seismic"`, a GB50011/GB55002 design code, or the `opensees-seismic` skill: generic/frame/concrete-frame modeling, OpenSees seismic analysis, GB50011 code-check, structure-model validation, and report export. This prevents selecting only an analysis provider from cutting off modeling or code-checking.
- `run_analysis` accepts `seismicWorkflowJson` and can read LLM-structured seismic intent from `draftState.skillState.seismicWorkflow`; in the LangGraph chat tool path, `analysisType="seismic"` without a non-empty `seismicWorkflow` returns `SEISMIC_WORKFLOW_REQUIRED` instead of entering the compatibility execution path, and method enums, directions, modal combination, ground-motion record arrays, required record counts, catalog IDs, and scale-factor limits receive lightweight structural validation. The lower-level `opensees-seismic` runtime marks structured calls as `workflowInputMode="structured_seismic_workflow"` and legacy direct calls as `workflowInputMode="legacy_compatibility_parameters"` with a warning. The same mode is exposed in the compact tool summary, report seismic section, and frontend analysis overview.
- The legacy `AgentPolicyService` still keeps simple non-seismic compatibility helpers, but it no longer infers `GB50011` or `GB55002` from a natural-language regex match; China seismic code selection must arrive through the LLM-built structured `seismicWorkflow` / explicit session config path, so regex policy helpers cannot bypass semantic routing.
- `opensees-seismic/runtime.py` is split into contract parsing, design basis, method decision, design spectrum, modal, ground-motion, and result-adapter modules.
- The response-spectrum path supports OpenSees modal extraction, design spectra, CQC/SRSS modal combination, floor response, base shear, drift ratios, story shear-weight ratios and minimum story-shear adjustment trace for GB/T 50011 5.2.5, and the existing `envelope` postprocessing contract. CQC is the default and structured `responseSpectrum.modalCombination="srss"` switches back to SRSS. 3D models can run structured `directions=["x","y"]` bidirectional analysis, with per-direction results in `directionResults` and the controlling direction preserved in the overall envelope. For structural families with implemented GB/T 50011 5.5.1 drift limits, response-spectrum results now expose `responseSpectrum.finalCompliance` / `responseSpectrumFinalCompliance`, while the full elastic response-spectrum/time-history envelope exposes `elasticStoryDriftFinalCompliance` with `limitFamily` and `limitRatioText`: concrete frame `1/550`, concrete frame-shear-wall / frame-core-tube `1/800`, concrete shear-wall / tube-in-tube / transfer-level families `1/1000`, and steel-frame/steel families `1/250`. For each direction, response-spectrum floor forces are increased where needed to satisfy the 5.2.5 minimum story-shear coefficient, then applied as an OpenSees equivalent lateral static case and exposed in `seismicDesignActions.memberForces` for downstream member design-action and code-check traceability.
- OpenSees seismic modeling now treats structured two-node wall elements as equivalent line members in the modal, response-spectrum equivalent lateral static, representative-gravity, and vertical-seismic static paths. The current scope is explicit: it supports `type="wall"` and compatible structured wall aliases with `section.thickness` plus explicit `section.properties.wallLength` or area-derived length; it does not claim shell-wall meshing, wall-opening finite elements, or full nonlinear wall constitutive behavior.
- The ground-motion path supports user-provided records, uploaded CSV `headers/rows` and AT2/TXT `content` returned by `analyze_file`, unit conversion, first-mode scaling and spectrum-match summaries, multi-mode modal SDOF response statistics, CQC/SRSS modal combination, scale-factor control configurable through `groundMotionSet.scaleFactorLimit`, 3-record/7-record combination logic, and 65/80 base-shear checks. It now emits `timeHistory.combinationSummary`: 3-record sets use the larger of the time-history envelope and response-spectrum base shear, while 7-or-more-record sets use the larger of the time-history average and response-spectrum base shear. The time-history branch now attempts an OpenSees transient check, extracts transient story-drift ratios from matching vertical node lines when available, falls back to level-average drift only when node-line matching is unavailable, carries the time-history drift into the combined envelope, and explicitly keeps the modal SDOF fallback when transient analysis is unavailable.
- Structured `methodPreference="elastic_plastic_time_history"` is now explicitly recognized instead of falling back to `auto`. In `auto`, structured rare-earthquake design basis, performance objectives, explicit elastic-plastic deformation requirements, or structured nonlinear model/time-history controls now deterministically trigger the elastic-plastic time-history requirement. The runtime executes the available response-spectrum path and the elastic time-history comparison path. When structured `nonlinearModel.memberPlasticHinges` provide complete 2D element-end yield moment/yield rotation data, the nonlinear branch first runs a restricted OpenSees member-end rotational plastic-hinge transient estimate and reports `modelScope="member_end_rotational_plastic_hinges_2d"`, record-level hinge responses, and the controlling hinge. If that path is unavailable, it runs an OpenSees bilinear multi-story shear-building elastic-plastic estimate when floor masses are available; single-story or failed multi-story runs fall back to the bilinear SDOF estimate. When no structured yield drift is provided, those reduced-model fallbacks use the shared structural-family GB/T 50011 5.5.1 elastic drift limit as the advisory yield drift and expose `yieldDriftLimitRatioText` / `yieldDriftLimitFamily`; unsupported families retain an explicit concrete-frame fallback marker. The result reports record-level roof displacement, base shear, ductility, story drift traces when available, and `elasticPlasticTimeHistory.finalCompliance` from maximum story drift and the acceptance limit. It also audits structured `nonlinearModel.materialConstitutiveModels`, `nonlinearModel.memberPlasticHinges`, hinge backbone calibration, and `convergenceCriteria` into `elasticPlasticTimeHistory.nonlinearModelAudit`, so missing model inputs are traceable separately from solver capability. Because a full distributed/member nonlinear constitutive solver is not built yet, `scope` and `gb50011.elasticPlasticTimeHistoryFullMemberAnalysis` in `missingCapabilities` make the remaining full-member boundary explicit even when the restricted 2D hinge path runs.
- Structured performance objectives can now provide drift-acceptance targets through `performanceObjective.acceptanceDriftRatio` / `limitDriftRatio`, or method-specific `elasticPlasticTimeHistory.performanceObjective` and `pushover.performanceObjective`. The selected objective is carried into the elastic-plastic time-history and Pushover acceptance checks, final-compliance objects, reports, and frontend overview. Under `methodPreference="auto"`, a structured performance objective also participates in deterministic method selection by requiring the nonlinear time-history path when ground motions are available, selecting the structured Pushover path when Pushover inputs are present and ground motions are absent, or surfacing missing ground-motion inputs when neither nonlinear execution path is supplied. This is a structured acceptance-target and restricted capacity-spectrum performance-point estimate, not a complete performance-based design workflow.
- The standalone `analysis/opensees-nonlinear` runtime no longer throws a raw `NotImplementedError`; it returns a structured `partial` capability-boundary result with model scale, nonlinear-model input audit, missing inputs, missing full-member solver capabilities, and next action. This keeps explicit nonlinear requests explainable without claiming full OpenSees nonlinear execution.
- For 3D time-history analysis, ground-motion records can carry structured `direction`/`component` fields; the runtime selects matching X/Y components per requested direction, while untagged records remain usable for each direction. It does not use Y-tagged components as X components.
- When structured requirements trigger supplementary time-history analysis but records are missing or insufficient, results expose `groundMotionRequirement` with required/provided/missing counts and status; bidirectional time-history results also expose `totalRequiredCount` and `directionRequirements` so missing X/Y components are counted per direction. Top-level `missingInputs` keeps `groundMotions`, and the report/frontend overview can show the full record requirement and missing directional components.
- The pushover path now returns the same China seismic workflow result shape instead of the old compatibility payload: it reuses the OpenSees elastic frame model for linear static displacement-control pushover and returns `data.pushover`, `envelope`, `methodDecision`, `designBasis`, and report metrics. It derives initial stiffness, a secant capacity-spectrum performance-point estimate from the GB design spectrum and floor weights, drift ratio, and advisory acceptance check from the curve. When structured `nonlinearModel.memberPlasticHinges` provide complete element-end yield moment and yield rotation data for a 2D frame, it first runs a restricted OpenSees member-end rotational plastic-hinge displacement-control estimate and reports `modelScope="member_end_rotational_plastic_hinges_2d"`, hinge responses, and the controlling hinge. If that path is unavailable, it uses the OpenSees bilinear multi-story shear-building estimate when floor masses are available, then falls back to the bilinear SDOF estimate. The reduced-model Pushover fallbacks use the same structural-family advisory yield-drift metadata as elastic-plastic time history when explicit yield drift is absent. The runtime derives `pushover.finalCompliance` from the nonlinear estimate or capacity-curve drift acceptance and marks `pushoverPerformancePointEstimate`, `pushoverCapacitySpectrumIteration`, `pushoverMemberPlasticHinge2dEstimate`, `pushoverBilinearSdofEstimate`, `pushoverBilinearStoryShearBuildingEstimate`, and `gb50011.nonlinearPushoverFinalCompliance` as implemented when the corresponding paths run. The overall result can still be `partial` when other inputs or regularity warnings remain, and the 2D hinge path still exposes the remaining full-member constitutive-model boundary.
- Built-in artificial records `SCGM-A1` through `SCGM-A7` support structured catalog selection and auto-selection; they are for workflow execution, demos, and regression, not a real recorded strong-motion database.
- User- or project-provided local/licensed ground-motion catalogs are supported via `groundMotionSet.localCatalog.records`; records can be selected by exact structured `catalogIds` or deterministically filtered and sorted by structured `selectionCriteria` fields such as record type, site class, magnitude range, distance range, target magnitude, and target distance. Selected records retain `recordType=actual` and feed both time-history analysis and actual-record-ratio checks.
- Method selection is based only on `seismicWorkflow`, model metadata, automatic regularity assessment, and structured code fields; no keyword or regex method routing is used. Auto selection now covers response spectrum, supplementary elastic time history, elastic-plastic time-history demand from structured rare-earthquake/performance/nonlinear-model requirements, and structured Pushover when nonlinear static inputs are provided without ground motions.
- `seismicWorkflow.structure.heightM/storyCount` now flows into `SeismicDesignBasis` and takes precedence over older model metadata for automatic method selection; when structured height triggers supplementary time-history analysis but ground motions are missing, the result returns `partial`, `groundMotionRequirement`, and `missingInputs=["groundMotions"]` instead of silently downgrading to a final response-spectrum-only result.
- `opensees-seismic/regularity.py` now provides a structured-model heuristic regularity assessment from explicit nested `seismicWorkflow.regularityAssessment.classification`, story heights, floor loads, story-mass variation from structured story weight/mass or floor load multiplied by story plan area, structured global or story-level slab-opening area/opening-ratio and rigid-diaphragm flags, structured story lateral stiffness, story column lateral stiffness, structured story lateral strength/capacity variation, structured weak/soft-story flags, story-level plan setback, structured plan-irregularity/reentrant-corner/plan-concavity flags or ratios, structured transfer-story/vertical lateral-system discontinuity flags, overall plan aspect ratio, structured torsional displacement ratios, node plan extents, and story node-centroid versus column-stiffness-center eccentricity; `particularly_irregular` triggers supplementary time-history demand, while `irregular` asks for engineer review without forcing time history by itself.
- Design-basis results now expose `region`, `seismicGrade`, `missingInputs`, and `isPreliminary`; if only a region is known but no official `GB 18306-2015` intensity or design basic acceleration is provided, results and reports are marked preliminary instead of claiming final compliance. If only intensity 7 or 8 is provided without design basic acceleration or explicit `alphaMax`, the run marks `designBasis.siteSeismic.accelerationG` as missing and uses the higher conservative `alphaMax` for preliminary analysis. `codeBasis` also records `GB 18306-2015` with the No.1 amendment effective 2026-02-27 as the current official ground-motion zonation standard basis and carries the official `20260055-Q-419` drafting-stage full revision-plan trace; reports show that the revision plan is not used as the current formal design basis.
- Design basic acceleration parsing now accepts the semantic contract field `designBasicAccelerationG` as well as compatibility fields such as `accelerationG` and `basicAccelerationG`; higher-bin inputs such as 0.15g and 0.30g correctly derive intensity and `alphaMax` instead of being treated as missing.
- Design-basis normalization now normalizes structured `fortificationCategory` under `GB 50223-2008` into special/key/standard/moderate categories, exposes the category label and A/B/C/D class, derives the seismic action standard and seismic measure intensity, and marks special fortification category runs preliminary unless an approved structured seismic safety evaluation is supplied. For special fortification category runs, supplied safety-evaluation `designBasicAccelerationG`, `intensity`, `designGroup`, `characteristicPeriod`, `rareCharacteristicPeriod`, and `alphaMax` take precedence only when `seismicSafetyEvaluation.approved` is explicitly true.
- Design-basis normalization now supports structured `earthquakeLevel` / `targetEarthquakeLevel`, mapping frequent, fortification, and rare earthquake levels to the corresponding maximum horizontal seismic influence coefficient. Rare-earthquake spectra add 0.05s to the characteristic period per `GB/T 50011-2010 (2024 edition)`. Pure elastic rare-earthquake response-spectrum results keep the numeric spectrum and envelope while exposing the `gb50011.rareEarthquakeElasticPlasticDeformation` capability boundary; when the same run includes elastic-plastic time-history or pushover `finalCompliance`, that capability is moved to `implementedCapabilities`.
- Response-spectrum results now include `periodRangeAssessment`; if any modal period exceeds the normal 6.0s GB/T 50011 design-spectrum range, the run also emits `longPeriodSpecialStudyAdvisory` with the governing mode and conservative advisory influence coefficient trace. The result still exposes `gb50011.responseSpectrumLongPeriodSpecialStudy`, marks final compliance unsupported, and shows the long-period special-study requirement in the report and frontend overview because this advisory trace is not a substitute for a project-specific long-period study.
- Method decisions now support structured vertical-seismic-action demand detection: intensity 8 or 9 with `structureProfile.hasLargeSpan`, `hasLongCantilever`, or `hasIsolation`, and intensity 9 high-rise conditions, emit `methodDecision.verticalSeismicRequired` with reasons. Large-span/long-cantilever paths calculate the vertical seismic standard value, coefficient, representative gravity load, and floor distribution, then attempt an OpenSees equivalent vertical static solve to report vertical base reaction, maximum vertical displacement, and member end forces. Large-space structures can use the equivalent vertical response-spectrum coefficient `0.65 * alphaMax`. The `GB50011` global code check reads member end forces plus explicit structured `verticalSeismicCapacity` utilization or demand/capacity data when available; otherwise it falls back to section/material data from `elementData` for a simplified vertical-seismic member-capacity screening check. When neither comparable structured capacity nor section/material data is available, it returns a not-applicable item instead of passing by default.
- Method decisions also expose structured isolation and energy-dissipation audits and capability boundaries. When `structure.hasIsolation`, `structureProfile.hasIsolation`, `structure.hasEnergyDissipation`, `structure.hasEnergyDissipationSystem`, `structure.hasDampingDevice`, or dedicated `isolationSystem` / `energyDissipationSystem` / `dampingSystem` objects are provided, the result records `methodDecision.specialSystemReviewRequired`, preserves specific reasons, outputs `specialSystemReview` with system types, device counts, missing structured device/input fields, and any provided demand/capacity acceptance checks. GB50011 code-check now preserves those acceptance-check details, including item, status, utilization, formula, demand, capacity, source, and unit, inside the special-system audit item. When isolation stiffness, damping, displacement capacity, and modal mass or explicit system mass/weight are available, it also outputs a restricted equivalent-linear isolation response-spectrum estimate with period, alpha, base shear, displacement demand, and displacement utilization. When selected ground-motion records are also available, it now adds a restricted SDOF isolation-layer time-history estimate with record-level displacement/base-shear responses, controlling record, displacement utilization, and final-compliance trace. When an energy-dissipation system provides an explicit additional/equivalent damping ratio plus demand/capacity deformation inputs, it also outputs a restricted equivalent-damping deformation estimate with period, damping ratios, demand reduction factor, adjusted deformation demand, and deformation utilization. When energy-dissipation mass, period/stiffness, damping, devices, and selected ground-motion records are available, it also outputs a restricted SDOF time-history estimate with record-level device deformation/device-force demand, controlling record, utilization, and final-compliance trace. The result still adds `gb50011.isolationSystemSpecialSeismicAnalysis` and/or `gb50011.energyDissipationSystemSpecialSeismicAnalysis` to `missingCapabilities`, and marks final compliance unsupported instead of treating the ordinary response-spectrum/time-history result as a full specialized-system design.
- GB50011 global code-check now also reads structured over-limit or special seismic review traces from `analysisSummary.overLimitReview`, `analysisSummary.specialReview`, `analysisSummary.specialSeismicReview`, `analysisSummary.overLimitSpecialReview`, matching nested `designBasis` / `methodDecision` review objects, and explicit review flags in `regularityAssessment`. If a structured review is required, final compliance fails until the review trace carries approved or completed evidence; approved review evidence is preserved with source path, type, authority, date, and approval/report ID. This is an auditable evidence gate only; it does not infer legal over-limit status from message keywords or replace the official special-review process.
- The runtime also extracts OpenSees member end forces under representative gravity load from floor masses, then combines gravity, horizontal equivalent seismic actions, and vertical seismic actions into `memberDesignActionCombinations`. The current coverage preserves the single-direction `1.2G + 1.3Eh` case, and bidirectional response-spectrum runs now emit `1.2G + 1.3Ex`, `1.2G + 1.3Ey`, plus X/Y companion-direction cases controlled by `designCombinations.orthogonalHorizontalFactor`. When vertical seismic action is required, it also emits `1.2G + 1.3Ev` and horizontal/vertical companion cases. Per-member axial, shear, and moment envelopes feed the report, frontend overview, and GB50011 global code-check traceability.
- User- or project-provided structured `GB 18306-2015` zonation tables are supported. The runtime matches by `regionCode` or exact structured `region`, then fills design basic acceleration, intensity, design earthquake group, and characteristic period; it does not embed or guess city parameters.
- The `GB 50011` code-check entry accepts aliases such as `GB/T 50011-2010-2024` and `GB 55002 + GB/T 50011`, and appends a `__global_seismic__` check for seismic analysis results: design-basis completeness, structured seismic-grade basis, structured workflow input, capability boundary, isolation/energy-dissipation special-system structured audit including restricted isolation-layer and energy-dissipation SDOF time-history trace inputs when present, regularity assessment and particularly-irregular supplementary time-history trigger, frequent-earthquake elastic drift ratio, modal mass participation, response-spectrum long-period special-study requirement, GB/T 50011 5.2.5 story minimum seismic shear coefficient, horizontal seismic member forces, basic seismic action combinations, combination member-capacity screening, required supplementary time-history completeness, the 3-record or at-least-7-record ground-motion count rule, 65/80 time-history base-shear ratios, time-history combination-summary rule, direction-level time-history traceability for bidirectional results, actual-record ratio, ground-motion scale factor, elastic-plastic time-history final compliance, pushover elastic-plastic estimate drift, and pushover final compliance. The tool bridge now forwards elastic-plastic time history, regularity assessment, horizontal/gravity member forces, and seismic basic action combinations into code-check. Element checks also add a structured seismic-combination member capacity item when member combination actions plus explicit demand/capacity or utilization data are available; when an explicit `gammaRE` / `seismicCapacityAdjustmentFactor` is supplied with that structured capacity data, the check traces `S <= R/gammaRE`, adjusted capacity, and the gamma source. For concrete beams, columns, seismic walls, and coupling beams, they add a GB/T 50011 6.2.9 shear-compression section-limit item when structured shear demand, concrete strength, width, and effective-depth data or explicit utilization is available. For concrete frame beams/columns, they also add a GB/T 50011 6.2.4 + 6.2.5 strong-shear weak-bending shear-capacity item when structured capacity-design shear demand/capacity or utilization data is available. They add a GB/T 50011 6.3.6 frame-column axial-compression-ratio item when structured `seismicGrade`, combination axial force, section area, and concrete strength are available; when structured column `shearSpanRatio` is available, that axial-ratio limit is reduced by 0.05 for short columns and a special-requirement item fails if the ratio is below 1.5. When concrete material grade or explicit `fc` is available, element checks add a GB 55002-2021 5.1.2 material-strength-grade item requiring transfer beams/columns and Grade 1 or Grade 2 frame beams/columns to be not lower than C30. When frame-beam section width/depth and span are available, element checks add a GB/T 50011 6.3.1 beam-section geometry item for minimum width, depth-to-width ratio, and clear-span-to-depth ratio. When structured beam section/reinforcement/joint data is available, element checks add GB/T 50011 6.3.2/6.3.3/6.3.4 flat-beam detailing, beam continuous longitudinal reinforcement, beam-end longitudinal ductility, through-interior-column bar-diameter, and beam-end confined-zone stirrup detailing items for flat-beam section limits and arrangement flags, top/bottom bar count, diameter, continuous-area ratio, beam-end compression-zone ratio, bottom/top area ratio, end tension-ratio limit, through-joint bar diameter, confined-zone length, stirrup spacing/diameter, leg spacing, first-stirrup distance, and 135-degree hook detailing. When concrete frame-column section width/depth plus `seismicGrade` and `storyCount` are available, element checks add a GB/T 50011 6.3.5 frame-column section geometry item for 300/400mm minimum side length and long-to-short side ratio. When structured column or joint reinforcement/capacity data is available, element checks add GB/T 50011 6.2.2, 6.2.15 + Appendix D, and 6.3.7/6.3.8/6.3.9/6.3.10 frame-joint strong-column weak-beam moment relationship, frame-joint core shear-capacity verification, column longitudinal-reinforcement-ratio, supplemental longitudinal detailing, confined-zone stirrup diameter/spacing, confined-zone range, confined-zone volumetric ratio, non-confined-zone stirrup volume/spacing, and frame-joint core stirrup detailing items.
- The GB50011 global code-check now includes a `GB 18306-2015` standard-status item, a `GB 55002-2021 2.3.2 + GB 50223-2008` fortification-category item, and a structured seismic-grade basis item. It reads only structured design-basis fields, confirms that current `GB 18306-2015` plus the effective No.1 amendment remains the formal zonation basis while draft revision plans are trace-only, confirms the category class/action standard/measure standard/measure intensity trace, checks measure-intensity consistency for special/key/standard categories, confirms a supplied `seismicGrade` is Grade 1 to Grade 4 and carries its structured source path when available, and fails special fortification category results when the required structured seismic safety evaluation has not been provided.
- When a member is explicitly structured as a concrete seismic wall, element checks now add GB/T 50011 6.4 wall axial-compression-ratio, wall thickness, distributed-reinforcement detailing, and boundary/edge-member detailing items. The wall checks cover structured axial ratio or axial demand against a project/code-derived limit, seismic-grade/story-height wall thickness, bottom-strengthened-zone thickness, double-layer reinforcement, tie spacing/diameter, vertical/horizontal distributed reinforcement ratio, spacing, and diameter. When structured boundary-element data provides comparable actual values and code-derived limits, the checks also cover boundary longitudinal reinforcement ratio/diameter plus transverse spacing/diameter/volumetric ratio; when a boundary element is declared required but comparable structured data is missing, the check returns `not_applicable` instead of passing by default. These checks consume only structured wall fields such as `type="wall"`/`type="shear-wall"`, `section.thickness`, `storyHeightMm`, `reinforcement.wall`, `boundaryElement`/`edgeMember`, and `shearWallData`; the tool bridge now preserves these fields in `elementData` and `elementContextById`.
- When a member is explicitly structured as a steel beam, column, brace, or link, element checks now add a GB/T 50011 chapter 8 structured steel-member seismic detailing item. It consumes only structured `steelSeismicDetailing`, `steelDetailing`, or `seismicDetailing` records and compares member/brace slenderness plus flange, web, or plate width-thickness actual ratios against project/code-derived limits supplied in the same structured data. If actual ratios are present without comparable limits, the item returns `not_applicable` instead of treating the steel member as compliant. The code-check bridge preserves these records from model element, metadata, element extra, section, section extra, or section properties into `elementData` / `elementContextById`.
- The code-check bridge now also preserves structured GB50011 member evidence from model element, metadata, element extra, section, section extra, or section properties into `elementData` / `elementContextById`, including `seismicCapacity`, `capacityDesign`, `strongShearWeakBending`, `shearCompression`, `jointCore`, `jointData`, `flatBeam`, `columnPosition`, and `columnCategory`. This makes the concrete member-capacity/detailing checks reachable from ordinary model JSON rather than only from hand-built Python code-check contexts.
- GB50011 code-check inputs and the dedicated GB50011 domain entry now carry structured `context.codeBasis`, `context.displayCode`, and `context.codeVersion` metadata, so downstream audit/report paths can preserve the exact `GB 55002-2021 + GB/T 50011-2010 (2024 partial revision)` baseline while keeping the legacy `GB50011` compatibility code.
- The seismic report guard now requires analysis results to be explicitly marked as `workflowInputMode="structured_seismic_workflow"` and requires a non-skipped `code-check-gb50011` result containing the `__global_seismic__` / `global-seismic` detail instead of accepting any `codeCheckResult`; `run_analysis` stamps `meta.traceId`, `run_code_check` records the actual code-check skill in `meta.codeCheckSkillId` and the checked analysis trace in `meta.analysisTraceId`, and `generate_report` uses these structured fields to block legacy or unmarked analysis results, stale code checks from a different analysis run, GB50017 checks, skipped checks, or ordinary member-only GB50011 checks from producing a China seismic calculation report.
- The default report now includes a code-check summary with total/passed/failed/warning counts, not-applicable/unavailable counts when present or derivable from details, governing check metadata when available, and the top failed/not-applicable/warning items before the clause traceability table. Its seismic section includes workflow input mode, an explicit warning when the result came from legacy compatibility parameters, region, code basis, GB18306 zonation source/region code when provided, model scale, analysis directions, modal combination, design basic acceleration, earthquake level, seismic grade and source, alphaMax, selected method, method-selection reasons, response-spectrum elastic-drift final compliance, elastic envelope drift final compliance, long-period special-study requirements and advisory trace, vertical-seismic reasons when triggered, special-system review reasons, structured audit summaries, restricted isolation equivalent-linear estimate metrics, restricted isolation-layer SDOF time-history metrics, restricted energy-dissipation equivalent-damping estimate metrics, and restricted energy-dissipation SDOF time-history metrics when specialized-system inputs are provided, horizontal seismic member-force count, basic seismic action combination case count, elastic time-history controlling story, combination summary, and direction-level time-history summary when available, elastic-plastic time-history status/model scope/story count/advisory yield-drift source/nonlinear-model audit/control story/control plastic hinge/max drift/final compliance, pushover elastic-plastic estimate/model scope/story count/advisory yield-drift source/control story/control plastic hinge/final compliance, ground-motion catalog, full ground-motion requirement, maximum ground-motion scale factor, modal-period ground-motion spectrum compatibility, preliminary status, base shear, drift ratio, modal mass participation, minimum story shear-weight ratio, and minimum story-shear adjustment status/factor; clause traceability includes the specific check item name.
- The frontend analysis overview now displays the code-check summary including not-applicable/unavailable counts, governing check, and failed/not-applicable/warning attention items, plus node/element/story counts, seismic method, method-selection reasons, analysis directions, modal combination, region, GB18306 zonation source/region code and current-standard/revision-plan status when provided, intensity, earthquake level, seismic grade and source, site category, preliminary status, missing inputs, capability boundaries, special-system review reasons, structured special-system audit systems/missing inputs/check counts, restricted isolation equivalent-linear estimate period/displacement/status, restricted isolation-layer SDOF time-history displacement/status, restricted energy-dissipation equivalent-damping estimate period/adjusted deformation/status, restricted energy-dissipation SDOF time-history deformation/force/status, long-period special-study requirements and advisory trace, response-spectrum elastic-drift compliance and utilization, elastic envelope drift compliance and utilization, regularity assessment, horizontal/vertical seismic member-force metrics, vertical-seismic trigger reasons when present, basic seismic action combination case count, elastic time-history controlling story when available, elastic-plastic time-history status/model scope/story count/advisory yield-drift source/nonlinear-model audit/control story/control plastic hinge/max drift/final compliance/utilization, pushover elastic-plastic estimate drift/model scope/story count/advisory yield-drift source/control story/control plastic hinge/final compliance/utilization, max base shear, max drift ratio, modal mass participation, minimum story shear-weight ratio, minimum story-shear adjustment status/factor, ground-motion count, full ground-motion requirement, missing directional components, maximum scale factor, modal-period spectrum compatibility, time-history base shear, time-history combination summary, and direction-level time-history summary.
- The default report and frontend analysis overview now also display structured over-limit/special-review traces when `overLimitReview`, `specialReview`, `specialSeismicReview`, or `overLimitSpecialReview` are present, showing requirement state, status, and approval/review/report IDs from structured fields.
- The default report and frontend overview now display the structured fortification category label/class, seismic measure intensity, safety-evaluation status, restricted isolation equivalent-linear metrics, restricted isolation-layer SDOF time-history metrics, restricted energy-dissipation equivalent-damping metrics, and restricted energy-dissipation SDOF time-history metrics from the design-basis/result data.
- Structured seismic workflow inputs are not implemented as a dedicated frontend Context-tab form. In the normal console path, the frontend sends the original chat message, attachments, selected model, and existing generic context only; seismic design basis, method choice, review evidence, member evidence, and ground-motion intent must come from the LLM/agent semantic workflow or from an explicit API/tool caller that already supplies `seismicWorkflow`.
- Direct Analysis API tasks now keep the same default compliance gate as the chat workflow for structured China seismic tasks: when `type="seismic"` includes a non-empty `parameters.seismicWorkflow`, `runAnalysis` automatically runs GB50011 code-check after the OpenSees analysis and persists the result under `results.codeCheck`, then reuses the default report-export template to persist a readable calculation report under `results.report` (`summary`, `json`, and `markdown`). Callers can explicitly set `parameters.autoCodeCheck=false` for analysis-only runs. The task schema also preserves `parameters.designCode`, defaulting to `GB/T 50011-2010-2024` for the automatic check; if a structured China seismic task explicitly supplies a non-GB50011-compatible code such as `GB50017`, the direct API now fails the task instead of producing a China seismic report from the wrong code-check provider.
- The chat API still accepts structured `context.seismicWorkflow` for direct clients and future pluggable conversation modules. LangGraph stores it in a dedicated `contextSeismicWorkflow` channel instead of overwriting `draftState`, and `run_analysis` deep-merges it with `draftState.skillState.seismicWorkflow`; the analysis API also preserves `parameters.seismicWorkflow`. The built-in artificial ground-motion catalog metadata endpoint remains available for direct clients or generic record-picker modules, but the console no longer has a hard-coded China Seismic Workflow panel.
- Uploaded, local-catalog, and built-in ground-motion records remain supported as structured backend inputs. Uploaded records are enriched from normal chat attachments when a structured workflow references uploaded sources or direct callers provide `uploadedAttachments`; validation rejects `source="uploaded"` if no parsed records are available. Zonation tables, seismic safety evaluation, member evidence, and over-limit/special-review traces remain structured data contracts and are not inferred from message keywords.
- Any future UI extension should be a generic, reusable conversation module, such as an interaction-module schema or record/JSON picker attached to a chat turn, rather than a permanent domain-specific Context-tab surface that injects `analysisType`, `designCode`, fixed skills, or `seismicWorkflow` automatically.
- Analysis results now expose `capabilityAssessment` and `missingCapabilities`; when GB50011 final-compliance checks are not implemented for the structural family, response-spectrum/time-history results remain available but the result is marked `partial`, and the report, frontend overview, compact tool summary, and GB50011 code-check all show the capability boundary. Code-check treats missing capabilities and explicit `workflowInputMode="legacy_compatibility_parameters"` analysis results as final-compliance failure items instead of claiming full code compliance.
- `analysis-regression` now covers response-spectrum, response-spectrum elastic-drift final compliance, 3D bidirectional response-spectrum, horizontal seismic member-force extraction, representative-gravity member-force extraction, basic seismic action combinations, 3-record array ground motions, multi-mode time-history response fields and scaling summaries, modal-period ground-motion spectrum-compatibility traces, auto performance-objective selection into elastic-plastic time history, auto Pushover selection from structured nonlinear static inputs without ground motions, elastic-plastic time-history final compliance with multi-story shear-building story-drift traces and structured 2D member-end plastic-hinge transient input, rare-earthquake elastic-plastic deformation capability handling, structured special-system audits, restricted isolation equivalent-linear estimates, restricted isolation-layer SDOF time-history estimates, restricted energy-dissipation equivalent-damping estimates, restricted energy-dissipation SDOF time-history estimates, and capability boundaries for isolation and energy-dissipation flags, long-period response-spectrum special-study boundaries, the built-in artificial catalog, automatic and nested explicit regularity assessment, soft-story stiffness regularity assessment, structured weak/soft-story regularity flags, structured story lateral-stiffness and strength regularity assessment, story-mass regularity assessment, global and story-level floor-diaphragm discontinuity regularity assessment, torsional-eccentricity and structured torsional-displacement-ratio regularity assessment, plan-setback and structured plan-irregularity regularity assessment, vertical lateral-system discontinuity regularity assessment, plan-aspect regularity assessment, pushover including structured 2D member-end plastic-hinge input, uploaded-content time-history, and GB50011 global seismic code-check contracts.

Full capabilities still pending:

- An embedded legal city-to-`GB 18306-2015` ground-motion parameter data source; the current implementation supports only user- or project-provided structured zonation tables.
- Embedded real recorded ground-motion catalog management, licensing, long-term project archiving, and a full persisted catalog browser; the current implementation supports user- or project-provided structured local/licensed catalogs through normal attachments, explicit API/tool inputs, and future generic pluggable record pickers, without a dedicated frontend seismic workflow form.
- A complete legal over-limit / special seismic review workflow, including jurisdiction-specific submission materials, official expert-review conclusions, and project archival records. The current implementation only gates final compliance on explicit structured review requirements and preserves approved/completed evidence when the project provides it.
- Full clause-level automatic regularity classification across all structural systems; the current implementation only covers explicit nested structured regularity classification plus conservative heuristics for story-height variation, floor-load/story-mass variation, floor-diaphragm discontinuity from global or story-level slab opening area/opening-ratio or non-rigid-diaphragm flags, structured story lateral-stiffness variation, story column lateral-stiffness variation, structured story lateral strength/capacity variation, structured weak/soft-story flags, story-level plan setback, structured plan-irregularity/reentrant-corner/plan-concavity flags or ratios, structured transfer-story/vertical lateral-system discontinuity flags, overall plan aspect ratio, structured torsional displacement ratios, node-envelope checks, and plan torsional eccentricity.
- True OpenSees distributed/full-member nonlinear elastic-plastic time history, general 3D/full-member nonlinear pushover, and complete performance-based objective workflows; elastic-plastic time-history and pushover now both have a restricted structured 2D member-end rotational plastic-hinge path before reduced-model fallback, and Pushover has a restricted secant capacity-spectrum performance-point iteration, but neither path is a full distributed inelastic member model or complete performance-based design procedure.
- Specialized isolation and energy-dissipation system analysis, including detailed bearing/device modeling, full isolation-layer finite-element dynamic analysis, and damping-device force/deformation acceptance; the current implementation exposes a structured `partial` capability boundary plus device/input audit, simple demand/capacity acceptance traces, a restricted equivalent-linear isolation response-spectrum estimate, a restricted SDOF isolation-layer time-history estimate when ground motions are available, a restricted energy-dissipation equivalent-damping deformation estimate when stiffness/damping/mass/capacity or explicit damping/deformation inputs are provided, and a restricted energy-dissipation SDOF time-history estimate when ground motions and SDOF device inputs are available, but it does not yet run a dedicated isolation or damping-device finite-element model.
- All-member strength checks, detailing checks, and specialized vertical-seismic clause coverage; the current implementation can output vertical seismic standard values, floor distributions, story minimum seismic shear-coefficient checks from structured response-spectrum floor ratios, an OpenSees equivalent vertical static check, member end forces, a vertical-seismic member-capacity check using explicit structured capacity data or simplified section/material screening with explicit gammaRE capacity-adjustment tracing when demand/capacity data provides it, basic seismic action combinations including representative gravity load, combination member-capacity screening when section/material data is available, per-member structured seismic-combination capacity checks when explicit capacities or utilization are available, explicit gammaRE capacity-adjustment tracing for those structured member-capacity checks, concrete-member shear-compression section-limit checks when structured shear and effective-section data is available, concrete-frame strong-shear weak-bending shear-capacity checks when structured capacity-design data is available, frame-column axial-compression-ratio checks when `seismicGrade` and combination axial force are available, short-column axial-ratio limit adjustment and special-study checks when column shear-span ratio is available, minimum C30 material-strength-grade checks when concrete material grade/strength is available, frame-beam section geometry, flat-beam detailing, longitudinal reinforcement, beam-end longitudinal ductility, through-interior-column bar-diameter, and stirrup detailing checks when section dimensions/span/reinforcement are available, frame-column section geometry checks when column dimensions, seismic grade, and story count are available, frame-column longitudinal ratio/supplemental detailing/stirrup diameter-spacing/confined-zone range/stirrup-volume-ratio/non-confined-zone checks when structured column reinforcement is available, frame-joint strong-column weak-beam moment relationship and frame-joint core shear-capacity/detailing checks when structured joint moment/core data is available, steel-member slenderness and width-thickness detailing checks when structured actual values and code-derived limits are supplied, and shear-wall axial-compression-ratio/thickness/distributed-reinforcement/boundary-element detailing checks when structured wall, action, and boundary data is available.
