import re
from rank_bm25 import BM25Okapi
from embedding.vector_store import semantic_rank



def _tokenize(text: str) -> list[str]:
    return re.findall(r"\w+", text.lower())

#Reciprocal Rank Fusion (rrf)
#k - a constant smoothing parameter or penalty factor
def _rrf(rank_list: list[list[str]], k: int = 60) -> dict:
    scores: dict[str, float] = {}
    for ranking in rank_list:
        for rank, _id in enumerate(ranking):
            scores[_id] = scores.get(_id, 0.0) + 1.0 / (k + rank)
    return scores

def hybrid_search(query_text: str, source: str | None = None, n: int = 6, where: dict | None = None):
    semantic = semantic_rank(query_text, source, where)
    if not semantic:
        return [], [], []
    ids = [s[0] for s in semantic]
    docs_by_id = {s[0]: s[1] for s in semantic}
    dist_by_id = {s[0]: s[2] for s in semantic}
    meta_by_id = {s[0]: s[3] for s in semantic}

    semantic_order = ids
    corpus_tokens = [_tokenize(docs_by_id[i]) for i in ids]
    bm25 = BM25Okapi(corpus_tokens)
    bm25_scores = bm25.get_scores(_tokenize(query_text))
    bm25_order = [
        i for i, _ in sorted(zip(ids, bm25_scores),
                              key=lambda p: p[1], reverse=True)
    ]

    fused = _rrf([semantic_order, bm25_order])
    top_ids = sorted(fused, key=lambda i: fused[i], reverse=True)[:n]

    chunks = [docs_by_id[i] for i in top_ids]
    distances = [dist_by_id[i] for i in top_ids]
    metas = [meta_by_id[i] for i in top_ids]

    return chunks, distances, metas


#A general question gets every passage about as close to it as the best one:
# within _MARGIN cosine similarity, never fewer than _FEWEST (a lone passage is
# often cut mid-sentence) and never more than _MOST.
CANDIDATES = 12
_MARGIN = 0.15
_FEWEST = 3
_MOST = 8


def close_to_best(chunks: list[str], distances: list[float], metas: list[dict]):
    if not distances:
        return chunks, distances, metas

    best = 1 - min(distances)
    keep = []
    for i, distance in enumerate(distances):
        if i < _FEWEST or 1 - distance >= best - _MARGIN:
            keep.append(i)
    keep = keep[:_MOST]

    return ([chunks[i] for i in keep], [distances[i] for i in keep],
            [metas[i] for i in keep])
