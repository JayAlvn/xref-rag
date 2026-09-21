"""Structural markers in legal/regulatory documents.
Recitals, articles and chapters are addressable by number, so queries like
"clause 148" can be answered by an exact metadata filter. This module locates
those markers in extracted text; the chunker turns them into boundaries.
"""
import re

# A recital marker sits alone on its line: "(148)".
_CLAUSE = re.compile(r"^\((\d{1,3})\)[ \t]*$", re.M)
_UNIT = r"Article|Section|Clause|Rule|Annex|Schedule|Exhibit|Appendix|Chapter|Part|Title"

# Numbers like 58, 3.13, 3.7A, VII or B.
_NUMBER = r"\d{1,3}(?:\.\d{1,3})?[A-Z]?|[IVXLC]{1,7}|[A-Z]"

# A heading stands alone on its line, or is followed by its title.
_HEADING = re.compile(
    rf"^({_UNIT})\s+({_NUMBER})(?=[ \t]*$|[ \t]+(?-i:[A-Z]))",
    re.M | re.I,
)

_PARAGRAPH = re.compile(r"^(\d{1,2})\.\s+", re.M)

# Opens a line: "(e)", "(iv)", "e." or "iv.". Sequence decides which level it
# belongs to, since "(i)" is both a letter and a roman numeral.
_MARKER = re.compile(r"^(?:\(([a-z]{1,5})\)|([a-z]{1,5})\.)\s*(?=\S)", re.M)

_ROMANS = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii"]

# Sorts 58, 3.13, 3.7A, 50a so headings can be checked against the numbering.
_ORDER = re.compile(r"^(\d{1,3})(?:\.(\d{1,3}))?([A-Za-z]?)$")
_FIRST_MAX = 3   # a document starts at article 1, 1.1 or 2 -- never at 258

# How deep each kind of marker sits, outermost first. A marker takes over its
# own depth and closes everything deeper.
_DEPTH = {
    "annex": 0,
    "schedule": 0,
    "appendix": 0,
    "exhibit": 0,

    "part": 1,
    "title": 2,
    "chapter": 3,
    "section": 4,
    "article": 5,
    "recital": 5,
    "clause": 5,
    "rule": 5,
    "paragraph": 6,
    "point": 7,
    "subparagraph": 7,
    "subpoint":8,
}

# Where the text after a list's last item starts: that item ends a sentence and
# the next line opens a new one. "(d) ... pursuant to Article 92.\nIn fixing the
# amount of the fine ..." -- earlier items end with ";", "," or "and", so only
# the last one can close the list.
_LIST_END = re.compile(r"\.[ \t]*\n+(?=[A-Z])")


def _candidates(text: str, heading_starts: list[int]) -> list[tuple[int, str, int | str | None]]:

    events = []

    for pos in heading_starts:
        events.append((pos, "heading", None))

    for m in _PARAGRAPH.finditer(text):
        events.append((m.start(), "paragraph", int(m.group(1))))

    for m in _MARKER.finditer(text):
        token = m.group(1)
        if token is None:
            token = m.group(2)
        events.append((m.start(), "marker", token))
    
    events.sort(key=lambda event: event[0])
    
    return events

def _in_sequence(text: str, events: list[tuple[int, str, int | str | None]]) -> list[tuple[int, str, int | str]]:

    marks = []
    next_paragraph = None
    next_point = "a"
    next_subpoint = None

    for pos, kind, value in events:
        if kind == "heading":
            next_paragraph = 1
            next_point = "a"
            next_subpoint = None
        elif kind == "paragraph" and value == next_paragraph:
            before = text[max(0, pos - 200): pos].rstrip()
            if value == 1 or before.endswith((".", ";", ":")):
                marks.append((pos, "paragraph", value))
                next_paragraph = value + 1
                next_point = "a"
                next_subpoint = None
        elif kind == "marker" and next_paragraph is not None:
            if value == next_point:
                marks.append((pos, "point", value))
                next_point = chr(ord(value) + 1)
                next_subpoint = "i"
            elif value == next_subpoint:
                marks.append((pos, "subpoint", value))
                index = _ROMANS.index(value)
                if index + 1 < len(_ROMANS):
                    next_subpoint = _ROMANS[index + 1]
                else:
                    next_subpoint = None
   
    
    return marks

def _find_subdivisions(text: str, heading_starts: list[int]) -> list[tuple[int, str, int | str]]:
    return _in_sequence(text, _candidates(text, heading_starts))


def _closing_text(text: str, marks: list[tuple[int, str, int | str]]) -> list[tuple[int, str, int | None]]:
    """Mark the text that follows a paragraph's list of points.

    Such text applies to the whole paragraph, not to the last point: EU acts
    call it the paragraph's second subparagraph. Without this mark it would
    carry the last point's label. Outside a numbered paragraph there is no
    subparagraph to name, so the mark only ends the list (value None).
    """
    closing = []
    count = 1
    in_paragraph = False
    for i, (pos, kind, _) in enumerate(marks):
        if kind == "paragraph":
            count = 1
            in_paragraph = True
            continue
        if kind not in ("point", "subpoint", "subparagraph"):
            count = 1
            in_paragraph = False
            continue
        if kind not in ("point", "subpoint"):
            continue

        end = len(text)
        if i + 1 < len(marks):
            end = marks[i + 1][0]
            # Only the list's last item; the next item is still inside the list.
            if marks[i + 1][1] in ("point", "subpoint"):
                continue

        tail = _LIST_END.search(text, pos, end)
        if tail is None:
            continue
        if in_paragraph:
            count += 1
            closing.append((tail.end(), "subparagraph", count))
        else:
            closing.append((tail.end(), "subparagraph", None))

    return closing


def _find_recitals(text: str) -> list[tuple[int, str, int]]:
    """Locate recital markers, skipping footnote markers."""
    marks = []
    expected = 1
    for m in _CLAUSE.finditer(text):
        if int(m.group(1)) == expected:
            marks.append((m.start(), "recital", expected))
            expected += 1
    return marks

def _order_key(value: int | str) -> tuple[int, int, str] | None:
    """(major, minor, suffix) for 58, 3.13, 3.7A, 50a. None when not numbered."""
    m = _ORDER.match(str(value))
    if not m:
        return None
    minor = 0
    if m.group(2):
        minor = int(m.group(2))
    
    return (int(m.group(1)), minor, m.group(3).lower())


def find_markers(text: str) -> list[tuple[int, str, int | str]]:
    """Return (offset, kind, value) for every structural marker, in order."""

    marks = _find_recitals(text)
    heading_starts = []
    last_article = None

    for m in _HEADING.finditer(text):
        kind = m.group(1).lower()
        value = m.group(2)
        if value.isdigit():
            value = int(value)

        if kind == "article":
            key = _order_key(value)
            if key is None:
                continue
            if last_article is None and key[0] > _FIRST_MAX:
                continue
            if last_article is not None and key <= last_article:
                continue
            last_article = key

        marks.append((m.start(), kind, value))  
        heading_starts.append(m.start())
    marks += _find_subdivisions(text, heading_starts)
    marks.sort(key=lambda mark: mark[0])
    marks += _closing_text(text, marks)
    marks.sort(key=lambda mark: mark[0])

    return marks
