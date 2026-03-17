"""
services/constants.py — Centralised Domain Constants

Single source of truth for every hardcoded list, mapping, and chart-colour
token previously scattered across query_service.py.

Rules for this module
─────────────────────
• No imports from app.* — zero application dependencies.
• No mutable state — every name here is a constant.  Dict values are plain
  Python dicts/lists; they are intentionally NOT frozen because they are
  never mutated at runtime.
• Names are exported without the leading underscore so they read cleanly at
  call-sites:  `from app.services.constants import CHART_FILLS`
  vs.          `from app.services.query_service import _CHART_FILLS`

Adding new constants
────────────────────
Drop them here, grouped by domain.  Add a brief comment if the value is not
self-evident (e.g. why a specific seed integer was chosen).
"""

from __future__ import annotations

from typing import Dict, List

# ─── Application registry ─────────────────────────────────────────────────────

TARGET_APPS: List[str] = [
    "Naukri Portal",
    "GenAI Service",
    "Flipkart DB",
    "Payment-GW",
    "Auth-Svc",
    "Shipping-API",
    "IP-Intel-API",
    "Product-Catalog",
]

API_PATHS: Dict[str, List[str]] = {
    "Naukri Portal":   ["/api/jobs/search", "/api/profile/update", "/api/apply", "/api/resume/upload"],
    "GenAI Service":   ["/v1/chat/completions", "/v1/embeddings", "/v1/fine-tune", "/v1/images/generate"],
    "Flipkart DB":     ["/rpc/get_all_employees", "/rpc/export_orders", "/rpc/bulk_update", "/rpc/audit_log"],
    "Payment-GW":      ["/v1/charge", "/v1/refund", "/v1/payout", "/v1/dispute"],
    "Auth-Svc":        ["/v1/login", "/v1/token/refresh", "/v1/logout", "/v1/mfa/verify"],
    "Shipping-API":    ["/v1/rates", "/v1/track", "/v1/label/create", "/v1/pickup/schedule"],
    "IP-Intel-API":    ["/v1/check", "/v1/enrich", "/v1/blacklist/query", "/v1/geo"],
    "Product-Catalog": ["/v2/products", "/v2/inventory", "/v2/pricing", "/v2/categories"],
}

# Cost-per-call USD used to compute estimated API spend
API_COST_MAP: Dict[str, float] = {
    "GenAI Service":   0.025,
    "Payment-GW":      0.025,
    "Flipkart DB":     0.005,
    "Naukri Portal":   0.005,
    "Auth-Svc":        0.001,
    "Shipping-API":    0.005,
    "IP-Intel-API":    0.0005,
    "Product-Catalog": 0.0001,
}

# ─── Severity & action distributions ─────────────────────────────────────────

SEVERITIES: List[str]     = ["Info", "Low", "Medium", "High", "Critical"]
SEV_WEIGHTS: List[float]  = [0.50,   0.35,  0.10,    0.03,  0.02]

ACTIONS: List[str]          = ["OK", "Rate-Limited", "Blocked"]
ACTION_WEIGHTS: List[float] = [0.78,  0.14,           0.08]

HTTP_METHODS: List[str]         = ["GET", "POST", "POST", "GET", "PUT", "DELETE"]
HTTP_METHOD_WEIGHTS: List[float] = [0.40,  0.35,  0.10,  0.05,  0.05,  0.05]

HOUR_LABELS: List[str] = ["12am", "3am", "6am", "9am", "12pm", "3pm", "6pm", "9pm"]

# ─── Network constants ────────────────────────────────────────────────────────

NETWORK_APPS: List[str] = [
    "GenAI Service", "Flipkart DB", "Naukri Portal",
    "Payment-GW", "Auth-Svc", "Shipping-API",
]

PORTS: List[int] = [22, 443, 80, 3306, 5432, 8080, 6379, 27017]

SUSPICIOUS_IPS: List[str] = [
    "185.220.101.45", "91.108.4.177",  "45.33.32.156",  "198.51.100.22",
    "203.0.113.78",   "159.89.49.123", "194.165.16.11",  "116.203.90.41",
    "162.55.32.100",  "51.15.88.202",  "89.248.172.16",  "66.240.192.138",
]

INTERNAL_IPS: List[str] = [
    "10.0.1.42",    "10.0.2.15",    "10.0.3.88",
    "192.168.1.101","192.168.1.202","192.168.2.10",
    "172.16.0.55",  "172.16.1.12",
]

# Maps OpenSSH Loghub EventIds to human-readable anomaly descriptions.
EVENT_TO_ANOMALY: Dict[str, str] = {
    "E27": "Possible Break-In Attempt",
    "E13": "SSH Brute Force – Invalid User",
    "E10": "Failed Password for Invalid User",
    "E9":  "Failed Password Attack",
    "E19": "Authentication Failure",
    "E20": "Authentication Failure (user exposed)",
    "E14": "Repeated Root Login Failures",
    "E2":  "Connection Closed (preauth)",
    "E24": "Received Disconnect – Bye Bye",
    "E5":  "Too Many Auth Failures for Root",
    "E7":  "No Auth Method Available",
    "E21": "PAM Check Pass – User Unknown",
}

# EventIds that are unambiguously SSH — always assign port 22.
SSH_EVENT_IDS: frozenset = frozenset(
    {"E27", "E13", "E10", "E9", "E19", "E20", "E14", "E2", "E24", "E5", "E7", "E21"}
)

# ─── Database domain constants ────────────────────────────────────────────────

QUERY_TYPES: List[str] = ["SELECT", "INSERT", "UPDATE", "DELETE"]

DB_USERS: List[str] = [
    "db_admin", "app_user", "report_svc",
    "etl_job",  "finance_ro", "audit_user",
]

DB_TABLES: List[str] = [
    "users", "orders", "payments", "audit_log", "sessions",
    "products", "inventory", "employee_records", "salary_data",
]

# Human-readable reason mapped to query type for suspicious-activity display.
DB_SUSPICIOUS_REASONS: Dict[str, str] = {
    "INSERT": "Bulk insert outside business hours from non-application user",
    "UPDATE": "Mass UPDATE with no WHERE clause detected",
    "DELETE": "Bulk DELETE on sensitive table — DLP alert triggered",
    "SELECT": "Unusual SELECT * on PII table from external IP",
}

# ─── UI chart colours ─────────────────────────────────────────────────────────
# These are CSS custom-property tokens that Tailwind / shadcn/ui resolves at
# runtime.  The index (chart-1 … chart-5) matches the colour palette defined
# in globals.css.  Cycle with `CHART_FILLS[i % len(CHART_FILLS)]`.

CHART_FILLS: List[str] = [
    "hsl(var(--chart-1))",
    "hsl(var(--chart-2))",
    "hsl(var(--chart-3))",
    "hsl(var(--chart-4))",
    "hsl(var(--chart-5))",
]

# ─── NumPy RNG seeds (deterministic mock data) ───────────────────────────────
# Fixed seeds make the mock DataFrames reproducible across restarts.
# Change only if you want a different-looking dataset — do not randomise.

RNG_SEED_SEVERITY = 42
RNG_SEED_METHODS  = 7
RNG_SEED_TRENDS   = 13
RNG_SEED_ACTIONS  = 99
RNG_SEED_JITTER   = 3
