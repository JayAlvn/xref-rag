MODEL_NAME = "cross-encoder/ms-marco-MiniLM-L-6-v2"

_model = None


def _load():
    global _model
    if _model is None:
        from sentence_transformers import CrossEncoder
        _model = CrossEncoder(MODEL_NAME)

    return _model


def rerank(query_text: str, chunks: list[str], distances: list[float], metas: list[dict], keep: int):
    if not chunks:
        return chunks, distances, metas

    pairs = [(query_text, chunk) for chunk in chunks]
    scores = _load().predict(pairs)
    order = sorted(range(len(chunks)), key=lambda i: scores[i], reverse=True)[:keep]

    return (
        [chunks[i] for i in order],
        [distances[i] for i in order],
        [metas[i] for i in order]
    )
