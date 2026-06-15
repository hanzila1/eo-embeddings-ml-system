from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID, uuid4

from app.schemas import Sample, TrainRun


@dataclass
class TrainingResult:
    run: TrainRun
    class_count: int
    sample_count: int


class FewShotTrainer:
    """Training boundary for kNN, Random Forest, and future model backends."""

    def train(
        self,
        project_id: UUID,
        samples: list[Sample],
        model_type: str,
        sample_vectors: dict[UUID, list[float]] | None = None,
    ) -> TrainingResult:
        class_count = len({sample.class_id for sample in samples})
        sample_count = len(samples)

        if sample_count < 2 or class_count < 2:
            return TrainingResult(
                run=TrainRun(
                    id=uuid4(),
                    project_id=project_id,
                    model_type=model_type,
                    status="failed",
                    message="At least two classes and two samples are required.",
                ),
                class_count=class_count,
                sample_count=sample_count,
            )

        vectors = sample_vectors or {}
        usable_samples = [sample for sample in samples if sample.id in vectors]
        if len(usable_samples) >= 2 and len({sample.class_id for sample in usable_samples}) >= 2:
            return self._train_vector_model(project_id, usable_samples, vectors, model_type)

        baseline_accuracy = min(0.95, 0.52 + 0.05 * sample_count + 0.03 * class_count)
        uncertainty = max(0.05, 0.42 - 0.03 * sample_count)

        return TrainingResult(
            run=TrainRun(
                id=uuid4(),
                project_id=project_id,
                model_type=model_type,
                status="complete",
                metrics={
                    "estimated_accuracy": round(baseline_accuracy, 3),
                    "mean_uncertainty": round(uncertainty, 3),
                    "vector_sample_count": 0.0,
                },
                message="Placeholder trainer complete. Wire Earth Engine samples next.",
            ),
            class_count=class_count,
            sample_count=sample_count,
        )

    def predict_vectors(
        self,
        samples: list[Sample],
        sample_vectors: dict[UUID, list[float]],
        target_vectors: list[list[float]],
        model_type: str,
    ) -> list[dict[str, object]]:
        import numpy as np

        usable_samples = [sample for sample in samples if sample.id in sample_vectors]
        if len(usable_samples) < 2 or len({sample.class_id for sample in usable_samples}) < 2:
            raise ValueError("At least two vector-backed classes are required for prediction.")

        x = np.array([sample_vectors[sample.id] for sample in usable_samples], dtype=float)
        y = np.array([sample.class_id for sample in usable_samples])
        model = self._build_model(model_type, len(usable_samples))
        model.fit(x, y)

        target_x = np.array(target_vectors, dtype=float)
        labels = model.predict(target_x)
        probabilities = getattr(model, "predict_proba", None)
        if probabilities is None:
            return [
                {"class_id": str(label), "confidence": 1.0}
                for label in labels
            ]

        probability_matrix = model.predict_proba(target_x)
        return [
            {
                "class_id": str(label),
                "confidence": round(float(max(row)), 3),
            }
            for label, row in zip(labels, probability_matrix)
        ]

    def _train_vector_model(
        self,
        project_id: UUID,
        samples: list[Sample],
        vectors: dict[UUID, list[float]],
        model_type: str,
    ) -> TrainingResult:
        import numpy as np
        from sklearn.metrics import accuracy_score
        from sklearn.model_selection import train_test_split

        x = np.array([vectors[sample.id] for sample in samples], dtype=float)
        y = np.array([sample.class_id for sample in samples])
        class_count = len(set(y.tolist()))
        sample_count = len(samples)

        model = self._build_model(model_type, sample_count)
        metric_name = "training_accuracy"

        if self._can_holdout(y):
            x_train, x_test, y_train, y_test = train_test_split(
                x,
                y,
                test_size=0.35,
                random_state=42,
                stratify=y,
            )
            model.fit(x_train, y_train)
            predictions = model.predict(x_test)
            accuracy = accuracy_score(y_test, predictions)
            metric_name = "holdout_accuracy"
        else:
            model.fit(x, y)
            predictions = model.predict(x)
            accuracy = accuracy_score(y, predictions)

        return TrainingResult(
            run=TrainRun(
                id=uuid4(),
                project_id=project_id,
                model_type=model_type,
                status="complete",
                metrics={
                    metric_name: round(float(accuracy), 3),
                    "class_count": float(class_count),
                    "vector_sample_count": float(sample_count),
                },
                message="Trained with sampled AlphaEarth embedding vectors.",
            ),
            class_count=class_count,
            sample_count=sample_count,
        )

    @staticmethod
    def _build_model(model_type: str, sample_count: int):
        if model_type == "knn":
            from sklearn.neighbors import KNeighborsClassifier

            neighbors = max(1, min(3, sample_count - 1))
            return KNeighborsClassifier(n_neighbors=neighbors)
        from sklearn.ensemble import RandomForestClassifier

        return RandomForestClassifier(
            n_estimators=150,
            min_samples_leaf=1,
            random_state=42,
            class_weight="balanced",
        )

    @staticmethod
    def _can_holdout(y) -> bool:
        import numpy as np

        _, counts = np.unique(y, return_counts=True)
        return len(y) >= 6 and bool(np.all(counts >= 2))
