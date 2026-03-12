"""
main.py — ATLAS FastAPI Application (PostgreSQL + Velociraptor Stack)

Architecture changes from previous version:
  - REMOVED: Elasticsearch client, Wazuh client, Redis client
  - REMOVED: ML anomaly engine (IsolationForest dependency)
  - ADDED:   PostgreSQL via SQLAlchemy asyncpg
  - ADDED:   Local log file ingestion on startup
  - ADDED:   Velociraptor webhook receiver route
  - ADDED:   POST /api/ingest/http — API-key secured batch ingest (Vector-compatible)
  - ADDED:   S3 cold-storage background polling task (boto3 stub)
  - RETAINED: LLM Copilot integration (gracefully degraded if Ollama unavailable)
  - RETAINED: CORS middleware, global exception handler, health endpoints
  - RETAINED: Progressive containment rules (settings API)

Startup sequence:
  1. Create/verify all PostgreSQL tables (including new S3IngestCursor).
  2. If reingest_on_startup=True, parse JSONL log files → insert into DB.
  3. If s3_enabled=True, launch the S3 background polling task.
  4. Register all API routers.
  5. Begin serving requests.

Shutdown sequence:
  1. Cancel the S3 background task gracefully.
  2. Dispose SQLAlchemy connection pool.
"""

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import router as dashboard_router
from app.api.routes_auth import router as auth_router
from app.api.routes_case_management import router as case_management_router
from app.api.routes_figma_settings import router as figma_settings_router
from app.api.routes_ingest import router as ingest_router
from app.api.routes_reports import router as reports_router
from app.api.routes_settings import router as settings_router
from app.api.routes_webhooks import router as webhook_router
from app.api.routes_figma_widgets import router as figma_widgets_router
from app.core.config import get_settings
from app.core.database import AsyncSessionLocal, close_db, create_all_tables
from app.services.auth_service import seed_default_admin
from app.services.log_ingestion import ingest_all_logs
from app.services.s3_ingestor import run_s3_ingest_loop
from sqlalchemy import text

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger(__name__)

settings = get_settings()


# ─── Application Lifespan ─────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Async context manager for startup and shutdown lifecycle.

    This is the modern FastAPI pattern (replaces deprecated @app.on_event).
    Everything before `yield` runs at startup; everything after runs at shutdown.
    """
    logger.info(f"Starting {settings.app_name} (env: {settings.app_env}) ...")

    # ── 1. Database tables (includes new S3IngestCursor) ──────────────────────
    await create_all_tables()

    # ── 2. JSONL file log ingestion ────────────────────────────────────────────
    if settings.reingest_on_startup:
        logger.info("reingest_on_startup=True — loading log files into PostgreSQL ...")
        async with AsyncSessionLocal() as session:
            try:
                stats = await ingest_all_logs(session)
                logger.info(f"Log ingestion complete: {stats}")
            except Exception as exc:
                logger.error(
                    f"Log ingestion failed: {exc}. "
                    "The API will start but dashboard data may be empty.",
                    exc_info=True,
                )
    else:
        logger.info("reingest_on_startup=False — skipping JSONL ingestion.")

    # ── 3. Seed default admin user (no-op if users already exist) ─────────────
    try:
        await seed_default_admin()
    except Exception as exc:
        logger.error(f"Admin seed failed: {exc}", exc_info=True)

    # ── 3. S3 cold-storage background task ────────────────────────────────────
    # Launched as a fire-and-forget asyncio task. The task runs an infinite
    # poll loop; we keep a reference so we can cancel it cleanly on shutdown.
    s3_task = None
    if settings.s3_enabled:
        logger.info(
            f"s3_enabled=True — starting S3 background ingest task "
            f"(bucket='{settings.s3_log_bucket}', prefix='{settings.s3_log_prefix}', "
            f"poll={settings.s3_poll_interval_seconds}s)"
        )
        s3_task = asyncio.create_task(
            run_s3_ingest_loop(),
            name="atlas-s3-ingest",
        )
    else:
        logger.info(
            "s3_enabled=False — S3 background ingest task is disabled. "
            "Set S3_ENABLED=true in .env to activate cold-storage ingestion."
        )

    logger.info(f"{settings.app_name} startup complete. Docs: http://localhost:8000/docs")

    yield  # ── Application is running ──────────────────────────────────────

    # ── Shutdown ───────────────────────────────────────────────────────────────
    logger.info("Shutting down ATLAS ...")

    if s3_task and not s3_task.done():
        logger.info("Cancelling S3 background ingest task ...")
        s3_task.cancel()
        try:
            await asyncio.wait_for(asyncio.shield(s3_task), timeout=5.0)
        except (asyncio.CancelledError, asyncio.TimeoutError):
            pass
        logger.info("S3 background task stopped.")

    await close_db()
    logger.info("Database connection pool closed. Shutdown complete.")


# ─── FastAPI Application ───────────────────────────────────────────────────────

app = FastAPI(
    title="ATLAS — Advanced Traffic Layer Anomaly System",
    description=(
        "Enterprise SOC Dashboard backend powered by PostgreSQL + Velociraptor. "
        "Replaces previous Elasticsearch/Wazuh stack with a lean, cost-effective "
        "architecture suitable for both cloud and on-premises deployments."
    ),
    version="2.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)


# ── CORS ──────────────────────────────────────────────────────────────────────
# In production replace ["*"] with your exact frontend domain.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if settings.debug else ["https://your-soc-frontend.com"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Routers ───────────────────────────────────────────────────────────────────
# Dashboard routes at root level (match frontend apiFetch() calls with no prefix)
# Ingest / webhook / settings routes under their own prefixes
app.include_router(dashboard_router)
app.include_router(auth_router)         # POST /api/auth/login, GET /api/auth/me, etc.
app.include_router(ingest_router)       # POST /api/ingest/http
app.include_router(webhook_router)      # POST /webhooks/velociraptor
app.include_router(settings_router)     # GET/POST /settings/*
app.include_router(figma_settings_router)  # GET/PUT /api/settings/apps/*
app.include_router(reports_router)         # GET/POST /reports/*
app.include_router(case_management_router) # GET /case-management
app.include_router(figma_widgets_router)   # GET /figma/*


# ── Global Exception Handler ──────────────────────────────────────────────────
@app.exception_handler(Exception)
async def global_exception_handler(request, exc: Exception):
    """
    Catches unhandled exceptions and returns a consistent JSON error response.
    Prevents Python stack traces from reaching the frontend browser in production.
    """
    logger.error(f"Unhandled exception on {request.url}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal server error",
            "detail": str(exc) if settings.debug else "Contact your SOC administrator.",
        },
    )


# ── Health Endpoints ──────────────────────────────────────────────────────────

@app.get("/", tags=["Health"])
async def root():
    """Service identification endpoint."""
    return {
        "service": settings.app_name,
        "version": "2.0.0",
        "stack": "PostgreSQL + Velociraptor",
        "environment": settings.app_env,
        "docs": "/docs",
    }


@app.get("/health", tags=["Health"])
async def health():
    """
    Lightweight liveness probe for container orchestration.
    Returns 200 as long as the FastAPI process is alive and DB is reachable.
    Designed for Kubernetes liveness checks (fast, no heavy computation).
    """
    db_status = "unknown"
    try:
        async with AsyncSessionLocal() as session:
            await session.execute(text("SELECT 1"))
            db_status = "connected"
    except Exception as exc:
        db_status = f"error: {exc}"

    return {
        "status": "healthy" if db_status == "connected" else "degraded",
        "database": db_status,
        "stack": "PostgreSQL + Velociraptor",
    }


@app.post("/admin/reingest-logs", tags=["Admin"])
async def admin_reingest_logs():
    """
    Manually triggers a full log re-ingestion from the data/logs/ directory.
    Useful in development after updating log files.

    Production note: Protect this endpoint with admin-only authentication.
    In a fully automated pipeline, this endpoint is replaced by a scheduled
    Celery/APScheduler task or a Kafka consumer.
    """
    async with AsyncSessionLocal() as session:
        try:
            stats = await ingest_all_logs(session)
            return {"status": "success", "records_ingested": stats}
        except Exception as exc:
            logger.error(f"Manual re-ingestion failed: {exc}", exc_info=True)
            return JSONResponse(
                status_code=500,
                content={"status": "error", "detail": str(exc)},
            )
