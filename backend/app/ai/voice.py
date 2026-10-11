"""Voice tutor on Gemini Live: the spoken prompts, the locked session config and the token.

The browser streams audio to Gemini Live directly (lowest lag, natural interruptions), but only
with a single-use token minted here. The token locks the model, the instructions (which carry
the student's notes) and the tools, so the browser can't repurpose it and never sees the API key.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Literal, Protocol

import httpx
from fastapi import HTTPException
from sqlmodel import Session

from ..config import settings
from ..schemas import VoiceSessionRequest
from . import prompts
from .context import PageDoc, build_notes_block, has_any_content, scope_description
from .llm_adapter import LLMError, translate_error
from .service import cap_pages, scoped_docs, unread_pages

logger = logging.getLogger(__name__)

VoiceMode = Literal["viva", "explain", "buddy"]
VIVA_QUESTIONS = 5

SPOKEN_STYLE = """You are talking out loud with a student in real time.
- Keep every turn to 2-4 short sentences, then stop and let the student speak.
- Never read out markdown, bullet symbols, LaTeX or links. Say formulas in words.
- Say page references as "page 3".
- Reply in the language the student speaks.
- If the student interrupts, stop and respond to what they just said."""

MODE_PROMPTS: dict[str, str] = {
    "viva": f"""You are a friendly examiner running a viva (an oral exam) on the student's notes in <notes>.
- Ask ONE question at a time, drawn only from the notes, most important topics first. Then wait for the answer.
- If an answer is vague or partly wrong, ask one short follow-up. Then give the correct point from the notes in a sentence, with its page, and move on.
- Never give the answer before the student has tried. Never ask about anything the notes don't cover.
- After about {VIVA_QUESTIONS} questions, or as soon as the student asks to stop, give a two-sentence spoken verdict and then call finish_viva.
- Begin by greeting the student in one sentence and asking question 1.""",
    "explain": """You are a patient tutor explaining concepts from the student's notes in <notes>.
- Explain with the notes' own terms first, in plain spoken language, with one everyday analogy.
- Then check understanding with one quick question.
- If the notes don't cover something, say "your notes don't cover this" before explaining it from general knowledge.
- Begin by greeting the student in one sentence and asking what they'd like explained, suggesting one topic from the notes.""",
    "buddy": """You are a study buddy helping the student learn the notes in <notes> by thinking, not by being told.
- Answer with hints and guiding questions that lead to the answer. Give the full answer only if the student asks for it twice.
- Praise specific correct reasoning. Point out mistakes gently, with a nudge from the notes.
- If the notes don't cover something, say so before using general knowledge.
- Begin by greeting the student in one sentence and asking what they're working on.""",
}

FINISH_VIVA: dict[str, Any] = {
    "name": "finish_viva",
    "description": "Report the result once the viva is over, right after the spoken verdict.",
    "parameters_json_schema": {
        "type": "object",
        "properties": {
            "score": {"type": "integer", "minimum": 0, "maximum": 10, "description": "Overall score out of 10."},
            "summary": {"type": "string", "description": "One-sentence verdict."},
            "topics": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "topic": {"type": "string"},
                        "verdict": {"type": "string", "enum": ["strong", "shaky", "missed"]},
                    },
                    "required": ["topic", "verdict"],
                },
            },
        },
        "required": ["score", "summary", "topics"],
    },
}


def build_voice_instruction(mode: VoiceMode, project_name: str, scoped: list[PageDoc], scope: str) -> str:
    return "\n\n".join(
        [
            MODE_PROMPTS[mode],
            SPOKEN_STYLE,
            prompts.PAGE_SEMANTICS,
            prompts.NOTES_ARE_DATA,
            scope_description(scope, scoped),
            build_notes_block(project_name, scoped),
        ]
    )


def live_config(mode: VoiceMode, instruction: str, voice: str) -> dict[str, Any]:
    """Everything the token locks. Session resumption is left to the browser (it sends its handle)."""
    config: dict[str, Any] = {
        "response_modalities": ["AUDIO"],
        "system_instruction": instruction,
        "speech_config": {"voice_config": {"prebuilt_voice_config": {"voice_name": voice}}},
        "input_audio_transcription": {},
        "output_audio_transcription": {},
        "context_window_compression": {"sliding_window": {}},
    }
    if mode == "viva":
        config["tools"] = [{"function_declarations": [FINISH_VIVA]}]
    return config


# --------------------------------------------------------------------------- tokens

TOKEN_LIFETIME = timedelta(minutes=30)
TOKEN_START_WINDOW = timedelta(minutes=1)
NOT_CONFIGURED = "AI is not configured. Add GEMINI_API_KEY to backend/.env and restart."
EMPTY_VIVA = "Nothing to examine yet. Write or import some notes first, or switch to Explain."
UNREAD_VIVA = "The handwriting here hasn't been read yet. Open 'What the AI sees' and press Re-read."


class TokenMinter(Protocol):
    async def mint(self, *, model: str, config: dict[str, Any]) -> str: ...


class GeminiTokenMinter:
    def __init__(self, api_key: str):
        from google import genai  # imported lazily so tests never need the SDK configured

        self._client = genai.Client(api_key=api_key)

    async def mint(self, *, model: str, config: dict[str, Any]) -> str:
        from google.genai import errors as genai_errors
        from google.genai import types

        now = datetime.now(timezone.utc)
        try:
            token = await self._client.aio.auth_tokens.create(
                config=types.CreateAuthTokenConfig(
                    uses=1,
                    expire_time=now + TOKEN_LIFETIME,
                    new_session_expire_time=now + TOKEN_START_WINDOW,
                    live_connect_constraints=types.LiveConnectConstraints(model=model, config=config),
                    lock_additional_fields=[],  # lock exactly what we set; the browser adds its resume handle
                )
            )
        except (genai_errors.APIError, httpx.TimeoutException, httpx.TransportError) as exc:
            logger.warning("Voice token mint failed: %r", exc)
            raise translate_error(exc) from exc
        if not token.name:
            raise LLMError("Gemini didn't return a voice session token. Try again.", 502)
        return token.name


class NotConfiguredMinter:
    async def mint(self, **_: Any) -> str:
        raise LLMError(NOT_CONFIGURED, 503)


def build_minter(api_key: str) -> TokenMinter:
    return GeminiTokenMinter(api_key) if api_key else NotConfiguredMinter()


async def start_session(session: Session, minter: TokenMinter, req: VoiceSessionRequest) -> dict[str, Any]:
    project, _docs, scoped = scoped_docs(session, req.project_id, req.page_id, req.scope)
    scoped = cap_pages(scoped)
    if req.mode == "viva" and not has_any_content(scoped):
        raise HTTPException(status_code=400, detail=UNREAD_VIVA if any(d.unread for d in scoped) else EMPTY_VIVA)
    instruction = build_voice_instruction(req.mode, project.name, scoped, req.scope)
    token = await minter.mint(model=settings.voice_model, config=live_config(req.mode, instruction, settings.voice_name))
    return {
        "token": token,
        "model": settings.voice_model,
        "mode": req.mode,
        "scope": req.scope,
        "unread_pages": unread_pages(scoped),
    }
