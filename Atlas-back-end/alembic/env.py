"""
Alembic environment configuration for FastAPI + SQLAlchemy (async runtime).

Alembic itself uses a synchronous engine (psycopg2).
Your FastAPI app can still use asyncpg.
"""

import os
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool
from alembic import context

from dotenv import load_dotenv
load_dotenv()

# Import models package
import pkgutil
import importlib
import app.models

# Dynamically load all model modules
for module in pkgutil.walk_packages(app.models.__path__, app.models.__name__ + "."):
    importlib.import_module(module.name)

# Import metadata from models
from app.models.db_models import Base

# Alembic Config
config = context.config

# Logging
# if config.config_file_name is not None:
#     fileConfig(config.config_file_name)

# Metadata for autogenerate
target_metadata = Base.metadata


# ---------------------------------------------------
# DATABASE URL (SYNC for migrations)
# ---------------------------------------------------

DATABASE_URL = os.getenv("DATABASE_URL_SYNC")

if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL_SYNC not set")


# ---------------------------------------------------
# OFFLINE MODE
# ---------------------------------------------------

def run_migrations_offline() -> None:
    """Run migrations without DB connection."""
    
    context.configure(
        url=DATABASE_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


# ---------------------------------------------------
# ONLINE MODE
# ---------------------------------------------------

def run_migrations_online() -> None:
    """Run migrations with live DB connection."""

    configuration = config.get_section(config.config_ini_section)
    configuration["sqlalchemy.url"] = DATABASE_URL

    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )

        with context.begin_transaction():
            context.run_migrations()


# ---------------------------------------------------

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()