#!/usr/bin/env python3
"""
scripts/check_env.py — ATLAS Environment Pre-flight Validator

Run this script before starting the application to verify that every
required environment variable is present, non-empty, and does not
contain a known placeholder value.

Usage
─────
  # From the project root (reads .env automatically via pydantic-settings):
  python scripts/check_env.py

  # Explicit .env file:
  ENV_FILE=/etc/atlas/production.env python scripts/check_env.py

  # In CI (exits non-zero on any failure):
  python scripts/check_env.py || exit 1

Exit codes
──────────
  0  All checks passed — safe to start the application.
  1  One or more checks failed — do NOT start until resolved.

Integration
───────────
Add to your Dockerfile CMD or entrypoint:

  CMD ["sh", "-c", "python scripts/check_env.py && uvicorn app.main:app ..."]

Or as a docker-compose healthcheck prerequisite in a dependent service.
"""

from __future__ import annotations

import sys
import os
from typing import NamedTuple

# ── Colour helpers (gracefully degrade on systems without ANSI support) ────────
_ANSI = sys.stdout.isatty()
_R  = "\033[31m" if _ANSI else ""   # red
_G  = "\033[32m" if _ANSI else ""   # green
_Y  = "\033[33m" if _ANSI else ""   # yellow
_B  = "\033[1m"  if _ANSI else ""   # bold
_X  = "\033[0m"  if _ANSI else ""   # reset


# ─────────────────────────────────────────────────────────────────────────────
# Known placeholder strings — the same set used in config.py validators.
# Any variable whose value matches one of these is treated as unset.
# ─────────────────────────────────────────────────────────────────────────────

_PLACEHOLDERS: frozenset[str] = frozenset(
    {
        "change_me_in_production",
        "change_me_in_production_use_openssl_rand_hex_32",
        "change_me_super_secret_key_for_jwt_signing",
        "change_me_generate_with_secrets_token_urlsafe_48",
        "replace_with_strong_password",
        "replace_with_strong_unique_password",
        "replace_with_generated_token_hex_32",
        "replace_with_generated_token_urlsafe_48",
        "replace_with_wazuh_manager_ip",
        "replace_with_wazuh_api_password",
        "replace_with_openssl_rand_hex_32",
        "atlasadmin1!",
        "analyst123!",
        "readonly123!",
        "your_password_here",
        "changeme",
        "change",
        "secret",
        "password",
        "todo",
        "fixme",
    }
)


# ─────────────────────────────────────────────────────────────────────────────
# Variable registry
# ─────────────────────────────────────────────────────────────────────────────

class VarSpec(NamedTuple):
    name: str
    description: str
    required: bool = True
    min_length: int = 1
    warn_if_placeholder: bool = True
    # Optional extra validation function: receives the value, returns error str or None
    validator: object = None


def _validate_url(v: str) -> str | None:
    if not (v.startswith("http://") or v.startswith("https://")):
        return "must start with http:// or https://"
    return None


def _validate_db_url(v: str) -> str | None:
    if "asyncpg" not in v and "psycopg" not in v:
        return "must be a PostgreSQL URL (asyncpg or psycopg driver)"
    return None


def _validate_hex32(v: str) -> str | None:
    """Warns if the value looks shorter than 32 hex bytes (64 chars)."""
    if len(v) < 32:
        return f"looks short ({len(v)} chars) — recommend at least 64-char hex string"
    return None


_REQUIRED_VARS: list[VarSpec] = [
    # ── Database ──────────────────────────────────────────────────────────────
    VarSpec(
        "DATABASE_URL",
        "Async SQLAlchemy PostgreSQL URL (postgresql+asyncpg://…)",
        validator=_validate_db_url,
    ),
    # ── JWT ───────────────────────────────────────────────────────────────────
    VarSpec(
        "SECRET_KEY",
        "JWT signing secret — generate: python -c \"import secrets; print(secrets.token_hex(32))\"",
        min_length=32,
        validator=_validate_hex32,
    ),
    # ── Ingest ────────────────────────────────────────────────────────────────
    VarSpec(
        "INGEST_API_KEY",
        "Static API key for Vector / Fluent Bit — generate: python -c \"import secrets; print(secrets.token_urlsafe(48))\"",
        min_length=32,
    ),
    # ── Wazuh ─────────────────────────────────────────────────────────────────
    VarSpec(
        "WAZUH_API_URL",
        "Full base URL of Wazuh Manager API (https://…:55000)",
        validator=_validate_url,
    ),
    VarSpec("WAZUH_USERNAME", "Wazuh API username (e.g. wazuh-wui)"),
    VarSpec("WAZUH_PASSWORD", "Wazuh API password"),
    # ── Velociraptor ──────────────────────────────────────────────────────────
    VarSpec(
        "VELOCIRAPTOR_WEBHOOK_SECRET",
        "HMAC-SHA256 shared secret — generate: openssl rand -hex 32",
        min_length=16,
    ),
    # ── Seed accounts ─────────────────────────────────────────────────────────
    VarSpec("SEED_ADMIN_PASSWORD",    "Bootstrap Admin account password",    min_length=8),
    VarSpec("SEED_ANALYST_PASSWORD",  "Bootstrap Analyst account password",  min_length=8),
    VarSpec("SEED_READONLY_PASSWORD", "Bootstrap Read-Only account password", min_length=8),
    # ── Postgres container (docker-compose only — not loaded by FastAPI) ───────
    VarSpec("POSTGRES_USER",     "PostgreSQL container username",     warn_if_placeholder=True),
    VarSpec("POSTGRES_PASSWORD", "PostgreSQL container password",     min_length=8),
    VarSpec("POSTGRES_DB",       "PostgreSQL container database name", warn_if_placeholder=True),
]

_OPTIONAL_VARS: list[VarSpec] = [
    VarSpec("DATABASE_URL_SYNC",            "Sync URL for Alembic migrations",  required=False),
    VarSpec("ALLOWED_CORS_ORIGINS",         "Comma-separated allowed origins",  required=False, warn_if_placeholder=False),
    VarSpec("VELOCIRAPTOR_API_URL",         "Velociraptor API base URL",         required=False, warn_if_placeholder=False),
    VarSpec("VELOCIRAPTOR_API_KEY",         "Velociraptor API key",              required=False, warn_if_placeholder=False),
    VarSpec("OLLAMA_BASE_URL",              "Ollama API base URL",               required=False, warn_if_placeholder=False),
    VarSpec("WAZUH_CA_BUNDLE",              "Path to Wazuh CA certificate PEM",  required=False, warn_if_placeholder=False),
    VarSpec("AWS_ACCESS_KEY_ID",            "AWS access key (blank = IAM role)", required=False, warn_if_placeholder=False),
    VarSpec("AWS_SECRET_ACCESS_KEY",        "AWS secret key (blank = IAM role)", required=False, warn_if_placeholder=False),
]


# ─────────────────────────────────────────────────────────────────────────────
# .env loader — lightweight, no pydantic required for this script
# ─────────────────────────────────────────────────────────────────────────────

def _load_dotenv(path: str = ".env") -> None:
    """
    Parses a .env file and injects variables into os.environ.
    Only sets variables that are not already set — os.environ takes precedence.
    Handles quoted values (single and double quotes), inline comments (#).
    """
    try:
        with open(path, encoding="utf-8") as f:
            for raw_line in f:
                line = raw_line.strip()
                # Skip blanks and comment lines
                if not line or line.startswith("#"):
                    continue
                if "=" not in line:
                    continue
                key, _, raw_val = line.partition("=")
                key = key.strip()
                # Strip inline comment
                val = raw_val.split("#")[0].strip()
                # Strip surrounding quotes
                if len(val) >= 2 and val[0] in ('"', "'") and val[0] == val[-1]:
                    val = val[1:-1]
                # Do not override existing environment variables
                if key not in os.environ:
                    os.environ[key] = val
    except FileNotFoundError:
        print(f"{_Y}[WARN] .env file not found at '{path}' — using process environment only.{_X}")


# ─────────────────────────────────────────────────────────────────────────────
# Check runner
# ─────────────────────────────────────────────────────────────────────────────

class CheckResult(NamedTuple):
    name: str
    status: str       # "OK" | "FAIL" | "WARN" | "SKIP"
    message: str


def _check_var(spec: VarSpec) -> CheckResult:
    val = os.environ.get(spec.name, "")

    if not val:
        if spec.required:
            return CheckResult(spec.name, "FAIL", "not set or empty")
        return CheckResult(spec.name, "SKIP", "not set (optional)")

    if spec.warn_if_placeholder and val.lower() in _PLACEHOLDERS:
        if spec.required:
            return CheckResult(
                spec.name,
                "FAIL",
                f"contains a known placeholder value — replace before starting",
            )
        return CheckResult(
            spec.name,
            "WARN",
            f"still using a placeholder value",
        )

    if len(val) < spec.min_length:
        return CheckResult(
            spec.name,
            "FAIL" if spec.required else "WARN",
            f"too short ({len(val)} chars, minimum {spec.min_length})",
        )

    if spec.validator:
        err = spec.validator(val)
        if err:
            return CheckResult(spec.name, "WARN", err)

    return CheckResult(spec.name, "OK", spec.description)


def run_checks() -> int:
    """
    Runs all checks, prints a formatted report, and returns an exit code.
    Returns 0 on success (all required vars OK), 1 on any FAIL.
    """
    # Load .env unless the user wants to use the raw process environment
    env_file = os.environ.get("ENV_FILE", ".env")
    _load_dotenv(env_file)

    results: list[CheckResult] = []
    for spec in _REQUIRED_VARS + _OPTIONAL_VARS:
        results.append(_check_var(spec))

    # ── Print header ──────────────────────────────────────────────────────────
    print()
    print(f"{_B}╔══════════════════════════════════════════════════════════╗{_X}")
    print(f"{_B}║      ATLAS Backend — Environment Pre-flight Check        ║{_X}")
    print(f"{_B}╚══════════════════════════════════════════════════════════╝{_X}")
    print()

    # ── Print results ─────────────────────────────────────────────────────────
    max_name = max(len(r.name) for r in results)
    fail_count = 0
    warn_count = 0

    for r in results:
        if r.status == "OK":
            badge = f"{_G}[ OK   ]{_X}"
        elif r.status == "FAIL":
            badge = f"{_R}[FAIL  ]{_X}"
            fail_count += 1
        elif r.status == "WARN":
            badge = f"{_Y}[ WARN ]{_X}"
            warn_count += 1
        else:  # SKIP
            badge = f"[  --  ]"

        name_padded = r.name.ljust(max_name)
        print(f"  {badge}  {name_padded}  {r.message}")

    # ── Print summary ─────────────────────────────────────────────────────────
    print()
    total = len(results)
    ok_count = sum(1 for r in results if r.status == "OK")
    skip_count = sum(1 for r in results if r.status == "SKIP")

    print(
        f"  Results: "
        f"{_G}{ok_count} OK{_X}  "
        f"{_Y}{warn_count} WARN{_X}  "
        f"{_R}{fail_count} FAIL{_X}  "
        f"{skip_count} skipped  "
        f"(of {total} checks)"
    )

    if fail_count > 0:
        print()
        print(
            f"  {_R}{_B}✗ Pre-flight FAILED — {fail_count} required variable(s) are missing or "
            f"still contain placeholder values.{_X}"
        )
        print(
            f"  {_R}  Edit your .env file and re-run this script before starting ATLAS.{_X}"
        )
        print()
        return 1

    if warn_count > 0:
        print()
        print(
            f"  {_Y}⚠  {warn_count} warning(s) — review before deploying to production.{_X}"
        )

    print()
    print(f"  {_G}{_B}✓ Pre-flight passed — safe to start ATLAS.{_X}")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(run_checks())
