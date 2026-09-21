import os
from pathlib import Path

DATA_DIR = Path(os.environ.get("XREF_DATA_DIR", Path(__file__).resolve().parent))

CHROMA_DIR = DATA_DIR / "chroma_db"
UPLOADS_DIR = DATA_DIR / "uploads"
EDGES_DB = DATA_DIR / "edges.db"


UPLOADS_DIR.mkdir(parents=True, exist_ok=True)