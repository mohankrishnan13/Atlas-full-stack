"""
services/query/__init__.py

Re-exports every active public service function so route handlers can import
from the package root:

    from app.services.query import overview_service, endpoint_service, network_service
    from app.services.query import get_incidents, update_incident_status

REMOVED in Anomaly Command Center pivot:
    api_service         — API Monitoring domain retired
    db_service          — DB Monitoring domain retired
    reports_service     — renamed to incidents_service; reports functions deleted
    get_app_config      — AppConfig model deleted
    update_app_config   — AppConfig model deleted
    get_quarantined_endpoints — QuarantinedEndpoint model deleted
    lift_quarantine     — QuarantinedEndpoint model deleted
    get_reports_overview — ScheduledReport / ReportDownload models deleted
    generate_report     — ReportDownload model deleted
"""

from app.services.query import (
    endpoint_service,
    network_service,
    overview_service,
)
from app.services.query.incidents_service import (
    get_case_management,
    get_incidents,
    update_incident_status,
)

__all__ = [
    # Module-level imports (used by route handlers as `overview_service.get_overview()`)
    "overview_service",
    "endpoint_service",
    "network_service",
    # Function-level imports (used directly in routes_actions)
    "get_incidents",
    "update_incident_status",
    "get_case_management",
]
