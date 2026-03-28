# UEI Cloud Platform

**Unified Energy Interface** — a cloud-hosted Battery Management System (BMS) monitoring platform built as a fourth-year capstone project.

Ingests telemetry from BMS hardware (Orion Jr2), stores it in PostgreSQL, serves it through a multi-tenant REST API, visualizes it in Grafana, and exposes an AI-powered natural language assistant powered by Claude.

---

## Architecture

```
BMS Hardware / Raspberry Pi / Simulator
          │
          │  POST /telemetry  (no auth — device-friendly)
          ▼
  FastAPI Cloud API  (:8000)
          │
          ├─── PostgreSQL  (telemetry + auth tables)
          │         │
          │         └─── Grafana  (:3000)  real-time dashboards
          │
          └─── Next.js Frontend  (Vercel)
                    │
                    ├─── /             Landing page
                    ├─── /login        Login / Register
                    └─── /dashboard    Live telemetry + AI chat
                              │
                              └─── Claude AI Chatbot
                                        (Next.js API route → Anthropic SDK)
                                        (natural language → SQL)
```

### Stack

| Layer | Technology |
|---|---|
| Cloud API | FastAPI 0.115, Python 3.11, Uvicorn |
| Database | PostgreSQL 16 |
| Visualization | Grafana (latest) |
| Frontend | Next.js 15 (App Router), TypeScript, Tailwind CSS |
| Hosting | Vercel (frontend) · Docker Compose on GCP VM (backend) |
| AI Assistant | Claude (`claude-sonnet-4-6`) via Anthropic SDK |
| Auth | JWT (HS256, 8h expiry) · bcrypt password hashing |
| Containers | Docker + docker-compose |

---

## Repository Structure

```
uei-cloud/
├── api/
│   ├── cloud_api.py          # FastAPI application (auth + telemetry + data routes)
│   ├── seed.py               # Creates superadmin account (org: Capstone)
│   ├── Dockerfile
│   └── requirements.txt
│
├── db/
│   ├── init.sql              # Full schema — runs automatically on first docker-compose up
│   └── migrate_auth.sql      # Safe migration for existing DBs (adds auth tables)
│
├── web/                      # Next.js frontend (deployed to Vercel)
│   ├── app/
│   │   ├── page.tsx          # Landing page  →  uei-cloud.vercel.app/
│   │   ├── login/page.tsx    # Login + Register
│   │   ├── dashboard/        # Live dashboard (auth-gated)
│   │   └── api/              # Next.js API routes (proxy to FastAPI + AI chatbot)
│   └── vercel.json
│
├── simulator.py              # Orion Jr2 BMS simulator (configurable rate/node)
├── bms_api_simulator.py      # Realistic stateful BMS sim (drift + faults)
├── sim_bms2.py               # BMS Node 2 simulator (charge-cycle, 14S LiFePO4)
├── sim_bms3.py               # BMS Node 3 simulator (thermal stress + fault derating)
├── sim_pv_api.py             # PV system simulator (inverters + loads)
├── run_all.py                # Launch all 4 simulators concurrently (BMS-1/2/3 + PV)
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## Deployment

### Requirements

- Google Cloud Compute Engine VM (Debian / Ubuntu)
- Docker + Docker Compose v2
- Firewall rules open: `8000` (API), `3000` (Grafana)
- A `.env` file — copy from `.env.example` and fill in secrets

### First-time setup

```bash
git clone git@github.com:Harsh-0214/uei-cloud.git
cd uei-cloud
cp .env.example .env          # edit SECRET_KEY and passwords
docker compose up -d --build
```

`db/init.sql` runs automatically and creates all tables on first startup.

### Updating an existing deployment

```bash
git pull
docker compose build api
docker compose up -d api
```

### Create the superadmin account

After the API container is running:

```bash
docker exec uei-cloud-api python seed.py
```

This creates org **Capstone** and user `capstone.uei@gmail.com` / `capstone` with role `superadmin`. Safe to re-run.

### Migrate an existing database (auth tables only)

```bash
docker exec -i uei-postgres psql -U uei -d uei < db/migrate_auth.sql
```

---

## Environment Variables

Copy `.env.example` to `.env` and set:

| Variable | Description |
|---|---|
| `POSTGRES_DB` | Database name (default: `uei`) |
| `POSTGRES_USER` | DB user (default: `uei`) |
| `POSTGRES_PASSWORD` | DB password |
| `SECRET_KEY` | JWT signing secret — **change in production** |
| `GF_SECURITY_ADMIN_PASSWORD` | Grafana admin password |

For the Next.js frontend, set in Vercel environment variables:

| Variable | Description |
|---|---|
| `API_URL` | FastAPI backend URL (e.g. `http://34.130.163.154:8000`) |
| `ANTHROPIC_API_KEY` | Claude API key for the AI chatbot |

---

## Database Schema

### `telemetry` — BMS data points

| Column | Type | Description |
|---|---|---|
| `id` | BIGSERIAL | Primary key |
| `ts_utc` | TIMESTAMPTZ | Measurement timestamp |
| `node_id` | TEXT | Raspberry Pi / device ID |
| `bms_id` | TEXT | BMS unit identifier |
| `soc` | FLOAT | State of charge (0–100 %) |
| `pack_voltage` | FLOAT | Pack voltage (V) |
| `pack_current` | FLOAT | Pack current (A, + = charging) |
| `temp_high` | FLOAT | Highest cell temp (°C) |
| `temp_low` | FLOAT | Lowest cell temp (°C) |
| `ccl` | FLOAT | Charge current limit (A) |
| `dcl` | FLOAT | Discharge current limit (A) |
| `fault_active` | BOOL | Active fault flag |
| `faults_cleared_min` | FLOAT | Minutes since last fault clear |
| `highest_cell_v` | FLOAT | Max cell voltage (V) |
| `lowest_cell_v` | FLOAT | Min cell voltage (V) |

### `organizations`, `users`, `nodes` — Multi-tenant auth

```
organizations  ──< users     (each user belongs to one org)
organizations  ──< nodes     (each node is registered to one org)
nodes          ──  telemetry (joined by node_id for data isolation)
```

User roles: `member` · `admin` · `superadmin`

---

## API Reference

Base URL (production): `http://34.130.163.154:8000`

### Auth

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/register` | None | Create account; first user in a new org becomes admin |
| `POST` | `/auth/login` | None | Returns a JWT access token |
| `GET` | `/auth/me` | Bearer JWT | Returns current user profile |

**Register / Login body:**
```json
{ "email": "you@example.com", "password": "secret", "org_name": "Team A" }
```

**Token response:**
```json
{ "access_token": "...", "token_type": "bearer", "org_name": "Team A", "role": "admin" }
```

### Admin

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/admin/nodes` | Admin JWT | Register a node to an organization |

```json
{ "node_id": "pi_bms_1", "org_name": "Team A" }
```

Only nodes registered here will appear in `/latest` and `/telemetry`.

### Telemetry Ingestion

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/telemetry` | None | Ingest a BMS packet (devices post here) |

```json
{
  "ts_utc": "2026-03-10T18:00:00Z",
  "node_id": "pi_bms_1",
  "bms_id": "orionjr2_1",
  "soc": 82.1,
  "pack_voltage": 48.6,
  "pack_current": -3.2,
  "temp_high": 31.5,
  "temp_low": 28.0,
  "ccl": 50.0,
  "dcl": 100.0,
  "fault_active": false,
  "faults_cleared_min": 120.0,
  "highest_cell_v": 3.34,
  "lowest_cell_v": 3.30
}
```

### Data (Protected)

All routes require `Authorization: Bearer <token>`.

Regular users see only nodes belonging to their organization. `superadmin` sees all nodes across all organizations.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/latest` | Latest reading for each node in your org |
| `GET` | `/latest?node_id=pi_bms_1` | Latest reading for a specific node |
| `GET` | `/telemetry?limit=100` | Recent telemetry rows (max 1000) |
| `GET` | `/telemetry?node_id=pi_bms_1` | Filtered by node |
| `GET` | `/schema` | DB schema (used by AI chatbot) |
| `POST` | `/query` | Execute a read-only SELECT query |

---

## Frontend (Next.js on Vercel)

URL: `https://uei-cloud.vercel.app`

| Route | Description |
|---|---|
| `/` | Public landing page |
| `/login` | Login / Register (JWT stored in localStorage) |
| `/dashboard` | Live telemetry, Chart.js graphs, AI chat — requires login |

To deploy: push to `main`. Vercel auto-deploys from `web/`.

Set `API_URL` and `ANTHROPIC_API_KEY` in Vercel environment variables.

---

## Grafana

Access: `http://<VM_IP>:3000`

**Add PostgreSQL data source:**
- Host: `postgres:5432`
- Database: `uei`
- User: `uei`
- Password: from `.env`
- SSL: disabled

**Example dashboard query (SOC over time):**
```sql
SELECT ts_utc AS "time", soc
FROM telemetry
WHERE node_id = 'pi_bms_1'
ORDER BY ts_utc;
```

---

## Simulators

### `run_all.py` — All simulators at once (recommended)

Launches all 4 simulator threads concurrently so you can see the full dashboard in action.

```bash
pip install requests
python run_all.py                              # target http://localhost:8000
python run_all.py --api-url http://IP:8000     # target deployed VM
python run_all.py --period 5                   # slower cadence (5s)
```

Simulates:
- **BMS-1** (`pi_bms_1`) — mixed discharge / charge
- **BMS-2** (`bms-node-2`) — charge-cycle from low SOC → full → discharge
- **BMS-3** (`bms-node-3`) — thermal stress, overtemp faults + CCL/DCL derating
- **PV-1** (`pi_pv_1`) — solar inverter output + load channels

### `simulator.py` — Orion Jr2 BMS (standalone)

Stateful 4S LiFePO₄ model with coulomb counting, cell imbalance, and temperature-triggered fault/derate logic.

```bash
python simulator.py --hz 1 --post-url http://34.130.163.154:8000/telemetry
# Options: --node-id, --bms-id, --soc-start
```

### `bms_api_simulator.py` — Realistic drift + random faults

Sends every 2 s. ~1 % fault injection per cycle, 15 % per-cycle recovery chance.

```bash
python bms_api_simulator.py
```

### `sim_bms2.py` — Charge-cycle simulator (Node 2)

14S LiFePO₄ pack starting at low SOC (~25%) that charges to full then discharges, cycling continuously.

```bash
python sim_bms2.py --api-url http://localhost:8000
python sim_bms2.py --api-url http://IP:8000 --period 5 --soc-start 40
```

### `sim_bms3.py` — Thermal stress simulator (Node 3)

High-ambient-temp pack that creeps toward overtemperature faults (>60 °C), triggering CCL/DCL derating until the pack cools.

```bash
python sim_bms3.py --api-url http://localhost:8000
python sim_bms3.py --api-url http://IP:8000 --period 5
```

### `sim_pv_api.py` — PV system simulator

Simulates 2 inverters, 4 load channels, and 2 battery voltages. Posts to `/pv/telemetry`.

```bash
python sim_pv_api.py
```

---

## AI Chatbot

The AI assistant is integrated directly into the Next.js frontend (`web/app/api/chat/`). It uses Claude with tool-use to translate natural language questions into SQL queries, executing them read-only against the database via the `/query` API endpoint.

No separate service is needed — it runs as a Next.js API route on Vercel, using `ANTHROPIC_API_KEY` set in your Vercel environment.

Example questions the assistant can answer:
- "What is the current SOC for node pi_bms_1?"
- "Show me any faults in the last 24 hours"
- "Which node has the lowest pack voltage right now?"

---

## Common Commands

```bash
# View logs
docker compose logs -f api
docker compose logs -f postgres
docker compose logs -f grafana

# Restart a single service
docker compose restart api

# Stop everything
docker compose down

# Full rebuild
docker compose up -d --build
```

---

## Project Status

| Component | Status |
|---|---|
| Cloud API (FastAPI) | Complete |
| Multi-tenant auth (JWT, orgs, roles) | Complete |
| Telemetry ingestion | Complete |
| Next.js frontend (Vercel) | Complete |
| Grafana dashboards | Complete |
| AI chatbot (Claude) | Complete |
| BMS simulators | Complete |
| PV system support | In progress |
| Hardware (BMS / Pi) integration | Ongoing |
