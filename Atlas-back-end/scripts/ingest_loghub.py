import asyncio
import csv
import os
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
    DashboardUser,
    DbActivityLog,
    EndpointLog,
    Microservice,
    NetworkLog,
    TeamUser,
)


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
        existing = (
            await db.execute(select(DashboardUser).where(DashboardUser.env == env).limit(1))
        ).scalars().first()
        if not existing:
            db.add(
                DashboardUser(
                    env=env,
                    name="Jane Doe" if env == "cloud" else "John Admin",
                    email="jane.doe@atlas-sec.com" if env == "cloud" else "john.admin@atlas-internal.com",
                    avatar="https://i.pravatar.cc/150?img=8",
                )
            )

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

        existing_team = (
            await db.execute(select(TeamUser).where(TeamUser.env == env).limit(1))
        ).scalars().first()
        if not existing_team:
            db.add(
                TeamUser(
                    env=env,
                    name="Atlas Admin",
                    email=f"admin-{env}@atlas.local",
                    role="Admin",
                    avatar="https://i.pravatar.cc/150?img=1",
                    is_active=True,
                    invite_pending=False,
                )
            )

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


async def ingest_loghub(data_root: Path, batch_size: int = 2000) -> None:
    settings = get_settings()
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

    files: list[tuple[str, Path]] = []
    for p in data_root.rglob("*_structured.csv"):
        if p.is_file():
            files.append((p.parent.name.lower(), p))

    async with SessionLocal() as db:
        async with db.begin():
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
            async with db.begin():
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
                                app=target_app,
                                path=random.choice(["/login", "/signup", "/checkout", "/search", "/profile"]),
                                method=random.choice(["GET", "POST", "PUT"]),
                                cost_per_call=round(random.uniform(0.001, 0.02), 4),
                                trend_pct=random.randint(-10, 25),
                                action=random.choice(["OK", "OK", "Rate-Limited", "Blocked"]),
                                calls_today=0,
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
                                port=random.choice([22, 80, 443, 3389, 3306]),
                                anomaly_type=random.choice([
                                    "Suspicious Activity",
                                    "Brute Force Attempt",
                                    "Port Scan",
                                    "Unusual Connection Pattern",
                                ]),
                                bandwidth_pct=random.randint(1, 100),
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
                        buffer.append(
                            EndpointLog(
                                env=env,
                                line_id=line_id,
                                timestamp=ts,
                                level=level,
                                component=component,
                                content=content,
                                event_id=event_id,
                                event_template=event_template,
                                target_app=target_app,
                                workstation_id=f"{os_name[:2].upper()}-{random.randint(100,999)}",
                                employee=random.choice([
                                    "John Doe",
                                    "Jane Smith",
                                    "Mike Johnson",
                                    "Sarah Williams",
                                    "David Brown",
                                ]),
                                avatar="https://i.pravatar.cc/150?img=12",
                                alert_message=content or "Endpoint event",
                                alert_category=random.choice([
                                    "Malware",
                                    "USB Activity",
                                    "Login Attempts",
                                    "File Changes",
                                ]),
                                severity=severity,
                                os_name=os_name,
                                is_offline=random.random() < 0.1,
                                is_malware=random.random() < 0.05,
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
                                db_user=random.choice(["postgres", "app_user", "readonly"]),
                                query_type=random.choice(["SELECT", "INSERT", "UPDATE", "DELETE"]),
                                target_table=random.choice(["users", "orders", "payments", "sessions"]),
                                reason="",
                                is_suspicious=random.random() < 0.08,
                                active_connections=random.randint(1, 200),
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

                    if len(buffer) >= batch_size:
                        db.add_all(buffer)
                        buffer.clear()

                if buffer:
                    db.add_all(buffer)
                    buffer.clear()

            # Post-ingest: create a few alerts per file to populate header
            async with db.begin():
                for _ in range(3):
                    env = _pick_env()
                    target_app = _pick_target_app()
                    a = Alert(
                        alert_id=str(uuid.uuid4()),
                        env=env,
                        line_id=None,
                        timestamp=_utcnow(),
                        level=None,
                        component=None,
                        content=None,
                        event_id=None,
                        event_template=None,
                        target_app=target_app,
                        source_ip=_pick_source_ip(),
                        app=target_app,
                        message=f"{dataset} ingest event: suspicious activity detected",
                        severity=random.choice(["Critical", "High", "Medium"]),
                        timestamp_label="just now",
                        raw_payload={"dataset": dataset, "source": str(csv_path)},
                    )
                    db.add(a)

    await engine.dispose()


def main() -> None:
    data_root = Path(__file__).resolve().parents[1] / "data" / "logs"
    asyncio.run(ingest_loghub(data_root=data_root))


if __name__ == "__main__":
    main()
