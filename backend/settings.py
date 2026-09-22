import os
from pathlib import Path

DATA_DIR = Path(os.environ.get("XREF_DATA_DIR", Path(__file__).resolve().parent))

CHROMA_DIR = DATA_DIR / "chroma_db"
UPLOADS_DIR = DATA_DIR / "uploads"
EDGES_DB = DATA_DIR / "edges.db"

# The language model, and the Ollama release fetched to run it on a computer
# that has none. The checksums are those Ollama publishes for the release: a
# download that does not match is discarded unopened.
MODEL = "llama3.2"
OLLAMA_VERSION = "v0.30.10"
OLLAMA_CHECKSUMS = {
    "ollama-linux-amd64.tar.zst": "046d8f28e58d58477a49558d8d1bcb2e81ca8b287f93c44b12ff919c10d178dd",
    "ollama-windows-amd64.zip": "9606cee7501703a0969682667def313130f99ed73f44a88a7a8efe82d4b565f0",
}


UPLOADS_DIR.mkdir(parents=True, exist_ok=True)