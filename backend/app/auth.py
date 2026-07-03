"""Authentifizierung & Autorisierung — die Auth-Prädikate der App an einem Ort.

Alle Funktionen arbeiten auf dem rohen HTTP-Basic-`Authorization`-Header (so wie
ihn das Frontend schickt) und sprechen edu-sharing ausschließlich über das
Singleton ``edu_sharing.client`` an — derselbe Mock-Seam, den die Tests nutzen.

Bewusst **keine** HTTP-/Audit-Belange hier: das Werfen von 401/403 und das
Logging fehlgeschlagener Mod-Versuche bleibt in der Route-Schicht
(`routes._require_moderator`), damit dieses Modul rein bleibt und keinen
Rück-Import auf `routes` braucht (Import-Richtung: routes → auth, nie umgekehrt).

Diese Zentralisierung ist zugleich die Naht für einen späteren Wechsel des
Auth-Mechanismus (OAuth/Bearer statt Basic): dann ändert sich nur, was hier an
edu-sharing weitergereicht wird — die Aufrufer bleiben unberührt. Siehe
``docs/AUTH-OAUTH-SPIKE.md``.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import logging
import time

from . import edu_sharing
from .caches import evict_expired_and_cap
from .config import settings
from .db import connect

log = logging.getLogger(__name__)


def decode_basic_user(authorization: str | None) -> str | None:
    """Stabilen User-Key aus dem Basic-Auth-Header ableiten (Base64-dekodierter
    Username). Gibt None zurück, wenn keine Credentials anliegen."""
    if not authorization or not authorization.lower().startswith("basic "):
        return None
    try:
        raw = base64.b64decode(authorization.split(" ", 1)[1]).decode("utf-8", "replace")
        return raw.split(":", 1)[0] or None
    except Exception:
        return None


# Kurz-TTL-Cache für den Moderator-Status (Auth-Hash → (is_mod, expiry_ts)).
# Beseitigt den `my_memberships`-Roundtrip zu edu-sharing bei JEDEM geschützten
# Request (Latenz + harte Kopplung an die ES-Verfügbarkeit). Schlüssel ist ein
# SHA-256 des Headers, nie das Klartext-Credential.
#
# Trade-off (bewusst, dokumentiert in docs/KNOWN-LIMITATIONS.md): entzogene
# Mod-Rechte wirken erst nach Ablauf der TTL. Deshalb kurze TTL; und es werden
# NUR erfolgreich verifizierte Ergebnisse gecacht — ein ES-Fehler/abgelehnte
# Credentials brennen sich nicht als „kein Mod" ein.
_MOD_CACHE: dict[str, tuple[bool, float]] = {}
_MOD_CACHE_TTL = 60.0
# Obergrenze gegen unbegrenztes Wachstum bei vielen distinkten Auth-Headern.
_MOD_CACHE_MAX = 4096


def _auth_cache_key(authorization: str) -> str:
    return hashlib.sha256(authorization.encode("utf-8")).hexdigest()


async def is_moderator(authorization: str | None) -> bool:
    """Bestätigt, ob der eingeloggte User Mod-Rechte hat — ausschließlich über
    Mitgliedschaft in einer der konfigurierten edu-sharing-Gruppen
    (Default: GROUP_ALFRESCO_ADMINISTRATORS).

    Wichtig: der `my_memberships`-Call verifiziert die Credentials gegen
    edu-sharing (falsches Passwort → 401 → kein Mod). Es gibt bewusst KEINEN
    Username-Bootstrap mehr — der vertraute dem unverifizierten Basic-Usernamen
    und war damit ein Auth-Bypass, sobald gesetzt.

    Das Ergebnis wird kurz gecacht (siehe ``_MOD_CACHE``).
    """
    if not authorization:
        return False
    key = _auth_cache_key(authorization)
    now = time.monotonic()
    cached = _MOD_CACHE.get(key)
    if cached and cached[1] > now:
        return cached[0]
    try:
        m = await edu_sharing.client.my_memberships(auth_header=authorization)
        groups = {(g.get("authorityName") or "") for g in (m.get("groups") or [])}
    except Exception:
        # Transienter ES-Fehler oder abgelehnte Credentials → NICHT cachen,
        # damit ein kurzer Ausfall nicht TTL-lang „kein Mod" einbrennt.
        return False
    result = any(g in groups for g in settings.fallback_mod_groups)
    _MOD_CACHE[key] = (result, now + _MOD_CACHE_TTL)
    evict_expired_and_cap(_MOD_CACHE, now, _MOD_CACHE_MAX)
    return result


async def verify_login(authorization: str | None) -> str | None:
    """Verifiziert die Basic-Credentials gegen edu-sharing und liefert den
    bestätigten Usernamen (None = fehlt/ungültig). Für App-DB-only-Schreibpfade,
    bei denen es keinen edu-sharing-Write als Backstop gibt — dort würde sonst
    der UNVERIFIZIERTE Basic-Username genügen (Impersonation). edu-sharing prüft
    user:pass gemeinsam; akzeptiert es den Header, ist der dekodierte Username
    der echte Caller. Ein Call pro (seltener) Schreibaktion; häufige
    Lese-Endpunkte bleiben bewusst ungekoppelt (kein Verfügbarkeits-/Perf-Nachteil).

    Bewusst NICHT gecacht: bei Schreibpfaden soll ein geändertes/entzogenes
    Passwort sofort greifen.
    """
    if not authorization:
        return None
    user = decode_basic_user(authorization)
    if not user:
        return None
    try:
        await edu_sharing.client.my_memberships(auth_header=authorization)
    except Exception:
        return None
    return user


async def is_owner_or_mod(
    idea_id: str, authorization: str | None, *, verified: bool = False
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

    ``verified`` (keyword-only): der Aufrufer sichert zu, dass das Passwort
    geprüft ist — entweder vorab per ``verify_login`` ODER durch einen
    nachgelagerten edu-sharing-Write mit derselben Auth (der das Passwort selbst
    prüft). NUR dann wird der Owner-Treffer über den bloß dekodierten Basic-
    Usernamen akzeptiert. Default ``False`` = fail-closed: ohne diese Zusicherung
    gilt ausschließlich der passwort-verifizierte Mod-Status. Ein vergessenes
    ``verified=True`` sperrt den Owner aus (sichtbarer Bug) statt Impersonation
    per bloßem Username zu erlauben (stiller Auth-Bypass).
    """
    if not authorization:
        return False, None, False
    user = decode_basic_user(authorization)
    if not user:
        return False, None, False
    is_mod = await is_moderator(authorization)
    if is_mod:
        return True, user, True

    # Fail-closed: der Owner-Treffer unten beruht auf dem NUR dekodierten (nicht
    # passwort-geprüften) `user`. Ihn nur zulassen, wenn der Aufrufer die
    # Passwort-Prüfung zusichert (`verified=True`, s. Docstring). Sonst gilt hier
    # ausschließlich der oben passwort-verifizierte Mod-Status.
    if not verified:
        return False, user, False

    # 1. Cache-Check (billig): Owner == eingeloggter (nun verifizierter) User.
    #    Im Threadpool statt direkt auf dem Event-Loop: dieser Lookup liegt auf
    #    JEDEM Edit-/Delete-/Attachment-Pfad — bliebe er auf dem Loop, würde eine
    #    Lock-Wartezeit (busy_timeout bis 30 s) ALLE Requests einfrieren statt
    #    nur diesen einen.
    def _read_owner():
        with connect() as con:
            return con.execute(
                "SELECT owner_username FROM idea WHERE id=?",
                (idea_id,),
            ).fetchone()

    try:
        row = await asyncio.to_thread(_read_owner)
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
        log.debug("is_owner_or_mod: ES-fallback failed for %s: %s", idea_id, e)

    return False, user, False


async def can_edit_idea(
    idea_id: str, authorization: str | None, *, verified: bool = False
) -> tuple[bool, str | None, bool]:
    """Erweitert `is_owner_or_mod` um angenommene Mithackende mit
    Bearbeitungsrecht: idea_interaction (kind='interest', status='approved',
    can_edit=1). Diese „Mitwirkenden" dürfen Beschreibung/Anhänge bearbeiten —
    NICHT löschen/umhängen (das bleibt Owner/Mod).

    Return: (allowed, username, is_owner_or_mod). is_owner_or_mod=False heißt:
    nur als Mitwirkende:r berechtigt (für Endpoints, die mehr verlangen).

    ``verified``: wie bei ``is_owner_or_mod`` — der Owner- UND der Mitwirkenden-
    Treffer vertrauen dem dekodierten Usernamen und werden daher nur bei
    zugesicherter Passwort-Prüfung akzeptiert (fail-closed by default).
    """
    allowed, user, is_mod = await is_owner_or_mod(idea_id, authorization, verified=verified)
    if allowed:
        return True, user, True
    if not user:
        return False, user, False
    # Der Mitwirkenden-Treffer vergleicht ebenfalls den nur dekodierten Username
    # mit idea_interaction.user_key → dieselbe fail-closed-Regel wie beim Owner-
    # Pfad: ohne zugesicherte Verifikation kein Zugriff.
    if not verified:
        return False, user, False

    # Threadpool statt Event-Loop — gleiche Begründung wie der Owner-Lookup in
    # is_owner_or_mod (Hot-Path; Lock-Wartezeit darf nicht den Loop blockieren).
    def _read_collaborator():
        with connect() as con:
            return con.execute(
                "SELECT can_edit, status FROM idea_interaction "
                "WHERE idea_id=? AND user_key=? AND kind='interest'",
                (idea_id, user),
            ).fetchone()

    try:
        row = await asyncio.to_thread(_read_collaborator)
        if row and row["status"] == "approved" and row["can_edit"]:
            return True, user, False
    except Exception as e:
        log.debug("can_edit_idea: collaborator-check failed for %s: %s", idea_id, e)
    return False, user, False
