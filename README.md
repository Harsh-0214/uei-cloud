# UEI Cloud Platform

**Unified Energy Interface** — a cloud-hosted Battery Management System (BMS) and PV monitoring platform built as a fourth-year capstone project.

Ingests telemetry from BMS hardware (Orion Jr2) and PV/solar systems, stores it in PostgreSQL, serves it through a multi-tenant REST API, and visualizes it in a Next.js dashboard with live SSE streaming, edge algorithm outputs, carbon emissions tracking, and an AI-powered natural language assistant.

Live: **https://uei-cloud.vercel.app**

---

## Architecture

```
BMS Raspberry Pi (Orion Jr2)          PV Raspberry Pi (CSV reader)
  POST /telemetry (no auth)             pv_live_line_to_postgres_every3s.py
         │                                        │ (direct DB write)
         ▼                                        ▼
  FastAPI Cloud API (:8000)  ──────  PostgreSQL (Docker)
         │
         └── Next.js Frontend (Vercel)
                  ├── /              Landing page
                  ├── /login         Login / Register
                  ├── /overview      Live node cards + recent logs
                  ├── /dashboard     Full telemetry + algorithms + carbon
                  ├── /nodes         Add / remove nodes
                  ├── /logs          Full log history + JSON export
                  └── /users         User management
```

### Stack

| Layer | Technology |
|---|---|
| Cloud API | FastAPI 0.115, Python 3.11, Uvicorn |
| Database | PostgreSQL 16 (Docker) |
| Frontend | Next.js 15 (App Router), TypeScript |
| Hosting | Vercel (frontend) · Docker Compose on GCP VM (backend) |
| AI Assistant | Claude (`claude-sonnet-4-6`) via Anthropic SDK |
| Auth | JWT (HS256, 8 h expiry) · bcrypt password hashing |
| Algorithms | CAC, RDA, RHF (edge + cloud) |
| Carbon | CarbonCalculator — CO₂ emitted/avoided per interval |

---

## Repository Structure

```
uei-cloud/
├── api/
│   ├── cloud_api.py          # FastAPI application — auth, telemetry, algorithms, carbon, PV
│   ├── seed.py               # Creates superadmin account (org: Capstone)
│   ├── algorithms/
│   │   ├── cac.py            # Context-Aware Adaptive Control
│   │   ├── rda.py            # Risk-Indexed Derating Algorithm
│   │   ├── rhf.py            # Rolling Health Forecast
│   │   └── carbon.py         # Carbon Emissions Calculator
│   ├── Dockerfile
│   └── requirements.txt
│
├── db/
│   ├── init.sql              # Base schema (runs on first docker-compose up)
│   ├── migrate_auth.sql      # Adds auth tables to existing DB
│   ├── migrate_algo.sql      # Adds algo_events, soh_forecast, node_config tables
│   ├── migrate_carbon.sql    # Adds carbon_config, carbon_events tables
│   └── migrate_pv.sql        # Adds pv_telemetry table
│
├── web/                      # Next.js frontend (deployed to Vercel)
│   └── app/
│       ├── overview/         # Post-login landing — live node cards + logs
│       ├── dashboard/        # Full dashboard — telemetry, charts, algorithms, carbon
│       ├── nodes/            # Add/remove registered nodes
│       ├── logs/             # Log history, range filter, JSON export
│       ├── users/            # User management
│       └── api/              # Next.js proxy routes → FastAPI
│
├── pi_bms_client.py          # Pi client for real BMS (Orion Jr2 via CAN/serial)
├── pi_pv_client.py           # Pi client for PV system (CSV reader, no Modbus)
├── pi_setup.sh               # One-shot Pi setup script (systemd service)
├── run_all.py                # All-in-one simulator (3 BMS + 3 PV nodes + carbon)
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

# Create superadmin account
docker exec uei-cloud-api-1 python seed.py
```

### Run all migrations (required on existing deployments)

```bash
docker exec -i uei-postgres psql -U uei -d uei < db/migrate_auth.sql
docker exec -i uei-postgres psql -U uei -d uei < db/migrate_algo.sql
docker exec -i uei-postgres psql -U uei -d uei < db/migrate_carbon.sql
docker exec -i uei-postgres psql -U uei -d uei < db/migrate_pv.sql
docker compose restart api
```

### Updating an existing deployment

```bash
git pull
docker compose build api
docker compose up -d api
```

---

## Environment Variables

| Variable | Description |
|---|---|
| `POSTGRES_DB` | Database name (default: `uei`) |
| `POSTGRES_USER` | DB user (default: `uei`) |
| `POSTGRES_PASSWORD` | DB password |
| `SECRET_KEY` | JWT signing secret — **change in production** |
| `ANTHROPIC_API_KEY` | Claude API key (AI chatbot + carbon config) |

**Vercel** — set `API_URL` to `http://<VM_IP>:8000` in project settings.

---

## Database Schema

### `telemetry` — BMS data points
Written by `POST /telemetry` (Pi clients / simulators).

| Column | Type | Description |
|---|---|---|
| `node_id` | TEXT | Raspberry Pi / device ID |
| `bms_id` | TEXT | BMS unit identifier |
| `soc` | FLOAT | State of charge (0–100 %) |
| `pack_voltage` | FLOAT | Pack voltage (V) |
| `pack_current` | FLOAT | Pack current (A, + = charging) |
| `temp_high / low` | FLOAT | Cell temperatures (°C) |
| `ccl / dcl` | FLOAT | Charge / discharge current limits (A) |
| `fault_active` | BOOL | Active fault flag |
| `highest_cell_v / lowest_cell_v` | FLOAT | Min/max cell voltages (V) |

### `pv_telemetry` — Solar / PV data points
Written directly to PostgreSQL by `pv_live_line_to_postgres_every3s.py` on the PV Pi.

| Column | Type | Description |
|---|---|---|
| `node_id` | TEXT | PV system node ID |
| `pv_id` | TEXT | PV unit identifier |
| `invr1 / invr2` | FLOAT | Inverter currents (A) |
| `ld1–ld4` | FLOAT | Load channel currents (A) |
| `bv1 / bv2` | FLOAT | Battery voltages (V) |

### `algo_events` — Edge algorithm outputs (CAC / RDA)
Written by Pi clients after each telemetry packet. `output` is JSONB.

### `soh_forecast` — RHF battery health forecasts
Written by `rhf_job.py`. Contains `current_soh`, `forecast_30d/60d/90d`.

### `carbon_events` — Carbon emissions per interval
Written by Pi clients / `run_all.py` via `POST /carbon`.

### `organizations`, `users`, `nodes` — Multi-tenant auth
```
organizations  ──< users     (each user belongs to one org)
organizations  ──< nodes     (each node is registered to one org)
```
User roles: `member` · `admin` · `superadmin`

---

## API Reference

Base URL: `http://34.130.163.154:8000`  |  Docs: `/docs`

### Auth
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/auth/register` | Create account |
| `POST` | `/auth/login` | Returns JWT access token |
| `GET` | `/auth/me` | Current user profile |

### Telemetry
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/telemetry` | None | Ingest BMS packet |
| `POST` | `/pv/telemetry` | None | Ingest PV packet |
| `GET` | `/stream/latest` | None | SSE — live telemetry for all nodes (1 s) |
| `GET` | `/latest` | JWT | Latest BMS reading per node |
| `GET` | `/pv/latest` | JWT | Latest PV reading per node |
| `GET` | `/logs` | JWT | BMS log history (supports `range`, `node_id`, `limit`) |
| `GET` | `/pv/telemetry` | JWT | PV history |
| `GET` | `/telemetry/nodes` | None | All distinct node_ids ever seen |

### Algorithms
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/algo` | None | Ingest CAC/RDA output from Pi |
| `GET` | `/algo/latest` | JWT | Latest algo output per node/algo |
| `GET` | `/forecast` | JWT | Latest RHF SoH forecast |
| `POST` | `/algo/rhf/run` | Admin JWT | Trigger RHF job |

### Carbon
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/carbon` | None | Ingest carbon event from Pi |
| `GET` | `/carbon/summary` | JWT | Aggregated emissions stats |
| `GET` | `/carbon/config/{node_id}` | None | Node carbon intensity config |
| `PATCH` | `/carbon/config/{node_id}` | Admin JWT | Update carbon intensity |

### Admin
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/admin/nodes` | Admin JWT | List all registered nodes |
| `POST` | `/admin/nodes` | Admin JWT | Register a node to an org |
| `DELETE` | `/admin/nodes/{node_id}` | Admin JWT | Remove a node |
| `GET` | `/admin/users` | Admin JWT | List users in org |

---

## Frontend Pages

| Route | Description |
|---|---|
| `/` | Public landing page |
| `/login` | Login / Register |
| `/overview` | Live node cards, summary stats, recent logs — main post-login page |
| `/dashboard` | Full dashboard: live metrics, Chart.js history, CAC/RDA/RHF outputs, carbon emissions |
| `/nodes` | Register / remove nodes; view by org |
| `/logs` | Full log history with range filter, node filter, PDF + JSON export |
| `/users` | User management |

---

## Raspberry Pi Setup

Four Pis are deployed in the lab:

| Pi | Role | Script |
|---|---|---|
| `pi_bms_real` | Real BMS (Orion Jr2) | `pi_setup.sh --type bms --mode real` |
| `pi_pv_real` | Real PV system (CSV reader) | `pi_setup.sh --type pv --mode real --csv-path /path/to/pv.csv` |
| `pi_bms_sim` | BMS simulator | `pi_setup.sh --type bms --mode sim` |
| `pi_pv_sim` | PV simulator | `pi_setup.sh --type pv --mode sim` |

`pi_setup.sh` installs dependencies and creates a `systemd` service that auto-restarts on reboot.

---

## Simulator

`run_all.py` runs 3 BMS + 3 PV simulator threads, posting telemetry, algorithm outputs (CAC/RDA), and carbon events every 2 s.

```bash
pip install requests
python run_all.py --api-url http://34.130.163.154:8000
```

---

## Common Commands

```bash
# View logs
docker compose logs -f api
docker compose logs -f postgres

# Restart API
docker compose restart api

# Inspect database
docker exec -it uei-postgres psql -U uei -d uei
\dt                          # list tables
SELECT COUNT(*) FROM telemetry;
SELECT COUNT(*) FROM carbon_events;
SELECT DISTINCT node_id FROM telemetry;

# Full rebuild
docker compose up -d --build
```

---

## Project Status

| Component | Status |
|---|---|
| Cloud API (FastAPI) | Complete |
| Multi-tenant auth (JWT, orgs, roles) | Complete |
| BMS telemetry ingestion + live SSE | Complete |
| PV telemetry (direct DB write) | Complete |
| Next.js frontend (Vercel) | Complete |
| Overview page (live node cards) | Complete |
| Nodes management page | Complete |
| Logs page (range/node filter, export) | Complete |
| Edge algorithms (CAC, RDA, RHF) | Complete |
| Carbon Emissions Calculator | Complete |
| AI chatbot (Claude, natural language → SQL) | Complete |
| BMS + PV simulators (`run_all.py`) | Complete |
| Hardware (BMS / Pi) integration | Ongoing |
