"""
connectors/wazuh_client.py — Async Wazuh Manager API Client

Supersedes:
  - _fetch_live_wazuh_agents()   in services/query_service.py  (blocking)
  - class WazuhCollector         in services/wazuh_service.py  (blocking inside async)

Root problem with the old code
───────────────────────────────
Both the old files called `requests.get(...)` — a synchronous, thread-blocking
function — from within async contexts.  In a FastAPI/asyncio process every
blocking I/O call freezes the event loop for ALL concurrent requests for the
entire duration of the network round-trip (up to the 5-10 s timeout).  With a
slow or unavailable Wazuh host this is catastrophic.

Fix
───
Every HTTP call in this module uses `httpx.AsyncClient`, which is the async
counterpart of `requests`.  `await client.get(...)` suspends *only* the current
coroutine while the TCP read is pending — all other async tasks continue
running.

Token caching
─────────────
Wazuh JWTs expire after 900 s.  We refresh proactively at 840 s so that the
token is always valid before the first call of a new window, avoiding 401 races.
The cache is a module-level dict — suitable for a single-process FastAPI app.
For multi-worker deployments replace it with Redis or a shared external store.

Configuration
─────────────
All credentials and the API URL are read from `Settings` (core/config.py) so
nothing sensitive is hardcoded here.  Override in .env:

    WAZUH_API_URL=https://10.10.5.142:55000
    WAZUH_USERNAME=wazuh-wui
    WAZUH_PASSWORD=your_real_password
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.db_models import EndpointLog

logger = logging.getLogger(__name__)

# ─── Module-level token cache ─────────────────────────────────────────────────
# Intentionally NOT a class attribute — a module-level dict survives across
# multiple calls without instantiating a new client each time.
_token_state: dict[str, Any] = {"token": None, "ts": None}

# Refresh the token 60 s before the Wazuh 900 s expiry window.
_TOKEN_TTL_SECONDS: int = 840


# ─── Internal helpers ─────────────────────────────────────────────────────────

def _map_wazuh_level(level: int) -> str:
    """
    Translates Wazuh's 0–15 rule level scale to the ATLAS severity vocabulary.

    Wazuh scale reference:
      0–3   informational / low noise
      4–6   low (policy warnings, information leaks)
      7–11  medium to high (attacks, access violations)
      12–15 critical (rootkits, critical system breaches)
    """
    if level >= 12:
        return "Critical"
    if level >= 7:
        return "High"
    if level >= 4:
        return "Medium"
    return "Low"


async def _get_token(client: httpx.AsyncClient) -> Optional[str]:
    """
    Returns a valid Wazuh JWT, fetching a new one only when the cached token
    has expired or was never obtained.

    Using an in-process cache keeps the per-request overhead negligible — we
    pay one authentication round-trip every 14 minutes instead of on every
    agent/alert fetch.
    """
    settings = get_settings()
    now = datetime.now(timezone.utc)
    ts: Optional[datetime] = _token_state.get("ts")

    # Return cached token if it is still fresh
    if (
        _token_state["token"]
        and ts is not None
        and (now - ts).total_seconds() < _TOKEN_TTL_SECONDS
    ):
        return _token_state["token"]

    # Re-authenticate
    try:
        res = await client.get(
            f"{settings.wazuh_api_url}/security/user/authenticate",
            auth=(settings.wazuh_username, settings.wazuh_password),
        )
        res.raise_for_status()
        token: Optional[str] = res.json().get("data", {}).get("token")
        if token:
            _token_state["token"] = token
            _token_state["ts"] = now
            logger.debug("[WazuhClient] Token refreshed successfully.")
        else:
            logger.error("[WazuhClient] Authenticate response contained no token.")
        return token
    except (httpx.TimeoutException, httpx.ConnectError):
        logger.error("[WazuhClient] Authentication timed out.")
    except httpx.HTTPStatusError as exc:
        logger.error(
            f"[WazuhClient] Authentication HTTP error {exc.response.status_code}: "
            f"{exc.response.text[:200]}"
        )
    except Exception as exc:
        logger.error(f"[WazuhClient] Unexpected auth error: {exc}")

    return None


def _build_client() -> httpx.AsyncClient:
    """
    Returns a configured AsyncClient.

    `verify=False` disables SSL certificate verification for the self-signed
    cert that Wazuh ships by default.  In production, replace with a path to
    the Wazuh CA bundle:  verify="/etc/wazuh-certs/ca.pem"
    """
    return httpx.AsyncClient(
        verify=False,
        timeout=httpx.Timeout(connect=5.0, read=8.0, write=5.0, pool=5.0),
        # Silence the SSL warning — we are consciously bypassing cert check.
        # httpx does NOT emit urllib3 warnings, but suppress any global ones.
    )


# ─── Public API ───────────────────────────────────────────────────────────────

async def fetch_agents() -> list[dict]:
    """
    Returns the live list of Wazuh agent dicts from the Manager API.

    Each dict has the shape the Wazuh REST API returns, e.g.:
        {
          "id": "001",
          "name": "LAPTOP-JDOE",
          "status": "active",           # active | disconnected | pending
          "os": {"name": "Windows 11", "platform": "windows"},
          ...
        }

    Returns an empty list on any failure so callers can always iterate safely.

    Why async?
    The call may block for up to the configured read timeout (8 s).  Using
    `await` here suspends only this coroutine — the FastAPI event loop stays
    responsive for all other concurrent requests during that wait.
    """
    async with _build_client() as client:
        token = await _get_token(client)
        if not token:
            logger.warning("[WazuhClient] fetch_agents: no token, returning [].")
            return []

        try:
            res = await client.get(
                f"{get_settings().wazuh_api_url}/agents",
                headers={"Authorization": f"Bearer {token}"},
                params={
                    # Request up to 500 agents; increase for larger deployments.
                    "limit": 500,
                    # Include all statuses so the UI can show offline counts.
                    "status": "active,disconnected,pending,never_connected",
                },
            )
            res.raise_for_status()
            agents: list[dict] = res.json().get("data", {}).get("affected_items", [])
            logger.debug(f"[WazuhClient] Fetched {len(agents)} agents.")
            return agents

        except (httpx.TimeoutException, httpx.ConnectError):
            logger.error("[WazuhClient] fetch_agents timed out.")
        except httpx.HTTPStatusError as exc:
            logger.error(
                f"[WazuhClient] fetch_agents HTTP error {exc.response.status_code}."
            )
        except Exception as exc:
            logger.error(f"[WazuhClient] fetch_agents unexpected error: {exc}")

    return []


async def sync_alerts(db: AsyncSession, limit: int = 20) -> int:
    """
    Polls the Wazuh /alerts endpoint and persists new alerts into PostgreSQL
    (endpoint_logs table).

    Idempotency
    ───────────
    Before inserting, we check whether a row with the same `timestamp` already
    exists.  Wazuh timestamps are microsecond-precision ISO strings, making
    them a reliable deduplication key for the polling window.

    Why NOT use the Wazuh alert `id` directly?
    The Wazuh alert ID is an internal string like "1717034012.5432".  We store
    it in `raw_payload` for forensics but do not have a dedicated column for it
    yet.  Adding one (e.g. `external_id VARCHAR`) and indexing it would make
    deduplication O(1) — recommended for high-volume deployments.

    Parameters
    ──────────
    db      AsyncSession — the SQLAlchemy session to write into.
    limit   Number of recent alerts to fetch from Wazuh per call (default 20).

    Returns the count of newly inserted rows (0 if nothing new or on failure).

    Blocking concern addressed
    ──────────────────────────
    The old WazuhCollector.sync_alerts() called requests.get() inside an
    async def, stalling the event loop.  This version awaits httpx, so the
    coroutine yields control correctly during every network wait.
    """
    async with _build_client() as client:
        token = await _get_token(client)
        if not token:
            logger.warning("[WazuhClient] sync_alerts aborted — no token.")
            return 0

        try:
            res = await client.get(
                f"{get_settings().wazuh_api_url}/security/alerts",
                headers={"Authorization": f"Bearer {token}"},
                params={"limit": limit, "sort": "-timestamp"},
            )
            res.raise_for_status()
            alerts: list[dict] = (
                res.json().get("data", {}).get("affected_items", [])
            )
        except (httpx.TimeoutException, httpx.ConnectError):
            logger.error("[WazuhClient] sync_alerts fetch timed out.")
            return 0
        except httpx.HTTPStatusError as exc:
            logger.error(
                f"[WazuhClient] sync_alerts HTTP error {exc.response.status_code}."
            )
            return 0
        except Exception as exc:
            logger.error(f"[WazuhClient] sync_alerts unexpected error: {exc}")
            return 0

    inserted = 0

    for alert in alerts:
        ts: str = alert.get("timestamp", "")

        # ── Deduplication check ───────────────────────────────────────────────
        existing = (
            await db.execute(
                select(EndpointLog)
                .where(EndpointLog.timestamp == ts)
                .limit(1)
            )
        ).scalar_one_or_none()

        if existing:
            continue  # already in DB — skip

        # ── Map Wazuh alert fields to EndpointLog columns ─────────────────────
        agent: dict = alert.get("agent", {})
        rule:  dict = alert.get("rule", {})
        data:  dict = alert.get("data", {})

        db.add(
            EndpointLog(
                env="local",
                workstation_id=agent.get("name") or "Unknown-Host",
                employee=(
                    data.get("dstuser")
                    or data.get("srcuser")
                    or "system"
                ),
                alert_message=rule.get("description") or "Wazuh Security Alert",
                alert_category=(rule.get("groups") or ["security"])[0],
                severity=_map_wazuh_level(int(rule.get("level") or 0)),
                os_name=agent.get("os", {}).get("name") or "Managed Agent",
                is_malware=int(rule.get("level") or 0) >= 10,
                is_offline=False,
                timestamp=ts,
                raw_payload=alert,   # full JSON preserved for forensics
            )
        )
        inserted += 1

    if inserted > 0:
        await db.commit()
        logger.info(f"[WazuhClient] Synced {inserted} new alerts into endpoint_logs.")

    return inserted
