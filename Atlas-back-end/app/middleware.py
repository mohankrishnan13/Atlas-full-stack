"""
app/middleware.py — ATLAS Request Middleware

Two responsibilities, one middleware:

  1. KILL SWITCH ENFORCEMENT
     Before forwarding any request to a route handler, the middleware checks
     the BlockedEntity table for two match types:

       • entity_type='ip'    — exact match against the client IP
       • entity_type='route' — prefix match against the request path
                               (e.g. blocking "/api/v1/export" blocks all
                               sub-paths like "/api/v1/export/csv")

     If a match is found, the middleware returns 403 Forbidden immediately
     without touching the route handler, SQLAlchemy sessions, or any
     business logic. This makes the block truly "hard" — it fires before
     auth, before dependency injection, before everything.

  2. REQUEST TELEMETRY LOGGING
     After the route handler completes (or is blocked), the middleware writes
     one row to ApiLog capturing:
       - path, method, source IP, status code, response time (ms)
       - env inferred from the JWT (or "cloud" default when unauthenticated)

     The write is fire-and-forget via asyncio.create_task() so it never
     adds latency to the response path even under load.

PERFORMANCE DESIGN
──────────────────
  BlockedEntity rows are cached in-process in _BlocklistCache. The cache
  refreshes from PostgreSQL every CACHE_TTL_SECONDS (default 30). Under a
  sustained attack, the per-request overhead is a single dict lookup in memory
  — no database round-trip on the hot path.

  ApiLog writes are buffered: rows accumulate in a deque and are flushed to
  PostgreSQL every FLUSH_INTERVAL_SECONDS (default 10) by a background asyncio
  task, or when the buffer reaches FLUSH_BATCH_SIZE rows. This prevents the
  log write from adding latency to every response while still giving near-real-
  time data to the API Monitoring dashboard.

PATHS EXCLUDED FROM LOGGING
────────────────────────────
  Health checks, Swagger UI, static assets, and the Alembic migration status
  endpoint are excluded from ApiLog writes — they generate noise without signal.
  See _SKIP_LOG_PREFIXES below.
"""

import asyncio
import logging
import time
from collections import deque
from datetime import datetime, timezone
from typing import Deque, Optional

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy import select, and_
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.types import ASGIApp

from app.core.database import AsyncSessionLocal
from app.models.db_models import ApiLog, BlockedEntity

logger = logging.getLogger(__name__)

# ── Tuning constants ──────────────────────────────────────────────────────────

# How often (seconds) the in-process blocklist cache refreshes from PostgreSQL.
# Lower = faster propagation of new blocks; higher = fewer DB reads.
CACHE_TTL_SECONDS: int = 30

# ApiLog write buffer settings.
FLUSH_INTERVAL_SECONDS: int = 10     # flush at most every N seconds
FLUSH_BATCH_SIZE: int = 200          # flush immediately if buffer reaches this

# Paths that are never written to ApiLog — health probes, docs, static.
_SKIP_LOG_PREFIXES: tuple[str, ...] = (
    "/health",
    "/docs",
    "/redoc",
    "/openapi.json",
    "/favicon.ico",
    "/_next/",
    "/static/",
)

# Paths that bypass BOTH the kill switch AND logging entirely.
# These must never be blocked — if you lock out /api/auth/login you
# can't unblock anything from the UI.
_BYPASS_PREFIXES: tuple[str, ...] = (
    "/api/auth/login",
    "/health",
    "/docs",
    "/redoc",
    "/openapi.json",
)


# ── In-process blocklist cache ────────────────────────────────────────────────

class _BlocklistCache:
    """
    Holds the active BlockedEntity rows in two sets for O(1) lookup:
      _blocked_ips    — set of exact IP strings
      _blocked_routes — set of route path strings (matched as prefix)

    The cache is populated lazily on first use and refreshed every
    CACHE_TTL_SECONDS by AtlasMiddleware._maybe_refresh_cache().
    """

    def __init__(self) -> None:
        self._blocked_ips: set[str]    = set()
        self._blocked_routes: set[str] = set()
        self._last_refresh: float      = 0.0
        self._lock = asyncio.Lock()

    def is_ip_blocked(self, ip: str) -> bool:
        return ip in self._blocked_ips

    def is_route_blocked(self, path: str) -> bool:
        """Prefix-match: any stored route that is a prefix of `path` blocks it."""
        return any(path.startswith(r) for r in self._blocked_routes)

    def needs_refresh(self) -> bool:
        return (time.monotonic() - self._last_refresh) >= CACHE_TTL_SECONDS

    async def refresh(self) -> None:
        """Reload active blocked entities from PostgreSQL."""
        async with self._lock:
            # Double-check under lock to avoid stampede.
            if not self.needs_refresh():
                return
            try:
                async with AsyncSessionLocal() as db:
                    result = await db.execute(
                        select(BlockedEntity.entity_type, BlockedEntity.value)
                        .where(BlockedEntity.is_active == True)  # noqa: E712
                    )
                    rows = result.all()

                new_ips: set[str]    = set()
                new_routes: set[str] = set()
                for entity_type, value in rows:
                    if entity_type == "ip":
                        new_ips.add(value)
                    elif entity_type == "route":
                        new_routes.add(value)

                self._blocked_ips    = new_ips
                self._blocked_routes = new_routes
                self._last_refresh   = time.monotonic()

                logger.debug(
                    "[Blocklist] Refreshed: %d blocked IPs, %d blocked routes",
                    len(new_ips), len(new_routes),
                )
            except Exception as exc:
                # Never crash the middleware if the DB is temporarily unavailable.
                # The stale cache continues to enforce existing blocks.
                logger.warning("[Blocklist] Cache refresh failed: %s", exc)


# ── ApiLog write buffer ───────────────────────────────────────────────────────

class _ApiLogBuffer:
    """
    Accumulates ApiLog row dicts in a deque and flushes them to PostgreSQL
    in batches via a background asyncio task.

    The flush task is started by AtlasMiddleware.startup() (called from the
    FastAPI lifespan via app.middleware_instance.startup()).
    """

    def __init__(self) -> None:
        self._buf: Deque[dict] = deque()
        self._task: Optional[asyncio.Task] = None

    def push(self, row: dict) -> None:
        self._buf.append(row)
        if len(self._buf) >= FLUSH_BATCH_SIZE:
            # Schedule an immediate flush without blocking the response path.
            asyncio.create_task(self._flush())

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._periodic_flush())

    def stop(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()

    async def _periodic_flush(self) -> None:
        while True:
            try:
                await asyncio.sleep(FLUSH_INTERVAL_SECONDS)
                await self._flush()
            except asyncio.CancelledError:
                # Final flush on shutdown.
                await self._flush()
                break
            except Exception as exc:
                logger.error("[ApiLogBuffer] Periodic flush error: %s", exc)

    async def _flush(self) -> None:
        if not self._buf:
            return

        # Drain the buffer atomically.
        batch, self._buf = list(self._buf), deque()

        try:
            async with AsyncSessionLocal() as db:
                db.add_all([ApiLog(**row) for row in batch])
                await db.commit()
                logger.debug("[ApiLogBuffer] Flushed %d rows.", len(batch))
        except Exception as exc:
            logger.error(
                "[ApiLogBuffer] Flush failed (%d rows dropped): %s",
                len(batch), exc,
            )


# ── Middleware ────────────────────────────────────────────────────────────────

class AtlasMiddleware(BaseHTTPMiddleware):
    """
    FastAPI/Starlette middleware that:
      1. Enforces the BlockedEntity kill switch (returns 403 on match).
      2. Logs every non-excluded request to ApiLog (fire-and-forget buffer).

    Registration in main.py:
        from app.middleware import AtlasMiddleware
        app.add_middleware(AtlasMiddleware)

    The middleware starts its background flush task automatically when the
    ASGI app starts (via the Starlette lifespan / startup hook).  If you are
    using FastAPI's own lifespan context manager you can alternatively call:
        atlas_middleware.buffer.start()   # in lifespan startup
        atlas_middleware.buffer.stop()    # in lifespan shutdown
    """

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)
        self.cache  = _BlocklistCache()
        self.buffer = _ApiLogBuffer()

    # ── Called by Starlette on ASGI startup ───────────────────────────────────
    async def startup(self) -> None:
        self.buffer.start()
        logger.info("[AtlasMiddleware] ApiLog buffer started.")

    async def shutdown(self) -> None:
        self.buffer.stop()
        logger.info("[AtlasMiddleware] ApiLog buffer stopped.")

    # ── Main request dispatch ─────────────────────────────────────────────────

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        path      = request.url.path
        method    = request.method
        client_ip = self._get_client_ip(request)
        env       = self._get_env(request)
        t_start   = time.perf_counter()

        # ── 1. Hard bypass — health / auth / docs never blocked or logged ─────
        if any(path.startswith(p) for p in _BYPASS_PREFIXES):
            return await call_next(request)

        # ── 2. Refresh blocklist cache if stale ───────────────────────────────
        if self.cache.needs_refresh():
            asyncio.create_task(self.cache.refresh())

        # ── 3. Kill switch check ──────────────────────────────────────────────
        if self.cache.is_ip_blocked(client_ip):
            logger.warning(
                "[KillSwitch] Blocked IP %s attempted %s %s",
                client_ip, method, path,
            )
            self._log_blocked(client_ip, path, method, "ip", env)
            return JSONResponse(
                status_code=403,
                content={
                    "error":  "Forbidden",
                    "detail": "Your IP address has been blocked by the SOC.",
                },
            )

        if self.cache.is_route_blocked(path):
            logger.warning(
                "[KillSwitch] Blocked route accessed by %s: %s %s",
                client_ip, method, path,
            )
            self._log_blocked(client_ip, path, method, "route", env)
            return JSONResponse(
                status_code=403,
                content={
                    "error":  "Forbidden",
                    "detail": "This endpoint has been disabled by the SOC.",
                },
            )

        # ── 4. Forward to route handler ───────────────────────────────────────
        response = await call_next(request)

        # ── 5. Log to ApiLog buffer (fire-and-forget) ─────────────────────────
        if not any(path.startswith(p) for p in _SKIP_LOG_PREFIXES):
            elapsed_ms = (time.perf_counter() - t_start) * 1000
            self._push_log(
                client_ip=client_ip,
                path=path,
                method=method,
                status_code=response.status_code,
                response_time_ms=elapsed_ms,
                env=env,
            )

        return response

    # ── Helpers ───────────────────────────────────────────────────────────────

    @staticmethod
    def _get_client_ip(request: Request) -> str:
        """
        Reads the real client IP, respecting X-Forwarded-For when set by a
        trusted reverse proxy (nginx, load balancer).
        """
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            # X-Forwarded-For may contain a chain: "client, proxy1, proxy2"
            return forwarded.split(",")[0].strip()
        return request.client.host if request.client else "unknown"

    @staticmethod
    def _get_env(request: Request) -> str:
        """
        Reads the active environment from the ?env= query parameter that the
        frontend apiFetch injects on every request. Defaults to 'cloud' when
        the parameter is absent (unauthenticated requests, health checks, etc.).

        Valid values: 'cloud' | 'local'. Any other value is clamped to 'cloud'.
        """
        env = request.query_params.get("env", "cloud")
        return env if env in ("cloud", "local") else "cloud"

    def _push_log(
        self,
        client_ip: str,
        path: str,
        method: str,
        status_code: int,
        response_time_ms: float,
        env: str = "cloud",
    ) -> None:
        """Builds an ApiLog row dict and pushes it to the write buffer."""
        severity = (
            "Critical" if status_code >= 500
            else "High" if status_code >= 400
            else "Info"
        )
        now = datetime.now(timezone.utc)
        self.buffer.push({
            "env":              env,
            "severity":         severity,
            "app":              "ATLAS",
            "target_app":       "ATLAS",
            "source_ip":        client_ip,
            "path":             path,
            "method":           method,
            "action":           "OK" if status_code < 400 else "Error",
            "endpoint":         path,
            "status_code":      status_code,
            "response_time_ms": round(response_time_ms, 3),
            "logged_at":        now,
            "timestamp":        now.isoformat(),
            "raw_payload":      {},
        })

    def _log_blocked(
        self,
        client_ip: str,
        path: str,
        method: str,
        block_type: str,
        env: str = "cloud",
    ) -> None:
        """Pushes a 403 row to the ApiLog buffer for blocked requests."""
        now = datetime.now(timezone.utc)
        self.buffer.push({
            "env":              env,
            "severity":         "Critical",
            "app":              "ATLAS",
            "target_app":       "ATLAS",
            "source_ip":        client_ip,
            "path":             path,
            "method":           method,
            "action":           f"BLOCKED_{block_type.upper()}",
            "endpoint":         path,
            "status_code":      403,
            "response_time_ms": 0.0,
            "logged_at":        now,
            "timestamp":        now.isoformat(),
            "raw_payload":      {"block_type": block_type},
        })
