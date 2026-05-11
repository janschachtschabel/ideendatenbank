"""Legt 8 HackathOERn-3-Ideen mit ihren Steckbrief-PDFs in der
HackathOERn-Inbox an. Nutzt den WLO-Upload-Account, der auf der Inbox
Collaborator-Rechte hat.

Pro Idee:
  1. ccm:io im Inbox-Ordner erzeugen
  2. Properties setzen (Titel, Beschreibung, Keywords, Phase, Event, wwwurl, Autor)
  3. PDF-Bytes als Content hochladen
  4. Lokalen Cache refreshen
"""
from __future__ import annotations
import argparse, asyncio, os, sys
from base64 import b64encode

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
import httpx

INBOX_ID = "98fcbe56-7a3b-4267-bcbe-567a3ba267ee"
PDF_DIR = os.path.join(os.path.dirname(__file__), "..", "tmp", "h3")
BASE_URL = "https://edu-sharing-network.org/wp-content/uploads/sites/3/2026/04"

# ─── Kuratierte Metadaten je Steckbrief ────────────────────────────────
IDEAS = [
    {
        "file": "01_Steckbrief.pdf",
        "title": "AI Content Editor — Generierung und Überarbeitung von Inhalten per AI",
        "author": "Stephan Kulla (selbstständig)",
        "description": (
            "Wie können Inhalte direkt im Workflow KI-gestützt neu generiert und "
            "überarbeitet werden? In einem Proof-of-Concept im Serlo Editor wird "
            "erprobt, wie sich Inhalte automatisiert neu generieren oder gezielt "
            "überarbeiten lassen — inspiriert von der Canvas-Funktion von ChatGPT. "
            "Im Fokus stehen die KI-unterstützte Aktualisierung von OER und eine "
            "kollaborative Qualitätssicherung, perspektivisch über Kommentar-/"
            "Vorschlagsmodus.\n\n"
            "Zielgruppe: OER-Erstellende und -Nutzende. Anwendungskontext: "
            "übergreifend. Unterstützungsbedarf: IT, Entwickler:innen, "
            "Berater:innen."
        ),
        "topic_kws": ["KI", "Serlo Editor", "OER-Aktualisierung",
                      "Canvas", "Qualitätssicherung", "Kollaboration"],
    },
    {
        "file": "02_Steckbrief.pdf",
        "title": "fAIr — Indikatoren für OER und ihre Integration in technische Infrastrukturen",
        "author": "Roger Flühler, Enrique Corredera-Nilsson (ZHAW)",
        "description": (
            "Wie lässt sich die Qualität und Wirkung von OER sinnvoll messen? "
            "Das Projekt fAIr erprobt dafür aussagekräftige quantitative und "
            "qualitative Indikatoren — von Nutzungsdaten wie Downloads und "
            "Nachnutzung bis hin zu qualitativen Bewertungen. Entscheidend ist, "
            "was wirklich relevant ist: für Autor:innen, Institutionen und "
            "Plattformen. Ebenso im Blick: die Integration solcher Indikatoren "
            "in bestehende Infrastrukturen wie edu-sharing. Ziel ist es, OER "
            "transparenter, vergleichbarer und in ihrer Wirkung besser "
            "verständlich zu machen.\n\n"
            "Zielgruppe: OER-Community, Nutzer:innen. Anwendungskontext: "
            "übergreifend. Einreichende Organisation: ZHAW Zürcher Hochschule "
            "für Angewandte Wissenschaften (Swiss Digital Academy)."
        ),
        "topic_kws": ["Indikatoren", "Wirkungsmessung", "Qualität",
                      "Nutzungsdaten", "edu-sharing", "Swiss Digital Academy"],
    },
    {
        "file": "03_Steckbrief.pdf",
        "title": "poEtree — Der digitale Lernentwicklungsbaum",
        "author": "Nadine Krause, Susan Schalles (Grundschule)",
        "description": (
            "Wie lassen sich selbstgesteuertes Lernen, Kompetenzentwicklung und "
            "Lehrplananforderungen sinnvoll verbinden? Der Potentialentwicklungs-"
            "baum poEtree („potential evolving tree\") setzt als offene "
            "Lerninfrastruktur an: er verknüpft fachliche Inhalte, "
            "Zukunftskompetenzen (einschließlich der kontemplativen Kompetenz "
            "als Dimension der Selbstwahrnehmung) sowie metakognitive Prozesse. "
            "Im Fokus steht keine neue Plattform, sondern eine anschlussfähige "
            "Struktur, die in unterschiedlichen Bildungskontexten funktioniert "
            "— von bestehenden Systemen bis zu neuen Lernsettings. Im "
            "HackathOERn werden erste Prototypen und Denkmodelle für ein "
            "vernetztes Lernökosystem entwickelt.\n\n"
            "Zielgruppe: Lehrer:innen, Lernende. Anwendungskontext: Schule. "
            "Unterstützungsbedarf: UI/UX, Prototyping, OER-Community, "
            "Forschung, Hochschulen."
        ),
        "topic_kws": ["Lernökosystem", "Kompetenzen", "Schule",
                      "Selbstgesteuertes Lernen", "OEP", "Prototyp"],
    },
    {
        "file": "04_Steckbrief.pdf",
        "title": "ComCal — Meine Termine mit MCP, Chatbot und Nostr befreien",
        "author": "Steffen Rörtgen, Ludger Sicking (Comenius Institut)",
        "description": (
            "Wie lassen sich Veranstaltungen plattformübergreifend effizient "
            "veröffentlichen, ohne mehrfachen Pflegeaufwand? Viele Organisationen "
            "müssen Veranstaltungen für Reichweite mehrfach pflegen — manuell, "
            "zeitaufwendig und fehleranfällig. Das ComCal-Projekt erprobt ein "
            "offenes, interoperables Kalendersystem auf Basis des Nostr-"
            "Protokolls. Ein Chatbot unterstützt dabei, Veranstaltungsdaten aus "
            "verschiedenen Quellen zu extrahieren, zu standardisieren und in "
            "ein offenes Netzwerk zu veröffentlichen. Ziel: ein skalierbares "
            "Event-Ökosystem, das Veröffentlichung und Nachnutzung deutlich "
            "vereinfacht.\n\n"
            "Zielgruppe: OER-Community. Anwendungskontext: übergreifend. "
            "Unterstützungsbedarf: UX/UI-Expertise, KI-/MCP-Expertise."
        ),
        "topic_kws": ["Nostr", "MCP", "Kalender", "Chatbot",
                      "Interoperabilität", "Veranstaltungen"],
    },
    {
        "file": "05_Steckbrief.pdf",
        "title": "Strukturierte OER-Sammlungen — Dateiorganisation komplexer zusammenhängender OER",
        "author": "Ute Rühling (Universität Münster)",
        "description": (
            "Inklusiver Unterricht braucht mehr als einzelne Materialien: er "
            "erfordert komplexe, zusammenhängende Unterrichtsreihen mit "
            "unterschiedlichen Differenzierungsstufen. Inhalte müssen "
            "editierbar, anpassbar und weitergebbar sein, gleichzeitig fehlt "
            "im Alltag oft die Zeit für den Überblick. Bestehende Lösungen "
            "sind entweder zu starr, zu komplex oder nicht offen genug. "
            "Erprobt werden neue Ansätze für editierbare, differenzierbare "
            "und teilbare Inhalte, die Struktur, Flexibilität und "
            "Übersichtlichkeit verbinden — und Lehrkräfte im Alltag wirklich "
            "entlasten.\n\n"
            "Zielgruppe: Lehrer:innen, Lernende. Anwendungskontext: "
            "übergreifend. Unterstützungsbedarf: Node.js, Client-Server-"
            "Architekturen, idealerweise Deno, Webdesign, UX/UI, CSS."
        ),
        "topic_kws": ["Inklusion", "Differenzierung", "Unterrichtsreihen",
                      "Sammlungen", "Lehrkräfte-Entlastung", "Node.js"],
    },
    {
        "file": "06_Steckbrief.pdf",
        "title": "Q&A AI-Chatbot — Intelligenter Zugang zu OER-Wissen",
        "author": "David Stöllger, Edmond Kacaj (twillo / TIB)",
        "description": (
            "Wie lassen sich verstreute OER-Inhalte, FAQs und Leitfäden durch "
            "KI-Chatbots effizient zugänglich und nutzbar machen? KI-Chatbots "
            "können komplexe, verstreute Informationen aus FAQs, Leitfäden "
            "oder OER-Plattformen durchsuchbar und leicht zugänglich machen. "
            "Konzipiert wird ein vielseitiger Prototyp, der öffentlich "
            "zugängliche Inhalte selektiv integriert, beim Erstellen und "
            "Remixen von OER unterstützt und dabei auf präzise Antworten "
            "ohne Halluzinationen achtet. Geprüft werden ressourcenschonende "
            "Open-Source-KI-Modelle, die bestehende Ansätze sinnvoll ergänzen.\n\n"
            "Zielgruppe: OER-Community, Nutzer:innen, Ersteller:innen, "
            "Plattformen. Anwendungskontext: übergreifend. "
            "Unterstützungsbedarf: Entwickler:innen und weitere Interessierte."
        ),
        "topic_kws": ["Chatbot", "KI", "Q&A", "FAQ",
                      "Open-Source-LLM", "twillo", "TIB"],
    },
    {
        "file": "07_Steckbrief.pdf",
        "title": "OER-Navigator — Passende Materialien besser finden",
        "author": "Sebastian Zug, Jihad Hyadi, Ines Aubel, André Dietrich (TU Bergakademie Freiberg)",
        "description": (
            "Wie lassen sich OER-Repositorien so durchsuchen, dass Lehrende "
            "und Lernende schnell passende Materialien finden? "
            "OER-Repositorien bieten eine Fülle von Materialien — doch die "
            "Auffindbarkeit bleibt eine Herausforderung: textbasierte Suchen "
            "liefern oft zu viele Treffer, Graphdarstellungen sind schwer "
            "zugänglich, und die Unterstützungsbedarfe der Suchenden variieren "
            "stark. Im OER-Navigator werden bestehende Formate hinterfragt "
            "und neue erprobt: von semantischen Clustern über facettierte "
            "Suche bis hin zu Recommender-Systemen. Ziel ist ein multimodaler "
            "Suchmechanismus, der Lehrende und Lernende situativ unterstützt. "
            "Beim HackathOERn liegt der Fokus auf konzeptioneller Arbeit — "
            "Bedarfe strukturieren, Zugänge evaluieren, im besten Fall einen "
            "ersten Prototypen entwickeln.\n\n"
            "Zielgruppe: OER-Community, Nutzer:innen, Ersteller:innen, "
            "Plattformen. Anwendungskontext: übergreifend. "
            "Unterstützungsbedarf: Erfahrung in Nutzung/Verwaltung großer "
            "OER-Repositorien, Frontend/Prototyping, UX/Informations-"
            "architektur, Datenvisualisierung."
        ),
        "topic_kws": ["Recommender", "Semantische Suche", "Facettierte Suche",
                      "Auffindbarkeit", "TU Freiberg"],
    },
    {
        "file": "08_Steckbrief.pdf",
        "title": "FAQ im Metadatendialog — Hilfe im Metadatenworkflow",
        "author": "David Stöllger (twillo / TIB)",
        "description": (
            "Wie können Metadaten von OER so gestaltet werden, dass sie die "
            "Nachnutzbarkeit verbessern, ohne den Workflow zu unterbrechen? "
            "Der Metadatendialog ist entscheidend für die Sichtbarkeit und "
            "Nachnutzbarkeit von OER. Lehrende wünschen sich mehr "
            "Informationen zu den Metadateneinträgen, ohne dass der Workflow "
            "unterbrochen wird. Das Projekt erprobt kontextsensitive Pop-up-"
            "Infos, die zusätzliche Hinweise (z.B. aus FAQs) direkt im "
            "Metadatendialog bereitstellen. Erste Gespräche mit Repositoriums-"
            "Betreibern wie der HOOU zeigen: dieser Ansatz wird begrüßt und "
            "unterstützt. Ziel ist mehr Orientierung für Lehrende bei "
            "gleichzeitig reibungslosem Arbeiten.\n\n"
            "Zielgruppe: OER-Community, Nutzer:innen, Ersteller:innen, "
            "Plattformen. Anwendungskontext: übergreifend."
        ),
        "topic_kws": ["Metadaten", "UX", "Kontext-Hilfen", "FAQ",
                      "Pop-up", "twillo", "HOOU"],
    },
]


def _slug(s: str) -> str:
    import re
    s = s.lower()
    repl = {"ä":"ae","ö":"oe","ü":"ue","ß":"ss"," ":"-"}
    for k, v in repl.items(): s = s.replace(k, v)
    s = re.sub(r"[^a-z0-9-]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s[:80]


async def main(dry_run: bool) -> None:
    env = os.path.join(os.path.dirname(__file__), "..", ".env")
    user = pw = None
    for line in open(env, encoding="utf-8"):
        if line.startswith("EDU_GUEST_USER="): user = line.split("=",1)[1].strip()
        elif line.startswith("EDU_GUEST_PASS="): pw = line.split("=",1)[1].strip()
    auth = "Basic " + b64encode(f"{user}:{pw}".encode()).decode()
    repo = "https://redaktion.openeduhub.net/edu-sharing/rest"

    created_ids: list[str] = []
    async with httpx.AsyncClient(timeout=120) as c:
        for idea in IDEAS:
            pdf_path = os.path.join(PDF_DIR, idea["file"])
            with open(pdf_path, "rb") as f:
                pdf_bytes = f.read()
            wwwurl = f"{BASE_URL}/{idea['file']}"
            kws = [
                "phase:anregung",
                "event:hackathoern-3",
                *idea["topic_kws"],
            ]
            props = {
                "cm:name": [_slug(idea["title"]) + ".pdf"],
                "cm:title": [idea["title"]],
                "cclom:title": [idea["title"]],
                "cclom:general_description": [idea["description"]],
                "cm:description": [idea["description"]],
                "cclom:general_keyword": kws,
                "ccm:author_freetext": [idea["author"]],
                "ccm:wwwurl": [wwwurl],
            }
            print(f"== {idea['file']:25s}  {idea['title'][:55]}")
            if dry_run:
                print(f"   would create with {len(pdf_bytes)} bytes PDF")
                continue
            # 1. Knoten anlegen
            r = await c.post(
                f"{repo}/node/v1/nodes/-home-/{INBOX_ID}/children?type=ccm:io&renameIfExists=true",
                json=props,
                headers={"Authorization": auth, "Content-Type": "application/json"},
            )
            r.raise_for_status()
            node = r.json().get("node") or {}
            nid = (node.get("ref") or {}).get("id")
            print(f"   created: {nid}")
            # 2. PDF-Content uploaden
            r2 = await c.post(
                f"{repo}/node/v1/nodes/-home-/{nid}/content"
                f"?mimetype=application/pdf&versionComment=Initial",
                files={"file": (idea["file"], pdf_bytes, "application/pdf")},
                headers={"Authorization": auth},
            )
            r2.raise_for_status()
            print(f"   uploaded {len(pdf_bytes)} B PDF")
            created_ids.append(nid)

    if not dry_run and created_ids:
        # Cache refresh
        from app import sync as sync_mod
        for nid in created_ids:
            try: await sync_mod.refresh_idea(nid)
            except Exception as e: print(f"   refresh-fail {nid[:8]}: {e}")
        print(f"\nrefreshed {len(created_ids)} idea(s) in cache")
    print(f"\nSummary: created={len(created_ids)} dry_run={dry_run}")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true")
    asyncio.run(main(p.parse_args().dry_run))
