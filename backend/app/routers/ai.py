"""AI endpoints (doc §14). Thin wrappers: validation happens in the schemas, logic in app.ai."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlmodel import Session

from ..ai import service, study
from ..ai.llm_adapter import LLMAdapter
from ..db import get_session
from ..http import ai_rate_limit, get_llm, ok
from ..schemas import (
    AnswerRequest,
    AskRequest,
    FlashcardsRequest,
    ProjectOnlyRequest,
    QuizRequest,
    RefineRequest,
    ReviewRequest,
    SummarizeRequest,
)

router = APIRouter(prefix="/api", tags=["ai"])
limited = [Depends(ai_rate_limit)]


@router.post("/ai/ask", dependencies=limited)
async def ask(body: AskRequest, session: Session = Depends(get_session), llm: LLMAdapter = Depends(get_llm)):
    return ok(await service.ask(session, llm, body))


@router.post("/ai/summarize", dependencies=limited)
async def summarize(body: SummarizeRequest, session: Session = Depends(get_session), llm: LLMAdapter = Depends(get_llm)):
    return ok(await service.summarize(session, llm, body))


@router.post("/ai/refine", dependencies=limited)
async def refine(body: RefineRequest, session: Session = Depends(get_session), llm: LLMAdapter = Depends(get_llm)):
    return ok(await service.refine(session, llm, body))


@router.post("/ai/quiz", dependencies=limited)
async def quiz(body: QuizRequest, session: Session = Depends(get_session), llm: LLMAdapter = Depends(get_llm)):
    return ok(await study.generate_quiz(session, llm, body))


@router.post("/ai/quiz/{quiz_id}/answer", dependencies=limited)
async def answer(
    quiz_id: str, body: AnswerRequest, session: Session = Depends(get_session), llm: LLMAdapter = Depends(get_llm)
):
    return ok(await study.answer_question(session, llm, quiz_id, body))


@router.post("/ai/flashcards", dependencies=limited)
async def flashcards(body: FlashcardsRequest, session: Session = Depends(get_session), llm: LLMAdapter = Depends(get_llm)):
    return ok(await study.generate_flashcards(session, llm, body))


@router.post("/ai/revision-sheet", dependencies=limited)
async def revision_sheet(body: ProjectOnlyRequest, session: Session = Depends(get_session), llm: LLMAdapter = Depends(get_llm)):
    return ok(await service.revision_sheet(session, llm, body))


@router.post("/ai/recommend", dependencies=limited)
async def recommend(body: ProjectOnlyRequest, session: Session = Depends(get_session), llm: LLMAdapter = Depends(get_llm)):
    return ok(await service.recommend(session, llm, body))


@router.post("/flashcards/{card_id}/review")
def review_flashcard(card_id: str, body: ReviewRequest, session: Session = Depends(get_session)):
    return ok(study.review_flashcard(session, card_id, body.result))


@router.delete("/flashcards/{card_id}")
def delete_flashcard(card_id: str, session: Session = Depends(get_session)):
    study.delete_flashcard(session, card_id)
    return ok({"deleted": card_id})
