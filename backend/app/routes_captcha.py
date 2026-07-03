"""Captcha feature — the anonymous-submit math challenge (issue + verify).

Split out of routes.py (behaviour-preserving). The /captcha route is mounted back
onto the main router via ``include_router`` in routes.py; ``_captcha_verify`` is
imported there by the anonymous ``POST /ideas`` path. Self-contained: the token
lives in the ``captcha_challenge`` table.
"""

from __future__ import annotations

import secrets as _secrets
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, Request

from .db import connect
from .ratelimit import limiter

router = APIRouter()

CAPTCHA_TTL_SECONDS = 600  # 10 Min Zeit zum Lösen


def _captcha_make_question() -> tuple[str, int]:
    """Erzeugt eine einfache Plus/Minus-Aufgabe mit zweistelligen Werten.
    Ergebnis ist immer ≥ 0 (keine negativen Antworten, damit ein
    nummerisches Eingabefeld ohne Vorzeichen reicht)."""
    a = _secrets.randbelow(13) + 2  # 2..14
    b = _secrets.randbelow(10) + 1  # 1..10
    if a >= b and _secrets.randbelow(2):
        return f"Was ist {a} − {b}?", a - b
    return f"Was ist {a} + {b}?", a + b


def _captcha_cleanup(con) -> None:
    now = datetime.now(UTC).isoformat()
    con.execute(
        "DELETE FROM captcha_challenge WHERE expires_at < ? OR used = 1",
        (now,),
    )


def _captcha_issue() -> dict:
    question, answer = _captcha_make_question()
    token = _secrets.token_urlsafe(18)
    now = datetime.now(UTC)
    expires = (now + timedelta(seconds=CAPTCHA_TTL_SECONDS)).isoformat()
    with connect() as con:
        _captcha_cleanup(con)
        con.execute(
            "INSERT INTO captcha_challenge (token, answer, expires_at, used, created_at) "
            "VALUES (?, ?, ?, 0, ?)",
            (token, answer, expires, now.isoformat()),
        )
    return {"token": token, "question": question, "ttl_seconds": CAPTCHA_TTL_SECONDS}


def _captcha_verify(token: str | None, answer: int | str | None) -> None:
    """Wirft 400 wenn Token unbekannt, abgelaufen, schon verbraucht oder
    Antwort falsch. Markiert als used (Single-Use), wenn erfolgreich."""
    if not token or answer is None or str(answer).strip() == "":
        raise HTTPException(400, "Captcha-Lösung fehlt")
    try:
        ans_int = int(str(answer).strip())
    except ValueError:
        raise HTTPException(400, "Captcha-Lösung muss eine Zahl sein")
    now = datetime.now(UTC).isoformat()
    with connect() as con:
        row = con.execute(
            "SELECT answer, expires_at, used FROM captcha_challenge WHERE token = ?",
            (token,),
        ).fetchone()
        if not row:
            raise HTTPException(400, "Captcha abgelaufen oder unbekannt — bitte neu laden")
        if row["used"]:
            raise HTTPException(400, "Captcha schon verwendet — bitte neu laden")
        if row["expires_at"] < now:
            raise HTTPException(400, "Captcha abgelaufen — bitte neu laden")
        if int(row["answer"]) != ans_int:
            # Falsche Antwort verbraucht das Token NICHT → Tippfehler-Retry möglich.
            raise HTTPException(400, "Captcha-Antwort falsch — bitte neu versuchen")
        # Single-Use ATOMAR einlösen: das DELETE ist der Claim. Gewinnt ein
        # paralleler Request mit demselben Token das Rennen (TOCTOU zwischen
        # SELECT und DELETE), löscht er die Zeile zuerst; unser DELETE trifft dann
        # 0 Zeilen → wir lehnen ab. So kann ein gelöstes Captcha nicht doppelt
        # eingelöst werden. (Löschen statt „used"-Flag hält die Tabelle klein.)
        claimed = con.execute("DELETE FROM captcha_challenge WHERE token = ?", (token,)).rowcount
        if claimed != 1:
            raise HTTPException(400, "Captcha schon verwendet — bitte neu laden")


@router.get("/captcha", tags=["public"])
@limiter.limit("30/minute")
def captcha_new(request: Request):
    """Liefert eine frische Mathe-Aufgabe + Single-Use-Token.

    Frontend rendert `question` als Klartext-Frage, sammelt die Antwort
    und sendet beim anonymen `POST /ideas` `captcha_token` +
    `captcha_answer` mit. Eingeloggte User brauchen nichts davon."""
    return _captcha_issue()
