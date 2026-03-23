from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, model_validator


class Node(BaseModel):
    id: str = Field(..., min_length=1)
    x: float
    y: float
    z: float
    restraints: Optional[List[bool]] = Field(
        default=None,
        min_length=6,
        max_length=6,
        description="[ux, uy, uz, rx, ry, rz]",
    )


class Element(BaseModel):
    id: str = Field(..., min_length=1)
    type: Literal["beam", "truss", "shell", "solid"] = "beam"
    nodes: List[str] = Field(..., min_length=2)
    material: str = Field(..., min_length=1)
    section: str = Field(..., min_length=1)


class Material(BaseModel):
    id: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)
    E: float = Field(..., gt=0, description="弹性模量 MPa")
    nu: float = Field(..., ge=0, le=0.5, description="泊松比")
    rho: float = Field(..., gt=0, description="密度 kg/m^3")
    fy: Optional[float] = Field(default=None, gt=0, description="屈服强度 MPa")


class Section(BaseModel):
    id: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)
    type: str = Field(..., min_length=1)
    properties: Dict[str, Any] = Field(default_factory=dict)


class LoadCase(BaseModel):
    id: str = Field(..., min_length=1)
    type: Literal["dead", "live", "wind", "seismic", "other"] = "other"
    loads: List[Dict[str, Any]] = Field(default_factory=list)


class LoadCombination(BaseModel):
    id: str = Field(..., min_length=1)
    factors: Dict[str, float] = Field(default_factory=dict)


class StructureModelV1(BaseModel):
    schema_version: str = Field(default="1.0.0")
    unit_system: str = Field(default="SI")
    nodes: List[Node] = Field(default_factory=list)
    elements: List[Element] = Field(default_factory=list)
    materials: List[Material] = Field(default_factory=list)
    sections: List[Section] = Field(default_factory=list)
    load_cases: List[LoadCase] = Field(default_factory=list)
    load_combinations: List[LoadCombination] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_references(self):
        node_ids = {n.id for n in self.nodes}
        material_ids = {m.id for m in self.materials}
        section_ids = {s.id for s in self.sections}

        for elem in self.elements:
            for node_id in elem.nodes:
                if node_id not in node_ids:
                    raise ValueError(f"Element '{elem.id}' references unknown node '{node_id}'")
            if elem.material not in material_ids:
                raise ValueError(
                    f"Element '{elem.id}' references unknown material '{elem.material}'"
                )
            if elem.section not in section_ids:
                raise ValueError(
                    f"Element '{elem.id}' references unknown section '{elem.section}'"
                )

        return self
