"""Stellt die spekulierten Beschreibungen für die 7 wirklich leeren Stubs
wieder her und markiert sie transparent als unverifiziert.

Die Texte sind Anregungen aus Titel + OER-Domain-Wissen — kein Originalinhalt.
Markierung am Anfang macht das beim Lesen sofort klar.
"""
from __future__ import annotations
import argparse, asyncio, os, sys
from base64 import b64encode

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
import httpx

PREFIX = "[Vorschlag, ohne Originalinhalt — bitte vom Einreicher bestätigen.] "

RESTORED: dict[str, str] = {
    "ef3b9dea-1a5e-4491-bb9d-ea1a5e649163": (
        "Diskussion zentraler vs. föderierter OER-Infrastrukturen — "
        "wo schaffen zentrale Kataloge Mehrwert (Auffindbarkeit, "
        "Qualitätssicherung), wo überwiegen die Risiken (Single Point "
        "of Failure, fehlende Vielfalt)?"),
    "48a90bba-6e4f-4074-a90b-ba6e4ff07405": (
        "OER-Inhalte über TikTok, Instagram-Reels und ähnliche Plattformen "
        "verbreiten („TikTOER\"), um Zielgruppen dort abzuholen, wo sie sind. "
        "Fragen: Lizenzierung, Einbettung, Plattform-Abhängigkeit."),
    "b63d1b09-64da-4616-bd1b-0964da161696": (
        "Eine interaktive Landkarte / Graph der OER-Community — Akteure, "
        "Projekte, Plattformen und ihre Beziehungen sichtbar, um Vernetzung "
        "zu erleichtern und Doppelarbeit zu vermeiden."),
    "687f8fe6-b729-4e29-bf8f-e6b729fe2977": (
        "Ein zentrales Portal mit Lernpfaden zu OER-Kompetenz — für "
        "Lehrkräfte, Lernende und Multiplikator:innen. Vom Lizenz-1×1 "
        "bis zur eigenen OER-Produktion."),
    "5b253f16-b3fe-484a-a53f-16b3fee84a04": (
        "Datenschutzfreundliches Tracking der OER-Nutzung — wieviel wird "
        "heruntergeladen, weiterverwendet, in Klassenzimmern eingesetzt? "
        "Anonyme Aggregation als Erfolgs-Signal für Förderer und Autor:innen."),
    "e011de4c-5d2c-411d-91de-4c5d2ce11d66": (
        "Automatisierter Accessibility-Check für OER — prüft Bilder auf "
        "Alt-Texte, Kontraste, Untertitel-Tracks und strukturelle "
        "Zugänglichkeit, mit konkreten Verbesserungs-Vorschlägen für "
        "Autor:innen."),
    "4af4aeff-2c57-43e8-b4ae-ff2c5773e87b": (
        "Eine zentrale, kuratierte Datenbank für OER aus dem deutsch- "
        "sprachigen Raum, die einzelne Repositories aggregiert und über "
        "offene Schnittstellen wieder ausspielt — Auffindbarkeit ohne "
        "Zentralisierungs-Risiken."),
}


async def main(dry_run: bool) -> None:
    env = os.path.join(os.path.dirname(__file__), "..", ".env")
    user = pw = None
    for line in open(env, encoding="utf-8"):
        if line.startswith("EDU_GUEST_USER="): user = line.split("=",1)[1].strip()
        elif line.startswith("EDU_GUEST_PASS="): pw = line.split("=",1)[1].strip()
    auth = "Basic " + b64encode(f"{user}:{pw}".encode()).decode()
    repo = "https://redaktion.openeduhub.net/edu-sharing/rest"

    ok = err = 0
    async with httpx.AsyncClient() as c:
        for nid, body in RESTORED.items():
            full = PREFIX + body
            try:
                meta = (await c.get(
                    f"{repo}/node/v1/nodes/-home-/{nid}/metadata?propertyFilter=-all-",
                    headers={"Authorization": auth}, timeout=30,
                )).json().get("node") or {}
            except Exception as e:
                print(f"  ! {nid[:8]} meta-fail: {e}"); continue
            tid = meta.get("originalId") or nid
            patch = {"cclom:general_description": [full], "cm:description": [full]}
            print(f"  + {nid[:8]} → {tid[:8]}  ({len(full)} chars)")
            if dry_run: continue
            try:
                r = await c.put(
                    f"{repo}/node/v1/nodes/-home-/{tid}/metadata",
                    json=patch,
                    headers={"Authorization": auth, "Content-Type": "application/json"},
                    timeout=60,
                )
                r.raise_for_status(); ok += 1
            except httpx.HTTPStatusError as ex:
                print(f"      ERR {ex.response.status_code}: {ex.response.text[:120]}")
                err += 1
    print(f"\nSummary: ok={ok} err={err} dry_run={dry_run}")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true")
    asyncio.run(main(p.parse_args().dry_run))
