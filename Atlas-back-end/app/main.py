"""
main.py — ATLAS FastAPI Application

Startup sequence (lifespan):
  1. seed_default_admin()         — Seeds admin accounts (idempotent)
  2. _seed_applications_config()  — Seeds Apps / Microservices (idempotent)
  3. _start_wazuh_sync()          — Background Wazuh poll task (every 60s)
  4. anomaly_worker()             — Background anomaly detection (every 60s)

Note: Table creation is handled strictly by Alembic migrations. The Dockerfile
CMD runs `alembic upgrade head` before uvicorn starts, so tables are guaranteed
to exist before any background task queries them.

The ProgrammingError safety nets below are a belt-and-suspenders fallback: if
somehow uvicorn starts before Alembic finishes (e.g. manual dev run without
the migration step), the background tasks log a warning and wait 10 seconds
instead of crash-looping.
"""

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text, select, desc
from sqlalchemy.exc import IntegrityError, OperationalError, ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import AsyncSessionLocal, close_db, get_db
from app.services.auth_service import seed_default_admin, get_current_user
from app.services.wazuh_service import WazuhCollector
from app.services.anomaly_engine import anomaly_worker
from app.models.db_models import (
    Application, AppConfig, Microservice, AnomalyEvent, AtlasUser,
)

from app.api.routes_auth import router as auth_router
from app.api.routes_dashboard import router as dashboard_router
from app.api.routes_settings import router as settings_router
from app.api.routes_actions import router as actions_router
from app.api.routes_simulation import router as simulation_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger(__name__)

settings = get_settings()


# ── Seed helpers ──────────────────────────────────────────────────────────────

async def _seed_applications_config() -> None:
    """Seeds Applications, Microservices, and AppConfigs. Idempotent."""
    _APPS = [
        ("all",      "All Applications"),
        ("naukri",   "Naukri"),
        ("genai",    "GenAI"),
        ("flipkart", "Flipkart"),
    ]
    _MICROSERVICES = [
        ("api",           "API-Gateway",          "Healthy", "40%", "75%", "auth,payment,notifications"),
        ("auth",          "Auth-Service",         "Healthy", "20%", "25%", "api"),
        ("payment",       "Payment-Service",      "Healthy", "50%", "50%", "api"),
        ("notifications", "Notification-Service", "Healthy", "70%", "25%", "api"),
    ]

    async with AsyncSessionLocal() as db:
        try:
            for env in ("cloud", "local"):
                for app_id, name in _APPS:
                    exists = (await db.execute(
                        select(Application).where(
                            Application.env == env,
                            Application.app_id == app_id,
                        )
                    )).scalar_one_or_none()
                    if not exists:
                        db.add(Application(env=env, app_id=app_id, name=name))

                has_ms = (await db.execute(
                    select(Microservice).where(Microservice.env == env).limit(1)
                )).scalar_one_or_none()

                if not has_ms:
                    for sid, name, status, top, left, conns in _MICROSERVICES:
                        db.add(Microservice(
                            env=env, service_id=sid, name=name,
                            status=status, position_top=top,
                            position_left=left, connections_csv=conns,
                        ))

                for app_id, _ in _APPS:
                    if app_id == "all":
                        continue
                    exists = (await db.execute(
                        select(AppConfig).where(
                            AppConfig.env == env,
                            AppConfig.app_id == app_id,
                        )
                    )).scalar_one_or_none()
                    if not exists:
                        db.add(AppConfig(env=env, app_id=app_id))

            await db.commit()

        except (IntegrityError, ProgrammingError, OperationalError) as exc:
            # ProgrammingError  → table doesn't exist yet (Alembic not run)
            # OperationalError  → DB not reachable yet
            # IntegrityError    → concurrent insert beat us (harmless)
            await db.rollback()
            logger.warning(
                "Application config seed skipped (%s: %s). "
                "This is normal if Alembic has not been run yet.",
                type(exc).__name__, exc,
            )
        except Exception as exc:
            await db.rollback()
            logger.error("Unexpected error during app config seed: %s", exc, exc_info=True)


# ── Background tasks ──────────────────────────────────────────────────────────

async def _start_wazuh_sync() -> None:
    """
    Background coroutine: polls Wazuh every 60 seconds for new alerts.

    Safety net: if ProgrammingError or OperationalError is raised (tables not
    yet created or DB unreachable), the task logs a warning and waits 10 seconds
    before retrying rather than entering a tight crash-log loop.
    This handles the edge case where uvicorn starts before Alembic finishes.
    """
    collector = WazuhCollector()
    while True:
        try:
            logger.info("[WazuhSync] Polling Wazuh for new alerts ...")
            async with AsyncSessionLocal() as db:
                await collector.sync_alerts(db)
            logger.info("[WazuhSync] Sync complete.")

        except asyncio.CancelledError:
            logger.info("[WazuhSync] Cancelled — shutting down.")
            break

        except (ProgrammingError, OperationalError) as exc:
            # ── Safety net: tables not ready yet ─────────────────────────────
            logger.warning(
                "[WazuhSync] Database not ready (%s). "
                "Waiting 10s before retry — check that Alembic has run.",
                type(exc).__name__,
            )
            await asyncio.sleep(10)
            continue   # skip the 60-second sleep below; retry quickly

        except Exception as exc:
            logger.error("[WazuhSync] Error: %s", exc, exc_info=True)

        await asyncio.sleep(60)


# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting %s (env: %s) ...", settings.app_name, settings.app_env)

    # Seed initial data. The Dockerfile guarantees Alembic has already run,
    # so tables exist here. The try/except below handles the manual-dev case.
    try:
        await seed_default_admin()
        await _seed_applications_config()
    except (ProgrammingError, OperationalError) as exc:
        logger.warning(
            "Database seed skipped on startup (%s). "
            "Run `alembic upgrade head` then restart.",
            type(exc).__name__,
        )

    wazuh_task  = asyncio.create_task(_start_wazuh_sync())
    engine_task = asyncio.create_task(anomaly_worker())
    logger.info(
        "%s startup complete. Wazuh sync + Anomaly Engine active.",
        settings.app_name,
    )

    yield

    logger.info("Shutting down ATLAS ...")
    for task in (wazuh_task, engine_task):
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
    await close_db()
    logger.info("Shutdown complete.")


# ── FastAPI application ───────────────────────────────────────────────────────

app = FastAPI(
    title="ATLAS — Advanced Traffic Layer Anomaly System",
    description="Enterprise SOC Dashboard backend powered by FastAPI + PostgreSQL + Gemini AI.",
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

app.include_router(auth_router)
app.include_router(dashboard_router)
app.include_router(settings_router)
app.include_router(actions_router)
app.include_router(simulation_router)


# ── AnomalyEvent REST endpoints ───────────────────────────────────────────────

@app.get("/anomalies", tags=["Anomaly Engine"], summary="List recent AI-detected anomalies")
async def list_anomalies(
    limit: int = 50,
    status: str = "",
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
):
    q = select(AnomalyEvent).where(AnomalyEvent.env == current_user.env)
    if status:
        q = q.where(AnomalyEvent.status == status)
    q = q.order_by(desc(AnomalyEvent.detected_at)).limit(limit)
    result = await db.execute(q)
    rows = result.scalars().all()
    return [
        {
            "id": r.id,
            "anomalyType": r.anomaly_type,
            "severity": r.severity,
            "targetApp": r.target_app,
            "sourceIp": r.source_ip,
            "endpoint": r.endpoint,
            "description": r.description,
            "metricsSnapshot": r.metrics_snapshot,
            "aiExplanation": r.ai_explanation,
            "status": r.status,
            "detectedAt": r.detected_at.isoformat() if r.detected_at else None,
            "resolvedAt": r.resolved_at.isoformat() if r.resolved_at else None,
        }
        for r in rows
    ]


@app.patch(
    "/anomalies/{anomaly_id}/acknowledge",
    tags=["Anomaly Engine"],
    summary="Acknowledge an anomaly (Active → Acknowledged)",
)
async def acknowledge_anomaly(
    anomaly_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
):
    from fastapi import HTTPException
    result = await db.execute(
        select(AnomalyEvent).where(
            AnomalyEvent.id == anomaly_id,
            AnomalyEvent.env == current_user.env,
        )
    )
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Anomaly not found.")
    event.status = "Acknowledged"
    await db.commit()
    return {"success": True, "id": anomaly_id, "status": "Acknowledged"}


# ── Global exception handler ──────────────────────────────────────────────────

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


# ── Health endpoints ──────────────────────────────────────────────────────────

@app.get("/", tags=["Health"])
async def root():
    return {
        "service": settings.app_name,
        "version": "3.0.0",
        "stack": "FastAPI + PostgreSQL + Gemini AI",
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
        "stack": "FastAPI",
    }
