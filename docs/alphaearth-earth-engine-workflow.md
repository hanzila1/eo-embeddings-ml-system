# AlphaEarth / Earth Engine Workflow

## Dataset

Earth Engine collection:

```javascript
ee.ImageCollection("GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL")
```

Each image contains 64 bands:

```text
A00, A01, ..., A63
```

Each 10 m pixel is a unit-length embedding vector. Use all 64 bands together.

## Core Operations

### Select Annual Embeddings

```javascript
var embeddings = ee.ImageCollection("GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL");

var image = embeddings
  .filterDate("2024-01-01", "2025-01-01")
  .filterBounds(areaOfInterest)
  .mosaic();
```

### Sample Training Points

```javascript
var bands = ee.List.sequence(0, 63).map(function(i) {
  return ee.String("A").cat(ee.Number(i).format("%02d"));
});

var samples = image.select(bands).sampleRegions({
  collection: labels,
  properties: ["class_id"],
  scale: 10,
  geometries: true
});
```

### Train Random Forest

```javascript
var classifier = ee.Classifier.smileRandomForest({
  numberOfTrees: 150,
  minLeafPopulation: 2
}).train({
  features: samples,
  classProperty: "class_id",
  inputProperties: bands
});

var classified = image.select(bands).classify(classifier);
```

### Similarity Search

For a prototype vector, dot product is cosine similarity because AlphaEarth vectors are unit-length.

```javascript
var prototype = ee.Array([/* 64 values */]);
var dot = image.select(bands)
  .toArray()
  .arrayDotProduct(prototype)
  .arrayGet([0]);
```

### Change Detection

```javascript
var image2020 = embeddings.filterDate("2020-01-01", "2021-01-01")
  .filterBounds(areaOfInterest)
  .mosaic()
  .select(bands);

var image2024 = embeddings.filterDate("2024-01-01", "2025-01-01")
  .filterBounds(areaOfInterest)
  .mosaic()
  .select(bands);

var similarity = image2020.multiply(image2024).reduce(ee.Reducer.sum());
var change = ee.Image(1).subtract(similarity);
```

## Backend Integration Plan

1. Authenticate Earth Engine in the API process with project `ee-hanzilabinyounasai`.
2. Convert frontend GeoJSON labels to `ee.FeatureCollection`.
3. Sample embedding vectors for labels.
4. Train in Earth Engine for large areas or locally for small experiments.
5. Return tile URLs, statistics, and export task IDs.

## Local Authentication

```powershell
cd "D:\EO Embeddings ML system\apps\api"
.\.venv\Scripts\Activate.ps1
$env:EARTH_ENGINE_PROJECT="ee-hanzilabinyounasai"
earthengine authenticate
```

Authentication is required once per local account. The project ID alone is not enough; Earth Engine also needs OAuth user credentials or a service-account credential file.

## First Real API Calls

- `POST /projects`
- `POST /projects/{id}/samples`
- `POST /projects/{id}/train`
- `GET /projects/{id}/runs/{run_id}`
- `POST /projects/{id}/similarity`
- `POST /projects/{id}/change`
- `POST /projects/{id}/exports`
