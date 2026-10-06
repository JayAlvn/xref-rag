from inspect import istraceback
import re 
from ingestion.structure import _UNIT, _NUMBER

#one cited identifier, with an optional paragraph: "5", "3.7A", "III", "5(2)"
_ITEM = rf"(?:{_NUMBER})(?:\(\d{{1,3}}\))?"

#a unit word, singular or plural, then one identifier or a list of them
#e.g "Article 5(2)", "Articles 3.9 and 3.10", "Annexes I, II or III"
_REFERENCE = re.compile(
    rf"\b((?i:{_UNIT}))(e?s)?\s+({_ITEM}(?:\s*(?:,|\band\b|\bor\b)\s*{_ITEM})*)(?!\w)"
)
#splits a matched list back into its identifiers
_ONE = re.compile(rf"({_NUMBER})(?:\((\d{{1,3}})\))?")

#points at another document
#e.g "Article 11 of Regulation .."
_OF_ANOTHER = re.compile(
    rf"\s+of\s+(?:the\s+)?(?!(?:{_UNIT})\b)"
    r"([A-Z][^,;:\n]{0,60}?)"
    r"(?=[,;:\n]|\.\s|\.$|\s+(?:of|and)\b|$)"
)

#three or more capitals after a number
#e.g "Artivle 114 TFEU"
_ACRONYM = re.compile(r"[ \t]+([A-Z]{3,})\b")

#returns true if the match sits alone, that is, a title, not reference
def _is_heading(text: str, start: int, end: int) -> bool:
    line_start = text.rfind("\n", 0, start) + 1
    line_end = text.find("\n", end)

    if line_end == -1:
        line_end = len(text)

    before = text[line_start:start].strip()
    after = text[end:line_end].strip()

    if before != "":
        return False
    if after == "":
        return True

    return after[0].isupper()

#determines if the text after reference names another document 
def _instrument(text: str, end: int) -> str | None:
    named = _OF_ANOTHER.match(text, end)
    if named:
        return named.group(1).strip()
    
    acronym = _ACRONYM.match(text, end)
    if acronym:
        return acronym.group(1)
    
    return None

def extract_references(text: str) -> list[dict]:

    refs = []
    seen = set()

    for match in _REFERENCE.finditer(text):
        plural = match.group(2)

        if plural is None and _is_heading(text, match.start(), match.end()):
            continue
        
        kind = match.group(1).lower()
        instrument = _instrument(text, match.end())

        for item in _ONE.finditer(match.group(3)):
            ident = item.group(1)
            if ident.isdigit():
                ident = int(ident)
        
            paragraph = item.group(2)
            if paragraph is not None:
                paragraph = int(paragraph)

            key = (kind, ident, instrument)
            if key in seen:
                continue
            seen.add(key)

            refs.append({
                "kind": kind,
                "id": ident,
                "paragraph": paragraph,
                "external": instrument is not None,
                "instrument": instrument,
            })

    return refs

if __name__ == "__main__":
    sample = (
    "Article 6\n"
    "Classification rules\n"
    "1. As referred to in Article 5(2) and Annex III, the requirements of\n"
    "Chapter III, Section 2 apply. Article 11 of Regulation (EU) 2019/2144\n"
    "applies, as does Article 114 TFEU. See also Article 5 of this Regulation.\n"
    )
    for ref in extract_references(sample):
        print(ref)

