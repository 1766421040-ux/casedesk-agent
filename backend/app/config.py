"""Environment-only configuration. No API can override model endpoints or storage."""
from dataclasses import dataclass
import os
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    database_path: str = str(Path(__file__).resolve().parents[1] / "data" / "casedesk.sqlite3")
    provider: str = "demo"
    model_url: str = "https://api.openai.com/v1"
    model_key: str = ""
    model_name: str = ""
    model_timeout: float = 20.0
    session_hours: int = 12
    demo_seed: bool = True

    @classmethod
    def from_env(cls):
        return cls(
            database_path=os.getenv("CASEDESK_DATABASE_PATH", cls.database_path),
            provider=os.getenv("CASEDESK_PROVIDER", "demo"),
            model_url=os.getenv("CASEDESK_MODEL_BASE_URL", cls.model_url),
            model_key=os.getenv("CASEDESK_MODEL_API_KEY", ""),
            model_name=os.getenv("CASEDESK_MODEL_NAME", ""),
            model_timeout=float(os.getenv("CASEDESK_MODEL_TIMEOUT", "20")),
            demo_seed=os.getenv("CASEDESK_DEMO_SEED", "true").lower() == "true",
        )
