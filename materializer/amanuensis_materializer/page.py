"""The page model the HTML writer prints (store-only PLAN §3.1).

A page is a title and a sequence of blocks; a section is a block that holds
blocks. Every Markdown shape the projection used to recognise while it printed
HTML is a block kind here, resolved once by `html_projection.parse_markdown`, so
`write_html` lays out what a block already says and reads no Markdown.

Inline content is a tuple of inline nodes and the plain text a reader sees in
it. The plain text is what labels, slugs, captions and the SVG drawings use;
the nodes are what the writer prints.

Until the renderers build pages themselves (SO14–SO18) the model is filled from
Markdown, so a few fields still carry what that Markdown said rather than what
a record says: `RecordMarker.raw` is the marker comment as written, and `Tag` is
an emphasis mark the Markdown left misnested, which the parser always printed
as it stood.
"""

from __future__ import annotations

from dataclasses import dataclass

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
    href: str
    label: str
    external: bool = False


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


# The outcomes a coverage cell records: key, label, mark. Order is the legend's.
COVERAGE_STATES: tuple[tuple[str, str, str], ...] = (
    ("confirmed-bug", "Confirmed defect", "!"),
    ("confirmed-acceptable", "Accepted behavior", "✓"),
    ("ruled-out", "Ruled out", "×"),
    ("out-of-scope", "Out of scope", "○"),
    ("unresolved-competition", "Competing explanations", "?"),
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


# Every recognition hook the HTML stage had (§1.2), and the block kind
# `parse_markdown` resolves it to. Table hooks are keyed by the constant in
# `html_projection.py` that holds their header signature.
HOOKS: dict[str, type] = {
    "_SUBSYSTEM_ATLAS_PROJECTION": Atlas,
    "_ENUM_TABLE_PROJECTION": EnumTable,
    "_DEPENDENCY_TOPOLOGY_PROJECTION": Topology,
    "_SEAM_TOPOLOGY_PROJECTION": Topology,
    "_BOUNDARY_PROJECTION": BoundaryDiagram,
    "_RUNTIME_BOUNDARY_PROJECTION": RuntimeDiagram,
    "_CONCERN_CHECKLIST_PROJECTION": ConcernChecklist,
    "_RECORDED_CHECKLIST_PROJECTION": ConcernChecklist,
    "_RECORD_PROJECTIONS": RecordList,
    "_SUMMARY_LIST_PROJECTIONS": SummaryList,
    "_LIFECYCLE_TABLE_PROJECTIONS": LifecycleTable,
    "coverage index (Subsystem and concern-code columns)": CoverageIndex,
    "hot-spot measure table": Table,
    "hot-spot and finding facets": Facets,
    "mermaid graph": RelationshipTrace,
    "mermaid pie showData": StalenessBars,
    "mermaid, any other shape": DiagramSource,
    "table, any other signature": Table,
    "heading": Heading,
    "section (a level-2 heading)": Section,
    "full vocabulary disclosure": Details,
    "paragraph": Paragraph,
    "list": List,
    "fence": Code,
    "blockquote": Quote,
    "anchor line": Anchor,
    "marker comment": RecordMarker,
}
