from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from uuid import UUID

from app.config import get_database_path
from app.schemas import Project, Sample


class SqliteStore:
    def __init__(self, db_path: Path | None = None) -> None:
        self.db_path = db_path or get_database_path()

    def initialize(self) -> None:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS projects (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    area_geojson TEXT,
                    year INTEGER NOT NULL,
                    embedding_source TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS samples (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                    class_id TEXT NOT NULL,
                    class_name TEXT NOT NULL,
                    geometry TEXT NOT NULL,
                    year INTEGER,
                    vector TEXT,
                    vector_source TEXT,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );

                CREATE INDEX IF NOT EXISTS idx_samples_project_id
                ON samples(project_id);
                """
            )

    def create_project(self, project: Project) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO projects (id, name, area_geojson, year, embedding_source)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    str(project.id),
                    project.name,
                    json.dumps(project.area_geojson) if project.area_geojson else None,
                    project.year,
                    project.embedding_source,
                ),
            )

    def list_projects(self) -> list[Project]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT id, name, area_geojson, year, embedding_source
                FROM projects
                ORDER BY created_at DESC
                """
            ).fetchall()
        return [self._project_from_row(row) for row in rows]

    def get_project(self, project_id: UUID) -> Project | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT id, name, area_geojson, year, embedding_source
                FROM projects
                WHERE id = ?
                """,
                (str(project_id),),
            ).fetchone()
        return self._project_from_row(row) if row else None

    def add_sample(
        self,
        sample: Sample,
        vector: list[float] | None = None,
        vector_source: str | None = None,
    ) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO samples (
                    id,
                    project_id,
                    class_id,
                    class_name,
                    geometry,
                    year,
                    vector,
                    vector_source
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(sample.id),
                    str(sample.project_id),
                    sample.class_id,
                    sample.class_name,
                    json.dumps(sample.geometry),
                    sample.year,
                    json.dumps(vector) if vector else None,
                    vector_source,
                ),
            )

    def list_samples(self, project_id: UUID) -> list[Sample]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT id, project_id, class_id, class_name, geometry, year
                FROM samples
                WHERE project_id = ?
                ORDER BY created_at ASC
                """,
                (str(project_id),),
            ).fetchall()
        return [self._sample_from_row(row) for row in rows]

    def sample_vectors(self, project_id: UUID) -> dict[UUID, list[float]]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT id, vector
                FROM samples
                WHERE project_id = ? AND vector IS NOT NULL
                """,
                (str(project_id),),
            ).fetchall()
        vectors: dict[UUID, list[float]] = {}
        for row in rows:
            vectors[UUID(row["id"])] = [float(value) for value in json.loads(row["vector"])]
        return vectors

    def counts(self) -> dict[str, int]:
        with self._connect() as connection:
            project_count = connection.execute("SELECT COUNT(*) FROM projects").fetchone()[0]
            sample_count = connection.execute("SELECT COUNT(*) FROM samples").fetchone()[0]
        return {"projects": int(project_count), "samples": int(sample_count)}

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.db_path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    @staticmethod
    def _project_from_row(row: sqlite3.Row) -> Project:
        area_geojson = json.loads(row["area_geojson"]) if row["area_geojson"] else None
        return Project(
            id=UUID(row["id"]),
            name=row["name"],
            area_geojson=area_geojson,
            year=row["year"],
            embedding_source=row["embedding_source"],
        )

    @staticmethod
    def _sample_from_row(row: sqlite3.Row) -> Sample:
        return Sample(
            id=UUID(row["id"]),
            project_id=UUID(row["project_id"]),
            class_id=row["class_id"],
            class_name=row["class_name"],
            geometry=json.loads(row["geometry"]),
            year=row["year"],
        )
