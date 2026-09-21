import os
from ingestion.pdf_reader import load_pdf, load_pdf_pages, printed_page_numbers
from ingestion.docx_reader import load_docx
from ingestion.text_reader import load_txt

def load_document(path: str) -> str:

    extract = os.path.splitext(path)[1].lower()

    loaders = {
        ".pdf": load_pdf,
        ".docx": load_docx,
        ".txt": load_txt,
    }

    if extract not in loaders:
        raise ValueError(f"Unsupported file type:{extract}")

    return loaders[extract](path)


def load_document_pages(path: str) -> list[tuple[int, str]]:
    """Same dispatch as load_document, but keeps page boundaries.
    Only PDFs have real pages; docx/txt come back as a single page 1.
    """
    extract = os.path.splitext(path)[1].lower()

    if extract == ".pdf":
        return load_pdf_pages(path)

    return [(1, load_document(path))]



def load_printed_pages(path: str) -> dict[int, int]:
    """PDF page -> printed page number, where the document prints one."""
    extract = os.path.splitext(path)[1].lower()
    if extract == ".pdf":
        return printed_page_numbers(path)

    return {}
