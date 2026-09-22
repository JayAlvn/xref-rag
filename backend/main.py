import argparse
import logging
import logging.handlers
import os
import threading
import time

import psutil
import uvicorn

from api import app
from generation import runtime
from settings import DATA_DIR


# The desktop app passes its own process id. Once that process is gone --
# closed or crashed -- nothing is left to serve, so the backend exits too.
# The start time is compared as well: a process id can be reused by an
# unrelated program after the app has exited.
def exit_with(parent: int) -> None:
    try:
        started = psutil.Process(parent).create_time()
    except psutil.NoSuchProcess:
        os._exit(0)

    while True:
        time.sleep(2)
        try:
            if psutil.Process(parent).create_time() != started:
                break
        except psutil.NoSuchProcess:
            break

    # os._exit skips the server's own shutdown, so stop Ollama here.
    runtime.stop()
    os._exit(0)


# Errors on a user's computer are written to backend.log in the data folder,
# beside ollama.log: the packaged app has no console to show them in.
def log_to_file() -> None:
    handler = logging.handlers.RotatingFileHandler(
        DATA_DIR / "backend.log", maxBytes=1_000_000, backupCount=1, encoding="utf-8",
    )
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    handler.setLevel(logging.INFO)
    for name in ("", "uvicorn.error"):
        logging.getLogger(name).addHandler(handler)
    logging.getLogger("xref").setLevel(logging.INFO)


if __name__ == "__main__":
    log_to_file()
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--parent", type=int, default=0)
    args = parser.parse_args()

    if args.parent:
        threading.Thread(target=exit_with, args=(args.parent,), daemon=True).start()

    # 127.0.0.1 only: nothing outside this machine can reach the API, and
    # Windows does not ask the user for firewall permission.
    uvicorn.run(app, host="127.0.0.1", port=args.port)
