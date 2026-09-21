import json

import generation.basic_backend as basic
from generation.basic_backend import BasicBackend, _interleave_for_attention


def fake_chat(reply: str, seen: list):
    """Stands in for ollama.chat: records the prompt and returns `reply`."""
    def chat(model, messages, format, options):
        seen.append(messages[0]["content"])
        return {"message": {"content": reply}, "prompt_eval_count": 40, "eval_count": 12}
    return chat


def test_answer_and_detail_come_from_the_json(monkeypatch):
    seen = []
    reply = json.dumps({"answer": "The Board advises.", "detail": "Article 66, point d."})
    monkeypatch.setattr(basic.ollama, "chat", fake_chat(reply, seen))

    result = BasicBackend().generate("what does the Board do?", ["passage one"])

    assert result["finding"] == "The Board advises."
    assert result["detail"] == "Article 66, point d."
    assert result["sources"] == ["passage one"]


def test_a_reply_that_is_not_json_is_kept_as_the_answer(monkeypatch):
    seen = []
    monkeypatch.setattr(basic.ollama, "chat", fake_chat("plain words", seen))

    result = BasicBackend().generate("q", ["p"])

    assert result["finding"] == "plain words"
    assert result["detail"] == ""


def test_token_usage_is_reported(monkeypatch):
    seen = []
    monkeypatch.setattr(basic.ollama, "chat", fake_chat("{}", seen))

    usage = BasicBackend().generate("q", ["p"])["usage"]

    assert usage["prompt_tokens"] == 40
    assert usage["completion_tokens"] == 12
    assert usage["total_tokens"] == 52


def test_the_named_provision_is_pointed_out_to_the_model(monkeypatch):
    seen = []
    monkeypatch.setattr(basic.ollama, "chat", fake_chat("{}", seen))

    BasicBackend().generate("point 3 article 93", ["3. Authorised firms..."], focus="Article 93(3)")

    assert "The question names Article 93(3)" in seen[0]


def test_no_focus_line_without_a_named_provision(monkeypatch):
    seen = []
    monkeypatch.setattr(basic.ollama, "chat", fake_chat("{}", seen))

    BasicBackend().generate("what is capital?", ["p"])

    assert "The question names" not in seen[0]


def test_interleaving_keeps_the_first_passage_first():
    assert _interleave_for_attention(["a", "b", "c", "d", "e"]) == ["a", "c", "e", "d", "b"]
