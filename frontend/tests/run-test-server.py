"""A fresh, synthetic SQLite database for one Playwright invocation, never port 8000."""
from pathlib import Path
import os
import sys
import tempfile


def main():
    backend = Path(__file__).resolve().parents[2] / "backend"
    sys.path.insert(0, str(backend))
    # Force safe local settings even if the shell is configured for a real model.
    with tempfile.TemporaryDirectory(prefix="casedesk-e2e-") as directory:
        os.environ["CASEDESK_DATABASE_PATH"] = str(Path(directory) / "e2e.sqlite3")
        os.environ["CASEDESK_PROVIDER"] = "demo"
        os.environ["CASEDESK_DEMO_SEED"] = "true"
        import uvicorn

        uvicorn.run(
            "app.main:app",
            host="127.0.0.1",
            port=8001,
            workers=1,
            log_level="warning",
        )


if __name__ == "__main__":
    main()
