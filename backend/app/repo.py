"""Database helpers shared by the routers and AI services."""

from __future__ import annotations

import json
from typing import Any

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from .ai.context import PageDoc
from .ai.transcriber import content_hash, has_ink, typed_transcript
from .models import Page, PageTranscript, Project, utcnow
from .schemas import PageOut, TranscriptOut


def get_project(session: Session, project_id: str) -> Project:
    project = session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def get_page(session: Session, page_id: str, *, include_deleted: bool = False) -> Page:
    page = session.get(Page, page_id)
    if page is None or (page.deleted_at is not None and not include_deleted):
        raise HTTPException(status_code=404, detail="Page not found")
    return page


def ordered_pages(session: Session, project_id: str) -> list[Page]:
    """Live pages in the student's order. Always sort by `order` (doc §10.2)."""
    statement = (
        select(Page)
        .where(Page.project_id == project_id, Page.deleted_at.is_(None))  # type: ignore[union-attr]
        .order_by(Page.order, Page.id)
    )
    return list(session.exec(statement))


def renumber(session: Session, pages: list[Page]) -> None:
    for index, page in enumerate(pages):
        if page.order != index:
            page.order = index
            session.add(page)


def elements_of(page: Page) -> list[dict[str, Any]]:
    return json.loads(page.elements_json or "[]")


def set_elements(page: Page, elements: list[dict[str, Any]]) -> None:
    page.elements_json = json.dumps(elements, separators=(",", ":"))
    page.content_hash = content_hash(elements)
    page.updated_at = utcnow()


def touch_project(session: Session, project_id: str) -> None:
    project = session.get(Project, project_id)
    if project is not None:
        project.updated_at = utcnow()
        session.add(project)


def page_out(page: Page, number: int) -> PageOut:
    return PageOut(
        id=page.id,
        project_id=page.project_id,
        title=page.title,
        order=page.order,
        number=number,
        width=page.width,
        height=page.height,
        background=page.background,
        elements=elements_of(page),
        content_hash=page.content_hash,
        thumbnail=page.thumbnail,
        updated_at=page.updated_at,
    )


def page_number(session: Session, page: Page) -> int:
    for index, candidate in enumerate(ordered_pages(session, page.project_id), start=1):
        if candidate.id == page.id:
            return index
    return 0


def _transcripts_for(session: Session, pages: list[Page]) -> dict[str, PageTranscript]:
    if not pages:
        return {}
    ids = [p.id for p in pages]
    rows = session.exec(select(PageTranscript).where(PageTranscript.page_id.in_(ids)))  # type: ignore[attr-defined]
    return {row.page_id: row for row in rows}


def upsert_transcript(
    session: Session, page: Page, text: str, *, source: str, user_corrected: bool = False
) -> PageTranscript:
    row = session.get(PageTranscript, page.id)
    if row is None:
        row = PageTranscript(page_id=page.id, content_hash=page.content_hash, transcript_md=text)
    row.content_hash = page.content_hash
    row.transcript_md = text
    row.source = source
    row.user_corrected = user_corrected
    row.created_at = utcnow()
    session.add(row)
    return row


def load_docs(session: Session, project_id: str, current_page_id: str | None) -> list[PageDoc]:
    """Every page as text for the AI.

    Typed-only pages are "transcribed" for free right here (no LLM call). Pages with ink
    need a vision transcript that matches their current content hash; if it's missing or
    stale we fall back to their typed text and flag them as `unread`.
    """
    pages = ordered_pages(session, project_id)
    transcripts = _transcripts_for(session, pages)
    docs: list[PageDoc] = []
    dirty = False
    for number, page in enumerate(pages, start=1):
        elements = elements_of(page)
        row = transcripts.get(page.id)
        fresh = row is not None and row.content_hash == page.content_hash
        if not fresh and not has_ink(elements):
            row = upsert_transcript(session, page, typed_transcript(elements), source="typed")
            fresh, dirty = True, True
        text = row.transcript_md if (fresh and row is not None) else typed_transcript(elements)
        docs.append(
            PageDoc(
                page_id=page.id,
                number=number,
                title=page.title,
                text=text,
                is_current=page.id == current_page_id,
                unread=not fresh,
            )
        )
    if dirty:
        try:
            session.commit()
        except IntegrityError:
            # Another request stored the same typed transcript at the same moment; theirs is identical.
            session.rollback()
    return docs


def transcript_statuses(session: Session, project_id: str) -> list[TranscriptOut]:
    docs = {d.page_id: d for d in load_docs(session, project_id, None)}
    pages = ordered_pages(session, project_id)
    transcripts = _transcripts_for(session, pages)
    out: list[TranscriptOut] = []
    for number, page in enumerate(pages, start=1):
        row = transcripts.get(page.id)
        doc = docs[page.id]
        out.append(
            TranscriptOut(
                page_id=page.id,
                number=number,
                title=page.title,
                has_ink=has_ink(elements_of(page)),
                stale=doc.unread,
                transcript_md=row.transcript_md if row else None,
                source=row.source if row else None,
                user_corrected=bool(row and row.user_corrected),
            )
        )
    return out
