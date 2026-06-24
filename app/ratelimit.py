"""Zentrale Rate-Limiter-Instanz.

Wird in `main.py` an `app.state.limiter` gehängt und in `routes.py` per
Decorator verwendet (`@limiter.limit("…/…")`). Ein eigenes Modul, damit
keine Zirkel-Imports zwischen main und routes entstehen.

Limits sind bewusst großzügig — wir wollen Spam und Brute-Force bremsen,
nicht echte User behindern. Die Werte können jederzeit angepasst werden.

**Schul-NAT-/Embed-Szenario**: Viele User teilen sich eine öffentliche
IP (Schul-Netz, Embed in Schul-Lernplattform). Ein reines IP-basiertes
Limit würde dort fälschlich blocken. Deshalb nutzen wir einen
kombinierten Key:
  - Eingeloggte User → Hash(Authorization-Header)
  - Anonym         → IP-Adresse (X-Forwarded-For respektieren)
Hinter nginx muss `X-Forwarded-For` durchgereicht werden (s. README).
"""

from __future__ import annotations

import hashlib

from slowapi import Limiter
from starlette.requests import Request


def _client_ip(request: Request) -> str:
    """Echte Client-IP hinter dem Reverse-Proxy.

    WICHTIG: X-Forwarded-For ist clientseitig fälschbar. nginx hängt mit
    `$proxy_add_x_forwarded_for` die real gesehene IP HINTEN an — deshalb
    NICHT die erste (vom Client kontrollierbare), sondern die LETZTE XFF-IP
    nehmen. X-Real-IP (nginx = $remote_addr) hat Vorrang; sonst Peer-Adresse.
    Sonst könnte ein anonymer Client per rotierendem XFF die IP-Rate-Limits
    auf /ideas, /report, /captcha aushebeln.
    """
    real = request.headers.get("x-real-ip")
    if real and real.strip():
        return real.strip()
    xff = request.headers.get("x-forwarded-for")
    if xff:
        parts = [p.strip() for p in xff.split(",") if p.strip()]
        if parts:
            return parts[-1]
    return request.client.host if request.client else "unknown"


def auth_or_ip_key(request: Request) -> str:
    """Rate-Limit-Key: User-Hash wenn eingeloggt, sonst Client-IP.

    So bremst Spam von einzelnen Accounts oder einzelnen anonymen IPs,
    ohne ganze Schul-/Embed-Netze auszusperren. Auth-Header wird gehashed
    statt verbatim verwendet, damit Klartext-Credentials nie in den
    Slowapi-Storage gelangen.
    """
    auth = request.headers.get("authorization") or ""
    if auth:
        h = hashlib.sha256(auth.encode("utf-8", errors="replace")).hexdigest()
        return f"u:{h[:24]}"
    return f"ip:{_client_ip(request)}"


# In-Memory-Storage reicht für Single-Instance-Deployment. Bei
# Mehr-Worker-/Mehr-Server-Setup auf Redis umstellen via
# storage_uri="redis://…".
limiter = Limiter(key_func=auth_or_ip_key, default_limits=[])
