"""
services/anomaly_detection.py — ATLAS Statistical Anomaly Detection Engine

Design contract
───────────────
• Pure Python math only — NO numpy, pandas, or scikit-learn.
• All DB access via SQLAlchemy func.count() + asyncio.
• Database errors (table not yet created) are caught so the loop
  never crashes during cold-start before init_db.py has run.
• One task, one infinite loop — launched via asyncio.create_task()
  in main.py lifespan alongside the Wazuh sync task.

Detection algorithm (per cycle, per env)
──────────────────────────────────────────
  current_minute_count  = COUNT(EndpointLog rows in last 60 seconds)
  baseline_total        = COUNT(EndpointLog rows in prior 9 minutes)
  baseline_average      = baseline_total / 9   (alerts per minute)

  TRIGGER when BOTH are true:
    1. current_minute_count > SPIKE_MIN_COUNT   (absolute floor — avoids
                                                 false positives at low volume)
    2. current_minute_count >= baseline_average * SPIKE_MULTIPLIER

Severity derivation (from spike ratio)
────────────────────────────────────────
  ratio = current_minute_count / max(baseline_average, 1)
  ratio >= 5.0  → "Critical"
  ratio >= 3.0  → "High"
  otherwise     → "Medium"   (only reached if baseline_average is very low)

Timestamp strategy
──────────────────
EndpointLog.timestamp is stored as an ISO-8601 String (e.g.
"2025-03-18T10:30:00.123456+00:00"). ISO-8601 strings sort lexicographically,
so `WHERE timestamp >= :cutoff` performs a correct time-window filter using
plain string comparison — no CAST needed.

TrafficAnomaly.timestamp is a proper timezone-aware DateTime column so the
output table is queryable with BETWEEN and ORDER BY natively.
"""

import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.exc import ProgrammingError

from app.core.database import AsyncSessionLocal
from app.models.db_models import EndpointLog, TrafficAnomaly

logger = logging.getLogger(__name__)

# ─── Tuneable thresholds ──────────────────────────────────────────────────────

# Minimum absolute alert count in the current minute to consider a spike.
# Prevents false positives when baseline is 0 and a single alert arrives.
SPIKE_MIN_COUNT: int = 10

# Spike multiplier — current minute must be >= this multiple of the baseline.
SPIKE_MULTIPLIER: float = 3.0

# How many seconds between engine cycles.
POLL_INTERVAL_SECONDS: int = 60

# Environments to monitor. Add "local" if you run a local Wazuh stack.
MONITORED_ENVS: list[str] = ["cloud"]


# ─── Severity helper ─────────────────────────────────────────────────────────

def _derive_severity(ratio: float) -> str:
    """
    Classifies the spike into a severity bucket based on the magnitude ratio
    (current_count / baseline_average).

      >= 5× → Critical
      >= 3× → High
      < 3×  → Medium   (edge case: fires only when baseline_average is very
                         small but still meets SPIKE_MIN_COUNT floor)
    """
    if ratio >= 5.0:
        return "Critical"
    if ratio >= 3.0:
        return "High"
    return "Medium"


# ─── Per-env detection cycle ─────────────────────────────────────────────────

async def _run_detection_cycle(env: str) -> None:
    """
    Runs one full detection cycle for the given environment.

    Steps:
      1. Compute time window boundaries.
      2. COUNT current-minute alerts from endpoint_logs.
      3. COUNT prior-9-minute alerts (the baseline window).
      4. Evaluate spike condition.
      5. If triggered, INSERT a TrafficAnomaly row.

    All DB work happens inside a single AsyncSession that is closed
    after the cycle completes, regardless of outcome.
    """
    now: datetime     = datetime.now(timezone.utc)
    one_min_ago: str  = (now - timedelta(seconds=60)).isoformat()
    ten_min_ago: str  = (now - timedelta(minutes=10)).isoformat()

    async with AsyncSessionLocal() as db:
        try:
            # ── Step 2: current-minute count ─────────────────────────────────
            current_result = await db.execute(
                select(func.count(EndpointLog.id)).where(
                    EndpointLog.env == env,
                    EndpointLog.timestamp >= one_min_ago,
                )
            )
            current_minute_count: int = current_result.scalar_one() or 0

            # Short-circuit: skip baseline query if floor isn't met.
            if current_minute_count <= SPIKE_MIN_COUNT:
                logger.debug(
                    "[AnomalyEngine][%s] Count=%d — below floor (%d). Skipping.",
                    env, current_minute_count, SPIKE_MIN_COUNT,
                )
                return

            # ── Step 3: baseline window (minutes 1-10 ago) ───────────────────
            # Excludes the current minute so the spike doesn't inflate its own
            # baseline. Window: [10 min ago, 1 min ago) = 9 minutes.
            baseline_result = await db.execute(
                select(func.count(EndpointLog.id)).where(
                    EndpointLog.env == env,
                    EndpointLog.timestamp >= ten_min_ago,
                    EndpointLog.timestamp <  one_min_ago,
                )
            )
            baseline_total: int = baseline_result.scalar_one() or 0

            # Divide over 9 minutes (the baseline window width).
            baseline_average: float = baseline_total / 9.0

            # ── Step 4: evaluate spike condition ─────────────────────────────
            # Avoid divide-by-zero — if baseline is 0, use 1 as denominator
            # so ratio = current_count (still a meaningful spike signal).
            ratio: float = current_minute_count / max(baseline_average, 1.0)

            logger.info(
                "[AnomalyEngine][%s] count=%d  baseline_avg=%.2f  ratio=%.2f",
                env, current_minute_count, baseline_average, ratio,
            )

            if current_minute_count < baseline_average * SPIKE_MULTIPLIER:
                logger.debug(
                    "[AnomalyEngine][%s] Ratio %.2f < threshold %.1f×. No anomaly.",
                    env, ratio, SPIKE_MULTIPLIER,
                )
                return

            # ── Step 5: persist anomaly record ───────────────────────────────
            severity = _derive_severity(ratio)

            details_payload = json.dumps({
                "current_count":  current_minute_count,
                "baseline_avg":   round(baseline_average, 4),
                "spike_ratio":    round(ratio, 4),
                "baseline_window_minutes": 9,
                "env":            env,
                "detected_at":    now.isoformat(),
            })

            anomaly = TrafficAnomaly(
                env=env,
                timestamp=now,
                anomaly_type="Endpoint Alert Spike",
                severity=severity,
                details=details_payload,
                ai_explanation=None,  # Phase 3 — AI investigator will fill this
            )
            db.add(anomaly)
            await db.commit()

            logger.warning(
                "[AnomalyEngine][%s] 🚨 ANOMALY DETECTED — %s | count=%d "
                "baseline_avg=%.2f ratio=%.2f  → TrafficAnomaly #%s inserted.",
                env, severity, current_minute_count, baseline_average, ratio,
                anomaly.id,
            )

        except ProgrammingError:
            # Tables haven't been created yet (init_db.py hasn't run).
            # Swallow silently — the engine will retry next cycle.
            await db.rollback()
            logger.debug(
                "[AnomalyEngine][%s] ProgrammingError — tables not ready yet. "
                "Sleeping until next cycle.", env,
            )

        except asyncio.CancelledError:
            # Propagate cleanly so the outer loop can shut down.
            raise

        except Exception as exc:
            await db.rollback()
            logger.error(
                "[AnomalyEngine][%s] Unexpected error during detection cycle: %s",
                env, exc, exc_info=True,
            )


# ─── Main background task ─────────────────────────────────────────────────────

async def run_anomaly_engine() -> None:
    """
    Infinite background coroutine — runs one detection cycle per environment
    every POLL_INTERVAL_SECONDS seconds.

    Launch via:
        asyncio.create_task(run_anomaly_engine())

    Shutdown:
        Cancel the task — CancelledError propagates through the sleep and
        exits the loop cleanly.

    Error isolation:
        Each per-env cycle runs independently.  A crash in one environment's
        cycle is caught and logged; it does not prevent other environments
        from being checked, and it does not kill the engine loop.
    """
    logger.info(
        "[AnomalyEngine] Starting — monitoring envs=%s  interval=%ds  "
        "floor=%d  multiplier=%.1f×",
        MONITORED_ENVS, POLL_INTERVAL_SECONDS, SPIKE_MIN_COUNT, SPIKE_MULTIPLIER,
    )

    while True:
        try:
            for env in MONITORED_ENVS:
                await _run_detection_cycle(env)

        except asyncio.CancelledError:
            logger.info("[AnomalyEngine] Task cancelled — shutting down cleanly.")
            break

        except Exception as exc:
            # Safety net — should never fire because _run_detection_cycle()
            # catches all exceptions internally, but belt-and-suspenders.
            logger.error(
                "[AnomalyEngine] Outer loop error: %s — continuing.", exc, exc_info=True,
            )

        await asyncio.sleep(POLL_INTERVAL_SECONDS)
