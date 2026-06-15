from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    area_geojson: dict[str, Any] | None = None
    year: int = Field(ge=2017, le=2024, default=2024)
    embedding_source: str = "GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL"


class Project(ProjectCreate):
    id: UUID


class SampleCreate(BaseModel):
    class_id: str = Field(min_length=1, max_length=64)
    class_name: str = Field(min_length=1, max_length=120)
    geometry: dict[str, Any]
    year: int | None = Field(default=None, ge=2017, le=2024)


class Sample(SampleCreate):
    id: UUID
    project_id: UUID


class TrainRequest(BaseModel):
    model_type: Literal["knn", "random_forest"] = "random_forest"
    validation: Literal["holdout", "spatial_block"] = "holdout"


class TrainRun(BaseModel):
    id: UUID
    project_id: UUID
    model_type: str
    status: Literal["queued", "running", "complete", "failed"]
    metrics: dict[str, float] = Field(default_factory=dict)
    message: str | None = None


class SimilarityRequest(BaseModel):
    geometry: dict[str, Any]
    year: int = Field(ge=2017, le=2024, default=2024)
    limit: int = Field(default=100, ge=1, le=10000)


class SimilarityGridRequest(BaseModel):
    geometry: dict[str, Any]
    bbox: list[float] = Field(
        min_length=4,
        max_length=4,
        description="[min_lon, min_lat, max_lon, max_lat]",
    )
    rows: int = Field(default=10, ge=2, le=20)
    cols: int = Field(default=10, ge=2, le=20)
    year: int = Field(ge=2017, le=2024, default=2024)


class ChangeRequest(BaseModel):
    start_year: int = Field(ge=2017, le=2024)
    end_year: int = Field(ge=2017, le=2024)
    area_geojson: dict[str, Any] | None = None


class PredictGridRequest(BaseModel):
    bbox: list[float] = Field(
        min_length=4,
        max_length=4,
        description="[min_lon, min_lat, max_lon, max_lat]",
    )
    rows: int = Field(default=8, ge=2, le=20)
    cols: int = Field(default=8, ge=2, le=20)
    year: int = Field(ge=2017, le=2024, default=2024)
    model_type: Literal["knn", "random_forest"] = "random_forest"
