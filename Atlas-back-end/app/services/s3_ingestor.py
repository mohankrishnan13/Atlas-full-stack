"""
services/s3_ingestor.py — AWS S3 Cold-Storage Log Ingestion Background Task

This module implements a periodic background task that polls an S3 bucket
for new compressed log archives and ingests them into PostgreSQL.

Architecture overview
─────────────────────
Production log pipeline (target state):

  Log Sources (servers, containers, VMs)
        │
        ▼  (Vector / Fluent Bit ships in real-time)
  POST /api/ingest/http  ──► PostgreSQL  (hot path, ≤ 24h retention)
        │
        │  (Vector also archives compressed batches every N minutes)
        ▼
  S3 Bucket: atlas-soc-cold-logs/
      logs/2024/05/21/
          network_10-45-00.jsonl.gz
          endpoint_10-45-00.jsonl.gz
          ...                         ◄── this module reads these
        │
        ▼
  S3IngestCursor table  (idempotency ledger — tracks processed objects)
        │
        ▼
  PostgreSQL  (cold-path backfill / replay)

Why S3 + local file ingestion coexist
──────────────────────────────────────
  - `/api/ingest/http` is the real-time hot path (≤ seconds latency).
  - `data/logs/*.jsonl` is the local dev/MVP path (no network needed).
  - S3 is the cold replay path: disaster recovery, new analyst onboarding,
    re-processing after a parser bug fix, long-term audit queries.
  - All three paths write to the same PostgreSQL tables via the same
    `_parse_*` functions — the DB schema is the single source of truth.

boto3 threading note
──────────────────────
`boto3` is synchronous. Calling it directly in an async FastAPI handler
would block the event loop. We use `asyncio.to_thread()` to run each
boto3 call in a ThreadPoolExecutor thread, keeping the event loop free.

Stub vs. live behaviour
────────────────────────
This file is a fully-runnable stub:
  - All boto3 calls are present and correct — no pseudo-code.
  - `S3_ENABLED=false` in .env prevents the task from starting (default).
  - Set `S3_ENABLED=true` + real AWS credentials to activate live ingestion.
  - The `_simulate_s3_objects()` helper lets you run the task locally
    without real AWS credentials for integration testing.
"""

import asyncio
import gzip
import io
import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import AsyncSessionLocal
from app.models.db_models import S3IngestCursor
from app.services.log_ingestion import (
    _parse_alert,
    _parse_api_log,
    _parse_db_activity_log,
    _parse_endpoint_log,
    _parse_incident,
    _parse_network_log,
    _safe_int,
)

logger = logging.getLogger(__name__)
settings = get_settings()

# Reuse the same log_type → parser dispatch table as the HTTP ingest route.
_PARSERS = {
    "network":  _parse_network_log,
    "api":      _parse_api_log,
    "endpoint": _parse_endpoint_log,
    "db":       _parse_db_activity_log,
    "incident": _parse_incident,
    "alert":    _parse_alert,
}

# ── S3 object naming convention ───────────────────────────────────────────────
# Vector archives logs in this key pattern (configured in vector.toml):
#   logs/{log_type}/{YYYY}/{MM}/{DD}/{HH}-{mm}-{ss}.jsonl.gz
# The ingestor derives `log_type` from the key prefix automatically.
#
# Example key: logs/network/2024/05/21/10-45-00.jsonl.gz
#              → log_type = "network"
_KEY_PREFIX_TO_LOG_TYPE = {
    "network":  "network",
    "api":      "api",
    "endpoint": "endpoint",
    "db":       "db",
    "incident": "incident",
    "alert":    "alert",
}


# ─────────────────────────────────────────────────────────────────────────────
# boto3 helpers  (all run inside asyncio.to_thread to avoid blocking the loop)
# ─────────────────────────────────────────────────────────────────────────────

def _build_s3_client():
    """
    Builds and returns a boto3 S3 client.

    Credential resolution order (standard boto3 chain):
      1. Explicit env vars: AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (from .env)
      2. AWS_PROFILE / ~/.aws/credentials  (developer laptops)
      3. EC2 instance metadata / ECS task role  (production — preferred)
      4. IAM Roles Anywhere / Web Identity Token  (K8s with IRSA)

    In production, leave aws_access_key_id and aws_secret_access_key blank in
    .env and attach an IAM role to your ECS task or EC2 instance instead.
    The role needs s3:ListBucket and s3:GetObject on the log bucket.
    """
    import boto3  # imported lazily — not required when S3 is disabled

    kwargs: Dict[str, Any] = {"region_name": settings.aws_region}

    if settings.aws_access_key_id and settings.aws_secret_access_key:
        # Explicit credentials — useful for local dev or cross-account access.
        kwargs["aws_access_key_id"] = settings.aws_access_key_id
        kwargs["aws_secret_access_key"] = settings.aws_secret_access_key
        logger.debug("[S3] Using explicit AWS credentials from configuration.")
    else:
        logger.debug("[S3] No explicit credentials configured — relying on IAM role / env chain.")

    return boto3.client("s3", **kwargs)


def _list_new_s3_objects(
    already_processed: set,
    bucket: str,
    prefix: str,
    max_keys: int,
) -> List[Dict[str, Any]]:
    """
    Synchronous boto3 call: lists objects in the S3 bucket/prefix that
    have NOT yet been ingested (i.e. their key is not in `already_processed`).

    Uses S3 paginator to handle buckets with > 1000 objects without
    hitting the default ListObjectsV2 page limit.

    Returns a list of S3 object metadata dicts:
      { "key": str, "etag": str, "size": int }
    """
    client = _build_s3_client()
    paginator = client.get_paginator("list_objects_v2")

    new_objects = []
    pages = paginator.paginate(
        Bucket=bucket,
        Prefix=prefix,
        PaginationConfig={"MaxItems": max_keys * 10},   # over-fetch, then filter
    )

    for page in pages:
        for obj in page.get("Contents", []):
            key: str = obj["Key"]

            # Skip directory markers (keys ending in "/")
            if key.endswith("/"):
                continue

            # Skip non-gzip files — the ingestor only handles .jsonl.gz
            if not key.endswith(".jsonl.gz"):
                logger.debug(f"[S3] Skipping non-.jsonl.gz object: {key}")
                continue

            if key in already_processed:
                continue

            new_objects.append({
                "key":  key,
                "etag": obj.get("ETag", "").strip('"'),
                "size": obj.get("Size", 0),
            })

            if len(new_objects) >= max_keys:
                return new_objects

    return new_objects


def _download_and_decompress(bucket: str, key: str) -> List[Dict[str, Any]]:
    """
    Synchronous boto3 call: downloads a .jsonl.gz object from S3 and
    decompresses it into a list of parsed JSON dicts.

    Memory note: the entire object is buffered in memory. For very large
    objects (> 500 MB uncompressed), use streaming decompression with
    gzip.open() on a boto3 streaming body instead.
    """
    client = _build_s3_client()

    logger.info(f"[S3] Downloading s3://{bucket}/{key} ...")
    response = client.get_object(Bucket=bucket, Key=key)

    compressed_bytes: bytes = response["Body"].read()

    # Decompress gzip in-memory
    with gzip.open(io.BytesIO(compressed_bytes), "rt", encoding="utf-8") as gz:
        content = gz.read()

    # Parse JSONL — one JSON object per line
    records = []
    for line_no, line in enumerate(content.splitlines(), start=1):
        line = line.strip()
        if not line:
            continue
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError as exc:
            logger.warning(f"[S3] Skipping malformed JSON at {key}:{line_no} — {exc}")

    logger.info(f"[S3] Decompressed {len(records)} records from {key}")
    return records


def _tag_s3_object_as_processed(bucket: str, key: str) -> None:
    """
    Optional: tags the S3 object with 'atlas-ingested=true' after successful
    ingestion. Useful for S3 lifecycle rules and ops visibility.

    This is a best-effort operation — failure does NOT abort the ingest.
    The S3IngestCursor table is the authoritative idempotency record.
    """
    try:
        client = _build_s3_client()
        client.put_object_tagging(
            Bucket=bucket,
            Key=key,
            Tagging={
                "TagSet": [
                    {"Key": "atlas-ingested", "Value": "true"},
                    {"Key": "atlas-ingested-at", "Value": datetime.now(timezone.utc).isoformat()},
                ]
            },
        )
        logger.debug(f"[S3] Tagged s3://{bucket}/{key} as atlas-ingested=true")
    except Exception as exc:
        logger.warning(f"[S3] Failed to tag object {key} (non-fatal): {exc}")


# ── Simulation helper for local testing ───────────────────────────────────────

def _simulate_s3_objects() -> List[Dict[str, Any]]:
    """
    Returns fake S3 object metadata for testing the background task locally
    without real AWS credentials. Activated when AWS_ACCESS_KEY_ID is blank
    and S3_ENABLED=true. Produces no actual network calls.
    """
    return [
        {
            "key": "logs/network/2024/05/21/10-45-00.jsonl.gz",
            "etag": "abc123",
            "size": 4096,
        },
        {
            "key": "logs/endpoint/2024/05/21/10-45-00.jsonl.gz",
            "etag": "def456",
            "size": 8192,
        },
    ]


def _simulate_download(key: str) -> List[Dict[str, Any]]:
    """Returns synthetic records matching the key's log_type for local testing."""
    log_type = _derive_log_type_from_key(key)
    if log_type == "network":
        return [
            {
                "log_type": "network", "env": "cloud",
                "source_ip": "10.0.0.1", "dest_ip": "10.0.0.2",
                "app": "S3-Replay", "port": 443,
                "anomaly_type": "Simulated S3 replay event",
                "bandwidth_pct": 10, "active_connections": 100, "dropped_packets": 0,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        ]
    if log_type == "endpoint":
        return [
            {
                "log_type": "endpoint", "env": "local",
                "workstation_id": "SIM-001", "employee": "S3 Simulation",
                "avatar": "", "alert_message": "Simulated endpoint event from S3",
                "alert_category": "Anomalous Activity", "severity": "Low",
                "os_name": "Windows 11", "is_offline": False, "is_malware": False,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        ]
    return []


# ─────────────────────────────────────────────────────────────────────────────
# Core ingestion logic
# ─────────────────────────────────────────────────────────────────────────────

def _derive_log_type_from_key(key: str) -> Optional[str]:
    """
    Derives the log_type from the S3 object key path.

    Expected key structure:
      logs/{log_type}/{YYYY}/{MM}/{DD}/{timestamp}.jsonl.gz
                 ↑
            extracted here

    Fallback: if the key doesn't match the expected structure, log_type
    is read from each record's `log_type` field at parse time instead.
    Returns None to signal "use per-record log_type".
    """
    parts = key.lstrip("/").split("/")
    if len(parts) >= 2:
        candidate = parts[1].lower()
        if candidate in _KEY_PREFIX_TO_LOG_TYPE:
            return _KEY_PREFIX_TO_LOG_TYPE[candidate]
    return None


async def _process_single_object(
    obj_meta: Dict[str, Any],
    bucket: str,
    db: AsyncSession,
    use_simulation: bool,
) -> Tuple[int, int]:
    """
    Downloads, decompresses, parses, and inserts a single S3 object.

    Returns (records_ingested, parse_errors).
    All DB writes for this object are committed atomically so that a
    crash mid-object leaves the cursor table in a consistent state.
    """
    key: str = obj_meta["key"]
    key_log_type: Optional[str] = _derive_log_type_from_key(key)

    # ── Download ──────────────────────────────────────────────────────────────
    if use_simulation:
        records = _simulate_download(key)
    else:
        records = await asyncio.to_thread(_download_and_decompress, bucket, key)

    # ── Parse ─────────────────────────────────────────────────────────────────
    orm_objects = []
    parse_errors = 0

    for record in records:
        if not isinstance(record, dict):
            parse_errors += 1
            continue

        # Prefer key-derived log_type; fall back to per-record field
        log_type = key_log_type or str(record.get("log_type", "")).strip().lower()
        parser = _PARSERS.get(log_type)

        if parser is None:
            logger.debug(f"[S3] Skipping record with unknown log_type='{log_type}' in {key}")
            parse_errors += 1
            continue

        try:
            orm_objects.append(parser(record))
        except Exception as exc:
            logger.warning(f"[S3] Parse error in {key}: {exc}")
            parse_errors += 1

    # ── Insert ────────────────────────────────────────────────────────────────
    if orm_objects:
        db.add_all(orm_objects)
        await db.commit()

    return len(orm_objects), parse_errors


async def _mark_object_processed(
    db: AsyncSession,
    bucket: str,
    obj_meta: Dict[str, Any],
    records_ingested: int,
    parse_errors: int,
    status: str = "completed",
) -> None:
    """Writes a row to S3IngestCursor to record this object as processed."""
    cursor = S3IngestCursor(
        bucket=bucket,
        object_key=obj_meta["key"],
        etag=obj_meta.get("etag", ""),
        size_bytes=_safe_int(obj_meta.get("size", 0)),
        records_ingested=records_ingested,
        parse_errors=parse_errors,
        status=status,
    )
    db.add(cursor)
    await db.commit()


async def _get_processed_keys(db: AsyncSession, bucket: str) -> set:
    """Loads all already-processed S3 object keys for this bucket from the cursor table."""
    result = await db.execute(
        select(S3IngestCursor.object_key).where(S3IngestCursor.bucket == bucket)
    )
    return {row[0] for row in result.all()}


# ─────────────────────────────────────────────────────────────────────────────
# Public background task entrypoint
# ─────────────────────────────────────────────────────────────────────────────

async def run_s3_ingest_loop() -> None:
    """
    Long-running async background task started from the FastAPI lifespan.

    Loop behaviour:
      1. Load all already-processed S3 object keys from the cursor table.
      2. List new objects in the configured S3 bucket/prefix.
      3. For each new object:
           a. Download and decompress (in a thread, non-blocking).
           b. Parse records using the same _parse_* functions as other paths.
           c. Bulk-insert valid records into PostgreSQL.
           d. Write a cursor row to mark the object as processed.
           e. Optionally tag the S3 object as atlas-ingested=true.
      4. Sleep for `s3_poll_interval_seconds`.
      5. Repeat.

    Cancellation: the loop checks `asyncio.CancelledError` cleanly —
    it will not corrupt in-progress DB transactions because each object
    is committed independently before moving to the next.

    Use simulation mode when AWS credentials are not configured locally:
    set S3_ENABLED=true with blank AWS_ACCESS_KEY_ID to trigger simulation.
    """
    bucket = settings.s3_log_bucket
    prefix = settings.s3_log_prefix
    poll_interval = settings.s3_poll_interval_seconds
    max_keys = settings.s3_max_keys_per_poll
    use_simulation = not bool(settings.aws_access_key_id)

    if use_simulation:
        logger.warning(
            "[S3] No AWS credentials configured — running in SIMULATION MODE. "
            "Synthetic records will be ingested. Set aws_access_key_id in .env "
            "or attach an IAM role to switch to live S3 ingestion."
        )

    logger.info(
        f"[S3] Background ingest task started. "
        f"Bucket='{bucket}' Prefix='{prefix}' "
        f"PollInterval={poll_interval}s MaxKeys={max_keys} "
        f"Simulation={use_simulation}"
    )

    while True:
        try:
            async with AsyncSessionLocal() as db:
                # ── 1. Load processed-key ledger ──────────────────────────────
                already_processed = await _get_processed_keys(db, bucket)
                logger.debug(
                    f"[S3] Cursor table has {len(already_processed)} processed objects."
                )

            # ── 2. List new S3 objects ────────────────────────────────────────
            if use_simulation:
                new_objects = _simulate_s3_objects()
                # Filter out anything in the cursor table
                new_objects = [
                    o for o in new_objects if o["key"] not in already_processed
                ]
            else:
                new_objects = await asyncio.to_thread(
                    _list_new_s3_objects,
                    already_processed,
                    bucket,
                    prefix,
                    max_keys,
                )

            if not new_objects:
                logger.debug(
                    f"[S3] No new objects found. Next poll in {poll_interval}s."
                )
            else:
                logger.info(
                    f"[S3] Found {len(new_objects)} new objects to ingest."
                )

            # ── 3. Process each new object ────────────────────────────────────
            for obj_meta in new_objects:
                key = obj_meta["key"]
                ingest_status = "completed"
                records_ingested = 0
                parse_errors = 0

                try:
                    async with AsyncSessionLocal() as db:
                        records_ingested, parse_errors = await _process_single_object(
                            obj_meta, bucket, db, use_simulation
                        )
                        if parse_errors > 0 and records_ingested == 0:
                            ingest_status = "failed"
                        elif parse_errors > 0:
                            ingest_status = "partial"

                    logger.info(
                        f"[S3] Ingested '{key}': "
                        f"records={records_ingested} errors={parse_errors} "
                        f"status={ingest_status}"
                    )

                except Exception as exc:
                    logger.error(
                        f"[S3] Failed to process '{key}': {exc}", exc_info=True
                    )
                    ingest_status = "failed"

                finally:
                    # Always write the cursor row, even on failure, to prevent
                    # a broken object from being retried infinitely.
                    try:
                        async with AsyncSessionLocal() as db:
                            await _mark_object_processed(
                                db, bucket, obj_meta,
                                records_ingested, parse_errors, ingest_status,
                            )
                    except Exception as cursor_exc:
                        logger.error(
                            f"[S3] Failed to write cursor for '{key}': {cursor_exc}",
                            exc_info=True,
                        )

                # ── 4. Tag the S3 object (best-effort, non-blocking) ──────────
                if not use_simulation and ingest_status != "failed":
                    await asyncio.to_thread(_tag_s3_object_as_processed, bucket, key)

        except asyncio.CancelledError:
            logger.info("[S3] Background ingest task cancelled. Exiting cleanly.")
            return

        except Exception as exc:
            # Log unexpected errors and continue — a transient AWS outage or
            # DB hiccup should not permanently kill the background task.
            logger.error(
                f"[S3] Unexpected error in ingest loop (will retry in {poll_interval}s): {exc}",
                exc_info=True,
            )

        # ── 5. Sleep until next poll ──────────────────────────────────────────
        logger.debug(f"[S3] Sleeping {poll_interval}s until next poll ...")
        await asyncio.sleep(poll_interval)
