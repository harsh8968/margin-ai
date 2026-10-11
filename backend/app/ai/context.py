"""Builds the "context packet" the LLM sees (PS6 doc §11.3).

The trick that lets the AI tell *this page* from *the whole project*: every page is
wrapped in a <page n=".." title=".."> tag, and the one the student is looking at is
tagged current="true" and placed first. The system prompt defines "this page" as that tag.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from html import escape

from ..schemas import SelectionPayload

UNREAD_PLACEHOLDER = "(This page has handwriting that has not been read yet.)"
EMPTY_PLACEHOLDER = "(This page is empty.)"


@dataclass(frozen=True)
class PageDoc:
    page_id: str
    number: int
    title: str
    text: str
    is_current: bool
    unread: bool = False

    @property
    def has_text(self) -> bool:
        return bool(self.text.strip())


_OUR_TAGS = re.compile(r"<(\s*/?\s*)(page|notes|selection)\b", re.IGNORECASE)


def _neutralize(text: str) -> str:
    """Stop note content from opening or closing our tags (a cheap prompt-injection guard)."""
    return _OUR_TAGS.sub(lambda m: f"&lt;{m.group(1)}{m.group(2)}", text)


def select_docs(scope: str, docs: list[PageDoc]) -> list[PageDoc]:
    """`page` and `selection` see only the current page; `project` sees every page."""
    if scope == "project":
        return docs
    current = [d for d in docs if d.is_current]
    return current or docs[:1]


def build_notes_block(project_name: str, docs: list[PageDoc]) -> str:
    ordered = sorted(docs, key=lambda d: (not d.is_current, d.number))
    lines = [f'<notes project="{escape(project_name)}">']
    for doc in ordered:
        current = ' current="true"' if doc.is_current else ""
        if doc.has_text:
            body = _neutralize(doc.text.strip())
        else:
            body = UNREAD_PLACEHOLDER if doc.unread else EMPTY_PLACEHOLDER
        lines.append(f'<page n="{doc.number}" title="{escape(doc.title)}"{current}>\n{body}\n</page>')
    lines.append("</notes>")
    return "\n".join(lines)


def build_selection_block(selection: SelectionPayload | None) -> str:
    if selection is None:
        return ""
    typed = "\n".join(f"- {_neutralize(block)}" for block in selection.text_blocks if block.strip())
    parts = ["<selection>"]
    if selection.image:
        parts.append("The attached image shows the selected region of the current page (handwriting and drawings).")
    if typed:
        parts.append(f"Typed text inside the selection:\n{typed}")
    parts.append("</selection>")
    return "\n".join(parts)


def has_any_content(docs: list[PageDoc], selection: SelectionPayload | None = None) -> bool:
    if selection is not None and (selection.image or any(b.strip() for b in selection.text_blocks)):
        return True
    return any(doc.has_text for doc in docs)


def scope_description(scope: str, docs: list[PageDoc]) -> str:
    if scope == "selection":
        return "SCOPE: the student's SELECTION on the current page. Work only on the selected content; the page is surrounding context."
    if scope == "page":
        number = docs[0].number if docs else "?"
        return f"SCOPE: only the current page (p.{number})."
    return f"SCOPE: the whole project ({len(docs)} pages)."
