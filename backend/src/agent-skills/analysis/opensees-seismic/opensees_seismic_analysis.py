from __future__ import annotations

from typing import Any, Dict, List


class OpenSeesSeismicExecutor:
    """Compatibility facade backed by the canonical seismic implementations."""

    def __init__(self, analyzer):
        self.analyzer = analyzer

    def get_modes(self, ops) -> List[Dict[str, Any]]:
        from design_basis import build_design_basis
        from modal import run_modal_analysis

        basis = build_design_basis(self.analyzer.model, {}, {})
        return run_modal_analysis(self.analyzer.model, basis, modal_count=6).modes

    def pushover_analysis(self, target_disp: float, control_node: str | None, ops) -> Dict[str, Any]:
        from design_basis import build_design_basis
        from pushover import run_linear_pushover

        basis = build_design_basis(self.analyzer.model, {}, {})
        parameters: Dict[str, Any] = {"targetDisplacement": target_disp}
        if control_node:
            parameters["controlNode"] = control_node
        return run_linear_pushover(
            self.analyzer.model,
            basis,
            parameters,
            direction="x",
        )
