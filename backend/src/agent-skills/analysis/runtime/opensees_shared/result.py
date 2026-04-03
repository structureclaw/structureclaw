from __future__ import annotations

from typing import Any, Dict, List, Optional

from contracts import AnalysisResult


def build_success_result(
    summary: Dict[str, Any],
    detailed: Dict[str, Any],
    warnings: Optional[List[str]] = None,
) -> AnalysisResult:
    """Construct a normalised success AnalysisResult."""
    return AnalysisResult(
        status="success",
        summary=summary,
        detailed=detailed,
        warnings=warnings or [],
    )


def raise_analysis_error(message: str) -> None:
    """Signal an analysis error by raising, so the registry can trigger fallback selection."""
    raise RuntimeError(message)
