from __future__ import annotations

import asyncio
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path

import anyio.to_thread
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
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


def _configure_thread_pools() -> None:
    """Beide Thread-Pools explizit dimensionieren (siehe config.py):

    - asyncio-Default-Executor (trägt alle ``asyncio.to_thread``-DB-Zugriffe):
      der Python-Default ``min(32, CPU+4)`` ist auf kleinen Containern nur
      5–6 Threads — bei Event-Spitzen würden async DB-Pfade dort queuen.
    - anyio-Limiter (trägt alle sync-``def``-Routen): Default 40.

    Muss im LAUFENDEN Event-Loop aufgerufen werden (→ Lifespan). Kein explizites
    Shutdown nötig: asyncio schließt den Default-Executor beim Loop-Ende selbst
    (uvicorn läuft über ``asyncio.run``)."""
    loop = asyncio.get_running_loop()
    loop.set_default_executor(
        ThreadPoolExecutor(
            max_workers=max(4, settings.threadpool_db_workers),
            thread_name_prefix="db",
        )
    )
    anyio.to_thread.current_default_thread_limiter().total_tokens = max(
        4, settings.threadpool_sync_routes
    )


async def _sync_loop() -> None:
    """Full repository sync once per night at ``settings.sync_nightly_hour`` (UTC).

    Deliberately does NOT sync at startup: the SQLite cache persists on the data
    volume across restarts, and writes trigger ``refresh_idea`` for freshness. A
    fresh/empty cache is handled separately by ``_startup_sync_if_empty``. Manual
    full sync stays available via ``POST /admin/sync``.
    """
    while True:
        await asyncio.sleep(
            sync_mod.seconds_until_hour(datetime.now(UTC), settings.sync_nightly_hour)
        )
        try:
            result = await sync_mod.run_sync()
            log.info(
                "nightly sync: topics=%s ideas=%s error=%s",
                result["topics_seen"],
                result["ideas_seen"],
                result["error"],
            )
        except Exception:
            log.exception("nightly sync loop error")


async def _startup_sync_if_empty() -> None:
    """Fresh-deploy safety net: if the cache is empty (no persisted DB and no
    backup restored), run ONE sync shortly after start so the app isn't empty
    until the nightly run. The short delay keeps it off the critical path of the
    first user requests.
    """
    if not sync_mod.cache_is_empty():
        return
    await asyncio.sleep(20)
    try:
        log.info("startup: idea cache empty — running one-off initial sync")
        result = await sync_mod.run_sync()
        log.info(
            "initial sync: topics=%s ideas=%s error=%s",
            result["topics_seen"],
            result["ideas_seen"],
            result["error"],
        )
    except Exception:
        log.exception("initial sync failed")


@asynccontextmanager
async def lifespan(app: FastAPI):
    _configure_thread_pools()
    # Auto-Restore beim Erststart: wenn keine DB vorhanden ist und ein
    # Backup-ZIP im Backup-Ordner liegt, ziehen wir das jüngste vor der
    # Schema-Migration. So kommt eine frisch deployte App nicht „leer"
    # hoch, sondern setzt nahtlos beim letzten Backup auf.
    try:
        restored = backup_mod.auto_restore_if_fresh()
        if restored:
            log.info(
                "auto-restore: aktiv — DB aus %s wiederhergestellt (%d Bytes)",
                restored["from"],
                restored.get("size") or 0,
            )
    except Exception:
        log.exception("auto-restore: unerwarteter Fehler — starte mit leerer DB")

    init_db()
    # Legacy-Stimmen einmalig für den Punkteverfall erfassen (idempotent über
    # Marker), damit die verfallsgewichtete Rangliste schon vor dem ersten
    # Sync nicht leer/0 ist.
    try:
        from .db import connect as _connect

        with _connect() as _con:
            sync_mod.ensure_vote_seed(_con)
    except Exception:
        log.exception("ensure_vote_seed beim Start fehlgeschlagen")
    sync_task = asyncio.create_task(_sync_loop())
    startup_sync_task = asyncio.create_task(_startup_sync_if_empty())
    backup_task = asyncio.create_task(backup_mod.auto_backup_loop())
    try:
        yield
    finally:
        sync_task.cancel()
        startup_sync_task.cancel()
        backup_task.cancel()
        # Ephemeral-Modus: letzten Stand sichern, BEVOR das tmpfs mit dem Pod
        # stirbt — geplante Restarts/Deployments verlieren damit nichts
        # (no-op im Default-Modus, s. backup.shutdown_backup).
        try:
            await asyncio.to_thread(backup_mod.shutdown_backup)
        except Exception:
            log.exception("shutdown-backup fehlgeschlagen")
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
# Antworten komprimieren (gzip). Vor allem das ~800-KB-Frontend-Bundle wird
# sonst UNKOMPRIMIERT ausgeliefert (StaticFiles gzippt nicht, und der
# Reverse-Proxy tut es hier aktuell auch nicht) → mehrere Sekunden Erstladezeit,
# besonders nach jedem Deploy (Cache-Bust erzwingt Re-Download). gzip drückt das
# Bundle auf ~1/4. Greift nur, wenn der Client `Accept-Encoding: gzip` sendet
# (alle Browser) und die Antwort > 1 KB ist.
app.add_middleware(GZipMiddleware, minimum_size=1024)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    # Nur tatsächlich genutzte Methoden / Header erlauben — minimiert die
    # Angriffsfläche bei einer kompromittierten Origin-Domain.
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Authorization",
        "Content-Type",
        "Accept",
        "X-Requested-With",
    ],
)


@app.middleware("http")
async def _security_headers(request, call_next):
    """Grund-Härtung auf ALLEN Antworten (API + statisches Bundle):
    - `nosniff`: verhindert MIME-Sniffing (z.B. einen hochgeladenen Text als
      HTML/JS interpretieren zu lassen).
    - `Referrer-Policy`: keine vollständigen URLs (mit Query) an Fremd-Origins
      leaken.
    Bewusst OHNE `X-Frame-Options`/CSP-`frame-ancestors`: die App wird absichtlich
    als Web-Component in Partnerseiten (WLO) eingebettet — ein Frame-Verbot würde
    genau diesen Embed brechen. Eine vollständige CSP ist wegen des Embed-Szenarios
    noch offen (braucht Browser-Test gegen die Host-Seiten) und daher hier bewusst
    nicht gesetzt.

    Zusätzlich Observability für Instanz-Latenz-Diagnosen:
    - `Server-Timing: app;dur=<ms>` auf jeder Antwort — die Browser-DevTools
      zeigen damit pro Request die reine SERVER-Verarbeitungszeit. Ist der
      Request langsam, aber `dur` klein, liegt die Zeit auf dem WEG (Proxy-
      Keepalive, DNS, TLS, Queueing) — nicht in App/DB. Beendet das
      Instanzvergleichs-Rätselraten datenbasiert.
    - API-Requests über 1 s landen als WARNING im Log (Pfad + Dauer), damit
      `kubectl logs` langsame Aufrufe ohne DevTools-Sitzung benennt."""
    t0 = time.perf_counter()
    response = await call_next(request)
    dur_ms = (time.perf_counter() - t0) * 1000.0
    response.headers["Server-Timing"] = f"app;dur={dur_ms:.1f}"
    if dur_ms > 1000.0 and request.url.path.startswith("/api/"):
        log.warning("slow request: %s %s -> %.0f ms", request.method, request.url.path, dur_ms)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response


app.include_router(router, prefix="/api/v1")


# ---- Serve the embed build (if present) at the root ----------------------
# `npm run build:embed` produces frontend/dist/embed/browser. When that
# directory exists, mount it so the same FastAPI process serves both the API
# and the web-component bundle (no CORS headache, one deploy unit).
_STATIC_DIR = Path(__file__).resolve().parents[2] / "frontend" / "dist" / "embed" / "browser"

# Statische Assets als Versionsabhängig-cachebar ausliefern. Die Angular-Bundles
# werden über einen `?v=<timestamp>`-Query-Parameter invalidiert (siehe
# index.html). Daher dürfen die Dateien selbst `immutable` sein: Der Browser
# lädt sie nach dem ersten Besuch NICHT mehr neu. Das ist der entscheidende
# Fix gegen die langsame Navigation hinter einem HTTP/2-Reverse-Proxy (Caddy):
# ohne Cache revalidiert der Browser bei jeder Navigation die Bundles auf der
# EINEN HTTP/2-Verbindung und blockiert damit die API-XHRs (gemessen 5–14 s).
# Mit `immutable` bleibt die Verbindung frei. Wirkt identisch hinter nginx
# (HTTP/1.1) und Caddy (HTTP/2), da der Header von der App selbst gesetzt wird.
# index.html bleibt `no-cache` (per ETag revalidiert), damit ein neues Deploy
# mit neuem `?v=` sofort greift.
_ASSET_SUFFIXES = (
    ".js",
    ".css",
    ".woff2",
    ".woff",
    ".ttf",
    ".otf",
    ".svg",
    ".ico",
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".map",
)


class CachedStaticFiles(StaticFiles):
    """StaticFiles mit Cache-Control: versionierte Assets `immutable`,
    HTML `no-cache`."""

    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        if path.endswith(_ASSET_SUFFIXES):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        else:
            # index.html und SPA-Fallbacks: revalidieren statt blind cachen,
            # damit neue Deploys (neuer ?v=) sofort sichtbar werden.
            response.headers["Cache-Control"] = "no-cache"
        return response


if _STATIC_DIR.is_dir():
    app.mount("/", CachedStaticFiles(directory=_STATIC_DIR, html=True), name="static")
    log.info("Serving static bundle from %s", _STATIC_DIR)
else:
    log.info("No built bundle at %s — API only (start dev server separately)", _STATIC_DIR)
