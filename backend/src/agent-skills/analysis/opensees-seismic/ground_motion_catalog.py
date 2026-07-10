from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Sequence, Tuple


CATALOG_META = [
    {
        "id": "SCGM-A1",
        "name": "StructureClaw artificial record A1",
        "recordType": "artificial",
        "dt": 0.02,
        "duration": 20.0,
        "unit": "g",
        "usableForAnalysis": True,
        "description": "Deterministic artificial acceleration record for workflow and regression use.",
        "descriptionZh": "用于流程验证和回归测试的确定性人工加速度时程。",
    },
    {
        "id": "SCGM-A2",
        "name": "StructureClaw artificial record A2",
        "recordType": "artificial",
        "dt": 0.02,
        "duration": 20.0,
        "unit": "g",
        "usableForAnalysis": True,
        "description": "Deterministic artificial acceleration record for workflow and regression use.",
        "descriptionZh": "用于流程验证和回归测试的确定性人工加速度时程。",
    },
    {
        "id": "SCGM-A3",
        "name": "StructureClaw artificial record A3",
        "recordType": "artificial",
        "dt": 0.02,
        "duration": 20.0,
        "unit": "g",
        "usableForAnalysis": True,
        "description": "Deterministic artificial acceleration record for workflow and regression use.",
        "descriptionZh": "用于流程验证和回归测试的确定性人工加速度时程。",
    },
    {
        "id": "SCGM-A4",
        "name": "StructureClaw artificial record A4",
        "recordType": "artificial",
        "dt": 0.02,
        "duration": 20.0,
        "unit": "g",
        "usableForAnalysis": True,
        "description": "Deterministic artificial acceleration record for workflow and regression use.",
        "descriptionZh": "用于流程验证和回归测试的确定性人工加速度时程。",
    },
    {
        "id": "SCGM-A5",
        "name": "StructureClaw artificial record A5",
        "recordType": "artificial",
        "dt": 0.02,
        "duration": 20.0,
        "unit": "g",
        "usableForAnalysis": True,
        "description": "Deterministic artificial acceleration record for workflow and regression use.",
        "descriptionZh": "用于流程验证和回归测试的确定性人工加速度时程。",
    },
    {
        "id": "SCGM-A6",
        "name": "StructureClaw artificial record A6",
        "recordType": "artificial",
        "dt": 0.02,
        "duration": 20.0,
        "unit": "g",
        "usableForAnalysis": True,
        "description": "Deterministic artificial acceleration record for workflow and regression use.",
        "descriptionZh": "用于流程验证和回归测试的确定性人工加速度时程。",
    },
    {
        "id": "SCGM-A7",
        "name": "StructureClaw artificial record A7",
        "recordType": "artificial",
        "dt": 0.02,
        "duration": 20.0,
        "unit": "g",
        "usableForAnalysis": True,
        "description": "Deterministic artificial acceleration record for workflow and regression use.",
        "descriptionZh": "用于流程验证和回归测试的确定性人工加速度时程。",
    },
]

RECORDED_REFERENCE_CATALOG_META = [
    {
        "id": "SCGM-R1",
        "name": "El Centro 1940 Array #9",
        "recordType": "reference",
        "event": "Imperial Valley / El Centro",
        "year": 1940,
        "region": "California, USA",
        "station": "El Centro Array #9 / Imperial Valley Irrigation District",
        "component": "S00E or S90W horizontal components",
        "magnitudeMw": 6.9,
        "dt": 0.02,
        "pgaG": 0.35,
        "pgaMps2": 3.417,
        "sourceUrl": "https://www.strongmotioncenter.org/vdc/scripts/event.plx?evt=88",
        "dataAvailability": "metadata_only",
        "usableForAnalysis": False,
        "description": "Classic recorded motion widely used in OpenSees examples and structural dynamics benchmarks. Metadata only; upload or import a licensed record before formal analysis.",
        "descriptionZh": "OpenSees 示例和结构动力学基准中常用的经典真实记录。当前仅提供元数据；正式分析前需上传或导入授权波形。",
    },
    {
        "id": "SCGM-R2",
        "name": "Taft 1952 Lincoln School Tunnel",
        "recordType": "reference",
        "event": "Kern County / Taft",
        "year": 1952,
        "region": "California, USA",
        "station": "Taft Lincoln School Tunnel",
        "component": "N21E or S69E horizontal components",
        "magnitudeMw": 7.5,
        "dt": 0.02,
        "pgaG": 0.18,
        "pgaMps2": 1.759,
        "sourceUrl": "https://www.strongmotioncenter.org/vdc/scripts/event.plx?evt=81",
        "dataAvailability": "metadata_only",
        "usableForAnalysis": False,
        "description": "Classic far-field reference record used in earthquake engineering studies. Metadata only; upload or import a licensed record before formal analysis.",
        "descriptionZh": "地震工程研究中常用的经典远场参考记录。当前仅提供元数据；正式分析前需上传或导入授权波形。",
    },
    {
        "id": "SCGM-R3",
        "name": "Hachinohe 1968 Tokachi-Oki",
        "recordType": "reference",
        "event": "Tokachi-Oki / Hachinohe",
        "year": 1968,
        "region": "Japan",
        "station": "Hachinohe Harbor or Hachinohe City",
        "component": "horizontal component commonly cited in benchmark studies",
        "magnitudeMw": 7.9,
        "pgaG": 0.2294,
        "sourceUrl": "https://www.jaee.gr.jp/stack/submit-j/v10n02/gai/100202_gaiyo_english.pdf",
        "dataAvailability": "metadata_only",
        "usableForAnalysis": False,
        "description": "Long-duration far-field record frequently used in high-rise and vibration-control benchmark studies. Metadata only.",
        "descriptionZh": "高层结构和振动控制基准研究中常用的长持续时间远场记录。当前仅提供元数据。",
    },
    {
        "id": "SCGM-R4",
        "name": "Northridge 1994 Sylmar",
        "recordType": "reference",
        "event": "Northridge",
        "year": 1994,
        "region": "California, USA",
        "station": "Sylmar County Hospital Parking Lot",
        "component": "90 degree or 360 degree horizontal components",
        "magnitudeMw": 6.7,
        "dt": 0.02,
        "pgaG": 0.843,
        "pgaMps2": 8.268,
        "sourceUrl": "https://www.strongmotioncenter.org/vdc/scripts/event.plx?evt=21",
        "dataAvailability": "metadata_only",
        "usableForAnalysis": False,
        "description": "Strong near-field reference record commonly used for nonlinear and control benchmarks. Metadata only.",
        "descriptionZh": "非线性分析和控制基准中常用的强近场参考记录。当前仅提供元数据。",
    },
    {
        "id": "SCGM-R5",
        "name": "Kobe 1995 KJMA",
        "recordType": "reference",
        "event": "Hyogo-ken Nanbu / Kobe",
        "year": 1995,
        "region": "Japan",
        "station": "KJMA",
        "component": "0 or 90 degree horizontal components",
        "magnitudeMw": 6.9,
        "sourceUrl": "https://www.strongmotioncenter.org/vdc/scripts/event.plx?evt=1098",
        "dataAvailability": "metadata_only",
        "usableForAnalysis": False,
        "description": "Near-fault recorded motion with pulse-like characteristics often used in benchmark studies. Metadata only.",
        "descriptionZh": "基准研究中常用的近断层脉冲型真实记录。当前仅提供元数据。",
    },
    {
        "id": "SCGM-R6",
        "name": "Loma Prieta 1989 Oakland Outer Harbor Wharf",
        "recordType": "reference",
        "event": "Loma Prieta",
        "year": 1989,
        "region": "California, USA",
        "station": "Oakland Outer Harbor Wharf",
        "component": "270 or 0 degree horizontal components",
        "dt": 0.02,
        "pgaG": 0.276,
        "pgaMps2": 2.704,
        "sourceUrl": "https://www.eng.ucy.ac.cy/petros/Earthquakes/earthquakes.htm",
        "dataAvailability": "metadata_only",
        "usableForAnalysis": False,
        "description": "Soft-soil and waterfront reference record for supplementing site-condition variety. Metadata only.",
        "descriptionZh": "用于补充场地条件差异的软土/港区参考记录。当前仅提供元数据。",
    },
    {
        "id": "SCGM-R7",
        "name": "Chi-Chi 1999 TCU052 or TCU068",
        "recordType": "reference",
        "event": "Chi-Chi",
        "year": 1999,
        "region": "Taiwan, China",
        "station": "TCU052 or TCU068",
        "component": "horizontal components",
        "magnitudeMw": 7.6,
        "sourceUrl": "https://www.usgs.gov/publications/data-files-cwb-free-field-strong-motion-data-21-september-chi-chi-taiwan-earthquake",
        "dataAvailability": "metadata_only",
        "usableForAnalysis": False,
        "description": "Modern near-fault strong-motion reference with many recorded stations; useful for long-period and pulse-sensitive checks. Metadata only.",
        "descriptionZh": "包含大量台站的现代近断层强震参考记录，适合长周期和脉冲敏感问题筛选。当前仅提供元数据。",
    },
]

CATALOG_BY_ID = {item["id"]: item for item in CATALOG_META}
REFERENCE_CATALOG_BY_ID = {item["id"]: item for item in RECORDED_REFERENCE_CATALOG_META}


def list_builtin_catalog() -> List[Dict[str, Any]]:
    return [dict(item) for item in CATALOG_META]


def list_recorded_reference_catalog() -> List[Dict[str, Any]]:
    return [dict(item) for item in RECORDED_REFERENCE_CATALOG_META]


def _wave_values(index: int, duration: float, dt: float) -> List[float]:
    count = int(duration / dt)
    values: List[float] = []
    amplitude = 0.025 + 0.004 * index
    primary_hz = 0.65 + 0.08 * index
    secondary_hz = 1.35 + 0.11 * index
    phase = 0.37 * index
    for step in range(count):
        t = step * dt
        envelope = math.sin(math.pi * min(t / duration, 1.0)) ** 1.2
        value = envelope * amplitude * (
            math.sin(2.0 * math.pi * primary_hz * t + phase)
            + 0.45 * math.sin(2.0 * math.pi * secondary_hz * t)
            + 0.20 * math.sin(2.0 * math.pi * (2.2 + 0.05 * index) * t + phase / 2.0)
        )
        values.append(round(value, 8))
    return values


def _catalog_record(catalog_id: str) -> Dict[str, Any]:
    if catalog_id not in CATALOG_BY_ID:
        raise ValueError(f"Unknown built-in ground-motion catalog id: {catalog_id}")
    meta = CATALOG_BY_ID[catalog_id]
    index = int(catalog_id.rsplit("A", 1)[-1])
    return {
        "id": catalog_id,
        "name": meta["name"],
        "dt": meta["dt"],
        "unit": meta["unit"],
        "recordType": meta["recordType"],
        "source": "builtin_artificial_catalog",
        "values": _wave_values(index, float(meta["duration"]), float(meta["dt"])),
    }


def _string_list(value: Any) -> List[str]:
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return []


def _optional_number(value: Any) -> Optional[float]:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return float(value)
    if isinstance(value, str) and value.strip():
        try:
            number = float(value)
        except ValueError:
            return None
        return number if math.isfinite(number) else None
    return None


def _ground_motion_set(workflow: Dict[str, Any]) -> Dict[str, Any]:
    value = workflow.get("groundMotionSet")
    return value if isinstance(value, dict) else {}


def _records(value: Any) -> List[Dict[str, Any]]:
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    if isinstance(value, dict):
        nested = value.get("records")
        if isinstance(nested, list):
            return [item for item in nested if isinstance(item, dict)]
    return []


def selected_catalog_ids(workflow: Dict[str, Any]) -> List[str]:
    ground_motion_set = _ground_motion_set(workflow)
    ids: List[str] = []
    for value in (
        workflow.get("catalogIds"),
        workflow.get("catalogId"),
        ground_motion_set.get("catalogIds"),
        ground_motion_set.get("catalogId"),
        ground_motion_set.get("selectedCatalogIds"),
    ):
        ids.extend(_string_list(value))
    return list(dict.fromkeys(ids))


def _local_catalog_records(workflow: Dict[str, Any]) -> List[Dict[str, Any]]:
    ground_motion_set = _ground_motion_set(workflow)
    records: List[Dict[str, Any]] = []
    for source in (
        ground_motion_set.get("localCatalog"),
        ground_motion_set.get("catalog"),
        workflow.get("groundMotionCatalog"),
        workflow.get("localGroundMotionCatalog"),
    ):
        records.extend(_records(source))
    return records


def _selection_criteria(workflow: Dict[str, Any]) -> Dict[str, Any]:
    ground_motion_set = _ground_motion_set(workflow)
    for value in (
        ground_motion_set.get("selectionCriteria"),
        ground_motion_set.get("criteria"),
        workflow.get("groundMotionSelection"),
    ):
        if isinstance(value, dict):
            return value
    return {}


def _record_number(record: Dict[str, Any], *keys: str) -> Optional[float]:
    for key in keys:
        number = _optional_number(record.get(key))
        if number is not None:
            return number
    return None


def _record_text(record: Dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = record.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip().lower()
    return ""


def _number_in_range(value: Optional[float], minimum: Optional[float], maximum: Optional[float]) -> bool:
    if value is None:
        return minimum is None and maximum is None
    if minimum is not None and value < minimum:
        return False
    if maximum is not None and value > maximum:
        return False
    return True


def _target_count(workflow: Dict[str, Any], required_count: int) -> int:
    ground_motion_set = _ground_motion_set(workflow)
    criteria = _selection_criteria(workflow)
    for value in (
        ground_motion_set.get("recordCount"),
        ground_motion_set.get("requiredCount"),
        criteria.get("recordCount"),
        criteria.get("count"),
    ):
        number = _optional_number(value)
        if number is not None and number > 0:
            return int(number)
    return required_count if required_count > 0 else 3


def _matches_selection_criteria(record: Dict[str, Any], criteria: Dict[str, Any]) -> bool:
    record_types = {item.lower() for item in _string_list(criteria.get("recordType") or criteria.get("recordTypes"))}
    if record_types:
        record_type = _record_text(record, "recordType", "type") or "actual"
        if record_type not in record_types:
            return False

    site_classes = {item.lower() for item in _string_list(criteria.get("siteClass") or criteria.get("siteClasses") or criteria.get("siteCategory"))}
    if site_classes:
        site_class = _record_text(record, "siteClass", "siteCategory", "site")
        if site_class not in site_classes:
            return False

    magnitude = _record_number(record, "magnitude", "mw", "magnitudeMw")
    if not _number_in_range(
        magnitude,
        _optional_number(criteria.get("minMagnitude") or criteria.get("magnitudeMin")),
        _optional_number(criteria.get("maxMagnitude") or criteria.get("magnitudeMax")),
    ):
        return False

    distance = _record_number(record, "distanceKm", "ruptureDistanceKm", "epicentralDistanceKm", "sourceDistanceKm")
    if not _number_in_range(
        distance,
        _optional_number(criteria.get("minDistanceKm") or criteria.get("distanceKmMin")),
        _optional_number(criteria.get("maxDistanceKm") or criteria.get("distanceKmMax")),
    ):
        return False

    return True


def _selection_score(record: Dict[str, Any], criteria: Dict[str, Any], index: int) -> Tuple[float, float, int]:
    target_magnitude = _optional_number(criteria.get("targetMagnitude") or criteria.get("magnitude"))
    target_distance = _optional_number(criteria.get("targetDistanceKm") or criteria.get("distanceKm"))
    magnitude = _record_number(record, "magnitude", "mw", "magnitudeMw")
    distance = _record_number(record, "distanceKm", "ruptureDistanceKm", "epicentralDistanceKm", "sourceDistanceKm")
    magnitude_score = abs(magnitude - target_magnitude) if magnitude is not None and target_magnitude is not None else 0.0
    distance_score = abs(distance - target_distance) if distance is not None and target_distance is not None else 0.0
    return (magnitude_score, distance_score, index)


def _select_local_records_by_criteria(
    records: List[Dict[str, Any]],
    workflow: Dict[str, Any],
    required_count: int,
) -> List[Dict[str, Any]]:
    criteria = _selection_criteria(workflow)
    target_count = _target_count(workflow, required_count)
    candidates = [
        (index, record)
        for index, record in enumerate(records)
        if _matches_selection_criteria(record, criteria)
    ]
    candidates.sort(key=lambda item: _selection_score(item[1], criteria, item[0]))
    return [record for _, record in candidates[:target_count]]


def resolve_local_catalog_records(
    workflow: Dict[str, Any],
    *,
    required_count: int = 0,
    allow_auto_select: bool = False,
) -> List[Dict[str, Any]]:
    records = _local_catalog_records(workflow)
    if not records:
        return []
    selected_ids = selected_catalog_ids(workflow)
    selected: List[Dict[str, Any]]
    if selected_ids:
        by_id = {
            str(record.get("id") or record.get("catalogId") or "").strip(): record
            for record in records
        }
        selected = [by_id[catalog_id] for catalog_id in selected_ids if catalog_id in by_id]
    else:
        ground_motion_set = _ground_motion_set(workflow)
        source = str(ground_motion_set.get("source") or "").strip().lower()
        criteria = _selection_criteria(workflow)
        wants_local_auto = allow_auto_select and (
            ground_motion_set.get("autoSelect") is True
            and source in {"local_catalog", "licensed_catalog", "project_catalog"}
        )
        wants_criteria_selection = bool(criteria) and source in {"local_catalog", "licensed_catalog", "project_catalog"}
        selected = _select_local_records_by_criteria(records, workflow, required_count) if (wants_local_auto or wants_criteria_selection) else []
    result: List[Dict[str, Any]] = []
    for record in selected:
        result.append({
            **record,
            "id": str(record.get("id") or record.get("catalogId") or record.get("name") or "local-ground-motion"),
            "source": record.get("source") or "local_ground_motion_catalog",
            "recordType": record.get("recordType") or record.get("type") or "actual",
        })
    return result


def wants_builtin_auto_select(workflow: Dict[str, Any]) -> bool:
    ground_motion_set = _ground_motion_set(workflow)
    source = str(ground_motion_set.get("source") or workflow.get("groundMotionSource") or "").strip().lower()
    return (
        ground_motion_set.get("autoSelect") is True
        or workflow.get("autoSelectGroundMotions") is True
        or source in {"builtin", "builtin_artificial", "artificial", "auto"}
    )


def resolve_builtin_catalog_records(
    workflow: Dict[str, Any],
    *,
    required_count: int = 0,
    allow_auto_select: bool = False,
) -> List[Dict[str, Any]]:
    ids = selected_catalog_ids(workflow)
    if not ids and allow_auto_select and wants_builtin_auto_select(workflow):
        count = required_count if required_count in {3, 7} else 3
        ids = [item["id"] for item in CATALOG_META[:count]]
    executable_ids: List[str] = []
    for catalog_id in ids:
        if catalog_id in CATALOG_BY_ID:
            executable_ids.append(catalog_id)
        elif catalog_id in REFERENCE_CATALOG_BY_ID:
            continue
        else:
            raise ValueError(f"Unknown built-in ground-motion catalog id: {catalog_id}")
    ids = executable_ids
    if not ids:
        return []
    return [_catalog_record(catalog_id) for catalog_id in ids]


def resolve_catalog_records(
    workflow: Dict[str, Any],
    *,
    required_count: int = 0,
    allow_auto_select: bool = False,
) -> List[Dict[str, Any]]:
    local_records = resolve_local_catalog_records(
        workflow,
        required_count=required_count,
        allow_auto_select=allow_auto_select,
    )
    local_ids = {str(record.get("id") or "").strip() for record in local_records}
    builtin_ids = [
        catalog_id for catalog_id in selected_catalog_ids(workflow)
        if catalog_id in CATALOG_BY_ID and catalog_id not in local_ids
    ]
    builtin_records = [_catalog_record(catalog_id) for catalog_id in builtin_ids]
    if not local_records and not builtin_records:
        builtin_records = resolve_builtin_catalog_records(
            workflow,
            required_count=required_count,
            allow_auto_select=allow_auto_select,
        )
    return [*local_records, *builtin_records]


def catalog_summary_for_records(records: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    catalog_ids = [record.get("id") for record in records if isinstance(record.get("id"), str)]
    sources = sorted({
        str(record.get("source") or "unknown")
        for record in records
        if isinstance(record, dict)
    })
    return {
        "source": sources[0] if len(sources) == 1 else "mixed_ground_motion_catalog",
        "catalogIds": catalog_ids,
        **({"catalog": list_builtin_catalog()} if sources == ["builtin_artificial_catalog"] else {}),
    }
