from __future__ import annotations

from pathlib import Path

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # edu-sharing
    edu_repo_base_url: str = "https://redaktion.openeduhub.net"
    # API-Basis. Wenn leer gelassen, wird sie automatisch aus
    # `edu_repo_base_url` abgeleitet (`<base>/edu-sharing/rest`) — so muss man
    # bei einem anderen Repo nur EDU_REPO_BASE_URL setzen. Explizit per
    # EDU_REPO_API überschreibbar, falls die API woanders liegt.
    edu_repo_api: str = ""

    @model_validator(mode="after")
    def _derive_repo_api(self) -> Settings:
        if not (self.edu_repo_api or "").strip():
            self.edu_repo_api = f"{self.edu_repo_base_url.rstrip('/')}/edu-sharing/rest"
        return self

    # Gast-Account ohne Default — Pflicht über .env / ENV-Variable.
    # Lieber harter Fehler beim Start als unbeabsichtigt mit
    # hard-coded Test-Credentials gegen Prod laufen.
    edu_guest_user: str = ""
    edu_guest_pass: str = ""
    edu_guest_inbox_id: str = "21144164-30c0-4c01-ae16-264452197063"

    # Ideendatenbank-Root
    ideendb_root_collection_id: str = "4197d4d2-c700-400c-97d4-d2c700900c68"

    # FastAPI
    app_host: str = "127.0.0.1"
    app_port: int = 8000
    app_cors_origins: str = "http://localhost:4200,https://wp-test.wirlernenonline.de"

    # SQLite
    sqlite_path: Path = Path("./data/ideendb.sqlite")
    # DEPRECATED: Der Sync läuft nicht mehr im Intervall, sondern einmal nachts
    # (siehe `sync_nightly_hour`). Feld bleibt nur für Backward-Compat bereits
    # gesetzter SYNC_INTERVAL_SECONDS-Env-Werte; es wird NICHT mehr ausgewertet.
    sync_interval_seconds: int = 900
    # Uhrzeit (UTC-Stunde 0–23) des nächtlichen Voll-Syncs. Der Sync läuft
    # bewusst NICHT beim App-Start (konkurriert sonst mit den ersten Requests)
    # und nicht im Minutentakt: die SQLite-Cache-Datei überlebt Restarts auf dem
    # Volume, und Schreibvorgänge lösen refresh_idea (Einzelknoten) aus. Ausnahme:
    # ist der Cache beim Start LEER (frisches Volume ohne Backup), läuft einmalig
    # ein Initial-Sync. Manueller Voll-Sync jederzeit über POST /admin/sync.
    sync_nightly_hour: int = 1

    # Rating-Verfall (exponentiell mit Mindestgewicht). Ältere Stimmen verlieren
    # mit der Zeit an Gewicht (w(t) = max(floor, 0.5^(t/halflife))), damit die
    # Rangliste „aktuell" bleibt und neue Ideen aufholen können. Die kumulative
    # Gesamtsumme OHNE Verfall bleibt erhalten und wird in der Balkengrafik
    # gezeigt. Halbwertszeit in Tagen: nach `halflife` Tagen zählt eine Stimme
    # noch halb. 90 Tage ≈ 7d→0.95, 30d→0.79, 90d→0.50, 180d→0.25.
    # `floor` = Verfallsstopp: eine Stimme zählt nie weniger als dieser Anteil
    # (Default 0.20), damit Bestand nicht vollständig entwertet wird.
    rating_decay_enabled: bool = True
    rating_decay_halflife_days: float = 90.0
    rating_decay_floor: float = 0.20

    @property
    def rating_decay_lambda(self) -> float:
        """Verfallsrate λ pro Tag, abgeleitet aus der Halbwertszeit."""
        import math

        hl = self.rating_decay_halflife_days or 0.0
        return (math.log(2) / hl) if hl > 0 else 0.0

    # Ephemeral-DB-Modus (Variante A des Storage-Befunds 07/2026): die SQLite-
    # Datei liegt auf einer RAM-Disk (tmpfs) — der Request-Pfad berührt den
    # (ggf. trägen) Cluster-Storage nie. Persistenz übernehmen die Backups auf
    # dem echten Volume: JEDER Pod-Start restauriert aus dem jüngsten Backup
    # (Marker wird nicht konsumiert), Backups laufen minütlich-granular
    # (backup_interval_minutes) und zusätzlich beim geplanten Shutdown.
    # Verlustfenster: nur bei HARTEM Crash die App-eigenen Writes seit dem
    # letzten Backup (edu-sharing-Inhalte stellt der Sync ohnehin wieder her).
    db_ephemeral: bool = False

    # Backup
    backup_enabled: bool = True
    backup_dir: Path = Path("./data/backups")
    backup_interval_hours: int = 24
    # >0 übersteuert das Stunden-Intervall (Minuten-Granularität — im
    # Ephemeral-Modus ist das Backup-Intervall zugleich das Verlustfenster).
    backup_interval_minutes: int = 0
    backup_keep: int = 3
    # Auto-Restore beim Erststart nur, wenn diese Marker-Datei im
    # Backup-Verzeichnis existiert (`<backup_dir>/AUTO_RESTORE_OK`).
    # Sicherheits-Opt-in: verhindert, dass ein versehentlich oder
    # böswillig hineingelegtes ZIP automatisch produktiv geladen wird.
    backup_auto_restore_marker: str = "AUTO_RESTORE_OK"

    # Upload-Größen-Limits (Bytes). Schützt vor RAM-/Disk-Ausnutzung.
    # Schwellwerte gelten je Einzel-Upload und gelten zusätzlich zu
    # ggf. davor geschalteten Reverse-Proxy-Limits (nginx
    # client_max_body_size).
    upload_image_max_bytes: int = 10 * 1024 * 1024  # 10 MB Vorschaubilder
    upload_content_max_bytes: int = 50 * 1024 * 1024  # 50 MB Idee-Hauptinhalte
    upload_attachment_max_bytes: int = 50 * 1024 * 1024  # 50 MB pro Anhang
    # Obergrenze für Serienobjekt-Anhänge pro Idee (Frontend-Submit erlaubt 4,
    # die Ideenseite mehr; diese Gesamt-Grenze greift serverseitig — wichtig,
    # seit anonyme Uploads über den Gast erlaubt sind).
    max_attachments_per_idea: int = 20
    upload_restore_max_bytes: int = 200 * 1024 * 1024  # 200 MB Backup-Restore

    # KI (optional)
    b_api_key: str | None = Field(default=None, alias="B_API_KEY")
    llm_base_url: str = "https://b-api.prod.openeduhub.net/api/v1/llm/openai"
    llm_model: str = "gpt-4.1-mini"

    # Thread-Pools explizit dimensionieren (statt CPU-abhängiger Defaults):
    # - `threadpool_db_workers`: asyncio-Default-Executor, über den ALLE
    #   `asyncio.to_thread`-DB-Zugriffe laufen. Python-Default ist
    #   min(32, CPU+4) — auf kleinen Containern (1–2 vCPU) nur 5–6 Threads;
    #   bei Event-Verkehrsspitzen stauen sich dort sonst die async DB-Pfade,
    #   während sync-Routen (eigener Pool) flott bleiben → schwer
    #   diagnostizierbare Teil-Verlangsamung.
    # - `threadpool_sync_routes`: anyio-Limiter, der alle sync-`def`-Routen
    #   (Listen/Meta/Ranking/Bootstrap) trägt. Bibliotheks-Default: 40.
    threadpool_db_workers: int = 32
    threadpool_sync_routes: int = 64

    # Moderation — Mitglieder einer dieser edu-sharing-Gruppen haben Zugriff
    # auf Taxonomie-Verwaltung, Inbox-Postfach, Verschieben, fremde Ideen
    # bearbeiten. Default ist GROUP_ALFRESCO_ADMINISTRATORS (Repo-Admins);
    # weitere Gruppen können kommasepariert angehängt werden.
    moderation_fallback_groups: str = "GROUP_ALFRESCO_ADMINISTRATORS"

    @property
    def fallback_mod_groups(self) -> list[str]:
        return [g.strip() for g in self.moderation_fallback_groups.split(",") if g.strip()]

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.app_cors_origins.split(",") if o.strip()]


settings = Settings()
