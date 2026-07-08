"""Shared route-layer helpers used across the route modules.

Extracted from routes.py (behaviour-preserving) so route modules can import them
without pulling in the whole routes.py. They belong to the routes layer (some
raise HTTPException or write the audit log) but carry no route decorators, and
they never import a route module — so importing this module creates no cycles.
"""

from __future__ import annotations

import asyncio
import json
import logging
import secrets as _secrets
from datetime import UTC, datetime, timedelta

import httpx
from fastapi import HTTPException, UploadFile

from . import edu_sharing
from . import sync as sync_mod
from .auth import decode_basic_user as _user_key_from_auth
from .auth import is_moderator as _is_moderator
from .config import settings
from .db import connect

log = logging.getLogger(__name__)


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


def _row_to_idea(r) -> dict:
    # Login-Username NIE als Anzeigename ausliefern: `author` ist im Cache evtl.
    # nur cm:creator (= Login). Daher author verwerfen, wenn er == owner_username,
    # und einen sicheren owner_display_name bilden. Anzeige-Priorität (Anforderung):
    # 1. author-Freitext aus der Einreichung, 2. Klarname aus edu-sharing,
    # sonst None — nie der Login, nie der Guest-Service-Account.
    _un = _safe_get(r, "owner_username")
    _au = r["author"]
    _safe_author = _au if (_au and _au != _un) else None
    # Der technische Guest-Account (anonyme Submits) ist keine Person: Login
    # nicht ausliefern → kein Profil-Link auf den Service-Account im Frontend.
    if settings.edu_guest_user and _un == settings.edu_guest_user:
        _un = None
    return {
        "id": r["id"],
        "kind": r["kind"],
        "topic_id": r["topic_id"],
        "main_content_id": r["main_content_id"],
        "title": r["title"],
        "description": r["description"],
        "preview_url": r["preview_url"],
        "author": _safe_author,
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
        "owner_username": _un,
        "owner_display_name": _safe_author or _safe_get(r, "owner_display_name"),
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
    """Return [root_id] + all transitive descendants from the topic table.

    Zyklusfest über ein ``visited``-Set: Zeigt ein ``parent_id`` (z.B. nach
    einem fehlerhaften Move) auf einen Vorfahren, würde die naive Breitensuche
    sonst ENDLOS laufen — der Request hinge bis zum Proxy-Timeout (~30s) und
    ließe den ausführenden Threadpool-Worker für immer drehen, bis nach genug
    solcher Requests der ganze Pool erschöpft ist. Mit ``visited`` terminiert
    der Walk garantiert nach höchstens (#Topics) Schritten und liefert jeden
    erreichbaren Knoten genau einmal.
    """
    ids: list[str] = [root_id]
    visited: set[str] = {root_id}
    frontier = [root_id]
    while frontier:
        placeholders = ",".join("?" * len(frontier))
        rows = con.execute(
            f"SELECT id FROM topic WHERE parent_id IN ({placeholders})", frontier
        ).fetchall()
        frontier = [r["id"] for r in rows if r["id"] not in visited]
        visited.update(frontier)
        ids.extend(frontier)
    return ids


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


# ===== Upload-Token (Objekt-Autorisierung für anonyme Uploads) ============
# Anonyme Einreicher haben keinen Login, mit dem sich Eigentum nachweisen ließe.
# Beim anonymen `POST /ideas` geben wir daher ein kurzlebiges, unratbares Token
# zurück, das an genau die neu erstellte Knoten-ID gebunden ist. Vorschaubild-/
# Anhang-Uploads im anonymen Zweig verlangen dieses Token → niemand kann an eine
# fremde (erratene) Inbox-Knoten-ID hochladen. Mehrfach nutzbar (mehrere Anhänge
# + Vorschaubild) innerhalb der TTL.
UPLOAD_TOKEN_TTL_SECONDS = 1800  # 30 Min — deckt das Nachladen mehrerer/großer Dateien ab


def _upload_token_issue(node_id: str) -> str:
    token = _secrets.token_urlsafe(24)
    now = datetime.now(UTC)
    expires = (now + timedelta(seconds=UPLOAD_TOKEN_TTL_SECONDS)).isoformat()
    with connect() as con:
        con.execute("DELETE FROM upload_token WHERE expires_at < ?", (now.isoformat(),))
        con.execute(
            "INSERT INTO upload_token (token, node_id, expires_at, created_at) VALUES (?,?,?,?)",
            (token, node_id, expires, now.isoformat()),
        )
    return token


def _upload_token_valid(token: str | None, node_id: str) -> bool:
    """True, wenn `token` existiert, nicht abgelaufen ist und zu `node_id` gehört."""
    if not token:
        return False
    now = datetime.now(UTC).isoformat()
    with connect() as con:
        row = con.execute(
            "SELECT node_id, expires_at FROM upload_token WHERE token = ?",
            (token,),
        ).fetchone()
    return bool(row and row["expires_at"] >= now and row["node_id"] == node_id)


# Kleiner TTL-Cache für aufgelöste Anzeigenamen (username → (name, expiry_ts)).
# Spart pro Request einen edu-sharing-Roundtrip; 10 Min sind unkritisch, da
# sich Vor-/Nachname praktisch nie ändern.
_DISPLAY_NAME_CACHE: dict[str, tuple[str, float]] = {}
_DISPLAY_NAME_TTL = 600.0
# Obergrenze gegen unbegrenztes Wachstum bei vielen distinkten Usern.
_DISPLAY_NAME_MAX = 4096


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
    from .caches import evict_expired_and_cap

    _DISPLAY_NAME_CACHE[user] = (name, now + _DISPLAY_NAME_TTL)
    evict_expired_and_cap(_DISPLAY_NAME_CACHE, now, _DISPLAY_NAME_MAX)
    return name


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


async def _publish_original_safe(node_id: str, authorization: str | None) -> bool:
    """Best-effort: Original-Knoten öffentlich lesbar machen, damit die
    eingebettete (anonyme) Vorschau/Render nach dem Einsortieren funktioniert.
    edu-sharing publiziert das Original beim Referenzieren NICHT automatisch.
    Scheitert das Publish (z.B. fehlendes ChangePermissions), bleibt der Move
    trotzdem gültig — die Mod kann es über „Vorschau reparieren" nachholen."""
    if not node_id:
        return False
    try:
        await edu_sharing.client.publish_node(node_id, auth_header=authorization)
        return True
    except Exception as e:
        log.warning("publish_node(%s) nach Einsortieren fehlgeschlagen: %s", node_id, e)
        return False


async def _unpublish_original_safe(node_id: str, authorization: str | None) -> bool:
    """Best-effort-Gegenstück zu `_publish_original_safe`: entzieht dem Original
    die öffentliche Freigabe (beim Verstecken/Löschen), damit kein anonym
    erreichbarer Rest übrig bleibt. Scheitert es, bleibt die Aktion gültig."""
    if not node_id:
        return False
    try:
        await edu_sharing.client.unpublish_node(node_id, auth_header=authorization)
        return True
    except Exception as e:
        log.warning("unpublish_node(%s) fehlgeschlagen: %s", node_id, e)
        return False


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
                # Auch im idempotenten Pfad veröffentlichen — heilt Altfälle,
                # die referenziert, aber nie öffentlich gemacht wurden.
                await _publish_original_safe(source_id, authorization)
                return existing
        raise

    ref_node = (result or {}).get("node") or {}
    ref_id = (ref_node.get("ref") or {}).get("id")
    if ref_id:
        try:
            # _upsert_idea ist bewusst SYNCHRON (kann strukturell kein Netz-I/O
            # machen). Threadpool statt Event-Loop: eine Lock-Wartezeit
            # (busy_timeout) darf nur diesen Request bremsen, nicht alle.
            def _cache_reference_row():
                with connect() as con:
                    sync_mod._upsert_idea(
                        con,
                        ref_node,
                        kind="io",
                        topic_id=target_topic_id,
                        main_content_id=ref_id,
                    )

            await asyncio.to_thread(_cache_reference_row)
        except Exception as e:
            log.warning("upsert nach addReference für %s: %s", ref_id, e)
    # Original öffentlich lesbar machen, damit die (anonyme) Vorschau/Render
    # nach dem Einsortieren funktioniert (sonst „insufficient permissions").
    await _publish_original_safe(source_id, authorization)
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


# LIKE-Wildcards in User-Input escapen — `%` und `_` würden sonst als
# Pattern wirken (Mod kann ungewollt z.B. mit `%` alle Datensätze ziehen
# oder Ressourcen via `%%%%...` belasten).
def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _purge_idea_cache(con, idea_id: str) -> None:
    """Entfernt eine Idee samt aller Nebendaten aus dem App-Cache (sonst Waisen).
    Einzige Quelle der Wahrheit dafür, welche Tabellen Ideen-Daten halten —
    genutzt von delete_idea UND der Karteileichen-Bereinigung."""
    con.execute("DELETE FROM idea WHERE id = ?", (idea_id,))
    con.execute("DELETE FROM idea_fts WHERE id = ?", (idea_id,))
    con.execute("DELETE FROM idea_interaction WHERE idea_id = ?", (idea_id,))
    con.execute("DELETE FROM vote_event WHERE idea_id = ?", (idea_id,))
    con.execute("DELETE FROM idea_contact WHERE idea_id = ?", (idea_id,))
    con.execute("DELETE FROM idea_report WHERE idea_id = ?", (idea_id,))
