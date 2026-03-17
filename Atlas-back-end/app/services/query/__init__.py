"""
query/__init__.py

Re-exports every public service function so route handlers can import from
the package root rather than individual modules:

    # Before (monolith):
    from app.services.query_service import get_overview, get_api_monitoring

    # After (preferred new style):
    from app.services.query import get_overview, get_api_monitoring

    # Also works (module-level):
    from app.services.query.api_service import get_api_monitoring
"""

from app.services.query.api_service import get_api_monitoring
from app.services.query.db_service import get_db_monitoring
from app.services.query.endpoint_service import get_endpoint_security
from app.services.query.network_service import get_network_traffic
from app.services.query.overview_service import (
    get_header_data,
    get_overview,
    get_team_users,
)
from app.services.query.reports_service import (
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

__all__ = [
    # Overview & header
    "get_overview",
    "get_header_data",
    "get_team_users",
    # Telemetry domains
    "get_api_monitoring",
    "get_network_traffic",
    "get_endpoint_security",
    "get_db_monitoring",
    # Incident & case management
    "get_incidents",
    "update_incident_status",
    "get_case_management",
    # App config & quarantine
    "get_app_config",
    "update_app_config",
    "get_quarantined_endpoints",
    "lift_quarantine",
    # Reports
    "get_reports_overview",
    "generate_report",
]
