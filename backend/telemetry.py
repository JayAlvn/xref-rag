import functools
import platform
import re

import psutil

try:
    import pynvml
    pynvml.nvmlInit()  # once, at import, not per request
    _HANDLE = pynvml.nvmlDeviceGetHandleByIndex(0)
except Exception:
    _HANDLE = None


def _cpu_model() -> str:
    system = platform.system()
    if system == "Linux":
        try:
            with open("/proc/cpuinfo") as f:
                m = re.search(r"^model name\s*:\s*(.+)$", f.read(), re.M)
                if m:
                    return m.group(1).strip()
        except OSError:
            pass
    elif system == "Darwin":
        import subprocess
        try:
            return subprocess.check_output(
                ["sysctl", "-n", "machdep.cpu.brand_string"], text=True).strip()
        except Exception:
            pass

    return platform.processor() or platform.machine()


def _gpu() -> dict | None:
    if _HANDLE is None:
        return None
    mem = pynvml.nvmlDeviceGetMemoryInfo(_HANDLE)
    name = pynvml.nvmlDeviceGetName(_HANDLE)
    return {
        "name": name.decode() if isinstance(name, bytes) else name,
        "util": pynvml.nvmlDeviceGetUtilizationRates(_HANDLE).gpu,
        "vram_used_mb": mem.used // 1024 ** 2,
        "vram_total_mb": mem.total // 1024 ** 2,
        "temp_c": pynvml.nvmlDeviceGetTemperature(_HANDLE, pynvml.NVML_TEMPERATURE_GPU),
    }

def _cpu_temp() -> float | None:
    try:
        temps = psutil.sensors_temperatures()
        if not temps:
            return None

        for name in ("coretemp", "k10temp", "zenpower", "cpu_termal", "acpitz"):
           if name in temps and temps[name]:
            for entry in temps[name]:
                if entry.label and ("package" in entry.label.lower() or "tctl" in entry.label.lower()):
                    return entry.current
                return temps[name][0].current

        for entries in temps.values():
            if entries:
                return entries[0].current
    except Exception:
        pass 
    return None
            


def _cpu() -> dict:
    """Live CPU load.
    interval=None is non-blocking: it averages since the previous call, so the
    very first reading after startup is 0.0. Passing interval=1 instead would
    freeze the request handler for a full second.
    """
    vm = psutil.virtual_memory()
    return {
        "util": psutil.cpu_percent(interval=None),
        "temp_c": _cpu_temp(),
        "ram_used_gb": round((vm.total - vm.available) / 1024 ** 3, 1),
        "ram_total_gb": round(vm.total / 1024 ** 3, 1),
    }

def _model() -> dict | None:
    """Which model is resident, and how much of it sits in VRAM.
    An empty list means Ollama evicted the model after its idle timeout, so the
    next query pays a full reload before it emits a single token -- which is
    what the UI warns about before you press send.
    """
    from generation import runtime
    try:
        running = runtime.client().ps().models
    except Exception:
        return None
    if not running:
        return {"loaded": False}

    m = running[0]
    total = getattr(m, "size", 0) or 0
    vram = getattr(m, "size_vram", 0) or 0
    return {
        "loaded": True,
        "name": m.model,
        "gpu_percent": round(vram / total * 100) if total else 0,
        "size_gb": round(total / 1024 ** 3, 1),
    }


@functools.lru_cache(maxsize=1)
def specs() -> dict:
    vm = psutil.virtual_memory()
    gpu = _gpu()
    return {
        "cpu": _cpu_model(),
        # logical=False returns None on some virtualised hosts.
        "cores": psutil.cpu_count(logical=False) or psutil.cpu_count(logical=True),
        "threads": psutil.cpu_count(logical=True),
        "ram_total_gb": round(vm.total / 1024 ** 3, 1),
        "gpu": gpu["name"] if gpu else None,
        "vram_total_mb": gpu["vram_total_mb"] if gpu else None,
        "os": f"{platform.system()} {platform.release()}",
    }


def snapshot() -> dict:
    return {"specs": specs(), "gpu": _gpu(), "cpu": _cpu(), "model": _model()}
