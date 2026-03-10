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
from passlib.context import CryptContext

DB_HOST = os.environ.get("DB_HOST", "postgres")
DB_PORT = int(os.environ.get("DB_PORT", "5432"))
DB_NAME = os.environ.get("DB_NAME", "uei")
DB_USER = os.environ.get("DB_USER", "uei")
DB_PASS = os.environ.get("DB_PASS", "uei_password")

SUPERADMIN_ORG      = "Capstone"
SUPERADMIN_EMAIL    = "capstone.uei@gmail.com"
SUPERADMIN_PASSWORD = "capstone"
SUPERADMIN_ROLE     = "superadmin"

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")

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
            hashed = pwd_ctx.hash(SUPERADMIN_PASSWORD)

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

    conn.close()
    print("Done. Superadmin account ready.")

if __name__ == "__main__":
    main()
