import pytest
from pathlib import Path
from pipeline.pipeline import ingest, retrieve

FIXTURE = Path(__file__).parent / "fixtures" / "Architecture.pdf"


@pytest.mark.skipif(not FIXTURE.exists(), reason="fixture not present")
def test_retrieval_returns_passages_with_their_locations():
    ingest(str(FIXTURE))
    result = retrieve("What is an architectural pattern?", source="Architecture.pdf")

    assert len(result["sources"]) > 0
    assert all(isinstance(s, str) for s in result["sources"])
    assert len(result["retrieval"]) == len(result["sources"])
    assert "lookup" in result
