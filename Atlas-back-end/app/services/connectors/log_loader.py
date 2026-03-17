"""
connectors/log_loader.py — Loghub CSV Mock-Data Generator

Responsibility
──────────────
This module is the **only** place in the codebase that imports Pandas or
NumPy.  It reads Loghub structured CSV files from disk, enriches them with
deterministic mock fields, caches the resulting DataFrames in-memory, and
exposes both synchronous accessors (for startup warm-up) and async wrappers
(for hot-path request handlers) so that CSV I/O never blocks the event loop.

When to use sync vs async accessors
─────────────────────────────────────
• `warm_cache()` / `build_*_df()` — called once from main.py lifespan at
  startup, in a synchronous context before the event loop accepts requests.
• `load_api_df()` / `load_network_df()` / `load_db_df()` — called from
  async domain services.  They delegate to `asyncio.to_thread(build_*_df)`
  which moves the blocking pd.read_csv to a thread-pool worker, keeping the
  event loop free.  After warm_cache() has run, the in-memory cache hit is
  so fast (~μs) that the thread switch overhead dominates — this is an
  acceptable trade-off for architectural correctness and safety on cold cache.

Isolation contract
──────────────────
No other module (query/, routes) imports Pandas or NumPy directly.
Any function that needs a DataFrame must import from this module.
"""

from __future__ import annotations

import asyncio
import logging
import re
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd

from app.services.cache import cache_get, cache_set
from app.services.constants import (
    ACTION_WEIGHTS,
    ACTIONS,
    API_COST_MAP,
    API_PATHS,
    DB_SUSPICIOUS_REASONS,
    DB_TABLES,
    DB_USERS,
    EVENT_TO_ANOMALY,
    HOUR_LABELS,
    HTTP_METHOD_WEIGHTS,
    HTTP_METHODS,
    INTERNAL_IPS,
    NETWORK_APPS,
    PORTS,
    QUERY_TYPES,
    RNG_SEED_ACTIONS,
    RNG_SEED_JITTER,
    RNG_SEED_METHODS,
    RNG_SEED_SEVERITY,
    RNG_SEED_TRENDS,
    SEV_WEIGHTS,
    SEVERITIES,
    SSH_EVENT_IDS,
    SUSPICIOUS_IPS,
    TARGET_APPS,
)

logger = logging.getLogger(__name__)

# ─── Log root path ────────────────────────────────────────────────────────────
# Resolves to  <project_root>/data/logs/
_LOG_ROOT: Path = Path(__file__).resolve().parent.parent.parent.parent / "data" / "logs"


def _csv(relative: str) -> Path:
    return _LOG_ROOT / relative


# ─── DataFrame enrichment helpers ────────────────────────────────────────────

def _assign_env(df: pd.DataFrame) -> pd.DataFrame:
    """Assigns 'cloud' to even LineIds, 'local' to odd ones."""
    df["env"] = np.where(df["LineId"] % 2 == 0, "cloud", "local")
    return df


def _assign_severity_weighted(df: pd.DataFrame) -> pd.DataFrame:
    """
    Assigns a severity label using the project's standard distribution
    (50% Info, 35% Low, 10% Medium, 3% High, 2% Critical).

    Fixed seed 42 — produces identical results across restarts so the
    dashboard charts are visually stable in development.
    """
    rng = np.random.default_rng(RNG_SEED_SEVERITY)
    df["severity"] = rng.choice(SEVERITIES, size=len(df), p=SEV_WEIGHTS)
    return df


def _assign_target_app(df: pd.DataFrame) -> pd.DataFrame:
    """Assigns a target app deterministically from LineId modulo."""
    df["target_app"] = [TARGET_APPS[lid % len(TARGET_APPS)] for lid in df["LineId"]]
    return df


# ─── IP extraction (network CSV) ─────────────────────────────────────────────

_IP_RE = re.compile(r"\b(\d{1,3}(?:\.\d{1,3}){3})\b")


def _extract_ip(content: str, occurrence: int = 0) -> str:
    hits = _IP_RE.findall(content or "")
    if hits and len(hits) > occurrence:
        return hits[occurrence]
    return ""


# ─── Synchronous DataFrame builders ──────────────────────────────────────────
# These functions are BLOCKING — they call pd.read_csv on a cold cache.
# Call them only from warm_cache() at startup, or via the async load_*()
# wrappers below in request handlers.

def build_api_df() -> pd.DataFrame:
    """
    Builds the API monitoring DataFrame from the Apache Loghub CSV.

    Cache key: "api_df"
    CSV path:  data/logs/Apache/Apache_2k.log_structured.csv

    Columns produced (subset used by api_service / overview_service):
      env, severity, target_app, app, path, method, cost_per_call,
      trend_pct, action, calls_today, blocked_count, avg_latency_ms,
      estimated_cost, hour_label, actual_calls, predicted_calls, source_ip
    """
    cached = cache_get("api_df")
    if cached is not None:
        return cached

    csv_path = _csv("Apache/Apache_2k.log_structured.csv")
    if not csv_path.exists():
        logger.warning(f"[log_loader] API CSV not found: {csv_path}")
        return pd.DataFrame()

    df = pd.read_csv(csv_path, dtype=str).fillna("")
    df["LineId"] = pd.to_numeric(df["LineId"], errors="coerce").fillna(0).astype(int)
    df = _assign_env(df)
    df = _assign_severity_weighted(df)
    df = _assign_target_app(df)

    df["app"] = df["target_app"]
    df["path"] = df.apply(
        lambda r: API_PATHS[r["target_app"]][r["LineId"] % len(API_PATHS[r["target_app"]])],
        axis=1,
    )

    rng_methods = np.random.default_rng(seed=RNG_SEED_METHODS)
    df["method"] = rng_methods.choice(HTTP_METHODS, size=len(df), p=HTTP_METHOD_WEIGHTS)

    df["cost_per_call"] = df["target_app"].map(API_COST_MAP).fillna(0.001)

    rng_trends = np.random.default_rng(seed=RNG_SEED_TRENDS)
    trend_raw = rng_trends.integers(-20, 30, size=len(df))
    extreme_mask = (df["LineId"] % 50 == 0)
    trend_raw[extreme_mask.values] = rng_trends.integers(100, 900, size=int(extreme_mask.sum()))
    df["trend_pct"] = trend_raw

    rng_actions = np.random.default_rng(seed=RNG_SEED_ACTIONS)
    df["action"] = rng_actions.choice(ACTIONS, size=len(df), p=ACTION_WEIGHTS)
    df.loc[df["severity"] == "Critical", "action"] = "Blocked"
    df.loc[df["severity"] == "High",     "action"] = "Rate-Limited"

    is_cloud = df["env"] == "cloud"
    df["calls_today"]   = np.where(is_cloud, 1_258_345, 45_678).astype(int)
    df["blocked_count"] = np.where(is_cloud,    12_456,  1_234).astype(int)
    df["avg_latency_ms"] = (df["cost_per_call"] * 5_000).round(1)
    df.loc[df["avg_latency_ms"] < 12, "avg_latency_ms"] = 12.0
    df["estimated_cost"] = (df["calls_today"] * df["cost_per_call"]).round(2)
    df["hour_label"] = df["LineId"].apply(lambda x: HOUR_LABELS[x % len(HOUR_LABELS)])

    base = df["calls_today"] // 8
    jitter = np.random.default_rng(seed=RNG_SEED_JITTER).integers(-500, 500, size=len(df))
    df["actual_calls"]    = (base + jitter).clip(lower=0).astype(int)
    df["predicted_calls"] = (base * 0.9).astype(int)

    all_ips = SUSPICIOUS_IPS + INTERNAL_IPS
    df["source_ip"] = df["LineId"].apply(lambda x: all_ips[x % len(all_ips)])

    cache_set("api_df", df)
    return df


def build_network_df() -> pd.DataFrame:
    """
    Builds the Network Traffic DataFrame from the OpenSSH Loghub CSV.

    Cache key: "network_df"
    CSV path:  data/logs/OpenSSH/OpenSSH_2k.log_structured.csv
    """
    cached = cache_get("network_df")
    if cached is not None:
        return cached

    csv_path = _csv("OpenSSH/OpenSSH_2k.log_structured.csv")
    if not csv_path.exists():
        logger.warning(f"[log_loader] Network CSV not found: {csv_path}")
        return pd.DataFrame()

    df = pd.read_csv(csv_path, dtype=str).fillna("")
    df["LineId"] = pd.to_numeric(df["LineId"], errors="coerce").fillna(0).astype(int)
    df = _assign_env(df)
    df = _assign_severity_weighted(df)
    df = _assign_target_app(df)

    df["anomaly_type"] = (
        df["EventId"].map(EVENT_TO_ANOMALY).fillna("Suspicious Outbound Connection")
    )
    df.loc[df["severity"] == "Critical", "anomaly_type"] = "SSH Brute Force Attack"
    df.loc[df["severity"] == "High",     "anomaly_type"] = "Possible Break-In Attempt"

    df["source_ip"] = df["Content"].apply(lambda c: _extract_ip(c, 0))
    fallback = df["source_ip"] == ""
    df.loc[fallback, "source_ip"] = df.loc[fallback, "LineId"].apply(
        lambda x: SUSPICIOUS_IPS[x % len(SUSPICIOUS_IPS)]
    )
    df["dest_ip"] = df["LineId"].apply(lambda x: INTERNAL_IPS[x % len(INTERNAL_IPS)])
    df["app"]     = df["LineId"].apply(lambda x: NETWORK_APPS[x % len(NETWORK_APPS)])
    df["port"]    = df["LineId"].apply(lambda x: PORTS[x % len(PORTS)])
    df.loc[df["EventId"].isin(SSH_EVENT_IDS), "port"] = 22

    df["bandwidth_pct"]      = (df["LineId"] % 80 + 20).astype(int)
    df["active_connections"] = (df["LineId"] % 950 + 50).astype(int)
    df["dropped_packets"]    = (df["LineId"] % 500).astype(int)

    cache_set("network_df", df)
    return df


def build_db_df() -> pd.DataFrame:
    """
    Builds the Database Monitoring DataFrame by deriving columns from the
    API DataFrame — shares the same rows, adds DB-specific fields.

    Cache key: "db_df"
    Depends on: build_api_df()
    """
    cached = cache_get("db_df")
    if cached is not None:
        return cached

    api_df = build_api_df()
    if api_df.empty:
        return pd.DataFrame()

    df = api_df[[
        "LineId", "env", "severity", "target_app",
        "source_ip", "hour_label", "calls_today",
        "avg_latency_ms", "EventId",
    ]].copy()

    df["app"]          = df["target_app"]
    df["db_user"]      = df["LineId"].apply(lambda x: DB_USERS[x % len(DB_USERS)])
    df["query_type"]   = df["LineId"].apply(lambda x: QUERY_TYPES[x % len(QUERY_TYPES)])
    df["target_table"] = df["LineId"].apply(lambda x: DB_TABLES[x % len(DB_TABLES)])

    df["is_suspicious"] = (
        df["severity"].isin(["High", "Critical"])
        & df["query_type"].isin(["INSERT", "UPDATE", "DELETE"])
    )
    df["reason"] = df["query_type"].map(DB_SUSPICIOUS_REASONS)

    df["active_connections"]    = (df["calls_today"] // 1000).clip(upper=500).astype(int)
    df["data_export_volume_tb"] = (df["LineId"] % 10 * 0.1).round(2)
    df["select_count"] = (df["calls_today"] * 0.70).astype(int)
    df["insert_count"] = (df["calls_today"] * 0.15).astype(int)
    df["update_count"] = (df["calls_today"] * 0.10).astype(int)
    df["delete_count"] = (df["calls_today"] * 0.05).astype(int)

    cache_set("db_df", df)
    return df


def warm_cache() -> None:
    """
    Pre-loads all three DataFrames into memory at startup.

    Called synchronously from app/main.py lifespan before the event loop
    starts serving requests.  After this returns, every subsequent
    `cache_get("api_df")` call is a nanosecond dict lookup — no I/O.
    """
    logger.info("[log_loader] Warming Pandas CSV cache ...")
    build_api_df()
    build_network_df()
    build_db_df()
    logger.info("[log_loader] Pandas CSV cache warm — all three DataFrames ready.")


# ─── Async wrappers (for request handlers) ───────────────────────────────────
# These are the functions that domain services (api_service, etc.) call.
# On a warm cache the overhead is ~1 μs dict lookup + thread dispatch, which
# is negligible.  On a cold cache (after cache_bust or first startup before
# warm_cache finishes) they offload the blocking pd.read_csv to a thread-pool
# worker so the event loop is never stalled.

async def load_api_df() -> pd.DataFrame:
    """Async accessor — use in request handlers instead of build_api_df()."""
    return await asyncio.to_thread(build_api_df)


async def load_network_df() -> pd.DataFrame:
    """Async accessor — use in request handlers instead of build_network_df()."""
    return await asyncio.to_thread(build_network_df)


async def load_db_df() -> pd.DataFrame:
    """Async accessor — use in request handlers instead of build_db_df()."""
    return await asyncio.to_thread(build_db_df)
