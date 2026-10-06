from ingestion.references import extract_references


def found(text):

    return [

        (r["kind"],
        r["id"],
        r["paragraph"],
        r["instrument"],)

        for r in extract_references(text)
    ]

def text_dotted_numbers_and_plural_lists():
    #example
    text =  "fulfilling the conditions in Articles 3.9 and 3.10, satisfy the REB"
    assert found(text) == [("article", "3.9", None, None), ("article", "3.10", None, None)]

def test_a_heading_with_its_title_is_not_a_reference():
    assert found("Article 4.6 Subject to applicable legal requirements, individuals") == []

def test_a_reference_starting_a_line_is_still_a_reference():
    assert found("Article 6 shall apply to high-risk systems.") == [("article", 6, None, None)]

def test_paragraph_and_other_instruments():
    text = "As referred to in Article 5(2). Article 11 of Regulation (EU) 2019/2144, as does Article 114 TFEU."
    assert found(text) == [
        ("article", 5, 2, None),
        ("article", 11, None, "Regulation (EU) 2019/2144"),
        ("article", 114, None, "TFEU"),
    ]

def test_roman_numerals_lists():
    assert found("see Annexes I, II or III.") == [
        ("annex", "I", None, None),
        ("annex", "II", None, None),
        ("annex", "III", None, None),
    ]