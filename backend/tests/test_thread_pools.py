"""Thread-Pool-Dimensionierung (main._configure_thread_pools).

Prüft beobachtbares Verhalten statt privater Attribute:
- `asyncio.to_thread` läuft nach der Konfiguration auf dem eigenen Executor
  (Thread-Namens-Präfix "db") — d.h. der Default-Executor wurde ersetzt.
- Der anyio-Limiter (sync-`def`-Routen) trägt die konfigurierte Token-Zahl.
"""

from __future__ import annotations

import asyncio
import threading

import anyio.to_thread

from app.config import settings
from app.main import _configure_thread_pools


def test_thread_pools_are_sized_from_settings():
    async def probe():
        _configure_thread_pools()
        # to_thread nutzt jetzt den benannten Executor (Beweis: Thread-Name).
        name = await asyncio.to_thread(lambda: threading.current_thread().name)
        assert name.startswith("db")
        limiter = anyio.to_thread.current_default_thread_limiter()
        assert limiter.total_tokens == max(4, settings.threadpool_sync_routes)

    asyncio.run(probe())
