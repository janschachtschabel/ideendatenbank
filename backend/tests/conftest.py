"""Pytest-Harness für das Ideendatenbank-Backend.

Hermetik: Das Test-Env wird ERZWUNGEN, *bevor* ``app.config`` (Settings) geladen
wird — so geraten niemals die echten (Prod-)edu-sharing-Credentials der Maschine
in die Settings. Der gesamte edu-sharing-Zugriff läuft über das Singleton
``app.edu_sharing.client`` und wird pro Test durch :class:`FakeES` ersetzt; es
fließt damit kein einziger Netz-Call. Jeder Test bekommt eine frische
temporäre SQLite-DB.
"""

from __future__ import annotations

import base64
import json
import os

# --- Test-Env ERZWINGEN, bevor app.config (Settings) importiert wird ---------
# os.environ schlägt .env-Dateien UND vorhandene Prod-Variablen, sodass keine
# echten Credentials/URLs in die Settings geraten. (Der Client ist zusätzlich
# gemockt → ohnehin kein Netz.)
os.environ.update(
    {
        "EDU_REPO_BASE_URL": "http://edu-sharing.invalid",
        "EDU_GUEST_USER": "test-guest",
        "EDU_GUEST_PASS": "test-guest-pass",
        "EDU_GUEST_INBOX_ID": "inbox-collection",
        "IDEENDB_ROOT_COLLECTION_ID": "root-collection",
        "MODERATION_FALLBACK_GROUPS": "GROUP_TEST_ADMINS",
        "APP_CORS_ORIGINS": "http://localhost",
        "BACKUP_ENABLED": "false",
    }
)
os.environ.pop("EDU_REPO_API", None)  # aus BASE_URL ableiten lassen

import httpx  # noqa: E402  (Import nach dem Env-Setup ist beabsichtigt)
import pytest  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402

from app import auth, edu_sharing, routes_common  # noqa: E402
from app.config import settings  # noqa: E402
from app.db import connect, init_db  # noqa: E402
from app.main import app  # noqa: E402

MOD_GROUP = "GROUP_TEST_ADMINS"


def basic_auth(user: str, password: str = "pw") -> str:
    """Baut einen HTTP-Basic-Header, wie ihn das Frontend sendet."""
    token = base64.b64encode(f"{user}:{password}".encode()).decode()
    return f"Basic {token}"


def _decode_basic_user(auth_header: str | None) -> str | None:
    if not auth_header or not auth_header.startswith("Basic "):
        return None
    try:
        decoded = base64.b64decode(auth_header[6:]).decode()
    except Exception:
        return None
    return decoded.split(":", 1)[0] or None


def http_error(status: int, text: str = "") -> httpx.HTTPStatusError:
    """edu-sharing-artiger HTTP-Fehler. `text` füllt den Response-Body (für die
    Rating-Schein-500-vs-echt-403-Unterscheidung, die `e.response.text` prüft)."""
    request = httpx.Request("GET", "http://edu-sharing.invalid")
    response = httpx.Response(status, text=text, request=request)
    return httpx.HTTPStatusError(f"HTTP {status}", request=request, response=response)


class FakeES:
    """In-Memory-Ersatz für ``edu_sharing.client``.

    Zeichnet Aufrufe auf (``calls``), sodass Tests prüfen können, WELCHE
    ES-Methode mit WELCHEN Argumenten lief, und liefert konfigurierbare Daten.
    Nur die in den Tests tatsächlich genutzten Methoden sind implementiert —
    ein unerwarteter Aufruf schlägt laut fehl (AttributeError) statt still
    falsch zu sein.
    """

    def __init__(self) -> None:
        self.mods: set[str] = set()  # Usernamen, die als Moderator gelten
        self.calls: list[tuple[str, dict]] = []
        self.nodes: dict[str, dict] = {}  # node_id -> node-dict (für node_metadata)
        self.inbox_node_ids: set[str] = set()  # Kinder der Inbox-Sammlung
        self.collections: dict[str, dict] = {}  # coll_id -> {subcollections, references}
        self.child_objects: list[dict] = []  # was list_child_objects liefert (Anhang-Zähler)
        self.child_objects_error: bool = False  # True → list_child_objects wirft (z.B. 403)
        self.fail_es: bool = False  # True → my_memberships + Walk werfen (kompletter ES-Ausfall)
        self.fail_collections: bool = False  # True → nur der Sammlungs-Walk wirft (Auth bleibt ok)
        self.add_rating_error: tuple[int, str] | None = None  # (status, body) → add_rating wirft

    def called(self, name: str) -> list[dict]:
        """kwargs aller aufgezeichneten Aufrufe von ``name``."""
        return [kw for (n, kw) in self.calls if n == name]

    def _record(self, name: str, **kw) -> None:
        self.calls.append((name, kw))

    async def my_memberships(self, auth_header: str | None = None, **_) -> dict:
        self._record("my_memberships", auth_header=auth_header)
        if self.fail_es:
            raise http_error(503)
        user = _decode_basic_user(auth_header)
        groups = [{"authorityName": MOD_GROUP}] if user and user in self.mods else []
        return {"groups": groups}

    async def my_profile(self, auth_header: str | None = None, **_) -> dict:
        self._record("my_profile", auth_header=auth_header)
        return {"person": {"profile": {"firstName": "", "lastName": ""}}}

    async def node_children(
        self, node_id: str, max_items: int = 200, skip_count: int = 0, **_
    ) -> dict:
        self._record("node_children", node_id=node_id, skip_count=skip_count)
        if skip_count:  # nur eine Seite — Folge-Seiten leer
            return {"nodes": []}
        return {
            "nodes": [
                {"type": "ccm:io", "ref": {"id": nid}, "properties": {}, "name": nid}
                for nid in sorted(self.inbox_node_ids)
            ]
        }

    async def node_metadata(self, node_id: str, auth_header: str | None = None, **_) -> dict:
        self._record("node_metadata", node_id=node_id, auth_header=auth_header)
        if node_id in self.nodes:
            return {"node": self.nodes[node_id]}
        raise http_error(404)

    async def collection_subcollections(
        self, collection_id: str, max_items: int = 100, **_
    ) -> dict:
        self._record("collection_subcollections", collection_id=collection_id)
        if self.fail_es or self.fail_collections:
            raise http_error(503)
        return {"collections": self.collections.get(collection_id, {}).get("subcollections", [])}

    async def collection_references(
        self, collection_id: str, max_items: int = 200, auth_header=None, **_
    ) -> dict:
        self._record("collection_references", collection_id=collection_id)
        if self.fail_es or self.fail_collections:
            raise http_error(503)
        return {"references": self.collections.get(collection_id, {}).get("references", [])}

    async def add_collection_reference(
        self, collection_id: str, node_id: str, auth_header=None, **_
    ) -> dict:
        self._record("add_collection_reference", collection_id=collection_id, node_id=node_id)
        ref_id = f"ref::{node_id}::{collection_id}"
        return {"node": {"ref": {"id": ref_id}, "properties": {}, "originalId": node_id}}

    async def delete_collection_reference(self, ref_id: str, auth_header=None, **_) -> dict:
        self._record("delete_collection_reference", ref_id=ref_id)
        return {}

    async def add_rating(self, node_id: str, rating, auth_header=None, **_) -> dict:
        if self.add_rating_error is not None:
            raise http_error(*self.add_rating_error)
        self._record("add_rating", node_id=node_id, rating=rating)
        return {}

    async def delete_rating(self, node_id: str, auth_header=None, **_) -> dict:
        self._record("delete_rating", node_id=node_id)
        return {}

    async def publish_node(self, node_id: str, auth_header=None, **_) -> bool:
        self._record("publish_node", node_id=node_id)
        return True

    async def unpublish_node(self, node_id: str, auth_header=None, **_) -> bool:
        self._record("unpublish_node", node_id=node_id)
        return True

    async def delete_node(self, node_id: str, auth_header=None, **_) -> dict:
        self._record("delete_node", node_id=node_id)
        return {}

    async def list_child_objects(self, parent_id: str, auth_header=None, **_) -> list[dict]:
        self._record("list_child_objects", parent_id=parent_id)
        if self.child_objects_error:
            raise http_error(403)
        return list(self.child_objects)

    async def update_metadata(self, node_id: str, *args, **kwargs) -> dict:
        # Flexibel gegenüber positional/keyword props — Tests prüfen nur, DASS
        # der Metadaten-Write am richtigen Knoten erfolgt.
        self._record("update_metadata", node_id=node_id)
        return {}

    async def create_node(self, parent_id: str | None = None, **kwargs) -> dict:
        self._record("create_node", parent_id=parent_id)
        return {"node": {"ref": {"id": "new-node-1"}, "properties": {}}}

    async def create_collection(
        self, parent_id: str | None = None, title: str | None = None, **kwargs
    ) -> dict:
        self._record("create_collection", parent_id=parent_id, title=title)
        return {"collection": {"ref": {"id": f"coll::{title}"}}}

    async def upload_preview(self, node_id: str, *args, **kwargs) -> dict:
        self._record("upload_preview", node_id=node_id)
        return {}

    async def add_child_object(self, parent_id: str | None = None, **kwargs) -> dict:
        self._record("add_child_object", parent_id=parent_id)
        return {"node": {"ref": {"id": f"child::{parent_id}"}}}

    async def upload_content(self, node_id: str, *args, **kwargs) -> dict:
        self._record("upload_content", node_id=node_id)
        return {}

    async def comments(self, node_id: str, *args, **kwargs) -> dict:
        self._record("comments", node_id=node_id)
        return {"comments": []}


@pytest.fixture(autouse=True)
def _fresh_db(tmp_path, monkeypatch):
    """Frische temporäre SQLite-DB pro Test + geleerte In-Memory-Caches.
    Auch das Backup-Verzeichnis wird isoliert — sonst lesen Tests (z.B. der
    /status-Diagnostics-Block via list_backups) echte ZIPs aus ./data/backups
    der Entwickler-Maschine (Hermetik-Loch, vom Backup-Testlauf aufgedeckt)."""
    monkeypatch.setattr(settings, "sqlite_path", tmp_path / "test.sqlite")
    monkeypatch.setattr(settings, "backup_dir", tmp_path / "backups")
    init_db()
    routes_common._DISPLAY_NAME_CACHE.clear()
    auth._MOD_CACHE.clear()  # Mod-Status-Cache pro Test leeren (Isolation)
    auth._MEMBERSHIP_INFLIGHT.clear()  # In-Flight-Coalescing-Registry (defensiv)
    yield
    # Thread-gepoolte Connections deterministisch schließen — sonst halten
    # Worker-Threads die tmp_path-DB des Tests offen (Windows: Datei-Lock →
    # pytest-tmp-Cleanup-Fehler; außerdem sauberer Pfadwechsel zum Folgetest).
    from app.db import invalidate_pooled_connections

    invalidate_pooled_connections()


@pytest.fixture(autouse=True)
def fake_es(monkeypatch) -> FakeES:
    """Ersetzt das edu-sharing-Singleton durch :class:`FakeES` (kein Netz)."""
    fes = FakeES()
    monkeypatch.setattr(edu_sharing, "client", fes)
    return fes


@pytest.fixture
def client() -> TestClient:
    """TestClient OHNE Lifespan (kein Sync-Loop / Auto-Restore im Test)."""
    return TestClient(app)


@pytest.fixture
def mod_headers(fake_es) -> dict:
    """Header eines Moderators (Mitglied der Mod-Gruppe)."""
    fake_es.mods.add("mod")
    return {"Authorization": basic_auth("mod")}


@pytest.fixture
def user_headers() -> dict:
    """Header eines eingeloggten Nicht-Moderators."""
    return {"Authorization": basic_auth("user")}


@pytest.fixture
def seed_idea():
    """Fügt eine minimale Idee-Zeile in den Cache ein (nur NOT-NULL-Pflichtfelder
    + die für Tests relevanten Spalten). Gibt die Insert-Funktion zurück."""

    def _seed(
        idea_id: str,
        *,
        title: str = "Idea",
        kind: str = "io",
        topic_id: str | None = "ch1",
        original_id: str | None = None,
        hidden: int = 0,
        owner_username: str | None = None,
        events: list[str] | None = None,
    ) -> str:
        with connect() as con:
            con.execute(
                "INSERT INTO idea "
                "(id, kind, title, topic_id, original_id, hidden, owner_username, events) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    idea_id,
                    kind,
                    title,
                    topic_id,
                    original_id,
                    hidden,
                    owner_username,
                    json.dumps(events) if events is not None else None,
                ),
            )
        return idea_id

    return _seed


@pytest.fixture
def seed_interaction():
    """Fügt eine idea_interaction-Zeile ein (für Collaborator-Edit-Tests)."""

    def _seed(
        idea_id: str,
        user_key: str,
        *,
        kind: str = "interest",
        status: str = "approved",
        can_edit: int = 1,
    ) -> None:
        with connect() as con:
            con.execute(
                "INSERT INTO idea_interaction "
                "(idea_id, user_key, kind, created_at, status, can_edit) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (idea_id, user_key, kind, "2026-01-01T00:00:00Z", status, can_edit),
            )

    return _seed
