import hashlib
import os
import platform
import shutil
import socket
import subprocess
import sys
import tarfile
import threading
import time
import zipfile
from pathlib import Path

import httpx
import ollama
import psutil

from settings import (
    DATA_DIR, MODEL, MODELS_DIR, OLLAMA_CHECKSUMS, OLLAMA_DIR, OLLAMA_VERSION,
)

# Where an Ollama installed from ollama.com answers.
_SYSTEM_HOST = "127.0.0.1:11434"
_RELEASE = f"https://github.com/ollama/ollama/releases/download/{OLLAMA_VERSION}/"

_PID_FILE = DATA_DIR / "ollama.pid"
_LOG_FILE = DATA_DIR / "ollama.log"
_DOWNLOAD = DATA_DIR / "ollama-download.part"

# Approximate download sizes, shown before the user agrees to the download.
_ARCHIVE_BYTES = {
    "ollama-linux-amd64.tar.zst": 1_397_000_000,
    "ollama-windows-amd64.zip": 1_462_000_000,
}
_MODEL_BYTES = 2_019_377_376

# Room for the download, the unpacked program and the model: at most about
# 4.3 GB at once on Linux (Ollama 2.2 GB unpacked, the model 2.0 GB).
_SPACE_NEEDED = 6_000_000_000

_lock = threading.Lock()
_state = {
    "host": None,      # where Ollama answers, once one is known
    "source": None,    # "custom" (OLLAMA_HOST), "system" or "bundled"
    "client": None,
    "process": None,   # the Ollama this backend started, if any
    "working": False,  # setup is running
    "step": "",        # "download", "unpack", "start" or "model"
    "done": 0,
    "total": 0,
    "error": "",
}


def _report(**fields) -> None:
    with _lock:
        _state.update(fields)


# The standalone Ollama build for this computer, or None without one.
def _archive() -> str | None:
    if platform.machine().lower() not in ("x86_64", "amd64"):
        return None
    if sys.platform == "win32":
        return "ollama-windows-amd64.zip"
    if sys.platform.startswith("linux"):
        return "ollama-linux-amd64.tar.zst"
    return None


def _program() -> Path:
    if sys.platform == "win32":
        return OLLAMA_DIR / "ollama.exe"
    return OLLAMA_DIR / "bin" / "ollama"


def _answers(host: str) -> bool:
    try:
        return httpx.get(f"http://{host}/api/version", timeout=1).status_code == 200
    except httpx.HTTPError:
        return False


def _use(host: str, source: str) -> None:
    _report(host=host, source=source, client=ollama.Client(host=host))


def client() -> ollama.Client:
    current = _state["client"]
    if current is None:
        raise RuntimeError("The language model is not set up yet.")
    return current


def _has_model() -> bool:
    try:
        installed = client().list().models
    except Exception:
        return False
    for entry in installed:
        name = entry.model or ""
        if name == MODEL or name.startswith(MODEL + ":"):
            return True
    return False


# ----------------------------------------------------------------------------
# Starting and stopping


# Find an Ollama to use: one named by OLLAMA_HOST, then one already running on
# this computer, then the copy set up earlier in the data folder. Without any,
# the app offers to set one up. XREF_OLLAMA=bundled skips the first two.
def start() -> None:
    _stop_leftover()

    candidates = []
    if os.environ.get("XREF_OLLAMA") != "bundled":
        custom = os.environ.get("OLLAMA_HOST")
        if custom:
            candidates.append((custom, "custom"))
        candidates.append((_SYSTEM_HOST, "system"))

    for host, source in candidates:
        if _answers(host):
            _use(host, source)
            return

    if _program().exists():
        _serve()


# Start the copy in the data folder on a free port, with its models kept in
# the data folder, so it never meets an Ollama the user runs themselves.
def _serve() -> None:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    host = f"127.0.0.1:{port}"

    env = dict(os.environ)
    env["OLLAMA_HOST"] = host
    env["OLLAMA_MODELS"] = str(MODELS_DIR)

    flags = 0
    if sys.platform == "win32":
        flags = subprocess.CREATE_NO_WINDOW

    with open(_LOG_FILE, "ab") as log:
        process = subprocess.Popen(
            [str(_program()), "serve"], env=env, stdout=log, stderr=log,
            creationflags=flags,
        )
    _PID_FILE.write_text(str(process.pid))
    _report(process=process)
    _use(host, "bundled")


# Stop an Ollama together with the model runners it started.
def _end(process: psutil.Process) -> None:
    family = process.children(recursive=True) + [process]
    for member in family:
        try:
            member.terminate()
        except psutil.NoSuchProcess:
            pass
    _, alive = psutil.wait_procs(family, timeout=5)
    for member in alive:
        member.kill()


def stop() -> None:
    process = _state["process"]
    if process is None:
        return
    try:
        _end(psutil.Process(process.pid))
    except psutil.NoSuchProcess:
        pass
    _report(process=None)
    _PID_FILE.unlink(missing_ok=True)


# An Ollama this app started before a crash may still be holding its port.
def _stop_leftover() -> None:
    if not _PID_FILE.exists():
        return
    try:
        leftover = psutil.Process(int(_PID_FILE.read_text()))
        if Path(leftover.exe()).resolve() == _program().resolve():
            _end(leftover)
    except (ValueError, psutil.Error, OSError):
        pass
    _PID_FILE.unlink(missing_ok=True)


# ----------------------------------------------------------------------------
# Status and setup


def status() -> dict:
    with _lock:
        report = {
            "source": _state["source"],
            "working": _state["working"],
            "step": _state["step"],
            "done": _state["done"],
            "total": _state["total"],
            "error": _state["error"],
        }
        host = _state["host"]

    needs = []
    if host is None:
        needs = ["runtime", "model"]
    elif _answers(host) and not _has_model():
        needs = ["model"]

    download = 0
    if "runtime" in needs:
        download += _ARCHIVE_BYTES.get(_archive() or "", 0)
    if "model" in needs:
        download += _MODEL_BYTES

    state = "ready"
    if report["working"]:
        state = "working"
    elif report["error"]:
        state = "error"
    elif needs:
        state = "missing"
    elif not _answers(host):
        state = "starting"

    report.update(
        state=state, needs=needs, download_bytes=download,
        model=MODEL, ollama_version=OLLAMA_VERSION,
        automatic=_archive() is not None,
    )
    return report


def begin_setup() -> None:
    with _lock:
        if _state["working"]:
            return
        _state.update(working=True, error="", step="", done=0, total=0)
    threading.Thread(target=_set_up, daemon=True).start()


def _set_up() -> None:
    try:
        if _state["host"] is None:
            _install()
            _serve()
        _wait_until_answering()
        if not _has_model():
            _pull()
    except Exception as error:
        message = str(error)
        if not message:
            message = error.__class__.__name__
        _report(error=message)
    finally:
        _report(working=False, step="")


def _install() -> None:
    archive = _archive()
    if archive is None:
        raise RuntimeError(
            "Automatic setup is not available on this computer. Install Ollama "
            "from ollama.com, run `ollama pull llama3.2`, and restart xref-rag."
        )

    free = shutil.disk_usage(DATA_DIR).free
    if free < _SPACE_NEEDED:
        raise RuntimeError(
            f"Not enough disk space: setup needs about {_SPACE_NEEDED // 10**9} GB free, "
            f"but only {free / 10**9:.1f} GB is available."
        )

    _download(_RELEASE + archive, OLLAMA_CHECKSUMS[archive])
    _unpack(archive)
    _DOWNLOAD.unlink(missing_ok=True)


def _download(url: str, expected: str) -> None:
    _report(step="download", done=0, total=0)
    digest = hashlib.sha256()
    done = 0
    with httpx.stream("GET", url, follow_redirects=True, timeout=30) as response:
        response.raise_for_status()
        _report(total=int(response.headers.get("content-length", 0)))
        with open(_DOWNLOAD, "wb") as out:
            for block in response.iter_bytes(1 << 20):
                out.write(block)
                digest.update(block)
                done += len(block)
                _report(done=done)

    if digest.hexdigest() != expected:
        _DOWNLOAD.unlink(missing_ok=True)
        raise RuntimeError(
            "The Ollama download did not match its published checksum and was "
            "discarded. Try again."
        )


# Unpack beside the final folder and rename it into place, so a copy that was
# only half unpacked is never taken for an installed one.
def _unpack(archive: str) -> None:
    _report(step="unpack", done=0, total=0)
    staging = OLLAMA_DIR.with_name("ollama-unpacking")
    shutil.rmtree(staging, ignore_errors=True)
    staging.mkdir(parents=True)

    if archive.endswith(".zip"):
        with zipfile.ZipFile(_DOWNLOAD) as zipped:
            zipped.extractall(staging)
    else:
        import zstandard

        with open(_DOWNLOAD, "rb") as packed:
            with zstandard.ZstdDecompressor().stream_reader(packed) as stream:
                with tarfile.open(fileobj=stream, mode="r|") as tar:
                    tar.extractall(staging, filter="data")

    shutil.rmtree(OLLAMA_DIR, ignore_errors=True)
    staging.rename(OLLAMA_DIR)


def _wait_until_answering() -> None:
    _report(step="start")
    for _ in range(120):
        if _answers(_state["host"]):
            return
        time.sleep(0.5)
    raise RuntimeError(f"Ollama did not start. Its log is in {_LOG_FILE}.")


def _pull() -> None:
    _report(step="model", done=0, total=0)
    layers = {}
    for progress in client().pull(MODEL, stream=True):
        if progress.digest and progress.total:
            layers[progress.digest] = (progress.completed or 0, progress.total)
            _report(
                done=sum(completed for completed, _ in layers.values()),
                total=sum(total for _, total in layers.values()),
            )
