# EO Embeddings API

FastAPI service skeleton for the Few-Shot Embedding Mapper.

## Run

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e .
uvicorn app.main:app --reload --port 8080
```

## Environment

Future Earth Engine integration will need one of:

- user authentication for local research,
- service account credentials for deployment.

Expected variables later:

```text
GOOGLE_APPLICATION_CREDENTIALS=
EARTH_ENGINE_PROJECT=
```
