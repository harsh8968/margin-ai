"""Voice tutor endpoint: mints a locked, single-use Gemini Live token for the browser."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlmodel import Session

from ..ai import voice
from ..db import get_session
from ..http import ai_rate_limit, ok
from ..schemas import VoiceSessionRequest

router = APIRouter(prefix="/api", tags=["voice"])


def get_minter(request: Request) -> voice.TokenMinter:
    return request.app.state.voice_minter


@router.post("/voice/session", dependencies=[Depends(ai_rate_limit)])
async def start_voice_session(
    body: VoiceSessionRequest,
    session: Session = Depends(get_session),
    minter: voice.TokenMinter = Depends(get_minter),
):
    return ok(await voice.start_session(session, minter, body))
