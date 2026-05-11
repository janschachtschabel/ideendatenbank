from __future__ import annotations

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # edu-sharing
    edu_repo_base_url: str = "https://redaktion.openeduhub.net"
    edu_repo_api: str = "https://redaktion.openeduhub.net/edu-sharing/rest"
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
    sync_interval_seconds: int = 300

    # Backup
    backup_enabled: bool = True
    backup_dir: Path = Path("./data/backups")
    backup_interval_hours: int = 24
    backup_keep: int = 3

    # KI (optional)
    b_api_key: str | None = Field(default=None, alias="B_API_KEY")
    llm_base_url: str = "https://b-api.prod.openeduhub.net/api/v1/llm/openai"
    llm_model: str = "gpt-4.1-mini"

    # Moderation — Mitglieder einer dieser edu-sharing-Gruppen haben Zugriff
    # auf Taxonomie-Verwaltung, Inbox-Postfach, Verschieben, fremde Ideen
    # bearbeiten. Default ist GROUP_ALFRESCO_ADMINISTRATORS (Repo-Admins);
    # weitere Gruppen können kommasepariert angehängt werden.
    moderation_fallback_groups: str = "GROUP_ALFRESCO_ADMINISTRATORS"
    # Komma-Liste von Usernamen, die unabhängig von der Gruppe immer
    # Moderator-Status haben (Bootstrap, bevor die Gruppe existiert).
    moderation_bootstrap_users: str = ""

    @property
    def fallback_mod_groups(self) -> list[str]:
        return [g.strip() for g in self.moderation_fallback_groups.split(",") if g.strip()]

    @property
    def bootstrap_mod_users(self) -> list[str]:
        return [u.strip() for u in self.moderation_bootstrap_users.split(",") if u.strip()]

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.app_cors_origins.split(",") if o.strip()]


settings = Settings()
