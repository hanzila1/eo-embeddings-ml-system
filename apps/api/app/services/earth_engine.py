from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.config import get_earth_engine_project
from app.services.embeddings import ALPHAEARTH_BANDS, ALPHAEARTH_COLLECTION


@dataclass(frozen=True)
class EarthEngineStatus:
    available: bool
    authenticated: bool
    project: str
    message: str
    collection_id: str = ALPHAEARTH_COLLECTION


class EarthEngineEmbeddingSampler:
    """Thin Earth Engine adapter for AlphaEarth Satellite Embeddings."""

    def __init__(self, project: str | None = None) -> None:
        self.project = project or get_earth_engine_project()
        self._initialized = False

    def status(self) -> EarthEngineStatus:
        try:
            ee = self._import_ee()
        except Exception as exc:
            return EarthEngineStatus(
                available=False,
                authenticated=False,
                project=self.project,
                message=f"earthengine-api import failed: {exc}",
            )

        try:
            self._initialize(ee)
            collection_size = (
                ee.ImageCollection(ALPHAEARTH_COLLECTION)
                .filterDate("2024-01-01", "2025-01-01")
                .limit(1)
                .size()
                .getInfo()
            )
            if collection_size < 1:
                return EarthEngineStatus(
                    available=True,
                    authenticated=True,
                    project=self.project,
                    message="Authenticated, but AlphaEarth collection returned no images for 2024.",
                )
            return EarthEngineStatus(
                available=True,
                authenticated=True,
                project=self.project,
                message="Earth Engine authenticated and AlphaEarth collection reachable.",
            )
        except Exception as exc:
            return EarthEngineStatus(
                available=True,
                authenticated=False,
                project=self.project,
                message=str(exc),
            )

    def sample_geojson(self, geometry: dict[str, Any], year: int) -> list[float]:
        ee = self._import_ee()
        self._initialize(ee)

        ee_geometry = self._to_ee_geometry(ee, geometry)
        image = (
            ee.ImageCollection(ALPHAEARTH_COLLECTION)
            .filterDate(f"{year}-01-01", f"{year + 1}-01-01")
            .filterBounds(ee_geometry)
            .mosaic()
            .select(ALPHAEARTH_BANDS)
        )
        sample = (
            image.sample(region=ee_geometry, scale=10, numPixels=1, geometries=False)
            .first()
            .toDictionary(ALPHAEARTH_BANDS)
            .getInfo()
        )
        if not sample:
            raise ValueError("No AlphaEarth embedding sample returned for the geometry.")
        return [float(sample[band]) for band in ALPHAEARTH_BANDS]

    def sample_points(self, points: list[tuple[float, float]], year: int) -> list[list[float] | None]:
        ee = self._import_ee()
        self._initialize(ee)

        features = [
            ee.Feature(ee.Geometry.Point([lon, lat]), {"idx": idx})
            for idx, (lon, lat) in enumerate(points)
        ]
        collection = ee.FeatureCollection(features)
        image = (
            ee.ImageCollection(ALPHAEARTH_COLLECTION)
            .filterDate(f"{year}-01-01", f"{year + 1}-01-01")
            .filterBounds(collection.geometry())
            .mosaic()
            .select(ALPHAEARTH_BANDS)
        )
        sampled = image.sampleRegions(
            collection=collection,
            scale=10,
            geometries=False,
        ).getInfo()

        output: list[list[float] | None] = [None] * len(points)
        for feature in sampled.get("features", []):
            properties = feature.get("properties", {})
            idx = int(properties["idx"])
            try:
                output[idx] = [float(properties[band]) for band in ALPHAEARTH_BANDS]
            except KeyError:
                output[idx] = None
        return output

    def alphaearth_tile_url(self, year: int) -> str:
        ee = self._import_ee()
        self._initialize(ee)

        image = self._annual_embedding_image(ee, year)
        visual = image.visualize(
            bands=["A02", "A01", "A00"],
            min=-0.3,
            max=0.3,
            gamma=1.15,
        )
        map_id = visual.getMapId()
        return map_id["tile_fetcher"].url_format

    def similarity_tile_url(
        self,
        prototype_geometry: dict[str, Any],
        year: int,
        bbox: list[float] | None = None,
    ) -> str:
        ee = self._import_ee()
        self._initialize(ee)

        prototype = self.sample_geojson(prototype_geometry, year)
        image = self._annual_embedding_image(ee, year)
        prototype_image = ee.Image.constant(prototype).rename(ALPHAEARTH_BANDS)
        similarity = image.multiply(prototype_image).reduce(ee.Reducer.sum()).rename("similarity")
        if bbox:
            similarity = similarity.clip(self._bbox_to_geometry(ee, bbox))

        visual = similarity.visualize(
            min=0.35,
            max=0.92,
            palette=["1b1b1b", "314d8f", "39a66b", "f4d35e", "f25f5c"],
        )
        map_id = visual.getMapId()
        return map_id["tile_fetcher"].url_format

    def classification_tile_url(
        self,
        training_samples: list[Any],
        year: int,
        bbox: list[float] | None = None,
    ) -> dict[str, Any]:
        ee = self._import_ee()
        self._initialize(ee)

        class_ids = []
        for sample in training_samples:
            if sample.class_id not in class_ids:
                class_ids.append(sample.class_id)
        if len(class_ids) < 2:
            raise ValueError("At least two classes are required for a classification tile.")

        class_values = {class_id: idx for idx, class_id in enumerate(class_ids)}
        features = []
        for sample in training_samples:
            features.append(
                ee.Feature(
                    self._to_ee_geometry(ee, sample.geometry),
                    {
                        "class_value": class_values[sample.class_id],
                        "class_id": sample.class_id,
                    },
                )
            )
        labels = ee.FeatureCollection(features)

        image = self._annual_embedding_image(ee, year)
        training = image.sampleRegions(
            collection=labels,
            properties=["class_value"],
            scale=10,
            geometries=False,
        )
        classifier = ee.Classifier.smileRandomForest(
            numberOfTrees=120,
            minLeafPopulation=1,
        ).train(
            features=training,
            classProperty="class_value",
            inputProperties=ALPHAEARTH_BANDS,
        )
        classified = image.classify(classifier).rename("class")
        if bbox:
            classified = classified.clip(self._bbox_to_geometry(ee, bbox))

        palette = ["217a57", "0d6f7b", "b77b1f", "b54b43", "315c9f", "6a7d39", "8b4f8f"]
        visual = classified.visualize(
            min=0,
            max=max(1, len(class_ids) - 1),
            palette=palette[: len(class_ids)],
        )
        map_id = visual.getMapId()
        return {
            "tile_url": map_id["tile_fetcher"].url_format,
            "legend": [
                {
                    "class_id": class_id,
                    "class_value": class_values[class_id],
                    "color": f"#{palette[class_values[class_id] % len(palette)]}",
                }
                for class_id in class_ids
            ],
        }

    def sentinel2_tile_url(self, year: int) -> str:
        ee = self._import_ee()
        self._initialize(ee)

        image = (
            ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
            .filterDate(f"{year}-01-01", f"{year + 1}-01-01")
            .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 25))
            .median()
            .select(["B4", "B3", "B2"])
        )
        visual = image.visualize(
            bands=["B4", "B3", "B2"],
            min=0,
            max=3000,
            gamma=1.15,
        )
        map_id = visual.getMapId()
        return map_id["tile_fetcher"].url_format

    @staticmethod
    def _annual_embedding_image(ee: Any, year: int) -> Any:
        return (
            ee.ImageCollection(ALPHAEARTH_COLLECTION)
            .filterDate(f"{year}-01-01", f"{year + 1}-01-01")
            .mosaic()
            .select(ALPHAEARTH_BANDS)
        )

    @staticmethod
    def _bbox_to_geometry(ee: Any, bbox: list[float]) -> Any:
        min_lon, min_lat, max_lon, max_lat = bbox
        return ee.Geometry.Rectangle([min_lon, min_lat, max_lon, max_lat], proj="EPSG:4326")

    def _initialize(self, ee: Any) -> None:
        if self._initialized:
            return
        ee.Initialize(project=self.project)
        self._initialized = True

    @staticmethod
    def _import_ee() -> Any:
        import ee

        return ee

    @staticmethod
    def _to_ee_geometry(ee: Any, geometry: dict[str, Any]) -> Any:
        geometry_type = geometry.get("type")
        coordinates = geometry.get("coordinates")

        if geometry_type == "Point":
            return ee.Geometry.Point(coordinates)
        if geometry_type == "Polygon":
            return ee.Geometry.Polygon(coordinates)
        if geometry_type == "MultiPolygon":
            return ee.Geometry.MultiPolygon(coordinates)

        raise ValueError(f"Unsupported geometry type: {geometry_type}")
