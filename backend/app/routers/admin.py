from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from app.config import settings
from app.db import get_session
from app.models import SyncEvent
from app.scheduler import next_run_time_iso
from app.sync_service import run_sync

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.post("/sync")
def trigger_manual_sync():
    event = run_sync(trigger="manual")
    return event


@router.get("/sync/history")
def sync_history(limit: int = 20, session: Session = Depends(get_session)):
    events = session.exec(
        select(SyncEvent).order_by(SyncEvent.started_at.desc()).limit(limit)
    ).all()
    return events


@router.get("/sync/status")
def sync_status(session: Session = Depends(get_session)):
    latest = session.exec(
        select(SyncEvent).order_by(SyncEvent.started_at.desc()).limit(1)
    ).first()
    return {
        "latest": latest,
        "nextRunAt": next_run_time_iso(),
        "intervalMinutes": settings.sync_interval_minutes,
    }
