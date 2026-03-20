"""
alembic/env.py — Async Alembic Environment for ATLAS

How it works
────────────
The app uses asyncpg (postgresql+asyncpg://) at runtime, but Alembic is a
one-shot CLI tool that needs to talk to the database once and exit.

There are two valid approaches for async SQLAlchemy apps:

  Option A — Pure async (used here):
    Use create_async_engine(asyncpg_url) and conn.run_sync(do_run_migrations).
    Alembic's migration code is always synchronous internally; run_sync()
    bridges the async engine to Alembic's sync context.configure() calls.

  Option B — Plain sync (also valid):
    Use a plain create_engine(psycopg2_url). Simpler but requires psycopg2
    to be installed and the DATABASE_URL_SYNC variable to be set.

We use Option A because it only requires asyncpg (already in requirements.txt)
and works with a single DATABASE_URL environment variable.

URL resolution priority
───────────────────────
  1. DATABASE_URL_SYNC in environment → rewritten to asyncpg for async engine
  2. DATABASE_URL in environment       → used directly (already asyncpg)
  3. sqlalchemy.url in alembic.ini     → last resort (intentionally blank)

Nothing is hardcoded here. Docker Compose injects the URL via env_file.
"""

import asyncio
import os
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from alembic import context

# ── Alembic config object ─────────────────────────────────────────────────────
config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# ── Import every model so Base.metadata has all 17 table definitions ──────────
# If you add a new model file in the future, import it here too.
from app.models.db_models import Base  # noqa: E402
import app.models.db_models            # noqa: F401 — registers all ORM classes

target_metadata = Base.metadata


# ── URL helpers ───────────────────────────────────────────────────────────────

def _get_asyncpg_url() -> str:
    """
    Returns a postgresql+asyncpg:// URL for the async engine.

    Priority:
      1. DATABASE_URL_SYNC (psycopg2 URL) → scheme rewritten to asyncpg
      2. DATABASE_URL (asyncpg URL)       → used as-is
      3. sqlalchemy.url from alembic.ini  → last resort
    """
    # DATABASE_URL_SYNC is the psycopg2 sync URL. Rewrite it to asyncpg.
    sync_url = os.environ.get("DATABASE_URL_SYNC", "").strip()
    if sync_url:
        return (
            sync_url
            .replace("postgresql+psycopg2://", "postgresql+asyncpg://", 1)
            .replace("postgresql://",          "postgresql+asyncpg://", 1)
        )

    # DATABASE_URL is already asyncpg — use it directly.
    async_url = os.environ.get("DATABASE_URL", "").strip()
    if async_url:
        return async_url

    # Last resort: alembic.ini (blank by design — will raise a clear error).
    ini_url = config.get_main_option("sqlalchemy.url", "")
    if ini_url:
        return ini_url

    raise RuntimeError(
        "No database URL found for Alembic.\n"
        "Set DATABASE_URL or DATABASE_URL_SYNC in your .env file.\n"
        "Example: DATABASE_URL=postgresql+asyncpg://user:pass@postgres:5432/atlas_db"
    )


def _get_sync_url_for_offline() -> str:
    """
    Returns a synchronous URL for offline mode (SQL generation without a DB).
    Uses psycopg2 dialect so the generated SQL uses PostgreSQL syntax.
    """
    sync_url = os.environ.get("DATABASE_URL_SYNC", "").strip()
    if sync_url:
        return sync_url

    async_url = os.environ.get("DATABASE_URL", "").strip()
    if async_url:
        return async_url.replace("postgresql+asyncpg://", "postgresql+psycopg2://", 1)

    return config.get_main_option("sqlalchemy.url", "")


# ── Offline mode ──────────────────────────────────────────────────────────────

def run_migrations_offline() -> None:
    """
    Emits SQL to stdout without a live DB connection.
    Run with: alembic upgrade head --sql > migration.sql
    """
    url = _get_sync_url_for_offline()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


# ── Online mode (async) ───────────────────────────────────────────────────────

def do_run_migrations(connection: Connection) -> None:
    """
    Synchronous callback passed to conn.run_sync().
    Alembic's context.configure() and context.run_migrations() are always
    synchronous — run_sync() is the bridge from the async connection.
    """
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """
    Creates a one-shot async engine with NullPool (no persistent connections —
    Alembic is a CLI tool, not a long-running server) and runs all pending
    migrations via conn.run_sync(do_run_migrations).

    This is the canonical pattern from the Alembic async cookbook:
    https://alembic.sqlalchemy.org/en/latest/cookbook.html#using-asyncio-with-alembic
    """
    url = _get_asyncpg_url()

    # NullPool: create a new connection for this run, close it when done.
    # No pool is needed for a one-shot migration process.
    engine = create_async_engine(url, poolclass=pool.NullPool)

    async with engine.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await engine.dispose()


def run_migrations_online() -> None:
    """Entry point for online mode — wraps the async function in asyncio.run()."""
    asyncio.run(run_async_migrations())


# ── Dispatch ──────────────────────────────────────────────────────────────────

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
