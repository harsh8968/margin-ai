"""Running on serverless hosts (Vercel + hosted Postgres): database URLs, engine options, client IPs."""

from types import SimpleNamespace

from app import config
from app.config import load_settings, normalize_database_url
from app.db import make_engine
from app.http import client_key


def test_postgres_urls_use_the_psycopg_driver():
    assert normalize_database_url("postgres://u:p@h/db?sslmode=require") == "postgresql+psycopg://u:p@h/db?sslmode=require"
    assert normalize_database_url("postgresql://u:p@h/db") == "postgresql+psycopg://u:p@h/db"
    assert normalize_database_url("postgresql+psycopg://u:p@h/db") == "postgresql+psycopg://u:p@h/db"
    assert normalize_database_url("sqlite:///x.db") == "sqlite:///x.db"


def test_a_hosted_database_needs_no_local_data_folder(monkeypatch, tmp_path):
    # Serverless file systems are read-only: only create backend/data for the default SQLite file.
    monkeypatch.setenv("DATABASE_URL", "postgres://u:p@h/db")
    monkeypatch.setattr(config, "BACKEND_DIR", tmp_path)
    settings = load_settings()
    assert settings.database_url == "postgresql+psycopg://u:p@h/db"
    assert not (tmp_path / "data").exists()


def test_the_default_sqlite_file_lives_in_backend_data(monkeypatch, tmp_path):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setattr(config, "BACKEND_DIR", tmp_path)
    settings = load_settings()
    assert settings.database_url == f"sqlite:///{(tmp_path / 'data' / 'canvas.db').as_posix()}"
    assert (tmp_path / "data").is_dir()


def test_postgres_engine_checks_connections_before_use():
    engine = make_engine("postgresql+psycopg://u:p@localhost:1/db")  # nothing connects until first use
    assert (engine.dialect.name, engine.dialect.driver) == ("postgresql", "psycopg")
    assert engine.pool._pre_ping is True


def test_rate_limit_keys_on_the_visitors_ip_behind_a_proxy():
    behind_proxy = SimpleNamespace(headers={"x-forwarded-for": "203.0.113.7, 10.0.0.1"}, client=SimpleNamespace(host="10.0.0.1"))
    assert client_key(behind_proxy) == "203.0.113.7"
    assert client_key(SimpleNamespace(headers={"x-real-ip": "198.51.100.2"}, client=None)) == "198.51.100.2"
    assert client_key(SimpleNamespace(headers={}, client=SimpleNamespace(host="127.0.0.1"))) == "127.0.0.1"
    assert client_key(SimpleNamespace(headers={}, client=None)) == "unknown"
