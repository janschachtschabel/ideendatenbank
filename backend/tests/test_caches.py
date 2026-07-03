"""Bounded TTL-cache eviction (``app.caches.evict_expired_and_cap``).

Pins that expired entries are dropped and the dict is capped oldest-first, so the
auth (``_MOD_CACHE``) and display-name (``_DISPLAY_NAME_CACHE``) caches cannot
grow unbounded from many distinct credentials/users.
"""

from __future__ import annotations

from app.caches import evict_expired_and_cap


def test_expired_entries_are_dropped():
    cache = {"fresh": (1, 100.0), "stale": (2, 50.0)}
    evict_expired_and_cap(cache, now=75.0, max_entries=100)
    assert "fresh" in cache
    assert "stale" not in cache  # expiry 50 <= now 75


def test_capped_oldest_first():
    cache = {f"k{i}": (i, 1000.0) for i in range(10)}  # all unexpired
    evict_expired_and_cap(cache, now=0.0, max_entries=5)
    assert list(cache.keys()) == ["k5", "k6", "k7", "k8", "k9"]


def test_expired_removed_before_capping():
    cache = {"old": (0, 10.0), "a": (1, 1000.0), "b": (2, 1000.0)}
    evict_expired_and_cap(cache, now=50.0, max_entries=2)  # "old" expires → a,b fit
    assert set(cache.keys()) == {"a", "b"}
