"""FastAPI app factory. Run with:  uvicorn app.main:app --reload --port 8000"""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session

from .ai.llm_adapter import LLMAdapter, LLMError, build_adapter
from .ai.voice import TokenMinter, build_minter
from .config import settings
from .db import create_db, get_session
from .http import AI_REQUESTS_PER_MINUTE, SlidingWindowLimiter, fail, ok
from .routers import ai, assets, pages, projects, voice
from .routers.projects import project_out
from .seed import seed_demo_project

logger = logging.getLogger("canvas")
FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"


def create_app(llm: LLMAdapter | None = None, *, minter: TokenMinter | None = None, init_db: bool = True) -> FastAPI:
    app = FastAPI(title="AI Learning Canvas", version="1.0.0")
    app.state.llm = llm or build_adapter(
        settings.llm_provider, settings.gemini_api_key, settings.gemini_model, settings.gemini_fallback_model
    )
    app.state.voice_minter = minter or build_minter(settings.gemini_api_key)
    app.state.ai_limiter = SlidingWindowLimiter(AI_REQUESTS_PER_MINUTE)
    if init_db:
        create_db()

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(HTTPException)
    async def http_error(_: Request, exc: HTTPException):
        return JSONResponse(status_code=exc.status_code, content=fail(str(exc.detail)))

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError):
        first = exc.errors()[0] if exc.errors() else {}
        where = ".".join(str(p) for p in first.get("loc", []) if p != "body")
        message = f"Invalid request: {where} {first.get('msg', '')}".strip()
        return JSONResponse(status_code=422, content=fail(message))

    @app.exception_handler(LLMError)
    async def llm_error(_: Request, exc: LLMError):
        return JSONResponse(status_code=exc.status_code, content=fail(exc.user_message))

    @app.exception_handler(Exception)
    async def unexpected_error(_: Request, exc: Exception):
        logger.exception("Unhandled error", exc_info=exc)
        return JSONResponse(status_code=500, content=fail("Something went wrong on the server."))

    @app.get("/api/health")
    def health(request: Request):
        adapter = request.app.state.llm
        return ok(
            {
                "status": "ok",
                "llm": adapter.name,
                "model": getattr(adapter, "model", None),
                "ai_configured": adapter.name != "not-configured",
            }
        )

    @app.post("/api/demo/seed", status_code=201)
    def seed(session: Session = Depends(get_session)):
        project = seed_demo_project(session)
        return ok(project_out(session, project).model_dump(mode="json"))

    app.include_router(projects.router)
    app.include_router(pages.router)
    app.include_router(ai.router)
    app.include_router(voice.router)
    app.include_router(assets.router)

    if FRONTEND_DIST.is_dir():
        # Production: one process serves the built React app and the API.
        app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
    return app


logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
app = create_app()
