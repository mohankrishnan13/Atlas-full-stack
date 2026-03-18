"""
query/endpoint_service.py — Endpoint Security Domain Service

Data pipeline (three-step hybrid)
───────────────────────────────────
Step 1 │ LIVE AGENT TOPOLOGY
       │   wazuh_client.fetch_agents()
       │   → real-time agent count, OS breakdown, active agent name list
       │
Step 2 │ LIVE ALERT HISTORY
       │   PostgreSQL endpoint_logs  (written by wazuh_client.sync_alerts)
       │   → malware count, alert-type chart, top-10 event feed
       │
Step 3 │ KEEPALIVE PADDING
       │   Active agent names from Step 1
       │   → if fewer than 10 real alerts exist, pad the feed with
       │     "Agent heartbeat received" rows so the UI table is never empty.

Pydantic contracts preserved
─────────────────────────────
The returned `EndpointSecurityData` schema is identical to the one assembled
in the old monolithic query_service.get_endpoint_security() — the frontend sees no diff.

Pandas removed from this path
──────────────────────────────
The old code called _get_real_endpoint_df(), which converted PostgreSQL rows
into a Pandas DataFrame purely so it could use groupby() and sort_values().
That round-trip (ORM row → dict → DataFrame → iterrows → Pydantic) introduced
unnecessary memory pressure and a Pandas import dependency on a hot path.

Replacements:
  • alert_category counts  → collections.Counter
  • severity sort          → sorted() with a lookup dict key
  • malware count          → sum() generator
  • OS distribution        → collections.defaultdict (Step 1, from Wazuh API)
"""

from __future__ import annotations

import logging
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_models import EndpointLog
from app.models.schemas import (
    AlertTypeDistribution,
    EndpointSecurityData,
    OsDistribution,
    WazuhEvent,
)
from app.services.constants import CHART_FILLS
from app.services.connectors import wazuh_client

logger = logging.getLogger(__name__)

# Severity sort order — lower number = higher urgency (used in _severity_key).
_SEV_ORDER: dict[str, int] = {
    "Critical": 0,
    "High": 1,
    "Medium": 2,
    "Low": 3,
    "Info": 4,
}

# Sentinel timestamp used when a row has no recorded time.
_EPOCH_ISO = "1970-01-01T00:00:00+00:00"


# ─── Internal helpers ─────────────────────────────────────────────────────────

def _severity_key(row: dict) -> tuple[int, str]:
    """
    Sort key for endpoint log rows: primary by severity (Critical first),
    secondary by timestamp descending (newest first within same severity).

    Returning a tuple lets Python's sort use the timestamp as a tiebreaker
    without a second pass.  Timestamps are ISO strings — lexicographic order
    works correctly for ISO-8601.
    """
    sev_rank = _SEV_ORDER.get(row.get("severity", "Info"), 99)
    ts = row.get("timestamp") or _EPOCH_ISO
    # Negate the string is not possible, so we invert by prefixing with a
    # character that sorts *after* "9" in ASCII — we want newest first, so
    # we subtract from a fixed future point instead.
    # Simpler: sort ascending on (sev_rank, negated_ts) → negate via tuple trick:
    # Python will compare second element only on tie — reverse=True on the full
    # list would invert sev_rank ordering, so we use the approach below.
    return (sev_rank, ts)  # caller uses reverse=False; ts is already lexicographic desc candidate


async def _fetch_endpoint_rows(env: str, db: AsyncSession) -> list[dict]:
    """
    Queries the endpoint_logs PostgreSQL table for the most recent 200 rows
    and returns them as plain Python dicts — **no Pandas involved**.

    Why 200?
    We fetch more than the UI-visible 10 rows to give the alert-type chart
    a statistically meaningful sample (more categories surface) while keeping
    the query lightweight.

    Schema contract
    ───────────────
    The returned dicts expose the same keys the old _get_real_endpoint_df()
    produced as DataFrame columns, so _build_wazuh_events() and
    _build_alert_types() work against the same shape.
    """
    try:
        result = await db.execute(
            select(EndpointLog)
            .where(EndpointLog.env == env)
            .order_by(EndpointLog.id.desc())
            .limit(200)
        )
        rows = result.scalars().all()
        if not rows:
            return []

        now_iso = datetime.now(timezone.utc).isoformat()
        return [
            {
                "workstation_id": r.workstation_id or "Unknown",
                "employee":       r.employee       or "System",
                "avatar":         r.avatar         or "",
                "alert_message":  r.alert_message  or "Wazuh Alert",
                "alert_category": r.alert_category or "Security",
                "os_name":        r.os_name        or "Managed Agent",
                "is_offline":     bool(r.is_offline),
                "is_malware":     bool(r.is_malware),
                "severity":       r.severity       or "Medium",
                "timestamp":      r.timestamp      or now_iso,
            }
            for r in rows
        ]
    except Exception as e:
        logger.error(f"Error fetching endpoint rows: {e}", exc_info=True)
        return []


def _build_os_distribution(agents: list[dict]) -> tuple[int, int, list[OsDistribution]]:
    """
    Derive monitored count, offline count, and OS distribution from the raw
    Wazuh agent list returned by wazuh_client.fetch_agents().

    The manager agent (id == "000") is excluded — it represents Wazuh itself,
    not a monitored endpoint.

    Returns
    ───────
    monitored      : total enrolled agents (excluding manager)
    offline        : agents whose status != "active"
    os_distribution: list[OsDistribution] for the frontend pie/bar chart
    """
    monitored = 0
    offline   = 0
    os_counts: dict[str, int] = defaultdict(int)

    for agent in agents:
        if agent.get("id") == "000":
            continue  # skip the Wazuh manager node itself

        monitored += 1

        if agent.get("status") != "active":
            offline += 1

        os_name: str = agent.get("os", {}).get("name") or "Unknown OS"
        os_counts[os_name] += 1

    os_distribution = [
        OsDistribution(
            name=os_name,
            value=count,
            fill=CHART_FILLS[i % len(CHART_FILLS)],
        )
        for i, (os_name, count) in enumerate(os_counts.items())
    ]

    return monitored, offline, os_distribution


def _build_active_agents(agents: list[dict]) -> list[str]:
    """
    Returns the list of *active* agent names (hostnames), excluding the
    Wazuh manager node.  Used to populate keepalive padding rows.
    """
    return [
        agent.get("name", "Unknown-Host")
        for agent in agents
        if agent.get("id") != "000" and agent.get("status") == "active"
    ]


def _build_alert_types(rows: list[dict]) -> list[AlertTypeDistribution]:
    """
    Produces a frequency-ranked list of alert categories for the chart.

    Native Python Counter replaces the Pandas groupby().size() pattern:
        Old:  cat_counts = real_ep.groupby("alert_category").size()
              .reset_index(name="value").sort_values("value", ascending=False)
        New:  Counter(row["alert_category"] for row in rows).most_common()

    The CHART_FILLS offset of +2 preserves the original colour assignment
    so the UI doesn't see a visual change.
    """
    counts = Counter(row["alert_category"] for row in rows)
    return [
        AlertTypeDistribution(
            name=category,
            value=count,
            fill=CHART_FILLS[(i + 2) % len(CHART_FILLS)],
        )
        for i, (category, count) in enumerate(counts.most_common())
    ]


def _build_wazuh_events(rows: list[dict], limit: int = 10) -> list[WazuhEvent]:
    """
    Selects the top `limit` rows sorted by severity (Critical first) then
    by timestamp (newest first within the same severity band).

    Native Python sorted() replaces the Pandas multi-key sort:
        Old:  top_events = real_ep.sort_values(
                  by=["severity", "timestamp"],
                  ascending=[True, False],
                  key=lambda col: col.map({...}) if col.name == "severity" else col
              ).head(10)

    The two-level sort is achieved by sorting on (sev_rank, timestamp) with
    a post-sort reversal trick — see _build_wazuh_events_sorted() for details.
    """
    # Sort: primary ascending sev_rank (0 = Critical), secondary descending
    # timestamp (newest first).  Since we cannot negate a string, we sort
    # descending on timestamp by using a secondary sort with reverse=True
    # on timestamp only — achieved by sorting twice (stable sort guarantee):
    #   Pass 1: sort by timestamp descending
    #   Pass 2: sort by sev_rank ascending (stable — preserves ts order within group)
    rows_by_ts = sorted(rows, key=lambda r: r.get("timestamp") or "", reverse=True)
    rows_sorted = sorted(rows_by_ts, key=lambda r: _SEV_ORDER.get(r.get("severity", "Info"), 99))

    return [
        WazuhEvent(
            id=i + 1,
            workstationId=row["workstation_id"],
            employee=row["employee"],
            avatar=row["avatar"],
            alert=row["alert_message"],
            severity=row["severity"],
            timestamp=row.get("timestamp"),
        )
        for i, row in enumerate(rows_sorted[:limit])
    ]


def _pad_with_keepalives(
    events: list[WazuhEvent],
    active_agents: list[str],
    target: int = 10,
) -> list[WazuhEvent]:
    """
    Fills the event feed up to `target` rows with heartbeat entries when
    there are fewer real alerts than needed to populate the UI table.

    Why?
    A mostly-empty table is confusing — it looks like the monitoring stack is
    broken.  Padding with "Agent heartbeat received" rows (severity="Info")
    communicates that endpoints are actively check-in and the feed is live.

    The React UI renders Info-severity rows without action buttons, so there
    is no risk of analysts accidentally quarantining healthy machines.

    This logic is preserved verbatim from the original get_endpoint_security().
    """
    if len(events) >= target or not active_agents:
        return events

    padded = list(events)
    needed = target - len(padded)

    for i in range(needed):
        agent_name = active_agents[i % len(active_agents)]
        padded.append(
            WazuhEvent(
                id=100 + i,
                workstationId=agent_name,
                employee="system",
                avatar="",
                alert="Agent heartbeat received. Endpoint is secure.",
                severity="Info",
                timestamp=None,
            )
        )

    return padded


# ─── Public service function ──────────────────────────────────────────────────

async def get_endpoint_security(
    env: str,
    db: AsyncSession,
) -> EndpointSecurityData:
    """
    Assembles the full Endpoint Security dashboard payload.

    The three-step hybrid pipeline:

    Step 1 — Live agent topology from Wazuh Manager API
    ────────────────────────────────────────────────────
    We call wazuh_client.fetch_agents() which is now async (httpx) so it
    never blocks the event loop.  This gives us:
      • total monitored laptop count
      • offline device count
      • OS distribution breakdown
      • list of active agent hostnames (for keepalive padding in Step 3)

    Step 2 — Live alert history from PostgreSQL
    ────────────────────────────────────────────
    We query endpoint_logs directly via SQLAlchemy.  These rows were written
    by wazuh_client.sync_alerts() (the background collector task).
    This gives us:
      • malware alert count
      • alert-type frequency chart
      • top-10 security events for the event feed

    Step 3 — Keepalive padding
    ──────────────────────────
    If fewer than 10 real alerts exist, we fill the remainder of the table
    with "heartbeat" rows so the UI always shows a full 10-row feed.

    Both Step 1 and Step 2 are awaited concurrently using asyncio.gather()
    for a latency improvement over sequential awaits.

    Pydantic contract
    ─────────────────
    Returns EndpointSecurityData — identical to the original monolith output.
    """
    import asyncio

    # ── Steps 1 & 2 in parallel ───────────────────────────────────────────────
    agents, endpoint_rows = await asyncio.gather(
        wazuh_client.fetch_agents(),
        _fetch_endpoint_rows(env, db),
    )

    # ── Step 1: derive topology metrics from live agent list ──────────────────
    monitored, offline, os_distribution = _build_os_distribution(agents)
    active_agents = _build_active_agents(agents)

    # ── Step 2: derive alert metrics from PostgreSQL rows ─────────────────────
    malware_count: int = sum(1 for row in endpoint_rows if row["is_malware"])
    alert_types: list[AlertTypeDistribution] = _build_alert_types(endpoint_rows)
    wazuh_events: list[WazuhEvent] = _build_wazuh_events(endpoint_rows)

    # ── Step 3: keepalive padding ─────────────────────────────────────────────
    wazuh_events = _pad_with_keepalives(wazuh_events, active_agents)

    return EndpointSecurityData(
        monitoredLaptops=monitored,
        offlineDevices=offline,
        malwareAlerts=malware_count,
        osDistribution=os_distribution,
        # Returns [] when no real alerts exist — lets the React UI render
        # "No alert categories recorded yet" instead of a broken chart.
        alertTypes=alert_types,
        wazuhEvents=wazuh_events,
    )
