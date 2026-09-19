from embedding.vector_store import metadata_lookup
from graph.build import _node_of
from graph.store import get_outgoing

MAX_DEPTH = 2 
MAX_NODES = 50
PREVIEW_CHARS = 240

def _label(node: str) -> str:
    kind, value = node.split(":", 1)
    if kind == "ext":
        return value
    return f"{kind.capitalize()} {value}"

def _preview(document: str, node: str) -> str:
    kind, value = node.split(":", 1)
    if value.isdigit():
        value = int(value)
    chunks, _ = metadata_lookup({kind: value, "source": document}, limit=1)
    if not chunks:
        return ""
    return " ".join(chunks[0].split())[:PREVIEW_CHARS]

def _make_node(document: str, node: str, kind: str, depth: int) -> dict:
    entry = {
        "id": f"{document}::{node}",
        "id": _node_id(document, node),
        "node": node,
        "document": document,
        "label": _label(node),
        "kind": kind,
        "depth": depth,
    }
    if kind == "retrieved" or kind == "internal":
        entry["preview"] = _preview(document, node)

    return entry

def _node_id(document: str, node:str) -> str:
    return f"{document}::{node}"

def _queue(frontier: dict, document: str, node:str) -> None:
    if document not in frontier:
        frontier[document] = []
    frontier[document].append(node)

def _seed(metas: list[dict], nodes:dict) -> dict:
    frontier = {}
    for meta in metas:
        document = meta.get("source")
        node = _node_of(meta)
        if document is None or node is None:
            continue
        node_id = _node_id(document, node)
        if node_id in nodes:
            continue
        nodes[node_id] = _make_node(document, node, "retrieved", 0)
        _queue(frontier, document, node)

    return frontier
    
def _expand(frontier: dict, nodes: dict, edges: list, depth: int) -> dict:
    next_frontier = {}
    for document, sources in frontier.items():
        for source, target, edge_type in get_outgoing(document, sources):
            target_id = _node_id(document, target)

            if target_id not in nodes:
                if len(nodes) >= MAX_NODES:
                    continue
                nodes[target_id] = _make_node(document, target, edge_type, depth)
                if edge_type == "internal":
                    _queue(next_frontier, document, target)

            edges.append({
                "from": _node_id(document, source),
                "to": target_id,
                "type": edge_type,
            })

    return next_frontier

def graph_for(metas: list[dict]) -> dict:
    nodes = {}
    edges = []

    frontier = _seed(metas, nodes)
    for depth in range(1, MAX_DEPTH + 1):
        if not frontier:
            break
        frontier = _expand(frontier, nodes, edges, depth)

    return {"nodes": list(nodes.values()), "edges": edges}

