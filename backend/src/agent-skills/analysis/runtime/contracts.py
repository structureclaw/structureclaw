from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from typing_extensions import TypedDict


class AnalysisResultMeta(TypedDict, total=False):
    engineId: str
    engineName: str
    engineVersion: str
    engineKind: str
    selectionMode: str
    fallbackFrom: Optional[str]
    analysisSkillId: str
    analysisSkillIds: List[str]
    analysisAdapterKey: str
    analysisType: str
    elapsedMs: float


class AnalysisResult(TypedDict, total=False):
    """Return type for all run_analysis() implementations.

    status="success"  → detailed contains computed results; warnings may be non-empty.
    status="partial"  → computation completed with degraded fidelity; warnings explain why.

    Failures must raise RuntimeError (or EngineNotAvailableError), NOT return
    a result dict.  The registry relies on exceptions to trigger fallback.
    """

    status: Literal["success", "partial"]
    summary: Dict[str, Any]
    detailed: Dict[str, Any]
    warnings: List[str]
    meta: AnalysisResultMeta


class EngineNotAvailableError(RuntimeError):
    """Raised when an engine cannot be used (not installed, licence expired, etc.).

    As a RuntimeError subclass, this is caught by registry.py's generic
    exception handler which attempts a fallback engine.  If no fallback
    succeeds, the error propagates to the API layer as a normal failure.
    """

    def __init__(self, engine: str, reason: str) -> None:
        self.engine = engine
        self.reason = reason
        super().__init__(f"Engine '{engine}' unavailable: {reason}")


# ---------------------------------------------------------------------------
# Protocol contract — documentation only, NOT an ABC
# ---------------------------------------------------------------------------
# Every analysis skill runtime.py MUST expose:
#
#   def run_analysis(model, parameters: Dict[str, Any]) -> AnalysisResult
#
# Execution lifecycle enforced by registry.py:
#   1. registry selects engine → finds matching skill → imports runtime.py
#   2. calls run_analysis(model, parameters)
#   3. SUCCESS  → return AnalysisResult(status="success", summary=..., detailed=...)
#   4. FAILURE  → raise RuntimeError  (do NOT return an error dict)
#   5. ENGINE UNAVAILABLE → raise EngineNotAvailableError
#   6. registry catches exception → tries fallback engine → re-raises if no fallback
#
# Result collection:
#   registry._run_python_analysis() injects "meta" into the returned dict.
#   Skill run_analysis() must NOT set meta; it is owned by the registry.
