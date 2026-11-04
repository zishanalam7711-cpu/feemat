"""Feemat - loader for the optional 'plus' feature modules.

Every file named  plus_*.py  in this folder is imported when the server starts and its  install(api, ctx, drop_routes)  is called.
So a new feature = a new file; server.py does not have to change again. If one module has a problem, it is logged and skipped:
the rest of the app keeps working.
"""
import glob
import importlib
import logging
import os

log = logging.getLogger("feemat")


def drop_routes(api, pairs) -> int:
    """Remove existing routes [(METHOD, '/path'), ...] (path without the /api prefix) so a plus module can replace them."""
    prefix = getattr(api, "prefix", "") or ""
    wanted = {(m.upper(), prefix + p) for m, p in pairs}
    keep, dropped = [], 0
    for r in api.routes:
        methods = getattr(r, "methods", None) or set()
        path = getattr(r, "path", None)
        if path is not None and any((m, path) in wanted for m in methods):
            dropped += 1
            continue
        keep.append(r)
    api.routes[:] = keep
    return dropped


def load_all(api, ctx, folder=None) -> list:
    folder = folder or os.path.dirname(os.path.abspath(__file__))
    loaded = []
    for f in sorted(glob.glob(os.path.join(folder, "plus_*.py"))):
        name = os.path.splitext(os.path.basename(f))[0]
        try:
            mod = importlib.import_module(name)
            mod.install(api, ctx, drop_routes)
            loaded.append(name)
        except Exception:
            log.exception("plus module %s could not be loaded (the rest of the app still works)", name)
    log.info("plus modules loaded: %s", ", ".join(loaded) or "none")
    return loaded
