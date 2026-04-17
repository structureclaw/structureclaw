"""PKPM SATWE calculation report export — runtime entry point.

Reads analysis results from PKPM SATWE output files (.OUT) and optionally
APIPyInterface.ResultData to produce a comprehensive calculation report
(JSON + Markdown + Word + PDF) covering design parameters, modal analysis,
earthquake forces, displacements, member design, and code checks.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List

from out_parsers import (
    _parse_comfort,
    _parse_floor_dimensions,
    _parse_mass_table,
    _parse_member_counts,
    _parse_overturning,
    _parse_shear_capacity,
    _parse_stability,
    _parse_stability_conclusion,
    _parse_stiffness_info,
    _parse_total_mass,
    _parse_unit_mass,
    _parse_wdisp_cases,
    _parse_wgcpj,
    _parse_wind_load,
    _parse_wmass_sections,
    _parse_wpj_beams,
    _parse_wpj_columns,
    _parse_wzq_base_shear,
    _parse_wzq_direction_factors,
    _parse_wzq_effective_mass,
    _parse_wzq_min_shear_ratio,
    _parse_wzq_periods,
    _parse_wzq_shear_weight_ratio,
    _read_all_wpj,
    _read_out_file,
)
from api_extractors import (
    _extract_base_shear,
    _extract_beam_design,
    _extract_column_design,
    _extract_modal,
    _extract_stiff_weight_ratio,
    _extract_story_drift,
    _extract_story_mass,
    _extract_story_stiffness,
)
from report_render import (
    _convert_bmp_to_png,
    _convert_docx_to_pdf,
    _find_project_images,
    _generate_docx,
    _generate_markdown,
    _generate_pdf,
)


# ── Helpers ──────────────────────────────────────────────────────────────


def _resolve_jws_path(model: Dict[str, Any], parameters: Dict[str, Any]) -> Path:
    jws = parameters.get("jws_path") or model.get("_pkpm_jws_path", "")
    if not jws:
        raise ValueError(
            "No JWS path provided. Pass parameters.jws_path or model._pkpm_jws_path."
        )
    p = Path(jws)
    if not p.is_file():
        raise FileNotFoundError(f"JWS file not found: {jws}")
    return p


# ── Main entry point ────────────────────────────────────────────────────


def run_analysis(model: Dict[str, Any], parameters: Dict[str, Any]) -> Dict[str, Any]:
    jws_path = _resolve_jws_path(model, parameters)
    warnings: List[str] = []
    project_dir = jws_path.parent

    # ── Read .OUT files ──────────────────────────────────────────────
    wmass_text = _read_out_file(project_dir, "WMASS.OUT")
    wzq_text = _read_out_file(project_dir, "WZQ.OUT")
    wdisp_text = _read_out_file(project_dir, "WDISP.OUT")
    wgcpj_text = _read_out_file(project_dir, "WGCPJ.OUT")
    wpj_data = _read_all_wpj(project_dir)

    out_file_data: Dict[str, Any] = {}

    if wmass_text:
        out_file_data["wmass_params"] = _parse_wmass_sections(wmass_text)
        out_file_data["mass_table"] = _parse_mass_table(wmass_text)
        out_file_data["total_mass"] = _parse_total_mass(wmass_text)
        out_file_data["member_counts"] = _parse_member_counts(wmass_text)
        out_file_data["wind_load"] = _parse_wind_load(wmass_text)
        out_file_data["floor_dimensions"] = _parse_floor_dimensions(wmass_text)
        out_file_data["unit_mass"] = _parse_unit_mass(wmass_text)
        out_file_data["stiffness_info"] = _parse_stiffness_info(wmass_text)
        out_file_data["overturning"] = _parse_overturning(wmass_text)
        out_file_data["stability"] = _parse_stability(wmass_text)
        out_file_data["stability_conclusion"] = _parse_stability_conclusion(wmass_text)
        out_file_data["shear_capacity"] = _parse_shear_capacity(wmass_text)
        out_file_data["comfort"] = _parse_comfort(wmass_text)

    if wzq_text:
        out_file_data["wzq_periods"] = _parse_wzq_periods(wzq_text)
        out_file_data["wzq_direction_factors"] = _parse_wzq_direction_factors(wzq_text)
        out_file_data["wzq_base_shear"] = _parse_wzq_base_shear(wzq_text)
        out_file_data["wzq_effective_mass"] = _parse_wzq_effective_mass(wzq_text)
        out_file_data["wzq_min_shear_ratio"] = _parse_wzq_min_shear_ratio(wzq_text)
        out_file_data["wzq_shear_weight_ratio"] = _parse_wzq_shear_weight_ratio(wzq_text)

    if wdisp_text:
        out_file_data["wdisp_cases"] = _parse_wdisp_cases(wdisp_text)

    if wgcpj_text:
        out_file_data["wgcpj"] = _parse_wgcpj(wgcpj_text)

    all_wpj_columns: List[Dict[str, Any]] = []
    all_wpj_beams: List[Dict[str, Any]] = []
    for wpj in wpj_data:
        all_wpj_columns.extend(_parse_wpj_columns(wpj["content"]))
        all_wpj_beams.extend(_parse_wpj_beams(wpj["content"]))
    if all_wpj_columns:
        out_file_data["wpj_columns"] = all_wpj_columns
    if all_wpj_beams:
        out_file_data["wpj_beams"] = all_wpj_beams

    # ── Find structural images ───────────────────────────────────────
    project_images = _find_project_images(project_dir)

    # ── Try APIPyInterface (supplementary) ───────────────────────────
    api_data: Dict[str, Any] = {}
    result = None
    try:
        import APIPyInterface
        result = APIPyInterface.ResultData()
        ret = result.InitialResult(str(jws_path))
        if ret != 0:
            warnings.append(f"InitialResult returned non-zero: {ret}")

        api_data["modal_analysis"] = _extract_modal(result)
        api_data["story_stiffness"] = _extract_story_stiffness(result)
        api_data["story_drift"] = _extract_story_drift(result)
        api_data["base_shear"] = _extract_base_shear(result)
        api_data["story_mass"] = _extract_story_mass(result)
        api_data["stiff_weight_ratio"] = _extract_stiff_weight_ratio(result)
        api_data["beam_design"] = _extract_beam_design(result)
        api_data["column_design"] = _extract_column_design(result)
    except ImportError:
        warnings.append("APIPyInterface not available, using .OUT file data only")
    except Exception as exc:
        warnings.append(f"APIPyInterface error: {exc}")
    finally:
        if result is not None:
            result.ClearResult()

    # Set defaults for missing keys
    for key in ["modal_analysis", "story_stiffness", "story_mass"]:
        api_data.setdefault(key, [])
    api_data.setdefault("story_drift", {"earthquake": {}, "wind": {}, "limit_value": None})
    api_data.setdefault("base_shear", {"entries": [], "shear_weight_limit": None})
    api_data.setdefault("stiff_weight_ratio", {"entries": [], "limit_value": None})
    api_data.setdefault("beam_design", {})
    api_data.setdefault("column_design", {})

    # ── Build report ─────────────────────────────────────────────────
    detailed = {
        "modal_analysis": api_data.get("modal_analysis", []),
        "story_stiffness": api_data.get("story_stiffness", []),
        "story_drift": api_data.get("story_drift", {}),
        "base_shear": api_data.get("base_shear", {}),
        "story_mass": api_data.get("story_mass", []),
        "stiff_weight_ratio": api_data.get("stiff_weight_ratio", {}),
        "beam_design": api_data.get("beam_design", {}),
        "column_design": api_data.get("column_design", {}),
        "code_exceedance": [],
        "out_file_data": out_file_data,
        "images": [str(p) for p in project_images],
    }

    report: Dict[str, Any] = {
        "status": "success",
        "summary": {
            "engine": "pkpm-calcbook",
            "jws_path": str(jws_path),
            "mode_count": len(api_data.get("modal_analysis", [])),
            "beam_total": api_data.get("beam_design", {}).get("total_beams", 0),
            "column_total": api_data.get("column_design", {}).get("total_columns", 0),
            "out_files_parsed": len([k for k in out_file_data if out_file_data[k]]),
            "wpj_column_count": len(all_wpj_columns),
            "wpj_beam_count": len(all_wpj_beams),
        },
        "detailed": detailed,
        "warnings": warnings,
    }

    report["markdown"] = _generate_markdown(report)

    # Generate Word document
    project_dir = jws_path.parent.resolve()
    raw_output_dir = parameters.get("output_dir", "")
    output_dir = project_dir
    if raw_output_dir:
        candidate = Path(raw_output_dir)
        if candidate.is_absolute():
            resolved = candidate.resolve()
        else:
            resolved = (project_dir / candidate).resolve()
        try:
            resolved.relative_to(project_dir)
            output_dir = resolved
        except ValueError:
            warnings.append("output_dir must be within the project directory, using default")
    output_dir.mkdir(parents=True, exist_ok=True)
    docx_path = output_dir / f"{jws_path.stem}_计算书.docx"

    try:
        _generate_docx(report, docx_path, images=project_images)
        report["summary"]["docx_path"] = str(docx_path)
    except Exception as exc:
        warnings.append(f"Word generation failed: {exc}")

    # Generate PDF
    pdf_path = output_dir / f"{jws_path.stem}_计算书.pdf"
    try:
        _generate_pdf(report, pdf_path, images=project_images)
        report["summary"]["pdf_path"] = str(pdf_path)
    except ImportError:
        if docx_path.is_file():
            try:
                result_path = _convert_docx_to_pdf(docx_path)
                if result_path:
                    report["summary"]["pdf_path"] = str(result_path)
                else:
                    warnings.append("PDF generation skipped: reportlab not installed and WPS conversion failed")
            except Exception as exc:
                warnings.append(f"PDF generation failed: {exc}")
        else:
            warnings.append("PDF generation skipped: DOCX file not available for WPS conversion")
    except Exception as exc:
        warnings.append(f"PDF generation failed: {exc}")

    return report
