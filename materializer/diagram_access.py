"""Shared check for the diagram gates: how a diagram's SVG presents itself to assistive technology.

Appendix B rule 8 of design/store-only/PLAN.md, as amended 2026-11-26 (store-only final review
F14/claude). ARIA treats the children of a `role="img"` as presentational, so an image that
holds links hides them from a screen reader. Hence two forms:

- a diagram with no link is `role="img"`, labelled by its `<title>` and `<desc>` together;
- a diagram with links is `role="group"`, labelled by its `<title>` and described by its
  `<desc>`; every top-level part that is not a link is hidden (`aria-hidden="true"`), no text
  sits outside a link in a part that holds one, and every link has a name.

A link is reachable: it has an href, neither it nor an ancestor is hidden, and no negative
tabindex takes it out of the keyboard order. Its name is what a screen reader would announce:
aria-labelledby, else aria-label, else its own `<title>`, else the text it shows, leaving out
any hidden text (Codex review, 2026-11-26).
"""

from __future__ import annotations

from xml.etree import ElementTree


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _shown(el: ElementTree.Element) -> str:
    """The text an element shows to assistive technology: hidden subtrees and tooltips left out."""

    if el.get("aria-hidden") == "true" or _local(el.tag) in ("title", "desc"):
        return ""
    words = [el.text or ""]
    for child in el:
        words.append(_shown(child))
        words.append(child.tail or "")
    return " ".join("".join(words).split())


def _name(link: ElementTree.Element, by_id: dict[str, ElementTree.Element]) -> str:
    """A link's accessible name, by the precedence accname and SVG-AAM give."""

    if refs := (link.get("aria-labelledby") or "").split():
        return " ".join(" ".join(by_id[r].itertext()).split() for r in refs if r in by_id).strip()
    if (label := (link.get("aria-label") or "").strip()):
        return label
    own = [c for c in link if _local(c.tag) == "title"]
    if own and (tip := " ".join("".join(own[0].itertext()).split())):
        return tip
    return _shown(link)


def access_faults(svg: str) -> str | None:
    """Why this `<svg>…</svg>` does not present itself as rule 8 says, or None."""

    try:
        root = ElementTree.fromstring(svg)
    except ElementTree.ParseError as exc:
        return f"the SVG does not parse as XML ({exc})"
    children = list(root)
    titles = [c for c in children if _local(c.tag) == "title"]
    descs = [c for c in children if _local(c.tag) == "desc"]
    if len(titles) != 1 or len(descs) != 1 or not titles[0].get("id") or not descs[0].get("id"):
        return "the SVG lacks one <title> and one <desc>, each a direct child with an id"
    title_id, desc_id = titles[0].get("id"), descs[0].get("id")
    role = root.get("role")
    labelled = (root.get("aria-labelledby") or "").split()
    links = [el for el in root.iter() if _local(el.tag) == "a"]
    if not links:
        if role != "img":
            return f'an SVG with no link has role {role!r}, not "img"'
        if labelled != [title_id, desc_id]:
            return f"aria-labelledby names {labelled}, not the <title> and <desc> ids {[title_id, desc_id]}"
        return None
    if role != "group":
        return f'an SVG with links has role {role!r}, not "group" (an image hides its links)'
    if labelled != [title_id]:
        return f"aria-labelledby names {labelled}, not the <title> id {title_id!r}"
    if (root.get("aria-describedby") or "") != desc_id:
        return f"aria-describedby is {root.get('aria-describedby')!r}, not the <desc> id {desc_id!r}"
    parent = {child: el for el in root.iter() for child in el}
    by_id = {el.get("id"): el for el in root.iter() if el.get("id")}
    for link in links:
        href = link.get("href") or link.get("{http://www.w3.org/1999/xlink}href")
        if not href:
            return "a link has no href, so it is not a link to assistive technology"
        node: ElementTree.Element | None = link
        while node is not None:
            if node.get("aria-hidden") == "true":
                return f"a link to {href!r} is hidden from assistive technology"
            node = parent.get(node)
        tabindex = (link.get("tabindex") or "").strip()
        if tabindex.lstrip("-").isdigit() and int(tabindex) < 0:
            return f"a link to {href!r} has tabindex {tabindex}, out of the keyboard order"
        if not _name(link, by_id):
            return f"a link to {href!r} has no accessible name"
    for part in children:
        if part in titles or part in descs:
            continue
        holds_link = any(_local(el.tag) == "a" for el in part.iter())
        if not holds_link:
            if part.get("aria-hidden") != "true":
                return f"a <{_local(part.tag)}> with no link is not hidden from assistive technology"
            continue
        inside = {id(el) for link in (el for el in part.iter() if _local(el.tag) == "a") for el in link.iter()}
        loose = [el for el in part.iter() if _local(el.tag) == "text" and id(el) not in inside]
        if loose:
            return f"text {''.join(loose[0].itertext()).strip()[:60]!r} sits outside a link in a part that holds one"
    return None
