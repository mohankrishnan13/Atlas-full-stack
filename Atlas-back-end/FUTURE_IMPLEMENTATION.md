# ATLAS — Future Implementation Guide
## Transitioning from MVP to Live Production Environment

---

## Overview

The current ATLAS backend is an MVP that reads log data from local JSONL files
in `data/logs/`. This guide details the exact steps to:

1. Set up a live **Velociraptor** server for real-time endpoint monitoring
2. Configure Velociraptor to push webhook alerts to ATLAS
3. Transition from local file ingestion to a **live Kafka queue** or **Syslog stream**
4. Harden the deployment for a production SOC environment

---

## Phase 1: Live Velociraptor Server Setup

### 1.1 — What is Velociraptor?

Velociraptor is an open-source DFIR (Digital Forensics and Incident Response) platform
that deploys lightweight agents on endpoints. Agents run **VQL (Velociraptor Query Language)**
artifacts to collect forensic data, detect threats, and respond to incidents in real time.

It replaces the Wazuh agents used in the previous ATLAS architecture with a more powerful,
query-driven approach.

### 1.2 — Server Installation

**Requirements:** Linux VM/server, 4+ GB RAM, 50+ GB disk.

```bash
# 1. Download latest release binary
VELOCIRAPTOR_VERSION="0.72.0"
wget https://github.com/Velocidex/velociraptor/releases/download/v${VELOCIRAPTOR_VERSION}/velociraptor-v${VELOCIRAPTOR_VERSION}-linux-amd64

chmod +x velociraptor-v${VELOCIRAPTOR_VERSION}-linux-amd64
sudo mv velociraptor-v${VELOCIRAPTOR_VERSION}-linux-amd64 /usr/local/bin/velociraptor

# 2. Generate a self-hosted server configuration
velociraptor config generate --self-signed > /etc/velociraptor/server.config.yaml

# 3. Create an admin user
velociraptor --config /etc/velociraptor/server.config.yaml \
  user add admin --role administrator

# 4. Start the server as a systemd service
velociraptor --config /etc/velociraptor/server.config.yaml service install
systemctl enable --now velociraptor_server
```

Access the Velociraptor GUI at: `https://<your-server-ip>:8889`

### 1.3 — Deploying Endpoint Agents

```bash
# Generate a client MSI installer for Windows endpoints
velociraptor config repack --msi /tmp/velociraptor_client.msi

# Or generate a DEB for Ubuntu/Debian
velociraptor config repack --deb /tmp/velociraptor_client.deb
```

Distribute and install the agent on all monitored endpoints via your MDM (Intune, JAMF, Ansible).

---

## Phase 2: Configuring Velociraptor Webhook Alerts → ATLAS

### 2.1 — How Velociraptor Webhooks Work

Velociraptor supports **Server Event Artifacts** — VQL queries that run
continuously on the server and trigger actions (like webhook calls) when
a condition is met.

The artifact monitors a stream of client events (hunt results, artifact
collections) and POSTs a JSON payload to your ATLAS endpoint when triggered.

### 2.2 — The Webhook Server Artifact (VQL)

Create a new artifact in the Velociraptor GUI under `View Artifacts → Add`:

```yaml
# Artifact name: Custom.ATLAS.Webhook.Dispatcher
name: Custom.ATLAS.Webhook.Dispatcher
description: |
  Forwards critical endpoint alerts to the ATLAS SOC Dashboard webhook.
  Monitors for malware detections, rootkit alerts, and policy violations.
type: SERVER_EVENT

parameters:
  - name: AtlasWebhookURL
    default: "https://your-atlas-backend.internal:8000/webhooks/velociraptor"
  - name: AtlasWebhookSecret
    description: "HMAC-SHA256 secret — must match VELOCIRAPTOR_WEBHOOK_SECRET in ATLAS .env"
    default: ""
  - name: WatchArtifacts
    type: csv
    default: |
      Artifact
      Windows.Detection.Yara.Process
      Windows.Events.ProcessCreation
      Linux.Sys.LastUserLogin
      Generic.Client.DiskSpace

sources:
  - query: |
      -- Watch the master event table for alerts from the listed artifacts
      LET alerts = SELECT *
        FROM watch_monitoring(artifact=WatchArtifacts)
        WHERE log(message="Received alert from " + ClientId)

      -- Build the payload and send webhook
      SELECT *
        FROM foreach(
          row=alerts,
          query={
            SELECT
              http_client(
                url=AtlasWebhookURL,
                method="POST",
                headers=dict(
                  `Content-Type`="application/json",
                  `X-Velociraptor-Signature`=hmac(
                    key=AtlasWebhookSecret,
                    message=serialize(item=dict(
                      artifact=Artifact,
                      client_id=ClientId,
                      session_id=SessionId,
                      timestamp=now(),
                      rows=_value
                    ))
                  )
                ),
                data=serialize(item=dict(
                  artifact=Artifact,
                  client_id=ClientId,
                  session_id=SessionId,
                  timestamp=timestamp(epoch=now()).UTC,
                  rows=_value
                ))
              ) AS WebhookResult
          }
        )
```

### 2.3 — Setting the Webhook Secret

In Velociraptor's artifact parameters, set `AtlasWebhookSecret` to a long
random hex string. Then set the **exact same value** in ATLAS:

```bash
# Generate a secure secret (run this once)
openssl rand -hex 32
# Example output: a7b3c2d1e4f5...

# Set it in ATLAS .env
VELOCIRAPTOR_WEBHOOK_SECRET=a7b3c2d1e4f5...
```

### 2.4 — The ATLAS Webhook Receiver (Already Implemented)

The endpoint is already built in `app/api/routes_webhooks.py`.
It verifies the HMAC-SHA256 signature and persists the event to PostgreSQL.

```
POST /webhooks/velociraptor
Headers:
  Content-Type: application/json
  X-Velociraptor-Signature: sha256=<hmac_hex>

Body:
{
  "artifact": "Windows.Detection.Yara.Process",
  "client_id": "C.1234abcd5678ef",
  "session_id": "F.ABCDEF123456",
  "timestamp": "2024-05-21T10:45:00Z",
  "rows": [
    {
      "Username": "john.smith",
      "Message": "YARA match: Emotet dropper variant in PID 4421",
      "Severity": "Critical",
      "OS": "Windows 11",
      "ProcessName": "explorer.exe",
      "ProcessPath": "C:\\Windows\\explorer.exe"
    }
  ]
}

Response (202 Accepted):
{
  "status": "accepted",
  "client_id": "C.1234abcd5678ef",
  "artifact": "Windows.Detection.Yara.Process"
}
```

**Stubbed production code for expanded Velociraptor actions:**

```python
# app/integrations/velociraptor_client.py  (future file)
import grpc
from pyvelociraptor import api_pb2, api_pb2_grpc

class VelociraptorClient:
    def __init__(self, api_url: str, cert_path: str):
        # Load the API certificate generated by Velociraptor
        creds = grpc.ssl_channel_credentials(
            open(cert_path, "rb").read()
        )
        self.channel = grpc.secure_channel(api_url, creds)
        self.stub = api_pb2_grpc.APIStub(self.channel)

    async def isolate_host(self, client_id: str) -> dict:
        """
        Sends the Windows.Remediation.Quarantine artifact to a client.
        This cuts all network connections except the Velociraptor C2 channel.
        """
        request = api_pb2.CollectArtifactRequest(
            client_id=client_id,
            artifacts=["Windows.Remediation.Quarantine"],
        )
        response = self.stub.CollectArtifact(request)
        return {"flow_id": response.flow_id, "status": "quarantine_initiated"}

    async def run_artifact(self, client_id: str, artifact: str, params: dict) -> str:
        """Run any artifact on a client and return the flow ID."""
        request = api_pb2.CollectArtifactRequest(
            client_id=client_id,
            artifacts=[artifact],
            parameters=api_pb2.ArtifactParameters(
                env=[api_pb2.VQLEnv(key=k, value=v) for k, v in params.items()]
            ),
        )
        response = self.stub.CollectArtifact(request)
        return response.flow_id
```

---

## Phase 3: Transitioning from Local Files to Live Data Streams

### 3.1 — Current Architecture (MVP)

```
data/logs/*.jsonl  →  log_ingestion.py  →  PostgreSQL  →  FastAPI API
     (static files at startup)
```

### 3.2 — Target Architecture Option A: Kafka

**When to use:** High-throughput environments (100k+ events/day), multiple
producers (firewalls, SIEMs, cloud trails), need for replayability.

```
Velociraptor/Firewall/SIEM
        │
        ▼
  Kafka Producer (logstash/fluentd/vector)
        │
        ▼
  Kafka Topic: atlas.events
        │
        ▼
  ATLAS Kafka Consumer (aiokafka)  ←── new file: services/kafka_consumer.py
        │
        ▼
  PostgreSQL  →  FastAPI API
```

**Implementation steps:**

```bash
# 1. Install Kafka (local dev with Docker)
docker run -d --name kafka \
  -p 9092:9092 \
  -e KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://localhost:9092 \
  confluentinc/cp-kafka:latest

# 2. Add aiokafka to requirements.txt
# aiokafka==0.10.0

# 3. Implement the consumer
```

```python
# app/services/kafka_consumer.py  (future file)
import json
import logging
from aiokafka import AIOKafkaConsumer
from app.core.config import get_settings
from app.core.database import AsyncSessionLocal
from app.services.log_ingestion import (
    _parse_endpoint_log, _parse_network_log,
    _parse_api_log, _parse_db_activity_log
)

logger = logging.getLogger(__name__)
settings = get_settings()

LOG_TYPE_PARSERS = {
    "endpoint": _parse_endpoint_log,
    "network":  _parse_network_log,
    "api":      _parse_api_log,
    "db":       _parse_db_activity_log,
}

async def start_kafka_consumer():
    """
    Starts a persistent Kafka consumer that processes events in real time.
    Call this from main.py lifespan instead of ingest_all_logs().
    """
    consumer = AIOKafkaConsumer(
        "atlas.events",
        bootstrap_servers=settings.kafka_bootstrap_servers,  # add to Settings
        group_id="atlas-soc-backend",
        value_deserializer=lambda v: json.loads(v.decode("utf-8")),
        auto_offset_reset="latest",   # "earliest" to replay from beginning
    )

    await consumer.start()
    logger.info("Kafka consumer started. Listening on topic: atlas.events")

    try:
        async for msg in consumer:
            event = msg.value
            log_type = event.get("log_type", "endpoint")
            parser = LOG_TYPE_PARSERS.get(log_type)

            if not parser:
                logger.warning(f"Unknown log_type in Kafka message: {log_type}")
                continue

            async with AsyncSessionLocal() as session:
                obj = parser(event)
                session.add(obj)
                await session.commit()

    finally:
        await consumer.stop()
        logger.info("Kafka consumer stopped.")
```

**main.py change** — replace `ingest_all_logs()` with:

```python
# In lifespan(), replace the file ingestion block with:
import asyncio
from app.services.kafka_consumer import start_kafka_consumer

# Start Kafka consumer as a background task
kafka_task = asyncio.create_task(start_kafka_consumer())
logger.info("Kafka consumer background task started.")

yield

# On shutdown:
kafka_task.cancel()
```

### 3.3 — Target Architecture Option B: Syslog / UDP Stream

**When to use:** On-premises environments, existing syslog infrastructure
(firewalls, network devices), minimal additional tooling.

```
Firewall/Router (rsyslog forwarding)
        │  (UDP 514 or TCP 601)
        ▼
  ATLAS Syslog Listener (Python asyncio UDP server)
        │
        ▼
  Log Parser → PostgreSQL
```

**Implementation steps:**

```python
# app/services/syslog_listener.py  (future file)
import asyncio
import re
import logging
from app.core.database import AsyncSessionLocal
from app.services.log_ingestion import _parse_network_log

logger = logging.getLogger(__name__)

# RFC 5424 syslog pattern (simplified)
SYSLOG_PATTERN = re.compile(
    r"<(?P<priority>\d+)>(?P<version>\d+) "
    r"(?P<timestamp>\S+) (?P<hostname>\S+) "
    r"(?P<app>\S+) (?P<procid>\S+) (?P<msgid>\S+) "
    r"(?P<structured_data>\S+) (?P<message>.+)"
)

class SyslogProtocol(asyncio.DatagramProtocol):
    def datagram_received(self, data: bytes, addr: tuple):
        raw = data.decode("utf-8", errors="replace").strip()
        match = SYSLOG_PATTERN.match(raw)
        if not match:
            return

        parsed = match.groupdict()
        # Transform to ATLAS network log format
        event = {
            "env": "cloud",
            "source_ip": addr[0],
            "dest_ip": parsed["hostname"],
            "app": parsed["app"],
            "port": 0,
            "anomaly_type": parsed["message"][:200],
            "bandwidth_pct": 0,
            "active_connections": 0,
            "dropped_packets": 0,
            "timestamp": parsed["timestamp"],
        }

        asyncio.create_task(self._persist(event))

    async def _persist(self, event: dict):
        async with AsyncSessionLocal() as session:
            obj = _parse_network_log(event)
            session.add(obj)
            await session.commit()

async def start_syslog_server(host: str = "0.0.0.0", port: int = 514):
    loop = asyncio.get_event_loop()
    transport, protocol = await loop.create_datagram_endpoint(
        SyslogProtocol,
        local_addr=(host, port),
    )
    logger.info(f"Syslog UDP listener started on {host}:{port}")
    return transport
```

---

## Phase 4: Production Hardening Checklist

### 4.1 — Authentication & Authorization

Replace the current bearer token placeholder with a full JWT implementation:

```python
# app/core/auth.py  (future file)
from datetime import datetime, timedelta, timezone
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/token")

def create_access_token(data: dict, expires_delta: timedelta) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + expires_delta
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.secret_key, algorithm=settings.algorithm)

async def get_current_user(token: str = Depends(oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    return username
```

### 4.2 — CORS Tightening

In `.env`, change:
```bash
# Replace wildcard with your actual frontend URL
ALLOWED_ORIGINS=https://atlas-soc.yourcompany.com
```

In `main.py`:
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins.split(","),  # add to Settings
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)
```

### 4.3 — Rate Limiting

Install `slowapi` and add rate limiting to sensitive endpoints:

```bash
pip install slowapi
```

```python
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

@router.post("/webhooks/velociraptor")
@limiter.limit("100/minute")  # Prevent webhook flood
async def receive_velociraptor_event(request: Request, ...):
    ...
```

### 4.4 — Database Migrations (Alembic)

```bash
# Initialize Alembic (run once)
alembic init alembic

# In alembic/env.py, set:
# from app.models.db_models import Base
# target_metadata = Base.metadata

# Create a migration
alembic revision --autogenerate -m "initial_schema"

# Apply migrations
alembic upgrade head
```

### 4.5 — Kubernetes Deployment

```yaml
# k8s/atlas-backend-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: atlas-backend
spec:
  replicas: 2
  selector:
    matchLabels:
      app: atlas-backend
  template:
    metadata:
      labels:
        app: atlas-backend
    spec:
      containers:
      - name: atlas
        image: your-registry/atlas-backend:2.0.0
        ports:
        - containerPort: 8000
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: atlas-secrets
              key: database-url
        livenessProbe:
          httpGet:
            path: /health
            port: 8000
          initialDelaySeconds: 30
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /health
            port: 8000
          initialDelaySeconds: 10
          periodSeconds: 10
```

### 4.6 — Monitoring & Observability

```bash
# Add OpenTelemetry tracing
pip install opentelemetry-sdk opentelemetry-instrumentation-fastapi

# Add Prometheus metrics
pip install prometheus-fastapi-instrumentator
```

```python
# In main.py
from prometheus_fastapi_instrumentator import Instrumentator
Instrumentator().instrument(app).expose(app)
# Metrics available at GET /metrics for Prometheus scraping
```

---

## Summary: Migration Timeline

| Step | What | Effort |
|------|------|--------|
| 1 | Deploy Velociraptor server + agents | 1–2 days |
| 2 | Configure webhook artifact + secret | 2 hours |
| 3 | Set `REINGEST_ON_STARTUP=false` in .env | 5 minutes |
| 4 | Implement Kafka consumer OR Syslog listener | 2–4 days |
| 5 | Add JWT authentication | 1 day |
| 6 | Set up Alembic migrations | 2 hours |
| 7 | Deploy to Kubernetes with secrets | 1 day |
| 8 | Configure Prometheus + Grafana | 1 day |

**Total estimated effort: 1–2 weeks for a full production-grade deployment.**

---

*Generated by the ATLAS Refactor — Phase 5 Documentation.*
*Backend version: 2.0.0 (PostgreSQL + Velociraptor Stack)*
