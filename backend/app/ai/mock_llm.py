"""A deterministic stand-in for the LLM (LLM_PROVIDER=mock).

It reads the same <notes> packet the real model gets and answers with simple keyword
matching. It exists so the UI can be developed and tested without an API key. It is
not smart, and /api/health reports it clearly so nobody mistakes it for the real AI.
"""

from __future__ import annotations

import re
from typing import TypeVar

from pydantic import BaseModel

from ..schemas import (
    AskOutput,
    FlashcardOut,
    FlashcardsOutput,
    GeneralOutput,
    GradeOutput,
    LLMCitation,
    QuizOutput,
    QuizQuestionOut,
    Recommendation,
    RecommendOutput,
    RefineOutput,
    RevisionOutput,
    SummaryOutput,
)
from .llm_adapter import Part, TextPart

T = TypeVar("T", bound=BaseModel)

_PAGE = re.compile(r'<page n="(\d+)" title="([^"]*)"[^>]*>\n(.*?)\n</page>', re.DOTALL)
_STOP = set(
    "a an the is are was were be of to in on for and or with what why how does do did this that these those "
    "it its as by from at which who whom explain define tell me about my notes page please can you give".split()
)


def _text(parts: list[Part]) -> str:
    return "\n".join(p.text for p in parts if isinstance(p, TextPart))


def _pages(parts: list[Part]) -> list[tuple[int, str, str]]:
    pages = []
    for number, title, body in _PAGE.findall(_text(parts)):
        if body.startswith("(This page"):
            body = ""
        pages.append((int(number), title, body.strip()))
    return pages


def _sentences(body: str) -> list[str]:
    chunks = re.split(r"(?<=[.!?])\s+|\n+", body)
    return [c.strip(" -*#\t") for c in chunks if len(c.strip(" -*#\t").split()) >= 3]


def _words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", text.lower()) if w not in _STOP and len(w) > 2}


def _after(label: str, text: str) -> str:
    match = re.search(rf"{label}:\s*(.+)", text)
    return match.group(1).strip() if match else ""


class MockAdapter:
    name = "mock"

    async def generate_text(self, *, system: str, parts: list[Part], temperature: float = 0.2) -> str:
        typed = re.findall(r"^- (.+)$", _text(parts), re.MULTILINE)
        body = "\n\n".join(typed) if typed else "[handwriting - mock transcript]"
        return f"{body}\n\n[Diagram: mock description of any drawings]"

    async def generate_json(self, *, system: str, parts: list[Part], schema: type[T], temperature: float = 0.3) -> T:
        handler = getattr(self, f"_{schema.__name__}", None)
        if handler is None:
            raise NotImplementedError(schema.__name__)
        return handler(parts)

    # -- handlers ---------------------------------------------------------------------------

    def _AskOutput(self, parts: list[Part]) -> AskOutput:
        question = _after("Student's question", _text(parts))
        wanted = _words(question)
        best: tuple[int, int, str] | None = None
        for number, _title, body in _pages(parts):
            for sentence in _sentences(body):
                score = len(wanted & _words(sentence))
                if score and (best is None or score > best[0]):
                    best = (score, number, sentence)
        if best is None:
            return AskOutput(answer_markdown="", citations=[], grounding="not_in_notes",
                             missing_info=f"Your notes don't mention: {question}")
        _, number, sentence = best
        quote = " ".join(sentence.split()[:15])
        return AskOutput(
            answer_markdown=f"According to your notes, {sentence} [p.{number}]",
            citations=[LLMCitation(page=number, quote=quote)],
            grounding="grounded" if best[0] >= 2 or len(wanted) <= 1 else "partial",
            missing_info="" if best[0] >= 2 else "Only part of the question appears in your notes.",
        )

    def _GeneralOutput(self, parts: list[Part]) -> GeneralOutput:
        question = _after("Student's question", _text(parts))
        return GeneralOutput(answer_markdown=f"(Mock) A general explanation of **{question}** would appear here.")

    def _SummaryOutput(self, parts: list[Part]) -> SummaryOutput:
        bullets, used = [], []
        for number, title, body in _pages(parts):
            sentences = _sentences(body)
            if sentences:
                used.append(number)
                bullets.append(f"- **{title}**: {sentences[0]} [p.{number}]")
        return SummaryOutput(summary_markdown="\n".join(bullets) or "Nothing to summarise.", pages_used=used)

    def _QuizOutput(self, parts: list[Part]) -> QuizOutput:
        match = re.search(r"Create (\d+) questions", _text(parts))
        count = int(match.group(1)) if match else 5
        facts = [(n, t, s) for n, t, body in _pages(parts) for s in _sentences(body)]
        questions: list[QuizQuestionOut] = []
        kinds = ["mcq", "tf", "short"]
        for i, (number, title, sentence) in enumerate(facts[:count]):
            kind = kinds[i % 3]
            words = sentence.split()
            if kind == "mcq":
                options = [" ".join(words[:6]), "None of these", "All of these", "It is not defined"]
                questions.append(QuizQuestionOut(type="mcq", question=f"Which statement appears in your notes on {title}?",
                                                 options=options, answer=options[0], explanation=f"See p.{number}.",
                                                 source_page=number, topic=title or "General", difficulty=1))
            elif kind == "tf":
                questions.append(QuizQuestionOut(type="tf", question=f"True or false: {sentence}", options=["True", "False"],
                                                 answer="True", explanation=f"Stated on p.{number}.", source_page=number,
                                                 topic=title or "General", difficulty=1))
            else:
                questions.append(QuizQuestionOut(type="short", question=f"In your own words: what do your notes say about {title}?",
                                                 options=[], answer=sentence, explanation=f"From p.{number}.", source_page=number,
                                                 topic=title or "General", difficulty=2))
        return QuizOutput(questions=questions)

    def _GradeOutput(self, parts: list[Part]) -> GradeOutput:
        text = _text(parts)
        expected, given = _words(_after("Model answer", text)), _words(_after("Student's answer", text))
        score = round(len(expected & given) / max(1, len(expected)), 2)
        verdict = "correct" if score >= 0.8 else "partial" if score >= 0.4 else "incorrect"
        missing = sorted(expected - given)[:3]
        return GradeOutput(score=score, verdict=verdict, feedback=f"(Mock grade) You covered {score:.0%} of the key words.",
                           missing_points=missing)

    def _RefineOutput(self, parts: list[Part]) -> RefineOutput:
        text = _text(parts)
        typed = re.findall(r"^- (.+)$", text.split("<selection>")[-1], re.MULTILINE) if "<selection>" in text else []
        source = "\n".join(typed) or "\n".join(body for _, _, body in _pages(parts))
        bullets = "\n".join(f"- {s}" for s in _sentences(source)) or source
        return RefineOutput(original_reading=source, proposed_markdown=f"**Refined (mock)**\n\n{bullets}",
                            change_summary="Mock: split into bullet points.")

    def _FlashcardsOutput(self, parts: list[Part]) -> FlashcardsOutput:
        cards = [
            FlashcardOut(front=f"{title}: complete the idea - {' '.join(s.split()[:4])}...", back=s, source_page=n, topic=title)
            for n, title, body in _pages(parts)
            for s in _sentences(body)[:3]
        ]
        return FlashcardsOutput(cards=cards)

    def _RevisionOutput(self, parts: list[Part]) -> RevisionOutput:
        lines = ["## Must-remember points"] + [
            f"- {(_sentences(body) or [title])[0]} [p.{n}]" for n, title, body in _pages(parts) if body
        ]
        return RevisionOutput(title="Quick revision sheet (mock)", sheet_markdown="\n".join(lines))

    def _RecommendOutput(self, parts: list[Part]) -> RecommendOutput:
        pages = _pages(parts)
        recs = [Recommendation(topic=title or f"Page {n}", why="(Mock) Central topic in your notes.",
                               action="Reread and try a quiz.", pages=[n]) for n, title, _ in pages[:3]]
        questions = [f"Explain {title}." for _, title, _ in pages[:3]]
        return RecommendOutput(recommendations=recs, practice_questions=questions)

