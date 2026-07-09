"""Thread-lokale Connection-Wiederverwendung in ``db.connect()``.

Live-Befund (Instanz-Vergleich): Auf trägem Storage kostet JEDES Öffnen der
SQLite-Datei (open + PRAGMAs) ~35–40 ms — Endpoints mit mehreren DB-Blöcken
multiplizieren das (get_idea 303 ms vs. 40 ms auf gesundem Storage). Der Pool
hält pro Worker-Thread EINE offene Connection; die Contextmanager-Semantik
(Commit bei Erfolg, Rollback bei Exception) bleibt unverändert.

Gepinnt außerdem: die Invalidierung, auf der der Restore-Pfad (Datei-Swap!)
und die Test-Hermetik (tmp_path-Wechsel) beruhen.
"""

from __future__ import annotations

import sqlite3
import threading

from app import db as db_mod
from app.config import settings
from app.db import connect, invalidate_pooled_connections


def test_same_thread_reuses_connection():
    with connect() as a:
        first = id(a)
        a.execute("SELECT 1")
    with connect() as b:
        assert id(b) == first  # keine Neu-Öffnung pro Aufruf


def test_commit_and_rollback_semantics_unchanged():
    with connect() as con:
        con.execute("INSERT INTO app_setting (key, value) VALUES ('pool-t', '1')")
    with connect() as con:  # neuer Block sieht den Commit
        assert con.execute(
            "SELECT value FROM app_setting WHERE key='pool-t'"
        ).fetchone()[0] == "1"
    try:
        with connect() as con:
            con.execute("UPDATE app_setting SET value='2' WHERE key='pool-t'")
            raise RuntimeError("boom")
    except RuntimeError:
        pass
    with connect() as con:  # Exception → Rollback, Wert unverändert
        assert con.execute(
            "SELECT value FROM app_setting WHERE key='pool-t'"
        ).fetchone()[0] == "1"


def test_nested_connect_gets_throwaway_connection():
    """Verschachtelung im selben Thread: die innere Nutzung bekommt eine
    FRISCHE Wegwerf-Connection — ihr Commit darf die äußere Transaktion nicht
    mit-committen (Sicherheitsnetz gegen Semantik-Drift)."""
    with connect() as outer:
        with connect() as inner:
            assert inner is not outer
            inner.execute("SELECT 1")
        outer.execute("SELECT 1")  # äußere bleibt nutzbar


def test_invalidate_closes_and_reopens():
    with connect() as a:
        old = a
    invalidate_pooled_connections()
    try:
        old.execute("SELECT 1")
        raise AssertionError("alte Connection müsste geschlossen sein")
    except sqlite3.ProgrammingError:
        pass  # geschlossen — genau das braucht der Restore-Datei-Swap
    with connect() as b:
        assert b is not old
        b.execute("SELECT 1")


def test_path_change_reopens(tmp_path, monkeypatch):
    """Test-Hermetik: wechselt settings.sqlite_path (frisches tmp_path pro
    Test), darf NICHT die alte Connection weiterverwendet werden."""
    with connect() as a:
        old = a
    monkeypatch.setattr(settings, "sqlite_path", tmp_path / "other.sqlite")
    db_mod.init_db()
    with connect() as b:
        assert b is not old
        b.execute("SELECT COUNT(*) FROM idea")


def test_threads_get_separate_connections():
    ids: list[int] = []

    def _worker():
        with connect() as con:
            con.execute("SELECT 1")
            ids.append(id(con))

    threads = [threading.Thread(target=_worker) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    with connect() as main_con:
        ids.append(id(main_con))
    assert len(set(ids)) == 3  # jeder Thread seine eigene Connection
