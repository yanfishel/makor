"""Typed failures the pipeline raises. `app/main.py` maps them to HTTP codes."""


class ConfigurationError(RuntimeError):
    pass


class ExtractionError(RuntimeError):
    """Upstream (local or remote) model failure."""
