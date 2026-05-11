"""Räumt die alten Anhänge-Sammlungen (ccm:map mit Keyword
`attachment-of:<idea-id>`) aus edu-sharing weg und setzt
`attachment_folder_id=NULL` im SQLite-Cache.

Hintergrund: Die Anhänge-Lösung wurde auf Child-IO-Serienobjekte
(`ccm:childio` + `ccm:io_childobject`-Aspekt) umgestellt. Die alten,
leeren Geschwister-Sammlungen werden nicht mehr gebraucht und sollen
entfernt werden, bevor sie für Verwirrung sorgen.

Aufruf:
    python scripts/cleanup_old_attachment_folders.py [--dry-run]
"""
from __future__ import annotations
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

import argparse
import base64
from app.db import connect
from app import edu_sharing


async def main(dry_run: bool) -> None:
    # Wir benutzen den WLO-Upload Gast (ist auf Prod Mitglied von
    # GROUP_ALFRESCO_ADMINISTRATORS) — er hat Schreibrecht auf alle alten
    # Anhänge-Sammlungen. Fallback auf .env-Werte.
    es_user = os.environ.get("ES_ADMIN_USER") or os.environ.get("EDU_GUEST_USER")
    es_pass = os.environ.get("ES_ADMIN_PASS") or os.environ.get("EDU_GUEST_PASS")
    if not (es_user and es_pass):
        # .env lesen
        envfile = os.path.join(os.path.dirname(__file__), "..", ".env")
        if os.path.exists(envfile):
            for line in open(envfile, encoding="utf-8"):
                line = line.strip()
                if line.startswith("EDU_GUEST_USER="):
                    es_user = line.split("=", 1)[1].strip()
                elif line.startswith("EDU_GUEST_PASS="):
                    es_pass = line.split("=", 1)[1].strip()
    if not (es_user and es_pass):
        print("Keine Credentials gefunden (EDU_GUEST_USER/PASS in .env oder ES_ADMIN_USER/PASS in env).")
        sys.exit(2)
    auth = "Basic " + base64.b64encode(f"{es_user}:{es_pass}".encode()).decode()

    with connect() as con:
        rows = con.execute(
            "SELECT id, title, attachment_folder_id FROM idea "
            "WHERE attachment_folder_id IS NOT NULL"
        ).fetchall()

    print(f"Found {len(rows)} ideas with legacy attachment_folder_id")

    deleted = 0
    not_found = 0
    errors = 0
    for r in rows:
        fid = r["attachment_folder_id"]
        print(f"  idea={r['id']!s:36} folder={fid} title={r['title']!r}")
        if dry_run:
            continue
        try:
            await edu_sharing.client.delete_node(fid, auth_header=auth)
            deleted += 1
            print(f"    -> deleted")
        except Exception as e:
            msg = str(e)
            if "404" in msg:
                not_found += 1
                print("    -> already 404 in ES")
            else:
                errors += 1
                print(f"    -> error: {msg[:160]}")

    if not dry_run:
        with connect() as con:
            con.execute(
                "UPDATE idea SET attachment_folder_id=NULL "
                "WHERE attachment_folder_id IS NOT NULL"
            )
        print(f"\nCache cleared: attachment_folder_id=NULL set for all rows.")

    print(f"\nSummary: deleted={deleted} not_found={not_found} errors={errors}")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()
    asyncio.run(main(args.dry_run))
