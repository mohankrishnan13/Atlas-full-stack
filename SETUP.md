# ATLAS SOC Dashboard — Complete Setup Guide

## Folder Structure After Extracting Both Zips

```
Atlas-full-stack/                        ← open a terminal here
│
├── docker-compose.yml                   ← REPLACE with the one in this zip
├── .env.example                         ← copy to .env and edit
│
├── Atlas-back-end/                      ← backend (leave as-is)
│   ├── app/
│   ├── data/logs/
│   ├── Dockerfile
│   └── requirements.txt
│
└── Atlas-front-end/                     ← frontend
    ├── src/
    ├── package.json
    ├── Dockerfile                       ← REPLACE with Dockerfile.frontend from this zip
    └── next.config.ts                   ← REPLACE with next.config.ts from this zip
```

---

## Step 1 — Copy the Required Files Into Place

From the `setup-files/` folder in this zip:

| File in this zip       | Copy it to                                          |
|------------------------|-----------------------------------------------------|
| `docker-compose.yml`   | `Atlas-full-stack/docker-compose.yml`               |
| `.env.example`         | `Atlas-full-stack/.env.example`                     |
| `Dockerfile.frontend`  | `Atlas-full-stack/Atlas-front-end/Dockerfile`       |
| `next.config.ts`       | `Atlas-full-stack/Atlas-front-end/next.config.ts`   |

**On macOS / Linux:**
```bash
cp docker-compose.yml      ../docker-compose.yml
cp .env.example            ../.env.example
cp Dockerfile.frontend     ../Atlas-front-end/Dockerfile
cp next.config.ts          ../Atlas-front-end/next.config.ts
```

**On Windows (PowerShell):**
```powershell
Copy-Item docker-compose.yml    ..\docker-compose.yml
Copy-Item .env.example          ..\.env.example
Copy-Item Dockerfile.frontend   ..\Atlas-front-end\Dockerfile
Copy-Item next.config.ts        ..\Atlas-front-end\next.config.ts
```

---

## Step 2 — Create Your .env File

Copy the example file and open it in a text editor:

```bash
cp .env.example .env
```

**Important fields to change before starting:**

| Variable                     | Description                                      |
|------------------------------|--------------------------------------------------|
| `POSTGRES_USER`              | Database username                                |
| `POSTGRES_PASSWORD`          | Database password                                |
| `POSTGRES_DB`                | Database name                                    |
| `SECRET_KEY`                 | JWT signing secret — must be long and random     |
| `INGEST_API_KEY`             | API key for the Vector / Fluent Bit ingest route |
| `VELOCIRAPTOR_WEBHOOK_SECRET`| HMAC secret for Velociraptor webhook payloads    |

**Generate a secure `SECRET_KEY` or `VELOCIRAPTOR_WEBHOOK_SECRET`:**
```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

**Generate a secure `INGEST_API_KEY`:**
```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

> ⚠️ **Never commit `.env` to version control.** It is already listed in `.gitignore`.

---

## Step 3 — Prerequisites

Install **Docker Desktop** (includes Docker Compose):

- **Mac / Windows:** https://www.docker.com/products/docker-desktop/
- **Linux:** https://docs.docker.com/engine/install/

Verify your installation:
```bash
docker --version          # Docker version 24+
docker compose version    # Docker Compose version v2+
```

---

## Step 4 — Start the Stack

Open a terminal inside `Atlas-full-stack/` and run:

```bash
docker compose up --build
```

**What happens step by step:**

1. Docker pulls `postgres:16-alpine`
2. Docker builds the FastAPI backend image
3. Docker builds the Next.js frontend image
4. PostgreSQL starts and passes its health check
5. Backend starts, creates all database tables, ingests sample log data, and seeds the default users
6. Frontend starts and connects to the backend

**You will see these lines in the logs when everything is ready:**
```
atlas-backend  | ATLAS startup complete. Docs: http://localhost:8000/docs
atlas-frontend | ▲ Next.js ... ready in ...ms
```

---

## Step 5 — Open the Dashboard

| Service       | URL                          |
|---------------|------------------------------|
| **Dashboard** | http://localhost:3000        |
| **API Docs**  | http://localhost:8000/docs   |
| **Health**    | http://localhost:8000/health |

---

## Step 6 — Log In

Three accounts are created automatically on first boot:

| Email                  | Password       | Role      | Access Level                     |
|------------------------|----------------|-----------|----------------------------------|
| `admin@atlas.com`    | `AtlasAdmin1!` | Admin     | Full access + user management    |
| `analyst@atlas.com`  | `Analyst123!`  | Analyst   | Read + quarantine + remediation  |
| `audit@firm.com`       | `ReadOnly123!` | Read-Only | View dashboards only             |

> ⚠️ **Change these passwords immediately** after first login in any shared or production environment.

---

## Subsequent Starts

After the first build, all images are cached. Starting again is fast:

```bash
docker compose up -d        # start all services in the background
docker compose down         # stop all services (database is preserved)
docker compose down -v      # stop all services AND wipe the database completely
```

---

## Viewing Logs

```bash
docker compose logs -f                   # stream all service logs
docker compose logs -f atlas-backend     # FastAPI backend only
docker compose logs -f atlas-frontend    # Next.js frontend only
docker compose logs -f postgres          # database only
```

---

## Rebuilding After Code Changes

```bash
# After editing Python files in Atlas-back-end/
docker compose up --build atlas-backend

# After editing TypeScript / TSX files in Atlas-front-end/
docker compose up --build atlas-frontend

# After changing both
docker compose up --build
```

---

## Common Issues

### `atlas-frontend` exits immediately or crashes during build
**Cause:** The old `Dockerfile` is still present in `Atlas-front-end/`.  
**Fix:** Make sure you replaced it with `Dockerfile.frontend` from this zip as described in Step 1.

### Login always fails with "Could not connect to server"
**Cause:** The backend container is not running.  
**Fix:** Check the status of all services:
```bash
docker compose ps
```

### Dashboard shows "Failed to load data" on every panel
**Cause:** The backend started before the database was fully ready.  
**Fix:** Restart the backend:
```bash
docker compose restart atlas-backend
```

### Port 3000 or 8000 is already in use
**Fix:** Stop whatever is using that port, or change the host-side port mapping in `docker-compose.yml`:
```yaml
ports:
  - "3001:3000"    # use 3001 on your machine instead of 3000
```

### `docker compose` command not found
**Fix:** Use `docker-compose` (with a hyphen) if you are on an older Docker installation, or update Docker Desktop to the latest version.

---

## Architecture Overview

```
Browser (localhost:3000)
        │
        │  HTTP / JSON
        ▼
atlas-frontend (Next.js)                →  atlas-network
        │
        │  NEXT_PUBLIC_ATLAS_BACKEND_URL = http://localhost:8000
        │  (browser calls the backend directly — no Next.js proxy layer)
        │
Browser (localhost:8000)
        │
        ▼
atlas-backend (FastAPI)                 →  atlas-network
        │
        │  postgresql+asyncpg://POSTGRES_USER:POSTGRES_PASSWORD@postgres:5432/POSTGRES_DB
        ▼
postgres (PostgreSQL 16)                →  atlas-network (internal only, not exposed to host)
```

> The frontend fetches data from `http://localhost:8000` **from the user's browser**, not from inside the Docker network. This means the backend port `8000` must always remain mapped to `localhost:8000` in `docker-compose.yml`.
