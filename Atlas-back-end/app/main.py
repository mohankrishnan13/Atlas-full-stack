"""
main.py — ATLAS FastAPI Application

Startup sequence (lifespan):
  1. seed_default_admin()        — Safely seeds admin user (skips if tables
                                   missing or user already exists).
  2. _start_wazuh_sync()         — Background task: polls Wazuh Indexer every
                                   60 seconds for new endpoint alerts.
  3. run_anomaly_engine()        — Background task: statistical spike detector
                                   running every 60 seconds against EndpointLog.

Table creation is handled strictly by init_db.py before Uvicorn starts.
Neither task blocks startup — both are fire-and-forget asyncio tasks.

Removed from previous version:
  - _seed_applications_config()  — Application/Microservice/AppConfig seed
                                   (those models are retired)
  - settings_router              — routes_settings.py retired (AppConfig gone)
"""

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, ProgrammingError

from app.core.config import get_settings
from app.core.database import AsyncSessionLocal, close_db
from app.services.auth_service import seed_default_admin
from app.services.wazuh_service import WazuhCollector
from app.services.anomaly_detection import run_anomaly_engine

from app.api.routes_auth import router as auth_router
from app.api.routes_dashboard import router as dashboard_router
from app.api.routes_actions import router as actions_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger(__name__)

settings = get_settings()


# ─────────────────────────────────────────────────────────────────────────────
# Background Tasks
# ─────────────────────────────────────────────────────────────────────────────

async def _start_wazuh_sync() -> None:
    """
    Background coroutine that polls Wazuh Indexer every 60 seconds.

    On each cycle it calls WazuhCollector.sync_alerts() which:
      1. Fetches the 50 most recent alerts above rule.level >= 3.
      2. Deduplicates by timestamp (idempotent — safe to re-run).
      3. Writes new EndpointLog rows to PostgreSQL.

    These rows are then picked up by:
      - endpoint_service.get_endpoint_security()  (dashboard read path)
      - anomaly_detection.run_anomaly_engine()     (spike detector)
    """
    collector = WazuhCollector()
    while True:
        try:
            logger.info("[WazuhSync] Polling Wazuh Indexer for new alerts ...")
            async with AsyncSessionLocal() as db:
                await collector.sync_alerts(db)
            logger.info("[WazuhSync] Sync complete.")
        except asyncio.CancelledError:
            logger.info("[WazuhSync] Background task cancelled — shutting down.")
            break
        except Exception as exc:
            logger.error("[WazuhSync] Error during sync: %s", exc, exc_info=True)

        await asyncio.sleep(60)


# ─────────────────────────────────────────────────────────────────────────────
# Lifespan
# ─────────────────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting %s (env: %s) ...", settings.app_name, settings.app_env)

    # Database tables are created by init_db.py before Uvicorn starts.
    # Seeding here is idempotent — safe to call on every restart.
    try:
        await seed_default_admin()
    except (IntegrityError, ProgrammingError):
        logger.warning("Database not ready. Skipping admin seed.")

    # Launch background tasks concurrently — both run indefinitely until
    # the application shuts down.
    wazuh_task   = asyncio.create_task(_start_wazuh_sync(),    name="wazuh_sync")
    anomaly_task = asyncio.create_task(run_anomaly_engine(),   name="anomaly_engine")

    logger.info(
        "%s startup complete. Active background tasks: %s",
        settings.app_name,
        [t.get_name() for t in (wazuh_task, anomaly_task)],
    )

    yield

    # ── Graceful shutdown ─────────────────────────────────────────────────────
    logger.info("Shutting down ATLAS — cancelling background tasks ...")

    for task in (wazuh_task, anomaly_task):
        task.cancel()

    # Wait for both tasks to acknowledge cancellation.
    await asyncio.gather(wazuh_task, anomaly_task, return_exceptions=True)

    await close_db()
    logger.info("Database connection pool closed. Shutdown complete.")


# ─────────────────────────────────────────────────────────────────────────────
# FastAPI App
# ─────────────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="ATLAS — Anomaly Command Center",
    description=(
        "SOC backend for Wazuh (Endpoint) and Zeek (Network) anomaly detection. "
        "PostgreSQL-native, no pandas hot-path, pure async."
    ),
    version="3.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.get_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Settings router intentionally omitted — AppConfig model retired.
# Quarantine lift remains in routes_actions (/settings/apps/{id}/quarantine/lift).
app.include_router(auth_router)
app.include_router(dashboard_router)
app.include_router(actions_router)


# ─────────────────────────────────────────────────────────────────────────────
# Global Exception Handler
# ─────────────────────────────────────────────────────────────────────────────

@app.exception_handler(Exception)
async def global_exception_handler(request, exc: Exception):
    logger.error("Unhandled exception on %s: %s", request.url, exc, exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal server error",
            "detail": str(exc) if settings.debug else "Contact your SOC administrator.",
        },
    )


# ─────────────────────────────────────────────────────────────────────────────
# Health Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/", tags=["Health"])
async def root():
    return {
        "service":     settings.app_name,
        "version":     "3.0.0",
        "stack":       "FastAPI + PostgreSQL",
        "environment": settings.app_env,
    }


@app.get("/health", tags=["Health"])
async def health():
    db_status = "unknown"
    try:
        async with AsyncSessionLocal() as session:
            await session.execute(text("SELECT 1"))
            db_status = "connected"
    except Exception as exc:
        db_status = f"error: {exc}"

    return {
        "status":   "healthy" if db_status == "connected" else "degraded",
        "database": db_status,
        "stack":    "FastAPI",
    }
