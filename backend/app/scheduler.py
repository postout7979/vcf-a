import logging

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

from app.config import settings
from app.sync_service import run_sync

logger = logging.getLogger("vcf_portal.scheduler")

scheduler = BackgroundScheduler(timezone="UTC")


def _scheduled_job() -> None:
    logger.info("Starting scheduled sync (every %d min)", settings.sync_interval_minutes)
    run_sync(trigger="scheduled")


def start_scheduler() -> None:
    if scheduler.running:
        return
    scheduler.add_job(
        _scheduled_job,
        trigger=IntervalTrigger(minutes=settings.sync_interval_minutes),
        id="catalog_sync",
        replace_existing=True,
        next_run_time=None,
    )
    scheduler.start()


def next_run_time_iso() -> str | None:
    job = scheduler.get_job("catalog_sync")
    if job and job.next_run_time:
        return job.next_run_time.isoformat()
    return None
