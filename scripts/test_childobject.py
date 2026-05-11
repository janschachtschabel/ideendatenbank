"""Test: Serienobjekte (Child-IO) statt Anhänge-Sammlung.

Hintergrund (Torsten): statt eine ccm:map-Geschwister-Sammlung anzulegen
(was Sammlungs-Schreibrechte erfordert), erzeugen wir das Anhang-Objekt
direkt UNTER dem Inhalts-Knoten der Idee. So entstehen Eltern-Kind-
Beziehungen ohne separate Sammlungs-Hierarchie.

Endpoint:
    POST /node/v1/nodes/-home-/{IDEA_ID}/children/
    ?type=ccm:io
    &renameIfExists=true
    &assocType=ccm:childio
    &versionComment=
    &aspects=ccm:io_childobject

Body: {"cm:name":["filename.png"], "ccm:childobject_order":["0"]}

Tests:
    1. Lege ein Child-IO unter einer existierenden Idee an
    2. Lade Bytes als content via PUT /node/.../content
    3. Lese Children der Idee aus → Child-IO muss erscheinen
    4. Lese Metadata des Child-IO → aspects, parent, childobject_order
    5. Versuche denselben Vorgang für eine FREMDE Idee → erwarten 403
       (oder Schein-200 + silent fail wie beim PATCH metadata)

Ausführung:
    cd C:/Users/jan/staging/Windsurf/ideendatenbank/backend
    .venv/Scripts/python.exe ../scripts/test_childobject.py
"""
from __future__ import annotations

import asyncio
import base64
import json
import sys
import io as _io
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
sys.stdout = _io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

import httpx

# Wir laden Settings über den Backend-Modul-Pfad
from app.config import settings


GUEST_USER = settings.edu_guest_user
GUEST_PASS = settings.edu_guest_pass
GUEST_AUTH = "Basic " + base64.b64encode(
    f"{GUEST_USER}:{GUEST_PASS}".encode()
).decode()

# Konfigurierbare Test-Modi:
TEST_TARGETS = [
    # (Label, Repo-API, Idee-ID)
    # Prod mit Fremd-Idee — erwarten 403 (Permission-Verweigerung)
    (
        "PROD / Fremd-Idee (Schule im Aufbruch — gehört Farina)",
        "https://redaktion.openeduhub.net/edu-sharing/rest",
        "1d58807c-918c-438e-9880-7c918cf38e79",
    ),
    # Staging — Torstens Original-Beispiel-ID
    (
        "STAGING / Torstens Beispiel-ID",
        "https://repository.staging.openeduhub.net/edu-sharing/rest",
        "9ab52a97-f26f-4b15-92e7-264d10be1476",
    ),
    # Prod / Test-Idee, die wir selbst per Inbox-Submit anlegen
    # → wird unten dynamisch erzeugt; ID-Platzhalter wird ersetzt
    (
        "PROD / eigene Idee (frisch über Submit-Flow angelegt, Gast = Owner)",
        "https://redaktion.openeduhub.net/edu-sharing/rest",
        "<DYNAMIC>",
    ),
]


async def step(label: str, coro):
    print(f"\n{'=' * 70}")
    print(f"  {label}")
    print("=" * 70)
    try:
        result = await coro
        return result
    except httpx.HTTPStatusError as e:
        print(f"  ✗ HTTP {e.response.status_code}")
        print(f"  Body: {e.response.text[:400]}")
        return None
    except Exception as e:
        print(f"  ✗ Exception: {type(e).__name__}: {e}")
        return None


async def create_child_object(
    client: httpx.AsyncClient,
    repo_api: str,
    parent_id: str,
    filename: str,
    order: int = 0,
) -> dict | None:
    """Legt einen ccm:io-Child unter dem gegebenen Parent-IO an."""
    url = f"{repo_api}/node/v1/nodes/-home-/{parent_id}/children/"
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
    headers = {
        "Authorization": GUEST_AUTH,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    print(f"  POST {url}")
    print(f"  params: {params}")
    print(f"  body:   {body}")
    r = await client.post(url, params=params, json=body, headers=headers, timeout=30)
    print(f"  → HTTP {r.status_code}")
    r.raise_for_status()
    return r.json()


async def upload_content(
    client: httpx.AsyncClient,
    repo_api: str,
    node_id: str,
    file_bytes: bytes,
    filename: str,
    mimetype: str,
) -> dict | None:
    """Lädt Datei-Bytes als content auf den Knoten."""
    url = f"{repo_api}/node/v1/nodes/-home-/{node_id}/content"
    params = {"mimetype": mimetype, "versionComment": "Initial upload"}
    headers = {"Authorization": GUEST_AUTH, "Accept": "application/json"}
    files = {"file": (filename, file_bytes, mimetype)}
    print(f"  POST {url}  ({len(file_bytes)} Bytes, {mimetype})")
    r = await client.post(url, params=params, headers=headers, files=files, timeout=60)
    print(f"  → HTTP {r.status_code}")
    r.raise_for_status()
    return r.json() if r.headers.get("content-type", "").startswith("application/json") else None


async def list_children(
    client: httpx.AsyncClient, repo_api: str, parent_id: str,
) -> dict | None:
    url = f"{repo_api}/node/v1/nodes/-home-/{parent_id}/children"
    params = {"propertyFilter": "-all-"}
    headers = {"Authorization": GUEST_AUTH, "Accept": "application/json"}
    r = await client.get(url, params=params, headers=headers, timeout=30)
    print(f"  GET {url} → HTTP {r.status_code}")
    r.raise_for_status()
    return r.json()


async def get_metadata(
    client: httpx.AsyncClient, repo_api: str, node_id: str,
) -> dict | None:
    url = f"{repo_api}/node/v1/nodes/-home-/{node_id}/metadata"
    headers = {"Authorization": GUEST_AUTH, "Accept": "application/json"}
    r = await client.get(
        url, params={"propertyFilter": "-all-"}, headers=headers, timeout=30,
    )
    print(f"  GET metadata({node_id[:8]}…) → HTTP {r.status_code}")
    r.raise_for_status()
    return r.json()


async def submit_test_idea_to_inbox(
    client: httpx.AsyncClient, repo_api: str,
) -> str | None:
    """Lege eine Test-Idee in der Gast-Inbox an (Owner = WLO-Upload).
    Damit Permissions garantiert in Ordnung sind für nachfolgende Tests."""
    inbox_id = settings.edu_guest_inbox_id
    url = f"{repo_api}/node/v1/nodes/-home-/{inbox_id}/children"
    params = {"type": "ccm:io", "renameIfExists": "true"}
    body = {
        "cm:name": ["test-childobject-parent.html"],
        "cm:title": ["Test-Idee für Child-Object-Test"],
    }
    headers = {
        "Authorization": GUEST_AUTH,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    print(f"  POST {url}")
    r = await client.post(url, params=params, json=body, headers=headers, timeout=30)
    print(f"  → HTTP {r.status_code}")
    r.raise_for_status()
    new = ((r.json().get("node") or {}).get("ref") or {}).get("id")
    print(f"  ✓ Neue Test-Idee: {new}")
    return new


async def cleanup(client: httpx.AsyncClient, repo_api: str, node_id: str) -> None:
    url = f"{repo_api}/node/v1/nodes/-home-/{node_id}"
    headers = {"Authorization": GUEST_AUTH}
    try:
        r = await client.delete(url, headers=headers, timeout=30)
        print(f"  DELETE {node_id[:8]}… → HTTP {r.status_code}")
    except Exception as e:
        print(f"  DELETE {node_id[:8]}… error: {e}")


async def run_one_test(
    label: str, repo_api: str, parent_id: str,
    cleanup_at_end: bool = True,
) -> dict:
    """Führt den Test-Zyklus für ein Target durch und gibt ein Ergebnis-Dict zurück."""
    print(f"\n\n{'#' * 75}")
    print(f"# {label}")
    print(f"# Repo:     {repo_api}")
    print(f"# Idee-ID:  {parent_id}")
    print("#" * 75)

    result = {
        "label": label,
        "repo_api": repo_api,
        "parent_id": parent_id,
        "create_status": None,
        "create_body": None,
        "child_id": None,
        "verified": False,
    }

    async with httpx.AsyncClient() as client:
        # Baseline
        await step("1. Children-Baseline", list_children(client, repo_api, parent_id))

        # Anlegen
        timestamp = "20260508"
        filename = f"test-childobject-{timestamp}.txt"
        try:
            r = await create_child_object(
                client, repo_api, parent_id, filename, order=0,
            )
            result["create_status"] = 200
            child_id = ((r.get("node") or {}).get("ref") or {}).get("id")
            result["child_id"] = child_id
            print(f"  ✓ Child-IO: {child_id}")
        except httpx.HTTPStatusError as e:
            result["create_status"] = e.response.status_code
            result["create_body"] = e.response.text[:300]
            print(f"  ✗ HTTP {e.response.status_code}: {e.response.text[:200]}")
            return result
        except Exception as e:
            result["create_body"] = str(e)
            print(f"  ✗ {e}")
            return result

        # Content
        try:
            test_bytes = b"Hallo aus dem Child-Object-Test."
            await upload_content(
                client, repo_api, child_id, test_bytes,
                filename, "text/plain;charset=utf-8",
            )
            print("  ✓ Content hochgeladen")
        except Exception as e:
            print(f"  ⚠ Content-Upload fehlgeschlagen: {e}")

        # Verify
        try:
            r = await list_children(client, repo_api, parent_id)
            children = r.get("nodes") or []
            verified = any(
                (c.get("ref") or {}).get("id") == child_id for c in children
            )
            result["verified"] = verified
            print(f"  → Children jetzt: {len(children)}")
            for c in children:
                marker = "  ✓" if (c.get("ref") or {}).get("id") == child_id else "   "
                print(f"  {marker} {c.get('name')!r}")
        except Exception as e:
            print(f"  ⚠ Verify fehlgeschlagen: {e}")

        # Metadata-Inspect
        try:
            md = await get_metadata(client, repo_api, child_id)
            node = md.get("node") or {}
            props = node.get("properties") or {}
            print(f"  parent.id: {(node.get('parent') or {}).get('id')}")
            print(f"  aspects:   {[a for a in node.get('aspects') or [] if 'childobject' in a.lower()]}")
            print(f"  childobject_order: {props.get('ccm:childobject_order')}")
            print(f"  cm:owner:  {props.get('cm:owner')}")
        except Exception as e:
            print(f"  ⚠ Metadata-Inspect fehlgeschlagen: {e}")

        # Cleanup
        if cleanup_at_end and child_id:
            print("  Cleanup:")
            await cleanup(client, repo_api, child_id)

    return result


async def main() -> None:
    print("=" * 75)
    print("  Child-Object-Test (Serienobjekte statt Anhänge-Sammlung)")
    print("=" * 75)
    print(f"  Guest: {GUEST_USER}")

    summary: list[dict] = []

    # Test 1+2: feste Targets (prod-Fremd-Idee, staging-Beispiel)
    for label, repo_api, parent_id in TEST_TARGETS[:2]:
        if parent_id == "<DYNAMIC>":
            continue
        try:
            r = await run_one_test(label, repo_api, parent_id)
            summary.append(r)
        except Exception as e:
            print(f'\n✗ Fataler Fehler bei „{label}": {e}')

    # Test 3: prod / eigene Idee anlegen + Child-Object darauf
    print("\n\n" + "#" * 75)
    print("# Vorbereitung: eigene Test-Idee in PROD-Inbox anlegen (Gast = Owner)")
    print("#" * 75)
    own_idea_id: str | None = None
    async with httpx.AsyncClient() as client:
        try:
            own_idea_id = await submit_test_idea_to_inbox(
                client, "https://redaktion.openeduhub.net/edu-sharing/rest",
            )
        except Exception as e:
            print(f"  ✗ Konnte keine eigene Idee anlegen: {e}")

    if own_idea_id:
        r = await run_one_test(
            "PROD / eigene Idee (Gast = Owner)",
            "https://redaktion.openeduhub.net/edu-sharing/rest",
            own_idea_id,
        )
        summary.append(r)
        # Test-Idee selbst auch wegräumen
        async with httpx.AsyncClient() as client:
            await cleanup(
                client, "https://redaktion.openeduhub.net/edu-sharing/rest", own_idea_id,
            )

    # Gesamt-Übersicht
    print("\n\n" + "=" * 75)
    print("  GESAMT-ZUSAMMENFASSUNG")
    print("=" * 75)
    for r in summary:
        emoji = "✓" if r["verified"] else "✗"
        status = r["create_status"] or "?"
        print(f"  {emoji}  HTTP {status:>3}  {r['label']}")
        if not r["verified"] and r.get("create_body"):
            short = (r["create_body"] or "")[:140].replace("\n", " ")
            print(f"        Body: {short}")


if __name__ == "__main__":
    asyncio.run(main())
