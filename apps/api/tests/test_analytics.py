import unittest

from pydantic import ValidationError

from app.schemas import ChangeAnalysisRequest, ClassificationTileRequest, TemporalProfileRequest
from app.services.earth_engine import EarthEngineEmbeddingSampler


class AnalyticsSchemaTests(unittest.TestCase):
    def test_change_analysis_requires_a_bbox(self) -> None:
        with self.assertRaises(ValidationError):
            ChangeAnalysisRequest(start_year=2020, end_year=2024)

    def test_change_analysis_bounds_threshold_and_hotspots(self) -> None:
        request = ChangeAnalysisRequest(
            bbox=[68.2, 25.3, 68.4, 25.5],
            start_year=2020,
            end_year=2024,
            threshold=0.2,
            hotspot_grid=7,
            hotspot_limit=10,
        )
        self.assertEqual(request.hotspot_grid, 7)
        self.assertEqual(request.hotspot_limit, 10)
        with self.assertRaises(ValidationError):
            ChangeAnalysisRequest(
                bbox=[68.2, 25.3, 68.4, 25.5],
                threshold=0.9,
            )

    def test_temporal_profile_years_and_classification_defaults(self) -> None:
        profile = TemporalProfileRequest(
            geometry={"type": "Point", "coordinates": [68.25, 25.35]},
        )
        classification = ClassificationTileRequest(bbox=[68.2, 25.3, 68.4, 25.5])
        self.assertEqual(profile.start_year, 2017)
        self.assertEqual(profile.end_year, 2024)
        self.assertTrue(classification.include_analysis)


class EarthEngineHelperTests(unittest.TestCase):
    def test_cosine_similarity(self) -> None:
        self.assertAlmostEqual(
            EarthEngineEmbeddingSampler._cosine_similarity([1.0, 0.0], [1.0, 0.0]),
            1.0,
        )
        self.assertAlmostEqual(
            EarthEngineEmbeddingSampler._cosine_similarity([1.0, 0.0], [0.0, 1.0]),
            0.0,
        )

    def test_analysis_scale_is_bounded_and_grows_with_area(self) -> None:
        local_scale = EarthEngineEmbeddingSampler._analysis_scale([68.2, 25.3, 68.21, 25.31])
        regional_scale = EarthEngineEmbeddingSampler._analysis_scale([60.0, 20.0, 75.0, 35.0])
        self.assertEqual(local_scale, 30.0)
        self.assertGreater(regional_scale, local_scale)
        self.assertLessEqual(regional_scale, 1_000.0)


if __name__ == "__main__":
    unittest.main()
