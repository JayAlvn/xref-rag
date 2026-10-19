import itertools
from embedding.vector_store import metadata_lookup
from retrieval.query_parsing import FALLBACKS, parse_identifier
# The whole provision is fetched, then the named part is brought to the front.
_CEILING = 200

def _relaxations(asked: dict) -> list[dict]:
    """The asked-for labels, then the same without the outer ones."""
    tries = [asked]
    for drop in ("paragraph", "point"):
        if drop in asked and len(asked) > 1:
            fewer = {k: v for k, v in tries[-1].items() if k != drop}
            if fewer:
                tries.append(fewer)

    return tries

def _is(meta: dict, asked: dict) -> bool:
    """Does this chunk carry every label the question named?

    A paragraph's first subparagraph carries no label: only the text after a
    list is marked, as subparagraph 2 onwards.
    """
    for key, value in asked.items():
        if key == "subparagraph" and value == 1:
            if meta.get(key) is not None:
                return False
            continue
        if str(meta.get(key)) != str(value):
            return False
    return True


# Which named unit narrows the search most, when they cannot all be matched
# together: a page before an article, an article before its chapter.
_SPECIFICITY = ("page", "recital", "clause", "rule", "article", "section",
                "annex", "schedule", "chapter", "part")


def _groups(pairs: list[tuple[str, int | str]]) -> list[list[tuple[str, int | str]]]:
    """Group each named unit with its fallbacks: "section 5" -> [section 5, article 5]."""
    groups = []
    for field, value in pairs:
        if groups:
            head_field, head_value = groups[-1][0]
            if field in FALLBACKS.get(head_field, ()) and value == head_value:
                groups[-1].append((field, value))
                continue
        groups.append([(field, value)])

    return groups


def _alternatives(field: str, value: int | str) -> list[dict]:
    """Chroma filters for one named unit, the likeliest reading first.

    A page is the number printed on it, then the PDF's own page count; either
    way a passage running over several pages matches every page it touches.
    """
    if field != "page":
        return [{field: {"$eq": value}}]
    if not isinstance(value, int):
        return []

    return [
        {"$and": [{"printed_page": {"$lte": value}}, {"printed_page_end": {"$gte": value}}]},
        {"$and": [{"page": {"$lte": value}}, {"page_end": {"$gte": value}}]},
        {"page": {"$eq": value}},
    ]


def _group_filters(group: list[tuple[str, int | str]]) -> list[dict]:
    filters = []
    for field, value in group:
        filters.extend(_alternatives(field, value))
    return filters


def _rank(group: list[tuple[str, int | str]]) -> int:
    field = group[0][0]
    if field in _SPECIFICITY:
        return _SPECIFICITY.index(field)
    return len(_SPECIFICITY)


def _filters(groups: list[list[tuple[str, int | str]]], source: str | None) -> list[dict]:
    """Every filter to try, in order: all named units together, then each alone.

    "chapter 3 page 48" means the passage on page 48 inside chapter 3, not
    chapter 3's opening; the units are only tried separately when no passage
    carries them all.
    """
    ordered = sorted(groups, key=_rank)
    tries = []

    if len(ordered) > 1:
        for combination in itertools.product(*[_group_filters(g) for g in ordered]):
            tries.append(list(combination))

    for group in ordered:
        for single in _group_filters(group):
            tries.append([single])

    wheres = []
    for clauses in tries:
        if source:
            clauses = clauses + [{"source": {"$eq": source}}]
        if len(clauses) == 1:
            wheres.append(clauses[0])
        else:
            wheres.append({"$and": clauses})

    return wheres


def _present(metas: list[dict], asked: dict) -> dict:
    """The values each asked-for level actually takes in the provision:
    {"paragraph": [1, 2, 3]}, or an empty list where it has no such level."""
    present = {}
    for key in asked:
        values = []
        if key == "subparagraph":
            values.append(1)
        for meta in metas:
            value = meta.get(key)
            if value is not None and value not in values:
                values.append(value)
        present[key] = values

    return present


def exact_lookup(query_text: str, source: str | None, asked: dict):
    for where in _filters(_groups(parse_identifier(query_text)), source):
        chunks, metas = metadata_lookup({}, limit=_CEILING, where=where)
        if not chunks:
            continue

        note = {"exact": True, "asked": asked, "found": False, "route": "exact"}
        if asked:
            # "66(2)(e)" in a document whose article 66 has no paragraphs still
            # names point (e), so drop the outer labels before giving up.
            for wanted in _relaxations(asked):
                hits = [i for i, meta in enumerate(metas) if _is(meta, wanted)]
                if not hits:
                    continue
                note["found"] = True
                chunks = [chunks[i] for i in hits]
                metas = [metas[i] for i in hits]
                break

            if not note["found"]:
                note["present"] = _present(metas, asked)

        # Exact match on the requested identifier -- no similarity involved.
        return chunks, [0.0] * len(chunks), metas, note


    return None