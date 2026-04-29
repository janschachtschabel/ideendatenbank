# edu-sharing Social API - Referenz fuer Entwickler

Stand: 2026-04-14 | Getestet auf Staging und Prod

## Umgebungen

| Umgebung | Base-URL | Swagger |
|----------|----------|---------|
| **Staging** | `https://repository.staging.openeduhub.net/edu-sharing/rest` | [Swagger UI](https://repository.staging.openeduhub.net/edu-sharing/swagger/) |
| **Produktion** | `https://redaktion.openeduhub.net/edu-sharing/rest` | [Swagger UI](https://redaktion.openeduhub.net/edu-sharing/swagger/) |

**OpenAPI Spec:** `{base-url}/../rest/openapi.json`

---

## Authentifizierung

- **Basic Auth:** `Authorization: Basic base64(username:password)`
- Lesen von Node-Metadaten (inkl. Rating) geht **ohne Auth**
- Kommentare lesen/schreiben erfordert **immer Auth** + `Comment`-Permission
- Rating schreiben erfordert **Auth** + `Rate`-Permission
- Feedback schreiben erfordert **Auth** + `Feedback`-Permission

### Rechte pruefen

Die verfuegbaren Rechte stehen im Node-Metadaten-Response unter `access` (Gast) und `accessEffective` (eingeloggt):

```
"access": ["Read", "ReadAll", "Embed", "Feedback", "DownloadContent"],
"accessEffective": ["Read", "Comment", "RateRead", "Consumer", "Feedback", "ReadAll", "Embed", "Rate", "DownloadContent", "ReadPreview"]
```

---

## 1. Kommentare (COMMENT v1)

### Kommentare lesen

```
GET /comment/v1/comments/-home-/{nodeId}
Authorization: Basic {credentials}
Accept: application/json
```

**Response (200):**
```json
{
  "comments": [
    {
      "ref": { "repo": "local", "id": "comment-uuid" },
      "replyTo": { "repo": "local", "id": "parent-comment-uuid" },
      "creator": {
        "firstName": "Max",
        "lastName": "Mustermann",
        "authorityName": "mmustermann"
      },
      "created": "2026-04-14T10:30:00.000Z",
      "comment": "Das ist ein Kommentar"
    }
  ]
}
```

- `replyTo` ist nur gefuellt wenn der Kommentar eine Antwort auf einen anderen ist
- Ohne Auth: **403** (`No permission 'Comment'`)

### Kommentar erstellen

```
PUT /comment/v1/comments/-home-/{nodeId}
Authorization: Basic {credentials}
Content-Type: application/json

"Das ist mein Kommentar"
```

**Body:** Ein JSON-String (in Anfuehrungszeichen!), kein Objekt.

**Antwort auf einen bestehenden Kommentar:**
```
PUT /comment/v1/comments/-home-/{nodeId}?commentReference={parentCommentId}
```

### Kommentar bearbeiten

```
POST /comment/v1/comments/-home-/{commentId}
Authorization: Basic {credentials}
Content-Type: application/json

"Aktualisierter Text"
```

### Kommentar loeschen

```
DELETE /comment/v1/comments/-home-/{commentId}
Authorization: Basic {credentials}
```

### Beispiel (curl)

```bash
# Kommentare lesen
curl -u "user:pass" \
  "https://repository.staging.openeduhub.net/edu-sharing/rest/comment/v1/comments/-home-/eb3ab633-3449-45f8-bab6-333449f5f84b" \
  -H "Accept: application/json"

# Kommentar erstellen
curl -u "user:pass" -X PUT \
  "https://repository.staging.openeduhub.net/edu-sharing/rest/comment/v1/comments/-home-/eb3ab633-3449-45f8-bab6-333449f5f84b" \
  -H "Content-Type: application/json" \
  -d '"Mein Kommentar"'

# Antwort auf Kommentar
curl -u "user:pass" -X PUT \
  "https://repository.staging.openeduhub.net/edu-sharing/rest/comment/v1/comments/-home-/eb3ab633-3449-45f8-bab6-333449f5f84b?commentReference=COMMENT-UUID" \
  -H "Content-Type: application/json" \
  -d '"Meine Antwort"'
```

---

## 2. Rating (RATING v1)

### Rating lesen (OHNE Auth)

Es gibt **keinen** oeffentlichen GET-Endpunkt fuer Ratings. Stattdessen den **Node-Metadaten-Endpunkt** verwenden:

```
GET /node/v1/nodes/-home-/{nodeId}/metadata
Accept: application/json
```

Das Rating steckt im Response unter `node.rating`:

```json
{
  "node": {
    "rating": {
      "overall": {
        "sum": 9.0,
        "count": 2,
        "rating": 4.5
      },
      "affiliation": {
        "null": { "sum": 9.0, "count": 2, "rating": 4.5 }
      },
      "user": 4.0
    },
    "commentCount": 3
  }
}
```

| Feld | Bedeutung |
|------|-----------|
| `overall.rating` | Durchschnittliche Bewertung |
| `overall.count` | Anzahl Bewertungen |
| `overall.sum` | Summe aller Bewertungen |
| `user` | Eigene Bewertung des aktuellen Users (0 = keine) |
| `commentCount` | Anzahl Kommentare (Bonus-Info) |

**Hinweis:** `user` ist nur aussagekraeftig wenn man eingeloggt ist. Als Gast immer 0.

### Bewertung abgeben / aendern

```
PUT /rating/v1/ratings/-home-/{nodeId}?rating={1-5}
Authorization: Basic {credentials}
Content-Type: application/json

" "
```

- `rating` (Query-Param): Wert von 1 bis 5 (Typ: double)
- **Body ist required** (laut Swagger "Text content of rating"), aber der Text taucht nirgends in der Response auf. Einfach einen Leerstring `" "` senden.
- Wenn der User bereits bewertet hat, wird die Bewertung aktualisiert.

### Bewertung loeschen

```
DELETE /rating/v1/ratings/-home-/{nodeId}
Authorization: Basic {credentials}
```

> **BUG:** Liefert aktuell 500 auf Staging und Prod (NullPointerException wegen fehlender Rating-Config). Siehe "Bekannte Bugs".

### Rating-Konfiguration

Das System unterstuetzt je nach `ConfigRating.mode`:
- `"stars"` - Stern-Bewertung (1-5)
- `"likes"` - Like-basiert
- `"none"` - Bewertungen deaktiviert

### Beispiel (curl)

```bash
# Rating lesen (ohne Auth)
curl "https://redaktion.openeduhub.net/edu-sharing/rest/node/v1/nodes/-home-/8207f3ed-b572-475b-951e-dac8b7a3986d/metadata" \
  -H "Accept: application/json" | jq '.node.rating'

# Bewertung abgeben (4 Sterne)
curl -u "user:pass" -X PUT \
  "https://redaktion.openeduhub.net/edu-sharing/rest/rating/v1/ratings/-home-/8207f3ed-b572-475b-951e-dac8b7a3986d?rating=4" \
  -H "Content-Type: application/json" \
  -d '" "'
```

---

## 3. Feedback (FEEDBACK v1)

### Feedback abgeben

```
PUT /feedback/v1/feedback/-home-/{nodeId}/add
Authorization: Basic {credentials}
Content-Type: application/json

{
  "additionalProp1": ["Wert 1"],
  "additionalProp2": ["Wert 2"]
}
```

- Body: Key-Value-Paare (`{string: string[]}`) - freie Struktur
- Laut Swagger: "the current user will be obscured to prevent back-tracing to the original id"

> **BUG:** Liefert aktuell 500 auf Staging und Prod, aber das Feedback wird trotzdem gespeichert! Beim Implementieren den 500er also nicht als Fehlschlag werten.

### Feedbacks lesen

```
GET /feedback/v1/feedback/-home-/{nodeId}/list
Authorization: Basic {credentials}
```

- Erfordert **Coordinator**-Berechtigung
> **BUG:** Liefert aktuell 500 auf Staging und Prod (FeedbackServiceImpl Bean fehlt).

### Beispiel (curl)

```bash
# Feedback abgeben (liefert 500 aber speichert trotzdem!)
curl -u "user:pass" -X PUT \
  "https://redaktion.openeduhub.net/edu-sharing/rest/feedback/v1/feedback/-home-/8207f3ed-b572-475b-951e-dac8b7a3986d/add" \
  -H "Content-Type: application/json" \
  -d '{"kommentar": ["Tolles Material"], "bewertung": ["gut"]}'
```

---

## Bekannte Bugs (Stand: 2026-04-14)

### Bug 1: DELETE Rating - 500 NullPointerException

| | Detail |
|-|--------|
| **Endpunkt** | `DELETE /rating/v1/ratings/-home-/{node}` |
| **Fehler** | `Cannot read field "mode" because "config.values.rating" is null` |
| **Betrifft** | Staging + Prod |
| **Ursache** | Rating-Config (`ConfigRating`) nicht gesetzt, Null-Check fehlt in `RatingDao.deleteRating()` |
| **Workaround** | Keiner. Rating kann nur ueberschrieben (PUT), nicht geloescht werden. |

### Bug 2: Feedback-Service komplett kaputt - 500

| | Detail |
|-|--------|
| **Endpunkte** | `GET .../list` und `PUT .../add` |
| **Fehler** | `NoSuchBeanDefinitionException: FeedbackServiceImpl` |
| **Betrifft** | Staging + Prod |
| **Ursache** | FeedbackServiceImpl Bean nicht registriert/deployiert |
| **Workaround** | PUT speichert trotzdem (bestaetigt!), Response ist aber immer 500. GET geht gar nicht. |

---

## Zusammenfassung: Was funktioniert?

| Funktion | Auth noetig | Lesen | Schreiben | Loeschen |
|----------|-------------|-------|-----------|----------|
| **Node-Metadaten + Rating** | Nein | OK | - | - |
| **Kommentare** | Ja | OK | OK | OK |
| **Rating abgeben** | Ja | (via Metadaten) | OK | BUG (500) |
| **Feedback** | Ja | BUG (500) | Speichert, aber 500 | - |

---

## Test-Node-IDs

| Umgebung | Node-ID | Titel |
|----------|---------|-------|
| Staging | `eb3ab633-3449-45f8-bab6-333449f5f84b` | Metakognition - Lernen zu Lernen |
| Prod | `8207f3ed-b572-475b-951e-dac8b7a3986d` | Bundesweiter Wettbewerb Physik |

---

## Wichtige Hinweise fuer Entwickler

1. **Comment-Body ist ein JSON-String**, kein Objekt: `"Mein Text"` (mit Anfuehrungszeichen)
2. **Rating-Body ist required aber nutzlos** - einfach `" "` senden
3. **Rating lesen geht nur ueber Node-Metadaten** - es gibt keinen eigenen GET-Endpunkt fuer normale User
4. **Feedback-PUT liefert 500 aber speichert** - bei der Fehlerbehandlung beruecksichtigen
5. **Repository-Parameter** ist immer `"-home-"` fuer das Home-Repository
6. **Prod versteckt Fehlerdetails** (`security.logging.displayLevel=minimal`) - zum Debuggen besser Staging nutzen
