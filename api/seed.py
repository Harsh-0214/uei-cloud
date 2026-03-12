"""
Seed the superadmin account.

Usage (inside the running API container):
    docker exec uei-cloud-api-1 python seed.py

Or on the host (if Python + deps are available):
    python api/seed.py
"""
import os
import psycopg2
from psycopg2.extras import RealDictCursor
import bcrypt

def hash_password(password):
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

DB_HOST = os.environ.get("DB_HOST", "postgres")
DB_PORT = int(os.environ.get("DB_PORT", "5432"))
DB_NAME = os.environ.get("DB_NAME", "uei")
DB_USER = os.environ.get("DB_USER", "uei")
DB_PASS = os.environ.get("DB_PASS", "uei_password")

SUPERADMIN_ORG      = "Capstone"
SUPERADMIN_EMAIL    = "capstone.uei@gmail.com"
SUPERADMIN_PASSWORD = "capstone"
SUPERADMIN_ROLE     = "superadmin"

# Simulator node_ids to register under the Capstone org
SIMULATOR_NODES = ["bms-node-1", "pi_bms_1", "pi_pv_1"]

def main():
    conn = psycopg2.connect(
        host=DB_HOST, port=DB_PORT, dbname=DB_NAME,
        user=DB_USER, password=DB_PASS,
    )
    conn.autocommit = False

    with conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Create or fetch org
            cur.execute("SELECT id FROM organizations WHERE name = %s", (SUPERADMIN_ORG,))
            org = cur.fetchone()
            if org:
                org_id = org["id"]
                print(f"  Organization '{SUPERADMIN_ORG}' already exists (id={org_id})")
            else:
                cur.execute(
                    "INSERT INTO organizations (name) VALUES (%s) RETURNING id",
                    (SUPERADMIN_ORG,),
                )
                org_id = cur.fetchone()["id"]
                print(f"  Created organization '{SUPERADMIN_ORG}' (id={org_id})")

            # Create or update user
            cur.execute("SELECT id, role FROM users WHERE email = %s", (SUPERADMIN_EMAIL,))
            existing = cur.fetchone()
            hashed = hash_password(SUPERADMIN_PASSWORD)

            if existing:
                cur.execute(
                    "UPDATE users SET hashed_password = %s, role = %s, organization_id = %s WHERE id = %s",
                    (hashed, SUPERADMIN_ROLE, org_id, existing["id"]),
                )
                print(f"  Updated existing user '{SUPERADMIN_EMAIL}' → role='{SUPERADMIN_ROLE}'")
            else:
                cur.execute(
                    """
                    INSERT INTO users (email, hashed_password, organization_id, role)
                    VALUES (%s, %s, %s, %s) RETURNING id
                    """,
                    (SUPERADMIN_EMAIL, hashed, org_id, SUPERADMIN_ROLE),
                )
                uid = cur.fetchone()["id"]
                print(f"  Created user '{SUPERADMIN_EMAIL}' (id={uid}) role='{SUPERADMIN_ROLE}'")

            # Register simulator nodes under the Capstone org
            for node in SIMULATOR_NODES:
                cur.execute(
                    """
                    INSERT INTO nodes (node_id, organization_id)
                    VALUES (%s, %s)
                    ON CONFLICT (node_id) DO NOTHING
                    """,
                    (node, org_id),
                )
                print(f"  Registered node '{node}' → org '{SUPERADMIN_ORG}'")

    conn.close()
    print("Done. Superadmin account and simulator nodes ready.")

if __name__ == "__main__":
    main()
