import asyncio
import csv
import random
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.models.db_models import (
    Alert,
    ApiLog,
    Application,
    AtlasUser,  # Replaced DashboardUser & TeamUser
    DbActivityLog,
    EndpointLog,
    Microservice,
    NetworkLog,
)
from app.services.auth_service import hash_password  # Added to secure the default admin


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_get(row: Dict[str, Any], key: str) -> Optional[str]:
    v = row.get(key)
    if v is None:
        return None
    v = str(v).strip()
    return v if v else None


def _parse_int(v: Optional[str], default: int = 0) -> int:
    if v is None:
        return default
    try:
        return int(float(v))
    except Exception:
        return default


def _pick_env() -> str:
    return random.choice(["cloud", "local"])


def _pick_target_app() -> str:
    return random.choice(["Naukri", "GenAI", "Flipkart"])


def _pick_source_ip() -> str:
    return f"10.{random.randint(0, 255)}.{random.randint(0, 255)}.{random.randint(1, 254)}"


def _pick_dest_ip() -> str:
    return f"172.16.{random.randint(0, 255)}.{random.randint(1, 254)}"


def _pick_severity(level: Optional[str] = None) -> str:
    if level:
        lv = level.lower()
        if lv in {"fatal", "panic"}:
            return "Critical"
        if lv in {"error", "err"}:
            return "High"
        if lv in {"warn", "warning"}:
            return "Medium"
        if lv in {"info"}:
            return "Low"
    return random.choice(["Critical", "High", "Medium", "Low"])


def _iter_csv_rows(csv_path: Path) -> Iterable[Dict[str, Any]]:
    with csv_path.open("r", encoding="utf-8", errors="ignore", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if not isinstance(row, dict):
                continue
            yield row


async def _ensure_seed_config(db: AsyncSession) -> None:
    for env in ("cloud", "local"):
        
        # ── 1. Unified AtlasUser Seeding ──
        existing_user = (
            await db.execute(select(AtlasUser).where(AtlasUser.env == env).limit(1))
        ).scalars().first()
        
        if not existing_user:
            # We must hash the password so the login endpoint works!
            default_password = hash_password("Admin123!")
            db.add(
                AtlasUser(
                    env=env,
                    name="Jane Admin" if env == "cloud" else "John Admin",
                    email="admin@atlas-sec.com" if env == "cloud" else "admin@atlas-internal.com",
                    hashed_password=default_password,
                    role="Admin",
                    is_active=True,
                    avatar="https://i.pravatar.cc/150?img=8",
                )
            )

        # ── 2. Applications Seeding ──
        apps = [
            ("all", "All Applications" if env == "cloud" else "All Systems"),
            ("naukri", "Naukri"),
            ("genai", "GenAI"),
            ("flipkart", "Flipkart"),
        ]
        for app_id, name in apps:
            found = (
                await db.execute(
                    select(Application).where(
                        Application.env == env,
                        Application.app_id == app_id,
                    )
                )
            ).scalars().first()
            if not found:
                db.add(Application(env=env, app_id=app_id, name=name))

        # ── 3. Microservices Seeding ──
        existing_ms = (
            await db.execute(select(Microservice).where(Microservice.env == env).limit(1))
        ).scalars().first()
        if not existing_ms:
            defaults = [
                ("api", "API-Gateway", "Healthy", "40%", "75%", "auth,payment,notifications"),
                ("auth", "Auth-Service", "Healthy", "20%", "25%", "api"),
                ("payment", "Payment-Service", "Failing" if env == "cloud" else "Healthy", "50%", "50%", "api"),
                ("notifications", "Notification-Service", "Healthy", "70%", "25%", "api"),
            ]
            for sid, name, status, top, left, conns in defaults:
                db.add(
                    Microservice(
                        env=env,
                        service_id=sid,
                        name=name,
                        status=status,
                        position_top=top,
                        position_left=left,
                        connections_csv=conns,
                    )
                )

    await db.flush()


async def ingest_loghub_data(db: AsyncSession, data_root: Path, batch_size: int = 2000) -> None:
    settings = get_settings()

    files: list[tuple[str, Path]] = []
    for p in data_root.rglob("*_structured.csv"):
        if p.is_file():
            files.append((p.parent.name.lower(), p))

    # Seeding should be handled separately on startup, not during log ingestion.
    await _ensure_seed_config(db)

    for dataset, csv_path in sorted(files, key=lambda x: str(x[1])):
            table = None
            if "apache" in dataset:
                table = "api"
            elif dataset in {"openssh", "proxifier"}:
                table = "network"
            elif dataset in {"windows", "linux", "mac"}:
                table = "endpoint"
            elif "hadoop" in dataset:
                table = "db"
            else:
                continue

            buffer = []
            # The calling function should manage the transaction.
            for row in _iter_csv_rows(csv_path):
                    env = _pick_env()
                    target_app = _pick_target_app()
                    line_id = _parse_int(_safe_get(row, "LineId"), default=0) or None
                    ts = _safe_get(row, "Timestamp") or _utcnow()
                    level = _safe_get(row, "Level")
                    component = _safe_get(row, "Component")
                    content = _safe_get(row, "Content")
                    event_id = _safe_get(row, "EventId")
                    event_template = _safe_get(row, "EventTemplate")

                    severity = _pick_severity(level)
                    raw_payload = {
                        "dataset": dataset,
                        **row,
                    }

                    if table == "api":
                        buffer.append(
                            ApiLog(
                                env=env,
                                line_id=line_id,
                                timestamp=ts,
                                level=level,
                                component=component,
                                content=content,
                                event_id=event_id,
                                event_template=event_template,
                                target_app=target_app,
                                severity=severity,
                                source_ip=_pick_source_ip(),
                                app=target_app, # TODO: Parse from content
                                path="/", # TODO: Parse from content
                                method="GET", # TODO: Parse from content
                                cost_per_call=0.0, # TODO: Calculate or assign based on path
                                trend_pct=0,
                                action="OK", # TODO: Determine from status code in content
                                calls_today=1,
                                blocked_count=0,
                                avg_latency_ms=round(random.uniform(30, 900), 1),
                                estimated_cost=round(random.uniform(0.0, 0.5), 4),
                                hour_label="",
                                actual_calls=1,
                                predicted_calls=1,
                                raw_payload=raw_payload,
                            )
                        )
                    elif table == "network":
                        buffer.append(
                            NetworkLog(
                                env=env,
                                line_id=line_id,
                                timestamp=ts,
                                level=level,
                                component=component,
                                content=content,
                                event_id=event_id,
                                event_template=event_template,
                                target_app=target_app,
                                severity=severity,
                                source_ip=_pick_source_ip(),
                                dest_ip=_pick_dest_ip(),
                                app=target_app,
                                port=0, # TODO: Parse from content
                                anomaly_type="Unknown", # TODO: Classify based on content
                                bandwidth_pct=0,
                                active_connections=random.randint(1, 5000),
                                dropped_packets=random.randint(0, 500),
                                raw_payload=raw_payload,
                            )
                        )
                    elif table == "endpoint":
                        os_name = {
                            "windows": "Windows",
                            "linux": "Linux",
                            "mac": "macOS",
                        }.get(dataset, "Unknown")

                        # TODO: Implement real parsing of 'content' to determine these values
                        alert_category = "Generic"
                        alert_msg = content or "Generic event"
                        is_malware_flag = "malware" in alert_msg.lower()


                        buffer.append(
                            EndpointLog(
                                env=env,
                                line_id=line_id,
                                timestamp=ts,
                                level=level,
                                component=component,
                                content=alert_msg, # Use the generated message
                                event_id=event_id,
                                event_template=event_template,
                                target_app=target_app,
                                workstation_id=f"{os_name[:2].upper()}-{random.randint(100,999)}",
                                employee="unknown", # TODO: Parse from content
                                avatar="https://i.pravatar.cc/150?img=12",
                                alert_message=alert_msg,
                                alert_category=alert_category,
                                severity=severity,
                                os_name=os_name,
                                is_offline=False,
                                is_malware=is_malware_flag, # TODO: Determine from content
                                raw_payload=raw_payload,
                            )
                        )
                    elif table == "db":
                        buffer.append(
                            DbActivityLog(
                                env=env,
                                line_id=line_id,
                                timestamp=ts,
                                level=level,
                                component=component,
                                content=content,
                                event_id=event_id,
                                event_template=event_template,
                                target_app=target_app,
                                severity=severity,
                                app=target_app,
                                db_user="unknown", # TODO: Parse from content
                                query_type="UNKNOWN", # TODO: Parse from content
                                target_table="unknown", # TODO: Parse from content
                                reason="", # TODO: Classify based on content
                                is_suspicious=False, # TODO: Determine from content
                                active_connections=0,
                                avg_latency_ms=round(random.uniform(1, 1200), 1),
                                data_export_volume_tb=round(random.uniform(0.0, 2.5), 3),
                                hour_label="",
                                select_count=random.randint(0, 200),
                                insert_count=random.randint(0, 50),
                                update_count=random.randint(0, 50),
                                delete_count=random.randint(0, 50),
                                raw_payload=raw_payload,
                            )
                        )

                    # ── Memory Leak Fix ──
                    if len(buffer) >= batch_size:
                        db.add_all(buffer)
                        await db.flush()
                        buffer.clear()

                    if buffer:
                        db.add_all(buffer)
                        await db.flush()
                        buffer.clear()


def main() -> None:
    data_root = Path(__file__).resolve().parents[1] / "data" / "logs"
    engine = create_async_engine(get_settings().database_url)
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)
    async def run():
        async with SessionLocal() as db:
            await ingest_loghub_data(db, data_root=data_root)
    asyncio.run(run())


if __name__ == "__main__":
    main()