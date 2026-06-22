# EO Embeddings ML System

Map-first tooling for few-shot Earth observation mapping with foundation-model embeddings.

This repository starts with a practical MVP:

- `apps/web`: dependency-light browser prototype for labeling, training runs, similarity search, change inspection, and export flows.
- `apps/api`: FastAPI skeleton for projects, samples, embedding extraction, model training, and inference.
- `docs`: architecture and AlphaEarth/Earth Engine workflow notes.

## Product Direction

The first product is a Few-Shot Embedding Mapper:

1. Select an area and year.
2. Add sparse labels by point or polygon.
3. Sample AlphaEarth Satellite Embedding vectors.
4. Train a lightweight classifier or similarity model.
5. Render map, confidence, uncertainty, and active-learning suggestions.
6. Export GeoTIFF, GeoJSON, or an Earth Engine script.

Current live capabilities:

- Sentinel-2 true-color context tiles from Earth Engine.
- AlphaEarth embedding visualization tiles.
- Click-based AlphaEarth vector sampling.
- Continuous embedding-similarity tile layers for "show me more places like this".
- Earth Engine Random Forest classification tiles trained from user labels.
- Coarse grid fallbacks for debugging and fast previews.
- SQLite persistence for projects, samples, and sampled embedding vectors.

## Quick Start

Open the static prototype:

```powershell
Start-Process .\apps\web\index.html
```

Run the API after installing dependencies:

```powershell
cd apps\api
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e .
uvicorn app.main:app --reload --port 8080
```

Earth Engine project:

```powershell
$env:EARTH_ENGINE_PROJECT="ee-hanzilabinyounasai"
earthengine authenticate
```

Then check:

```powershell
Invoke-RestMethod http://127.0.0.1:8080/earth-engine/status
```

Local data is stored in:

```text
apps/api/data/eo_mapper.sqlite
```

Override it with:

```powershell
$env:EO_MAPPER_DATA_DIR="D:\eo-mapper-data"
```

## Target Data Source

Primary embedding source:

```text
GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL
```

This is Google's AlphaEarth Foundations Satellite Embedding dataset in Google Earth Engine.
