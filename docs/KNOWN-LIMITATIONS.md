# Bekannte Grenzen & bewusste Entscheidungen (Auth)

Stand: 2026-06-23 (Auth-Härtung „Option 1").

Dieses Dokument hält bewusste Trade-offs rund um Authentifizierung fest, damit
sie nicht als „Versehen" missverstanden werden. Hintergrund/Plan:
`AUTH-OAUTH-SPIKE.md` + `~/.claude/plans/fluffy-conjuring-pretzel.md` (Phase 2).

## 1. Credentials liegen als HTTP-Basic im `sessionStorage`

Das Frontend hält `Basic base64(user:pass)` pro Browser-Tab im `sessionStorage`
(siehe `frontend/src/app/auth.service.ts`). Das ist eine **bewusste,
dokumentierte** Entscheidung bis OAuth verfügbar ist:

- **Mitigation:** Der `authInterceptor` (`auth.interceptor.ts`) hängt den
  Auth-Header **strukturell nur an die eigene API** an (`AuthService.isApiUrl`)
  — nie an eine Fremd-Origin der Einbettungsseite. Das ist ein einziger
  Chokepoint statt ~58 manueller Header pro Call und durch einen Test gepinnt
  (`api.service.spec.ts`: „sendet den Header NIEMALS an eine Fremd-URL").
- **Warum nicht direkt OAuth?** Der OAuth-Token-Flow von edu-sharing ist ohne
  Admin nicht nutzbar (fehlender `eduApp`-`client_secret`). Details +
  Selbst-Test-Rezept: `AUTH-OAUTH-SPIKE.md`. Sobald das Secret bzw. ein eigener
  Trusted-Client vorliegt, rastet OAuth lokal in `AuthService` (Frontend) +
  `auth.py` (Backend forwardet `Bearer` statt `Basic`) ein.

## 2. Moderator-Status wird kurz gecacht (≤ 60 s)

`auth.is_moderator` (`backend/app/auth.py`) cacht das Ergebnis des
edu-sharing-`my_memberships`-Calls pro Credential für 60 Sekunden.

- **Gewinn:** kein `my_memberships`-Roundtrip bei JEDEM geschützten Request
  mehr (Latenz + harte Kopplung an die ES-Verfügbarkeit fallen weg).
- **Trade-off (bewusst):** Entzogene Mod-Rechte wirken erst nach Ablauf der TTL
  (max. 60 s Verzögerung). Vertretbar für ein kleines Moderations-Team; die TTL
  ist kurz gewählt. **Transiente ES-Fehler werden NICHT gecacht** — ein kurzer
  Ausfall sperrt also keinen echten Mod 60 s lang aus (per Test gepinnt:
  `tests/test_auth_cache.py`). Schlüssel ist ein SHA-256 des Auth-Headers, nie
  das Klartext-Credential.
- **Schreibpfade** (`auth.verify_login`) sind **nicht** gecacht: ein geändertes/
  entzogenes Passwort greift dort sofort.

## 3. Kein `Depends()`-Routing-Layer (bewusst ausgelassen)

Der Sanierungsplan nannte einen FastAPI-`Depends()`-Layer. Beim Umbau zeigte
der Code, dass der `Authorization`-Header in **67 Routen** an edu-sharing
weitergereicht wird (Basic-Pass-Through). Ein `Depends()`-Provider, der nur den
Usernamen liefert, würde den `Header(None)`-Parameter dort **nicht** ersetzen —
die Route braucht den rohen Header weiter zum Forwarden. Eine Umstellung würde
Code also **verschieben statt reduzieren** und 67 Call-Sites anfassen (Risiko
ohne Funktionsgewinn).

Das eigentliche Ziel — **eine Quelle der Wahrheit für die Auth-Logik** — ist
stattdessen durch das Modul `backend/app/auth.py` erreicht (die Prädikate sind
zentralisiert; `routes.py` re-importiert sie unter ihren bisherigen Namen).
`_require_moderator` bleibt in `routes.py`, weil es HTTP-Status (401/403) und
Audit-Logging bündelt — beides Route-Belange.
