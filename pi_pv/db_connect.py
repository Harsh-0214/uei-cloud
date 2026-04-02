"""
db_connect.py — PostgreSQL connection for PV Pi node.

Reads credentials from config.csv in the same folder.

config.csv format (first row = header, second row = values):
    host,port,dbname,user,password
    34.130.163.154,5432,uei,uei,uei_password

Usage:
    from db_connect import get_conn

    conn = get_conn()
    # use conn ...
    conn.close()
"""

import csv
import os
import psycopg2

CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.csv")


def _load_config() -> dict:
    """Read the first data row from config.csv and return as a dict."""
    with open(CONFIG_FILE, newline="") as f:
        reader = csv.DictReader(f)
        row = next(reader)
    return row


def get_conn() -> psycopg2.extensions.connection:
    """Return a new psycopg2 connection using credentials from config.csv."""
    cfg = _load_config()
    return psycopg2.connect(
        host=cfg["host"],
        port=int(cfg["port"]),
        dbname=cfg["dbname"],
        user=cfg["user"],
        password=cfg["password"],
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
