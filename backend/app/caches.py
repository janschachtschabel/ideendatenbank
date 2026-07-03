"""Bounded-TTL-cache hygiene shared by the auth and display-name caches.

Both are ``{key: (value, expiry_ts)}`` dicts keyed by a per-user/per-credential
string. Without bounding they grow unbounded when many distinct keys appear
(e.g. one entry per Authorization header) — a slow memory-growth vector. Keeping
the eviction in one tested place avoids duplicating the logic at each cache.
"""

from __future__ import annotations


def evict_expired_and_cap(
    cache: dict[str, tuple[object, float]], now: float, max_entries: int
) -> None:
    """Bound a ``{key: (value, expiry_ts)}`` TTL dict *in place*.

    First drop entries whose ``expiry_ts`` has passed (``<= now``); if the dict is
    still larger than ``max_entries``, drop the oldest-inserted entries until it
    fits. ``now`` must use the same clock the caller stamped the expiries with
    (``time.monotonic()``).
    """
    expired = [k for k, (_, exp) in cache.items() if exp <= now]
    for k in expired:
        del cache[k]
    while len(cache) > max_entries:
        # dict preserves insertion order → the first key is the oldest inserted.
        del cache[next(iter(cache))]
