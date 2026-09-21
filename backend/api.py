from contextlib import asynccontextmanager

from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from embedding.vector_store import (
    delete_document, get_document_stats, list_documents, metadata_lookup,
)
from pipeline.pipeline import ingest, answer_query, retrieve
from graph.store import delete_edges
from graph.neighbourhood import neighbours_of
from telemetry import snapshot
from generation import runtime
from settings import UPLOADS_DIR
import os, shutil

# Find (or start) the Ollama that answers questions when the server starts, and
# stop the one this backend started when it shuts down.
@asynccontextmanager
async def lifespan(_app: FastAPI):
    runtime.start()
    yield
    runtime.stop()

app = FastAPI(title='X-REF-RAG API', lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return{
        "status": "ok"
    }

@app.get("/setup")
def setup_status():
    """Whether the language model is ready, or what setting it up involves."""
    return runtime.status()

@app.post("/setup")
def setup_begin():
    """Download and start Ollama and the model, in the background."""
    runtime.begin_setup()
    return runtime.status()

@app.get("/stats")
def stats():
    return snapshot()

@app.get("/document/{doc_name}/stats")
def doc_stats_endpoint(doc_name: str):
    return get_document_stats(doc_name)


@app.get("/document/{doc_name}/provision")
def provision_endpoint(doc_name: str, kind: str, value: str):
    """Every chunk of one provision, in reading order."""
    where = value
    if value.isdigit():
        where = int(value)

    chunks, _ = metadata_lookup({kind: where, "source": doc_name}, limit=200)

    return chunks


@app.get("/document/{doc_name}/neighbours")
def neighbours_endpoint(doc_name: str, node: str):
    """What one provision cites and what cites it: node is "article:66"."""
    return neighbours_of(doc_name, node)

class QueryRequest(BaseModel):
    query: str
    source: str | None = None

@app.post("/upload")
def upload(file: UploadFile = File(...)):

    path = str(UPLOADS_DIR / os.path.basename(file.filename))

    with open(path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    count = ingest(path)

    return{
        "filename":file.filename,
        "chunks_indexed":count,
    }


@app.post("/query")
def query_endpoint(request: QueryRequest):
    """Answer a question: retrieval-augmented generation."""
    return answer_query(request.query, request.source)


@app.post("/retrieve")
def retrieve_endpoint(request: QueryRequest):
    """Find passages without an answer: behind the find: command."""
    return retrieve(request.query, request.source)

@app.get("/documents")
def documents_endpoint():
    documents = []
    for name, chunks in list_documents().items():
        documents.append({"name": name, "chunks": chunks})
    return documents

@app.delete("/document/{doc_name}")
def delete_endpoint(doc_name: str):
    delete_document(doc_name)
    delete_edges(doc_name)
    return {"deleted": doc_name}