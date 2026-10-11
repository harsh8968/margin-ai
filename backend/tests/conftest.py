import os
import tempfile

# Point the app at a throwaway database before any app module is imported.
_TMP = tempfile.mkdtemp(prefix="canvas-tests-")
os.environ["DATABASE_URL"] = f"sqlite:///{_TMP}/test.db"
os.environ["LLM_PROVIDER"] = "mock"

import base64  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlmodel import SQLModel  # noqa: E402

from app.ai.llm_adapter import TextPart  # noqa: E402
from app.db import create_db, engine  # noqa: E402
from app.main import create_app  # noqa: E402

TINY_PNG = "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 64).decode()


class ScriptedLLM:
    """Returns pre-queued outputs and records every call, so tests can assert on prompts."""

    name = "scripted"

    def __init__(self):
        self.json_outputs: list = []
        self.text_outputs: list[str] = []
        self.calls: list[dict] = []

    def queue(self, *outputs):
        self.json_outputs.extend(outputs)

    def queue_text(self, *outputs: str):
        self.text_outputs.extend(outputs)

    def prompt_text(self, call_index: int = -1) -> str:
        return "\n".join(p.text for p in self.calls[call_index]["parts"] if isinstance(p, TextPart))

    async def generate_json(self, *, system, parts, schema, temperature=0.3):
        self.calls.append({"system": system, "parts": parts, "schema": schema})
        if not self.json_outputs:
            raise AssertionError(f"Unexpected LLM call for {schema.__name__}")
        output = self.json_outputs.pop(0)
        assert isinstance(output, schema), f"queued {type(output).__name__}, code asked for {schema.__name__}"
        return output

    async def generate_text(self, *, system, parts, temperature=0.2):
        self.calls.append({"system": system, "parts": parts, "schema": str})
        if not self.text_outputs:
            raise AssertionError("Unexpected text LLM call")
        return self.text_outputs.pop(0)


@pytest.fixture
def llm() -> ScriptedLLM:
    return ScriptedLLM()


@pytest.fixture
def client(llm):
    SQLModel.metadata.drop_all(engine)
    create_db()
    app = create_app(llm=llm)
    with TestClient(app) as test_client:
        yield test_client


def data(response):
    body = response.json()
    assert body["success"] is True, body
    assert body["error"] is None
    return body["data"]


def text_el(eid: str, text: str, x: float = 100, y: float = 100) -> dict:
    return {"id": eid, "type": "text", "x": x, "y": y, "width": 600, "text": text, "font_size": 28, "color": "#000"}


def stroke_el(eid: str = "s1") -> dict:
    return {"id": eid, "type": "stroke", "tool": "pen", "points": [[10, 10, 0.5], [20, 20, 0.5]], "color": "#000", "size": 4, "opacity": 1}


@pytest.fixture
def make_project(client):
    """Create a project whose pages hold the given typed texts. Returns (project_id, [page dicts])."""

    def factory(*page_texts: str, name: str = "Biology"):
        project = data(client.post("/api/projects", json={"name": name}))
        first = data(client.get(f"/api/projects/{project['id']}/pages"))[0]
        pages = []
        for index, text in enumerate(page_texts):
            elements = [text_el(f"t{index}", text)] if text else []
            if index == 0:
                data(client.patch(f"/api/pages/{first['id']}", json={"elements": elements, "title": "Page 1"}))
                pages.append(data(client.get(f"/api/pages/{first['id']}")))
            else:
                pages.append(data(client.post(f"/api/projects/{project['id']}/pages", json={"elements": elements})))
        return project["id"], pages

    return factory
