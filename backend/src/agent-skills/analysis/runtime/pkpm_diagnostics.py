from __future__ import annotations

import re
from importlib import metadata
from pathlib import Path
from typing import Any, Dict, Optional


PDB_MISMATCH_MARKER = "PDB VERSION INCONSISTENT"


def collect_apipyinterface_diagnostics() -> Dict[str, str]:
    """Return APIPyInterface location and package information for diagnostics."""
    info: Dict[str, str] = {}
    try:
        import APIPyInterface

        module_file = getattr(APIPyInterface, "__file__", "")
        if module_file:
            info["module_file"] = str(Path(module_file).resolve())
            info["module_dir"] = str(Path(module_file).resolve().parent)
    except Exception as exc:
        info["import_error"] = str(exc)

    for package_name in ("pkpm_api", "pkpm-api"):
        try:
            info["package_name"] = package_name
            info["package_version"] = metadata.version(package_name)
            break
        except metadata.PackageNotFoundError:
            continue
        except Exception as exc:
            info["package_error"] = str(exc)
            break

    return info


def find_pdb_version_mismatch(work_dir: Path) -> Optional[Dict[str, Any]]:
    """Scan PKPM output error files for SATWE PDB schema mismatch warnings."""
    if not work_dir.exists():
        return None

    for path in sorted(work_dir.glob("*_ERR.TXT")):
        try:
            text = path.read_bytes().decode("gb18030", errors="ignore")
        except OSError:
            continue
        if PDB_MISMATCH_MARKER not in text:
            continue

        file_version = _match_version(r"FILE\s+PDB\s+VERSION\s+NO\.\s*=\s*(\d+)", text)
        program_version = _match_version(r"PROGRAM\s+PDB\s+VERSION\s+NO\.\s*=\s*(\d+)", text)
        project_version = _read_project_version(work_dir)
        return {
            "err_file": str(path),
            "file_version": file_version,
            "program_version": program_version,
            "project_version": project_version,
        }
    return None


def format_pdb_version_mismatch_error(
    work_dir: Path,
    cycle_path: Path,
    mismatch: Dict[str, Any],
    *,
    include_file_paths: bool = True,
) -> str:
    api_info = collect_apipyinterface_diagnostics()
    details = [
        "PKPM/SATWE PDB version mismatch detected / 检测到 PKPM/SATWE PDB 版本不一致.",
        f"FILE PDB VERSION NO.={mismatch.get('file_version') or 'unknown'}",
        f"PROGRAM PDB VERSION NO.={mismatch.get('program_version') or 'unknown'}",
        f"JWSCYCLE={cycle_path}",
    ]
    if include_file_paths:
        details.extend([
            f"workDir={work_dir}",
            f"errFile={mismatch.get('err_file')}",
        ])
    project_version = mismatch.get("project_version")
    if project_version:
        details.append(f"projectVersion={project_version}")
    package_version = api_info.get("package_version")
    if package_version:
        details.append(f"{api_info.get('package_name', 'pkpm_api')}={package_version}")
    module_file = api_info.get("module_file")
    if module_file:
        details.append(f"APIPyInterface={module_file}")
    details.append(
        "This usually means the Python APIPyInterface package and the configured "
        "PKPM/SATWE installation are from incompatible releases. "
        "请使用与当前 PKPM/SATWE 主程序匹配的 APIPyInterface/pkpm_api 后重试。"
    )
    return " ".join(details)


def format_pdb_version_mismatch_warning(
    work_dir: Path,
    cycle_path: Path,
    mismatch: Dict[str, Any],
    *,
    include_file_paths: bool = True,
) -> str:
    api_info = collect_apipyinterface_diagnostics()
    parts = [
        "PKPM/SATWE PDB version warning detected; core SATWE results were still readable.",
        f"FILE PDB VERSION NO.={mismatch.get('file_version') or 'unknown'}",
        f"PROGRAM PDB VERSION NO.={mismatch.get('program_version') or 'unknown'}",
        f"JWSCYCLE={cycle_path}",
    ]
    if include_file_paths:
        parts.append(f"workDir={work_dir}")
    project_version = mismatch.get("project_version")
    if project_version:
        parts.append(f"projectVersion={project_version}")
    package_version = api_info.get("package_version")
    if package_version:
        parts.append(f"{api_info.get('package_name', 'pkpm_api')}={package_version}")
    module_file = api_info.get("module_file")
    if module_file:
        parts.append(f"APIPyInterface={module_file}")
    return " ".join(parts)

def _match_version(pattern: str, text: str) -> str:
    match = re.search(pattern, text, flags=re.IGNORECASE)
    return match.group(1) if match else ""


def _read_project_version(work_dir: Path) -> str:
    for path in sorted(work_dir.glob("__PMVERSION*")):
        name_match = re.search(r"__PMVERSION[:：]?(.+?)\.pm$", path.name, flags=re.IGNORECASE)
        if name_match:
            return name_match.group(1).strip()
        try:
            text = path.read_bytes().decode("gb18030", errors="ignore")
        except OSError:
            continue
        for line in text.splitlines():
            normalized = line.strip().strip("+")
            if normalized:
                return normalized[:120]
    return ""
