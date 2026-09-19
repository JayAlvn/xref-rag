import os
import time

from ingestion import load_document_pages, chunk_document
from embedding.vector_store import embed_and_store_chunks

from graph.build import build_graph
from graph.neighbourhood import graph_for
from retrieval.hybrid import route_search

from generation.naive_backend import NaiveBackend
from generation.basic_backend import BasicBackend

BACKENDS = {
    "naive": NaiveBackend(),
    "basic": BasicBackend()
}

ABSTENTION_MARKERS = (
    "does not provide", "not enough information", "cannot determine",
    "no explicit mention", "don't know", "do not know", "insufficient",
    "unable to", "no information", "not mentioned", "not specified",
    "cannot assess", "more specific information", "no clear indication",
)

def ingest(doc_path: str) -> int:
    pages = load_document_pages(doc_path)
    chunks = chunk_document(pages)
    doc_name = os.path.basename(doc_path)

    embed_and_store_chunks(chunks, doc_name)
    build_graph(doc_name)

    return len(chunks)

# Anchors measured against corpora (MiniLM, cosine space):
# unrelated queries top out near similarity 0.25, excellent matches reach ~0.70+.
_SIM_FLOOR = 0.25
_SIM_CEIL = 0.75

def _calculate_relevance_score(distance: float) -> float:
    similarity = 1 - distance  # cosine distance -> cosine similarity
    relevance = (similarity - _SIM_FLOOR) / (_SIM_CEIL - _SIM_FLOOR)
    return round(min(max(relevance, 0.0), 1.0), 3)

#evicence score 0-100
def _calculate_confidence_score(relevance_scores: list[float], finding_text: str) -> int:
    if not relevance_scores:
        return 0
    top = max(relevance_scores)
    avg = sum(relevance_scores) / len(relevance_scores)

    evidence = 0.6 * top  + 0.4 * avg
    
    if any (m in (finding_text or "").lower() for m in ABSTENTION_MARKERS):
        evidence *= 0.5
    
    return round (evidence * 100)


# Ceiling on retrieved passages: beyond this the prompt outgrows the 4096-token
# context window and the model starts silently dropping the tail.
_MAX_SOURCES = 12


def _location(meta: dict) -> dict:
    """Where a chunk came from, as flat keys for the API response.

    The chunk's own "source" (the filename) is renamed to "document" because
    "source" is already taken by the "Source N" label the UI shows.
    """
    if not meta:
        return {}

    where = {}
    for key in meta:
        if key != "source":
            where[key] = meta[key]

    if "source" in meta:
        where["document"] = meta["source"]
    return where


def _confidence_level(score: int) -> int:
    if score is None:
        return "low"
    if score >= 70:
        return "high"
    if score >= 40:
        return "probable"
    return "low"


def answer_query(user_query: str, mode: str = "basic", source: str | None = None,
                 n: int = 3) -> dict:
    if mode not in BACKENDS:
        raise ValueError(f"Unknown mode: {mode}")

    n = max(1, min(n, _MAX_SOURCES))

    t0 = time.perf_counter()
    top_chunks, distances, metas = route_search(user_query, source=source, n=n)
    t1 = time.perf_counter()

    result = BACKENDS[mode].generate(user_query, top_chunks)
    t2 = time.perf_counter()

    result["timings"] = {
        "retrieval_ms": round((t1 - t0) * 1000, 1),
        "generation_ms": round((t2 - t1) * 1000, 1),
    }

    relevance_score = [_calculate_relevance_score(d) for d in distances]

    result["retrieval"] = [
        {"source": f"Source {i + 1}", "score": s, **_location(m)}
        for i, (s, m) in enumerate(zip(relevance_score, metas))
    ]
    
    result["graph"] = graph_for(metas)

    confidence = _calculate_confidence_score(relevance_score, result.get("finding",""))
    result["confidence"] = confidence
    result["confidence_level"] = _confidence_level(confidence)

    return result
 

def run_pipeline(doc_path: str, user_query: str,  mode: str="basic") -> dict:
    ingest(doc_path)
    return answer_query(user_query, mode)


