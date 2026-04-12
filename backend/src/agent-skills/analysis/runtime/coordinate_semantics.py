"""
Coordinate semantics helpers for analysis engines.

Provides access to canonical coordinate semantics metadata (e.g. element
reference vectors) that the TypeScript model builder may embed in the
model payload.
"""

CANONICAL_COORDINATE_SEMANTICS = 'global-z-up'


def get_model_metadata(model: dict) -> dict:
    """Return the model's ``metadata`` dict, or an empty dict if absent."""
    metadata = model.get('metadata')
    return metadata if isinstance(metadata, dict) else {}


def get_frame_dimension(metadata: dict):
    """Return the declared frame dimension when present."""
    value = metadata.get('frameDimension')
    return value if value in {'2d', '3d'} else None


def get_reference_vector(metadata: dict, element_id: str):
    """Look up an explicit reference vector for *element_id* in *metadata*.

    Returns a list of three floats ``[vx, vy, vz]`` when the metadata
    contains a valid entry, or ``None`` otherwise so the caller can fall
    back to a geometry-based default.
    """
    vectors = metadata.get('elementReferenceVectors')
    if not isinstance(vectors, dict):
        return None
    value = vectors.get(element_id)
    if isinstance(value, list) and len(value) == 3:
        return [float(value[0]), float(value[1]), float(value[2])]
    return None
