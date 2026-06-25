"""Sync job: walk root → topics → challenges → ideas, mirror into SQLite.

Structure (matches current HackathOERn-Ideensammlung, Stand 2026-04):
  Root (ccm:map)
    Topic (ccm:map)                   -> topic.parent_id = NULL          (11×)
      Challenge (ccm:map)             -> topic.parent_id = topic.id
        Idea (ccm:io)                 -> idea.kind = 'io', topic_id = challenge
        Anhänge-Sammlung (ccm:map)    -> Geschwister, Keyword `attachment-of:<idea-id>`,
                                         wird an die Idee gehängt — keine eigene Idee.

Eine Idee ist immer ein ccm:io. Sammlungen sind ausschließlich Hierarchie
(Themen/Herausforderungen) oder Anhänge-Container.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
from datetime import UTC, datetime, timedelta

from . import edu_sharing
from .db import connect

log = logging.getLogger(__name__)

# Verhindert, dass Lifespan-Loop und manueller `POST /admin/sync` parallel
# laufen und die SQLite mit „database is locked" abschießen.
_sync_lock = asyncio.Lock()

# Mindestabstand zwischen zwei Trend-Snapshot-VERSUCHEN (Debounce-Floor).
# Option B: Es wird höchstens alle 5 Min geprüft, ob sich etwas geändert
# hat — und nur dann tatsächlich ein Snapshot geschrieben (siehe
# _capture_ranking_snapshot, Top-N-Order-Vergleich). So entsteht pro echter
# Rang-Änderung ein Punkt, ohne dass identische Stände den Chart zumüllen.
SNAPSHOT_MIN_INTERVAL = timedelta(minutes=5)
PHASE_PREFIX = "phase:"
EVENT_PREFIX = "event:"
TOPIC_PREFIX = "topic:"

# Legacy-Slug → kanonischer Slug. Reference-Knoten in edu-sharing sind
# nach Erstellung „eingefroren" — ES bietet keine API um sie auf das
# Original umzustellen. Daher normalisieren wir clientseitig beim Sync,
# damit die Cache-/Filter-Ansicht konsistent ist.
EVENT_SLUG_ALIASES = {
    "hackthoern-01": "hackathoern-1",
    "hackathoern-02": "hackathoern-2",
    "hackathoern-03": "hackathoern-3",
}

# Properties, die der Sync tatsächlich aus den Knoten liest. Statt `-all-`
# (Dutzende Properties) nur diese anfordern → kleinere Antworten, weniger
# Alfresco-Arbeit pro Call. WICHTIG: vollständig halten — fehlt eine, geht das
# Feld beim nächsten Sync still verloren. Knoten-Felder (rating, preview,
# commentCount, mimetype, originalId, owner, created/modifiedAt) sind KEINE
# Properties und kommen ohnehin immer mit.
_SYNC_PROPS = [
    "cclom:general_keyword",
    "ccm:collection_color",
    "cm:name",
    "cm:description",
    "cclom:general_description",
    "ccm:author_freetext",
    "cm:creator",
    "ccm:wwwurl",
    "cm:owner",
]

# Legacy-Anhang-Ordner (ccm:map-Geschwister mit `attachment-of:`) sind die
# teuerste Untersammlungs-Abfrage (1× pro Challenge). Neue Anhänge laufen als
# Child-IO; Altordner werden über scripts/cleanup_old_attachment_folders.py
# abgebaut. Daher den Scan nur noch jeden N-ten Sync-Lauf als Sicherheitsnetz
# fahren — KEIN zweiter Timer, nur ein Zähler auf demselben Sync-Loop. Der erste
# Lauf nach (Re-)Start scannt (n % N == 1).
_ATTACHMENT_SCAN_EVERY = 4  # bei 15-Min-Intervall ~stündlich
_sync_run_counter = 0


def _iso_now() -> str:
    return datetime.now(UTC).isoformat()


def _props(node: dict) -> dict:
    return node.get("properties") or {}


def _first(props: dict, key: str) -> str | None:
    v = props.get(key)
    if isinstance(v, list):
        return v[0] if v else None
    return v


def _keywords(props: dict) -> list[str]:
    v = props.get("cclom:general_keyword") or []
    if isinstance(v, str):
        v = [v]
    return [str(x) for x in v]


def _classify_keywords(kws: list[str]) -> tuple[str | None, list[str], list[str], list[str]]:
    """Split keywords into (phase, events, categories, other)."""
    phase: str | None = None
    events: list[str] = []
    categories: list[str] = []
    other: list[str] = []
    for k in kws:
        lk = k.strip()
        if lk.lower().startswith(PHASE_PREFIX):
            phase = lk[len(PHASE_PREFIX) :]
        elif lk.lower().startswith(EVENT_PREFIX):
            slug = lk[len(EVENT_PREFIX) :]
            events.append(EVENT_SLUG_ALIASES.get(slug, slug))
        elif lk.lower().startswith(TOPIC_PREFIX):
            categories.append(lk[len(TOPIC_PREFIX) :])
        elif lk.lower().startswith("submitter:"):
            # interner Tracking-Keyword — nicht in der UI-Keyword-Liste anzeigen
            continue
        elif lk.lower().startswith("target-topic:"):
            # Vom Submit-Formular automatisch gesetzter Hinweis-Marker für die
            # Moderation. Bleibt in `cclom:general_keyword`, fällt aber aus
            # der UI-sichtbaren Keyword-Liste raus.
            continue
        else:
            other.append(lk)
    return phase, events, categories, other


def _rating(node: dict) -> tuple[float, int, float]:
    """(Durchschnitt, Anzahl, Summe) der Sternwerte. edu-sharing liefert die
    Summe direkt als `overall.sum` mit — exakter als Durchschnitt×Anzahl."""
    r = node.get("rating") or {}
    overall = r.get("overall") or {}
    avg = float(overall.get("rating") or 0.0)
    count = int(overall.get("count") or 0)
    # `sum` ist bei manchen Instanzen nicht gesetzt → exakt aus avg*count
    # rekonstruieren (Sternwerte sind ganzzahlig, daher verlustfrei rundbar).
    raw_sum = overall.get("sum")
    total = float(raw_sum) if raw_sum is not None else float(round(avg * count))
    return avg, count, total


def _preview(node: dict) -> str | None:
    p = node.get("preview") or {}
    if p.get("isIcon"):
        return None
    return p.get("url")


async def _pick_main_content(collection_id: str) -> str | None:
    """Find the primary ccm:io for a collection-idea (for rating/comments).
    Rule: first reference (ccm:io), else first ccm:io among children."""
    try:
        refs = await edu_sharing.client.collection_references(collection_id, max_items=5)
        for r in refs.get("references") or []:
            rid = (r.get("ref") or {}).get("id")
            if rid:
                return rid
    except Exception as e:
        log.warning("refs failed for %s: %s", collection_id, e)
    return None


def _comment_count_from_node(node: dict) -> int:
    """Prefer the commentCount field on the node (cheap), fall back to 0.
    Node metadata on redaktion.openeduhub.net exposes this directly.
    """
    v = node.get("commentCount")
    try:
        return int(v) if v is not None else 0
    except (TypeError, ValueError):
        return 0


async def _upsert_topic(con, node: dict, parent_id: str | None) -> None:
    ref = (node.get("ref") or {}).get("id")
    if not ref:
        return
    props = _props(node)
    # edu-sharing collections can carry a preview image and an optional custom color
    # (`ccm:collection_color`). Using them keeps the topics view data-driven.
    # Skip the generic collection-icon so the UI falls back to our own visuals.
    preview = node.get("preview") or {}
    preview_url = preview.get("url") if not preview.get("isIcon") else None
    # Farbe ist ein reines App-Konzept: gesetzt via PATCH /admin/topics, NICHT
    # nach edu-sharing geschrieben. Beim ERSTEN INSERT seedet ES einen evtl.
    # vorhandenen Wert; danach ist die im Cache gesetzte Farbe maßgeblich und
    # wird beim Sync bewusst NICHT überschrieben (color fehlt im ON CONFLICT-SET
    # unten — analog zu idea.hidden). Sonst würde der Sync sie alle 5 min auf
    # NULL zurücksetzen.
    color = _first(props, "ccm:collection_color")
    con.execute(
        """INSERT INTO topic (id,parent_id,title,description,preview_url,color,created_at,modified_at)
           VALUES (?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET
             parent_id=excluded.parent_id,
             title=excluded.title,
             description=excluded.description,
             preview_url=excluded.preview_url,
             modified_at=excluded.modified_at""",
        (
            ref,
            parent_id,
            node.get("title") or _first(props, "cm:name") or "(ohne Titel)",
            (node.get("collection") or {}).get("description") or _first(props, "cm:description"),
            preview_url,
            color,
            node.get("createdAt"),
            node.get("modifiedAt"),
        ),
    )


async def _upsert_idea(
    con,
    node: dict,
    *,
    kind: str = "io",
    topic_id: str,
    main_content_id: str | None,
) -> None:
    """Schreibt eine Idee in den Cache. `kind` ist immer 'io' im neuen Modell;
    der Parameter bleibt aus historischen Gründen optional, default 'io'."""
    ref = (node.get("ref") or {}).get("id")
    if not ref:
        return
    props = _props(node)
    kws = _keywords(props)
    phase, events, categories, other = _classify_keywords(kws)

    # Rating + commentCount live on the main ccm:io; fetch once and reuse.
    rating_avg = 0.0
    rating_count = 0
    rating_sum = 0.0
    comment_count = 0
    if main_content_id and main_content_id != ref:
        try:
            io_meta = await edu_sharing.client.node_metadata(main_content_id)
            io_node = io_meta.get("node") or {}
            rating_avg, rating_count, rating_sum = _rating(io_node)
            comment_count = _comment_count_from_node(io_node)
        except Exception as e:
            log.warning("metadata fetch failed for %s: %s", main_content_id, e)
    else:
        rating_avg, rating_count, rating_sum = _rating(node)
        comment_count = _comment_count_from_node(node)

    title = node.get("title") or _first(props, "cm:name") or "(ohne Titel)"
    description = (
        _first(props, "cclom:general_description")
        or _first(props, "cm:description")
        or (node.get("collection") or {}).get("description")
    )
    author = _first(props, "ccm:author_freetext") or _first(props, "cm:creator")
    project_url = _first(props, "ccm:wwwurl")

    # Attachment metadata — only present on ccm:io nodes (kind='io' OR the
    # main_content of a kind='collection' idea).
    attach_mime = None
    attach_size = None
    attach_name = None
    attach_url = None
    if kind == "io":
        attach_mime = node.get("mimetype")
        attach_size = node.get("size")
        attach_name = node.get("name")
        attach_url = node.get("downloadUrl")

    # Owner-Identität für /me/ideas. Reihenfolge:
    #   1. submitter:<user>-Keyword (gesetzt vom Submit-Endpoint, wenn der
    #      Caller eingeloggt war — überschreibt cm:creator=guest)
    #   2. cm:owner   (explizit gesetzt, z.B. nach Move durch Mod)
    #   3. cm:creator (User, der den Node angelegt hat)
    #   4. node.owner.authorityName (wenn vorhanden)
    submitter_kw = next(
        (
            k[len("submitter:") :]
            for k in (kws or [])
            if isinstance(k, str) and k.lower().startswith("submitter:")
        ),
        None,
    )
    owner_username = (
        submitter_kw
        or _first(props, "cm:owner")
        or _first(props, "cm:creator")
        or (node.get("owner") or {}).get("authorityName")
    )

    # Original-ID merken: Reference-Knoten in Sammlungen tragen
    # `originalId`, der auf den ursprünglichen Inbox-Knoten zeigt.
    # Wir nutzen das später, um „bereits einsortierte" Originals aus
    # dem Postfach-Listing auszublenden.
    original_id = node.get("originalId") or None

    con.execute(
        """INSERT INTO idea
             (id,kind,topic_id,main_content_id,title,description,preview_url,author,
              project_url,phase,events,categories,keywords,rating_avg,rating_count,
              rating_sum,comment_count,attachment_mimetype,attachment_size,attachment_name,
              attachment_url,owner_username,original_id,created_at,modified_at,synced_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET
             kind=excluded.kind,
             topic_id=excluded.topic_id,
             main_content_id=excluded.main_content_id,
             title=excluded.title,
             description=excluded.description,
             preview_url=excluded.preview_url,
             author=excluded.author,
             project_url=excluded.project_url,
             phase=excluded.phase,
             events=excluded.events,
             categories=excluded.categories,
             keywords=excluded.keywords,
             rating_avg=excluded.rating_avg,
             rating_count=excluded.rating_count,
             rating_sum=excluded.rating_sum,
             comment_count=excluded.comment_count,
             attachment_mimetype=excluded.attachment_mimetype,
             attachment_size=excluded.attachment_size,
             attachment_name=excluded.attachment_name,
             attachment_url=excluded.attachment_url,
             owner_username=excluded.owner_username,
             original_id=excluded.original_id,
             modified_at=excluded.modified_at,
             synced_at=excluded.synced_at""",
        (
            ref,
            kind,
            topic_id,
            main_content_id,
            title,
            description,
            _preview(node),
            author,
            project_url,
            phase,
            json.dumps(events, ensure_ascii=False),
            json.dumps(categories, ensure_ascii=False),
            json.dumps(other, ensure_ascii=False),
            rating_avg,
            rating_count,
            rating_sum,
            comment_count,
            attach_mime,
            attach_size,
            attach_name,
            attach_url,
            owner_username,
            original_id,
            node.get("createdAt"),
            node.get("modifiedAt"),
            _iso_now(),
        ),
    )
    con.execute("DELETE FROM idea_fts WHERE id = ?", (ref,))
    con.execute(
        "INSERT INTO idea_fts(id,title,description,keywords) VALUES (?,?,?,?)",
        (ref, title, description or "", " ".join(kws)),
    )


async def refresh_idea(idea_id: str, *, auth_header: str | None = None) -> bool:
    """Single-Node-Refresh: holt Metadaten genau einer Idee aus edu-sharing und
    schreibt nur diese eine Cache-Row neu. ~50–200ms, kein Tree-Walk.

    Verwendet nach Schreib-Operationen (Submit, Edit, Rating, Kommentar, Upload),
    damit Listen/Karten den neuen Stand sofort widerspiegeln, ohne auf den
    nächsten 5-min-Voll-Sync warten zu müssen.

    Returns True bei Erfolg, False wenn der Knoten nicht (mehr) existiert oder
    kein Eltern-Container ermittelt werden konnte. Snapshots werden NICHT
    geschrieben — die bleiben streng zeitbasiert."""
    try:
        meta = await edu_sharing.client.node_metadata(idea_id, auth_header=auth_header)
    except Exception as e:
        log.debug("refresh_idea: node_metadata fehlgeschlagen für %s: %s", idea_id, e)
        return False

    node = (meta or {}).get("node") or meta or {}
    parent = node.get("parent") or {}
    parent_id = parent.get("id") or (parent.get("ref") or {}).get("id")
    if not parent_id:
        return False

    # Inbox-Submits gehören NICHT in den Public-Cache. Sie sollen nur über
    # `GET /api/v1/inbox` für Mods sichtbar sein, bis sie verschoben werden.
    # Erst nach `moderation/move` zeigt parent_id auf eine Herausforderung,
    # dann darf ein Refresh die Idee in den Cache schreiben.
    from .config import settings

    if parent_id == settings.edu_guest_inbox_id:
        log.debug("refresh_idea: skip inbox node %s", idea_id)
        return False

    # Retry-Logik für SQLite-Lock-Konflikte. Mit dem WAL-Mode + busy_timeout
    # in db.py sollte das selten passieren, aber ein paar Retries kosten
    # nichts und decken den seltenen Fall ab, wo der Voll-Sync mehrere
    # Sekunden lang exklusiven Lock hält.
    import sqlite3

    last_err: Exception | None = None
    for attempt in range(3):
        try:
            with connect() as con:
                await _upsert_idea(
                    con,
                    node,
                    kind="io",
                    topic_id=parent_id,
                    main_content_id=idea_id,
                )
            return True
        except sqlite3.OperationalError as e:
            if "locked" not in str(e).lower():
                log.warning("refresh_idea: upsert SQL-Fehler für %s: %s", idea_id, e)
                return False
            last_err = e
            await asyncio.sleep(0.5 * (attempt + 1))  # 0.5s, 1s, 1.5s
        except Exception as e:
            log.warning("refresh_idea: upsert fehlgeschlagen für %s: %s", idea_id, e)
            return False
    log.warning("refresh_idea: nach 3 Retries gescheitert für %s: %s", idea_id, last_err)
    return False


async def run_sync(*, wait: bool = True) -> dict:
    """One full walk. Safe to call periodically.

    Sequenzialisiert über `_sync_lock`. Mit `wait=False` wird ein bereits
    laufender Sync nicht wiederholt — es wird sofort ein Hinweis-Resultat
    zurückgegeben statt zu blockieren (sinnvoll für „nice-to-have"-Trigger
    nach Edits, wo Doppel-Läufe nichts bringen)."""
    if not wait and _sync_lock.locked():
        return {
            "started_at": _iso_now(),
            "finished_at": _iso_now(),
            "topics_seen": 0,
            "ideas_seen": 0,
            "skipped": True,
            "reason": "sync already running",
        }
    async with _sync_lock:
        return await _run_sync_locked()


async def _run_sync_locked() -> dict:
    from .config import settings  # local to avoid cycle at import-time

    started = _iso_now()
    # Sync-Lauf zählen → Legacy-Anhang-Scan nur jeden N-ten Lauf (s.o.).
    global _sync_run_counter
    _sync_run_counter += 1
    scan_attachments = _sync_run_counter % _ATTACHMENT_SCAN_EVERY == 1
    topics_seen = 0
    ideas_seen = 0
    err: str | None = None

    skipped: list[str] = []  # node-IDs, die wir wegen 401/403/etc. übersprungen haben

    async def _safe(coro, label: str):
        """Wrapt einen einzelnen ES-Call. 401/403 → return None + Log,
        sodass der gesamte Sync nicht abbricht, wenn nur einzelne Knoten
        nicht lesbar sind (z.B. Gast ohne Admin auf einer privaten Idee)."""
        try:
            return await coro
        except Exception as e:
            from httpx import HTTPStatusError

            if isinstance(e, HTTPStatusError) and e.response.status_code in (401, 403, 404):
                log.info("sync skip %s: %s", label, e.response.status_code)
                skipped.append(label)
                return None
            log.warning("sync %s failed: %s", label, e)
            return None

    try:
        # ---- PHASE 1: NUR LESEN (Netzwerk-Awaits, KEINE DB-Connection) ------
        # Erst den kompletten Sammlungs-Baum aus edu-sharing holen und in
        # einfache Python-Listen sammeln. Hier ist KEIN SQLite-Lock offen — das
        # langsame Alfresco-Backend blockiert also keine parallelen Schreibenden
        # mehr (vorher hing der Write-Lock über genau diesen Roundtrips, was
        # User-Writes bis zum busy_timeout staute → sporadische 503/Hänger).
        topic_writes: list[tuple[dict, str | None]] = []  # (node, parent_id)
        idea_writes: list[tuple[dict, str]] = []  # (ref_node, topic_id=chid)
        attach_writes: list[tuple[str, str]] = []  # (sub_id, attach_of)

        # Root's immediate children = Themen
        themes = await edu_sharing.client.collection_subcollections(
            settings.ideendb_root_collection_id, max_items=100, property_filter=_SYNC_PROPS
        )
        for theme in themes.get("collections") or []:
            tid = (theme.get("ref") or {}).get("id")
            if not tid:
                continue
            topic_writes.append((theme, None))

            # Herausforderungen (2. Ebene)
            challenges = (
                await _safe(
                    edu_sharing.client.collection_subcollections(
                        tid, max_items=100, property_filter=_SYNC_PROPS
                    ),
                    f"theme:{tid}",
                )
                or {}
            )
            for ch in challenges.get("collections") or []:
                chid = (ch.get("ref") or {}).get("id")
                if not chid:
                    continue
                topic_writes.append((ch, tid))

                # HackathOERn-Architektur: Ideen leben als ccm:io in der Inbox.
                # Sammlungen (Challenges) hängen sie als `ccm:io_reference`-
                # Knoten ein (originalId → Inbox-Knoten).
                ch_refs = (
                    await _safe(
                        edu_sharing.client.collection_references(
                            chid, max_items=200, property_filter=_SYNC_PROPS
                        ),
                        f"challenge:{chid}",
                    )
                    or {}
                )
                for ref_node in ch_refs.get("references") or []:
                    if not (ref_node.get("ref") or {}).get("id"):
                        continue
                    idea_writes.append((ref_node, chid))

                # Anhänge-Sammlungen sind ccm:map-Geschwister mit Keyword
                # `attachment-of:<idea-id>`. LEGACY: nur jeden N-ten Lauf scannen
                # (teuerste Untersammlungs-Abfrage).
                if scan_attachments:
                    ch_subs = (
                        await _safe(
                            edu_sharing.client.collection_subcollections(
                                chid, max_items=200, property_filter=_SYNC_PROPS
                            ),
                            f"challenge-subs:{chid}",
                        )
                        or {}
                    )
                    for sub in ch_subs.get("collections") or []:
                        sub_kws = _keywords(_props(sub))
                        attach_of = next(
                            (
                                k[len("attachment-of:") :]
                                for k in sub_kws
                                if k.lower().startswith("attachment-of:")
                            ),
                            None,
                        )
                        if not attach_of:
                            continue
                        sub_id = (sub.get("ref") or {}).get("id")
                        if not sub_id:
                            continue
                        attach_writes.append((sub_id, attach_of))

        # ---- PHASE 2: NUR SCHREIBEN (synchron, kurzer Lock, KEIN await) ------
        # Jetzt EINE Connection öffnen und alles am Stück schreiben. In diesem
        # Block gibt es KEIN `await` auf Netzwerk-I/O → der SQLite-Write-Lock
        # wird nur für die millisekunden-schnellen Schreibvorgänge gehalten,
        # nicht über die edu-sharing-Roundtrips. (`_upsert_topic`/`_upsert_idea`
        # sind zwar `async`, suspendieren auf diesem Pfad aber nicht:
        # main_content_id == ref → kein node_metadata-Await; sie laufen rein
        # synchron durch.) Ein einziger Commit am Blockende reicht.
        with connect() as con:
            for node, parent_id in topic_writes:
                await _upsert_topic(con, node, parent_id=parent_id)
                topics_seen += 1
            for ref_node, chid in idea_writes:
                ref_id = (ref_node.get("ref") or {}).get("id")
                try:
                    await _upsert_idea(
                        con,
                        ref_node,
                        kind="io",
                        topic_id=chid,
                        main_content_id=ref_id,
                    )
                    ideas_seen += 1
                except Exception as e:
                    log.warning("sync upsert ref %s failed: %s", ref_id, e)
                    skipped.append(f"idea-ref:{ref_id}")
            for sub_id, attach_of in attach_writes:
                con.execute(
                    "UPDATE idea SET attachment_folder_id=? WHERE id=?",
                    (sub_id, attach_of),
                )

            # Trend-Snapshot: aktuellen Stand der Top-Listen je Event/Sort
            # persistieren. Throttled auf SNAPSHOT_MIN_INTERVAL, damit das
            # 30er-Limit der ranking_snapshot-Tabelle nicht in 2.5h voll ist.
            if _should_capture_snapshot(con):
                _capture_ranking_snapshot(con, _iso_now())

            # Geisterzeilen aufräumen: Inbox-Originale (deren id auch als
            # original_id eines Reference-Eintrags vorkommt) gehören NICHT
            # in den Public-Cache — der Reference-Eintrag repräsentiert sie
            # in den Challenges. So bleibt die Idee-Liste pro Sync sauber,
            # auch wenn ein Knoten umgehängt wurde.
            con.execute(
                """DELETE FROM idea WHERE id IN (
                       SELECT original_id FROM idea
                       WHERE original_id IS NOT NULL
                   )"""
            )
            con.execute("DELETE FROM idea_fts WHERE id NOT IN (SELECT id FROM idea)")

            # Activity-Log gleich mit ausdünnen — billig und passt zum Sync-Tick.
            _prune_activity_log(con)

            con.execute(
                """INSERT INTO sync_log (started_at,finished_at,topics_seen,ideas_seen,error)
                   VALUES (?,?,?,?,?)""",
                (started, _iso_now(), topics_seen, ideas_seen, None),
            )
    except Exception as e:
        err = f"{type(e).__name__}: {e}"
        log.exception("sync failed")
        with connect() as con:
            con.execute(
                """INSERT INTO sync_log (started_at,finished_at,topics_seen,ideas_seen,error)
                   VALUES (?,?,?,?,?)""",
                (started, _iso_now(), topics_seen, ideas_seen, err),
            )

    return {
        "started_at": started,
        "finished_at": _iso_now(),
        "topics_seen": topics_seen,
        "ideas_seen": ideas_seen,
        "skipped_count": len(skipped),
        "skipped_examples": skipped[:10],
        "error": err,
    }


# ===== Rating-Verfall (exponentiell mit Mindestgewicht) =================
def _decay_weight(iso: str, lam: float, now: datetime, floor: float = 0.0) -> float:
    """Gewicht einer Stimme nach Alter: w(t)=max(floor, e^(−λ·t)), t in Tagen.
    `floor` = Verfallsstopp (Mindestgewicht), damit alte Stimmen nicht auf 0
    fallen."""
    if lam <= 0:
        return 1.0
    try:
        d = datetime.fromisoformat(iso)
    except Exception:
        return 1.0
    if d.tzinfo is None:
        d = d.replace(tzinfo=UTC)
    age_days = max(0.0, (now - d).total_seconds() / 86400.0)
    return max(floor, math.exp(-lam * age_days))


def decay_scores(con, mode: str) -> dict[str, float]:
    """Verfallsgewichteter Score je Idee.

    mode 'stars'  → Σ Sternwert·w(t)  (+ Legacy-Seed seed_sum·w)
    mode 'thumbs' → Σ 1·w(t)          (+ Legacy-Seed seed_count·w)

    Quelle ist das `vote_event`-Ledger (echte Zeitstempel ab Einführung)
    plus der einmalige `idea_score_seed` für Altbestand. λ + Mindestgewicht
    (floor) kommen aus der Config. Bei deaktiviertem Verfall (λ=0) entspricht
    das Ergebnis exakt der kumulativen Absolutsumme."""
    from .config import settings

    lam = settings.rating_decay_lambda
    floor = settings.rating_decay_floor
    now = datetime.now(UTC)
    out: dict[str, float] = {}
    for r in con.execute("SELECT idea_id, value, created_at FROM vote_event").fetchall():
        unit = float(r["value"]) if mode == "stars" else 1.0
        out[r["idea_id"]] = out.get(r["idea_id"], 0.0) + unit * _decay_weight(
            r["created_at"], lam, now, floor
        )
    for r in con.execute(
        "SELECT idea_id, seed_sum, seed_count, seeded_at FROM idea_score_seed"
    ).fetchall():
        base = float(r["seed_sum"]) if mode == "stars" else float(r["seed_count"])
        if base:
            out[r["idea_id"]] = out.get(r["idea_id"], 0.0) + base * _decay_weight(
                r["seeded_at"], lam, now, floor
            )
    return out


def ensure_vote_seed(con) -> None:
    """Einmaliger Legacy-Seed: erfasst die zum Einführungszeitpunkt bereits in
    edu-sharing vorhandenen Bewertungen als gebündelten, datierten Altbestand,
    damit der Verfalls-Score nicht bei 0 startet. Idempotent über einen Marker
    in app_setting."""
    done = con.execute("SELECT value FROM app_setting WHERE key='vote_seed_done'").fetchone()
    if done and done["value"] == "1":
        return
    now = _iso_now()
    rows = con.execute(
        "SELECT id, rating_avg, rating_count, rating_sum FROM idea "
        "WHERE COALESCE(rating_count,0) > 0"
    ).fetchall()
    for r in rows:
        cnt = int(r["rating_count"] or 0)
        # Exakte Summe aus edu-sharing (overall.sum) bevorzugen, sonst aus
        # Durchschnitt×Anzahl rekonstruieren.
        seed_sum = round(float(r["rating_sum"] or 0.0)) or round(
            float(r["rating_avg"] or 0.0) * cnt
        )
        con.execute(
            "INSERT OR IGNORE INTO idea_score_seed "
            "(idea_id,seed_sum,seed_count,seeded_at) VALUES (?,?,?,?)",
            (r["id"], seed_sum, cnt, now),
        )
    # Marker NUR setzen, wenn es etwas zu seeden gab. Auf einer frisch
    # deployten (leeren) DB läuft dieser Aufruf VOR dem ersten Sync — der
    # idea-Cache ist dann noch leer. Würden wir den Marker hier brennen, gingen
    # die in edu-sharing bereits vorhandenen Alt-Bewertungen nie in den
    # Verfalls-Score ein. Ohne Marker greift der nächste Aufruf (beim ersten
    # Snapshot nach dem Sync), sobald der Cache gefüllt ist.
    if rows:
        con.execute(
            "INSERT INTO app_setting (key,value) VALUES ('vote_seed_done','1') "
            "ON CONFLICT(key) DO UPDATE SET value='1'"
        )
    # Alte 'rating'-Snapshots haben die frühere Avg-Skala (~0..5); ab jetzt
    # speichern wir den Verfalls-Score (deutlich größere Skala). Einmal leeren,
    # damit der Verlaufs-Chart keine Maßstabs-Stufe zeigt.
    con.execute("DELETE FROM ranking_snapshot WHERE sort IN ('rating','likes')")
    log.info("ensure_vote_seed: %d Ideen als Legacy-Seed erfasst", len(rows))


# ===== Ranking Snapshots =================================================
SNAPSHOT_TOP_N = 50
# Auch ohne Rang-Änderung mindestens 1× täglich ein Snapshot je Board, damit
# der „Letzter Snapshot"-Zeitstempel aktuell bleibt (sonst steht da bei ruhigen
# Phasen tagealtes Datum). Siehe _capture_ranking_snapshot.
SNAPSHOT_MAX_AGE = timedelta(hours=24)
# Sorts mit Verfall (Score = decay_scores) vs. einfache Zähl-Sorts.
SNAPSHOT_DECAY_MODE = {"rating": "stars", "likes": "thumbs"}
SNAPSHOT_SORTS = (
    ("rating", "rating_avg", "rating_count"),  # tie-breaker rating_count
    ("likes", "rating_count", "comment_count"),  # Daumen-Modus: Anzahl = Likes
    ("comments", "comment_count", "rating_avg"),
    ("interest", "interest_count", "comment_count"),
)


def _should_capture_snapshot(con) -> bool:
    """True wenn der letzte Snapshot älter als `SNAPSHOT_MIN_INTERVAL` ist
    (oder noch keiner existiert)."""
    row = con.execute("SELECT MAX(snapshot_at) AS last FROM ranking_snapshot").fetchone()
    last = row["last"] if row else None
    if not last:
        return True
    try:
        last_dt = datetime.fromisoformat(last)
    except Exception:
        return True
    if last_dt.tzinfo is None:
        last_dt = last_dt.replace(tzinfo=UTC)
    return datetime.now(UTC) - last_dt >= SNAPSHOT_MIN_INTERVAL


def _capture_ranking_snapshot(con, ts: str) -> None:
    """Schreibt Top-N je (event, sort) als Snapshot. Wird einmal pro Sync-Lauf
    gerufen. Vor dem Insert werden ältere Snapshots ausgedünnt (siehe
    `_prune_snapshots`), damit die Tabelle nicht unbegrenzt wächst."""

    # Legacy-Stimmen einmalig erfassen, damit der Verfalls-Score Bestand hat.
    ensure_vote_seed(con)

    # Welche Events kommen in den Ideen vor? `events` ist JSON-Array.
    rows = con.execute(
        "SELECT DISTINCT events FROM idea WHERE events IS NOT NULL AND events != '[]'"
    ).fetchall()
    event_slugs: set[str] = set()
    for r in rows:
        try:
            for s in json.loads(r["events"] or "[]"):
                if s:
                    event_slugs.add(str(s))
        except Exception:
            continue

    # Pro-Idee Interest-Count vorberechnen (sort='interest').
    interest_map = {
        r["idea_id"]: r["c"]
        for r in con.execute(
            "SELECT idea_id, COUNT(*) AS c FROM idea_interaction "
            "WHERE kind='interest' GROUP BY idea_id"
        ).fetchall()
    }
    # Verfalls-Scores je Modus einmal vorberechnen (idee_id → Score).
    decay_by_mode = {m: decay_scores(con, m) for m in set(SNAPSHOT_DECAY_MODE.values())}

    def _rank_for(event_filter: str | None, sort_key: str, primary: str, secondary: str):
        # Trend-Snapshots sollen nur Ideen enthalten, die im jeweiligen
        # Sort-Kriterium *tatsächlich Aktivität* haben — sonst füllen 0er
        # die Top-N mit zufällig gewählten Karteileichen auf, was die
        # Verlaufs-Charts unbrauchbar macht.
        where = []
        params: list = []
        if event_filter:
            # Wildcards escapen (Konsistenz mit routes.py). event_filter ist ein
            # DB-Slug, daher i.d.R. harmlos — aber sauber gehalten.
            ef = event_filter.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            where.append("events LIKE ? ESCAPE '\\'")
            params.append(f'%"{ef}"%')

        # Rating/Likes: Score = verfallsgewichtet (decay_scores).
        decay_mode = SNAPSHOT_DECAY_MODE.get(sort_key)
        if decay_mode:
            dmap = decay_by_mode[decay_mode]
            sql_where = (" WHERE " + " AND ".join(where)) if where else ""
            ideas = con.execute(f"SELECT id FROM idea{sql_where}", params).fetchall()
            scored = [(r["id"], dmap.get(r["id"], 0.0)) for r in ideas]
            scored = [t for t in scored if t[1] > 0]
            scored.sort(key=lambda t: -t[1])
            return [(iid, round(s, 3)) for iid, s in scored[:SNAPSHOT_TOP_N]]

        if sort_key == "interest":
            sql_where = (" WHERE " + " AND ".join(where)) if where else ""
            ideas = con.execute(
                f"SELECT id, comment_count, rating_avg FROM idea{sql_where}",
                params,
            ).fetchall()
            scored = [
                (r["id"], float(interest_map.get(r["id"], 0)), float(r["comment_count"] or 0))
                for r in ideas
                if interest_map.get(r["id"], 0) > 0  # nur Ideen mit Mitmachen-Klick
            ]
            scored.sort(key=lambda t: (-t[1], -t[2]))
            return [(idea_id, score) for idea_id, score, _ in scored[:SNAPSHOT_TOP_N]]

        # Comments: nur Ideen mit primary > 0
        where.append(f"{primary} > 0")
        sql_where = " WHERE " + " AND ".join(where)
        ideas = con.execute(
            f"SELECT id, {primary} AS p, {secondary} AS s FROM idea{sql_where} "
            f"ORDER BY p DESC, s DESC LIMIT ?",
            (*params, SNAPSHOT_TOP_N),
        ).fetchall()
        return [(r["id"], float(r["p"] or 0)) for r in ideas]

    def _latest_order(ev: str, sort_key: str) -> list[str]:
        """Idee-IDs in Rang-Reihenfolge des jüngsten Snapshots für
        (event, sort) — für den Änderungs-Vergleich."""
        last = con.execute(
            "SELECT MAX(snapshot_at) AS m FROM ranking_snapshot WHERE event=? AND sort=?",
            (ev, sort_key),
        ).fetchone()
        last_at = last["m"] if last else None
        if not last_at:
            return []
        return [
            r["idea_id"]
            for r in con.execute(
                "SELECT idea_id FROM ranking_snapshot "
                "WHERE event=? AND sort=? AND snapshot_at=? ORDER BY rank ASC",
                (ev, sort_key, last_at),
            ).fetchall()
        ]

    def _latest_at(ev: str, sort_key: str) -> str | None:
        row = con.execute(
            "SELECT MAX(snapshot_at) AS m FROM ranking_snapshot WHERE event=? AND sort=?",
            (ev, sort_key),
        ).fetchone()
        return row["m"] if row else None

    def _is_stale(last_at: str | None) -> bool:
        """True wenn der letzte Board-Snapshot fehlt oder älter als
        SNAPSHOT_MAX_AGE ist → täglicher Heartbeat, damit der „Letzter
        Snapshot"-Zeitstempel auch in ruhigen Phasen aktuell bleibt."""
        if not last_at:
            return True
        try:
            d = datetime.fromisoformat(last_at)
        except Exception:
            return True
        if d.tzinfo is None:
            d = d.replace(tzinfo=UTC)
        return datetime.now(UTC) - d >= SNAPSHOT_MAX_AGE

    # Schreiben — overall + pro Event. Pro (event, sort) wird geschrieben, wenn
    # sich die Top-N-Reihenfolge geändert hat ODER der letzte Snapshot ≥24h alt
    # ist (Heartbeat). So bleibt der Verlauf schlank, aber der Zeitstempel
    # aktuell.
    targets = [""] + sorted(event_slugs)
    wrote_any = False
    for ev in targets:
        for sort_key, primary, secondary in SNAPSHOT_SORTS:
            ranking = _rank_for(ev or None, sort_key, primary, secondary)
            new_order = [idea_id for idea_id, _ in ranking]
            unchanged = bool(new_order) and new_order == _latest_order(ev, sort_key)
            if unchanged and not _is_stale(_latest_at(ev, sort_key)):
                continue  # unverändert & frisch → kein neuer Snapshot
            for rank, (idea_id, score) in enumerate(ranking, start=1):
                con.execute(
                    "INSERT OR REPLACE INTO ranking_snapshot "
                    "(snapshot_at,event,sort,idea_id,rank,score) VALUES (?,?,?,?,?,?)",
                    (ts, ev, sort_key, idea_id, rank, score),
                )
                wrote_any = True

    if wrote_any:
        _prune_snapshots(con)


ACTIVITY_LOG_KEEP_DAYS = 90
ACTIVITY_LOG_KEEP_ROWS = 5000


def _prune_activity_log(con) -> None:
    """Behalte Einträge der letzten ACTIVITY_LOG_KEEP_DAYS Tage UND maximal
    ACTIVITY_LOG_KEEP_ROWS Zeilen. Wird einmal pro Sync-Lauf gerufen (sehr
    günstig wegen ts-Index)."""
    cutoff_dt = datetime.now(UTC) - timedelta(days=ACTIVITY_LOG_KEEP_DAYS)
    cutoff = cutoff_dt.isoformat()
    con.execute("DELETE FROM activity_log WHERE ts < ?", (cutoff,))
    # Hard-Cap: lösche alles, was über die jüngsten ACTIVITY_LOG_KEEP_ROWS
    # hinausgeht (verhindert Explosion bei plötzlich sehr aktiver Phase).
    con.execute(
        "DELETE FROM activity_log WHERE id NOT IN ("
        "  SELECT id FROM activity_log ORDER BY ts DESC LIMIT ?"
        ")",
        (ACTIVITY_LOG_KEEP_ROWS,),
    )


def _prune_snapshots(con) -> None:
    """Behalte die jüngsten 200 Snapshot-Zeitpunkte — alles ältere wegwerfen.
    Mit Option B (nur bei Rang-Änderung, 5-Min-Floor) ist ein Zeitpunkt eine
    echte Änderung; 200 decken bei sehr aktivem Event mind. ~16h dichte
    Änderungs-Historie ab, bei ruhigem Betrieb deutlich länger — genug für
    die 7-Tage-Steiger-Auswertung."""
    keep = 200
    rows = con.execute(
        "SELECT DISTINCT snapshot_at FROM ranking_snapshot ORDER BY snapshot_at DESC LIMIT ?",
        (keep,),
    ).fetchall()
    if not rows:
        return
    cutoff = rows[-1]["snapshot_at"]
    con.execute("DELETE FROM ranking_snapshot WHERE snapshot_at < ?", (cutoff,))
    # Defensives Cleanup: Score=0 darf NIE in der Tabelle stehen — selbst
    # wenn ein zukünftiger Bug es einschleust, wird es bei jedem Sync wieder
    # rausgeworfen. Idea-Listen (auch deren History) bleiben so sauber.
    con.execute("DELETE FROM ranking_snapshot WHERE score <= 0")
