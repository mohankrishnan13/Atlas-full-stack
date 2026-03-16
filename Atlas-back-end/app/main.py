"""
main.py — ATLAS FastAPI Application

Startup sequence (lifespan):
  1. create_all_tables()          — idempotent DDL sync
  2. seed_default_admin()         — only runs when atlas_users is empty
  3. seed_applications_config()   — seeds Applications / Microservices / AppConfigs
  4. ingest_all_logs()            — JSONL → PostgreSQL  (if startup_run_log_ingest=True)
  5. warm_cache()                 — CSVs → Pandas RAM   (if startup_warm_pandas_cache=True)

Flags 4 and 5 are independently controlled via Settings so CI, tests,
and production environments can skip whichever steps are unnecessary.
"""

import logging
from contextlib import asynccontextmanager
import asyncio
from app.services.wazuh_service import WazuhCollector 

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.core.config import get_settings
from app.core.database import AsyncSessionLocal, close_db, create_all_tables
from app.services.auth_service import seed_default_admin
from app.services.query_service import warm_cache, _invalidate_cache

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


# ─── Seed helper ─────────────────────────────────────────────────────────────

async def _seed_applications_config() -> None:
    """
    Seeds Applications, Microservices, and AppConfigs for every env.
    Idempotent — rows are only inserted if they don't already exist.
    Applications and app-ids are derived from Settings so they stay
    consistent with what query_service / the frontend expect.
    """
    from sqlalchemy import select
    from app.models.db_models import Application, AppConfig, Microservice

    _APPS = [
        ("all",      "All Applications"),
        ("naukri",   "Naukri"),
        ("genai",    "GenAI"),
        ("flipkart", "Flipkart"),
    ]

    _MICROSERVICES = [
        # (service_id, name, status, top, left, connections_csv)
        ("api",           "API-Gateway",           "Healthy", "40%", "75%", "auth,payment,notifications"),
        ("auth",          "Auth-Service",           "Healthy", "20%", "25%", "api"),
        ("payment",       "Payment-Service",        "Healthy", "50%", "50%", "api"),
        ("notifications", "Notification-Service",   "Healthy", "70%", "25%", "api"),
    ]

    async with AsyncSessionLocal() as db:
        for env in ("cloud", "local"):
            # ── Applications ──────────────────────────────────────────────────
            for app_id, name in _APPS:
                exists = (await db.execute(
                    select(Application).where(
                        Application.env == env,
                        Application.app_id == app_id,
                    )
                )).scalar_one_or_none()
                if not exists:
                    db.add(Application(env=env, app_id=app_id, name=name))

            # ── Microservices ─────────────────────────────────────────────────
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

            # ── AppConfigs ────────────────────────────────────────────────────
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


# ─── Application Lifespan ─────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"Starting {settings.app_name} (env: {settings.app_env}) ...")

    # 1. DDL sync
    await create_all_tables()

    # 2. Seed user accounts
    try:
        await seed_default_admin()
    except Exception as exc:
        logger.error(f"Admin seed failed: {exc}", exc_info=True)

    # 3. Seed applications / microservices / app configs
    try:
        await _seed_applications_config()
    except Exception as exc:
        logger.error(f"Applications/config seed failed: {exc}", exc_info=True)

    # 4. JSONL → PostgreSQL ingest  (controlled by startup_run_log_ingest)
    if settings.startup_run_log_ingest:
        try:
            logger.info("Running log ingest (JSONL → PostgreSQL) ...")
            from app.services.log_ingestion import ingest_all_logs
            async with AsyncSessionLocal() as db:
                await ingest_all_logs(db)
            logger.info("Log ingest complete.")
        except Exception as exc:
            logger.error(
                f"Log ingest failed: {exc}. "
                "Case Management / Incident data may be empty.",
                exc_info=True,
            )
    else:
        logger.info("startup_run_log_ingest=False — skipping JSONL ingest.")

    # 5. CSVs → Pandas RAM cache  (controlled by startup_warm_pandas_cache)
    if settings.startup_warm_pandas_cache:
        try:
            logger.info("Warming Pandas CSV in-memory engine ...")
            warm_cache()
            logger.info("Pandas cache warm — dashboard charts ready.")
        except Exception as exc:
            logger.error(
                f"Pandas cache warm failed: {exc}. "
                "Dashboard charts may appear empty.",
                exc_info=True,
            )
    else:
        logger.info("startup_warm_pandas_cache=False — skipping Pandas warm.")

    logger.info(
        f"{settings.app_name} startup complete.  "
        f"Docs: http://localhost:8000/docs"
    )

    yield  # ── Application is running ──────────────────────────────────────

    logger.info("Shutting down ATLAS ...")
    await close_db()
    logger.info("Database connection pool closed.  Shutdown complete.")


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
    allow_origins=settings.get_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Routers ───────────────────────────────────────────────────────────────────
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
    Hot-reloads Loghub CSVs into Pandas memory.

    Invalidates the TTL cache first so warm_cache() always re-reads
    from disk — otherwise calls within the TTL window are no-ops.
    """
    try:
        _invalidate_cache()   # bust TTL so warm_cache re-reads disk
        warm_cache()
        return {"status": "success", "message": "Pandas in-memory cache reloaded."}
    except Exception as exc:
        logger.error(f"Manual cache reload failed: {exc}", exc_info=True)
        return JSONResponse(
            status_code=500,
            content={"status": "error", "detail": str(exc)},
        )

async def start_wazuh_sync():
    """Background task to poll Wazuh every 30 seconds."""
    collector = WazuhCollector(host="127.0.0.1") # Point to your laptop's IP
    while True:
        try:
            logger.info("Polling Wazuh Manager for new alerts...")
            async with AsyncSessionLocal() as db:
                await collector.sync_alerts(db)
            
            # After syncing DB, refresh the Pandas cache so charts update
            _invalidate_cache()
            warm_cache()
            
            logger.info("Wazuh sync complete. Dashboard updated.")
        except Exception as e:
            logger.error(f"Wazuh Sync Error: {e}")
        
        await asyncio.sleep(300) # Wait 300 seconds (5 minutes) before next poll

@asynccontextmanager
async def lifespan(app: FastAPI):
    # ... 1. DDL sync ...
    # ... 2. Seed admin ...
    # ... 3. Seed apps ...

    # 4. Start the Wazuh Background Task
    # This runs 'in the background' without blocking the API start
    wazuh_task = asyncio.create_task(start_wazuh_sync())

    logger.info("ATLAS is live with real Wazuh data streaming.")

    yield  # ── Application is running ──────────────────────────────────────

    # Cleanup
    wazuh_task.cancel()
    await close_db()