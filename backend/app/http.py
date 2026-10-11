"""Shared HTTP plumbing: the response envelope, LLM dependency and a tiny rate limiter."""

from __future__ import annotations

import time
from collections import defaultdict, deque
from typing import Any

from fastapi import HTTPException, Request

from .ai.llm_adapter import LLMAdapter

AI_REQUESTS_PER_MINUTE = 40


def ok(data: Any = None) -> dict[str, Any]:
    """Every endpoint answers with {success, data, error} (doc §14)."""
    return {"success": True, "data": data, "error": None}


def fail(message: str) -> dict[str, Any]:
    return {"success": False, "data": None, "error": message}


def get_llm(request: Request) -> LLMAdapter:
    return request.app.state.llm


class SlidingWindowLimiter:
    """Per-client limit on AI calls so a stuck UI loop can't burn the API quota."""

    def __init__(self, limit: int, window_seconds: float = 60.0):
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str) -> None:
        now = time.monotonic()
        hits = self._hits[key]
        while hits and now - hits[0] > self.window:
            hits.popleft()
        if len(hits) >= self.limit:
            raise HTTPException(status_code=429, detail="Too many AI requests. Wait a moment and try again.")
        hits.append(now)


def ai_rate_limit(request: Request) -> None:
    limiter: SlidingWindowLimiter = request.app.state.ai_limiter
    client = request.client.host if request.client else "unknown"
    limiter.check(client)
