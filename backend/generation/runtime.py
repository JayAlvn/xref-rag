import hashlib
import json
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

from settings import DATA_DIR, MODEL, OLLAMA_CHECKSUMS, OLLAMA_VERSION

# Where an Ollama installed from ollama.com answers.
_SYSTEM_HOST = "127.0.0.1:11434"
_RELEASE = f"https://github.com/ollama/ollama/releases/download/{OLLAMA_VERSION}/"

_PID_FILE = DATA_DIR / "ollama.pid"
_LOG_FILE = DATA_DIR / "ollama.log"
_STORAGE_FILE = DATA_DIR / "storage.json"

# Approximate download sizes, shown before the user agrees to the download.
_ARCHIVE_BYTES = {
    "ollama-linux-amd64.tar.zst": 1_397_000_000,
    "ollama-windows-amd64.zip": 1_462_000_000,
}
_MODEL_BYTES = 2_019_377_376

# Room for the download, the unpacked program and the model: at most about
# 4.3 GB at once on Linux (Ollama 2.2 GB unpacked, the model 2.0 GB). With
# Ollama already in place, only the model is still to come.
_SPACE_NEEDED = 6_000_000_000
_SPACE_FOR_MODEL = 3_000_000_000

# Drives a 2 GB model file should not be kept on.
_FAT = ("vfat", "fat", "fat32", "msdos")

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


# ----------------------------------------------------------------------------
# Where Ollama and the model are kept


# The folder chosen on the setup screen, or the suggested one until then.
def storage() -> Path:
    try:
        chosen = json.loads(_STORAGE_FILE.read_text(encoding="utf-8")).get("folder")
    except (OSError, ValueError, AttributeError):
        chosen = None
    if chosen:
        return Path(chosen)
    return suggested_storage()


# The app's data folder, unless Ollama could not load a model from it: on
# Windows, a user name in Cyrillic or other non-Latin letters puts such letters
# in the path, and then the drive's own xref-rag folder is suggested instead.
def suggested_storage() -> Path:
    if sys.platform == "win32" and not str(DATA_DIR).isascii():
        drive = os.environ.get("SystemDrive", "C:")
        return Path(drive + "\\") / "xref-rag"
    return DATA_DIR


def _ollama_dir() -> Path:
    return storage() / "ollama"


def _models_dir() -> Path:
    return storage() / "models"


def _download_file() -> Path:
    return storage() / "ollama-download.part"


def _program() -> Path:
    if sys.platform == "win32":
        return _ollama_dir() / "ollama.exe"
    return _ollama_dir() / "bin" / "ollama"


def _inside(path: Path, parent: str) -> bool:
    try:
        path.resolve().relative_to(Path(parent).resolve())
        return True
    except (ValueError, OSError):
        return False


# The nearest folder on the way to `path` that already exists.
def _existing(path: Path) -> Path | None:
    for candidate in [path] + list(path.parents):
        if candidate.exists():
            return candidate
    return None


# The mounted drive holding `path`, as psutil describes it.
def _partition(path: Path):
    best = None
    try:
        for partition in psutil.disk_partitions(all=False):
            if _inside(path, partition.mountpoint):
                if best is None or len(partition.mountpoint) > len(best.mountpoint):
                    best = partition
    except OSError:
        return None
    return best


def _on_network_drive(folder: Path) -> bool:
    text = str(folder)
    if text.startswith("\\\\") or text.startswith("//"):
        return True
    if sys.platform != "win32":
        return False
    import ctypes

    drive_remote = 4
    root = folder.anchor
    return bool(root) and ctypes.windll.kernel32.GetDriveTypeW(root) == drive_remote


def _space_needed(folder: Path) -> int:
    program = folder / "ollama" / "bin" / "ollama"
    if sys.platform == "win32":
        program = folder / "ollama" / "ollama.exe"
    if program.exists():
        return _SPACE_FOR_MODEL
    return _SPACE_NEEDED


# Why Ollama and the model cannot be kept in `folder`, or "" when they can.
# With `create`, the folder is made and written to; otherwise only its nearest
# existing parent is looked at, so checking a path as it is typed changes nothing.
def _storage_problem(folder: Path, create: bool) -> str:
    if not folder.is_absolute():
        return "Choose a full path, such as " + str(suggested_storage()) + "."
    if sys.platform == "win32" and not str(folder).isascii():
        return ("Ollama cannot load a model from a path with non-Latin letters. "
                "Choose a path with only Latin letters and digits, such as C:\\xref-rag.")
    if _on_network_drive(folder):
        return "Choose a folder on this computer: loading the model over a network is too slow."
    for variable in ("OneDrive", "OneDriveConsumer", "OneDriveCommercial"):
        synced = os.environ.get(variable)
        if synced and _inside(folder, synced):
            return "Choose a folder outside OneDrive: it would upload the 4 GB model."

    partition = _partition(folder)
    if partition is not None:
        if partition.fstype.lower() in _FAT:
            return "Choose a drive formatted as NTFS or ext4: this one cannot hold large files reliably."
        if sys.platform.startswith("linux") and "noexec" in partition.opts.split(","):
            return "Programs cannot run from this drive (it is mounted noexec). Choose another."

    parent = _existing(folder)
    if parent is None:
        return "This drive does not exist."
    if create:
        try:
            folder.mkdir(parents=True, exist_ok=True)
            probe = folder / ".xref-rag-write-test"
            probe.write_bytes(b"ok")
            probe.unlink()
        except OSError:
            return "xref-rag cannot write to this folder. Choose one in your own files."
    elif not os.access(parent, os.W_OK):
        return "xref-rag cannot write to this folder. Choose one in your own files."

    free = shutil.disk_usage(parent).free
    needed = _space_needed(folder)
    if free < needed:
        return (f"Not enough space: about {needed // 10**9} GB is needed, "
                f"and {free / 10**9:.1f} GB is free on this drive.")
    return ""


def check_storage(text: str) -> dict:
    folder = Path(text.strip()).expanduser()
    free = 0
    parent = _existing(folder)
    if parent is not None:
        free = shutil.disk_usage(parent).free
    return {
        "folder": str(folder),
        "problem": _storage_problem(folder, create=False),
        "free_bytes": free,
        "needed_bytes": _space_needed(folder),
    }


def _choose_storage(text: str) -> None:
    if _state["process"] is not None:
        raise ValueError("Ollama is running from the current folder; restart xref-rag to change it.")
    folder = Path(text.strip()).expanduser()
    problem = _storage_problem(folder, create=True)
    if problem:
        raise ValueError(problem)
    _STORAGE_FILE.write_text(json.dumps({"folder": str(folder)}), encoding="utf-8")


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


# Asked directly with a short timeout: while Ollama starts, a question through
# the client can wait long enough to stall the setup screen.
def _has_model() -> bool:
    host = _state["host"]
    if host is None:
        return False
    try:
        installed = httpx.get(f"http://{host}/api/tags", timeout=2).json().get("models", [])
    except (httpx.HTTPError, ValueError):
        return False
    for entry in installed:
        name = entry.get("model") or entry.get("name") or ""
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
    env["OLLAMA_MODELS"] = str(_models_dir())

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
        storage=check_storage(str(storage())),
        suggested_storage=str(suggested_storage()),
    )
    return report


# Starts setting up in the background; `folder`, when given, is where Ollama
# and the model go. A folder that cannot be used raises ValueError at once.
def begin_setup(folder: str | None = None) -> None:
    if _state["working"]:
        return
    if folder:
        _choose_storage(folder)
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

    problem = _storage_problem(storage(), create=True)
    if problem:
        raise RuntimeError(problem)

    _download(_RELEASE + archive, OLLAMA_CHECKSUMS[archive])
    _unpack(archive)
    _download_file().unlink(missing_ok=True)


def _download(url: str, expected: str) -> None:
    _report(step="download", done=0, total=0)
    digest = hashlib.sha256()
    done = 0
    with httpx.stream("GET", url, follow_redirects=True, timeout=30) as response:
        response.raise_for_status()
        _report(total=int(response.headers.get("content-length", 0)))
        with open(_download_file(), "wb") as out:
            for block in response.iter_bytes(1 << 20):
                out.write(block)
                digest.update(block)
                done += len(block)
                _report(done=done)

    if digest.hexdigest() != expected:
        _download_file().unlink(missing_ok=True)
        raise RuntimeError(
            "The Ollama download did not match its published checksum and was "
            "discarded. Try again."
        )


# Unpack beside the final folder and rename it into place, so a copy that was
# only half unpacked is never taken for an installed one.
def _unpack(archive: str) -> None:
    _report(step="unpack", done=0, total=0)
    target = _ollama_dir()
    staging = target.with_name("ollama-unpacking")
    shutil.rmtree(staging, ignore_errors=True)
    staging.mkdir(parents=True)

    if archive.endswith(".zip"):
        with zipfile.ZipFile(_download_file()) as zipped:
            zipped.extractall(staging)
    else:
        import zstandard

        with open(_download_file(), "rb") as packed:
            with zstandard.ZstdDecompressor().stream_reader(packed) as stream:
                with tarfile.open(fileobj=stream, mode="r|") as tar:
                    tar.extractall(staging, filter="data")

    shutil.rmtree(target, ignore_errors=True)
    staging.rename(target)


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
