"""The Gemini adapter's retry/fallback/repair logic (with a fake SDK client) and the mock LLM."""

import asyncio
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from google.genai import errors as genai_errors
from sqlmodel import SQLModel

from app.ai.llm_adapter import GeminiAdapter, LLMError, NotConfiguredAdapter, TextPart, build_adapter
from app.ai.mock_llm import MockAdapter
from app.db import create_db, engine
from app.main import create_app
from app.schemas import AskOutput

from .conftest import data

VALID = '{"answer_markdown": "ok [p.1]", "citations": [], "grounding": "partial", "missing_info": ""}'


def api_error(code: int, status: str = "ERR", message: str = "boom") -> genai_errors.APIError:
    return genai_errors.APIError(code, {"error": {"code": code, "status": status, "message": message}})


class FakeModels:
    def __init__(self, script):
        self.script = list(script)
        self.calls = []

    async def generate_content(self, *, model, contents, config):
        self.calls.append(SimpleNamespace(model=model, config=config))
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return SimpleNamespace(text=item)


def adapter_with(script) -> tuple[GeminiAdapter, FakeModels]:
    adapter = GeminiAdapter.__new__(GeminiAdapter)
    adapter.model, adapter.fallback_model = "primary", "fallback"
    models = FakeModels(script)
    adapter._client = SimpleNamespace(aio=SimpleNamespace(models=models))
    return adapter, models


def ask(adapter):
    return asyncio.run(adapter.generate_json(system="s", parts=[TextPart("q")], schema=AskOutput))


def test_rate_limited_primary_falls_back_to_second_model():
    adapter, models = adapter_with([api_error(429, "RESOURCE_EXHAUSTED"), VALID])
    assert ask(adapter).grounding == "partial"
    assert [c.model for c in models.calls] == ["primary", "fallback"]
    assert models.calls[0].config.response_json_schema["properties"]["grounding"]["enum"]


def test_invalid_json_gets_one_repair_attempt():
    adapter, models = adapter_with(['{"answer_markdown": 1}', "```json\n" + VALID + "\n```"])
    assert ask(adapter).answer_markdown == "ok [p.1]"
    assert len(models.calls) == 2


def test_still_invalid_after_repair_is_a_friendly_error():
    adapter, _ = adapter_with(["nope", "still nope"])
    with pytest.raises(LLMError, match="unexpected format"):
        ask(adapter)


def test_schema_rejected_retries_in_plain_json_mode():
    adapter, models = adapter_with([api_error(400, "INVALID_ARGUMENT"), VALID])
    assert ask(adapter).grounding == "partial"
    assert models.calls[1].config.response_json_schema is None
    assert "JSON Schema" in models.calls[1].config.system_instruction


@pytest.mark.parametrize(("code", "expected"), [(403, "API key"), (404, "GEMINI_MODEL"), (500, "unavailable")])
def test_errors_are_translated(code, expected):
    adapter, _ = adapter_with([api_error(code), api_error(code)])
    with pytest.raises(LLMError, match=expected):
        ask(adapter)


def test_generate_text_strips_whitespace():
    adapter, _ = adapter_with(["  transcript  \n"])
    assert asyncio.run(adapter.generate_text(system="s", parts=[TextPart("x")])) == "transcript"


def test_empty_response_is_an_error():
    adapter, _ = adapter_with(["   "])
    with pytest.raises(LLMError, match="empty"):
        asyncio.run(adapter.generate_text(system="s", parts=[TextPart("x")]))


def test_build_adapter_choices():
    assert isinstance(build_adapter("mock", "", "m", "f"), MockAdapter)
    assert isinstance(build_adapter("gemini", "", "m", "f"), NotConfiguredAdapter)
    with pytest.raises(LLMError, match="not configured"):
        asyncio.run(NotConfiguredAdapter().generate_text(system="s", parts=[]))


def test_mock_adapter_runs_the_demo_end_to_end():
    SQLModel.metadata.drop_all(engine)
    create_db()
    with TestClient(create_app(llm=MockAdapter())) as client:
        project = data(client.post("/api/demo/seed"))
        pages = data(client.get(f"/api/projects/{project['id']}/pages"))
        answer = data(client.post("/api/ai/ask", json={"project_id": project["id"], "page_id": pages[1]["id"],
                                                       "question": "What is a partial dependency?"}))
        assert answer["grounding"] in ("grounded", "partial") and answer["citations"]
        refusal = data(client.post("/api/ai/ask", json={"project_id": project["id"], "page_id": pages[1]["id"],
                                                        "question": "Explain quantum entanglement"}))
        assert refusal["grounding"] == "not_in_notes"
        quiz = data(client.post("/api/ai/quiz", json={"project_id": project["id"], "page_id": pages[0]["id"], "count": 6}))
        assert len(quiz["questions"]) >= 3
        for path, body in [("/api/ai/summarize", {"scope": "project"}), ("/api/ai/flashcards", {}),
                           ("/api/ai/revision-sheet", {}), ("/api/ai/recommend", {})]:
            data(client.post(path, json={"project_id": project["id"], "page_id": pages[0]["id"], **body}))
        refined = data(client.post("/api/ai/refine", json={"project_id": project["id"], "page_id": pages[5]["id"], "action": "exam"}))
        assert "normalisation" in refined["original_reading"]
