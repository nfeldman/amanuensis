"""Amanuensis materializer package.

Renders human-facing architectural documentation from a conspectus
memory.db and the project's prose artifacts.
"""
from .core import Materializer
from .renderers import PLACEHOLDER_SENTENCES

__all__ = ["PLACEHOLDER_SENTENCES", "Materializer"]
