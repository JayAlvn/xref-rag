import os
import sqlite3

_DB_PATH = os.path.join(os.path.dirname(__file__), "..", "edges.db")

def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS edges (
            document    TEXT NOT NULL,
            source      TEXT NOT NULL,
            target      TEXT NOT NULL,
            edge_type   TEXT NOT NULL,
            PRIMARY KEY (document, source, target)   
        )
        """
    )

    conn.execute(
        "CREATE INDEX IF NOT EXISTS edges_by_target ON edges (document, target)"
    )

    return conn

def save_edges(document: str, edges: list[tuple]) -> None:

    rows = []

    for source, target, edge_type in edges:
        rows.append((document, source, target, edge_type))
    
    conn = _connect()
    with conn:
        conn.execute("DELETE FROM edges WHERE document = ?", (document,))
        conn.executemany(
            "INSERT INTO edges (document, source, target, edge_type) VALUES (?, ?, ?, ?)",
            rows,
        )
    conn.close()

def get_outgoing(document: str, nodes: list[str]) -> list[tuple]:
    """Edges starting at any of these nodes -- what they point at."""

    if not nodes:
        return []

    placeholders = ", ".join("?" for _ in nodes)

    conn = _connect()
    rows = conn.execute(
        f"SELECT source, target, edge_type FROM edges "
        f"WHERE document = ? AND source IN ({placeholders})",
        (document, *nodes),
    ).fetchall()

    conn.close()

    return rows

def get_incoming(document: str, nodes: list[str]) ->list[tuple]:
    """Edges ending at any of these nodes -- what points at them."""

    if not nodes:
        return []

    placeholders = ", ".join("?" for _ in nodes)
    conn = _connect()
    rows = conn.execute(
        f"SELECT source, target, edge_type FROM edges "
        f"WHERE document = ? AND target IN ({placeholders})",
        (document, *nodes),
    ).fetchall()

    conn.close()

    return rows

def delete_edges(document: str) -> None:
    conn = _connect()
    
    with conn:
        conn.execute("DELETE FROM edges WHERE document = ?", (document,))
    conn.close()