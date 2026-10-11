"""Settings loaded once from environment variables (and backend/.env)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")


@dataclass(frozen=True)
class Settings:
    gemini_api_key: str
    gemini_model: str
    gemini_fallback_model: str
    llm_provider: str  # "gemini" | "mock"
    database_url: str
    cors_origins: tuple[str, ...]
    max_image_bytes: int
    max_pages_in_context: int
    voice_model: str
    voice_name: str


def load_settings() -> Settings:
    data_dir = BACKEND_DIR / "data"
    data_dir.mkdir(exist_ok=True)
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    provider = os.getenv("LLM_PROVIDER", "gemini").strip().lower()
    return Settings(
        gemini_api_key=api_key,
        gemini_model=os.getenv("GEMINI_MODEL", "gemini-3.8-flash").strip(),
        gemini_fallback_model=os.getenv("GEMINI_FALLBACK_MODEL", "gemini-3.5-flash-lite").strip(),
        llm_provider=provider,
        database_url=os.getenv("DATABASE_URL", f"sqlite:///{(data_dir / 'canvas.db').as_posix()}"),
        cors_origins=tuple(
            o.strip()
            for o in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
            if o.strip()
        ),
        max_image_bytes=int(os.getenv("MAX_IMAGE_BYTES", str(6 * 1024 * 1024))),
        max_pages_in_context=int(os.getenv("MAX_PAGES_IN_CONTEXT", "40")),
        voice_model=os.getenv("VOICE_MODEL", "gemini-3.8-live").strip(),
        voice_name=os.getenv("VOICE_NAME", "Kore").strip(),
    )


settings = load_settings()
