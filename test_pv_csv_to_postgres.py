import csv
from datetime import datetime, timezone
import psycopg

# =========================
# CONFIG
# =========================

CSV_PATH = "pv_data.csv"  # <-- change path if needed

PG_HOST = "localhost"      # if running on VM
PG_PORT = 5432
PG_DB   = "uei"
PG_USER = "uei"
PG_PASS = "uei_password"

NODE_ID = "pi_pv_1"
PV_ID   = "pv_1"

# =========================
# HELPERS
# =========================

def iso_from_hms(hr, minute, sec):
    now = datetime.now(timezone.utc)
    return datetime(
        now.year,
        now.month,
        now.day,
        int(float(hr)),
        int(float(minute)),
        int(float(sec)),
        tzinfo=timezone.utc,
    )


def parse_float(x):
    if x is None or str(x).strip() == "":
        return 0.0
    return float(x)


INSERT_SQL = """
INSERT INTO pv_telemetry (
  ts_utc, node_id, pv_id,
  invr1, invr2,
  ld1, ld2, ld3, ld4,
  bv1, bv2
) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s);
"""


def main():
    print("[TEST] Connecting to Postgres...")

    with psycopg.connect(
        host=PG_HOST,
        port=PG_PORT,
        dbname=PG_DB,
        user=PG_USER,
        password=PG_PASS,
    ) as conn:

        conn.autocommit = True

        with conn.cursor() as cur:

            with open(CSV_PATH, newline="") as f:
                reader = csv.DictReader(f)

                for row in reader:
                    try:
                        ts = iso_from_hms(row["Hr"], row["Min"], row["Sec"])

                        vals = (
                            ts,
                            NODE_ID,
                            PV_ID,
                            parse_float(row["Invr1"]),
                            parse_float(row["Invr2"]),
                            parse_float(row["Ld1"]),
                            parse_float(row["Ld2"]),
                            parse_float(row["Ld3"]),
                            parse_float(row["Ld4"]),
                            parse_float(row["BV1"]),
                            parse_float(row["BV2"]),
                        )

                        cur.execute(INSERT_SQL, vals)

                        print(f"[OK] Inserted {ts} invr1={vals[3]} bv1={vals[9]}")

                    except Exception as e:
                        print(f"[ERROR] {e}")

    print("[DONE] CSV processed.")


if __name__ == "__main__":
    main()
