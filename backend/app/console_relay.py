"""In-process relay for the VM web console ticket URL.

The ticket from open_namespace_vm_remote_console points at
vcf-vra.vcf.local over wss://, which this backend already reaches fine -
but the browser rejects it silently: a WebSocket opened from JavaScript
(unlike a page navigation) fails outright, with no click-through warning,
if the server's TLS certificate isn't already trusted by that browser
(confirmed live: a raw RFB handshake against the same ticket succeeds
end-to-end with certificate verification disabled, exactly matching what
a browser would refuse without ever surfacing why). Handing the browser a
same-origin relay URL instead means it only ever needs to trust this
portal's own certificate, which it already does.

Single-process, in-memory store - fine as long as the backend runs as one
uvicorn worker (see Dockerfile).
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
    """Return the upstream URL for token, or None if unknown/expired."""
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
