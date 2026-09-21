import json
from generation import runtime
from generation.base import Base
from settings import MODEL

CONTEXT_WINDOW= 4096 #sized for gtx1650

def _grab(response, key: str) -> int:
    try:
        value = response[key]
    except (KeyError, TypeError, IndexError):
        value = None
    return int(value) if value else 0

def _interleave_for_attention(chunks: list[str]) -> list[str]:
    front, back = [], []
    for position, chunk in enumerate(chunks):
        if position % 2 == 0:
            front.append(chunk)
        else:
            back.append(chunk)
    back.reverse()

    return front + back

# Whichever Ollama the runtime found or set up.
def _chat(**request):
    return runtime.client().chat(**request)

class BasicBackend(Base):
    def generate(self, query: str, chunks: list[str], focus: str | None = None) -> dict:

        # Reordered for attention, but each passage keeps its own number, so
        # "[3]" in the answer is Source 3 in the citations pane.
        numbered = [f"[{i + 1}] {c}" for i, c in enumerate(chunks)]
        context = "\n\n".join(_interleave_for_attention(numbered))

        # The retrieval sent only the named piece; say so, or the model may
        # treat its passages as loose matches rather than the text asked about.
        named = ""
        if focus:
            named = f"The question names {focus}. The passages below are that text; answer from them.\n"

        prompt = (
            named
            + "You answer questions about a document using ONLY the numbered "
            "context passages below.\n"

            "Do two things:\n"

            "1. ANSWER: answer the question directly and briefly.\n"

            "2. DETAIL: say where in the document the answer comes from and what "
            "the surrounding text adds, citing passages by their number, e.g. [2]. "
            "If the document only names something without describing it, say so "
            "plainly instead of repeating the name.\n"

            "Do not add anything the passages do not say.\n"

            "If the passages do not contain the answer, say that they do not.\n"

            "Respond with a JSON object EXACTLY in this shape:\n"

            "{\n"
            '  "answer": "<direct answer to the question, plain text>",\n'
            '  "detail": "<where in the document it comes from and what it adds>"\n'
            "}\n\n"
            f"Context:\n{context}\n\nQuestion: {query}"
        )

        response = _chat(
            model=MODEL,
            messages=[{"role": "user", "content": prompt}],
            format="json",
            options={"temperature": 0, "num_ctx": CONTEXT_WINDOW},
        )

        raw = response["message"]["content"]

        try:
            data = json.loads(raw)
            finding = data.get("answer", raw)
            detail = data.get("detail", "")
            if finding is None:
                finding = ""
            if detail is None:
                detail = ""

        except (json.JSONDecodeError, ValueError, TypeError):
            finding = raw
            detail = ""

        prompt_tokens = _grab(response, "prompt_eval_count")
        completion_tokens = _grab(response, "eval_count")


        return {
            "finding": finding,
            "sources": chunks,
            "detail": detail,
            "usage": {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": prompt_tokens + completion_tokens,
                "context_window": CONTEXT_WINDOW
            }
        }