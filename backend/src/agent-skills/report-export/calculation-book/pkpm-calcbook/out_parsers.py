"""PKPM SATWE .OUT file parsers — read GBK-encoded output files into structured data."""
from __future__ import annotations

import re
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

_logger = logging.getLogger(__name__)


# ── .OUT file readers (GBK → structured text) ──────────────────────────


def _read_out_file(project_dir: Path, filename: str) -> Optional[str]:
    path = project_dir / filename
    if not path.is_file():
        return None
    try:
        raw = path.read_bytes()
        text = raw.decode("gbk", errors="replace")
        return text.replace("\r\n", "\n").replace("\r", "\n")
    except (PermissionError, OSError) as exc:
        _logger.warning("Failed to read %s: %s", filename, exc)
        return None


def _read_all_wpj(project_dir: Path) -> List[Dict[str, Any]]:
    wpj_files = sorted(project_dir.glob("WPJ*.OUT"))
    results: List[Dict[str, Any]] = []
    for f in wpj_files:
        text = _read_out_file(project_dir, f.name)
        if text:
            results.append({"filename": f.name, "content": text})
    return results


def _parse_wmass_sections(text: str) -> Dict[str, str]:
    section_map: Dict[str, str] = {}
    patterns = [
        ("design_params", r"总信息\s+\.+\s*\n(.*?)(?=活荷载信息|二阶效应)"),
        ("wind_info_params", r"风荷载信息\s+\.+\s*\n(.*?)(?=地震信息)"),
        ("earthquake_params", r"地震信息\s+\.+\s*\n(.*?)(?=活荷载信息|二阶效应)"),
        ("live_load_params", r"活荷载信息\s+\.+\s*\n(.*?)(?=二阶效应|调整信息)"),
        ("second_order_params", r"二阶效应\s+\.+\s*\n(.*?)(?=调整信息)"),
        ("adjustment_params", r"调整信息\s+\.+\s*\n(.*?)(?=设计信息)"),
        ("design_info_params", r"设计信息\s+\.+\s*\n(.*?)(?=材料信息)"),
        ("material_params", r"材料信息\s+\.+\s*\n(.*?)(?=荷载组合信息)"),
        ("load_combination_params", r"荷载组合信息\s+\.+\s*\n(.*?)(?=地下信息)"),
        ("underground_params", r"地下信息\s+\.+\s*\n(.*?)(?=性能设计信息)"),
    ]
    for key, pat in patterns:
        m = re.search(pat, text, re.DOTALL)
        if m:
            section_map[key] = m.group(1).strip()
    return section_map


def _parse_mass_table(text: str) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    found_header = False
    for line in text.split("\n"):
        stripped = line.strip()
        if not found_header:
            if "\u5c42\u53f7" in stripped and "\u5854\u53f7" in stripped and "\u8d28\u5fc3" in stripped:
                found_header = True
            continue
        if not stripped:
            break
        parts = stripped.split()
        if len(parts) >= 8:
            try:
                int(parts[0])
                rows.append({
                    "floor": int(parts[0]),
                    "tower": int(parts[1]),
                    "mass_cx": float(parts[2]),
                    "mass_cy": float(parts[3]),
                    "mass_cz": float(parts[4]),
                    "dead_mass": float(parts[5]),
                    "live_mass": float(parts[6]),
                    "add_mass": float(parts[7]),
                    "mass_ratio": float(parts[8]) if len(parts) > 8 else 0.0,
                })
            except (ValueError, IndexError):
                break
    return rows


def _parse_total_mass(text: str) -> Dict[str, float]:
    result: Dict[str, float] = {}
    for key, pat in [
        ("live_total", r"活载产生的总质量\s*\(t\):\s*([\d.]+)"),
        ("dead_total", r"恒载产生的总质量\s*\(t\):\s*([\d.]+)"),
        ("add_total", r"附加总质量\s*\(t\):\s*([\d.]+)"),
        ("struct_total", r"结构的总质量\s*\(t\):\s*([\d.]+)"),
    ]:
        m = re.search(pat, text)
        if m:
            result[key] = float(m.group(1))
    return result


def _parse_member_counts(text: str) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    found_header = False
    for line in text.split("\n"):
        stripped = line.strip()
        if not found_header:
            if "\u5c42\u53f7" in stripped and "\u6881\u5143\u6570" in stripped:
                found_header = True
            continue
        if not stripped:
            if rows:
                break
            continue
        m = re.match(
            r"\s*(\d+)\(\s*(\d+)\)\s+(\d+)\s+(\d+)\(.*?\)\s+(\d+)\(.*?\)\s+(\d+)\(.*?\)\s+([\d.]+)\s+([\d.]+)",
            stripped,
        )
        if m:
            try:
                rows.append({
                    "floor": int(m.group(1)),
                    "std_floor": int(m.group(2)),
                    "tower": int(m.group(3)),
                    "beam_count": int(m.group(4)),
                    "column_count": int(m.group(5)),
                    "wall_count": int(m.group(6)),
                    "height": float(m.group(7)),
                    "cumulative_height": float(m.group(8)),
                })
            except (ValueError, IndexError):
                continue
    return rows


def _parse_wind_load(text: str) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    found_header = False
    for line in text.split("\n"):
        stripped = line.strip()
        if not found_header:
            if "\u98ce\u8377\u8f7dX" in stripped:
                found_header = True
            continue
        if not stripped:
            if rows:
                break
            continue
        if stripped.startswith("="):
            break
        parts = stripped.split()
        if len(parts) >= 8:
            try:
                int(parts[0])
                rows.append({
                    "floor": int(parts[0]),
                    "tower": int(parts[1]),
                    "wind_x": float(parts[2]),
                    "shear_x": float(parts[3]),
                    "overturn_x": float(parts[4]),
                    "wind_y": float(parts[5]),
                    "shear_y": float(parts[6]),
                    "overturn_y": float(parts[7]),
                })
            except (ValueError, IndexError):
                continue
    return rows


def _parse_floor_dimensions(text: str) -> List[Dict[str, Any]]:
    pattern = r"各楼层等效尺寸.*?\n\s*[-]+\s*\n(.*?)(?=\n\s*\*)"
    m = re.search(pattern, text, re.DOTALL)
    if not m:
        return []
    rows: List[Dict[str, Any]] = []
    for line in m.group(1).strip().split("\n"):
        parts = line.strip().split()
        if len(parts) >= 8:
            try:
                rows.append({
                    "floor": int(parts[0]),
                    "tower": int(parts[1]),
                    "area": float(parts[2]),
                    "centroid_x": float(parts[3]),
                    "centroid_y": float(parts[4]),
                    "equiv_width": float(parts[5]),
                    "equiv_height": float(parts[6]),
                    "max_width": float(parts[7]),
                    "min_width": float(parts[8]) if len(parts) > 8 else 0.0,
                })
            except (ValueError, IndexError):
                continue
    return rows


def _parse_unit_mass(text: str) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    found_data = False
    for line in text.split("\n"):
        stripped = line.strip()
        if not found_data:
            if "\u5355\u4f4d\u9762\u79ef\u8d28\u91cf" in stripped and "g[i]" in stripped:
                found_data = True
            continue
        if not stripped or stripped.startswith("="):
            break
        parts = stripped.split()
        if len(parts) >= 4:
            try:
                int(parts[0])
                rows.append({
                    "floor": int(parts[0]),
                    "tower": int(parts[1]),
                    "unit_mass": float(parts[2]),
                    "mass_ratio": float(parts[3]),
                })
            except (ValueError, IndexError):
                continue
    return rows


def _parse_stiffness_info(text: str) -> List[Dict[str, Any]]:
    pattern = r"Floor No\.\s+(\d+)\s+Tower No\.\s+(\d+)\s*\n(.*?)(?=-{20,}|\nX方向最小)"
    rows: List[Dict[str, Any]] = []
    for m in re.finditer(pattern, text, re.DOTALL):
        block = m.group(3)
        entry: Dict[str, Any] = {"floor": int(m.group(1)), "tower": int(m.group(2))}
        for key, pat in [
            ("Xstif", r"Xstif=\s*([\d.]+)"),
            ("Ystif", r"Ystif=\s*([\d.]+)"),
            ("Xmass", r"Xmass=\s*([\d.]+)"),
            ("Ymass", r"Ymass=\s*([\d.]+)"),
            ("Gmass", r"Gmass[^=]*=\s*([\d.]+)"),
            ("Eex", r"Eex\s*=\s*([\d.]+)"),
            ("Eey", r"Eey\s*=\s*([\d.]+)"),
            ("Ratx", r"Ratx\s*=\s*([\d.]+)"),
            ("Raty", r"Raty\s*=\s*([\d.]+)"),
            ("Ratx1", r"Ratx1=\s*([\d.]+)"),
            ("Raty1", r"Raty1=\s*([\d.]+)"),
            ("RJX1", r"RJX1\s*=\s*([\d.E+]+)"),
            ("RJY1", r"RJY1\s*=\s*([\d.E+]+)"),
            ("RJX3", r"RJX3\s*=\s*([\d.E+]+)"),
            ("RJY3", r"RJY3\s*=\s*([\d.E+]+)"),
        ]:
            m2 = re.search(pat, block)
            if m2:
                entry[key] = m2.group(1)
        rows.append(entry)
    return rows


def _parse_overturning(text: str) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    found_header = False
    for line in text.split("\n"):
        stripped = line.strip()
        if not found_header:
            if "\u6297\u503e\u8986\u529b\u77e9" in stripped:
                found_header = True
            continue
        if not stripped:
            if rows:
                break
            continue
        parts = stripped.split()
        if len(parts) >= 5:
            try:
                float(parts[2])
                rows.append({
                    "case": parts[0] + " " + parts[1],
                    "Mr": float(parts[2]),
                    "Mov": float(parts[3]),
                    "ratio": float(parts[4]),
                    "zero_stress": float(parts[5]) if len(parts) > 5 else 0.0,
                })
            except (ValueError, IndexError):
                continue
    return rows


def _parse_stability(text: str) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    found_header = False
    for line in text.split("\n"):
        stripped = line.strip()
        if not found_header:
            if "\u7ed3\u6784\u6574\u4f53\u7a33\u5b9a\u9a8c\u7b97\u7ed3\u679c" in stripped:
                found_header = True
            continue
        if "\u8be5\u7ed3\u6784\u521a\u91cd\u6bd4" in stripped:
            break
        if not stripped:
            continue
        parts = stripped.split()
        if len(parts) >= 7:
            try:
                int(parts[0])
                rows.append({
                    "floor": int(parts[0]),
                    "stiff_x": parts[1],
                    "stiff_y": parts[2],
                    "height": float(parts[3]),
                    "upper_weight": float(parts[4]),
                    "ratio_x": float(parts[5]),
                    "ratio_y": float(parts[6]),
                })
            except (ValueError, IndexError):
                continue
    return rows


def _parse_stability_conclusion(text: str) -> List[str]:
    results: List[str] = []
    for pat in [r"(该结构刚重比.*?验算)", r"(该结构刚重比.*?效应)"]:
        for m in re.finditer(pat, text):
            results.append(m.group(1))
    return results


def _parse_shear_capacity(text: str) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    found_header = False
    for line in text.split("\n"):
        stripped = line.strip()
        if not found_header:
            if "\u6297\u526a\u627f\u8f7d\u529b" in stripped and "\u627f\u8f7d\u529b\u6bd4\u503c" in stripped:
                found_header = True
            continue
        if not stripped:
            if rows:
                break
            continue
        if stripped.startswith("-"):
            continue
        parts = stripped.split()
        if len(parts) >= 6:
            try:
                int(parts[0])
                rows.append({
                    "floor": int(parts[0]),
                    "tower": int(parts[1]),
                    "capacity_x": parts[2],
                    "capacity_y": parts[3],
                    "ratio_x": parts[4],
                    "ratio_y": parts[5],
                })
            except (ValueError, IndexError):
                continue
    return rows


def _parse_comfort(text: str) -> List[str]:
    results: List[str] = []
    for line in text.split("\n"):
        if "加速度" in line and "=" in line:
            results.append(line.strip())
    return results


# ── WZQ.OUT parsers ─────────────────────────────────────────────────────


def _parse_wzq_periods(text: str) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    found_header = False
    for line in text.split("\n"):
        stripped = line.strip()
        if not found_header:
            if "\u632f\u578b\u53f7" in stripped and "\u5468 \u671f" in stripped:
                found_header = True
            continue
        if not stripped:
            if rows:
                break
            continue
        # Parse format: "  1       0.4524     90.00        1.00 ( 0.00+1.00 )      0.00"
        m = re.match(
            r"\s*(\d+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+\(\s*([-.\d]+)\+([-.\d]+)\s*\)\s+([-.\d]+)",
            stripped,
        )
        if m:
            try:
                rows.append({
                    "mode": int(m.group(1)),
                    "period": float(m.group(2)),
                    "angle": float(m.group(3)),
                    "translation": m.group(4),
                    "x_translation": m.group(5),
                    "y_translation": m.group(6),
                    "torsion": m.group(7),
                })
            except (ValueError, IndexError):
                continue
    return rows


def _parse_wzq_direction_factors(text: str) -> List[Dict[str, Any]]:
    pattern = r"直接输出X,Y,Z方向的.*?\n\s*[-]+\s*\n(.*?)(?=\n\s*=+|\n\s*\n)"
    m = re.search(pattern, text, re.DOTALL)
    if not m:
        return []
    rows: List[Dict[str, Any]] = []
    for line in m.group(1).strip().split("\n"):
        parts = line.strip().split()
        if len(parts) >= 5:
            try:
                int(parts[0])
                rows.append({
                    "mode": int(parts[0]),
                    "period": float(parts[1]),
                    "factor_x": float(parts[2]),
                    "factor_y": float(parts[3]),
                    "factor_z": float(parts[4]),
                })
            except (ValueError, IndexError):
                continue
    return rows


def _parse_wzq_base_shear(text: str) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    direction = None
    found_cqc_header = False
    past_note = False
    got_data = False
    for line in text.split("\n"):
        stripped = line.strip()
        if "(CQC)" in stripped and "\u697c\u5c42\u53cd\u5e94" not in stripped:
            if stripped.strip().startswith("X"):
                direction = "X"
            elif stripped.strip().startswith("Y"):
                direction = "Y"
            found_cqc_header = True
            past_note = False
            got_data = False
            continue
        if not found_cqc_header or not direction:
            continue
        if "\u6ce8\u610f" in stripped or "\u6ce8" in stripped:
            past_note = True
            continue
        if past_note and not got_data and not stripped:
            continue
        if past_note:
            if not stripped:
                if got_data:
                    found_cqc_header = False
                    direction = None
                continue
            if stripped.startswith("\u6297\u6807") or stripped.startswith("\u672c\u697c") or stripped.startswith("*") or stripped.startswith("="):
                found_cqc_header = False
                direction = None
                continue
            nums = re.findall(r"[-]?\d+\.\d+", stripped)
            ints_match = re.match(r"\s*(\d+)\s+(\d+)", stripped)
            if ints_match and len(nums) >= 2:
                try:
                    rows.append({
                        "direction": direction,
                        "floor": int(ints_match.group(1)),
                        "tower": int(ints_match.group(2)),
                        "F": float(nums[0]),
                        "V": float(nums[1]),
                    })
                    got_data = True
                except (ValueError, IndexError):
                    pass
    return rows


def _parse_wzq_effective_mass(text: str) -> Dict[str, List[Dict[str, Any]]]:
    result: Dict[str, List[Dict[str, Any]]] = {}
    for direction in ["X", "Y"]:
        pat = (
            rf"{direction}[^\n]*有效质量系数.*?\n\s*[-]+\s*\n(.*?)(?=\n\s*\n)"
        )
        m = re.search(pat, text, re.DOTALL)
        if m:
            entries: List[Dict[str, Any]] = []
            for line in m.group(1).strip().split("\n"):
                parts = line.strip().split()
                if len(parts) >= 2:
                    try:
                        entries.append({
                            "mode": int(parts[0]),
                            "coefficient": float(parts[1]),
                        })
                    except (ValueError, IndexError):
                        continue
            result[direction] = entries
    return result


def _parse_wzq_min_shear_ratio(text: str) -> Dict[str, str]:
    result: Dict[str, str] = {}
    for direction in ["X", "Y"]:
        pat = rf"抗标\(5\.2\.5\).*?{direction}向楼层最小剪重比\s*=\s*([\d.%]+)"
        m = re.search(pat, text)
        if m:
            result[direction] = m.group(1)
    return result


def _parse_wzq_shear_weight_ratio(text: str) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    found_header = False
    for line in text.split("\n"):
        stripped = line.strip()
        if not found_header:
            if "\u8c03\u6574\u7cfb\u6570" in stripped and "X" in stripped and "Y" in stripped:
                found_header = True
            continue
        if not stripped:
            if rows:
                break
            continue
        parts = stripped.split()
        if len(parts) >= 4:
            try:
                int(parts[0])
                rows.append({
                    "floor": int(parts[0]),
                    "tower": int(parts[1]),
                    "ratio_x": float(parts[2]),
                    "ratio_y": float(parts[3]),
                })
            except (ValueError, IndexError):
                continue
    return rows


# ── WDISP.OUT parsers ───────────────────────────────────────────────────


def _parse_wdisp_cases(text: str) -> List[Dict[str, Any]]:
    cases: List[Dict[str, Any]] = []
    for m in re.finditer(
        r"=== 工况\s+(\d+)\s+===\s*(.*?)(?=\n=== 工况|\Z)",
        text,
        re.DOTALL,
    ):
        case_title = m.group(2).split("\n")[0].strip()
        block = m.group(0)
        floor_data: List[Dict[str, Any]] = []
        for fm in re.finditer(
            r"(\d+)\s+(\d+)\s+(\d+)\s+([\d.-]+)\s+([\d.-]+)",
            block,
        ):
            try:
                floor_data.append({
                    "floor": int(fm.group(1)),
                    "tower": int(fm.group(2)),
                    "jmax": int(fm.group(3)),
                    "max_disp": float(fm.group(4)),
                    "ave_disp": float(fm.group(5)),
                })
            except (ValueError, IndexError):
                continue

        max_drift_line = ""
        dm = re.search(r"最大层间位移角:\s*(.*)", block)
        if dm:
            max_drift_line = dm.group(1).strip()

        cases.append({
            "case_num": int(m.group(1)),
            "title": case_title,
            "floors": floor_data,
            "max_drift_summary": max_drift_line,
        })
    return cases


# ── WGCPJ.OUT parser ────────────────────────────────────────────────────


def _is_wgcpj_header(line: str) -> bool:
    """Check if a WGCPJ line is a header/metadata line (not actual exceedance data)."""
    if not line or line.startswith("-") or line.startswith("|"):
        return True
    skip_keywords = ["SATWE", "WGCPJ", "工程项目", "项目编号"]
    if any(kw in line for kw in skip_keywords):
        return True
    if re.search(r"\d{4}", line) and "第" not in line:
        return True
    return False


def _parse_wgcpj(text: str) -> Dict[str, Any]:
    exceedance: List[str] = []
    for line in text.split("\n"):
        line = line.strip()
        if not _is_wgcpj_header(line) and "第" in line:
            exceedance.append(line)
    return {"exceedance_count": len(exceedance), "items": exceedance}


# ── WPJ.OUT parser (per-floor member design) ────────────────────────────


def _parse_wpj_columns(text: str) -> List[Dict[str, Any]]:
    columns: List[Dict[str, Any]] = []
    for m in re.finditer(
        r"N-C=\s*(\d+)\s*\(\s*\d+\)\s*B\*H\(mm\)=\s*(\d+)\*\s*(\d+)(.*?)(?=N-C=|\Z)",
        text,
        re.DOTALL,
    ):
        block = m.group(4)
        entry: Dict[str, Any] = {
            "id": int(m.group(1)),
            "width": int(m.group(2)),
            "height": int(m.group(3)),
        }
        for key, pat in [
            ("cover", r"Cover=\s*(\d+)"),
            ("cx", r"Cx=\s*([\d.]+)"),
            ("cy", r"Cy=\s*([\d.]+)"),
            ("length", r"Lc=\s*([\d.]+)"),
            ("seismic_grade", r"Nfc=\s*(\d+)"),
            ("concrete_grade", r"Rcc=\s*([\d.]+)"),
            ("axial_ratio", r"Uc=\s*([\d.]+)"),
            ("reinforce_ratio", r"Rs=\s*([\d.]+)"),
            ("hoop_ratio", r"Rsv=\s*([\d.]+)"),
            ("corner_steel", r"Asc=\s*([\d.]+)"),
            ("shear_span", r"RMD=\s*([\d.]+)"),
        ]:
            m2 = re.search(pat, block)
            if m2:
                entry[key] = m2.group(1)
        columns.append(entry)
    return columns


def _parse_wpj_beams(text: str) -> List[Dict[str, Any]]:
    beams: List[Dict[str, Any]] = []
    for m in re.finditer(
        r"N-B=\s*(\d+)\s*\(.*?\)\s*B\*H\(mm\)=\s*(\d+)\*\s*(\d+)(.*?)(?=N-B=|\Z)",
        text,
        re.DOTALL,
    ):
        block = m.group(4)
        entry: Dict[str, Any] = {
            "id": int(m.group(1)),
            "width": int(m.group(2)),
            "height": int(m.group(3)),
        }
        for key, pat in [
            ("cover", r"Cover=\s*(\d+)"),
            ("length", r"Lb=\s*([\d.]+)"),
            ("seismic_grade", r"Nfb=\s*(\d+)"),
            ("concrete_grade", r"Rcb=\s*([\d.]+)"),
        ]:
            m2 = re.search(pat, block)
            if m2:
                entry[key] = m2.group(1)
        top_match = re.search(r"Top_Ast=\s*([\d.]+)", block)
        btm_match = re.search(r"Btm_Ast=\s*([\d.]+)", block)
        if top_match:
            entry["top_reinforce"] = top_match.group(1)
        if btm_match:
            entry["btm_reinforce"] = btm_match.group(1)
        beams.append(entry)
    return beams
