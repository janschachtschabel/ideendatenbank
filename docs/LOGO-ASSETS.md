# Logo-Assets

> Hinweis: aus `frontend/public/assets/README.md` hierher verschoben, damit diese
> interne Notiz nicht öffentlich mit ausgeliefert wird.

Bitte zwei Dateien hier ablegen (von Dir bereitgestellt):

- `hackathoern-logo-dark.png`  — Version mit weißer Schrift auf dunklem Hintergrund (für Topbar)
- `hackathoern-logo-light.png` — Version mit dunkler Schrift auf hellem Hintergrund (für Hero/Footer)

Die App zeigt einen Text-Fallback, falls die Dateien fehlen.

## Favicon (erledigt)

Aus der 512×512-Vorlage `Muster-Favicon.png` (Repo-Wurzel der Ideendatenbank) erzeugter
Standard-Satz in `frontend/public/`:

- `favicon.ico` — Multi-Resolution 16/32/48 (Browser-Tab + automatischer `/favicon.ico`)
- `favicon-16x16.png`, `favicon-32x32.png` — explizite PNG-Varianten
- `apple-touch-icon.png` — 180×180 auf weißem Grund (iOS macht Transparenz sonst schwarz)

Referenziert in `src/index.html`. Wird beim Build nach `dist/embed/browser/` kopiert und
vom Backend mit ausgeliefert — kein generisches Angular-Icon mehr. Neu erzeugen: aus der
Vorlage mit Pillow auf die o. g. Größen skalieren (`.ico` mit `sizes=[(16,16),(32,32),(48,48)]`).
