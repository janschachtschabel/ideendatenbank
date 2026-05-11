"""Konsolidiert Event-Slug-Duplikate in der Taxonomie + auf den Ideen.

Hintergrund: in der Taxonomie standen historisch zwei Slugs pro Event
(z.B. `hackthoern-01` UND `hackathoern-1`). Verschiedene Skripte/Editoren
haben mal den einen, mal den anderen geschrieben → die Filter-Pillen zeigen
duplikate Einträge.

Vorgehen:
1. Pro Event ein **kanonischer Slug** definiert (siehe MAPPING)
2. Alle Ideen mit Alt-Slugs in `cclom:general_keyword` migriert
3. Alt-Slugs aus der App-Taxonomie deaktiviert (active=0), nicht gelöscht
   (weil ggf. noch in Backups/historischen Daten referenziert)
"""
from __future__ import annotations
import argparse, asyncio, os, sys
from base64 import b64encode

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
import httpx
from app.db import connect

# Alt-Slug → Kanonisch
MAPPING = {
    "hackthoern-01":    "hackathoern-1",
    "hackathoern-02":   "hackathoern-2",
    "hackathoern-03":   "hackathoern-3",
}


async def main(dry_run: bool) -> None:
    env = os.path.join(os.path.dirname(__file__), "..", ".env")
    user = pw = None
    for line in open(env, encoding="utf-8"):
        if line.startswith("EDU_GUEST_USER="): user = line.split("=",1)[1].strip()
        elif line.startswith("EDU_GUEST_PASS="): pw = line.split("=",1)[1].strip()
    auth = "Basic " + b64encode(f"{user}:{pw}".encode()).decode()
    repo = "https://redaktion.openeduhub.net/edu-sharing/rest"

    # 1. Stelle sicher, dass die kanonischen Slugs in der Taxonomie existieren
    with connect() as con:
        for old, new in MAPPING.items():
            row = con.execute(
                "SELECT label, sort_order FROM taxonomy_event WHERE slug=?", (old,)
            ).fetchone()
            new_row = con.execute(
                "SELECT 1 FROM taxonomy_event WHERE slug=?", (new,)
            ).fetchone()
            if row and not new_row:
                # Kanonisch fehlt → mit Label und sort_order vom alten anlegen
                print(f"  + Taxonomie {new!r} (Label='{row['label']}') anlegen")
                if not dry_run:
                    from datetime import datetime, timezone
                    con.execute(
                        "INSERT INTO taxonomy_event "
                        "(slug,label,sort_order,active,created_at,created_by) "
                        "VALUES (?,?,?,1,?,'consolidate_script')",
                        (new, row["label"], row["sort_order"],
                         datetime.now(timezone.utc).isoformat()),
                    )
            # Alten Eintrag deaktivieren
            if row:
                print(f"  · Taxonomie {old!r} → inaktiv")
                if not dry_run:
                    con.execute(
                        "UPDATE taxonomy_event SET active=0 WHERE slug=?", (old,),
                    )

    # 2. Alle Ideen mit Alt-Event-Slug migrieren (im edu-sharing schreiben)
    #    Wir holen aus dem Cache alle ideen, deren `events` einen Alt-Slug
    #    enthält, mappen die Originals und schreiben dort die korrigierten
    #    Keywords.
    with connect() as con:
        rows = con.execute("SELECT id, events, keywords FROM idea").fetchall()

    affected: list[tuple[str, list[str]]] = []
    import json
    for r in rows:
        evs = json.loads(r["events"] or "[]")
        if any(e in MAPPING for e in evs):
            affected.append((r["id"], evs))
    print(f"\n  {len(affected)} Ideen mit Alt-Event-Slug gefunden:")
    for nid, evs in affected[:5]:
        print(f"    {nid[:8]}  events={evs}")

    if not affected:
        print("  Nichts zu migrieren in den Ideen.")
        return

    async with httpx.AsyncClient(timeout=60) as c:
        for nid, _evs in affected:
            try:
                meta = (await c.get(
                    f"{repo}/node/v1/nodes/-home-/{nid}/metadata?propertyFilter=-all-",
                    headers={"Authorization": auth},
                )).json().get("node") or {}
            except Exception as e:
                print(f"    ! {nid[:8]} meta-fail: {e}"); continue
            orig_id = meta.get("originalId")
            kws = (meta.get("properties") or {}).get("cclom:general_keyword") or []
            if isinstance(kws, str): kws = [kws]
            new_kws: list[str] = []
            seen: set[str] = set()
            changed = False
            for k in kws:
                if not isinstance(k, str): continue
                if k.lower().startswith("event:"):
                    old_slug = k[len("event:"):]
                    new_slug = MAPPING.get(old_slug, old_slug)
                    if new_slug != old_slug: changed = True
                    out = f"event:{new_slug}"
                else:
                    out = k
                if out.lower() not in seen:
                    seen.add(out.lower())
                    new_kws.append(out)
            if not changed:
                continue
            # Beide schreiben: Referenz hat lokale Property-Override-Slots, die
            # die geerbten Werte des Originals überschatten. Wenn wir nur das
            # Original schreiben, bleibt der alte Wert auf der Reference sichtbar.
            targets = [nid] if not orig_id else [nid, orig_id]
            print(f"    + {nid[:8]} → targets={[t[:8] for t in targets]} events normalisiert")
            if dry_run: continue
            for tgt in targets:
                try:
                    await c.put(
                        f"{repo}/node/v1/nodes/-home-/{tgt}/metadata",
                        json={"cclom:general_keyword": new_kws},
                        headers={"Authorization": auth, "Content-Type": "application/json"},
                    )
                except httpx.HTTPStatusError as ex:
                    print(f"      ERR {tgt[:8]} {ex.response.status_code}: {ex.response.text[:120]}")

    # 3. Cache refresh
    if not dry_run:
        from app import sync as sync_mod
        for nid, _ in affected:
            try: await sync_mod.refresh_idea(nid)
            except Exception: pass
        print(f"\n  refreshed {len(affected)} idea(s) in cache")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true")
    asyncio.run(main(p.parse_args().dry_run))
