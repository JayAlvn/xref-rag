import sys
from pathlib import Path

import numpy as np
import onnxruntime
from tokenizers import Tokenizer

_MAX_TOKENS = 512

_session = None
_tokenizer = None


def _model_dir() -> Path:
    bundle = getattr(sys, "_MEIPASS", None)
    if bundle is not None:
        return Path(bundle) / "models" / "reranker"
    return Path(__file__).resolve().parent.parent / "models" / "reranker"


def _load():
    global _session, _tokenizer

    if _session is None:
        folder = _model_dir()
        _session = onnxruntime.InferenceSession(
            (folder / "model.onnx").read_bytes(),
            providers=["CPUExecutionProvider"],
        )
        _tokenizer = Tokenizer.from_str((folder / "tokenizer.json").read_text(encoding="utf-8"))
        _tokenizer.enable_truncation(max_length=_MAX_TOKENS)
        _tokenizer.enable_padding()

    return _session, _tokenizer


def rerank(query_text: str, chunks: list[str], distances: list[float], metas: list[dict], keep: int):
    if not chunks:
        return chunks, distances, metas

    session, tokenizer = _load()
    encodings = tokenizer.encode_batch([(query_text, chunk) for chunk in chunks])

    inputs = {
        "input_ids": np.array([e.ids for e in encodings], dtype=np.int64),
        "attention_mask": np.array([e.attention_mask for e in encodings], dtype=np.int64),
        "token_type_ids": np.array([e.type_ids for e in encodings], dtype=np.int64),
    }

    feed = {}
    for model_input in session.get_inputs():
        feed[model_input.name] = inputs[model_input.name]

    scores = session.run(None, feed)[0][:, 0]
    order = sorted(range(len(chunks)), key=lambda i: scores[i], reverse=True)[:keep]

    return (
        [chunks[i] for i in order],
        [distances[i] for i in order],
        [metas[i] for i in order],
    )
