# syntax=docker/dockerfile:1.7
#
# Ideendatenbank — kombiniertes Image (Backend + gebautes Frontend)
#
# Stage 1: Frontend bauen (Node 20)
# Stage 2: Backend mit FastAPI + slim Python, kopiert das gebaute Bundle rein
# Laufzeit: uvicorn serviert API + Bundle aus dem gleichen Container.
#
# Build:    docker build -t ideendatenbank .
# Run:      docker run --rm -p 8000:8000 -v ideendb-data:/data ideendatenbank
# Compose:  docker compose up -d  (siehe docker-compose.yml)

# =========================================================================
# Stage 1 — Frontend bauen
# =========================================================================
FROM node:20-bookworm-slim AS frontend-builder

WORKDIR /build

# Erst nur die package.* — Layer-Cache für npm install bleibt heile,
# solange sich Dependencies nicht ändern.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY frontend/ ./
RUN npm run build:embed

# =========================================================================
# Stage 2 — Backend (Python slim) + gebautes Bundle
# =========================================================================
FROM python:3.12-slim-bookworm AS runtime

# System-Updates + curl für Healthcheck (klein gehalten)
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Non-root user für Runtime
RUN groupadd -r app && useradd -r -g app -m -s /bin/bash app

WORKDIR /app

# Python-Dependencies zuerst — Cache-freundlich
COPY backend/pyproject.toml ./backend/pyproject.toml
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir \
        "fastapi>=0.115" "uvicorn[standard]>=0.32" "httpx>=0.27" \
        "pydantic>=2.9" "pydantic-settings>=2.5" \
        "python-multipart>=0.0.9" "slowapi>=0.1.9"

# Backend-Code
COPY backend/ ./backend/
RUN pip install --no-cache-dir -e ./backend

# Frontend-Bundle aus Stage 1 — landet genau dort, wo main.py es erwartet
# (frontend/dist/embed/browser/, relative zu app/main.py)
COPY --from=frontend-builder /build/dist/embed/browser/ ./frontend/dist/embed/browser/

# Daten-Verzeichnis (SQLite + Backups). Volume mountbar.
RUN mkdir -p /data /app/backend/data && \
    ln -sf /data /app/backend/data-volume && \
    chown -R app:app /app /data

USER app

# Sensible Defaults via env. Werden vom docker-compose oder
# `docker run -e` überschrieben. Secrets gehören NICHT ins Image.
ENV APP_HOST=0.0.0.0 \
    APP_PORT=8000 \
    SQLITE_PATH=/data/ideendb.sqlite \
    BACKUP_DIR=/data/backups \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app/backend

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8000/api/v1/topics > /dev/null || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--log-level", "info"]
