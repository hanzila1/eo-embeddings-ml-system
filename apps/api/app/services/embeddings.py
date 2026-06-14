from __future__ import annotations

from dataclasses import dataclass


ALPHAEARTH_COLLECTION = "GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL"
ALPHAEARTH_BANDS = [f"A{i:02d}" for i in range(64)]


@dataclass(frozen=True)
class EmbeddingSource:
    collection_id: str = ALPHAEARTH_COLLECTION
    bands: tuple[str, ...] = tuple(ALPHAEARTH_BANDS)
    native_scale_m: int = 10


class EmbeddingSampler:
    """Boundary for Earth Engine or local embedding extraction.

    The MVP web app uses mock vectors. This class defines the API boundary that
    will become real Earth Engine sampling without changing route handlers.
    """

    def __init__(self, source: EmbeddingSource | None = None) -> None:
        self.source = source or EmbeddingSource()

    def describe(self) -> dict[str, object]:
        return {
            "collection_id": self.source.collection_id,
            "band_count": len(self.source.bands),
            "bands": list(self.source.bands),
            "native_scale_m": self.source.native_scale_m,
        }

    def sample_geojson(self, geometry: dict, year: int) -> list[float]:
        """Return a deterministic placeholder vector until Earth Engine is wired."""
        seed = f"{year}:{geometry}".encode("utf-8")
        values = [((seed[i % len(seed)] / 255.0) * 2.0) - 1.0 for i in range(64)]
        magnitude = sum(v * v for v in values) ** 0.5 or 1.0
        return [v / magnitude for v in values]
