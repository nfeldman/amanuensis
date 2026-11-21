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
    # The record an item prints, when it prints one (a claim), as `<type>:<id>` (§3.5).
    record: str = ""

    def __repr__(self) -> str:
        # An unmarked item reads as it did before it could carry a mark.
        mark = f", record={self.record!r}" if self.record else ""
        return f"ListItem(text={self.text!r}, children={self.children!r}{mark})"


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
class Marked:
    """Blocks that print one record (store-only PLAN §3.5).

    Each element they print carries `data-record="<record>"`, and `data-state`
    when the record has a state, so the read-back can find the record's printed
    text and compare it with the store's.
    """

    record: str
    state: str
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
    # The record a row prints, and its state (§3.5).
    record: str = ""
    state: str = ""

    def __repr__(self) -> str:
        # An unmarked row reads as it did before it could carry a mark.
        mark = f", record={self.record!r}, state={self.state!r}" if self.record or self.state else ""
        return f"Row(cells={self.cells!r}, markers={self.markers!r}, filter={self.filter!r}{mark})"


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
    # The record's mark, `<type>:<id>`, and the stored state it prints (§3.5).
    record: str = ""
    state: str = ""


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
class Badge:
    """One measure of unresolved findings on one subsystem (A4): never a verdict, never a zero."""

    # `crit-high`, `med-low`, `awaiting` or `undiscriminated`: the Hot spots column it is read from.
    measure: str
    count: int
    # The short mark drawn on the boundary diagram, and the words the atlas prints.
    short: str
    label: str
    # The subsystem's depth is `concerns` or `adversarial`: its findings are not final.
    review: bool = False


@dataclass(frozen=True)
class AtlasItem:
    subsystem: Inlines
    depth: Inlines
    markers: tuple[str, ...] = ()
    record: str = ""
    state: str = ""
    badges: tuple[Badge, ...] = ()


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
    # The boundary's record and the two runtimes it joins, as the store names
    # them; empty for a table an imported body wrote, which no record holds.
    record: str = ""
    source_node: str = ""
    target_node: str = ""


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
    # The record the row's line draws: `seam:<id>` or `xref:<from>:<to>:<relationship>`.
    record: str = ""
    # The subsystem's finding badges; every row of one subsystem carries the same ones.
    badges: tuple[Badge, ...] = ()


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
class DiagramNode:
    """A box a diagram draws: the record it stands for, its place on the grid and what it says."""

    record: str
    label: str
    # Lanes or levels are rows, steps or rungs are columns; both count from 0.
    row: int
    column: int
    detail: str = ""
    # `solid`, `dashed` or `dotted`: how sure the record is, or that it sits apart.
    style: str = "solid"
    # Where the box links, or empty.
    href: str = ""
    # The box marks where the subject stands now.
    marker: bool = False
    # A bar segment's size, and the colour token it is filled with; zero and empty elsewhere.
    count: int = 0
    tone: str = ""
    # The revision(s) a cited file was examined at, when it has changed since: the box is hatched.
    hatch: str = ""
    # What else the box carries (Appendix B rule 7): `linchpin`, `survived`.
    qualifiers: tuple[str, ...] = ()


@dataclass(frozen=True)
class DiagramEdge:
    """An arrow a diagram draws, from one node's record to another's, and the record that joins them."""

    record: str
    source: str
    target: str
    label: str = ""
    style: str = "solid"
    # How far a line bows from the straight one, so two between the same boxes stay apart.
    bow: int = 0


@dataclass(frozen=True)
class Diagram:
    """A drawn figure and the account beside it (PLAN §7, Appendix B).

    The model holds the records; `diagrams.draw_svg` lays them out. Below its minimum
    a diagram holds no nodes and says why in `below`, and the writer prints that sentence.
    """

    kind: str
    # Who or what the diagram is about, when it is about one subject; empty otherwise.
    subject: str
    title: str
    # The one question it answers, in the reader's words.
    caption: str
    lanes: tuple[str, ...] = ()
    nodes: tuple[DiagramNode, ...] = ()
    edges: tuple[DiagramEdge, ...] = ()
    # Paragraphs of the account, then a list of items, each with the anchor its box links to.
    account: tuple[str, ...] = ()
    items: tuple[tuple[str, str], ...] = ()
    # What the diagram was read from or at.
    read_at: str = ""
    below: str = ""
    # Lines printed beneath the drawing, inside it, as its caption (a seam's assumptions).
    notes: tuple[str, ...] = ()


@dataclass(frozen=True)
class BadgeNote:
    """The sentence that says what a surface's badges are and are not (A4)."""

    text: str


@dataclass(frozen=True)
class Facets:
    """A filterable page's scope and the values each facet takes, in first-appearance order."""

    scope: str
    values: tuple[tuple[str, tuple[str, ...]], ...] = ()


Block = (
    Heading | Paragraph | List | Code | Quote | Anchor | RecordMarker | Section | Marked | Details
    | Table | EnumTable | LifecycleTable | RecordList | SummaryList | Atlas | Topology
    | RuntimeDiagram | BoundaryDiagram | CoverageIndex | ConcernChecklist
    | RelationshipTrace | StalenessBars | DiagramSource | Diagram | BadgeNote
)


@dataclass(frozen=True)
class Page:
    title: str
    # The page's HTML path, which links and page-specific layout are relative to.
    path: str
    blocks: tuple[Block, ...]
    facets: Facets | None = None
