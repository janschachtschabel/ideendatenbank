"""Cache-Control für statische Assets (Performance-Fix).

Pinnt den Fix gegen die langsame Navigation hinter einem HTTP/2-Reverse-Proxy
(Caddy): versionierte Bundles (Cache-Bust über ?v=) dürfen `immutable` sein,
damit der Browser sie nach dem ersten Besuch NICHT mehr neu anfordert und die
einzige HTTP/2-Verbindung frei für die API-XHRs bleibt. index.html bleibt
`no-cache`, damit ein neues Deploy (neuer ?v=) sofort greift. Der Header wird
von der App gesetzt → wirkt identisch hinter nginx (HTTP/1.1) und Caddy (HTTP/2).

Hermetisch: nutzt ein temporäres Verzeichnis statt des echten Frontend-Builds,
läuft also auch in CI ohne gebautes Bundle.
"""

from __future__ import annotations

from fastapi import FastAPI
from starlette.testclient import TestClient

from app.main import CachedStaticFiles


def _client(tmp_path):
    (tmp_path / "main.js").write_text("console.log(1)")
    (tmp_path / "styles.css").write_text("body{}")
    (tmp_path / "logo.svg").write_text("<svg/>")
    (tmp_path / "index.html").write_text("<!doctype html><title>t</title>")
    app = FastAPI()
    app.mount("/", CachedStaticFiles(directory=str(tmp_path), html=True), name="static")
    return TestClient(app)


def test_versioned_assets_are_immutable(tmp_path):
    c = _client(tmp_path)
    for path in ("/main.js", "/styles.css", "/logo.svg"):
        r = c.get(path)
        assert r.status_code == 200, path
        assert r.headers["cache-control"] == "public, max-age=31536000, immutable", path


def test_index_html_is_no_cache(tmp_path):
    c = _client(tmp_path)
    r = c.get("/index.html")
    assert r.status_code == 200
    assert r.headers["cache-control"] == "no-cache"


def test_spa_root_is_no_cache(tmp_path):
    """Der Root („/") liefert index.html — darf NICHT immutable gecacht werden,
    sonst sähen Nutzer nach einem Deploy die alte App."""
    c = _client(tmp_path)
    r = c.get("/")
    assert r.status_code == 200
    assert r.headers["cache-control"] == "no-cache"
