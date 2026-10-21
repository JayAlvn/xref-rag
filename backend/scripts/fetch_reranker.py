import hashlib
import sys
import urllib.request
from pathlib import Path

REVISION = "233902d25c440f23af6f7d6e94d2946bac0bee0a"
BASE_URL = f"https://huggingface.co/cross-encoder/ms-marco-MiniLM-L-6-v2/resolve/{REVISION}/"

FILES = {
    "onnx/model.onnx": ("model.onnx", "5d3e70fd0c9ff14b9b5169a51e957b7a9c74897afd0a35ce4bd318150c1d4d4a"),
    "tokenizer.json": ("tokenizer.json", "d241a60d5e8f04cc1b2b3e9ef7a4921b27bf526d9f6050ab90f9267a1f9e5c66"),
}

TARGET = Path(__file__).resolve().parent.parent / "models" / "reranker"

BLOCK_SIZE = 1024 * 1024

def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as file:
        while True:
            block = file.read(BLOCK_SIZE)
            if not block:
                break
            digest.update(block)
    return digest.hexdigest()

def fetch(remote: str, name: str, expected: str) -> None:
    path = TARGET / name
    if path.exists() and sha256(path) == expected:
        print(f"{name}: already there")
        return

    partial = path.with_name(name + ".part")
    print(f"{name}: downloading")
    urllib.request.urlretrieve(BASE_URL + remote, partial)

    if sha256(partial) != expected:
        partial.unlink()
        sys.exit(f"{name}: checksum does not match, download discarded")
    partial.replace(path)

def main() -> None:
    TARGET.mkdir(parents=True, exist_ok=True)
    for remote, (name, expected) in FILES.items():
        fetch(remote, name, expected)

if __name__ == "__main__":
    main()