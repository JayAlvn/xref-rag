import re
import unicodedata
import wordninja
from collections import Counter

_JUNK_BLOCKS = re.compile(
    r'[─-╿'          # Box Drawing
    r'▀-▟'           # Block Elements
    r'■-◿'           # Geometric Shapes (■ □ ▪ ▫)
    r'☀-⛿'           # Miscellaneous Symbols
    # Private Use Area: symbol-font bullets (Wingdings etc.) that PDF
    # extraction copies as raw code points with no glyph in any real font.
    r'\uE000-\uF8FF'
    r'�'              # Replacement character
    r'￾￿]',          # Non-characters
    re.UNICODE
)

_SMART_QUOTES = str.maketrans({
    '–': '-', '—': '-', '‘': "'", '’': "'",
    '“': '"', '”': '"', '•': '-', '…': '...',
})

EDGE_LINES = 4

def line_signature(line: str) -> str:
    line = line.strip()
    if re.search(r"[A-Za-z]", line):
        return re.sub(r"\d+", "#", line)
    return line

def running_lines(pages: list[str]) -> set[str]:
    counts = Counter()
    for text in pages:
        lines = []
        for line in text.splitlines():
            if line.strip():
                lines.append(line.strip())
        
        edges = set()

        for line in lines[:EDGE_LINES] + lines[-EDGE_LINES:]:
            edges.add(line_signature(line))
        counts.update(edges)

    threshold = max(3, len(pages) // 2)

    furniture = set()

    for signature, n in counts.items():
        if n >= threshold:
            furniture.add(signature)
    

    return furniture

def _looks_glued(text: str) -> bool:
    """True when text lost its spaces (< 8% of chars are spaces)."""
    if not text:
        return False
    spaces = text.count(" ")
    return spaces / max(len(text), 1) < 0.08


def _reinsert_spaces(text: str) -> str:
    """Split glued letter-runs (12+ chars) with wordninja.
    'softwareforexternalrelease' -> 'software for external release'."""
    def split_run(match):
        return ' '.join(wordninja.split(match.group(0)))
    return re.sub(r'[A-Za-z]{12,}', split_run, text)


def clean_text(text: str) -> str:
    text = unicodedata.normalize('NFC', text)
    text = text.translate(_SMART_QUOTES)
    text = _JUNK_BLOCKS.sub('', text)
    # Strip control characters (keep \n and \t)
    text = re.sub(r'[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]', '', text)
    # Remove lines that are only a page number
    text = re.sub(r'^\s*\d+\s*$', '', text, flags=re.MULTILINE)
    # Collapse runs of spaces/tabs
    text = re.sub(r'[ \t]{2,}', ' ', text)
    # Collapse 3+ blank lines to 2
    text = re.sub(r'\n{3,}', '\n\n', text)
    text = text.strip()
    # Repair space-less extraction — applies to ALL file types (pdf/docx/txt)
    if _looks_glued(text):
        text = _reinsert_spaces(text)
    return text