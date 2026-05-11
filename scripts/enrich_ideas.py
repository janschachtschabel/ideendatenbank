"""Schreibt kuratierte Beschreibungen, Keywords, Status und Event-Tags für die
HackathOERn-Ideen ins edu-sharing-Repository zurück.

Vorgehen:
- pro Idee: existierende Keywords lesen (nur phase:/event: gezielt austauschen
  + neue Themen-Schlagworte mergen, ohne Submitter/Target-Topic-Marker zu
  verlieren)
- description (cclom:general_description + cm:description) überschreiben
- title nur, wenn der Bestand offensichtlich Schrott ist (z.B. nur Dateiname)

Aufruf:
    python scripts/enrich_ideas.py --dry-run    # nur ausgeben
    python scripts/enrich_ideas.py              # tatsächlich schreiben
"""
from __future__ import annotations
import argparse
import asyncio
import os
import sys
from base64 import b64encode

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

import httpx


# ─── Kuratierte Inhalte (auf Basis der extrahierten Volltexte) ──────────────
# Schema je Eintrag:
#   title       (optional — nur setzen wenn Bestand schlecht/Dateiname war)
#   description (Pflicht — neue Klartext-Beschreibung)
#   topic_kws   (Liste — Themen-Schlagworte, gehen ins cclom:general_keyword)
#   phase       (anregung / ausarbeitung / pitch-bereit / in-umsetzung / abgeschlossen)
#   events      (Liste — z.B. ["hackathoern-1"])
ENRICHED: dict[str, dict] = {
    # ── Mit Volltext-Quelle ──────────────────────────────────────────────
    "efcf670c-7dc8-493c-8f67-0c7dc8e93cec": {
        "title": "Modulare Lösungen für OER-Redaktionen",
        "description": (
            "Workshop-Ergebnis aus dem HackathOERn 2 / OER-IT-Sommercamp 2025: "
            "Bausteine für eine zukunftsfähige OER-Redaktionsarbeit. Vorgestellt "
            "wurden Themenseiten und Widgets der edu-sharing-Plattform sowie "
            "neue Anwendungsfälle für KI-gestützte Redaktions-Workflows. "
            "Kerngedanken: Open by default, offene Dokumente von der ersten "
            "Idee bis zum Ergebnis, Kooperation statt Silos."),
        "topic_kws": ["OER-Redaktion", "Themenseiten", "Widgets", "edu-sharing",
                      "KI-Workflow", "Modularisierung"],
        "phase": "abgeschlossen",
        "events": ["hackathoern-2"],
    },
    "bd503def-30b8-4c4e-903d-ef30b87c4e50": {
        "title": "KI-Stundenverlaufplaner",
        "description": (
            "KI-Tool für innovative Stundenplanung — Ergebnis aus HackathOERn 2. "
            "Adressiert die Komplexität und Zeit-Intensität der Unterrichtsplanung "
            "(Curriculum, Lernziele, Reihenplanung, Klassenbedarfe, Ausstattung). "
            "Integriert OER-Material, aktuelle Nachrichten und externe Partner; "
            "berücksichtigt Förderbedarfe, Ausstattung und Stundenplan und "
            "reduziert die Planungszeit um bis zu 95 % gegenüber herkömmlicher "
            "Vorbereitung."),
        "topic_kws": ["KI", "Unterrichtsplanung", "Stundenverlauf",
                      "Lehrkräfte", "OER-Integration", "Förderbedarf"],
        "phase": "abgeschlossen",
        "events": ["hackathoern-2"],
    },
    "64c586fb-cdb0-4ab3-8586-fbcdb02ab374": {
        "title": "FindOER — OER-Meta-Bildsuchmaschine",
        "description": (
            "Offener Javascript-Baustein für die rechtssichere Bildsuche in OER. "
            "Adressiert das Silo-Problem getrennter Quellen (edu-sharing, MUNDO, "
            "openVerse, Unsplash u.a.) und den Zeitverlust für Lehrkräfte bei "
            "der Suche nach lizenzkonformen Bildern. Zielgruppen: Lehrkräfte, "
            "Schüler:innen sowie Entwickler:innen, die OER-Bilder einfach in "
            "ihre Anwendungen integrieren wollen. Live-Demo mit TeamMapper, "
            "GroupWriter und Excalidraw als Integrationsbeispielen. Ehemals "
            "OER Finder Plugin."),
        "topic_kws": ["Bildsuche", "Meta-Suche", "OER", "Lizenzen",
                      "Javascript-Plugin", "Lehrkräfte", "Open Source"],
        "phase": "abgeschlossen",
        "events": ["hackathoern-1"],
    },
    "d035737e-5925-455f-b573-7e5925755ff4": {
        "title": "B3 — Barcamp Beratungs Bot",
        "description": (
            "DSGVO-konformer Beratungs-Chatbot rund um Barcamp-Methoden — "
            "Ergebnis aus HackathOERn 1. Während des Hackathons wurden "
            "Begleitmaterialien konzipiert, technische Umsetzung diskutiert "
            "(eigener Server, DSGVO-Aspekte) und ein Prototyp entwickelt, der "
            "Quellenangaben und Vertiefungs-Material liefert. Ausblick: Umzug "
            "in produktives Hosting, Follow-up-Fragen, Einbindung der Barcamp-"
            "Materialien von selbstlernen.net, Marketing- und Vernetzungs-"
            "strategie für die OER-Community."),
        "topic_kws": ["Chatbot", "Barcamp", "Beratung", "DSGVO",
                      "Selbstlernen", "OER-Community"],
        "phase": "abgeschlossen",
        "events": ["hackathoern-1"],
    },
    "e81c1d8d-86b7-4a75-9c1d-8d86b7ca7575": {
        "title": "OER im Doppelpack — Qualitätsgesicherte Bereitstellung & einfaches Produzieren",
        "description": (
            "Projektsteckbrief des Universitätsverbundes digiLL (Universitäten "
            "Duisburg-Essen und Köln) für HackathOERn 1. Ziel: Die digiLL-"
            "Plattform überarbeiten und um zwei OEP-Bausteine ergänzen — "
            "qualitätsgesicherte, zielgruppengerechte Bereitstellung von "
            "Lehrkräftebildungs-Inhalten und communitygestütztes Produzieren "
            "eigener Materialien. Anwendungskontext: Lehrkräftebildung in "
            "allen Phasen. Unterstützungsbedarf: Webentwicklung, UX. "
            "Ansprechpartner: Jan Strobl (UDE), Jan Veldscholten (Köln)."),
        "topic_kws": ["digiLL", "Lehrkräftebildung", "Qualitätssicherung",
                      "OEP", "Community-Produktion", "Universität"],
        "phase": "abgeschlossen",
        "events": ["hackathoern-1"],
    },
    "5c2130b1-8964-41ff-a130-b1896431ffa8": {
        "title": "LearnGraph — Interaktive Wissenslandkarte für OER",
        "description": (
            "Projektsteckbrief der LearnGraph gUG für HackathOERn 1. Ziel: OER "
            "visuell und KI-gestützt aufbereitet als interaktive "
            "Wissenslandkarte zu verknüpfen, durch die sich Lernende wie in "
            "einer Navigations-App bewegen. Verbindet Fachgebiete und Skills, "
            "ergänzt durch Mentoring und Peer-Coaching, um die Anwendung von "
            "Wissen zu fördern. Internationale Ausrichtung mit globalem "
            "Netzwerk. Anwender: Studierende, Berufstätige, autodidaktische "
            "Lernende, Bildungseinrichtungen. Kontakt: Laurin Hagemann."),
        "topic_kws": ["LearnGraph", "Wissenslandkarte", "Skills",
                      "KI-Aufbereitung", "Mentoring", "Höhere Bildung",
                      "Peer-Coaching"],
        "phase": "abgeschlossen",
        "events": ["hackathoern-1"],
    },
    "1d58807c-918c-438e-9880-7c918cf38e79": {
        "title": "Standortbestimmung für eine zukunftsmutige Schule",
        "description": (
            "Projektsteckbrief der Schule im Aufbruch gGmbH für HackathOERn 1. "
            "Ziel: Schul-Standortbestimmung als Werkzeug für den Austausch "
            "aller Akteure und Ideen-Generierung. Der bestehende Fragebogen "
            "soll überarbeitet werden — barriereärmer, automatisierte "
            "Auswertung, Wirkungsmessung. Unterstützungsbedarf: "
            "Programmierung, Datenmanagement, KI-Nutzung. Vision: Schule "
            "heute so gestalten, dass sie morgen handlungsfähig ist — "
            "Transformation des Schulsystems. Kontakt: Jens Becker, Ina Limmer."),
        "topic_kws": ["Schulentwicklung", "Standortbestimmung", "Fragebogen",
                      "Wirkungsmessung", "Barrierearmut", "KI-Auswertung"],
        "phase": "abgeschlossen",
        "events": ["hackathoern-1"],
    },

    # ── HTML-Stubs (kein Volltext, Beschreibungen aus Titel-Kontext) ─────
    "4934c524-c050-46e6-b4c5-24c050b6e6ff": {
        "title": "Celebration Feature für die OER-Community",
        "description": (
            "Idee aus HackathOERn 2: ein Celebration-Feature, das Beiträge, "
            "Meilensteine und Beteiligung in der OER-Community sichtbar "
            "würdigt — als sozialer Anker für Motivation und Vernetzung."),
        "topic_kws": ["Celebration", "Community", "Anerkennung", "Gamification"],
        "phase": "anregung", "events": ["hackathoern-2"],
    },
    "f026e46d-ba8b-4011-a6e4-6dba8bc0113a": {
        "title": "Lernraumradar",
        "description": (
            "Idee aus HackathOERn 1: ein Radar/Verzeichnis offener Lernräume "
            "und ihrer Akteure, um regionale Bildungs-Ökosysteme sichtbar zu "
            "machen und Anschluss-Möglichkeiten für Lernende zu schaffen."),
        "topic_kws": ["Lernräume", "Verzeichnis", "Vernetzung", "Region"],
        "phase": "anregung", "events": ["hackathoern-1"],
    },
    "6535ebbb-5792-46d8-b5eb-bb5792a6d8f1": {
        "title": "LiaScript für OER",
        "description": (
            "Idee aus HackathOERn 1: Einsatz von LiaScript (Markdown-basierter "
            "Open-Source-Editor) für die Erstellung interaktiver, "
            "selbst-gehosteter OER-Lerneinheiten ohne Plattform-Bindung."),
        "topic_kws": ["LiaScript", "Markdown", "Selbstlern-Editor", "Interaktiv"],
        "phase": "anregung", "events": ["hackathoern-1"],
    },
    "dc0a70de-ba91-4834-8a70-deba91583493": {
        "title": "KI-Infrastrukturen für OER",
        "description": (
            "Ergebnis-Idee aus HackathOERn 2 zu offenen, gemeinwohl-orientierten "
            "KI-Infrastrukturen für die OER-Community: souveräne Modelle, "
            "geteilte Rechenkapazitäten, transparente Trainingsdaten."),
        "topic_kws": ["KI-Infrastruktur", "Souveränität", "GAIA-X", "OER"],
        "phase": "abgeschlossen", "events": ["hackathoern-2"],
    },
    "0608fe6e-9740-46f6-88fe-6e974056f6bd": {
        "title": "Metadaten-Mapping",
        "description": (
            "Ergebnis-Idee aus HackathOERn 2: einheitliches Metadaten-Mapping "
            "zwischen verschiedenen OER-Quellen (LOM, schema.org, MOOChub, "
            "edu-sharing) — um Fundstellen aus heterogenen Repositories "
            "zusammenzuführen."),
        "topic_kws": ["Metadaten", "LOM", "schema.org", "Mapping",
                      "Interoperabilität"],
        "phase": "abgeschlossen", "events": ["hackathoern-2"],
    },
    "489ee4b4-f1b4-4ff7-9ee4-b4f1b4dff709": {
        "title": "Synchrone Kollaboration",
        "description": (
            "Ergebnis-Idee aus HackathOERn 2: Werkzeuge für synchrone, "
            "echtzeitfähige Kollaboration in OER-Redaktionen (geteilte "
            "Whiteboards, Co-Editing, Voice-Channels) — niedrigschwellig "
            "und datenschutzfreundlich."),
        "topic_kws": ["Kollaboration", "Echtzeit", "Co-Editing", "Whiteboard"],
        "phase": "abgeschlossen", "events": ["hackathoern-2"],
    },
    "a5a7d45d-ff9b-4378-a7d4-5dff9ba378b9": {
        "title": "Matrix-Kanal für die OER-Community",
        "description": (
            "Idee aus HackathOERn 1: Aufbau eines Matrix-basierten "
            "Chat-Kanals als dezentrale, föderierte Kommunikationsplattform "
            "für die OER-Community — alternativ zu kommerziellen Messengern."),
        "topic_kws": ["Matrix", "Föderation", "Messenger", "Community"],
        "phase": "anregung", "events": ["hackathoern-1"],
    },
    "904f3de1-feef-464b-8f3d-e1feefc64b61": {
        "title": "Dezentraler aber interoperabler Datenraum",
        "description": (
            "Idee: ein dezentraler Datenraum für OER, der dennoch "
            "Interoperabilität zwischen den teilnehmenden Knoten gewährleistet "
            "— Vorbild GAIA-X / Solid. Lokale Hoheit, gemeinsame Auffindbarkeit."),
        "topic_kws": ["Datenraum", "Dezentralität", "Interoperabilität",
                      "Souveränität"],
        "phase": "anregung", "events": ["hackathoern-2"],
    },
    "a0a421dc-de5b-403a-a421-dcde5bb03a0c": {
        "title": "MOERFI — Ideen-Sammlung",
        "description": (
            "Brainstorm aus HackathOERn 2 zum Komplex MOERFI (Modulare OER-"
            "Findstrategien): wie OER über Suchmaschinen, Empfehlungssysteme "
            "und Federated Search auffindbar werden."),
        "topic_kws": ["MOERFI", "Auffindbarkeit", "Federated Search",
                      "Empfehlungen"],
        "phase": "anregung", "events": ["hackathoern-2"],
    },
    "1c03c1b1-ecf6-4592-83c1-b1ecf61592bd": {
        "title": "MOERFI — Ideenkarte",
        "description": (
            "Begleit-Notiz zur MOERFI-Ideensammlung (Modulare OER-"
            "Findstrategien) aus dem HackathOERn 2 — strukturiert "
            "Auffindbarkeits-Ansätze für offene Bildungsmaterialien."),
        "topic_kws": ["MOERFI", "Auffindbarkeit", "OER-Suche"],
        "phase": "anregung", "events": ["hackathoern-2"],
    },
    "7539337f-3204-464b-b933-7f3204164b89": {
        "title": "Verständnis für Tools und für OER entwickeln",
        "description": (
            "Idee: Aus dem Tool-Dschungel der OER-Welt (LMS, Repositories, "
            "Editoren, Suchmaschinen) eine niedrigschwellige Orientierung "
            "schaffen, damit Lehrkräfte und Lernende den Zweck und Nutzen "
            "der einzelnen Werkzeuge verstehen und verbinden können."),
        "topic_kws": ["Toolkompetenz", "Onboarding", "Bildungsangebote",
                      "Orientierung"],
        "phase": "anregung", "events": ["hackathoern-2"],
    },
    "61c39b0f-e152-4482-839b-0fe15254821e": {
        "title": "Anreize schaffen für OER-Beiträge",
        "description": (
            "Idee: Anreizsysteme für die Erstellung und Pflege von OER — "
            "z.B. Reputation, Sichtbarkeit, fachliche Würdigung, "
            "Anrechnung in Hochschul-Karrieren — damit mehr Akteure "
            "dauerhaft mitwirken."),
        "topic_kws": ["Anreize", "Reputation", "Beitrag", "Motivation"],
        "phase": "anregung", "events": ["hackathoern-2"],
    },
    "205ea5ce-c1cd-4eb5-9ea5-cec1cd7eb540": {
        "title": "Open Education Association",
        "description": (
            "Idee: eine Dachorganisation (Open Education Association) für "
            "die deutschsprachige OER-Community — bündelt Stimmen gegenüber "
            "Politik und Förderern, koordiniert Standards und gemeinsame "
            "Infrastruktur-Projekte."),
        "topic_kws": ["OEA", "Verband", "Lobbyarbeit", "Community"],
        "phase": "anregung", "events": ["hackathoern-2"],
    },
    "6fa1ae18-7cb3-4921-a1ae-187cb3292112": {
        "title": "Individuelles Begleiten von Lernenden",
        "description": (
            "Idee: niedrigschwellige Tutoring- und Begleit-Strukturen, die "
            "OER kontextualisieren und Lernende in heterogenen Gruppen "
            "individuell unterstützen — Mensch + KI im Tandem."),
        "topic_kws": ["Tutoring", "Begleitung", "Individualisierung",
                      "Lernpfade"],
        "phase": "anregung", "events": ["hackathoern-2"],
    },
    "5ad3607c-9f8b-4908-9360-7c9f8b6908ea": {
        "title": "Adressatengerechtes Marketing für OER",
        "description": (
            "Idee: zielgruppen-spezifisches Marketing für OER — Lehrkräfte, "
            "Schulleitungen, Lernende, Eltern, Bildungspolitik brauchen "
            "unterschiedliche Botschaften. Storytelling und Use Cases statt "
            "OER-Lizenz-Jargon."),
        "topic_kws": ["Marketing", "Zielgruppen", "Storytelling",
                      "OER-Kommunikation"],
        "phase": "anregung", "events": ["hackathoern-2"],
    },
    "b54c7c2f-2939-4042-8c7c-2f2939a042ed": {
        "title": "Multiplikator:innen vor Ort (Schule, Hochschule, …)",
        "description": (
            "Idee: ein Netzwerk von OER-Multiplikator:innen direkt in den "
            "Bildungseinrichtungen aufbauen — Schulen, Hochschulen, "
            "Volkshochschulen — damit OER praxisnah und peer-to-peer "
            "verbreitet wird."),
        "topic_kws": ["Multiplikatoren", "Botschafter", "Schule", "Hochschule",
                      "Peer-Learning"],
        "phase": "anregung", "events": ["hackathoern-2"],
    },
    "ef3b9dea-1a5e-4491-bb9d-ea1a5e649163": {
        "title": "Zentralisierungsansätze für OER",
        "description": (
            "Idee: Diskussion zentraler vs. föderierter OER-Infrastrukturen — "
            "wo schaffen zentrale Kataloge Mehrwert (Auffindbarkeit, "
            "Qualitätssicherung), wo überwiegen die Risiken (Single Point of "
            "Failure, fehlende Vielfalt)?"),
        "topic_kws": ["Zentralisierung", "Föderation", "Architektur",
                      "Strategie"],
        "phase": "anregung", "events": ["hackathoern-2"],
    },
    "48a90bba-6e4f-4074-a90b-ba6e4ff07405": {
        "title": "TikTOER — OER auf Social-Media-Plattformen",
        "description": (
            "Idee: OER-Inhalte über TikTok, Instagram-Reels und ähnliche "
            "Plattformen verbreiten (TikTOER), um Zielgruppen dort "
            "abzuholen, wo sie sind. Fragen: Lizenzierung, Einbettung, "
            "Plattform-Abhängigkeit."),
        "topic_kws": ["TikTok", "Social Media", "Reichweite", "Lizenzen"],
        "phase": "anregung", "events": ["hackathoern-2"],
    },
    "b63d1b09-64da-4616-bd1b-0964da161696": {
        "title": "OER-Community-Map",
        "description": (
            "Idee: eine interaktive Landkarte/Graph der OER-Community — "
            "Akteure, Projekte, Plattformen und ihre Beziehungen sichtbar, "
            "um Vernetzung zu erleichtern und Doppelarbeit zu vermeiden."),
        "topic_kws": ["Community-Map", "Visualisierung", "Akteure",
                      "Vernetzung"],
        "phase": "anregung", "events": ["hackathoern-2"],
    },
    "687f8fe6-b729-4e29-bf8f-e6b729fe2977": {
        "title": "OER-Kompetenzportal",
        "description": (
            "Idee: ein zentrales Portal mit Lernpfaden zu OER-Kompetenz — "
            "für Lehrkräfte, Lernende und Multiplikator:innen. Vom "
            "Lizenz-1×1 bis zur eigenen OER-Produktion."),
        "topic_kws": ["Kompetenzportal", "Lernpfad", "Weiterbildung",
                      "OER-Produktion"],
        "phase": "anregung", "events": ["hackathoern-2"],
    },
    "5b253f16-b3fe-484a-a53f-16b3fee84a04": {
        "title": "Nutzungstracking für OER",
        "description": (
            "Idee: datenschutzfreundliches Tracking der OER-Nutzung — wieviel "
            "wird heruntergeladen, weiterverwendet, in Klassenzimmern "
            "eingesetzt? Anonyme Aggregation als Erfolgs-Signal für "
            "Förderer und Autor:innen."),
        "topic_kws": ["Tracking", "Analytics", "Datenschutz", "Wirkung"],
        "phase": "anregung", "events": ["hackathoern-2"],
    },
    "e011de4c-5d2c-411d-91de-4c5d2ce11d66": {
        "title": "Automatisierter Accessibility-Check",
        "description": (
            "Idee: ein automatisierter Accessibility-Check für OER — prüft "
            "Bilder auf Alt-Texte, Kontraste, Untertitel-Tracks und "
            "strukturelle Zugänglichkeit, mit konkreten Verbesserungs-"
            "Vorschlägen für Autor:innen."),
        "topic_kws": ["Accessibility", "Barrierefreiheit", "WCAG",
                      "Qualitätssicherung"],
        "phase": "anregung", "events": ["hackathoern-2"],
    },
    "4af4aeff-2c57-43e8-b4ae-ff2c5773e87b": {
        "title": "Zentrale OER-Datenbank",
        "description": (
            "Idee: eine zentrale, kuratierte Datenbank für OER aus dem "
            "deutschsprachigen Raum, die einzelne Repositories aggregiert "
            "und über offene Schnittstellen wieder ausspielt — "
            "Auffindbarkeit ohne Zentralisierungs-Risiken."),
        "topic_kws": ["Datenbank", "Aggregation", "Auffindbarkeit", "Katalog"],
        "phase": "anregung", "events": ["hackathoern-2"],
    },
    "67287f88-d1ad-4638-a87f-88d1ad763828": {
        # Read-Verbot beim Extrakt — trotzdem updaten, falls der Knoten lebt
        "title": "Konkrete Lernort-Kooperationen",
        "description": (
            "Idee: konkrete Kooperationen zwischen Schulen, Volkshochschulen, "
            "Bibliotheken und außerschulischen Lernorten — gemeinsamer "
            "OER-Pool, geteilte Veranstaltungen, durchlässige Lernpfade "
            "über Institutionsgrenzen."),
        "topic_kws": ["Lernort", "Kooperation", "Schule", "Bibliothek",
                      "Außerschulisch"],
        "phase": "anregung", "events": ["hackathoern-2"],
    },
}


def _merge_keywords(existing: list[str], new_topic: list[str], new_phase: str | None,
                    new_events: list[str]) -> list[str]:
    """Bestehende Keywords erhalten — nur phase:/event:/Themen-Bereich gezielt
    austauschen. submitter:- und target-topic:-Marker bleiben unangetastet."""
    keep: list[str] = []
    for k in existing:
        lk = (k or "").lower()
        if lk.startswith(("phase:", "event:")):
            continue           # → werden gleich neu gesetzt
        if lk in {kw.lower() for kw in new_topic}:
            continue           # Duplikate vermeiden
        keep.append(k)
    if new_phase:
        keep.append(f"phase:{new_phase}")
    for ev in new_events:
        keep.append(f"event:{ev}")
    keep.extend(new_topic)
    return keep


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
    if not (es_user and es_pass):
        print("Keine Credentials in .env"); sys.exit(2)
    auth = "Basic " + b64encode(f"{es_user}:{es_pass}".encode()).decode()
    repo = "https://redaktion.openeduhub.net/edu-sharing/rest"

    ok = err = skipped = 0
    async with httpx.AsyncClient() as client:
        for nid, e in ENRICHED.items():
            try:
                meta = (await client.get(
                    f"{repo}/node/v1/nodes/-home-/{nid}/metadata?propertyFilter=-all-",
                    headers={"Authorization": auth}, timeout=30,
                )).json().get("node") or {}
                if not meta:
                    print(f"  - {nid[:8]}  SKIP (Knoten nicht erreichbar)")
                    skipped += 1; continue
            except Exception as ex:
                print(f"  - {nid[:8]}  SKIP ({ex})")
                skipped += 1; continue

            # WICHTIG: ist der Knoten ein Collection-Reference (Kopie),
            # zeigt `originalId` auf das echte Original. Schreibvorgänge
            # auf den Reference-Knoten werden von edu-sharing stillschweigend
            # verworfen — wir müssen das Original updaten.
            target_id = meta.get("originalId") or nid
            if target_id != nid:
                # Original-Metadaten holen für den Keyword-Merge
                try:
                    orig_meta = (await client.get(
                        f"{repo}/node/v1/nodes/-home-/{target_id}/metadata?propertyFilter=-all-",
                        headers={"Authorization": auth}, timeout=30,
                    )).json().get("node") or {}
                    if orig_meta: meta = orig_meta
                except Exception:
                    pass

            existing_props = meta.get("properties") or {}
            existing_kws = existing_props.get("cclom:general_keyword") or []
            if isinstance(existing_kws, str): existing_kws = [existing_kws]
            new_kws = _merge_keywords(
                existing_kws, e.get("topic_kws") or [],
                e.get("phase"), e.get("events") or [],
            )

            patch: dict[str, list[str]] = {
                "cclom:general_description": [e["description"]],
                "cm:description": [e["description"]],
                "cclom:general_keyword": new_kws,
            }
            if e.get("title"):
                patch["cm:title"] = [e["title"]]
                patch["cclom:title"] = [e["title"]]

            arrow = " (→orig)" if target_id != nid else ""
            print(f"  + {nid[:8]}{arrow}  {(e.get('title') or meta.get('title') or '')[:55]}")
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

    print(f"\nSummary: ok={ok}  err={err}  skipped={skipped}  dry_run={dry_run}")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()
    asyncio.run(main(args.dry_run))
