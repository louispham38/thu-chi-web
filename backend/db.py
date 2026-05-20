"""SQLAlchemy setup — Postgres in production, SQLite in dev."""
from __future__ import annotations

import os
from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


def _resolve_url() -> str:
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        # Default: SQLite file in same dir as this module
        here = os.path.dirname(os.path.abspath(__file__))
        return f"sqlite:///{os.path.join(here, 'thu_chi.db')}"
    # Render exposes postgres URLs as "postgres://"; SQLAlchemy 2 wants "postgresql+psycopg2://"
    if url.startswith("postgres://"):
        url = "postgresql+psycopg2://" + url[len("postgres://"):]
    elif url.startswith("postgresql://"):
        url = "postgresql+psycopg2://" + url[len("postgresql://"):]
    return url


DATABASE_URL = _resolve_url()
_connect_args: dict = {}
if DATABASE_URL.startswith("sqlite"):
    _connect_args = {"check_same_thread": False}

engine = create_engine(DATABASE_URL, connect_args=_connect_args, pool_pre_ping=True, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


class Base(DeclarativeBase):
    pass


def init_db() -> None:
    """Create tables. Idempotent."""
    import models  # noqa: F401  ensure imports register on Base.metadata

    Base.metadata.create_all(bind=engine)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
