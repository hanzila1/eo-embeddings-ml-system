# EO Embeddings ML System

Map-first tooling for few-shot Earth observation mapping with foundation-model embeddings.

This repository contains an operational, map-first AlphaEarth analysis workbench:

- `apps/web`: dependency-light browser workbench for AOIs, evidence labeling, similarity search, change intelligence, temporal inspection, and exports.
- `apps/api`: FastAPI service for projects, samples, embedding extraction, few-shot models, Earth Engine inference, and zonal analytics.
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
- Multi-year AlphaEarth change-detection tiles using `1 - cosine_similarity`.
- AOI-level change statistics: changed area, share of AOI, mean, median, P90, and P95 drift.
- Ranked change-hotspot polygons that can be inspected, focused, and exported.
- Earth Engine Random Forest classification tiles trained from user labels.
- Classification confidence tiles, low-confidence area, and per-class area estimates.
- A point inspector that compares annual 2017-2024 embeddings and plots temporal drift.
- API-backed sample undo/clear operations for iterative labeling sessions.
- Two-corner AOI drawing, view-to-AOI capture, live area, estimated 10 m pixels, and class balance.
- Portable GeoJSON evidence and a provenance-rich analysis JSON package.
- Project/year/date-stamped exports with embedded GeoJSON provenance metadata.
- Coarse grid fallbacks for debugging and fast previews.
- SQLite persistence for projects, samples, and sampled embedding vectors.
- Auto-saved project names backed by the API and SQLite.

## Operational Workflow

1. Draw an AOI or capture the current map view.
2. Click examples for at least two land-cover classes.
3. Build the land-cover map and inspect class area plus confidence.
4. Detect multi-year change and open the ranked hotspot list.
5. Switch to Inspect and click any pixel for its annual embedding-drift signature.
6. Export the AOI, labels, hotspots, metrics, model run, and provenance.

## Quick Start

Serve the browser workbench:

```powershell
cd apps\web
python -m http.server 5173 --bind 127.0.0.1
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

Open `http://127.0.0.1:5173/index.html` after both services are running.

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
