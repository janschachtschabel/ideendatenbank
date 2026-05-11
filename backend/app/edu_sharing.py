"""Thin edu-sharing REST client.

Read-only operations work unauthenticated against the guest account.
Write operations accept an optional Authorization header (Basic-Auth from the
browser session) for pass-through — the backend never stores user credentials.
"""
from __future__ import annotations

from base64 import b64encode
from typing import Any

import httpx

from .config import settings


def _guest_auth_header() -> str:
    raw = f"{settings.edu_guest_user}:{settings.edu_guest_pass}".encode()
    return "Basic " + b64encode(raw).decode()


class EduSharingClient:
    def __init__(self, base: str | None = None) -> None:
        self.base = (base or settings.edu_repo_api).rstrip("/")
        self._client = httpx.AsyncClient(timeout=30.0)

    async def close(self) -> None:
        await self._client.aclose()

    async def _req(
        self,
        method: str,
        path: str,
        *,
        json: Any | None = None,
        content: bytes | str | None = None,
        content_type: str = "application/json",
        params: dict | None = None,
        auth_header: str | None = None,
        skip_auth: bool = False,
        timeout: float | None = None,
    ) -> Any:
        headers = {"Accept": "application/json"}
        if not skip_auth:
            headers["Authorization"] = auth_header or _guest_auth_header()
        if json is not None or content is not None:
            headers["Content-Type"] = content_type
        r = await self._client.request(
            method,
            self.base + path,
            json=json if content is None else None,
            content=content,
            params=params,
            headers=headers,
            timeout=timeout if timeout is not None else httpx.USE_CLIENT_DEFAULT,
        )
        r.raise_for_status()
        if r.headers.get("content-type", "").startswith("application/json"):
            return r.json()
        return r.text

    # ---- Collections ----
    async def get_collection(self, node_id: str, *, auth_header: str | None = None) -> dict:
        return await self._req(
            "GET", f"/collection/v1/collections/-home-/{node_id}",
            auth_header=auth_header,
        )

    async def collection_subcollections(
        self, node_id: str, max_items: int = 100, *, auth_header: str | None = None,
    ) -> dict:
        return await self._req(
            "GET",
            f"/collection/v1/collections/-home-/{node_id}/children/collections",
            params={"maxItems": max_items, "propertyFilter": "-all-"},
            auth_header=auth_header,
        )

    async def collection_references(
        self, node_id: str, max_items: int = 100, *, auth_header: str | None = None,
    ) -> dict:
        return await self._req(
            "GET",
            f"/collection/v1/collections/-home-/{node_id}/children/references",
            params={"maxItems": max_items, "propertyFilter": "-all-"},
            auth_header=auth_header,
        )

    # ---- Nodes ----
    async def node_metadata(
        self,
        node_id: str,
        property_filter: str = "-all-",
        *,
        auth_header: str | None = None,
    ) -> dict:
        return await self._req(
            "GET",
            f"/node/v1/nodes/-home-/{node_id}/metadata",
            params={"propertyFilter": property_filter},
            auth_header=auth_header,
        )

    async def node_children(
        self,
        node_id: str,
        max_items: int = 100,
        *,
        skip_count: int = 0,
        sort_prop: str | None = None,
        sort_asc: bool = True,
        auth_header: str | None = None,
    ) -> dict:
        params: dict[str, Any] = {
            "maxItems": max_items,
            "skipCount": skip_count,
            "propertyFilter": "-all-",
        }
        if sort_prop:
            params["sortProperties"] = sort_prop
            params["sortAscending"] = str(sort_asc).lower()
        return await self._req(
            "GET",
            f"/node/v1/nodes/-home-/{node_id}/children",
            params=params,
            auth_header=auth_header,
        )

    # ---- IAM / Memberships / Group-Mitglieder ----
    async def my_memberships(self, *, auth_header: str) -> dict:
        # `maxItems` ohne Wert paginiert auf 10 — User in vielen Gruppen
        # liefen durch das Cap, dann fehlte die Admin-Gruppe in der Antwort.
        return await self._req(
            "GET",
            "/iam/v1/people/-home-/-me-/memberships",
            params={"maxItems": 200, "skipCount": 0},
            auth_header=auth_header,
        )

    async def search_people(
        self, pattern: str, max_items: int = 25, *, auth_header: str | None = None
    ) -> dict:
        return await self._req(
            "GET",
            "/iam/v1/people/-home-",
            params={"pattern": pattern, "maxItems": max_items},
            auth_header=auth_header,
        )

    async def get_group(
        self, group: str, *, auth_header: str | None = None
    ) -> dict:
        return await self._req(
            "GET",
            f"/iam/v1/groups/-home-/{group}",
            auth_header=auth_header,
        )

    async def group_members(
        self, group: str, max_items: int = 200, *, auth_header: str | None = None
    ) -> dict:
        return await self._req(
            "GET",
            f"/iam/v1/groups/-home-/{group}/members",
            params={"maxItems": max_items},
            auth_header=auth_header,
        )

    async def add_group_member(
        self, group: str, member: str, *, auth_header: str
    ) -> Any:
        return await self._req(
            "PUT",
            f"/iam/v1/groups/-home-/{group}/members/{member}",
            auth_header=auth_header,
        )

    async def remove_group_member(
        self, group: str, member: str, *, auth_header: str
    ) -> Any:
        return await self._req(
            "DELETE",
            f"/iam/v1/groups/-home-/{group}/members/{member}",
            auth_header=auth_header,
        )

    # ---- Comments ----
    async def comments(self, node_id: str, *, auth_header: str | None = None) -> dict:
        """Liest Kommentare und de-escaped alte Einträge, die durch einen
        früheren Bug als JSON-stringified Text gespeichert wurden
        (Format: `"…\\u00f6…"` mit literalen Quotes + Unicode-Escapes).
        Heuristik: wenn Body in Quotes eingeschlossen ist und gültiges
        JSON ist, parsen wir's und nutzen den dekodierten String."""
        result = await self._req(
            "GET", f"/comment/v1/comments/-home-/{node_id}",
            auth_header=auth_header,
        )
        for c in (result or {}).get("comments") or []:
            body = c.get("comment")
            if (isinstance(body, str)
                    and len(body) >= 2
                    and body[0] == '"' and body[-1] == '"'):
                try:
                    import json as _json
                    decoded = _json.loads(body)
                    if isinstance(decoded, str):
                        c["comment"] = decoded
                except Exception:
                    pass
        return result

    async def add_comment(
        self, node_id: str, comment: str, reply_to: str | None = None, *, auth_header: str
    ) -> Any:
        """edu-sharing speichert den Request-Body 1:1 als Comment-Text —
        es findet KEINE JSON-Deserialisierung statt. Aktueller Endpoint
        (Stand 05/2026) erwartet aber `application/json` als Content-Type
        (sonst 415 Unsupported Media Type) und liest die rohen UTF-8 Bytes
        als Comment-Text aus dem Body.
        Frühere Variante `text/plain;charset=utf-8` wird abgewiesen (415).
        Reply-to einen Eltern-Kommentar via Query-Param `commentReference`."""
        params: dict[str, str] = {}
        if reply_to:
            params["commentReference"] = reply_to
        return await self._req(
            "PUT",
            f"/comment/v1/comments/-home-/{node_id}",
            params=params or None,
            content=comment.encode("utf-8"),
            content_type="application/json;charset=UTF-8",
            auth_header=auth_header,
        )

    async def delete_comment(self, comment_id: str, *, auth_header: str) -> Any:
        return await self._req(
            "DELETE",
            f"/comment/v1/comments/-home-/{comment_id}",
            auth_header=auth_header,
        )

    # ---- Node creation ----
    async def create_node(
        self,
        parent_id: str,
        *,
        node_type: str = "ccm:io",
        rename_if_exists: bool = True,
        properties: dict[str, list[str]],
        auth_header: str | None = None,
    ) -> dict:
        """Create a child node under parent_id with initial properties.
        Returns the created node metadata (keys: 'node')."""
        params = {"type": node_type, "renameIfExists": str(rename_if_exists).lower()}
        return await self._req(
            "POST",
            f"/node/v1/nodes/-home-/{parent_id}/children",
            json=properties,
            params=params,
            auth_header=auth_header,
        )

    async def delete_node(self, node_id: str, *, auth_header: str | None = None) -> Any:
        return await self._req(
            "DELETE",
            f"/node/v1/nodes/-home-/{node_id}",
            auth_header=auth_header,
        )

    async def set_node_permission(
        self,
        node_id: str,
        *,
        username: str,
        permission: str = "Coordinator",
        auth_header: str | None = None,
    ) -> Any:
        """Grants `permission` (default: Coordinator = full rights) to a USER
        on a node. Used after a guest-created idea so the actual submitter can
        edit / delete it later. Caller must have ChangePermissions on the node
        (Owner = guest hat das automatisch)."""
        body = {
            "inherited": True,
            "permissions": [
                {
                    "authority": {
                        "authorityName": username,
                        "authorityType": "USER",
                    },
                    "permissions": [permission],
                }
            ],
        }
        return await self._req(
            "POST",
            f"/node/v1/nodes/-home-/{node_id}/permissions",
            json=body,
            params={"sendMail": "false", "sendCopy": "false"},
            auth_header=auth_header,
        )

    async def add_child_object(
        self,
        parent_id: str,
        *,
        filename: str,
        order: int = 0,
        auth_header: str | None = None,
    ) -> dict:
        """Legt einen Serienobjekt-Child unter einem ccm:io-Hauptknoten an
        (siehe Skill `wlo-childobjects`).

        Verwendet `assocType=ccm:childio` und `aspects=ccm:io_childobject`.
        Auth muss Schreibrechte am Eltern-IO haben — sonst 403.
        Returns das Node-Objekt mit `node.ref.id` für nachgelagerte
        Content-Uploads.
        """
        params = {
            "type": "ccm:io",
            "renameIfExists": "true",
            "assocType": "ccm:childio",
            "versionComment": "",
            "aspects": "ccm:io_childobject",
        }
        body = {
            "cm:name": [filename],
            "ccm:childobject_order": [str(order)],
        }
        return await self._req(
            "POST",
            f"/node/v1/nodes/-home-/{parent_id}/children/",
            json=body,
            params=params,
            auth_header=auth_header,
        )

    async def list_child_objects(
        self,
        parent_id: str,
        *,
        auth_header: str | None = None,
    ) -> list[dict]:
        """Liest direkte Children eines ccm:io-Hauptknotens und filtert auf
        solche mit dem `ccm:io_childobject`-Aspekt. Andere Children
        (Versionen, etc.) werden ausgeklammert."""
        result = await self.node_children(
            parent_id, max_items=200, auth_header=auth_header,
        )
        if not isinstance(result, dict):
            return []
        out: list[dict] = []
        for n in result.get("nodes") or []:
            if "ccm:io_childobject" in (n.get("aspects") or []):
                out.append(n)
        # Sortieren nach childobject_order, dann nach createdAt als Tie-Breaker
        def _sort_key(n: dict) -> tuple:
            props = n.get("properties") or {}
            order_str = (props.get("ccm:childobject_order") or ["999"])[0]
            try:
                order = int(order_str)
            except (ValueError, TypeError):
                order = 999
            return (order, n.get("createdAt") or "")
        out.sort(key=_sort_key)
        return out

    async def upload_content(
        self,
        node_id: str,
        file_bytes: bytes,
        filename: str,
        mimetype: str,
        *,
        version_comment: str = "Initial upload via Ideendatenbank",
        auth_header: str,
    ) -> Any:
        """Lädt eine Datei als content eines bestehenden ccm:io. Multipart mit
        Feld `file`. mimetype + versionComment sind Query-Params."""
        headers = {
            "Accept": "application/json",
            "Authorization": auth_header,
        }
        params = {"mimetype": mimetype, "versionComment": version_comment}
        files = {"file": (filename, file_bytes, mimetype)}
        r = await self._client.post(
            f"{self.base}/node/v1/nodes/-home-/{node_id}/content",
            params=params,
            files=files,
            headers=headers,
            timeout=120.0,
        )
        r.raise_for_status()
        if r.headers.get("content-type", "").startswith("application/json"):
            return r.json()
        return r.text

    async def upload_preview(
        self,
        node_id: str,
        image_bytes: bytes,
        filename: str,
        mimetype: str,
        *,
        auth_header: str,
    ) -> Any:
        """Setzt das Vorschaubild eines Nodes. Multipart mit Feld `image`."""
        headers = {
            "Accept": "application/json",
            "Authorization": auth_header,
        }
        params = {"mimetype": mimetype}
        files = {"image": (filename, image_bytes, mimetype)}
        r = await self._client.post(
            f"{self.base}/node/v1/nodes/-home-/{node_id}/preview",
            params=params,
            files=files,
            headers=headers,
            timeout=60.0,
        )
        r.raise_for_status()
        if r.headers.get("content-type", "").startswith("application/json"):
            return r.json()
        return r.text

    async def create_collection(
        self,
        parent_id: str,
        *,
        title: str,
        description: str | None = None,
        color: str | None = None,
        type_: str = "EDITORIAL",
        auth_header: str | None = None,
    ) -> dict:
        """Erstellt eine Sub-Sammlung (ccm:map) unter parent_id.

        edu-sharing's collection-create-Body braucht ein `Node`-artiges Objekt
        mit `title` + `name` auf Top-Level UND einem `collection`-Sub-Objekt.
        Keywords lassen sich hier nicht direkt setzen — dafür muss anschließend
        `update_metadata()` mit `cclom:general_keyword` gerufen werden.
        """
        body = {
            "title": title,
            "name": title,
            "collection": {
                "title": title,
                "description": description or "",
                "color": color or "#002855",
                "type": type_,
            },
        }
        return await self._req(
            "POST",
            f"/collection/v1/collections/-home-/{parent_id}/children",
            json=body,
            auth_header=auth_header,
        )

    async def update_metadata(
        self,
        node_id: str,
        properties: dict[str, list[str]],
        *,
        auth_header: str | None = None,
    ) -> Any:
        """Merge-Update of properties on an existing node. Only listed fields
        are touched; others stay as-is. Caller must hold Write permission."""
        return await self._req(
            "PUT",
            f"/node/v1/nodes/-home-/{node_id}/metadata",
            json=properties,
            auth_header=auth_header,
        )

    async def move_node(
        self, source_id: str, target_parent_id: str, *, auth_header: str | None = None
    ) -> dict:
        """Move a node to become a child of target_parent_id.
        edu-sharing signature: POST /children/_move?source={sourceId} on the
        TARGET parent. Returns NodeEntry."""
        return await self._req(
            "POST",
            f"/node/v1/nodes/-home-/{target_parent_id}/children/_move",
            params={"source": source_id},
            auth_header=auth_header,
        )

    # Self-registration: derzeit nicht via Backend-Proxy.
    # `POST /register/v1/register` auf redaktion.openeduhub.net hängt in einem
    # synchronen Mail-Hook und liefert nach 50s einen Ingress-Disconnect ohne
    # User anzulegen. Frontend leitet stattdessen auf wirlernenonline.de/register
    # weiter. Wenn der Server-Bug behoben ist, hier register_new()/register_exists()
    # wieder reaktivieren (siehe wlo-register Skill).

    # ---- Rating ----
    async def add_rating(
        self, node_id: str, rating: float, text: str = " ", *, auth_header: str
    ) -> Any:
        """Submit or update a rating (1..5, or 0 to reset).

        edu-sharing erwartet den Rating-Wert als **Integer-String** in der
        URL (z.B. `?rating=4`). Wenn httpx einen `float 4.0` serialisiert,
        landet `rating=4.0` in der URL, was edu-sharing verwirft → das
        Rating wird NICHT gespeichert und ein 500 kommt zurück.
        Daher: bei ganzzahligen Werten als int formatieren.
        Body ist ein JSON-String (mit Quotes); leeres `" "` reicht
        edu-sharing.
        """
        rating_param = str(int(rating)) if float(rating).is_integer() else str(rating)
        body = ('"' + (text or " ") + '"').encode("utf-8")
        return await self._req(
            "PUT",
            f"/rating/v1/ratings/-home-/{node_id}",
            params={"rating": rating_param},
            content=body,
            content_type="application/json",
            auth_header=auth_header,
        )


client = EduSharingClient()
