# 6. Auf eigener Webseite einbinden (Web-Component)

Die Ideendatenbank lässt sich als **Web-Component** in jede Webseite einbetten —
ohne Iframe, mit nativer DOM-Integration, responsive und themable.

## Konzept

Die App registriert zwei Custom Elements:
- `<ideendb-app>` — die komplette Anwendung mit Topbar + allen Seiten
- `<ideendb-tile-grid>` — nur die Kachelansicht, gut für Widgets

Ein `<script>`-Tag lädt das Bundle einmalig pro Seite. Danach sind beide Tags
beliebig oft verwendbar.

## Setup (einmal pro Seite)

```html
<script type="module" src="https://ideen.example.de/main.js"></script>
```

Ersetze `ideen.example.de` durch die Domain, auf der die App läuft.

## Voll-App

Komplette Anwendung mit Topbar + allen Seiten:

```html
<ideendb-app api-base="/api/v1"></ideendb-app>
```

Auf einer anderen Domain als die App — `api-base` muss die volle URL sein:

```html
<ideendb-app api-base="https://ideen.example.de/api/v1"></ideendb-app>
```

### Attribute

| Attribut | Werte | Bedeutung |
|---|---|---|
| `api-base` | URL | Basis-URL des Backends, default `/api/v1` |
| `theme` | `default` / `hackathoern` / `dark` | initiales Farbschema |
| `view` | `home` / `detail` / `user` / `browser` / `ranking` / `topics` / `events` / `submit` / `embed` / `help` | Initiale Seite |
| `idea-id` | UUID | Nur bei `view="detail"`: ID der direkt geöffneten Idee |
| `u` | Username | Nur bei `view="user"`: Profil-Username |

### Beispiele

**Direkt eine bestimmte Idee zeigen:**
```html
<ideendb-app
  api-base="https://ideen.example.de/api/v1"
  view="detail"
  idea-id="44554d62-3cd7-44ce-954d-623cd7c4ce42"></ideendb-app>
```

**Öffentliches Profil einer Person:**
```html
<ideendb-app
  api-base="https://ideen.example.de/api/v1"
  view="user"
  u="janschachtschabel"></ideendb-app>
```

**Direkt zum Einreiche-Formular:**
```html
<ideendb-app
  api-base="https://ideen.example.de/api/v1"
  view="submit"></ideendb-app>
```

Praktisch z.B. als QR-Code auf einem Konferenz-Plakat.

## Tile-Grid (Kachelansicht ohne Header)

Wenn du nur die Ideen-Kacheln willst — z.B. als Widget auf einer Blog-Sidebar:

```html
<ideendb-tile-grid
  api-base="https://ideen.example.de/api/v1"
  limit="6"></ideendb-tile-grid>
```

### Attribute

| Attribut | Werte | Bedeutung |
|---|---|---|
| `api-base` | URL | s.o. |
| `theme` | s.o. | Farbschema (muss gesetzt sein, kein Auto-Detect) |
| `topic-id` | UUID | nur Ideen unter dieser Sammlung |
| `phase` | Slug (`anregung`, `pitch-bereit`, …) | Filter |
| `event` | Slug (`hackathoern-3`) | Filter |
| `category` | Slug | Filter |
| `q` | Text | Volltext-Suche |
| `ids` | Komma-UUIDs | gezielte Auswahl (mehrere Ideen) |
| `sort` | `modified` / `created` / `rating` / `comments` / `title` | |
| `order` | `asc` / `desc` | |
| `limit` | Zahl 1–200 | wie viele Kacheln |
| `hide-footer` | boolean | „Mehr laden"-Button ausblenden |

### Beispiele

**Top-3-Ideen einer Veranstaltung auf einem Pre-Event-Blog:**
```html
<ideendb-tile-grid
  api-base="https://ideen.example.de/api/v1"
  event="hackathoern-3"
  sort="rating"
  limit="3"
  hide-footer></ideendb-tile-grid>
```

**Eigene Ideen-Liste per ID:**
```html
<ideendb-tile-grid
  api-base="https://ideen.example.de/api/v1"
  ids="abc-123,def-456,ghi-789"
  hide-footer></ideendb-tile-grid>
```

**Volltext-Suche-Widget:**
```html
<ideendb-tile-grid
  api-base="https://ideen.example.de/api/v1"
  q="KI-gestützte Inhalte"
  limit="12"></ideendb-tile-grid>
```

## Themes

Drei vordefinierte Themes, alle CSS-Variablen-basiert:

| Theme | Look | Tipp |
|---|---|---|
| `default` | Dunkelblauer Header, gelbe Akzente, helle Karten | klassisches WLO-Branding |
| `hackathoern` | Weißer Header mit Logo-Cyan/Orange/Olive-Akzenten | helles, freundliches Look |
| `dark` | Neutrale Grauabstufungen, Gold-Akzent | für Abend-/Nacht-Nutzung |

Setzbar via Attribut: `theme="hackathoern"`. Falls nicht gesetzt, gilt im Browser
`prefers-color-scheme` (Dark-Mode-Detection des OS), Fallback auf `default`.

### Eigene Branding-Farben

Wer eigene Farben braucht, überschreibt die CSS-Custom-Properties auf der
Host-Seite:

```html
<style>
  ideendb-app, ideendb-tile-grid {
    --wlo-primary:    #6f42c1;   /* eigenes Primary */
    --wlo-cta-bg:     #fd7e14;   /* eigene CTA-Farbe */
    --wlo-cta-text:   #fff;
  }
</style>
<ideendb-app theme="default"></ideendb-app>
```

## CORS + Cross-Origin

Wenn die App auf `ideen.example.de` läuft und du sie auf `blog.example.com`
einbettest:

1. **Script-Tag mit absoluter URL**: `<script src="https://ideen.example.de/main.js">`
2. **`api-base` mit voller URL** im Attribut
3. **Backend-Konfig**: Domain von `blog.example.com` muss in der Backend-`.env`-
   Variable `APP_CORS_ORIGINS` stehen — sonst lehnt der API-Server alle Calls
   ab. Der Betreiber muss das einmalig eintragen.

## Auto-Mount

Wenn die App auf der App-Domain selbst (`/`) aufgerufen wird **ohne** dass im
HTML schon ein `<ideendb-app>`-Tag steht, mountet sich die Komponente
automatisch am `<body>`. Das ist die Default-Konfiguration des Backend-
Frontend-Bundles.

## Embed-Doku live in der App

Die App selbst hat eine Doku-Seite mit allen Snippets, **kopierbar mit einem
Klick**: Footer → **„Einbinden"**. Die Snippets dort verwenden automatisch deine
aktuelle API-Base-URL.

Auch direkt erreichbar: `https://ideen.example.de/?view=embed`

---

→ Weiter mit [Kapitel 7: Häufige Fragen](07-faq.md)
