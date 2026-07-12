from __future__ import annotations

from dataclasses import dataclass
from math import cos, pi, sqrt
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
        include_analysis: bool = True,
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
            seed=42,
        ).train(
            features=training,
            classProperty="class_value",
            inputProperties=ALPHAEARTH_BANDS,
        )
        classified = image.classify(classifier).rename("class")
        confidence = image.classify(classifier.setOutputMode("PROBABILITY")).rename("confidence")
        region = self._bbox_to_geometry(ee, bbox) if bbox else None
        if bbox:
            classified = classified.clip(region)
            confidence = confidence.clip(region)

        palette = ["217a57", "0d6f7b", "b77b1f", "b54b43", "315c9f", "6a7d39", "8b4f8f"]
        visual = classified.visualize(
            min=0,
            max=max(1, len(class_ids) - 1),
            palette=palette[: len(class_ids)],
        )
        map_id = visual.getMapId()
        confidence_map_id = confidence.visualize(
            min=0.35,
            max=1.0,
            palette=["b23a48", "f4d35e", "1f7a57"],
        ).getMapId()
        result = {
            "tile_url": map_id["tile_fetcher"].url_format,
            "confidence_tile_url": confidence_map_id["tile_fetcher"].url_format,
            "legend": [
                {
                    "class_id": class_id,
                    "class_value": class_values[class_id],
                    "color": f"#{palette[class_values[class_id] % len(palette)]}",
                }
                for class_id in class_ids
            ],
        }
        if include_analysis and bbox and region:
            result["analysis"] = self._classification_analysis(
                ee=ee,
                classified=classified,
                confidence=confidence,
                region=region,
                bbox=bbox,
                class_ids=class_ids,
            )
        return result

    def change_tile_url(
        self,
        start_year: int,
        end_year: int,
        bbox: list[float] | None = None,
    ) -> str:
        ee = self._import_ee()
        self._initialize(ee)

        change = self._embedding_change_image(ee, start_year, end_year)
        if bbox:
            change = change.clip(self._bbox_to_geometry(ee, bbox))

        visual = change.visualize(
            min=0.02,
            max=0.38,
            palette=["102820", "1f7a57", "f4d35e", "f28c38", "b23a48"],
        )
        map_id = visual.getMapId()
        return map_id["tile_fetcher"].url_format

    def change_analysis(
        self,
        start_year: int,
        end_year: int,
        bbox: list[float],
        threshold: float = 0.18,
        hotspot_grid: int = 6,
        hotspot_limit: int = 8,
    ) -> dict[str, Any]:
        ee = self._import_ee()
        self._initialize(ee)

        region = self._bbox_to_geometry(ee, bbox)
        change = self._embedding_change_image(ee, start_year, end_year).clip(region)
        scale = self._analysis_scale(bbox)
        change_map_id = change.visualize(
            min=0.02,
            max=0.38,
            palette=["102820", "1f7a57", "f4d35e", "f28c38", "b23a48"],
        ).getMapId()
        reducer = (
            ee.Reducer.mean()
            .combine(reducer2=ee.Reducer.stdDev(), sharedInputs=True)
            .combine(reducer2=ee.Reducer.percentile([50, 90, 95]), sharedInputs=True)
        )
        statistics = change.reduceRegion(
            reducer=reducer,
            geometry=region,
            scale=scale,
            bestEffort=True,
            maxPixels=50_000_000,
            tileScale=4,
        )
        changed_area = (
            ee.Image.pixelArea()
            .divide(1_000_000)
            .rename("area_km2")
            .updateMask(change.gte(threshold))
            .reduceRegion(
                reducer=ee.Reducer.sum(),
                geometry=region,
                scale=scale,
                bestEffort=True,
                maxPixels=50_000_000,
                tileScale=4,
            )
        )
        summary = ee.Dictionary(
            {
                "statistics": statistics,
                "changed_area": changed_area,
                "aoi_area_km2": region.area(maxError=10).divide(1_000_000),
            }
        ).getInfo()

        grid = self._grid_feature_collection(ee, bbox, hotspot_grid)
        grid_result = change.reduceRegions(
            collection=grid,
            reducer=ee.Reducer.mean(),
            scale=scale,
            tileScale=4,
            maxPixelsPerRegion=250_000,
        ).getInfo()
        ranked = []
        for feature in grid_result.get("features", []):
            value = feature.get("properties", {}).get("mean")
            if value is None:
                continue
            ranked.append((float(value), feature))
        ranked.sort(key=lambda item: item[0], reverse=True)

        hotspot_features = []
        for rank, (score, feature) in enumerate(ranked[:hotspot_limit], start=1):
            severity = "critical" if score >= threshold * 1.5 else "high" if score >= threshold else "watch"
            hotspot_features.append(
                {
                    "type": "Feature",
                    "geometry": feature["geometry"],
                    "properties": {
                        "rank": rank,
                        "score": round(score, 4),
                        "severity": severity,
                    },
                }
            )

        raw_stats = summary.get("statistics") or {}
        changed_km2 = float((summary.get("changed_area") or {}).get("area_km2") or 0.0)
        aoi_area_km2 = float(summary.get("aoi_area_km2") or 0.0)
        return {
            "tile_url": change_map_id["tile_fetcher"].url_format,
            "start_year": start_year,
            "end_year": end_year,
            "threshold": threshold,
            "analysis_scale_m": round(scale, 1),
            "aoi_area_km2": round(aoi_area_km2, 2),
            "changed_area_km2": round(changed_km2, 2),
            "changed_area_percent": round((changed_km2 / aoi_area_km2) * 100, 2)
            if aoi_area_km2
            else 0.0,
            "mean_change": round(float(raw_stats.get("embedding_change_mean") or 0.0), 4),
            "median_change": round(float(raw_stats.get("embedding_change_p50") or 0.0), 4),
            "p90_change": round(float(raw_stats.get("embedding_change_p90") or 0.0), 4),
            "p95_change": round(float(raw_stats.get("embedding_change_p95") or 0.0), 4),
            "std_change": round(float(raw_stats.get("embedding_change_stdDev") or 0.0), 4),
            "hotspots": {"type": "FeatureCollection", "features": hotspot_features},
        }

    def temporal_profile(
        self,
        geometry: dict[str, Any],
        start_year: int = 2017,
        end_year: int = 2024,
    ) -> list[dict[str, float | int]]:
        ee = self._import_ee()
        self._initialize(ee)

        point = self._to_ee_geometry(ee, geometry)
        sample_region = point.buffer(10)
        features = []
        for year in range(start_year, end_year + 1):
            vector = self._annual_embedding_image(ee, year).reduceRegion(
                reducer=ee.Reducer.mean(),
                geometry=sample_region,
                scale=10,
                bestEffort=True,
                maxPixels=100,
            )
            features.append(ee.Feature(None, vector).set("year", year))

        sampled = ee.FeatureCollection(features).getInfo().get("features", [])
        vectors: dict[int, list[float]] = {}
        for feature in sampled:
            properties = feature.get("properties", {})
            year = int(properties.get("year"))
            if all(properties.get(band) is not None for band in ALPHAEARTH_BANDS):
                vectors[year] = [float(properties[band]) for band in ALPHAEARTH_BANDS]

        if end_year not in vectors:
            raise ValueError(f"No AlphaEarth embedding returned for {end_year} at this location.")
        reference = vectors[end_year]
        series = []
        for year in range(start_year, end_year + 1):
            vector = vectors.get(year)
            if not vector:
                continue
            similarity = self._cosine_similarity(vector, reference)
            series.append(
                {
                    "year": year,
                    "similarity_to_latest": round(similarity, 4),
                    "embedding_drift": round(max(0.0, 1.0 - similarity), 4),
                }
            )
        return series

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

    @classmethod
    def _embedding_change_image(cls, ee: Any, start_year: int, end_year: int) -> Any:
        start_image = cls._annual_embedding_image(ee, start_year)
        end_image = cls._annual_embedding_image(ee, end_year)
        similarity = start_image.multiply(end_image).reduce(ee.Reducer.sum())
        return ee.Image(1).subtract(similarity).rename("embedding_change")

    def _classification_analysis(
        self,
        ee: Any,
        classified: Any,
        confidence: Any,
        region: Any,
        bbox: list[float],
        class_ids: list[str],
    ) -> dict[str, Any]:
        scale = self._analysis_scale(bbox)
        grouped_area = (
            ee.Image.pixelArea()
            .divide(1_000_000)
            .rename("area_km2")
            .addBands(classified.toInt())
            .reduceRegion(
                reducer=ee.Reducer.sum().group(groupField=1, groupName="class_value"),
                geometry=region,
                scale=scale,
                bestEffort=True,
                maxPixels=50_000_000,
                tileScale=4,
            )
            .get("groups")
        )
        confidence_stats = confidence.reduceRegion(
            reducer=ee.Reducer.mean().combine(
                reducer2=ee.Reducer.percentile([10, 50]), sharedInputs=True
            ),
            geometry=region,
            scale=scale,
            bestEffort=True,
            maxPixels=50_000_000,
            tileScale=4,
        )
        uncertain_area = (
            ee.Image.pixelArea()
            .divide(1_000_000)
            .rename("area_km2")
            .updateMask(confidence.lt(0.6))
            .reduceRegion(
                reducer=ee.Reducer.sum(),
                geometry=region,
                scale=scale,
                bestEffort=True,
                maxPixels=50_000_000,
                tileScale=4,
            )
        )
        summary = ee.Dictionary(
            {
                "groups": grouped_area,
                "confidence": confidence_stats,
                "uncertain_area": uncertain_area,
            }
        ).getInfo()

        groups = summary.get("groups") or []
        total_area = sum(float(item.get("sum") or 0.0) for item in groups)
        class_areas = []
        for item in sorted(groups, key=lambda value: int(value.get("class_value", 0))):
            class_value = int(item.get("class_value", 0))
            area_km2 = float(item.get("sum") or 0.0)
            class_id = class_ids[class_value] if class_value < len(class_ids) else str(class_value)
            class_areas.append(
                {
                    "class_id": class_id,
                    "class_value": class_value,
                    "area_km2": round(area_km2, 2),
                    "percent": round((area_km2 / total_area) * 100, 2) if total_area else 0.0,
                }
            )

        confidence_values = summary.get("confidence") or {}
        uncertain_km2 = float((summary.get("uncertain_area") or {}).get("area_km2") or 0.0)
        return {
            "analysis_scale_m": round(scale, 1),
            "mapped_area_km2": round(total_area, 2),
            "mean_confidence": round(float(confidence_values.get("confidence_mean") or 0.0), 4),
            "p10_confidence": round(float(confidence_values.get("confidence_p10") or 0.0), 4),
            "median_confidence": round(float(confidence_values.get("confidence_p50") or 0.0), 4),
            "low_confidence_area_km2": round(uncertain_km2, 2),
            "low_confidence_percent": round((uncertain_km2 / total_area) * 100, 2)
            if total_area
            else 0.0,
            "class_areas": class_areas,
        }

    @staticmethod
    def _analysis_scale(bbox: list[float]) -> float:
        min_lon, min_lat, max_lon, max_lat = bbox
        midpoint = (min_lat + max_lat) / 2
        width_km = abs(max_lon - min_lon) * 111.32 * max(0.18, cos(midpoint * pi / 180))
        height_km = abs(max_lat - min_lat) * 111.32
        area_m2 = max(1.0, width_km * height_km * 1_000_000)
        return max(30.0, min(1_000.0, sqrt(area_m2 / 400_000)))

    @staticmethod
    def _grid_feature_collection(ee: Any, bbox: list[float], size: int) -> Any:
        min_lon, min_lat, max_lon, max_lat = bbox
        lon_step = (max_lon - min_lon) / size
        lat_step = (max_lat - min_lat) / size
        features = []
        for row in range(size):
            for col in range(size):
                west = min_lon + col * lon_step
                east = west + lon_step
                south = min_lat + row * lat_step
                north = south + lat_step
                features.append(
                    ee.Feature(
                        ee.Geometry.Rectangle([west, south, east, north], proj="EPSG:4326"),
                        {"cell_id": f"{row}-{col}"},
                    )
                )
        return ee.FeatureCollection(features)

    @staticmethod
    def _cosine_similarity(left: list[float], right: list[float]) -> float:
        numerator = sum(a * b for a, b in zip(left, right))
        left_norm = sqrt(sum(value * value for value in left)) or 1.0
        right_norm = sqrt(sum(value * value for value in right)) or 1.0
        return numerator / (left_norm * right_norm)

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
