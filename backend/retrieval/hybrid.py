import difflib
import itertools
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

# Short forms written in citations: "Art. 66", "Sec. 4".
_SHORT = {"art": "article", "sec": "section", "cha": "chapter", "ch": "chapter"}

# The number may be dotted or carry a letter: 58, 9.9, 3.7A.
_IDENTIFIER = re.compile(
    r"\b(" + "|".join(_UNIT_WORDS + tuple(_SHORT)) + r")s?\.?\s*(?:no\.?\s*|number\s*)?(\d{1,4}(?:\.\d{1,3})?[A-Za-z]?)\b",
    re.I,
)

# A query word is tried as its own metadata key first. These add a second
# try for conventions where people name a unit by another word -- in EU
# regulation, "clause 148" means recital 148.
_FALLBACKS = {
    "clause": ("recital",),
    "section": ("article",),
}

# A misspelled unit word still names a provision: "artilce 66".
_LOOSE = re.compile(r"\b([a-z]{4,10})\s*\.?\s*(\d{1,4}(?:\.\d{1,3})?[A-Za-z]?)\b", re.I)


def _unit_like(word: str) -> str | None:
    """The unit word this one was probably meant to be, or None."""
    near = difflib.get_close_matches(word.lower(), _UNIT_WORDS, n=1, cutoff=0.75)
    if near:
        return near[0]
    return None


def parse_identifier(query_text: str) -> list[tuple[str, int | str]]:
    """Extract (metadata field, value) pairs naming a part of the document.

    Plain numbers stay integers to match how the chunker stores them; anything
    else stays text, upper-cased so "3.7a" matches the stored "3.7A".
    """
    found = []
    page = None

    for word, number in _IDENTIFIER.findall(query_text):
        word = word.lower()
        word = _SHORT.get(word, word)
        value = number.upper()
        if number.isdigit():
            value = int(number)

        if word == "page":
            page = value
            continue

        found.append((word, value))
        for fallback in _FALLBACKS.get(word, ()):
            found.append((fallback, value))

    if page is not None:
        found.append(("page", page))

    if found:
        return found

    # Nothing matched exactly: allow for a slip of the keyboard.
    for word, number in _LOOSE.findall(query_text):
        unit = _unit_like(word)
        if unit is None or unit == "page":
            continue
        value = number.upper()
        if number.isdigit():
            value = int(number)
        found.append((unit, value))
        for fallback in _FALLBACKS.get(unit, ()):
            found.append((fallback, value))

    return found

# "paragraph 2", "para 2", "66(2)"
_PARAGRAPH_ASKED = re.compile(r"(?:\b(?:paragraph|subsection|para)\.?\s*\(?|\d\s*\()(\d{1,2})\)?", re.I)

# "point d", "point (iv)", "letter e", "subpoint ii", and "point 3", which
# people say for a numbered paragraph.
_POINT_ASKED = re.compile(
    r"\b(?:point|letter|subpoint|item)\.?\s*\(?([a-z]{1,5}|\d{1,2})\)?(?![a-z0-9])",
    re.I,
)

# "second subparagraph", "2nd subparagraph", "subparagraph 2"
_ORDINALS = {"first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5,
             "1st": 1, "2nd": 2, "3rd": 3, "4th": 4, "5th": 5}
_SUBPARAGRAPH_ASKED = re.compile(
    r"\b(?:(" + "|".join(_ORDINALS) + r")\s+sub-?paragraph|sub-?paragraph\s*\(?(\d)\)?)",
    re.I,
)

# a bare "(d)" or "(iv)" anywhere in the question
_BRACKETED = re.compile(r"\(([a-z]{1,5})\)")

_ROMAN = re.compile(r"^[ivx]{2,5}$")

# The whole provision is fetched, then the named part is brought to the front.
_CEILING = 200


def parse_subdivision(query_text: str) -> dict:
    """Which paragraph, point or sub-point the question names.

    A single letter is a point; two or more roman letters are a sub-point, so
    "point (i)" reads as a point and "point (iv)" as a sub-point. A digit is a
    paragraph: "point 3" and "paragraph 3" name the same thing.
    """
    asked = {}

    paragraph = _PARAGRAPH_ASKED.search(query_text)
    if paragraph:
        asked["paragraph"] = int(paragraph.group(1))

    subparagraph = _SUBPARAGRAPH_ASKED.search(query_text)
    if subparagraph:
        if subparagraph.group(1):
            asked["subparagraph"] = _ORDINALS[subparagraph.group(1).lower()]
        else:
            asked["subparagraph"] = int(subparagraph.group(2))

    tokens = []
    for m in _POINT_ASKED.finditer(query_text):
        tokens.append(m.group(1).lower())
    for m in _BRACKETED.finditer(query_text):
        tokens.append(m.group(1).lower())

    for token in tokens:
        if token.isdigit():
            asked.setdefault("paragraph", int(token))
        elif _ROMAN.match(token):
            asked.setdefault("subpoint", token)
        elif len(token) == 1:
            asked.setdefault("point", token)

    return asked


# Words that can sit around a reference without asking anything:
# "show me the text of paragraph 2 in article 7".
_FILLER = {"of", "in", "the", "and", "to", "under", "show", "me", "text",
           "full", "whole", "please", "see", "read"}

_WORD = re.compile(r"[a-z0-9]+", re.I)


def is_reference_only(query_text: str) -> bool:
    """True when the query names a part of the document and asks nothing
    about it: "paragraph 1 article 101", "Art. 66(2)(e)"."""
    if not parse_identifier(query_text):
        return False

    rest = query_text
    # Subdivisions first: "101(1)" loses its "(1)" before "article 101" goes.
    for pattern in (_SUBPARAGRAPH_ASKED, _PARAGRAPH_ASKED, _POINT_ASKED, _BRACKETED,
                    _IDENTIFIER, _LOOSE):
        rest = pattern.sub(" ", rest)

    for word in _WORD.findall(rest):
        if word.lower() not in _FILLER and not word.isdigit():
            return False
    return True


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
            if field in _FALLBACKS.get(head_field, ()) and value == head_value:
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


# A general question gets every passage about as close to it as the best one:
# within _MARGIN cosine similarity, never fewer than _FEWEST (a lone passage is
# often cut mid-sentence) and never more than _MOST.
_CANDIDATES = 12
_MARGIN = 0.15
_FEWEST = 3
_MOST = 8


def _close_to_best(chunks: list[str], distances: list[float], metas: list[dict]):
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


def route_search(query_text: str, source: str | None = None):
    """Retrieve for a query, picking exact lookup over similarity when possible.

    A named piece ("paragraph 2 of Article 7") comes back alone and whole; a
    named provision comes back whole, in reading order; anything else gets the
    passages closest to it. The note says which, what subdivision the question
    named, whether it was found, and what the provision has instead if not.
    """
    asked = parse_subdivision(query_text)

    for where in _filters(_groups(parse_identifier(query_text)), source):
        chunks, metas = metadata_lookup({}, limit=_CEILING, where=where)
        if not chunks:
            continue

        note = {"exact": True, "asked": asked, "found": False}
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

    chunks, distances, metas = _close_to_best(
        *hybrid_search(query_text, source=source, n=_CANDIDATES))

    return chunks, distances, metas, {"exact": False, "asked": asked, "found": False}
