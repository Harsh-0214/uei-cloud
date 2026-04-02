"""
db_connect.py — PostgreSQL connection for PV Pi node.

Configure via environment variables or edit the defaults below.

Usage:
    from db_connect import get_conn

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
"""

import os
import psycopg2

# ── Connection settings ───────────────────────────────────────────────────────
# Override any of these with environment variables, e.g.:
#   export DB_HOST=34.130.163.154
#   export DB_PASS=your_password

DB_HOST = os.environ.get("DB_HOST", "34.130.163.154")
DB_PORT = int(os.environ.get("DB_PORT", "5432"))
DB_NAME = os.environ.get("DB_NAME", "uei")
DB_USER = os.environ.get("DB_USER", "uei")
DB_PASS = os.environ.get("DB_PASS", "uei_password")


def get_conn() -> psycopg2.extensions.connection:
    """Return a new psycopg2 connection to the cloud database."""
    return psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASS,
        connect_timeout=10,
    )


def test_connection() -> None:
    """Quick connectivity check — prints server version."""
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT version();")
    row = cur.fetchone()
    print(f"[db_connect] Connected: {row[0]}")
    cur.close()
    conn.close()


if __name__ == "__main__":
    test_connection()
