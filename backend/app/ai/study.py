"""Quizzes (A5 + adaptive B2), grading, flashcards (B1) and insights (B5)."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException
from sqlmodel import Session, col, select

from ..learning import (
    LEVEL_TO_NUMBER,
    adaptive_level,
    leitner_next,
    per_topic_targets,
    strong_topics,
    topic_stats,
    weak_topics,
)
from ..models import Flashcard, Quiz, QuizAttempt, utcnow
from ..repo import get_project, load_docs
from ..schemas import (
    AnswerRequest,
    FlashcardsOutput,
    FlashcardsRequest,
    GradeOutput,
    QuizOutput,
    QuizQuestionOut,
    QuizRequest,
)
from . import prompts
from .context import PageDoc, build_notes_block, has_any_content
from .llm_adapter import LLMAdapter, LLMError, TextPart
from .service import context_parts, scoped_docs, unread_pages

TF_VALUES = {"true": "True", "t": "True", "false": "False", "f": "False"}


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower()).strip(" .")


# --------------------------------------------------------------------------- quiz generation


def _clean_question(q: QuizQuestionOut, valid_pages: dict[int, PageDoc], fallback_page: int) -> dict[str, Any] | None:
    """Repair or reject a generated question so the UI never shows a broken one."""
    options = [o.strip() for o in q.options if o.strip()]
    answer = q.answer.strip()
    if q.type == "mcq":
        if len(options) < 3:
            return None
        match = next((o for o in options if _norm(o) == _norm(answer)), None)
        if match is None and re.fullmatch(r"[A-Da-d]", answer):
            index = ord(answer.upper()) - ord("A")
            match = options[index] if index < len(options) else None
        if match is None:
            return None
        answer = match
    elif q.type == "tf":
        answer = TF_VALUES.get(_norm(answer), "")
        if not answer:
            return None
        options = ["True", "False"]
    else:
        options = []
        if not answer:
            return None
    page = q.source_page if q.source_page in valid_pages else fallback_page
    doc = valid_pages.get(page)
    return {
        "type": q.type,
        "question": q.question.strip(),
        "options": options,
        "answer": answer,
        "explanation": q.explanation.strip(),
        "source_page": page,
        "source_page_id": doc.page_id if doc else None,
        "topic": q.topic.strip() or "General",
        "difficulty": max(1, min(3, q.difficulty)),
    }


def _public_question(index: int, question: dict[str, Any]) -> dict[str, Any]:
    return {"index": index, **{k: question[k] for k in ("type", "question", "options", "source_page", "source_page_id", "topic", "difficulty")}}


async def generate_quiz(session: Session, llm: LLMAdapter, req: QuizRequest) -> dict[str, Any]:
    project, _docs, scoped = scoped_docs(session, req.project_id, req.page_id, req.scope)
    if not has_any_content(scoped, req.selection):
        raise HTTPException(status_code=400, detail="There are no notes in this scope to quiz you on yet.")

    attempts = list(
        session.exec(select(QuizAttempt).where(QuizAttempt.project_id == req.project_id).order_by(col(QuizAttempt.answered_at)))
    )
    level, reason = req.difficulty, ""
    focus = list(req.focus_topics)
    plan_lines: list[str] = []
    if req.difficulty == "adaptive":
        last_quiz = session.exec(
            select(Quiz).where(Quiz.project_id == req.project_id).order_by(col(Quiz.created_at).desc())
        ).first()
        level, reason = adaptive_level([a.score for a in attempts], last_quiz.difficulty if last_quiz else None)
        stats = topic_stats(attempts)
        targets = per_topic_targets(stats)
        weak = [s.topic for s in weak_topics(stats)]
        strong = [s.topic for s in strong_topics(stats)]
        focus = focus or weak
        if weak:
            plan_lines.append(f"Weak topics (put about 60% of questions here, difficulty 1-2): {', '.join(weak)}")
        if strong:
            plan_lines.append(f"Mastered topics (only a few questions, difficulty 3): {', '.join(strong)}")
        if targets:
            plan_lines.append("Per-topic difficulty targets: " + ", ".join(f"{t}={d}" for t, d in targets.items()))

    parts = context_parts(project, scoped, req.scope, req.selection)
    request_lines = [
        f"Create {req.count} questions.",
        f"Allowed types: {', '.join(req.types)}. Mix them roughly evenly.",
        f"Overall target difficulty: {LEVEL_TO_NUMBER.get(level, 2)} ({level}).",
    ]
    if focus:
        request_lines.append(f"Focus on these topics where the notes cover them: {', '.join(focus)}")
    parts.append(TextPart("\n".join(request_lines + plan_lines)))

    output = await llm.generate_json(system=prompts.QUIZ_SYSTEM, parts=parts, schema=QuizOutput, temperature=0.5)
    valid_pages = {d.number: d for d in scoped}
    fallback_page = next((d.number for d in scoped if d.is_current), scoped[0].number if scoped else 1)
    questions = [
        cleaned
        for q in output.questions
        if q.type in req.types and (cleaned := _clean_question(q, valid_pages, fallback_page))
    ][: req.count]
    if not questions:
        raise LLMError("The AI couldn't write valid questions from these notes. Try again or add more notes.", 502)

    quiz = Quiz(project_id=req.project_id, scope=req.scope, difficulty=level, questions_json=json.dumps(questions))
    session.add(quiz)
    session.commit()
    return {
        "quiz_id": quiz.id,
        "difficulty": level,
        "adaptive_reason": reason,
        "focus_topics": focus,
        "questions": [_public_question(i, q) for i, q in enumerate(questions)],
        "unread_pages": unread_pages(scoped),
    }


# --------------------------------------------------------------------------- answering


def _result(attempt: QuizAttempt, question: dict[str, Any], feedback: str, missing: list[str], verdict: str) -> dict[str, Any]:
    return {
        "correct": attempt.correct,
        "score": attempt.score,
        "verdict": verdict,
        "feedback": feedback,
        "missing_points": missing,
        "correct_answer": question["answer"],
        "explanation": question["explanation"],
        "source_page": question["source_page"],
        "source_page_id": question.get("source_page_id"),
    }


async def answer_question(session: Session, llm: LLMAdapter, quiz_id: str, req: AnswerRequest) -> dict[str, Any]:
    quiz = session.get(Quiz, quiz_id)
    if quiz is None:
        raise HTTPException(status_code=404, detail="Quiz not found")
    questions = json.loads(quiz.questions_json)
    if req.question_index >= len(questions):
        raise HTTPException(status_code=400, detail="Question index out of range")
    question = questions[req.question_index]

    existing = session.exec(
        select(QuizAttempt).where(QuizAttempt.quiz_id == quiz_id, QuizAttempt.question_index == req.question_index)
    ).first()
    if existing is not None:
        verdict = "correct" if existing.correct else ("partial" if existing.score >= 0.4 else "incorrect")
        return _result(existing, question, "You already answered this question.", [], verdict)

    if question["type"] in ("mcq", "tf"):
        correct = _norm(req.user_answer) == _norm(question["answer"])
        score, verdict, missing = (1.0 if correct else 0.0), ("correct" if correct else "incorrect"), []
        feedback = "Correct!" if correct else f"Not quite. The answer is: {question['answer']}"
    else:
        if not req.user_answer.strip():
            raise HTTPException(status_code=400, detail="Write an answer first")
        grade = await _grade_short(session, llm, quiz, question, req.user_answer)
        score, verdict, feedback, missing = grade.score, grade.verdict, grade.feedback, grade.missing_points
        correct = verdict == "correct"

    attempt = QuizAttempt(
        quiz_id=quiz_id,
        project_id=quiz.project_id,
        question_index=req.question_index,
        topic=question["topic"],
        difficulty=question["difficulty"],
        source_page=question["source_page"],
        user_answer=req.user_answer[:4000],
        correct=correct,
        score=round(score, 3),
    )
    session.add(attempt)
    session.commit()
    return _result(attempt, question, feedback, missing, verdict)


async def _grade_short(session: Session, llm: LLMAdapter, quiz: Quiz, question: dict[str, Any], user_answer: str) -> GradeOutput:
    project = get_project(session, quiz.project_id)
    docs = load_docs(session, quiz.project_id, question.get("source_page_id"))
    relevant = [d for d in docs if d.page_id == question.get("source_page_id")] or docs
    parts = [
        TextPart(build_notes_block(project.name, relevant)),
        TextPart(
            f"Question: {question['question']}\nModel answer: {question['answer']}\n"
            f"Student's answer: {user_answer}"
        ),
    ]
    return await llm.generate_json(system=prompts.GRADE_SYSTEM, parts=parts, schema=GradeOutput, temperature=0.0)


# --------------------------------------------------------------------------- flashcards


def flashcard_out(card: Flashcard) -> dict[str, Any]:
    return {
        "id": card.id,
        "front": card.front,
        "back": card.back,
        "source_page": card.source_page,
        "topic": card.topic,
        "box": card.box,
        "due_at": _aware(card.due_at).isoformat(),  # always UTC with offset, fresh or loaded from SQLite
    }


def list_flashcards(session: Session, project_id: str) -> list[dict[str, Any]]:
    get_project(session, project_id)
    cards = session.exec(
        select(Flashcard).where(Flashcard.project_id == project_id).order_by(col(Flashcard.box), col(Flashcard.due_at))
    )
    return [flashcard_out(c) for c in cards]


async def generate_flashcards(session: Session, llm: LLMAdapter, req: FlashcardsRequest) -> dict[str, Any]:
    project, _docs, scoped = scoped_docs(session, req.project_id, req.page_id, req.scope)
    if not has_any_content(scoped, req.selection):
        raise HTTPException(status_code=400, detail="There are no notes in this scope to make flashcards from.")
    parts = context_parts(project, scoped, req.scope, req.selection)
    request = f"Make {req.count} flashcards."
    if req.focus_topics:
        request += f" Focus on: {', '.join(req.focus_topics)}."
    parts.append(TextPart(request))
    output = await llm.generate_json(system=prompts.FLASHCARDS_SYSTEM, parts=parts, schema=FlashcardsOutput, temperature=0.4)

    existing = {_norm(c.front) for c in session.exec(select(Flashcard).where(Flashcard.project_id == req.project_id))}
    valid_pages = {d.number for d in scoped}
    created: list[Flashcard] = []
    for card in output.cards[: req.count]:
        if not card.front.strip() or not card.back.strip() or _norm(card.front) in existing:
            continue
        existing.add(_norm(card.front))
        created.append(
            Flashcard(
                project_id=req.project_id,
                front=card.front.strip(),
                back=card.back.strip(),
                source_page=card.source_page if card.source_page in valid_pages else None,
                topic=card.topic.strip(),
            )
        )
    session.add_all(created)
    session.commit()
    return {"created": [flashcard_out(c) for c in created], "unread_pages": unread_pages(scoped)}


def review_flashcard(session: Session, card_id: str, result: str) -> dict[str, Any]:
    card = session.get(Flashcard, card_id)
    if card is None:
        raise HTTPException(status_code=404, detail="Flashcard not found")
    card.box, card.due_at = leitner_next(card.box, result, utcnow())
    session.add(card)
    session.commit()
    return flashcard_out(card)


def delete_flashcard(session: Session, card_id: str) -> None:
    card = session.get(Flashcard, card_id)
    if card is None:
        raise HTTPException(status_code=404, detail="Flashcard not found")
    session.delete(card)
    session.commit()


# --------------------------------------------------------------------------- insights


def insights(session: Session, project_id: str) -> dict[str, Any]:
    get_project(session, project_id)
    attempts = list(
        session.exec(select(QuizAttempt).where(QuizAttempt.project_id == project_id).order_by(col(QuizAttempt.answered_at)))
    )
    stats = topic_stats(attempts)
    quizzes = list(session.exec(select(Quiz).where(Quiz.project_id == project_id).order_by(col(Quiz.created_at))))
    by_quiz: dict[str, list[float]] = {}
    for attempt in attempts:
        by_quiz.setdefault(attempt.quiz_id, []).append(attempt.score)
    recent = [
        {
            "quiz_id": q.id,
            "created_at": q.created_at.isoformat(),
            "difficulty": q.difficulty,
            "answered": len(by_quiz[q.id]),
            "score": round(sum(by_quiz[q.id]) / len(by_quiz[q.id]), 3),
        }
        for q in quizzes
        if q.id in by_quiz
    ][-10:]
    cards = list(session.exec(select(Flashcard).where(Flashcard.project_id == project_id)))
    boxes = {str(b): 0 for b in range(1, 6)}
    for card in cards:
        boxes[str(card.box)] += 1
    now = utcnow()
    due = sum(1 for c in cards if _aware(c.due_at) <= now)

    def stat_out(s: Any) -> dict[str, Any]:
        return {"topic": s.topic, "attempts": s.attempts, "correct": s.correct, "accuracy": s.accuracy, "source_pages": list(s.source_pages)}

    return {
        "total_answers": len(attempts),
        "overall_accuracy": round(sum(a.score for a in attempts) / len(attempts), 3) if attempts else None,
        "topics": [stat_out(s) for s in stats],
        "weak_topics": [stat_out(s) for s in weak_topics(stats)],
        "strong_topics": [stat_out(s) for s in strong_topics(stats)],
        "recent_quizzes": recent,
        "flashcards": {"total": len(cards), "due": due, "boxes": boxes},
    }


def _aware(value: datetime) -> datetime:
    """SQLite drops tz info; treat stored datetimes as UTC."""
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
