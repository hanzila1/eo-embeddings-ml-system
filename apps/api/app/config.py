import os
from pathlib import Path


DEFAULT_EARTH_ENGINE_PROJECT = "ee-hanzilabinyounasai"
DEFAULT_DATA_DIR = Path(__file__).resolve().parents[1] / "data"


def get_earth_engine_project() -> str:
    return os.getenv("EARTH_ENGINE_PROJECT", DEFAULT_EARTH_ENGINE_PROJECT)


def get_data_dir() -> Path:
    return Path(os.getenv("EO_MAPPER_DATA_DIR", DEFAULT_DATA_DIR)).resolve()


def get_database_path() -> Path:
    return get_data_dir() / "eo_mapper.sqlite"
