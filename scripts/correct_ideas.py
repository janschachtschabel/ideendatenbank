"""Korrektur-Lauf:
- 3 originale DOCX-Beschreibungen wiederherstellen + um Org/Kontakt-
  Informationen aus dem Steckbrief ergänzen.
- Titel zurück zur originalen Idee-Bezeichnung (HackathOERn-Prefixes
  entfernen ist OK, komplette Umbenennungen rückgängig).
- Schreibt — wie enrich_ideas.py — auf den `originalId` des Knotens,
  weil Reference-Knoten Metadaten-PUTs stillschweigend verwerfen.
"""
from __future__ import annotations
import argparse
import asyncio
import os
import sys
from base64 import b64encode

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

import httpx


# ─── Korrekturen pro ID (alles optional) ────────────────────────────────
# Felder:
#   title         (optional — neuer Titel)
#   description   (optional — neue Beschreibung)
#   keywords_drop (optional — Keywords entfernen, lowercase-vergleich)
CORRECTIONS: dict[str, dict] = {
    # ── 3 DOCX-Steckbriefe: originalen Text wiederherstellen + ergänzen ──
    "1d58807c-918c-438e-9880-7c918cf38e79": {
        "title": "Schule im Aufbruch",
        "description": (
            "Ziel ist die Standortbestimmung von Schulen, in der sich "
            "beteiligte Akteure austauschen und Ideen generieren. Dafür "
            "wurde eine Analyse für Schulen entwickelt, deren zugehöriger "
            "Fragebogen überarbeitet werden soll, um so barriereärmer zu "
            "sein sowie die Auswertung der Daten zu automatisieren und "
            "Wirkungsmessung zu ermöglichen.\n\n"
            "Anwendungskontext: Schulen — gesamte Schulgemeinschaft. "
            "Einreichende Organisation: Schule im Aufbruch gGmbH "
            "(Jens Becker, Ina Limmer). Unterstützungsbedarf: "
            "Programmierung, Datenmanagement, KI-Nutzung."),
    },
    "5c2130b1-8964-41ff-a130-b1896431ffa8": {
        "title": "LearnGraph",
        "description": (
            "Obwohl die Nutzung von OER weit verbreitet ist, bleibt die "
            "Anwendung oft hinter dem immanenten Potenzial zurück. Neben "
            "dem Zugriff auf OER-Materialien muss auch die Nutzung "
            "strukturiert und intuitiv möglich sein. OER sollen "
            "visualisiert, KI-unterstützt aufbereitet und in eine Plattform "
            "integriert und dadurch verknüpft werden. Die Wissenslandkarte "
            "von LearnGraph verknüpft Fachgebiete und Skills und bietet "
            "Nutzer:innen die Möglichkeit, sich wie in einer Navigations-App "
            "durch Bildungsinhalte zu bewegen. Dies fördert Lernen ohne "
            "Barrieren. Zusätzlich wird das Lernen durch Mentoring und "
            "Peer-Coaching unterstützt, um die Anwendung von Wissen zu "
            "fördern.\n\n"
            "Anwendungskontext: Höhere Bildung / berufliche Weiterentwicklung "
            "— globale Ausrichtung. Einreichende Organisation: LearnGraph gUG "
            "(Laurin Hagemann)."),
    },
    "e81c1d8d-86b7-4a75-9c1d-8d86b7ca7575": {
        "title": "OER im Doppelpack",
        "description": (
            "Herausforderung bei der Entwicklung und Etablierung offener "
            "digitaler Bildung liegt darin, niedrigschwellige und "
            "barrierearme Partizipation, qualitätsgesicherte Veröffentlichung "
            "und gute zielgruppengerechte Auffindbarkeit zu verknüpfen. "
            "Die eigene Plattform des Universitätsverbundes digiLL soll "
            "überarbeitet werden und so neue Features anbieten, wodurch "
            "zwei zentrale Aspekte im Sinne von OEP integriert werden: "
            "Qualitätsgesicherte Bereitstellung — Inhalte werden kuratiert "
            "und optimiert für verschiedene Zielgruppen in der "
            "Lehrkräftebildung veröffentlicht. Communitygestütztes "
            "Produzieren — Akteur:innen aller Phasen der Lehrkräftebildung "
            "sollen unkompliziert eigene Materialien erstellen können.\n\n"
            "Anwendungskontext: Lehrkräftebildung. Einreichende: "
            "Universitätsverbund digiLL (Universitäten Duisburg-Essen + "
            "Köln, Jan Strobl, Jan Veldscholten). Unterstützungsbedarf: "
            "Webentwicklung, UX."),
    },

    # ── PDFs: Subtitel wegnehmen, schlanker Idee-Name ───────────────────
    "64c586fb-cdb0-4ab3-8586-fbcdb02ab374": {"title": "FindOER"},

    # ── HTML-Stubs: meine Tagline-Erweiterungen zurücknehmen ────────────
    "4934c524-c050-46e6-b4c5-24c050b6e6ff": {"title": "Celebration Feature"},
    "6535ebbb-5792-46d8-b5eb-bb5792a6d8f1": {"title": "LiaScript"},
    "dc0a70de-ba91-4834-8a70-deba91583493": {"title": "KI-Infrastrukturen"},
    "a5a7d45d-ff9b-4378-a7d4-5dff9ba378b9": {"title": "Matrix-Kanal"},
    "a0a421dc-de5b-403a-a421-dcde5bb03a0c": {"title": "MOERFI – Ideen"},
    "1c03c1b1-ecf6-4592-83c1-b1ecf61592bd": {"title": "MOERFI – Ideen"},
    "61c39b0f-e152-4482-839b-0fe15254821e": {"title": "Anreize schaffen"},
    "6fa1ae18-7cb3-4921-a1ae-187cb3292112": {"title": "Individuelles Begleiten"},
    "5ad3607c-9f8b-4908-9360-7c9f8b6908ea": {"title": "Adressatengerechtes Marketing"},
    "b54c7c2f-2939-4042-8c7c-2f2939a042ed": {"title": "Multiplikator:innen vor Ort"},
    "ef3b9dea-1a5e-4491-bb9d-ea1a5e649163": {"title": "Zentralisierungsansätze"},
    "48a90bba-6e4f-4074-a90b-ba6e4ff07405": {"title": "TikTOER"},
    "5b253f16-b3fe-484a-a53f-16b3fee84a04": {"title": "Nutzungstracking"},
}


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

    ok = err = 0
    async with httpx.AsyncClient() as client:
        for nid, c in CORRECTIONS.items():
            try:
                meta = (await client.get(
                    f"{repo}/node/v1/nodes/-home-/{nid}/metadata?propertyFilter=-all-",
                    headers={"Authorization": auth}, timeout=30,
                )).json().get("node") or {}
            except Exception as e:
                print(f"  - {nid[:8]} SKIP ({e})"); continue
            if not meta:
                print(f"  - {nid[:8]} SKIP (nicht erreichbar)"); continue

            target_id = meta.get("originalId") or nid
            patch: dict[str, list[str]] = {}
            if c.get("title"):
                patch["cm:title"] = [c["title"]]
                patch["cclom:title"] = [c["title"]]
            if c.get("description"):
                patch["cclom:general_description"] = [c["description"]]
                patch["cm:description"] = [c["description"]]
            if not patch:
                continue

            arrow = " (→orig)" if target_id != nid else ""
            print(f"  + {nid[:8]}{arrow}  title='{c.get('title') or '–'}'")
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
