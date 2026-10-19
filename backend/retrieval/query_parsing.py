import difflib
import re

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
FALLBACKS = {
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
        for fallback in FALLBACKS.get(word, ()):
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
        for fallback in FALLBACKS.get(unit, ()):
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