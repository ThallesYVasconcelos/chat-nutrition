import argparse
import sys
from pathlib import Path

from dotenv import load_dotenv
from psycopg import connect

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from nutri_ai.config import get_settings  # noqa: E402


def main() -> None:
    load_dotenv(ROOT / ".env")
    parser = argparse.ArgumentParser()
    parser.add_argument("files", nargs="+")
    args = parser.parse_args()

    with connect(get_settings().resolved_database_url) as conn:
        with conn.cursor() as cur:
            for file_name in args.files:
                path = (ROOT / file_name).resolve()
                cur.execute(path.read_text(encoding="utf-8"))
                print(f"Applied {path.relative_to(ROOT)}")
        conn.commit()


if __name__ == "__main__":
    main()

