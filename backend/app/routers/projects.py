"""Projects, page lists, ordering and per-project study data (doc §10, §14)."""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, col, delete, select

from ..ai import study
from ..db import get_session
from ..http import ok
from ..models import ChatMessage, Page, Project, utcnow
from ..repo import get_page, get_project, ordered_pages, page_out, renumber, set_elements, touch_project, transcript_statuses
from ..schemas import PageCreate, PageOrder, ProjectCreate, ProjectOut, ProjectUpdate

router = APIRouter(prefix="/api/projects", tags=["projects"])


def project_out(session: Session, project: Project) -> ProjectOut:
    pages = ordered_pages(session, project.id)
    return ProjectOut(
        id=project.id,
        name=project.name,
        created_at=project.created_at,
        updated_at=project.updated_at,
        page_count=len(pages),
        cover_thumbnail=pages[0].thumbnail if pages else None,
    )


@router.get("")
def list_projects(session: Session = Depends(get_session)):
    projects = session.exec(select(Project).order_by(col(Project.updated_at).desc()))
    return ok([project_out(session, p).model_dump(mode="json") for p in projects])


@router.post("", status_code=201)
def create_project(body: ProjectCreate, session: Session = Depends(get_session)):
    project = Project(name=body.name.strip())
    session.add(project)
    session.flush()
    session.add(Page(project_id=project.id, title="Page 1", order=0, content_hash=_empty_hash()))
    session.commit()
    return ok(project_out(session, project).model_dump(mode="json"))


@router.get("/{project_id}")
def get_project_detail(project_id: str, session: Session = Depends(get_session)):
    project = get_project(session, project_id)
    pages = ordered_pages(session, project_id)
    return ok(
        {
            "project": project_out(session, project).model_dump(mode="json"),
            "pages": [page_out(p, i).model_dump(mode="json") for i, p in enumerate(pages, start=1)],
        }
    )


@router.patch("/{project_id}")
def rename_project(project_id: str, body: ProjectUpdate, session: Session = Depends(get_session)):
    project = get_project(session, project_id)
    project.name = body.name.strip()
    project.updated_at = utcnow()
    session.add(project)
    session.commit()
    return ok(project_out(session, project).model_dump(mode="json"))


@router.delete("/{project_id}")
def delete_project(project_id: str, session: Session = Depends(get_session)):
    project = get_project(session, project_id)
    session.delete(project)  # pages, transcripts, chats, quizzes and cards cascade in SQLite
    session.commit()
    return ok({"deleted": project_id})


# --------------------------------------------------------------------------- pages within a project


@router.get("/{project_id}/pages")
def list_pages(project_id: str, session: Session = Depends(get_session)):
    get_project(session, project_id)
    pages = ordered_pages(session, project_id)
    return ok([page_out(p, i).model_dump(mode="json") for i, p in enumerate(pages, start=1)])


@router.post("/{project_id}/pages", status_code=201)
def add_page(project_id: str, body: PageCreate, session: Session = Depends(get_session)):
    get_project(session, project_id)
    pages = ordered_pages(session, project_id)
    insert_at = len(pages)
    if body.after_page_id:
        anchor = get_page(session, body.after_page_id)
        if anchor.project_id != project_id:
            raise HTTPException(status_code=400, detail="after_page_id is not in this project")
        insert_at = next(i for i, p in enumerate(pages) if p.id == anchor.id) + 1
    page = Page(project_id=project_id, title=(body.title or f"Page {len(pages) + 1}").strip(), order=insert_at, background=body.background)
    set_elements(page, [el.model_dump() for el in body.elements])
    pages.insert(insert_at, page)
    session.add(page)
    renumber(session, pages)
    touch_project(session, project_id)
    session.commit()
    return ok(page_out(page, insert_at + 1).model_dump(mode="json"))


@router.put("/{project_id}/pages/order")
def reorder_pages(project_id: str, body: PageOrder, session: Session = Depends(get_session)):
    get_project(session, project_id)
    pages = {p.id: p for p in ordered_pages(session, project_id)}
    if set(body.page_ids) != set(pages) or len(body.page_ids) != len(pages):
        raise HTTPException(status_code=400, detail="page_ids must list every page of the project exactly once")
    renumber(session, [pages[pid] for pid in body.page_ids])
    touch_project(session, project_id)
    session.commit()
    ordered = ordered_pages(session, project_id)
    return ok([{"id": p.id, "order": p.order, "number": i} for i, p in enumerate(ordered, start=1)])


# --------------------------------------------------------------------------- study data


@router.get("/{project_id}/transcripts")
def list_transcripts(project_id: str, session: Session = Depends(get_session)):
    get_project(session, project_id)
    return ok([t.model_dump(mode="json") for t in transcript_statuses(session, project_id)])


@router.get("/{project_id}/chat")
def chat_history(project_id: str, session: Session = Depends(get_session)):
    get_project(session, project_id)
    rows = session.exec(
        select(ChatMessage).where(ChatMessage.project_id == project_id).order_by(col(ChatMessage.created_at))
    )
    return ok(
        [
            {
                "id": m.id,
                "role": m.role,
                "content": m.content,
                "scope": m.scope,
                "page_id": m.page_id,
                "citations": json.loads(m.citations_json or "[]"),
                "grounding": m.grounding,
                "missing_info": m.missing_info,
                "created_at": m.created_at.isoformat(),
            }
            for m in rows
        ][-100:]
    )


@router.delete("/{project_id}/chat")
def clear_chat(project_id: str, session: Session = Depends(get_session)):
    get_project(session, project_id)
    session.exec(delete(ChatMessage).where(ChatMessage.project_id == project_id))  # type: ignore[call-overload]
    session.commit()
    return ok({"cleared": True})


@router.get("/{project_id}/insights")
def project_insights(project_id: str, session: Session = Depends(get_session)):
    return ok(study.insights(session, project_id))


@router.get("/{project_id}/flashcards")
def project_flashcards(project_id: str, session: Session = Depends(get_session)):
    return ok(study.list_flashcards(session, project_id))


def _empty_hash() -> str:
    from ..ai.transcriber import content_hash

    return content_hash([])
