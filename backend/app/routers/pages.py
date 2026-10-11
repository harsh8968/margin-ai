"""Single-page operations and "what the AI sees" transcripts (doc §10.2, §11.2)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from ..ai.llm_adapter import LLMAdapter
from ..ai.service import decode_image
from ..ai.transcriber import has_ink, transcribe_with_vision, typed_blocks, typed_transcript
from ..db import get_session
from ..http import ai_rate_limit, get_llm, ok
from ..models import Page, PageTranscript, utcnow
from ..repo import (
    elements_of,
    get_page,
    ordered_pages,
    page_number,
    page_out,
    renumber,
    set_elements,
    touch_project,
    upsert_transcript,
)
from ..schemas import PageUpdate, TranscribeRequest, TranscriptOut, TranscriptUpdate

router = APIRouter(prefix="/api/pages", tags=["pages"])


@router.get("/{page_id}")
def read_page(page_id: str, session: Session = Depends(get_session)):
    page = get_page(session, page_id)
    return ok(page_out(page, page_number(session, page)).model_dump(mode="json"))


@router.patch("/{page_id}")
def update_page(page_id: str, body: PageUpdate, session: Session = Depends(get_session)):
    page = get_page(session, page_id)
    if body.title is not None:
        page.title = body.title.strip()
    if body.background is not None:
        page.background = body.background
    if body.elements is not None:
        set_elements(page, [el.model_dump() for el in body.elements])
    if body.thumbnail is not None:
        if not body.thumbnail.startswith("data:image/"):
            raise HTTPException(status_code=400, detail="Thumbnail must be an image data URL")
        page.thumbnail = body.thumbnail
    page.updated_at = utcnow()
    session.add(page)
    touch_project(session, page.project_id)
    session.commit()
    return ok({"id": page.id, "content_hash": page.content_hash, "updated_at": page.updated_at.isoformat(), "title": page.title})


@router.delete("/{page_id}")
def delete_page(page_id: str, session: Session = Depends(get_session)):
    page = get_page(session, page_id)
    pages = ordered_pages(session, page.project_id)
    if len(pages) <= 1:
        raise HTTPException(status_code=400, detail="A project needs at least one page")
    page.deleted_at = utcnow()
    session.add(page)
    renumber(session, [p for p in pages if p.id != page.id])
    touch_project(session, page.project_id)
    session.commit()
    return ok({"deleted": page_id, "restorable": True})


@router.post("/{page_id}/restore")
def restore_page(page_id: str, session: Session = Depends(get_session)):
    page = get_page(session, page_id, include_deleted=True)
    if page.deleted_at is None:
        return ok(page_out(page, page_number(session, page)).model_dump(mode="json"))
    pages = ordered_pages(session, page.project_id)
    position = min(page.order, len(pages))
    page.deleted_at = None
    pages.insert(position, page)
    session.add(page)
    renumber(session, pages)
    touch_project(session, page.project_id)
    session.commit()
    return ok(page_out(page, position + 1).model_dump(mode="json"))


@router.post("/{page_id}/duplicate", status_code=201)
def duplicate_page(page_id: str, session: Session = Depends(get_session)):
    source = get_page(session, page_id)
    pages = ordered_pages(session, source.project_id)
    position = next(i for i, p in enumerate(pages) if p.id == source.id) + 1
    copy = Page(
        project_id=source.project_id,
        title=f"{source.title} (copy)"[:120],
        order=position,
        background=source.background,
        thumbnail=source.thumbnail,
    )
    set_elements(copy, elements_of(source))
    pages.insert(position, copy)
    session.add(copy)
    renumber(session, pages)
    session.commit()
    return ok(page_out(copy, position + 1).model_dump(mode="json"))


# --------------------------------------------------------------------------- transcripts


def _transcript_out(session: Session, page: Page, row: PageTranscript | None) -> TranscriptOut:
    return TranscriptOut(
        page_id=page.id,
        number=page_number(session, page),
        title=page.title,
        has_ink=has_ink(elements_of(page)),
        stale=row is None or row.content_hash != page.content_hash,
        transcript_md=row.transcript_md if row else None,
        source=row.source if row else None,
        user_corrected=bool(row and row.user_corrected),
    )


@router.get("/{page_id}/transcript")
def read_transcript(page_id: str, session: Session = Depends(get_session)):
    page = get_page(session, page_id)
    return ok(_transcript_out(session, page, session.get(PageTranscript, page.id)).model_dump(mode="json"))


@router.post("/{page_id}/transcribe", dependencies=[Depends(ai_rate_limit)])
async def transcribe_page(
    page_id: str,
    body: TranscribeRequest,
    session: Session = Depends(get_session),
    llm: LLMAdapter = Depends(get_llm),
):
    page = get_page(session, page_id)
    if body.content_hash != page.content_hash:
        raise HTTPException(status_code=409, detail="The page changed while it was being read. Save and retry.")
    elements = elements_of(page)
    existing = session.get(PageTranscript, page.id)
    if existing is not None and existing.content_hash == page.content_hash and not body.force:
        # Already read for exactly this content: don't spend a vision call or overwrite a correction.
        return ok(_transcript_out(session, page, existing).model_dump(mode="json"))
    if not has_ink(elements):
        row = upsert_transcript(session, page, typed_transcript(elements), source="typed")
    else:
        previous = session.get(PageTranscript, page.id)
        correction = previous.transcript_md if previous and previous.user_corrected else None
        text = await transcribe_with_vision(
            llm, decode_image(body.image), title=page.title, blocks=typed_blocks(elements), previous_correction=correction
        )
        row = upsert_transcript(session, page, text, source="vision")
    session.commit()
    session.refresh(row)
    return ok(_transcript_out(session, page, row).model_dump(mode="json"))


@router.put("/{page_id}/transcript")
def correct_transcript(page_id: str, body: TranscriptUpdate, session: Session = Depends(get_session)):
    page = get_page(session, page_id)
    row = upsert_transcript(session, page, body.transcript_md.strip(), source="user", user_corrected=True)
    session.commit()
    session.refresh(row)
    return ok(_transcript_out(session, page, row).model_dump(mode="json"))
