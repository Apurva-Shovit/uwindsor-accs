"""
Background generator for facility notifications.

Runs in-process on the API's own event loop rather than as a separate Render
cron service, because each pass rebuilds the whole lookback window from live
data instead of diffing since the last run. That makes a missed pass a non-event:
whenever the service next wakes up, the first sweep backfills everything the
downtime would otherwise have skipped. A cron service would have to be paid for
and would still have that same gap, without the self-healing.

The first sweep runs at startup for exactly that reason — a freshly woken
container serves a correct feed on its first request, not on the first tick.
"""
import asyncio
import logging

from ..config import settings
from .notification_service import NotificationService

logger = logging.getLogger(__name__)

# How long to wait before retrying after a failed pass. Short enough to recover
# from a blip, long enough that a persistent fault is not a hot loop against the
# database.
_RETRY_SECONDS = 60


async def run_once() -> dict:
    """One reconciliation pass. Raises on failure so callers can decide."""
    result = await NotificationService.sweep()
    logger.info(
        "notification sweep: %(created)s created, %(updated)s updated, "
        "%(removed)s removed across %(users)s users in %(duration_ms)sms",
        result,
    )
    return result


async def notification_sweeper() -> None:
    """Sweep on startup, then on a fixed interval, until cancelled."""
    interval = max(60, settings.NOTIFICATION_SWEEP_INTERVAL_MINUTES * 60)

    while True:
        delay = interval
        try:
            await run_once()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            # A failing sweep must not take the API down with it, and must not
            # stop later passes from trying again.
            logger.exception("notification sweep failed: %s", exc)
            delay = min(_RETRY_SECONDS, interval)
            try:
                await NotificationService.record_sweep_failure(str(exc))
            except Exception:
                logger.exception("could not record notification sweep failure")

        try:
            await asyncio.sleep(delay)
        except asyncio.CancelledError:
            raise


def start(app) -> None:
    """Attach the sweeper to the running app so shutdown can cancel it."""
    app.state.notification_sweeper = asyncio.create_task(notification_sweeper())


async def stop(app) -> None:
    task = getattr(app.state, "notification_sweeper", None)
    if task is None:
        return
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    app.state.notification_sweeper = None
