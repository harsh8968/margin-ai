"""Grounded Q&A, explain, summary, refine, revision sheet and recommendations."""

from __future__ import annotations

import json
from typing import Any

from fastapi import HTTPException
from sqlmodel import Session, select

from ..config import settings
from ..learning import topic_stats
from ..models import ChatMessage, Project, QuizAttempt
from ..repo import get_page, get_project, load_docs
from ..schemas import (
    AskOutput,
    AskRequest,
    GeneralOutput,
    ProjectOnlyRequest,
    RecommendOutput,
    RefineOutput,
    RefineRequest,
    RevisionOutput,
    SelectionPayload,
    SummarizeRequest,
    SummaryOutput,
)
from . import prompts
from .context import (
    PageDoc,
    build_notes_block,
    build_selection_block,
    has_any_content,
    scope_description,
    select_docs,
)
from .grounding import apply_grounding_policy, clean_page_refs, verify_citations
from .llm_adapter import LLMAdapter, Part, TextPart, decode_data_url


def scoped_docs(
    session: Session, project_id: str, page_id: str | None, scope: str
) -> tuple[Project, list[PageDoc], list[PageDoc]]:
    project = get_project(session, project_id)
    if scope in ("page", "selection") and not page_id:
        raise HTTPException(status_code=400, detail="page_id is required for page or selection scope")
    if page_id:
        page = get_page(session, page_id)
        if page.project_id != project_id:
            raise HTTPException(status_code=400, detail="Page does not belong to this project")
    docs = load_docs(session, project_id, page_id)
    return project, docs, select_docs(scope, docs)


def decode_image(data_url: str) -> Part:
    try:
        return decode_data_url(data_url, settings.max_image_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def cap_pages(scoped: list[PageDoc]) -> list[PageDoc]:
    """Full-context mode is accurate up to a few dozen pages (doc §11.3). Beyond that we keep the
    current page plus the first N others rather than silently truncating text."""
    if len(scoped) <= settings.max_pages_in_context:
        return scoped
    current = [d for d in scoped if d.is_current]
    others = [d for d in scoped if not d.is_current][: settings.max_pages_in_context - len(current)]
    return current + others


def context_parts(
    project: Project, scoped: list[PageDoc], scope: str, selection: SelectionPayload | None
) -> list[Part]:
    scoped = cap_pages(scoped)
    parts: list[Part] = [
        TextPart(scope_description(scope, scoped)),
        TextPart(build_notes_block(project.name, scoped)),
    ]
    if scope == "selection" and selection is not None:
        parts.append(TextPart(build_selection_block(selection)))
        if selection.image:
            parts.append(decode_image(selection.image))
    return parts


def unread_pages(scoped: list[PageDoc]) -> list[int]:
    return [d.number for d in scoped if d.unread]


def _page_ref(doc_by_number: dict[int, PageDoc], number: int) -> dict[str, Any] | None:
    doc = doc_by_number.get(number)
    return {"page": number, "page_id": doc.page_id, "title": doc.title} if doc else None


def same_scope_history(req: AskRequest) -> list:
    """Turns from another scope or page would smuggle in content the student didn't pick."""
    if req.scope == "project":
        return [t for t in req.history if t.scope in (None, "project")]
    return [t for t in req.history if t.scope == req.scope and t.page_id == req.page_id]


def _empty_message(scope: str, docs: list[PageDoc] | None = None) -> str:
    if docs and any(d.unread for d in docs):
        return "The handwriting here hasn't been read yet. Open 'What the AI sees' and press Re-read."
    if scope == "project":
        return "This project has no notes yet. Write or type something first."
    if scope == "selection":
        return "The selection is empty."
    return "This page has no notes yet. Write or type something first."


# --------------------------------------------------------------------------- ask / explain


async def ask(session: Session, llm: LLMAdapter, req: AskRequest) -> dict[str, Any]:
    project, _docs, scoped = scoped_docs(session, req.project_id, req.page_id, req.scope)
    if req.scope == "selection" and req.selection is None:
        raise HTTPException(status_code=400, detail="Selection scope needs a selection")

    if req.allow_general:
        return await _general_answer(session, llm, req, project, scoped)

    if not has_any_content(scoped, req.selection):
        output = AskOutput(answer_markdown="", citations=[], grounding="not_in_notes", missing_info=_empty_message(req.scope, scoped))
    else:
        parts = context_parts(project, scoped, req.scope, req.selection)
        history = same_scope_history(req)
        if history:
            transcript = "\n".join(f"{turn.role.upper()}: {turn.content[:1500]}" for turn in history[-6:])
            parts.append(TextPart(f"Earlier in this conversation:\n{transcript}"))
        parts.append(TextPart(f"Student's question: {req.question}"))
        system = prompts.ASK_SYSTEM + ("\n\n" + prompts.EXPLAIN_TEMPLATE if req.mode == "explain" else "")
        output = await llm.generate_json(system=system, parts=parts, schema=AskOutput, temperature=0.2)

    verified = verify_citations(output.citations, scoped)
    grounding, missing_info = apply_grounding_policy(output.grounding, verified, output.missing_info)
    answer = clean_page_refs(output.answer_markdown, {d.number for d in scoped})
    if grounding == "not_in_notes":
        answer, verified = "", []
    kept = [c for c in verified if c.verified]
    citations = [{"page": c.page, "page_id": c.page_id, "quote": c.quote} for c in kept]

    result = {
        "answer_markdown": answer,
        "citations": citations,
        "grounding": grounding,
        "missing_info": missing_info.strip(),
        "dropped_citations": len(verified) - len(kept),
        "unread_pages": unread_pages(scoped),
        "scope": req.scope,
        "mode": req.mode,
    }
    _save_turn(session, req, result)
    return result


async def _general_answer(
    session: Session, llm: LLMAdapter, req: AskRequest, project: Project, scoped: list[PageDoc]
) -> dict[str, Any]:
    parts = context_parts(project, scoped, req.scope, req.selection)
    parts.append(TextPart(f"Student's question: {req.question}"))
    output = await llm.generate_json(system=prompts.GENERAL_SYSTEM, parts=parts, schema=GeneralOutput, temperature=0.4)
    result = {
        "answer_markdown": output.answer_markdown,
        "citations": [],
        "grounding": "general",
        "missing_info": "",
        "dropped_citations": 0,
        "unread_pages": unread_pages(scoped),
        "scope": req.scope,
        "mode": req.mode,
    }
    _save_turn(session, req, result)
    return result


def _save_turn(session: Session, req: AskRequest, result: dict[str, Any]) -> None:
    session.add(
        ChatMessage(project_id=req.project_id, page_id=req.page_id, scope=req.scope, role="user", content=req.question)
    )
    session.add(
        ChatMessage(
            project_id=req.project_id,
            page_id=req.page_id,
            scope=req.scope,
            role="assistant",
            content=result["answer_markdown"],
            citations_json=json.dumps(result["citations"]),
            grounding=result["grounding"],
            missing_info=result["missing_info"] or None,
        )
    )
    session.commit()


# --------------------------------------------------------------------------- summary


async def summarize(session: Session, llm: LLMAdapter, req: SummarizeRequest) -> dict[str, Any]:
    project, _docs, scoped = scoped_docs(session, req.project_id, req.page_id, req.scope)
    by_number = {d.number: d for d in scoped}
    if not has_any_content(scoped, req.selection):
        return {"summary_markdown": _empty_message(req.scope), "pages_used": [], "unread_pages": unread_pages(scoped), "scope": req.scope, "format": req.format}

    parts = context_parts(project, scoped, req.scope, req.selection)
    parts.append(TextPart(f"Summary format: {prompts.SUMMARY_FORMATS[req.format]}"))
    output = await llm.generate_json(system=prompts.SUMMARY_SYSTEM, parts=parts, schema=SummaryOutput, temperature=0.2)
    pages_used = [ref for n in sorted(set(output.pages_used)) if (ref := _page_ref(by_number, n))]
    return {
        "summary_markdown": clean_page_refs(output.summary_markdown, set(by_number)),
        "pages_used": pages_used,
        "unread_pages": unread_pages(scoped),
        "scope": req.scope,
        "format": req.format,
    }


# --------------------------------------------------------------------------- refine


async def refine(session: Session, llm: LLMAdapter, req: RefineRequest) -> dict[str, Any]:
    project, _docs, scoped = scoped_docs(session, req.project_id, req.page_id, req.scope)
    if req.scope == "selection" and req.selection is None:
        raise HTTPException(status_code=400, detail="Selection scope needs a selection")
    if not has_any_content(scoped, req.selection if req.scope == "selection" else None):
        raise HTTPException(status_code=400, detail="There is nothing to refine yet.")

    parts = context_parts(project, scoped, req.scope, req.selection)
    target = "the content inside <selection>" if req.scope == "selection" else "the current page"
    instruction = f"Action: {prompts.REFINE_ACTIONS[req.action]}\nRefine {target}."
    if req.instruction:
        instruction += f"\nExtra request from the student: {req.instruction}"
    parts.append(TextPart(instruction))
    output = await llm.generate_json(system=prompts.REFINE_SYSTEM, parts=parts, schema=RefineOutput, temperature=0.3)
    return {
        "action": req.action,
        "scope": req.scope,
        "original_reading": output.original_reading,
        "proposed_markdown": output.proposed_markdown,
        "change_summary": output.change_summary,
    }


# --------------------------------------------------------------------------- revision sheet + recommendations


async def revision_sheet(session: Session, llm: LLMAdapter, req: ProjectOnlyRequest) -> dict[str, Any]:
    project, docs, _ = scoped_docs(session, req.project_id, req.page_id, "project")
    if not has_any_content(docs):
        raise HTTPException(status_code=400, detail="This project has no notes to revise from yet.")
    parts = context_parts(project, docs, "project", None)
    output = await llm.generate_json(system=prompts.REVISION_SYSTEM, parts=parts, schema=RevisionOutput, temperature=0.3)
    return {
        "title": output.title,
        "sheet_markdown": clean_page_refs(output.sheet_markdown, {d.number for d in docs}),
        "unread_pages": unread_pages(docs),
    }


async def recommend(session: Session, llm: LLMAdapter, req: ProjectOnlyRequest) -> dict[str, Any]:
    project, docs, _ = scoped_docs(session, req.project_id, req.page_id, "project")
    if not has_any_content(docs):
        raise HTTPException(status_code=400, detail="This project has no notes yet.")
    attempts = list(session.exec(select(QuizAttempt).where(QuizAttempt.project_id == req.project_id)))
    stats = topic_stats(attempts)
    if stats:
        lines = [f"- {s.topic}: {s.accuracy:.0%} over {s.attempts} answers (pages {list(s.source_pages)})" for s in stats]
        history = "Quiz performance by topic (weakest first):\n" + "\n".join(lines)
    else:
        history = "Quiz performance: no quiz history yet."
    parts = context_parts(project, docs, "project", None) + [TextPart(history)]
    output = await llm.generate_json(system=prompts.RECOMMEND_SYSTEM, parts=parts, schema=RecommendOutput, temperature=0.3)
    by_number = {d.number: d for d in docs}
    recommendations = [
        {
            "topic": rec.topic,
            "why": rec.why,
            "action": rec.action,
            "pages": [ref for n in rec.pages if (ref := _page_ref(by_number, n))],
        }
        for rec in output.recommendations
    ]
    return {"recommendations": recommendations, "practice_questions": output.practice_questions, "has_history": bool(stats)}
