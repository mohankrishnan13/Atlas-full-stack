"""
core/database.py — Async SQLAlchemy Engine & Session Management

Uses asyncpg driver (postgresql+asyncpg) for non-blocking DB operations.
All FastAPI route handlers must use get_db() as a dependency to receive
a properly scoped, auto-closed AsyncSession.

Design notes:
  - AsyncSession is request-scoped: one session per HTTP request.
  - expire_on_commit=False prevents lazy-load errors after commit in async code.
  - create_all_tables() is called once at startup via the lifespan manager.
"""

import logging
from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.core.config import get_settings

logger = logging.getLogger(__name__)

settings = get_settings()

# ── Engine ─────────────────────────────────────────────────────────────────────
engine = create_async_engine(
    settings.database_url,
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
    pool_timeout=settings.db_pool_timeout,
    echo=settings.db_echo_sql,
    # Keep connections alive across idle periods in development
    pool_pre_ping=True,
)

# ── Session Factory ────────────────────────────────────────────────────────────
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


# ── Declarative Base ───────────────────────────────────────────────────────────
class Base(DeclarativeBase):
    """
    Shared declarative base for all ORM models.
    Import this in db_models.py — never instantiate it directly.
    """
    pass


# ── Dependency ─────────────────────────────────────────────────────────────────
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    FastAPI dependency that yields a database session.

    Usage in route handlers:
        async def my_route(db: AsyncSession = Depends(get_db)):
            result = await db.execute(select(MyModel))

    The session is automatically closed (and rolled back on error)
    after the request completes, preventing connection leaks.
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def create_all_tables() -> None:
    """
    Creates all database tables defined in db_models.py.
    Called once at application startup — safe to call multiple times
    (CREATE TABLE IF NOT EXISTS semantics via checkfirst=True).
    """
    # Import models to ensure they are registered with Base.metadata
    import app.models.db_models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all, checkfirst=True)

    logger.info("Database tables verified / created.")


async def close_db() -> None:
    """Gracefully disposes the connection pool on application shutdown."""
    await engine.dispose()
    logger.info("Database connection pool closed.")
