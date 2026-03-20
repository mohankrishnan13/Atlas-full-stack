"""
services/anomaly_engine.py — ATLAS Anomaly Detection Engine

Background worker that runs every 60 seconds. It:

  1. COMPUTE  — Queries the last 5 minutes of ApiLog and NetworkLog data,
                computing aggregate metrics (call count, error rate, avg latency,
                network spike indicators).

  2. DETECT   — Compares computed metrics against defined thresholds:
                  • HIGH_ERROR_RATE   — error_rate > 10%
                  • API_SPIKE         — call_count > baseline * 3
                  • HIGH_LATENCY      — avg_latency_ms > 2000ms
                  • NETWORK_SPIKE     — total_bytes > spike threshold
                  • BRUTE_FORCE       — >50 auth failures in 5 min on /login

  3. EXPLAIN  — If an anomaly is found, calls Google Gemini to generate a
                SOC analyst–style explanation with likely cause + 2 mitigations.

  4. STORE    — Persists an AnomalyEvent row. The dashboard reads from this
                table; no polling of raw logs in the UI hot path.

Deduplication: An anomaly is not re-raised if an identical (env, anomaly_type,
target_app) event already exists with status='Active' AND was detected within
the last 10 minutes. This prevents flooding the UI during an active attack.

Gemini graceful degradation: If the Gemini API is unavailable or not configured,
the anomaly is still stored — only `ai_explanation` is left NULL.
"""

import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import case, func, select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.models.db_models import AnomalyEvent, ApiLog, NetworkLog, EndpointLog

logger = logging.getLogger(__name__)

# ── Detection thresholds ──────────────────────────────────────────────────────

# Normal baseline — calls per 5-minute window before we flag a spike
API_BASELINE_CALLS_PER_5MIN: int = int(os.getenv("ANOMALY_BASELINE_CALLS", "200"))
API_SPIKE_MULTIPLIER: float = 3.0          # flag if call_count > baseline * 3
API_ERROR_RATE_THRESHOLD: float = 0.10     # 10 % non-2xx responses
API_HIGH_LATENCY_MS: float = 2000.0        # avg response time above 2 s
BRUTE_FORCE_MIN_FAILURES: int = 50         # 401s on /login within 5 min

NETWORK_SPIKE_BYTES: int = int(os.getenv("ANOMALY_NETWORK_SPIKE_BYTES", str(500 * 1024 * 1024)))  # 500 MB
MALWARE_ALERT_THRESHOLD: int = 5           # distinct malware events in 5 min

# Re-raise cooldown — don't create a duplicate Active anomaly within N minutes
DEDUP_WINDOW_MINUTES: int = 10

# Gemini model
GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")

# ── Gemini helper ─────────────────────────────────────────────────────────────

async def _call_gemini(prompt: str) -> Optional[str]:
    """
    Calls the Google Gemini API with the given prompt.
    Returns the text response, or None on any error.
    Runs the blocking SDK call in a thread pool to avoid blocking the event loop.
    """
    api_key = os.getenv("GEMINI_API_KEY", "")
    if not api_key:
        logger.warning("[AnomalyEngine] GEMINI_API_KEY not set — skipping AI explanation.")
        return None

    try:
        import google.generativeai as genai  # lazy import — optional dependency

        def _blocking_call() -> str:
            genai.configure(api_key=api_key)
            model = genai.GenerativeModel(GEMINI_MODEL)
            response = model.generate_content(prompt)
            return response.text

        loop = asyncio.get_event_loop()
        text = await loop.run_in_executor(None, _blocking_call)
        return text

    except ImportError:
        logger.warning(
            "[AnomalyEngine] google-generativeai package not installed. "
            "Run: pip install google-generativeai"
        )
        return None
    except Exception as exc:
        logger.error("[AnomalyEngine] Gemini API error: %s", exc)
        return None


def _build_gemini_prompt(anomaly_type: str, metrics: dict, context: dict) -> str:
    """Builds a structured SOC analyst prompt for Gemini."""

    type_descriptions = {
        "HIGH_ERROR_RATE": (
            f"We detected a high HTTP error rate of {metrics.get('error_rate_pct', 0):.1f}% "
            f"({metrics.get('error_count', 0)} errors out of {metrics.get('total_calls', 0)} requests) "
            f"on endpoint `{context.get('endpoint', 'unknown')}` "
            f"for application `{context.get('target_app', 'unknown')}` "
            f"in the last 5 minutes."
        ),
        "API_SPIKE": (
            f"We detected an API call spike: {metrics.get('call_count', 0):,} requests in 5 minutes "
            f"(baseline is ~{API_BASELINE_CALLS_PER_5MIN:,}). "
            f"Target application: `{context.get('target_app', 'unknown')}`. "
            f"Most active endpoint: `{context.get('endpoint', 'unknown')}`."
        ),
        "HIGH_LATENCY": (
            f"Average API response time spiked to {metrics.get('avg_latency_ms', 0):.0f}ms "
            f"(threshold: {API_HIGH_LATENCY_MS:.0f}ms) "
            f"on `{context.get('target_app', 'unknown')}` "
            f"in the last 5 minutes."
        ),
        "BRUTE_FORCE": (
            f"We detected {metrics.get('auth_failures', 0)} HTTP 401 Unauthorized responses "
            f"on `{context.get('endpoint', '/login')}` "
            f"from {metrics.get('distinct_ips', 1)} distinct IP addresses in the last 5 minutes. "
            f"Top source IP: `{context.get('source_ip', 'unknown')}`."
        ),
        "NETWORK_SPIKE": (
            f"Unusually high network traffic detected: "
            f"{metrics.get('total_bytes_mb', 0):.1f} MB transferred in the last 5 minutes "
            f"(threshold: {NETWORK_SPIKE_BYTES / 1024 / 1024:.0f} MB). "
            f"Top source IP: `{context.get('source_ip', 'unknown')}`, "
            f"target port: {context.get('port', 'unknown')}."
        ),
        "MALWARE_OUTBREAK": (
            f"Multiple malware alerts triggered: {metrics.get('malware_count', 0)} infected endpoints "
            f"detected in the last 5 minutes. "
            f"Applications affected: `{context.get('target_app', 'unknown')}`."
        ),
        "PORT_SCAN": (
            f"Port scan activity detected from IP `{context.get('source_ip', 'unknown')}`: "
            f"{metrics.get('distinct_ports', 0)} distinct ports probed in 5 minutes."
        ),
    }

    incident_description = type_descriptions.get(
        anomaly_type,
        f"Anomaly type `{anomaly_type}` detected. Metrics: {metrics}."
    )

    return f"""You are a senior SOC (Security Operations Center) analyst reviewing a live security alert in an enterprise environment.

ALERT DETAILS:
{incident_description}

Your task:
1. In 1-2 sentences, explain the MOST LIKELY cause or attack vector for this anomaly (e.g., credential stuffing, DDoS, misconfigured service, data exfiltration).
2. List exactly 2 specific, actionable mitigation steps an analyst should take RIGHT NOW.
3. Rate the urgency: Critical / High / Medium / Low — and explain why in one sentence.

Format your response as plain text, structured exactly like this:
LIKELY CAUSE: [your explanation]

IMMEDIATE ACTIONS:
1. [First specific action]
2. [Second specific action]

URGENCY: [Critical/High/Medium/Low] — [one sentence reason]"""


# ── Deduplication check ───────────────────────────────────────────────────────

async def _is_duplicate(
    db: AsyncSession,
    env: str,
    anomaly_type: str,
    target_app: str,
) -> bool:
    """Returns True if an identical Active anomaly exists within the dedup window."""
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=DEDUP_WINDOW_MINUTES)
    result = await db.execute(
        select(AnomalyEvent).where(
            and_(
                AnomalyEvent.env == env,
                AnomalyEvent.anomaly_type == anomaly_type,
                AnomalyEvent.target_app == target_app,
                AnomalyEvent.status == "Active",
                AnomalyEvent.detected_at >= cutoff,
            )
        ).limit(1)
    )
    return result.scalar_one_or_none() is not None


async def _create_anomaly(
    db: AsyncSession,
    env: str,
    anomaly_type: str,
    severity: str,
    target_app: str,
    source_ip: str,
    endpoint: str,
    description: str,
    metrics: dict,
) -> None:
    """Creates an AnomalyEvent row and enriches it with a Gemini explanation."""

    # Check deduplication before doing the (expensive) Gemini call
    if await _is_duplicate(db, env, anomaly_type, target_app):
        logger.debug(
            "[AnomalyEngine] Dedup: %s / %s / %s already active. Skipping.",
            env, anomaly_type, target_app,
        )
        return

    logger.info(
        "[AnomalyEngine] Anomaly detected: type=%s severity=%s app=%s",
        anomaly_type, severity, target_app,
    )

    # Build the Gemini prompt and call the API
    context = {"target_app": target_app, "source_ip": source_ip, "endpoint": endpoint}
    prompt = _build_gemini_prompt(anomaly_type, metrics, context)
    ai_explanation = await _call_gemini(prompt)

    event = AnomalyEvent(
        env=env,
        anomaly_type=anomaly_type,
        severity=severity,
        target_app=target_app,
        source_ip=source_ip,
        endpoint=endpoint,
        description=description,
        metrics_snapshot=metrics,
        ai_explanation=ai_explanation,
        status="Active",
        detected_at=datetime.now(timezone.utc),
    )
    db.add(event)
    await db.commit()
    logger.info(
        "[AnomalyEngine] AnomalyEvent saved (id will be assigned). AI explanation: %s",
        "present" if ai_explanation else "absent",
    )


# ── Per-signal detection functions ───────────────────────────────────────────

async def _check_api_anomalies(db: AsyncSession, env: str) -> None:
    """
    Queries the last 5 minutes of ApiLog records and checks:
      - HIGH_ERROR_RATE
      - API_SPIKE
      - HIGH_LATENCY
      - BRUTE_FORCE (401s on /login endpoints)
    """
    window_start = datetime.now(timezone.utc) - timedelta(minutes=5)

    # ── Aggregate query: total calls, error count, avg latency ───────────
    agg = await db.execute(
        select(
            func.count(ApiLog.id).label("total_calls"),
            func.sum(
                case((ApiLog.status_code >= 400, 1), else_=0)
            ).label("error_count"),
            func.avg(ApiLog.response_time_ms).label("avg_latency_ms"),
            ApiLog.app.label("top_app"),
            ApiLog.endpoint.label("top_endpoint"),
        )
        .where(
            and_(
                ApiLog.env == env,
                ApiLog.logged_at >= window_start,
            )
        )
        .group_by(ApiLog.app, ApiLog.endpoint)
        .order_by(func.count(ApiLog.id).desc())
        .limit(1)
    )
    row = agg.first()
    if not row or not row.total_calls:
        return

    total_calls: int = int(row.total_calls or 0)
    error_count: int = int(row.error_count or 0)
    avg_latency: float = float(row.avg_latency_ms or 0.0)
    top_app: str = row.top_app or "Unknown"
    top_endpoint: str = row.top_endpoint or "/"

    error_rate: float = error_count / total_calls if total_calls else 0.0

    metrics_base = {
        "total_calls": total_calls,
        "error_count": error_count,
        "error_rate_pct": round(error_rate * 100, 2),
        "avg_latency_ms": round(avg_latency, 2),
        "window_minutes": 5,
    }

    # ── HIGH_ERROR_RATE ───────────────────────────────────────────────────
    if error_rate > API_ERROR_RATE_THRESHOLD:
        await _create_anomaly(
            db=db, env=env,
            anomaly_type="HIGH_ERROR_RATE",
            severity="Critical" if error_rate > 0.4 else "High",
            target_app=top_app,
            source_ip="",
            endpoint=top_endpoint,
            description=(
                f"Error rate {error_rate * 100:.1f}% ({error_count}/{total_calls} requests) "
                f"on {top_app} {top_endpoint} in the last 5 min."
            ),
            metrics={**metrics_base, "endpoint": top_endpoint},
        )

    # ── API_SPIKE ─────────────────────────────────────────────────────────
    if total_calls > API_BASELINE_CALLS_PER_5MIN * API_SPIKE_MULTIPLIER:
        await _create_anomaly(
            db=db, env=env,
            anomaly_type="API_SPIKE",
            severity="High",
            target_app=top_app,
            source_ip="",
            endpoint=top_endpoint,
            description=(
                f"API spike: {total_calls:,} calls in 5 min "
                f"(baseline ~{API_BASELINE_CALLS_PER_5MIN:,}) on {top_app}."
            ),
            metrics={**metrics_base, "call_count": total_calls, "baseline": API_BASELINE_CALLS_PER_5MIN},
        )

    # ── HIGH_LATENCY ──────────────────────────────────────────────────────
    if avg_latency > API_HIGH_LATENCY_MS:
        await _create_anomaly(
            db=db, env=env,
            anomaly_type="HIGH_LATENCY",
            severity="High",
            target_app=top_app,
            source_ip="",
            endpoint=top_endpoint,
            description=(
                f"Avg latency {avg_latency:.0f}ms on {top_app} "
                f"(threshold {API_HIGH_LATENCY_MS:.0f}ms)."
            ),
            metrics={**metrics_base},
        )

    # ── BRUTE_FORCE — 401s on login-like endpoints ────────────────────────
    bf = await db.execute(
        select(
            func.count(ApiLog.id).label("failures"),
            func.count(func.distinct(ApiLog.source_ip)).label("distinct_ips"),
            ApiLog.source_ip.label("top_ip"),
        )
        .where(
            and_(
                ApiLog.env == env,
                ApiLog.logged_at >= window_start,
                ApiLog.status_code == 401,
                ApiLog.endpoint.ilike("%login%"),
            )
        )
        .group_by(ApiLog.source_ip)
        .order_by(func.count(ApiLog.id).desc())
        .limit(1)
    )
    bf_row = bf.first()
    if bf_row and int(bf_row.failures or 0) >= BRUTE_FORCE_MIN_FAILURES:
        await _create_anomaly(
            db=db, env=env,
            anomaly_type="BRUTE_FORCE",
            severity="Critical",
            target_app=top_app,
            source_ip=bf_row.top_ip or "",
            endpoint="/login",
            description=(
                f"Brute force: {bf_row.failures} auth failures from "
                f"{bf_row.distinct_ips} IPs on /login in 5 min."
            ),
            metrics={
                "auth_failures": int(bf_row.failures or 0),
                "distinct_ips": int(bf_row.distinct_ips or 0),
                "window_minutes": 5,
            },
        )


async def _check_network_anomalies(db: AsyncSession, env: str) -> None:
    """
    Queries the last 5 minutes of NetworkLog records and checks:
      - NETWORK_SPIKE   — total bytes above threshold
      - PORT_SCAN       — single IP probing many distinct ports
    """
    window_start = datetime.now(timezone.utc) - timedelta(minutes=5)

    # ── Total bytes transferred ───────────────────────────────────────────
    net_agg = await db.execute(
        select(
            func.sum(NetworkLog.bytes_transferred).label("total_bytes"),
            func.count(NetworkLog.id).label("total_events"),
            NetworkLog.source_ip.label("top_source_ip"),
        )
        .where(
            and_(
                NetworkLog.env == env,
                NetworkLog.detected_at >= window_start,
            )
        )
        .group_by(NetworkLog.source_ip)
        .order_by(func.sum(NetworkLog.bytes_transferred).desc())
        .limit(1)
    )
    net_row = net_agg.first()
    if net_row and int(net_row.total_bytes or 0) > NETWORK_SPIKE_BYTES:
        total_bytes = int(net_row.total_bytes or 0)
        await _create_anomaly(
            db=db, env=env,
            anomaly_type="NETWORK_SPIKE",
            severity="High",
            target_app="Network",
            source_ip=net_row.top_source_ip or "",
            endpoint="",
            description=(
                f"Network spike: {total_bytes / 1024 / 1024:.1f} MB transferred "
                f"in 5 min (top source: {net_row.top_source_ip})."
            ),
            metrics={
                "total_bytes": total_bytes,
                "total_bytes_mb": round(total_bytes / 1024 / 1024, 2),
                "total_events": int(net_row.total_events or 0),
                "threshold_mb": NETWORK_SPIKE_BYTES / 1024 / 1024,
            },
        )

    # ── Port scan — single IP hitting many distinct ports ─────────────────
    scan_agg = await db.execute(
        select(
            NetworkLog.source_ip,
            func.count(func.distinct(NetworkLog.port)).label("distinct_ports"),
        )
        .where(
            and_(
                NetworkLog.env == env,
                NetworkLog.detected_at >= window_start,
            )
        )
        .group_by(NetworkLog.source_ip)
        .having(func.count(func.distinct(NetworkLog.port)) > 20)
        .order_by(func.count(func.distinct(NetworkLog.port)).desc())
        .limit(1)
    )
    scan_row = scan_agg.first()
    if scan_row:
        await _create_anomaly(
            db=db, env=env,
            anomaly_type="PORT_SCAN",
            severity="High",
            target_app="Network",
            source_ip=scan_row.source_ip or "",
            endpoint="",
            description=(
                f"Port scan: {scan_row.distinct_ports} distinct ports probed "
                f"from {scan_row.source_ip} in 5 min."
            ),
            metrics={
                "distinct_ports": int(scan_row.distinct_ports or 0),
                "source_ip": scan_row.source_ip or "",
            },
        )


async def _check_endpoint_anomalies(db: AsyncSession, env: str) -> None:
    """
    Checks for MALWARE_OUTBREAK: counts EndpointLog rows with is_malware=True
    that were inserted in the last 5 minutes.

    EndpointLog lacks a native DateTime column on legacy rows. We approximate
    recency by comparing against the maximum id from 5 minutes ago. Simulator
    rows use current timestamps in their string `timestamp` field, which we
    parse via PostgreSQL's to_timestamp() only for rows where it's ISO-format.

    Strategy: take the top-N recent rows by id (autoincrement = insertion order)
    and count malware within that window. This is conservative but avoids
    a full table scan with string→timestamp casting on every row.
    """
    # Get the id of the row inserted ~5 minutes ago as a recency fence.
    # We fetch the maximum id from rows whose string timestamp parses correctly.
    # For robustness we just use the top 200 most-recent rows as our window.
    RECENT_WINDOW = 200  # rows, not seconds — enough for a 5-min burst

    recent_max = await db.execute(
        select(func.max(EndpointLog.id)).where(EndpointLog.env == env)
    )
    max_id = recent_max.scalar() or 0
    fence_id = max(0, max_id - RECENT_WINDOW)

    malware_result = await db.execute(
        select(
            func.count(EndpointLog.id).label("malware_count"),
            EndpointLog.target_app.label("top_app"),
        )
        .where(
            and_(
                EndpointLog.env == env,
                EndpointLog.is_malware == True,  # noqa: E712
                EndpointLog.id > fence_id,
            )
        )
        .group_by(EndpointLog.target_app)
        .order_by(func.count(EndpointLog.id).desc())
        .limit(1)
    )
    malware_row = malware_result.first()
    if malware_row and int(malware_row.malware_count or 0) >= MALWARE_ALERT_THRESHOLD:
        await _create_anomaly(
            db=db, env=env,
            anomaly_type="MALWARE_OUTBREAK",
            severity="Critical",
            target_app=malware_row.top_app or "Unknown",
            source_ip="",
            endpoint="",
            description=(
                f"Malware outbreak: {malware_row.malware_count} infected endpoints "
                f"on {malware_row.top_app} in recent window."
            ),
            metrics={
                "malware_count": int(malware_row.malware_count or 0),
                "target_app": malware_row.top_app or "Unknown",
            },
        )


# ── Main worker loop ──────────────────────────────────────────────────────────

async def anomaly_worker() -> None:
    """
    Infinite background loop that runs all anomaly checks every 60 seconds.
    Spawned as an asyncio Task in main.py lifespan.
    Each check runs in its own DB session to prevent long-held transactions.
    """
    logger.info("[AnomalyEngine] Worker started. Detection interval: 60s.")

    while True:
        try:
            await asyncio.sleep(60)

            for env in ("cloud", "local"):
                async with AsyncSessionLocal() as db:
                    try:
                        await _check_api_anomalies(db, env)
                        await _check_network_anomalies(db, env)
                        await _check_endpoint_anomalies(db, env)
                    except Exception as exc:
                        await db.rollback()
                        logger.error(
                            "[AnomalyEngine] Check failed for env=%s: %s",
                            env, exc, exc_info=True,
                        )

            logger.debug("[AnomalyEngine] Cycle complete.")

        except asyncio.CancelledError:
            logger.info("[AnomalyEngine] Worker cancelled — shutting down.")
            break
        except Exception as exc:
            logger.error("[AnomalyEngine] Outer loop error: %s", exc, exc_info=True)
            # Brief pause before retrying to avoid tight error loops
            await asyncio.sleep(10)
