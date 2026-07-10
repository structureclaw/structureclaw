from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional

from seismic_contracts import as_record, first_number, first_string


def _string(value: Any) -> Optional[str]:
    if isinstance(value, str) and value.strip():
        return value.strip()
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    return None


def _match_key(value: Any) -> str:
    text = _string(value) or ""
    return "".join(text.lower().split())


def _first_existing(record: Dict[str, Any], keys: Iterable[str]) -> Any:
    for key in keys:
        if key in record:
            return record.get(key)
    return None


def _record_from_row(headers: List[Any], row: List[Any]) -> Dict[str, Any]:
    result: Dict[str, Any] = {}
    for index, raw_header in enumerate(headers):
        key = _string(raw_header)
        if not key or index >= len(row):
            continue
        result[key] = row[index]
    return result


def _records_from_table(table: Dict[str, Any]) -> List[Dict[str, Any]]:
    explicit = table.get("records")
    if isinstance(explicit, list):
        return [item for item in explicit if isinstance(item, dict)]
    headers = table.get("headers")
    rows = table.get("rows")
    if isinstance(headers, list) and isinstance(rows, list):
        return [_record_from_row(headers, row) for row in rows if isinstance(row, list)]
    return []


def _candidate_records(payload: Dict[str, Any], workflow: Dict[str, Any]) -> List[Dict[str, Any]]:
    metadata = as_record(payload.get("metadata"))
    design_basis = as_record(workflow.get("designBasis"))
    site = {
        **as_record(payload.get("site_seismic")),
        **as_record(metadata.get("siteSeismic")),
        **as_record(design_basis.get("siteSeismic")),
        **as_record(workflow.get("siteSeismic")),
    }
    candidates: List[Dict[str, Any]] = []
    for source in (
        as_record(site.get("zonationRecord")),
        as_record(design_basis.get("groundMotionZonation")),
        as_record(design_basis.get("zonation")),
        as_record(workflow.get("groundMotionZonation")),
        as_record(workflow.get("zonation")),
        as_record(metadata.get("groundMotionZonation")),
    ):
        if source:
            if source.get("records") or source.get("headers") or source.get("rows"):
                candidates.extend(_records_from_table(source))
            else:
                candidates.append(source)
    for source in (
        design_basis.get("zonationRecords"),
        workflow.get("zonationRecords"),
        metadata.get("zonationRecords"),
    ):
        if isinstance(source, list):
            candidates.extend([item for item in source if isinstance(item, dict)])
    return candidates


def _normalize_zonation_record(record: Dict[str, Any], source: str) -> Optional[Dict[str, Any]]:
    acceleration_g = first_number(
        _first_existing(record, ("accelerationG", "acceleration_g", "basicAccelerationG", "designBasicAccelerationG")),
        _first_existing(record, ("pgaG", "peakAccelerationG", "amaxG")),
    )
    intensity = first_number(_first_existing(record, ("intensity", "seismicIntensity", "fortificationIntensity")))
    design_group = first_string(_first_existing(record, ("designGroup", "design_group", "earthquakeGroup")))
    characteristic_period = first_number(
        _first_existing(record, ("characteristicPeriod", "characteristic_period", "Tg", "tg")),
    )
    max_influence = first_number(
        _first_existing(record, ("maxInfluenceCoefficient", "max_influence_coefficient", "alphaMax")),
    )
    if acceleration_g is None and intensity is None and design_group is None and characteristic_period is None:
        return None
    return {
        "source": source,
        "region": first_string(_first_existing(record, ("region", "city", "name", "location"))),
        "regionCode": first_string(_first_existing(record, ("regionCode", "adminCode", "gb18306Code", "code"))),
        "intensity": int(intensity) if intensity is not None else None,
        "accelerationG": acceleration_g,
        "designGroup": design_group,
        "characteristicPeriod": characteristic_period,
        "maxInfluenceCoefficient": max_influence,
    }


def resolve_zonation_record(payload: Dict[str, Any], workflow: Dict[str, Any], region: Optional[str]) -> Optional[Dict[str, Any]]:
    design_basis = as_record(workflow.get("designBasis"))
    explicit_region_code = first_string(
        design_basis.get("regionCode"),
        workflow.get("regionCode"),
        as_record(design_basis.get("siteSeismic")).get("regionCode"),
    )
    candidates = _candidate_records(payload, workflow)
    normalized = [
        record for record in (
            _normalize_zonation_record(candidate, "user-provided-gb18306-zonation")
            for candidate in candidates
        )
        if record
    ]
    if not normalized:
        return None
    if explicit_region_code:
        target = _match_key(explicit_region_code)
        for record in normalized:
            if _match_key(record.get("regionCode")) == target:
                return record
    if region:
        target_region = _match_key(region)
        for record in normalized:
            if _match_key(record.get("region")) == target_region:
                return record
    return normalized[0] if len(normalized) == 1 else None
