"""Fixture for the code-index extractor: every Python row of PLAN §4.2."""
import os
from .util import helper as h

LIMIT = 10
ratio: float = 0.5
a, b = 1, 2


# Greets someone.
def greet(name):
    """Say hello."""
    def shout(text):
        return text.upper()
    return shout("hello " + name)


async def fetch(url):
    return await h(url)


@dataclass
class Point:
    """A point."""

    x: int = 0

    def norm(self):
        return (self.x ** 2) ** 0.5

    @property
    def double(self):
        return self.x * 2

    async def refresh(self):
        return os.getcwd()


if os.name == "nt":
    def sep():
        return "\\"
else:
    def sep():
        return "/"
