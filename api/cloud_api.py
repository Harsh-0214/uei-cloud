from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional, Any
import os
import re
import bcrypt
import psycopg2
from psycopg2.extras import RealDictCursor
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from jose import JWTError, jwt
from passlib.context import CryptContext

app = FastAPI(title="UEI Cloud API", version="2.0")

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

def hash_password(plain, hashed):
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

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

# ── Protected data routes ────────────────────────────────────────────────────

@app.get("/latest")
def latest(
    node_id:      Optional[str] = None,
    current_user: dict          = Depends(get_current_user),
) -> Any:
    """
    Return the most recent telemetry row(s) for the authenticated user's organization.
    Only nodes registered to the user's org (via the nodes table) are returned.
    """
    org_id   = current_user["organization_id"]
    is_super = current_user.get("role") == "superadmin"

    if is_super:
        if node_id:
            q      = "SELECT * FROM telemetry WHERE node_id = %s ORDER BY ts_utc DESC LIMIT 1;"
            params = (node_id,)
        else:
            q      = "SELECT DISTINCT ON (node_id) * FROM telemetry ORDER BY node_id, ts_utc DESC;"
            params = None
    else:
        if node_id:
            q = """
            SELECT t.*
            FROM telemetry t
            JOIN nodes n ON t.node_id = n.node_id
            WHERE t.node_id = %s
              AND n.organization_id = %s
            ORDER BY t.ts_utc DESC
            LIMIT 1;
            """
            params = (node_id, org_id)
        else:
            q = """
            SELECT DISTINCT ON (t.node_id) t.*
            FROM telemetry t
            JOIN nodes n ON t.node_id = n.node_id
            WHERE n.organization_id = %s
            ORDER BY t.node_id, t.ts_utc DESC;
            """
            params = (org_id,)

    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(q, params) if params else cur.execute(q)
            rows = cur.fetchall()

    if node_id and not rows:
        raise HTTPException(status_code=404, detail="node_id not found or not in your organization")
    return rows[0] if node_id else rows


@app.get("/telemetry")
def list_telemetry(
    node_id:      Optional[str] = None,
    limit:        int           = 100,
    current_user: dict          = Depends(get_current_user),
) -> Any:
    """
    Return recent telemetry rows for the authenticated user's organization.
    Optional node_id filter. Max 1000 rows.
    """
    org_id   = current_user["organization_id"]
    is_super = current_user.get("role") == "superadmin"
    limit    = min(limit, 1000)

    if is_super:
        if node_id:
            q      = "SELECT * FROM telemetry WHERE node_id = %s ORDER BY ts_utc DESC LIMIT %s;"
            params = (node_id, limit)
        else:
            q      = "SELECT * FROM telemetry ORDER BY ts_utc DESC LIMIT %s;"
            params = (limit,)
    else:
        if node_id:
            q = """
            SELECT t.*
            FROM telemetry t
            JOIN nodes n ON t.node_id = n.node_id
            WHERE t.node_id = %s
              AND n.organization_id = %s
            ORDER BY t.ts_utc DESC
            LIMIT %s;
            """
            params = (node_id, org_id, limit)
        else:
            q = """
            SELECT t.*
            FROM telemetry t
            JOIN nodes n ON t.node_id = n.node_id
            WHERE n.organization_id = %s
            ORDER BY t.ts_utc DESC
            LIMIT %s;
            """
            params = (org_id, limit)

    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(q, params)
            rows = cur.fetchall()

    return [dict(r) for r in rows]


@app.get("/schema")
def schema(current_user: dict = Depends(get_current_user)) -> Any:
    """Return DB schema (used by the AI chatbot). Requires auth."""
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
def query(req: QueryRequest, current_user: dict = Depends(get_current_user)) -> Any:
    """Execute a read-only SELECT query (used by the AI chatbot). Requires auth."""
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
