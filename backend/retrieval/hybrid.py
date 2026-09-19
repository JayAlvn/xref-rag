import re
from rank_bm25 import BM25Okapi
from embedding.vector_store import semantic_rank, metadata_lookup

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

def hybrid_search(query_text: str, source: str | None = None, n: int = 6):
    semantic = semantic_rank(query_text, source)
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


_UNIT_WORDS = ("recital", "clause", "article", "section", "annex",
               "schedule", "rule", "chapter", "part", "page")

_IDENTIFIER = re.compile(
    r"\b(" + "|".join(_UNIT_WORDS) + r")s?\.?\s*(?:no\.?\s*|number\s*)?(\d{1,4})\b",
    re.I,
)

# A query word is tried as its own metadata key first. These add a second
# try for conventions where people name a unit by another word -- in EU
# regulation, "clause 148" means recital 148.
_FALLBACKS = {
    "clause": ("recital",),
    "section": ("article",),
}

def parse_identifier(query_text: str) -> list[tuple[str, int]]:
    """Extract (metadata field, number) pairs naming a part of the document.
    """
    found = []
    page = None

    for word, number in _IDENTIFIER.findall(query_text):
        word = word.lower()
        number = int(number)
        if word == "page":
            page = number
            continue
        
        found.append((word, number))
        for fallback in _FALLBACKS.get(word, ()):
            found.append((fallback, number))
    if page is not None:
        found.append(("page", page))

    return found

def route_search(query_text: str, source: str | None = None, n: int = 6):
    """Retrieve for a query, picking exact lookup over similarity when possible.
    """
    for field, number in parse_identifier(query_text):
        conditions = {field: number}
        if source:
            conditions["source"] = source

        chunks, metas = metadata_lookup(conditions, limit=n)
        if chunks:
            # Exact match on the requested identifier -- no similarity involved.
            return chunks, [0.0] * len(chunks), metas

    return hybrid_search(query_text, source=source, n=n)
