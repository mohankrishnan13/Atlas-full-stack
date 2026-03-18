"""
init_db.py — Database Table Initialization Script

This script creates all database tables using SQLAlchemy's metadata.create_all
to eliminate race conditions and UndefinedTableError issues in multi-worker
Docker environments.

Usage:
    python init_db.py

The script uses the same async engine as the FastAPI application
and runs synchronously within an async context to ensure proper
connection handling and transaction management.
"""

import asyncio
import logging
from sqlalchemy.ext.asyncio import AsyncEngine

from app.core.database import engine
from app.models.db_models import Base

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def create_all_tables() -> None:
    """
    Creates all database tables defined in db_models.py.
    
    Uses Base.metadata.create_all with checkfirst=True to safely
    create tables only if they don't already exist.
    """
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all, checkfirst=True)
        logger.info("✅ Database tables created successfully")
    except Exception as exc:
        logger.error(f"❌ Failed to create database tables: {exc}")
        raise


async def main() -> None:
    """
    Main entry point for database initialization.
    """
    logger.info("🚀 Initializing ATLAS database...")
    
    try:
        await create_all_tables()
        logger.info("🎉 Database initialization complete")
    except Exception as exc:
        logger.error(f"💥 Database initialization failed: {exc}")
        raise


if __name__ == "__main__":
    asyncio.run(main())
