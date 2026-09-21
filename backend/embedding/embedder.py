from chromadb.utils.embedding_functions import ONNXMiniLM_L6_V2

# all-MiniLM-L6-v2 run by ONNX Runtime on the CPU: the same model and the
# same vectors as the sentence-transformers version, without PyTorch, which
# would add gigabytes to the installed and packaged program.
model = ONNXMiniLM_L6_V2()

def embed_text(text: str) -> list[float]:
    return [float(x) for x in model([text])[0]]

def embed_batch(batch_of_sentences: list[str]) -> list[list[float]]:
    return [[float(x) for x in vector] for vector in model(batch_of_sentences)]
