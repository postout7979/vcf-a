import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db import init_db
from app.routers import admin, catalog, dashboard, deploy, projects
from app.scheduler import scheduler, start_scheduler
from app.sync_service import run_sync

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="VCF Cloud Management Portal API", version="1.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(catalog.router)
app.include_router(deploy.router)
app.include_router(admin.router)
app.include_router(dashboard.router)
app.include_router(projects.router)


@app.on_event("startup")
def on_startup() -> None:
    init_db()
    start_scheduler()
    run_sync(trigger="scheduled")


@app.on_event("shutdown")
def on_shutdown() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)


@app.get("/api/health")
def health():
    return {"status": "ok"}
