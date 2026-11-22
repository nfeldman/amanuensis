"""Amanuensis materializer package.

Renders human-facing architectural documentation from a conspectus
memory.db. It opens no prose file in the storage directory.
"""
from .core import Materializer
from .renderers import PLACEHOLDER_SENTENCES

__all__ = ["PLACEHOLDER_SENTENCES", "Materializer"]
