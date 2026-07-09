"""Operational endpoints: liveness (/health), readiness (/ready) and the
/status diagnostics block.

Split out of ``routes.py`` (behaviour-preserving). The router defined here is
mounted back onto the main API router via ``include_router`` in ``routes.py``,
so the public paths (/api/v1/health, /ready, /status) stay exactly the same.
"""

from __future__ import annotations

import asyncio
import os
import time
from datetime import UTC, datetime

from fastapi import APIRouter, Header, HTTPException

from . import backup as backup_mod
from .auth import is_moderator
from .config import settings
from .db import connect, open_probe_ms

router = APIRouter()


@router.get("/health")
async def health():
    """Liveness-Probe: beantwortet ausschließlich „läuft der Prozess?".
    BEWUSST ohne DB-/edu-sharing-Zugriff und als `async def` direkt auf dem
    Event-Loop (kein Threadpool) — so kann weder eine kurz gelockte SQLite-DB
    (z.B. während des 5-Minuten-Syncs) noch ein ausgelasteter Threadpool die
    Probe ausbremsen. Eine kurz gelockte DB ist KEIN toter Prozess; ein
    k8s-Neustart mitten im Sync macht es nur schlimmer (Restart-Schleife).
    Abhängigkeits-Check → /ready, Kennzahlen → /status."""
    return {"ok": True}


@router.get("/ready")
def ready():
    """Readiness-Probe: ist die DB erreichbar? Bewusst minimal (`SELECT 1`,
    kein Table-Scan) und als sync-`def` im Threadpool, damit der DB-Zugriff den
    Event-Loop nicht blockiert. Schlägt sie fehl, nimmt k8s den Pod nur aus dem
    Service (kein Neustart), bis die DB wieder antwortet."""
    try:
        with connect() as con:
            con.execute("SELECT 1").fetchone()
    except Exception as e:
        raise HTTPException(503, f"db not ready: {type(e).__name__}")
    return {"ready": True}


@router.get("/status")
async def status(authorization: str | None = Header(None)):
    """Kennzahlen für Monitoring/Menschen — NICHT als k8s-Probe verwenden
    (macht DB-Reads/COUNTs, kann unter Last/Sync langsamer sein).

    Öffentlich sind nur die groben Zähler + der letzte Sync (für Uptime-
    Pings ausreichend). Der `diagnostics`-Block ist Mod-only: PRAGMA-Werte,
    Dateigrößen, Index-Namen und Query-Timings sind Interna, die einem
    anonymen Aufrufer nichts nützen außer Recon (Audit-Befund).

    Der `diagnostics`-Block dient dem Vergleich ZWEIER Deployments mit
    identischem Code+Daten: zeigt, ob die Performance-PRAGMAs/Indizes auf
    DIESEM Prozess aktiv sind (sonst alter/nicht-neugestarteter Stand), wie
    groß die WAL-Datei real ist (Bloat-Bremse) und wie schnell ein
    repräsentativer Read tatsächlich läuft. `last_backup` zeigt zusätzlich,
    ob die Auto-Sicherung läuft (Alerting-Minimalcheck ohne externen Dienst).
    DB-Zugriffe laufen im Threadpool — gleiche Nicht-Blockier-Eigenschaft
    wie zuvor als sync-`def`-Route."""
    is_mod = await is_moderator(authorization)

    def _read_public():
        with connect() as con:
            counts = con.execute(
                "SELECT (SELECT COUNT(*) FROM topic) topics, (SELECT COUNT(*) FROM idea) ideas"
            ).fetchone()
            last = con.execute("SELECT * FROM sync_log ORDER BY id DESC LIMIT 1").fetchone()
        return counts, last

    counts, last = await asyncio.to_thread(_read_public)
    out: dict[str, object] = {
        "ok": True,
        "topics": counts["topics"],
        "ideas": counts["ideas"],
        "last_sync": dict(last) if last else None,
    }
    if not is_mod:
        return out

    def _read_diagnostics():
        with connect() as con:
            # --- Diagnose: realer Read + effektive PRAGMAs + Index-Präsenz ----
            t0 = time.perf_counter()
            con.execute("SELECT * FROM idea WHERE COALESCE(hidden,0)=0").fetchall()
            sample_query_ms = round((time.perf_counter() - t0) * 1000, 2)

            pragmas: dict[str, object] = {}
            for p in (
                "journal_mode",
                "synchronous",
                "cache_size",
                "mmap_size",
                "page_size",
                "page_count",
                "journal_size_limit",
                "busy_timeout",
                "temp_store",
            ):
                try:
                    row = con.execute(f"PRAGMA {p}").fetchone()
                    pragmas[p] = row[0] if row else None
                except Exception:
                    pragmas[p] = None

            idx_names = {
                r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='index'")
            }

        # WAL-/DB-Dateigrößen (best-effort; aussagekräftig für den Bloat-Verdacht)
        db_bytes: dict[str, int | None] = {}
        _db_path = os.fspath(settings.sqlite_path)
        for suffix, label in (("", "db"), ("-wal", "wal"), ("-shm", "shm")):
            try:
                db_bytes[label] = os.path.getsize(_db_path + suffix)
            except OSError:
                db_bytes[label] = None

        # Jüngstes Backup (falls vorhanden) — „läuft die Auto-Sicherung?"
        try:
            backups = backup_mod.list_backups()
            last_backup = (
                {"filename": backups[0]["filename"], "created_at": backups[0]["created_at"]}
                if backups
                else None
            )
        except Exception:
            last_backup = None
        # Storage-Kennzahl: Kosten einer FRISCHEN Datei-Öffnung (db.open_probe_ms).
        # Im Normalbetrieb spart der Thread-Pool genau diese Kosten — die Zahl
        # hier macht die Storage-Gesundheit der Instanz direkt vergleichbar
        # (gesund <1 ms, träge ~35–40 ms, Live-Vergleich 07/2026).
        try:
            connect_open_ms = round(open_probe_ms(), 2)
        except Exception:
            connect_open_ms = None
        return sample_query_ms, pragmas, idx_names, db_bytes, last_backup, connect_open_ms

    (
        sample_query_ms,
        pragmas,
        idx_names,
        db_bytes,
        last_backup,
        connect_open_ms,
    ) = await asyncio.to_thread(_read_diagnostics)
    out["diagnostics"] = {
        "server_time": datetime.now(UTC).isoformat(),
        "sample_query_ms": sample_query_ms,
        "connect_open_ms": connect_open_ms,
        "db_bytes": db_bytes,
        "pragmas": pragmas,
        "last_backup": last_backup,
        "expected_indexes_present": {
            "idea_owner_idx": "idea_owner_idx" in idx_names,
            "idea_interaction_user_idx": "idea_interaction_user_idx" in idx_names,
        },
    }
    return out
