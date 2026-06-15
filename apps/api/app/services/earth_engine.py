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

        image = (
            ee.ImageCollection(ALPHAEARTH_COLLECTION)
            .filterDate(f"{year}-01-01", f"{year + 1}-01-01")
            .mosaic()
            .select(ALPHAEARTH_BANDS)
        )
        visual = image.visualize(
            bands=["A02", "A01", "A00"],
            min=-0.3,
            max=0.3,
            gamma=1.15,
        )
        map_id = visual.getMapId()
        return map_id["tile_fetcher"].url_format

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
