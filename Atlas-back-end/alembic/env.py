"""
Alembic environment configuration for async PostgreSQL.

This file configures Alembic to work with:
- Async PostgreSQL (asyncpg driver) 
- Dynamic DATABASE_URL from app.core.config.settings
- All models from app.models.db_models
"""

import asyncio
from logging.config import fileConfig
from os import environ
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config
from sqlalchemy.orm import sessionmaker

from alembic import context
from app.core.config import get_settings

# Import all models to ensure they're registered with Base.metadata
from app.models.db_models import Base

# Import this here to avoid circular imports
import app.models.db_models
from dotenv import load_dotenv
load_dotenv()

# Get settings dynamically
settings = get_settings()

# Alembic Config object
config = context.config

# Set the SQLAlchemy URL from our settings
config.set_main_option('sqlalchemy.url', settings.database_url)

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Target metadata for autogenerate support
target_metadata = Base.metadata


def get_url():
    """Return the database URL from settings."""
    return settings.database_url


def get_engine():
    """Create async engine from configuration."""
    return async_engine_from_config(
        config,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )


async def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.
    
    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.
    
    Calls to context.execute() here emit the given string to the
    script output.
    """
    url = get_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    """Run migrations in 'online' mode.
    
    In this scenario we need to create an Engine
    and associate a connection with the context.
    """
    
    # Configure the context for async PostgreSQL
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        # Compare types to avoid false positives
        compare_type=True,
        # Include object names for PostgreSQL
        include_object=True,
        include_schemas=True,
    )

    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    """Run migrations in 'online' mode.
    
    In this scenario we need to create an Engine
    and associate a connection with the context.
    """
    
    # Create async engine
    connectable = get_engine()
    
    # Use a sync connection for Alembic
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    # Dispose the engine after migrations
    await connectable.dispose()


def run_migrations_online_sync() -> None:
    """Run migrations in 'online' mode using sync connection.
    
    This is the entry point that Alembic expects.
    """
    
    # Create sync engine for Alembic
    configuration = config.get_section(config.config_ini_section)
    configuration['sqlalchemy.url'] = get_url()
    
    # Create sync engine specifically for migrations
    from sqlalchemy import create_engine
    sync_engine = create_engine(
        get_url(),
        poolclass=pool.NullPool,
    )
    
    with sync_engine.connect() as connection:
        do_run_migrations(connection)


if context.is_offline_mode():
    run_migrations_offline()
else:
    # For async, we need to run the async version
    # But Alembic expects a sync function, so we provide both
    run_migrations_online_sync()