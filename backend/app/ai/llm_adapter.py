"""One small interface in front of the LLM provider.

Everything else in the app calls `generate_json` / `generate_text` and never touches the
Gemini SDK directly, so swapping providers (or using the mock in tests) is one line.
"""

from __future__ import annotations

import base64
import binascii
import json
import logging
import re
from dataclasses import dataclass
from typing import Any, Protocol, TypeVar

import httpx
from pydantic import BaseModel, ValidationError

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

RETRYABLE_CODES = {429, 500, 502, 503, 504}
REQUEST_TIMEOUT_MS = 60_000


@dataclass(frozen=True)
class TextPart:
    text: str


@dataclass(frozen=True)
class ImagePart:
    data: bytes
    mime_type: str


Part = TextPart | ImagePart


class LLMError(Exception):
    """An LLM failure with a message that is safe to show the student."""

    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.user_message = message
        self.status_code = status_code


class LLMAdapter(Protocol):
    name: str

    async def generate_json(
        self, *, system: str, parts: list[Part], schema: type[T], temperature: float = 0.3
    ) -> T: ...

    async def generate_text(self, *, system: str, parts: list[Part], temperature: float = 0.2) -> str: ...


# --------------------------------------------------------------------------- helpers

_DATA_URL = re.compile(r"^data:(image/(?:png|jpeg|webp));base64,(.+)$", re.DOTALL)


def decode_data_url(data_url: str, max_bytes: int) -> ImagePart:
    """Turn `data:image/jpeg;base64,...` into raw bytes, rejecting anything odd."""
    match = _DATA_URL.match(data_url.strip())
    if not match:
        raise ValueError("Image must be a base64 PNG, JPEG or WebP data URL")
    mime_type, payload = match.groups()
    try:
        raw = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("Image data is not valid base64") from exc
    if len(raw) > max_bytes:
        raise ValueError(f"Image is too large ({len(raw) // 1024} KB)")
    return ImagePart(data=raw, mime_type=mime_type)


def inline_refs(schema: dict[str, Any]) -> dict[str, Any]:
    """Pydantic emits `$defs` + `$ref`; inline them so any JSON-schema dialect accepts it."""
    defs = schema.get("$defs", {})

    def resolve(node: Any) -> Any:
        if isinstance(node, dict):
            if "$ref" in node:
                ref_name = node["$ref"].split("/")[-1]
                return resolve(defs[ref_name])
            return {k: resolve(v) for k, v in node.items() if k not in ("$defs", "title")}
        if isinstance(node, list):
            return [resolve(item) for item in node]
        return node

    return resolve(schema)


def strip_code_fences(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return text.strip()


# --------------------------------------------------------------------------- Gemini


class GeminiAdapter:
    name = "gemini"

    def __init__(self, api_key: str, model: str, fallback_model: str | None = None):
        from google import genai  # imported lazily so tests never need the SDK configured
        from google.genai import types

        # The SDK default is "wait forever"; a stalled call must fail instead of hanging the UI.
        self._client = genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=REQUEST_TIMEOUT_MS))
        self.model = model
        self.fallback_model = fallback_model if fallback_model and fallback_model != model else None

    def _contents(self, parts: list[Part]) -> list[Any]:
        from google.genai import types

        out: list[Any] = []
        for part in parts:
            if isinstance(part, ImagePart):
                out.append(types.Part.from_bytes(data=part.data, mime_type=part.mime_type))
            else:
                out.append(types.Part.from_text(text=part.text))
        return [types.Content(role="user", parts=out)]

    async def _generate(self, parts: list[Part], config: Any) -> str:
        from google.genai import errors as genai_errors

        models = [self.model] + ([self.fallback_model] if self.fallback_model else [])
        last_error: Exception | None = None
        for model in models:
            try:
                response = await self._client.aio.models.generate_content(
                    model=model, contents=self._contents(parts), config=config
                )
                text = response.text or ""
                if not text.strip():
                    raise LLMError("The AI returned an empty response. Try again.", 502)
                return text
            except genai_errors.APIError as exc:
                last_error = exc
                logger.warning("Gemini %s failed with %s: %s", model, exc.code, exc.message)
                if exc.code in RETRYABLE_CODES or exc.code == 404:
                    continue  # rate-limited, overloaded or unknown model -> try the fallback
                raise translate_error(exc) from exc
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                last_error = exc
                logger.warning("Gemini %s network failure: %r", model, exc)
        assert last_error is not None
        raise translate_error(last_error) from last_error

    async def generate_json(
        self, *, system: str, parts: list[Part], schema: type[T], temperature: float = 0.3
    ) -> T:
        from google.genai import types

        json_schema = inline_refs(schema.model_json_schema())
        config = types.GenerateContentConfig(
            system_instruction=system,
            temperature=temperature,
            response_mime_type="application/json",
            response_json_schema=json_schema,
        )
        try:
            text = await self._generate(parts, config)
        except LLMError as exc:
            # Some model versions reject parts of a schema. Fall back to "JSON mode" with the
            # schema described in the prompt; pydantic still validates the result below.
            if exc.status_code != 400:
                raise
            schema_hint = f"\n\nReturn ONLY JSON matching this JSON Schema:\n{json.dumps(json_schema)}"
            config = types.GenerateContentConfig(
                system_instruction=system + schema_hint,
                temperature=temperature,
                response_mime_type="application/json",
            )
            text = await self._generate(parts, config)

        try:
            return schema.model_validate_json(strip_code_fences(text))
        except ValidationError as first_error:
            logger.warning("LLM JSON failed validation, asking it to repair: %s", first_error)
            repair = parts + [
                TextPart(
                    "Your previous reply did not match the required JSON schema. "
                    f"Errors: {first_error.errors(include_url=False)[:5]}. Reply again with valid JSON only."
                )
            ]
            text = await self._generate(repair, config)
            try:
                return schema.model_validate_json(strip_code_fences(text))
            except ValidationError as exc:
                raise LLMError("The AI returned an answer in an unexpected format. Try again.", 502) from exc

    async def generate_text(self, *, system: str, parts: list[Part], temperature: float = 0.2) -> str:
        from google.genai import types

        config = types.GenerateContentConfig(system_instruction=system, temperature=temperature)
        return (await self._generate(parts, config)).strip()


def translate_error(exc: Exception) -> LLMError:
    if isinstance(exc, httpx.TimeoutException):
        return LLMError("The AI took too long to answer. Try again.", 504)
    if isinstance(exc, httpx.TransportError):
        return LLMError("Couldn't reach the AI service. Check the internet connection.", 502)
    code = getattr(exc, "code", 502)
    message = (getattr(exc, "message", "") or "").lower()
    if code == 429:
        return LLMError("Gemini rate limit reached. Wait a few seconds and try again.", 429)
    if code in (401, 403) or "api key" in message:
        return LLMError("Gemini rejected the API key. Check GEMINI_API_KEY in backend/.env.", 503)
    if code == 400:
        return LLMError("Gemini could not process this request.", 400)
    if code == 404:
        return LLMError("The configured Gemini model was not found. Check GEMINI_MODEL.", 503)
    return LLMError("The AI service is unavailable right now. Try again shortly.", 502)


class NotConfiguredAdapter:
    """Used when no API key is set: every AI call fails with a clear setup message."""

    name = "not-configured"

    async def generate_json(self, **_: Any) -> Any:
        raise LLMError("AI is not configured. Add GEMINI_API_KEY to backend/.env and restart.", 503)

    async def generate_text(self, **_: Any) -> str:
        raise LLMError("AI is not configured. Add GEMINI_API_KEY to backend/.env and restart.", 503)


def build_adapter(provider: str, api_key: str, model: str, fallback_model: str) -> LLMAdapter:
    if provider == "mock":
        from .mock_llm import MockAdapter

        return MockAdapter()
    if not api_key:
        return NotConfiguredAdapter()
    return GeminiAdapter(api_key=api_key, model=model, fallback_model=fallback_model)
