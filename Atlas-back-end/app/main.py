"""
main.py — ATLAS FastAPI Application (Pandas In-Memory Engine)

Architecture (v2):
  - PostgreSQL: Used strictly for Auth, Config, and Case Management state.
  - Telemetry: Read directly from Loghub CSVs into memory using Pandas.
  - Routers: Consolidated into Auth, Dashboard, Settings, and Actions.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.core.config import get_settings
from app.core.database import AsyncSessionLocal, close_db, create_all_tables
from app.services.auth_service import seed_default_admin

# ── NEW: Pandas Cache Warmer ──
from app.services.query_service import warm_cache

# ── NEW: Consolidated Routers ──
from app.api.routes_auth import router as auth_router
from app.api.routes_dashboard import router as dashboard_router
from app.api.routes_settings import router as settings_router
from app.api.routes_actions import router as actions_router

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
    """
    logger.info(f"Starting {settings.app_name} (env: {settings.app_env}) ...")

    # ── 1. Initialize PostgreSQL (Config & Users ONLY) ────────────────────────
    await create_all_tables()

    try:
        await seed_default_admin()
    except Exception as exc:
        logger.error(f"Admin seed failed: {exc}", exc_info=True)

    # ── 2. Warm up the Pandas In-Memory Log Engine ────────────────────────────
    try:
        logger.info("Booting Pandas CSV Log Engine...")
        warm_cache()
    except Exception as exc:
        logger.error(
            f"Failed to load Loghub CSVs into Pandas: {exc}. "
            "Dashboard charts may appear empty.",
            exc_info=True,
        )

    logger.info(f"{settings.app_name} startup complete. Docs: http://localhost:8000/docs")

    yield  # ── Application is running ──────────────────────────────────────

    # ── 3. Shutdown Sequence ──────────────────────────────────────────────────
    logger.info("Shutting down ATLAS ...")
    await close_db()
    logger.info("Database connection pool closed. Shutdown complete.")


# ─── FastAPI Application ───────────────────────────────────────────────────────

app = FastAPI(
    title="ATLAS — Advanced Traffic Layer Anomaly System",
    description=(
        "Enterprise SOC Dashboard backend powered by FastAPI + Pandas. "
        "Telemetry is served directly from CSV logs in RAM for maximum performance, "
        "while configurations and RBAC are handled via PostgreSQL."
    ),
    version="2.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)


# ── CORS ──────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if settings.debug else ["http://localhost:3000", "https://your-soc-frontend.com"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Consolidated Routers ──────────────────────────────────────────────────────
app.include_router(auth_router)
app.include_router(dashboard_router)
app.include_router(settings_router)
app.include_router(actions_router)


# ── Global Exception Handler ──────────────────────────────────────────────────
@app.exception_handler(Exception)
async def global_exception_handler(request, exc: Exception):
    logger.error(f"Unhandled exception on {request.url}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal server error",
            "detail": str(exc) if settings.debug else "Contact your SOC administrator.",
        },
    )


# ── Health & Admin Endpoints ──────────────────────────────────────────────────

@app.get("/", tags=["Health"])
async def root():
    return {
        "service": settings.app_name,
        "version": "2.0.0",
        "stack": "FastAPI + Pandas + PostgreSQL",
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
        "status": "healthy" if db_status == "connected" else "degraded",
        "database": db_status,
        "stack": "FastAPI + Pandas",
    }


@app.post("/admin/reload-cache", tags=["Admin"])
async def admin_reload_cache():
    """
    Manually triggers a hot-reload of the Loghub CSVs into Pandas memory.
    Useful if you drop a new Loghub CSV into the data/logs/ folder while the server is running.
    """
    try:
        warm_cache()
        return {"status": "success", "message": "Pandas in-memory cache successfully reloaded."}
    except Exception as exc:
        logger.error(f"Manual cache reload failed: {exc}", exc_info=True)
        return JSONResponse(
            status_code=500,
            content={"status": "error", "detail": str(exc)},
        )