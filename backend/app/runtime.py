import asyncio
import time
from collections import OrderedDict, deque
from .errors import SearchError

class TTLCache:
    def __init__(self, ttl=900, capacity=200, clock=time.monotonic):
        self.ttl, self.capacity, self.clock = ttl, capacity, clock
        self.entries = OrderedDict()
        self.inflight = {}

    async def get_or_create(self, key, factory):
        now = self.clock()
        for old in list(self.entries):
            if self.entries[old][0] <= now:
                del self.entries[old]
        if key in self.entries:
            self.entries.move_to_end(key)
            return self.entries[key][1]
        if key not in self.inflight:
            self.inflight[key] = asyncio.create_task(self._load(key, factory))
        return await asyncio.shield(self.inflight[key])

    async def _load(self, key, factory):
        try:
            result = await factory()
            self.entries[key] = (self.clock() + self.ttl, result)
            while len(self.entries) > self.capacity:
                self.entries.popitem(last=False)
            return result
        finally:
            self.inflight.pop(key, None)

class RateLimiter:
    """Global per-process sliding window; no unbounded client identity map."""
    def __init__(self, limit=10, clock=time.monotonic):
        self.limit, self.clock, self.hits = limit, clock, deque()

    def check(self):
        now = self.clock()
        while self.hits and self.hits[0] <= now - 60:
            self.hits.popleft()
        if len(self.hits) >= self.limit:
            raise SearchError('rate_limit', 'Слишком много запросов. Попробуйте через минуту.', 429, max(1, int(60 - (now - self.hits[0])) + 1))
        self.hits.append(now)
