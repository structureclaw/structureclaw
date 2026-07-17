from __future__ import annotations

from typing import Any, Dict, List

from design_basis import SeismicDesignBasis


GB50011_MAX_DESIGN_SPECTRUM_PERIOD_SEC = 6.0


def period_range_assessment(modes: List[Dict[str, Any]], max_period: float = GB50011_MAX_DESIGN_SPECTRUM_PERIOD_SEC) -> Dict[str, Any]:
    periods = [
        float(mode.get("period", 0.0) or 0.0)
        for mode in modes
        if isinstance(mode, dict)
    ]
    periods = [period for period in periods if period > 0.0]
    max_mode_period = max(periods, default=0.0)
    exceeding_modes = [
        {
            "modeNumber": mode.get("modeNumber"),
            "period": float(mode.get("period", 0.0) or 0.0),
        }
        for mode in modes
        if isinstance(mode, dict) and float(mode.get("period", 0.0) or 0.0) > max_period
    ]
    return {
        "code": "GB/T 50011-2010(2024)",
        "maxCodeSpectrumPeriodSec": max_period,
        "maxModePeriodSec": round(max_mode_period, 6),
        "requiresSpecialStudy": len(exceeding_modes) > 0,
        "exceedingModes": exceeding_modes,
        "basis": "design spectrum is normally defined through 6.0 s; longer-period structures require special study",
    }


def long_period_special_study_advisory(
    modes: List[Dict[str, Any]],
    basis: SeismicDesignBasis,
    max_period: float = GB50011_MAX_DESIGN_SPECTRUM_PERIOD_SEC,
) -> Dict[str, Any] | None:
    assessment = period_range_assessment(modes, max_period)
    if assessment.get("requiresSpecialStudy") is not True:
        return None

    alpha_at_limit = seismic_influence_coefficient(max_period, basis)
    advisory_modes: List[Dict[str, Any]] = []
    for mode in modes:
        if not isinstance(mode, dict):
            continue
        period = float(mode.get("period", 0.0) or 0.0)
        if period <= max_period:
            continue
        alpha_at_mode = seismic_influence_coefficient(period, basis)
        advisory_alpha = max(alpha_at_mode, alpha_at_limit)
        advisory_modes.append({
            "modeNumber": mode.get("modeNumber"),
            "period": round(period, 6),
            "effectiveMass": round(float(mode.get("effectiveMass", 0.0) or 0.0), 6),
            "alphaAtMode": alpha_at_mode,
            "alphaAtCodePeriodLimit": alpha_at_limit,
            "advisoryAlpha": advisory_alpha,
            "advisoryAlphaRatioToCodeLimit": round(advisory_alpha / max(alpha_at_limit, 1e-12), 6),
        })

    if not advisory_modes:
        return None
    governing = max(advisory_modes, key=lambda item: float(item.get("period", 0.0) or 0.0))
    return {
        "status": "advisory_only",
        "clause": "GB/T 50011-2010(2024)",
        "maxCodeSpectrumPeriodSec": max_period,
        "maxModePeriodSec": assessment.get("maxModePeriodSec"),
        "alphaAtCodePeriodLimit": alpha_at_limit,
        "governingMode": governing,
        "modes": advisory_modes,
        "scope": (
            "Conservative long-period coefficient trace for engineering review; "
            "not a substitute for project-specific long-period special study."
        ),
    }


def seismic_influence_coefficient(period: float, basis: SeismicDesignBasis) -> float:
    damping = max(0.01, min(0.20, basis.damping_ratio))
    alpha_max = basis.alpha_max
    tg = basis.characteristic_period
    gamma = 0.9 + (0.05 - damping) / (0.3 + 6.0 * damping)
    eta1 = max(0.0, 0.02 + (0.05 - damping) / (4.0 + 32.0 * damping))
    eta2 = max(0.55, 1.0 + (0.05 - damping) / (0.08 + 1.6 * damping))
    t = max(float(period), 0.0)
    t0 = 0.1

    if t < t0:
        alpha = alpha_max * (0.45 + (t / t0) * (eta2 - 0.45))
    elif t < tg:
        alpha = alpha_max * eta2
    elif t < 5.0 * tg:
        alpha = alpha_max * ((tg / max(t, 1e-6)) ** gamma) * eta2
    else:
        alpha = alpha_max * ((eta2 * (0.2 ** gamma)) - eta1 * (t - 5.0 * tg))

    return round(max(alpha, 0.2 * alpha_max), 6)


def generate_design_spectrum(basis: SeismicDesignBasis, max_period: float = 6.0, step: float = 0.02) -> List[Dict[str, float]]:
    points: List[Dict[str, float]] = []
    count = int(max_period / step) + 1
    for index in range(count):
        period = round(index * step, 4)
        points.append({
            "period": period,
            "alpha": seismic_influence_coefficient(period, basis),
        })
    return points


def spectrum_values_for_modes(modes: List[Dict[str, Any]], basis: SeismicDesignBasis) -> List[Dict[str, Any]]:
    values: List[Dict[str, Any]] = []
    for mode in modes:
        period = float(mode.get("period", 0.0) or 0.0)
        values.append({
            "modeNumber": mode.get("modeNumber"),
            "period": period,
            "alpha": seismic_influence_coefficient(period, basis),
            "requiresSpecialStudy": period > GB50011_MAX_DESIGN_SPECTRUM_PERIOD_SEC,
        })
    return values
