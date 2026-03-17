"""
services/query_service.py  ←  BACKWARD-COMPATIBILITY SHIM
══════════════════════════════════════════════════════════════════════════════
This file REPLACES the 600-line monolith.  It re-exports every public symbol
from the new modular architecture so that existing route handlers and callers
that import from `app.services.query_service` continue to work without any
change to their import lines.

Migration path
──────────────
Phase 1 — Drop-in replacement (now):
  Replace the old query_service.py with this file.
  Zero route changes needed.

Phase 2 — Gradual migration (recommended):
  Update each route file to import from the domain-specific module or from
  `app.services.query` (the package __init__).  Once all routes are updated,
  delete this shim.

  Example migration for routes_dashboard.py:
    # Old
    from app.services.query_service import get_overview, get_api_monitoring

    # New
    from app.services.query import get_overview, get_api_monitoring

What is NOT re-exported
───────────────────────
Private CSV helpers (_build_api_df, _build_network_df, etc.) are intentionally
not exposed — they live in connectors/log_loader.py.  If any non-route code
imported those private names, update it to:
    from app.services.connectors.log_loader import build_api_df

warm_cache and _invalidate_cache are re-exported for main.py compatibility.
"""

# ── Cache management (used by main.py lifespan) ───────────────────────────────
from app.services.cache import cache_bust as _cache_bust         # noqa: F401
from app.services.cache import invalidate_cache as _invalidate_cache  # noqa: F401
from app.services.connectors.log_loader import warm_cache         # noqa: F401

# Re-export _invalidate_cache under both names main.py uses
invalidate_cache = _invalidate_cache

# ── Domain service functions ──────────────────────────────────────────────────
from app.services.query.api_service      import get_api_monitoring    # noqa: F401
from app.services.query.db_service       import get_db_monitoring     # noqa: F401
from app.services.query.endpoint_service import get_endpoint_security # noqa: F401
from app.services.query.network_service  import get_network_traffic   # noqa: F401
from app.services.query.overview_service import (                     # noqa: F401
    get_header_data,
    get_overview,
    get_team_users,
)
from app.services.query.reports_service  import (                     # noqa: F401
    generate_report,
    get_app_config,
    get_case_management,
    get_incidents,
    get_quarantined_endpoints,
    get_reports_overview,
    lift_quarantine,
    update_app_config,
    update_incident_status,
)
