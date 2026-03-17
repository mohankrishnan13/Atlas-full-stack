"""
query/network_service.py — Network Traffic Domain Service

Owns: get_network_traffic()
Data source: OpenSSH Loghub CSV via log_loader.load_network_df()
"""

from __future__ import annotations

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.schemas import NetworkAnomaly, NetworkTrafficData
from app.services.connectors.log_loader import load_network_df

logger = logging.getLogger(__name__)

_EMPTY = NetworkTrafficData(
    bandwidth=0, activeConnections=0, droppedPackets=0, networkAnomalies=[]
)

# Severity sort order (lower = higher urgency) — used for top-N selection.
_SEV_RANK = {"Critical": 0, "High": 1, "Medium": 2, "Low": 3, "Info": 4}


async def get_network_traffic(env: str, db: AsyncSession) -> NetworkTrafficData:
    """
    Assembles Network Traffic page data from the OpenSSH CSV DataFrame.

    Anomaly table shows the top 15 unique source_ip × app combinations
    sorted by severity, which mirrors the original monolith behaviour.
    """
    df = await load_network_df()
    if df.empty:
        return _EMPTY

    n = df[df["env"] == env]
    if n.empty:
        return _EMPTY

    # ── KPI scalars ───────────────────────────────────────────────────────────
    bw      = int(n.iloc[0]["bandwidth_pct"])
    active  = int(n["active_connections"].mean())
    dropped = int(n["dropped_packets"].sum())

    # ── Top anomalies — deduplicated and severity-ranked ──────────────────────
    top_n = (
        n[n["severity"].isin(["Critical", "High", "Medium"])]
        .drop_duplicates(subset=["source_ip", "app"])
        .sort_values(
            "severity",
            key=lambda s: s.map(_SEV_RANK),
        )
        .head(15)
    )

    anomalies = [
        NetworkAnomaly(
            id=i + 1,
            sourceIp=row["source_ip"],
            destIp=row["dest_ip"],
            app=row["app"],
            port=int(row["port"]),
            type=row["anomaly_type"],
        )
        for i, (_, row) in enumerate(top_n.iterrows())
    ]

    return NetworkTrafficData(
        bandwidth=bw,
        activeConnections=active,
        droppedPackets=dropped,
        networkAnomalies=anomalies,
    )
