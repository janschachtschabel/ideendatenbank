"""Trend ranking — live top list with decay scoring + risers of the last N days.

Split out of routes.py (behaviour-preserving). Owns the ranking domain: the
live top list (decay-weighted vs. absolute scoring, snapshot delta, per-idea
history with a synthetic "live" point) and the risers view that compares the
newest snapshot against an ~N-day-old one. Snapshots are written by the sync
loop (see sync.py); this module only reads them.

The router is mounted back onto the main API router via ``include_router`` in
routes.py, so the public paths (/api/v1/ranking, /api/v1/ranking/risers) stay
exactly the same.
"""

from __future__ import annotations

import json
from typing import Literal

from fastapi import APIRouter, HTTPException, Query

from . import sync as sync_mod
from .config import settings
from .db import connect
from .routes_common import _escape_like, _row_to_idea, _safe_get

router = APIRouter()

_RANKING_SORTS = {"rating", "comments", "interest", "likes"}


@router.get("/ranking", tags=["ranking"])
# Bewusst sync `def` statt `async`: diese Funktion macht ausschließlich
# blockierende DB-/CPU-Arbeit (SELECT * FROM idea + decay_scores + Python-
# sorted()) und hat KEINE awaits. Als `async def` liefe sie auf dem Event-Loop
# und würde ihn für ihre Dauer einfrieren → parallele Requests (die Themenseite
# feuert ~5 gleichzeitig) blieben so lange auf "pending". Als `def` führt
# Starlette sie im Threadpool aus, der Loop bleibt frei.
def get_ranking(
    sort: str = Query("rating"),
    event: str | None = None,
    limit: int = Query(20, ge=1, le=50),
    basis: str = Query("decay"),
):
    """Aktuelle Top-Liste + Trend-Delta gegen den vorherigen Snapshot.

    Bei den Bewertungs-Sorts (`rating`=Sterne, `likes`=Daumen) ist der primäre
    Score standardmäßig **verfallsgewichtet** (`basis=decay`): ältere Stimmen
    zählen weniger, damit neue Ideen aufholen können. `basis=absolute` rankt
    nach der kumulativen Gesamtsumme ohne Verfall. Pro Eintrag werden IMMER
    beide Werte (`score_decay`, `score_absolute`) mitgeliefert."""
    if sort not in _RANKING_SORTS:
        raise HTTPException(400, f"sort muss eins von {sorted(_RANKING_SORTS)} sein")

    ev = event or ""
    # Verfall gibt es nur für die Rating-Sorts; comments/interest bleiben Zähl-
    # Sorts. mode steuert die decay_scores-Berechnung (Sterne vs. Daumen).
    decay_mode = {"rating": "stars", "likes": "thumbs"}.get(sort)
    decay_enabled = settings.rating_decay_enabled and decay_mode is not None
    effective_basis = "decay" if (decay_enabled and basis != "absolute") else "absolute"
    with connect() as con:
        # --- 1. LIVE-Rangliste aus der idea-Tabelle (ALLE Ideen) ---------
        # Anders als früher (nur Snapshot-Einträge mit score>0) zeigt die
        # Liste jetzt jede Idee — auch unbewertete und neue. So sind auch
        # Bewegungen in unteren Rängen sichtbar, und ein frischer Vote
        # wirkt sofort (refresh_idea hat den Cache schon aktualisiert).
        where = ["COALESCE(hidden,0)=0"]
        params: list = []
        if ev:
            where.append("events LIKE ? ESCAPE '\\'")
            params.append(f'%"{_escape_like(ev)}"%')
        sql_where = " WHERE " + " AND ".join(where)

        interest_map = {
            r["idea_id"]: r["c"]
            for r in con.execute(
                "SELECT idea_id, COUNT(*) AS c FROM idea_interaction "
                "WHERE kind='interest' GROUP BY idea_id"
            ).fetchall()
        }

        all_ideas = con.execute(f"SELECT * FROM idea{sql_where}", params).fetchall()

        # Verfalls-Scores (idee_id → gewichteter Score) einmal vorberechnen.
        decay_map = sync_mod.decay_scores(con, decay_mode) if decay_enabled else {}

        def _absolute(r) -> float:
            """Kumulative Absolutsumme ohne Verfall — die maßgebliche Zahl, die
            in der Liste pro Eintrag ausgewiesen wird (Nachvollziehbarkeit)."""
            if sort == "comments":
                return float(r["comment_count"] or 0)
            if sort == "interest":
                return float(interest_map.get(r["id"], 0))
            if sort == "likes":
                # Daumen-Modus: Anzahl der Daumen (= Bewertungen).
                return float(r["rating_count"] or 0)
            # Sterne: exakte Summe (edu-sharing overall.sum), Fallback Schnitt×Anzahl.
            # rating_sum-Spalte ist durch die Migration garantiert vorhanden.
            s = r["rating_sum"]
            if s:
                return float(round(float(s)))
            return float(round(float(r["rating_avg"] or 0) * float(r["rating_count"] or 0)))

        def _decay(r) -> float:
            return decay_map.get(r["id"], 0.0) if decay_enabled else _absolute(r)

        def _active(r) -> float:
            return _decay(r) if effective_basis == "decay" else _absolute(r)

        def _score(r) -> tuple[float, float]:
            """(primär, sekundär) je nach Sort + Basis — höher = besser."""
            return (_active(r), float(r["comment_count"] or 0))

        scored = sorted(
            all_ideas,
            key=lambda r: (_score(r)[0], _score(r)[1], (r["title"] or "")),
            reverse=True,
        )[:limit]

        # --- 2. Snapshot-Daten für Delta + Verlauf ----------------------
        snaps = [
            r["snapshot_at"]
            for r in con.execute(
                "SELECT DISTINCT snapshot_at FROM ranking_snapshot "
                "WHERE event=? AND sort=? ORDER BY snapshot_at DESC LIMIT 12",
                (ev, sort),
            ).fetchall()
        ]
        latest = snaps[0] if snaps else None

        prev_ranks: dict[str, int] = {}
        if latest:
            # Delta = aktuelle Live-Position vs. Rang im jüngsten Snapshot.
            for r in con.execute(
                "SELECT idea_id, rank FROM ranking_snapshot "
                "WHERE event=? AND sort=? AND snapshot_at=?",
                (ev, sort, latest),
            ).fetchall():
                prev_ranks[r["idea_id"]] = r["rank"]

        history_by_idea: dict[str, list[dict]] = {}
        if snaps:
            for hr in con.execute(
                "SELECT idea_id, snapshot_at, score, rank FROM ranking_snapshot "
                "WHERE event=? AND sort=? AND score > 0 ORDER BY snapshot_at ASC",
                (ev, sort),
            ).fetchall():
                history_by_idea.setdefault(hr["idea_id"], []).append(
                    {
                        "at": hr["snapshot_at"],
                        "score": hr["score"],
                        "rank": hr["rank"],
                    }
                )

    # Synthetischer „Jetzt"-Punkt: Damit Verlaufs-Chart + Zeilen-Sparklines
    # zum LIVE-Rang der Tabelle passen, hängen wir den aktuellen Stand als
    # letzten Stützpunkt an. Ohne ihn würden die Kurven beim letzten
    # stündlichen Snapshot „hängen bleiben", während Tabelle/Delta schon
    # den Live-Stand zeigen (Inkonsistenz nach einem frischen Vote).
    # Nur anhängen, wenn es bereits echte Snapshots gibt — sonst gäbe es
    # nur einen Einzelpunkt und keinen sinnvollen „Verlauf".
    LIVE_MARKER = "live"
    has_snaps = bool(snaps)

    items = []
    for idx, r in enumerate(scored):
        rank = idx + 1
        iid = r["id"]
        prev_rank = prev_ranks.get(iid)
        delta = (prev_rank - rank) if prev_rank is not None else None
        score_decay = round(_decay(r), 2)
        score_absolute = _absolute(r)
        active_score = score_decay if effective_basis == "decay" else score_absolute
        # Verlauf-Punkt = Verfalls-Score (Snapshots speichern denselben), damit
        # Chart + Live-Stand konsistent sind.
        history = list(history_by_idea.get(iid, []))
        if has_snaps:
            history.append({"at": LIVE_MARKER, "score": score_decay, "rank": rank})
        items.append(
            {
                "rank": rank,
                "prev_rank": prev_rank,
                "delta": delta,
                "score": active_score,
                "score_decay": score_decay,
                "score_absolute": score_absolute,
                "idea": _row_to_idea(r),
                "history": history,
            }
        )

    snapshots_out = list(reversed(snaps))  # alt → neu (für Chart-X-Achse)
    if has_snaps:
        snapshots_out.append(LIVE_MARKER)

    return {
        "sort": sort,
        "event": event,
        "snapshot_at": latest,
        "snapshots": snapshots_out,
        "items": items,
    }


# ===== Ranking-Trend: Top-Steiger der letzten 7 Tage ==============


@router.get("/ranking/risers", tags=["ranking"])
def ranking_risers(
    sort: Literal["rating", "likes", "comments", "interest"] = "rating",
    event: str | None = None,
    days: int = Query(7, ge=1, le=90),
    limit: int = Query(5, ge=1, le=20),
):
    """Vergleicht den jüngsten Snapshot mit einem ~N-Tage-alten Snapshot
    und liefert die Ideen mit der größten Rangverbesserung (kleinerer
    Rang = besser). Für die Ranking-Seite als „Top-Steiger"-Sektion."""
    ev = event or ""
    with connect() as con:
        # Jüngsten Snapshot bestimmen
        latest = con.execute(
            "SELECT MAX(snapshot_at) FROM ranking_snapshot WHERE event=? AND sort=?",
            (ev, sort),
        ).fetchone()[0]
        if not latest:
            return {"count": 0, "items": []}
        # Snapshot N Tage zuvor (oder den ältesten verfügbaren)
        cutoff_target = con.execute(
            "SELECT datetime(?, ?)",
            (latest, f"-{days} days"),
        ).fetchone()[0]
        prev = con.execute(
            """SELECT snapshot_at FROM ranking_snapshot
                WHERE event=? AND sort=? AND snapshot_at <= ?
                ORDER BY snapshot_at DESC LIMIT 1""",
            (ev, sort, cutoff_target),
        ).fetchone()
        if not prev:
            # Fallback: ältester Snapshot überhaupt
            prev = con.execute(
                """SELECT snapshot_at FROM ranking_snapshot
                    WHERE event=? AND sort=? AND snapshot_at < ?
                    ORDER BY snapshot_at ASC LIMIT 1""",
                (ev, sort, latest),
            ).fetchone()
        if not prev or prev["snapshot_at"] == latest:
            return {"count": 0, "items": [], "latest": latest, "previous": None}

        prev_at = prev["snapshot_at"]
        rows = con.execute(
            """SELECT cur.idea_id,
                      cur.rank AS rank,
                      prev.rank AS prev_rank,
                      (prev.rank - cur.rank) AS delta,
                      cur.score AS score,
                      i.title, i.description, i.preview_url, i.author,
                      i.owner_username, i.owner_display_name,
                      i.phase, i.events, i.hidden
                 FROM ranking_snapshot cur
                 JOIN ranking_snapshot prev
                   ON prev.idea_id = cur.idea_id
                  AND prev.event = cur.event AND prev.sort = cur.sort
                  AND prev.snapshot_at = ?
                 LEFT JOIN idea i ON i.id = cur.idea_id
                WHERE cur.event = ? AND cur.sort = ?
                  AND cur.snapshot_at = ?
                  AND (i.hidden IS NULL OR i.hidden = 0)
                ORDER BY (prev.rank - cur.rank) DESC, cur.rank ASC
                LIMIT ?""",
            (prev_at, ev, sort, latest, limit),
        ).fetchall()

    items = []
    for r in rows:
        if (r["delta"] or 0) <= 0:
            continue
        # Login-Username nie als Anzeigename ausliefern (analog _row_to_idea).
        _au = r["author"]
        _safe_au = _au if (_au and _au != _safe_get(r, "owner_username")) else None
        items.append(
            {
                "idea_id": r["idea_id"],
                "title": r["title"],
                "description": r["description"],
                "preview_url": r["preview_url"],
                "author": _safe_au,
                "owner_display_name": _safe_get(r, "owner_display_name") or _safe_au,
                "phase": r["phase"],
                "events": json.loads(r["events"] or "[]"),
                "rank": r["rank"],
                "prev_rank": r["prev_rank"],
                "delta": r["delta"],
                "score": r["score"],
            }
        )
    return {
        "count": len(items),
        "items": items,
        "latest": latest,
        "previous": prev_at,
        "sort": sort,
        "event": event,
    }
