from uuid import UUID, uuid4

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.schemas import (
    ChangeRequest,
    ClassificationTileRequest,
    PredictGridRequest,
    Project,
    ProjectCreate,
    Sample,
    SampleCreate,
    SimilarityGridRequest,
    SimilarityRequest,
    SimilarityTileRequest,
    TrainRequest,
    TrainRun,
)
from app.services.embeddings import EmbeddingSampler
from app.services.earth_engine import EarthEngineEmbeddingSampler
from app.services.models import FewShotTrainer
from app.storage import SqliteStore


app = FastAPI(title="EO Embeddings API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

train_runs: dict[UUID, TrainRun] = {}

store = SqliteStore()
store.initialize()
sampler = EmbeddingSampler()
earth_engine_sampler = EarthEngineEmbeddingSampler()
trainer = FewShotTrainer()


@app.get("/health")
def health() -> dict[str, object]:
    return {"status": "ok", "store": store.counts()}


@app.get("/")
def root() -> dict[str, str]:
    return {
        "name": "EO Embeddings API",
        "status": "ready",
        "embedding_source": "GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL",
    }


@app.get("/embedding-source")
def embedding_source() -> dict[str, object]:
    return sampler.describe()


@app.get("/earth-engine/status")
def earth_engine_status() -> dict[str, object]:
    return earth_engine_sampler.status().__dict__


@app.get("/earth-engine/alphaearth-tiles")
def alphaearth_tiles(year: int = 2024) -> dict[str, object]:
    if year < 2017 or year > 2024:
        raise HTTPException(status_code=400, detail="year must be between 2017 and 2024")
    try:
        tile_url = earth_engine_sampler.alphaearth_tile_url(year)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {
        "year": year,
        "collection_id": earth_engine_sampler.status().collection_id,
        "tile_url": tile_url,
        "visualization": {
            "bands": ["A02", "A01", "A00"],
            "min": -0.3,
            "max": 0.3,
            "gamma": 1.15,
        },
    }


@app.get("/earth-engine/sentinel2-tiles")
def sentinel2_tiles(year: int = 2024) -> dict[str, object]:
    if year < 2017 or year > 2024:
        raise HTTPException(status_code=400, detail="year must be between 2017 and 2024")
    try:
        tile_url = earth_engine_sampler.sentinel2_tile_url(year)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {
        "year": year,
        "collection_id": "COPERNICUS/S2_SR_HARMONIZED",
        "tile_url": tile_url,
        "visualization": {
            "bands": ["B4", "B3", "B2"],
            "min": 0,
            "max": 3000,
            "gamma": 1.15,
        },
    }


@app.post("/projects", response_model=Project)
def create_project(payload: ProjectCreate) -> Project:
    project = Project(id=uuid4(), **payload.model_dump())
    store.create_project(project)
    return project


@app.get("/projects", response_model=list[Project])
def list_projects() -> list[Project]:
    return store.list_projects()


@app.get("/projects/{project_id}", response_model=Project)
def get_project(project_id: UUID) -> Project:
    return _get_project_or_404(project_id)


@app.post("/projects/{project_id}/samples", response_model=Sample)
def add_sample(project_id: UUID, payload: SampleCreate) -> Sample:
    project = _get_project_or_404(project_id)

    sample = Sample(id=uuid4(), project_id=project_id, **payload.model_dump())
    year = payload.year or project.year
    vector_source = "earth_engine"
    try:
        vector = earth_engine_sampler.sample_geojson(payload.geometry, year)
    except Exception as exc:
        vector_source = f"placeholder: {exc}"
        vector = sampler.sample_geojson(payload.geometry, year)
    store.add_sample(sample, vector=vector, vector_source=vector_source)
    return sample


@app.post("/projects/{project_id}/samples/vector")
def sample_vector(project_id: UUID, payload: SampleCreate) -> dict[str, object]:
    project = _get_project_or_404(project_id)

    year = payload.year or project.year
    source_mode = "earth_engine"
    try:
        vector = earth_engine_sampler.sample_geojson(payload.geometry, year)
        source = earth_engine_sampler.project
    except Exception as exc:
        source_mode = "placeholder"
        vector = sampler.sample_geojson(payload.geometry, year)
        source = f"{sampler.source.collection_id}; fallback reason: {exc}"
    return {
        "project_id": project_id,
        "class_id": payload.class_id,
        "year": year,
        "band_count": len(vector),
        "vector_preview": vector[:8],
        "source_mode": source_mode,
        "source": source,
    }


@app.get("/projects/{project_id}/samples", response_model=list[Sample])
def list_samples(project_id: UUID) -> list[Sample]:
    _get_project_or_404(project_id)
    return store.list_samples(project_id)


@app.post("/projects/{project_id}/train", response_model=TrainRun)
def train(project_id: UUID, payload: TrainRequest) -> TrainRun:
    _get_project_or_404(project_id)

    result = trainer.train(
        project_id,
        store.list_samples(project_id),
        payload.model_type,
        store.sample_vectors(project_id),
    )
    train_runs[result.run.id] = result.run
    return result.run


@app.post("/projects/{project_id}/similarity")
def similarity(project_id: UUID, payload: SimilarityRequest) -> dict[str, object]:
    _get_project_or_404(project_id)

    vector = sampler.sample_geojson(payload.geometry, payload.year)
    return {
        "project_id": project_id,
        "year": payload.year,
        "prototype_vector_preview": vector[:6],
        "message": "Similarity search boundary ready; FAISS/Earth Engine implementation next.",
    }


@app.post("/projects/{project_id}/similarity-grid")
def similarity_grid(project_id: UUID, payload: SimilarityGridRequest) -> dict[str, object]:
    _get_project_or_404(project_id)

    min_lon, min_lat, max_lon, max_lat = payload.bbox
    if min_lon >= max_lon or min_lat >= max_lat:
        raise HTTPException(status_code=400, detail="Invalid bbox")

    try:
        prototype = earth_engine_sampler.sample_geojson(payload.geometry, payload.year)
        source_mode = "earth_engine"
    except Exception as exc:
        prototype = sampler.sample_geojson(payload.geometry, payload.year)
        source_mode = f"placeholder: {exc}"

    cells = _build_grid(min_lon, min_lat, max_lon, max_lat, payload.rows, payload.cols)
    points = [cell["center"] for cell in cells]
    try:
        vectors = earth_engine_sampler.sample_points(points, payload.year)
    except Exception as exc:
        source_mode = f"placeholder: {exc}"
        vectors = [
            sampler.sample_geojson(
                {"type": "Point", "coordinates": [lon, lat]},
                payload.year,
            )
            for lon, lat in points
        ]

    features = []
    for cell, vector in zip(cells, vectors):
        if vector is None:
            continue
        similarity_score = _cosine_similarity(prototype, vector)
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "similarity": round(similarity_score, 3),
                    "year": payload.year,
                },
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [cell["ring"]],
                },
            }
        )

    return {
        "project_id": project_id,
        "year": payload.year,
        "source_mode": source_mode,
        "feature_count": len(features),
        "features": features,
    }


@app.post("/projects/{project_id}/similarity-tiles")
def similarity_tiles(project_id: UUID, payload: SimilarityTileRequest) -> dict[str, object]:
    _get_project_or_404(project_id)

    try:
        tile_url = earth_engine_sampler.similarity_tile_url(
            prototype_geometry=payload.geometry,
            year=payload.year,
            bbox=payload.bbox,
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return {
        "project_id": project_id,
        "year": payload.year,
        "source_mode": "earth_engine",
        "tile_url": tile_url,
        "visualization": {
            "metric": "cosine_similarity",
            "min": 0.35,
            "max": 0.92,
        },
    }


@app.post("/projects/{project_id}/change")
def change(project_id: UUID, payload: ChangeRequest) -> dict[str, object]:
    _get_project_or_404(project_id)
    if payload.start_year >= payload.end_year:
        raise HTTPException(status_code=400, detail="start_year must be before end_year")

    return {
        "project_id": project_id,
        "start_year": payload.start_year,
        "end_year": payload.end_year,
        "method": "1 - cosine_similarity(embedding_start, embedding_end)",
        "message": "Change detection route ready for Earth Engine raster execution.",
    }


@app.post("/projects/{project_id}/predict-grid")
def predict_grid(project_id: UUID, payload: PredictGridRequest) -> dict[str, object]:
    _get_project_or_404(project_id)
    project_samples = store.list_samples(project_id)

    min_lon, min_lat, max_lon, max_lat = payload.bbox
    if min_lon >= max_lon or min_lat >= max_lat:
        raise HTTPException(status_code=400, detail="Invalid bbox")

    cells = _build_grid(min_lon, min_lat, max_lon, max_lat, payload.rows, payload.cols)
    points = [cell["center"] for cell in cells]

    source_mode = "earth_engine"
    try:
        vectors = earth_engine_sampler.sample_points(points, payload.year)
    except Exception as exc:
        source_mode = f"placeholder: {exc}"
        vectors = [
            sampler.sample_geojson(
                {"type": "Point", "coordinates": [lon, lat]},
                payload.year,
            )
            for lon, lat in points
        ]

    valid_cells = []
    valid_vectors = []
    for cell, vector in zip(cells, vectors):
        if vector is None:
            continue
        valid_cells.append(cell)
        valid_vectors.append(vector)

    if not valid_vectors:
        raise HTTPException(status_code=400, detail="No embedding vectors returned for grid")

    try:
        predictions = trainer.predict_vectors(
            project_samples,
            store.sample_vectors(project_id),
            valid_vectors,
            payload.model_type,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    class_lookup = {
        sample.class_id: sample.class_name
        for sample in project_samples
    }
    features = []
    for cell, prediction in zip(valid_cells, predictions):
        class_id = str(prediction["class_id"])
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "class_id": class_id,
                    "class_name": class_lookup.get(class_id, class_id),
                    "confidence": prediction["confidence"],
                    "year": payload.year,
                },
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [cell["ring"]],
                },
            }
        )

    return {
        "project_id": project_id,
        "year": payload.year,
        "source_mode": source_mode,
        "rows": payload.rows,
        "cols": payload.cols,
        "feature_count": len(features),
        "features": features,
    }


@app.post("/projects/{project_id}/classification-tiles")
def classification_tiles(project_id: UUID, payload: ClassificationTileRequest) -> dict[str, object]:
    _get_project_or_404(project_id)

    try:
        result = earth_engine_sampler.classification_tile_url(
            training_samples=store.list_samples(project_id),
            year=payload.year,
            bbox=payload.bbox,
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return {
        "project_id": project_id,
        "year": payload.year,
        "source_mode": "earth_engine",
        **result,
    }


def _get_project_or_404(project_id: UUID) -> Project:
    project = store.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def _build_grid(
    min_lon: float,
    min_lat: float,
    max_lon: float,
    max_lat: float,
    rows: int,
    cols: int,
) -> list[dict[str, object]]:
    lon_step = (max_lon - min_lon) / cols
    lat_step = (max_lat - min_lat) / rows
    cells = []
    for row in range(rows):
        for col in range(cols):
            west = min_lon + col * lon_step
            east = west + lon_step
            south = min_lat + row * lat_step
            north = south + lat_step
            ring = [
                [west, south],
                [east, south],
                [east, north],
                [west, north],
                [west, south],
            ]
            cells.append(
                {
                    "center": (west + lon_step / 2, south + lat_step / 2),
                    "ring": ring,
                }
            )
    return cells


def _cosine_similarity(left: list[float], right: list[float]) -> float:
    numerator = sum(a * b for a, b in zip(left, right))
    left_norm = sum(a * a for a in left) ** 0.5 or 1.0
    right_norm = sum(b * b for b in right) ** 0.5 or 1.0
    return numerator / (left_norm * right_norm)
