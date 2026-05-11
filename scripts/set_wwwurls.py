"""Setzt ccm:wwwurl auf jene 4 Karten, deren HTML-Inhalt eine eindeutige
externe URL enthält — extrahiert aus dem textContent."""
from __future__ import annotations
import argparse, asyncio, os, sys
from base64 import b64encode
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
import httpx

WWWURLS = {
    # ref-id  →  (originalId, URL aus HTML-Inhalt)
    "f026e46d-ba8b-4011-a6e4-6dba8bc0113a": "https://gamma.app/docs/Datenbasiert-das-Lernen-im-Sozialraums-gestalten-entuwnetuwk13gm?mode=doc",
    "6535ebbb-5792-46d8-b5eb-bb5792a6d8f1": "https://www.youtube.com/watch?v=E0mFOPkUQzU",
    "489ee4b4-f1b4-4ff7-9ee4-b4f1b4dff709": "https://yjs.dev/",
    "a5a7d45d-ff9b-4378-a7d4-5dff9ba378b9": "https://matrix.to/#/#oer-it:academiccloud.de",
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
        for ref_id, url in WWWURLS.items():
            try:
                meta = (await c.get(
                    f"{repo}/node/v1/nodes/-home-/{ref_id}/metadata?propertyFilter=-all-",
                    headers={"Authorization": auth}, timeout=30,
                )).json().get("node") or {}
            except Exception as e:
                print(f"  ! {ref_id[:8]} meta-fail: {e}"); continue
            tid = meta.get("originalId") or ref_id
            print(f"  + {ref_id[:8]} → {tid[:8]}  url={url}")
            if dry_run: continue
            try:
                r = await c.put(
                    f"{repo}/node/v1/nodes/-home-/{tid}/metadata",
                    json={"ccm:wwwurl": [url]},
                    headers={"Authorization": auth, "Content-Type": "application/json"},
                    timeout=60,
                )
                r.raise_for_status(); ok += 1
            except httpx.HTTPStatusError as ex:
                print(f"      ERR {ex.response.status_code}: {ex.response.text[:120]}")
                err += 1
    print(f"\nSummary: ok={ok} err={err}  dry_run={dry_run}")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true")
    asyncio.run(main(p.parse_args().dry_run))
