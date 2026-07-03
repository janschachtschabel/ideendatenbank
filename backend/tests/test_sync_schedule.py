"""Nightly-sync scheduling helpers.

Pins the pure scheduling math (``seconds_until_hour``) and the fresh-volume
cache check (``cache_is_empty``) that together replace the old fixed-interval
sync loop: the sync now runs once nightly + on manual trigger, never at startup
except on an empty cache.
"""

from __future__ import annotations

from datetime import UTC, datetime

from app.sync import cache_is_empty, seconds_until_hour


def test_seconds_until_hour_later_today():
    now = datetime(2026, 7, 1, 0, 30, tzinfo=UTC)  # 00:30 → next 01:00 is 30 min away
    assert seconds_until_hour(now, 1) == 30 * 60


def test_seconds_until_hour_wraps_to_next_day():
    now = datetime(2026, 7, 1, 2, 0, tzinfo=UTC)  # 02:00, already past 01:00 → tomorrow
    assert seconds_until_hour(now, 1) == 23 * 3600


def test_seconds_until_hour_exactly_on_hour_is_next_day():
    now = datetime(2026, 7, 1, 1, 0, tzinfo=UTC)  # exactly 01:00 → avoid immediate re-fire
    assert seconds_until_hour(now, 1) == 24 * 3600


def test_cache_is_empty_true_on_fresh_db():
    # The autouse _fresh_db fixture provides an empty DB per test.
    assert cache_is_empty() is True


def test_cache_is_empty_false_after_seed(seed_idea):
    seed_idea("idea-1")
    assert cache_is_empty() is False
