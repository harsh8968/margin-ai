"""Database tables (PS6 doc §8).

Pages store their drawing as a vector element list (`elements_json`), never as pixels.
`content_hash` changes whenever the elements change, which is how a PageTranscript
("what the AI sees") knows it has gone stale.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, LargeBinary
from sqlmodel import Field, SQLModel

PAGE_WIDTH = 1240  # A4 at 150 DPI, in logical units
PAGE_HEIGHT = 1754


def new_id() -> str:
    return uuid.uuid4().hex


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Project(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    name: str
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class Page(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    project_id: str = Field(foreign_key="project.id", index=True, ondelete="CASCADE")
    title: str
    order: int = Field(index=True)
    width: int = PAGE_WIDTH
    height: int = PAGE_HEIGHT
    background: str = "ruled"  # ruled | grid | dots | blank
    elements_json: str = "[]"
    content_hash: str = ""
    thumbnail: str | None = None  # small JPEG data URL for the sidebar
    deleted_at: datetime | None = None  # soft delete so "Undo" can restore it
    updated_at: datetime = Field(default_factory=utcnow)


class PageTranscript(SQLModel, table=True):
    page_id: str = Field(foreign_key="page.id", primary_key=True, ondelete="CASCADE")
    content_hash: str
    transcript_md: str
    source: str = "vision"  # vision | typed | seed | user
    user_corrected: bool = False
    created_at: datetime = Field(default_factory=utcnow)


class ChatMessage(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    project_id: str = Field(foreign_key="project.id", index=True, ondelete="CASCADE")
    page_id: str | None = None
    scope: str
    role: str  # user | assistant
    content: str
    citations_json: str = "[]"
    grounding: str | None = None
    missing_info: str | None = None
    created_at: datetime = Field(default_factory=utcnow)


class Quiz(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    project_id: str = Field(foreign_key="project.id", index=True, ondelete="CASCADE")
    scope: str
    difficulty: str
    questions_json: str
    created_at: datetime = Field(default_factory=utcnow)


class QuizAttempt(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    quiz_id: str = Field(foreign_key="quiz.id", index=True, ondelete="CASCADE")
    project_id: str = Field(foreign_key="project.id", index=True, ondelete="CASCADE")
    question_index: int
    topic: str
    difficulty: int
    source_page: int | None = None
    user_answer: str
    correct: bool
    score: float
    answered_at: datetime = Field(default_factory=utcnow)


class Flashcard(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    project_id: str = Field(foreign_key="project.id", index=True, ondelete="CASCADE")
    front: str
    back: str
    source_page: int | None = None
    topic: str = ""
    box: int = 1  # Leitner box 1..5
    due_at: datetime = Field(default_factory=utcnow)
    created_at: datetime = Field(default_factory=utcnow)


class Asset(SQLModel, table=True):
    """Binary files for imported pages (PDF page renders, photos). Kept out of elements_json
    so autosaving a page never re-uploads its background image."""

    id: str = Field(default_factory=new_id, primary_key=True)
    project_id: str = Field(foreign_key="project.id", index=True, ondelete="CASCADE")
    mime: str
    size: int
    data: bytes = Field(sa_column=Column(LargeBinary, nullable=False))
    created_at: datetime = Field(default_factory=utcnow)
