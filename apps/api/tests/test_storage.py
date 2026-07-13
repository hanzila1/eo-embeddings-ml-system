import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4

from app.schemas import Project
from app.storage import SqliteStore


class ProjectStorageTests(unittest.TestCase):
    def test_project_name_update_is_persisted(self) -> None:
        with TemporaryDirectory() as directory:
            store = SqliteStore(Path(directory) / "test.sqlite")
            store.initialize()
            project = Project(id=uuid4(), name="Initial analysis")
            store.create_project(project)

            updated = store.update_project_name(project.id, "Indus crop analysis")

            self.assertIsNotNone(updated)
            self.assertEqual(updated.name, "Indus crop analysis")
            self.assertEqual(store.get_project(project.id).name, "Indus crop analysis")

    def test_project_name_update_returns_none_for_unknown_project(self) -> None:
        with TemporaryDirectory() as directory:
            store = SqliteStore(Path(directory) / "test.sqlite")
            store.initialize()

            self.assertIsNone(store.update_project_name(uuid4(), "Missing project"))


if __name__ == "__main__":
    unittest.main()
