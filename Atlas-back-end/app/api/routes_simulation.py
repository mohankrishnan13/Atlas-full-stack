"""
api/routes_simulation.py — ATLAS Attack Simulator

POST /api/simulate/anomaly

Injects realistic anomalous telemetry records into ApiLog, NetworkLog, or
EndpointLog to simulate live attacks for demo purposes. After inserting records,
it immediately triggers a one-shot anomaly detection run so the AnomalyEvent
appears in the UI within seconds (rather than waiting for the 60-second cycle).

Supported attack types:
  api_spike       — 600 high-volume API calls from multiple IPs (triggers API_SPIKE)
  brute_force     — 500 401 Unauthorized hits on /api/auth/login (triggers BRUTE_FORCE)
  high_latency    — 300 calls with 3000–8000ms response times (triggers HIGH_LATENCY)
  network_spike   — 400 network log entries with large byte transfers (triggers NETWORK_SPIKE)
  port_scan       — 300 NetworkLog rows from one IP across 80+ ports (triggers PORT_SCAN)
  malware_outbreak— 50 EndpointLog rows with is_malware=True (triggers MALWARE_OUTBREAK)

Security: This endpoint requires a valid JWT. In production, restrict it further
to Admin role only (or remove entirely). It is intentionally NOT authenticated by
INGEST_API_KEY because analysts run it from the dashboard UI.
"""

import logging
import random
import string
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.db_models import ApiLog, EndpointLog, NetworkLog, AtlasUser
from app.services.auth_service import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/simulate", tags=["Attack Simulator"])

# ── Request / Response schemas ────────────────────────────────────────────────

AttackType = Literal[
    "api_spike",
    "brute_force",
    "high_latency",
    "network_spike",
    "port_scan",
    "malware_outbreak",
]

class SimulateRequest(BaseModel):
    type: AttackType
    env: str = "cloud"          # which environment to inject into
    count: int = 0              # 0 = use the default for this attack type


class SimulateResponse(BaseModel):
    success: bool
    attack_type: str
    records_inserted: int
    message: str
    triggered_anomaly_check: bool


# ── Helpers ───────────────────────────────────────────────────────────────────

def _rand_ip(prefix: str = "") -> str:
    """Generates a random IP address, optionally with a fixed prefix octet."""
    if prefix:
        return f"{prefix}.{random.randint(1,254)}.{random.randint(1,254)}.{random.randint(1,254)}"
    return ".".join(str(random.randint(1, 254)) for _ in range(4))


def _rand_str(n: int = 8) -> str:
    return "".join(random.choices(string.ascii_lowercase, k=n))


def _now_minus(seconds: int = 0) -> datetime:
    return datetime.now(timezone.utc) - timedelta(seconds=seconds)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


# ── Attack generators ─────────────────────────────────────────────────────────

def _gen_api_spike(env: str, count: int) -> list[ApiLog]:
    """
    600 high-frequency API calls from diverse source IPs across several endpoints.
    Spread over the last 4 minutes to stay within the engine's 5-minute window.
    """
    endpoints = ["/api/products", "/api/search", "/api/recommendations", "/api/cart"]
    apps = ["naukri", "flipkart", "genai"]
    records = []
    for i in range(count):
        records.append(ApiLog(
            env=env,
            severity="Info",
            app=random.choice(apps),
            target_app=random.choice(apps),
            source_ip=_rand_ip("203"),
            path=random.choice(endpoints),
            method="GET",
            action="OK",
            endpoint=random.choice(endpoints),
            status_code=200,
            response_time_ms=round(random.uniform(50, 300), 2),
            logged_at=_now_minus(random.randint(0, 240)),
            timestamp=_iso(_now_minus(random.randint(0, 240))),
            raw_payload={},
        ))
    return records


def _gen_brute_force(env: str, count: int) -> list[ApiLog]:
    """
    500+ failed authentication attempts (HTTP 401) on /api/auth/login.
    Uses ~20 distinct source IPs to mimic a distributed credential-stuffing attack.
    """
    attacker_ips = [_rand_ip("185") for _ in range(20)]
    records = []
    for i in range(count):
        records.append(ApiLog(
            env=env,
            severity="Critical",
            app="auth",
            target_app="naukri",
            source_ip=random.choice(attacker_ips),
            path="/api/auth/login",
            method="POST",
            action="BLOCKED",
            endpoint="/api/auth/login",
            status_code=401,
            response_time_ms=round(random.uniform(20, 80), 2),
            logged_at=_now_minus(random.randint(0, 290)),
            timestamp=_iso(_now_minus(random.randint(0, 290))),
            raw_payload={"attempt": i},
        ))
    return records


def _gen_high_latency(env: str, count: int) -> list[ApiLog]:
    """
    300 API calls with degraded response times (3–8 seconds).
    Simulates a slow dependency (e.g. database overload, external API timeout).
    """
    endpoints = ["/api/payments", "/api/checkout", "/api/reports"]
    records = []
    for _ in range(count):
        records.append(ApiLog(
            env=env,
            severity="High",
            app="payment",
            target_app="flipkart",
            source_ip=_rand_ip("10"),
            path=random.choice(endpoints),
            method=random.choice(["GET", "POST"]),
            action="SLOW",
            endpoint=random.choice(endpoints),
            status_code=200,
            response_time_ms=round(random.uniform(3000, 8000), 2),
            logged_at=_now_minus(random.randint(0, 270)),
            timestamp=_iso(_now_minus(random.randint(0, 270))),
            raw_payload={},
        ))
    return records


def _gen_network_spike(env: str, count: int) -> list[NetworkLog]:
    """
    400 NetworkLog records with large byte transfers (5–50 MB each).
    Total: ~10–20 GB to comfortably exceed the 500 MB spike threshold.
    """
    attacker_ip = _rand_ip("91")
    records = []
    for _ in range(count):
        records.append(NetworkLog(
            env=env,
            severity="High",
            source_ip=attacker_ip,
            dest_ip=_rand_ip("10"),
            app="network",
            target_app="flipkart",
            port=random.choice([80, 443, 8080, 3306]),
            anomaly_type="DATA_EXFILTRATION",
            bandwidth_pct=random.randint(70, 99),
            active_connections=random.randint(100, 500),
            dropped_packets=random.randint(0, 20),
            bytes_transferred=random.randint(5 * 1024 * 1024, 50 * 1024 * 1024),
            detected_at=_now_minus(random.randint(0, 280)),
            timestamp=_iso(_now_minus(random.randint(0, 280))),
            raw_payload={},
        ))
    return records


def _gen_port_scan(env: str, count: int) -> list[NetworkLog]:
    """
    300 NetworkLog records from a single source IP across 80+ distinct destination ports.
    Classic vertical port scan signature.
    """
    scanner_ip = _rand_ip("77")
    # Enumerate real ports to ensure distinct_ports count triggers detection
    ports = list(range(20, 1024, 3))[:count]   # up to count distinct ports
    records = []
    for port in ports:
        records.append(NetworkLog(
            env=env,
            severity="High",
            source_ip=scanner_ip,
            dest_ip=_rand_ip("10"),
            app="network",
            target_app="All",
            port=port,
            anomaly_type="PORT_SCAN",
            bandwidth_pct=5,
            active_connections=1,
            dropped_packets=0,
            bytes_transferred=random.randint(40, 200),
            detected_at=_now_minus(random.randint(0, 295)),
            timestamp=_iso(_now_minus(random.randint(0, 295))),
            raw_payload={"scanner_ip": scanner_ip},
        ))
    return records


def _gen_malware_outbreak(env: str, count: int) -> list[EndpointLog]:
    """
    50 EndpointLog records with is_malware=True across different workstations.
    """
    apps = ["naukri", "flipkart", "genai"]
    malware_names = [
        "Trojan.GenericKD.47195836",
        "Ransom.WannaCry",
        "Backdoor.Agent.DC",
        "Spyware.Keylogger.XP",
        "Rootkit.Necurs",
    ]
    records = []
    for i in range(count):
        ws_id = f"LAPTOP-SIM{i:03d}"
        records.append(EndpointLog(
            env=env,
            severity="Critical",
            workstation_id=ws_id,
            employee=f"SimUser{i:03d}",
            avatar="",
            os_name=random.choice(["Windows 10", "Windows 11", "macOS 14"]),
            target_app=random.choice(apps),
            alert_message=f"Malware detected: {random.choice(malware_names)}",
            alert_category="Malware",
            is_offline=random.random() > 0.7,
            is_malware=True,
            timestamp=_iso(_now_minus(random.randint(0, 270))),
            raw_payload={"simulated": True},
        ))
    return records


# ── Default counts per attack type ───────────────────────────────────────────

_DEFAULTS: dict[str, int] = {
    "api_spike":        600,
    "brute_force":      520,
    "high_latency":     300,
    "network_spike":    400,
    "port_scan":        300,
    "malware_outbreak":  50,
}

_MESSAGES: dict[str, str] = {
    "api_spike":        "Injected high-volume API traffic. Engine will detect API_SPIKE.",
    "brute_force":      "Injected 401 auth failures on /login. Engine will detect BRUTE_FORCE.",
    "high_latency":     "Injected slow API responses. Engine will detect HIGH_LATENCY.",
    "network_spike":    "Injected large network transfers. Engine will detect NETWORK_SPIKE.",
    "port_scan":        "Injected multi-port scan traffic. Engine will detect PORT_SCAN.",
    "malware_outbreak": "Injected malware endpoint alerts. Engine will detect MALWARE_OUTBREAK.",
}


# ── Route ─────────────────────────────────────────────────────────────────────

@router.post(
    "/anomaly",
    response_model=SimulateResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Inject simulated attack telemetry",
    description=(
        "Inserts realistic anomalous records into the telemetry tables to trigger "
        "the Anomaly Engine on its next cycle (≤60s). Use this to demo the "
        "AI explanation feature without a real attack."
    ),
)
async def simulate_anomaly(
    payload: SimulateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
) -> SimulateResponse:
    """
    Requires a valid JWT. Admin or Analyst role recommended.
    """
    attack_type: str = payload.type
    env: str = payload.env or current_user.env
    count: int = payload.count if payload.count > 0 else _DEFAULTS[attack_type]

    logger.warning(
        "[Simulator] Attack simulation triggered by %s: type=%s env=%s count=%d",
        current_user.email, attack_type, env, count,
    )

    try:
        # Generate records
        records: list = []
        if attack_type == "api_spike":
            records = _gen_api_spike(env, count)
        elif attack_type == "brute_force":
            records = _gen_brute_force(env, count)
        elif attack_type == "high_latency":
            records = _gen_high_latency(env, count)
        elif attack_type == "network_spike":
            records = _gen_network_spike(env, count)
        elif attack_type == "port_scan":
            records = _gen_port_scan(env, count)
        elif attack_type == "malware_outbreak":
            records = _gen_malware_outbreak(env, count)
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown attack type: {attack_type}",
            )

        # Bulk insert — use add_all for efficiency
        db.add_all(records)
        await db.commit()

        logger.info(
            "[Simulator] Inserted %d records for %s/%s",
            len(records), env, attack_type,
        )

        # ── Trigger an immediate one-shot detection run ───────────────────
        # Import here to avoid circular imports at module load time
        triggered = False
        try:
            import asyncio
            from app.services.anomaly_engine import (
                _check_api_anomalies,
                _check_network_anomalies,
                _check_endpoint_anomalies,
            )
            from app.core.database import AsyncSessionLocal

            async def _run_checks() -> None:
                async with AsyncSessionLocal() as check_db:
                    await _check_api_anomalies(check_db, env)
                    await _check_network_anomalies(check_db, env)
                    await _check_endpoint_anomalies(check_db, env)

            # Schedule as a background task — do not await (returns immediately)
            asyncio.create_task(_run_checks())
            triggered = True
        except Exception as trigger_exc:
            logger.warning("[Simulator] Could not trigger immediate check: %s", trigger_exc)

        return SimulateResponse(
            success=True,
            attack_type=attack_type,
            records_inserted=len(records),
            message=_MESSAGES[attack_type],
            triggered_anomaly_check=triggered,
        )

    except HTTPException:
        raise
    except Exception as exc:
        await db.rollback()
        logger.error("[Simulator] Failed to inject records: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Simulation failed: {exc}",
        )
