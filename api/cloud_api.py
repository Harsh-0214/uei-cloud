from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional, Any
import asyncio
import json
import os
import re
import bcrypt
import psycopg2
from psycopg2.extras import RealDictCursor
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from jose import JWTError, jwt
from passlib.context import CryptContext

app = FastAPI(title="UEI Cloud API", version="2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://uei-cloud.vercel.app", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Config ──────────────────────────────────────────────────────────────────

DB_HOST = os.environ.get("DB_HOST", "postgres")
DB_PORT = int(os.environ.get("DB_PORT", "5432"))
DB_NAME = os.environ.get("DB_NAME", "uei")
DB_USER = os.environ.get("DB_USER", "uei")
DB_PASS = os.environ.get("DB_PASS", "uei_password")

SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret-key-CHANGE-IN-PRODUCTION")
ALGORITHM  = "HS256"
TOKEN_EXPIRE_HOURS = 8

# ── DB ───────────────────────────────────────────────────────────────────────

def db_conn():
    return psycopg2.connect(
        host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASS
    )

# ── Auth utilities ───────────────────────────────────────────────────────────

pwd_ctx  = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer   = HTTPBearer(auto_error=False)

def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

def verify_password(plain, hashed):
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))

def create_access_token(user_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=TOKEN_EXPIRE_HOURS)
    return jwt.encode({"sub": str(user_id), "exp": expire}, SECRET_KEY, algorithm=ALGORITHM)

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(bearer)) -> dict:
    """Validate Bearer JWT and return the user row (with org_name)."""
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    try:
        payload  = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        user_id  = payload.get("sub")
        if user_id is None:
            raise ValueError
    except (JWTError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT u.id, u.email, u.role, u.organization_id,
                       o.name AS org_name
                FROM users u
                JOIN organizations o ON u.organization_id = o.id
                WHERE u.id = %s
                """,
                (int(user_id),),
            )
            user = cur.fetchone()

    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return dict(user)

def require_admin(current_user: dict = Depends(get_current_user)) -> dict:
    if current_user.get("role") not in ("admin", "superadmin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return current_user

# ── Auth request/response models ─────────────────────────────────────────────

class RegisterRequest(BaseModel):
    email:    str
    password: str
    org_name: str   # Creates the org if it doesn't exist; joins it if it does

class LoginRequest(BaseModel):
    email:    str
    password: str

class NodeRegisterRequest(BaseModel):
    node_id:  str
    org_name: str   # Org the node belongs to (must already exist)

# ── Auth routes ──────────────────────────────────────────────────────────────

@app.post("/auth/register", status_code=201)
def register(req: RegisterRequest):
    """
    Create a user account.
    - If org_name doesn't exist, it's created and the user becomes its admin.
    - If org_name already exists, the user joins it as a member.
    """
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Check email uniqueness
            cur.execute("SELECT id FROM users WHERE email = %s", (req.email,))
            if cur.fetchone():
                raise HTTPException(status_code=409, detail="Email already registered")

            # Get or create org
            cur.execute("SELECT id FROM organizations WHERE name = %s", (req.org_name,))
            org = cur.fetchone()
            if org:
                org_id = org["id"]
                role   = "member"
            else:
                cur.execute(
                    "INSERT INTO organizations (name) VALUES (%s) RETURNING id",
                    (req.org_name,),
                )
                org_id = cur.fetchone()["id"]
                role   = "admin"   # First user in a new org is admin

            hashed = hash_password(req.password)
            cur.execute(
                """
                INSERT INTO users (email, hashed_password, organization_id, role)
                VALUES (%s, %s, %s, %s) RETURNING id
                """,
                (req.email, hashed, org_id, role),
            )
            user_id = cur.fetchone()["id"]

    token = create_access_token(user_id)
    return {"access_token": token, "token_type": "bearer", "org_name": req.org_name, "role": role}


@app.post("/auth/login")
def login(req: LoginRequest):
    """Return a JWT access token for valid credentials."""
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT u.id, u.hashed_password, u.role, o.name AS org_name
                FROM users u
                JOIN organizations o ON u.organization_id = o.id
                WHERE u.email = %s
                """,
                (req.email,),
            )
            user = cur.fetchone()

    if not user or not verify_password(req.password, user["hashed_password"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    token = create_access_token(user["id"])
    return {
        "access_token": token,
        "token_type":   "bearer",
        "org_name":     user["org_name"],
        "role":         user["role"],
    }


@app.get("/auth/me")
def me(current_user: dict = Depends(get_current_user)):
    """Return the authenticated user's profile."""
    return {
        "id":              current_user["id"],
        "email":           current_user["email"],
        "role":            current_user["role"],
        "organization_id": current_user["organization_id"],
        "org_name":        current_user["org_name"],
    }

# ── Admin routes ─────────────────────────────────────────────────────────────

@app.get("/admin/users")
def list_users(current_user: dict = Depends(get_current_user)) -> Any:
    """Return all users with their org name. Any authenticated user can view."""
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT u.id, u.email, u.role, o.name AS org_name, u.organization_id
                FROM users u
                JOIN organizations o ON u.organization_id = o.id
                ORDER BY o.name, u.email
                """
            )
            rows = cur.fetchall()
    return [dict(r) for r in rows]


@app.post("/admin/nodes", status_code=201)
def register_node(req: NodeRegisterRequest, _admin: dict = Depends(require_admin)):
    """
    Register a node_id as belonging to an organization.
    The org must already exist. Only admins may call this.
    """
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT id FROM organizations WHERE name = %s", (req.org_name,))
            org = cur.fetchone()
            if not org:
                raise HTTPException(status_code=404, detail=f"Organization '{req.org_name}' not found")
            try:
                cur.execute(
                    "INSERT INTO nodes (node_id, organization_id) VALUES (%s, %s) RETURNING id",
                    (req.node_id, org["id"]),
                )
            except psycopg2.errors.UniqueViolation:
                raise HTTPException(status_code=409, detail=f"node_id '{req.node_id}' is already registered")

    return {"status": "ok", "node_id": req.node_id, "org_name": req.org_name}


@app.get("/admin/nodes")
def list_nodes(_admin: dict = Depends(require_admin)):
    """Return all registered nodes with their org name. Admin only."""
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT n.node_id, o.name AS org_name
                FROM nodes n
                JOIN organizations o ON n.organization_id = o.id
                ORDER BY o.name, n.node_id
                """
            )
            rows = cur.fetchall()
    return [dict(r) for r in rows]


@app.delete("/admin/nodes/{node_id}", status_code=200)
def delete_node(node_id: str, _admin: dict = Depends(require_admin)):
    """Remove a node. Admin only."""
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM nodes WHERE node_id = %s RETURNING node_id", (node_id,))
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail=f"Node '{node_id}' not found")
    return {"status": "ok", "node_id": node_id}


# ── Telemetry ingestion (NO auth — BMS devices post here) ────────────────────

class TelemetryPacket(BaseModel):
    ts_utc:             str
    node_id:            str
    bms_id:             str
    soc:                float = Field(ge=0.0, le=100.0)
    pack_voltage:       float
    pack_current:       float
    temp_high:          float
    temp_low:           float
    ccl:                float
    dcl:                float
    fault_active:       bool
    faults_cleared_min: float
    highest_cell_v:     float
    lowest_cell_v:      float


@app.post("/telemetry")
def ingest(pkt: TelemetryPacket):
    """Ingest a telemetry packet from a BMS device. No authentication required."""
    try:
        ts = datetime.fromisoformat(pkt.ts_utc.replace("Z", "+00:00"))
    except Exception:
        raise HTTPException(status_code=422, detail="ts_utc must be ISO8601")

    q = """
    INSERT INTO telemetry (
      ts_utc, node_id, bms_id, soc, pack_voltage, pack_current, temp_high, temp_low,
      ccl, dcl, fault_active, faults_cleared_min, highest_cell_v, lowest_cell_v
    ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s);
    """
    vals = (
        ts, pkt.node_id, pkt.bms_id, pkt.soc, pkt.pack_voltage, pkt.pack_current,
        pkt.temp_high, pkt.temp_low, pkt.ccl, pkt.dcl, pkt.fault_active,
        pkt.faults_cleared_min, pkt.highest_cell_v, pkt.lowest_cell_v,
    )

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(q, vals)

    return {"status": "ok", "node_id": pkt.node_id}


# ── PV Telemetry (NO auth — PV devices post here) ────────────────────────────

class PvPacket(BaseModel):
    ts_utc:  str
    node_id: str
    pv_id:   str
    invr1:   float = 0.0
    invr2:   float = 0.0
    ld1:     float = 0.0
    ld2:     float = 0.0
    ld3:     float = 0.0
    ld4:     float = 0.0
    bv1:     float = 0.0
    bv2:     float = 0.0


@app.post("/pv/telemetry")
def ingest_pv(pkt: PvPacket):
    """Ingest a PV telemetry packet. No authentication required."""
    try:
        ts = datetime.fromisoformat(pkt.ts_utc.replace("Z", "+00:00"))
    except Exception:
        raise HTTPException(status_code=422, detail="ts_utc must be ISO8601")

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO pv_telemetry
                  (ts_utc, node_id, pv_id, invr1, invr2, ld1, ld2, ld3, ld4, bv1, bv2)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (ts, pkt.node_id, pkt.pv_id,
                 pkt.invr1, pkt.invr2,
                 pkt.ld1, pkt.ld2, pkt.ld3, pkt.ld4,
                 pkt.bv1, pkt.bv2),
            )
    return {"status": "ok", "node_id": pkt.node_id}


@app.get("/pv/latest")
def pv_latest(node_id: Optional[str] = None) -> Any:
    """Return the most recent PV reading per node (or for one node)."""
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if node_id:
                cur.execute(
                    "SELECT * FROM pv_telemetry WHERE node_id = %s ORDER BY ts_utc DESC LIMIT 1",
                    (node_id,),
                )
            else:
                cur.execute(
                    """
                    SELECT DISTINCT ON (node_id) *
                    FROM pv_telemetry
                    ORDER BY node_id, ts_utc DESC
                    """
                )
            rows = cur.fetchall()
    return [dict(r) for r in rows]


@app.get("/pv/telemetry")
def pv_history(
    node_id: Optional[str] = None,
    range:   str = "1h",
    limit:   int = 500,
) -> Any:
    """Return historical PV telemetry rows filtered by time range."""
    limit = min(limit, 5000)
    if range == "all":
        if node_id:
            q      = "SELECT * FROM pv_telemetry WHERE node_id = %s ORDER BY ts_utc DESC LIMIT %s"
            params: tuple = (node_id, limit)
        else:
            q      = "SELECT * FROM pv_telemetry ORDER BY ts_utc DESC LIMIT %s"
            params = (limit,)
    else:
        interval = RANGE_MAP.get(range, "1 hour")
        if node_id:
            q = """
                SELECT * FROM pv_telemetry
                WHERE node_id = %s
                  AND ts_utc >= NOW() AT TIME ZONE 'UTC' - INTERVAL %s
                ORDER BY ts_utc DESC LIMIT %s
            """
            params = (node_id, interval, limit)
        else:
            q = """
                SELECT * FROM pv_telemetry
                WHERE ts_utc >= NOW() AT TIME ZONE 'UTC' - INTERVAL %s
                ORDER BY ts_utc DESC LIMIT %s
            """
            params = (interval, limit)

    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(q, params)
            rows = cur.fetchall()
    return [dict(r) for r in rows]


# ── Protected data routes ────────────────────────────────────────────────────

RANGE_MAP = {
    "5m":  "5 minutes",
    "15m": "15 minutes",
    "30m": "30 minutes",
    "1h":  "1 hour",
    "6h":  "6 hours",
    "24h": "24 hours",
    "7d":  "7 days",
    "30d": "30 days",
}

@app.get("/metrics")
def metrics(node_id: str, metric: str, range: str = "1h") -> Any:
    """
    Return time-series data for a single node used by the dashboard charts.
    metric: soc | pack_voltage | temperature
    range:  5m | 15m | 30m | 1h | 6h | 24h
    """
    interval = RANGE_MAP.get(range, "1 hour")

    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if metric == "temperature":
                cur.execute(
                    """
                    SELECT ts_utc AS time, temp_high AS high, temp_low AS low
                    FROM telemetry
                    WHERE node_id = %s
                      AND ts_utc >= NOW() AT TIME ZONE 'UTC' - INTERVAL %s
                    ORDER BY ts_utc ASC
                    """,
                    (node_id, interval),
                )
            elif metric in ("soc", "pack_voltage"):
                col = "soc" if metric == "soc" else "pack_voltage"
                cur.execute(
                    f"""
                    SELECT ts_utc AS time, {col} AS value
                    FROM telemetry
                    WHERE node_id = %s
                      AND ts_utc >= NOW() AT TIME ZONE 'UTC' - INTERVAL %s
                    ORDER BY ts_utc ASC
                    """,
                    (node_id, interval),
                )
            else:
                raise HTTPException(status_code=400, detail=f"Unknown metric '{metric}'")

            rows = cur.fetchall()

    return [dict(r) for r in rows]


@app.get("/latest")
def latest(node_id: Optional[str] = None) -> Any:
    """Return the most recent telemetry row(s) for all nodes."""
    if node_id:
        q      = "SELECT * FROM telemetry WHERE node_id = %s ORDER BY ts_utc DESC LIMIT 1;"
        params = (node_id,)
    else:
        q      = "SELECT DISTINCT ON (node_id) * FROM telemetry ORDER BY node_id, ts_utc DESC;"
        params = None

    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(q, params) if params else cur.execute(q)
            rows = cur.fetchall()

    if node_id and not rows:
        raise HTTPException(status_code=404, detail="node_id not found")
    return rows[0] if node_id else rows


@app.get("/telemetry/nodes")
def telemetry_nodes() -> Any:
    """Return all distinct node_ids that have ever posted telemetry."""
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT DISTINCT node_id FROM telemetry ORDER BY node_id")
            rows = cur.fetchall()
    return [r[0] for r in rows]


@app.get("/logs")
def logs(node_id: Optional[str] = None, range: str = "1h", limit: int = 500) -> Any:
    """Return structured telemetry log rows filtered by time range. Used by the Logs page."""
    limit = min(limit, 5000)

    # "all" means no time filter
    if range == "all":
        if node_id:
            q = "SELECT * FROM telemetry WHERE node_id = %s ORDER BY ts_utc DESC LIMIT %s"
            params: tuple = (node_id, limit)
        else:
            q = "SELECT * FROM telemetry ORDER BY ts_utc DESC LIMIT %s"
            params = (limit,)
    else:
        interval = RANGE_MAP.get(range, "1 hour")
        if node_id:
            q = """
                SELECT * FROM telemetry
                WHERE node_id = %s
                  AND ts_utc >= NOW() AT TIME ZONE 'UTC' - INTERVAL %s
                ORDER BY ts_utc DESC LIMIT %s
            """
            params = (node_id, interval, limit)
        else:
            q = """
                SELECT * FROM telemetry
                WHERE ts_utc >= NOW() AT TIME ZONE 'UTC' - INTERVAL %s
                ORDER BY ts_utc DESC LIMIT %s
            """
            params = (interval, limit)

    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(q, params)
            rows = cur.fetchall()

    return [dict(r) for r in rows]


@app.get("/telemetry")
def list_telemetry(node_id: Optional[str] = None, limit: int = 100) -> Any:
    """Return recent telemetry rows for all nodes. Optional node_id filter. Max 1000 rows."""
    limit = min(limit, 1000)
    if node_id:
        q      = "SELECT * FROM telemetry WHERE node_id = %s ORDER BY ts_utc DESC LIMIT %s;"
        params = (node_id, limit)
    else:
        q      = "SELECT * FROM telemetry ORDER BY ts_utc DESC LIMIT %s;"
        params = (limit,)

    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(q, params)
            rows = cur.fetchall()

    return [dict(r) for r in rows]


@app.get("/schema")
def schema() -> Any:
    """Return DB schema (used by the AI chatbot)."""
    q = """
    SELECT t.table_name, c.column_name, c.data_type, c.is_nullable
    FROM information_schema.tables t
    JOIN information_schema.columns c
        ON t.table_name   = c.table_name
       AND t.table_schema = c.table_schema
    WHERE t.table_schema = 'public'
      AND t.table_type   = 'BASE TABLE'
    ORDER BY t.table_name, c.ordinal_position
    """
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(q)
            rows = cur.fetchall()

    tables: dict[str, list[str]] = {}
    for table, col, dtype, nullable in rows:
        note = "  -- nullable" if nullable == "YES" else ""
        tables.setdefault(table, []).append(f"  {col}  {dtype}{note}")

    lines = ["PostgreSQL database schema (read-only):"]
    for table, cols in tables.items():
        lines.append(f"\nTable: {table}")
        lines.extend(cols)
    return "\n".join(lines)


_BLOCKED = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|GRANT|REVOKE|EXEC|EXECUTE|COPY)\b",
    re.IGNORECASE,
)


class QueryRequest(BaseModel):
    sql: str


@app.post("/query")
def query(req: QueryRequest) -> Any:
    """Execute a read-only SELECT query (used by the AI chatbot)."""
    stripped = req.sql.strip()

    if not re.match(r"^\s*SELECT\b", stripped, re.IGNORECASE):
        raise HTTPException(status_code=400, detail="Only SELECT queries are permitted.")
    if _BLOCKED.search(stripped):
        raise HTTPException(status_code=400, detail="Query contains a forbidden keyword.")
    if ";" in stripped.rstrip(";"):
        raise HTTPException(status_code=400, detail="Multi-statement queries are not allowed.")

    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(stripped)
            rows = cur.fetchmany(200)

    return [dict(r) for r in rows]


# ── Node config — operational profiles (CAC fallback source) ─────────────────

class NodeConfigUpdate(BaseModel):
    max_charge_current:    Optional[float] = None
    max_discharge_current: Optional[float] = None
    temp_warn_threshold:   Optional[float] = None
    temp_fault_threshold:  Optional[float] = None
    soc_high_threshold:    Optional[float] = None
    soc_low_threshold:     Optional[float] = None


@app.get("/config/{node_id}")
def get_node_config(node_id: str) -> Any:
    """
    Return the operational profile for a node.
    No auth required — Pi devices call this to populate the CAC cache.
    Returns built-in defaults if no custom config exists for this node.
    """
    defaults = {
        "node_id": node_id,
        "max_charge_current":    80.0,
        "max_discharge_current": 120.0,
        "temp_warn_threshold":   45.0,
        "temp_fault_threshold":  60.0,
        "soc_high_threshold":    90.0,
        "soc_low_threshold":     20.0,
    }
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM node_config WHERE node_id = %s", (node_id,))
            row = cur.fetchone()
    if row:
        return dict(row)
    return defaults


@app.patch("/config/{node_id}", status_code=200)
def update_node_config(
    node_id: str,
    req: NodeConfigUpdate,
    _admin: dict = Depends(require_admin),
) -> Any:
    """Update the operational profile for a node. Admin only."""
    fields = {k: v for k, v in req.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")

    set_clause = ", ".join(f"{k} = %({k})s" for k in fields)
    fields["node_id"] = node_id
    fields["updated_at"] = datetime.now(timezone.utc)

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                INSERT INTO node_config (node_id, {", ".join(k for k in fields if k not in ("node_id", "updated_at"))})
                VALUES (%(node_id)s, {", ".join(f"%({k})s" for k in fields if k not in ("node_id", "updated_at"))})
                ON CONFLICT (node_id) DO UPDATE SET {set_clause}, updated_at = %(updated_at)s
                """,
                fields,
            )
    return {"status": "ok", "node_id": node_id, "updated": list(req.model_dump(exclude_none=True).keys())}


# ── Algorithm events — edge algorithm outputs (CAC / RDA) ────────────────────

class AlgoEventPacket(BaseModel):
    ts_utc:  str
    node_id: str
    algo:    str   # 'CAC' | 'RDA'
    output:  dict  # algorithm-specific payload


@app.post("/algo")
def ingest_algo_event(pkt: AlgoEventPacket) -> Any:
    """
    Ingest a CAC or RDA algorithm output from an edge Pi device.
    No authentication required — same pattern as /telemetry.
    """
    try:
        ts = datetime.fromisoformat(pkt.ts_utc.replace("Z", "+00:00"))
    except Exception:
        raise HTTPException(status_code=422, detail="ts_utc must be ISO8601")

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO algo_events (ts_utc, node_id, algo, output) VALUES (%s, %s, %s, %s::jsonb)",
                (ts, pkt.node_id, pkt.algo.upper(), json.dumps(pkt.output)),
            )
    return {"status": "ok", "node_id": pkt.node_id, "algo": pkt.algo}


@app.get("/algo/latest")
def algo_latest(
    node_id: Optional[str] = None,
    algo: Optional[str]    = None,
    _user: dict            = Depends(get_current_user),
) -> Any:
    """
    Return the most recent algorithm event per (node_id, algo) combination.
    Optionally filter by node_id and/or algo name. Requires authentication.
    """
    where_parts = []
    params: list = []
    if node_id:
        where_parts.append("node_id = %s")
        params.append(node_id)
    if algo:
        where_parts.append("algo = %s")
        params.append(algo.upper())

    where = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""

    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                f"""
                SELECT DISTINCT ON (node_id, algo) *
                FROM algo_events
                {where}
                ORDER BY node_id, algo, ts_utc DESC
                """,
                params,
            )
            rows = cur.fetchall()

    return [dict(r) for r in rows]


# ── SoH forecasts — RHF outputs ───────────────────────────────────────────────

@app.get("/forecast")
def get_forecast(
    node_id: Optional[str] = None,
    _user: dict            = Depends(get_current_user),
) -> Any:
    """
    Return the latest RHF SoH forecast for all nodes (or a specific node).
    Forecasts are written by rhf_job.py.
    """
    if node_id:
        q      = "SELECT * FROM soh_forecast WHERE node_id = %s ORDER BY computed_at DESC LIMIT 1"
        params = (node_id,)
    else:
        q      = "SELECT DISTINCT ON (node_id) * FROM soh_forecast ORDER BY node_id, computed_at DESC"
        params = None

    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(q, params) if params else cur.execute(q)
            rows = cur.fetchall()

    if node_id and not rows:
        raise HTTPException(status_code=404, detail="No forecast found for this node")
    return rows[0] if node_id else [dict(r) for r in rows]


@app.post("/algo/rhf/run", status_code=202)
def trigger_rhf(days: int = 30, _admin: dict = Depends(require_admin)) -> Any:
    """
    Trigger the RHF job synchronously for all active nodes (admin only).
    For large datasets prefer running rhf_job.py directly via docker exec.
    """
    import subprocess
    result = subprocess.run(
        ["python", "rhf_job.py", "--days", str(days)],
        capture_output=True, text=True, timeout=120,
    )
    return {
        "status": "ok" if result.returncode == 0 else "error",
        "stdout": result.stdout[-4000:],
        "stderr": result.stderr[-2000:],
    }


# ── Carbon Emissions Calculator endpoints ─────────────────────────────────────

class CarbonEventPacket(BaseModel):
    ts_utc:           str
    node_id:          str
    interval_s:       float = 2.0
    power_kw:         float = 0.0
    grid_import_kw:   float = 0.0
    solar_gen_kw:     float = 0.0
    co2_g:            float = 0.0
    co2_avoided_g:    float = 0.0
    carbon_intensity: float = 400.0


@app.post("/carbon")
def ingest_carbon(pkt: CarbonEventPacket) -> Any:
    """
    Ingest a carbon emissions event from an edge Pi device.
    No authentication required — same pattern as POST /telemetry.
    """
    try:
        ts = datetime.fromisoformat(pkt.ts_utc.replace("Z", "+00:00"))
    except Exception:
        raise HTTPException(status_code=422, detail="ts_utc must be ISO8601")

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO carbon_events
                  (ts_utc, node_id, interval_s, power_kw, grid_import_kw,
                   solar_gen_kw, co2_g, co2_avoided_g, carbon_intensity)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (ts, pkt.node_id, pkt.interval_s, pkt.power_kw, pkt.grid_import_kw,
                 pkt.solar_gen_kw, pkt.co2_g, pkt.co2_avoided_g, pkt.carbon_intensity),
            )
    return {"status": "ok", "node_id": pkt.node_id}


@app.get("/carbon/summary")
def carbon_summary(
    node_id: Optional[str] = None,
    range:   str           = "1h",
    _user:   dict          = Depends(get_current_user),
) -> Any:
    """
    Return aggregated carbon emissions stats for a time range.
    Optionally filtered to a single node.
    """
    interval = RANGE_MAP.get(range, "1 hour")

    if node_id:
        q = """
            SELECT
              COUNT(*)                          AS data_points,
              COALESCE(SUM(co2_g),          0)  AS total_co2_g,
              COALESCE(SUM(co2_avoided_g),  0)  AS total_co2_avoided_g,
              COALESCE(SUM(co2_avoided_g - co2_g), 0) AS net_co2_saved_g,
              COALESCE(SUM(grid_import_kw * interval_s / 3600), 0) AS total_grid_kwh,
              COALESCE(SUM(solar_gen_kw   * interval_s / 3600), 0) AS total_solar_kwh,
              COALESCE(AVG(carbon_intensity), 400) AS avg_carbon_intensity
            FROM carbon_events
            WHERE node_id = %s
              AND ts_utc >= NOW() AT TIME ZONE 'UTC' - INTERVAL %s
        """
        params = (node_id, interval)
    else:
        q = """
            SELECT
              COUNT(*)                          AS data_points,
              COALESCE(SUM(co2_g),          0)  AS total_co2_g,
              COALESCE(SUM(co2_avoided_g),  0)  AS total_co2_avoided_g,
              COALESCE(SUM(co2_avoided_g - co2_g), 0) AS net_co2_saved_g,
              COALESCE(SUM(grid_import_kw * interval_s / 3600), 0) AS total_grid_kwh,
              COALESCE(SUM(solar_gen_kw   * interval_s / 3600), 0) AS total_solar_kwh,
              COALESCE(AVG(carbon_intensity), 400) AS avg_carbon_intensity
            FROM carbon_events
            WHERE ts_utc >= NOW() AT TIME ZONE 'UTC' - INTERVAL %s
        """
        params = (interval,)

    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(q, params)
            row = dict(cur.fetchone())

    total_kwh = float(row["total_grid_kwh"]) + float(row["total_solar_kwh"])
    row["solar_fraction"] = round(float(row["total_solar_kwh"]) / total_kwh, 3) if total_kwh > 0 else 0.0
    row["node_id"]        = node_id
    row["range"]          = range
    return {k: float(v) if isinstance(v, (int,)) else v for k, v in row.items()}


@app.get("/carbon/config/{node_id}")
def get_carbon_config(node_id: str) -> Any:
    """
    Return the carbon intensity config for a node.
    No auth required — Pi devices call this to set their emission factor.
    Returns built-in default (400 gCO₂/kWh) if no config row exists.
    """
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM carbon_config WHERE node_id = %s", (node_id,))
            row = cur.fetchone()
    if row:
        return dict(row)
    return {"node_id": node_id, "carbon_intensity": 400.0, "region": "global"}


class CarbonConfigUpdate(BaseModel):
    carbon_intensity: Optional[float] = None
    region:           Optional[str]   = None


@app.patch("/carbon/config/{node_id}")
def update_carbon_config(
    node_id: str,
    req:     CarbonConfigUpdate,
    _admin:  dict = Depends(require_admin),
) -> Any:
    """Update the carbon intensity for a node. Admin only."""
    fields = {k: v for k, v in req.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="No fields provided")
    fields["updated_at"] = datetime.now(timezone.utc)
    set_clause = ", ".join(f"{k} = %({k})s" for k in fields)
    fields["node_id"] = node_id
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                INSERT INTO carbon_config (node_id, {", ".join(k for k in fields if k not in ("node_id", "updated_at"))})
                VALUES (%(node_id)s, {", ".join(f"%({k})s" for k in fields if k not in ("node_id", "updated_at"))})
                ON CONFLICT (node_id) DO UPDATE SET {set_clause}
                """,
                fields,
            )
    return {"status": "ok", "node_id": node_id}


@app.get("/stream/latest")
async def stream_latest():
    """SSE endpoint — pushes the latest telemetry for all nodes every second."""

    async def generate():
        while True:
            try:
                def fetch():
                    with db_conn() as conn:
                        with conn.cursor(cursor_factory=RealDictCursor) as cur:
                            cur.execute(
                                "SELECT DISTINCT ON (node_id) * FROM telemetry ORDER BY node_id, ts_utc DESC"
                            )
                            return [dict(r) for r in cur.fetchall()]

                rows = await asyncio.to_thread(fetch)
                payload = json.dumps(rows, default=str)
                yield f"data: {payload}\n\n"
            except Exception:
                pass
            await asyncio.sleep(1)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
