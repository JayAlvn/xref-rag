import os
import time

from ingestion import load_document_pages, load_printed_pages, chunk_document, with_printed_pages
from embedding.vector_store import embed_and_store_chunks

from graph.build import build_graph
from graph.neighbourhood import graph_for
from retrieval.hybrid import route_search, is_reference_only

from generation.basic_backend import BasicBackend, CONTEXT_WINDOW

GENERATOR = BasicBackend()

def ingest(doc_path: str) -> int:
    pages = load_document_pages(doc_path)
    chunks = with_printed_pages(chunk_document(pages), load_printed_pages(doc_path))
    doc_name = os.path.basename(doc_path)

    embed_and_store_chunks(chunks, doc_name)
    build_graph(doc_name)

    return len(chunks)


# What the passages may take of the 4096-token context: the instructions and
# the answer need about 1100 tokens, and a word is about 1.4 tokens.
_WORD_BUDGET = 2000

_UNITS = ("article", "recital", "clause", "rule", "section", "annex",
          "schedule", "chapter", "part")

_PLURAL = {"paragraph": "paragraphs", "subparagraph": "subparagraphs",
           "point": "points", "subpoint": "sub-points"}

_ORDINAL = {1: "first", 2: "second", 3: "third", 4: "fourth", 5: "fifth"}


def _provision_label(meta: dict) -> str:
    """The provision a chunk belongs to: Article 93."""
    for kind in _UNITS:
        if kind in meta:
            return f"{kind.capitalize()} {meta[kind]}"
    return ""


def _reference_label(meta: dict) -> str:
    """The piece a chunk belongs to, written as a reference: Article 93(3),
    or Article 101(1), second subparagraph."""
    reference = _provision_label(meta)
    if reference == "":
        return ""
    for part in ("paragraph", "point", "subpoint"):
        if part in meta:
            reference += f"({meta[part]})"
    if "subparagraph" in meta:
        reference += f", {_ORDINAL.get(meta['subparagraph'], meta['subparagraph'])} subparagraph"
    return reference


def _subdivision_name(key: str, value) -> str:
    if key == "paragraph":
        return f"paragraph {value}"
    if key == "subparagraph":
        return f"subparagraph {value}"
    return f"point ({value})"


def _missing(note: dict, metas: list[dict]) -> str:
    """What to say when the named piece does not exist, instead of letting the
    model answer from whatever else the provision says."""
    provision = _provision_label(metas[0])
    if provision == "":
        provision = "That part of the document"

    for key, value in note["asked"].items():
        present = note["present"][key]
        if str(value) in [str(v) for v in present]:
            continue
        name = _subdivision_name(key, value)
        plural = _PLURAL[key]
        if not present:
            return (f"{provision} has no {name}: its text is not divided into {plural}. "
                    "Its full text is in Citations.")
        listed = ", ".join(str(v) for v in present)
        return f"{provision} has no {name}. Its {plural} are {listed}. Its full text is in Citations."

    return f"{provision} has no such part. Its full text is in Citations."


def _within_budget(chunks: list[str], distances: list[float], metas: list[dict]):
    """As many passages, in the order given, as the model's context can hold."""
    used = 0
    keep = 0
    for chunk in chunks:
        words = len(chunk.split())
        if keep > 0 and used + words > _WORD_BUDGET:
            break
        used += words
        keep += 1

    return chunks[:keep], distances[:keep], metas[:keep]


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


def _retrieve(user_query: str, source: str | None) -> tuple[dict, list[dict]]:
    """The retrieval half of RAG: the passages, where they come from and how
    they were found. Returns the response fields and the chunks' metadata.
    How many passages is decided here, never by the caller."""
    t0 = time.perf_counter()
    top_chunks, distances, metas, note = route_search(user_query, source=source)
    t1 = time.perf_counter()

    missing = None
    if note["exact"] and note["asked"] and not note["found"] and metas:
        missing = _missing(note, metas)
    top_chunks, distances, metas = _within_budget(top_chunks, distances, metas)

    result = {
        "sources": top_chunks,
        "retrieval": [
            {"source": f"Source {i + 1}", **_location(m)}
            for i, m in enumerate(metas)
        ],
        "graph": graph_for(metas),
        # How the passages were found, so the UI can say "exact match on
        # Article 66(d)" rather than dressing a label match up as a score.
        "lookup": note,
        "timings": {"retrieval_ms": round((t1 - t0) * 1000, 1), "generation_ms": 0.0},
    }
    if missing is not None:
        result["missing"] = missing

    return result, metas


def retrieve(user_query: str, source: str | None = None) -> dict:
    """Find passages without generating: what find: displays."""
    result, _ = _retrieve(user_query, source)
    return result


def answer_query(user_query: str, source: str | None = None) -> dict:
    """Retrieval-augmented generation: find the passages, then answer from them."""
    result, metas = _retrieve(user_query, source)

    # The named piece does not exist: say so, rather than have the model
    # answer from a neighbouring passage as if it were that piece.
    if "missing" in result:
        result.update({
            "finding": result.pop("missing"),
            "detail": "",
            "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0,
                      "context_window": CONTEXT_WINDOW},
        })
        return result

    lookup = result["lookup"]
    focus = None
    if metas and lookup["exact"]:
        if lookup["found"]:
            focus = _reference_label(metas[0])
        elif not lookup["asked"]:
            focus = _provision_label(metas[0])

    # A bare reference asks nothing, and the model answers "None" to it. What
    # the reader wants from the chat is what that text means in plain words.
    question = user_query
    if is_reference_only(user_query):
        if focus:
            question = f"Explain in plain language what {focus} says."
        else:
            question = "Explain in plain language what these passages say."

    t0 = time.perf_counter()
    generated = GENERATOR.generate(question, result["sources"], focus)
    result["timings"]["generation_ms"] = round((time.perf_counter() - t0) * 1000, 1)

    result.update({key: value for key, value in generated.items() if key != "sources"})

    if _empty(result.get("finding")):
        result["finding"] = "The model gave no answer. The passages are in Citations."
        result["detail"] = ""

    return result


# What a small model writes when it has nothing to say.
_NON_ANSWERS = {"", "none", "null", "n/a", "na", "unknown"}


def _empty(finding) -> bool:
    if finding is None:
        return True
    return str(finding).strip().strip(".").lower() in _NON_ANSWERS


def run_pipeline(doc_path: str, user_query: str) -> dict:
    ingest(doc_path)
    return answer_query(user_query)
