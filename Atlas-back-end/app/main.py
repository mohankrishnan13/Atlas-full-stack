"""
main.py — ATLAS FastAPI Application

Startup sequence (lifespan):
  1. seed_default_admin()         — Safely attempts to seed admin (skips if tables missing/exist)
  2. seed_applications_config()   — Safely attempts to seed Apps/Microservices
  3. start_wazuh_sync()           — Background Wazuh poll task (runs every 1 minute)

Note: Table creation is now handled strictly by Alembic migrations externally.
"""

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text, select
from sqlalchemy.exc import IntegrityError, ProgrammingError

from app.core.config import get_settings
from app.core.database import AsyncSessionLocal, close_db
from app.services.auth_service import seed_default_admin
from app.services.wazuh_service import WazuhCollector
from app.models.db_models import Application, AppConfig, Microservice

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

async def _seed_applications_config() -> None:
    """
    Seeds Applications, Microservices, and AppConfigs for every env.
    Idempotent — safely handles race conditions in multi-worker environments.
    """
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

        except (IntegrityError, ProgrammingError):
            await db.rollback()
            logger.info("Application config seed skipped: Data already exists or tables not ready.")
        except Exception as e:
            await db.rollback()
            logger.error(f"Unexpected error during application config seed: {e}")

async def _start_wazuh_sync() -> None:
    """
    Background coroutine that polls Wazuh every minute for new alerts.
    """
    collector = WazuhCollector()
    while True:
        try:
            logger.info("[WazuhSync] Polling Wazuh for new alerts ...")
            async with AsyncSessionLocal() as db:
                await collector.sync_alerts(db)
            logger.info("[WazuhSync] Sync complete.")
        except asyncio.CancelledError:
            logger.info("[WazuhSync] Background task cancelled — shutting down.")
            break
        except Exception as exc:
            logger.error("[WazuhSync] Error during sync: %s", exc, exc_info=True)

        await asyncio.sleep(60)

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"Starting {settings.app_name} (env: {settings.app_env}) ...")
    
    # Database tables are now created by init_db.py before Uvicorn starts
    # This eliminates race conditions and UndefinedTableError issues
    
    try:
        await seed_default_admin()
        await _seed_applications_config()
    except (IntegrityError, ProgrammingError):
        logger.warning("Database not ready. Skipping initial data seeding.")

    wazuh_task = asyncio.create_task(_start_wazuh_sync())
    logger.info(f"{settings.app_name} startup complete. Wazuh sync active.")

    yield

    logger.info("Shutting down ATLAS ...")
    wazuh_task.cancel()
    try:
        await wazuh_task
    except asyncio.CancelledError:
        pass
    await close_db()
    logger.info("Database connection pool closed. Shutdown complete.")

app = FastAPI(
    title="ATLAS — Advanced Traffic Layer Anomaly System",
    description="Enterprise SOC Dashboard backend powered by FastAPI + PostgreSQL.",
    version="2.0.0",
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

@app.get("/", tags=["Health"])
async def root():
    return {
        "service": settings.app_name,
        "version": "2.0.0",
        "stack": "FastAPI + PostgreSQL",
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
