"""In-process relay for the VM web console ticket URL.

vm-operator/VCF Automation's web-console proxy host (the `proxyAddr` baked
into the URL `open_namespace_vm_web_console` builds) sits on the Supervisor's
internal network and is routinely unreachable from an end user's browser,
even though this backend can already reach it (it talks to the namespace's
Supervisor API endpoint for every other VM-operator call). Rather than hand
the browser that internal URL directly, the console router hands it a
same-origin relay URL backed by this process: a short-lived token maps to
the real upstream URL, and /api/projects/console-relay/{token} forwards
both the plain HTTP request and the WebSocket upgrade a WMKS ticket session
needs (see routers/projects.py's console-relay routes).

Single-process, in-memory store - fine as long as the backend runs as one
uvicorn worker (see Dockerfile). It would need a shared store (e.g. Redis)
if that ever changes.
"""

import secrets
import time

_TTL_SECONDS = 300.0
_sessions: dict[str, tuple[str, float]] = {}


def register(upstream_url: str) -> str:
    """Store upstream_url under a fresh token and return the token."""
    _purge_expired()
    token = secrets.token_urlsafe(32)
    _sessions[token] = (upstream_url, time.time() + _TTL_SECONDS)
    return token


def resolve(token: str) -> str | None:
    """Return the upstream URL for token, or None if unknown/expired.

    Deliberately not single-use: the bootstrap HTTP request and the
    WebSocket upgrade that follows it both need to resolve the same token.
    """
    entry = _sessions.get(token)
    if not entry:
        return None
    url, expires_at = entry
    if time.time() > expires_at:
        _sessions.pop(token, None)
        return None
    return url


def _purge_expired() -> None:
    now = time.time()
    for token, (_, expires_at) in list(_sessions.items()):
        if now > expires_at:
            _sessions.pop(token, None)
