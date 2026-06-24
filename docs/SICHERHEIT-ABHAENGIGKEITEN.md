# Sicherheits-Status der Abhängigkeiten

Stand: 2026-06-23 (Hotfix `dsgvo-deps-security`).

## Backend (Python) — ✅ sauber

`pip-audit` meldet **keine bekannten Schwachstellen** mehr. Im Hotfix gepatcht
(Floors in `backend/pyproject.toml` angehoben, damit auch frische Installs/Docker-
Builds die gepatchten Versionen ziehen):

| Paket | vorher | jetzt | Advisory |
|---|---|---|---|
| python-multipart | 0.0.26 | ≥0.0.31 (0.0.32) | CVE-2026-42561/53538/53539/53540 (Upload-Parser) |
| starlette | 1.0.0 | ≥1.3.1 | PYSEC-2026-161, CVE-2026-48817/48818/54282/54283 |
| pydantic-settings | 2.14.0 | ≥2.14.2 | GHSA-4xgf-cpjx-pc3j |
| idna | 3.13 | ≥3.15 (3.18) | PYSEC-2026-215 |
| pip (Tooling) | 26.0.1 | 26.1.2 | CVE-2026-3219/6357, PYSEC-2026-196 |

`starlette`/`idna` sind eigentlich transitive Pakete (via FastAPI bzw. httpx) — sie
sind als explizite Sicherheits-Floors notiert, damit die gepatchte Version erzwungen
wird. FastAPI 0.136.1 ist mit starlette 1.3.1 kompatibel (kein Framework-Sprung nötig).

## Frontend (npm) — teilweise gepatcht, Rest in Phase 1

`npm audit fix` (ohne `--force`) hat **39 → 26** Schwachstellen reduziert; die
**kritische** ist beseitigt. Der Rest:

- **Angular-Framework** (`@angular/core` high XSS, `@angular/common` high, `@angular/compiler` moderate):
  Fix nur durch das **Angular-21-Upgrade** (Breaking Change) → geplant als **Phase 1**.
  Kurzfristiges Restrisiko vertretbar: die App rendert überwiegend eigene Inhalte,
  Nutzereingaben laufen über Captcha/Rate-Limit/Backend-Validierung; die
  `@angular/common`-Befunde (HttpTransferCache-Leak) betreffen SSR/Hydration-Transfer-
  Cache, den diese reine Client-Web-Component nicht nutzt.
- **Build-/Dev-Tooling** (`http-proxy-middleware`, `piscina`, `postcss`,
  `serialize-javascript`, `@babel/core`): **nicht im ausgelieferten Bundle** (nur
  Build-/Dev-Zeit). `npm audit fix --force` schlägt hier einen unbrauchbaren
  Downgrade von `@angular-devkit/build-angular` vor — daher bewusst **nicht** angewandt;
  wird durch das Toolchain-Update in Phase 1 (build-angular v21) korrekt gelöst.

`--force` wurde durchgängig vermieden, da es Angular auf 21 zwingen bzw. die
Toolchain herabstufen würde — beides gehört in die getestete Phase 1, nicht in den Hotfix.
