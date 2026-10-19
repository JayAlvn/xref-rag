from settings import ROUTING, RERANK
from retrieval.lookup import exact_lookup
from retrieval.query_parsing import parse_subdivision
from retrieval.rerank import rerank
from retrieval.search import CANDIDATES, close_to_best, hybrid_search


# Reranking reads a wider pool than plain hybrid keeps, then picks the best.
_RERANK_POOL = 20 # hands to the reranker.
_RERANK_KEEP = 6 # the reranker keeps for the prompt


def _hybrid_note(asked: dict, route: str) -> dict:
    return {
        "exact": False,
        "asked": asked,
        "found": False,
        "route": route,
        "rerank": RERANK,
    }


def _full_hybrid(query_text: str, source: str | None, asked: dict):
    if RERANK:
        chunks, distances, metas = hybrid_search(query_text, source=source, n=_RERANK_POOL)
        chunks, distances, metas = rerank(query_text, chunks, distances, metas, _RERANK_KEEP)
    else:
        chunks, distances, metas = hybrid_search(query_text, source=source, n=CANDIDATES)
        chunks, distances, metas = close_to_best(chunks, distances, metas)

    return chunks, distances, metas, _hybrid_note(asked, "hybrid")


def route_search(query_text: str, source: str | None = None):
    """Retrieve for a query, picking exact lookup over similarity when possible.

    A named piece ("paragraph 2 of Article 7") comes back alone and whole; a
    named provision comes back whole, in reading order; anything else gets the
    passages closest to it. The note says which, what subdivision the question
    named, whether it was found, and what the provision has instead if not.
    """
    asked = parse_subdivision(query_text)

    if ROUTING == "hybrid":
        return _full_hybrid(query_text, source, asked)

    found = exact_lookup(query_text, source, asked)
    if found is not None:
        return found

    return _full_hybrid(query_text, source, asked)
