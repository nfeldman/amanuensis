"""Lints over generated orientation prose (spec §11.1).

The overview's thesis carries no freshness or status vocabulary, because that
vocabulary makes a claim the prose cannot keep current: a sentence saying the
survey is up to date is true only until the next commit, and nothing
re-examines it. The numbers that *can* be kept current are rendered from
records beside it, so the prose does not need to carry them.

A bare word-boundary match over the forbidden terms is too coarse to ship.
`\\bmapped\\b` matches inside *memory-mapped*, because `-` is a word boundary,
and `\\bstale\\b` matches *a stale cache is invalidated by…* — a correct
technical sentence about the subject matter, not a claim about the survey. The
rule is about survey-status assertions, so the match is shaped like one:

1. an occurrence is *cleared* when it is not immediately preceded by a hyphen
   or a backtick and does not sit inside a code span or a fenced block, which
   alone clears *memory-mapped* and every quoted enum value;
2. a cleared occurrence is a violation only as the complement of a copula whose
   subject is the project, the codebase, the conspectus, the survey, the
   documentation, or a subsystem id — which catches *the conspectus is fully
   surveyed* while leaving *a stale cache* alone;
3. a count fraction is a violation unconditionally: a fraction in orientation
   prose is always a number that will go out of date.

The terms come from `conspectus-vocabulary.json` through the generated
`vocabulary` module, so the lint and the reader's guide cannot disagree about
what counts as status vocabulary (§10).
"""

from __future__ import annotations

import re

from .vocabulary import ORIENTATION_FORBIDDEN_TERMS

# The subjects a survey-status assertion is made *about*. A sentence whose
# subject is part of the codebase under survey — a cache, a region, a B-tree —
# is not one of these, which is what keeps the technical register usable.
_SUBJECT = (
    r"(?:this\s+(?:codebase|project)"
    r"|the\s+(?:conspectus|survey|documentation)"
    r"|[A-Za-z]-\d+)"
)
_COPULA = r"(?:is|are|was|were|remains?)"

# A fraction is two counts with a slash between them; both will move.
_FRACTION = re.compile(r"\b\d+\s*/\s*\d+\b")

# Fenced blocks first, then code spans: quoting a forbidden term is how the
# reader's guide and the enum tables talk about it at all.
_FENCED = re.compile(
    r"(?ms)^[ \t]*(?P<fence>```+|~~~+)[^\n]*\n.*?(?:^[ \t]*(?P=fence)[^\n]*$|\Z)"
)
_CODE_SPAN = re.compile(r"`+[^`\n]*`+")


def _mask(match: re.Match[str]) -> str:
    """Blank a span while preserving its length, so offsets stay faithful."""
    return re.sub(r"[^\n]", "#", match.group(0))


def _masked(text: str) -> str:
    return _CODE_SPAN.sub(_mask, _FENCED.sub(_mask, text))


def _assertion(term: str) -> re.Pattern[str]:
    """A survey-status assertion whose complement is this term."""
    return re.compile(
        rf"\b{_SUBJECT}\s+{_COPULA}\b[^.]{{0,40}}?(?<![-`\w]){re.escape(term)}\b",
        re.IGNORECASE,
    )


_ASSERTIONS: tuple[tuple[str, re.Pattern[str]], ...] = tuple(
    (term, _assertion(term)) for term in ORIENTATION_FORBIDDEN_TERMS
)


def _excerpt(text: str, start: int, end: int, width: int = 72) -> str:
    """The matched span, trimmed to a readable length on one line."""
    span = " ".join(text[start:end].split())
    if len(span) <= width:
        return span
    return span[: width - 1] + "…"


def orientation_violations(text: str | None) -> list[str]:
    """Every reason this prose may not be published as orientation (§11.1).

    Each entry names what the sentence asserts and quotes the span that asserts
    it, so the warning the materializer prints tells the author what to change.
    An empty list means the prose carries no survey-status claim and no count.
    """

    if not text:
        return []
    masked = _masked(text)
    found: list[tuple[int, str]] = []
    for term, pattern in _ASSERTIONS:
        for match in pattern.finditer(masked):
            found.append(
                (
                    match.start(),
                    f'asserts "{term}" of the record: "'
                    f'{_excerpt(text, match.start(), match.end())}"',
                )
            )
    for match in _FRACTION.finditer(text):
        found.append(
            (
                match.start(),
                f'carries the count fraction "{match.group(0)}", '
                "which the prose cannot keep current",
            )
        )
    seen: set[str] = set()
    violations: list[str] = []
    for _position, violation in sorted(found, key=lambda item: item[0]):
        if violation in seen:
            continue
        seen.add(violation)
        violations.append(violation)
    return violations
