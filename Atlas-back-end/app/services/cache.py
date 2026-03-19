"""
services/cache.py — In-Process TTL Cache

A minimal, importable memory cache used exclusively by log_loader.py to
avoid re-reading and re-processing the Loghub CSVs on every request.

Design
──────
• Plain Python dict — no external dependency (no Redis, no diskcache).
• TTL enforced via time.monotonic() — immune to system clock adjustments.
• Thread-safe for typical single-threaded asyncio usage.  If you add
  Gunicorn with multiple sync workers, replace this with Redis.
• All functions are synchronous — the cache itself never does I/O.

Public API
──────────
  cache_get(key)        → stored value or None if missing/expired
  cache_set(key, val)   → stores value with current timestamp
  cache_bust()          → clears all entries immediately (used by tests and
                          the /admin/reload-cache endpoint)
  invalidate_cache()    → public alias for cache_bust (backward compat)

TTL
───
Default: 300 s (5 minutes).  Override by setting CACHE_TTL_SECONDS before
the first import, or by patching the module attribute in tests:

    import app.services.cache as cache_mod
    cache_mod.CACHE_TTL_SECONDS = 0   # forces every get() to miss
"""

from __future__ import annotations

import time
from typing import Any, Optional

# ─── Module-level state ───────────────────────────────────────────────────────
# One dict for the entire process.  Each entry: {"ts": float, "val": Any}

_STORE: dict[str, dict] = {}

CACHE_TTL_SECONDS: int = 300


# ─── Public functions ─────────────────────────────────────────────────────────

def cache_get(key: str) -> Optional[Any]:
    """
    Returns the cached value if it exists and has not expired.
    Returns None on a cache miss or expiry — callers must handle both cases.
    """
    entry = _STORE.get(key)
    if entry is None:
        return None
    if time.monotonic() - entry["ts"] >= CACHE_TTL_SECONDS:
        # Expired — evict lazily so the next write is clean.
        del _STORE[key]
        return None
    return entry["val"]


def cache_set(key: str, val: Any) -> None:
    """Stores `val` under `key` with the current monotonic timestamp."""
    _STORE[key] = {"ts": time.monotonic(), "val": val}


def cache_bust() -> None:
    """
    Immediately clears all cached entries.

    Call this from:
      • /admin/reload-cache — before warm_cache() so stale DataFrames
        are not returned during the reload window.
      • Test setUp/tearDown — to ensure test isolation.
    """
    _STORE.clear()


def invalidate_cache() -> None:
    """Backward-compatible alias for cache_bust()."""
    cache_bust()
