"""Spekulierte Beschreibungen durch die echten textContent-Texte ersetzen.

Gilt für die 16 HTML-Stubs, deren Inhalt jetzt via /textContent ausgelesen
werden konnte, sowie für die 7 wirklich leeren Stubs (Beschreibung leeren —
keine Erfindung mehr).

Für jeden Knoten wird der `originalId` getroffen, weil Reference-Knoten
Metadaten-PUTs stillschweigend verwerfen.
"""
from __future__ import annotations
import argparse
import asyncio
import json
import os
import sys
from base64 import b64encode

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

import httpx


# ─── 7 wirklich leere Stubs (kein Datei-Inhalt vorhanden) ──────────────
TRULY_EMPTY = {
    "ef3b9dea-1a5e-4491-bb9d-ea1a5e649163",  # Zentralisierungsansätze
    "48a90bba-6e4f-4074-a90b-ba6e4ff07405",  # TikTOER
    "b63d1b09-64da-4616-bd1b-0964da161696",  # OER-Community-Map
    "687f8fe6-b729-4e29-bf8f-e6b729fe2977",  # OER-Kompetenzportal
    "5b253f16-b3fe-484a-a53f-16b3fee84a04",  # Nutzungstracking
    "e011de4c-5d2c-411d-91de-4c5d2ce11d66",  # Automatisierter Accessibility-Check
    "4af4aeff-2c57-43e8-b4ae-ff2c5773e87b",  # Zentrale OER-Datenbank
}

# ─── Knoten, deren spekulierte Beschreibung NICHT überschrieben werden ──
# (PDFs + DOCX-Steckbriefe haben bereits kuratierte/originale Texte)
SKIP_REPLACE = {
    "efcf670c-7dc8-493c-8f67-0c7dc8e93cec",  # Modulare Lösungen (PDF, kuratiert OK)
    "bd503def-30b8-4c4e-903d-ef30b87c4e50",  # KI-Stundenverlaufplaner (PDF, kuratiert OK)
    "64c586fb-cdb0-4ab3-8586-fbcdb02ab374",  # FindOER (PDF, kuratiert OK)
    "d035737e-5925-455f-b573-7e5925755ff4",  # B3 (PDF, kuratiert OK)
    "1d58807c-918c-438e-9880-7c918cf38e79",  # Schule im Aufbruch (DOCX, original)
    "5c2130b1-8964-41ff-a130-b1896431ffa8",  # LearnGraph (DOCX, original)
    "e81c1d8d-86b7-4a75-9c1d-8d86b7ca7575",  # OER im Doppelpack (DOCX, original)
    "f9c08ca9-90da-4cfc-808c-a990da0cfca0",  # testidee (eigene)
}


def _clean_text(s: str) -> str:
    """Whitespace normalisieren, leere Zeilen weg, Zeilenumbrüche zu Absätzen."""
    lines = [l.strip() for l in s.splitlines()]
    lines = [l for l in lines if l]
    return "\n".join(lines).strip()


async def main(dry_run: bool) -> None:
    env = os.path.join(os.path.dirname(__file__), "..", ".env")
    es_user = es_pass = None
    if os.path.exists(env):
        for line in open(env, encoding="utf-8"):
            line = line.strip()
            if line.startswith("EDU_GUEST_USER="):
                es_user = line.split("=", 1)[1].strip()
            elif line.startswith("EDU_GUEST_PASS="):
                es_pass = line.split("=", 1)[1].strip()
    auth = "Basic " + b64encode(f"{es_user}:{es_pass}".encode()).decode()
    repo = "https://redaktion.openeduhub.net/edu-sharing/rest"

    # extrahierte Texte als Quelle der Wahrheit (liegt im selben Ordner
    # wie das Skript, neben anderen historischen Datendumps).
    content = json.load(open(os.path.join(os.path.dirname(__file__),
                                          "ideen_content.json"), encoding="utf-8"))
    by_id = {d["id"]: d for d in content}

    ok = err = 0
    async with httpx.AsyncClient() as client:
        for nid, d in by_id.items():
            if nid in SKIP_REPLACE:
                continue
            try:
                meta = (await client.get(
                    f"{repo}/node/v1/nodes/-home-/{nid}/metadata?propertyFilter=-all-",
                    headers={"Authorization": auth}, timeout=30,
                )).json().get("node") or {}
            except Exception as e:
                print(f"  ! {nid[:8]}  meta-fail ({e})"); continue
            if not meta:
                print(f"  - {nid[:8]}  SKIP (Knoten weg)"); continue
            target_id = meta.get("originalId") or nid

            if nid in TRULY_EMPTY:
                # Spekulierte Beschreibung leeren — keine Erfindung mehr
                new_desc = ""
                action = "EMPTY (kein Datei-Inhalt)"
            else:
                txt = (d.get("extracted_text") or "").strip()
                if not txt or txt.startswith("["):
                    print(f"  - {nid[:8]}  SKIP (kein verwertbarer Text)")
                    continue
                new_desc = _clean_text(txt)
                action = f"REAL ({len(new_desc)} chars)"

            patch = {
                "cclom:general_description": [new_desc] if new_desc else [],
                "cm:description": [new_desc] if new_desc else [],
            }
            print(f"  + {nid[:8]} (→{target_id[:8]})  {action}  {(d['title'] or '')[:45]}")
            if dry_run:
                continue
            try:
                r = await client.put(
                    f"{repo}/node/v1/nodes/-home-/{target_id}/metadata",
                    headers={"Authorization": auth, "Content-Type": "application/json"},
                    json=patch, timeout=60,
                )
                r.raise_for_status()
                ok += 1
            except httpx.HTTPStatusError as ex:
                print(f"      → ERR {ex.response.status_code}: {ex.response.text[:160]}")
                err += 1

    print(f"\nSummary: ok={ok}  err={err}  dry_run={dry_run}")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true")
    asyncio.run(main(p.parse_args().dry_run))
