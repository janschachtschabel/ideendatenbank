"""Explore edu-sharing API: what works for our Ideendatenbank use case.

Runs read-only tests against redaktion.openeduhub.net as the WLO-Upload guest.
Prints a markdown-ish report to stdout.
"""
from __future__ import annotations

import json
import sys
from base64 import b64encode
from urllib import request as urlrequest
from urllib.error import HTTPError

import os

BASE = "https://redaktion.openeduhub.net/edu-sharing/rest"
USER = os.environ.get("EDU_GUEST_USER", "")
PASS = os.environ.get("EDU_GUEST_PASS", "")
INBOX = "21144164-30c0-4c01-ae16-264452197063"
ROOT_COLLECTION = "4197d4d2-c700-400c-97d4-d2c700900c68"  # HackathOERn-Ideensammlung

if not USER or not PASS:
    sys.stderr.write(
        "Setze EDU_GUEST_USER und EDU_GUEST_PASS als Umgebungsvariablen,\n"
        "bevor du dieses Probe-Skript aufrufst.\n"
    )
    sys.exit(2)

AUTH_HEADER = "Basic " + b64encode(f"{USER}:{PASS}".encode()).decode()


def call(method: str, path: str, body: dict | None = None, auth: bool = True) -> tuple[int, dict | str]:
    url = BASE + path
    data = None
    headers = {"Accept": "application/json"}
    if auth:
        headers["Authorization"] = AUTH_HEADER
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urlrequest.Request(url, data=data, headers=headers, method=method)
    try:
        with urlrequest.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            try:
                return resp.status, json.loads(raw)
            except json.JSONDecodeError:
                return resp.status, raw[:400]
    except HTTPError as e:
        body_txt = e.read().decode("utf-8", errors="replace")[:400]
        return e.code, body_txt


def h(title: str) -> None:
    print(f"\n=== {title} ===")


def show(status: int, data) -> None:
    if isinstance(data, dict):
        keys = list(data.keys())[:10]
        print(f"  status={status}  keys={keys}")
    else:
        print(f"  status={status}  body={str(data)[:200]}")


def main() -> None:
    h("1. Auth: who am I?")
    s, d = call("GET", "/authentication/v1/validateSession")
    show(s, d)
    if isinstance(d, dict):
        print("  statusCode:", d.get("statusCode"))

    h("2. Guest home folder (where anonymous uploads would land)")
    s, d = call("GET", f"/node/v1/nodes/-home-/{INBOX}/metadata")
    show(s, d)

    h("3. Volltextsuche: 'Idee' auf mds_oeh / ngsearch")
    body = {
        "criteria": [{"property": "ngsearchword", "values": ["Idee"]}],
        "facets": [],
    }
    s, d = call(
        "POST",
        "/search/v1/queries/-home-/mds_oeh/ngsearch?contentType=ALL&maxItems=3&skipCount=0",
        body=body,
    )
    show(s, d)
    if isinstance(d, dict) and "nodes" in d:
        for n in d["nodes"][:3]:
            print(f"   - {n.get('ref',{}).get('id')} | {n.get('type')} | {n.get('title') or n.get('name')}")

    h("4. Sammlungen-Suche ('HackathOERn')")
    body = {"criteria": [{"property": "ngsearchword", "values": ["HackathOERn"]}]}
    s, d = call(
        "POST",
        "/search/v1/queries/-home-/mds_oeh/ngsearch?contentType=COLLECTIONS&maxItems=5",
        body=body,
    )
    show(s, d)
    if isinstance(d, dict) and "nodes" in d:
        for n in d["nodes"][:5]:
            print(f"   - {n.get('ref',{}).get('id')} | {n.get('title') or n.get('name')}")

    h("5. Rating/Kommentare-Test: brauchen eine bekannte ccm:io NodeId")
    body = {"criteria": [{"property": "ngsearchword", "values": ["Mathematik"]}]}
    s, d = call(
        "POST",
        "/search/v1/queries/-home-/mds_oeh/ngsearch?contentType=FILES&maxItems=1",
        body=body,
    )
    if isinstance(d, dict) and d.get("nodes"):
        node_id = d["nodes"][0]["ref"]["id"]
        print(f"  Beispiel-Node: {node_id}")

        h("5a. GET /rating/v1/ratings/-home-/{nodeId}")
        s2, d2 = call("GET", f"/rating/v1/ratings/-home-/{node_id}")
        show(s2, d2)

        h("5b. GET /comment/v1/comments/-home-/{nodeId}")
        s3, d3 = call("GET", f"/comment/v1/comments/-home-/{node_id}")
        show(s3, d3)

        h("5c. Rating auf Sammlung? (COLLECTIONS-Treffer wählen)")
        body2 = {"criteria": [{"property": "ngsearchword", "values": ["Mathematik"]}]}
        s4, d4 = call(
            "POST",
            "/search/v1/queries/-home-/mds_oeh/ngsearch?contentType=COLLECTIONS&maxItems=1",
            body=body2,
        )
        if isinstance(d4, dict) and d4.get("nodes"):
            cid = d4["nodes"][0]["ref"]["id"]
            print(f"  Beispiel-Collection: {cid}")
            s5, d5 = call("GET", f"/rating/v1/ratings/-home-/{cid}")
            show(s5, d5)

    h("6. HackathOERn-Root-Sammlung: Metadaten")
    s, d = call("GET", f"/collection/v1/collections/-home-/{ROOT_COLLECTION}")
    show(s, d)
    if isinstance(d, dict) and d.get("collection"):
        c = d["collection"]
        print(f"  title={c.get('title')}  scope={c.get('scope')}  type={c.get('type')}")

    h("7. HackathOERn-Root: Untersammlungen (children, folders only)")
    s, d = call(
        "GET",
        f"/collection/v1/collections/-home-/{ROOT_COLLECTION}/children/collections?maxItems=20",
    )
    show(s, d)
    if isinstance(d, dict) and d.get("collections"):
        for c in d["collections"][:20]:
            print(f"   - {c.get('ref',{}).get('id')} | {c.get('title')}")

    h("8. HackathOERn-Root: enthaltene Inhalte (references/ccm:io)")
    s, d = call(
        "GET",
        f"/collection/v1/collections/-home-/{ROOT_COLLECTION}/children/references?maxItems=20",
    )
    show(s, d)
    if isinstance(d, dict) and d.get("references"):
        for r in d["references"][:20]:
            print(f"   - {r.get('ref',{}).get('id')} | {r.get('title') or r.get('name')}")

    h("9. Sort-Felder testen: modifiedAt absteigend")
    body = {"criteria": [{"property": "ngsearchword", "values": ["*"]}]}
    s, d = call(
        "POST",
        "/search/v1/queries/-home-/mds_oeh/ngsearch?contentType=ALL&maxItems=2&sortProperties=cm:modified&sortAscending=false",
        body=body,
    )
    show(s, d)
    if isinstance(d, dict) and d.get("nodes"):
        for n in d["nodes"]:
            print(f"   modifiedAt={n.get('modifiedAt')}  title={n.get('title') or n.get('name')}")


if __name__ == "__main__":
    sys.exit(main() or 0)
