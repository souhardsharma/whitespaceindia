"""One process at a time may talk to PARIVESH from this machine.

WHY
---
Sustained concurrency from one address got this project refused at the TCP
layer for nine hours, and the incident that did it was a backfill plus a
second process probing alongside. The engineering reference says never run two fetchers at
once; nothing enforced it. A sync started by hand while a six-hour backfill
was running would double the load on the service and interleave appends to
the same cache file.

The lock is MACHINE-WIDE, not per cache: a rehearsal on a scratch cache talks
to the same service from the same address as a backfill on the real one.

A process started BY the holder (the sync runs its fetchers as subprocesses)
inherits the right to run through INSTRUMENTS_LOCK_HELD, so the sync's own
children are not locked out by their parent. A lock left by a process that no
longer exists is stale and is cleared.
"""
from __future__ import annotations

import atexit
import json
import os
import sys
import tempfile
import time
from pathlib import Path

ENV = "INSTRUMENTS_LOCK_HELD"


def default_path() -> Path:
    return Path(os.environ.get("INSTRUMENTS_LOCK_FILE")
                or Path(tempfile.gettempdir()) / "whitespace-instruments-parivesh.lock")


def pid_alive(pid: int) -> bool:
    """Whether a process with this id exists. Never signals it.

    os.kill(pid, 0) is the POSIX probe, but on Windows os.kill with any
    signal but the two console events TERMINATES the process - so Windows
    asks the kernel instead.
    """
    if pid <= 0:
        return False
    if sys.platform == "win32":
        import ctypes
        from ctypes import wintypes
        k32 = ctypes.WinDLL("kernel32", use_last_error=True)
        k32.OpenProcess.restype = wintypes.HANDLE
        handle = k32.OpenProcess(0x1000, False, pid)  # QUERY_LIMITED_INFORMATION
        if not handle:
            return False
        try:
            code = wintypes.DWORD()
            if not k32.GetExitCodeProcess(handle, ctypes.byref(code)):
                return False
            return code.value == 259  # STILL_ACTIVE
        finally:
            k32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def holder(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return None


_held: dict = {}


def _os_lock(path: Path):
    """An exclusive lock the OS holds for this process, or None if taken.

    Held on a sidecar file nobody reads, for as long as the process lives;
    the OS drops it when the process dies, however it dies. Clearing a
    stale JSON lock by hand raced: two starters could both judge it stale,
    and the second deleted the first one's fresh lock and took it too.
    """
    side = path.with_name(path.name + ".os")
    fd = os.open(side, os.O_RDWR | os.O_CREAT, 0o644)
    try:
        if sys.platform == "win32":
            import msvcrt
            msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        os.close(fd)
        return None
    return fd


def _os_unlock(fd) -> None:
    try:
        if sys.platform == "win32":
            import msvcrt
            os.lseek(fd, 0, os.SEEK_SET)
            msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
    except OSError:
        pass
    os.close(fd)


def watch_holder(pid: int, interval: float = 5.0) -> None:
    """Exit this process when the holder that started it, or its own parent,
    is gone.

    A child runs on its holder's lock. Killed hard - a job timeout, a
    TerminateProcess - the holder runs no cleanup, its lock becomes stale,
    the next run clears it, and the orphaned children would go on reading
    PARIVESH beside that run: the two-at-once this lock exists to prevent.
    """
    parent = os.getppid()

    def loop():
        while True:
            time.sleep(interval)
            if not pid_alive(pid) or (parent > 1 and not pid_alive(parent)):
                sys.stderr.write(f"run_lock: holder {pid} or parent {parent} "
                                 "is gone; stopping.\n")
                sys.stderr.flush()
                os._exit(2)

    import threading
    threading.Thread(target=loop, name="run-lock-watch", daemon=True).start()


def acquire(name: str, path: Path | None = None) -> bool:
    """Take the lock for `name`, or return False if a live process holds it.

    Returns True without taking anything when this process was started by the
    holder (its id is in INSTRUMENTS_LOCK_HELD and still owns the file); such
    a process stops itself if that holder dies (watch_holder).
    """
    path = path or default_path()
    inherited = os.environ.get(ENV)
    h = holder(path) or {}
    pid = int(h.get("pid") or 0)
    if inherited and pid and str(pid) == inherited and pid_alive(pid):
        watch_holder(pid)
        return True
    fd = _os_lock(path)
    if fd is None:
        return False
    # The OS lock serialises everyone who gets this far, so the check below
    # cannot race. It still honours a JSON lock naming a live process, which
    # a run started before the OS lock existed holds without the sidecar.
    h = holder(path) or {}
    pid = int(h.get("pid") or 0)
    if pid and pid != os.getpid() and pid_alive(pid):
        _os_unlock(fd)
        return False
    tmp = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps({"pid": os.getpid(), "name": name,
                               "started": time.strftime("%Y-%m-%dT%H:%M:%S")}),
                   encoding="utf-8")
    os.replace(tmp, path)
    _held[str(path)] = fd
    os.environ[ENV] = str(os.getpid())
    atexit.register(release, path)
    return True


def release(path: Path | None = None) -> None:
    path = path or default_path()
    h = holder(path)
    if h and int(h.get("pid") or 0) == os.getpid():
        try:
            path.unlink()
        except FileNotFoundError:
            pass
    fd = _held.pop(str(path), None)
    if fd is not None:
        _os_unlock(fd)


def hold_or_exit(name: str) -> None:
    """Take the lock, or stop with a message naming who holds it."""
    if acquire(name):
        return
    h = holder(default_path()) or {}
    sys.exit(f"ERROR: another run is talking to PARIVESH from this machine "
             f"({h.get('name', '?')}, pid {h.get('pid', '?')}, since "
             f"{h.get('started', '?')}). Two at once is how this project was "
             f"blocked. Wait for it, or remove {default_path()} if that "
             f"process is gone.")
