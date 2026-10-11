"""Vercel entrypoint: the FastAPI app runs as one serverless function; the CDN serves the React build."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.main import app  # noqa: E402,F401  (Vercel's Python runtime serves this ASGI app)
