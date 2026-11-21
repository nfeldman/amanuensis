"""The page model the HTML writer prints (store-only PLAN §3.1).

A page is a title and a sequence of blocks; a section is a block that holds
blocks. Every shape a page can print is a block kind here, built by a renderer
(or, for an imported body, by `legacy_prose.py`), so `write_html` lays out what a
block already says and reads no Markdown.

Inline content is a tuple of inline nodes and the plain text a reader sees in
it. The plain text is what labels, slugs, captions and the SVG drawings use;
the nodes are what the writer prints.

A few fields still carry what a Markdown source said rather than what a record
says: `RecordMarker.raw` is the marker comment as written, and `Tag` is an
emphasis mark an imported body left misnested, which the writer prints as it stood.
"""

from __future__ import annotations

from dataclasses import dataclass

from .vocabulary import DISPOSITION_CLASSIFICATIONS, labels

# ---------------------------------------------------------------------------
# Inlines.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Text:
    text: str


@dataclass(frozen=True)
class CodeSpan:
    """Literal code. (`Code` is the fenced block.)"""

    text: str


@dataclass(frozen=True)
class Chip:
    """A stored enum value printed as its label: `status`, `severity` or `evidence`."""

    enum: str
    value: str
    show_hint: bool = True


@dataclass(frozen=True)
class Abbr:
    text: str
    title: str


@dataclass(frozen=True)
class Emph:
    children: tuple[Inline, ...]


@dataclass(frozen=True)
class Strong:
    children: tuple[Inline, ...]


@dataclass(frozen=True)
class Link:
    """`label` is the link's plain text; `children`, when present, are what prints for it."""

    href: str
    label: str
    external: bool = False
    children: tuple[Inline, ...] = ()

    def __repr__(self) -> str:
        # A plain label's link reads as it did before it could hold children.
        rich = f", children={self.children!r}" if self.children else ""
        return f"Link(href={self.href!r}, label={self.label!r}, external={self.external!r}{rich})"


@dataclass(frozen=True)
class InlineAnchor:
    id: str


@dataclass(frozen=True)
class InlineMarker:
    raw: str


@dataclass(frozen=True)
class Break:
    pass


@dataclass(frozen=True)
class Tag:
    """One emphasis mark of a misnested pair (`strong` or `em`)."""

    name: str
    closing: bool


Inline = Text | CodeSpan | Chip | Abbr | Emph | Strong | Link | InlineAnchor | InlineMarker | Break | Tag


@dataclass(frozen=True)
class Inlines:
    nodes: tuple[Inline, ...]
    plain: str = ""


EMPTY = Inlines(())

# ---------------------------------------------------------------------------
# Blocks.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Heading:
    level: int
    text: Inlines
    # A subsystem heading on the two finding pages: it defines the IDs under it.
    finding_group: bool = False


@dataclass(frozen=True)
class Paragraph:
    text: Inlines


@dataclass(frozen=True)
class ListItem:
    text: Inlines
    children: tuple[List, ...] = ()


@dataclass(frozen=True)
class List:
    ordered: bool
    items: tuple[ListItem, ...]


@dataclass(frozen=True)
class Code:
    language: str
    source: str


@dataclass(frozen=True)
class Quote:
    text: Inlines


@dataclass(frozen=True)
class Anchor:
    id: str


@dataclass(frozen=True)
class RecordMarker:
    raw: str


@dataclass(frozen=True)
class Section:
    slug: str
    blocks: tuple[Block, ...]


@dataclass(frozen=True)
class Details:
    """A disclosure: the guide's full vocabulary stays closed until asked for."""

    summary: str
    blocks: tuple[Block, ...]
    css_class: str = "vocabulary-disclosure"


@dataclass(frozen=True)
class RowFilter:
    """The facet values one filterable row carries (§8.1.2)."""

    subsystem: str
    severity: str


@dataclass(frozen=True)
class Row:
    cells: tuple[Inlines, ...]
    markers: tuple[str, ...] = ()
    filter: RowFilter | None = None


@dataclass(frozen=True)
class Table:
    caption: str
    headers: tuple[Inlines, ...]
    rows: tuple[Row, ...]


@dataclass(frozen=True)
class EnumTable:
    """The guide's enum tables: the Value column is the stored value, printed literally."""

    caption: str
    headers: tuple[Inlines, ...]
    rows: tuple[Row, ...]


@dataclass(frozen=True)
class LifecycleTable:
    """State containers: the location prints under the name, not in a column."""

    caption: str
    headers: tuple[Inlines, ...]
    rows: tuple[Row, ...]


@dataclass(frozen=True)
class Fact:
    key: str
    value: Inlines


@dataclass(frozen=True)
class Record:
    """One row of a record table, as the record list prints it."""

    markers: tuple[str, ...]
    key: Inlines
    key_text: str
    # The plain text the record's heading ID is made from.
    slug_text: str
    facts: tuple[Fact, ...]
    # Content fields with something to print, in order. A finding's are its
    # observed behavior, why it matters and root cause, under its lede.
    fields: tuple[Fact, ...]
    lede: Inlines | None = None
    # A file-ledger record's path and revision, for its source link.
    path: str = ""
    revision: str = ""
    subsystem_id: str = ""
    filter: RowFilter | None = None


@dataclass(frozen=True)
class RecordList:
    kind: str
    caption: str
    records: tuple[Record, ...]


@dataclass(frozen=True)
class SummaryItem:
    key: Inlines
    value: Inlines
    markers: tuple[str, ...] = ()


@dataclass(frozen=True)
class SummaryList:
    caption: str
    items: tuple[SummaryItem, ...]


@dataclass(frozen=True)
class AtlasItem:
    subsystem: Inlines
    depth: Inlines
    markers: tuple[str, ...] = ()


@dataclass(frozen=True)
class AtlasRegion:
    name: str
    items: tuple[AtlasItem, ...]


@dataclass(frozen=True)
class Atlas:
    caption: str
    regions: tuple[AtlasRegion, ...]


@dataclass(frozen=True)
class TopologyEdge:
    key: Inlines
    left_id: str
    left: Inlines
    right_id: str
    right: Inlines
    detail: Inlines
    qualifier: Inlines
    directed: bool
    markers: tuple[str, ...] = ()


@dataclass(frozen=True)
class Topology:
    kind: str  # "dependency" or "seam"
    caption: str
    edges: tuple[TopologyEdge, ...]


@dataclass(frozen=True)
class RuntimeRow:
    source: Inlines
    language: Inlines
    target: Inlines
    mechanism: Inlines
    note: Inlines
    markers: tuple[str, ...] = ()


@dataclass(frozen=True)
class RuntimeDiagram:
    caption: str
    rows: tuple[RuntimeRow, ...]


@dataclass(frozen=True)
class BoundaryRow:
    layer: str
    subsystem_id: str
    name: str
    # Empty when the row names no other end.
    other_id: str = ""
    relation: str = ""
    # Whether the boundary cell links to a seam, and the seam it names.
    seam: bool = False
    seam_id: str = ""


@dataclass(frozen=True)
class BoundaryDiagram:
    caption: str
    rows: tuple[BoundaryRow, ...]


# The mark a coverage cell prints for each concern review verdict; the presentation
# glyph is the projection's own, the key and label are the vocabulary contract's.
_COVERAGE_MARKS = {
    "confirmed-bug": "!",
    "confirmed-acceptable": "✓",
    "ruled-out": "×",
    "out-of-scope": "○",
    "unresolved-competition": "?",
}
_VERDICT_LABELS = labels("disposition_classification")

# The outcomes a coverage cell records: key, label, mark. Order is the contract's, and the legend's.
COVERAGE_STATES: tuple[tuple[str, str, str], ...] = tuple(
    (key, _VERDICT_LABELS[key], _COVERAGE_MARKS[key]) for key in DISPOSITION_CLASSIFICATIONS
)


@dataclass(frozen=True)
class CoverageReview:
    code: str
    key: str
    label: str
    mark: str
    linchpin: bool


@dataclass(frozen=True)
class CoverageRow:
    subsystem_id: str
    name: str
    # The link the row's own cell carries, already an HTML href; None when the
    # cell has no link and the writer routes the ID.
    href: str | None
    reviews: tuple[CoverageReview, ...]
    markers: tuple[str, ...] = ()


@dataclass(frozen=True)
class CoverageIndex:
    codes: tuple[str, ...]
    rows: tuple[CoverageRow, ...]


@dataclass(frozen=True)
class ConcernItem:
    code: Inlines
    code_text: str
    slug_text: str
    primary_subsystems: Inlines
    probe: Inlines
    markers: tuple[str, ...] = ()


@dataclass(frozen=True)
class ConcernFamily:
    name: str
    territory: str
    slug_text: str
    items: tuple[ConcernItem, ...]


@dataclass(frozen=True)
class ConcernChecklist:
    caption: str
    families: tuple[ConcernFamily, ...]


@dataclass(frozen=True)
class TraceNode:
    record_id: str
    name: str


@dataclass(frozen=True)
class TraceEdge:
    left: TraceNode
    right: TraceNode
    label: str
    two_way: bool


@dataclass(frozen=True)
class RelationshipTrace:
    edges: tuple[TraceEdge, ...]


@dataclass(frozen=True)
class StalenessBars:
    values: tuple[tuple[str, float], ...]


@dataclass(frozen=True)
class DiagramSource:
    """A Mermaid fence no hook draws, printed as its source."""

    source: str


@dataclass(frozen=True)
class Facets:
    """A filterable page's scope and the values each facet takes, in first-appearance order."""

    scope: str
    values: tuple[tuple[str, tuple[str, ...]], ...] = ()


Block = (
    Heading | Paragraph | List | Code | Quote | Anchor | RecordMarker | Section | Details
    | Table | EnumTable | LifecycleTable | RecordList | SummaryList | Atlas | Topology
    | RuntimeDiagram | BoundaryDiagram | CoverageIndex | ConcernChecklist
    | RelationshipTrace | StalenessBars | DiagramSource
)


@dataclass(frozen=True)
class Page:
    title: str
    # The page's HTML path, which links and page-specific layout are relative to.
    path: str
    blocks: tuple[Block, ...]
    facets: Facets | None = None
