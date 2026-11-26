"""Per-task budget for provider calls inside one student AI execution.

The execution service gives each student AI task a fixed total time. Without a
shared budget, one slow provider (or its SDK retries) used up that time and the
fallback chain never ran; worksheet fallbacks could also fan out into dozens of
serial vision calls. The budget makes every provider call:

- short: a per-call timeout capped by what is left of the task, and no SDK retry;
- countable: the number of calls is the task's metered usage;
- bounded: once the time or the call cap is spent, fallbacks stop and the task
  returns what it has instead of being cut off by the outer timeout.
"""

from __future__ import annotations

import contextvars
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Iterator

# Below this, a new provider call cannot be expected to finish in time.
MIN_CALL_SECONDS = 4.0
# Kept back so a finished call can still be parsed, saved and returned.
SETTLE_RESERVE_SECONDS = 3.0


class AiBudgetExhausted(Exception):
    """No time or calls are left for another provider request in this task."""


@dataclass
class AiCallBudget:
    deadline: float | None
    max_calls: int | None
    calls: int = 0
    failed_providers: set[str] = field(default_factory=set)

    def remaining_seconds(self) -> float | None:
        if self.deadline is None:
            return None
        return self.deadline - time.monotonic()

    def call_timeout(self, provider_timeout: float) -> float:
        """Timeout for the next call, or AiBudgetExhausted when none is left."""
        if self.max_calls is not None and self.calls >= self.max_calls:
            raise AiBudgetExhausted("model call cap reached")
        remaining = self.remaining_seconds()
        if remaining is None:
            return provider_timeout
        usable = remaining - SETTLE_RESERVE_SECONDS
        if usable < MIN_CALL_SECONDS:
            raise AiBudgetExhausted("time budget spent")
        return min(provider_timeout, usable)


_current: contextvars.ContextVar[AiCallBudget | None] = contextvars.ContextVar("ai_call_budget", default=None)


def current_budget() -> AiCallBudget | None:
    return _current.get()


@contextmanager
def ai_call_budget(total_seconds: float | None, max_calls: int | None) -> Iterator[AiCallBudget]:
    """Open a budget for one task; nested tasks keep the outer one."""
    existing = _current.get()
    if existing is not None:
        yield existing
        return
    budget = AiCallBudget(
        deadline=None if total_seconds is None else time.monotonic() + total_seconds,
        max_calls=max_calls,
    )
    token = _current.set(budget)
    try:
        yield budget
    finally:
        _current.reset(token)


def provider_skipped(provider: str) -> bool:
    """A provider that already failed in this task is not retried by later fallbacks."""
    budget = _current.get()
    return budget is not None and provider in budget.failed_providers


def mark_provider_failed(provider: str) -> None:
    budget = _current.get()
    if budget is not None:
        budget.failed_providers.add(provider)


async def create_chat_completion(client: Any, provider: str, provider_timeout: float, **kwargs: Any) -> Any:
    """One metered provider call: bounded timeout, no SDK retry.

    Raises AiBudgetExhausted before calling when the task has nothing left.
    """
    budget = _current.get()
    timeout = budget.call_timeout(provider_timeout) if budget else provider_timeout
    with_options = getattr(client, "with_options", None)
    bounded = with_options(timeout=timeout, max_retries=0) if callable(with_options) else client
    if budget is not None:
        budget.calls += 1
    try:
        return await bounded.chat.completions.create(**kwargs)
    except AiBudgetExhausted:
        raise
    except Exception:
        mark_provider_failed(provider)
        raise
