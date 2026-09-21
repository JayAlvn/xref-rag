import logging
import re
from collections import Counter

logging.basicConfig(level=logging.INFO)

# Anything sitting below this fraction of the page is a running header/footer.
_FOOTER_ZONE = 0.95

#to see 
def _page_text(page) -> str:
    """A page's body text, with footnotes and the running footer removed.

    Both sit visually below the body but land mid-stream once the layout is
    flattened to text, which splices a footnote into the middle of the very
    clause that cites it. They are the trailing run of lines that are either
    smaller than the body text or down in the page margin -- a clause marker
    like "(148)" is also small, but always has body text below it, so the
    walk stops before reaching it.
    """
    lines, weight = [], Counter()
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            text = "".join(span["text"] for span in line["spans"])
            if not text.strip():
                continue
            size = round(max(span["size"] for span in line["spans"]), 1)
            lines.append((round(line["bbox"][1], 1), size, text))
            weight[size] += len(text)

    if not lines:
        return ""

    body_size = weight.most_common(1)[0][0]
    cutoff = page.rect.height * _FOOTER_ZONE

    furniture = set()
    for i in sorted(range(len(lines)), key=lambda i: lines[i][0], reverse=True):
        top, size, _ = lines[i]
        if size < body_size or top > cutoff:
            furniture.add(i)
        else:
            break

    # Emit in extraction order, which is reading order; only filter.
    return "\n".join(t for i, (_, _, t) in enumerate(lines) if i not in furniture)


def load_pdf_pages(path: str) -> list[tuple[int, str]]:
    """Extract a PDF one page at a time as (1-based page number, text).

    Page numbers survive into chunk metadata, so an identifier lookup
    ("page 37/144") can be answered by an exact filter instead of a
    similarity search.
    """
    logging.info(f"loading the pdf: {path}")
    try:
        import fitz  # PyMuPDF
        doc = fitz.open(path)
        pages = [(i + 1, _page_text(page)) for i, page in enumerate(doc)]
        doc.close()
        if any(text.strip() for _, text in pages):
            logging.info("Success: extracted text from PDF (PyMuPDF)")
            return pages
    except ImportError:
        logging.info("PyMuPDF is not installed; falling back to pypdf.")
    except Exception as e:
        logging.info(f"PyMuPDF failed ({e}); falling back to pypdf.")

    try:
        from pypdf import PdfReader
        reader = PdfReader(path)
        logging.info("Success: extracted text from PDF (pypdf)")
        return [(i + 1, page.extract_text() or "")
                for i, page in enumerate(reader.pages)]
    except Exception as e:
        print(f"Error loading pdf file {e}")
        return []


# Where a printed page number lives: the top and bottom strips of the page.
_MARGIN = 0.08

# A number at either end of a line, or before a slash: "48", "48 TCPS 2 (2022)",
# "L 176/5", "5/144".
_EDGE_NUMBERS = re.compile(r"^(\d{1,4})\b|\b(\d{1,4})$|\b(\d{1,4})\s*/\s*\d{1,4}$")

# Share of pages that must agree before a numbering is trusted. A document
# numbered by subpart ("3.8-2") never reaches it, and gets no printed pages.
_AGREEMENT = 0.5


def _margin_numbers(page) -> set[int]:
    """Numbers standing at the ends of lines in the page's top and bottom strips."""
    height = page.rect.height
    found = set()
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            top = line["bbox"][1]
            if height * _MARGIN < top < height * (1 - _MARGIN):
                continue
            text = "".join(span["text"] for span in line["spans"]).strip()
            for match in _EDGE_NUMBERS.finditer(text):
                for value in match.groups():
                    if value is not None:
                        found.add(int(value))

    return found


def printed_page_numbers(path: str) -> dict[int, int]:
    """Map each PDF page (1-based) to the number printed on it.

    Front matter pushes the printed numbering behind the PDF's own: TCPS 2
    prints "48" on PDF page 56. The number sits in the footer the text
    extraction drops, so it is read by position instead. The gap between PDF
    page and printed number that most pages agree on is the document's offset.
    """
    import fitz

    doc = fitz.open(path)
    offsets = Counter()
    for i, page in enumerate(doc):
        gaps = set()
        for value in _margin_numbers(page):
            gaps.add(i + 1 - value)
        offsets.update(gaps)
    total = len(doc)
    doc.close()

    if not offsets:
        return {}

    offset, agreeing = offsets.most_common(1)[0]
    if agreeing < max(3, total * _AGREEMENT):
        return {}

    printed = {}
    for number in range(1, total + 1):
        if number - offset >= 1:
            printed[number] = number - offset

    return printed


def load_pdf(path: str) -> str:
    return "\n".join(text for _, text in load_pdf_pages(path))


def load_pdf_metadata(path: str) -> dict:
    from pypdf import PdfReader
    reader = PdfReader(path)
    metadata = reader.metadata
    return {
        "author": metadata.author,
        "title": metadata.title,
        "creation_date": metadata.creation_date,
    }
