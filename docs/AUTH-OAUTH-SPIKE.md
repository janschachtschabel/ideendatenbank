# Auth-Mechanismus: OAuth-Spike & Wissensstand

Stand: 2026-06-23.

Dieses Dokument hält fest, **was wir über OAuth/Bearer bei edu-sharing wissen**,
**was der Spike ergeben hat** und **was vom Admin/Team noch gebraucht wird**, damit
ein späterer Wechsel von Basic-Auth auf OAuth nicht bei null beginnt.

> **Kurzfazit:** OAuth ist auf der Instanz technisch vorhanden, aber **ohne
> Admin nicht nutzbar** — der nötige `client_secret` (bzw. ein registrierter
> Trusted-App-Public-Key) liegt beim edu-sharing-Admin. Bis dahin bleibt
> **Basic-Auth**, gehärtet über die Auth-Abstraktion (siehe „Entscheidung").

---

## 1. Warum überhaupt OAuth?

Das Programmierer-Review kritisierte: Credentials liegen als
`Basic base64(user:pass)` im `sessionStorage` und werden pro Request an die eigene
API geschickt. Gewünscht: token-basierter Flow (kurzlebige Tokens, Refresh) statt
dauerhaft mitgeführter Klartext-Credentials. OAuth/Bearer wäre der sauberere
Mechanismus — **sofern edu-sharing ihn für unsere App bereitstellt**.

## 2. Methodik des Spikes (sicher, ohne Geheimnisse)

Nur **credential-freie Contract-Probes** (read-only) gegen die geteilte Instanz
`https://redaktion.openeduhub.net`. **Keine** echten Zugangsdaten, **kein**
Secret-Raten/Brute-Force, **keine** schreibenden Calls. Ziel war ausschließlich
herauszufinden, *welche Auth-Mechanismen die API anbietet und welche Fehlermeldung
sie auf welchen Reiz gibt*.

## 3. Befunde

### 3.1 Token-Endpoint existiert, verlangt einen *trusted client*

`POST /edu-sharing/oauth2/token`:

| Reiz | Antwort | Deutung |
|---|---|---|
| keine Parameter | `500` (Java-NPE, content-type null) | Endpoint existiert, will Parameter |
| `grant_type=bogus` / `grant_type=password` (ohne Client) | `401 {"error":"trustless client_id"}` | Token nur für **registrierte** Clients |

### 3.2 `eduApp` IST ein registrierter Trusted-Client (Schlüsselbefund)

Verschiedene `client_id`-Werte mit **Dummy**-Secret (`x`/`x`):

| `client_id` | Antwort | Deutung |
|---|---|---|
| **`eduApp`** | **`{"error":"invalid client_secret"}`** | **erkannt/trusted** — nur das Secret fehlt |
| `edu-sharing`, `edusharing`, `web`, `webapp`, `default`, `local`, `localhost`, `trusted`, `ngApp`, `angular` | `{"error":"trustless client_id"}` | nicht registriert |

→ Die *andere* Fehlermeldung bei `eduApp` (`invalid client_secret` statt
`trustless client_id`) beweist: **`eduApp` ist ein bekannter, vertrauenswürdiger
Client.** Es braucht **keine Neu-Registrierung** — nur den korrekten
`client_secret`. `eduApp` ist der historische Standard-Client der
edu-sharing-App.

### 3.3 Trusted-App / `appauth` (Public-Key-Variante)

`GET /rest/authentication/v1/appauth/{userId}` → `405` (Methode existiert, falsches
Verb). Die Trusted-App-Variante setzt einen **vom Admin registrierten Public Key**
voraus (RSA-signierte Requests). Ohne Admin nicht herstellbar.

### 3.4 Akzeptiert die REST-API `Authorization: Bearer`?

- **Noch nicht abschließend geklärt.** Das REST-OpenAPI deklariert als Security-
  Schemes nur `basicAuth` + `cookieAuth` — **kein** Bearer-Scheme. Das heißt nicht
  zwingend, dass Bearer abgelehnt wird (edu-sharing prüft Tokens teils außerhalb der
  OpenAPI-Deklaration), aber es ist nicht dokumentiert.
- Bearer-Test mit Müll-Token gegen `/rest/iam/v1/people/-home-/-me-` → `200`,
  **aber** ohne jede Auth ebenfalls `200` (Endpoint ist gast-lesbar) → **nicht
  aussagekräftig**.
- **Für einen sauberen Bearer-Test gefunden:** `GET /rest/admin/v1/applications`
  liefert **ohne Auth `401`**. Mit einem gültigen Token muss er `!= 401` werden
  (`200`/`403`) — erst das beweist, dass die REST-API Bearer akzeptiert.

| Endpoint | ohne Auth | als Bearer-Testziel |
|---|---|---|
| `/rest/admin/v1/applications` | **401** | ✅ geeignet (Admin-gated) |
| `/rest/bulk/v1/sync/PERSON` | 401 | geeignet |
| `/rest/iam/v1/people/-home-/-me-` | 200 | ❌ gast-lesbar |
| `/rest/iam/v1/people/-home-/-me-/preferences` | 500 | ❌ Server-Bug |

## 4. Was fehlt (Admin/Team) — Blocker

1. **`client_secret` des `eduApp`-Clients** (Deployment-Config-Wert, admin-gehalten).
   *Ohne diesen kein Password-Grant.* — **Aktuell nicht verfügbar.**
2. *Alternativ:* **eigener Trusted-Client + Secret** speziell für die
   Ideendatenbank registrieren (sauberer als `eduApp` mitzubenutzen), **oder** ein
   **Trusted-App-Public-Key** für die `appauth`-Variante.
3. **Bestätigung**, dass die REST-API `Authorization: Bearer` akzeptiert (mit dem
   Test aus 3.4 verifizierbar, sobald ein Token vorliegt).
4. Klärung, ob der **Service-/Gast-Account** denselben Flow nutzen kann (die App
   spricht edu-sharing auch ohne eingeloggten User an).

## 5. Selbst-Test-Rezept (wenn das Secret vorliegt)

Sobald der `eduApp`-`client_secret` legitim verfügbar ist, lässt sich die
Machbarkeit ohne weitere Admin-Hilfe abschließend verifizieren. Secret und
Passwort interaktiv einlesen (nicht in die Shell-History):

```bash
BASE=https://redaktion.openeduhub.net
read -rp  "edu-sharing User: " U
read -rsp "edu-sharing Passwort: " PW; echo
read -rsp "eduApp client_secret: " CS; echo

# 1) Token holen (Password-Grant via trusted client 'eduApp'):
curl -s -X POST "$BASE/edu-sharing/oauth2/token" \
  --data-urlencode "grant_type=password" --data-urlencode "client_id=eduApp" \
  --data-urlencode "client_secret=$CS" \
  --data-urlencode "username=$U" --data-urlencode "password=$PW"
#   erwartet: {"access_token":"...","token_type":"Bearer","refresh_token":"..."}

# 2) Bearer gegen einen auth-pflichtigen Endpoint testen (ohne Auth = 401):
TOKEN="<access_token aus Schritt 1>"
curl -s -o /dev/null -w "Bearer -> HTTP %{http_code}\n" \
  -H "Authorization: Bearer $TOKEN" "$BASE/edu-sharing/rest/admin/v1/applications"
#   401 = REST akzeptiert Bearer NICHT;  200/403 = Bearer wird akzeptiert
```

Ergebnis = grün (Token + non-401) → OAuth ist umsetzbar; rot → bei Basic bleiben.

## 6. Skizze der Umsetzung (falls Spike grün)

- Backend hält den `eduApp`-`client_secret` als **Env-Secret** (wie
  `EDU_GUEST_PASS`) — **nie** ins Git, **nie** ins Frontend.
- `AuthService` (Frontend) holt das Token über das Backend (Backend kennt das
  Secret), verwaltet Ablauf + Refresh.
- Backend forwardet `Authorization: Bearer <token>` statt `Basic` an edu-sharing.
- **Basic bleibt Fallback**, bis Bearer für *alle* Pfade (inkl. Uploads,
  Mod-Checks, Gast) nachgewiesen ist. Die Phase-0-Auth-Tests müssen mit Bearer
  unverändert grün sein (Funktionsparität).

## 7. Sicherheits-Beobachtung (für das Team)

Dass `eduApp` per Password-Grant erreichbar ist, bedeutet: Wer das
`eduApp`-Secret kennt, kann mit User-Credentials Tokens ziehen. Das Team sollte
sicherstellen, dass der `eduApp`-`client_secret` **kein Default-Wert** ist.

---

## Entscheidung

OAuth ist **spike-gated** und derzeit **admin-blockiert** (Secret/Registrierung).
Deshalb: **jetzt kein OAuth**, sondern zuerst die **strukturelle Auth-Härtung**
(Plan-Phase 2, „Option 1") — vollständig selbst umsetzbar, ohne edu-sharing-
Änderung, vom 70-Test-Sicherheitsnetz gedeckt. Diese Abstraktion (Backend
`auth.py` + `Depends()` + Mod-Status-Cache; Frontend `AuthService` + HTTP-
Interceptor) ist genau die Naht, in die OAuth später als **lokal begrenzter**
Wechsel einrastet. Sobald der `eduApp`-Secret (oder ein eigener Trusted-Client)
vom Admin bereitsteht, Selbst-Test aus Abschnitt 5 fahren und Abschnitt 6 umsetzen.

Siehe Gesamtplan: `~/.claude/plans/fluffy-conjuring-pretzel.md` (Phase 2 / 2c).
