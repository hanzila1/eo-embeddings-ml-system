import os


DEFAULT_EARTH_ENGINE_PROJECT = "ee-hanzilabinyounasai"


def get_earth_engine_project() -> str:
    return os.getenv("EARTH_ENGINE_PROJECT", DEFAULT_EARTH_ENGINE_PROJECT)
