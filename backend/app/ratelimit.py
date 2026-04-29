"""Zentrale Rate-Limiter-Instanz.

Wird in `main.py` an `app.state.limiter` gehängt und in `routes.py` per
Decorator verwendet (`@limiter.limit("…/…")`). Ein eigenes Modul, damit
keine Zirkel-Imports zwischen main und routes entstehen.

Limits sind bewusst großzügig — wir wollen Spam und Brute-Force bremsen,
nicht echte User behindern. Die Werte können jederzeit angepasst werden.
"""
from __future__ import annotations

from slowapi import Limiter
from slowapi.util import get_remote_address

# In-Memory-Storage reicht für Single-Instance-Deployment. Bei
# Mehr-Worker-/Mehr-Server-Setup auf Redis umstellen via
# storage_uri="redis://…".
limiter = Limiter(key_func=get_remote_address, default_limits=[])
