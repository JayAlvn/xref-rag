
from graph.store import save_edges
from ingestion.references import extract_references

from embedding.vector_store import get_document_chunks

# The units a graph node can be, most specific first. Paragraphs and points
# stay out: cross-references are drawn between provisions, not their points.
_NODE_KINDS = ("recital", "article", "clause", "rule", "section",
               "annex", "schedule", "appendix", "exhibit", "chapter", "part", "title")


def _node_of(meta: dict) ->  str | None:
    for kind in _NODE_KINDS:
        if kind in meta:
            return f"{kind}:{meta[kind]}"
    return None


def build_edges(texts: list[str], metas: list[dict]) -> list[tuple]:

    edges = set()
    nodes = set()

    for meta in metas:
        node = _node_of(meta)
        if node is not None:
            nodes.add(node)
    
    for text, meta in zip(texts, metas):
        source = _node_of(meta)
        if source is None:
            continue
        for ref in extract_references(text):
            if ref["external"]:
                target = f"ext:{ref['instrument']}"
                edge_type = "external"
            else:
                target = f"{ref['kind']}:{ref['id']}"
                if target == source:
                    continue
                if target in nodes:
                    edge_type = "internal"
                else:
                    edge_type = "missing"
        
            edges.add((source, target, edge_type))

    return sorted(edges)

def build_graph(doc_name: str) -> int:
    texts, metas = get_document_chunks(doc_name)
    edges = build_edges(texts, metas)
    save_edges(doc_name, edges)
    
    return len(edges)



if __name__ == "__main__":
    texts = [
        "Article 5 applies, as does Annex III.",
        "See Article 99 and Article 11 of Regulation (EU) 2019/2144.",
        "Annex III lists high-risk systems.",
    ]
    metas = [
        {"source": "x.pdf", "article": 6, "chapter": "III"},
        {"source": "x.pdf", "article": 5, "chapter": "II"},
        {"source": "x.pdf", "annex": "III"},
    ]
    for edge in build_edges(texts, metas):
        print(edge)