from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from . import backup as backup_mod
from . import edu_sharing
from . import sync as sync_mod
from .config import settings
from .db import init_db
from .ratelimit import limiter
from .routes import router

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("ideendb")


async def _sync_loop() -> None:
    while True:
        try:
            result = await sync_mod.run_sync()
            log.info(
                "sync: topics=%s ideas=%s error=%s",
                result["topics_seen"],
                result["ideas_seen"],
                result["error"],
            )
        except Exception:
            log.exception("sync loop error")
        await asyncio.sleep(settings.sync_interval_seconds)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Auto-Restore beim Erststart: wenn keine DB vorhanden ist und ein
    # Backup-ZIP im Backup-Ordner liegt, ziehen wir das jüngste vor der
    # Schema-Migration. So kommt eine frisch deployte App nicht „leer"
    # hoch, sondern setzt nahtlos beim letzten Backup auf.
    try:
        restored = backup_mod.auto_restore_if_fresh()
        if restored:
            log.info(
                "auto-restore: aktiv — DB aus %s wiederhergestellt (%d Bytes)",
                restored["from"], restored.get("size") or 0,
            )
    except Exception:
        log.exception("auto-restore: unerwarteter Fehler — starte mit leerer DB")

    init_db()
    sync_task = asyncio.create_task(_sync_loop())
    backup_task = asyncio.create_task(backup_mod.auto_backup_loop())
    try:
        yield
    finally:
        sync_task.cancel()
        backup_task.cancel()
        await edu_sharing.client.close()


app = FastAPI(
    title="HackathOERn Ideendatenbank",
    version="0.1.0",
    lifespan=lifespan,
)

# Rate-Limiter — Shared State, damit Decorators in routes.py greifen
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS — strikt nur die explizit konfigurierten Origins. Kein Localhost-
# Regex-Fallback mehr (war zu offen — jede App auf localhost:* hätte
# mit Credentials zugreifen können). Für lokale Entwicklung trage die
# Origin in APP_CORS_ORIGINS ein (env).
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api/v1")


# ---- Serve the embed build (if present) at the root ----------------------
# `npm run build:embed` produces frontend/dist/embed/browser. When that
# directory exists, mount it so the same FastAPI process serves both the API
# and the web-component bundle (no CORS headache, one deploy unit).
_STATIC_DIR = Path(__file__).resolve().parents[2] / "frontend" / "dist" / "embed" / "browser"
if _STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=_STATIC_DIR, html=True), name="static")
    log.info("Serving static bundle from %s", _STATIC_DIR)
else:
    log.info("No built bundle at %s — API only (start dev server separately)", _STATIC_DIR)
