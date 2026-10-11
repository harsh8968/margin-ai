"""SQLite engine + session dependency."""

from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import event
from sqlmodel import Session, SQLModel, create_engine

from .config import settings


def make_engine(url: str):
    if not url.startswith("sqlite"):
        # Hosted Postgres behind a transaction pooler (Neon): no server-side prepared statements,
        # and re-check pooled connections that a frozen serverless instance may have lost.
        return create_engine(
            url, pool_pre_ping=True, pool_size=2, max_overflow=3, pool_recycle=300, connect_args={"prepare_threshold": None}
        )
    engine = create_engine(url, connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _record):  # pragma: no cover - driver hook
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.execute("PRAGMA journal_mode=WAL")
        cur.close()

    return engine


engine = make_engine(settings.database_url)


def create_db(target_engine=None) -> None:
    from . import models  # noqa: F401  (registers tables)

    SQLModel.metadata.create_all(target_engine or engine)


def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session
