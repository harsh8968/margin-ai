"""Request/response models and the JSON schemas we force the LLM to follow.

Two families live here:
  * API models  - validate what the browser sends us (system boundary).
  * LLM models  - passed to Gemini as `response_json_schema`, then used to validate
                  whatever comes back. If the model returns junk, validation fails loudly
                  instead of a broken answer reaching the student.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, SerializerFunctionWrapHandler, model_serializer

Scope = Literal["selection", "page", "project"]
GroundingLabel = Literal["grounded", "partial", "not_in_notes"]
QuestionType = Literal["mcq", "tf", "short"]
Difficulty = Literal["easy", "medium", "hard", "adaptive"]
RefineAction = Literal["simplify", "grammar", "structure", "improve", "exam"]
SummaryFormat = Literal["short", "detailed", "terms"]

MAX_TEXT = 20_000
MAX_IMAGE_CHARS = 9_000_000  # ~6.5 MB once base64-decoded; rejected before decoding

# --------------------------------------------------------------------------- elements

Point = Annotated[list[float], Field(min_length=2, max_length=3)]


class StrokeElement(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(min_length=1, max_length=64)
    type: Literal["stroke"]
    tool: Literal["pen", "highlighter"] = "pen"
    points: list[Point] = Field(max_length=20_000)
    color: str = Field(default="#1f2a44", max_length=32)
    size: float = Field(default=4, gt=0, le=200)
    opacity: float = Field(default=1, ge=0, le=1)


class EraseElement(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(min_length=1, max_length=64)
    type: Literal["erase"]
    points: list[Point] = Field(max_length=20_000)
    size: float = Field(default=24, gt=0, le=400)


class TextElement(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(min_length=1, max_length=64)
    type: Literal["text"]
    x: float
    y: float
    width: float = Field(default=600, gt=0, le=5000)
    text: str = Field(max_length=MAX_TEXT)
    font_size: float = Field(default=28, gt=0, le=400)
    color: str = Field(default="#1f2a44", max_length=32)


class ImageElement(BaseModel):
    """An imported PDF page or photo, used as the paper the student writes over.

    `src` may only point at our own asset store, never an external URL. `text` holds the
    PDF's text layer when there is one, so the AI can read it exactly. `needs_vision` marks
    pages whose pictures or drawings carry content that text layer misses.
    """

    model_config = ConfigDict(extra="ignore")
    id: str = Field(min_length=1, max_length=64)
    type: Literal["image"]
    x: float
    y: float
    width: float = Field(gt=0, le=5000)
    height: float = Field(gt=0, le=5000)
    src: str = Field(pattern=r"^/api/assets/[0-9a-f]{32}$")
    text: str = Field(default="", max_length=60_000)
    name: str = Field(default="", max_length=200)
    needs_vision: bool = False

    @model_serializer(mode="wrap")
    def _omit_unset_flag(self, handler: SerializerFunctionWrapHandler) -> dict[str, Any]:
        # Stored elements of pages imported before this flag existed must hash the same.
        data = handler(self)
        if not data.get("needs_vision"):
            data.pop("needs_vision", None)
        return data


Element = Annotated[StrokeElement | EraseElement | TextElement | ImageElement, Field(discriminator="type")]


class AssetUpload(BaseModel):
    data_url: str = Field(min_length=32, max_length=MAX_IMAGE_CHARS)

# --------------------------------------------------------------------------- projects / pages


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class ProjectUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class ProjectOut(BaseModel):
    id: str
    name: str
    created_at: datetime
    updated_at: datetime
    page_count: int
    cover_thumbnail: str | None


Background = Literal["ruled", "grid", "dots", "blank"]


class PageCreate(BaseModel):
    title: str | None = Field(default=None, max_length=120)
    after_page_id: str | None = None
    background: Background = "ruled"
    elements: list[Element] = Field(default_factory=list, max_length=10_000)


class PageUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    background: Background | None = None
    elements: list[Element] | None = Field(default=None, max_length=10_000)
    thumbnail: str | None = Field(default=None, max_length=400_000)


class PageOut(BaseModel):
    id: str
    project_id: str
    title: str
    order: int
    number: int
    width: int
    height: int
    background: str
    elements: list[dict[str, Any]]
    content_hash: str
    thumbnail: str | None
    updated_at: datetime


class PageOrder(BaseModel):
    page_ids: list[str] = Field(min_length=1, max_length=1_000)


class TranscribeRequest(BaseModel):
    image: str = Field(min_length=32, max_length=MAX_IMAGE_CHARS, description="data:image/jpeg;base64,... of the rendered page")
    content_hash: str = Field(min_length=1, max_length=64)
    force: bool = Field(default=False, description="Re-read even if a fresh transcript exists")


class TranscriptUpdate(BaseModel):
    transcript_md: str = Field(max_length=MAX_TEXT)


class TranscriptOut(BaseModel):
    page_id: str
    number: int
    title: str
    has_ink: bool
    stale: bool
    transcript_md: str | None
    source: str | None
    user_corrected: bool


# --------------------------------------------------------------------------- AI requests


class SelectionPayload(BaseModel):
    image: str | None = Field(default=None, max_length=MAX_IMAGE_CHARS, description="data URL crop of the selected region")
    text_blocks: list[str] = Field(default_factory=list, max_length=200)


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=MAX_TEXT)
    scope: Scope | None = None
    page_id: str | None = None


class AskRequest(BaseModel):
    project_id: str
    page_id: str | None = None
    scope: Scope = "project"
    question: str = Field(min_length=1, max_length=2_000)
    mode: Literal["answer", "explain"] = "answer"
    selection: SelectionPayload | None = None
    history: list[ChatTurn] = Field(default_factory=list, max_length=12)
    allow_general: bool = False


class VoiceSessionRequest(BaseModel):
    project_id: str
    page_id: str | None = None
    scope: Literal["page", "project"] = "project"
    mode: Literal["viva", "explain", "buddy"] = "viva"


class SummarizeRequest(BaseModel):
    project_id: str
    page_id: str | None = None
    scope: Scope = "page"
    format: SummaryFormat = "short"
    selection: SelectionPayload | None = None


class QuizRequest(BaseModel):
    project_id: str
    page_id: str | None = None
    scope: Scope = "project"
    count: int = Field(default=5, ge=1, le=15)
    types: list[QuestionType] = Field(default_factory=lambda: ["mcq", "tf", "short"], min_length=1)
    difficulty: Difficulty = "medium"
    focus_topics: list[str] = Field(default_factory=list, max_length=20)
    selection: SelectionPayload | None = None


class AnswerRequest(BaseModel):
    question_index: int = Field(ge=0)
    user_answer: str = Field(max_length=4_000)


class RefineRequest(BaseModel):
    project_id: str
    page_id: str
    action: RefineAction
    scope: Literal["selection", "page"] = "page"
    selection: SelectionPayload | None = None
    instruction: str | None = Field(default=None, max_length=500)


class FlashcardsRequest(BaseModel):
    project_id: str
    page_id: str | None = None
    scope: Scope = "project"
    count: int = Field(default=8, ge=1, le=20)
    focus_topics: list[str] = Field(default_factory=list, max_length=20)
    selection: SelectionPayload | None = None


class ReviewRequest(BaseModel):
    result: Literal["got_it", "missed"]


class ProjectOnlyRequest(BaseModel):
    project_id: str
    page_id: str | None = None


# --------------------------------------------------------------------------- LLM output schemas


class LLMCitation(BaseModel):
    page: int = Field(description="Page number (n) the quote comes from")
    quote: str = Field(description="Short verbatim quote copied from that page's notes")


class AskOutput(BaseModel):
    answer_markdown: str = Field(description="Answer in markdown. Put [p.N] after claims. Empty if not_in_notes.")
    citations: list[LLMCitation]
    grounding: GroundingLabel
    missing_info: str = Field(description="What the notes do not cover. Empty string if nothing is missing.")


class GeneralOutput(BaseModel):
    answer_markdown: str


class SummaryOutput(BaseModel):
    summary_markdown: str = Field(description="Summary in markdown with [p.N] page references")
    pages_used: list[int]


class QuizQuestionOut(BaseModel):
    type: QuestionType
    question: str
    options: list[str] = Field(description="4 options for mcq; ['True','False'] for tf; [] for short")
    answer: str = Field(description="mcq: the exact correct option text; tf: 'True' or 'False'; short: model answer")
    explanation: str
    source_page: int
    topic: str = Field(description="2-4 word topic label, reused consistently across questions")
    difficulty: int = Field(ge=1, le=3)


class QuizOutput(BaseModel):
    questions: list[QuizQuestionOut]


class GradeOutput(BaseModel):
    score: float = Field(ge=0, le=1)
    verdict: Literal["correct", "partial", "incorrect"]
    feedback: str
    missing_points: list[str]


class RefineOutput(BaseModel):
    original_reading: str = Field(description="The source content exactly as you read it, as plain text")
    proposed_markdown: str
    change_summary: str = Field(description="One line describing what you changed")


class FlashcardOut(BaseModel):
    front: str
    back: str
    source_page: int
    topic: str


class FlashcardsOutput(BaseModel):
    cards: list[FlashcardOut]


class RevisionOutput(BaseModel):
    title: str
    sheet_markdown: str


class Recommendation(BaseModel):
    topic: str
    why: str
    action: str
    pages: list[int]


class RecommendOutput(BaseModel):
    recommendations: list[Recommendation]
    practice_questions: list[str]
