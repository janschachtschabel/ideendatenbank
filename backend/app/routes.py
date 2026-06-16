from __future__ import annotations

import html
import json
import logging
import re
import sqlite3
from datetime import UTC, datetime, timedelta
from typing import Literal

log = logging.getLogger(__name__)

import httpx
from fastapi import APIRouter, Body, File, Header, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, Field

from . import backup as backup_mod
from . import edu_sharing
from . import sync as sync_mod
from .config import settings
from .db import connect
from .ratelimit import limiter

router = APIRouter()

SortBy = Literal["modified", "created", "rating", "comments", "title"]


def _row_to_idea(r) -> dict:
    return {
        "id": r["id"],
        "kind": r["kind"],
        "topic_id": r["topic_id"],
        "main_content_id": r["main_content_id"],
        "title": r["title"],
        "description": r["description"],
        "preview_url": r["preview_url"],
        "author": r["author"],
        "project_url": r["project_url"],
        "phase": r["phase"],
        "events": json.loads(r["events"] or "[]"),
        "categories": json.loads(r["categories"] or "[]"),
        "keywords": json.loads(r["keywords"] or "[]"),
        "rating_avg": r["rating_avg"],
        "rating_count": r["rating_count"],
        "comment_count": r["comment_count"],
        "attachment_mimetype": _safe_get(r, "attachment_mimetype"),
        "attachment_size": _safe_get(r, "attachment_size"),
        "attachment_name": _safe_get(r, "attachment_name"),
        "attachment_url": _safe_get(r, "attachment_url"),
        "owner_username": _safe_get(r, "owner_username"),
        "attachment_folder_id": _safe_get(r, "attachment_folder_id"),
        "created_at": r["created_at"],
        "modified_at": r["modified_at"],
    }


def _safe_get(row, key: str):
    try:
        return row[key]
    except (IndexError, KeyError):
        return None


# ---- URL- und Upload-Helfer (Security) ----------------------------------

_SAFE_URL_SCHEMES = ("http://", "https://")


def _validate_external_url(value: str | None, *, field: str = "URL") -> str | None:
    """Akzeptiert nur http(s)-URLs. Verhindert `javascript:`/`data:`/
    `file:`-Schemes, die später z.B. als Link gerendert werden könnten
    (XSS-Vektor). Leere Strings → None."""
    if value is None:
        return None
    v = value.strip()
    if not v:
        return None
    low = v.lower()
    if not low.startswith(_SAFE_URL_SCHEMES):
        raise HTTPException(
            400,
            f"Ungültige {field}: nur http(s)-Adressen erlaubt (z.B. https://example.org).",
        )
    if len(v) > 2000:
        raise HTTPException(400, f"{field} zu lang (max 2000 Zeichen)")
    return v


async def _read_upload_capped(file: UploadFile, max_bytes: int) -> bytes:
    """Liest einen UploadFile chunk-weise und bricht ab, sobald `max_bytes`
    überschritten wird. Verhindert RAM-DoS via riesige Uploads — `await
    file.read()` ohne Limit würde alles vollständig laden."""
    chunks: list[bytes] = []
    total = 0
    chunk_size = 1024 * 1024  # 1 MB Schritte
    while True:
        chunk = await file.read(chunk_size)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            mb = max_bytes // (1024 * 1024)
            raise HTTPException(413, f"Datei zu groß (max {mb} MB)")
        chunks.append(chunk)
    return b"".join(chunks)


# LIKE-Wildcards in User-Input escapen — `%` und `_` würden sonst als
# Pattern wirken (Mod kann ungewollt z.B. mit `%` alle Datensätze ziehen
# oder Ressourcen via `%%%%...` belasten).
def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _safe_highlight(raw: str | None) -> str | None:
    """FTS-Snippet (roher User-Text) HTML-escapen und die Sentinel-Marker
    \\x01/\\x02 in <mark>/</mark> wandeln. Nötig, weil Titel/Beschreibung im
    Frontend per [innerHTML] gerendert werden — so enthält der String nur
    escapten Text + <mark> und kann kein eingeschleustes HTML ausführen."""
    if not raw or "\x01" not in raw:
        return None
    return html.escape(raw).replace("\x01", "<mark>").replace("\x02", "</mark>")


def _build_update_set(
    assignments: list[tuple[str, object]],
    allowed_columns: frozenset[str],
) -> tuple[str, list[object]]:
    """Baut sicher eine `SET col=?, col=?`-Klausel aus (Spaltenname, Wert).

    Werte gehen weiterhin parametrisiert (`?`), Spaltennamen werden gegen
    eine Whitelist geprüft — so kann niemals User-Input als Spaltenname
    in die SQL gelangen, selbst wenn der Aufruf-Code sich später ändert.
    Wirft ValueError bei nicht erlaubten Spalten (= Programmierfehler,
    nie aus User-Daten ableitbar).
    """
    fragments: list[str] = []
    params: list[object] = []
    for col, value in assignments:
        if col not in allowed_columns:
            # Hart abbrechen statt still ignorieren — soll als Bug auffallen.
            raise ValueError(f"Spalte nicht in Whitelist: {col!r}")
        fragments.append(f"{col}=?")
        params.append(value)
    return ", ".join(fragments), params


# ---- Mathe-Captcha (gegen Bot-Spam beim anonymen Submit) -----------------
#
# Bewusste Design-Entscheidungen:
#   - Kein Drittanbieter (kein hCaptcha/reCAPTCHA → DSGVO-neutral, kein
#     Tracking, kein Bilderrätsel-UX).
#   - Schützt nur gegen generische Drive-by-Bots. Wer die Plattform
#     gezielt angreift, baut in 5 Zeilen einen Bypass — dafür greifen
#     Rate-Limit + Auth.
#   - NUR für anonyme Submits Pflicht; eingeloggte User skippen das.

import secrets as _secrets

CAPTCHA_TTL_SECONDS = 600  # 10 Min Zeit zum Lösen


def _captcha_make_question() -> tuple[str, int]:
    """Erzeugt eine einfache Plus/Minus-Aufgabe mit zweistelligen Werten.
    Ergebnis ist immer ≥ 0 (keine negativen Antworten, damit ein
    nummerisches Eingabefeld ohne Vorzeichen reicht)."""
    a = _secrets.randbelow(13) + 2  # 2..14
    b = _secrets.randbelow(10) + 1  # 1..10
    if a >= b and _secrets.randbelow(2):
        return f"Was ist {a} − {b}?", a - b
    return f"Was ist {a} + {b}?", a + b


def _captcha_cleanup(con) -> None:
    now = datetime.now(UTC).isoformat()
    con.execute(
        "DELETE FROM captcha_challenge WHERE expires_at < ? OR used = 1",
        (now,),
    )


def _captcha_issue() -> dict:
    question, answer = _captcha_make_question()
    token = _secrets.token_urlsafe(18)
    now = datetime.now(UTC)
    expires = (now + timedelta(seconds=CAPTCHA_TTL_SECONDS)).isoformat()
    with connect() as con:
        _captcha_cleanup(con)
        con.execute(
            "INSERT INTO captcha_challenge (token, answer, expires_at, used, created_at) "
            "VALUES (?, ?, ?, 0, ?)",
            (token, answer, expires, now.isoformat()),
        )
    return {"token": token, "question": question, "ttl_seconds": CAPTCHA_TTL_SECONDS}


def _captcha_verify(token: str | None, answer: int | str | None) -> None:
    """Wirft 400 wenn Token unbekannt, abgelaufen, schon verbraucht oder
    Antwort falsch. Markiert als used (Single-Use), wenn erfolgreich."""
    if not token or answer is None or str(answer).strip() == "":
        raise HTTPException(400, "Captcha-Lösung fehlt")
    try:
        ans_int = int(str(answer).strip())
    except ValueError:
        raise HTTPException(400, "Captcha-Lösung muss eine Zahl sein")
    now = datetime.now(UTC).isoformat()
    with connect() as con:
        row = con.execute(
            "SELECT answer, expires_at, used FROM captcha_challenge WHERE token = ?",
            (token,),
        ).fetchone()
        if not row:
            raise HTTPException(400, "Captcha abgelaufen oder unbekannt — bitte neu laden")
        if row["used"]:
            raise HTTPException(400, "Captcha schon verwendet — bitte neu laden")
        if row["expires_at"] < now:
            raise HTTPException(400, "Captcha abgelaufen — bitte neu laden")
        if int(row["answer"]) != ans_int:
            raise HTTPException(400, "Captcha-Antwort falsch — bitte neu versuchen")
        # Single-Use: sofort löschen (statt nur als used markieren) hält
        # die Tabelle klein.
        con.execute("DELETE FROM captcha_challenge WHERE token = ?", (token,))


@router.get("/captcha", tags=["public"])
@limiter.limit("30/minute")
def captcha_new(request: Request):
    """Liefert eine frische Mathe-Aufgabe + Single-Use-Token.

    Frontend rendert `question` als Klartext-Frage, sammelt die Antwort
    und sendet beim anonymen `POST /ideas` `captcha_token` +
    `captcha_answer` mit. Eingeloggte User brauchen nichts davon."""
    return _captcha_issue()


# ---- App-Settings (Voting-Modus) ----------------------------------------

_VALID_VOTING_MODES = ("stars", "thumbs")


def _get_setting(key: str, default: str | None = None) -> str | None:
    with connect() as con:
        row = con.execute("SELECT value FROM app_setting WHERE key=?", (key,)).fetchone()
    return row["value"] if row else default


def _set_setting(key: str, value: str) -> None:
    with connect() as con:
        con.execute(
            "INSERT INTO app_setting (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, value),
        )


def _rating_open_for_events(event_slugs: list[str] | None) -> bool:
    """Ist die Bewertung für eine Idee offen?
    Regel: global aktiv UND (keine Veranstaltung ODER mindestens eine
    zugehörige Veranstaltung mit rating_open=1). Greift überall (UI + Schreib-
    Endpoint), damit das Stoppen serverseitig durchgesetzt wird."""
    if _get_setting("rating_enabled", "1") == "0":
        return False
    slugs = [s for s in (event_slugs or []) if s]
    if not slugs:
        return True
    with connect() as con:
        ph = ",".join("?" * len(slugs))
        rows = con.execute(
            f"SELECT rating_open FROM taxonomy_event WHERE slug IN ({ph})",
            slugs,
        ).fetchall()
    if not rows:
        return True  # Event(s) nicht in der Taxonomie → nicht blockieren
    return any(bool(r["rating_open"]) for r in rows)


@router.get("/settings", tags=["public"])
def get_settings():
    """Öffentliche Lauf-Einstellungen, die das Frontend zum Rendern braucht.
    - voting_mode_global: 'stars' | 'thumbs' (Pro-Event-Overrides in der Event-Liste)
    - edu_repo_base_url: für „im Repo öffnen"-Links + Registrierungs-Link,
      deployment-spezifisch aus der Backend-Config."""
    return {
        "voting_mode_global": _get_setting("voting_mode_global", "stars"),
        # Globaler Bewertungs-Schalter (Master): '1' = an, '0' = aus.
        "rating_enabled": _get_setting("rating_enabled", "1") != "0",
        "edu_repo_base_url": settings.edu_repo_base_url.rstrip("/"),
        # Rating-Verfall: Frontend rendert daraus die Transparenz-Box am
        # Seitenende (Formel + Beispieltabelle).
        "rating_decay_enabled": settings.rating_decay_enabled,
        "rating_decay_halflife_days": settings.rating_decay_halflife_days,
        "rating_decay_floor": settings.rating_decay_floor,
    }


class SettingsPatch(BaseModel):
    voting_mode_global: Literal["stars", "thumbs"] | None = None
    rating_enabled: bool | None = None


@router.put("/admin/settings", tags=["admin"])
async def update_settings(
    body: SettingsPatch,
    authorization: str | None = Header(None),
):
    """Mod-only: globale Einstellungen ändern (sofort wirksam)."""
    await _require_moderator(authorization)
    if body.voting_mode_global is not None:
        _set_setting("voting_mode_global", body.voting_mode_global)
        _log_activity(
            action="setting_changed",
            authorization=authorization,
            is_mod=True,
            target_type="setting",
            target_id="voting_mode_global",
            detail={"value": body.voting_mode_global},
        )
    if body.rating_enabled is not None:
        _set_setting("rating_enabled", "1" if body.rating_enabled else "0")
        _log_activity(
            action="setting_changed",
            authorization=authorization,
            is_mod=True,
            target_type="setting",
            target_id="rating_enabled",
            detail={"value": body.rating_enabled},
        )
    return {
        "ok": True,
        "voting_mode_global": _get_setting("voting_mode_global", "stars"),
        "rating_enabled": _get_setting("rating_enabled", "1") != "0",
    }


def _attachment_from_node(n: dict) -> dict:
    """Normalise an edu-sharing ccm:io node into our attachment payload."""
    props = n.get("properties") or {}
    preview = n.get("preview") or {}
    ref_id = (n.get("ref") or {}).get("id")
    return {
        "id": ref_id,
        "name": n.get("name") or (props.get("cm:name") or [None])[0],
        "title": n.get("title") or (props.get("cm:title") or [None])[0] or n.get("name"),
        "mimetype": n.get("mimetype"),
        "size": n.get("size"),
        "download_url": n.get("downloadUrl"),
        "render_url": (n.get("content") or {}).get("url"),
        "preview_url": preview.get("url") if not preview.get("isIcon") else None,
    }


def _collect_topic_subtree(con, root_id: str) -> list[str]:
    """Return [root_id] + all transitive descendants from the topic table."""
    ids = [root_id]
    frontier = [root_id]
    while frontier:
        placeholders = ",".join("?" * len(frontier))
        rows = con.execute(
            f"SELECT id FROM topic WHERE parent_id IN ({placeholders})", frontier
        ).fetchall()
        frontier = [r["id"] for r in rows]
        ids.extend(frontier)
    return ids


@router.get("/topics/{topic_id}")
def get_topic(topic_id: str):
    """Single topic plus its direct children, for drill-down views."""
    cols = "id,parent_id,title,description,preview_url,color,created_at,modified_at"
    with connect() as con:
        row = con.execute(
            f"SELECT {cols} FROM topic WHERE id=?",
            (topic_id,),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Topic not found")
        children = con.execute(
            f"SELECT {cols} FROM topic WHERE parent_id=? ORDER BY title",
            (topic_id,),
        ).fetchall()
        parent = None
        if row["parent_id"]:
            parent = con.execute(
                "SELECT id,parent_id,title FROM topic WHERE id=?", (row["parent_id"],)
            ).fetchone()
    return {
        "topic": dict(row),
        "parent": dict(parent) if parent else None,
        "children": [dict(c) for c in children],
    }


# ===== Topic-CRUD (Mod-only) ============================================


class TopicCreate(BaseModel):
    parent_id: str | None = None  # None = neue Top-Level-Themen-Sammlung
    title: str = Field(..., min_length=2, max_length=120)
    description: str | None = None
    color: str | None = None


class TopicPatch(BaseModel):
    title: str | None = None
    description: str | None = None
    color: str | None = None


class TopicSortItem(BaseModel):
    id: str
    sort_order: int


@router.post("/admin/topics", tags=["topics"], status_code=201)
async def create_topic(
    body: TopicCreate,
    authorization: str | None = Header(None),
):
    """Legt eine neue Themen- oder Herausforderungs-Sammlung in edu-sharing
    an. Mod-only — Owner-/Container-Permissions werden von ES geprüft."""
    await _require_moderator(authorization)
    parent = body.parent_id or settings.ideendb_root_collection_id
    try:
        result = await edu_sharing.client.create_collection(
            parent_id=parent,
            title=body.title,
            description=body.description,
            color=body.color,
            auth_header=authorization,
        )
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403):
            raise HTTPException(403, "Keine Berechtigung, hier eine Sammlung anzulegen.")
        raise HTTPException(e.response.status_code, f"edu-sharing: {e.response.text[:200]}")
    new_id = (((result or {}).get("collection") or result or {}).get("ref") or {}).get("id")
    if not new_id:
        raise HTTPException(502, "edu-sharing lieferte keine ID")
    # Sofort in den Cache schreiben (Voll-Sync zieht später nach)
    with connect() as con:
        con.execute(
            "INSERT OR REPLACE INTO topic "
            "(id,parent_id,title,description,color,sort_order,created_at,modified_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (
                new_id,
                body.parent_id,
                body.title,
                body.description,
                body.color,
                100,
                sync_mod._iso_now(),
                sync_mod._iso_now(),
            ),
        )
    _log_activity(
        action="topic_created",
        authorization=authorization,
        is_mod=True,
        target_type="topic",
        target_id=new_id,
        target_label=body.title,
        detail={"parent_id": body.parent_id},
    )
    return {"ok": True, "id": new_id}


@router.patch("/admin/topics/{topic_id}", tags=["topics"])
async def edit_topic(
    topic_id: str,
    body: TopicPatch,
    authorization: str | None = Header(None),
):
    """Aktualisiert Titel/Beschreibung/Farbe einer Themen-Sammlung in
    edu-sharing + Cache."""
    await _require_moderator(authorization)
    props: dict[str, list[str]] = {}
    if body.title is not None:
        props["cm:title"] = [body.title]
        props["cm:name"] = [body.title]
    if body.description is not None:
        props["cm:description"] = [body.description]
    # Farbe wird aktuell nicht in ES persistiert (kein dediziertes Feld);
    # wir speichern sie nur lokal im Cache, damit die UI sie nutzen kann.
    if props:
        try:
            await edu_sharing.client.update_metadata(
                topic_id,
                props,
                auth_header=authorization,
            )
        except httpx.HTTPStatusError as e:
            if e.response.status_code in (401, 403):
                raise HTTPException(403, "Keine Berechtigung, diese Sammlung zu ändern.")
            raise HTTPException(e.response.status_code, f"edu-sharing: {e.response.text[:200]}")

    # SET-Klausel über Whitelist-Helper bauen — Spaltennamen werden gegen
    # eine harte Liste geprüft, Werte gehen parametrisiert rein. So bleibt
    # die SQL injection-sicher, auch wenn jemand später User-Input in die
    # assignments-Liste packen sollte.
    _TOPIC_UPDATABLE = frozenset({"title", "description", "color", "modified_at"})
    assignments: list[tuple[str, object]] = []
    if body.title is not None:
        assignments.append(("title", body.title))
    if body.description is not None:
        assignments.append(("description", body.description))
    if body.color is not None:
        assignments.append(("color", body.color))
    if assignments:
        assignments.append(("modified_at", sync_mod._iso_now()))
        set_sql, params = _build_update_set(assignments, _TOPIC_UPDATABLE)
        params.append(topic_id)
        with connect() as con:
            con.execute(
                f"UPDATE topic SET {set_sql} WHERE id=?",
                params,
            )
    _log_activity(
        action="topic_edited",
        authorization=authorization,
        is_mod=True,
        target_type="topic",
        target_id=topic_id,
        target_label=body.title,
        detail=body.model_dump(exclude_none=True),
    )
    return {"ok": True}


@router.delete("/admin/topics/{topic_id}", tags=["topics"])
async def delete_topic(
    topic_id: str,
    authorization: str | None = Header(None),
):
    """Löscht eine Themen-/Herausforderungs-Sammlung. Vorsicht: Sammlung
    muss in ES leer sein, sonst lehnt edu-sharing ab. Wir versuchen den
    DELETE und reichen den ES-Status durch — kein Recursive-Force."""
    await _require_moderator(authorization)
    # Vor-Check: hat Cache noch Kinder/Ideen?
    with connect() as con:
        kids = con.execute(
            "SELECT COUNT(*) FROM topic WHERE parent_id=?",
            (topic_id,),
        ).fetchone()[0]
        ideas = con.execute(
            "SELECT COUNT(*) FROM idea WHERE topic_id=?",
            (topic_id,),
        ).fetchone()[0]
        title_row = con.execute(
            "SELECT title FROM topic WHERE id=?",
            (topic_id,),
        ).fetchone()
    if kids or ideas:
        raise HTTPException(
            409,
            f"Kann nicht gelöscht werden: enthält noch {kids} Sammlung(en) "
            f"und {ideas} Idee(n). Erst leeren oder verschieben.",
        )
    try:
        await edu_sharing.client.delete_node(topic_id, auth_header=authorization)
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403):
            raise HTTPException(403, "Keine Berechtigung, diese Sammlung zu löschen.")
        if e.response.status_code != 404:
            raise HTTPException(e.response.status_code, f"edu-sharing: {e.response.text[:200]}")
    with connect() as con:
        con.execute("DELETE FROM topic WHERE id=?", (topic_id,))
    _log_activity(
        action="topic_deleted",
        authorization=authorization,
        is_mod=True,
        target_type="topic",
        target_id=topic_id,
        target_label=(title_row["title"] if title_row else None),
    )
    return {"ok": True}


@router.post("/admin/topics/{topic_id}/preview", tags=["topics"])
async def upload_topic_preview(
    topic_id: str,
    file: UploadFile = File(...),
    authorization: str | None = Header(None),
):
    """Lädt ein Vorschaubild für eine Themen-/Herausforderungs-Sammlung."""
    await _require_moderator(authorization)
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(400, "Vorschaubild muss ein Bild sein (image/*).")
    data = await _read_upload_capped(file, settings.upload_image_max_bytes)
    if not data:
        raise HTTPException(400, "Leere Datei")
    try:
        await edu_sharing.client.upload_preview(
            topic_id,
            image_bytes=data,
            filename=file.filename or "preview.png",
            mimetype=file.content_type or "image/png",
            auth_header=authorization,
        )
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403):
            raise HTTPException(403, "Keine Berechtigung, hier ein Vorschaubild zu setzen.")
        raise HTTPException(e.response.status_code, f"edu-sharing: {e.response.text[:200]}")
    # Topic-Cache refreshen, damit die neue preview.url-URL (mit neuem
    # `?modified=`-Token) ins Cache wandert und Browser-Caches umgeht.
    try:
        meta = await edu_sharing.client.node_metadata(
            topic_id,
            auth_header=authorization,
        )
        node = (meta or {}).get("node") or {}
        new_preview = (node.get("preview") or {}).get("url")
        is_icon = (node.get("preview") or {}).get("isIcon", False)
        if new_preview and not is_icon:
            with connect() as con:
                con.execute(
                    "UPDATE topic SET preview_url=? WHERE id=?",
                    (new_preview, topic_id),
                )
    except Exception as e:
        log.debug("upload_topic_preview: Cache-Refresh fehlgeschlagen: %s", e)
    _log_activity(
        action="topic_preview_set",
        authorization=authorization,
        is_mod=True,
        target_type="topic",
        target_id=topic_id,
        detail={"size": len(data), "mimetype": file.content_type},
    )
    return {"ok": True}


@router.put("/admin/topics/sort", tags=["topics"])
async def sort_topics(
    items: list[TopicSortItem] = Body(...),
    authorization: str | None = Header(None),
):
    """Setzt sort_order für eine Liste von Themen/Herausforderungen.
    Reihenfolge im Body bestimmt die Anzeige (kleinere Zahl = weiter oben).
    Persistiert nur in der App-DB — edu-sharing kennt kein Reihenfolge-Feld."""
    await _require_moderator(authorization)
    with connect() as con:
        for it in items:
            con.execute(
                "UPDATE topic SET sort_order=? WHERE id=?",
                (it.sort_order, it.id),
            )
    _log_activity(
        action="topics_sorted",
        authorization=authorization,
        is_mod=True,
        target_type="topic",
        detail={"count": len(items)},
    )
    return {"ok": True, "updated": len(items)}


@router.get("/meta")
def meta_facets(
    topic_id: str | None = Query(None),
    phase: str | None = Query(None),
    event: str | None = Query(None),
    q: str | None = Query(None),
):
    """Facetten-Counts (Phase/Veranstaltung/Kategorie + Per-Topic) im Cache.

    Drill-down: Die Counts berücksichtigen die ÜBRIGEN aktiven Filter, damit sie
    zur Auswahl passen — z.B. zeigt die Veranstaltungs-Liste bei aktivem
    Phase=Anregung nur Counts INNERHALB Anregung. Pro Dimension wird der EIGENE
    Filter ausgelassen, damit man Werte innerhalb einer Dimension noch wechseln
    kann. Versteckte Ideen sind (wie in der Liste) ausgeschlossen.
    """
    topic_ids: list[str] = []
    if topic_id:
        with connect() as con:
            topic_ids = list(_collect_topic_subtree(con, topic_id))
    qn = (q or "").strip()

    def _clauses(*, skip: str, use_q: bool) -> tuple[list[str], list]:
        cl: list[str] = ["COALESCE(hidden, 0) = 0"]
        pr: list = []
        if topic_ids and skip != "topic":
            cl.append(f"topic_id IN ({','.join('?' * len(topic_ids))})")
            pr.extend(topic_ids)
        if phase and skip != "phase":
            cl.append("phase = ?")
            pr.append(phase)
        if event and skip != "event":
            cl.append("events LIKE ? ESCAPE '\\'")
            pr.append(f'%"{_escape_like(event)}"%')
        if qn and use_q:
            cl.append("id IN (SELECT id FROM idea_fts WHERE idea_fts MATCH ?)")
            pr.append(qn)
        return cl, pr

    def _compute(use_q: bool):
        with connect() as con:
            cl, pr = _clauses(skip="phase", use_q=use_q)
            phase_rows = con.execute(
                "SELECT phase AS value, COUNT(*) AS count FROM idea "
                f"WHERE {' AND '.join(cl)} AND phase IS NOT NULL AND phase <> '' "
                "GROUP BY phase ORDER BY count DESC",
                pr,
            ).fetchall()
            cl_e, pr_e = _clauses(skip="event", use_q=use_q)
            ev_rows = con.execute(
                f"SELECT events FROM idea WHERE {' AND '.join(cl_e)}", pr_e
            ).fetchall()
            cl_c, pr_c = _clauses(skip="category", use_q=use_q)
            cat_rows = con.execute(
                f"SELECT categories FROM idea WHERE {' AND '.join(cl_c)}", pr_c
            ).fetchall()
            cl_t, pr_t = _clauses(skip="topic", use_q=use_q)
            topic_rows = con.execute(
                "SELECT topic_id AS value, COUNT(*) AS count FROM idea "
                f"WHERE {' AND '.join(cl_t)} AND topic_id IS NOT NULL "
                "GROUP BY topic_id",
                pr_t,
            ).fetchall()
        return phase_rows, ev_rows, cat_rows, topic_rows

    try:
        phase_rows, ev_rows, cat_rows, topic_rows = _compute(use_q=bool(qn))
    except sqlite3.OperationalError:
        # Malformierte FTS-Query → Facetten ohne Volltext-Filter berechnen.
        phase_rows, ev_rows, cat_rows, topic_rows = _compute(use_q=False)

    events: dict[str, int] = {}
    for r in ev_rows:
        for e in json.loads(r["events"] or "[]"):
            events[e] = events.get(e, 0) + 1
    categories: dict[str, int] = {}
    for r in cat_rows:
        for c in json.loads(r["categories"] or "[]"):
            categories[c] = categories.get(c, 0) + 1
    return {
        "phases": [dict(p) for p in phase_rows],
        "events": [
            {"value": k, "count": v} for k, v in sorted(events.items(), key=lambda x: -x[1])
        ],
        "categories": [
            {"value": k, "count": v} for k, v in sorted(categories.items(), key=lambda x: -x[1])
        ],
        "topics": {r["value"]: r["count"] for r in topic_rows},
    }


@router.get("/topics")
def list_topics():
    """Flat list of all topics + challenges (tree reconstructable via parent_id).
    Sortierung: erst Root-Themen, dann Kinder; innerhalb gleiches Parent
    nach sort_order, dann nach Titel."""
    with connect() as con:
        rows = con.execute(
            "SELECT id,parent_id,title,description,preview_url,color,sort_order,"
            "       created_at,modified_at FROM topic "
            "ORDER BY parent_id NULLS FIRST, sort_order ASC, title ASC"
        ).fetchall()
    return [dict(r) for r in rows]


@router.get("/ideas")
def list_ideas(
    topic_id: str | None = Query(None, description="Filter by topic (theme or challenge)"),
    include_descendants: bool = Query(True, description="Include ideas in sub-topics"),
    phase: str | None = None,
    event: str | None = None,
    category: str | None = None,
    q: str | None = Query(None, description="Full-text search"),
    # Query-Param heißt `ids` (öffentlicher Vertrag), die Python-Variable
    # `id_filter` vermeidet die Kollision mit `ids` aus dem topic-subtree-
    # Pfad weiter unten.
    id_filter: str | None = Query(
        None,
        alias="ids",
        description="Komma-separierte Idea-IDs für gezielte Auswahl (Embed-Anwendungen)",
    ),
    sort: SortBy = "modified",
    order: Literal["asc", "desc"] = "desc",
    limit: int = Query(24, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    # Spalten qualifizieren wir mit dem `i.`-Prefix, weil beim FTS-Join
    # (idea_fts) sonst `id` und `title` mehrdeutig wären → SQLite-500.
    sort_cols = {
        "modified": "i.modified_at",
        "created": "i.created_at",
        "rating": "i.rating_avg",
        "comments": "i.comment_count",
        "title": "i.title",
    }
    sort_col = sort_cols[sort]

    where: list[str] = []
    params: list = []
    if topic_id:
        if include_descendants:
            with connect() as con:
                ids = _collect_topic_subtree(con, topic_id)
            placeholders = ",".join("?" * len(ids))
            where.append(f"i.topic_id IN ({placeholders})")
            params.extend(ids)
        else:
            where.append("i.topic_id = ?")
            params.append(topic_id)
    if phase:
        where.append("i.phase = ?")
        params.append(phase)
    if event:
        # events is a JSON array; LIKE works for simple membership lookup.
        # Wildcards im User-Input escapen (kein SQLi, aber sonst Over-Match/DoS).
        where.append("i.events LIKE ? ESCAPE '\\'")
        params.append(f'%"{_escape_like(event)}"%')
    if category:
        where.append("i.categories LIKE ? ESCAPE '\\'")
        params.append(f'%"{_escape_like(category)}"%')

    if id_filter:
        # Komma-separiert, max 200 IDs zur Sicherheit
        id_list = [x.strip() for x in id_filter.split(",") if x.strip()][:200]
        if id_list:
            placeholders = ",".join("?" * len(id_list))
            where.append(f"i.id IN ({placeholders})")
            params.extend(id_list)
        else:
            where.append("1 = 0")  # leere ids → keine Treffer

    # Versteckte Ideen (vom Mod soft-deleted) generell ausblenden — Mods
    # haben einen separaten Tab im Mod-UI für die Verwaltung.
    where.append("COALESCE(i.hidden, 0) = 0")

    base_sql = "FROM idea i"
    if q:
        base_sql += " JOIN idea_fts f ON i.id = f.id"
        where.append("idea_fts MATCH ?")
        params.append(q)
    if where:
        base_sql += " WHERE " + " AND ".join(where)

    # Bei Volltext-Suche FTS5-Highlights mitselektieren. Spalten-Index in
    # idea_fts: 0=id, 1=title, 2=description, 3=keywords. Wir nutzen
    # snippet() für die Beschreibung (zeigt Match in Kontext) und
    # highlight() für den Titel (markiert nur).
    select_cols = "i.*"
    if q:
        select_cols += (
            # Sentinel-Marker (\\x01/\\x02) statt direkt '<mark>' — werden
            # serverseitig nach dem HTML-Escapen ersetzt (siehe _safe_highlight).
            ", snippet(idea_fts, 2, char(1), char(2), '…', 16) AS highlight_desc"
            ", highlight(idea_fts, 1, char(1), char(2)) AS highlight_title"
        )

    list_sql = (
        f"SELECT {select_cols} {base_sql} ORDER BY {sort_col} {order.upper()} LIMIT ? OFFSET ?"
    )
    count_sql = f"SELECT COUNT(*) {base_sql}"

    with connect() as con:
        try:
            total = con.execute(count_sql, params).fetchone()[0]
            rows = con.execute(list_sql, [*params, limit, offset]).fetchall()
        except sqlite3.OperationalError:
            # Malformierte FTS5-Query (z.B. unbalanciertes ") darf keinen 500
            # werfen — als 0 Treffer behandeln, die Suggestions unten greifen.
            total, rows = 0, []

    items = []
    for r in rows:
        d = _row_to_idea(r)
        # Highlights nur dann mitsenden, wenn vorhanden (q gesetzt + Treffer).
        # _safe_highlight escapt den User-Text und setzt <mark> aus Sentinels.
        try:
            ht = _safe_highlight(r["highlight_title"])
            hd = _safe_highlight(r["highlight_desc"])
            if ht or hd:
                d["highlights"] = {"title": ht, "description": hd}
        except (IndexError, KeyError):
            pass
        items.append(d)

    response: dict = {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": items,
    }

    # 0-Treffer-Suggestions: bei Volltext-Suche ohne Treffer schlagen wir
    # alternative Begriffe vor (LIKE-Match auf Title) und liefern zusätzlich
    # eine Auswahl aktueller Ideen. So sieht die UI nie eine Sackgasse.
    if q and total == 0:
        suggestions = _suggest_for_empty_query(q)
        if suggestions:
            response["suggestions"] = suggestions

    return response


def _suggest_for_empty_query(q: str) -> dict:
    """Liefert Vorschläge bei 0 FTS5-Treffern.
    - alt_terms: Titel-Tokens, die LIKE %term% in der idea-Tabelle matchen
    - recent: 5 aktuelle Ideen als „bei Sackgasse halt mal das hier"-Fallback
    """
    tokens = [t for t in re.split(r"\W+", q.strip()) if len(t) >= 3][:5]
    alt_terms: list[str] = []
    with connect() as con:
        for tok in tokens:
            row = con.execute(
                "SELECT title FROM idea WHERE title LIKE ? ORDER BY modified_at DESC LIMIT 1",
                (f"%{tok}%",),
            ).fetchone()
            if row and row["title"] not in alt_terms:
                alt_terms.append(row["title"])
        recent_rows = con.execute("SELECT * FROM idea ORDER BY modified_at DESC LIMIT 5").fetchall()
    return {
        "alt_terms": alt_terms,
        "recent": [_row_to_idea(r) for r in recent_rows],
    }


# ===== Trend-Ranking =====================================================

_RANKING_SORTS = {"rating", "comments", "interest", "likes"}


@router.get("/ranking", tags=["ranking"])
async def get_ranking(
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


@router.get("/ideas/{idea_id}")
async def get_idea(idea_id: str, authorization: str | None = Header(None)):
    with connect() as con:
        row = con.execute("SELECT * FROM idea WHERE id = ?", (idea_id,)).fetchone()
        interest_count = con.execute(
            "SELECT COUNT(*) FROM idea_interaction WHERE idea_id=? AND kind='interest'",
            (idea_id,),
        ).fetchone()[0]

    # Cache-Miss-Fallback: frisch eingereichte Ideen sind noch nicht im Cache.
    # Statt 404 → live aus edu-sharing holen, in den Cache schreiben (refresh
    # nutzt _upsert_idea), Row neu lesen. Funktioniert auch für anonyme Reader,
    # solange die Idee öffentlich lesbar ist.
    if not row:
        ok = await sync_mod.refresh_idea(idea_id, auth_header=authorization)
        if ok:
            with connect() as con:
                row = con.execute("SELECT * FROM idea WHERE id = ?", (idea_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Idea not found")

    # Versteckte Ideen: für non-mod als 404 behandeln, damit Suchmaschinen
    # und externe Embeds sie nicht zeigen. Mod sieht den Inhalt + Hinweis.
    if row["hidden"]:
        is_mod_caller_early = await _is_moderator(authorization)
        if not is_mod_caller_early:
            raise HTTPException(404, "Idea not found")

    base = _row_to_idea(row)
    base["hidden"] = bool(row["hidden"])
    base["hidden_reason"] = row["hidden_reason"]
    base["interest_count"] = interest_count

    # Node-Metadata einmalig holen — wir brauchen sie für can_edit/Rating.
    # Wenn keine Auth da ist, holen wir trotzdem (anonym), weil Rating-Werte
    # auch ohne Auth lesbar sind. So bekommt jeder User die Live-Werte.
    target_id = row["main_content_id"] or row["id"]
    live_meta_node: dict = {}
    try:
        meta = await edu_sharing.client.node_metadata(
            target_id,
            auth_header=authorization,
        )
        live_meta_node = (meta or {}).get("node") or {}
    except Exception as e:
        log.debug("get_idea: node_metadata fehlgeschlagen: %s", e)

    # can_edit / can_delete: NICHT aus ES-accessEffective ableiten — die
    # HackathOERn-Gruppe hat dort durch Vererbung pauschal Write-Rechte und
    # das wäre ein Free-for-all. App-seitiges Owner-Gating greift stattdessen.
    can_edit = False
    can_delete = False
    if authorization:
        # Editieren dürfen Owner/Mod UND angenommene Mitwirkende; Löschen/
        # Umhängen bleibt Owner/Mod vorbehalten.
        edit_allowed, _user, is_owner_or_mod = await _can_edit_idea(row["id"], authorization)
        can_edit = edit_allowed
        can_delete = is_owner_or_mod
    base["can_edit"] = can_edit
    base["can_delete"] = can_delete

    # Display-Name des Erstellers/Owners — konsistent mit Kommentaren, die
    # `firstName + lastName` aus dem ES-Profil zeigen. Frontend nutzt das
    # statt des reinen Login-Usernamens.
    owner_display_name: str | None = None
    if live_meta_node:
        for src in ("createdBy", "owner"):
            obj = live_meta_node.get(src) or {}
            fn = (obj.get("firstName") or "").strip()
            ln = (obj.get("lastName") or "").strip()
            full = f"{fn} {ln}".strip()
            if full:
                owner_display_name = full
                break
    base["owner_display_name"] = owner_display_name

    # Live-Rating aus den Node-Metadaten — der Cache-Wert kann durch
    # Schein-500-Fehler hinterherhinken, bis der nächste Sync läuft.
    # Auf der Detail-Seite ist es vertretbar, einen aktuellen Wert zu zeigen.
    base["my_rating"] = 0.0
    if live_meta_node:
        live_rating = live_meta_node.get("rating") or {}
        overall = live_rating.get("overall") or {}
        live_avg = float(overall.get("rating") or 0.0)
        live_count = int(overall.get("count") or 0)
        if live_count > 0 or live_avg > 0:
            base["rating_avg"] = live_avg
            base["rating_count"] = live_count
        if authorization:
            base["my_rating"] = float(live_rating.get("user") or 0.0)

    # Phase-Workflow: dem Frontend mitteilen, welche Phasen der Caller setzen
    # darf. Mod sieht alle, Owner nur „aktuelle + 1 vorwärts" (ohne Archive).
    is_mod_caller = False
    if authorization:
        try:
            is_mod_caller = await _is_moderator(authorization)
        except Exception:
            is_mod_caller = False
    with connect() as con:
        order = _phase_order(con)
    base["allowed_next_phases"] = (
        _allowed_next_phases(
            current=base.get("phase"),
            is_mod=is_mod_caller,
            order=order,
        )
        if can_edit
        else []
    )

    # Live comments — always against the ccm:io target (collection ideas
    # route to main_content_id, io ideas to themselves).
    # Auth-Passthrough: wenn der Caller eingeloggt ist, dessen Identität nutzen
    # statt Gast — damit funktioniert auch der Lesezugriff auf Ideen, die der
    # Gast (z.B. ohne Admin-Rechte) nicht sehen kann.
    comment_target = row["main_content_id"] or row["id"]
    is_private = False  # markiert: Gast hat keinen Lesezugriff
    try:
        base["comments"] = (
            await edu_sharing.client.comments(
                comment_target,
                auth_header=authorization,
            )
        ).get("comments") or []
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403):
            is_private = True
        base["comments"] = []
    except Exception:
        base["comments"] = []

    # Live attachments — documents the user can download / preview.
    def _has_real_content(att: dict) -> bool:
        """Eine Idee als ccm:io darf nur dann als Anhang gelistet werden,
        wenn sie tatsächlich Datei-Bytes oder einen externen Link mitbringt.
        Reine Brainstorm-Karten (Titel, ggf. textContent vom Crawler) ohne
        echten Datei-Inhalt führen sonst zu einer leeren `Dokumente (1)`-
        Anzeige mit unbenutzbarem „Öffnen"-Button."""
        sz = att.get("size") or 0
        try:
            sz = int(sz)
        except (TypeError, ValueError):
            sz = 0
        return bool(att.get("download_url")) or sz > 0

    attachments: list[dict] = []
    if row["kind"] == "io":
        # The node itself IS the attachment; use cached fields, top it up
        # with a fresh probe to get render_url + preview_url.
        att: dict | None = None
        try:
            meta = await edu_sharing.client.node_metadata(
                row["id"],
                auth_header=authorization,
            )
            att = _attachment_from_node(meta.get("node") or {})
        except httpx.HTTPStatusError as e:
            if e.response.status_code in (401, 403):
                is_private = True
            att = {
                "id": row["id"],
                "name": _safe_get(row, "attachment_name"),
                "title": row["title"],
                "mimetype": _safe_get(row, "attachment_mimetype"),
                "size": _safe_get(row, "attachment_size"),
                "download_url": _safe_get(row, "attachment_url"),
                "render_url": None,
                "preview_url": row["preview_url"],
            }
        except Exception:
            att = {
                "id": row["id"],
                "name": _safe_get(row, "attachment_name"),
                "title": row["title"],
                "mimetype": _safe_get(row, "attachment_mimetype"),
                "size": _safe_get(row, "attachment_size"),
                "download_url": _safe_get(row, "attachment_url"),
                "render_url": None,
                "preview_url": row["preview_url"],
            }
        if att and _has_real_content(att):
            attachments.append(att)
    else:
        # Collection idea — list every referenced ccm:io as an attachment.
        try:
            refs = await edu_sharing.client.collection_references(
                row["id"],
                max_items=50,
                auth_header=authorization,
            )
            for n in refs.get("references") or []:
                attachments.append(_attachment_from_node(n))
        except httpx.HTTPStatusError as e:
            if e.response.status_code in (401, 403):
                is_private = True
        except Exception:
            pass

    # Serienobjekt-Anhänge: Child-IOs unter der Idee (ccm:io_childobject-
    # Aspekt). Ersetzt die alte Geschwister-Sammlungs-Lösung.
    base["attachment_folder"] = None  # Legacy-Feld — Frontend ignoriert es jetzt
    try:
        # Bei kind="io" hängen Children am Knoten selbst; bei kind="collection"
        # hängen sie ebenfalls am Idee-Knoten (= ccm:map). Funktioniert für beide.
        children = await edu_sharing.client.list_child_objects(
            row["id"],
            auth_header=authorization,
        )
        for n in children:
            a = _attachment_from_node(n)
            a["from_folder"] = True  # Backwards-compat-Flag fürs Frontend
            a["is_child_object"] = True
            attachments.append(a)
    except Exception:
        pass

    base["attachments"] = attachments
    # Kontaktdaten der Einreichenden NUR für eingeloggte Nutzer:innen ausliefern
    # (serverseitiges Gate gegen Bot-Harvesting). Nur VERIFIZIERTE Logins
    # bekommen das Feld — ein bloßer (fälschbarer) Header reicht nicht. Den
    # Verify-Roundtrip nur auslösen, wenn überhaupt ein Kontakt hinterlegt ist
    # (spart den edu-sharing-Call auf den allermeisten Ideen).
    if authorization:
        try:
            with connect() as con:
                crow = con.execute(
                    "SELECT contact FROM idea_contact WHERE idea_id=?", (idea_id,)
                ).fetchone()
            if (
                crow
                and crow["contact"]
                and (is_mod_caller or (await _verify_login(authorization)) is not None)
            ):
                base["contact"] = crow["contact"]
        except Exception:
            pass
    # Hinweis für die UI, falls der Reader keinen Zugriff auf Live-Daten hat.
    # Eingeloggte User sehen das normalerweise nicht — deshalb nur bei Gast.
    if is_private and not authorization:
        base["restricted"] = True
    # Bewertungsphase: ist diese Idee aktuell bewertbar? (global + Event-Phase)
    base["rating_open"] = _rating_open_for_events(base.get("events") or [])
    if not base["rating_open"]:
        # Grund mitgeben, damit das Frontend den passenden Hinweis zeigt,
        # ohne auf den (cachebaren) globalen Schalter angewiesen zu sein.
        base["rating_closed_reason"] = (
            "global" if _get_setting("rating_enabled", "1") == "0" else "phase"
        )
    return base


@router.post("/ideas/{idea_id}/rating")
@limiter.limit("30/minute")
async def rate_idea(
    request: Request,
    idea_id: str,
    rating: float = Query(..., ge=0, le=5),
    text: str = Query("", max_length=4000),
    authorization: str | None = Header(None),
):
    user = _user_key_from_auth(authorization)
    log.info("rate_idea: user=%s idea=%s rating=%s", user, idea_id, rating)
    if not authorization:
        raise HTTPException(401, "Authorization header required for rating")
    with connect() as con:
        row = con.execute(
            "SELECT main_content_id,id,events FROM idea WHERE id = ?", (idea_id,)
        ).fetchone()
    if not row:
        raise HTTPException(404, "Idea not found")
    # Bewertungsphase serverseitig durchsetzen (nicht nur UI ausblenden):
    # eine NEUE/positive Bewertung ist nur möglich, wenn die Phase offen ist.
    # rating=0 (= zurücknehmen) bleibt erlaubt.
    if rating:
        try:
            _evs = json.loads(row["events"]) if row["events"] else []
        except Exception:
            _evs = []
        if not _rating_open_for_events(_evs if isinstance(_evs, list) else []):
            raise HTTPException(409, "Die Bewertung für diese Idee ist aktuell nicht geöffnet.")
    target = row["main_content_id"] or row["id"]
    if not target:
        raise HTTPException(409, "Idea has no ccm:io target for rating")
    # Strategie: Write versuchen, dann Read-Back als Wahrheits-Check.
    # edu-sharing wirft bei diesem Endpoint regelmäßig 500er, die je nach
    # Variante entweder Schein-Fehler (Rating IST drin) oder echte
    # Permission-Verweigerungen (Rating NICHT drin) sind:
    #   - `config.values.rating is null` → Schein, drin
    #   - `DAOSecurityException` → echt, nicht drin
    # Wir lassen das Write durchlaufen, schlucken den Fehler erstmal still
    # und vergleichen anschließend Read-Back-Wert mit dem gewünschten Rating.
    write_status: int | None = None
    write_error_text: str | None = None
    try:
        await edu_sharing.client.add_rating(
            target, rating=rating, text=text, auth_header=authorization
        )
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403):
            raise HTTPException(e.response.status_code, "Anmeldung erforderlich")
        write_status = e.response.status_code
        write_error_text = e.response.text[:200]
    except Exception as e:
        log.info("rate_idea: ES-Write Netzwerkfehler: %s", e)

    # Read-Back mit User-Auth — wahrer Stand
    avg = 0.0
    count = 0
    mine = 0.0
    try:
        meta = await edu_sharing.client.node_metadata(
            target,
            auth_header=authorization,
        )
        r = (meta.get("node") or {}).get("rating") or {}
        overall = r.get("overall") or {}
        avg = float(overall.get("rating") or 0.0)
        count = int(overall.get("count") or 0)
        mine = float(r.get("user") or 0.0)
    except Exception as e:
        log.warning("rate_idea: Read-Back fehlgeschlagen: %s", e)

    persisted = abs(mine - rating) < 0.01

    if write_status and write_status >= 400 and not persisted:
        # Echter Fehler — der Write ging schief und der Read-Back bestätigt
        # dass nichts persistiert wurde. Das ist meistens eine Permission-
        # Verweigerung (DAOSecurityException) — der User darf die Idee nicht
        # bewerten, z.B. weil sie einer anderen Person gehört und keine
        # Tool-Permission gesetzt ist.
        log.warning(
            "rate_idea: Rating nicht persistiert (HTTP %s): %s",
            write_status,
            write_error_text,
        )
        if "DAOSecurityException" in (write_error_text or "") or write_status == 403:
            raise HTTPException(
                403,
                "Du darfst diese Idee nicht bewerten. Wende dich an die "
                "Moderation, falls das ein Fehler ist.",
            )
        raise HTTPException(
            502,
            "edu-sharing konnte das Rating nicht speichern. Bitte später nochmal probieren.",
        )

    # Erfolg (entweder Write 200 oder Schein-500 mit persistiertem Rating)
    if write_status:
        log.info(
            "rate_idea: ES-Write %s ignoriert (Read-Back zeigt mine=%s)",
            write_status,
            mine,
        )

    # Vote-Ledger für den Punkteverfall pflegen (Zeitstempel der Stimme).
    # Nur wenn das Rating tatsächlich serverseitig steht. rating=0 = Reset.
    if persisted or not write_status:
        try:
            with connect() as con:
                if rating and rating > 0:
                    # created_at NICHT überschreiben → Erstabgabe bleibt das
                    # maßgebliche Stimmenalter. Wertänderung aktualisiert nur
                    # value + updated_at (Audit).
                    _ts = datetime.now(UTC).isoformat()
                    con.execute(
                        "INSERT INTO vote_event (idea_id,user_key,value,created_at,updated_at) "
                        "VALUES (?,?,?,?,?) "
                        "ON CONFLICT(idea_id,user_key) DO UPDATE SET "
                        "value=excluded.value, updated_at=excluded.updated_at",
                        (idea_id, user, float(rating), _ts, _ts),
                    )
                else:
                    con.execute(
                        "DELETE FROM vote_event WHERE idea_id=? AND user_key=?",
                        (idea_id, user),
                    )
        except Exception as e:
            log.debug("rate_idea: vote_event-Ledger-Update fehlgeschlagen: %s", e)

    # Cache update — best-effort
    try:
        await sync_mod.refresh_idea(idea_id, auth_header=authorization)
    except Exception:
        pass

    return {
        "ok": True,
        "rating": {
            "avg": avg,
            "count": count,
            "mine": mine,
        },
    }


@router.delete("/ideas/{idea_id}/rating")
@limiter.limit("30/minute")
async def unrate_idea(
    request: Request,
    idea_id: str,
    authorization: str | None = Header(None),
):
    """Eigene Bewertung/Like zurücknehmen (Daumen-Modus „un-like").

    Achtung: edu-sharing quittiert das Löschen aktuell oft mit 500
    (Server-Bug). Wir unterdrücken den Fehler bewusst — der Endnutzer
    sieht keinen Fehler, der Like kann aber serverseitig bestehen bleiben,
    bis der Bug behoben ist. Frontend aktualisiert optimistisch."""
    if not authorization:
        raise HTTPException(401, "Anmeldung erforderlich")
    with connect() as con:
        row = con.execute("SELECT main_content_id,id FROM idea WHERE id = ?", (idea_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Idea not found")
    target = row["main_content_id"] or row["id"]

    ok = True
    try:
        await edu_sharing.client.delete_rating(target, auth_header=authorization)
    except Exception as e:
        # 500 vom bekannten edu-sharing-Bug o.ä. → still schlucken.
        ok = False
        log.info("unrate_idea: delete_rating fehlgeschlagen (toleriert): %s", e)

    # Vote aus dem Verfalls-Ledger entfernen (unabhängig vom ES-Bug, damit
    # der Score-Verfall den Un-Like sofort widerspiegelt).
    user = _user_key_from_auth(authorization)
    if user:
        try:
            with connect() as con:
                con.execute(
                    "DELETE FROM vote_event WHERE idea_id=? AND user_key=?",
                    (idea_id, user),
                )
        except Exception as e:
            log.debug("unrate_idea: vote_event-Ledger-Delete fehlgeschlagen: %s", e)

    try:
        await sync_mod.refresh_idea(idea_id, auth_header=authorization)
    except Exception:
        pass

    # Immer 200 — der Endnutzer soll keinen Fehler sehen.
    return {"ok": True, "persisted": ok}


@router.post("/ideas/{idea_id}/comments")
@limiter.limit("30/minute")
async def comment_idea(
    request: Request,
    idea_id: str,
    comment: str = Query(..., min_length=1, max_length=4000),
    reply_to: str | None = None,
    authorization: str | None = Header(None),
):
    if not authorization:
        raise HTTPException(401, "Authorization header required for comments")
    with connect() as con:
        row = con.execute("SELECT main_content_id,id FROM idea WHERE id = ?", (idea_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Idea not found")
    target = row["main_content_id"] or row["id"]
    result = await edu_sharing.client.add_comment(
        target, comment=comment, reply_to=reply_to, auth_header=authorization
    )
    # Cache aktualisieren — comment_count fließt in Sortierung + Karten ein.
    try:
        await sync_mod.refresh_idea(idea_id, auth_header=authorization)
    except Exception:
        pass
    return result


class IdeaSubmission(BaseModel):
    title: str = Field(..., min_length=3, max_length=150)
    description: str | None = None
    author: str | None = None
    project_url: str | None = None
    keywords: list[str] = []
    topic_id: str | None = None  # target challenge (level-2 topic) — moderator moves there later
    phase: str | None = None
    event: str | None = None  # legacy single-event (wird auf events[] gemerged)
    events: list[str] = []  # mehrere Veranstaltungen pro Idee
    # Mathe-Captcha — Pflicht NUR bei anonymem Submit. Eingeloggte User
    # (= mit Authorization-Header) lassen das Feld leer.
    captcha_token: str | None = None
    captcha_answer: str | None = None
    # Optionale Kontaktdaten (E-Mail oder Link) für Rückfragen/Mithackende.
    # Werden NUR mit ausdrücklicher Einwilligung (contact_consent) in der
    # App-DB gespeichert und nur eingeloggten Nutzer:innen angezeigt.
    contact: str | None = Field(default=None, max_length=200)
    contact_consent: bool = False


_SAFE_NAME = re.compile(r"[^a-zA-Z0-9_\-]+")


def _slugify(title: str) -> str:
    s = _SAFE_NAME.sub("-", title.strip().lower()).strip("-")
    return (s[:80] or "idee") + ".html"


@router.post("/ideas", status_code=201)
@limiter.limit("10/minute")
async def submit_idea(
    request: Request,
    body: IdeaSubmission,
    authorization: str | None = Header(None),
):
    """Create a new idea as ccm:io. Without Authorization header it is created
    in the guest inbox for moderator review. With Authorization it is created
    under the same inbox for now (later: directly under the target challenge).

    Anonyme Submits müssen ein zuvor von `GET /captcha` geholtes Token
    + Lösung mitschicken (`captcha_token` + `captcha_answer`).
    Eingeloggte User skippen das."""
    if not authorization:
        _captcha_verify(body.captcha_token, body.captcha_answer)
    kws = [k.strip() for k in body.keywords if k and k.strip()]
    if body.phase and not any(k.lower().startswith("phase:") for k in kws):
        kws.append(f"phase:{body.phase}")
    # Events: einzelne event-Flag + events-Liste mergen, deduplizieren.
    event_slugs = list(body.events or [])
    if body.event:
        event_slugs.append(body.event)
    seen_events: set[str] = set()
    for ev in event_slugs:
        ev = (ev or "").strip()
        if not ev or ev in seen_events:
            continue
        seen_events.add(ev)
        if not any(k.lower() == f"event:{ev}".lower() for k in kws):
            kws.append(f"event:{ev}")
    if body.topic_id and not any(k.lower().startswith("target-topic:") for k in kws):
        # remember the intended target so moderator/UI can pick it up later
        kws.append(f"target-topic:{body.topic_id}")

    # Submitter-Tracking: bei eingeloggter Einreichung den Caller-Username
    # als Keyword anhängen, damit "Meine Ideen" und Edit-Gating zuordnen können.
    submitter = _user_key_from_auth(authorization) if authorization else None
    if submitter and not any(k.lower().startswith("submitter:") for k in kws):
        kws.append(f"submitter:{submitter}")

    props: dict[str, list[str]] = {
        "cm:name": [_slugify(body.title)],
        "cm:title": [body.title],
        "cclom:title": [body.title],
    }
    if body.description:
        props["cclom:general_description"] = [body.description]
        props["cm:description"] = [body.description]
    if kws:
        props["cclom:general_keyword"] = kws
    if body.author:
        props["ccm:author_freetext"] = [body.author]
    safe_url = _validate_external_url(body.project_url, field="Projekt-URL")
    if safe_url:
        props["ccm:wwwurl"] = [safe_url]
    # Pflicht-Metadaten für die WLO-Freischaltung. Ohne diese Felder flaggt
    # die Redaktionsmaske die Idee als "unvollständig". Wir setzen WLO-übliche
    # Defaults, damit die Idee out-of-the-box freischaltbar ist:
    #   - Lizenz: CC BY 4.0 (WLO-Standard für OER-Beiträge)
    #   - Sprache: Deutsch
    #   - Replikations-Quelle: kennzeichnet den App-Ursprung
    # Diese Defaults können später im Repo geändert werden.
    props.setdefault("ccm:commonlicense_key", ["CC_BY"])
    props.setdefault("ccm:commonlicense_cc_version", ["4.0"])
    props.setdefault("cclom:general_language", ["de"])
    props.setdefault("ccm:replicationsource", ["hackathoern-ideendatenbank"])

    # Strategie:
    # - Eingeloggte User schreiben mit IHRER Auth direkt in die Community-Inbox
    #   (sie sind Mitglied der HackathOERn-Gruppe, die dort Collaborator-Rechte
    #   geerbt hat). Dadurch werden sie selbst der ES-Creator und können ihre
    #   Idee auch nach einem Move durch Mods weiter bearbeiten/löschen.
    # - Anonyme Submits laufen über den Guest (WLO-Upload), der direkt
    #   Collaborator auf der Inbox hat.
    # Kein Fallback eingeloggt → Guest, weil das den Owner-Tausch maskieren
    # würde. Fehler bleibt Fehler — der User merkt, dass etwas mit seinem
    # Account-Setup nicht stimmt.
    try:
        result = await edu_sharing.client.create_node(
            parent_id=settings.edu_guest_inbox_id,
            node_type="ccm:io",
            properties=props,
            auth_header=authorization,  # None bei Anonym → Guest-Fallback im Client
        )
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403):
            raise HTTPException(
                403,
                "Keine Berechtigung, eine Idee anzulegen. Vermutlich fehlt "
                "die Mitgliedschaft in der HackathOERn-Gruppe — bitte beim "
                "Moderationsteam melden.",
            )
        raise HTTPException(
            502,
            f"edu-sharing Fehler beim Anlegen: {e.response.status_code} {e.response.text[:180]}",
        )

    node = (result or {}).get("node") or {}
    new_id = (node.get("ref") or {}).get("id")

    # Kontaktdaten nur MIT Einwilligung in der App-DB ablegen (nicht in
    # edu-sharing). Anzeige später nur für eingeloggte Nutzer:innen.
    contact = (body.contact or "").strip()
    if new_id and contact and body.contact_consent:
        try:
            with connect() as con:
                con.execute(
                    "INSERT INTO idea_contact (idea_id,contact,created_at) VALUES (?,?,?) "
                    "ON CONFLICT(idea_id) DO UPDATE SET contact=excluded.contact",
                    (new_id, contact[:200], datetime.now(UTC).isoformat()),
                )
        except Exception as e:
            log.debug("submit_idea: idea_contact speichern fehlgeschlagen: %s", e)

    # Single-Node-Refresh: frische Idee sofort im Cache, ohne auf 5-min-Sync
    # zu warten. Auth des Erstellers (oder None für Gast) wird durchgereicht.
    if new_id:
        try:
            await sync_mod.refresh_idea(new_id, auth_header=authorization)
        except Exception:
            pass

    _log_activity(
        action="idea_submitted",
        authorization=authorization,
        target_type="idea",
        target_id=new_id,
        target_label=body.title,
        detail={
            "anonymous": authorization is None,
            "topic_id": body.topic_id,
            "phase": body.phase,
            "events": list(body.events or []) + ([body.event] if body.event else []),
        },
    )

    return {
        "ok": True,
        "moderation": "pending",
        "node_id": new_id,
        "message": (
            "Danke! Deine Idee liegt jetzt im Moderations-Postfach. "
            "Das Team prüft sie und ordnet sie der passenden Herausforderung zu."
        ),
    }


def _user_key_from_auth(authorization: str | None) -> str | None:
    """Derive a stable user key from Basic-Auth header (Base64-decoded username).
    Returns None when no credentials are provided."""
    if not authorization or not authorization.lower().startswith("basic "):
        return None
    import base64 as _b

    try:
        raw = _b.b64decode(authorization.split(" ", 1)[1]).decode("utf-8", "replace")
        return raw.split(":", 1)[0] or None
    except Exception:
        return None


# Kleiner TTL-Cache für aufgelöste Anzeigenamen (username → (name, expiry_ts)).
# Spart pro Request einen edu-sharing-Roundtrip; 10 Min sind unkritisch, da
# sich Vor-/Nachname praktisch nie ändern.
_DISPLAY_NAME_CACHE: dict[str, tuple[str, float]] = {}
_DISPLAY_NAME_TTL = 600.0


async def _resolve_display_name(authorization: str | None) -> str | None:
    """Echten Namen (Vor- + Nachname) des eingeloggten Users aus edu-sharing
    auflösen. Fallback: Login-Username. None nur ohne Auth."""
    user = _user_key_from_auth(authorization)
    if not user:
        return None
    import time as _t

    now = _t.monotonic()
    cached = _DISPLAY_NAME_CACHE.get(user)
    if cached and cached[1] > now:
        return cached[0]
    name = user
    try:
        prof = await edu_sharing.client.my_profile(auth_header=authorization)
        person = (prof or {}).get("person") or {}
        p = person.get("profile") or {}
        fn = (p.get("firstName") or person.get("firstName") or "").strip()
        ln = (p.get("lastName") or person.get("lastName") or "").strip()
        full = f"{fn} {ln}".strip()
        if full:
            name = full
    except Exception:
        # ES nicht erreichbar / kein Profil → Login-Name als Fallback.
        pass
    _DISPLAY_NAME_CACHE[user] = (name, now + _DISPLAY_NAME_TTL)
    return name


# ===== Phase-Status-Workflow (Variante A) ===============================
# Regeln:
#   - Owner darf phase nur um GENAU EINE Stufe vorwärts setzen
#   - Moderator darf jede Transition (auch zurück, springen, zur Archiviert)
#   - Archiviert + Sprünge über >1 Stufe sind ausschließlich Mod
#   - Phasen ohne sort_order werden ans Ende gestellt
#   - Heuristik: phase==None oder unbekannt wird wie „erste Phase" behandelt
PHASE_ARCHIVE_SLUG = "archiviert"


def _phase_order(con) -> list[str]:
    """Liefert die aktiven Phase-Slugs in der vom Mod definierten Reihenfolge.
    Fallback auf den DEFAULT_PHASES-Stand, falls keine Taxonomie da ist."""
    rows = con.execute(
        "SELECT slug FROM taxonomy_phase WHERE active = 1 ORDER BY sort_order ASC, slug ASC"
    ).fetchall()
    if rows:
        return [r["slug"] for r in rows]
    # Fallback (sollte init_db immer schon gepflanzt haben)
    return [
        "anregung",
        "ausarbeitung",
        "pitch-bereit",
        "in-umsetzung",
        "abgeschlossen",
        PHASE_ARCHIVE_SLUG,
    ]


def _is_allowed_phase_transition(
    *,
    current: str | None,
    target: str | None,
    is_mod: bool,
    order: list[str],
) -> tuple[bool, str | None]:
    """Returns (ok, reason). Reason ist nur bei ok=False gesetzt."""
    if is_mod:
        return True, None
    # Kein Mod → strengere Regeln
    if not target:
        return True, None  # phase löschen → setzt zurück, harmlos
    if target == PHASE_ARCHIVE_SLUG:
        return False, "Nur Moderator:innen dürfen Ideen archivieren."
    if target not in order:
        # Phase-Slug existiert in taxonomy_phase nicht (oder inaktiv)
        return False, f'Phase „{target}" ist nicht (mehr) verfügbar.'
    target_idx = order.index(target)
    if not current or current not in order:
        # Idee ohne Phase → darf auf erste oder zweite Stufe wechseln (Toleranz)
        if target_idx <= 1:
            return True, None
        return False, ("Phase muss schrittweise hochgesetzt werden — Sprung zu weit. Mod fragen.")
    current_idx = order.index(current)
    if target_idx == current_idx:
        return True, None  # No-Op
    if target_idx == current_idx + 1:
        return True, None  # genau eine Stufe vorwärts
    if target_idx < current_idx:
        return False, "Nur Moderator:innen dürfen Phasen zurückschalten."
    return False, (
        "Mehrere Stufen auf einmal sind nur für Moderator:innen — "
        "schrittweise weiter, oder Mod fragen."
    )


def _allowed_next_phases(
    *,
    current: str | None,
    is_mod: bool,
    order: list[str],
) -> list[str]:
    """Welche Phasen darf der Caller jetzt setzen?"""
    if is_mod:
        return list(order)  # alles erlaubt
    if not current or current not in order:
        return order[:2]  # erste oder zweite Stufe
    idx = order.index(current)
    out = [current]
    if idx + 1 < len(order) and order[idx + 1] != PHASE_ARCHIVE_SLUG:
        out.append(order[idx + 1])
    return out


def _log_activity(
    *,
    action: str,
    authorization: str | None = None,
    is_mod: bool = False,
    target_type: str | None = None,
    target_id: str | None = None,
    target_label: str | None = None,
    detail: dict | None = None,
) -> None:
    """Schreibt eine Zeile in activity_log. Best-effort: Fehler werden nur
    geloggt, niemals propagiert — das Logging darf eine Schreib-Aktion nie
    zum Scheitern bringen."""
    try:
        actor = _user_key_from_auth(authorization)
        with connect() as con:
            con.execute(
                "INSERT INTO activity_log "
                "(ts,actor,is_mod,action,target_type,target_id,target_label,detail) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (
                    sync_mod._iso_now(),
                    actor or "Gast",
                    1 if is_mod else 0,
                    action,
                    target_type,
                    target_id,
                    (target_label or "")[:200] if target_label else None,
                    json.dumps(detail, ensure_ascii=False) if detail else None,
                ),
            )
    except Exception as e:
        log.warning("activity log failed (%s): %s", action, e)


@router.get("/ideas/{idea_id}/interactions")
async def get_interactions(
    idea_id: str,
    authorization: str | None = Header(None),
):
    with connect() as con:
        rows = con.execute(
            "SELECT kind, display_name, user_key, created_at, status, can_edit "
            "FROM idea_interaction WHERE idea_id = ? ORDER BY created_at DESC",
            (idea_id,),
        ).fetchall()
        # Selbst gesetzte App-Profil-Namen der Teilnehmer (bevorzugt vor dem
        # beim Beitritt aufgelösten edu-sharing-Namen).
        keys = list({r["user_key"] for r in rows if r["user_key"]})
        meta_names: dict[str, str] = {}
        if keys:
            ph = ",".join("?" * len(keys))
            for m in con.execute(
                f"SELECT username, display_name FROM user_profile_meta "
                f"WHERE username IN ({ph}) AND display_name IS NOT NULL AND display_name != ''",
                keys,
            ).fetchall():
                meta_names[m["username"]] = m["display_name"]

    current = _user_key_from_auth(authorization)
    interest = [r for r in rows if r["kind"] == "interest"]
    follow = [r for r in rows if r["kind"] == "follow"]

    def disp(r) -> str:
        """1. App-Profilname (selbst gesetzt) → 2. beim Beitritt aufgelöster
        edu-sharing-Klarname (≠ Login) → 3. Login als Fallback."""
        uk = r["user_key"]
        if meta_names.get(uk):
            return meta_names[uk]
        dn = r["display_name"]
        if dn and dn != uk:
            return dn
        return uk

    # Eigener Eintrag zeigt noch den Login? → frisch aus edu-sharing auflösen
    # (Auth des Betrachters liegt vor) und im Ledger nachziehen, damit auch
    # Altbestand korrekt wird.
    current_name: str | None = None
    if current and authorization:
        mine = next((r for r in interest if r["user_key"] == current), None)
        if mine is not None and disp(mine) == current:
            real = await _resolve_display_name(authorization)
            if real and real != current:
                current_name = real
                try:
                    with connect() as con:
                        con.execute(
                            "UPDATE idea_interaction SET display_name=? "
                            "WHERE idea_id=? AND user_key=? AND kind='interest'",
                            (real, idea_id, current),
                        )
                except Exception:
                    pass

    def name_for(r) -> str:
        if current_name and r["user_key"] == current:
            return current_name
        return disp(r)

    # Verwaltungs-Flag: darf der Betrachter das Team annehmen / Recht erteilen?
    can_manage = False
    if authorization:
        try:
            can_manage = (await _is_owner_or_mod(idea_id, authorization))[0]
        except Exception:
            can_manage = False

    def status_of(r) -> str:
        return r["status"] if r["status"] else "pending"

    return {
        "interest": {
            "count": len(interest),
            "users": [
                {
                    "name": name_for(r),
                    "user_key": r["user_key"],
                    "status": status_of(r),
                    "approved": status_of(r) == "approved",
                    "can_edit": bool(r["can_edit"]),
                }
                for r in interest
            ],
            "mine": any(r["user_key"] == current for r in interest) if current else False,
            "mine_status": next((status_of(r) for r in interest if r["user_key"] == current), None)
            if current
            else None,
            "can_manage": can_manage,
        },
        "follow": {
            "count": len(follow),
            "mine": any(r["user_key"] == current for r in follow) if current else False,
        },
    }


class ContactBody(BaseModel):
    contact: str | None = Field(default=None, max_length=200)


@router.put("/ideas/{idea_id}/contact", tags=["ideas"])
async def set_idea_contact(
    idea_id: str, body: ContactBody, authorization: str | None = Header(None)
):
    """Kontakt einer Idee setzen/ändern/entfernen. Nur Einreichende oder
    Moderation. Leerer Wert → löschen (für DSGVO-Löschanfragen). Speicherung
    ausschließlich App-seitig (idea_contact), nicht in edu-sharing."""
    # App-DB-Write ohne edu-sharing-Backstop → Credentials verifizieren, sonst
    # würde der Owner-Cache-Pfad in _is_owner_or_mod dem ungeprüften Username trauen.
    if not await _verify_login(authorization):
        raise HTTPException(401, "Anmeldung erforderlich")
    allowed, _user, is_mod = await _is_owner_or_mod(idea_id, authorization)
    if not allowed:
        raise HTTPException(403, "Nur Einreichende oder Moderation dürfen den Kontakt ändern.")
    contact = (body.contact or "").strip()
    with connect() as con:
        if contact:
            con.execute(
                "INSERT INTO idea_contact (idea_id,contact,created_at) VALUES (?,?,?) "
                "ON CONFLICT(idea_id) DO UPDATE SET contact=excluded.contact",
                (idea_id, contact[:200], datetime.now(UTC).isoformat()),
            )
        else:
            con.execute("DELETE FROM idea_contact WHERE idea_id=?", (idea_id,))
    _log_activity(
        action="idea_contact_changed",
        authorization=authorization,
        is_mod=is_mod,
        target_type="idea",
        target_id=idea_id,
        detail={"set": bool(contact)},
    )
    return {"ok": True, "contact": contact or None}


@router.post("/ideas/{idea_id}/interest")
async def toggle_interest(
    idea_id: str,
    authorization: str | None = Header(None),
):
    # App-DB-Write → Login verifizieren (sonst Impersonation per Username).
    user = await _verify_login(authorization)
    if not user:
        raise HTTPException(401, "Anmeldung erforderlich")
    with connect() as con:
        row = con.execute("SELECT id, title FROM idea WHERE id = ?", (idea_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Idee nicht gefunden")
        existing = con.execute(
            "SELECT 1 FROM idea_interaction WHERE idea_id=? AND user_key=? AND kind='interest'",
            (idea_id, user),
        ).fetchone()
        if existing:
            con.execute(
                "DELETE FROM idea_interaction WHERE idea_id=? AND user_key=? AND kind='interest'",
                (idea_id, user),
            )
            return {"state": "removed"}
    # Echten Namen auflösen (außerhalb der Schreib-Transaktion, da Netz-IO),
    # damit die Mitmach-Liste Klarnamen statt Login-Usernamen zeigt.
    display = await _resolve_display_name(authorization) or user
    with connect() as con:
        con.execute(
            "INSERT INTO idea_interaction (idea_id,user_key,kind,display_name,created_at) "
            "VALUES (?,?, 'interest', ?, datetime('now'))",
            (idea_id, user, display),
        )
    # Anfrage protokollieren → erscheint im Feed/„Was ist neu" der/des
    # Ideengeber:in (fremde Aktion auf eigener Idee).
    _log_activity(
        action="team_join_requested",
        authorization=authorization,
        target_type="idea",
        target_id=idea_id,
        target_label=row["title"],
        detail={"user": user, "name": display},
    )
    return {"state": "added"}


@router.post("/ideas/{idea_id}/follow")
async def toggle_follow(
    idea_id: str,
    authorization: str | None = Header(None),
):
    # App-DB-Write → Login verifizieren (sonst Impersonation per Username).
    user = await _verify_login(authorization)
    if not user:
        raise HTTPException(401, "Anmeldung erforderlich")
    with connect() as con:
        row = con.execute("SELECT id FROM idea WHERE id = ?", (idea_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Idee nicht gefunden")
        existing = con.execute(
            "SELECT 1 FROM idea_interaction WHERE idea_id=? AND user_key=? AND kind='follow'",
            (idea_id, user),
        ).fetchone()
        if existing:
            con.execute(
                "DELETE FROM idea_interaction WHERE idea_id=? AND user_key=? AND kind='follow'",
                (idea_id, user),
            )
            return {"state": "removed"}
        con.execute(
            "INSERT INTO idea_interaction (idea_id,user_key,kind,display_name,created_at) "
            "VALUES (?,?, 'follow', ?, datetime('now'))",
            (idea_id, user, user),
        )
    return {"state": "added"}


class TeamMemberPatch(BaseModel):
    """Owner/Mod nimmt eine:n Mithackende:n an (status) und/oder erteilt
    Bearbeitungsrecht (can_edit)."""

    status: Literal["pending", "approved"] | None = None
    can_edit: bool | None = None


@router.put("/ideas/{idea_id}/team/{user_key}", tags=["ideas"])
async def set_team_member(
    idea_id: str,
    user_key: str,
    body: TeamMemberPatch,
    authorization: str | None = Header(None),
):
    """Annehmen einer/eines Mithackenden (grünes Häkchen) und/oder
    Bearbeitungsrecht erteilen. Nur Owner/Mod. Die Person muss bereits als
    Mithackende:r (kind='interest') eingetragen sein."""
    # App-DB-Write → Login verifizieren, sonst würde der Owner-Cache-Pfad in
    # _is_owner_or_mod dem ungeprüften Username vertrauen (Impersonation).
    if not await _verify_login(authorization):
        raise HTTPException(401, "Anmeldung erforderlich")
    allowed, _u, is_mod = await _is_owner_or_mod(idea_id, authorization)
    if not allowed:
        raise HTTPException(403, "Nur Einreicher:in oder Moderation können das Team verwalten.")

    # Zielzustand bestimmen: Edit-Recht impliziert „angenommen"; Zurücksetzen
    # auf „pending" entzieht das Edit-Recht wieder.
    new_status = body.status
    new_can_edit = body.can_edit
    if new_can_edit:
        new_status = "approved"
    if new_status == "pending":
        new_can_edit = False
    if new_status is None and new_can_edit is None:
        raise HTTPException(400, "Nichts zu ändern.")

    sets: list[str] = []
    params: list = []
    if new_status is not None:
        sets.append("status=?")
        params.append(new_status)
    if new_can_edit is not None:
        sets.append("can_edit=?")
        params.append(1 if new_can_edit else 0)
    params += [idea_id, user_key]

    with connect() as con:
        exists = con.execute(
            "SELECT 1 FROM idea_interaction WHERE idea_id=? AND user_key=? AND kind='interest'",
            (idea_id, user_key),
        ).fetchone()
        if not exists:
            raise HTTPException(404, "Diese Person ist nicht als Mithackende eingetragen.")
        con.execute(
            f"UPDATE idea_interaction SET {', '.join(sets)} "
            "WHERE idea_id=? AND user_key=? AND kind='interest'",
            params,
        )
        _trow = con.execute("SELECT title FROM idea WHERE id=?", (idea_id,)).fetchone()
        idea_title = _trow["title"] if _trow else None
    # Spezifische Aktion → der/die betroffene Mithackende sieht im Feed/„Was
    # ist neu" konkret, was passiert ist (Aktion stammt vom Owner, nicht von
    # ihr/ihm selbst → wird im eigenen Feed angezeigt).
    if new_can_edit is True:
        action = "team_edit_granted"
    elif new_can_edit is False:
        action = "team_edit_revoked"
    elif new_status == "approved":
        action = "team_approved"
    elif new_status == "pending":
        action = "team_unapproved"
    else:
        action = "team_member_updated"
    _log_activity(
        action=action,
        authorization=authorization,
        is_mod=is_mod,
        target_type="idea",
        target_id=idea_id,
        target_label=idea_title,
        detail={"user": user_key, "status": new_status, "can_edit": new_can_edit},
    )
    return {"ok": True, "user_key": user_key, "status": new_status, "can_edit": new_can_edit}


@router.delete("/ideas/{idea_id}/team/{user_key}", tags=["ideas"])
async def remove_team_member(
    idea_id: str,
    user_key: str,
    authorization: str | None = Header(None),
):
    """Entfernt eine:n Mithackende:n ganz aus dem Team (inkl. Edit-Recht).
    Nur Owner/Mod."""
    # App-DB-Write → Login verifizieren (siehe set_team_member).
    if not await _verify_login(authorization):
        raise HTTPException(401, "Anmeldung erforderlich")
    allowed, _u, is_mod = await _is_owner_or_mod(idea_id, authorization)
    if not allowed:
        raise HTTPException(403, "Nur Einreicher:in oder Moderation können das Team verwalten.")
    with connect() as con:
        con.execute(
            "DELETE FROM idea_interaction WHERE idea_id=? AND user_key=? AND kind='interest'",
            (idea_id, user_key),
        )
    _log_activity(
        action="team_member_removed",
        authorization=authorization,
        is_mod=is_mod,
        target_type="idea",
        target_id=idea_id,
        detail={"user": user_key},
    )
    return {"ok": True}


@router.get("/inbox", tags=["moderation"])
async def list_inbox(
    # Default 200: Inbox passt in eine Seite, "Alle" zeigt wirklich alle.
    # Niedrigeres Limit muss der Caller explizit setzen.
    limit: int = Query(200, ge=1, le=500),
    filter: Literal[
        "uncategorized",  # noch nicht in einer Sammlung (Default — was zu tun ist)
        "all",  # alle ccm:io der Inbox
        "categorized",  # bereits irgendwo als Reference verlinkt
        "app-submits",  # nur App-Einreichungen mit phase:/event:-Markern
    ] = Query("uncategorized", description="Sichtfilter über die Inbox"),
    authorization: str | None = Header(None),
):
    await _require_moderator(authorization)
    """List ccm:io nodes in the moderation inbox.

    Vier Sichten via `?filter=`:
      - `uncategorized` (Default): noch keiner Sammlung als Reference zugeordnet.
        Das ist die operative Arbeitsliste — diese Items müssen einsortiert werden.
      - `all`: alle ccm:io der Inbox, unabhängig vom Sammlungs-Status.
      - `categorized`: nur die schon als Reference irgendwo gelandet sind
        (Übersicht über das, was bereits eingepflegt wurde).
      - `app-submits`: nur Items mit `phase:`/`event:`/`target-topic:`-
        Keywords aus dem App-Einreichungs-Pfad.
    """
    # Fetch up to 3 pages of 200 newest-first nodes to surface our recent
    # submissions in an inbox that contains lots of legacy uploads.
    raw_nodes: list[dict] = []
    try:
        for skip in (0, 200, 400):
            page = await edu_sharing.client.node_children(
                settings.edu_guest_inbox_id,
                max_items=200,
                skip_count=skip,
                sort_prop="cm:created",
                sort_asc=False,
            )
            ns = page.get("nodes") or []
            raw_nodes.extend(ns)
            if len(ns) < 200:
                break
    except httpx.HTTPStatusError as e:
        raise HTTPException(502, f"edu-sharing Fehler: {e.response.status_code}")

    # Originals, die bereits als Reference in einer Sammlung referenziert
    # werden, raus aus dem Postfach: ihre IDs stehen in idea.original_id.
    # Sonst tauchen alte Ideen-Originale (mit phase:/event:-Marker, weil
    # sie über den Reference-Knoten gepflegt wurden) im Postfach auf.
    with connect() as con:
        # original_id -> Liste der Herausforderungen (topic_id), in denen das
        # Original referenziert ist. Dient (a) dem in_collection-Flag und (b)
        # der Anzeige der konkreten Einsortierung im Postfach (ein Original kann
        # in mehreren Herausforderungen liegen).
        cataloged: dict[str, list[str]] = {}
        for r in con.execute(
            "SELECT original_id, topic_id FROM idea WHERE original_id IS NOT NULL"
        ).fetchall():
            oid = r["original_id"]
            if not oid:
                continue
            lst = cataloged.setdefault(oid, [])
            if r["topic_id"] and r["topic_id"] not in lst:
                lst.append(r["topic_id"])

    items = []
    for n in raw_nodes:
        if n.get("type") != "ccm:io":
            continue
        node_id = (n.get("ref") or {}).get("id")
        is_cataloged = bool(node_id and node_id in cataloged)
        props = n.get("properties") or {}
        kws = props.get("cclom:general_keyword") or []
        if isinstance(kws, str):
            kws = [kws]
        has_marker = any(
            str(k).lower().startswith(p) for k in kws for p in ("phase:", "event:", "target-topic:")
        )
        # Sichtfilter anwenden
        if filter == "uncategorized" and is_cataloged:
            continue
        if filter == "categorized" and not is_cataloged:
            continue
        if filter == "app-submits" and not has_marker:
            continue
        # filter == "all" → kein zusätzliches Skip

        phase = next(
            (k[len("phase:") :] for k in kws if str(k).lower().startswith("phase:")),
            None,
        )
        event = next(
            (k[len("event:") :] for k in kws if str(k).lower().startswith("event:")),
            None,
        )
        target_topic = next(
            (k[len("target-topic:") :] for k in kws if str(k).lower().startswith("target-topic:")),
            None,
        )
        items.append(
            {
                "id": (n.get("ref") or {}).get("id"),
                "name": n.get("name"),
                "title": n.get("title") or (props.get("cm:title") or [None])[0] or n.get("name"),
                "description": (props.get("cclom:general_description") or [None])[0]
                or (props.get("cm:description") or [None])[0],
                "author": (props.get("ccm:author_freetext") or [None])[0],
                "project_url": (props.get("ccm:wwwurl") or [None])[0],
                "phase": phase,
                "event": event,
                "target_topic": target_topic,
                "created_at": n.get("createdAt"),
                "in_collection": is_cataloged,
                "has_app_marker": has_marker,
                # Konkrete Herausforderung(en), in denen das Item schon liegt
                # (topic_id-Liste; vom Frontend zu „Thema › Herausforderung" aufgelöst).
                "placements": cataloged.get(node_id, []),
            }
        )
    # Newest first
    items.sort(key=lambda x: x["created_at"] or "", reverse=True)
    sliced = items[:limit]
    return {
        # `count` = Anzahl tatsächlich zurückgegebener Items (post-slice).
        # `total` = wieviele matchen den Filter überhaupt (pre-slice).
        # Bei Konsumenten wie der Mod-UI kann so „N von M" angezeigt werden.
        "count": len(sliced),
        "total": len(items),
        "items": sliced,
        "filter": filter,
    }


@router.get("/inbox/{node_id}/preview", tags=["moderation"])
async def inbox_item_preview(
    node_id: str,
    authorization: str | None = Header(None),
):
    """Vollständige Review-Vorschau einer Inbox-Einreichung — direkt aus
    edu-sharing, Cache-unabhängig.

    `GET /ideas/{id}` quittiert noch nicht einsortierte Inbox-Knoten mit 404
    (es gibt keine Cache-Row, und `refresh_idea` überspringt Inbox-Knoten
    bewusst, damit sie nicht im Public-Cache landen). Für die Moderation ist
    die Detailsicht aber gerade bei den UNeinsortierten Einreichungen nötig —
    das ist die operative Arbeitsliste. Dieser Endpoint liefert daher alles
    zum Prüfen + Freigeben:
      - Beschreibung, Schlagwörter (ohne interne `*:`-Marker),
      - Phase + Veranstaltung(en),
      - den vom Einreicher gewünschten Themenbereich/Herausforderung
        (`target-topic:`) und den App-Einreicher (`submitter:`),
      - Anhänge (Knoten selbst, falls er Datei-Inhalt trägt, + Child-Objekte)
        inkl. Download-/Vorschau-Links,
      - Owner + Zeitstempel + ggf. Bewertung.
    Nur Moderation."""
    await _require_moderator(authorization)
    try:
        meta = await edu_sharing.client.node_metadata(node_id, auth_header=authorization)
    except httpx.HTTPStatusError as e:
        raise HTTPException(e.response.status_code, f"edu-sharing: {e.response.text[:180]}")
    node = (meta or {}).get("node") or {}
    if not node:
        raise HTTPException(404, "Einreichung nicht gefunden")
    props = node.get("properties") or {}

    def _first(key: str) -> str | None:
        v = props.get(key)
        if isinstance(v, list):
            return v[0] if v else None
        return v

    kws_raw = props.get("cclom:general_keyword") or []
    if isinstance(kws_raw, str):
        kws_raw = [kws_raw]
    kws = [str(k) for k in kws_raw if k]
    internal = ("phase:", "event:", "target-topic:", "submitter:", "topic:")
    phase = next((k[len("phase:") :] for k in kws if k.lower().startswith("phase:")), None)
    events = [k[len("event:") :] for k in kws if k.lower().startswith("event:")]
    target_topic = next(
        (k[len("target-topic:") :] for k in kws if k.lower().startswith("target-topic:")),
        None,
    )
    submitter = next(
        (k[len("submitter:") :] for k in kws if k.lower().startswith("submitter:")),
        None,
    )
    keywords = [k for k in kws if not k.lower().startswith(internal)]

    preview = node.get("preview") or {}
    created_by = node.get("createdBy") or {}
    owner_display = (
        " ".join(
            x
            for x in (
                (created_by.get("firstName") or "").strip(),
                (created_by.get("lastName") or "").strip(),
            )
            if x
        ).strip()
        or None
    )

    # Anhänge: der Knoten selbst (nur wenn er echten Datei-Inhalt trägt — reine
    # Brainstorm-Karten ohne Bytes/Link nicht listen) + Child-Objekte (Serie).
    attachments: list[dict] = []
    self_att = _attachment_from_node(node)
    if self_att.get("download_url") or (self_att.get("size") or 0):
        attachments.append(self_att)
    try:
        for child in await edu_sharing.client.list_child_objects(
            node_id, auth_header=authorization
        ):
            a = _attachment_from_node(child)
            a["is_child_object"] = True
            attachments.append(a)
    except Exception:
        pass

    rating_overall = (node.get("rating") or {}).get("overall") or {}

    # Kontaktdaten (App-DB, opt-in vom Einreicher) — der Caller ist bereits als
    # Moderator verifiziert (_require_moderator macht einen echten
    # my_memberships-Roundtrip), daher hier direkt ausliefern. Moderation
    # braucht den Kontakt für Rückfragen vor der Freigabe. Liegt NICHT in
    # edu-sharing, daher separater App-DB-Lookup über die Knoten-ID.
    contact = None
    try:
        with connect() as con:
            crow = con.execute(
                "SELECT contact FROM idea_contact WHERE idea_id=?", (node_id,)
            ).fetchone()
        if crow and crow["contact"]:
            contact = crow["contact"]
    except Exception:
        pass

    return {
        "id": node_id,
        "title": node.get("title") or _first("cm:title") or node.get("name"),
        "description": _first("cclom:general_description") or _first("cm:description"),
        "author": _first("ccm:author_freetext"),
        "project_url": _first("ccm:wwwurl"),
        "owner_username": owner_display or _first("cm:creator"),
        "contact": contact,
        "phase": phase,
        "events": events,
        "target_topic": target_topic,
        "submitter": submitter,
        "keywords": keywords,
        "preview_url": preview.get("url") if not preview.get("isIcon") else None,
        "attachments": attachments,
        "created_at": node.get("createdAt"),
        "modified_at": node.get("modifiedAt"),
        "rating_avg": float(rating_overall.get("rating") or 0.0) or None,
        "rating_count": int(rating_overall.get("count") or 0) or None,
    }


@router.get("/moderation/sync-diff", tags=["moderation"])
async def sync_diff(authorization: str | None = Header(None)):
    """Dry-Run-Abgleich App-Cache ↔ edu-sharing zum Aufspüren von Sync-
    Problemen. Läuft denselben Sammlungs-Walk wie der Sync (ohne zu schreiben)
    und vergleicht das Ergebnis mit der `idea`-Cache-Tabelle:
      - `missing`: in einer Herausforderung referenziert, aber NICHT im Cache
        (Sync hat sie (noch) nicht erfasst → erscheinen nicht in der App).
      - `stale`: im Cache, aber in KEINER Sammlung mehr referenziert
        (Knoten gelöscht/umgehängt → Karteileiche, Nutzer:innen sehen sie evtl.).
    Nur Mod."""
    await _require_moderator(authorization)
    live: dict[str, dict] = {}
    try:
        themes = await edu_sharing.client.collection_subcollections(
            settings.ideendb_root_collection_id, max_items=100
        )
        for theme in themes.get("collections") or []:
            tid = (theme.get("ref") or {}).get("id")
            if not tid:
                continue
            challenges = await edu_sharing.client.collection_subcollections(tid, max_items=100)
            for ch in challenges.get("collections") or []:
                chid = (ch.get("ref") or {}).get("id")
                if not chid:
                    continue
                ch_props = ch.get("properties") or {}
                ch_title = (
                    ch.get("title") or (ch_props.get("cm:title") or [None])[0] or ch.get("name")
                )
                refs = await edu_sharing.client.collection_references(chid, max_items=200)
                for rn in refs.get("references") or []:
                    rid = (rn.get("ref") or {}).get("id")
                    if not rid:
                        continue
                    rp = rn.get("properties") or {}
                    title = rn.get("title") or (rp.get("cm:title") or [None])[0] or rn.get("name")
                    live[rid] = {"title": title, "challenge": ch_title}
    except httpx.HTTPStatusError as e:
        raise HTTPException(502, f"edu-sharing Fehler: {e.response.status_code}")

    with connect() as con:
        rows = con.execute("SELECT id, title, COALESCE(hidden, 0) AS hidden FROM idea").fetchall()
    cache = {r["id"]: r["title"] for r in rows}
    hidden_ids = {r["id"] for r in rows if r["hidden"]}
    missing = [
        {"id": rid, "title": v["title"], "challenge": v["challenge"]}
        for rid, v in live.items()
        if rid not in cache
    ]
    # `stale`: im Cache, aber nirgends mehr referenziert. Versteckte Ideen
    # landen hier ebenfalls (ihre edu-sharing-Referenz wurde mit-entfernt),
    # sind aber KEIN Sync-Problem — daher als `hidden` markiert und aus der
    # in_sync-Bewertung ausgenommen, damit sie die Mod nicht verwirren.
    stale = [
        {"id": cid, "title": cache[cid], "hidden": cid in hidden_ids}
        for cid in cache
        if cid not in live
    ]
    real_stale = [s for s in stale if not s["hidden"]]
    return {
        "missing": missing,
        "stale": stale,
        "hidden_stale_count": len(stale) - len(real_stale),
        "live_count": len(live),
        "cache_count": len(cache),
        "in_sync": not missing and not real_stale,
    }


@router.delete("/inbox/{node_id}", tags=["moderation"])
async def delete_inbox_item(
    node_id: str,
    authorization: str | None = Header(None),
):
    """Delete a pending inbox submission. Caller muss Moderator sein."""
    await _require_moderator(authorization)
    try:
        result = await edu_sharing.client.delete_node(node_id, auth_header=authorization)
    except httpx.HTTPStatusError as e:
        raise HTTPException(e.response.status_code, f"edu-sharing: {e.response.text[:180]}")
    _log_activity(
        action="inbox_deleted",
        authorization=authorization,
        is_mod=True,
        target_type="idea",
        target_id=node_id,
    )
    return result


@router.post("/ideas/{idea_id}/content", tags=["ideas"])
async def upload_idea_content(
    idea_id: str,
    file: UploadFile = File(...),
    authorization: str | None = Header(None),
):
    """Lädt eine Datei (Anhang oder Hauptinhalt) ans ccm:io der Idee.
    Nur Owner/Mod/angenommene Mitwirkende (App-Gate); zusätzlich prüft
    edu-sharing die Schreibrechte."""
    if not authorization:
        raise HTTPException(401, "Anmeldung erforderlich")
    if not (await _can_edit_idea(idea_id, authorization))[0]:
        raise HTTPException(
            403, "Keine Berechtigung, diese Idee zu bearbeiten (nur Team/Moderation)."
        )
    data = await _read_upload_capped(file, settings.upload_content_max_bytes)
    if not data:
        raise HTTPException(400, "Leere Datei")
    try:
        await edu_sharing.client.upload_content(
            idea_id,
            file_bytes=data,
            filename=file.filename or "upload.bin",
            mimetype=file.content_type or "application/octet-stream",
            auth_header=authorization,
        )
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403):
            raise HTTPException(403, "Keine Berechtigung, hier Inhalte zu speichern.")
        raise HTTPException(e.response.status_code, f"edu-sharing: {e.response.text[:200]}")
    return {"ok": True, "size": len(data), "name": file.filename}


@router.post("/ideas/{idea_id}/preview", tags=["ideas"])
async def upload_idea_preview(
    idea_id: str,
    file: UploadFile = File(...),
    authorization: str | None = Header(None),
):
    """Setzt das Vorschaubild ans ccm:io der Idee (Owner/Mod/Mitwirkende)."""
    if not authorization:
        raise HTTPException(401, "Anmeldung erforderlich")
    if not (await _can_edit_idea(idea_id, authorization))[0]:
        raise HTTPException(
            403, "Keine Berechtigung, diese Idee zu bearbeiten (nur Team/Moderation)."
        )
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(400, "Vorschaubild muss ein Bild sein (image/*).")
    data = await _read_upload_capped(file, settings.upload_image_max_bytes)
    if not data:
        raise HTTPException(400, "Leere Datei")
    try:
        await edu_sharing.client.upload_preview(
            idea_id,
            image_bytes=data,
            filename=file.filename or "preview.png",
            mimetype=file.content_type or "image/png",
            auth_header=authorization,
        )
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403):
            raise HTTPException(403, "Keine Berechtigung, hier ein Vorschaubild zu setzen.")
        raise HTTPException(e.response.status_code, f"edu-sharing: {e.response.text[:200]}")
    # Cache aktualisieren: edu-sharing setzt einen neuen `?modified=`-Param
    # in preview.url. Ohne Refresh würde das Frontend weiter die alte URL
    # (alter Zeitstempel) anfragen und den Browser-Cache treffen.
    try:
        await sync_mod.refresh_idea(idea_id, auth_header=authorization)
    except Exception as e:
        log.debug("upload_idea_preview: Cache-Refresh fehlgeschlagen: %s", e)
    # Falls preview.url im Sync NICHT direkt aufgefrischt wurde (z.B. weil
    # der Knoten als Reference im Postfach liegt), hängen wir manuell einen
    # Cache-Buster an, damit der Browser das neue Bild lädt.
    try:
        with connect() as con:
            row = con.execute(
                "SELECT preview_url FROM idea WHERE id=?",
                (idea_id,),
            ).fetchone()
            if row and row["preview_url"]:
                from datetime import datetime

                bust = int(datetime.now(UTC).timestamp())
                sep = "&" if "?" in row["preview_url"] else "?"
                new_url = f"{row['preview_url']}{sep}cb={bust}"
                # Cache-Buster nur, wenn nicht bereits via Sync gesetzt
                if "modified=" not in row["preview_url"]:
                    con.execute(
                        "UPDATE idea SET preview_url=? WHERE id=?",
                        (new_url, idea_id),
                    )
    except Exception as e:
        log.debug("upload_idea_preview: Cache-Buster fehlgeschlagen: %s", e)
    return {"ok": True}


class MoveRequest(BaseModel):
    node_id: str
    target_topic_id: str


class BulkMoveRequest(BaseModel):
    node_ids: list[str] = Field(..., min_length=1, max_length=50)
    target_topic_id: str


async def _reference_into_collection(
    source_id: str,
    target_topic_id: str,
    *,
    authorization: str,
) -> str:
    """Hängt eine Inbox-Idee als Reference an eine Ziel-Sammlung
    (HackathOERn-Standardvorgehensweise — Original bleibt in der Inbox,
    Sammlung bekommt einen Reference-Knoten). Wirft den ES-HTTPError weiter,
    wenn ES den Reference-Pfad ablehnt — kein stillschweigender Fallback
    auf `_move`, damit Permission-Probleme früh sichtbar werden.

    Idempotent: wenn die Idee bereits in der Ziel-Sammlung referenziert ist,
    wird der bestehende Reference-Knoten zurückgegeben, statt einen 409
    DuplicateNodeName-Fehler an den Caller durchzureichen.

    Returns: die ID des Reference-Knotens (neu oder bereits vorhanden).
    """
    try:
        result = await edu_sharing.client.add_collection_reference(
            collection_id=target_topic_id,
            node_id=source_id,
            auth_header=authorization,
        )
    except httpx.HTTPStatusError as e:
        # 409 = DuplicateNodeName → in der Ziel-Sammlung gibt's schon eine
        # Reference auf diese Idee. Wir suchen sie nach und geben deren ID
        # zurück, damit der Caller einen no-op-Erfolg sieht.
        if e.response.status_code == 409:
            existing = await _find_existing_reference(source_id, target_topic_id, authorization)
            if existing:
                log.info(
                    "addReference: %s war bereits in %s referenziert (no-op)",
                    source_id,
                    target_topic_id,
                )
                return existing
        raise

    ref_node = (result or {}).get("node") or {}
    ref_id = (ref_node.get("ref") or {}).get("id")
    if ref_id:
        try:
            with connect() as con:
                await sync_mod._upsert_idea(
                    con,
                    ref_node,
                    kind="io",
                    topic_id=target_topic_id,
                    main_content_id=ref_id,
                )
        except Exception as e:
            log.warning("upsert nach addReference für %s: %s", ref_id, e)
    return ref_id or source_id


async def _find_existing_reference(
    source_id: str,
    target_topic_id: str,
    authorization: str | None,
) -> str | None:
    """Sucht eine bereits existierende Reference auf `source_id` in der
    Sammlung `target_topic_id`. Wird vom Idempotenz-Pfad von
    `_reference_into_collection` genutzt (siehe 409-Behandlung dort)."""
    try:
        refs = await edu_sharing.client.collection_references(
            target_topic_id,
            max_items=500,
            auth_header=authorization,
        )
    except Exception as e:
        log.warning("collection_references-Lookup fehlgeschlagen: %s", e)
        return None
    for r in refs.get("references") or []:
        props = r.get("properties") or {}
        orig_field = props.get("ccm:original") or props.get("sys:node-uuid")
        if isinstance(orig_field, list) and orig_field:
            orig_field = orig_field[0]
        # Fallback: in den Reference-Eigenschaften steht oft `ccm:original_id`
        if not orig_field:
            orig_field = (
                (props.get("ccm:original_id") or [None])[0]
                if isinstance(props.get("ccm:original_id"), list)
                else props.get("ccm:original_id")
            )
        # Manche ES-Versionen liefern `originalId` direkt auf Top-Level
        if not orig_field:
            orig_field = r.get("originalId")
        if orig_field and str(orig_field) == source_id:
            return (r.get("ref") or {}).get("id")
    return None


class ChangeTopicRequest(BaseModel):
    new_topic_id: str


@router.post("/moderation/ideas/{idea_id}/change-topic", tags=["moderation"])
async def change_idea_topic(
    idea_id: str,
    body: ChangeTopicRequest,
    authorization: str | None = Header(None),
):
    """Wechselt die Herausforderung einer Idee. Praktisch: löscht die alte
    Reference und legt eine neue im Ziel-Topic an. Original bleibt in der
    Community-Inbox unangetastet.

    Idempotent: ist die Idee bereits im Ziel-Topic, passiert nichts.
    Nur Moderatoren — Herausforderungs-Zuordnung ist redaktioneller Akt.
    """
    await _require_moderator(authorization)
    with connect() as con:
        row = con.execute(
            "SELECT id, original_id, topic_id, title FROM idea WHERE id = ?",
            (idea_id,),
        ).fetchone()
        target = con.execute(
            "SELECT id, title FROM topic WHERE id = ?",
            (body.new_topic_id,),
        ).fetchone()
    if not row:
        raise HTTPException(404, "Idee nicht im Cache — unbekannte ID")
    if not target:
        raise HTTPException(404, f"Ziel-Herausforderung {body.new_topic_id} nicht gefunden")

    current_topic = row["topic_id"]
    if current_topic == body.new_topic_id:
        return {
            "ok": True,
            "message": "Idee ist bereits in dieser Herausforderung",
            "result_id": idea_id,
            "no_op": True,
        }

    # `original_id` zeigt auf den Inbox-Knoten. Falls die Row selbst das
    # Original ist (z.B. neu eingereicht, noch nirgends referenziert),
    # nehmen wir die Row-ID als Source.
    source_id = row["original_id"] or row["id"]

    # 1. Neue Reference im Ziel-Topic
    try:
        new_ref_id = await _reference_into_collection(
            source_id,
            body.new_topic_id,
            authorization=authorization,
        )
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            e.response.status_code,
            f"edu-sharing: {e.response.text[:200]}",
        )

    # 2. Alte Reference löschen — aber nur wenn die App-Row tatsächlich eine
    #    Reference war (original_id gesetzt). Sonst (Original direkt unter
    #    altem Topic) würden wir den Inhalt verlieren.
    deleted_old = False
    if row["original_id"] and row["id"] != new_ref_id:
        try:
            await edu_sharing.client.delete_collection_reference(
                row["id"],
                auth_header=authorization,
            )
            with connect() as con:
                con.execute("DELETE FROM idea WHERE id = ?", (row["id"],))
                con.execute("DELETE FROM idea_fts WHERE id = ?", (row["id"],))
            deleted_old = True
        except Exception as e:
            log.warning("change-topic: alte Reference %s nicht gelöscht: %s", row["id"], e)

    _log_activity(
        action="idea_topic_changed",
        authorization=authorization,
        is_mod=True,
        target_type="idea",
        target_id=idea_id,
        target_label=row["title"],
        detail={
            "from_topic_id": current_topic,
            "to_topic_id": body.new_topic_id,
            "to_topic_title": target["title"],
            "new_ref_id": new_ref_id,
            "old_ref_deleted": deleted_old,
        },
    )
    return {
        "ok": True,
        "moved_to": target["title"],
        "result_id": new_ref_id,
        "old_ref_deleted": deleted_old,
    }


@router.post("/moderation/bulk_move", tags=["moderation"])
async def bulk_move_to_topic(
    body: BulkMoveRequest,
    authorization: str | None = Header(None),
):
    """Referenziert mehrere Inbox-Ideen in eine Ziel-Herausforderung.
    Pro-Item-Fehler werden gesammelt; der Gesamtaufruf bricht nicht ab.
    """
    await _require_moderator(authorization)
    with connect() as con:
        t = con.execute(
            "SELECT id,title FROM topic WHERE id = ?", (body.target_topic_id,)
        ).fetchone()
    if not t:
        raise HTTPException(404, f"Unknown target topic {body.target_topic_id}")

    succeeded: list[str] = []
    failed: list[dict] = []
    for nid in body.node_ids:
        try:
            new_id = await _reference_into_collection(
                nid,
                body.target_topic_id,
                authorization=authorization,
            )
        except httpx.HTTPStatusError as e:
            failed.append(
                {"id": nid, "status": e.response.status_code, "detail": e.response.text[:160]}
            )
            continue
        except Exception as e:
            failed.append({"id": nid, "status": 0, "detail": str(e)[:160]})
            continue
        # Titel für Log (aus Cache nach Upsert)
        with connect() as con:
            r = con.execute(
                "SELECT title FROM idea WHERE id=? OR original_id=?",
                (new_id, nid),
            ).fetchone()
            moved_title = r["title"] if r else None
        _log_activity(
            action="idea_moved",
            authorization=authorization,
            is_mod=True,
            target_type="idea",
            target_id=nid,
            target_label=moved_title,
            detail={
                "to_topic_id": body.target_topic_id,
                "to_topic_title": t["title"],
                "result_id": new_id,
                "bulk": True,
            },
        )
        succeeded.append(nid)

    return {
        "ok": len(failed) == 0,
        "moved_to": t["title"],
        "succeeded": succeeded,
        "failed": failed,
        "succeeded_count": len(succeeded),
        "failed_count": len(failed),
    }


@router.post("/moderation/move", tags=["moderation"])
async def move_to_topic(
    body: MoveRequest,
    authorization: str | None = Header(None),
):
    """Referenziert eine Inbox-Idee in eine Herausforderung. Caller muss
    Moderator sein. Original bleibt in der Inbox — die Sammlung bekommt
    einen Reference-Knoten dazu (HackathOERn-Standard).
    Der Endpoint heißt aus historischen Gründen weiterhin /move."""
    await _require_moderator(authorization)
    with connect() as con:
        t = con.execute(
            "SELECT id,title FROM topic WHERE id = ?", (body.target_topic_id,)
        ).fetchone()
    if not t:
        raise HTTPException(404, f"Unknown target topic {body.target_topic_id}")

    try:
        new_id = await _reference_into_collection(
            body.node_id,
            body.target_topic_id,
            authorization=authorization,
        )
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            e.response.status_code,
            f"edu-sharing: {e.response.text[:200]}",
        )

    # Titel für Log
    moved_title = None
    with connect() as con:
        r = con.execute(
            "SELECT title FROM idea WHERE id=? OR original_id=?",
            (new_id, body.node_id),
        ).fetchone()
        moved_title = r["title"] if r else None
    _log_activity(
        action="idea_moved",
        authorization=authorization,
        is_mod=True,
        target_type="idea",
        target_id=body.node_id,
        target_label=moved_title,
        detail={
            "to_topic_id": body.target_topic_id,
            "to_topic_title": t["title"],
            "result_id": new_id,
        },
    )

    return {"ok": True, "moved_to": t["title"], "result_id": new_id}


# Selbstregistrierung läuft extern über https://wirlernenonline.de/register/.
# Der edu-sharing /register/v1/register-Endpoint auf redaktion.openeduhub.net
# läuft deterministisch in einen 50s-Server-Disconnect (synchroner Mail-Hook
# hängt). Das WordPress-Plugin auf wirlernenonline.de umgeht das mit eigenem
# Service-Pfad. Bis das server-seitig gefixt ist, leitet das Frontend direkt
# auf das WLO-Formular weiter.


# ===== Taxonomie: Phasen + Veranstaltungen =====================
# Wird im Submit-Form als Dropdown angeboten und ans `cclom:general_keyword`
# als `phase:<slug>` bzw. `event:<slug>` angehängt.


class TaxonomyEntry(BaseModel):
    slug: str = Field(..., min_length=2, max_length=80, pattern=r"^[a-z0-9][a-z0-9\-]*$")
    label: str = Field(..., min_length=2, max_length=120)
    description: str | None = None
    sort_order: int = 100
    active: bool = True


class EventEntry(TaxonomyEntry):
    """Erweitert TaxonomyEntry um Event-spezifische Lifecycle-Felder."""

    # Lifecycle: draft (Mod sichtbar, Submitter nicht), live (Default),
    # archived (abgelaufen — taucht im UI ausgegraut auf).
    status: Literal["draft", "live", "archived"] = "live"
    # ISO-Zeitstempel; bis dahin im Featured-Slot auf der Startseite.
    featured_until: str | None = None
    # Pro-Event-Override des Bewertungssystems. None/"" = globalen Modus
    # erben. Sonst 'stars' | 'thumbs'.
    voting_mode: Literal["stars", "thumbs", ""] | None = None
    # Bewertungsphase: True = offen (bewertbar), False = gestoppt (z.B.
    # Einreichungsphase). Greift nur, wenn global Bewertungen aktiv sind.
    rating_open: bool = True
    # Optionale Zusatzinfos fürs Promotion-Banner auf der Startseite.
    # Ort, Zeitraum (von–bis, freies Datumsformat/ISO) und Detail-URL.
    location: str | None = Field(default=None, max_length=200)
    date_start: str | None = Field(default=None, max_length=40)
    date_end: str | None = Field(default=None, max_length=40)
    detail_url: str | None = Field(default=None, max_length=500)


def _list_taxonomy(table: str) -> list[dict]:
    """Schlanke Variante für Phases — ohne Event-spezifische Felder."""
    with connect() as con:
        rows = con.execute(
            f"SELECT slug,label,description,sort_order,active,created_at,created_by "
            f"FROM {table} ORDER BY sort_order, label"
        ).fetchall()
    return [{**dict(r), "active": bool(r["active"])} for r in rows]


def _list_events(include_drafts: bool = False, include_archived: bool = False) -> list[dict]:
    """Event-Listing mit status + featured_until. include_drafts/archived
    sind Mod-Optionen; Default-Anzeige zeigt nur `live`-Events."""
    with connect() as con:
        rows = con.execute(
            "SELECT slug,label,description,sort_order,active,status,"
            "featured_until,voting_mode,rating_open,location,date_start,date_end,detail_url,"
            "created_at,created_by "
            "FROM taxonomy_event ORDER BY sort_order, label"
        ).fetchall()
    items: list[dict] = []
    for r in rows:
        d = {**dict(r), "active": bool(r["active"])}
        d["rating_open"] = bool(r["rating_open"])
        status = d.get("status") or "live"
        d["status"] = status
        if status == "draft" and not include_drafts:
            continue
        if status == "archived" and not include_archived:
            continue
        items.append(d)
    return items


@router.get("/phases", tags=["taxonomy"])
def list_phases(only_active: bool = True):
    items = _list_taxonomy("taxonomy_phase")
    return [i for i in items if i["active"]] if only_active else items


@router.get("/events", tags=["taxonomy"])
async def list_events(
    only_active: bool = True,
    include_drafts: bool = False,
    include_archived: bool = True,
    authorization: str | None = Header(None),
):
    """Default-Sicht: live + archived (Übersicht zeigt auch alte Events,
    Submit-Form filtert clientseitig auf nur live). Drafts nur, wenn der
    Aufrufer Mod ist und das Flag explizit setzt."""
    # Entwürfe (unveröffentlichte Events) nur für Mods — sonst leakt
    # unveröffentlichte Event-Taxonomie (Label, Termine, Ort, Detail-URL) an
    # beliebige Aufrufer. Der ES-Roundtrip läuft nur, wenn Drafts angefragt sind.
    if include_drafts and not await _is_moderator(authorization):
        include_drafts = False
    items = _list_events(
        include_drafts=include_drafts,
        include_archived=include_archived,
    )
    if only_active:
        items = [i for i in items if i["active"]]
    return items


@router.get("/events/featured", tags=["taxonomy"])
def featured_event():
    """Liefert ALLE aktuell für die Startseite hervorgehobenen Events.

    Auswahl: status='live', featured_until in der Zukunft. Sortiert nach
    der Endzeit aufsteigend (das am ehesten auslaufende zuerst). Pro Event
    wird der Idee-Zähler mitgegeben, damit das Frontend keinen zweiten
    Roundtrip braucht.

    Rückgabe ist eine LISTE — das Frontend stapelt mehrere Featured-Events
    untereinander. Leere Liste, wenn keins featured ist.
    """
    now_iso = datetime.now(UTC).isoformat()
    out: list[dict] = []
    with connect() as con:
        rows = con.execute(
            "SELECT slug,label,description,sort_order,featured_until,status,"
            "location,date_start,date_end,detail_url "
            "FROM taxonomy_event "
            "WHERE status='live' AND active=1 "
            "  AND featured_until IS NOT NULL AND featured_until > ? "
            "ORDER BY featured_until ASC",
            (now_iso,),
        ).fetchall()
        for row in rows:
            ev = {**dict(row), "active": True}
            # Event-Zugehörigkeit liegt in der JSON-Spalte `events` als
            # blanker Slug (z.B. "hackathoern-3") — NICHT als `event:`-Keyword
            # und NICHT in der `keywords`-Spalte. Gleiches LIKE-Muster wie
            # der Listen-Filter (siehe list_ideas, i.events LIKE '%"slug"%').
            ev["idea_count"] = con.execute(
                "SELECT COUNT(*) FROM idea WHERE COALESCE(hidden,0)=0 AND events LIKE ?",
                (f'%"{row["slug"]}"%',),
            ).fetchone()[0]
            out.append(ev)
    return out


def _upsert_taxonomy(table: str, body: TaxonomyEntry, user: str | None) -> dict:
    with connect() as con:
        existing = con.execute(f"SELECT slug FROM {table} WHERE slug=?", (body.slug,)).fetchone()
        if existing:
            con.execute(
                f"UPDATE {table} SET label=?, description=?, sort_order=?, active=? WHERE slug=?",
                (body.label, body.description, body.sort_order, 1 if body.active else 0, body.slug),
            )
        else:
            from datetime import datetime

            con.execute(
                f"INSERT INTO {table} (slug,label,description,sort_order,active,"
                f"created_at,created_by) VALUES (?,?,?,?,?,?,?)",
                (
                    body.slug,
                    body.label,
                    body.description,
                    body.sort_order,
                    1 if body.active else 0,
                    datetime.now(UTC).isoformat(),
                    user or "anonymous",
                ),
            )
    return {"ok": True, "slug": body.slug}


def _upsert_event(body: EventEntry, user: str | None) -> dict:
    """Upsert mit Event-spezifischen Feldern (Status + Featured + Voting-Modus)."""
    # Leerstring → NULL (= globalen Modus erben).
    vmode = body.voting_mode or None
    with connect() as con:
        existing = con.execute(
            "SELECT slug FROM taxonomy_event WHERE slug=?", (body.slug,)
        ).fetchone()
        # Leere Strings der optionalen Banner-Felder zu NULL normalisieren.
        location = (body.location or "").strip() or None
        date_start = (body.date_start or "").strip() or None
        date_end = (body.date_end or "").strip() or None
        # http(s)-only — blockt javascript:/data: im später als Link gerenderten
        # Featured-Banner (analog project_url/website).
        detail_url = _validate_external_url(body.detail_url, field="Detail-URL")
        if existing:
            con.execute(
                "UPDATE taxonomy_event SET label=?, description=?, sort_order=?, "
                "active=?, status=?, featured_until=?, voting_mode=?, rating_open=?, "
                "location=?, date_start=?, date_end=?, detail_url=? WHERE slug=?",
                (
                    body.label,
                    body.description,
                    body.sort_order,
                    1 if body.active else 0,
                    body.status,
                    body.featured_until,
                    vmode,
                    1 if body.rating_open else 0,
                    location,
                    date_start,
                    date_end,
                    detail_url,
                    body.slug,
                ),
            )
        else:
            con.execute(
                "INSERT INTO taxonomy_event "
                "(slug,label,description,sort_order,active,status,featured_until,"
                "voting_mode,rating_open,location,date_start,date_end,detail_url,"
                "created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    body.slug,
                    body.label,
                    body.description,
                    body.sort_order,
                    1 if body.active else 0,
                    body.status,
                    body.featured_until,
                    vmode,
                    1 if body.rating_open else 0,
                    location,
                    date_start,
                    date_end,
                    detail_url,
                    datetime.now(UTC).isoformat(),
                    user or "anonymous",
                ),
            )
    return {"ok": True, "slug": body.slug}


@router.put("/admin/events/{slug}", tags=["taxonomy"])
async def upsert_event(slug: str, body: EventEntry, authorization: str | None = Header(None)):
    user = await _require_moderator(authorization)
    if slug != body.slug:
        raise HTTPException(400, "URL-Slug und Body-Slug stimmen nicht überein")
    res = _upsert_event(body, user)
    _log_activity(
        action="taxonomy_event_changed",
        authorization=authorization,
        is_mod=True,
        target_type="taxonomy",
        target_id=slug,
        target_label=body.label,
        detail={
            "active": body.active,
            "sort_order": body.sort_order,
            "status": body.status,
            "featured_until": body.featured_until,
        },
    )
    return res


async def _purge_tag_from_ideas(kind: str, slug: str, auth: str | None) -> dict:
    """Entfernt das `phase:<slug>` bzw. `event:<slug>` Keyword von ALLEN
    betroffenen Ideen-Knoten in edu-sharing und räumt den Cache nach. Wird
    beim Löschen einer Phase/Veranstaltung aufgerufen, damit keine verwaisten
    Tags an Ideen zurückbleiben (die sonst beim nächsten Sync wiederkämen).
    Best-effort: Fehler pro Knoten werden gezählt, brechen den Lauf nicht ab."""
    # Slug defensiv prüfen (kommt als ungeprüfter Pfad-Param) → kein LIKE-
    # Over-Match, kein unsinniger Massen-Walk.
    if not re.fullmatch(r"[a-z0-9][a-z0-9\-]*", slug or ""):
        return {"removed": 0, "failed": 0, "total": 0}
    tag = f"{kind}:{slug}".strip().lower()
    # edu-sharing-Knoten tragen teils Legacy-Slugs (z.B. `event:hackthoern-01`),
    # die wir beim Sync auf den kanonischen Slug normalisieren (EVENT_SLUG_ALIASES).
    # Beim Entfernen müssen daher AUCH die Alias-Varianten gestrippt werden —
    # sonst bleibt das rohe Keyword am Knoten und der Event taucht beim nächsten
    # Sync wieder auf (Cache wird geleert, ES nicht → "Wiederauferstehung").
    remove_literals = {tag}
    if kind == "event":
        remove_literals |= {
            f"event:{raw}".lower()
            for raw, canon in sync_mod.EVENT_SLUG_ALIASES.items()
            if canon == slug
        }
    PURGE_MAX = 5000  # Sicherheits-Obergrenze gegen unbeabsichtigte Riesen-Walks
    with connect() as con:
        if kind == "phase":
            rows = con.execute(
                "SELECT id FROM idea WHERE phase = ? LIMIT ?", (slug, PURGE_MAX)
            ).fetchall()
        else:
            rows = con.execute(
                "SELECT id FROM idea WHERE events LIKE ? ESCAPE '\\' LIMIT ?",
                (f'%"{_escape_like(slug)}"%', PURGE_MAX),
            ).fetchall()
    ids = [r["id"] for r in rows]
    removed = 0
    failed = 0
    for nid in ids:
        try:
            meta = await edu_sharing.client.node_metadata(nid, auth_header=auth)
            props = (meta.get("node") or {}).get("properties") or {}
            kws = list(props.get("cclom:general_keyword") or [])
            new_kws = [k for k in kws if str(k).strip().lower() not in remove_literals]
            if len(new_kws) != len(kws):
                await edu_sharing.client.update_metadata(
                    nid, {"cclom:general_keyword": new_kws}, auth_header=auth
                )
            with connect() as con:
                if kind == "phase":
                    con.execute("UPDATE idea SET phase = NULL WHERE id = ?", (nid,))
                else:
                    row = con.execute("SELECT events FROM idea WHERE id = ?", (nid,)).fetchone()
                    try:
                        evs = [e for e in json.loads(row["events"] or "[]") if e != slug]
                    except Exception:
                        evs = []
                    con.execute(
                        "UPDATE idea SET events = ? WHERE id = ?",
                        (json.dumps(evs), nid),
                    )
            removed += 1
        except Exception as e:  # noqa: BLE001 — best-effort, einzelne Knoten dürfen scheitern
            log.warning("purge tag %s from %s failed: %s", tag, nid, e)
            failed += 1
    return {"removed": removed, "failed": failed, "total": len(ids)}


@router.get("/admin/taxonomy-usage", tags=["taxonomy"])
async def taxonomy_usage(authorization: str | None = Header(None)):
    """Wie viele Ideen tragen aktuell welche Phase / Veranstaltung? Für die
    Lösch-Warnung und die Nutzungs-Anzeige im Mod-Bereich. Nur Mod."""
    await _require_moderator(authorization)
    with connect() as con:
        prows = con.execute(
            "SELECT phase AS slug, COUNT(*) AS n FROM idea "
            "WHERE phase IS NOT NULL AND phase <> '' GROUP BY phase"
        ).fetchall()
        erows = con.execute(
            "SELECT events FROM idea WHERE events IS NOT NULL AND events NOT IN ('', '[]')"
        ).fetchall()
    phases = {r["slug"]: r["n"] for r in prows}
    events: dict[str, int] = {}
    for r in erows:
        try:
            for ev in json.loads(r["events"] or "[]"):
                events[ev] = events.get(ev, 0) + 1
        except Exception:
            pass
    return {"phases": phases, "events": events}


@router.delete("/admin/events/{slug}", tags=["taxonomy"])
async def delete_event(slug: str, authorization: str | None = Header(None)):
    await _require_moderator(authorization)
    # Erst die event:<slug>-Tags von allen Ideen entfernen, dann die Taxonomie.
    purge = await _purge_tag_from_ideas("event", slug, authorization)
    # Taxonomie nur entfernen, wenn ALLE Tags weg sind — sonst bliebe ein
    # verwaister Tag ohne Label hängen; bei Teil-Fehler Eintrag behalten,
    # damit die Mod erneut löschen kann.
    if purge["failed"] == 0:
        with connect() as con:
            con.execute("DELETE FROM taxonomy_event WHERE slug=?", (slug,))
    _log_activity(
        action="taxonomy_event_deleted",
        authorization=authorization,
        is_mod=True,
        target_type="taxonomy",
        target_id=slug,
        detail={"untagged": purge["removed"], "failed": purge["failed"]},
    )
    return {"ok": purge["failed"] == 0, **purge}


@router.put("/admin/phases/{slug}", tags=["taxonomy"])
async def upsert_phase(slug: str, body: TaxonomyEntry, authorization: str | None = Header(None)):
    user = await _require_moderator(authorization)
    if slug != body.slug:
        raise HTTPException(400, "URL-Slug und Body-Slug stimmen nicht überein")
    res = _upsert_taxonomy("taxonomy_phase", body, user)
    _log_activity(
        action="taxonomy_phase_changed",
        authorization=authorization,
        is_mod=True,
        target_type="taxonomy",
        target_id=slug,
        target_label=body.label,
        detail={"active": body.active, "sort_order": body.sort_order},
    )
    return res


@router.delete("/admin/phases/{slug}", tags=["taxonomy"])
async def delete_phase(slug: str, authorization: str | None = Header(None)):
    await _require_moderator(authorization)
    # Erst die phase:<slug>-Tags von allen Ideen entfernen, dann die Taxonomie.
    purge = await _purge_tag_from_ideas("phase", slug, authorization)
    # Taxonomie nur entfernen, wenn ALLE Tags weg sind (s. delete_event).
    if purge["failed"] == 0:
        with connect() as con:
            con.execute("DELETE FROM taxonomy_phase WHERE slug=?", (slug,))
    _log_activity(
        action="taxonomy_phase_deleted",
        authorization=authorization,
        is_mod=True,
        target_type="taxonomy",
        target_id=slug,
        detail={"untagged": purge["removed"], "failed": purge["failed"]},
    )
    return {"ok": purge["failed"] == 0, **purge}


# ===== Idee bearbeiten =========================================
class IdeaPatch(BaseModel):
    title: str | None = None
    description: str | None = None
    author: str | None = None
    project_url: str | None = None
    keywords: list[str] | None = None
    phase: str | None = None
    event: str | None = None  # legacy single-event
    events: list[str] | None = None  # mehrere Veranstaltungen — überschreibt komplett


@router.patch("/ideas/{idea_id}", tags=["ideas"])
async def edit_idea(
    idea_id: str,
    body: IdeaPatch,
    authorization: str | None = Header(None),
):
    """Updates the metadata on the underlying ccm:io. App-seitig wird
    geprüft, ob der Caller Owner (Submitter) oder Mod ist — die ES-
    Group-Vererbung gibt sonst jedem HackathOERn-Mitglied Write-Rechte."""
    if not authorization:
        raise HTTPException(401, "Anmeldung erforderlich")

    allowed, user, is_owner_or_mod = await _can_edit_idea(idea_id, authorization)
    if not allowed:
        raise HTTPException(
            403,
            "Diese Idee gehört nicht dir. Nur Einreicher:in, angenommene "
            "Mitwirkende oder die Moderation können sie bearbeiten.",
        )

    # Mitwirkende (angenommene Mithackende, nicht Owner/Mod) dürfen Inhalt
    # bearbeiten, aber NICHT die Kuration: Phase + Veranstaltung bleiben dem
    # Owner/Mod vorbehalten. Bestehende phase:/event:-Keywords werden in die
    # Keyword-Liste zurückgemischt, damit sie nicht verloren gehen.
    if not is_owner_or_mod:
        body.phase = None
        body.event = None
        body.events = None
        if body.keywords is not None:
            try:
                _m = await edu_sharing.client.node_metadata(idea_id, auth_header=authorization)
                _kw = ((_m.get("node") or {}).get("properties") or {}).get(
                    "cclom:general_keyword"
                ) or []
                if isinstance(_kw, str):
                    _kw = [_kw]
                body.keywords = list(body.keywords) + [
                    k for k in _kw if str(k).lower().startswith(("phase:", "event:"))
                ]
            except Exception:
                pass

    with connect() as con:
        row = con.execute(
            "SELECT main_content_id, kind, phase FROM idea WHERE id=?", (idea_id,)
        ).fetchone()

    # Fallback wenn der Cache den Node noch nicht kennt (z.B. unmittelbar
    # nach einem POST /ideas vor dem nächsten Sync): direkt am Node editieren.
    if not row:
        target_node = idea_id
        current_phase: str | None = None
    else:
        target_node = (
            row["main_content_id"]
            if row["kind"] == "collection" and row["main_content_id"]
            else idea_id
        )
        current_phase = row["phase"]

    # Phase-Status-Workflow (Variante A): Owner darf nur eine Stufe vorwärts,
    # Mod darf alles. Der Workflow-Check läuft *bevor* ES kontaktiert wird.
    if body.phase is not None and body.phase != current_phase:
        is_mod = await _is_moderator(authorization)
        with connect() as con:
            order = _phase_order(con)
        ok, reason = _is_allowed_phase_transition(
            current=current_phase,
            target=body.phase,
            is_mod=is_mod,
            order=order,
        )
        if not ok:
            raise HTTPException(403, reason or "Phase-Wechsel nicht erlaubt.")

    # Build the property update — only fields that were sent are merged in.
    props: dict[str, list[str]] = {}
    if body.title is not None:
        props["cm:title"] = [body.title]
        props["cclom:title"] = [body.title]
    if body.description is not None:
        props["cclom:general_description"] = [body.description]
        props["cm:description"] = [body.description]
    if body.author is not None:
        props["ccm:author_freetext"] = [body.author]
    if body.project_url is not None:
        # Leerstring = explizites Entfernen, ansonsten http(s)-validieren.
        if body.project_url.strip() == "":
            props["ccm:wwwurl"] = []
        else:
            props["ccm:wwwurl"] = [_validate_external_url(body.project_url, field="Projekt-URL")]
    # Keywords-Merge: bestehende Keywords aus edu-sharing erhalten,
    # nur phase: und event: gezielt austauschen.
    #
    # Wichtig: edu-sharing's PUT /metadata ÜBERSCHREIBT cclom:general_keyword
    # komplett — wir müssen also die alten Keywords mit-senden, damit z.B.
    # fachliche Tags ("OER", "schule") nicht beim Quick-Edit verloren gehen.
    #
    # Strategie:
    #  - body.keywords explizit mitgeschickt (Edit-Modal): das ist die neue
    #    User-Liste. Wir filtern phase:/event: heraus und tauschen frisch.
    #  - body.keywords NICHT mitgeschickt (Quick-Edit): wir holen die alten
    #    Keywords live aus edu-sharing, behalten alle Nicht-phase/event-Werte
    #    und überschreiben nur phase:/event:-Einträge.
    if (
        body.keywords is not None
        or body.phase is not None
        or body.event is not None
        or body.events is not None
    ):
        if body.keywords is not None:
            base_kws = list(body.keywords)
        else:
            # Quick-Edit: alte Liste live holen, damit Bestand erhalten bleibt
            try:
                cur_meta = await edu_sharing.client.node_metadata(
                    target_node,
                    auth_header=authorization,
                )
                cur_props = (cur_meta.get("node") or {}).get("properties") or {}
                base_kws = list(cur_props.get("cclom:general_keyword") or [])
            except Exception as e:
                log.warning(
                    "edit_idea: alte Keywords nicht lesbar, Bestand könnte verloren gehen: %s",
                    e,
                )
                base_kws = []

        # phase:- und event:-Einträge entfernen, die wir gleich neu setzen
        kws = [k for k in base_kws if not k.lower().startswith(("phase:", "event:"))]
        if body.phase:
            kws.append(f"phase:{body.phase}")
        # Events: events[] hat Vorrang, sonst legacy event-Feld.
        # Wenn weder events noch event mit-geschickt wurden, bleiben die
        # alten Event-Keywords aus base_kws erhalten — wir müssen sie also
        # zurück-mergen, sonst gehen sie verloren beim Phase-Quick-Edit.
        if body.events is not None or body.event is not None:
            evs = body.events if body.events is not None else ([body.event] if body.event else [])
            seen: set[str] = set()
            for ev in evs:
                ev = (ev or "").strip()
                if not ev or ev.lower() in seen:
                    continue
                seen.add(ev.lower())
                kws.append(f"event:{ev}")
        else:
            # Alte event:-Einträge behalten
            for k in base_kws:
                if k.lower().startswith("event:"):
                    kws.append(k)

        # Wenn keine Phase im Patch war, alten Phase-Wert behalten
        if body.phase is None:
            for k in base_kws:
                if k.lower().startswith("phase:"):
                    kws.append(k)
                    break

        props["cclom:general_keyword"] = kws

    if not props:
        raise HTTPException(400, "Keine Felder zum Aktualisieren angegeben")

    try:
        await edu_sharing.client.update_metadata(target_node, props, auth_header=authorization)
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403):
            raise HTTPException(403, "Du hast keine Berechtigung, diese Idee zu bearbeiten.")
        raise HTTPException(e.response.status_code, f"edu-sharing: {e.response.text[:200]}")

    # Read-Back: edu-sharing antwortet bei fehlenden Schreibrechten
    # gelegentlich mit 200 OK, persistiert die Änderungen aber stillschweigend
    # NICHT (silent permission denial). Wir prüfen daher kurz, ob die
    # Properties wirklich angekommen sind. Wenn nicht: harten 403 mit
    # klarer Meldung an den User.
    try:
        verify = await edu_sharing.client.node_metadata(
            target_node,
            auth_header=authorization,
        )
        live_props = (verify.get("node") or {}).get("properties") or {}
        # Wir prüfen exemplarisch das aussagekräftigste Feld, das die UI ändert:
        if "cclom:general_keyword" in props:
            expected = set(props["cclom:general_keyword"])
            actual = set(live_props.get("cclom:general_keyword") or [])
            if expected and not expected.issubset(actual):
                log.warning(
                    "edit_idea: Properties nicht persistiert für %s "
                    "(Permission?): expected %s, got %s",
                    idea_id,
                    expected,
                    actual,
                )
                raise HTTPException(
                    403,
                    "Du hast keine Schreibrechte für diese Idee. "
                    "Sie gehört einer anderen Person und kann nur von "
                    "ihr oder einem Moderator bearbeitet werden.",
                )
        elif "cm:title" in props and body.title:
            if (live_props.get("cm:title") or [None])[0] != body.title:
                log.warning(
                    "edit_idea: Title nicht persistiert für %s — Permission?",
                    idea_id,
                )
                raise HTTPException(
                    403,
                    "Du hast keine Schreibrechte für diese Idee.",
                )
    except HTTPException:
        raise
    except Exception as e:
        # Read-Back kaputt → nicht blockieren, der Sync zieht später nach
        log.info("edit_idea: Read-Back fehlgeschlagen, trotzdem OK: %s", e)

    # Single-Node-Refresh statt Voll-Sync: nur diese eine Idee neu cachen.
    try:
        await sync_mod.refresh_idea(idea_id, auth_header=authorization)
    except Exception:
        pass
    _log_activity(
        action="idea_edited",
        authorization=authorization,
        target_type="idea",
        target_id=idea_id,
        target_label=body.title,
        detail={
            k: v
            for k, v in body.model_dump(exclude_none=True).items()
            if k in {"title", "phase", "event", "events"}
        },
    )
    # Separater Phase-Wechsel-Eintrag mit Old/New, falls Phase wirklich gewechselt
    if body.phase is not None and body.phase != current_phase:
        _log_activity(
            action="phase_changed",
            authorization=authorization,
            target_type="idea",
            target_id=idea_id,
            target_label=body.title,
            detail={"from": current_phase, "to": body.phase},
        )
    return {"ok": True, "node_id": target_node}


@router.delete("/ideas/{idea_id}", tags=["ideas"])
async def delete_idea(
    idea_id: str,
    authorization: str | None = Header(None),
):
    """Löscht eine Idee. App-seitig wird geprüft, ob der Caller Owner
    (Submitter) oder Mod ist (ES-Group-Vererbung würde sonst jedem
    HackathOERn-Mitglied Delete-Rechte geben)."""
    if not authorization:
        raise HTTPException(401, "Anmeldung erforderlich")

    allowed, user, is_mod = await _is_owner_or_mod(idea_id, authorization)
    if not allowed:
        raise HTTPException(
            403,
            "Diese Idee gehört nicht dir. Nur der Einreicher oder die Moderation kann sie löschen.",
        )

    try:
        await edu_sharing.client.delete_node(idea_id, auth_header=authorization)
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403):
            raise HTTPException(403, "Keine Berechtigung, diese Idee zu löschen.")
        if e.response.status_code == 404:
            # Schon weg — Cache nachziehen, dem Caller OK zurückgeben.
            pass
        else:
            raise HTTPException(e.response.status_code, f"edu-sharing: {e.response.text[:200]}")

    # Cache aufräumen + Titel für Log retten BEVOR wir löschen
    deleted_title: str | None = None
    with connect() as con:
        row = con.execute("SELECT title FROM idea WHERE id = ?", (idea_id,)).fetchone()
        deleted_title = row["title"] if row else None
        con.execute("DELETE FROM idea WHERE id = ?", (idea_id,))
        con.execute("DELETE FROM idea_fts WHERE id = ?", (idea_id,))
        con.execute("DELETE FROM idea_interaction WHERE idea_id = ?", (idea_id,))
        # Nebendaten der Idee mit aufräumen (sonst Waisen): Verfalls-Ledger,
        # gespeicherter Kontakt, Meldungen.
        con.execute("DELETE FROM vote_event WHERE idea_id = ?", (idea_id,))
        con.execute("DELETE FROM idea_contact WHERE idea_id = ?", (idea_id,))
        con.execute("DELETE FROM idea_report WHERE idea_id = ?", (idea_id,))
    _log_activity(
        action="idea_deleted",
        authorization=authorization,
        target_type="idea",
        target_id=idea_id,
        target_label=deleted_title,
    )
    return {"ok": True}


# =====================================================================
# Anhänge an Ideen — Serienobjekte (`ccm:io_childobject`).
#
# Statt einer Geschwister-Sammlung legen wir das Anhang-IO direkt UNTER
# die Idee als Child. Vorteile:
#   - keine separate Sammlungs-Schreibrechte nötig (Owner der Idee reicht)
#   - native Eltern-Kind-Beziehung über `ccm:childio`-Assoziation
#   - kein Hilfs-Keyword `attachment-of:<id>` mehr
#   - Children werden bei Idee-Löschung automatisch mit-gelöscht
# Siehe Skill `wlo-childobjects` für API-Details.
# =====================================================================


class AttachmentRename(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)


async def _verify_child_of(
    *,
    child_id: str,
    parent_id: str,
    authorization: str,
) -> dict:
    """Sicherheits-Check: das Child muss tatsächlich unter dem angegebenen
    Eltern-IO hängen. Verhindert versehentliche Operationen auf fremden
    Knoten. Gibt die Node-Metadaten zurück (für nachfolgenden Code reusable)."""
    try:
        meta = await edu_sharing.client.node_metadata(
            child_id,
            auth_header=authorization,
        )
    except httpx.HTTPStatusError as e:
        raise HTTPException(e.response.status_code, f"edu-sharing: {e.response.text[:200]}")
    parent = (meta.get("node") or {}).get("parent") or {}
    actual_parent = parent.get("id") or (parent.get("ref") or {}).get("id")
    if actual_parent != parent_id:
        raise HTTPException(
            409,
            "Dieser Anhang gehört nicht zu dieser Idee. Aus Sicherheitsgründen abgelehnt.",
        )
    return meta


@router.patch("/ideas/{idea_id}/attachments/{attachment_id}", tags=["ideas"])
async def rename_attachment(
    idea_id: str,
    attachment_id: str,
    body: AttachmentRename,
    authorization: str | None = Header(None),
):
    """Benennt einen Anhang um. App-Gate: Owner/Mod/Mitwirkende. Sicherheits-
    Check: Anhang muss Child der Idee sein."""
    if not authorization:
        raise HTTPException(401, "Anmeldung erforderlich")
    if not (await _can_edit_idea(idea_id, authorization))[0]:
        raise HTTPException(
            403, "Keine Berechtigung, Anhänge dieser Idee zu bearbeiten (nur Team/Moderation)."
        )
    await _verify_child_of(
        child_id=attachment_id,
        parent_id=idea_id,
        authorization=authorization,
    )
    new_name = body.name.strip()
    try:
        await edu_sharing.client.update_metadata(
            attachment_id,
            {"cm:name": [new_name], "cm:title": [new_name], "cclom:title": [new_name]},
            auth_header=authorization,
        )
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403):
            raise HTTPException(403, "Keine Berechtigung, diesen Anhang umzubenennen.")
        raise HTTPException(e.response.status_code, f"edu-sharing: {e.response.text[:200]}")
    _log_activity(
        action="attachment_renamed",
        authorization=authorization,
        target_type="attachment",
        target_id=attachment_id,
        target_label=new_name,
        detail={"idea_id": idea_id},
    )
    return {"ok": True, "name": new_name}


@router.delete("/ideas/{idea_id}/attachments/{attachment_id}", tags=["ideas"])
async def delete_attachment(
    idea_id: str,
    attachment_id: str,
    authorization: str | None = Header(None),
):
    """Löscht einen einzelnen Anhang. App-Gate: NUR Owner/Mod (Mitwirkende
    dürfen nicht löschen — edu-sharing's „Collaborator" erlaubt das ohnehin
    nicht). Sicherheits-Check: Anhang muss Child der Idee sein."""
    if not authorization:
        raise HTTPException(401, "Anmeldung erforderlich")
    if not (await _is_owner_or_mod(idea_id, authorization))[0]:
        raise HTTPException(403, "Nur Einreicher:in oder Moderation können Anhänge löschen.")
    meta = await _verify_child_of(
        child_id=attachment_id,
        parent_id=idea_id,
        authorization=authorization,
    )
    att_props = (meta.get("node") or {}).get("properties") or {}
    att_name = (att_props.get("cm:name") or att_props.get("cclom:title") or [None])[0] or "Datei"
    try:
        await edu_sharing.client.delete_node(attachment_id, auth_header=authorization)
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403):
            raise HTTPException(403, "Keine Berechtigung, diesen Anhang zu löschen.")
        if e.response.status_code != 404:
            raise HTTPException(e.response.status_code, f"edu-sharing: {e.response.text[:200]}")
    _log_activity(
        action="attachment_deleted",
        authorization=authorization,
        target_type="attachment",
        target_id=attachment_id,
        target_label=att_name,
        detail={"idea_id": idea_id},
    )
    return {"ok": True}


@router.put("/ideas/{idea_id}/attachments/{attachment_id}/content", tags=["ideas"])
async def replace_attachment_content(
    idea_id: str,
    attachment_id: str,
    file: UploadFile = File(...),
    authorization: str | None = Header(None),
):
    """Tauscht die Datei eines Anhangs aus (neue Version als Content). App-Gate:
    Owner/Mod/Mitwirkende. Sicherheits-Check: der Anhang muss ein Child der Idee
    sein — damit lässt sich der Hauptknoten der Idee NICHT versehentlich
    überschreiben."""
    if not authorization:
        raise HTTPException(401, "Anmeldung erforderlich")
    if not (await _can_edit_idea(idea_id, authorization))[0]:
        raise HTTPException(
            403, "Keine Berechtigung, Anhänge dieser Idee zu bearbeiten (nur Team/Moderation)."
        )
    await _verify_child_of(
        child_id=attachment_id,
        parent_id=idea_id,
        authorization=authorization,
    )
    data = await _read_upload_capped(file, settings.upload_attachment_max_bytes)
    if not data:
        raise HTTPException(400, "Leere Datei")
    filename = file.filename or "upload.bin"
    mimetype = file.content_type or "application/octet-stream"
    try:
        await edu_sharing.client.upload_content(
            attachment_id,
            file_bytes=data,
            filename=filename,
            mimetype=mimetype,
            auth_header=authorization,
        )
        # cm:name an die neue Datei angleichen (korrekte Endung beim Download).
        # cm:title/cclom:title bleiben unangetastet → ein zuvor per „Umbenennen"
        # gesetzter Anzeigename bleibt erhalten.
        try:
            await edu_sharing.client.update_metadata(
                attachment_id,
                {"cm:name": [filename]},
                auth_header=authorization,
            )
        except Exception:
            pass
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403):
            raise HTTPException(403, "Keine Berechtigung, diesen Anhang auszutauschen.")
        raise HTTPException(e.response.status_code, f"edu-sharing: {e.response.text[:200]}")
    try:
        await sync_mod.refresh_idea(idea_id, auth_header=authorization)
    except Exception:
        pass
    _log_activity(
        action="attachment_replaced",
        authorization=authorization,
        target_type="attachment",
        target_id=attachment_id,
        target_label=filename,
        detail={"idea_id": idea_id, "size": len(data), "mimetype": mimetype},
    )
    return {"ok": True, "name": filename, "size": len(data)}


class IdeaReport(BaseModel):
    reason: str = Field(..., min_length=3, max_length=2000)


@router.post("/ideas/{idea_id}/report", tags=["ideas"])
@limiter.limit("10/minute")
async def report_idea(
    request: Request,
    idea_id: str,
    body: IdeaReport,
    authorization: str | None = Header(None),
):
    """Trägt einen Melde-Eintrag in die DB ein. Moderatoren sehen die offenen
    Meldungen in ihrem Bereich. Kein automatischer Mailversand — bewusst
    minimal, weil ES-eigener SMTP-Hook auf prod hängt."""
    # Reporter = der/die Meldende selbst. Identität VERIFIZIEREN (echter,
    # passwort-geprüfter Username), sonst ließe sich eine Meldung einem
    # beliebigen Account unterschieben → /me/reports + Dublettenerkennung
    # manipulierbar. None bei anonymer Meldung. Vor connect(), damit der
    # ES-Roundtrip nicht den SQLite-Write-Lock hält.
    reporter = (await _verify_login(authorization)) if authorization else None
    with connect() as con:
        con.execute(
            "INSERT INTO idea_report (idea_id,reason,reporter,created_at) VALUES (?,?,?,?)",
            (idea_id, body.reason.strip(), reporter, sync_mod._iso_now()),
        )
        # Idee-Titel für hübsches Log
        title_row = con.execute("SELECT title FROM idea WHERE id=?", (idea_id,)).fetchone()
    _log_activity(
        action="report_submitted",
        authorization=authorization,
        target_type="idea",
        target_id=idea_id,
        target_label=(title_row["title"] if title_row else None),
        detail={"reason_excerpt": body.reason.strip()[:120]},
    )
    return {"ok": True}


@router.get("/admin/reports", tags=["moderation"])
async def list_reports(authorization: str | None = Header(None)):
    """Mod-Liste offener Meldungen (resolved_at IS NULL)."""
    await _require_moderator(authorization)
    with connect() as con:
        rows = con.execute(
            """SELECT r.*, i.title FROM idea_report r
                 LEFT JOIN idea i ON i.id = r.idea_id
                WHERE r.resolved_at IS NULL
                ORDER BY r.created_at DESC LIMIT 200"""
        ).fetchall()
    return {"count": len(rows), "items": [dict(r) for r in rows]}


@router.get("/admin/stats", tags=["moderation"])
async def admin_stats(authorization: str | None = Header(None)):
    """Übersichts-Dashboard für Mods: Totals, Phasen-/Event-Verteilung,
    Aktivitätskurve (Ideen pro Woche), Top-Aktive User, Reports-Stand."""
    await _require_moderator(authorization)
    with connect() as con:
        # Totals
        ideas_total = con.execute("SELECT COUNT(*) FROM idea").fetchone()[0]
        topics_total = con.execute("SELECT COUNT(*) FROM topic").fetchone()[0]
        themes_total = con.execute("SELECT COUNT(*) FROM topic WHERE parent_id IS NULL").fetchone()[
            0
        ]
        challenges_total = topics_total - themes_total

        comments_total = con.execute("SELECT COALESCE(SUM(comment_count),0) FROM idea").fetchone()[
            0
        ]
        ratings_total = con.execute("SELECT COALESCE(SUM(rating_count),0) FROM idea").fetchone()[0]
        interest_total = con.execute(
            "SELECT COUNT(*) FROM idea_interaction WHERE kind='interest'"
        ).fetchone()[0]
        follow_total = con.execute(
            "SELECT COUNT(*) FROM idea_interaction WHERE kind='follow'"
        ).fetchone()[0]

        # Phasen-Verteilung
        phases = [
            {"phase": r["phase"] or "(offen)", "count": r["c"]}
            for r in con.execute(
                "SELECT COALESCE(phase,'') AS phase, COUNT(*) AS c "
                "FROM idea GROUP BY phase ORDER BY c DESC"
            ).fetchall()
        ]

        # Event-Verteilung — events ist JSON, also in Python aggregieren
        ev_rows = con.execute("SELECT events FROM idea").fetchall()
        events: dict[str, int] = {}
        no_event = 0
        for r in ev_rows:
            try:
                evs = json.loads(r["events"] or "[]")
            except Exception:
                evs = []
            if not evs:
                no_event += 1
            for e in evs:
                events[e] = events.get(e, 0) + 1
        events_dist = sorted(
            [{"event": k, "count": v} for k, v in events.items()],
            key=lambda x: -x["count"],
        )
        if no_event:
            events_dist.append({"event": "(keine)", "count": no_event})

        # Aktivität pro Woche — letzte 12 Wochen, basiert auf created_at
        # ISO-Wochen-Format „YYYY-Www"
        weekly = con.execute(
            "SELECT strftime('%Y-W%W', created_at) AS week, COUNT(*) AS c "
            "FROM idea WHERE created_at IS NOT NULL "
            "GROUP BY week ORDER BY week DESC LIMIT 12"
        ).fetchall()
        weekly_list = list(reversed([{"week": r["week"], "count": r["c"]} for r in weekly]))

        # Top-Aktive User aus activity_log (letzte 30 Tage)
        cutoff = (datetime.now(UTC) - timedelta(days=30)).isoformat()
        top_actors = [
            {"actor": r["actor"], "count": r["c"]}
            for r in con.execute(
                "SELECT actor, COUNT(*) AS c FROM activity_log "
                "WHERE ts >= ? AND actor IS NOT NULL AND actor != 'Gast' "
                "GROUP BY actor ORDER BY c DESC LIMIT 10",
                (cutoff,),
            ).fetchall()
        ]

        # Reports
        rep_open = (
            con.execute("SELECT COUNT(*) FROM idea_report WHERE resolved_at IS NULL").fetchone()[0]
            if con.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='idea_report'"
            ).fetchone()
            else 0
        )
        rep_resolved = (
            con.execute(
                "SELECT COUNT(*) FROM idea_report WHERE resolved_at IS NOT NULL"
            ).fetchone()[0]
            if con.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='idea_report'"
            ).fetchone()
            else 0
        )

        # Aktivitäts-Volumen letzte 30 Tage pro Action
        action_dist = [
            {"action": r["action"], "count": r["c"]}
            for r in con.execute(
                "SELECT action, COUNT(*) AS c FROM activity_log "
                "WHERE ts >= ? GROUP BY action ORDER BY c DESC",
                (cutoff,),
            ).fetchall()
        ]

        # Aktivste Ideen (Rating + Comments + Interest gewichtet)
        top_ideas = [
            dict(r)
            for r in con.execute(
                "SELECT i.id, i.title, i.rating_avg, i.rating_count, "
                "       i.comment_count, "
                "       (SELECT COUNT(*) FROM idea_interaction "
                "        WHERE idea_id=i.id AND kind='interest') AS interest_count "
                "FROM idea i "
                "ORDER BY (rating_count + comment_count + "
                "  (SELECT COUNT(*) FROM idea_interaction "
                "   WHERE idea_id=i.id AND kind='interest')) DESC LIMIT 10"
            ).fetchall()
        ]

    # Avg-Rating (gewichtet)
    avg_rating = 0.0
    if ratings_total:
        with connect() as con:
            r = con.execute(
                "SELECT SUM(rating_avg * rating_count) / SUM(rating_count) AS a "
                "FROM idea WHERE rating_count > 0"
            ).fetchone()
            avg_rating = float(r["a"] or 0.0)

    return {
        "totals": {
            "ideas": ideas_total,
            "themes": themes_total,
            "challenges": challenges_total,
            "comments": comments_total,
            "ratings": ratings_total,
            "interest": interest_total,
            "follow": follow_total,
            "avg_rating": round(avg_rating, 2),
        },
        "phases": phases,
        "events": events_dist,
        "weekly": weekly_list,
        "top_actors": top_actors,
        "top_ideas": top_ideas,
        "reports": {"open": rep_open, "resolved": rep_resolved},
        "actions_30d": action_dist,
    }


@router.get("/admin/activity", tags=["moderation"])
async def list_activity(
    action: str | None = None,
    actor: str | None = None,
    target_id: str | None = None,
    since: str | None = Query(None, description="ISO datetime — only entries newer than this"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    authorization: str | None = Header(None),
):
    """Mod-Aktivitätslog. Filterbar nach action-Typ, Akteur, Target-Idee
    oder Zeitraum. Sortiert chronologisch absteigend (neueste zuerst)."""
    await _require_moderator(authorization)
    where: list[str] = []
    params: list = []
    if action:
        where.append("action = ?")
        params.append(action)
    if actor:
        # SQL-LIKE-Wildcards (% / _) aus dem User-Input neutralisieren,
        # damit z.B. `actor=%` nicht zur Voll-Liste degeneriert und
        # Ressourcen-/Pattern-DoS via `%%%%…` ausgeschlossen ist.
        where.append("actor LIKE ? ESCAPE '\\'")
        params.append(f"%{_escape_like(actor)}%")
    if target_id:
        where.append("target_id = ?")
        params.append(target_id)
    if since:
        where.append("ts >= ?")
        params.append(since)
    sql_where = (" WHERE " + " AND ".join(where)) if where else ""

    with connect() as con:
        total = con.execute(f"SELECT COUNT(*) FROM activity_log{sql_where}", params).fetchone()[0]
        rows = con.execute(
            f"SELECT * FROM activity_log{sql_where} ORDER BY ts DESC LIMIT ? OFFSET ?",
            (*params, limit, offset),
        ).fetchall()
        # Verfügbare Action-Typen für UI-Dropdown
        actions = [
            r["action"]
            for r in con.execute(
                "SELECT DISTINCT action FROM activity_log ORDER BY action ASC"
            ).fetchall()
        ]

    items = []
    for r in rows:
        d = dict(r)
        if d.get("detail"):
            try:
                d["detail"] = json.loads(d["detail"])
            except Exception:
                pass
        items.append(d)

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "actions": actions,
        "items": items,
    }


@router.post("/admin/reports/{report_id}/resolve", tags=["moderation"])
async def resolve_report(report_id: int, authorization: str | None = Header(None)):
    await _require_moderator(authorization)
    with connect() as con:
        con.execute(
            "UPDATE idea_report SET resolved_at=? WHERE id=?",
            (sync_mod._iso_now(), report_id),
        )
    _log_activity(
        action="report_resolved",
        authorization=authorization,
        is_mod=True,
        target_type="report",
        target_id=str(report_id),
    )
    return {"ok": True}


# ===== Moderation — Rolle ermitteln =============================


async def _is_moderator(authorization: str | None) -> bool:
    """Bestätigt, ob der eingeloggte User Mod-Rechte hat — ausschließlich über
    Mitgliedschaft in einer der konfigurierten edu-sharing-Gruppen
    (Default: GROUP_ALFRESCO_ADMINISTRATORS).

    Wichtig: der `my_memberships`-Call verifiziert die Credentials gegen
    edu-sharing (falsches Passwort → 401 → kein Mod). Es gibt bewusst KEINEN
    Username-Bootstrap mehr — der vertraute dem unverifizierten Basic-Usernamen
    und war damit ein Auth-Bypass, sobald gesetzt.
    """
    if not authorization:
        return False
    try:
        m = await edu_sharing.client.my_memberships(auth_header=authorization)
        groups = {(g.get("authorityName") or "") for g in (m.get("groups") or [])}
    except Exception:
        return False
    return any(g in groups for g in settings.fallback_mod_groups)


async def _verify_login(authorization: str | None) -> str | None:
    """Verifiziert die Basic-Credentials gegen edu-sharing und liefert den
    bestätigten Usernamen (None = fehlt/ungültig). Für App-DB-only-Schreibpfade,
    bei denen es keinen edu-sharing-Write als Backstop gibt — dort würde sonst
    der UNVERIFIZIERTE Basic-Username genügen (Impersonation). edu-sharing prüft
    user:pass gemeinsam; akzeptiert es den Header, ist der dekodierte Username
    der echte Caller. Ein Call pro (seltener) Schreibaktion; häufige
    Lese-Endpunkte bleiben bewusst ungekoppelt (kein Verfügbarkeits-/Perf-Nachteil)."""
    if not authorization:
        return None
    user = _user_key_from_auth(authorization)
    if not user:
        return None
    try:
        await edu_sharing.client.my_memberships(auth_header=authorization)
    except Exception:
        return None
    return user


async def _is_owner_or_mod(
    idea_id: str, authorization: str | None
) -> tuple[bool, str | None, bool]:
    """Owner-Gating für Idee-Editieren / -Löschen.

    edu-sharing's accessEffective ist hier *nicht* ausreichend: alle
    Mitglieder der HackathOERn-Gruppe haben durch Gruppen-Vererbung Write-
    Rechte auf jeder Idee — und das wäre ein Free-for-all. Stattdessen
    prüfen wir App-seitig:
      1. ist Mod/Admin → ja, alles erlaubt
      2. ist der Caller der originale Submitter (cm:creator oder
         submitter:<user>-Keyword) → ja, eigene Idee
      3. sonst → nein

    Return: (allowed, username, is_mod). username ist None bei fehlender Auth.
    """
    if not authorization:
        return False, None, False
    user = _user_key_from_auth(authorization)
    if not user:
        return False, None, False
    is_mod = await _is_moderator(authorization)
    if is_mod:
        return True, user, True

    # 1. Cache-Check (billig)
    try:
        with connect() as con:
            row = con.execute(
                "SELECT owner_username FROM idea WHERE id=?",
                (idea_id,),
            ).fetchone()
        if row and row["owner_username"] and row["owner_username"] == user:
            return True, user, False
    except Exception:
        pass

    # 2. Live-Fallback: ES-Metadaten lesen (cm:creator / submitter:-Keyword)
    try:
        meta = await edu_sharing.client.node_metadata(
            idea_id,
            auth_header=authorization,
        )
        node = (meta or {}).get("node") or {}
        props = node.get("properties") or {}
        creator_field = props.get("cm:creator") or []
        creator = (
            creator_field[0]
            if isinstance(creator_field, list) and creator_field
            else creator_field
            if isinstance(creator_field, str)
            else None
        )
        if creator and creator == user:
            return True, user, False
        kws = props.get("cclom:general_keyword") or []
        if isinstance(kws, str):
            kws = [kws]
        target = f"submitter:{user}".lower()
        if any(str(k).lower() == target for k in kws):
            return True, user, False
    except Exception as e:
        log.debug("_is_owner_or_mod: ES-fallback failed for %s: %s", idea_id, e)

    return False, user, False


async def _can_edit_idea(idea_id: str, authorization: str | None) -> tuple[bool, str | None, bool]:
    """Erweitert `_is_owner_or_mod` um angenommene Mithackende mit
    Bearbeitungsrecht: idea_interaction (kind='interest', status='approved',
    can_edit=1). Diese „Mitwirkenden" dürfen Beschreibung/Anhänge bearbeiten —
    NICHT löschen/umhängen (das bleibt Owner/Mod).

    Return: (allowed, username, is_owner_or_mod). is_owner_or_mod=False heißt:
    nur als Mitwirkende:r berechtigt (für Endpoints, die mehr verlangen).
    """
    allowed, user, is_mod = await _is_owner_or_mod(idea_id, authorization)
    if allowed:
        return True, user, True
    if not user:
        return False, user, False
    try:
        with connect() as con:
            row = con.execute(
                "SELECT can_edit, status FROM idea_interaction "
                "WHERE idea_id=? AND user_key=? AND kind='interest'",
                (idea_id, user),
            ).fetchone()
        if row and row["status"] == "approved" and row["can_edit"]:
            return True, user, False
    except Exception as e:
        log.debug("_can_edit_idea: collaborator-check failed for %s: %s", idea_id, e)
    return False, user, False


async def _require_moderator(authorization: str | None) -> str:
    """Helper, der bei nicht-Mod den 403 wirft. Gibt sonst den Username zurück.
    Fehlgeschlagene Versuche werden ins Activity-Log geschrieben — so kann ein
    Mod im Audit-Tab erkennen, ob jemand Mod-Endpoints zu raten versucht."""
    if not authorization:
        _log_activity(
            action="auth_failed",
            target_type="admin",
            detail={"reason": "no_credentials"},
        )
        raise HTTPException(401, "Anmeldung erforderlich")
    if not await _is_moderator(authorization):
        _log_activity(
            action="auth_failed",
            authorization=authorization,
            target_type="admin",
            detail={"reason": "not_moderator"},
        )
        raise HTTPException(403, "Diese Aktion ist Moderator:innen vorbehalten.")
    return _user_key_from_auth(authorization) or ""


@router.get("/me", tags=["me"])
async def whoami(authorization: str | None = Header(None)):
    """Bestätigt den aktuell eingeloggten User + Mod-Status.
    Frontend nutzt das beim Login um Mod-UI zu gaten."""
    if not authorization:
        return {"authenticated": False}
    user = _user_key_from_auth(authorization)
    is_mod = await _is_moderator(authorization)
    # Echten Namen mitgeben, damit das Frontend statt des Login-Usernamens
    # den Klarnamen (+ Initialen) anzeigen kann. Fallback: Username.
    display_name = await _resolve_display_name(authorization)
    return {
        "authenticated": bool(user),
        "username": user,
        "display_name": display_name or user,
        "is_moderator": is_mod,
        "moderation_groups": settings.fallback_mod_groups,
    }


@router.get("/me/memberships", tags=["me"])
async def my_memberships_debug(authorization: str | None = Header(None)):
    """Diagnose-Endpoint: liefert die rohen Memberships des Callers + die
    konfigurierten Mod-Gruppen, um Mismatch-Probleme aufzudecken."""
    if not authorization:
        raise HTTPException(401, "Anmeldung erforderlich")
    try:
        m = await edu_sharing.client.my_memberships(auth_header=authorization)
    except Exception as e:
        raise HTTPException(502, f"edu-sharing memberships-Fehler: {e}")
    groups = [
        {
            "authorityName": g.get("authorityName"),
            "displayName": (g.get("profile") or {}).get("displayName"),
            "groupType": (g.get("profile") or {}).get("groupType"),
        }
        for g in (m.get("groups") or [])
    ]
    user_groups = {g["authorityName"] for g in groups}
    matched = user_groups & set(settings.fallback_mod_groups)
    user = _user_key_from_auth(authorization)
    return {
        "username": user,
        "is_moderator": bool(matched),
        "matched_groups": sorted(matched),
        "expected_groups": settings.fallback_mod_groups,
        "groups_count": len(groups),
        "groups": groups,
    }


# ===== "Mein Bereich" — User-spezifische Listen ==================


@router.get("/me/ideas", tags=["me"])
def my_ideas(authorization: str | None = Header(None)):
    """Ideen, die dem eingeloggten User gehören (cm:owner == username)."""
    user = _user_key_from_auth(authorization)
    if not user:
        raise HTTPException(401, "Anmeldung erforderlich")
    with connect() as con:
        rows = con.execute(
            "SELECT * FROM idea WHERE owner_username = ? ORDER BY modified_at DESC",
            (user,),
        ).fetchall()
    return {"count": len(rows), "items": [_row_to_idea(r) for r in rows]}


@router.get("/me/follows", tags=["me"])
async def my_follows(authorization: str | None = Header(None)):
    """Ideen, denen der User folgt. Private Liste → Identität verifizieren,
    sonst ließen sich fremde Folge-Listen per gefälschtem Basic-User abrufen."""
    user = await _verify_login(authorization)
    if not user:
        raise HTTPException(401, "Anmeldung erforderlich")
    with connect() as con:
        rows = con.execute(
            "SELECT i.* FROM idea i "
            "JOIN idea_interaction x ON x.idea_id = i.id "
            "WHERE x.user_key = ? AND x.kind = 'follow' "
            "ORDER BY x.created_at DESC",
            (user,),
        ).fetchall()
    return {"count": len(rows), "items": [_row_to_idea(r) for r in rows]}


@router.get("/me/interest", tags=["me"])
async def my_interest(authorization: str | None = Header(None)):
    """Ideen, bei denen der User „mithacken" gemarkt hat — inkl. eigenem
    Team-Status (pending/approved) + Bearbeitungsrecht. Private Liste →
    Identität verifizieren (nicht nur dem Basic-Usernamen vertrauen)."""
    user = await _verify_login(authorization)
    if not user:
        raise HTTPException(401, "Anmeldung erforderlich")
    with connect() as con:
        rows = con.execute(
            "SELECT i.*, x.status AS my_status, x.can_edit AS my_can_edit FROM idea i "
            "JOIN idea_interaction x ON x.idea_id = i.id "
            "WHERE x.user_key = ? AND x.kind = 'interest' "
            "ORDER BY x.created_at DESC",
            (user,),
        ).fetchall()
    items = []
    for r in rows:
        d = _row_to_idea(r)
        d["my_status"] = r["my_status"] or "pending"
        d["my_can_edit"] = bool(r["my_can_edit"])
        items.append(d)
    return {"count": len(items), "items": items}


@router.get("/me/team-requests", tags=["me"])
async def my_team_requests(authorization: str | None = Header(None)):
    """Für die Ideen des eingeloggten Users: alle Mithackenden (offene
    Anfragen + angenommene) mit Idee-Titel — fürs zentrale Annehmen/Verwalten
    im „Mein Bereich". Klarnamen bevorzugt aus dem App-Profil. Private Liste
    (zeigt fremde Mithack-Anfragen) → Identität verifizieren."""
    user = await _verify_login(authorization)
    if not user:
        raise HTTPException(401, "Anmeldung erforderlich")
    with connect() as con:
        rows = con.execute(
            "SELECT x.idea_id, x.user_key, x.display_name, x.status, x.can_edit, "
            "x.created_at, i.title AS idea_title "
            "FROM idea_interaction x JOIN idea i ON i.id = x.idea_id "
            "WHERE i.owner_username = ? AND x.kind = 'interest' "
            "ORDER BY i.title, (x.status = 'approved'), x.created_at",
            (user,),
        ).fetchall()
        names: dict[str, str] = {}
        keys = list({r["user_key"] for r in rows})
        if keys:
            ph = ",".join("?" * len(keys))
            for m in con.execute(
                f"SELECT username, display_name FROM user_profile_meta "
                f"WHERE username IN ({ph}) AND display_name IS NOT NULL AND display_name != ''",
                keys,
            ).fetchall():
                names[m["username"]] = m["display_name"]

    def nm(r) -> str:
        uk = r["user_key"]
        if names.get(uk):
            return names[uk]
        dn = r["display_name"]
        return dn if (dn and dn != uk) else uk

    items = [
        {
            "idea_id": r["idea_id"],
            "idea_title": r["idea_title"],
            "user_key": r["user_key"],
            "name": nm(r),
            "status": r["status"] or "pending",
            "approved": (r["status"] == "approved"),
            "can_edit": bool(r["can_edit"]),
            "created_at": r["created_at"],
        }
        for r in rows
    ]
    pending = sum(1 for it in items if not it["approved"])
    return {"count": len(items), "pending": pending, "items": items}


@router.get("/me/activity", tags=["me"])
async def my_activity(
    limit: int = Query(50, ge=1, le=200),
    authorization: str | None = Header(None),
):
    """Aktivitäts-Feed für den eingeloggten User: Ereignisse zu Ideen, denen
    er folgt, die ihm gehören oder bei denen er „Mitmachen" angeklickt hat.
    Eigene Aktionen werden ausgeblendet — wir zeigen nur, was *andere* tun."""
    if not authorization:
        raise HTTPException(401, "Anmeldung erforderlich")
    me = _user_key_from_auth(authorization)
    if not me:
        raise HTTPException(401, "Username konnte nicht ermittelt werden")

    with connect() as con:
        # Sammle relevante Idea-IDs: gefolgt + Mitmachen + eigene
        idea_ids = {
            r["idea_id"]
            for r in con.execute(
                "SELECT idea_id FROM idea_interaction "
                "WHERE user_key = ? AND kind IN ('follow','interest')",
                (me,),
            ).fetchall()
        }
        for r in con.execute(
            "SELECT id FROM idea WHERE owner_username = ?",
            (me,),
        ).fetchall():
            idea_ids.add(r["id"])

        if not idea_ids:
            return {"count": 0, "items": []}

        placeholders = ",".join(["?"] * len(idea_ids))
        rows = con.execute(
            f"SELECT * FROM activity_log "
            f"WHERE target_id IN ({placeholders}) "
            f"  AND COALESCE(actor,'') <> ? "  # eigene Aktionen ausblenden
            f"ORDER BY ts DESC LIMIT ?",
            (*idea_ids, me, limit),
        ).fetchall()

    items = []
    for r in rows:
        d = dict(r)
        if d.get("detail"):
            try:
                d["detail"] = json.loads(d["detail"])
            except Exception:
                pass
        items.append(d)
    return {"count": len(items), "items": items}


# ===== Anhänge als Child-IO (Serienobjekt-Pattern) ==============
# Frühere Lösung mit Geschwister-Sammlung + `attachment-of:<id>`-Keyword
# wurde abgelöst — siehe ~/.claude/skills/wlo-childobjects/SKILL.md.


@router.post("/ideas/{idea_id}/attachments/upload", tags=["ideas"])
async def upload_attachment(
    idea_id: str,
    file: UploadFile = File(...),
    authorization: str | None = Header(None),
):
    """Lädt einen Anhang direkt als Child-IO (`ccm:childio` +
    `ccm:io_childobject`-Aspekt) unter die Idee. App-Gate: Owner/Mod/
    angenommene Mitwirkende."""
    if not authorization:
        raise HTTPException(401, "Anmeldung erforderlich")
    if not (await _can_edit_idea(idea_id, authorization))[0]:
        raise HTTPException(
            403, "Keine Berechtigung, an diese Idee Anhänge zu hängen (nur Team/Moderation)."
        )

    data = await _read_upload_capped(file, settings.upload_attachment_max_bytes)
    if not data:
        raise HTTPException(400, "Leere Datei")
    filename = file.filename or "upload.bin"
    mimetype = file.content_type or "application/octet-stream"

    # Step 1: Child-IO als Serienobjekt unter der Idee anlegen.
    # Order = aktuelle Anzahl bestehender Children, damit Reihenfolge stabil bleibt.
    try:
        existing = await edu_sharing.client.list_child_objects(
            idea_id,
            auth_header=authorization,
        )
    except Exception:
        existing = []
    order = len(existing)

    try:
        result = await edu_sharing.client.add_child_object(
            parent_id=idea_id,
            filename=filename,
            order=order,
            auth_header=authorization,
        )
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403):
            raise HTTPException(403, "Keine Berechtigung, an diese Idee Anhänge zu hängen.")
        if e.response.status_code == 404:
            raise HTTPException(404, "Idee nicht gefunden")
        raise HTTPException(e.response.status_code, f"edu-sharing: {e.response.text[:200]}")

    new_id = ((result or {}).get("node") or {}).get("ref", {}).get("id")
    if not new_id:
        raise HTTPException(502, "edu-sharing lieferte keine ID für den neuen Anhang")

    # Step 2: Bytes als content uploaden
    try:
        await edu_sharing.client.upload_content(
            new_id,
            file_bytes=data,
            filename=filename,
            mimetype=mimetype,
            auth_header=authorization,
        )
    except httpx.HTTPStatusError as e:
        # Aufräumen — Stub-Node ohne Content ist Datenmüll
        try:
            await edu_sharing.client.delete_node(new_id, auth_header=authorization)
        except Exception:
            pass
        raise HTTPException(
            e.response.status_code,
            f"edu-sharing Upload-Fehler: {e.response.text[:200]}",
        )
    # Idee-Cache anstoßen — modified_at aktuell halten.
    try:
        await sync_mod.refresh_idea(idea_id, auth_header=authorization)
    except Exception:
        pass
    _log_activity(
        action="attachment_uploaded",
        authorization=authorization,
        target_type="attachment",
        target_id=new_id,
        target_label=filename,
        detail={"idea_id": idea_id, "size": len(data), "mimetype": mimetype},
    )
    return {"ok": True, "node_id": new_id, "name": filename, "size": len(data)}


@router.get("/ideas/{idea_id}/attachments", tags=["ideas"])
async def list_attachments(
    idea_id: str,
    authorization: str | None = Header(None),
):
    """Listet alle Child-IO-Anhänge unter einer Idee, sortiert nach
    `ccm:childobject_order`."""
    try:
        children = await edu_sharing.client.list_child_objects(
            idea_id,
            auth_header=authorization,
        )
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            raise HTTPException(404, "Idee nicht gefunden")
        raise HTTPException(e.response.status_code, f"edu-sharing: {e.response.text[:200]}")

    items = []
    for n in children:
        ref = n.get("ref") or {}
        props = n.get("properties") or {}
        items.append(
            {
                "node_id": ref.get("id"),
                "name": (props.get("cm:name") or [n.get("name")])[0],
                "mimetype": (props.get("ccm:content-type") or [None])[0] or n.get("mimetype"),
                "size": n.get("size"),
                "created_at": n.get("createdAt"),
                "order": (props.get("ccm:childobject_order") or [None])[0],
                "preview_url": (n.get("preview") or {}).get("url"),
                # Konsistent zum primären Anhang-Serialisierer (_attachment_dict):
                # die edu-sharing-Content-URL, nicht ein erfundenes es_render_base.
                "render_url": (n.get("content") or {}).get("url"),
            }
        )
    return {"items": items, "count": len(items)}


# ===== Moderatoren-Übersicht (read-only) ==========================
# Mitgliedschaften in den Mod-Gruppen werden ausschließlich im
# edu-sharing-Repository selbst verwaltet — diese App liest sie nur
# zur Anzeige aus, um nicht versehentlich globale Admin-Rechte zu
# erteilen oder zu entziehen.


@router.get("/admin/moderators", tags=["moderation"])
async def list_moderators(authorization: str | None = Header(None)):
    """Mitglieder aller konfigurierten Mod-Gruppen + Bootstrap-User."""
    await _require_moderator(authorization)
    members: list[dict] = []
    seen: set[str] = set()
    group_results: list[dict] = []
    for group_name in settings.fallback_mod_groups:
        ok = True
        error: str | None = None
        try:
            m = await edu_sharing.client.group_members(group_name, auth_header=authorization)
        except httpx.HTTPStatusError as e:
            ok = False
            if e.response.status_code == 404:
                error = "Gruppe nicht gefunden"
                m = {}
            else:
                error = f"HTTP {e.response.status_code}"
                m = {}
        except Exception as e:
            ok = False
            error = str(e)
            m = {}

        added = 0
        for p in m.get("persons") or m.get("authorities") or m.get("members") or []:
            uname = p.get("authorityName") or p.get("userName")
            key = (uname or "").lower()
            if not uname or key in seen:
                continue
            seen.add(key)
            profile = p.get("profile") or {}
            members.append(
                {
                    "username": uname,
                    "first_name": profile.get("firstName"),
                    "last_name": profile.get("lastName"),
                    "email": profile.get("email") or p.get("mailbox"),
                    "source": group_name,
                }
            )
            added += 1
        # Klartext-Bezeichnung der Gruppe holen (profile.displayName), damit das
        # Mod-UI nicht nur die technische Gruppen-ID zeigt. Best-effort.
        display_name: str | None = None
        try:
            g = await edu_sharing.client.get_group(group_name, auth_header=authorization)
            inner = g.get("group") if isinstance(g.get("group"), dict) else g
            display_name = ((inner or {}).get("profile") or {}).get("displayName") or None
        except Exception:
            display_name = None
        group_results.append(
            {
                "group": group_name,
                "display_name": display_name,
                "ok": ok,
                "error": error,
                "count": added,
            }
        )

    return {
        "groups": settings.fallback_mod_groups,
        "group_status": group_results,
        "count": len(members),
        "members": members,
        "managed_externally": True,
    }


@router.post("/admin/sync", tags=["admin"])
async def trigger_sync(authorization: str | None = Header(None)):
    await _require_moderator(authorization)
    return await sync_mod.run_sync()


# ===== Backup / Restore (Mod-only) =======================================


@router.post("/admin/backup", tags=["admin"])
async def admin_backup_create(authorization: str | None = Header(None)):
    """Erstellt jetzt ein neues Backup. Behält die letzten N (laut
    settings.backup_keep), löscht ältere automatisch."""
    await _require_moderator(authorization)
    try:
        # Im Executor laufen lassen — VACUUM INTO + ZIP-Pack ist I/O-lastig
        import asyncio as _aio

        path = await _aio.to_thread(backup_mod.create_backup)
    except Exception as e:
        log.exception("backup failed")
        raise HTTPException(500, f"Backup fehlgeschlagen: {e}")
    _log_activity(
        action="backup_created",
        authorization=authorization,
        is_mod=True,
        target_type="backup",
        target_label=path.name,
        detail={"size": path.stat().st_size},
    )
    return {
        "ok": True,
        "filename": path.name,
        "size": path.stat().st_size,
    }


@router.get("/admin/backups", tags=["admin"])
async def admin_backup_list(authorization: str | None = Header(None)):
    """Liste vorhandener Backups, neueste zuerst."""
    await _require_moderator(authorization)
    return {
        "backups": backup_mod.list_backups(),
        "keep": settings.backup_keep,
        "interval_hours": settings.backup_interval_hours,
        "enabled": settings.backup_enabled,
    }


@router.get("/admin/backups/{filename}", tags=["admin"])
async def admin_backup_download(
    filename: str,
    authorization: str | None = Header(None),
):
    """Stream-Download einer Backup-ZIP."""
    await _require_moderator(authorization)
    try:
        path = backup_mod.get_backup_path(filename)
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(404, str(e))
    from fastapi.responses import FileResponse

    return FileResponse(
        path,
        media_type="application/zip",
        filename=filename,
    )


@router.delete("/admin/backups/{filename}", tags=["admin"])
async def admin_backup_delete(
    filename: str,
    authorization: str | None = Header(None),
):
    """Löscht ein Backup manuell. Pre-Restore-Backups bleiben dadurch nicht
    automatisch erhalten — wer eines aufheben will, muss es vorher
    herunterladen."""
    await _require_moderator(authorization)
    try:
        backup_mod.delete_backup(filename)
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(404, str(e))
    _log_activity(
        action="backup_deleted",
        authorization=authorization,
        is_mod=True,
        target_type="backup",
        target_label=filename,
    )
    return {"ok": True}


@router.post("/admin/backups/restore", tags=["admin"])
@limiter.limit("3/hour")
async def admin_backup_restore(
    request: Request,
    file: UploadFile = File(...),
    authorization: str | None = Header(None),
):
    """Stellt aus einer hochgeladenen ZIP wieder her. Vor dem Austausch
    wird automatisch ein „pre-restore"-Backup angelegt — sicherheitshalber.

    WARNUNG: Aktivität-Log und alle App-DB-Daten werden auf den Stand des
    Backups zurückgesetzt. edu-sharing-Daten werden nicht angefasst, der
    nächste Voll-Sync zieht den aktuellen Stand vom Repo nach."""
    await _require_moderator(authorization)
    data = await _read_upload_capped(file, settings.upload_restore_max_bytes)
    if not data:
        raise HTTPException(400, "Leere Datei")
    try:
        result = await backup_mod.restore_backup(data)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        log.exception("restore failed")
        raise HTTPException(500, f"Restore fehlgeschlagen: {e}")
    _log_activity(
        action="backup_restored",
        authorization=authorization,
        is_mod=True,
        target_type="backup",
        target_label=file.filename,
        detail={"size": len(data), "restored_metadata": result.get("restored_metadata")},
    )
    return result


# ===== Kommentar löschen (Owner + Mod) ============================


@router.delete("/comments/{comment_id}", tags=["ideas"])
async def delete_comment(
    comment_id: str,
    idea_id: str | None = Query(None),
    authorization: str | None = Header(None),
):
    """Löscht einen Kommentar. Erlaubt für (a) Kommentar-Autor selbst,
    (b) Moderator. edu-sharing prüft Schreibrecht auf dem Kommentar-Knoten,
    aber wir gating das auch app-seitig: ohne Auth direkt 401."""
    if not authorization:
        raise HTTPException(401, "Anmeldung erforderlich")
    me = _user_key_from_auth(authorization)
    is_mod = await _is_moderator(authorization)

    # Owner-Check: edu-sharing-Comment-API hat creator-Authority. Wir lesen
    # die Kommentar-Liste der Idee (sofern idea_id mit) und matchen den
    # ref.id. Bei is_mod überspringen wir die Owner-Prüfung.
    author_match = is_mod
    if not is_mod and idea_id:
        try:
            with connect() as con:
                row = con.execute(
                    "SELECT main_content_id,id FROM idea WHERE id=?",
                    (idea_id,),
                ).fetchone()
            if row:
                target = row["main_content_id"] or row["id"]
                cm = await edu_sharing.client.comments(target, auth_header=authorization)
                for c in (cm or {}).get("comments") or []:
                    ref_id = (c.get("ref") or {}).get("id")
                    if ref_id == comment_id:
                        creator = ((c.get("creator") or {}).get("authorityName") or "").lower()
                        if creator and me and creator == me.lower():
                            author_match = True
                        break
        except Exception as e:
            log.debug("delete_comment: Owner-Check fehlgeschlagen: %s", e)

    if not author_match:
        raise HTTPException(403, "Nur Autor:in oder Moderation kann Kommentare löschen.")

    try:
        await edu_sharing.client.delete_comment(comment_id, auth_header=authorization)
    except httpx.HTTPStatusError as e:
        raise HTTPException(e.response.status_code, f"edu-sharing: {e.response.text[:200]}")

    # comment_count refreshen
    if idea_id:
        try:
            await sync_mod.refresh_idea(idea_id, auth_header=authorization)
        except Exception:
            pass
    _log_activity(
        action="comment_deleted",
        authorization=authorization,
        is_mod=is_mod,
        target_type="idea",
        target_id=idea_id or "",
        detail={"comment_id": comment_id},
    )
    return {"ok": True}


# ===== Reports — Status für den Reporter ==========================


@router.get("/ideas/{idea_id}/report-status", tags=["ideas"])
def idea_report_status(idea_id: str, authorization: str | None = Header(None)):
    """Zeigt dem eingeloggten User, ob er die Idee bereits gemeldet hat
    (verhindert Doppel-Meldungen, zeigt Status im UI)."""
    if not authorization:
        return {"reported": False}
    me = _user_key_from_auth(authorization)
    if not me:
        return {"reported": False}
    with connect() as con:
        row = con.execute(
            """SELECT id, created_at, resolved_at FROM idea_report
                WHERE idea_id = ? AND reporter = ?
                ORDER BY created_at DESC LIMIT 1""",
            (idea_id, me),
        ).fetchone()
    if not row:
        return {"reported": False}
    return {
        "reported": True,
        "created_at": row["created_at"],
        "resolved_at": row["resolved_at"],
        "status": "resolved" if row["resolved_at"] else "open",
    }


# ===== Ranking-Trend: Top-Steiger der letzten 7 Tage ==============


@router.get("/ranking/risers", tags=["ranking"])
def ranking_risers(
    sort: Literal["rating", "comments", "interest"] = "rating",
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
        items.append(
            {
                "idea_id": r["idea_id"],
                "title": r["title"],
                "description": r["description"],
                "preview_url": r["preview_url"],
                "author": r["author"],
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


# ===== Öffentliches User-Profil ====================================


@router.get("/users/{username}", tags=["users"])
def public_user_profile(username: str):
    """Öffentliches Profil — listet die Ideen eines Users + Aggregat-Stats
    + optionale Profil-Felder (display_name, bio, website, role).
    Keine private Information (Mitmachen/Folgen anderer Ideen, eigene
    Meldungen) — die liegen unter /me/*."""
    uname = (username or "").strip()
    if not uname:
        raise HTTPException(400, "Username erforderlich")
    with connect() as con:
        rows = con.execute(
            """SELECT * FROM idea
                WHERE owner_username = ?
                  AND COALESCE(hidden,0) = 0
                ORDER BY modified_at DESC""",
            (uname,),
        ).fetchall()
        agg = con.execute(
            """SELECT
                 COUNT(*) AS ideas,
                 COALESCE(SUM(comment_count),0) AS comments,
                 COALESCE(SUM(rating_count),0) AS ratings,
                 COALESCE(AVG(NULLIF(rating_avg,0)),0) AS avg_rating
                FROM idea WHERE owner_username = ?
                  AND COALESCE(hidden,0) = 0""",
            (uname,),
        ).fetchone()
        last_act = con.execute(
            "SELECT MAX(modified_at) FROM idea WHERE owner_username = ?",
            (uname,),
        ).fetchone()[0]
        meta_row = con.execute(
            "SELECT display_name, bio, website, role FROM user_profile_meta WHERE username=?",
            (uname,),
        ).fetchone()
    if not rows and not last_act and not meta_row:
        raise HTTPException(404, "Kein öffentliches Profil vorhanden")
    meta = (
        dict(meta_row)
        if meta_row
        else {
            "display_name": None,
            "bio": None,
            "website": None,
            "role": None,
        }
    )
    return {
        "username": uname,
        "stats": {
            "ideas": agg["ideas"],
            "comments": agg["comments"],
            "ratings": agg["ratings"],
            "avg_rating": round(float(agg["avg_rating"] or 0.0), 2),
        },
        "last_activity": last_act,
        "profile": meta,
        "ideas": [_row_to_idea(r) for r in rows],
    }


# ===== Eigene Profil-Felder pflegen (App-seitig) ===================


class ProfileMetaPatch(BaseModel):
    """Optional editable Profil-Felder (alle nullable / leer = entfernen)."""

    display_name: str | None = Field(default=None, max_length=80)
    bio: str | None = Field(default=None, max_length=280)
    website: str | None = Field(default=None, max_length=2000)
    # Rolle/Kontext: Slug aus dem Frontend-Dropdown. Statt einer starren
    # Literal-Whitelist (die bei jeder neuen Rolle mitgepflegt werden müsste)
    # nur Format + Länge prüfen: kebab-case, max. 40 Zeichen, leer = entfernen.
    role: str | None = Field(default=None, max_length=40, pattern=r"^[a-z0-9-]*$")


@router.get("/me/profile-meta", tags=["me"])
def get_my_profile_meta(authorization: str | None = Header(None)):
    """Lädt die eigenen Profil-Felder zum Bearbeiten."""
    if not authorization:
        raise HTTPException(401, "Anmeldung erforderlich")
    me = _user_key_from_auth(authorization)
    if not me:
        raise HTTPException(401, "Username konnte nicht ermittelt werden")
    with connect() as con:
        row = con.execute(
            "SELECT display_name, bio, website, role, updated_at "
            "FROM user_profile_meta WHERE username=?",
            (me,),
        ).fetchone()
    if not row:
        return {
            "display_name": None,
            "bio": None,
            "website": None,
            "role": None,
            "updated_at": None,
        }
    return dict(row)


@router.put("/me/profile-meta", tags=["me"])
async def update_my_profile_meta(
    body: ProfileMetaPatch,
    authorization: str | None = Header(None),
):
    """Speichert die eigenen Profil-Felder. Wirft 400 bei ungültiger URL."""
    # App-DB-Write → Login gegen edu-sharing verifizieren (sonst könnte man mit
    # fremdem Username + beliebigem Passwort fremde Profilfelder überschreiben).
    me = await _verify_login(authorization)
    if not me:
        raise HTTPException(401, "Anmeldung erforderlich")

    # URL absichern (http(s)-only)
    safe_url = _validate_external_url(body.website, field="Website")

    # Leere Strings → NULL
    def _norm(v: str | None) -> str | None:
        if v is None:
            return None
        s = v.strip()
        return s or None

    display = _norm(body.display_name)
    bio = _norm(body.bio)
    role = _norm(body.role)
    now = datetime.now(UTC).isoformat()

    with connect() as con:
        con.execute(
            "INSERT INTO user_profile_meta "
            "(username, display_name, bio, website, role, updated_at) "
            "VALUES (?,?,?,?,?,?) "
            "ON CONFLICT(username) DO UPDATE SET "
            "  display_name=excluded.display_name, "
            "  bio=excluded.bio, "
            "  website=excluded.website, "
            "  role=excluded.role, "
            "  updated_at=excluded.updated_at",
            (me, display, bio, safe_url, role, now),
        )
    _log_activity(
        action="profile_meta_updated",
        authorization=authorization,
        is_mod=False,
        target_type="user",
        target_id=me,
        detail={
            "fields": [
                k
                for k, v in {
                    "display_name": display,
                    "bio": bio,
                    "website": safe_url,
                    "role": role,
                }.items()
                if v is not None
            ]
        },
    )
    return {"ok": True, "username": me, "updated_at": now}


# ===== Hidden-Verwaltung (Mod-only) ===============================


@router.get("/admin/hidden-ideas", tags=["moderation"])
async def list_hidden_ideas(authorization: str | None = Header(None)):
    """Liste der versteckten Ideen — für den Mod-Tab „Versteckt"."""
    await _require_moderator(authorization)
    with connect() as con:
        rows = con.execute(
            """SELECT id, title, owner_username, hidden_reason, modified_at
                 FROM idea WHERE hidden = 1
                ORDER BY modified_at DESC LIMIT 500"""
        ).fetchall()
    return {"count": len(rows), "items": [dict(r) for r in rows]}


@router.get("/admin/all-ideas", tags=["moderation"])
async def list_all_ideas_admin(
    q: str | None = None,
    authorization: str | None = Header(None),
):
    """Alle Ideen inkl. versteckte — für die Sichtbarkeits-Verwaltung im
    Mod-Tab „Versteckt". Optionaler Titel-Filter `q` (LIKE, Wildcards
    escaped). Versteckte zuerst, dann nach Änderungsdatum. Nur Mod."""
    await _require_moderator(authorization)
    sql = (
        "SELECT id, title, owner_username, COALESCE(hidden, 0) AS hidden, "
        "hidden_reason, modified_at FROM idea"
    )
    params: list = []
    if q and q.strip():
        like = q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        sql += " WHERE title LIKE ? ESCAPE '\\'"
        params.append(f"%{like}%")
    sql += " ORDER BY COALESCE(hidden, 0) DESC, modified_at DESC LIMIT 400"
    with connect() as con:
        rows = con.execute(sql, params).fetchall()
    return {"count": len(rows), "items": [dict(r) for r in rows]}


@router.post("/admin/ideas/{idea_id}/hide", tags=["moderation"])
async def hide_idea(
    idea_id: str,
    body: dict | None = None,
    authorization: str | None = Header(None),
):
    """Idee soft-deleten: bleibt in der DB, ist aber für öffentliche Listen
    und Detail-Seiten unsichtbar. Reversibel via /unhide."""
    await _require_moderator(authorization)
    reason = (body or {}).get("reason") if isinstance(body, dict) else None
    with connect() as con:
        row = con.execute(
            "SELECT title FROM idea WHERE id=?",
            (idea_id,),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Idee nicht gefunden")
        con.execute(
            "UPDATE idea SET hidden = 1, hidden_reason = ? WHERE id=?",
            (reason, idea_id),
        )
    _log_activity(
        action="idea_hidden",
        authorization=authorization,
        is_mod=True,
        target_type="idea",
        target_id=idea_id,
        target_label=row["title"],
        detail={"reason": reason} if reason else None,
    )
    return {"ok": True}


@router.post("/admin/ideas/{idea_id}/unhide", tags=["moderation"])
async def unhide_idea(
    idea_id: str,
    authorization: str | None = Header(None),
):
    """Idee wieder sichtbar machen."""
    await _require_moderator(authorization)
    with connect() as con:
        row = con.execute(
            "SELECT title FROM idea WHERE id=?",
            (idea_id,),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Idee nicht gefunden")
        con.execute(
            "UPDATE idea SET hidden = 0, hidden_reason = NULL WHERE id=?",
            (idea_id,),
        )
    _log_activity(
        action="idea_unhidden",
        authorization=authorization,
        is_mod=True,
        target_type="idea",
        target_id=idea_id,
        target_label=row["title"],
    )
    return {"ok": True}


# ===== Notification-Cursor — "neu seit letztem Besuch" =============


@router.get("/me/notifications/unseen", tags=["me"])
def my_notifications_unseen(authorization: str | None = Header(None)):
    """Anzahl der Feed-Items, die seit dem letzten /me/notifications/seen-
    Call aufgetreten sind. Für die Badge im User-Menü / Profil-Tab."""
    if not authorization:
        return {"count": 0}
    me = _user_key_from_auth(authorization)
    if not me:
        return {"count": 0}
    with connect() as con:
        seen_row = con.execute(
            "SELECT last_seen FROM user_feed_seen WHERE user_key=?",
            (me,),
        ).fetchone()
        last_seen = seen_row["last_seen"] if seen_row else "1970-01-01T00:00:00Z"

        # Relevante Idea-IDs (gefolgt + mitmachen + eigene)
        idea_ids = {
            r["idea_id"]
            for r in con.execute(
                "SELECT idea_id FROM idea_interaction "
                "WHERE user_key=? AND kind IN ('follow','interest')",
                (me,),
            ).fetchall()
        }
        for r in con.execute(
            "SELECT id FROM idea WHERE owner_username=?",
            (me,),
        ).fetchall():
            idea_ids.add(r["id"])
        if not idea_ids:
            return {"count": 0, "last_seen": last_seen}

        # SQLites Default-Parameter-Limit liegt bei 999. Wer >900 Ideen
        # gefolgt/eigen hat, würde sonst eine `too many SQL variables`-
        # Exception bekommen. Wir chunken auf 800er-Blöcke und summieren.
        idea_list = list(idea_ids)
        CHUNK = 800
        count = 0
        for start in range(0, len(idea_list), CHUNK):
            chunk = idea_list[start : start + CHUNK]
            placeholders = ",".join("?" * len(chunk))
            count += con.execute(
                f"SELECT COUNT(*) FROM activity_log "
                f"WHERE target_id IN ({placeholders}) "
                f"  AND ts > ? AND COALESCE(actor,'') <> ?",
                (*chunk, last_seen, me),
            ).fetchone()[0]
    return {"count": count, "last_seen": last_seen}


@router.post("/me/notifications/seen", tags=["me"])
async def mark_notifications_seen(authorization: str | None = Header(None)):
    """Setzt den Notification-Cursor auf jetzt — alle weiter zurückliegenden
    Feed-Items gelten als „gelesen"."""
    if not authorization:
        raise HTTPException(401, "Anmeldung erforderlich")
    # App-DB-Write → Identität verifizieren statt nur dem Basic-Usernamen zu
    # vertrauen, sonst ließe sich der Notification-Cursor fremder User setzen.
    me = await _verify_login(authorization)
    if not me:
        raise HTTPException(401, "Anmeldung ungültig")
    now = sync_mod._iso_now()
    with connect() as con:
        con.execute(
            "INSERT OR REPLACE INTO user_feed_seen (user_key, last_seen) VALUES (?, ?)",
            (me, now),
        )
    return {"ok": True, "last_seen": now}


# ===== Idee aus edu-sharing nachladen ============================


@router.post("/ideas/{idea_id}/refresh", tags=["ideas"])
async def manual_refresh_idea(
    idea_id: str,
    authorization: str | None = Header(None),
):
    """Holt die Idee live aus edu-sharing und aktualisiert den App-Cache.
    Wird gebraucht, wenn ein User im Repo direkt etwas geändert hat
    (z.B. neues Vorschaubild) und nicht auf den 5-Minuten-Sync warten will.
    Owner + Mod dürfen refreshen — für anonyme Besucher ist's gesperrt,
    um Spam-Refresh-Last vom Repo abzuhalten."""
    if not authorization:
        raise HTTPException(401, "Anmeldung erforderlich")
    allowed, _user, _is_mod = await _is_owner_or_mod(idea_id, authorization)
    if not allowed:
        raise HTTPException(403, "Nur Eigentümer oder Mod dürfen refreshen.")
    ok = await sync_mod.refresh_idea(idea_id, auth_header=authorization)
    if not ok:
        raise HTTPException(
            502, "Refresh fehlgeschlagen — Knoten unbekannt oder edu-sharing nicht erreichbar."
        )
    return {"ok": True}


# ===== Bestehende Ideen nachpflegen: Pflicht-Metadaten für Freischaltung ====


def _missing_publication_fields(cur_props: dict) -> dict[str, list[str]]:
    """Welche der WLO-Freischaltungs-Pflichtfelder fehlen am Knoten?
    Liefert ein dict mit Defaults nur für die fehlenden Felder — wird
    von Single- und Bulk-Backfill verwendet."""
    add: dict[str, list[str]] = {}
    if not cur_props.get("ccm:commonlicense_key"):
        add["ccm:commonlicense_key"] = ["CC_BY"]
    if not cur_props.get("ccm:commonlicense_cc_version"):
        add["ccm:commonlicense_cc_version"] = ["4.0"]
    if not cur_props.get("cclom:general_language"):
        add["cclom:general_language"] = ["de"]
    if not cur_props.get("ccm:replicationsource"):
        add["ccm:replicationsource"] = ["hackathoern-ideendatenbank"]
    return add


@router.post("/admin/ideas/backfill-publication-meta", tags=["moderation"])
async def backfill_publication_meta_all(
    limit: int = Query(50, ge=1, le=500),
    authorization: str | None = Header(None),
):
    """Bulk-Variante: läuft über alle Ideen und ergänzt fehlende Pflicht-
    Metadaten. Per-Item-Fehler werden gesammelt; der Lauf bricht nicht ab."""
    await _require_moderator(authorization)
    with connect() as con:
        rows = con.execute(
            "SELECT id, main_content_id, title FROM idea "
            "WHERE COALESCE(hidden,0)=0 ORDER BY modified_at DESC LIMIT ?",
            (limit,),
        ).fetchall()

    processed = 0
    updated = 0
    errors: list[dict] = []
    for r in rows:
        target = r["main_content_id"] or r["id"]
        try:
            meta = await edu_sharing.client.node_metadata(
                target,
                auth_header=authorization,
            )
            cur = (meta.get("node") or {}).get("properties") or {}
            add = _missing_publication_fields(cur)
            if add:
                await edu_sharing.client.update_metadata(
                    target,
                    add,
                    auth_header=authorization,
                )
                updated += 1
                try:
                    await sync_mod.refresh_idea(r["id"], auth_header=authorization)
                except Exception:
                    pass
            processed += 1
        except Exception as e:
            errors.append({"id": r["id"], "title": r["title"], "error": str(e)[:200]})
    _log_activity(
        action="publication_meta_bulk_backfilled",
        authorization=authorization,
        is_mod=True,
        target_type="idea",
        detail={"processed": processed, "updated": updated, "error_count": len(errors)},
    )
    return {"ok": True, "processed": processed, "updated": updated, "errors": errors[:20]}


@router.get("/health")
def health():
    with connect() as con:
        counts = con.execute(
            "SELECT (SELECT COUNT(*) FROM topic) topics, (SELECT COUNT(*) FROM idea) ideas"
        ).fetchone()
        last = con.execute("SELECT * FROM sync_log ORDER BY id DESC LIMIT 1").fetchone()
    return {
        "ok": True,
        "topics": counts["topics"],
        "ideas": counts["ideas"],
        "last_sync": dict(last) if last else None,
    }
