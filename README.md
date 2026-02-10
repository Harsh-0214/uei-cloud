# UEI Cloud Platform (Capstone Project)

This repository contains the cloud backend for the **Unified Energy Interface (UEI)** capstone project.  
The system ingests Battery Management System (BMS) telemetry (e.g., Orion Jr2), stores it in a cloud database, and visualizes it in real time using Grafana.

---

## System Overview

### Data Flow
```
BMS / Simulator / Raspberry Pi
        ↓ (HTTP POST)
UEI Cloud API (FastAPI)
        ↓
PostgreSQL Database
        ↓
Grafana Dashboards
```

### Core Technologies
- **FastAPI** – telemetry ingestion and query API
- **PostgreSQL** – persistent telemetry storage
- **Grafana** – real-time visualization
- **Docker + docker-compose** – reproducible cloud deployment

---

## Repository Structure

```
uei-cloud/
├── api/
│   ├── cloud_api.py        # FastAPI backend
│   ├── Dockerfile
│   └── requirements.txt
├── db/
│   └── init.sql            # Database schema
├── docker-compose.yml      # Cloud stack definition
├── .env                    # Environment variables (not committed)
├── .gitignore
├── simulator.py            # Telemetry simulator
└── README.md
```

---

## Requirements

- Google Cloud Compute Engine VM (Debian or Ubuntu)
- Docker
- docker-compose (v1.29+)
- Firewall ports open:
  - `8000` – Cloud API
  - `3000` – Grafana

---

## Deployment

Clone the repository and start the cloud stack:

```bash
git clone git@github.com:Harsh-0214/uei-cloud.git
cd uei-cloud
docker-compose up -d --build
```

Verify containers are running:

```bash
docker ps
```

Expected containers:
- `uei-postgres`
- `uei-cloud-api`
- `uei-grafana`

---

## Cloud API

### POST Telemetry
```
POST /telemetry
```

Example payload:
```json
{
  "ts_utc": "2026-02-10T21:30:00Z",
  "node_id": "bms-node-1",
  "bms_id": "OrionJr2_001",
  "soc": 78.5,
  "pack_voltage": 13.1,
  "pack_current": -8.2,
  "temp_high": 34.2,
  "temp_low": 29.5,
  "ccl": 25,
  "dcl": 60,
  "fault_active": false,
  "faults_cleared_min": 42,
  "highest_cell_v": 3.34,
  "lowest_cell_v": 3.30
}
```

### GET Latest Telemetry
```
GET /latest
GET /latest?node_id=bms-node-1
```

---

## Simulator (Testing & Demo)

The simulator generates Orion Jr2–style telemetry for testing and demonstrations.

### Install dependency
```bash
sudo apt-get install -y python3-requests
```

### Run simulator and send data to API
```bash
python3 simulator.py --hz 1 --post-url http://localhost:8000/telemetry
```

### Verify ingestion
```bash
curl http://localhost:8000/latest
```

---

## Grafana

Access Grafana in a browser:
```
http://<VM_EXTERNAL_IP>:3000
```

Default credentials:
- **Username:** `admin`
- **Password:** `admin`

### PostgreSQL Data Source Settings
- Host: `postgres:5432`
- Database: `uei`
- User: `uei`
- Password: `uei_password`
- SSL: disabled

### Example Dashboard Query (SOC)
```sql
SELECT
  ts_utc AS "time",
  soc
FROM telemetry
WHERE node_id = 'bms-node-1'
ORDER BY ts_utc;
```

---

## Common Commands

View logs:
```bash
docker-compose logs -f api
docker-compose logs -f postgres
docker-compose logs -f grafana
```

Restart services:
```bash
docker-compose restart
```

Stop stack:
```bash
docker-compose down
```

---

## Design Rationale (Capstone)

- Docker provides reproducibility, isolation, and rapid recovery
- Single-VM architecture chosen for simplicity and cost efficiency
- PostgreSQL selected for reliability and structured telemetry storage
- Architecture is compatible with TimescaleDB for future scaling

---

## Recovery Procedure

If the VM or files are lost:

```bash
git clone git@github.com:Harsh-0214/uei-cloud.git
cd uei-cloud
docker-compose up -d --build
```

The full cloud stack is restored in minutes.

---

## Project Status

- Cloud backend: **Complete**
- Telemetry ingestion: **Complete**
- Visualization: **In progress**
- Hardware (BMS / Pi) integration: **Ongoing**
