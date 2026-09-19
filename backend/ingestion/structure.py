"""Structural markers in legal/regulatory documents.
Recitals, articles and chapters are addressable by number, so queries like
"clause 148" can be answered by an exact metadata filter. This module locates
those markers in extracted text; the chunker turns them into boundaries.
"""
import re

# A recital marker sits alone on its line: "(148)".
_CLAUSE = re.compile(r"^\((\d{1,3})\)[ \t]*$", re.M)
_UNIT = r"Article|Section|Clause|Rule|Annex|Schedule|Exhibit|Appendix|Chapter|Part|Title"

_HEADING = re.compile(
    rf"^({_UNIT})\s+(\d{{1,3}}|[IVXLC]{{1,7}}|[A-Z])[ \t]*$",
    re.M | re.I,
)
#Paragraphs e.g : "2. The .."
_PARAGRAPH = re.compile(r"^(\d{1,2})\.\s+", re.M)

#A point opens a line with one ltetter in brackets: "(e) this regulation is .."
_POINT = re.compile(r"^\(([a-z])\)\s+", re.M)

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
}


def _candidates(text: str, heading_starts: list[int]) -> list[tuple[int, str, int | str | None]]:

    events = []

    for pos in heading_starts:
        events.append((pos, "heading", None))

    for m in _PARAGRAPH.finditer(text):
        events.append((m.start(), "paragraph", int(m.group(1))))

    for m in _POINT.finditer(text):
        events.append((m.start(), "point", m.group(1)))
    
    events.sort(key=lambda event: event[0])
    
    return events

def _in_sequence(text: str, events: list[tuple[int, str, int | str | None]]) -> list[tuple[int, str, int | str]]:

    marks = []
    next_paragraph = None
    next_point = "a"

    for pos, kind, value in events:
        if kind == "heading":
            next_paragraph = 1
            next_point = "a"
        elif kind == "paragraph" and value == next_paragraph:
            before = text[max(0, pos - 200): pos].rstrip()
            if value == 1 or before.endswith((".", ";", ":")):
                marks.append((pos, "paragraph", value))
                next_paragraph = value + 1
                next_point = "a"
        elif kind == "point" and next_paragraph is not None and value == next_point:
            marks.append((pos, "point", value))
            next_point = chr(ord(value) + 1)

    
    return marks

def _find_subdivisions(text: str, heading_starts: list[int]) -> list[tuple[int, str, int | str]]:
    return _in_sequence(text, _candidates(text, heading_starts))


def _find_recitals(text: str) -> list[tuple[int, str, int]]:
    """Locate recital markers, skipping footnote markers."""
    marks = []
    expected = 1
    for m in _CLAUSE.finditer(text):
        if int(m.group(1)) == expected:
            marks.append((m.start(), "recital", expected))
            expected += 1
    return marks


def find_markers(text: str) -> list[tuple[int, str, int | str]]:
    """Return (offset, kind, value) for every structural marker, in order."""

    marks = _find_recitals(text)
    heading_starts = []

    for m in _HEADING.finditer(text):
        kind = m.group(1).lower()
        value = m.group(2)
        if value.isdigit():
            value = int(value)
        marks.append((m.start(), kind, value))  
        heading_starts.append(m.start())
    marks += _find_subdivisions(text, heading_starts)
    marks.sort(key=lambda mark: mark[0])

    return marks
