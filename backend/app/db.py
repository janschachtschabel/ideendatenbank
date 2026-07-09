"""SQLite cache for fast listing/sorting/searching of ideas.

edu-sharing stays source-of-truth; we mirror a subset of fields periodically.
Uses FTS5 for full-text search across title + description + keywords.
"""

from __future__ import annotations

import sqlite3
import threading
from contextlib import contextmanager
from datetime import UTC, datetime

from .config import settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS topic (
    id TEXT PRIMARY KEY,
    parent_id TEXT,            -- NULL for root-themes, or parent topic id for challenges
    title TEXT NOT NULL,
    description TEXT,
    preview_url TEXT,
    color TEXT,                -- optional hex color stored on the collection
    sort_order INTEGER NOT NULL DEFAULT 100,
    created_at TEXT,
    modified_at TEXT
);

CREATE INDEX IF NOT EXISTS topic_parent_idx ON topic(parent_id);
-- topic_sort_idx wird in init_db() NACH der ALTER-Migration angelegt

CREATE TABLE IF NOT EXISTS idea (
    id TEXT PRIMARY KEY,              -- idea collection id (ccm:map) OR main-content ccm:io id
    kind TEXT NOT NULL,               -- 'collection' or 'io'
    topic_id TEXT,                    -- parent challenge (or topic) id
    main_content_id TEXT,             -- for kind=collection: primary ccm:io inside (for rating/comments)
    title TEXT NOT NULL,
    description TEXT,
    preview_url TEXT,
    author TEXT,
    project_url TEXT,
    phase TEXT,                       -- from keywords prefix phase:*
    events TEXT,                      -- JSON array of event keywords (event:*)
    categories TEXT,                  -- JSON array of topic keywords (topic:*)
    keywords TEXT,                    -- JSON array of all other keywords
    rating_avg REAL DEFAULT 0,
    rating_count INTEGER DEFAULT 0,
    -- Summe aller Sternwerte (edu-sharing overall.sum) — exakte Absolutsumme.
    rating_sum REAL DEFAULT 0,
    comment_count INTEGER DEFAULT 0,
    attachment_mimetype TEXT,         -- mimetype of the main/single content file (for kind='io')
    attachment_size INTEGER,          -- bytes
    attachment_name TEXT,             -- filename (for kind='io')
    attachment_url TEXT,              -- direct download URL (for kind='io')
    owner_username TEXT,              -- node.owner.authorityName from edu-sharing
    attachment_folder_id TEXT,        -- LEGACY: alte Geschwister-Sammlung; Anhänge laufen
                                      -- jetzt als ccm:childio direkt unter der Idee. Spalte
                                      -- bleibt für historische Rows, neue Submits setzen NULL.
    created_at TEXT,
    modified_at TEXT,
    synced_at TEXT
);

CREATE INDEX IF NOT EXISTS idea_topic_idx ON idea(topic_id);
CREATE INDEX IF NOT EXISTS idea_modified_idx ON idea(modified_at DESC);
CREATE INDEX IF NOT EXISTS idea_rating_idx ON idea(rating_avg DESC, rating_count DESC);
-- /me/ideas + oeffentliches Profil filtern nach owner_username und sortieren
-- nach modified_at DESC — der zusammengesetzte Index bedient Filter UND
-- Sortierung in einem Schritt (sonst Full-Scan + Sort pro Aufruf).
CREATE INDEX IF NOT EXISTS idea_owner_idx ON idea(owner_username, modified_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS idea_fts USING fts5(
    id UNINDEXED,
    title,
    description,
    keywords,
    tokenize='unicode61 remove_diacritics 2'
);

CREATE TABLE IF NOT EXISTS idea_interaction (
    -- Social signals that edu-sharing doesn't natively track.
    idea_id TEXT NOT NULL,
    user_key TEXT NOT NULL,               -- authenticated username, or anon-id from cookie
    kind TEXT NOT NULL,                   -- 'interest' | 'follow'
    display_name TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (idea_id, user_key, kind)
);

CREATE INDEX IF NOT EXISTS idea_interaction_idea_idx
    ON idea_interaction(idea_id, kind);
-- /me/follows, /me/interest, /me/activity, /me/notifications suchen nach
-- user_key (+ kind). Der (idea_id, kind)-Index oben kann das NICHT bedienen
-- (user_key ist kein Praefix) → eigener Index gegen den Full-Scan pro
-- „Mein Bereich“-Aufruf.
CREATE INDEX IF NOT EXISTS idea_interaction_user_idx
    ON idea_interaction(user_key, kind);

CREATE TABLE IF NOT EXISTS taxonomy_event (
    -- Kuratierte Event-Liste (z.B. "HackathOERn 3", "OER-Camp 2026").
    -- Wird im Submit-Form als Dropdown angeboten und ans cclom:general_keyword
    -- als `event:<slug>` angehängt.
    slug          TEXT PRIMARY KEY,
    label         TEXT NOT NULL,
    description   TEXT,
    sort_order    INTEGER DEFAULT 100,
    active        INTEGER NOT NULL DEFAULT 1,
    -- Lifecycle-Status: 'draft' (Mod sichtbar, Submitter nicht),
    -- 'live' (aktuell laufend, Default), 'archived' (abgelaufen).
    status        TEXT NOT NULL DEFAULT 'live',
    -- Wenn gesetzt + Zeitstempel in der Zukunft: Event taucht im
    -- "Featured"-Slot auf der Startseite auf.
    featured_until TEXT,
    -- Optionale Zusatzinfos fürs Promotion-Banner (alle nullable):
    -- Veranstaltungsort, Zeitraum von/bis (ISO-Datum) und Detail-URL.
    location      TEXT,
    date_start    TEXT,
    date_end      TEXT,
    detail_url    TEXT,
    created_at    TEXT NOT NULL,
    created_by    TEXT
);

CREATE TABLE IF NOT EXISTS taxonomy_phase (
    -- Kuratierte Phasen-Enum (z.B. "Anregung", "Ausarbeitung", ...).
    -- Default-Liste wird beim ersten Start gesetzt; Mods können erweitern.
    slug        TEXT PRIMARY KEY,
    label       TEXT NOT NULL,
    description TEXT,
    sort_order  INTEGER DEFAULT 100,
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL,
    created_by  TEXT
);

CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    topics_seen INTEGER,
    ideas_seen INTEGER,
    error TEXT
);

-- Trend-Snapshots: pro Sync-Lauf einmal Top-N je Event/Sort persistieren.
-- event = '' für „alle Events", sort ∈ {'rating','comments','interest'}.
-- score ist die jeweils maßgebliche Größe (rating_avg, comment_count, interest_count).
CREATE TABLE IF NOT EXISTS ranking_snapshot (
    snapshot_at TEXT NOT NULL,
    event TEXT NOT NULL DEFAULT '',
    sort TEXT NOT NULL,
    idea_id TEXT NOT NULL,
    rank INTEGER NOT NULL,
    score REAL NOT NULL,
    PRIMARY KEY (snapshot_at, event, sort, idea_id)
);
CREATE INDEX IF NOT EXISTS idx_ranking_lookup
  ON ranking_snapshot (event, sort, snapshot_at);
CREATE INDEX IF NOT EXISTS idx_ranking_idea
  ON ranking_snapshot (idea_id, event, sort, snapshot_at);

-- Vote-Ledger: pro (Idee, User) die zuletzt abgegebene Bewertung MIT
-- Zeitstempel. Quelle der Wahrheit für die Rating-WERTE bleibt edu-sharing;
-- dieses Ledger dient ausschließlich dem zeitlichen Punkteverfall (das
-- Alter jeder Stimme), das edu-sharing nicht einfach ausliefert. Wird von
-- rate_idea/unrate_idea gepflegt (App mediiert jede Bewertung).
--   value = abgegebener Rating-Wert (Sterne 1..5; Daumen = 5).
CREATE TABLE IF NOT EXISTS vote_event (
    idea_id    TEXT NOT NULL,
    user_key   TEXT NOT NULL,
    value      REAL NOT NULL,
    -- created_at = Erstabgabe der Stimme (NIE überschrieben → maßgeblich fürs
    -- Stimmenalter/Verfall). updated_at = letzte Wertänderung (Audit).
    created_at TEXT NOT NULL,
    updated_at TEXT,
    PRIMARY KEY (idea_id, user_key)
);
CREATE INDEX IF NOT EXISTS idx_vote_event_idea ON vote_event (idea_id);

-- Legacy-Seed: Bestands-Stimmen, die VOR Einführung des Verfalls schon in
-- edu-sharing lagen (ohne App-Zeitstempel). Werden einmalig als ein
-- gebündelter, auf das Einführungsdatum datierter „Altbestand" erfasst, der
-- wie eine Stimme mit verfällt. seed_sum = Summe der Sternwerte (avg*count),
-- seed_count = Anzahl Bewertungen — je nach Modus (Sterne/Daumen) genutzt.
CREATE TABLE IF NOT EXISTS idea_score_seed (
    idea_id    TEXT PRIMARY KEY,
    seed_sum   REAL NOT NULL,
    seed_count INTEGER NOT NULL,
    seeded_at  TEXT NOT NULL
);

-- Kontaktdaten der Einreichenden (App-seitig, NICHT in edu-sharing — bewusst
-- aus Datenschutz-Gründen). Nur mit ausdrücklicher Einwilligung gespeichert;
-- Anzeige nur für eingeloggte Nutzer:innen (serverseitig gegated). Zweck:
-- Rückfragen + Mithackende. Löschbar (DSGVO) über den Idee-Knoten.
CREATE TABLE IF NOT EXISTS idea_contact (
    idea_id    TEXT PRIMARY KEY,
    contact    TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- Meldungen / Reports: User können Ideen via "⚠ Melden"-Button melden,
-- Moderatoren erledigen sie im Mod-UI. Tabelle hier zentral angelegt
-- (vorher lag das verstreut als `CREATE TABLE IF NOT EXISTS` in mehreren
-- Endpoints, was auf frischer DB zur Race auf bulk-resolve führte).
CREATE TABLE IF NOT EXISTS idea_report (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    idea_id      TEXT NOT NULL,
    reason       TEXT NOT NULL,
    reporter     TEXT,           -- Username (falls eingeloggt)
    created_at   TEXT NOT NULL,
    resolved_at  TEXT            -- NULL = offen, gesetzt = erledigt
);
CREATE INDEX IF NOT EXISTS idx_report_reporter ON idea_report (reporter, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_open ON idea_report (resolved_at, created_at DESC);

-- Aktivitäts-Log für Moderatoren: jede relevante Schreib-Aktion in der App
-- wird hier festgehalten, damit das Mod-Team Vorgänge nachvollziehen kann.
-- Bewusst NICHT geloggt: Rating-Add, Kommentar-Add (eigene Tabellen),
-- Mitmachen/Folgen-Toggles (zu viel Rauschen), Login-Versuche.
CREATE TABLE IF NOT EXISTS activity_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    ts           TEXT NOT NULL,
    actor        TEXT,           -- username, NULL/„Gast" für anonyme Aktionen
    is_mod       INTEGER NOT NULL DEFAULT 0,
    action       TEXT NOT NULL,
    target_type  TEXT,           -- 'idea' | 'attachment' | 'folder' | 'taxonomy' | 'report' | 'mod'
    target_id    TEXT,
    target_label TEXT,           -- denormalisierter Titel/Name für Anzeige
    detail       TEXT            -- JSON, action-spezifisch
);
CREATE INDEX IF NOT EXISTS idx_activity_ts        ON activity_log (ts DESC);
CREATE INDEX IF NOT EXISTS idx_activity_actor     ON activity_log (actor, ts DESC);
CREATE INDEX IF NOT EXISTS idx_activity_action    ON activity_log (action, ts DESC);
CREATE INDEX IF NOT EXISTS idx_activity_target_id ON activity_log (target_id);

-- Einmalige Mathe-Captcha-Tokens für anonyme Submits. Schlank, ohne
-- Drittpartei. Hält Drive-by-Bots fern, ist aber bewusst KEIN Schutz
-- gegen gezielte Angriffe (eval('3+7') trivial). Auto-Cleanup beim
-- Anlegen neuer Tokens.
CREATE TABLE IF NOT EXISTS captcha_challenge (
    token       TEXT PRIMARY KEY,
    answer      INTEGER NOT NULL,
    expires_at  TEXT NOT NULL,
    used        INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_captcha_expires ON captcha_challenge(expires_at);

-- Kurzlebiges Upload-Token: weist den ANONYMEN Einreicher als Eigentümer der
-- frisch erstellten (noch nicht moderierten) Idee aus, damit nur er
-- Vorschaubild/Anhänge an genau diesen Knoten hängen kann (Objekt-Autorisierung
-- des anonymen Upload-Zweigs). Mehrfach nutzbar innerhalb der TTL; Auto-Cleanup
-- beim Anlegen neuer Tokens.
CREATE TABLE IF NOT EXISTS upload_token (
    token       TEXT PRIMARY KEY,
    node_id     TEXT NOT NULL,
    expires_at  TEXT NOT NULL,
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_upload_token_expires ON upload_token(expires_at);

-- Globale App-Einstellungen als simple Key-Value-Ablage. Aktuell genutzt
-- für `voting_mode_global` ('stars' | 'thumbs'). Mod-umschaltbar zur
-- Laufzeit, ohne Neustart.
CREATE TABLE IF NOT EXISTS app_setting (
    key   TEXT PRIMARY KEY,
    value TEXT
);
"""


def _ensure_dir() -> None:
    settings.sqlite_path.parent.mkdir(parents=True, exist_ok=True)


DEFAULT_PHASES = [
    ("anregung", "Anregung", 10),
    ("ausarbeitung", "Ausarbeitung", 20),
    ("pitch-bereit", "Pitch-bereit", 30),
    ("in-umsetzung", "In Umsetzung", 40),
    ("abgeschlossen", "Abgeschlossen", 50),
    ("archiviert", "Archiviert", 60),
]


def init_db() -> None:
    _ensure_dir()
    with connect() as con:
        # WAL ist eine persistente Eigenschaft der DB-Datei und wird hier
        # EINMALIG gesetzt (statt bei jeder connect()). init_db() läuft beim
        # Start und nach jedem Restore (restore_backup ruft init_db; der
        # Auto-Restore läuft direkt davor) — so ist WAL auch nach einem aus
        # `VACUUM INTO` (DELETE-Mode) wiederhergestellten Backup garantiert.
        con.execute("PRAGMA journal_mode = WAL")
        con.executescript(SCHEMA)
        # Idempotente Migration für bestehende DBs: sort_order wurde
        # nachträglich hinzugefügt. ALTER TABLE schlägt fehl, wenn die Spalte
        # schon da ist — das ist ok. Index auf sort_order wird nach der
        # Migration angelegt, damit er auch auf alten DBs greift.
        try:
            con.execute("ALTER TABLE topic ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 100")
        except sqlite3.OperationalError:
            pass
        # `original_id` wird mit-persistiert, damit das Inbox-Listing
        # erkennt, ob ein in der Inbox liegender Knoten bereits als
        # Reference in einer Sammlung einsortiert ist (= nicht mehr im
        # Postfach zeigen).
        try:
            con.execute("ALTER TABLE idea ADD COLUMN original_id TEXT")
        except sqlite3.OperationalError:
            pass
        # `hidden`: Mod-gesetzte Sichtbarkeits-Sperre. 1 = nicht in
        # öffentlichen Listen, aber Daten bleiben erhalten (Soft-Hide).
        try:
            con.execute("ALTER TABLE idea ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0")
        except sqlite3.OperationalError:
            pass
        try:
            con.execute("ALTER TABLE idea ADD COLUMN hidden_reason TEXT")
        except sqlite3.OperationalError:
            pass
        # Event-Lifecycle: Status + Featured-Slot (Mai 2026).
        # Bestehende Events bekommen status='live' (Default) — keine
        # User-sichtbare Änderung.
        try:
            con.execute("ALTER TABLE taxonomy_event ADD COLUMN status TEXT NOT NULL DEFAULT 'live'")
        except sqlite3.OperationalError:
            pass
        try:
            con.execute("ALTER TABLE taxonomy_event ADD COLUMN featured_until TEXT")
        except sqlite3.OperationalError:
            pass
        # Pro-Event-Override des Bewertungssystems: NULL = globalen Modus
        # erben, sonst 'stars' | 'thumbs'.
        try:
            con.execute("ALTER TABLE taxonomy_event ADD COLUMN voting_mode TEXT")
        except sqlite3.OperationalError:
            pass
        # Bewertungsphase pro Event: 1 = offen (bewertbar), 0 = gestoppt
        # (z.B. Einreichungsphase). Default offen → Bestand bleibt bewertbar.
        try:
            con.execute(
                "ALTER TABLE taxonomy_event ADD COLUMN rating_open INTEGER NOT NULL DEFAULT 1"
            )
        except sqlite3.OperationalError:
            pass
        # Event-Zusatzinfos für das Promotion-Banner auf der Startseite
        # (Juni 2026): Ort, Zeitraum (von–bis) + Detail-URL. Alle optional.
        for _col in ("location", "date_start", "date_end", "detail_url"):
            try:
                con.execute(f"ALTER TABLE taxonomy_event ADD COLUMN {_col} TEXT")
            except sqlite3.OperationalError:
                pass
        # Exakte Sterne-Summe (edu-sharing overall.sum) statt Durchschnitt×Anzahl.
        try:
            con.execute("ALTER TABLE idea ADD COLUMN rating_sum REAL DEFAULT 0")
        except sqlite3.OperationalError:
            pass
        # Vote-Ledger: updated_at (letzte Wertänderung) ergänzen; created_at
        # bleibt die unveränderliche Erstabgabe.
        try:
            con.execute("ALTER TABLE vote_event ADD COLUMN updated_at TEXT")
        except sqlite3.OperationalError:
            pass
        # Team-/Mithacken-Workflow (Juni 2026): Mithackende schreiben sich als
        # 'interest' ein (status='pending'). Owner/Mod kann sie annehmen
        # (status='approved' → grünes Häkchen) und optional Bearbeitungsrecht
        # erteilen (can_edit=1 → „Mitwirkende:r"). 'follow' bleibt unberührt.
        try:
            con.execute(
                "ALTER TABLE idea_interaction ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'"
            )
        except sqlite3.OperationalError:
            pass
        try:
            con.execute(
                "ALTER TABLE idea_interaction ADD COLUMN can_edit INTEGER NOT NULL DEFAULT 0"
            )
        except sqlite3.OperationalError:
            pass
        # Voll-Cache der Detailseite (Juni 2026): die teuren Live-Reads von
        # get_idea im Cache halten.
        #  - Kommentar-Thread (`comments_cache`): `comments_cache_count` merkt den
        #    comment_count zum Cache-Zeitpunkt; weicht er vom aktuellen ab
        #    (nächster Sync / Post / Delete bumpen die Zahl), wird neu geholt.
        #  - Child-IO-Anhänge (`children_cache`): kein Count-Signal verfügbar →
        #    `children_cache_at` (ISO-Zeitstempel) steuert eine kurze TTL.
        # Alle Spalten additiv/optional → kein Bruch des bestehenden Stands.
        for _ddl in (
            "ALTER TABLE idea ADD COLUMN comments_cache TEXT",
            "ALTER TABLE idea ADD COLUMN comments_cache_count INTEGER",
            "ALTER TABLE idea ADD COLUMN children_cache TEXT",
            "ALTER TABLE idea ADD COLUMN children_cache_at TEXT",
        ):
            try:
                con.execute(_ddl)
            except sqlite3.OperationalError:
                pass
        # Owner-Klarname (Vor- + Nachname aus edu-sharing createdBy/owner) im
        # Cache halten, damit die Detailseite ihn ohne Live-Call zeigt — und NIE
        # den Login-Username (zugleich Anmeldename) öffentlich anzeigen muss.
        try:
            con.execute("ALTER TABLE idea ADD COLUMN owner_display_name TEXT")
        except sqlite3.OperationalError:
            pass
        # User-Notification-Cursor: wann hat der User seinen Feed zuletzt
        # angesehen? Aktivitäten danach gelten als „neu" und werden im
        # Profil-Tab "Was ist neu" mit Badge gezählt.
        con.execute(
            """CREATE TABLE IF NOT EXISTS user_feed_seen (
                 user_key TEXT PRIMARY KEY,
                 last_seen TEXT NOT NULL
               )"""
        )
        # User-Profil-Felder (App-seitig, NICHT in edu-sharing). Pflegbar
        # über "Mein Bereich → Profil bearbeiten". Werden im öffentlichen
        # Profil angezeigt.
        con.execute(
            """CREATE TABLE IF NOT EXISTS user_profile_meta (
                 username        TEXT PRIMARY KEY,
                 display_name    TEXT,
                 bio             TEXT,
                 website         TEXT,
                 role            TEXT,
                 updated_at      TEXT NOT NULL
               )"""
        )
        con.execute(
            "CREATE INDEX IF NOT EXISTS topic_sort_idx ON topic(parent_id, sort_order, title)"
        )
        # Index für den Ghost-Cleanup (DELETE … WHERE id IN (SELECT original_id …))
        # und das Inbox-„bereits einsortiert"-Lookup — beide gehen über original_id.
        con.execute("CREATE INDEX IF NOT EXISTS idea_original_idx ON idea(original_id)")
        # seed phases on first start (idempotent)
        existing = con.execute("SELECT COUNT(*) FROM taxonomy_phase").fetchone()[0]
        if existing == 0:
            now = datetime.now(UTC).isoformat()
            con.executemany(
                "INSERT INTO taxonomy_phase (slug,label,sort_order,active,created_at,created_by) "
                "VALUES (?,?,?,1,?,'system')",
                [(slug, label, order, now) for slug, label, order in DEFAULT_PHASES],
            )
        # Aufräumen: Im neuen Modell sind alle Ideen ccm:io. Falls noch
        # Cache-Reste mit kind='collection' aus älteren Sync-Versionen
        # vorliegen, einmalig entfernen. edu-sharing-Daten werden NICHT
        # angefasst — der Cache rebuilt sich beim nächsten Sync.
        con.execute("DELETE FROM idea WHERE kind = 'collection'")
        con.execute("DELETE FROM idea_fts WHERE id NOT IN (SELECT id FROM idea)")


# ===== Thread-lokaler Connection-Pool =======================================
# Live-Befund (Instanz-Vergleich idee.hackathoern.de): Auf trägem Storage
# kostet JEDES Öffnen der DB-Datei (open + Header-Page + PRAGMAs) ~35–40 ms —
# Endpoints mit mehreren DB-Blöcken multiplizieren das (get_idea 303 ms vs.
# 40 ms auf gesundem Storage). Deshalb hält jeder Worker-Thread EINE offene
# Connection; die Contextmanager-Semantik von `connect()` (Commit bei Erfolg,
# Rollback bei Exception) bleibt exakt erhalten.
#
# Invalidierung — die drei Fälle, in denen NICHT wiederverwendet wird:
#   1. `settings.sqlite_path` hat gewechselt (Test-Hermetik: frisches tmp_path
#      pro Test) → alte Connection wird verworfen.
#   2. `invalidate_pooled_connections()` wurde gerufen (Restore tauscht die
#      DB-DATEI aus: offene Handles zeigten auf Linux sonst auf die alte
#      Inode, auf Windows blockierten sie den Datei-Tausch komplett).
#   3. Verschachteltes `connect()` im selben Thread → frische WEGWERF-
#      Connection, damit ein inneres Commit nie die äußere, noch offene
#      Transaktion mit-committet (Sicherheitsnetz; im Code gibt es keine
#      Verschachtelung, aber dieses Semantik-Risiko darf nicht am Aufrufer
#      hängen).
#
# `check_same_thread=False`: die Connection wird weiterhin nur von ihrem
# Besitzer-Thread BENUTZT (thread-local) — das Flag erlaubt lediglich dem
# Restore-/Test-Teardown, fremde Handles zu SCHLIESSEN.

_POOL_LOCK = threading.Lock()
# thread-id → Connection. Nur fürs zentrale Schließen (Restore/Teardown);
# die Wiederverwendung selbst läuft über das schnellere threading.local().
_POOL: dict[int, sqlite3.Connection] = {}
_LOCAL = threading.local()
_GENERATION = 0


def _open_connection(path: str) -> sqlite3.Connection:
    con = sqlite3.connect(path, timeout=30.0, check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    con.execute("PRAGMA synchronous = NORMAL")
    con.execute("PRAGMA busy_timeout = 30000")
    # Performance-Haertung, alle per-Connection (daher hier, nicht in init_db):
    #   cache_size (negativ = KiB) ~2 MB. Vor dem Pooling waren es 8 MB — mit
    #     langlebigen Connections in bis zu ~100 Worker-Threads (32 asyncio +
    #     64 anyio) würde das im 1-Gi-Container bis ~800 MB binden. Reads
    #     trägt ohnehin das 128-MB-mmap (prozessweit geteilt, page-cache-
    #     backed); der private Page-Cache braucht nur Arbeits-Seiten.
    #   temp_store=MEMORY → ORDER BY/GROUP BY ohne passenden Index im RAM statt in
    #     einer Temp-Datei (z.B. Sortierung nach created/comments).
    #   mmap_size=128 MB → Reads ohne read()-Syscall/Copy, spuerbar bei grosser WAL.
    #   journal_size_limit=16 MB → die .db-wal-Datei wird nach einem Checkpoint auf
    #     <=16 MB gekappt statt unbegrenzt zu wachsen (sonst Read-Bremse, weil jeder
    #     Query zusaetzlich die WAL durchsuchen muss).
    con.execute("PRAGMA cache_size = -2000")
    con.execute("PRAGMA temp_store = MEMORY")
    con.execute("PRAGMA mmap_size = 134217728")
    con.execute("PRAGMA journal_size_limit = 16777216")
    return con


def _drop_local_connection() -> None:
    """Wirft die thread-lokale Connection weg (best-effort close + Registry)."""
    con = getattr(_LOCAL, "con", None)
    _LOCAL.con = None
    if con is None:
        return
    with _POOL_LOCK:
        tid = threading.get_ident()
        if _POOL.get(tid) is con:
            del _POOL[tid]
    try:
        con.close()
    except Exception:
        pass  # bereits geschlossen (z.B. durch invalidate) — egal


def open_probe_ms() -> float:
    """Misst die Kosten EINER frischen DB-Datei-Öffnung (open + Header-Page +
    PRAGMAs) in Millisekunden — die Kennzahl der Storage-These: auf gesundem
    Storage <1 ms, auf trägem ~35–40 ms (Live-Instanz-Vergleich 07/2026).
    Wird in den /status-Mod-Diagnostics ausgewiesen, damit sich die Storage-
    Gesundheit pro Instanz direkt vor Ort ablesen und vergleichen lässt."""
    import time

    _ensure_dir()
    t0 = time.perf_counter()
    con = _open_connection(str(settings.sqlite_path))
    try:
        con.execute("SELECT 1").fetchone()
    finally:
        con.close()
    return (time.perf_counter() - t0) * 1000.0


def invalidate_pooled_connections() -> None:
    """Schließt ALLE gepoolten Connections und erhöht die Generation, sodass
    jeder Thread beim nächsten `connect()` frisch öffnet.

    MUSS vor dem Restore-Datei-Swap laufen (backup.restore_backup): auf
    Windows blockieren offene Handles den Tausch, auf Linux läsen sie danach
    die alte Inode. Ein Worker, der GENAU in diesem Moment mitten in einer
    Query steckt, bekommt einen sqlite3-Fehler und sein Request schlägt
    kontrolliert fehl — akzeptiert für die seltene Restore-Wartung."""
    global _GENERATION
    with _POOL_LOCK:
        _GENERATION += 1
        for con in _POOL.values():
            try:
                con.close()
            except Exception:
                pass
        _POOL.clear()


@contextmanager
def connect():
    """Connection-Kontext mit großzügigem busy_timeout — thread-lokal gepoolt
    (Begründung + Invalidierungsregeln: Kommentarblock oben).

    Der WAL-Journal-Mode ist eine *persistente* Eigenschaft der DB-Datei und
    wird einmalig in `init_db()` gesetzt (beim Start und nach jedem Restore,
    der ebenfalls `init_db()` aufruft) — nicht bei jeder Verbindung. WAL
    erlaubt einen Writer + mehrere Reader gleichzeitig und verhindert die
    `database is locked`-Fehler, wenn Sync parallel zu User-Aktionen schreibt.

    `busy_timeout=30000` lässt SQLite bis zu 30 Sekunden auf einen Lock warten,
    statt sofort mit `database is locked` abzubrechen. Der Sync hält die
    Connection NICHT über die edu-sharing-Roundtrips offen (erst alles lesen,
    dann in EINER kurzen Transaktion schreiben), sodass der Write-Lock nur
    Millisekunden gehalten wird — der 30s-Timeout ist nur das Sicherheitsnetz.
    """
    _ensure_dir()
    path = str(settings.sqlite_path)

    if getattr(_LOCAL, "in_use", False):
        # Verschachtelung → Wegwerf-Connection (Invalidierungsfall 3).
        con = _open_connection(path)
        try:
            yield con
            con.commit()
        except BaseException:
            try:
                con.rollback()
            except Exception:
                pass
            raise
        finally:
            con.close()
        return

    con = getattr(_LOCAL, "con", None)
    if (
        con is None
        or getattr(_LOCAL, "path", None) != path
        or getattr(_LOCAL, "generation", None) != _GENERATION
    ):
        _drop_local_connection()
        con = _open_connection(path)
        _LOCAL.con = con
        _LOCAL.path = path
        _LOCAL.generation = _GENERATION
        with _POOL_LOCK:
            tid = threading.get_ident()
            stale = _POOL.get(tid)
            if stale is not None and stale is not con:
                # Thread-ID-Wiederverwendung nach Thread-Ende: Altlast schließen.
                try:
                    stale.close()
                except Exception:
                    pass
            _POOL[tid] = con

    _LOCAL.in_use = True
    try:
        yield con
        con.commit()
    except BaseException:
        try:
            con.rollback()
        except Exception:
            pass
        # Zustand unklar (z.B. von invalidate geschlossen) → nicht weiterreichen.
        _drop_local_connection()
        raise
    finally:
        _LOCAL.in_use = False
